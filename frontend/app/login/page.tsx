'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { api, setToken } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  // Preenchido com o administrador padrão a pedido do dono (facilita o dia a dia).
  const [email, setEmail] = useState('admin@sistema-julia.local')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [temLogo, setTemLogo] = useState(false)

  // Logo do escritório (rota pública) — se houver, substitui o ícone.
  useEffect(() => {
    fetch('/api/escritorio/logo', { method: 'HEAD' })
      .then((r) => setTemLogo(r.ok))
      .catch(() => {})
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post<{ token: string }>('/login', { email, password })
      setToken(res.token)
      // ?next= permite voltar direto para a tela de captura após o login no celular.
      const next = new URLSearchParams(window.location.search).get('next')
      router.push(next && next.startsWith('/') ? next : '/painel')
    } catch (err: any) {
      setError(err?.message || 'Falha ao entrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {temLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/escritorio/logo" alt="Logo" className="mx-auto mb-2 h-16 max-w-[220px] object-contain" />
          ) : (
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="h-6 w-6" />
            </div>
          )}
          <CardTitle>Sistema Julia</CardTitle>
          <CardDescription>Entre com seu e-mail e senha</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </Button>
            <p className="text-center text-xs">
              <Link href="/esqueci-senha" className="text-muted-foreground hover:text-foreground hover:underline">
                Esqueci a senha
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
