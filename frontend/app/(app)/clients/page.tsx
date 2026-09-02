'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Search, Trash2 } from 'lucide-react'
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

const EMPTY = { name: '', email: '', phone: '', company: '', tipo: 'pj' as TipoCliente, documento: '' }

export default function ClientsPage() {
  const [rows, setRows] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // O formulário tem endereço próprio: ?novo=1 ou ?editar=<id>.
  const [novo, setNovo] = useParamEstado('novo')
  const [editarId, setEditarId] = useParamEstado('editar')
  // A busca fica na URL: dá para salvar/compartilhar o resultado.
  const [busca, setBusca] = useParamEstado('busca')
  const visiveis = useMemo(
    () => filtrarPorTexto(rows, busca || '', (c) => [c.name, c.company, c.email, c.phone, c.documento]),
    [rows, busca]
  )
  const editing = rows.find((c) => String(c.id) === editarId) || null
  const open = novo === '1' || !!editing
  useTitulo(novo === '1' ? 'Novo cliente' : editing ? `Editar ${editing.name}` : 'Clientes')

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

  // Ao abrir (inclusive por link direto ou voltar), preenche o formulário.
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
      })
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
    if (!confirm(`Excluir o cliente "${c.name}"?`)) return
    try {
      await api.del(`/clients/${c.id}`)
      load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao excluir')
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">Gerencie os clientes do sistema.</p>
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
              <TableHead>E-mail</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {busca ? `Nenhum cliente encontrado para “${busca}”.` : 'Nenhum cliente cadastrado.'}
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.tipo === 'pf' ? 'PF' : 'PJ'}</TableCell>
                  <TableCell className="text-muted-foreground">{mascaraDoc(c.tipo, c.documento) || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.company || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone || '—'}</TableCell>
                  <TableCell className="text-right">
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
                {/* Trocar o tipo remascara o que já foi digitado (e corta o que
                    sobra), para não guardar um CNPJ no campo de CPF. */}
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
                <p className="text-xs text-muted-foreground">
                  É este nome que aparece como cliente nos imóveis e nas vistorias.
                </p>
              )}
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
    </div>
  )
}
