'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Define a nova senha a partir do link (?token=). O token vale 1 hora, uma vez.
export default function RedefinirSenhaPage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [nome, setNome] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || ''
    setToken(t)
    if (!t) return setErro('Link incompleto — peça outro.')
    api
      .get<{ data: { nome: string } }>(`/senha/token/${encodeURIComponent(t)}`)
      .then((r) => setNome(r.data.nome))
      .catch((e) => setErro(e?.message || 'Link inválido ou vencido'))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (senha !== confirma) return setErro('As senhas não conferem')
    setErro(null)
    setLoading(true)
    try {
      await api.post('/senha/redefinir', { token, senha })
      setOk(true)
      setTimeout(() => router.push('/login'), 1500)
    } catch (err: any) {
      setErro(err?.message || 'Falha ao redefinir')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle>Nova senha</CardTitle>
          <CardDescription>{nome ? `Olá, ${nome}. Escolha a nova senha.` : 'Conferindo o link…'}</CardDescription>
        </CardHeader>
        <CardContent>
          {ok ? (
            <p className="text-center text-sm">Senha alterada. Redirecionando para o login…</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="senha">Nova senha</Label>
                <Input id="senha" type="password" autoComplete="new-password" minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} required disabled={!nome} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirma">Repita a senha</Label>
                <Input id="confirma" type="password" autoComplete="new-password" minLength={6} value={confirma} onChange={(e) => setConfirma(e.target.value)} required disabled={!nome} />
              </div>
              {erro && <p className="text-sm text-destructive">{erro}</p>}
              <Button type="submit" className="w-full" disabled={loading || !nome}>
                {loading ? 'Salvando…' : 'Salvar nova senha'}
              </Button>
              <p className="text-center text-xs">
                <Link href="/login" className="text-muted-foreground hover:underline">
                  Voltar para o login
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
