'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Bed,
  Bus,
  CalendarPlus,
  Car,
  ExternalLink,
  FileSpreadsheet,
  FileUp,
  ListChecks,
  Loader2,
  Paperclip,
  Plane,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS, STATUS_COR, STATUS_LABEL, filtrarPorTexto } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Item {
  id: number
  tipo: string
  titulo: string
  inicio: string | null
  fim: string | null
  origem: string
  destino: string
  codigo: string
  valor: number
  notificar: boolean
  lembreteMin: number
  obs: string
  concluido: boolean
}

interface Despesa {
  id: number
  categoria: string
  descricao: string
  valor: number
  data: string | null
  temComprovante: boolean
  nomeOriginal: string
  vistoriaId: number | null
}

interface VistoriaDaViagem {
  id: number
  tipoServico: string
  dataVistoria: string | null
  status: string
  imovelNome: string
  endereco: string
  clienteNome: string
}

interface Dados {
  viagem: {
    id: number
    titulo: string
    destino: string
    inicio: string | null
    fim: string | null
    verba: number
    observacoes: string
    responsavelId: number | null
    responsavelNome: string | null
    processo: string
    liderConferente: string
    retencao: number
    motivoRetencao: string
  }
  vistorias: VistoriaDaViagem[]
  itens: Item[]
  despesas: Despesa[]
  totais: { verba: number; previsto: number; gasto: number; saldo: number }
}

const TIPOS = [
  { v: 'voo', label: 'Voo', icon: Plane },
  { v: 'onibus', label: 'Ônibus', icon: Bus },
  { v: 'carro', label: 'Carro', icon: Car },
  { v: 'transfer', label: 'Transfer / Uber', icon: Car },
  { v: 'hotel', label: 'Hospedagem', icon: Bed },
  { v: 'vistoria', label: 'Vistoria', icon: CalendarPlus },
  { v: 'tarefa', label: 'Tarefa (marcar como feita)', icon: ListChecks },
  { v: 'outro', label: 'Outro', icon: CalendarPlus },
]

const CATEGORIAS = [
  { v: 'passagem', label: 'Passagem' },
  { v: 'hospedagem', label: 'Hospedagem' },
  { v: 'transporte', label: 'Transporte (uber, táxi, combustível)' },
  { v: 'alimentacao', label: 'Alimentação' },
  { v: 'outro', label: 'Outros' },
]

const LEMBRETES = [
  { v: 0, label: 'Na hora' },
  { v: 30, label: '30 min antes' },
  { v: 60, label: '1 hora antes' },
  { v: 120, label: '2 horas antes' },
  { v: 180, label: '3 horas antes' },
  { v: 720, label: '12 horas antes' },
  { v: 1440, label: '1 dia antes' },
]

const dinheiro = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// datetime-local ↔ ISO
const paraCampo = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const quando = (i: Item) => {
  if (!i.inicio) return 'sem data'
  const ini = new Date(i.inicio)
  const fmt = (d: Date) => d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return i.fim ? `${fmt(ini)} → ${fmt(new Date(i.fim))}` : fmt(ini)
}

const ITEM_VAZIO = {
  tipo: 'voo',
  titulo: '',
  inicio: '',
  fim: '',
  origem: '',
  destino: '',
  codigo: '',
  valor: '',
  notificar: true,
  lembreteMin: 180,
  obs: '',
}

