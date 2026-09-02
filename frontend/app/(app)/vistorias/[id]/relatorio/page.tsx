'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, Download, FileText, Image as ImagemIcon, Loader2, Plus, Printer, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { Foto, SELECT_CLASS, TIPOS_SERVICO, VistoriaDetalhe, ambientesAchatados } from '@/lib/vistorias'
import { Abas, abasDaVistoria } from '@/components/abas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// Relatório da vistoria. Hoje há um modelo — o EVTL, que apresenta as
// divergências entre a planta aprovada e o que existe no local, cada uma com a
// foto da planta ao lado da foto atual. Outros modelos entram aqui depois.
interface Divergencia {
  id: number
  ambienteId: number | null
  titulo: string
  descricao: string
  fotoPlantaId: number | null
  fotoAtualId: number | null
  ordem: number
  ambienteNome: string | null
  pavimentoNome: string | null
  origem: string | null
  situacao: string | null
}

interface Sugestao {
  id: number
  nome: string
  pavimentoNome: string
  origem: string
  situacao: string
}

// Uma foto do LIP, dentro da árvore pavimento → ambiente.
interface FotoLip {
  id: number
  claquete: boolean
  destaque: boolean
  lip: boolean
}
interface AmbienteLip {
  id: number
  nome: string
  numero: number
  fotos: FotoLip[]
}
interface PavimentoLip {
  id: number
  nome: string
  ambientes: AmbienteLip[]
}

const MODELOS = [
  {
    id: 'evtl',
    nome: 'EVTL — Estudo de Viabilidade Técnica e Legal',
    descricao: 'Divergências entre a planta aprovada e o levantamento em campo, com foto da planta e foto atual.',
    pronto: true,
  },
  {
    id: 'lip',
    nome: 'LIP — Laudo de Inspeção Predial',
    descricao: 'Word separado por ambiente, com as fotos escolhidas numeradas e legendadas para o arquiteto completar.',
    pronto: true,
  },
  { id: 'bombeiro', nome: 'Laudo de bombeiro', descricao: 'Em breve.', pronto: false },
  { id: 'asbuilt', nome: 'As-built', descricao: 'Em breve.', pronto: false },
]

