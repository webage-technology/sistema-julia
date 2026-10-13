'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Eye,
  FileText,
  FolderOpen,
  GitCompare,
  Loader2,
  MapPin,
  MapPinned,
  Pencil,
  Plus,
  ScanText,
  Trash2,
  Upload,
} from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { Pavimento, SELECT_CLASS, STATUS_COR, STATUS_LABEL, TIPOS_SERVICO, useTiposServico } from '@/lib/vistorias'
import { ETAPA_COR, ETAPA_LABEL, Pino } from '@/lib/regularizacao'
import { Arquivos } from '@/components/arquivos'
import { PlantaPinos } from '@/components/planta-pinos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Sugestao {
  pavimentos: { nome: string; ambientes: string[] }[]
  ignorados: { texto: string; ocorrencias: number }[]
  observacoes: string
  paginas: number
  textosLidos: number
  prancha: { total: number; presentes: number[] } | null
  visual?: boolean
}

interface Detalhe {
  id: number
  clientId: number
  nome: string
  endereco: string
  clienteNome: string
  plantaNome: string
  temPlanta: boolean
  plantas?: { nome: string; pdf: boolean }[]
  pavimentos: Pavimento[]
  vistorias: { id: number; tipoServico: string; dataVistoria: string | null; status: string; fotos: number; processoId: number | null }[]
  processos: { id: number; numero: string; titulo: string; tipo: string; etapa: string }[]
  pinos: number
  matricula: string
  cartorio: string
  inscricao: string
  lote: string
  quadra: string
  zoneamento: string
  uso: string
  areaTerreno: number | null
  areaAprovada: number | null
  areaIptu: number | null
  latitude: number | null
  longitude: number | null
  cep: string
  municipio: string
  uf: string
  observacoes: string
}

interface Prancha {
  indice: number
  nome: string
  paginas: number
}

