import type { Metadata, Viewport } from 'next'

// Layout da captura em campo: tela cheia, sem sidebar, sem zoom por toque
// (o zoom acidental atrapalha o disparo rápido).
// `viewportFit: 'cover'` deixa a imagem ir até a borda e é o que faz
// env(safe-area-inset-*) valer alguma coisa — na horizontal o recorte da tela
// fica justamente do lado onde ficam os controles.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
}

export const metadata: Metadata = {
  title: 'Captura — Sistema Julia',
}

export default function CapturaLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-black">{children}</div>
}
