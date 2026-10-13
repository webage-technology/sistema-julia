'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  FileCheck,
  FileText,
  FolderOpen,
  History,
  Paperclip,
  Plus,
  Receipt,
  Stamp,
  Trash2,
  Upload,
  Wallet,
  Wand2,
} from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS, STATUS_COR, STATUS_LABEL, VistoriaResumo, useTiposServico } from '@/lib/vistorias'
import {
  CATEGORIA_DESPESA_LABEL,
  DespesaProcesso,
  Documento,
  ETAPAS,
  ETAPA_COR,
  ETAPA_LABEL,
  Laudo,
  ORGAO_LABEL,
  PRIORIDADE_LABEL,
  Processo,
  Protocolo,
  Rrt,
  STATUS_DOC_COR,
  STATUS_DOC_LABEL,
  STATUS_PROTOCOLO_LABEL,
  STATUS_RRT_LABEL,
  TIPOS_PROCESSO,
  TIPO_PROTOCOLO_LABEL,
  dia,
  dataHora,
  dinheiro,
  hojeIso,
} from '@/lib/regularizacao'
import { ehTecnico } from '@/lib/papeis'
import { Arquivos } from '@/components/arquivos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// O processo: cabeçalho com etapa e dados, e abas com endereço (?aba=):
// visão · protocolos · documentos · arquivos · vistorias · rrt · despesas · histórico.
type Detalhe = Omit<Processo, 'vistorias'> & {
  vistorias: (VistoriaResumo & { fotos: number; responsavelNome?: string })[]
  protocolos: Protocolo[]
  documentos: Documento[]
  rrts: Rrt[]
  despesas: DespesaProcesso[]
  laudos: Laudo[]
  arquivos: number
  resumo: { despesas: number; reembolsoPendente: number }
}

const ABAS = [
  { k: '', label: 'Visão geral', icon: FolderOpen },
  { k: 'protocolos', label: 'Protocolos e prazos', icon: Stamp },
  { k: 'documentos', label: 'Documentos', icon: FileCheck },
  { k: 'arquivos', label: 'Arquivos', icon: Paperclip },
  { k: 'vistorias', label: 'Vistorias', icon: Camera },
  { k: 'rrt', label: 'RRT / ART', icon: FileText },
  { k: 'financeiro', label: 'Despesas', icon: Wallet },
  { k: 'historico', label: 'Histórico', icon: History },
]

const PROTO_VAZIO = { orgao: 'prefeitura', tipo: 'protocolo', numero: '', assunto: '', data: hojeIso(), prazo: '', status: 'aberto', resposta: '', observacoes: '' }
const RRT_VAZIA = { tipo: 'RRT', numero: '', atividade: '', data: hojeIso(), valor: '', status: 'emitida', userId: '', vistoriaId: '', observacoes: '' }
const DESP_VAZIA = { categoria: 'taxa_prefeitura', descricao: '', valor: '', data: hojeIso(), reembolsavel: true }

