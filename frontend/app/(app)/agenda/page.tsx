'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bed,
  Bus,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Filter,
  Plane,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import {
  Imovel,
  SELECT_CLASS,
  STATUS_COR,
  STATUS_LABEL,
  TIPOS_SERVICO,
  VistoriaResumo,
  filtrarPorTexto,
} from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// Agenda geral: tudo que está marcado — vistorias e os trechos das viagens —
// num calendário só, com filtros por responsável, tipo e busca (o mesmo espírito
// da agenda do Legal One: ver o dia inteiro e conseguir recortar por pessoa).
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface ItemCronograma {
  id: number
  tipo: string
  titulo: string
  inicio: string
  fim: string | null
  origem: string
  destino: string
  codigo: string
  valor: number
  notificar: boolean
  viagemId: number
  viagemTitulo: string
  clientes: string | null
  imoveis: string | null
  responsavelId: number | null
  responsavelNome: string | null
}

// Compromisso normalizado: vistoria ou trecho de viagem.
interface Evento {
  chave: string
  data: string // YYYY-MM-DD
  hora: string
  tipo: string // 'vistoria' | 'voo' | 'onibus' | ...
  titulo: string
  detalhe: string
  responsavelId: number | null
  responsavelNome: string | null
  cor: string
  destino: string
}

const ICONE: Record<string, typeof Plane> = {
  vistoria: ClipboardList,
  voo: Plane,
  onibus: Bus,
  carro: Car,
  transfer: Car,
  hotel: Bed,
}

const TIPOS_FILTRO = [
  { v: '', label: 'Todos os tipos' },
  { v: 'vistoria', label: 'Vistorias' },
  { v: 'voo', label: 'Voos' },
  { v: 'onibus', label: 'Ônibus' },
  { v: 'carro', label: 'Carro' },
  { v: 'transfer', label: 'Transfer / Uber' },
  { v: 'hotel', label: 'Hospedagem' },
  { v: 'outro', label: 'Outros' },
]

