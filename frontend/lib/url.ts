'use client'

// Estado que mora na URL. Cada tela do sistema — inclusive as que aparecem como
// diálogo (novo/editar), abas e a foto ampliada — tem endereço próprio, então dá
// para compartilhar o link, favoritar e usar o botão voltar do navegador.
//
// Usa history.pushState direto (o Next 14 sincroniza o roteador com ele) em vez
// de useSearchParams — que exigiria <Suspense> em toda página.
import { useCallback, useEffect, useState } from 'react'

/**
 * Liga um parâmetro da query ao estado do componente.
 *
 *   const [novo, setNovo] = useParamEstado('novo')   // /clientes?novo=1
 *   setNovo('1')   → abre (empilha no histórico: voltar fecha)
 *   setNovo(null)  → fecha
 */
export function useParamEstado(nome: string): [string | null, (valor: string | null) => void] {
  const [valor, setValor] = useState<string | null>(null)

  useEffect(() => {
    const ler = () => setValor(new URLSearchParams(window.location.search).get(nome))
    ler() // valor inicial (link compartilhado / F5)
    // voltar e avançar do navegador
    window.addEventListener('popstate', ler)
    return () => window.removeEventListener('popstate', ler)
  }, [nome])

  const definir = useCallback(
    (novo: string | null) => {
      const url = new URL(window.location.href)
      if (novo == null || novo === '') url.searchParams.delete(nome)
      else url.searchParams.set(nome, novo)
      window.history.pushState({}, '', url)
      setValor(novo == null || novo === '' ? null : novo)
    },
    [nome]
  )

  return [valor, definir]
}

/** Título da aba do navegador — é o nome sugerido ao favoritar a página. */
export function useTitulo(titulo: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · Sistema Julia` : 'Sistema Julia'
  }, [titulo])
}
