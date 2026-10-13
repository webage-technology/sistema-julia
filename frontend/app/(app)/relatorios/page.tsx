'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Download, Eye, EyeOff, FileCheck, FileText, Images, Library, PenLine, Plus, Search, Trash2 } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { Modelo, Relatorio, SELECT_CLASS, VistoriaResumo, filtrarPorTexto } from '@/lib/vistorias'
import { Laudo, dataHora, dia, tamanho } from '@/lib/regularizacao'
import { ehAdmin, ehTecnico } from '@/lib/papeis'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

// Área de Relatórios. É UMA tela com duas abas (?aba=): os DOCUMENTOS em Word
// (o que já existia) e os LAUDOS EMITIDOS em PDF (numerados, versionados,
// congelados). Os dois usos por filtro continuam:
//   /relatorios?imovel=3 · ?vistoria=12 · ?cliente=4
export default function RelatoriosPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Relatorio[]>([])
  const [laudos, setLaudos] = useState<Laudo[]>([])
  const [vistorias, setVistorias] = useState<VistoriaResumo[]>([])
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [me, setMe] = useState<{ role?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useParamEstado('aba')
  const [vistoria] = useParamEstado('vistoria')
  const [imovel] = useParamEstado('imovel')
  const [cliente] = useParamEstado('cliente')
  const [busca, setBusca] = useParamEstado('busca')
  const [novo, setNovo] = useParamEstado('novo')
  const open = novo === '1'
  const [form, setForm] = useState({ vistoriaId: '', modeloId: '', titulo: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const assinadoRef = useRef<HTMLInputElement>(null)
  const [alvoAssinado, setAlvoAssinado] = useState<number | null>(null)
  const emitidos = aba === 'emitidos'

  const filtro = useMemo(() => {
    const q = new URLSearchParams()
    if (vistoria) q.set('vistoriaId', vistoria)
    if (imovel) q.set('imovelId', imovel)
    if (cliente) q.set('clienteId', cliente)
    return q.toString()
  }, [vistoria, imovel, cliente])

  const carregar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<{ data: Relatorio[] }>(`/relatorios${filtro ? `?${filtro}` : ''}`).then((r) => setRows(r.data)),
      api.get<{ data: Laudo[] }>(`/laudos${filtro ? `?${filtro}` : ''}`).then((r) => setLaudos(r.data)),
    ]).finally(() => setLoading(false))
  }, [filtro])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    api.get<{ data: VistoriaResumo[] }>('/vistorias').then((r) => setVistorias(r.data))
    api.get<{ data: Modelo[] }>('/modelos').then((r) => setModelos(r.data))
    api.get<{ user: { role?: string } }>('/me').then((r) => setMe(r.user))
  }, [])

  const candidatas = useMemo(
    () => vistorias.filter((v) => (!vistoria || String(v.id) === vistoria) && (!imovel || String(v.imovelId) === imovel)),
    [vistorias, vistoria, imovel]
  )

  const contexto = vistoria
    ? candidatas[0] && `vistoria #${candidatas[0].id} — ${candidatas[0].imovelNome}`
    : imovel
      ? candidatas[0]?.imovelNome
      : null

  useTitulo(open ? 'Novo relatório' : emitidos ? 'Laudos emitidos' : contexto ? `Relatórios — ${contexto}` : 'Relatórios')

  useEffect(() => {
    if (open) {
      setForm({ vistoriaId: vistoria || '', modeloId: String(modelos[0]?.id || ''), titulo: '' })
      setErro(null)
    }
  }, [open, vistoria, modelos])

  const visiveis = useMemo(
    () => filtrarPorTexto(rows, busca || '', (r) => [r.titulo, r.imovelNome, r.clienteNome, `#${r.vistoriaId}`]),
    [rows, busca]
  )
  const laudosVisiveis = useMemo(
    () => filtrarPorTexto(laudos, busca || '', (l) => [l.numero, l.titulo, l.imovelNome, l.clienteNome, `#${l.vistoriaId}`, l.processoNumero]),
    [laudos, busca]
  )

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    try {
      const r = await api.post<{ data: { id: number } }>(`/vistorias/${form.vistoriaId}/relatorios`, {
        modeloId: Number(form.modeloId),
        titulo: form.titulo || undefined,
      })
      router.push(`/relatorios/${r.data.id}`)
    } catch (err: any) {
      setErro(err?.message || 'Erro ao criar')
      setSalvando(false)
    }
  }

  const excluir = async (r: Relatorio) => {
    if (!confirm(`Excluir o relatório “${r.titulo}”? As fotos da vistoria não são apagadas.`)) return
    await api.del(`/relatorios/${r.id}`)
    carregar()
  }

  const enviarAssinado = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f || !alvoAssinado) return
    const fd = new FormData()
    fd.append('pdf', f)
    try {
      await api.upload(`/laudos/${alvoAssinado}/assinado`, fd)
      carregar()
    } catch (err: any) {
      alert(err?.message || 'Falha ao enviar')
    } finally {
      setAlvoAssinado(null)
      if (assinadoRef.current) assinadoRef.current.value = ''
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            {contexto
              ? `Somente os relatórios de ${contexto}.`
              : 'Documentos em Word e laudos emitidos em PDF de todos os imóveis. Entrando por uma vistoria ou por um imóvel, a lista vem filtrada.'}
          </p>
        </div>
        <span className="flex gap-2">
          {(vistoria || imovel || cliente) && (
            <Button variant="outline" onClick={() => router.push(`/relatorios${emitidos ? '?aba=emitidos' : ''}`)}>
              Ver todos
            </Button>
          )}
          <Link href="/relatorios/modelos">
            <Button variant="outline">
              <Library className="h-4 w-4" /> Modelos
            </Button>
          </Link>
          <Button onClick={() => setNovo('1')}>
            <Plus className="h-4 w-4" /> Novo relatório
          </Button>
        </span>
      </div>

      <div className="mb-4 inline-flex gap-1 rounded-lg border border-border bg-muted p-1">
        {[
          { k: '', label: 'Documentos (Word)', icon: FileText },
          { k: 'emitidos', label: 'Laudos emitidos (PDF)', icon: FileCheck },
        ].map((t) => {
          const Icon = t.icon
          const ativo = (aba || '') === t.k
          return (
            <button key={t.k} onClick={() => setAba(t.k || null)} className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors ${ativo ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={emitidos ? 'Buscar por número (LIP-2026-003), título, imóvel ou cliente…' : 'Buscar por título, imóvel ou cliente…'}
          value={busca || ''}
          onChange={(e) => setBusca(e.target.value || null)}
        />
      </div>
      <input ref={assinadoRef} type="file" accept=".pdf" className="hidden" onChange={(e) => enviarAssinado(e.target.files)} />

      {emitidos ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Laudo</TableHead>
                <TableHead>Imóvel / cliente</TableHead>
                <TableHead>Emitido</TableHead>
                <TableHead>Assinatura</TableHead>
                <TableHead className="w-40 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : laudosVisiveis.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {busca ? `Nenhum laudo para “${busca}”.` : 'Nenhum laudo emitido ainda — emita pela aba Relatório de uma vistoria.'}
                  </TableCell>
                </TableRow>
              ) : (
                laudosVisiveis.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">
                      {l.numero}
                      <span className="block text-muted-foreground">v{l.versao}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{l.titulo}</span>
                      <span className="block text-xs text-muted-foreground">
                        {l.paginas} páginas · {tamanho(l.tamanho)} ·{' '}
                        <Link href={`/vistorias/${l.vistoriaId}/relatorio?modelo=${l.modelo}`} className="hover:underline">
                          vistoria #{l.vistoriaId}
                        </Link>
                        {l.processoNumero ? ` · ${l.processoNumero}` : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {l.imovelNome}
                      <span className="block text-xs">{l.clienteNome}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dataHora(l.emitidoEm)}
                      <span className="block text-xs">{l.emitidoPorNome}</span>
                      {l.aprovadoEm && <span className="block text-xs text-emerald-700">aprovado pelo cliente em {dia(l.aprovadoEm)}</span>}
                    </TableCell>
                    <TableCell>
                      {l.temAssinado ? (
                        <a href={apiUrl(`/laudos/${l.id}/pdf?assinado=1`)} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 hover:underline">
                          PDF assinado ({dia(l.assinadoEm)})
                        </a>
                      ) : ehTecnico(me?.role) ? (
                        <button
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setAlvoAssinado(l.id)
                            assinadoRef.current?.click()
                          }}
                        >
                          <PenLine className="h-3 w-3" /> anexar assinado
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <a href={apiUrl(`/laudos/${l.id}/pdf`)} target="_blank" rel="noreferrer" title="Abrir PDF">
                        <Button variant="ghost" size="icon">
                          <FileText className="h-4 w-4" />
                        </Button>
                      </a>
                      <a href={apiUrl(`/laudos/${l.id}/pdf?download=1`)} title="Baixar">
                        <Button variant="ghost" size="icon">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                      {ehTecnico(me?.role) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={l.visivelCliente ? 'Visível no portal do cliente' : 'Oculto do portal'}
                          onClick={() => api.put(`/laudos/${l.id}`, { visivelCliente: !l.visivelCliente }).then(carregar)}
                        >
                          {l.visivelCliente ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                      )}
                      {ehAdmin(me?.role) && (
                        <Button variant="ghost" size="icon" onClick={() => confirm(`Excluir o laudo ${l.numero} v${l.versao}?`) && api.del(`/laudos/${l.id}`).then(carregar)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relatório</TableHead>
                <TableHead>Imóvel</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Vistoria</TableHead>
                <TableHead className="text-center">Fotos</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : visiveis.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {busca ? `Nenhum relatório encontrado para “${busca}”.` : 'Nenhum relatório ainda — crie o primeiro em “Novo relatório”.'}
                  </TableCell>
                </TableRow>
              ) : (
                visiveis.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/relatorios/${r.id}`)}>
                    <TableCell>
                      <span className="flex items-center gap-2 font-medium">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" /> {r.titulo}
                      </span>
                      <span className="text-xs text-muted-foreground">{r.modeloNome || r.modelo}</span>
                    </TableCell>
                    <TableCell>{r.imovelNome}</TableCell>
                    <TableCell className="text-muted-foreground">{r.clienteNome}</TableCell>
                    <TableCell className="text-muted-foreground">
                      #{r.vistoriaId}
                      {r.dataVistoria ? ` · ${dia(r.dataVistoria)}` : ''}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{r.fotosIncluidas}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          excluir(r)
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo relatório</DialogTitle>
          </DialogHeader>
          <form onSubmit={criar} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Vistoria</Label>
              <select className={SELECT_CLASS} value={form.vistoriaId} onChange={(e) => setForm({ ...form, vistoriaId: e.target.value })} required>
                <option value="">Selecione…</option>
                {candidatas.map((v) => (
                  <option key={v.id} value={v.id}>
                    #{v.id} — {v.imovelNome} ({v.fotos} fotos)
                  </option>
                ))}
              </select>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Images className="h-3.5 w-3.5" />
                {modelos.find((m) => String(m.id) === form.modeloId)?.tipo === 'docx'
                  ? 'É desta vistoria que o modelo puxa cliente, imóvel, data e responsável.'
                  : 'O relatório nasce com todas as fotos dos ambientes dentro — depois é só tirar o que não entra.'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <div className="max-h-64 space-y-2 overflow-auto">
                {modelos.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setForm({ ...form, modeloId: String(m.id) })}
                    className={`block w-full rounded-md border p-3 text-left text-sm transition-colors ${form.modeloId === String(m.id) ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent'}`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <FileText className="h-4 w-4 shrink-0" /> {m.nome}
                      {m.tipo === 'docx' && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Word</span>}
                    </span>
                    {m.descricao && <span className="mt-1 block text-xs text-muted-foreground">{m.descricao}</span>}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Para o laudo em PDF numerado (EVTL, LIP, bombeiro, as-built, regularização), use “Emitir PDF” na aba Relatório da vistoria.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Título (opcional)</Label>
              <Input placeholder="Relatório fotográfico" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovo(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando || !form.vistoriaId || !form.modeloId}>
                {salvando ? 'Criando…' : 'Criar relatório'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
