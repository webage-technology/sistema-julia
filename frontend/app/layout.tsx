import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sistema Julia',
  description: 'Login, usuários e clientes',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  )
}
