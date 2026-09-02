import type { MetadataRoute } from 'next'

// Manifest PWA: permite "Adicionar à Tela de Início" no celular da Julia —
// o sistema abre em tela cheia, como um aplicativo.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sistema Julia',
    short_name: 'Julia',
    description: 'Vistorias — captura guiada, conferência e export de fotos',
    // Instalado no celular, o app abre direto na tela de iniciar vistoria —
    // é para isso que ele é aberto em campo.
    start_url: '/iniciar',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#0f172a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
