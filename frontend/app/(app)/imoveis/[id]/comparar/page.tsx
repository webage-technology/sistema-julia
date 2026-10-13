'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, GitCompare } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS, STATUS_LABEL } from '@/lib/vistorias'
import { dia } from '@/lib/regularizacao'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

// Comparação entre duas vistorias do mesmo imóvel, ambiente a ambiente:
// levantamento × conclusão de obra, ou a atualização × a anterior.
interface Lado {
  id: number
  nome: string
  situacao: string
  origem: string
  nota: string
  areaCalculada: number
  peDireito: number | null
  fotos: number
  claqueteId: number | null
  fotoId: number | null
  naoConformidades: number
}
interface Linha {
  chave: string
  pavimentoNome: string
  nome: string
  situacao: 'igual' | 'alterado' | 'novo' | 'removido'
  mudancas: string[]
  a: Lado | null
  b: Lado | null
}

const COR: Record<string, string> = {
  igual: 'bg-muted text-muted-foreground',
  alterado: 'bg-zinc-900 text-white',
  novo: 'bg-primary text-primary-foreground',
  removido: 'bg-primary/10 text-primary ring-1 ring-primary/30',
}
const LABEL: Record<string, string> = { igual: 'Igual', alterado: 'Alterado', novo: 'Novo', removido: 'Não existe mais' }

export default function CompararPage() {
  const { id } = useParams<{ id: string }>()
  const [a, setA] = useParamEstado('a')
  const [b, setB] = useParamEstado('b')
  const [d, setD] = useState<{ vistorias: any[]; comparacao: { linhas: Linha[]; resumo: any } | null } | null>(null)
  const [filtro, setFiltro] = useState('')
  useTitulo('Comparar vistorias')

  useEffect(() => {
    api.get<{ data: any }>(`/imoveis/${id}/comparar?a=${a || ''}&b=${b || ''}`).then((r) => setD(r.data))
  }, [id, a, b])

  if (!d) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const opcao = (v: any) => `#${v.id} · ${v.tipoServico || 'vistoria'}${v.dataVistoria ? ` · ${dia(v.dataVistoria)}` : ''} · ${v.fotos} fotos · ${STATUS_LABEL[v.status] || v.status}`
  const c = d.comparacao
  const linhas = c ? c.linhas.filter((l) => !filtro || l.situacao === filtro) : []

  const Mini = ({ lado }: { lado: Lado | null }) =>
    lado ? (
      <div className="flex gap-1">
        {[lado.claqueteId, lado.fotoId].filter(Boolean).map((fid) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={fid} src={apiUrl(`/fotos/${fid}/thumb`)} alt="" className="h-14 w-20 rounded border object-cover" />
        ))}
        {!lado.claqueteId && !lado.fotoId && <span className="text-xs text-muted-foreground">sem foto</span>}
      </div>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    )

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href={`/imoveis/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Imóvel
      </Link>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <GitCompare className="h-6 w-6" /> Comparar vistorias
        </h1>
        <p className="text-sm text-muted-foreground">Ambiente a ambiente: o que apareceu, o que sumiu, o que mudou de área ou ganhou não conformidade entre duas idas ao mesmo imóvel.</p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase text-muted-foreground">A — antes</p>
            <select className={SELECT_CLASS} value={a || ''} onChange={(e) => setA(e.target.value || null)}>
              <option value="">Escolha…</option>
              {d.vistorias.map((v) => (
                <option key={v.id} value={v.id}>
                  {opcao(v)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase text-muted-foreground">B — depois</p>
            <select className={SELECT_CLASS} value={b || ''} onChange={(e) => setB(e.target.value || null)}>
              <option value="">Escolha…</option>
              {d.vistorias.map((v) => (
                <option key={v.id} value={v.id}>
                  {opcao(v)}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {d.vistorias.length < 2 && <p className="text-sm text-muted-foreground">Este imóvel tem menos de duas vistorias — não há o que comparar ainda.</p>}

      {c && (
        <>
          <div className="flex flex-wrap gap-2">
            {(['igual', 'alterado', 'novo', 'removido'] as const).map((s) => (
              <button key={s} onClick={() => setFiltro(filtro === s ? '' : s)} className={`rounded-full px-3 py-1 text-xs ${COR[s]} ${filtro && filtro !== s ? 'opacity-40' : ''}`}>
                {c.resumo[s === 'igual' ? 'iguais' : s === 'alterado' ? 'alterados' : s === 'novo' ? 'novos' : 'removidos']} {LABEL[s]}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              Área levantada: {c.resumo.areaA.toFixed(2)} m² → {c.resumo.areaB.toFixed(2)} m²
            </span>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ambientes</CardTitle>
              <CardDescription>Claquete e uma foto de cada lado. Clique no número da vistoria para abrir.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-2">Ambiente</th>
                      <th className="py-2 pr-2">Situação</th>
                      <th className="py-2 pr-2">
                        <Link href={`/vistorias/${a}`} className="hover:underline">
                          A · #{a}
                        </Link>
                      </th>
                      <th className="py-2 pr-2">
                        <Link href={`/vistorias/${b}`} className="hover:underline">
                          B · #{b}
                        </Link>
                      </th>
                      <th className="py-2">O que mudou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.chave} className="border-b align-top">
                        <td className="py-2 pr-2">
                          <span className="font-medium">{l.nome}</span>
                          <span className="block text-xs text-muted-foreground">{l.pavimentoNome}</span>
                        </td>
                        <td className="py-2 pr-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${COR[l.situacao]}`}>{LABEL[l.situacao]}</span>
                        </td>
                        <td className="py-2 pr-2">
                          <Mini lado={l.a} />
                          {l.a && (
                            <span className="block text-xs text-muted-foreground">
                              {l.a.fotos} fotos{l.a.areaCalculada ? ` · ${l.a.areaCalculada.toFixed(2)} m²` : ''}
                              {l.a.naoConformidades ? ` · ${l.a.naoConformidades} NC` : ''}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          <Mini lado={l.b} />
                          {l.b && (
                            <span className="block text-xs text-muted-foreground">
                              {l.b.fotos} fotos{l.b.areaCalculada ? ` · ${l.b.areaCalculada.toFixed(2)} m²` : ''}
                              {l.b.naoConformidades ? ` · ${l.b.naoConformidades} NC` : ''}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-xs">
                          {l.mudancas.length ? l.mudancas.join(' · ') : l.situacao === 'novo' ? 'Não existia na vistoria A' : l.situacao === 'removido' ? 'Não aparece na vistoria B' : '—'}
                          {l.b?.nota && <span className="block text-muted-foreground">Nota B: {l.b.nota}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
