'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, ChevronRight, MapPin, Plus, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { STATUS_COR, STATUS_LABEL, VistoriaResumo, emRelatorio, filtrarPorTexto } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

// Porta de entrada do trabalho de campo: abriu o app, é daqui que se começa a
// fotografar. Mostra primeiro o que é de hoje e o que está em andamento — em
// campo não dá para procurar em lista.
const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function IniciarPage() {
  const router = useRouter()
  const [rows, setRows] = useState<VistoriaResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useParamEstado('busca')
  useTitulo('Iniciar vistoria')

  useEffect(() => {
    api
      .get<{ data: VistoriaResumo[] }>('/vistorias')
      .then((r) => setRows(r.data))
      .finally(() => setCarregando(false))
  }, [])

  const hoje = hojeIso()
  const { deHoje, andamento, proximas, resto } = useMemo(() => {
    // Vistoria finalizada saiu do campo: não aparece mais na tela de iniciar.
    const abertas = rows.filter((v) => !emRelatorio(v.status))
    return {
      deHoje: abertas.filter((v) => v.dataVistoria === hoje),
      andamento: abertas.filter((v) => v.status === 'campo' && v.dataVistoria !== hoje),
      proximas: abertas.filter((v) => v.dataVistoria && v.dataVistoria > hoje && v.status !== 'campo'),
      resto: abertas.filter((v) => !v.dataVistoria && v.status !== 'campo'),
    }
  }, [rows, hoje])

  const filtradas = useMemo(
    () => filtrarPorTexto(rows, busca || '', (v) => [v.imovelNome, v.clienteNome, v.tipoServico]),
    [rows, busca]
  )

  const Cartao = ({ v, destaque }: { v: VistoriaResumo; destaque?: boolean }) => (
    <button
      onClick={() => router.push(`/captura/${v.id}`)}
      className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
        destaque ? 'border-primary bg-primary/5 hover:bg-primary/10' : 'hover:bg-accent'
      }`}
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
          destaque ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        <Camera className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{v.imovelNome}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {v.clienteNome} · {v.tipoServico || 'sem tipo'}
          {v.fotos > 0 ? ` · ${v.fotos} fotos já feitas` : ''}
        </span>
      </span>
      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COR[v.status] || ''}`}>
        {STATUS_LABEL[v.status] || v.status}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  )

  const Secao = ({ titulo, lista, destaque }: { titulo: string; lista: VistoriaResumo[]; destaque?: boolean }) =>
    lista.length === 0 ? null : (
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{titulo}</p>
        {lista.map((v) => (
          <Cartao key={v.id} v={v} destaque={destaque} />
        ))}
      </div>
    )

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Camera className="h-6 w-6" /> Iniciar vistoria
        </h1>
        <p className="text-sm text-muted-foreground">
          Escolha a vistoria e comece a fotografar. A câmera abre já no primeiro ambiente.
        </p>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : busca ? (
        <div className="space-y-2">
          {filtradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma vistoria para “{busca}”.</p>
          ) : (
            filtradas.map((v) => <Cartao key={v.id} v={v} />)
          )}
        </div>
      ) : (
        <>
          <Secao titulo="Hoje" lista={deHoje} destaque />
          <Secao titulo="Em andamento" lista={andamento} destaque />
          {deHoje.length === 0 && andamento.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <MapPin className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Nada marcado para hoje. Escolha uma das próximas abaixo ou crie uma vistoria agora.
                </p>
                <Button onClick={() => router.push('/vistorias?nova=1')}>
                  <Plus className="h-4 w-4" /> Nova vistoria
                </Button>
              </CardContent>
            </Card>
          )}
          <Secao titulo="Próximas" lista={proximas} />
          <Secao titulo="Sem data marcada" lista={resto} />
        </>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Procurar outra vistoria por imóvel ou cliente…"
          value={busca || ''}
          onChange={(e) => setBusca(e.target.value || null)}
        />
      </div>
    </div>
  )
}