export default function ProcessoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [d, setD] = useState<Detalhe | null>(null)
  const [me, setMe] = useState<{ role?: string } | null>(null)
  const [usuarios, setUsuarios] = useState<{ id: number; name: string; registro?: string }[]>([])
  const [aba, setAba] = useParamEstado('aba')
  const [protoParam, setProtoParam] = useParamEstado('protocolo')
  const [rrtParam, setRrtParam] = useParamEstado('rrt')
  const [despParam, setDespParam] = useParamEstado('despesa')
  const [vincular, setVincular] = useParamEstado('vincular')
  const [docNovo, setDocNovo] = useParamEstado('documento')
  const [historico, setHistorico] = useState<any[]>([])
  const [candidatas, setCandidatas] = useState<VistoriaResumo[]>([])
  const [salvo, setSalvo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [protoForm, setProtoForm] = useState(PROTO_VAZIO)
  const [rrtForm, setRrtForm] = useState(RRT_VAZIA)
  const [despForm, setDespForm] = useState(DESP_VAZIA)
  const [despArquivo, setDespArquivo] = useState<File | null>(null)
  const [docForm, setDocForm] = useState({ nome: '', obrigatorio: true })
  const [salvando, setSalvando] = useState(false)
  const docUploadRef = useRef<HTMLInputElement>(null)
  const [docAlvo, setDocAlvo] = useState<Documento | null>(null)
  const tipos = useTiposServico()

  const carregar = useCallback(() => api.get<{ data: Detalhe }>(`/processos/${id}`).then((r) => setD(r.data)), [id])
  useEffect(() => {
    carregar().catch((e) => setErro(e?.message || 'Processo não encontrado'))
    api.get<{ user: { role?: string } }>('/me').then((r) => setMe(r.user))
    api.get<{ data: { id: number; name: string; registro?: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [carregar])

  useEffect(() => {
    if (aba === 'historico') api.get<{ data: any[] }>(`/processos/${id}/historico`).then((r) => setHistorico(r.data))
  }, [aba, id, d?.updatedAt])

  useEffect(() => {
    if (vincular === '1') api.get<{ data: VistoriaResumo[] }>('/vistorias').then((r) => setCandidatas(r.data))
  }, [vincular])

  useTitulo(d ? `${d.numero} — ${d.titulo}` : 'Processo')

  // Formulários dos diálogos: preenchidos a partir da URL (link direto funciona).
  useEffect(() => {
    if (!protoParam || !d) return
    setErro(null)
    if (protoParam === 'novo') return setProtoForm(PROTO_VAZIO)
    const p = d.protocolos.find((x) => String(x.id) === protoParam)
    if (p) setProtoForm({ orgao: p.orgao, tipo: p.tipo, numero: p.numero, assunto: p.assunto, data: p.data || '', prazo: p.prazo || '', status: p.status, resposta: p.resposta, observacoes: p.observacoes })
  }, [protoParam, d])
  useEffect(() => {
    if (!rrtParam || !d) return
    setErro(null)
    if (rrtParam === 'nova') return setRrtForm(RRT_VAZIA)
    const r = d.rrts.find((x) => String(x.id) === rrtParam)
    if (r) setRrtForm({ tipo: r.tipo, numero: r.numero, atividade: r.atividade, data: r.data || '', valor: r.valor ? String(r.valor) : '', status: r.status, userId: r.userId ? String(r.userId) : '', vistoriaId: r.vistoriaId ? String(r.vistoriaId) : '', observacoes: r.observacoes })
  }, [rrtParam, d])
  useEffect(() => {
    if (despParam === '1') {
      setDespForm(DESP_VAZIA)
      setDespArquivo(null)
      setErro(null)
    }
  }, [despParam])
  useEffect(() => {
    if (docNovo === '1') setDocForm({ nome: '', obrigatorio: true })
  }, [docNovo])

  const prazosAbertos = useMemo(() => (d ? d.protocolos.filter((p) => p.status === 'aberto' && p.prazo) : []), [d])

  if (erro && !d) return <p className="text-sm text-destructive">{erro}</p>
  if (!d) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const avisar = (t: string) => {
    setSalvo(t)
    setTimeout(() => setSalvo(null), 2000)
  }
  const salvarCampo = async (campos: Record<string, unknown>) => {
    try {
      const r = await api.put<{ data: Processo }>(`/processos/${id}`, campos)
      setD((x) => x && { ...x, ...r.data, vistorias: x.vistorias })
      avisar('Salvo')
      if ('etapa' in campos || 'tipo' in campos) carregar()
    } catch (err: any) {
      alert(err?.message || 'Falha ao salvar')
    }
  }

  const tecnico = ehTecnico(me?.role)
  const abaAtual = aba || ''
  const hoje = hojeIso()

  // ---- protocolos
  const salvarProtocolo = async (e: React.FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    setErro(null)
    try {
      const corpo = { ...protoForm, prazo: protoForm.prazo || null, data: protoForm.data || null }
      if (protoParam === 'novo') await api.post(`/processos/${id}/protocolos`, corpo)
      else await api.put(`/protocolos/${protoParam}`, corpo)
      setProtoParam(null)
      carregar()
    } catch (err: any) {
      setErro(err?.message || 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }
  const statusProtocolo = async (p: Protocolo, status: string) => {
    await api.put(`/protocolos/${p.id}`, { status })
    carregar()
  }
  const excluirProtocolo = async (p: Protocolo) => {
    if (!confirm(`Excluir o protocolo “${p.numero || p.assunto}”?`)) return
    await api.del(`/protocolos/${p.id}`)
    carregar()
  }

  // ---- documentos
  const statusDoc = async (doc: Documento, status: string) => {
    await api.put(`/processo-documentos/${doc.id}`, { status })
    carregar()
  }
  const enviarDoc = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f || !docAlvo) return
    try {
      const fd = new FormData()
      fd.append('arquivo', f)
      fd.append('processoId', String(id))
      fd.append('clientId', String(d.clientId))
      fd.append('categoria', 'documento-pessoal')
      fd.append('nome', docAlvo.nome)
      fd.append('visivelCliente', '1')
      if (docAlvo.arquivoId) fd.append('substituiId', String(docAlvo.arquivoId))
      const r = await api.upload<{ data: { id: number } }>('/arquivos', fd)
      await api.put(`/processo-documentos/${docAlvo.id}`, { status: 'recebido', arquivoId: r.data.id })
      carregar()
    } catch (err: any) {
      alert(err?.message || 'Falha ao enviar')
    } finally {
      setDocAlvo(null)
      if (docUploadRef.current) docUploadRef.current.value = ''
    }
  }
  const criarDoc = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.post(`/processos/${id}/documentos`, docForm)
    setDocNovo(null)
    carregar()
  }
  const aplicarModelo = async () => {
    const r = await api.post<{ data: { adicionados: number } }>(`/processos/${id}/documentos/aplicar`, {})
    alert(`${r.data.adicionados} documento(s) adicionado(s) do modelo “${d.tipo}”.`)
    carregar()
  }

  // ---- vistorias
  const vincularVistoria = async (vid: number) => {
    try {
      await api.post(`/processos/${id}/vistorias`, { vistoriaId: vid })
      setVincular(null)
      carregar()
    } catch (err: any) {
      alert(err?.message || 'Falha ao vincular')
    }
  }
  const novaVistoria = async () => {
    if (!d.imovelId) return alert('Defina o imóvel do processo antes de criar a vistoria.')
    const r = await api.post<{ data: { id: number } }>('/vistorias', { imovelId: d.imovelId, tipoServico: tipos.includes(d.tipo) ? d.tipo : tipos[0], processoId: d.id, responsavelId: d.responsavelId })
    router.push(`/vistorias/${r.data.id}`)
  }

  // ---- RRT
  const salvarRrt = async (e: React.FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    setErro(null)
    try {
      const corpo = { ...rrtForm, userId: rrtForm.userId || null, vistoriaId: rrtForm.vistoriaId || null, data: rrtForm.data || null }
      if (rrtParam === 'nova') await api.post(`/processos/${id}/rrts`, corpo)
      else await api.put(`/rrts/${rrtParam}`, corpo)
      setRrtParam(null)
      carregar()
    } catch (err: any) {
      setErro(err?.message || 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  // ---- despesas
  const salvarDespesa = async (e: React.FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    setErro(null)
    try {
      const fd = new FormData()
      fd.append('categoria', despForm.categoria)
      fd.append('descricao', despForm.descricao)
      fd.append('valor', despForm.valor)
      fd.append('data', despForm.data)
      fd.append('reembolsavel', despForm.reembolsavel ? '1' : '0')
      if (despArquivo) fd.append('comprovante', despArquivo)
      await api.upload(`/processos/${id}/despesas`, fd)
      setDespParam(null)
      carregar()
    } catch (err: any) {
      setErro(err?.message || 'Falha ao lançar')
    } finally {
      setSalvando(false)
    }
  }

  const Resumo = ({ rotulo, valor, alerta, href }: { rotulo: string; valor: string | number; alerta?: boolean; href?: string }) => {
    const corpo = (
      <div className={`rounded-md border p-3 ${alerta ? 'border-primary/50 bg-primary/5' : ''}`}>
        <p className="text-xs text-muted-foreground">{rotulo}</p>
        <p className={`text-lg font-semibold ${alerta ? 'text-primary' : ''}`}>{valor}</p>
      </div>
    )
    return href ? (
      <button className="text-left" onClick={() => setAba(href)}>
        {corpo}
      </button>
    ) : (
      corpo
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/processos" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Processos
      </Link>

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-muted-foreground">{d.numero}</p>
          <Input
            className="h-auto border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            defaultValue={d.titulo}
            onBlur={(e) => e.target.value.trim() && e.target.value !== d.titulo && salvarCampo({ titulo: e.target.value })}
          />
          <p className="text-sm text-muted-foreground">
            <Link href={`/clients?editar=${d.clientId}`} className="hover:underline">
              {d.clienteNome}
            </Link>
            {d.imovelId && (
              <>
                {' · '}
                <Link href={`/imoveis/${d.imovelId}`} className="hover:underline">
                  {d.imovelNome}
                </Link>
                {d.imovelEndereco ? ` — ${d.imovelEndereco}` : ''}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {salvo && <span className="text-xs text-muted-foreground">{salvo}</span>}
          <select className={`${SELECT_CLASS} w-auto font-medium`} value={d.etapa} onChange={(e) => salvarCampo({ etapa: e.target.value })}>
            {ETAPAS.map((e) => (
              <option key={e} value={e}>
                {ETAPA_LABEL[e]}
              </option>
            ))}
          </select>
          {tecnico && (
            <Button
              variant="outline"
              size="icon"
              title="Enviar para a lixeira"
              onClick={async () => {
                if (!confirm(`Enviar o processo ${d.numero} para a lixeira? Dá para restaurar depois.`)) return
                await api.del(`/processos/${id}`)
                router.push('/processos')
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {/* Linha de etapas */}
      <div className="flex flex-wrap gap-1">
        {ETAPAS.filter((e) => e !== 'arquivado').map((e, i) => {
          const idx = ETAPAS.indexOf(d.etapa as any)
          const feito = i < idx
          const atual = e === d.etapa
          return (
            <button
              key={e}
              onClick={() => salvarCampo({ etapa: e })}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${atual ? ETAPA_COR[e] : feito ? 'bg-zinc-200 text-zinc-700' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
            >
              {feito ? '✓ ' : ''}
              {ETAPA_LABEL[e]}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Resumo rotulo="Protocolos abertos" valor={d.protocolosAbertos} href="protocolos" />
        <Resumo rotulo="Próximo prazo" valor={d.proximoPrazo ? dia(d.proximoPrazo) : '—'} alerta={!!d.proximoPrazo && d.proximoPrazo < hoje} href="protocolos" />
        <Resumo rotulo="Docs. pendentes" valor={d.docsPendentes} alerta={d.docsPendentes > 0} href="documentos" />
        <Resumo rotulo="Vistorias" valor={d.vistorias.length} href="vistorias" />
        <Resumo rotulo="A reembolsar" valor={d.resumo.reembolsoPendente ? dinheiro(d.resumo.reembolsoPendente) : '—'} alerta={d.resumo.reembolsoPendente > 0} href="financeiro" />
        <Resumo rotulo="Arquivos" valor={d.arquivos} href="arquivos" />
      </div>

      {/* Abas */}
      <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted p-1">
        {ABAS.map((a) => {
          const Icon = a.icon
          const ativo = abaAtual === a.k
          return (
            <button
              key={a.k}
              onClick={() => setAba(a.k || null)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                ativo ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-card hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" /> {a.label}
            </button>
          )
        })}
      </div>

      {/* ---------------------------------------------------------- visão geral */}
      {abaAtual === '' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dados do processo</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo de serviço</Label>
                <select className={SELECT_CLASS} value={d.tipo} onChange={(e) => salvarCampo({ tipo: e.target.value })}>
                  {!TIPOS_PROCESSO.includes(d.tipo) && d.tipo && <option value={d.tipo}>{d.tipo}</option>}
                  {TIPOS_PROCESSO.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Prioridade</Label>
                <select className={SELECT_CLASS} value={d.prioridade} onChange={(e) => salvarCampo({ prioridade: e.target.value })}>
                  {Object.entries(PRIORIDADE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Responsável</Label>
                <select className={SELECT_CLASS} value={d.responsavelId ?? ''} onChange={(e) => salvarCampo({ responsavelId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Não definido</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Previsão de conclusão</Label>
                <Input type="date" defaultValue={d.previsao || ''} onBlur={(e) => e.target.value !== (d.previsao || '') && salvarCampo({ previsao: e.target.value || null })} />
              </div>
              <div className="space-y-1.5">
                <Label>Início</Label>
                <Input type="date" defaultValue={d.inicio || ''} onBlur={(e) => e.target.value !== (d.inicio || '') && salvarCampo({ inicio: e.target.value || null })} />
              </div>
              <div className="space-y-1.5">
                <Label>Concluído em</Label>
                <Input type="date" defaultValue={d.concluidoEm || ''} onBlur={(e) => e.target.value !== (d.concluidoEm || '') && salvarCampo({ concluidoEm: e.target.value || null })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Descrição / escopo</Label>
                <textarea
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue={d.descricao}
                  onBlur={(e) => e.target.value !== d.descricao && salvarCampo({ descricao: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>
          <div className="space-y-5">
            <Card className={prazosAbertos.some((p) => p.vencido) ? 'border-primary/60' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Stamp className="h-4 w-4" /> Prazos abertos
                </CardTitle>
              </CardHeader>
              <CardContent>
                {prazosAbertos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum protocolo aberto com prazo.</p>
                ) : (
                  <ul className="divide-y">
                    {prazosAbertos.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className={`w-16 shrink-0 text-xs font-semibold ${p.vencido ? 'text-primary' : 'text-muted-foreground'}`}>{p.vencido ? 'VENCIDO' : `${p.diasParaPrazo} dia(s)`}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {TIPO_PROTOCOLO_LABEL[p.tipo]} {p.numero} — {p.assunto}
                        </span>
                        <span className="text-xs text-muted-foreground">{dia(p.prazo)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileCheck className="h-4 w-4" /> Laudos emitidos
                </CardTitle>
              </CardHeader>
              <CardContent>
                {d.laudos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum laudo emitido. Emita pela aba Relatório da vistoria.</p>
                ) : (
                  <ul className="divide-y">
                    {d.laudos.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 py-2 text-sm">
                        <a href={apiUrl(`/laudos/${l.id}/pdf`)} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">
                          {l.numero} v{l.versao}
                        </a>
                        <span className="min-w-0 flex-1 truncate">{l.titulo}</span>
                        {l.aprovadoEm && <span className="rounded bg-emerald-100 px-1.5 text-[10px] text-emerald-900">aprovado pelo cliente</span>}
                        <span className="text-xs text-muted-foreground">{dataHora(l.emitidoEm)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- protocolos */}
      {abaAtual === 'protocolos' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Protocolos, comunique-se e prazos</CardTitle>
                <CardDescription>Cada ida ao órgão: número, o que foi pedido, até quando responder. Um comunique-se muda a etapa do processo sozinho.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setProtoParam('novo')}>
                <Plus className="h-4 w-4" /> Protocolo
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {d.protocolos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum protocolo registrado.</p>
            ) : (
              <ul className="divide-y">
                {d.protocolos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">{dia(p.data)}</span>
                    <span className="min-w-0 flex-1">
                      <button className="text-left font-medium hover:underline" onClick={() => setProtoParam(String(p.id))}>
                        {TIPO_PROTOCOLO_LABEL[p.tipo] || p.tipo}
                        {p.numero ? ` ${p.numero}` : ''} — {p.assunto}
                      </button>
                      <span className="block text-xs text-muted-foreground">
                        {ORGAO_LABEL[p.orgao] || p.orgao}
                        {p.prazo && (
                          <>
                            {' · prazo '}
                            <span className={p.vencido ? 'font-semibold text-primary' : ''}>
                              {dia(p.prazo)}
                              {p.status === 'aberto' && p.diasParaPrazo != null ? ` (${p.vencido ? 'vencido' : `${p.diasParaPrazo} dias`})` : ''}
                            </span>
                          </>
                        )}
                        {p.respondidoEm ? ` · respondido em ${dia(p.respondidoEm)}` : ''}
                        {p.resposta ? ` · ${p.resposta}` : ''}
                      </span>
                    </span>
                    <select className={`${SELECT_CLASS} h-8 w-auto text-xs`} value={p.status} onChange={(e) => statusProtocolo(p, e.target.value)}>
                      {Object.entries(STATUS_PROTOCOLO_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    {tecnico && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => excluirProtocolo(p)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------- documentos */}
      {abaAtual === 'documentos' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Documentos exigidos</CardTitle>
                <CardDescription>O que o cliente precisa entregar para este tipo de serviço. Enviar o arquivo marca como recebido; o cliente também consegue enviar pelo portal.</CardDescription>
              </div>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={aplicarModelo} title="Traz os documentos do modelo do tipo de serviço que ainda não estão na lista">
                  <Wand2 className="h-4 w-4" /> Aplicar modelo
                </Button>
                <Button size="sm" onClick={() => setDocNovo('1')}>
                  <Plus className="h-4 w-4" /> Documento
                </Button>
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <input ref={docUploadRef} type="file" className="hidden" onChange={(e) => enviarDoc(e.target.files)} />
            {d.documentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum documento na lista. Use “Aplicar modelo” para trazer os do tipo “{d.tipo || '—'}”.</p>
            ) : (
              <ul className="divide-y">
                {d.documentos.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_DOC_COR[doc.status] || ''}`}>{STATUS_DOC_LABEL[doc.status] || doc.status}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{doc.nome}</span>
                      {!doc.obrigatorio && <span className="ml-1 text-xs text-muted-foreground">(opcional)</span>}
                      <span className="block text-xs text-muted-foreground">
                        {doc.arquivoId && (
                          <a href={apiUrl(`/arquivos/${doc.arquivoId}/download`)} target="_blank" rel="noreferrer" className="hover:underline">
                            {doc.arquivoNome || 'arquivo'}
                          </a>
                        )}
                        {doc.recebidoEm ? ` · recebido em ${dia(doc.recebidoEm)}` : ''}
                        {doc.validade ? ` · válido até ${dia(doc.validade)}` : ''}
                        {doc.observacao ? ` · ${doc.observacao}` : ''}
                      </span>
                    </span>
                    <Input
                      type="date"
                      className="h-8 w-36 text-xs"
                      title="Validade"
                      defaultValue={doc.validade || ''}
                      onBlur={(e) => e.target.value !== (doc.validade || '') && api.put(`/processo-documentos/${doc.id}`, { validade: e.target.value || null }).then(carregar)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDocAlvo(doc)
                        docUploadRef.current?.click()
                      }}
                    >
                      <Upload className="h-4 w-4" /> {doc.arquivoId ? 'Substituir' : 'Enviar'}
                    </Button>
                    <select className={`${SELECT_CLASS} h-8 w-auto text-xs`} value={doc.status === 'vencido' ? 'recebido' : doc.status} onChange={(e) => statusDoc(doc, e.target.value)}>
                      <option value="pendente">Pendente</option>
                      <option value="recebido">Recebido</option>
                      <option value="dispensado">Dispensado</option>
                    </select>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => confirm(`Tirar “${doc.nome}” da lista?`) && api.del(`/processo-documentos/${doc.id}`).then(carregar)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------- arquivos */}
      {abaAtual === 'arquivos' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Arquivos do processo</CardTitle>
            <CardDescription>Matrícula, IPTU, alvará, guias pagas, DWG, ofícios — com categoria, validade e versões. O que estiver marcado aparece no portal do cliente.</CardDescription>
          </CardHeader>
          <CardContent>
            <Arquivos processoId={d.id} podeExcluir={tecnico} aoMudar={carregar} />
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------- vistorias */}
      {abaAtual === 'vistorias' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Vistorias do processo</CardTitle>
                <CardDescription>Levantamento, vistoria de conclusão, atualização — todas as idas a campo deste trabalho.</CardDescription>
              </div>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setVincular('1')}>
                  <Plus className="h-4 w-4" /> Incluir existente
                </Button>
                <Button size="sm" onClick={novaVistoria}>
                  <Camera className="h-4 w-4" /> Nova vistoria
                </Button>
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {d.vistorias.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma vistoria vinculada.</p>
            ) : (
              <ul className="divide-y">
                {d.vistorias.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link href={`/vistorias/${v.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="font-medium">#{v.id} · {v.imovelNome}</span>
                      <span className="text-muted-foreground"> — {v.tipoServico || 'sem tipo'}{v.dataVistoria ? ` · ${dia(v.dataVistoria)}` : ''}</span>
                    </Link>
                    <span className="text-xs text-muted-foreground">{v.fotos} fotos</span>
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COR[v.status] || ''}`}>{STATUS_LABEL[v.status] || v.status}</span>
                    {d.imovelId && d.vistorias.length > 1 && (
                      <Link href={`/imoveis/${d.imovelId}/comparar?a=${d.vistorias[d.vistorias.length - 1].id}&b=${v.id}`} className="text-xs text-primary hover:underline">
                        comparar
                      </Link>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Desvincular" onClick={() => confirm(`Tirar a vistoria #${v.id} deste processo?`) && api.del(`/processos/${id}/vistorias/${v.id}`).then(carregar)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------- RRT */}
      {abaAtual === 'rrt' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Responsabilidade técnica</CardTitle>
                <CardDescription>RRT (CAU) ou ART (CREA) de cada atividade do processo. O PDF da RRT fica em Arquivos (categoria RRT / ART) e o número sai no laudo.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setRrtParam('nova')}>
                <Plus className="h-4 w-4" /> RRT / ART
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {d.rrts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma RRT/ART registrada.</p>
            ) : (
              <ul className="divide-y">
                {d.rrts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-white">{r.tipo}</span>
                    <button className="min-w-0 flex-1 text-left hover:underline" onClick={() => setRrtParam(String(r.id))}>
                      <span className="font-medium">{r.numero || '(sem número)'}</span>
                      <span className="text-muted-foreground"> — {r.atividade || 'atividade não informada'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.profissionalNome}
                        {r.profissionalRegistro ? ` (${r.profissionalRegistro})` : ''}
                        {r.data ? ` · ${dia(r.data)}` : ''}
                        {r.valor ? ` · ${dinheiro(r.valor)}` : ''}
                        {r.vistoriaId ? ` · vistoria #${r.vistoriaId}` : ''}
                      </span>
                    </button>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{STATUS_RRT_LABEL[r.status] || r.status}</span>
                    {tecnico && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => confirm('Excluir esta RRT/ART?') && api.del(`/rrts/${r.id}`).then(carregar)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------ despesas */}
      {abaAtual === 'financeiro' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Resumo rotulo="Despesas do processo" valor={dinheiro(d.resumo.despesas)} />
            <Resumo rotulo="A reembolsar pelo cliente" valor={dinheiro(d.resumo.reembolsoPendente)} alerta={d.resumo.reembolsoPendente > 0} />
          </div>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Receipt className="h-4 w-4" /> Despesas do processo
                  </CardTitle>
                  <CardDescription>Taxas da prefeitura, cartório, cópias, correio — o que é reembolsável pelo cliente fica marcado até ser ressarcido.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setDespParam('1')}>
                  <Plus className="h-4 w-4" /> Despesa
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {d.despesas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma despesa lançada.</p>
              ) : (
                <ul className="divide-y">
                  {d.despesas.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{CATEGORIA_DESPESA_LABEL[x.categoria] || x.categoria}</span>
                      <span className="min-w-0 flex-1 truncate">{x.descricao || '—'}</span>
                      <span className="text-xs text-muted-foreground">{dia(x.data)}</span>
                      {x.temComprovante ? (
                        <a href={apiUrl(`/despesas-processo/${x.id}/comprovante`)} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                          comprovante
                        </a>
                      ) : (
                        <span className="text-xs text-amber-600">sem comprovante</span>
                      )}
                      {x.reembolsavel && (
                        <button
                          className={`rounded px-2 py-0.5 text-xs ${x.reembolsadoEm ? 'bg-emerald-100 text-emerald-900' : 'bg-primary/10 text-primary ring-1 ring-primary/30'}`}
                          onClick={() => api.put(`/despesas-processo/${x.id}`, { reembolsadoEm: x.reembolsadoEm ? null : hojeIso() }).then(carregar)}
                          title="Clique para alternar"
                        >
                          {x.reembolsadoEm ? `reembolsado ${dia(x.reembolsadoEm)}` : 'a reembolsar'}
                        </button>
                      )}
                      <span className="w-24 text-right font-medium">{dinheiro(x.valor)}</span>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => confirm('Excluir a despesa?') && api.del(`/despesas-processo/${x.id}`).then(carregar)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---------------------------------------------------------- histórico */}
      {abaAtual === 'historico' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Linha do tempo
            </CardTitle>
            <CardDescription>Tudo que aconteceu neste processo, por quem e quando.</CardDescription>
          </CardHeader>
          <CardContent>
            {historico.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
            ) : (
              <ol className="relative space-y-2 border-l pl-5">
                {historico.map((h) => (
                  <li key={h.id} className="relative text-sm">
                    <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full bg-zinc-400" />
                    <p>{h.descricao || h.acao}</p>
                    <p className="text-xs text-muted-foreground">
                      {dataHora(h.createdAt)} · {h.userNome || 'sistema'} · {h.acao}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------- diálogos */}
      <Dialog open={!!protoParam} onOpenChange={(o) => !o && setProtoParam(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{protoParam === 'novo' ? 'Novo protocolo' : 'Protocolo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarProtocolo} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Órgão</Label>
                <select className={SELECT_CLASS} value={protoForm.orgao} onChange={(e) => setProtoForm({ ...protoForm, orgao: e.target.value })}>
                  {Object.entries(ORGAO_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select className={SELECT_CLASS} value={protoForm.tipo} onChange={(e) => setProtoForm({ ...protoForm, tipo: e.target.value })}>
                  {Object.entries(TIPO_PROTOCOLO_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Número do protocolo</Label>
                <Input value={protoForm.numero} onChange={(e) => setProtoForm({ ...protoForm, numero: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={protoForm.data} onChange={(e) => setProtoForm({ ...protoForm, data: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Assunto / exigências</Label>
                <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={protoForm.assunto} onChange={(e) => setProtoForm({ ...protoForm, assunto: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Prazo para responder</Label>
                <Input type="date" value={protoForm.prazo} onChange={(e) => setProtoForm({ ...protoForm, prazo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Situação</Label>
                <select className={SELECT_CLASS} value={protoForm.status} onChange={(e) => setProtoForm({ ...protoForm, status: e.target.value })}>
                  {Object.entries(STATUS_PROTOCOLO_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Resposta dada / resultado</Label>
                <textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={protoForm.resposta} onChange={(e) => setProtoForm({ ...protoForm, resposta: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Observações</Label>
                <Input value={protoForm.observacoes} onChange={(e) => setProtoForm({ ...protoForm, observacoes: e.target.value })} />
              </div>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProtoParam(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={docNovo === '1'} onOpenChange={(o) => !o && setDocNovo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Documento exigido</DialogTitle>
          </DialogHeader>
          <form onSubmit={criarDoc} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={docForm.nome} onChange={(e) => setDocForm({ ...docForm, nome: e.target.value })} placeholder="Ex.: Certidão negativa de débitos" required />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={docForm.obrigatorio} onChange={(e) => setDocForm({ ...docForm, obrigatorio: e.target.checked })} /> Obrigatório
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDocNovo(null)}>
                Cancelar
              </Button>
              <Button type="submit">Adicionar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={vincular === '1'} onOpenChange={(o) => !o && setVincular(null)}>
        <DialogContent className="max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Incluir vistoria no processo</DialogTitle>
          </DialogHeader>
          <ul className="divide-y">
            {candidatas
              .filter((c) => !c.processoId && (!d.imovelId || c.imovelId === d.imovelId))
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">#{c.id} · {c.imovelNome}</span>
                    <span className="text-muted-foreground"> — {c.tipoServico || 'sem tipo'}{c.dataVistoria ? ` · ${dia(c.dataVistoria)}` : ''}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => vincularVistoria(c.id)}>
                    Incluir
                  </Button>
                </li>
              ))}
            {candidatas.filter((c) => !c.processoId && (!d.imovelId || c.imovelId === d.imovelId)).length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">Nenhuma vistoria livre {d.imovelId ? 'deste imóvel' : ''}. Crie uma nova.</li>
            )}
          </ul>
          <DialogFooter>
            <Button onClick={() => setVincular(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rrtParam} onOpenChange={(o) => !o && setRrtParam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rrtParam === 'nova' ? 'Nova RRT / ART' : 'RRT / ART'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarRrt} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select className={SELECT_CLASS} value={rrtForm.tipo} onChange={(e) => setRrtForm({ ...rrtForm, tipo: e.target.value })}>
                  <option value="RRT">RRT (CAU)</option>
                  <option value="ART">ART (CREA)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Número</Label>
                <Input value={rrtForm.numero} onChange={(e) => setRrtForm({ ...rrtForm, numero: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Atividade técnica</Label>
                <Input value={rrtForm.atividade} onChange={(e) => setRrtForm({ ...rrtForm, atividade: e.target.value })} placeholder="Ex.: Levantamento arquitetônico e projeto de regularização" />
              </div>
              <div className="space-y-1.5">
                <Label>Profissional</Label>
                <select className={SELECT_CLASS} value={rrtForm.userId} onChange={(e) => setRrtForm({ ...rrtForm, userId: e.target.value })}>
                  <option value="">Eu mesmo</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.registro ? ` (${u.registro})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Vistoria (opcional)</Label>
                <select className={SELECT_CLASS} value={rrtForm.vistoriaId} onChange={(e) => setRrtForm({ ...rrtForm, vistoriaId: e.target.value })}>
                  <option value="">—</option>
                  {d.vistorias.map((v) => (
                    <option key={v.id} value={v.id}>
                      #{v.id} · {v.tipoServico || 'vistoria'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={rrtForm.data} onChange={(e) => setRrtForm({ ...rrtForm, data: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input value={rrtForm.valor} onChange={(e) => setRrtForm({ ...rrtForm, valor: e.target.value })} placeholder="0,00" />
              </div>
              <div className="space-y-1.5">
                <Label>Situação</Label>
                <select className={SELECT_CLASS} value={rrtForm.status} onChange={(e) => setRrtForm({ ...rrtForm, status: e.target.value })}>
                  {Object.entries(STATUS_RRT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Observações</Label>
                <Input value={rrtForm.observacoes} onChange={(e) => setRrtForm({ ...rrtForm, observacoes: e.target.value })} />
              </div>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRrtParam(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={despParam === '1'} onOpenChange={(o) => !o && setDespParam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Despesa do processo</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarDespesa} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <select className={SELECT_CLASS} value={despForm.categoria} onChange={(e) => setDespForm({ ...despForm, categoria: e.target.value })}>
                  {Object.entries(CATEGORIA_DESPESA_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input value={despForm.valor} onChange={(e) => setDespForm({ ...despForm, valor: e.target.value })} placeholder="0,00" required />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Input value={despForm.descricao} onChange={(e) => setDespForm({ ...despForm, descricao: e.target.value })} placeholder="Ex.: Taxa de análise do projeto" />
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={despForm.data} onChange={(e) => setDespForm({ ...despForm, data: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={despForm.reembolsavel} onChange={(e) => setDespForm({ ...despForm, reembolsavel: e.target.checked })} /> Reembolsável pelo cliente
            </label>
            <div className="space-y-1.5">
              <Label>Comprovante (foto ou PDF)</Label>
              <Input type="file" accept="image/*,.pdf" onChange={(e) => setDespArquivo(e.target.files?.[0] || null)} />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDespParam(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Lançando…' : 'Lançar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {erro && d && !protoParam && !rrtParam && !despParam && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {erro}
        </p>
      )}
    </div>
  )
}
