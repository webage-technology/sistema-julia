'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Download, Eye, FileCheck, FileText, Image as ImagemIcon, Loader2, Plus, Printer, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { api, apiUrl, baixarBlob } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { Foto, Relatorio, SELECT_CLASS, VistoriaDetalhe, ambientesAchatados, useTiposServico } from '@/lib/vistorias'
import { ANOMALIA_LABEL, GRAU_COR, GRAU_LABEL, Laudo, ModeloLaudo, NaoConformidade, PRAZO_NC_LABEL, dataHora, tamanho } from '@/lib/regularizacao'
import { ehTecnico } from '@/lib/papeis'
import { Abas, abasDaVistoria } from '@/components/abas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// Relatório da vistoria — os modelos disponíveis para ESTA vistoria.
//
// Cada modelo tem sua área de edição (divergências no EVTL, não conformidades
// e fotos no LIP, checklist no de bombeiro, quadro de áreas no as-built e na
// regularização) e o mesmo bloco de EMISSÃO: prévia e "Emitir" geram o PDF
// numerado e versionado no servidor. No fim do bloco, qualquer modelo pode ser
// baixado como está — em PDF ou em Word (.docx) — para enviar ou ajustar o
// texto. O Relatório fotográfico continua tendo também seus documentos Word
// próprios (/relatorios/:id).
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

const MODELOS: { id: string; nome: string; descricao: string }[] = [
  { id: 'evtl', nome: 'EVTL — Estudo de Viabilidade Técnica e Legal', descricao: 'Divergências entre a planta aprovada e o levantamento, com foto da planta e foto atual, quadro de áreas e protocolos.' },
  { id: 'lip', nome: 'LIP — Laudo de Inspeção Predial', descricao: 'Não conformidades com grau de risco e recomendação (NBR 16747), checklist e registro fotográfico por ambiente.' },
  { id: 'fotografico', nome: 'Relatório fotográfico', descricao: 'Registro fotográfico por ambiente, numerado e legendado. Também vira documento Word editável.' },
  { id: 'bombeiro', nome: 'Laudo de bombeiro', descricao: 'Checklist de segurança contra incêndio, não conformidades e evidências fotográficas.' },
  { id: 'asbuilt', nome: 'As-built', descricao: 'Quadro de áreas medido em campo, divergências e registro por ambiente.' },
  { id: 'regularizacao', nome: 'Regularização', descricao: 'Quadro de áreas × aprovada × IPTU, divergências, checklist, histórico de protocolos e registro fotográfico.' },
]
const TEM_NC = ['lip', 'bombeiro', 'regularizacao']
const TEM_DIVERGENCIA = ['evtl', 'asbuilt', 'regularizacao']

