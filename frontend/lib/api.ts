'use client'

// Cliente HTTP minimal. Chama a API na MESMA origem (/api/*, proxied pelo Next
// para o backend Express). Token JWT em localStorage['sj_token'] para as
// chamadas com header; para <img src> e downloads vale o cookie HttpOnly que o
// backend define no login — o token não vai mais na URL.

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

// Sair: limpa o token local e pede ao backend para apagar o cookie de sessão.
export async function sair() {
  try {
    await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${getToken() || ''}` } })
  } catch {
    /* sem rede: o cookie expira sozinho */
  }
  clearToken()
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

// Envio de arquivos (FormData) — sem Content-Type manual (o navegador define o boundary).
async function requestForm<T>(path: string, form: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
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
    throw err
  }
  return json as T
}

// Resposta binária (PDF de prévia) — devolve um Blob para abrir em nova aba.
async function requestBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    let json: any = null
    try {
      json = await res.json()
    } catch {
      /* corpo vazio */
    }
    const err = new Error(json?.message || `Erro ${res.status}`) as ApiError
    err.status = res.status
    throw err
  }
  return res.blob()
}

// Salva um Blob como arquivo no computador (o Content-Disposition se perde
// quando a resposta vem por fetch, então o nome é dado aqui).
export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// URL para <img src>, <a href> e novas abas: a sessão vai pelo cookie.
export function apiUrl(path: string): string {
  return `/api${path}`
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path),
  upload: <T = any>(path: string, form: FormData) => requestForm<T>(path, form),
  blob: (path: string, body?: unknown) => requestBlob('POST', path, body),
}
