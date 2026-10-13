import './globals.css'
import type { Metadata } from 'next'
import FaixaAmbiente from './faixa-ambiente'

export const metadata: Metadata = {
  title: 'Sistema Julia',
  description: 'Vistorias, imóveis, clientes e usuários',
  icons: { apple: '/icons/apple-touch-icon.png' },
  // Instalado na tela de início do iPhone, abre em tela cheia (sem barra do Safari).
  appleWebApp: { capable: true, title: 'Sistema Julia', statusBarStyle: 'black-translucent' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background text-foreground antialiased"><FaixaAmbiente />{children}</body>
    </html>
  )
}
