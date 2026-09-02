'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Plus, Pencil, Search, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { filtrarPorTexto } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

interface User {
  id: number
  name: string
  email: string
  role: string
  createdAt: string
}

const EMPTY = { name: '', email: '', password: '', role: 'user' }

export default function UsersPage() {
  const router = useRouter()
  const [rows, setRows] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // O formulário tem endereço próprio: ?novo=1 ou ?editar=<id>.
  const [novo, setNovo] = useParamEstado('novo')
  const [editarId, setEditarId] = useParamEstado('editar')
  const [busca, setBusca] = useParamEstado('busca')
  const visiveis = useMemo(() => filtrarPorTexto(rows, busca || '', (u) => [u.name, u.email, u.role]), [rows, busca])
  const editing = rows.find((u) => String(u.id) === editarId) || null
  const open = novo === '1' || !!editing
  useTitulo(novo === '1' ? 'Novo usuário' : editing ? `Editar ${editing.name}` : 'Usuários')

  const load = useCallback(() => {
    setLoading(true)
    api
      .get<{ data: User[] }>('/users')
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  // Ao abrir (inclusive por link direto ou voltar), preenche o formulário.
  useEffect(() => {
    setError(null)
    if (novo === '1') setForm(EMPTY)
    else if (editing) setForm({ name: editing.name, email: editing.email, password: '', role: editing.role })
  }, [novo, editing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fechar = () => {
    if (novo === '1') setNovo(null)
    else setEditarId(null)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name: form.name, email: form.email, role: form.role }
      if (form.password) body.password = form.password
      if (editing) await api.put(`/users/${editing.id}`, body)
      else await api.post('/users', { ...body, password: form.password })
      fechar()
      load()
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (u: User) => {
    if (!confirm(`Excluir o usuário "${u.name}"?`)) return
    try {
      await api.del(`/users/${u.id}`)
      load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao excluir')
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Usuários</h1>
          <p className="text-sm text-muted-foreground">Gerencie os usuários do sistema.</p>
        </div>
        <Button onClick={() => setNovo('1')}>
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por nome, e-mail ou papel…"
          value={busca || ''}
          onChange={(e) => setBusca(e.target.value || null)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {busca ? `Nenhum usuário para “${busca}”.` : 'Nenhum usuário cadastrado.'}
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{u.role}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={`Agenda de ${u.name}`}
                      onClick={() => router.push(`/agenda?responsavel=${u.id}`)}
                    >
                      <CalendarDays className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditarId(String(u.id))}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(u)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !o && fechar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>
                Senha{' '}
                {editing && <span className="text-xs font-normal text-muted-foreground">(em branco = manter)</span>}
              </Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="user">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={fechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
