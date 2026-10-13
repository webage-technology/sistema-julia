import type { Metadata } from 'next'

// Portal do cliente: fora do layout da equipe (sem menu, sem login interno).
export const metadata: Metadata = {
  title: 'Portal do cliente',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-muted/40">{children}</div>
}
