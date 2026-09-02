'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Plus, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import {
  Imovel,
  SELECT_CLASS,
  STATUS_COR,
  STATUS_LABEL,
  TIPOS_SERVICO,
  VistoriaResumo,
  filtrarPorTexto,
} from '@/lib/vistorias'
import { ABAS_VISTORIAS, Abas } from '@/components/abas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

export default function VistoriasPage() {
  const router = useRouter()
  const [rows, setRows] = useState<VistoriaResumo[]>([])
  const [imoveis, setImoveis] = useState<Imovel[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ imovelId: '', tipoServico: TIPOS_SERVICO[0], dataVistoria: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // O formulário de criação tem endereço próprio: /vistorias?nova=1
  const [nova, setNova] = useParamEstado('nova')
  const open = nova === '1'
  useTitulo(open ? 'Nova vistoria' : 'Vistorias')
  const [busca, setBusca] = useParamEstado('busca')
  const visiveis = useMemo(
    () =>
      filtrarPorTexto(rows, busca || '', (v) => [
        v.imovelNome,
        v.clienteNome,
        v.tipoServico,
        STATUS_LABEL[v.status],
        `#${v.id}`,
      ]),
    [rows, busca]
  )

  useEffect(() => {
    if (open) {
      setForm({ imovelId: '', tipoServico: TIPOS_SERVICO[0], dataVistoria: '' })
      setError(null)
    }
  }, [open])

  useEffect(() => {
    api
      .get<{ data: VistoriaResumo[] }>('/vistorias')
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false))
    api.get<{ data: Imovel[] }>('/imoveis').then((r) => setImoveis(r.data))
  }, [])

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/vistorias', {
        ...form,
        dataVistoria: form.dataVistoria || null,
      })
      router.push(`/vistorias/${r.data.id}`)
    } catch (err: any) {
      setError(err?.message || 'Erro ao criar')
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Abas itens={ABAS_VISTORIAS} />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vistorias</h1>
          <p className="text-sm text-muted-foreground">Capture, confira e exporte as fotos de cada vistoria.</p>
        </div>
        <span className="flex gap-2">
          <Button onClick={() => router.push('/iniciar')}>
            <Camera className="h-4 w-4" /> Iniciar vistoria
          </Button>
          <Button variant="outline" onClick={() => setNova('1')}>
            <Plus className="h-4 w-4" /> Nova vistoria
          </Button>
        </span>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por imóvel, cliente, tipo de serviço ou status…"
          value={busca || ''}
          onChange={(e) => setBusca(e.target.value || null)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>Imóvel</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-center">Fotos</TableHead>
              <TableHead>Status</TableHead>
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
                  {busca
                    ? `Nenhuma vistoria encontrada para “${busca}”.`
                    : 'Nenhuma vistoria — crie a primeira em “Nova vistoria”.'}
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((v) => (
                <TableRow key={v.id} className="cursor-pointer" onClick={() => router.push(`/vistorias/${v.id}`)}>
                  <TableCell className="font-medium">#{v.id}</TableCell>
                  <TableCell>{v.imovelNome}</TableCell>
                  <TableCell className="text-muted-foreground">{v.clienteNome}</TableCell>
                  <TableCell className="text-muted-foreground">{v.tipoServico || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {v.dataVistoria ? v.dataVistoria.split('-').reverse().join('/') : '—'}
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">{v.fotos}</TableCell>
                  <TableCell>
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COR[v.status] || ''}`}>
                      {STATUS_LABEL[v.status] || v.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !o && setNova(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova vistoria</DialogTitle>
          </DialogHeader>
          <form onSubmit={criar} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Imóvel</Label>
              <select
                className={SELECT_CLASS}
                value={form.imovelId}
                onChange={(e) => setForm({ ...form, imovelId: e.target.value })}
                required
              >
                <option value="">Selecione…</option>
                {imoveis.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome} — {i.clienteNome}
                  </option>
                ))}
              </select>
              {imoveis.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum imóvel — cadastre primeiro em Imóveis.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo de serviço</Label>
                <select
                  className={SELECT_CLASS}
                  value={form.tipoServico}
                  onChange={(e) => setForm({ ...form, tipoServico: e.target.value })}
                >
                  {TIPOS_SERVICO.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Data prevista</Label>
                <Input
                  type="date"
                  value={form.dataVistoria}
                  onChange={(e) => setForm({ ...form, dataVistoria: e.target.value })}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNova(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Criando…' : 'Criar vistoria'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
