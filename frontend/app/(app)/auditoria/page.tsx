'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, History, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS } from '@/lib/vistorias'
import { dataHora } from '@/lib/regularizacao'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

// Auditoria (só administrador): quem fez o quê, quando, de onde.
const ENTIDADES = ['', 'processo', 'protocolo', 'processo_documento', 'vistoria', 'imovel', 'cliente', 'usuario', 'laudo', 'arquivo', 'escritorio', 'rrt', 'despesa_processo']

export default function AuditoriaPage() {
  const [lista, setLista] = useState<any[]>([])
  const [usuarios, setUsuarios] = useState<{ id: number; name: string }[]>([])
  const [busca, setBusca] = useParamEstado('busca')
  const [entidade, setEntidade] = useParamEstado('entidade')
  const [userId, setUserId] = useParamEstado('usuario')
  const [erro, setErro] = useState<string | null>(null)
  useTitulo('Auditoria')

  const carregar = useCallback(() => {
    const q = new URLSearchParams()
    if (busca) q.set('busca', busca)
    if (entidade) q.set('entidade', entidade)
    if (userId) q.set('userId', userId)
    api
      .get<{ data: any[] }>(`/auditoria?${q}`)
      .then((r) => setLista(r.data))
      .catch((e) => setErro(e?.message || 'Sem acesso'))
  }, [busca, entidade, userId])
  useEffect(() => {
    const t = setTimeout(carregar, 200)
    return () => clearTimeout(t)
  }, [carregar])
  useEffect(() => {
    api.get<{ data: { id: number; name: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Configurações
      </Link>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <History className="h-6 w-6" /> Auditoria
        </h1>
        <p className="text-sm text-muted-foreground">Cada ação relevante deixa uma linha: quem, o quê, quando e de que endereço.</p>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar na descrição…" value={busca || ''} onChange={(e) => setBusca(e.target.value || null)} />
        </div>
        <select className={`${SELECT_CLASS} w-auto`} value={entidade || ''} onChange={(e) => setEntidade(e.target.value || null)}>
          {ENTIDADES.map((e) => (
            <option key={e} value={e}>
              {e || 'Todas as entidades'}
            </option>
          ))}
        </select>
        <select className={`${SELECT_CLASS} w-auto`} value={userId || ''} onChange={(e) => setUserId(e.target.value || null)}>
          <option value="">Todos os usuários</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <Card>
        {lista.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nada registrado.</p>
        ) : (
          <ul className="divide-y">
            {lista.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-2 text-sm">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{dataHora(a.createdAt)}</span>
                <span className="w-32 shrink-0 truncate text-xs font-medium">{a.userNome || 'sistema'}</span>
                <span className="rounded bg-muted px-1.5 text-xs">{a.acao}</span>
                <span className="min-w-0 flex-1">
                  {a.processoId ? (
                    <Link href={`/processos/${a.processoId}?aba=historico`} className="hover:underline">
                      {a.descricao}
                    </Link>
                  ) : (
                    a.descricao
                  )}
                  <span className="block text-[11px] text-muted-foreground">
                    {a.entidade}
                    {a.entidadeId ? ` #${a.entidadeId}` : ''}
                    {a.ip ? ` · ${a.ip}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
