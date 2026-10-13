'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { Notificacao, dataHora } from '@/lib/regularizacao'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// Todos os avisos do usuário: prazos, vistorias, documentos, laudos, portal.
export default function NotificacoesPage() {
  const router = useRouter()
  const [lista, setLista] = useState<Notificacao[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const [todas, setTodas] = useParamEstado('todas')
  useTitulo('Avisos')

  const carregar = useCallback(() => {
    api.get<{ data: Notificacao[]; naoLidas: number }>(`/notificacoes${todas === '1' ? '?todas=1' : ''}`).then((r) => {
      setLista(r.data)
      setNaoLidas(r.naoLidas)
    })
  }, [todas])
  useEffect(() => {
    carregar()
  }, [carregar])

  const abrir = async (n: Notificacao) => {
    if (!n.lidaEm) await api.post(`/notificacoes/${n.id}/lida`).catch(() => {})
    if (n.link) router.push(n.link)
    else carregar()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Bell className="h-6 w-6" /> Avisos
          </h1>
          <p className="text-sm text-muted-foreground">{naoLidas} não lido(s). Prazos, vistorias de amanhã, documentos faltando, laudos emitidos e envios do portal.</p>
        </div>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTodas(todas === '1' ? null : '1')}>
            {todas === '1' ? 'Só não lidos' : 'Mostrar lidos'}
          </Button>
          <Button size="sm" onClick={() => api.post('/notificacoes/lidas').then(carregar)} disabled={naoLidas === 0}>
            <Check className="h-4 w-4" /> Marcar todos como lidos
          </Button>
        </span>
      </div>
      <Card>
        {lista.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhum aviso.</p>
        ) : (
          <ul className="divide-y">
            {lista.map((n) => (
              <li key={n.id}>
                <button onClick={() => abrir(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/50 ${n.lidaEm ? 'opacity-60' : ''}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.lidaEm ? 'bg-transparent' : n.tipo === 'prazo_vencido' ? 'bg-primary' : 'bg-zinc-900'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.tipo === 'prazo_vencido' ? 'font-semibold text-primary' : 'font-medium'}`}>{n.titulo}</span>
                    {n.mensagem && <span className="block whitespace-pre-line text-xs text-muted-foreground">{n.mensagem}</span>}
                    <span className="block text-[11px] text-muted-foreground">{dataHora(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
