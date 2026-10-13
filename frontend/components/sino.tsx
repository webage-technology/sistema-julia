'use client'

// Sino de notificações do menu: mostra quantas não lidas há e, ao abrir, as
// últimas — clicar leva ao link e marca como lida. A lista completa fica em
// /notificacoes.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { Notificacao, dataHora } from '@/lib/regularizacao'

export function Sino() {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [lista, setLista] = useState<Notificacao[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const carregar = useCallback(() => {
    api
      .get<{ data: Notificacao[]; naoLidas: number }>('/notificacoes')
      .then((r) => {
        setLista(r.data.slice(0, 12))
        setNaoLidas(r.naoLidas)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 60000)
    return () => clearInterval(t)
  }, [carregar])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  const abrir = async (n: Notificacao) => {
    setAberto(false)
    api.post(`/notificacoes/${n.id}/lida`).catch(() => {})
    setLista((l) => l.filter((x) => x.id !== n.id))
    setNaoLidas((c) => Math.max(0, c - 1))
    if (n.link) router.push(n.link)
  }

  const todasLidas = async () => {
    await api.post('/notificacoes/lidas').catch(() => {})
    setLista([])
    setNaoLidas(0)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setAberto((a) => !a)}
        className="relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5 hover:text-white"
        aria-label="Notificações"
      >
        <Bell className="h-4 w-4 text-zinc-500" /> Avisos
        {naoLidas > 0 && (
          <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{naoLidas}</span>
        )}
      </button>
      {aberto && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-80 rounded-md border border-border bg-card text-card-foreground shadow-lg">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
            <span className="font-semibold">Avisos</span>
            <span className="text-muted-foreground">{naoLidas} não lido(s)</span>
            {naoLidas > 0 && (
              <button onClick={todasLidas} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <Check className="h-3 w-3" /> marcar todos
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-auto">
            {lista.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Nada pendente.</li>}
            {lista.map((n) => (
              <li key={n.id}>
                <button onClick={() => abrir(n)} className="w-full px-3 py-2 text-left hover:bg-accent">
                  <p className={`text-sm ${n.tipo === 'prazo_vencido' ? 'font-semibold text-primary' : 'font-medium'}`}>{n.titulo}</p>
                  {n.mensagem && <p className="line-clamp-2 text-xs text-muted-foreground">{n.mensagem}</p>}
                  <p className="text-[11px] text-muted-foreground">{dataHora(n.createdAt)}</p>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/notificacoes" onClick={() => setAberto(false)} className="block border-t px-3 py-2 text-center text-xs text-primary hover:underline">
            Ver todos os avisos
          </Link>
        </div>
      )}
    </div>
  )
}
