'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronLeft, ChevronRight, List } from 'lucide-react'

// Tour navegável: "andar o caminho" da vistoria no navegador — foto a foto, na
// ordem real em que foram tiradas, com o letreiro de onde se está
// (Térreo → Cozinha · foto 12 de 47), índice por ambiente e as setas.
interface Foto {
  id: number
  ambienteId: number
  legenda: string
  destaque: boolean
  capturadaEm: string | null
  ordem: number
}
interface Ambiente {
  id: number
  nome: string
  nota: string
  fotos: Foto[]
}
interface Pavimento {
  id: number
  nome: string
  ambientes: Ambiente[]
}

export default function TourPage() {
  const { token, vistoriaId } = useParams<{ token: string; vistoriaId: string }>()
  const [d, setD] = useState<{ vistoria: any; pavimentos: Pavimento[]; totalFotos: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [i, setI] = useState(0)
  const [indice, setIndice] = useState(false)
  const base = `/api/portal/${token}`
  const sessao = typeof window !== 'undefined' ? localStorage.getItem(`sj_portal_${token}`) || '' : ''
  const q = sessao ? `?sessao=${encodeURIComponent(sessao)}` : ''

  useEffect(() => {
    fetch(`${base}/vistorias/${vistoriaId}/tour`, { headers: sessao ? { 'X-Portal-Sessao': sessao } : {}, cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j?.message || 'Falha')
        setD(j.data)
      })
      .catch((e) => setErro(e.message))
  }, [base, vistoriaId, sessao])

  // Lista plana na ordem do caminho, com o pavimento/ambiente de cada foto.
  const passos = useMemo(() => {
    if (!d) return []
    const out: { foto: Foto; pavimento: string; ambiente: string; nota: string; indexNoAmb: number; totalNoAmb: number }[] = []
    for (const p of d.pavimentos) for (const a of p.ambientes) a.fotos.forEach((f, k) => out.push({ foto: f, pavimento: p.nome, ambiente: a.nome, nota: a.nota, indexNoAmb: k + 1, totalNoAmb: a.fotos.length }))
    return out
  }, [d])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, passos.length - 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [passos.length])

  if (erro) return <div className="p-6 text-sm text-destructive">{erro}</div>
  if (!d) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>
  if (!passos.length) return <div className="p-6 text-sm text-muted-foreground">Esta vistoria ainda não tem fotos organizadas por ambiente.</div>

  const atual = passos[i]
  const irPara = (ambId: number) => {
    const k = passos.findIndex((p) => p.foto.ambienteId === ambId)
    if (k >= 0) setI(k)
    setIndice(false)
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <header className="flex items-center gap-3 bg-black/80 px-4 py-3">
        <Link href={`/portal/${token}`} className="text-zinc-400 hover:text-white" aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs uppercase tracking-wide text-zinc-400">
            {d.vistoria.imovelNome}
            {d.vistoria.dataVistoria ? ` · ${String(d.vistoria.dataVistoria).split('-').reverse().join('/')}` : ''}
          </p>
          <p className="truncate font-semibold">
            {atual.pavimento} → {atual.ambiente} <span className="font-normal text-zinc-400">· foto {atual.indexNoAmb} de {atual.totalNoAmb}</span>
          </p>
        </div>
        <span className="text-xs text-zinc-400">
          {i + 1} / {passos.length}
        </span>
        <button onClick={() => setIndice((v) => !v)} className="rounded-md bg-zinc-800 p-2" aria-label="Índice">
          <List className="h-5 w-5" />
        </button>
      </header>
      <div className="h-1 w-full bg-zinc-800">
        <div className="h-full bg-white transition-all" style={{ width: `${((i + 1) / passos.length) * 100}%` }} />
      </div>

      <main className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}/fotos/${atual.foto.id}/web${q}`} alt={atual.ambiente} className="max-h-full max-w-full object-contain" />
        <button onClick={() => setI((x) => Math.max(x - 1, 0))} disabled={i === 0} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 disabled:opacity-20" aria-label="Anterior">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button onClick={() => setI((x) => Math.min(x + 1, passos.length - 1))} disabled={i === passos.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 disabled:opacity-20" aria-label="Próxima">
          <ChevronRight className="h-6 w-6" />
        </button>
        {(atual.foto.legenda || atual.nota) && (
          <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 text-sm">
            {atual.foto.legenda}
            {atual.nota && <span className="block text-xs text-zinc-300">{atual.nota}</span>}
          </p>
        )}
        {indice && (
          <div className="absolute inset-0 overflow-auto bg-black/90 p-4">
            {d.pavimentos.map((p) => (
              <div key={p.id} className="mb-4">
                <p className="mb-1 text-xs font-semibold uppercase text-zinc-400">{p.nome}</p>
                <div className="grid gap-1 sm:grid-cols-2 md:grid-cols-3">
                  {p.ambientes.map((a) => (
                    <button key={a.id} onClick={() => irPara(a.id)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${atual.foto.ambienteId === a.id ? 'bg-white text-black' : 'bg-zinc-800'}`}>
                      <span className="flex-1">{a.nome}</span>
                      <span className="text-xs opacity-60">{a.fotos.length}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
