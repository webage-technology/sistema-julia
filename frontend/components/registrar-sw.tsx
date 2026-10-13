'use client'

// Registra o service worker (public/sw.js): é ele que deixa o app abrir sem
// sinal — a casca da tela de captura e a última resposta da vistoria ficam em
// cache no aparelho. A fila de fotos já era offline; agora a TELA também é.
import { useEffect } from 'react'

export function RegistrarSW() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production' && !/^(sistema-julia|localhost)/.test(window.location.hostname) && !window.location.hostname.endsWith('webage.com.br')) return
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw] não registrado:', err?.message))
  }, [])
  return null
}