export default function RelatorioPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)
  const [docs, setDocs] = useState<Relatorio[]>([])
  const [divs, setDivs] = useState<Divergencia[]>([])
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [fotos, setFotos] = useState<Foto[]>([])
  const [ncs, setNcs] = useState<NaoConformidade[]>([])
  const [laudos, setLaudos] = useState<Laudo[]>([])
  const [modelosPdf, setModelosPdf] = useState<ModeloLaudo[]>([])
  const [textos, setTextos] = useState<{ tipoServico: string; secao: string; texto: string }[]>([])
  const [me, setMe] = useState<{ role?: string } | null>(null)
  const [modelo, setModelo] = useParamEstado('modelo')
  const [escolhendo, setEscolhendo] = useParamEstado('foto') // "<divId>:planta" | "<divId>:atual" | "<ncId>:nc"
  const [redigindo, setRedigindo] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [lip, setLip] = useState<PavimentoLip[]>([])
  const [fonte, setFonte] = useState('')
  const [opcoes, setOpcoes] = useState({ titulo: '', fonte: '', fotosPorAmbiente: '0', incluirClaquetes: false, introducao: '', conclusao: '', observacoes: '' })
  const [emitindo, setEmitindo] = useState<'previa' | 'emitir' | null>(null)
  const [baixando, setBaixando] = useState<'pdf' | 'word' | null>(null)
  const [erroEmissao, setErroEmissao] = useState<string | null>(null)
  const tipos = useTiposServico()
  const modeloAtual = modelo || 'evtl'

  const carregar = useCallback(async () => {
    const [d, dv, f, l, r, n, la, mp, tx] = await Promise.all([
      api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`),
      api.get<{ data: { divergencias: Divergencia[]; sugestoes: Sugestao[] } }>(`/vistorias/${id}/divergencias`),
      api.get<{ data: Foto[] }>(`/vistorias/${id}/fotos`),
      api.get<{ data: { pavimentos: PavimentoLip[] } }>(`/vistorias/${id}/lip`),
      api.get<{ data: Relatorio[] }>(`/relatorios?vistoriaId=${id}`),
      api.get<{ data: NaoConformidade[] }>(`/vistorias/${id}/nao-conformidades`),
      api.get<{ data: Laudo[] }>(`/vistorias/${id}/laudos`),
      api.get<{ data: ModeloLaudo[] }>('/laudos/modelos'),
      api.get<{ data: any[] }>('/textos-padrao'),
    ])
    setDet(d.data)
    setDivs(dv.data.divergencias)
    setSugestoes(dv.data.sugestoes)
    setFotos(f.data)
    setLip(l.data.pavimentos)
    setDocs(r.data)
    setNcs(n.data)
    setLaudos(la.data)
    setModelosPdf(mp.data)
    setTextos(tx.data)
    setCarregando(false)
  }, [id])
  useEffect(() => {
    carregar()
    api.get<{ user: { role?: string } }>('/me').then((r) => setMe(r.user))
    api.get<{ data: { fonteFotos: string } }>('/escritorio').then((r) => setFonte(r.data.fonteFotos || '')).catch(() => {})
  }, [carregar])

  useTitulo(det ? `Relatório — vistoria #${det.id}` : 'Relatório')

  if (carregando || !det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const ambientes = ambientesAchatados(det.pavimentos)
  const tecnico = ehTecnico(me?.role)

  // ---- divergências (EVTL)
  const salvar = async (d: Divergencia, campos: Partial<Divergencia>) => {
    const r = await api.put<{ data: Divergencia[] }>(`/divergencias/${d.id}`, campos)
    setDivs(r.data)
  }
  const adicionar = async () => {
    const r = await api.post<{ data: { divergencias: Divergencia[] } }>(`/vistorias/${id}/divergencias`, { titulo: 'Nova divergência' })
    setDivs(r.data.divergencias)
  }
  const sugerir = async () => {
    const r = await api.post<{ data: { criadas: number; divergencias: Divergencia[] } }>(`/vistorias/${id}/divergencias/sugerir`, {})
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

  // ---- não conformidades (LIP)
  const salvarNc = async (n: NaoConformidade, campos: Partial<NaoConformidade>) => {
    const r = await api.put<{ data: NaoConformidade[] }>(`/nao-conformidades/${n.id}`, campos)
    setNcs(r.data)
  }
  const novaNc = async () => {
    const r = await api.post<{ data: { lista: NaoConformidade[] } }>(`/vistorias/${id}/nao-conformidades`, { titulo: '', anomalia: 'outro', grau: 'regular' })
    setNcs(r.data.lista)
  }
  const excluirNc = async (n: NaoConformidade) => {
    if (!confirm(`Excluir “${n.titulo || ANOMALIA_LABEL[n.anomalia]}”?`)) return
    const r = await api.del<{ data: NaoConformidade[] }>(`/nao-conformidades/${n.id}`)
    setNcs(r.data)
  }
  const redigirNc = async (n: NaoConformidade) => {
    setRedigindo(-n.id)
    try {
      const r = await api.post<{ data: { descricao: string; recomendacao: string } }>(`/nao-conformidades/${n.id}/texto`, {})
      await salvarNc(n, { descricao: r.data.descricao || n.descricao, recomendacao: r.data.recomendacao || n.recomendacao })
    } catch (err: any) {
      alert(err?.message || 'Falha ao redigir')
    } finally {
      setRedigindo(null)
    }
  }

  // ---- LIP: fotos marcadas
  const marcarLip = async (ids: number[], valor: boolean) => {
    if (!ids.length) return
    const alvo = new Set(ids)
    setLip((ps) => ps.map((p) => ({ ...p, ambientes: p.ambientes.map((a) => ({ ...a, fotos: a.fotos.map((f) => (alvo.has(f.id) ? { ...f, lip: valor } : f)) })) })))
    try {
      await api.post(`/vistorias/${id}/lip/fotos`, { ids, lip: valor })
    } catch {
      carregar()
    }
  }

  const criarFotografico = async () => {
    const r = await api.post<{ data: { id: number } }>(`/vistorias/${id}/relatorios`, { modelo: 'fotografico' })
    router.push(`/relatorios/${r.data.id}`)
  }

  // ---- seletor de foto (divergência ou NC)
  const escolherFoto = async (fotoId: number | null) => {
    if (!escolhendo) return
    const [alvoId, qual] = escolhendo.split(':')
    if (qual === 'nc') {
      const n = ncs.find((x) => String(x.id) === alvoId)
      if (n) await salvarNc(n, { fotoId })
    } else {
      const d = divs.find((x) => String(x.id) === alvoId)
      if (d) await salvar(d, qual === 'planta' ? { fotoPlantaId: fotoId } : { fotoAtualId: fotoId })
    }
    setEscolhendo(null)
  }
  const divEscolhendo = escolhendo ? divs.find((x) => String(x.id) === escolhendo.split(':')[0]) : null
  const ncEscolhendo = escolhendo?.endsWith(':nc') ? ncs.find((x) => String(x.id) === escolhendo.split(':')[0]) : null
  const querPlanta = escolhendo?.endsWith(':planta')
  const ambienteAlvo = ncEscolhendo?.ambienteId ?? divEscolhendo?.ambienteId ?? null
  const fotosOrdenadas = [...fotos].sort((a, b) => {
    const ambA = ambienteAlvo && a.ambienteId === ambienteAlvo ? 0 : 1
    const ambB = ambienteAlvo && b.ambienteId === ambienteAlvo ? 0 : 1
    if (ambA !== ambB) return ambA - ambB
    if (querPlanta && a.claquete !== b.claquete) return a.claquete ? -1 : 1
    if (!querPlanta && a.destaque !== b.destaque) return a.destaque ? -1 : 1
    return a.ordem - b.ordem
  })

  // ---- emissão do PDF
  const opcoesEnvio = () => ({
    ...opcoes,
    fonte: opcoes.fonte || fonte,
    fotosPorAmbiente: Number(opcoes.fotosPorAmbiente) || 0,
  })
  const previa = async () => {
    setEmitindo('previa')
    setErroEmissao(null)
    try {
      const blob = await api.blob(`/vistorias/${id}/laudos/previa`, { modelo: modeloAtual, opcoes: opcoesEnvio() })
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (err: any) {
      setErroEmissao(err?.message || 'Falha ao gerar a prévia')
    } finally {
      setEmitindo(null)
    }
  }
  // Baixar o laudo como está, sem emitir: PDF para mandar, Word para ajustar o
  // texto antes. Sai o mesmo conteúdo do modelo escolhido, com as opções acima.
  const baixar = async (formato: 'pdf' | 'word') => {
    setBaixando(formato)
    setErroEmissao(null)
    try {
      const rota = formato === 'pdf' ? `/vistorias/${id}/laudos/previa` : `/vistorias/${id}/laudos/docx`
      const blob = await api.blob(rota, { modelo: modeloAtual, opcoes: opcoesEnvio() })
      const nome = `${modeloAtual}-vistoria-${id}-${(det.imovelNome || '').replace(/[\\/:*?"<>|]/g, '-').trim()}`.replace(/-+$/, '')
      baixarBlob(blob, `${nome}.${formato === 'pdf' ? 'pdf' : 'docx'}`)
    } catch (err: any) {
      setErroEmissao(err?.message || 'Falha ao baixar o arquivo')
    } finally {
      setBaixando(null)
    }
  }
  const emitir = async () => {
    const ultimo = laudos.find((l) => l.modelo === modeloAtual)
    if (!confirm(ultimo ? `Emitir a versão ${ultimo.versao + 1} de ${ultimo.numero}? A anterior continua guardada.` : 'Emitir o laudo? Ele recebe número oficial e fica congelado como versão 1.')) return
    setEmitindo('emitir')
    setErroEmissao(null)
    try {
      const r = await api.post<{ data: Laudo }>(`/vistorias/${id}/laudos`, { modelo: modeloAtual, opcoes: opcoesEnvio() })
      setLaudos((l) => [r.data, ...l])
      window.open(apiUrl(`/laudos/${r.data.id}/pdf`), '_blank')
    } catch (err: any) {
      setErroEmissao(err?.message || 'Falha ao emitir')
    } finally {
      setEmitindo(null)
    }
  }
  const textoPadrao = (secao: string) => {
    const tipo = String(det.tipoServico || '').toLowerCase()
    const m = MODELOS.find((x) => x.id === modeloAtual)?.nome.toLowerCase() || ''
    return textos.find((t) => t.secao === secao && t.tipoServico && (t.tipoServico.toLowerCase() === tipo || t.tipoServico.toLowerCase() === m))?.texto || textos.find((t) => t.secao === secao && !t.tipoServico)?.texto || ''
  }
  const emissoes = laudos.filter((l) => l.modelo === modeloAtual)

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
            {det.processoNumero && (
              <>
                {' · '}
                <Link href={`/processos/${det.processoId}`} className="text-primary hover:underline">
                  {det.processoNumero}
                </Link>
              </>
            )}
          </p>
        </div>
        <span className="flex gap-2 print:hidden">
          <Link href={`/relatorios?vistoria=${id}`}>
            <Button variant="outline">
              <FileText className="h-4 w-4" /> Relatórios desta vistoria
            </Button>
          </Link>
          {modeloAtual === 'evtl' && (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
          )}
        </span>
      </div>

      {/* Tipo da vistoria e modelo do relatório */}
      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tipo de vistoria e modelo do laudo</CardTitle>
          <CardDescription>O tipo define o checklist, os documentos e o texto padrão. Todo modelo sai em PDF numerado e, no fim da página, também em PDF ou Word para baixar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {tipos.map((t) => (
              <button
                key={t}
                onClick={async () => {
                  await api.put(`/vistorias/${id}`, { tipoServico: t })
                  carregar()
                }}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${det.tipoServico === t ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODELOS.map((m) => {
              const n = laudos.filter((l) => l.modelo === m.id).length
              return (
                <button key={m.id} onClick={() => setModelo(m.id === 'evtl' ? null : m.id)} className={`rounded-md border p-3 text-left text-sm transition-colors ${modeloAtual === m.id ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent'}`}>
                  <span className="flex items-center gap-2 font-medium">
                    <FileText className="h-4 w-4" /> {m.nome}
                    {n > 0 && <span className="ml-auto rounded bg-muted px-1.5 text-[10px]">{n} emitido(s)</span>}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{m.descricao}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Cabeçalho impresso (EVTL pela impressão do navegador) */}
      {modeloAtual === 'evtl' && (
        <div className="hidden print:block">
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
      )}

      {/* ---- Divergências (EVTL, as-built, regularização) */}
      {TEM_DIVERGENCIA.includes(modeloAtual) && (
        <Card className="print:border-0 print:shadow-none">
          <CardHeader className="pb-3 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Divergências entre planta e realidade</CardTitle>
                <CardDescription>
                  Cada item sai no laudo com a foto da planta à esquerda e a foto atual à direita. O{' '}
                  <Link href={`/vistorias/${id}?aba=areas`} className="text-primary hover:underline">
                    quadro de áreas
                  </Link>{' '}
                  entra sozinho quando há medidas.
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
                Nenhuma divergência no relatório. {sugestoes.length > 0 ? `A vistoria já aponta ${sugestoes.length} — use “Trazer da vistoria”.` : 'Use “Divergência” para incluir manualmente.'}
              </p>
            )}
            {divs.map((d, i) => (
              <div key={d.id} className="break-inside-avoid rounded-md border p-3 print:border-0 print:p-0 print:pb-6">
                <div className="mb-2 flex flex-wrap items-start gap-2">
                  <span className="mt-2 text-sm font-semibold">{i + 1}.</span>
                  <Input className="min-w-56 flex-1 font-medium print:border-0 print:px-0 print:text-base print:font-bold" defaultValue={d.titulo} onBlur={(e) => e.target.value !== d.titulo && salvar(d, { titulo: e.target.value })} />
                  <select className={`${SELECT_CLASS} w-auto print:hidden`} value={d.ambienteId ?? ''} onChange={(e) => salvar(d, { ambienteId: e.target.value ? Number(e.target.value) : null } as any)}>
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
                      <p className="mb-1 text-xs font-medium text-muted-foreground">{qual === 'planta' ? 'Planta aprovada' : 'Situação atual (vistoria)'}</p>
                      <button onClick={() => setEscolhendo(`${d.id}:${qual}`)} className="h-44 w-full overflow-hidden rounded border bg-muted/30 print:h-56 print:cursor-default">
                        <Miniatura fotoId={qual === 'planta' ? d.fotoPlantaId : d.fotoAtualId} vazio={qual === 'planta' ? 'escolher foto da planta' : 'escolher foto atual'} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm print:border-0 print:px-0" defaultValue={d.descricao} placeholder="Descrição técnica da divergência" onBlur={(e) => e.target.value !== d.descricao && salvar(d, { descricao: e.target.value })} />
                  <Button variant="ghost" size="sm" className="print:hidden" disabled={redigindo === d.id} onClick={() => redigir(d)}>
                    {redigindo === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {redigindo === d.id ? 'Redigindo…' : 'Escrever com a IA'}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---- Não conformidades (LIP, bombeiro, regularização) */}
      {TEM_NC.includes(modeloAtual) && (
        <Card className="print:hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Não conformidades</CardTitle>
                <CardDescription>Anomalia, grau de risco, recomendação e prazo (NBR 16747), com a foto que evidencia. É o que faz o laudo sair quase pronto.</CardDescription>
              </div>
              <Button size="sm" onClick={novaNc}>
                <Plus className="h-4 w-4" /> Não conformidade
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {ncs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma ainda. Dica: as fotos marcadas como <strong>destaque</strong> na captura são as candidatas — abra uma não conformidade e escolha a foto.
              </p>
            )}
            {ncs.map((n, i) => (
              <div key={n.id} className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{i + 1}.</span>
                  <Input className="min-w-48 flex-1 font-medium" defaultValue={n.titulo} placeholder="Título (ex.: Fissura na viga do hall)" onBlur={(e) => e.target.value !== n.titulo && salvarNc(n, { titulo: e.target.value })} />
                  <select className={`${SELECT_CLASS} w-auto`} value={n.anomalia} onChange={(e) => salvarNc(n, { anomalia: e.target.value })}>
                    {Object.entries(ANOMALIA_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select className={`${SELECT_CLASS} w-auto ${GRAU_COR[n.grau]}`} value={n.grau} onChange={(e) => salvarNc(n, { grau: e.target.value })}>
                    {Object.entries(GRAU_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        Risco {v.toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <select className={`${SELECT_CLASS} w-auto`} value={n.prazo} onChange={(e) => salvarNc(n, { prazo: e.target.value })}>
                    {Object.entries(PRAZO_NC_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select className={`${SELECT_CLASS} w-auto`} value={n.ambienteId ?? ''} onChange={(e) => salvarNc(n, { ambienteId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Sem ambiente</option>
                    {ambientes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.pavimentoNome} — {a.nome}
                      </option>
                    ))}
                  </select>
                  <Button variant="ghost" size="icon" onClick={() => excluirNc(n)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                  <button onClick={() => setEscolhendo(`${n.id}:nc`)} className="h-36 overflow-hidden rounded border bg-muted/30">
                    <Miniatura fotoId={n.fotoId} vazio="escolher foto" />
                  </button>
                  <div className="space-y-2">
                    <textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue={n.descricao} placeholder="Descrição da anomalia observada" onBlur={(e) => e.target.value !== n.descricao && salvarNc(n, { descricao: e.target.value })} />
                    <textarea className="min-h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue={n.recomendacao} placeholder="Recomendação" onBlur={(e) => e.target.value !== n.recomendacao && salvarNc(n, { recomendacao: e.target.value })} />
                    <Button variant="ghost" size="sm" disabled={redigindo === -n.id} onClick={() => redigirNc(n)}>
                      {redigindo === -n.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      {redigindo === -n.id ? 'Redigindo…' : 'Escrever com a IA'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---- Checklist (bombeiro, regularização): atalho */}
      {(modeloAtual === 'bombeiro' || modeloAtual === 'regularizacao') && (
        <Card className="print:hidden">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="flex-1 text-muted-foreground">O checklist de {modeloAtual === 'bombeiro' ? 'segurança contra incêndio' : 'regularização'} é marcado na vistoria (também pelo celular) e entra no PDF como tabela, com as evidências dos itens não conformes.</span>
            <Link href={`/vistorias/${id}?aba=checklist`}>
              <Button variant="outline" size="sm">
                <Check className="h-4 w-4" /> Abrir checklist
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* ---- LIP: fotos marcadas */}
      {modeloAtual === 'lip' && <LipSelecao pavimentos={lip} fonte={opcoes.fonte || fonte} onFonte={(v) => setOpcoes({ ...opcoes, fonte: v })} onMarcar={marcarLip} href={(f) => apiUrl(`/vistorias/${id}/lip/docx?fonte=${encodeURIComponent(f)}`)} />}

      {/* ---- Fotográfico: documentos Word */}
      {modeloAtual === 'fotografico' && (
        <Card className="print:hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Relatórios fotográficos em Word desta vistoria</CardTitle>
                <CardDescription>Cada um é um documento próprio (capa, texto livre e recorte de fotos). O PDF abaixo usa todas as fotos dos ambientes, ou o recorte de um destes documentos.</CardDescription>
              </div>
              <Button size="sm" onClick={criarFotografico}>
                <Plus className="h-4 w-4" /> Novo documento Word
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum documento Word ainda.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {docs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/relatorios/${r.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 font-medium">{r.titulo}</span>
                      <span className="text-xs text-muted-foreground">{r.fotosIncluidas} fotos</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Emissão do PDF (todos os modelos) */}
      <Card className="border-zinc-900 print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck className="h-4 w-4" /> Emitir laudo em PDF — {modelosPdf.find((m) => m.id === modeloAtual)?.label || modeloAtual}
          </CardTitle>
          <CardDescription>
            Capa com o timbre, identificação, textos padrão, as seções deste modelo, conclusão e responsabilidade técnica. A prévia não guarda nada; “Emitir” gera o número oficial ({modelosPdf.find((m) => m.id === modeloAtual)?.prefixo}-{new Date().getFullYear()}-NNN) e congela a versão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label>Subtítulo na capa (opcional)</Label>
              <Input value={opcoes.titulo} onChange={(e) => setOpcoes({ ...opcoes, titulo: e.target.value })} placeholder="Ex.: Regularização do galpão — 2ª etapa" />
            </div>
            <div className="space-y-1.5">
              <Label>Fonte das fotos</Label>
              <Input value={opcoes.fonte} onChange={(e) => setOpcoes({ ...opcoes, fonte: e.target.value })} placeholder={fonte || 'Escritório'} />
            </div>
            <div className="space-y-1.5">
              <Label>Fotos por ambiente (0 = todas)</Label>
              <Input type="number" min={0} value={opcoes.fotosPorAmbiente} onChange={(e) => setOpcoes({ ...opcoes, fotosPorAmbiente: e.target.value })} />
            </div>
            {modeloAtual === 'fotografico' && docs.length > 0 && (
              <div className="space-y-1.5 lg:col-span-2">
                <Label>Recorte de fotos</Label>
                <select className={SELECT_CLASS} value={(opcoes as any).relatorioId || ''} onChange={(e) => setOpcoes({ ...opcoes, relatorioId: e.target.value ? Number(e.target.value) : undefined } as any)}>
                  <option value="">Todas as fotos dos ambientes</option>
                  {docs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.titulo} ({r.fotosIncluidas} fotos)
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={opcoes.incluirClaquetes} onChange={(e) => setOpcoes({ ...opcoes, incluirClaquetes: e.target.checked })} /> Incluir claquetes
            </label>
          </div>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">Textos deste laudo (deixe em branco para usar o padrão do tipo)</summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Objetivo / introdução</Label>
                <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={opcoes.introducao} placeholder={textoPadrao('introducao')} onChange={(e) => setOpcoes({ ...opcoes, introducao: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Conclusão</Label>
                <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={opcoes.conclusao} placeholder={textoPadrao('conclusao')} onChange={(e) => setOpcoes({ ...opcoes, conclusao: e.target.value })} />
              </div>
              <div className="space-y-1.5 lg:col-span-2">
                <Label>Observações</Label>
                <textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={opcoes.observacoes} onChange={(e) => setOpcoes({ ...opcoes, observacoes: e.target.value })} />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Os textos padrão por tipo de serviço ficam em{' '}
              <Link href="/configuracoes?aba=textos" className="text-primary hover:underline">
                Configurações → Textos padrão
              </Link>
              .
            </p>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={previa} disabled={!!emitindo}>
              {emitindo === 'previa' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Prévia (abre o PDF)
            </Button>
            {tecnico && (
              <Button onClick={emitir} disabled={!!emitindo}>
                {emitindo === 'emitir' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
                {emissoes.length ? `Emitir versão ${emissoes[0].versao + 1}` : 'Emitir versão 1'}
              </Button>
            )}
            {!det.responsavelNome && <span className="text-xs text-muted-foreground">Defina o profissional responsável na vistoria para o laudo sair assinado.</span>}
          </div>

          {/* Baixar o relatório pronto: PDF para enviar, Word para editar. */}
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="mb-2 text-sm font-medium">Baixar este relatório</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => baixar('pdf')} disabled={!!baixando || !!emitindo}>
                {baixando === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF (.pdf)
              </Button>
              <Button variant="outline" onClick={() => baixar('word')} disabled={!!baixando || !!emitindo}>
                {baixando === 'word' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Word (.docx)
              </Button>
              <span className="text-xs text-muted-foreground">
                O mesmo conteúdo do modelo {modelosPdf.find((m) => m.id === modeloAtual)?.label || modeloAtual}, com as opções acima. O Word é para
                ajustar o texto; o PDF oficial, numerado e versionado, é o de “Emitir”.
              </span>
            </div>
          </div>
          {erroEmissao && <p className="text-sm text-destructive">{erroEmissao}</p>}
          {emissoes.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {emissoes.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-mono text-xs">
                    {l.numero} v{l.versao}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {dataHora(l.emitidoEm)} · {l.emitidoPorNome} · {l.paginas} páginas · {tamanho(l.tamanho)}
                    {l.temAssinado ? ' · assinado' : ''}
                    {l.aprovadoEm ? ' · aprovado pelo cliente' : ''}
                  </span>
                  <a href={apiUrl(`/laudos/${l.id}/pdf`)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    abrir
                  </a>
                  <a href={apiUrl(`/laudos/${l.id}/pdf?download=1`)} className="text-primary hover:underline">
                    <Download className="inline h-4 w-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            A assinatura digital (gov.br / ICP-Brasil) é feita fora do sistema; o PDF assinado volta pela área de{' '}
            <Link href="/relatorios?aba=emitidos" className="text-primary hover:underline">
              Laudos emitidos
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      {/* Seletor de foto */}
      <Dialog open={!!escolhendo} onOpenChange={(o) => !o && setEscolhendo(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{ncEscolhendo ? 'Foto da não conformidade' : querPlanta ? 'Foto da planta' : 'Foto atual'}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {ncEscolhendo ? 'As fotos marcadas como destaque vêm primeiro.' : querPlanta ? 'As claquetes (marcadas com C) costumam ser a foto da planta apontando o ambiente.' : 'Escolha a foto que evidencia a situação encontrada.'}
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {fotosOrdenadas.map((f) => (
              <button key={f.id} onClick={() => escolherFoto(f.id)} className="relative overflow-hidden rounded border hover:ring-2 hover:ring-primary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={apiUrl(`/fotos/${f.id}/thumb`)} alt={`Foto ${f.ordem}`} className="aspect-[4/3] w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{f.ordem}</span>
                {f.claquete && <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-amber-300">C</span>}
                {f.destaque && <span className="absolute bottom-1 right-1 rounded bg-amber-400 px-1 text-[10px] font-semibold text-black">★</span>}
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

// Escolha das fotos do LIP (também usadas no PDF do LIP). A ordem é a do
// documento: ambientes numerados corridos e, dentro de cada um, a ordem do caminho.
function LipSelecao({ pavimentos, fonte, onFonte, onMarcar, href }: { pavimentos: PavimentoLip[]; fonte: string; onFonte: (v: string) => void; onMarcar: (ids: number[], valor: boolean) => void; href: (fonte: string) => string }) {
  const todas = pavimentos.flatMap((p) => p.ambientes.flatMap((a) => a.fotos))
  const marcadas = todas.filter((f) => f.lip)
  const numeroDaImagem = new Map<number, number>()
  let n = 0
  for (const f of todas) if (f.lip) numeroDaImagem.set(f.id, ++n)

  return (
    <Card className="print:hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fotos do laudo, por ambiente</CardTitle>
        <CardDescription>As fotos marcadas entram no PDF e no Word do LIP, numeradas e legendadas. Cada ambiente ganha sua seção; as não conformidades acima saem com foto, grau de risco e recomendação.</CardDescription>
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
            <Button variant="outline" disabled={!marcadas.length}>
              <Download className="h-4 w-4" /> Word (.docx)
            </Button>
          </a>
        </div>
        {pavimentos.length === 0 && <p className="text-sm text-muted-foreground">Esta vistoria ainda não tem ambientes com fotos. Faça a conferência para ligar as fotos aos ambientes.</p>}
        {pavimentos.map((p) => (
          <div key={p.id} className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{p.nome}</p>
            {p.ambientes.map((a) => {
              const doAmbiente = a.fotos.filter((f) => f.lip)
              const todasMarcadas = a.fotos.length > 0 && doAmbiente.length === a.fotos.length
              return (
                <div key={a.id} className="rounded-md border">
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                    <span className="flex h-6 min-w-6 items-center justify-center rounded bg-zinc-900 px-1.5 text-xs font-bold text-white">{a.numero}</span>
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
                    <p className="px-3 py-2 text-xs text-muted-foreground">Sem foto — o ambiente sai no laudo com a nota “não foi possível realizar registro fotográfico”.</p>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 p-3">
                      {a.fotos.map((f) => (
                        <button key={f.id} onClick={() => onMarcar([f.id], !f.lip)} title={f.lip ? 'Tirar do laudo' : 'Incluir no laudo'} className={`relative overflow-hidden rounded border-2 transition-opacity ${f.lip ? 'border-primary' : 'border-transparent opacity-40 hover:opacity-75'}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={apiUrl(`/fotos/${f.id}/thumb`)} alt={a.nome} className="aspect-[4/3] w-full object-cover" />
                          {f.lip && <span className="absolute inset-x-0 bottom-0 bg-primary/90 text-[10px] font-semibold text-white">Imagem {String(numeroDaImagem.get(f.id)).padStart(2, '0')}</span>}
                          {f.lip && (
                            <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-white">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                          {f.claquete && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-amber-300">C</span>}
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