export default function AgendaPage() {
  const router = useRouter()
  const [vistorias, setVistorias] = useState<VistoriaResumo[]>([])
  const [imoveis, setImoveis] = useState<Imovel[]>([])
  const [cronograma, setCronograma] = useState<ItemCronograma[]>([])
  const [usuarios, setUsuarios] = useState<{ id: number; name: string }[]>([])
  const [carregando, setCarregando] = useState(true)

  // Tudo na URL: mês, dia, e os filtros (dá para salvar o link já filtrado).
  const [mesParam, setMesParam] = useParamEstado('mes')
  const [diaParam, setDiaParam] = useParamEstado('dia')
  const [busca, setBusca] = useParamEstado('busca')
  const [responsavel, setResponsavel] = useParamEstado('responsavel')
  const [tipo, setTipo] = useParamEstado('tipo')

  const hoje = new Date()
  const mesAtual = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : iso(hoje).slice(0, 7)
  const [ano, mes] = mesAtual.split('-').map(Number)
  const nomeResponsavel = usuarios.find((u) => String(u.id) === responsavel)?.name
  useTitulo(`Agenda — ${MESES[mes - 1]} de ${ano}${nomeResponsavel ? ` · ${nomeResponsavel}` : ''}`)

  const [form, setForm] = useState({ imovelId: '', tipoServico: TIPOS_SERVICO[0], participantes: '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = () => {
    setCarregando(true)
    Promise.all([
      api.get<{ data: VistoriaResumo[] }>('/vistorias').then((r) => setVistorias(r.data)),
      api.get<{ data: ItemCronograma[] }>('/cronograma?dias=365').then((r) => setCronograma(r.data)),
    ]).finally(() => setCarregando(false))
  }
  useEffect(() => {
    carregar()
    api.get<{ data: Imovel[] }>('/imoveis').then((r) => setImoveis(r.data))
    api.get<{ data: { id: number; name: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [])

  useEffect(() => {
    if (diaParam) {
      setForm({ imovelId: '', tipoServico: TIPOS_SERVICO[0], participantes: '' })
      setErro(null)
    }
  }, [diaParam])

  // Vistorias e trechos de viagem viram uma lista só de compromissos.
  const eventos = useMemo<Evento[]>(() => {
    const dasVistorias: Evento[] = vistorias
      .filter((v) => v.dataVistoria)
      .map((v) => ({
        chave: `v-${v.id}`,
        data: v.dataVistoria!,
        hora: '',
        tipo: 'vistoria',
        titulo: v.imovelNome || `Vistoria #${v.id}`,
        detalhe: `${v.clienteNome || ''} · ${v.tipoServico || 'vistoria'}`,
        responsavelId: v.responsavelId ?? null,
        responsavelNome: v.responsavelNome ?? null,
        cor: STATUS_COR[v.status] || 'bg-muted',
        destino: v.endereco || '',
      }))
    const dosItens: Evento[] = cronograma.map((it) => ({
      chave: `i-${it.id}`,
      data: it.inicio.slice(0, 10),
      hora: new Date(it.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      tipo: it.tipo,
      titulo: it.titulo,
      detalhe: [it.viagemTitulo, it.clientes, it.codigo].filter(Boolean).join(' · '),
      responsavelId: it.responsavelId,
      responsavelNome: it.responsavelNome,
      cor: 'bg-zinc-200 text-zinc-900',
      destino: it.destino,
    }))
    return [...dasVistorias, ...dosItens]
  }, [vistorias, cronograma])

  // Filtros (responsável, tipo e texto) valem para o calendário e para a lista.
  const filtrados = useMemo(() => {
    let lista = eventos
    if (responsavel) lista = lista.filter((e) => String(e.responsavelId ?? '') === responsavel)
    if (tipo) lista = lista.filter((e) => e.tipo === tipo)
    return filtrarPorTexto(lista, busca || '', (e) => [e.titulo, e.detalhe, e.destino, e.responsavelNome])
  }, [eventos, responsavel, tipo, busca])

  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const e of filtrados) {
      const lista = m.get(e.data) || []
      lista.push(e)
      m.set(e.data, lista)
    }
    for (const lista of m.values()) lista.sort((a, b) => a.hora.localeCompare(b.hora))
    return m
  }, [filtrados])

  const proximos = useMemo(() => {
    const hojeStr = iso(hoje)
    return filtrados
      .filter((e) => e.data >= hojeStr)
      .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora))
      .slice(0, 30)
  }, [filtrados]) // eslint-disable-line react-hooks/exhaustive-deps

  const semDataMarcada = useMemo(
    () =>
      vistorias.filter(
        (v) => !v.dataVistoria && (!responsavel || String(v.responsavelId ?? '') === responsavel)
      ),
    [vistorias, responsavel]
  )

  const semanas = useMemo(() => {
    const primeiro = new Date(ano, mes - 1, 1)
    const deslocamento = primeiro.getDay()
    const diasNoMes = new Date(ano, mes, 0).getDate()
    const linhas = Math.ceil((deslocamento + diasNoMes) / 7)
    const inicio = new Date(primeiro)
    inicio.setDate(1 - deslocamento)
    return Array.from({ length: linhas }, (_, semana) =>
      Array.from({ length: 7 }, (_, dia) => {
        const d = new Date(inicio)
        d.setDate(inicio.getDate() + semana * 7 + dia)
        return d
      })
    )
  }, [ano, mes])

  const mudarMes = (delta: number) => setMesParam(iso(new Date(ano, mes - 1 + delta, 1)).slice(0, 7))

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/vistorias', {
        imovelId: form.imovelId,
        tipoServico: form.tipoServico,
        participantes: form.participantes,
        dataVistoria: diaParam,
        responsavelId: responsavel ? Number(responsavel) : undefined,
      })
      setDiaParam(null)
      carregar()
      router.push(`/vistorias/${r.data.id}`)
    } catch (err: any) {
      setErro(err?.message || 'Erro ao agendar')
      setSalvando(false)
    }
  }

  const hojeIso = iso(hoje)
  const temFiltro = !!(busca || responsavel || tipo)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <CalendarDays className="h-6 w-6" /> Agenda
            {nomeResponsavel && <span className="text-base font-normal text-muted-foreground">· {nomeResponsavel}</span>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Vistorias e trechos de viagem no mesmo calendário. Clique num dia para agendar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => mudarMes(-1)} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-44 text-center font-medium">
            {MESES[mes - 1]} de {ano}
          </span>
          <Button variant="outline" size="icon" onClick={() => mudarMes(1)} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setMesParam(null)}>
            Hoje
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por imóvel, cliente, viagem, localizador…"
            value={busca || ''}
            onChange={(e) => setBusca(e.target.value || null)}
          />
        </div>
        <select
          className={`${SELECT_CLASS} w-auto`}
          value={responsavel || ''}
          onChange={(e) => setResponsavel(e.target.value || null)}
        >
          <option value="">Todos os profissionais</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className={`${SELECT_CLASS} w-auto`} value={tipo || ''} onChange={(e) => setTipo(e.target.value || null)}>
          {TIPOS_FILTRO.map((t) => (
            <option key={t.v} value={t.v}>
              {t.label}
            </option>
          ))}
        </select>
        {temFiltro && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBusca(null)
              setResponsavel(null)
              setTipo(null)
            }}
          >
            <X className="h-4 w-4" /> Limpar
          </Button>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Filter className="h-3 w-3" /> {filtrados.length} compromisso(s)
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {DIAS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {semanas.flat().map((d) => {
            const data = iso(d)
            const doMes = d.getMonth() === mes - 1
            const doDia = porDia.get(data) || []
            return (
              <button
                key={data}
                onClick={() => setDiaParam(data)}
                className={`group min-h-24 border-b border-r p-1.5 text-left align-top transition-colors hover:bg-accent/50 ${
                  doMes ? '' : 'bg-muted/30 text-muted-foreground'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      data === hojeIso ? 'bg-primary font-semibold text-primary-foreground' : ''
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <Plus className="invisible h-3.5 w-3.5 text-muted-foreground group-hover:visible" />
                </span>
                <span className="mt-1 flex flex-col gap-1">
                  {doDia.slice(0, 3).map((e) => (
                    <span
                      key={e.chave}
                      className={`truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${e.cor}`}
                      title={`${e.hora ? e.hora + ' · ' : ''}${e.titulo} — ${e.detalhe}${
                        e.responsavelNome ? ` · ${e.responsavelNome}` : ''
                      }`}
                    >
                      {e.hora ? `${e.hora} ` : ''}
                      {e.titulo}
                    </span>
                  ))}
                  {doDia.length > 3 && (
                    <span className="px-1.5 text-[11px] text-muted-foreground">+{doDia.length - 3} no dia</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      {carregando && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}

      {/* Lista dos próximos compromissos (mesma filtragem do calendário) */}
      <Card className="mt-6">
        <CardContent className="p-4">
          <p className="mb-1 text-sm font-medium">Próximos compromissos</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Vistorias e trechos de viagem, na ordem em que acontecem.
          </p>
          {proximos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {temFiltro ? 'Nada encontrado com estes filtros.' : 'Nada agendado à frente.'}
            </p>
          ) : (
            <ul className="divide-y">
              {proximos.map((e) => {
                const Icon = ICONE[e.tipo] || CalendarDays
                return (
                  <li key={e.chave} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">
                      {e.data.split('-').reverse().slice(0, 2).join('/')}
                      {e.hora ? ` ${e.hora}` : ''}
                    </span>
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {e.titulo}
                      <span className="text-muted-foreground"> · {e.detalhe}</span>
                    </span>
                    {e.responsavelNome && (
                      <span className="truncate text-xs text-muted-foreground">{e.responsavelNome}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {semDataMarcada.length > 0 && (
        <Card className="mt-6">
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium">Vistorias sem data marcada ({semDataMarcada.length})</p>
            <div className="flex flex-wrap gap-2">
              {semDataMarcada.map((v) => (
                <button
                  key={v.id}
                  onClick={() => router.push(`/vistorias/${v.id}?editar=1`)}
                  className="rounded border px-2 py-1 text-xs hover:bg-accent"
                  title="Abrir para definir a data"
                >
                  #{v.id} · {v.imovelNome}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agendar vistoria no dia escolhido */}
      <Dialog open={!!diaParam} onOpenChange={(o) => !o && setDiaParam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agendar vistoria — {diaParam ? diaParam.split('-').reverse().join('/') : ''}</DialogTitle>
          </DialogHeader>

          {diaParam && (porDia.get(diaParam)?.length ?? 0) > 0 && (
            <div className="rounded-md border bg-muted/30 p-2 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Já neste dia:</p>
              {porDia.get(diaParam)!.map((e) => (
                <p key={e.chave} className="truncate text-sm">
                  {e.hora ? `${e.hora} · ` : ''}
                  {e.titulo} <span className="text-muted-foreground">— {e.detalhe}</span>
                </p>
              ))}
            </div>
          )}

          <form onSubmit={criar} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Imóvel</Label>
              <select
                className={SELECT_CLASS}
                value={form.imovelId}
                onChange={(e) => setForm({ ...form, imovelId: e.target.value })}
                required
              >
                <option value="">Selecione…</option>
                {imoveis.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome} — {i.clienteNome}
                  </option>
                ))}
              </select>
              {imoveis.length === 0 && (
                <p className="text-xs text-muted-foreground">Cadastre um cliente e um imóvel primeiro.</p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo de serviço</Label>
                <select
                  className={SELECT_CLASS}
                  value={form.tipoServico}
                  onChange={(e) => setForm({ ...form, tipoServico: e.target.value })}
                >
                  {TIPOS_SERVICO.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Participantes</Label>
                <Input
                  value={form.participantes}
                  onChange={(e) => setForm({ ...form, participantes: e.target.value })}
                  placeholder="Quem vai junto"
                />
              </div>
            </div>
            {nomeResponsavel && (
              <p className="text-xs text-muted-foreground">
                Será criada com <strong>{nomeResponsavel}</strong> como responsável (filtro ativo).
              </p>
            )}
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDiaParam(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando || !form.imovelId}>
                {salvando ? 'Agendando…' : 'Agendar vistoria'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