export default function RelatorioPage() {
  const { id } = useParams<{ id: string }>()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)
  const [divs, setDivs] = useState<Divergencia[]>([])
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [fotos, setFotos] = useState<Foto[]>([])
  const [modelo, setModelo] = useParamEstado('modelo')
  const [escolhendo, setEscolhendo] = useParamEstado('foto') // "<divId>:planta" | "<divId>:atual"
  const [redigindo, setRedigindo] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [lip, setLip] = useState<PavimentoLip[]>([])
  const [fonte, setFonte] = useState('Plenno Arquitetura')
  const modeloAtual = modelo || 'evtl'

  const carregar = useCallback(async () => {
    const [d, dv, f, l] = await Promise.all([
      api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`),
      api.get<{ data: { divergencias: Divergencia[]; sugestoes: Sugestao[] } }>(`/vistorias/${id}/divergencias`),
      api.get<{ data: Foto[] }>(`/vistorias/${id}/fotos`),
      api.get<{ data: { pavimentos: PavimentoLip[] } }>(`/vistorias/${id}/lip`),
    ])
    setDet(d.data)
    setDivs(dv.data.divergencias)
    setSugestoes(dv.data.sugestoes)
    setFotos(f.data)
    setLip(l.data.pavimentos)
    setCarregando(false)
  }, [id])
  useEffect(() => {
    carregar()
  }, [carregar])

  useTitulo(det ? `Relatório — vistoria #${det.id}` : 'Relatório')

  if (carregando || !det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const ambientes = ambientesAchatados(det.pavimentos)

  const salvar = async (d: Divergencia, campos: Partial<Divergencia>) => {
    const r = await api.put<{ data: Divergencia[] }>(`/divergencias/${d.id}`, campos)
    setDivs(r.data)
  }

  const adicionar = async () => {
    const r = await api.post<{ data: { divergencias: Divergencia[] } }>(`/vistorias/${id}/divergencias`, {
      titulo: 'Nova divergência',
    })
    setDivs(r.data.divergencias)
  }

  const sugerir = async () => {
    const r = await api.post<{ data: { criadas: number; divergencias: Divergencia[] } }>(
      `/vistorias/${id}/divergencias/sugerir`,
      {}
    )
    setDivs(r.data.divergencias)
    setSugestoes([])
  }

  const excluir = async (d: Divergencia) => {
    if (!confirm(`Excluir “${d.titulo}” do relatório?`)) return
    const r = await api.del<{ data: Divergencia[] }>(`/divergencias/${d.id}`)
    setDivs(r.data)
  }

  const redigir = async (d: Divergencia) => {
    setRedigindo(d.id)
    try {
      const r = await api.post<{ data: { texto: string } }>(`/divergencias/${d.id}/texto`, {})
      await salvar(d, { descricao: r.data.texto })
    } catch (err: any) {
      alert(err?.message || 'Falha ao redigir')
    } finally {
      setRedigindo(null)
    }
  }

  // Marca/desmarca fotos do LIP. Otimista: a grade responde na hora e o servidor
  // recebe a lista inteira de uma vez (marcar um ambiente são ~8 fotos).
  const marcarLip = async (ids: number[], valor: boolean) => {
    if (!ids.length) return
    const alvo = new Set(ids)
    setLip((ps) =>
      ps.map((p) => ({
        ...p,
        ambientes: p.ambientes.map((a) => ({
          ...a,
          fotos: a.fotos.map((f) => (alvo.has(f.id) ? { ...f, lip: valor } : f)),
        })),
      }))
    )
    try {
      await api.post(`/vistorias/${id}/lip/fotos`, { ids, lip: valor })
    } catch {
      carregar() // servidor recusou: volta ao que ele tem
    }
  }

  const escolherFoto = async (fotoId: number | null) => {
    if (!escolhendo) return
    const [divId, qual] = escolhendo.split(':')
    const d = divs.find((x) => String(x.id) === divId)
    if (d) await salvar(d, qual === 'planta' ? { fotoPlantaId: fotoId } : { fotoAtualId: fotoId })
    setEscolhendo(null)
  }

  // No seletor, prioriza as fotos do ambiente da divergência.
  const divEscolhendo = escolhendo ? divs.find((x) => String(x.id) === escolhendo.split(':')[0]) : null
  const querPlanta = escolhendo?.endsWith(':planta')
  const fotosOrdenadas = [...fotos].sort((a, b) => {
    const ambA = divEscolhendo && a.ambienteId === divEscolhendo.ambienteId ? 0 : 1
    const ambB = divEscolhendo && b.ambienteId === divEscolhendo.ambienteId ? 0 : 1
    if (ambA !== ambB) return ambA - ambB
    if (querPlanta && a.claquete !== b.claquete) return a.claquete ? -1 : 1
    return a.ordem - b.ordem
  })

  const Miniatura = ({ fotoId, vazio }: { fotoId: number | null; vazio: string }) =>
    fotoId ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={apiUrl(`/fotos/${fotoId}/web`)} alt={vazio} className="h-full w-full object-contain" />
    ) : (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
        <ImagemIcon className="h-5 w-5" /> {vazio}
      </span>
    )

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="print:hidden">
        <Abas itens={abasDaVistoria(id)} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Relatório — {det.imovelNome}</h1>
          <p className="text-sm text-muted-foreground">
            {det.clienteNome} · vistoria #{det.id}
            {det.dataVistoria ? ` · ${det.dataVistoria.split('-').reverse().join('/')}` : ''}
            {det.responsavelNome ? ` · ${det.responsavelNome}` : ''}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()} className="print:hidden">
          <Printer className="h-4 w-4" /> Imprimir / PDF
        </Button>
      </div>

      {/* Tipo da vistoria e modelo do relatório */}
      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tipo de vistoria e modelo do relatório</CardTitle>
          <CardDescription>O tipo define qual relatório faz sentido. Hoje o EVTL está pronto.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {TIPOS_SERVICO.map((t) => (
              <button
                key={t}
                onClick={async () => {
                  await api.put(`/vistorias/${id}`, { tipoServico: t })
                  carregar()
                }}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  det.tipoServico === t ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODELOS.map((m) => (
              <button
                key={m.id}
                disabled={!m.pronto}
                onClick={() => setModelo(m.id === 'evtl' ? null : m.id)}
                className={`rounded-md border p-3 text-left text-sm transition-colors disabled:opacity-50 ${
                  modeloAtual === m.id ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent'
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <FileText className="h-4 w-4" /> {m.nome}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{m.descricao}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cabeçalho impresso */}
      <div className="hidden print:block" hidden={modeloAtual !== 'evtl'}>
        <h2 className="text-xl font-bold">EVTL — Estudo de Viabilidade Técnica e Legal</h2>
        <p className="text-sm">
          {det.imovelNome} · {det.clienteNome}
          {det.endereco ? ` · ${det.endereco}` : ''}
        </p>
        <p className="text-sm">
          Vistoria #{det.id}
          {det.dataVistoria ? ` · ${det.dataVistoria.split('-').reverse().join('/')}` : ''}
          {det.responsavelNome ? ` · Responsável: ${det.responsavelNome}` : ''}
        </p>
        <hr className="my-3" />
      </div>

      {/* Divergências — miolo do EVTL */}
      {modeloAtual === 'evtl' && (
      <Card className="print:border-0 print:shadow-none">
        <CardHeader className="pb-3 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Divergências entre planta e realidade</CardTitle>
              <CardDescription>
                Cada item sai no laudo com a foto da planta à esquerda e a foto atual à direita.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {sugestoes.length > 0 && (
                <Button size="sm" variant="outline" onClick={sugerir}>
                  <Sparkles className="h-4 w-4" /> Trazer {sugestoes.length} da vistoria
                </Button>
              )}
              <Button size="sm" onClick={adicionar}>
                <Plus className="h-4 w-4" /> Divergência
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {divs.length === 0 && (
            <p className="text-sm text-muted-foreground print:hidden">
              Nenhuma divergência no relatório.{' '}
              {sugestoes.length > 0
                ? `A vistoria já aponta ${sugestoes.length} — use “Trazer da vistoria”.`
                : 'Use “Divergência” para incluir manualmente.'}
            </p>
          )}

          {divs.map((d, i) => (
            <div key={d.id} className="break-inside-avoid rounded-md border p-3 print:border-0 print:p-0 print:pb-6">
              <div className="mb-2 flex flex-wrap items-start gap-2">
                <span className="mt-2 text-sm font-semibold">{i + 1}.</span>
                <Input
                  className="min-w-56 flex-1 font-medium print:border-0 print:px-0 print:text-base print:font-bold"
                  defaultValue={d.titulo}
                  onBlur={(e) => e.target.value !== d.titulo && salvar(d, { titulo: e.target.value })}
                />
                <select
                  className={`${SELECT_CLASS} w-auto print:hidden`}
                  value={d.ambienteId ?? ''}
                  onChange={(e) => salvar(d, { ambienteId: e.target.value ? Number(e.target.value) : null } as any)}
                >
                  <option value="">Sem ambiente</option>
                  {ambientes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.pavimentoNome} — {a.nome}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="icon" className="print:hidden" onClick={() => excluir(d)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {(['planta', 'atual'] as const).map((qual) => (
                  <div key={qual}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {qual === 'planta' ? 'Planta aprovada' : 'Situação atual (vistoria)'}
                    </p>
                    <button
                      onClick={() => setEscolhendo(`${d.id}:${qual}`)}
                      className="h-44 w-full overflow-hidden rounded border bg-muted/30 print:h-56 print:cursor-default"
                    >
                      <Miniatura
                        fotoId={qual === 'planta' ? d.fotoPlantaId : d.fotoAtualId}
                        vazio={qual === 'planta' ? 'escolher foto da planta' : 'escolher foto atual'}
                      />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2">
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm print:border-0 print:px-0"
                  defaultValue={d.descricao}
                  placeholder="Descrição técnica da divergência"
                  onBlur={(e) => e.target.value !== d.descricao && salvar(d, { descricao: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="print:hidden"
                  disabled={redigindo === d.id}
                  onClick={() => redigir(d)}
                >
                  {redigindo === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {redigindo === d.id ? 'Redigindo…' : 'Escrever com a IA'}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* LIP — escolha das fotos e geração do Word */}
      {modeloAtual === 'lip' && (
        <LipSelecao
          pavimentos={lip}
          fonte={fonte}
          onFonte={setFonte}
          onMarcar={marcarLip}
          href={(f) => apiUrl(`/vistorias/${id}/lip/docx?fonte=${encodeURIComponent(f)}`)}
        />
      )}

      {/* Seletor de foto */}
      <Dialog open={!!escolhendo} onOpenChange={(o) => !o && setEscolhendo(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{querPlanta ? 'Foto da planta' : 'Foto atual'}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {querPlanta
              ? 'As claquetes (marcadas com C) costumam ser a foto da planta apontando o ambiente.'
              : 'Escolha a foto que evidencia a situação encontrada.'}
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {fotosOrdenadas.map((f) => (
              <button
                key={f.id}
                onClick={() => escolherFoto(f.id)}
                className="relative overflow-hidden rounded border hover:ring-2 hover:ring-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={apiUrl(`/fotos/${f.id}/thumb`)} alt={`Foto ${f.ordem}`} className="aspect-[4/3] w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{f.ordem}</span>
                {f.claquete && (
                  <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-amber-300">
                    C
                  </span>
                )}
              </button>
            ))}
            {fotos.length === 0 && <p className="text-sm text-muted-foreground">Esta vistoria ainda não tem fotos.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => escolherFoto(null)}>
              Tirar foto do item
            </Button>
            <Button onClick={() => setEscolhendo(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Escolha das fotos do LIP. A ordem aqui é exatamente a do documento: ambientes
// numerados corridos (o número acompanha o "AMBIENTE N" do Word) e, dentro de
// cada um, as fotos na ordem do caminho. O "Imagem NN" mostrado na miniatura é o
// mesmo que vai sair na legenda — é assim que dá para conferir antes de gerar.
function LipSelecao({
  pavimentos,
  fonte,
  onFonte,
  onMarcar,
  href,
}: {
  pavimentos: PavimentoLip[]
  fonte: string
  onFonte: (v: string) => void
  onMarcar: (ids: number[], valor: boolean) => void
  href: (fonte: string) => string
}) {
  const todas = pavimentos.flatMap((p) => p.ambientes.flatMap((a) => a.fotos))
  const marcadas = todas.filter((f) => f.lip)
  const numeroDaImagem = new Map<number, number>()
  let n = 0
  for (const f of todas) if (f.lip) numeroDaImagem.set(f.id, ++n)

  return (
    <Card className="print:hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fotos do laudo, por ambiente</CardTitle>
        <CardDescription>
          O Word sai com um ambiente por página, numerado, e abaixo as fotos marcadas — cada uma legendada com o
          número da imagem, o nome do ambiente e a fonte. O estado do imóvel não entra: cada ambiente sai com uma
          linha em branco reservada para a sua análise.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/40 p-3">
          <div className="min-w-56 space-y-1.5">
            <Label>Fonte das fotos (legenda)</Label>
            <Input value={fonte} onChange={(e) => onFonte(e.target.value)} />
          </div>
          <p className="min-w-40 flex-1 text-sm text-muted-foreground">
            {marcadas.length} de {todas.length} fotos no laudo
          </p>
          <Button variant="outline" onClick={() => onMarcar(todas.map((f) => f.id), true)}>
            Marcar todas
          </Button>
          <Button variant="outline" onClick={() => onMarcar(todas.map((f) => f.id), false)}>
            Nenhuma
          </Button>
          <a href={marcadas.length ? href(fonte) : undefined}>
            <Button disabled={!marcadas.length}>
              <Download className="h-4 w-4" /> Baixar Word (.docx)
            </Button>
          </a>
        </div>

        {pavimentos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Esta vistoria ainda não tem ambientes com fotos. Faça a conferência para ligar as fotos aos ambientes.
          </p>
        )}

        {pavimentos.map((p) => (
          <div key={p.id} className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{p.nome}</p>
            {p.ambientes.map((a) => {
              const doAmbiente = a.fotos.filter((f) => f.lip)
              const todasMarcadas = a.fotos.length > 0 && doAmbiente.length === a.fotos.length
              return (
                <div key={a.id} className="rounded-md border">
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                    <span className="flex h-6 min-w-6 items-center justify-center rounded bg-zinc-900 px-1.5 text-xs font-bold text-white">
                      {a.numero}
                    </span>
                    <span className="flex-1 text-sm font-semibold">{a.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {doAmbiente.length}/{a.fotos.length} fotos
                    </span>
                    {a.fotos.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => onMarcar(a.fotos.map((f) => f.id), !todasMarcadas)}>
                        {todasMarcadas ? 'Desmarcar' : 'Marcar todas'}
                      </Button>
                    )}
                  </div>
                  {a.fotos.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Sem foto — o ambiente sai no laudo com a nota “não foi possível realizar registro fotográfico”.
                    </p>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 p-3">
                      {a.fotos.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => onMarcar([f.id], !f.lip)}
                          title={f.lip ? 'Tirar do laudo' : 'Incluir no laudo'}
                          className={`relative overflow-hidden rounded border-2 transition-opacity ${
                            f.lip ? 'border-primary' : 'border-transparent opacity-40 hover:opacity-75'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={apiUrl(`/fotos/${f.id}/thumb`)}
                            alt={a.nome}
                            className="aspect-[4/3] w-full object-cover"
                          />
                          {f.lip && (
                            <span className="absolute inset-x-0 bottom-0 bg-primary/90 text-[10px] font-semibold text-white">
                              Imagem {String(numeroDaImagem.get(f.id)).padStart(2, '0')}
                            </span>
                          )}
                          {f.lip && (
                            <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-white">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                          {f.claquete && (
                            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-amber-300">
                              C
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
