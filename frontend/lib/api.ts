'use client'

// Cliente HTTP minimal. Chama a API na MESMA origem (/api/*, proxied pelo Next
// para o backend Express). Token JWT em localStorage['sj_token'].

export interface ApiError extends Error {
  status?: number
  body?: any
}

const TOKEN_KEY = 'sj_token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken() {
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* corpo vazio */
  }
  if (!res.ok) {
    const err = new Error(json?.message || `Erro ${res.status}`) as ApiError
    err.status = res.status
    err.body = json
    if (res.status === 401 && typeof window !== 'undefined') {
      clearToken()
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login'
    }
    throw err
  }
  return json as T
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path),
}
