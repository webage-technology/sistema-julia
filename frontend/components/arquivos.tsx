'use client'

// Arquivos (GED) de um processo, imóvel, cliente ou vistoria: lista por
// categoria, envio com validade e visibilidade no portal, versão nova "no
// lugar de" outra, edição e exclusão. O diálogo tem endereço (?arquivo=novo
// ou ?arquivo=<id>) como toda tela do sistema.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Eye, EyeOff, FileText, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado } from '@/lib/url'
import { SELECT_CLASS } from '@/lib/vistorias'
import { Arquivo, CATEGORIA_ARQUIVO_LABEL, dia, dataHora, tamanho } from '@/lib/regularizacao'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Props {
  processoId?: number
  imovelId?: number
  clientId?: number
  vistoriaId?: number
  podeExcluir?: boolean
  param?: string
  titulo?: string
  aoMudar?: () => void
}

export function Arquivos({ processoId, imovelId, clientId, vistoriaId, podeExcluir = true, param = 'arquivo', titulo, aoMudar }: Props) {
  const [lista, setLista] = useState<Arquivo[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [filtro, setFiltro] = useState('')
  const [dialogo, setDialogo] = useParamEstado(param)
  const [form, setForm] = useState({ nome: '', categoria: 'outro', descricao: '', validade: '', visivelCliente: false, substituiId: '' })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtroDono = useMemo(() => {
    const q = new URLSearchParams()
    if (processoId) q.set('processoId', String(processoId))
    if (imovelId) q.set('imovelId', String(imovelId))
    if (clientId) q.set('clientId', String(clientId))
    if (vistoriaId) q.set('vistoriaId', String(vistoriaId))
    return q.toString()
  }, [processoId, imovelId, clientId, vistoriaId])

  const carregar = useCallback(() => {
    api.get<{ data: Arquivo[]; categorias: string[] }>(`/arquivos?${filtroDono}`).then((r) => {
      setLista(r.data)
      setCategorias(r.categorias)
    })
  }, [filtroDono])
  useEffect(() => {
    carregar()
  }, [carregar])

  const editando = lista.find((a) => String(a.id) === dialogo) || null
  const substituindo = dialogo?.startsWith('v') ? lista.find((a) => String(a.id) === dialogo.slice(1)) || null : null
  const open = dialogo === 'novo' || !!editando || !!substituindo

  useEffect(() => {
    if (!open) return
    setErro(null)
    setArquivo(null)
    if (editando) setForm({ nome: editando.nome, categoria: editando.categoria, descricao: editando.descricao, validade: editando.validade || '', visivelCliente: editando.visivelCliente, substituiId: '' })
    else if (substituindo) setForm({ nome: substituindo.nome, categoria: substituindo.categoria, descricao: substituindo.descricao, validade: '', visivelCliente: substituindo.visivelCliente, substituiId: String(substituindo.id) })
    else setForm({ nome: '', categoria: 'outro', descricao: '', validade: '', visivelCliente: false, substituiId: '' })
  }, [open, editando?.id, substituindo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      if (editando) {
        await api.put(`/arquivos/${editando.id}`, { nome: form.nome, categoria: form.categoria, descricao: form.descricao, validade: form.validade || null, visivelCliente: form.visivelCliente })
      } else {
        if (!arquivo) throw new Error('Escolha o arquivo')
        const fd = new FormData()
        fd.append('arquivo', arquivo)
        if (processoId) fd.append('processoId', String(processoId))
        if (imovelId) fd.append('imovelId', String(imovelId))
        if (clientId) fd.append('clientId', String(clientId))
        if (vistoriaId) fd.append('vistoriaId', String(vistoriaId))
        fd.append('categoria', form.categoria)
        fd.append('nome', form.nome)
        fd.append('descricao', form.descricao)
        if (form.validade) fd.append('validade', form.validade)
        fd.append('visivelCliente', form.visivelCliente ? '1' : '0')
        if (form.substituiId) fd.append('substituiId', form.substituiId)
        await api.upload('/arquivos', fd)
      }
      setDialogo(null)
      carregar()
      aoMudar?.()
    } catch (err: any) {
      setErro(err?.message || 'Falha ao salvar')
    } finally {
      setEnviando(false)
    }
  }

  const excluir = async (a: Arquivo) => {
    if (!confirm(`Excluir o arquivo “${a.nome}”${a.versao > 1 ? ` (v${a.versao})` : ''}?`)) return
    try {
      await api.del(`/arquivos/${a.id}`)
      carregar()
      aoMudar?.()
    } catch (err: any) {
      alert(err?.message || 'Falha ao excluir')
    }
  }

  const visiveis = filtro ? lista.filter((a) => a.categoria === filtro) : lista
  const usadas = [...new Set(lista.map((a) => a.categoria))]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {titulo && <p className="text-sm font-semibold">{titulo}</p>}
        {usadas.length > 1 && (
          <select className={`${SELECT_CLASS} h-8 w-auto`} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todas as categorias</option>
            {usadas.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_ARQUIVO_LABEL[c] || c}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" className="ml-auto" onClick={() => setDialogo('novo')}>
          <Upload className="h-4 w-4" /> Enviar arquivo
        </Button>
      </div>
      {visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum arquivo. Matrícula, IPTU, alvará, DWG, guias pagas, contrato — tudo fica aqui, com categoria, validade e versão.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {visiveis.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <a href={apiUrl(`/arquivos/${a.id}/download`)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {a.nome}
                </a>
                {a.versao > 1 && <span className="ml-1 rounded bg-muted px-1 text-[10px]">v{a.versao}</span>}
                <span className="block truncate text-xs text-muted-foreground">
                  {CATEGORIA_ARQUIVO_LABEL[a.categoria] || a.categoria} · {a.nomeOriginal} · {tamanho(a.tamanho)} · {dataHora(a.createdAt)}
                  {a.enviadoPeloCliente ? ' · enviado pelo cliente' : a.enviadoPorNome ? ` · ${a.enviadoPorNome}` : ''}
                  {a.descricao ? ` · ${a.descricao}` : ''}
                </span>
              </span>
              {a.validade && (
                <span className={`flex items-center gap-1 text-xs ${a.vencido ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                  {a.vencido && <AlertTriangle className="h-3 w-3" />}
                  {a.vencido ? 'venceu' : 'vale até'} {dia(a.validade)}
                </span>
              )}
              <span title={a.visivelCliente ? 'Visível no portal do cliente' : 'Só a equipe vê'} className="text-muted-foreground">
                {a.visivelCliente ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </span>
              <a href={apiUrl(`/arquivos/${a.id}/download?download=1`)} className="text-muted-foreground hover:text-foreground" title="Baixar">
                <Download className="h-4 w-4" />
              </a>
              <button className="text-muted-foreground hover:text-foreground" title="Enviar versão nova" onClick={() => setDialogo(`v${a.id}`)}>
                <RefreshCw className="h-4 w-4" />
              </button>
              <button className="text-muted-foreground hover:text-foreground" title="Editar" onClick={() => setDialogo(String(a.id))}>
                <Pencil className="h-4 w-4" />
              </button>
              {podeExcluir && (
                <button className="text-destructive" title="Excluir" onClick={() => excluir(a)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && setDialogo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar arquivo' : substituindo ? `Nova versão de “${substituindo.nome}”` : 'Enviar arquivo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-3">
            {!editando && (
              <div className="space-y-1.5">
                <Label>Arquivo</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                    <Plus className="h-4 w-4" /> Escolher
                  </Button>
                  <span className="truncate text-sm text-muted-foreground">{arquivo?.name || 'Nenhum escolhido'}</span>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    setArquivo(f)
                    if (f && !form.nome) setForm((x) => ({ ...x, nome: f.name.replace(/\.[^.]+$/, '') }))
                  }}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Matrícula 123.456" />
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <select className={SELECT_CLASS} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} disabled={!!substituindo}>
                  {(categorias.length ? categorias : Object.keys(CATEGORIA_ARQUIVO_LABEL)).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORIA_ARQUIVO_LABEL[c] || c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Validade (opcional)</Label>
                <Input type="date" value={form.validade} onChange={(e) => setForm({ ...form, validade: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Descrição</Label>
                <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.visivelCliente} onChange={(e) => setForm({ ...form, visivelCliente: e.target.checked })} />
              Visível no portal do cliente
            </label>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogo(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando ? 'Salvando…' : editando ? 'Salvar' : 'Enviar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
