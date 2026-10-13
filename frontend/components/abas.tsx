'use client'

// Abas de navegação entre telas irmãs (ex.: Vistorias | Cronograma). Cada aba é um
// link de verdade — mantém a regra de que toda tela tem endereço próprio.
//
// Antes eram um sublinhado fininho, que sumia no meio da página. Agora são um
// seletor segmentado: caixa cinza com borda, aba ativa em vermelho cheio e ícone
// em cada uma. O bloco tem peso visual próprio, então dá para achar de relance
// em que parte da vistoria se está.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarClock, Camera, ClipboardList, FileText, type LucideIcon } from 'lucide-react'

export interface AbaItem {
  href: string
  label: string
  icon?: LucideIcon
  ativoEm?: string[]
}

export function Abas({ itens }: { itens: AbaItem[] }) {
  const pathname = usePathname()
  return (
    <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted p-1">
      {itens.map((i) => {
        const ativo = pathname === i.href || (i.ativoEm || []).some((p) => pathname.startsWith(p))
        const Icon = i.icon
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={ativo ? 'page' : undefined}
            className={`flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              ativo
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-card hover:text-foreground'
            }`}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            {i.label}
          </Link>
        )
      })}
    </div>
  )
}

// O cronograma é a viagem vista pelo lado do tempo: quando se sai, o que está
// marcado em campo e a verba daquela ida. Os dados continuam sendo os da
// viagem (/viagens) — só o nome da aba fala a língua de quem usa.
export const ABAS_VISTORIAS: AbaItem[] = [
  { href: '/vistorias', label: 'Vistorias', icon: ClipboardList },
  { href: '/viagens', label: 'Cronograma', icon: CalendarClock, ativoEm: ['/viagens'] },
]

// Abas de uma vistoria: o trabalho de campo e o laudo que sai dele.
export const abasDaVistoria = (id: string | number): AbaItem[] => [
  { href: `/vistorias/${id}`, label: 'Vistoria', icon: Camera },
  { href: `/vistorias/${id}/relatorio`, label: 'Relatório', icon: FileText },
]
