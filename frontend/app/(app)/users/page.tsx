'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Copy, KeyRound, PenLine, Plus, Pencil, Search, Trash2 } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { filtrarPorTexto, SELECT_CLASS } from '@/lib/vistorias'
import { PAPEIS, PAPEL_LABEL, ehAdmin } from '@/lib/papeis'
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
  registro: string
  titulo: string
  telefone: string
  temAssinatura: boolean
  ativo: boolean
  createdAt: string
}

const EMPTY = { name: '', email: '', password: '', role: 'arquiteto', registro: '', titulo: '', telefone: '', ativo: true }

export default function UsersPage() {
  const router = useRouter()
  const [rows, setRows] = useState<User[]>([])
  const [me, setMe] = useState<{ id?: number; role?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [link, setLink] = useState<{ nome: string; url: string } | null>(null)
  const assinaturaRef = useRef<HTMLInputElement>(null)
  const [alvoAssinatura, setAlvoAssinatura] = useState<number | null>(null)
  // O formulário tem endereço próprio: ?novo=1 ou ?editar=<id>.
  const [novo, setNovo] = useParamEstado('novo')
  const [editarId, setEditarId] = useParamEstado('editar')
  const [busca, setBusca] = useParamEstado('busca')
  const visiveis = useMemo(() => filtrarPorTexto(rows, busca || '', (u) => [u.name, u.email, u.role, u.registro]), [rows, busca])
  const editing = rows.find((u) => String(u.id) === editarId) || null
  const open = novo === '1' || !!editing
  const admin = ehAdmin(me?.role)
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
    api.get<{ user: { id?: number; role?: string } }>('/me').then((r) => setMe(r.user))
  }, [load])

  // Ao abrir (inclusive por link direto ou voltar), preenche o formulário.
  useEffect(() => {
    setError(null)
    if (novo === '1') setForm(EMPTY)
    else if (editing)
      setForm({ name: editing.name, email: editing.email, password: '', role: editing.role, registro: editing.registro, titulo: editing.titulo, telefone: editing.telefone, ativo: editing.ativo })
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
      const body: Record<string, unknown> = { name: form.name, email: form.email, role: form.role, registro: form.registro, titulo: form.titulo, telefone: form.telefone, ativo: form.ativo }
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
    if (!confirm(`Excluir o usuário "${u.name}"? Prefira desativar, para manter o histórico.`)) return
    try {
      await api.del(`/users/${u.id}`)
      load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao excluir')
    }
  }

  const gerarLink = async (u: User) => {
    try {
      const r = await api.post<{ data: { url: string } }>(`/users/${u.id}/link-redefinicao`)
      setLink({ nome: u.name, url: r.data.url })
    } catch (err: any) {
      alert(err?.message || 'Falha ao gerar o link')
    }
  }

  const enviarAssinatura = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f || !alvoAssinatura) return
    const fd = new FormData()
    fd.append('assinatura', f)
    try {
      await api.upload(`/users/${alvoAssinatura}/assinatura`, fd)
      load()
    } catch (err: any) {
      alert(err?.message || 'Falha ao enviar')
    } finally {
      setAlvoAssinatura(null)
      if (assinaturaRef.current) assinaturaRef.current.value = ''
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Usuários</h1>
          <p className="text-sm text-muted-foreground">A equipe: papel, registro profissional (CAU/CREA) e assinatura para o laudo.</p>
        </div>
        {admin && (
          <Button onClick={() => setNovo('1')}>
            <Plus className="h-4 w-4" /> Novo usuário
          </Button>
        )}
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome, e-mail, papel ou registro…" value={busca || ''} onChange={(e) => setBusca(e.target.value || null)} />
      </div>
      <input ref={assinaturaRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => enviarAssinatura(e.target.files)} />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead className="w-44 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {busca ? `Nenhum usuário para “${busca}”.` : 'Nenhum usuário cadastrado.'}
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((u) => (
                <TableRow key={u.id} className={u.ativo ? '' : 'opacity-50'}>
                  <TableCell className="font-medium">
                    {u.name}
                    {!u.ativo && <span className="ml-2 rounded bg-muted px-1.5 text-xs font-normal">desativado</span>}
                    {u.titulo && <span className="block text-xs font-normal text-muted-foreground">{u.titulo}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.email}
                    {u.telefone && <span className="block text-xs">{u.telefone}</span>}
                  </TableCell>
                  <TableCell>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{PAPEL_LABEL[u.role] || u.role}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.registro || '—'}
                    {u.temAssinatura && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${apiUrl(`/users/${u.id}/assinatura`)}?v=${u.temAssinatura}`} alt="assinatura" className="mt-1 h-6 max-w-[120px] object-contain" />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title={`Agenda de ${u.name}`} onClick={() => router.push(`/agenda?responsavel=${u.id}`)}>
                      <CalendarDays className="h-4 w-4" />
                    </Button>
                    {(admin || me?.id === u.id) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Enviar assinatura (PNG)"
                        onClick={() => {
                          setAlvoAssinatura(u.id)
                          assinaturaRef.current?.click()
                        }}
                      >
                        <PenLine className="h-4 w-4" />
                      </Button>
                    )}
                    {admin && (
                      <>
                        <Button variant="ghost" size="icon" title="Gerar link de redefinição de senha" onClick={() => gerarLink(u)}>
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setEditarId(String(u.id))}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(u)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !o && fechar()}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone / WhatsApp</Label>
                <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Título profissional</Label>
                <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Arquiteta e Urbanista" />
              </div>
              <div className="space-y-1.5">
                <Label>Registro (CAU / CREA)</Label>
                <Input value={form.registro} onChange={(e) => setForm({ ...form, registro: e.target.value })} placeholder="CAU A123456-7" />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Senha {editing && <span className="text-xs font-normal text-muted-foreground">(em branco = manter)</span>}
                </Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} minLength={6} />
              </div>
              <div className="space-y-1.5">
                <Label>Papel</Label>
                <select className={SELECT_CLASS} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {PAPEIS.map((p) => (
                    <option key={p.valor} value={p.valor}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{PAPEIS.find((p) => p.valor === form.role)?.descricao}</p>
              </div>
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Usuário ativo (desativado não entra, mas o histórico fica)
              </label>
            )}
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

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link de redefinição de senha</DialogTitle>
          </DialogHeader>
          {link && (
            <div className="space-y-3 text-sm">
              <p>
                Mande este link para <strong>{link.nome}</strong> (WhatsApp, e-mail, pessoalmente). Vale por 1 hora e uma única vez.
              </p>
              <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{link.url}</p>
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(link.url)}>
                <Copy className="h-4 w-4" /> Copiar
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setLink(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
