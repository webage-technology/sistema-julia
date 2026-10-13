'use client'

// Planta com pinos. A prancha rasterizada vira imagem; cada ambiente é um
// pino em coordenadas relativas (0..1), então funciona em qualquer tamanho de
// tela. Dois modos:
//   • editar (imóvel): escolhe-se o ambiente na lista e toca-se na planta para
//     colocar/mover o pino;
//   • navegar (captura, laudo): tocar no pino escolhe o ambiente.
import { useRef, useState } from 'react'
import { apiUrl } from '@/lib/api'
import { Pino } from '@/lib/regularizacao'

interface Props {
  imovelId: number
  pinos: Pino[]
  prancha: number
  pagina?: number
  modo: 'editar' | 'navegar'
  selecionado?: number | null
  onColocar?: (x: number, y: number) => void
  onEscolher?: (pino: Pino) => void
  className?: string
  escuro?: boolean
}

export function PlantaPinos({ imovelId, pinos, prancha, pagina = 1, modo, selecionado, onColocar, onEscolher, className, escuro }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [erro, setErro] = useState(false)
  const src = apiUrl(`/imoveis/${imovelId}/planta/imagem?arquivo=${prancha}&pagina=${pagina}`)

  const clique = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modo !== 'editar' || !onColocar || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    onColocar(Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000)
  }

  const iniciais = (nome: string) =>
    nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('')

  return (
    <div className={`relative inline-block max-w-full select-none ${className || ''}`}>
      <div ref={ref} className={`relative ${modo === 'editar' ? 'cursor-crosshair' : ''}`} onClick={clique}>
        {erro ? (
          <div className="flex h-48 w-full items-center justify-center rounded border bg-muted text-sm text-muted-foreground">Não consegui rasterizar esta prancha.</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Planta" className="block max-h-[70vh] w-auto max-w-full rounded border bg-white" draggable={false} onError={() => setErro(true)} />
        )}
        {!erro &&
          pinos
            .filter((p) => p.prancha === prancha)
            .map((p) => {
              const ativo = selecionado != null && p.ambienteId === selecionado
              return (
                <button
                  key={p.ambienteId}
                  type="button"
                  title={`${p.pavimentoNome ? `${p.pavimentoNome} — ` : ''}${p.nome}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (modo === 'navegar') onEscolher?.(p)
                    else onEscolher?.(p)
                  }}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-full transition-transform ${ativo ? 'z-20 scale-125' : 'z-10 hover:scale-110'}`}
                >
                  <span
                    className={`flex h-7 min-w-7 items-center justify-center rounded-full border-2 px-1 text-[10px] font-bold shadow ${
                      ativo ? 'border-white bg-primary text-primary-foreground' : escuro ? 'border-zinc-900 bg-white text-zinc-900' : 'border-white bg-zinc-900 text-white'
                    }`}
                  >
                    {iniciais(p.nome)}
                  </span>
                  <span className={`mx-auto block h-2 w-0.5 ${ativo ? 'bg-primary' : escuro ? 'bg-white' : 'bg-zinc-900'}`} />
                </button>
              )
            })}
      </div>
    </div>
  )
}
