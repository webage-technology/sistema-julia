'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RotateCcw, Trash, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useTitulo } from '@/lib/url'
import { dataHora } from '@/lib/regularizacao'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Lixeira (só administrador): o que foi excluído continua aqui até ser
// restaurado ou apagado de vez — inclusive as fotos no disco.
export default function LixeiraPage() {
  const [d, setD] = useState<any>(null)
  const [erro, setErro] = useState<string | null>(null)
  useTitulo('Lixeira')

  const carregar = useCallback(() => {
    api
      .get<{ data: any }>('/lixeira')
      .then((r) => setD(r.data))
      .catch((e) => setErro(e?.message || 'Sem acesso'))
  }, [])
  useEffect(() => {
    carregar()
  }, [carregar])

  if (erro) return <p className="text-sm text-destructive">{erro}</p>
  if (!d) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const agir = async (tipo: string, id: number, acao: 'restaurar' | 'apagar', nome: string) => {
    if (acao === 'apagar' && !confirm(`Apagar DEFINITIVAMENTE “${nome}”? Isto não tem volta — arquivos e fotos somem do disco.`)) return
    try {
      if (acao === 'restaurar') await api.post(`/lixeira/${tipo}/${id}/restaurar`)
      else await api.del(`/lixeira/${tipo}/${id}`)
      carregar()
    } catch (err: any) {
      alert(err?.message || 'Falha')
    }
  }

  const Secao = ({ titulo, tipo, itens, nome }: { titulo: string; tipo: string; itens: any[]; nome: (x: any) => string }) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {titulo} ({itens.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Vazio.</p>
        ) : (
          <ul className="divide-y">
            {itens.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{nome(x)}</span>
                  <span className="block text-xs text-muted-foreground">excluído em {dataHora(x.excluidoEm)}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => agir(tipo, x.id, 'restaurar', nome(x))}>
                  <RotateCcw className="h-4 w-4" /> Restaurar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => agir(tipo, x.id, 'apagar', nome(x))}>
                  <Trash2 className="h-4 w-4 text-destructive" /> Apagar de vez
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Configurações
      </Link>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Trash className="h-6 w-6" /> Lixeira
        </h1>
        <p className="text-sm text-muted-foreground">Excluir um cliente leva os imóveis, vistorias e processos dele; restaurar o cliente traz tudo de volta. Restaure o pai antes do filho.</p>
      </div>
      <Secao titulo="Processos" tipo="processos" itens={d.processos} nome={(x) => `${x.numero} — ${x.titulo} (${x.clienteNome})`} />
      <Secao titulo="Vistorias" tipo="vistorias" itens={d.vistorias} nome={(x) => `Vistoria #${x.id} — ${x.imovelNome} (${x.clienteNome}) · ${x.fotos} fotos`} />
      <Secao titulo="Imóveis" tipo="imoveis" itens={d.imoveis} nome={(x) => `${x.nome} (${x.clienteNome}) · ${x.vistorias} vistoria(s)`} />
      <Secao titulo="Clientes" tipo="clients" itens={d.clients} nome={(x) => x.nome} />
    </div>
  )
}
