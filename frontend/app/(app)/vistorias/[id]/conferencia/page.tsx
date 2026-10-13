'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, MapPin, Maximize2, Pencil, PenLine, Plus, QrCode, Save, Star, Trash2, X } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import {
  Foto,
  SELECT_CLASS,
  Separacao,
  VistoriaDetalhe,
  ambientesAchatados,
  corDoAmbiente,
  resumoSeparacao,
  separarPorCartoes,
} from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AnotarFoto } from '@/components/anotar-foto'

// Modelo da conferência: a fita segue a ordem do caminho (cronológica). A Julia
// seleciona um ambiente e clica na PRIMEIRA foto dele — todas as seguintes
// entram no mesmo ambiente até a próxima fronteira. Fronteira com valor null
// significa "sem ambiente" daquele ponto em diante.
export default function ConferenciaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)
  const [fotos, setFotos] = useState<Foto[]>([])
  const [fronteiras, setFronteiras] = useState<Record<number, number | null>>({})
  const [selecionado, setSelecionado] = useState<number | null>(null)
  // A foto ampliada tem endereço próprio: ?foto=<id> (dá para mandar o link dela).
  const [fotoParam, setFotoParam] = useParamEstado('foto')
  const zoom = fotos.find((f) => String(f.id) === fotoParam) || null
  const setZoom = (f: Foto | null) => setFotoParam(f ? String(f.id) : null)
  const [salvando, setSalvando] = useState(false)
  const [ren, setRen] = useState<{ id: number; nome: string } | null>(null)
  const [novo, setNovo] = useState<{ pavimentoId: string; nome: string } | null>(null)
  // Anotação (setas/círculos) sobre a foto ampliada; `versao` força o
  // navegador a buscar a imagem de novo depois que o backend a regera.
  const [anotando, setAnotando] = useState(false)
  const [versao, setVersao] = useState(0)
  const [separando, setSeparando] = useState(false)
  const [separacao, setSeparacao] = useState<Separacao | null>(null)

  const load = useCallback(async () => {
    const [d, f] = await Promise.all([
      api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`),
      api.get<{ data: Foto[] }>(`/vistorias/${id}/fotos`),
    ])
    setDet(d.data)
    setFotos(f.data)
    // Fronteiras iniciais: onde o ambiente muda na fita salva no servidor.
    const init: Record<number, number | null> = {}
    let prev: number | null | undefined = undefined
    for (const foto of f.data) {
      const a = foto.ambienteId ?? null
      if (prev === undefined) {
        if (a !== null) init[foto.id] = a
      } else if (a !== prev) {
        init[foto.id] = a
      }
      prev = a
    }
    setFronteiras(init)
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  useTitulo(det ? `Conferência — vistoria #${det.id}` : 'Conferência')

  const ambientes = useMemo(() => (det ? ambientesAchatados(det.pavimentos) : []), [det])
  const corPorAmbiente = useMemo(() => {
    const m = new Map<number, string>()
    ambientes.forEach((a, i) => m.set(a.id, corDoAmbiente(i)))
    return m
  }, [ambientes])
  const nomePorAmbiente = useMemo(() => {
    const m = new Map<number, string>()
    ambientes.forEach((a) => m.set(a.id, a.nome))
    return m
  }, [ambientes])

  // Atribuição efetiva de cada foto, derivada das fronteiras.
  const efetivo = useMemo(() => {
    const m: Record<number, number | null> = {}
    let atual: number | null = null
    for (const f of fotos) {
      if (f.id in fronteiras) atual = fronteiras[f.id]
      m[f.id] = atual
    }
    return m
  }, [fotos, fronteiras])

  const contagem = useMemo(() => {
    const m = new Map<number | null, number>()
    for (const f of fotos) {
      const a = efetivo[f.id]
      m.set(a, (m.get(a) || 0) + 1)
    }
    return m
  }, [fotos, efetivo])

  const alteradas = useMemo(
    () => fotos.filter((f) => (efetivo[f.id] ?? null) !== (f.ambienteId ?? null)),
    [fotos, efetivo]
  )

  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const marcarFronteira = (foto: Foto) => {
    setFronteiras((fr) => ({ ...fr, [foto.id]: selecionado }))
  }
  const removerFronteira = (fotoId: number) => {
    setFronteiras((fr) => {
      const { [fotoId]: _removida, ...resto } = fr
      return resto
    })
  }

  // Muda só uma foto: fronteira nela + fronteira na seguinte restaurando o fluxo.
  const moverUma = (fotoId: number, alvo: number | null) => {
    const idx = fotos.findIndex((f) => f.id === fotoId)
    const proxima = fotos[idx + 1]
    setFronteiras((fr) => {
      const novoFr: Record<number, number | null> = { ...fr, [fotoId]: alvo }
      if (proxima) novoFr[proxima.id] = efetivo[proxima.id] ?? null
      return novoFr
    })
  }

  const salvar = async () => {
    setSalvando(true)
    try {
      await api.post(`/vistorias/${id}/fotos/atribuir`, {
        atribuicoes: alteradas.map((f) => ({ fotoId: f.id, ambienteId: efetivo[f.id] ?? null })),
      })
      await load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const toggleFlag = async (foto: Foto, campo: 'claquete' | 'destaque') => {
    const r = await api.put<{ data: { claquete: boolean; destaque: boolean } }>(`/fotos/${foto.id}`, {
      [campo]: !foto[campo],
    })
    // `zoom` deriva da lista, então basta atualizar a lista.
    setFotos((fs) => fs.map((f) => (f.id === foto.id ? { ...f, ...r.data } : f)))
  }

  const excluirFoto = async (foto: Foto) => {
    if (!confirm(`Excluir a foto #${foto.ordem}?`)) return
    await api.del(`/fotos/${foto.id}`)
    setZoom(null)
    load()
  }

  const salvarRen = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ren) return
    await api.put(`/ambientes/${ren.id}`, { nome: ren.nome, nomearDepois: false })
    setRen(null)
    const d = await api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`)
    setDet(d.data)
  }

  const criarAmbiente = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!novo || !novo.pavimentoId || !novo.nome.trim()) return
    const r = await api.post<{ data: { id: number } }>(`/pavimentos/${novo.pavimentoId}/ambientes`, {
      nome: novo.nome.trim(),
    })
    setNovo(null)
    const d = await api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`)
    setDet(d.data)
    setSelecionado(r.data.id)
  }

  // Fotos que chegaram sem ambiente → ambiente do último cartão (QR) antes delas.
  const separar = async () => {
    setSeparando(true)
    try {
      setSeparacao(await separarPorCartoes(id))
      await load()
    } finally {
      setSeparando(false)
    }
  }

  const semAmbiente = contagem.get(null) || 0

  return (
    <div className="flex gap-6">
      {/* Painel de ambientes */}
      <aside className="w-64 shrink-0">
        <div className="sticky top-0 space-y-3">
          <Link href={`/vistorias/${id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" /> Vistoria #{det.id}
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Conferência</h1>
            <p className="text-xs text-muted-foreground">
              1. Escolha o ambiente aqui. 2. Clique na primeira foto dele na fita — o resto se encaixa até a próxima
              fronteira.
            </p>
          </div>
          <div className="max-h-[60vh] space-y-2 overflow-auto rounded-md border p-2">
            <button
              onClick={() => setSelecionado(null)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                selecionado === null ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
            >
              <span className="h-3 w-3 rounded-full bg-gray-400" />
              <span className="flex-1">Sem ambiente</span>
              <span className="text-xs opacity-70">{semAmbiente}</span>
            </button>
            {det.pavimentos.map((p) => (
              <div key={p.id}>
                <p className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">{p.nome}</p>
                {p.ambientes.map((a) => (
                  <div key={a.id} className="group flex items-center">
                    <button
                      onClick={() => setSelecionado(a.id)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                        selecionado === a.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      } ${a.situacao === 'nao_existe' ? 'line-through opacity-50' : ''}`}
                    >
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: corPorAmbiente.get(a.id) }} />
                      <span className="flex-1 truncate">
                        {a.nome}
                        {a.nomearDepois ? ' *' : ''}
                      </span>
                      <span className="text-xs opacity-70">{contagem.get(a.id) || 0}</span>
                    </button>
                    <button
                      className="invisible p-1 text-muted-foreground hover:text-foreground group-hover:visible"
                      onClick={() => setRen({ id: a.id, nome: a.nome })}
                      title="Renomear"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setNovo({ pavimentoId: String(det.pavimentos[0]?.id || ''), nome: '' })}
          >
            <Plus className="h-4 w-4" /> Novo ambiente
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={separar}
            disabled={separando || alteradas.length > 0}
            title={
              alteradas.length > 0
                ? 'Salve os ajustes antes'
                : 'Coloca as fotos sem ambiente no ambiente do último cartão de claquete (QR) fotografado antes delas'
            }
          >
            <QrCode className="h-4 w-4" /> {separando ? 'Separando…' : 'Separar pelos cartões (QR)'}
          </Button>
          {separacao && <p className="text-xs text-muted-foreground">{resumoSeparacao(separacao)}</p>}
          <Button className="w-full" onClick={salvar} disabled={salvando || alteradas.length === 0}>
            <Save className="h-4 w-4" />
            {salvando ? 'Salvando…' : alteradas.length > 0 ? `Salvar (${alteradas.length})` : 'Tudo salvo'}
          </Button>
        </div>
      </aside>

      {/* Fita cronológica */}
      <div className="min-w-0 flex-1">
        <p className="mb-3 text-sm text-muted-foreground">
          {fotos.length} fotos na ordem do caminho · {semAmbiente} sem ambiente
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
          {fotos.map((f) => {
            const amb = efetivo[f.id]
            const cor = amb != null ? corPorAmbiente.get(amb) : '#9ca3af'
            const fronteira = f.id in fronteiras
            return (
              <div
                key={f.id}
                className="group relative cursor-pointer overflow-hidden rounded-md border bg-muted/30"
                onClick={() => marcarFronteira(f)}
                title={amb != null ? nomePorAmbiente.get(amb) : 'Sem ambiente'}
              >
                <div className="h-1.5 w-full" style={{ background: cor }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${apiUrl(`/fotos/${f.id}/thumb`)}?v=${versao}`}
                  alt={`Foto ${f.ordem}`}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
                <span className="absolute left-1 top-2.5 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                  {f.ordem}
                </span>
                {f.claquete && (
                  <span
                    className="absolute right-1 top-2.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-amber-300"
                    title={f.cartao ? 'Cartão de claquete lido pelo QR' : 'Claquete'}
                  >
                    {f.cartao ? 'QR' : 'C'}
                  </span>
                )}
                {f.destaque && (
                  <Star className="absolute right-1 top-8 h-3.5 w-3.5 fill-amber-400 text-amber-400 drop-shadow" />
                )}
                {f.temAnotacao && (
                  <span className="absolute right-1 top-14 rounded bg-primary px-1 text-[10px] font-semibold text-white" title="Com anotação">
                    A
                  </span>
                )}
                {fronteira && (
                  <span
                    className="absolute bottom-1 left-1 flex max-w-[85%] items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                    style={{ background: fronteiras[f.id] != null ? corPorAmbiente.get(fronteiras[f.id]!) : '#6b7280' }}
                  >
                    <span className="truncate">
                      {fronteiras[f.id] != null ? nomePorAmbiente.get(fronteiras[f.id]!) : 'Sem ambiente'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removerFronteira(f.id)
                      }}
                      title="Remover fronteira"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                <button
                  className="invisible absolute bottom-1 right-1 rounded bg-black/60 p-1 text-white group-hover:visible"
                  onClick={(e) => {
                    e.stopPropagation()
                    setZoom(f)
                  }}
                  title="Ampliar / editar foto"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zoom / edição de uma foto */}
      <Dialog
        open={!!zoom}
        onOpenChange={(o) => {
          if (!o) {
            setAnotando(false)
            setZoom(null)
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          {zoom && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Foto {zoom.ordem}
                  {zoom.capturadaEm ? ` · ${new Date(zoom.capturadaEm).toLocaleString('pt-BR')}` : ''}
                </DialogTitle>
              </DialogHeader>
              {anotando ? (
                <AnotarFoto
                  fotoId={zoom.id}
                  src={`${apiUrl(`/fotos/${zoom.id}/web`)}?v=${versao}`}
                  temAnotacao={!!zoom.temAnotacao}
                  onFechar={() => setAnotando(false)}
                  onSalvo={async () => {
                    setAnotando(false)
                    setVersao((v) => v + 1)
                    const f = await api.get<{ data: Foto[] }>(`/vistorias/${id}/fotos`)
                    setFotos(f.data)
                  }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${apiUrl(`/fotos/${zoom.id}/web`)}?v=${versao}`} alt={`Foto ${zoom.ordem}`} className="max-h-[60vh] w-full rounded object-contain" />
              )}
              {(zoom.latitude != null || zoom.capturadaEm) && !anotando && (
                <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {zoom.latitude != null && zoom.longitude != null && (
                    <a href={`https://www.google.com/maps?q=${zoom.latitude},${zoom.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      <MapPin className="h-3 w-3" /> {Number(zoom.latitude).toFixed(5)}, {Number(zoom.longitude).toFixed(5)}
                      {zoom.precisao ? ` (±${Math.round(zoom.precisao)} m)` : ''}
                    </a>
                  )}
                  {zoom.carimbada && <span>carimbada</span>}
                  {zoom.temAnotacao && <span>com anotação</span>}
                </p>
              )}
              {!anotando && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-48 flex-1 space-y-1.5">
                  <Label>Ambiente (só esta foto)</Label>
                  <select
                    className={SELECT_CLASS}
                    value={efetivo[zoom.id] ?? ''}
                    onChange={(e) => moverUma(zoom.id, e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">Sem ambiente</option>
                    {ambientes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.pavimentoNome} — {a.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={zoom.claquete} onChange={() => toggleFlag(zoom, 'claquete')} />
                  Claquete (abertura do ambiente)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={zoom.destaque} onChange={() => toggleFlag(zoom, 'destaque')} />
                  Destaque/patologia
                </label>
                <Button variant="outline" size="sm" onClick={() => setAnotando(true)}>
                  <PenLine className="h-4 w-4" /> {zoom.temAnotacao ? 'Editar anotação' : 'Anotar'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => excluirFoto(zoom)}>
                  <Trash2 className="h-4 w-4 text-destructive" /> Excluir
                </Button>
              </div>
              )}
              {!anotando && (
              <p className="text-xs text-muted-foreground">
                A troca de ambiente aqui vale só para esta foto e entra na lista do “Salvar”.
              </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Renomear ambiente */}
      <Dialog open={!!ren} onOpenChange={(o) => !o && setRen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear ambiente</DialogTitle>
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

      {/* Novo ambiente */}
      <Dialog open={!!novo} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo ambiente</DialogTitle>
          </DialogHeader>
          <form onSubmit={criarAmbiente} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Pavimento</Label>
              <select
                className={SELECT_CLASS}
                value={novo?.pavimentoId || ''}
                onChange={(e) => novo && setNovo({ ...novo, pavimentoId: e.target.value })}
                required
              >
                {det.pavimentos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={novo?.nome || ''} onChange={(e) => novo && setNovo({ ...novo, nome: e.target.value })} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovo(null)}>
                Cancelar
              </Button>
              <Button type="submit">Criar e selecionar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
