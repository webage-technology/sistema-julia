'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Loader2,
  Pause,
  Play,
  PlugZap,
  RotateCcw,
  Send,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Ponte com o Claude Code do WebAge Hub. A chave de integração fica no backend —
// esta tela só conversa com /api/hub/*.
interface Status {
  configurado: boolean
  online?: boolean
  hubUrl: string
  motivo?: string
  sistema?: { id: string; name: string; hasRepo: boolean }
}

interface Job {
  id: number
  status: string
  done: boolean
  log: string
  error?: string
  filesChanged?: number
  resultText?: string
}

interface Mensagem {
  id?: number | string
  role: string
  content: string
}

interface Etapa {
  chave: string
  titulo: string
  ok: boolean
  detalhe: string
  ms: number
}

const MODELOS = [
  { valor: '', label: 'Padrão do Hub' },
  { valor: 'haiku', label: 'Haiku (rápido)' },
  { valor: 'sonnet', label: 'Sonnet (equilíbrio)' },
  { valor: 'opus', label: 'Opus (mais capaz)' },
]

const ATIVO = ['queued', 'running', 'working', 'starting']

export default function IaPage() {
  const [status, setStatus] = useState<Status | null>(null)
  // A aba e o job acompanhado ficam na URL: /ia?aba=pergunta · /ia?job=745
  const [abaParam, setAbaParam] = useParamEstado('aba')
  const aba: 'alteracao' | 'pergunta' = abaParam === 'pergunta' ? 'pergunta' : 'alteracao'
  const [jobParam, setJobParam] = useParamEstado('job')
  useTitulo(aba === 'pergunta' ? 'Perguntar à IA' : 'IA — alterações')

  // Teste da integração (botão) — percorre a ponte e mostra etapa por etapa.
  const [testando, setTestando] = useState(false)
  const [teste, setTeste] = useState<{ ok: boolean; etapas: Etapa[] } | null>(null)

  // Alteração de código
  const [titulo, setTitulo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [modelo, setModelo] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  // Pergunta sobre o código
  const [chatId, setChatId] = useState<number | null>(null)
  const [pergunta, setPergunta] = useState('')
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [pensando, setPensando] = useState(false)

  useEffect(() => {
    api.get<{ data: Status }>('/hub/status').then((r) => setStatus(r.data))
  }, [])

  const testar = async () => {
    setTestando(true)
    setTeste(null)
    try {
      const r = await api.post<{ data: { ok: boolean; etapas: Etapa[] } }>('/hub/teste', {})
      setTeste(r.data)
      // O teste também revalida o status do topo (pode ter mudado desde que abriu).
      api.get<{ data: Status }>('/hub/status').then((s) => setStatus(s.data))
    } catch (err: any) {
      setTeste({
        ok: false,
        etapas: [{ chave: 'erro', titulo: 'Falha ao executar o teste', ok: false, detalhe: err?.message || 'Erro', ms: 0 }],
      })
    } finally {
      setTestando(false)
    }
  }

  // Polling do log enquanto o job roda.
  const acompanhar = useCallback((id: number) => {
    let parar = false
    const tick = async () => {
      if (parar) return
      try {
        const r = await api.get<{ data: Job }>(`/hub/jobs/${id}`)
        setJob(r.data)
        if (r.data.done) return
      } catch {
        /* erro transitório — continua tentando */
      }
      setTimeout(tick, 2000)
    }
    tick()
    return () => {
      parar = true
    }
  }, [])

  // Segue o job da URL — inclusive ao abrir o link direto ou usar voltar/avançar.
  useEffect(() => {
    const id = Number(jobParam)
    if (!id) {
      setJob(null)
      return
    }
    setJob((j) => (j && j.id === id ? j : { id, status: 'queued', done: false, log: '' }))
    return acompanhar(id)
  }, [jobParam, acompanhar])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log])

  const pedirAlteracao = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const r = await api.post<{ data: { jobId: number } }>('/hub/jobs', {
        prompt,
        title: titulo || undefined,
        model: modelo || undefined,
      })
      // O job vai para a URL: dá para fechar a aba e voltar depois pelo link.
      setJobParam(String(r.data.jobId))
    } catch (err: any) {
      setErro(err?.message || 'Falha ao enviar ao Hub')
    } finally {
      setEnviando(false)
    }
  }

  const acao = async (nome: 'pause' | 'cancel' | 'resume' | 'revert') => {
    if (!job) return
    try {
      const r = await api.post<{ data: { jobId?: number } }>(`/hub/jobs/${job.id}/${nome}`, {})
      const novo = r.data?.jobId
      if (novo && novo !== job.id) setJobParam(String(novo)) // retomar cria um job novo
      else if (nome !== 'revert') acompanhar(job.id)
    } catch (err: any) {
      setErro(err?.message || 'Falha na ação')
    }
  }

  // O chat que LÊ o código depende de repositório GitHub no Hub. Sem ele (caso
  // deste sistema hoje), cai para a completação de texto — a IA responde, mas
  // sem abrir os arquivos.
  const leCodigo = !!status?.sistema?.hasRepo

  const perguntar = async (e: React.FormEvent) => {
    e.preventDefault()
    const texto = pergunta.trim()
    if (!texto) return
    setPergunta('')
    setMensagens((m) => [...m, { role: 'user', content: texto }])
    setPensando(true)
    try {
      if (leCodigo) {
        let id = chatId
        if (!id) {
          const c = await api.post<{ data: { id: number } }>('/hub/chats', {})
          id = c.data.id
          setChatId(id)
        }
        const r = await api.post<{ data: { messages?: Mensagem[]; message?: Mensagem } }>(
          `/hub/chats/${id}/mensagens`,
          { content: texto }
        )
        if (r.data.messages?.length) setMensagens(r.data.messages)
        else if (r.data.message) setMensagens((m) => [...m, r.data.message!])
      } else {
        const r = await api.post<{ data: { text: string } }>('/hub/texto', {
          prompt: texto,
          system:
            'Você responde dúvidas sobre o Sistema Julia, um sistema de vistorias de imóveis (captura guiada de fotos no celular, conferência e export por pavimento/ambiente). Responda em português, de forma direta.',
        })
        setMensagens((m) => [...m, { role: 'assistant', content: r.data.text }])
      }
    } catch (err: any) {
      setMensagens((m) => [...m, { role: 'error', content: err?.message || 'Falha ao perguntar' }])
    } finally {
      setPensando(false)
    }
  }

  const rodando = !!job && !job.done
  const ativo = job && ATIVO.includes(job.status)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bot className="h-6 w-6" /> IA (Claude Code via WebAge Hub)
        </h1>
        <p className="text-sm text-muted-foreground">
          Peça alterações no próprio sistema ou tire dúvidas sobre o código. Quem executa é o Claude Code que roda no
          Hub — a chave de integração fica só no servidor.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            {!status ? (
              <span className="text-muted-foreground">Verificando conexão…</span>
            ) : status.configurado && status.online ? (
              <>
                <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  Conectado ao Hub como <strong>{status.sistema?.name}</strong>
                </span>
                <span className="text-muted-foreground">
                  · {status.hubUrl} · {status.sistema?.hasRepo ? 'com repositório' : 'edição na cópia local'}
                </span>
              </>
            ) : (
              <>
                <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  {status.configurado ? 'Hub inacessível' : 'Integração não configurada'} — {status.motivo}
                </span>
              </>
            )}
            <Button variant="outline" size="sm" className="ml-auto" onClick={testar} disabled={testando}>
              {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
              {testando ? 'Testando…' : 'Testar integração'}
            </Button>
          </div>

          {testando && !teste && (
            <p className="text-xs text-muted-foreground">
              Falando com o Hub e pedindo uma resposta real ao Claude — leva alguns segundos.
            </p>
          )}

          {teste && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <p className={`text-sm font-medium ${teste.ok ? 'text-emerald-700' : 'text-destructive'}`}>
                {teste.ok ? 'Integração funcionando de ponta a ponta.' : 'A integração falhou em alguma etapa — veja abaixo.'}
              </p>
              <ul className="space-y-1.5">
                {teste.etapas.map((et) => (
                  <li key={et.chave} className="flex items-start gap-2">
                    {et.ok ? (
                      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">{et.titulo}</span>
                      {et.ms > 0 && <span className="ml-2 text-xs text-muted-foreground">{(et.ms / 1000).toFixed(1)}s</span>}
                      <span className={`block text-xs ${et.ok ? 'text-muted-foreground' : 'text-destructive'}`}>{et.detalhe}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b">
        {[
          { k: 'alteracao', label: 'Pedir alteração no sistema' },
          { k: 'pergunta', label: 'Perguntar à IA' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setAbaParam(t.k === 'alteracao' ? null : t.k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              aba === t.k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'alteracao' ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Alteração por IA</CardTitle>
            <CardDescription>
              O Hub roda o Claude Code sobre a cópia local deste repositório e deixa as mudanças prontas para revisão.
              Disponível apenas para administradores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={pedirAlteracao} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <div className="space-y-1.5">
                  <Label>Título (opcional)</Label>
                  <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Ajuste na conferência" />
                </div>
                <div className="space-y-1.5">
                  <Label>Modelo</Label>
                  <select className={SELECT_CLASS} value={modelo} onChange={(e) => setModelo(e.target.value)}>
                    {MODELOS.map((m) => (
                      <option key={m.valor} value={m.valor}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>O que deve ser feito</Label>
                <textarea
                  className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Descreva a alteração com o máximo de detalhe: o que muda, onde, e como saber que ficou certo."
                />
              </div>
              {erro && <p className="text-sm text-destructive">{erro}</p>}
              <Button type="submit" disabled={enviando || rodando || !prompt.trim() || !status?.online}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {rodando ? 'Em execução…' : 'Enviar ao Claude Code'}
              </Button>
            </form>

            {job && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">Job #{job.id}</span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">{job.status}</span>
                  {rodando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {typeof job.filesChanged === 'number' && job.filesChanged > 0 && (
                    <span className="text-xs text-muted-foreground">{job.filesChanged} arquivos alterados</span>
                  )}
                  <span className="ml-auto flex gap-1">
                    {ativo && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => acao('pause')}>
                          <Pause className="h-3.5 w-3.5" /> Pausar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => acao('cancel')}>
                          <Square className="h-3.5 w-3.5" /> Parar
                        </Button>
                      </>
                    )}
                    {job.done && job.status === 'paused' && (
                      <Button variant="outline" size="sm" onClick={() => acao('resume')}>
                        <Play className="h-3.5 w-3.5" /> Retomar
                      </Button>
                    )}
                    {job.done && (
                      <Button variant="outline" size="sm" onClick={() => acao('revert')}>
                        <RotateCcw className="h-3.5 w-3.5" /> Desfazer
                      </Button>
                    )}
                  </span>
                </div>
                {job.error && <p className="text-sm text-destructive">{job.error}</p>}
                <pre
                  ref={logRef}
                  className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-200"
                >
                  {job.log || 'Aguardando o Hub iniciar…'}
                </pre>
                {job.done && job.resultText && <p className="text-sm">{job.resultText}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Perguntar à IA</CardTitle>
            <CardDescription>
              {leCodigo
                ? 'Conversa só de leitura — a IA lê o código do sistema e responde. Nada é alterado.'
                : 'Conversa só de leitura. Como este sistema ainda não tem repositório GitHub no Hub, a IA responde sem abrir os arquivos — para respostas baseadas no código, use “Pedir alteração” com uma tarefa de investigação.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-96 space-y-3 overflow-auto">
              {mensagens.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Ex.: “Escreva o texto padrão de conclusão de um laudo de as-built” · “Sugira nomes de ambientes para
                  uma vistoria de bombeiro”
                </p>
              )}
              {mensagens.map((m, i) => (
                <div
                  key={m.id ?? i}
                  className={`rounded-md px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'ml-8 bg-primary/10'
                      : m.role === 'error'
                        ? 'bg-destructive/10 text-destructive'
                        : 'mr-8 bg-muted'
                  }`}
                >
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {m.role === 'user' ? 'Você' : m.role === 'error' ? 'Erro' : 'IA'}
                  </p>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
              {pensando && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Lendo o código…
                </p>
              )}
            </div>
            <form onSubmit={perguntar} className="flex gap-2">
              <Input
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                placeholder="Sua pergunta sobre o sistema"
                disabled={pensando || !status?.online}
              />
              <Button type="submit" disabled={pensando || !pergunta.trim() || !status?.online}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