export default function ImovelPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [det, setDet] = useState<Detalhe | null>(null)
  const [novoPav, setNovoPav] = useState('')
  const [novoAmb, setNovoAmb] = useState<Record<number, string>>({})
  const plantaRef = useRef<HTMLInputElement>(null)
  const [salvo, setSalvo] = useState<string | null>(null)

  // Diálogos com endereço próprio: ?editar=1 · ?nova-vistoria=1 · ?ler-planta=1 · ?aba=
  const [editar, setEditar] = useParamEstado('editar')
  const [novaVistoria, setNovaVistoria] = useParamEstado('nova-vistoria')
  const [aba, setAba] = useParamEstado('aba')
  const editOpen = editar === '1'
  const nvOpen = novaVistoria === '1'
  const [editForm, setEditForm] = useState({ nome: '', endereco: '' })
  const [ren, setRen] = useState<{ tipo: 'pavimento' | 'ambiente'; id: number; nome: string } | null>(null)
  const [nvForm, setNvForm] = useState({ tipoServico: TIPOS_SERVICO[0], dataVistoria: '', participantes: '', processoId: '' })
  const tipos = useTiposServico()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Leitura da planta pela IA: /imoveis/:id?ler-planta=1 (texto) · ?ler-planta=visual (imagem)
  const [lerPlanta, setLerPlanta] = useParamEstado('ler-planta')
  const lerOpen = !!lerPlanta
  const [lendo, setLendo] = useState(false)
  const [sugestao, setSugestao] = useState<Sugestao | null>(null)
  const [erroLeitura, setErroLeitura] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})
  const [extras, setExtras] = useState<Record<string, boolean>>({})
  const [pavExtras, setPavExtras] = useState('')
  const [verIgnorados, setVerIgnorados] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [modeloLeitura, setModeloLeitura] = useState<'sonnet' | 'opus'>('sonnet')

  // Planta com pinos
  const [pinos, setPinos] = useState<Pino[]>([])
  const [pranchas, setPranchas] = useState<Prancha[]>([])
  const [prancha, setPrancha] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [ambPino, setAmbPino] = useState<number | null>(null)

  const load = useCallback(() => {
    api.get<{ data: Detalhe }>(`/imoveis/${id}`).then((r) => setDet(r.data))
  }, [id])
  const loadPinos = useCallback(() => {
    api.get<{ data: Pino[] }>(`/imoveis/${id}/pinos`).then((r) => setPinos(r.data)).catch(() => {})
  }, [id])
  useEffect(() => {
    load()
    loadPinos()
  }, [load, loadPinos])
  useEffect(() => {
    if (det?.temPlanta) api.get<{ data: Prancha[] }>(`/imoveis/${id}/planta/pranchas`).then((r) => setPranchas(r.data)).catch(() => setPranchas([]))
  }, [det?.temPlanta, det?.plantaNome, id])

  useTitulo(det ? (nvOpen ? `Nova vistoria — ${det.nome}` : det.nome) : 'Imóvel')

  useEffect(() => {
    if (editOpen && det) setEditForm({ nome: det.nome, endereco: det.endereco })
  }, [editOpen, det])
  useEffect(() => {
    if (nvOpen) {
      setNvForm({ tipoServico: TIPOS_SERVICO[0], dataVistoria: '', participantes: '', processoId: '' })
      setErro(null)
    }
  }, [nvOpen])

  // Lê a planta assim que o diálogo abre. A leitura roda no servidor e é
  // consultada de 2 em 2 segundos (o proxy corta requisições longas).
  useEffect(() => {
    if (!lerOpen) return
    let cancelado = false
    setLendo(true)
    setSugestao(null)
    setErroLeitura(null)
    setSegundos(0)

    const receber = (dados: Sugestao) => {
      setSugestao(dados)
      const m: Record<string, boolean> = {}
      dados.pavimentos.forEach((p, pi) => p.ambientes.forEach((_, ai) => (m[`${pi}:${ai}`] = true)))
      setMarcados(m)
      setExtras({})
      setVerIgnorados(false)
      setPavExtras(dados.pavimentos[0]?.nome || 'Pavimento único')
    }

    const acompanhar = async (leituraId: number) => {
      while (!cancelado) {
        await new Promise((r) => setTimeout(r, 2000))
        if (cancelado) return
        const r = await api.get<{ data: { status: string; dados: Sugestao; mensagem: string; segundos: number } }>(`/planta/leituras/${leituraId}`)
        if (cancelado) return
        setSegundos(r.data.segundos)
        if (r.data.status === 'ok') return receber(r.data.dados)
        if (r.data.status === 'erro') throw new Error(r.data.mensagem)
      }
    }

    api
      .post<{ data: { leituraId: number } }>(`/imoveis/${id}/planta/ler`, { model: modeloLeitura, visual: lerPlanta === 'visual' })
      .then((r) => acompanhar(r.data.leituraId))
      .catch((err) => !cancelado && setErroLeitura(err?.message || 'Falha ao ler a planta'))
      .finally(() => !cancelado && setLendo(false))

    return () => {
      cancelado = true
    }
  }, [lerOpen, lerPlanta, id, modeloLeitura])

  // Daqui para baixo não pode haver hook.
  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const avisar = (t: string) => {
    setSalvo(t)
    setTimeout(() => setSalvo(null), 2000)
  }
  const salvarFicha = async (campos: Record<string, unknown>) => {
    try {
      await api.put(`/imoveis/${id}`, campos)
      avisar('Salvo')
      load()
    } catch (err: any) {
      alert(err?.message || 'Falha ao salvar')
    }
  }

  const trocarOrdem = async (tipo: 'pavimentos' | 'ambientes', lista: { id: number; ordem: number }[], idx: number, dir: -1 | 1) => {
    const outro = idx + dir
    if (outro < 0 || outro >= lista.length) return
    const a = lista[idx]
    const b = lista[outro]
    await api.put(`/${tipo}/${a.id}`, { ordem: b.ordem === a.ordem ? b.ordem + (dir === -1 ? -1 : 1) : b.ordem })
    await api.put(`/${tipo}/${b.id}`, { ordem: a.ordem })
    load()
  }

  const addPavimento = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!novoPav.trim()) return
    await api.post(`/imoveis/${id}/pavimentos`, { nome: novoPav.trim() })
    setNovoPav('')
    load()
  }

  const addAmbiente = async (pavId: number) => {
    const nome = (novoAmb[pavId] || '').trim()
    if (!nome) return
    await api.post(`/pavimentos/${pavId}/ambientes`, { nome })
    setNovoAmb({ ...novoAmb, [pavId]: '' })
    load()
  }

  const removerItem = async (tipo: 'pavimentos' | 'ambientes', itemId: number, nome: string) => {
    if (!confirm(`Excluir "${nome}" do modelo?`)) return
    await api.del(`/${tipo}/${itemId}`)
    load()
    loadPinos()
  }

  const salvarRen = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ren) return
    await api.put(`/${ren.tipo === 'pavimento' ? 'pavimentos' : 'ambientes'}/${ren.id}`, { nome: ren.nome })
    setRen(null)
    load()
    loadPinos()
  }

  const salvarEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.put(`/imoveis/${id}`, editForm)
    setEditar(null)
    load()
  }

  const enviarPlanta = async (files: FileList | null) => {
    if (!files?.length) return
    const form = new FormData()
    for (const f of Array.from(files)) form.append('planta', f)
    try {
      await api.upload(`/imoveis/${id}/planta`, form)
      load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao enviar planta')
    }
  }

  const aplicarSugestao = async () => {
    if (!sugestao) return
    const pavimentos = sugestao.pavimentos
      .map((p, pi) => ({ nome: p.nome, ambientes: p.ambientes.filter((_, ai) => marcados[`${pi}:${ai}`]) }))
      .filter((p) => p.ambientes.length)
    const resgatados = sugestao.ignorados.filter((t) => extras[t.texto]).map((t) => t.texto)
    if (resgatados.length) {
      const alvo = pavimentos.find((p) => p.nome === pavExtras)
      if (alvo) alvo.ambientes.push(...resgatados)
      else pavimentos.push({ nome: pavExtras || 'Pavimento único', ambientes: resgatados })
    }
    if (!pavimentos.length) return
    setBusy(true)
    try {
      const r = await api.post<{ data: { pavimentos: number; ambientes: number } }>(`/imoveis/${id}/estrutura`, { pavimentos })
      setLerPlanta(null)
      load()
      alert(`Adicionados: ${r.data.ambientes} ambientes em ${r.data.pavimentos || 'nenhum'} novo(s) pavimento(s).`)
    } catch (err: any) {
      setErroLeitura(err?.message || 'Falha ao adicionar')
    } finally {
      setBusy(false)
    }
  }

  const totalMarcados = Object.values(marcados).filter(Boolean).length + Object.values(extras).filter(Boolean).length

  const criarVistoria = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setBusy(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/vistorias', {
        imovelId: det.id,
        ...nvForm,
        dataVistoria: nvForm.dataVistoria || null,
        processoId: nvForm.processoId || null,
      })
      router.push(`/vistorias/${r.data.id}`)
    } catch (err: any) {
      setErro(err?.message || 'Erro ao criar vistoria')
      setBusy(false)
    }
  }

  const colocarPino = async (x: number, y: number) => {
    if (!ambPino) return
    const r = await api.put<{ data: Pino[] }>(`/imoveis/${id}/pinos`, { ambienteId: ambPino, prancha, x, y })
    setPinos(r.data)
    // Passa para o próximo ambiente sem pino — dá para marcar a planta inteira em sequência.
    const todos = det.pavimentos.flatMap((p) => p.ambientes)
    const comPino = new Set(r.data.map((p) => p.ambienteId))
    const i = todos.findIndex((a) => a.id === ambPino)
    const prox = [...todos.slice(i + 1), ...todos.slice(0, i)].find((a) => !comPino.has(a.id))
    setAmbPino(prox ? prox.id : null)
  }
  const removerPino = async (p: Pino) => {
    if (!p.id) return
    const r = await api.del<{ data: Pino[] }>(`/pinos/${p.id}`)
    setPinos(r.data)
  }

  const numero = (v: number | null | undefined) => (v == null ? '' : String(v))
  const campoFicha = (rotulo: string, chave: keyof Detalhe, extra?: { placeholder?: string; num?: boolean }) => (
    <div className="space-y-1.5">
      <Label>{rotulo}</Label>
      <Input
        defaultValue={extra?.num ? numero(det[chave] as number | null) : String(det[chave] ?? '')}
        placeholder={extra?.placeholder}
        inputMode={extra?.num ? 'decimal' : undefined}
        onBlur={(e) => {
          const atual = extra?.num ? numero(det[chave] as number | null) : String(det[chave] ?? '')
          if (e.target.value !== atual) salvarFicha({ [chave]: e.target.value })
        }}
      />
    </div>
  )

  const abaAtual = aba || ''
  const ABAS = [
    { k: '', label: 'Ficha e modelo' },
    { k: 'planta', label: `Planta com pinos${det.pinos ? ` (${det.pinos})` : ''}` },
    { k: 'arquivos', label: 'Arquivos' },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{det.nome}</h1>
          <p className="text-sm text-muted-foreground">
            {det.clienteNome}
            {det.endereco ? ` · ${det.endereco}` : ''}
            {det.latitude != null && det.longitude != null && (
              <>
                {' · '}
                <a href={`https://www.google.com/maps?q=${det.latitude},${det.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <MapPin className="h-3 w-3" /> mapa
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {salvo && <span className="text-xs text-muted-foreground">{salvo}</span>}
          <Link href={`/relatorios?imovel=${det.id}`}>
            <Button variant="outline">
              <FileText className="h-4 w-4" /> Relatórios
            </Button>
          </Link>
          {det.vistorias.length >= 2 && (
            <Link href={`/imoveis/${det.id}/comparar?a=${det.vistorias[det.vistorias.length - 1].id}&b=${det.vistorias[0].id}`}>
              <Button variant="outline">
                <GitCompare className="h-4 w-4" /> Comparar vistorias
              </Button>
            </Link>
          )}
          <Button variant="outline" onClick={() => setEditar('1')}>
            <Pencil className="h-4 w-4" /> Editar
          </Button>
          <Button onClick={() => setNovaVistoria('1')}>
            <Plus className="h-4 w-4" /> Nova vistoria
          </Button>
        </div>
      </div>

      <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted p-1">
        {ABAS.map((a) => (
          <button key={a.k} onClick={() => setAba(a.k || null)} className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold transition-colors ${abaAtual === a.k ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}>
            {a.label}
          </button>
        ))}
      </div>

      {abaAtual === '' && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ficha cadastral</CardTitle>
              <CardDescription>
                O que a prefeitura e o cartório pedem. A área aprovada e a do IPTU são comparadas com a área levantada em campo — a diferença é a divergência de área.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {campoFicha('Matrícula', 'matricula', { placeholder: '123.456' })}
              {campoFicha('Cartório de registro', 'cartorio', { placeholder: '5º CRI de São Paulo' })}
              {campoFicha('Inscrição imobiliária (SQL)', 'inscricao', { placeholder: '012.345.0067-8' })}
              {campoFicha('Lote', 'lote')}
              {campoFicha('Quadra', 'quadra')}
              {campoFicha('Zoneamento', 'zoneamento', { placeholder: 'ZM, ZC, ZEIS…' })}
              {campoFicha('Uso', 'uso', { placeholder: 'residencial, comercial, misto, institucional' })}
              {campoFicha('CEP', 'cep')}
              <div className="grid grid-cols-2 gap-3">
                {campoFicha('Município', 'municipio')}
                {campoFicha('UF', 'uf')}
              </div>
              {campoFicha('Área do terreno (m²)', 'areaTerreno', { num: true })}
              {campoFicha('Área construída aprovada (m²)', 'areaAprovada', { num: true })}
              {campoFicha('Área construída no IPTU (m²)', 'areaIptu', { num: true })}
              {campoFicha('Latitude', 'latitude', { num: true, placeholder: '-23.5432' })}
              {campoFicha('Longitude', 'longitude', { num: true, placeholder: '-46.6543' })}
              <div className="space-y-1.5">
                <Label>Consultas</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a href="https://geosampa.prefeitura.sp.gov.br/" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                    GeoSampa
                  </a>
                  <a href={`https://www.google.com/maps/search/${encodeURIComponent(det.endereco || det.nome)}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                    Google Maps
                  </a>
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label>Observações</Label>
                <textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue={det.observacoes} onBlur={(e) => e.target.value !== det.observacoes && salvarFicha({ observacoes: e.target.value })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Plantas</CardTitle>
              <CardDescription>
                PDF ou imagem — <strong>pode enviar várias pranchas de uma vez</strong> (01/05, 02/05…), já que cada uma traz os ambientes de um trecho. É a referência do modelo de ambientes, da planta com pinos e do que você fotografa como claquete.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              {det.plantas?.length ? (
                <span className="flex flex-wrap items-center gap-3">
                  {det.plantas.map((p, i) => (
                    <a key={p.nome} href={apiUrl(`/imoveis/${det.id}/planta?arquivo=${i}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                      <FileText className="h-4 w-4" /> {p.nome}
                    </a>
                  ))}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Nenhuma planta anexada.</span>
              )}
              <input ref={plantaRef} type="file" accept=".pdf,image/*" multiple className="hidden" onChange={(e) => enviarPlanta(e.target.files)} />
              <Button variant="outline" size="sm" onClick={() => plantaRef.current?.click()}>
                <Upload className="h-4 w-4" /> {det.temPlanta ? 'Substituir plantas' : 'Enviar plantas'}
              </Button>
              {det.temPlanta && (
                <>
                  <Button size="sm" onClick={() => setLerPlanta('1')}>
                    <ScanText className="h-4 w-4" /> Ler planta (texto do CAD)
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLerPlanta('visual')} title="Para planta escaneada ou com fontes em curvas: a imagem vai ao Claude com visão">
                    <Eye className="h-4 w-4" /> Ler planta como imagem
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Modelo de pavimentos e ambientes</CardTitle>
              <CardDescription>Cadastre na ordem prevista do caminho. Cada nova vistoria nasce com uma cópia deste modelo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {det.pavimentos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pavimento — comece adicionando um (ex.: Térreo).</p>}
              {det.pavimentos.map((p, pi) => (
                <div key={p.id} className="rounded-md border">
                  <div className="flex items-center gap-1 border-b bg-muted/40 px-3 py-2">
                    <span className="flex-1 text-sm font-semibold">{p.nome}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('pavimentos', det.pavimentos, pi, -1)} disabled={pi === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('pavimentos', det.pavimentos, pi, 1)} disabled={pi === det.pavimentos.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRen({ tipo: 'pavimento', id: p.id, nome: p.nome })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removerItem('pavimentos', p.id, p.nome)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  <ul className="divide-y">
                    {p.ambientes.map((a, ai) => (
                      <li key={a.id} className="flex items-center gap-1 px-3 py-1.5">
                        <span className="w-6 text-xs text-muted-foreground">{ai + 1}.</span>
                        <span className="flex-1 text-sm">
                          {a.nome}
                          {pinos.some((pp) => pp.ambienteId === a.id) && <MapPinned className="ml-1 inline h-3 w-3 text-muted-foreground" />}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('ambientes', p.ambientes, ai, -1)} disabled={ai === 0}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('ambientes', p.ambientes, ai, 1)} disabled={ai === p.ambientes.length - 1}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRen({ tipo: 'ambiente', id: a.id, nome: a.nome })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removerItem('ambientes', a.id, a.nome)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </li>
                    ))}
                    <li className="flex items-center gap-2 px-3 py-2">
                      <Input
                        className="h-8"
                        placeholder="Novo ambiente (ex.: Cozinha)"
                        value={novoAmb[p.id] || ''}
                        onChange={(e) => setNovoAmb({ ...novoAmb, [p.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addAmbiente(p.id)
                          }
                        }}
                      />
                      <Button size="sm" variant="outline" onClick={() => addAmbiente(p.id)}>
                        <Plus className="h-3.5 w-3.5" /> Ambiente
                      </Button>
                    </li>
                  </ul>
                </div>
              ))}
              <form onSubmit={addPavimento} className="flex items-center gap-2">
                <Input className="h-9 max-w-xs" placeholder="Novo pavimento (ex.: Térreo)" value={novoPav} onChange={(e) => setNovoPav(e.target.value)} />
                <Button type="submit" size="sm">
                  <Plus className="h-4 w-4" /> Pavimento
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Processos deste imóvel</CardTitle>
              </CardHeader>
              <CardContent>
                {det.processos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum processo.{' '}
                    <Link href="/processos?novo=1" className="text-primary hover:underline">
                      Abrir um
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="divide-y">
                    {det.processos.map((p) => (
                      <li key={p.id}>
                        <Link href={`/processos/${p.id}`} className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50">
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                          <span className="flex-1">
                            <span className="font-mono text-xs text-muted-foreground">{p.numero}</span> {p.titulo}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-xs ${ETAPA_COR[p.etapa] || ''}`}>{ETAPA_LABEL[p.etapa] || p.etapa}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Vistorias deste imóvel</CardTitle>
              </CardHeader>
              <CardContent>
                {det.vistorias.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma vistoria ainda.</p>
                ) : (
                  <ul className="divide-y">
                    {det.vistorias.map((v) => (
                      <li key={v.id}>
                        <Link href={`/vistorias/${v.id}`} className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50">
                          <ClipboardList className="h-4 w-4 text-muted-foreground" />
                          <span className="flex-1">
                            <span className="font-medium">#{v.id}</span> · {v.tipoServico || 'Sem tipo'}
                            {v.dataVistoria ? ` · ${v.dataVistoria.split('-').reverse().join('/')}` : ''}
                          </span>
                          <span className="text-muted-foreground">{v.fotos} fotos</span>
                          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COR[v.status] || ''}`}>{STATUS_LABEL[v.status] || v.status}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {abaAtual === 'planta' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Planta com pinos</CardTitle>
            <CardDescription>
              Escolha um ambiente na lista e clique na planta para colocar o pino (clique de novo para mover). Em campo, o celular mostra esta planta e tocar no pino troca de ambiente; no laudo o pino localiza a foto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!det.temPlanta ? (
              <p className="text-sm text-muted-foreground">Envie a planta primeiro (aba Ficha e modelo).</p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  {pranchas.length > 1 && (
                    <select
                      className={SELECT_CLASS}
                      value={prancha}
                      onChange={(e) => {
                        setPrancha(Number(e.target.value))
                        setPagina(1)
                      }}
                    >
                      {pranchas.map((p) => (
                        <option key={p.indice} value={p.indice}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                  )}
                  {(pranchas.find((p) => p.indice === prancha)?.paginas || 1) > 1 && (
                    <select className={SELECT_CLASS} value={pagina} onChange={(e) => setPagina(Number(e.target.value))}>
                      {Array.from({ length: pranchas.find((p) => p.indice === prancha)?.paginas || 1 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          página {i + 1}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="max-h-[60vh] space-y-2 overflow-auto rounded-md border p-2">
                    {det.pavimentos.map((p) => (
                      <div key={p.id}>
                        <p className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">{p.nome}</p>
                        {p.ambientes.map((a) => {
                          const pino = pinos.find((pp) => pp.ambienteId === a.id)
                          return (
                            <div key={a.id} className="group flex items-center">
                              <button onClick={() => setAmbPino(a.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${ambPino === a.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
                                <span className="flex-1 truncate">{a.nome}</span>
                                {pino && <MapPinned className="h-3 w-3 opacity-70" />}
                              </button>
                              {pino && (
                                <button className="invisible p-1 text-muted-foreground hover:text-destructive group-hover:visible" title="Remover pino" onClick={() => removerPino(pino)}>
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pinos.length} de {det.pavimentos.reduce((s, p) => s + p.ambientes.length, 0)} ambientes com pino.
                    {ambPino ? ' Clique na planta para posicionar.' : ' Escolha um ambiente.'}
                  </p>
                </div>
                <div className="overflow-auto">
                  <PlantaPinos imovelId={det.id} pinos={pinos} prancha={prancha} pagina={pagina} modo="editar" selecionado={ambPino} onColocar={colocarPino} onEscolher={(p) => setAmbPino(p.ambienteId)} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {abaAtual === 'arquivos' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Arquivos do imóvel</CardTitle>
            <CardDescription>Matrícula, IPTU, projetos aprovados, alvarás antigos — o que é do imóvel, e não de um processo específico.</CardDescription>
          </CardHeader>
          <CardContent>
            <Arquivos imovelId={det.id} clientId={det.clientId} />
          </CardContent>
        </Card>
      )}

      {/* Leitura da planta pela IA */}
      <Dialog open={lerOpen} onOpenChange={(o) => !o && setLerPlanta(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{lerPlanta === 'visual' ? 'Ambientes lidos da planta (imagem)' : 'Ambientes lidos da planta'}</DialogTitle>
          </DialogHeader>

          {lendo && (
            <div className="space-y-1 py-6">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {lerPlanta === 'visual' ? 'Rasterizando as pranchas e lendo com visão…' : 'Lendo a planta e separando os ambientes…'} ({segundos}s)
              </p>
              <p className="text-xs text-muted-foreground">Costuma levar de 30 s a 2 min. Pode continuar usando o sistema — a leitura roda no servidor.</p>
            </div>
          )}

          {erroLeitura && !lendo && (
            <div className="space-y-2 py-4">
              <p className="text-sm text-destructive">{erroLeitura}</p>
              {lerPlanta !== 'visual' && (
                <Button variant="outline" size="sm" onClick={() => setLerPlanta('visual')}>
                  <Eye className="h-4 w-4" /> Tentar a leitura como imagem
                </Button>
              )}
            </div>
          )}

          {sugestao && !lendo && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {sugestao.paginas} página(s){sugestao.textosLidos ? `, ${sugestao.textosLidos} textos lidos` : ' lidas como imagem'}. Desmarque o que não for ambiente de vistoria — nada é gravado até você confirmar.
              </p>
              {sugestao.prancha && sugestao.prancha.presentes.length < sugestao.prancha.total && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>
                    Faltam pranchas: você enviou {sugestao.prancha.presentes.length} de {sugestao.prancha.total}.
                  </strong>{' '}
                  Cada prancha traz os ambientes do seu trecho. Envie todas de uma vez em “Substituir plantas” e leia de novo.
                </p>
              )}
              {sugestao.pavimentos.length === 0 && <p className="text-sm">Nenhum ambiente reconhecido nesta planta. Cadastre manualmente.</p>}
              {sugestao.pavimentos.map((p, pi) => {
                const chaves = p.ambientes.map((_, ai) => `${pi}:${ai}`)
                const todos = chaves.every((k) => marcados[k])
                return (
                  <div key={pi} className="rounded-md border">
                    <label className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-semibold">
                      <input type="checkbox" checked={todos} onChange={() => setMarcados((m) => ({ ...m, ...Object.fromEntries(chaves.map((k) => [k, !todos])) }))} />
                      {p.nome}
                      <span className="ml-auto text-xs font-normal text-muted-foreground">{p.ambientes.length} ambientes</span>
                    </label>
                    <ul className="grid gap-1 p-3 sm:grid-cols-2">
                      {p.ambientes.map((a, ai) => (
                        <li key={ai}>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={!!marcados[`${pi}:${ai}`]} onChange={() => setMarcados((m) => ({ ...m, [`${pi}:${ai}`]: !m[`${pi}:${ai}`] }))} />
                            {a}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
              {sugestao.ignorados.length > 0 && (
                <div className="rounded-md border border-dashed">
                  <button type="button" onClick={() => setVerIgnorados((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
                    <span className="font-medium">Textos da planta que a IA não usou</span>
                    <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{sugestao.ignorados.length}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{verIgnorados ? 'ocultar' : 'conferir'}</span>
                  </button>
                  {verIgnorados && (
                    <div className="space-y-2 border-t p-3">
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {sugestao.ignorados.map((t) => (
                          <li key={t.texto}>
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={!!extras[t.texto]} onChange={() => setExtras((m) => ({ ...m, [t.texto]: !m[t.texto] }))} />
                              <span className="truncate" title={t.texto}>
                                {t.texto}
                                {t.ocorrencias > 1 && <span className="ml-1 text-xs text-muted-foreground">({t.ocorrencias}x)</span>}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {Object.values(extras).some(Boolean) && sugestao.pavimentos.length > 0 && (
                        <label className="flex items-center gap-2 text-xs">
                          Incluir no pavimento:
                          <select className={`${SELECT_CLASS} h-8 w-auto`} value={pavExtras} onChange={(e) => setPavExtras(e.target.value)}>
                            {sugestao.pavimentos.map((p) => (
                              <option key={p.nome}>{p.nome}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}
              {sugestao.observacoes && (
                <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <strong>Observação da IA:</strong> {sugestao.observacoes}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            {sugestao && !lendo && modeloLeitura === 'sonnet' ? (
              <Button type="button" variant="ghost" onClick={() => setModeloLeitura('opus')} title="Releitura mais cuidadosa (demora mais)">
                <ScanText className="h-4 w-4" /> Faltou ambiente? Ler de novo com mais capacidade
              </Button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setLerPlanta(null)}>
                Cancelar
              </Button>
              <Button onClick={aplicarSugestao} disabled={busy || lendo || totalMarcados === 0}>
                {busy ? 'Adicionando…' : `Adicionar ${totalMarcados} ambientes ao modelo`}
              </Button>
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar imóvel */}
      <Dialog open={editOpen} onOpenChange={(o) => !o && setEditar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar imóvel</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={editForm.nome} onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Endereço</Label>
              <Input value={editForm.endereco} onChange={(e) => setEditForm({ ...editForm, endereco: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditar(null)}>
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Renomear pavimento/ambiente */}
      <Dialog open={!!ren} onOpenChange={(o) => !o && setRen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear {ren?.tipo}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarRen} className="space-y-4">
            <Input value={ren?.nome || ''} onChange={(e) => ren && setRen({ ...ren, nome: e.target.value })} required />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRen(null)}>
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Nova vistoria */}
      <Dialog open={nvOpen} onOpenChange={(o) => !o && setNovaVistoria(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova vistoria — {det.nome}</DialogTitle>
          </DialogHeader>
          <form onSubmit={criarVistoria} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A vistoria nasce com uma cópia do modelo de ambientes deste imóvel{det.pavimentos.length === 0 ? ' (vazio — os ambientes poderão ser criados em campo)' : ''}.
            </p>
            <div className="space-y-1.5">
              <Label>Tipo de serviço</Label>
              <select className={SELECT_CLASS} value={nvForm.tipoServico} onChange={(e) => setNvForm({ ...nvForm, tipoServico: e.target.value })}>
                {tipos.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            {det.processos.length > 0 && (
              <div className="space-y-1.5">
                <Label>Processo</Label>
                <select className={SELECT_CLASS} value={nvForm.processoId} onChange={(e) => setNvForm({ ...nvForm, processoId: e.target.value })}>
                  <option value="">Sem processo</option>
                  {det.processos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.numero} — {p.titulo}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data prevista</Label>
                <Input type="date" value={nvForm.dataVistoria} onChange={(e) => setNvForm({ ...nvForm, dataVistoria: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Participantes</Label>
                <Input value={nvForm.participantes} onChange={(e) => setNvForm({ ...nvForm, participantes: e.target.value })} />
              </div>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovaVistoria(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Criando…' : 'Criar vistoria'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
