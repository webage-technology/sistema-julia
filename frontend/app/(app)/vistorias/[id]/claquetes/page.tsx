'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useTitulo } from '@/lib/url'
import { VistoriaDetalhe } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'

// Cartões de claquete: um por ambiente, para imprimir e levar a campo.
// Plano B da captura guiada — fotografando o cartão ao entrar no ambiente,
// a separação na conferência fica visual (e, no futuro, automática pelo QR).
export default function ClaquetesPage() {
  const { id } = useParams<{ id: string }>()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)

  useEffect(() => {
    api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`).then((r) => setDet(r.data))
  }, [id])

  useTitulo(det ? `Claquetes — vistoria #${det.id}` : 'Cartões de claquete')

  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <Link href={`/vistorias/${id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" /> Vistoria #{det.id}
          </Link>
          <h1 className="text-2xl font-semibold">Cartões de claquete</h1>
          <p className="text-sm text-muted-foreground">
            Imprima e leve a campo: ao entrar em cada ambiente, a primeira foto é o cartão dele.
          </p>
        </div>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 print:gap-2">
        {det.pavimentos.flatMap((p) =>
          p.ambientes
            .filter((a) => a.situacao !== 'nao_existe')
            .map((a) => (
              <div
                key={a.id}
                className="flex break-inside-avoid items-center justify-between gap-3 rounded-lg border-2 border-black p-5 print:rounded-none"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium uppercase tracking-wide">{p.nome}</p>
                  <p className="break-words text-3xl font-black leading-tight">{a.nome}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {det.imovelNome} · Vistoria #{det.id} · amb. {a.id}
                  </p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={apiUrl(`/qr?text=${encodeURIComponent(`SJ-AMB:${a.id}`)}`)}
                  alt=""
                  className="h-24 w-24 shrink-0"
                />
              </div>
            ))
        )}
      </div>
    </div>
  )
}
