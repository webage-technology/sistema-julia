'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Building2, Camera, CircleCheck, Download, FileCheck, FileText, Lock, Paperclip, Stamp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

// Portal do cliente — um link privado (com senha opcional) onde o cliente
// acompanha os processos, envia documentos, baixa e aprova laudos e anda o
// caminho das fotos. Fala só com /api/portal/<token>/*.
interface Info {
  cliente: { nome: string }
  escritorio: { nomeFantasia: string; telefone: string; email: string; site: string; temLogo: boolean; cor: string }
  precisaSenha: boolean
  autenticado: boolean
}

const ETAPA_COR: Record<string, string> = {
  levantamento: 'bg-zinc-200 text-zinc-800',
  projeto: 'bg-zinc-200 text-zinc-800',
  protocolo: 'bg-zinc-900 text-white',
  comunique_se: 'bg-red-600 text-white',
  aprovacao: 'bg-zinc-700 text-white',
  concluido: 'bg-emerald-100 text-emerald-900',
  arquivado: 'bg-zinc-100 text-zinc-500',
}
const STATUS_DOC: Record<string, [string, string]> = {
  pendente: ['Pendente — envie', 'bg-red-50 text-red-700 ring-1 ring-red-200'],
  recebido: ['Recebido', 'bg-emerald-100 text-emerald-900'],
  vencido: ['Vencido — envie de novo', 'bg-red-600 text-white'],
  dispensado: ['Dispensado', 'bg-zinc-100 text-zinc-500'],
}
const dia = (iso: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

export default function PortalPage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [senha, setSenha] = useState('')
  const [sessao, setSessao] = useState<string>('')
  const [dados, setDados] = useState<any>(null)
  const [enviandoDoc, setEnviandoDoc] = useState<number | null>(null)
  const [aprovando, setAprovando] = useState<number | null>(null)
  const [comentario, setComentario] = useState('')
  const docRef = useRef<HTMLInputElement>(null)
  const docAlvo = useRef<number | null>(null)

  const base = `/api/portal/${token}`
  const cab = (): Record<string, string> => (sessao ? { 'X-Portal-Sessao': sessao } : {})

  const carregarDados = useCallback(async () => {
    const r = await fetch(`${base}/dados`, { headers: cab(), cache: 'no-store' })
    const j = await r.json()
    if (!r.ok) throw new Error(j?.message || 'Falha')
    setDados(j.data)
  }, [base, sessao]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      setSessao(localStorage.getItem(`sj_portal_${token}`) || '')
    } catch {
      /* sem storage */
    }
  }, [token])

  useEffect(() => {
    fetch(base, { headers: cab(), cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j?.message || 'Link inválido')
        setInfo(j.data)
        if (j.data.autenticado) carregarDados().catch((e) => setErro(e.message))
      })
      .catch((e) => setErro(e.message))
  }, [base, sessao]) // eslint-disable-line react-hooks/exhaustive-deps

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    const r = await fetch(`${base}/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) })
    const j = await r.json()
    if (!r.ok) return setErro(j?.message || 'Senha incorreta')
    try {
      localStorage.setItem(`sj_portal_${token}`, j.data.sessao)
    } catch {
      /* sem storage */
    }
    setSessao(j.data.sessao)
  }

  const enviarDoc = async (files: FileList | null) => {
    const f = files?.[0]
    const docId = docAlvo.current
    if (!f || !docId) return
    setEnviandoDoc(docId)
    try {
      const fd = new FormData()
      fd.append('arquivo', f)
      const r = await fetch(`${base}/documentos/${docId}/enviar`, { method: 'POST', headers: cab(), body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.message || 'Falha ao enviar')
      await carregarDados()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setEnviandoDoc(null)
      docAlvo.current = null
      if (docRef.current) docRef.current.value = ''
    }
  }

  const aprovar = async (laudoId: number) => {
    const r = await fetch(`${base}/laudos/${laudoId}/aprovar`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cab() }, body: JSON.stringify({ comentario }) })
    if (r.ok) {
      setAprovando(null)
      setComentario('')
      carregarDados()
    }
  }

  if (erro && !info) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center text-sm">{erro}</CardContent>
        </Card>
      </div>
    )
  }
  if (!info) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>

  const Cabecalho = () => (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {info.escritorio.temLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${base}/logo`} alt={info.escritorio.nomeFantasia} className="h-12 max-w-[200px] object-contain" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white">
          <Building2 className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{info.escritorio.nomeFantasia}</p>
        <p className="text-xs text-muted-foreground">{[info.escritorio.telefone, info.escritorio.email, info.escritorio.site].filter(Boolean).join(' · ')}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Olá, <strong className="text-foreground">{info.cliente.nome}</strong>
      </p>
    </div>
  )

  if (info.precisaSenha && !info.autenticado) {
    return (
      <div className="mx-auto max-w-xl p-4 pt-10">
        <Cabecalho />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4" /> Portal protegido
            </CardTitle>
            <CardDescription>Informe a senha que o escritório combinou com você.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={entrar} className="flex gap-2">
              <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha" required />
              <Button type="submit">Entrar</Button>
            </form>
            {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!dados) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 pb-16 pt-8">
      <Cabecalho />
      <input ref={docRef} type="file" className="hidden" onChange={(e) => enviarDoc(e.target.files)} />

      {/* Processos */}
      {dados.processos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum processo em andamento.</p>}
      {dados.processos.map((p: any) => {
        const pendentes = p.documentos.filter((d: any) => d.status === 'pendente' || d.status === 'vencido')
        const abertos = p.protocolos.filter((x: any) => x.status === 'aberto')
        return (
          <Card key={p.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{p.numero}</p>
                  <CardTitle className="text-base">{p.titulo}</CardTitle>
                  <CardDescription>
                    {p.tipo}
                    {p.imovelNome ? ` · ${p.imovelNome}` : ''}
                    {p.previsao ? ` · previsão ${dia(p.previsao)}` : ''}
                    {p.responsavelNome ? ` · ${p.responsavelNome}${p.responsavelTelefone ? ` (${p.responsavelTelefone})` : ''}` : ''}
                  </CardDescription>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ETAPA_COR[p.etapa] || 'bg-muted'}`}>{p.etapaLabel}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {dados.etapas
                  .filter((e: any) => e.id !== 'arquivado')
                  .map((e: any, i: number) => {
                    const idx = dados.etapas.findIndex((x: any) => x.id === p.etapa)
                    return (
                      <span key={e.id} className={`rounded-full px-2 py-0.5 text-[11px] ${e.id === p.etapa ? ETAPA_COR[e.id] : i < idx ? 'bg-zinc-200 text-zinc-600' : 'bg-muted text-muted-foreground'}`}>
                        {i < idx ? '✓ ' : ''}
                        {e.label}
                      </span>
                    )
                  })}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {abertos.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-sm font-medium">
                    <Stamp className="h-4 w-4" /> Em andamento no órgão
                  </p>
                  <ul className="divide-y rounded-md border text-sm">
                    {abertos.map((x: any, i: number) => (
                      <li key={i} className="px-3 py-2">
                        <span className="font-medium">{x.tipo === 'comunique_se' ? 'Comunique-se' : 'Protocolo'}</span> {x.numero} — {x.assunto}
                        <span className="block text-xs text-muted-foreground">
                          {x.orgao} · {dia(x.data)}
                          {x.prazo ? ` · prazo ${dia(x.prazo)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {p.documentos.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-sm font-medium">
                    <FileCheck className="h-4 w-4" /> Documentos {pendentes.length > 0 && <span className="text-red-600">— {pendentes.length} pendente(s)</span>}
                  </p>
                  <ul className="divide-y rounded-md border text-sm">
                    {p.documentos.map((d: any) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_DOC[d.status]?.[1] || 'bg-muted'}`}>{STATUS_DOC[d.status]?.[0] || d.status}</span>
                        <span className="min-w-0 flex-1">
                          {d.nome}
                          {!d.obrigatorio && <span className="text-xs text-muted-foreground"> (opcional)</span>}
                          {d.observacao && <span className="block text-xs text-muted-foreground">{d.observacao}</span>}
                        </span>
                        {(d.status === 'pendente' || d.status === 'vencido') && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={enviandoDoc === d.id}
                            onClick={() => {
                              docAlvo.current = d.id
                              docRef.current?.click()
                            }}
                          >
                            <Upload className="h-4 w-4" /> {enviandoDoc === d.id ? 'Enviando…' : 'Enviar'}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Laudos */}
      {dados.laudos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Laudos e relatórios
            </CardTitle>
            <CardDescription>Baixe o PDF e, se estiver de acordo, registre a aprovação.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {dados.laudos.map((l: any) => (
                <li key={l.id} className="space-y-2 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">
                      {l.numero} v{l.versao}
                    </span>
                    <span className="min-w-0 flex-1">
                      {l.titulo} · {l.imovelNome}
                      <span className="block text-xs text-muted-foreground">
                        emitido em {dia(l.emitidoEm)}
                        {l.temAssinado ? ' · assinado digitalmente' : ''}
                      </span>
                    </span>
                    <a href={`${base}/laudos/${l.id}/pdf${sessao ? `?sessao=${encodeURIComponent(sessao)}` : ''}`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">
                        <Download className="h-4 w-4" /> PDF
                      </Button>
                    </a>
                    {l.aprovadoEm ? (
                      <span className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                        <CircleCheck className="h-3 w-3" /> aprovado em {dia(l.aprovadoEm)}
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => setAprovando(aprovando === l.id ? null : l.id)}>
                        Aprovar
                      </Button>
                    )}
                  </div>
                  {aprovando === l.id && (
                    <div className="flex flex-wrap gap-2 rounded-md border bg-muted/40 p-3">
                      <Input className="min-w-56 flex-1" placeholder="Comentário (opcional)" value={comentario} onChange={(e) => setComentario(e.target.value)} />
                      <Button size="sm" onClick={() => aprovar(l.id)}>
                        <CircleCheck className="h-4 w-4" /> Confirmar aprovação
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Vistorias: tour */}
      {dados.vistorias.filter((v: any) => v.fotos > 0).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" /> Fotos das vistorias
            </CardTitle>
            <CardDescription>Ande o caminho da vistoria foto a foto, ambiente por ambiente.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {dados.vistorias
                .filter((v: any) => v.fotos > 0)
                .map((v: any) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      {v.imovelNome} — {v.tipoServico || 'vistoria'}
                      {v.dataVistoria ? ` · ${dia(v.dataVistoria)}` : ''}
                      <span className="block text-xs text-muted-foreground">{v.fotos} fotos</span>
                    </span>
                    <Link href={`/portal/${token}/tour/${v.id}`}>
                      <Button size="sm" variant="outline">
                        <Camera className="h-4 w-4" /> Ver o caminho
                      </Button>
                    </Link>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Arquivos compartilhados */}
      {dados.arquivos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="h-4 w-4" /> Arquivos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {dados.arquivos.map((a: any) => (
                <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {a.nome}
                    <span className="block text-xs text-muted-foreground">
                      {a.categoria} · {dia(a.createdAt)}
                      {a.enviadoPeloCliente ? ' · enviado por você' : ''}
                    </span>
                  </span>
                  <a href={`${base}/arquivos/${a.id}/download${sessao ? `?sessao=${encodeURIComponent(sessao)}` : ''}`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline">
                      <Download className="h-4 w-4" />
                    </Button>
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">Portal do cliente · {info.escritorio.nomeFantasia}</p>
    </div>
  )
}
