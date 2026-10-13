'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useTitulo } from '@/lib/url'
import { VistoriaDetalhe } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'

// Cartões de claquete: um por ambiente, para imprimir e levar a campo. A equipe
// fotografa com a câmera do próprio celular — ao entrar em cada ambiente, a
// primeira foto é o cartão dele. Depois sobe TODAS as fotos de uma vez
// ("Enviar fotos (lote)") e o sistema lê o QR e separa por ambiente sozinho.
// O cartão "Novo ambiente" serve para o que não está cadastrado: cada foto dele
// abre um "Novo N" (escreva o nome à caneta no cartão; na conferência, renomeie).
const NOVOS = 4

export default function ClaquetesPage() {
  const { id } = useParams<{ id: string }>()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)

  useEffect(() => {
    api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`).then((r) => setDet(r.data))
  }, [id])

  useTitulo(det ? `Claquetes — vistoria #${det.id}` : 'Cartões de claquete')

  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const qr = (texto: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={apiUrl(`/qr?text=${encodeURIComponent(texto)}`)}
      alt=""
      className="shrink-0"
      style={{ width: '42mm', height: '42mm' }}
    />
  )

  const ambientes = det.pavimentos.flatMap((p) =>
    p.ambientes.filter((a) => a.situacao !== 'nao_existe').map((a) => ({ ...a, pavimento: p.nome }))
  )

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/vistorias/${id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" /> Vistoria #{det.id}
            </Link>
            <h1 className="text-2xl font-semibold">Cartões de claquete</h1>
          </div>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
        </div>
        <ol className="list-decimal space-y-1 rounded-md border bg-muted/30 p-3 pl-8 text-sm">
          <li>Imprima e leve a campo (vale qualquer impressora; o QR é lido mesmo em preto e branco).</li>
          <li>
            Ao entrar em cada ambiente, a <strong>primeira foto é o cartão dele</strong>, de perto, com o QR inteiro
            na tela. Depois fotografe o ambiente normalmente, com a câmera do próprio celular.
          </li>
          <li>
            Ambiente que não está na lista? Use um cartão <strong>Novo ambiente</strong> e escreva o nome nele à
            caneta — ele vira um ambiente novo para nomear na conferência.
          </li>
          <li>A cada novo dia, comece pelo cartão do ambiente onde parou.</li>
          <li>
            De volta, em <strong>Enviar fotos (lote)</strong>, selecione todas as fotos de uma vez: o sistema lê os
            cartões e separa tudo por ambiente, na ordem em que foram tiradas.
          </li>
        </ol>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
        {ambientes.map((a) => (
          <div
            key={a.id}
            className="flex break-inside-avoid items-center justify-between gap-3 rounded-lg border-2 border-black bg-white p-4 text-black print:rounded-none"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium uppercase tracking-wide">{a.pavimento}</p>
              <p className="break-words text-3xl font-black leading-tight">{a.nome}</p>
              <p className="mt-2 text-xs text-neutral-500">
                {det.imovelNome} · Vistoria #{det.id} · amb. {a.id}
              </p>
            </div>
            {qr(`SJ-AMB:${a.id}`)}
          </div>
        ))}
        {Array.from({ length: NOVOS }, (_, i) => (
          <div
            key={`novo-${i}`}
            className="flex break-inside-avoid items-center justify-between gap-3 rounded-lg border-2 border-dashed border-black bg-white p-4 text-black print:rounded-none"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium uppercase tracking-wide">Não estava na lista</p>
              <p className="text-2xl font-black leading-tight">Novo ambiente</p>
              <p className="mt-4 border-b border-black pb-1 text-xs text-neutral-500">Nome:</p>
              <p className="mt-2 text-xs text-neutral-500">Vale em qualquer vistoria · reutilizável</p>
            </div>
            {qr('SJ-NOVO')}
          </div>
        ))}
      </div>
    </div>
  )
}
