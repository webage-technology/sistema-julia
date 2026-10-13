'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Copy, ExternalLink, Globe, Plus, Pencil, Search, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { filtrarPorTexto, SELECT_CLASS } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

type TipoCliente = 'pf' | 'pj'

interface Client {
  id: number
  name: string
  email: string
  phone: string
  company: string
  tipo: TipoCliente
  documento: string
  endereco: string
  portalAtivo: boolean
  createdAt: string
}

// O backend guarda só os dígitos; aqui vai e volta com a máscara de CPF
// (000.000.000-00) ou de CNPJ (00.000.000/0000-00).
const rotuloDoc = (tipo: TipoCliente) => (tipo === 'pf' ? 'CPF' : 'CNPJ')

function mascaraDoc(tipo: TipoCliente, valor: string) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, tipo === 'pf' ? 11 : 14)
  return tipo === 'pf'
    ? d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : d
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

const EMPTY = { name: '', email: '', phone: '', company: '', tipo: 'pj' as TipoCliente, documento: '', endereco: '' }

export default function ClientsPage() {
  const [rows, setRows] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // O formulário tem endereço próprio: ?novo=1 ou ?editar=<id>; o portal, ?portal=<id>.
  const [novo, setNovo] = useParamEstado('novo')
  const [editarId, setEditarId] = useParamEstado('editar')
  const [portalId, setPortalId] = useParamEstado('portal')
  const [busca, setBusca] = useParamEstado('busca')
  const [portal, setPortal] = useState<{ token: string | null; ativo: boolean; temSenha: boolean; url: string | null } | null>(null)
  const [senhaPortal, setSenhaPortal] = useState('')
  const [copiado, setCopiado] = useState(false)
  const visiveis = useMemo(
    () => filtrarPorTexto(rows, busca || '', (c) => [c.name, c.company, c.email, c.phone, c.documento]),
    [rows, busca]
  )
  const editing = rows.find((c) => String(c.id) === editarId) || null
  const clientePortal = rows.find((c) => String(c.id) === portalId) || null
  const open = novo === '1' || !!editing
  useTitulo(novo === '1' ? 'Novo cliente' : editing ? `Editar ${editing.name}` : clientePortal ? `Portal — ${clientePortal.company || clientePortal.name}` : 'Clientes')

  const load = useCallback(() => {
    setLoading(true)
    api
      .get<{ data: Client[] }>('/clients')
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setError(null)
    if (novo === '1') setForm(EMPTY)
    else if (editing)
      setForm({
        name: editing.name,
        email: editing.email,
        phone: editing.phone,
        company: editing.company,
        tipo: editing.tipo,
        documento: mascaraDoc(editing.tipo, editing.documento),
        endereco: editing.endereco || '',
      })
  }, [novo, editing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clientePortal) return setPortal(null)
    setSenhaPortal('')
    api.get<{ data: any }>(`/clients/${clientePortal.id}/portal`).then((r) => setPortal(r.data))
  }, [clientePortal?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fechar = () => {
    if (novo === '1') setNovo(null)
    else setEditarId(null)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (editing) await api.put(`/clients/${editing.id}`, form)
      else await api.post('/clients', form)
      fechar()
      load()
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Client) => {
    if (!confirm(`Enviar o cliente "${c.company || c.name}" para a lixeira? Imóveis, vistorias e processos dele vão junto (dá para restaurar).`)) return
    try {
      await api.del(`/clients/${c.id}`)
      load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao excluir')
    }
  }

  const salvarPortal = async (campos: Record<string, unknown>) => {
    if (!clientePortal) return
    try {
      const r = await api.put<{ data: any }>(`/clients/${clientePortal.id}/portal`, campos)
      setPortal(r.data)
      load()
    } catch (err: any) {
      alert(err?.message || 'Falha ao salvar')
    }
  }

  const urlPortal = portal?.url || (portal?.token && typeof window !== 'undefined' ? `${window.location.origin}/portal/${portal.token}` : null)

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">Quem contrata. Cada cliente pode ter um portal com o andamento dos processos.</p>
        </div>
        <Button onClick={() => setNovo('1')}>
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por nome, empresa, CPF/CNPJ, e-mail ou telefone…"
          value={busca || ''}
          onChange={(e) => setBusca(e.target.value || null)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-16">Tipo</TableHead>
              <TableHead>CPF/CNPJ</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead className="w-36 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {busca ? `Nenhum cliente encontrado para “${busca}”.` : 'Nenhum cliente cadastrado.'}
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.name}
                    <span className="block text-xs font-normal">
                      <Link href={`/processos?busca=${encodeURIComponent(c.company || c.name)}`} className="text-primary hover:underline">
                        processos
                      </Link>
                      {' · '}
                      <Link href={`/imoveis?busca=${encodeURIComponent(c.company || c.name)}`} className="text-primary hover:underline">
                        imóveis
                      </Link>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.tipo === 'pf' ? 'PF' : 'PJ'}</TableCell>
                  <TableCell className="text-muted-foreground">{mascaraDoc(c.tipo, c.documento) || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.company || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.email || '—'}
                    {c.phone && <span className="block text-xs">{c.phone}</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title={c.portalAtivo ? 'Portal do cliente ativo' : 'Portal do cliente'} onClick={() => setPortalId(String(c.id))}>
                      <Globe className={`h-4 w-4 ${c.portalAtivo ? 'text-primary' : ''}`} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditarId(String(c.id))}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(c)}>
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
            <DialogTitle>{editing ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select
                  className={SELECT_CLASS}
                  value={form.tipo}
                  onChange={(e) => {
                    const tipo = e.target.value as TipoCliente
                    setForm({ ...form, tipo, documento: mascaraDoc(tipo, form.documento) })
                  }}
                >
                  <option value="pj">Pessoa jurídica</option>
                  <option value="pf">Pessoa física</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{rotuloDoc(form.tipo)}</Label>
                <Input
                  inputMode="numeric"
                  placeholder={form.tipo === 'pf' ? '000.000.000-00' : '00.000.000/0000-00'}
                  value={form.documento}
                  onChange={(e) => setForm({ ...form, documento: mascaraDoc(form.tipo, e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              {form.tipo === 'pj' && (
                <p className="text-xs text-muted-foreground">É este nome que aparece como cliente nos imóveis, processos e laudos.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Endereço para correspondência</Label>
              <Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
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

      {/* Portal do cliente */}
      <Dialog open={!!clientePortal} onOpenChange={(o) => !o && setPortalId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Portal do cliente — {clientePortal?.company || clientePortal?.name}</DialogTitle>
          </DialogHeader>
          {portal ? (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Pelo portal o cliente acompanha a etapa dos processos, vê os prazos, envia os documentos pendentes, baixa e aprova os laudos emitidos e “anda o caminho” das fotos das vistorias. Não dá acesso a nada da equipe.
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={portal.ativo} onChange={(e) => salvarPortal({ ativo: e.target.checked })} /> Portal ativo
              </label>
              {portal.ativo && urlPortal && (
                <div className="space-y-2">
                  <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{urlPortal}</p>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard?.writeText(urlPortal)
                        setCopiado(true)
                        setTimeout(() => setCopiado(false), 1500)
                      }}
                    >
                      <Copy className="h-4 w-4" /> {copiado ? 'Copiado' : 'Copiar link'}
                    </Button>
                    <a href={urlPortal} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">
                        <ExternalLink className="h-4 w-4" /> Abrir
                      </Button>
                    </a>
                    <Button size="sm" variant="ghost" onClick={() => confirm('Gerar um link novo? O antigo deixa de funcionar.') && salvarPortal({ novoToken: true })}>
                      Gerar link novo
                    </Button>
                  </span>
                </div>
              )}
              <div className="space-y-1.5 rounded-md border p-3">
                <Label>Senha do portal {portal.temSenha ? '(definida)' : '(sem senha — o link basta)'}</Label>
                <div className="flex gap-2">
                  <Input type="password" value={senhaPortal} onChange={(e) => setSenhaPortal(e.target.value)} placeholder="Nova senha" />
                  <Button size="sm" variant="outline" disabled={!senhaPortal} onClick={() => salvarPortal({ senha: senhaPortal }).then(() => setSenhaPortal(''))}>
                    Definir
                  </Button>
                  {portal.temSenha && (
                    <Button size="sm" variant="ghost" onClick={() => salvarPortal({ senha: '' })}>
                      Remover
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
          <DialogFooter>
            <Button onClick={() => setPortalId(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
