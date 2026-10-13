'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Download, FileText, Lock, Trash2, Upload } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { CampoModelo, Modelo } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// Biblioteca de modelos — o armário de documentos do escritório.
//
// A Julia guarda aqui os .docx que ela já usa (laudos, declarações, pareceres)
// com as chaves {{...}} onde entram os dados. Na hora de gerar, o sistema puxa
// dos cadastros: cliente, imóvel, vistoria, responsável.
export default function ModelosPage() {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [campos, setCampos] = useState<CampoModelo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [novo, setNovo] = useParamEstado('novo')
  const open = novo === '1'
  const [form, setForm] = useState({ nome: '', descricao: '' })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)
  // Campos que cada modelo usa — carregados sob demanda ao expandir.
  const [usados, setUsados] = useState<Record<number, { campos: string[]; desconhecidos: string[] }>>({})
  const [aberto, setAberto] = useState<number | null>(null)
  const arquivoRef = useRef<HTMLInputElement>(null)

  useTitulo(open ? 'Novo modelo' : 'Modelos de documento')

  const carregar = useCallback(() => {
    setCarregando(true)
    api
      .get<{ data: Modelo[] }>('/modelos')
      .then((r) => setModelos(r.data))
      .finally(() => setCarregando(false))
  }, [])

  useEffect(() => {
    carregar()
    api.get<{ data: CampoModelo[] }>('/modelos/campos').then((r) => setCampos(r.data))
  }, [carregar])

  useEffect(() => {
    if (open) {
      setForm({ nome: '', descricao: '' })
      setArquivo(null)
      setErro(null)
    }
  }, [open])

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!arquivo) return setErro('Escolha o arquivo .docx do modelo')
    setErro(null)
    setEnviando(true)
    try {
      const fd = new FormData()
      fd.append('modelo', arquivo)
      fd.append('nome', form.nome)
      fd.append('descricao', form.descricao)
      await api.upload('/modelos', fd)
      setNovo(null)
      carregar()
    } catch (err: any) {
      setErro(err?.message || 'Falha ao enviar o modelo')
    } finally {
      setEnviando(false)
    }
  }

  const excluir = async (m: Modelo) => {
    const aviso = m.usos
      ? `Excluir “${m.nome}”? ${m.usos} relatório(s) foram feitos com ele — eles continuam existindo, mas não poderão ser gerados de novo.`
      : `Excluir o modelo “${m.nome}”?`
    if (!confirm(aviso)) return
    try {
      await api.del(`/modelos/${m.id}`)
      carregar()
    } catch (err: any) {
      alert(err?.message || 'Falha ao excluir')
    }
  }

  const verCampos = async (m: Modelo) => {
    if (aberto === m.id) return setAberto(null)
    setAberto(m.id)
    if (!usados[m.id]) {
      const r = await api.get<{ data: { campos: string[]; desconhecidos: string[] } }>(`/modelos/${m.id}/campos`)
      setUsados((u) => ({ ...u, [m.id]: r.data }))
    }
  }

  const copiar = (chave: string) => {
    navigator.clipboard?.writeText(`{{${chave}}}`)
    setCopiado(chave)
    setTimeout(() => setCopiado(null), 1500)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href="/relatorios"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Relatórios
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Modelos de documento</h1>
          <p className="text-sm text-muted-foreground">
            O armário do escritório. Guarde aqui os seus documentos em Word e o sistema preenche os dados dos cadastros
            toda vez que gerar.
          </p>
        </div>
        <Button onClick={() => setNovo('1')}>
          <Upload className="h-4 w-4" /> Novo modelo
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Modelos disponíveis</CardTitle>
          <CardDescription>
            Escolher um deles ao criar um relatório é o que decide como o documento sai.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {modelos.map((m) => (
            <div key={m.id} className="rounded-md border">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{m.nome}</span>
                {m.tipo === 'nativo' ? (
                  <span className="flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-white">
                    <Lock className="h-3 w-3" /> vem com o sistema
                  </span>
                ) : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                    Word
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {m.usos} relatório{m.usos === 1 ? '' : 's'}
                </span>
                {m.temArquivo && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => verCampos(m)}>
                      {aberto === m.id ? 'Ocultar campos' : 'Ver campos'}
                    </Button>
                    <a href={apiUrl(`/modelos/${m.id}/arquivo`)}>
                      <Button size="sm" variant="ghost" title="Baixar o modelo em branco">
                        <Download className="h-4 w-4" />
                      </Button>
                    </a>
                  </>
                )}
                {m.tipo !== 'nativo' && (
                  <Button size="sm" variant="ghost" onClick={() => excluir(m)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
              {m.descricao && <p className="px-3 pb-2 text-sm text-muted-foreground">{m.descricao}</p>}
              {aberto === m.id && (
                <div className="border-t bg-muted/30 px-3 py-2 text-sm">
                  {!usados[m.id] ? (
                    <p className="text-muted-foreground">Lendo o documento…</p>
                  ) : usados[m.id].campos.length === 0 ? (
                    <p className="text-muted-foreground">
                      Este modelo não tem nenhum campo <code>{'{{...}}'}</code> — vai sair sempre igual.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="flex flex-wrap gap-1.5">
                        {usados[m.id].campos.map((c) => (
                          <code
                            key={c}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              usados[m.id].desconhecidos.includes(c)
                                ? 'bg-destructive/10 text-destructive ring-1 ring-destructive/30'
                                : 'bg-background ring-1 ring-border'
                            }`}
                          >
                            {`{{${c}}}`}
                          </code>
                        ))}
                      </p>
                      {usados[m.id].desconhecidos.length > 0 && (
                        <p className="text-xs text-destructive">
                          Em vermelho, os campos que o sistema não conhece: eles ficam escritos como estão no documento
                          gerado. Confira a grafia na tabela abaixo.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Campos que o sistema preenche</CardTitle>
          <CardDescription>
            No Word, escreva a chave onde o dado deve entrar — por exemplo{' '}
            <code className="rounded bg-muted px-1">Cliente: {'{{cliente}}'}</code>. Clique para copiar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 sm:grid-cols-2">
            {campos.map((c) => (
              <li key={c.chave}>
                <button
                  onClick={() => copiar(c.chave)}
                  className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                >
                  <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">{`{{${c.chave}}}`}</code>
                  <span className="text-muted-foreground">{c.descricao}</span>
                  {copiado === c.chave && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo modelo de documento</DialogTitle>
          </DialogHeader>
          <form onSubmit={enviar} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Envie o arquivo Word (.docx) do seu documento. Onde entrar um dado do cadastro, escreva a chave — como{' '}
              <code className="rounded bg-muted px-1">{'{{cliente}}'}</code>. O resto do documento (timbre, formatação,
              tabelas) sai exatamente como está.
            </p>
            <div className="space-y-1.5">
              <Label>Arquivo (.docx)</Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => arquivoRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Escolher arquivo
                </Button>
                <span className="truncate text-sm text-muted-foreground">{arquivo?.name || 'Nenhum escolhido'}</span>
              </div>
              <input
                ref={arquivoRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  setArquivo(f)
                  if (f && !form.nome) setForm((x) => ({ ...x, nome: f.name.replace(/\.docx$/i, '') }))
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nome do modelo</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Laudo de inspeção predial"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Quando usar este modelo"
              />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovo(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando ? 'Enviando…' : 'Salvar modelo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