export default function ViagemPage() {
  const { id } = useParams<{ id: string }>()
  const [d, setD] = useState<Dados | null>(null)
  const [itemOpen, setItemOpen] = useParamEstado('item')
  const [despesaOpen, setDespesaOpen] = useParamEstado('despesa')
  const [form, setForm] = useState(ITEM_VAZIO)
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [dForm, setDForm] = useState({ categoria: 'alimentacao', descricao: '', valor: '', data: '', vistoriaId: '' })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Vincular vistorias à viagem
  const [vincularOpen, setVincularOpen] = useParamEstado('vincular')
  // Importação de fatura / extrato / relatório da Uber
  const [faturaOpen, setFaturaOpen] = useParamEstado('fatura')
  const [arqFatura, setArqFatura] = useState<File | null>(null)
  const [lendoFatura, setLendoFatura] = useState(false)
  const [segundosFatura, setSegundosFatura] = useState(0)
  const [erroFatura, setErroFatura] = useState<string | null>(null)
  const [importado, setImportado] = useState<{
    arquivo: string
    nome: string
    lancamentos: { indice: number; data: string | null; descricao: string; valor: number; categoria: string; repetido: boolean }[]
  } | null>(null)
  const [marcados, setMarcados] = useState<Record<number, boolean>>({})
  const [candidatas, setCandidatas] = useState<any[]>([])
  const [usuarios, setUsuarios] = useState<{ id: number; name: string }[]>([])
  const [buscaVistoria, setBuscaVistoria] = useState('')

  const carregar = useCallback(() => {
    api.get<{ data: Dados }>(`/viagens/${id}`).then((r) => setD(r.data))
  }, [id])
  useEffect(() => {
    carregar()
    api.get<{ data: { id: number; name: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [carregar])

  useEffect(() => {
    if (vincularOpen === '1') {
      setBuscaVistoria('')
      api.get<{ data: any[] }>('/vistorias').then((r) => setCandidatas(r.data))
    }
  }, [vincularOpen])

  useTitulo(d ? `Viagem — ${d.viagem.titulo || d.viagem.destino}` : 'Viagem')

  // Abrir o formulário de item (novo ou edição vinda da URL).
  useEffect(() => {
    if (!itemOpen || !d) return
    setErro(null)
    if (itemOpen === 'novo') {
      setEditandoId(null)
      setForm({ ...ITEM_VAZIO, destino: d.viagem.destino })
      return
    }
    const it = d.itens.find((x) => String(x.id) === itemOpen)
    if (it) {
      setEditandoId(it.id)
      setForm({
        tipo: it.tipo,
        titulo: it.titulo,
        inicio: paraCampo(it.inicio),
        fim: paraCampo(it.fim),
        origem: it.origem,
        destino: it.destino,
        codigo: it.codigo,
        valor: it.valor ? String(it.valor) : '',
        notificar: it.notificar,
        lembreteMin: it.lembreteMin,
        obs: it.obs,
      })
    }
  }, [itemOpen, d])

  useEffect(() => {
    if (despesaOpen === '1') {
      setDForm({
        categoria: 'alimentacao',
        descricao: '',
        valor: '',
        data: new Date().toISOString().slice(0, 10),
        vistoriaId: '',
      })
      setArquivo(null)
      setErro(null)
    }
  }, [despesaOpen])

  if (!d) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const salvarViagem = async (campos: Record<string, unknown>) => {
    await api.put(`/viagens/${id}`, campos)
    carregar()
  }

  const vincular = async (vistoriaId: number) => {
    await api.post(`/viagens/${id}/vistorias`, { vistoriaId })
    carregar()
  }

  const desvincular = async (v: VistoriaDaViagem) => {
    if (!confirm(`Tirar a vistoria #${v.id} (${v.imovelNome}) desta viagem?`)) return
    await api.del(`/viagens/${id}/vistorias/${v.id}`)
    carregar()
  }

  const salvarItem = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    try {
      const corpo = {
        ...form,
        inicio: form.inicio ? new Date(form.inicio).toISOString() : null,
        fim: form.fim ? new Date(form.fim).toISOString() : null,
      }
      if (editandoId) await api.put(`/viagem-itens/${editandoId}`, corpo)
      else await api.post(`/viagens/${id}/itens`, corpo)
      setItemOpen(null)
      carregar()
    } catch (err: any) {
      setErro(err?.message || 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const marcarFeito = async (it: Item) => {
    await api.put(`/viagem-itens/${it.id}`, { concluido: !it.concluido })
    carregar()
  }

  const excluirItem = async (it: Item) => {
    if (!confirm(`Excluir “${it.titulo}” do cronograma?`)) return
    await api.del(`/viagem-itens/${it.id}`)
    carregar()
  }

  const salvarDespesa = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    try {
      const fd = new FormData()
      fd.append('categoria', dForm.categoria)
      fd.append('descricao', dForm.descricao)
      fd.append('valor', dForm.valor)
      if (dForm.data) fd.append('data', dForm.data)
      if (dForm.vistoriaId) fd.append('vistoriaId', dForm.vistoriaId)
      if (arquivo) fd.append('comprovante', arquivo)
      await api.upload(`/viagens/${id}/despesas`, fd)
      setDespesaOpen(null)
      carregar()
    } catch (err: any) {
      setErro(err?.message || 'Erro ao lançar')
    } finally {
      setSalvando(false)
    }
  }

  // Envia a fatura e acompanha a leitura (a IA leva alguns segundos).
  const importarFatura = async () => {
    if (!arqFatura) return
    setLendoFatura(true)
    setErroFatura(null)
    setImportado(null)
    setSegundosFatura(0)
    try {
      const fd = new FormData()
      fd.append('fatura', arqFatura)
      const envio = await api.upload<{ data: { leituraId: number; arquivo: string; nome: string } }>(
        `/viagens/${id}/fatura`,
        fd
      )
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000))
        const r = await api.get<{ data: { status: string; segundos: number; mensagem: string; dados: any } }>(
          `/fatura/leituras/${envio.data.leituraId}`
        )
        setSegundosFatura(r.data.segundos)
        if (r.data.status === 'erro') throw new Error(r.data.mensagem)
        if (r.data.status === 'ok') {
          setImportado({ arquivo: envio.data.arquivo, nome: envio.data.nome, lancamentos: r.data.dados.lancamentos })
          // Repetidos vêm desmarcados: já estão lançados na viagem.
          const m: Record<number, boolean> = {}
          for (const l of r.data.dados.lancamentos) m[l.indice] = !l.repetido
          setMarcados(m)
          return
        }
      }
    } catch (err: any) {
      setErroFatura(err?.message || 'Falha ao ler a fatura')
    } finally {
      setLendoFatura(false)
    }
  }

  const lancarImportadas = async () => {
    if (!importado) return
    const escolhidas = importado.lancamentos.filter((l) => marcados[l.indice])
    if (!escolhidas.length) return
    setSalvando(true)
    try {
      await api.post(`/viagens/${id}/despesas/lote`, {
        arquivo: importado.arquivo,
        nomeArquivo: importado.nome,
        despesas: escolhidas.map((l) => ({
          data: l.data,
          descricao: l.descricao,
          valor: l.valor,
          categoria: l.categoria,
        })),
      })
      setFaturaOpen(null)
      setImportado(null)
      setArqFatura(null)
      carregar()
    } catch (err: any) {
      setErroFatura(err?.message || 'Falha ao lançar')
    } finally {
      setSalvando(false)
    }
  }

  const excluirDespesa = async (x: Despesa) => {
    if (!confirm(`Excluir a despesa “${x.descricao || x.categoria}”?`)) return
    await api.del(`/despesas/${x.id}`)
    carregar()
  }

  const semComprovante = d.despesas.filter((x) => !x.temComprovante).length
  const estourou = d.totais.verba > 0 && d.totais.gasto > d.totais.verba

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/viagens" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Cronograma
        </Link>
        <h1 className="text-2xl font-semibold">{d.viagem.titulo || d.viagem.destino || `Viagem #${d.viagem.id}`}</h1>
        <p className="text-sm text-muted-foreground">
          {d.viagem.destino}
          {d.viagem.inicio ? ` · ${d.viagem.inicio.split('-').reverse().join('/')}` : ''}
          {d.viagem.fim && d.viagem.fim !== d.viagem.inicio ? ` a ${d.viagem.fim.split('-').reverse().join('/')}` : ''}
          {d.viagem.responsavelNome ? ` · responsável: ${d.viagem.responsavelNome}` : ''}
        </p>
      </div>

      {/* Vistorias cobertas por esta viagem */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Vistorias desta viagem</CardTitle>
              <CardDescription>
                Uma viagem pode cobrir vários imóveis — do mesmo cliente ou de clientes diferentes.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setVincularOpen('1')}>
              <Plus className="h-4 w-4" /> Incluir vistoria
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {d.vistorias.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma vistoria vinculada. Use <strong>Incluir vistoria</strong> para escolher os imóveis desta ida.
            </p>
          ) : (
            <ul className="divide-y">
              {d.vistorias.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link href={`/vistorias/${v.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    <span className="font-medium">#{v.id} · {v.imovelNome}</span>
                    <span className="text-muted-foreground"> — {v.clienteNome}</span>
                  </Link>
                  <span className="text-xs text-muted-foreground">{v.tipoServico || 'sem tipo'}</span>
                  {v.dataVistoria && (
                    <span className="text-xs text-muted-foreground">{v.dataVistoria.split('-').reverse().join('/')}</span>
                  )}
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COR[v.status] || ''}`}>
                    {STATUS_LABEL[v.status] || v.status}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => desvincular(v)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Destino, verba e saldo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Dados e verba
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input
                defaultValue={d.viagem.titulo}
                placeholder="Ex.: Cuiabá — escolas do grupo"
                onBlur={(e) => e.target.value !== d.viagem.titulo && salvarViagem({ titulo: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Destino</Label>
              <Input
                defaultValue={d.viagem.destino}
                placeholder="Ex.: Cuiabá - MT"
                onBlur={(e) => e.target.value !== d.viagem.destino && salvarViagem({ destino: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Ida</Label>
              <Input
                type="date"
                defaultValue={d.viagem.inicio || ''}
                onBlur={(e) => e.target.value !== (d.viagem.inicio || '') && salvarViagem({ inicio: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Volta</Label>
              <Input
                type="date"
                defaultValue={d.viagem.fim || ''}
                onBlur={(e) => e.target.value !== (d.viagem.fim || '') && salvarViagem({ fim: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <select
                className={SELECT_CLASS}
                value={d.viagem.responsavelId ?? ''}
                onChange={(e) => salvarViagem({ responsavelId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Não definido</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Verba aprovada (R$)</Label>
              <Input
                defaultValue={d.viagem.verba || ''}
                placeholder="0,00"
                onBlur={(e) => Number(e.target.value.replace(',', '.')) !== d.viagem.verba && salvarViagem({ verba: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Observações da viagem</Label>
            {/* textarea: um <input> perderia as quebras de linha (roteiro, listas). */}
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              rows={Math.min(24, Math.max(3, d.viagem.observacoes.split('\n').length + 1))}
              defaultValue={d.viagem.observacoes}
              placeholder="Ex.: levar trena a laser, combinar chave com o zelador"
              onBlur={(e) => e.target.value !== d.viagem.observacoes && salvarViagem({ observacoes: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { r: 'Verba', v: d.totais.verba },
              { r: 'Previsto (cronograma)', v: d.totais.previsto },
              { r: 'Gasto (comprovado)', v: d.totais.gasto },
              { r: 'Saldo', v: d.totais.saldo },
            ].map((x) => (
              <div key={x.r} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{x.r}</p>
                <p className={`text-lg font-semibold ${x.r === 'Saldo' && estourou ? 'text-destructive' : ''}`}>
                  {dinheiro(x.v)}
                </p>
              </div>
            ))}
          </div>
          {estourou && <p className="text-sm text-destructive">Os gastos passaram da verba aprovada.</p>}

          {/* Campos que a planilha de prestação de contas pede */}
          <details className="rounded-md border p-3" open={!!(d.viagem.processo || d.viagem.retencao)}>
            <summary className="cursor-pointer text-sm font-medium">Dados do relatório de despesas</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Processo / contrato</Label>
                <Input
                  defaultValue={d.viagem.processo}
                  placeholder="Como aparece na planilha"
                  onBlur={(e) => e.target.value !== d.viagem.processo && salvarViagem({ processo: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Líder conferente</Label>
                <Input
                  defaultValue={d.viagem.liderConferente}
                  placeholder="Quem confere a prestação"
                  onBlur={(e) =>
                    e.target.value !== d.viagem.liderConferente && salvarViagem({ liderConferente: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Retenção p/ próxima semana (R$)</Label>
                <Input
                  defaultValue={d.viagem.retencao || ''}
                  placeholder="0,00"
                  onBlur={(e) =>
                    Number(e.target.value.replace(',', '.')) !== d.viagem.retencao &&
                    salvarViagem({ retencao: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Motivo da retenção</Label>
                <Input
                  defaultValue={d.viagem.motivoRetencao}
                  onBlur={(e) =>
                    e.target.value !== d.viagem.motivoRetencao && salvarViagem({ motivoRetencao: e.target.value })
                  }
                />
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      {/* Cronograma */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Cronograma</CardTitle>
              <CardDescription>
                Ida, hospedagem, deslocamentos e volta. Quem estiver marcado com “avisar” vira alarme no seu celular.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <a href={apiUrl(`/viagens/${id}/calendario.ics`)}>
                <Button variant="outline" size="sm" disabled={d.itens.length === 0}>
                  <CalendarPlus className="h-4 w-4" /> Enviar para o calendário
                </Button>
              </a>
              <Button size="sm" onClick={() => setItemOpen('novo')}>
                <Plus className="h-4 w-4" /> Item
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {d.itens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada no cronograma ainda. Comece pela ida (voo ou ônibus) e siga até a volta.
            </p>
          ) : (
            <ol className="relative space-y-2 border-l pl-5">
              {d.itens.map((it) => {
                const T = TIPOS.find((t) => t.v === it.tipo) || TIPOS[TIPOS.length - 1]
                const Icon = T.icon
                return (
                  <li key={it.id} className="relative">
                    <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border bg-background">
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className={`flex flex-wrap items-center gap-2 rounded-md border p-2.5 ${it.concluido ? 'opacity-60' : ''}`}>
                      {it.tipo === 'tarefa' && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={it.concluido}
                          onChange={() => marcarFeito(it)}
                          aria-label={it.concluido ? 'Desmarcar tarefa' : 'Marcar tarefa como feita'}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`flex flex-wrap items-center gap-2 text-sm font-medium ${it.concluido ? 'line-through' : ''}`}>
                          {it.titulo}
                          {it.notificar && (
                            <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground ring-1 ring-border">
                              {it.lembreteMin <= 0
                                ? 'avisa na hora'
                                : `avisa ${it.lembreteMin >= 60 ? `${it.lembreteMin / 60}h` : `${it.lembreteMin}min`} antes`}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {quando(it)}
                          {it.origem || it.destino ? ` · ${it.origem || '?'} → ${it.destino || '?'}` : ''}
                          {it.codigo ? ` · ${it.codigo}` : ''}
                        </p>
                        {it.obs && <p className="whitespace-pre-line text-xs text-muted-foreground">{it.obs}</p>}
                      </div>
                      {!!it.valor && <span className="text-sm">{dinheiro(it.valor)}</span>}
                      <Button variant="ghost" size="sm" onClick={() => setItemOpen(String(it.id))}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => excluirItem(it)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Prestação de contas */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="h-4 w-4" /> Prestação de contas
              </CardTitle>
              <CardDescription>
                Lance o gasto e anexe o comprovante na hora — foto do recibo pelo celular já serve.
              </CardDescription>
            </div>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setFaturaOpen('1')} title="Fatura do cartão, extrato ou CSV da Uber">
                <FileUp className="h-4 w-4" /> Importar fatura
              </Button>
              <a href={apiUrl(`/viagens/${id}/relatorio.xlsx`)}>
                <Button size="sm" variant="outline" disabled={d.despesas.length === 0} title="Planilha padrão preenchida pela IA">
                  <FileSpreadsheet className="h-4 w-4" /> Relatório em Excel
                </Button>
              </a>
              <Button size="sm" onClick={() => setDespesaOpen('1')}>
                <Plus className="h-4 w-4" /> Despesa
              </Button>
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {d.despesas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma despesa lançada.</p>
          ) : (
            <>
              <ul className="divide-y">
                {d.despesas.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {CATEGORIAS.find((c) => c.v === x.categoria)?.label.split(' (')[0] || x.categoria}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{x.descricao || '—'}</span>
                    <span className="text-xs text-muted-foreground">
                      {x.data ? x.data.split('-').reverse().join('/') : ''}
                    </span>
                    {x.temComprovante ? (
                      <a
                        href={apiUrl(`/despesas/${x.id}/comprovante`)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Paperclip className="h-3 w-3" /> comprovante <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-amber-600">sem comprovante</span>
                    )}
                    <span className="w-24 text-right font-medium">{dinheiro(x.valor)}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => excluirDespesa(x)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
                <span className={semComprovante ? 'text-amber-600' : 'text-muted-foreground'}>
                  {semComprovante
                    ? `${semComprovante} despesa(s) sem comprovante anexado`
                    : 'Todas as despesas têm comprovante'}
                </span>
                <span className="font-semibold">Total: {dinheiro(d.totais.gasto)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Incluir vistorias na viagem */}
      <Dialog open={vincularOpen === '1'} onOpenChange={(o) => !o && setVincularOpen(null)}>
        <DialogContent className="max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Incluir vistoria nesta viagem</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Buscar por imóvel, cliente ou tipo…"
            value={buscaVistoria}
            onChange={(e) => setBuscaVistoria(e.target.value)}
          />
          <ul className="divide-y">
            {filtrarPorTexto(
              candidatas.filter((c) => !d.vistorias.some((v) => v.id === c.id)),
              buscaVistoria,
              (c) => [c.imovelNome, c.clienteNome, c.tipoServico]
            ).map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">#{c.id} · {c.imovelNome}</span>
                  <span className="text-muted-foreground"> — {c.clienteNome}</span>
                  {c.dataVistoria && (
                    <span className="text-xs text-muted-foreground"> · {c.dataVistoria.split('-').reverse().join('/')}</span>
                  )}
                </span>
                <Button size="sm" variant="outline" onClick={() => vincular(c.id)}>
                  Incluir
                </Button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setVincularOpen(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Importar fatura / extrato / CSV da Uber */}
      <Dialog open={faturaOpen === '1'} onOpenChange={(o) => !o && setFaturaOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Importar fatura, extrato ou corridas</DialogTitle>
          </DialogHeader>

          {!importado && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Envie a <strong>fatura do cartão</strong> (PDF, CSV ou OFX do app do banco) ou o{' '}
                <strong>relatório de viagens da Uber Empresas</strong> (CSV). O sistema separa os lançamentos, ignora
                pagamentos e encargos, e você confere antes de lançar.
              </p>
              <Input
                type="file"
                accept=".pdf,.csv,.ofx,.txt,image/*"
                onChange={(e) => setArqFatura(e.target.files?.[0] || null)}
              />
              {lendoFatura && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Lendo os lançamentos… ({segundosFatura}s)
                </p>
              )}
              {erroFatura && <p className="text-sm text-destructive">{erroFatura}</p>}
            </div>
          )}

          {importado && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {importado.lancamentos.length} lançamento(s) em <strong>{importado.nome}</strong>. Os já lançados nesta
                viagem vêm desmarcados. O arquivo fica como comprovante das despesas criadas.
              </p>
              <ul className="divide-y">
                {importado.lancamentos.map((l) => (
                  <li key={l.indice} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!marcados[l.indice]}
                      onChange={() => setMarcados((m) => ({ ...m, [l.indice]: !m[l.indice] }))}
                    />
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      {l.data ? l.data.split('-').reverse().slice(0, 2).join('/') : '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l.descricao}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {CATEGORIAS.find((c) => c.v === l.categoria)?.label.split(' (')[0] || l.categoria}
                    </span>
                    {l.repetido && <span className="text-xs text-amber-600">já lançado</span>}
                    <span className="w-24 text-right font-medium">{dinheiro(l.valor)}</span>
                  </li>
                ))}
              </ul>
              {erroFatura && <p className="text-sm text-destructive">{erroFatura}</p>}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFaturaOpen(null)}>
              Cancelar
            </Button>
            {importado ? (
              <Button onClick={lancarImportadas} disabled={salvando || Object.values(marcados).filter(Boolean).length === 0}>
                {salvando
                  ? 'Lançando…'
                  : `Lançar ${Object.values(marcados).filter(Boolean).length} despesa(s)`}
              </Button>
            ) : (
              <Button onClick={importarFatura} disabled={!arqFatura || lendoFatura}>
                {lendoFatura ? 'Lendo…' : 'Ler lançamentos'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item do cronograma */}
      <Dialog open={!!itemOpen} onOpenChange={(o) => !o && setItemOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editandoId ? 'Editar item' : 'Novo item do cronograma'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarItem} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select className={SELECT_CLASS} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  {TIPOS.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Input
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ex.: Voo GRU → Cuiabá"
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Início</Label>
                <Input type="datetime-local" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Fim (opcional)</Label>
                <Input type="datetime-local" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>De</Label>
                <Input value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Para</Label>
                <Input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Localizador / reserva / nº do voo</Label>
                <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="0,00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <textarea
                className="flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                rows={3}
                value={form.obs}
                onChange={(e) => setForm({ ...form, obs: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.notificar}
                  onChange={(e) => setForm({ ...form, notificar: e.target.checked })}
                />
                Avisar antes
              </label>
              <select
                className={`${SELECT_CLASS} h-9 w-auto`}
                value={form.lembreteMin}
                disabled={!form.notificar}
                onChange={(e) => setForm({ ...form, lembreteMin: Number(e.target.value) })}
              >
                {LEMBRETES.map((l) => (
                  <option key={l.v} value={l.v}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                O aviso vai junto quando você enviar o cronograma para o calendário.
              </span>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setItemOpen(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Despesa */}
      <Dialog open={despesaOpen === '1'} onOpenChange={(o) => !o && setDespesaOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lançar despesa</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarDespesa} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <select
                  className={SELECT_CLASS}
                  value={dForm.categoria}
                  onChange={(e) => setDForm({ ...dForm, categoria: e.target.value })}
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c.v} value={c.v}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input value={dForm.valor} onChange={(e) => setDForm({ ...dForm, valor: e.target.value })} placeholder="0,00" required />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Input
                  value={dForm.descricao}
                  onChange={(e) => setDForm({ ...dForm, descricao: e.target.value })}
                  placeholder="Ex.: Uber aeroporto → hotel"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={dForm.data} onChange={(e) => setDForm({ ...dForm, data: e.target.value })} />
              </div>
            </div>
            {d.vistorias.length > 1 && (
              <div className="space-y-1.5">
                <Label>Vincular a uma vistoria (opcional)</Label>
                <select
                  className={SELECT_CLASS}
                  value={dForm.vistoriaId}
                  onChange={(e) => setDForm({ ...dForm, vistoriaId: e.target.value })}
                >
                  <option value="">Gasto geral da viagem</option>
                  {d.vistorias.map((v) => (
                    <option key={v.id} value={v.id}>
                      #{v.id} · {v.imovelNome}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Comprovante (foto do recibo ou PDF)</Label>
              <Input
                type="file"
                accept="image/*,.pdf,.heic,.heif"
                capture="environment"
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">
                Pelo celular, o campo abre a câmera — fotografe o recibo na hora do gasto.
              </p>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDespesaOpen(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Lançando…' : 'Lançar despesa'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
