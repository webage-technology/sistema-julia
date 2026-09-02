'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Trash2, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { ClienteOpcao, Imovel, SELECT_CLASS, filtrarPorTexto, nomeDoCliente } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

export default function ImoveisPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Imovel[]>([])
  const [clientes, setClientes] = useState<ClienteOpcao[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ clientId: '', nome: '', endereco: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // O formulário de cadastro tem endereço próprio: /imoveis?novo=1
  const [novo, setNovo] = useParamEstado('novo')
  const open = novo === '1'
  useTitulo(open ? 'Novo imóvel' : 'Imóveis')
  const [busca, setBusca] = useParamEstado('busca')
  const visiveis = useMemo(
    () => filtrarPorTexto(rows, busca || '', (i) => [i.nome, i.clienteNome, i.endereco]),
    [rows, busca]
  )

  const load = () => {
    setLoading(true)
    api
      .get<{ data: Imovel[] }>('/imoveis')
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    api.get<{ data: ClienteOpcao[] }>('/clients').then((r) => setClientes(r.data))
  }, [])

  // Ao abrir (inclusive por link direto ou voltar), zera o formulário.
  useEffect(() => {
    if (open) {
      setForm({ clientId: '', nome: '', endereco: '' })
      setError(null)
    }
  }, [open])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/imoveis', form)
      router.push(`/imoveis/${r.data.id}`)
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (i: Imovel) => {
    if (!confirm(`Excluir o imóvel "${i.nome}"? Todas as vistorias e fotos dele serão apagadas.`)) return
    try {
      await api.del(`/imoveis/${i.id}`)
      load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao excluir')
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Imóveis</h1>
          <p className="text-sm text-muted-foreground">
            Cada imóvel guarda a planta e o modelo de pavimentos/ambientes usado nas vistorias.
          </p>
        </div>
        <Button onClick={() => setNovo('1')}>
          <Plus className="h-4 w-4" /> Novo imóvel
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por imóvel, cliente ou endereço…"
          value={busca || ''}
          onChange={(e) => setBusca(e.target.value || null)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead className="text-center">Vistorias</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
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
                  {busca ? `Nenhum imóvel encontrado para “${busca}”.` : 'Nenhum imóvel cadastrado.'}
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((i) => (
                <TableRow key={i.id} className="cursor-pointer" onClick={() => router.push(`/imoveis/${i.id}`)}>
                  <TableCell className="font-medium">{i.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{i.clienteNome}</TableCell>
                  <TableCell className="text-muted-foreground">{i.endereco || '—'}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{i.vistorias}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => router.push(`/imoveis/${i.id}`)}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo imóvel</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <select
                className={SELECT_CLASS}
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                required
              >
                <option value="">Selecione…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomeDoCliente(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Nome do imóvel</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Galpão Rua das Flores"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Endereço</Label>
              <Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovo(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Salvando…' : 'Criar imóvel'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
