'use client'

// Anotação sobre a foto: setas, círculos e traços em vermelho, desenhados na
// conferência. Os traços ficam em coordenadas relativas (0..1) e, ao salvar,
// viram um PNG transparente do tamanho da imagem exibida (variante web), que o
// backend aplica nas variantes — o original nunca muda. Uma anotação já
// existente entra como camada de fundo, para continuar de onde parou.
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Circle, Eraser, PenLine, Save, Trash2, Undo2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

type Ferramenta = 'seta' | 'circulo' | 'traco'
interface Traco {
  tipo: Ferramenta
  pontos: { x: number; y: number }[]
}

const COR = '#e11d2e'

function desenhar(ctx: CanvasRenderingContext2D, w: number, h: number, tracos: Traco[]) {
  ctx.strokeStyle = COR
  ctx.fillStyle = COR
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(3, w / 250)
  for (const t of tracos) {
    const p = t.pontos.map((q) => ({ x: q.x * w, y: q.y * h }))
    if (p.length < 2) continue
    const a = p[0]
    const b = p[p.length - 1]
    ctx.beginPath()
    if (t.tipo === 'traco') {
      ctx.moveTo(a.x, a.y)
      for (const q of p.slice(1)) ctx.lineTo(q.x, q.y)
      ctx.stroke()
    } else if (t.tipo === 'circulo') {
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const tam = Math.max(12, w / 60)
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x - tam * Math.cos(ang - Math.PI / 6), b.y - tam * Math.sin(ang - Math.PI / 6))
      ctx.lineTo(b.x - tam * Math.cos(ang + Math.PI / 6), b.y - tam * Math.sin(ang + Math.PI / 6))
      ctx.closePath()
      ctx.fill()
    }
  }
}

export function AnotarFoto({ fotoId, src, temAnotacao, onFechar, onSalvo }: { fotoId: number; src: string; temAnotacao?: boolean; onFechar: () => void; onSalvo: () => void }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ferramenta, setFerramenta] = useState<Ferramenta>('seta')
  const [tracos, setTracos] = useState<Traco[]>([])
  const [atual, setAtual] = useState<Traco | null>(null)
  const [fundo, setFundo] = useState<HTMLImageElement | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [tam, setTam] = useState({ w: 0, h: 0 })

  // Anotação existente vira camada de fundo.
  useEffect(() => {
    if (!temAnotacao) return
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => setFundo(im)
    im.src = `/api/fotos/${fotoId}/anotacao?v=${Date.now()}`
  }, [fotoId, temAnotacao])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !tam.w) return
    c.width = tam.w
    c.height = tam.h
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, tam.w, tam.h)
    if (fundo) ctx.drawImage(fundo, 0, 0, tam.w, tam.h)
    desenhar(ctx, tam.w, tam.h, atual ? [...tracos, atual] : tracos)
  }, [tracos, atual, tam, fundo])

  const medir = () => {
    const im = imgRef.current
    if (im) setTam({ w: im.clientWidth, h: im.clientHeight })
  }
  useEffect(() => {
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])

  const ponto = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  const salvar = async () => {
    const im = imgRef.current
    if (!im) return
    setSalvando(true)
    setErro(null)
    try {
      // Exporta no tamanho REAL da imagem exibida (variante web), com a camada antiga por baixo.
      const c = document.createElement('canvas')
      c.width = im.naturalWidth
      c.height = im.naturalHeight
      const ctx = c.getContext('2d')!
      if (fundo) ctx.drawImage(fundo, 0, 0, c.width, c.height)
      desenhar(ctx, c.width, c.height, tracos)
      const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('canvas vazio'))), 'image/png'))
      const fd = new FormData()
      fd.append('anotacao', blob, 'anotacao.png')
      await api.upload(`/fotos/${fotoId}/anotacao`, fd)
      onSalvo()
    } catch (err: any) {
      setErro(err?.message || 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const apagarTudo = async () => {
    if (!confirm('Remover toda a anotação desta foto?')) return
    setSalvando(true)
    try {
      await api.del(`/fotos/${fotoId}/anotacao`)
      onSalvo()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            ['seta', ArrowUpRight, 'Seta'],
            ['circulo', Circle, 'Círculo'],
            ['traco', PenLine, 'Traço livre'],
          ] as const
        ).map(([k, Icon, rotulo]) => (
          <Button key={k} type="button" size="sm" variant={ferramenta === k ? 'default' : 'outline'} onClick={() => setFerramenta(k)}>
            <Icon className="h-4 w-4" /> {rotulo}
          </Button>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setTracos((t) => t.slice(0, -1))} disabled={!tracos.length}>
          <Undo2 className="h-4 w-4" /> Desfazer
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setTracos([])} disabled={!tracos.length}>
          <Eraser className="h-4 w-4" /> Limpar novos
        </Button>
        {(temAnotacao || fundo) && (
          <Button type="button" size="sm" variant="ghost" onClick={apagarTudo} disabled={salvando}>
            <Trash2 className="h-4 w-4 text-destructive" /> Remover anotação
          </Button>
        )}
        <span className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={salvar} disabled={salvando || (!tracos.length && !fundo)}>
            <Save className="h-4 w-4" /> {salvando ? 'Salvando…' : 'Salvar anotação'}
          </Button>
        </span>
      </div>
      <div className="relative inline-block max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={src} alt="Foto" className="block max-h-[60vh] w-auto max-w-full select-none rounded" draggable={false} onLoad={medir} />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          style={{ width: tam.w || undefined, height: tam.h || undefined, cursor: 'crosshair' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setAtual({ tipo: ferramenta, pontos: [ponto(e)] })
          }}
          onPointerMove={(e) => {
            if (!atual) return
            const p = ponto(e)
            setAtual((t) => (t ? { ...t, pontos: t.tipo === 'traco' ? [...t.pontos, p] : [t.pontos[0], p] } : t))
          }}
          onPointerUp={() => {
            if (atual && atual.pontos.length > 1) setTracos((t) => [...t, atual])
            setAtual(null)
          }}
        />
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <p className="text-xs text-muted-foreground">Arraste para desenhar. A anotação entra nas cópias exibidas e nos laudos; o original fica intacto.</p>
    </div>
  )
}
