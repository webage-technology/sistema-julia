'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Plane, Plus, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS, filtrarPorTexto } from '@/lib/vistorias'
import { ABAS_VISTORIAS, Abas } from '@/components/abas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

interface Viagem {
  id: number
  titulo: string
  destino: string
  inicio: string | null
  fim: string | null
  verba: number
  gasto: number
  responsavelNome: string | null
  vistorias: number
  itens: number
  clientes: string | null
}

const dinheiro = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (s: string | null) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '')

const periodo = (v: Viagem) => {
  if (!v.inicio && !v.fim) return '—'
  if (v.inicio && v.fim && v.inicio !== v.fim) return `${dia(v.inicio)} a ${dia(v.fim)}`
  return dia(v.inicio || v.fim)
}

export default function ViagensPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Viagem[]>([])
  const [usuarios, setUsuarios] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [nova, setNova] = useParamEstado('nova')
  const [busca, setBusca] = useParamEstado('busca')
  const [form, setForm] = useState({ titulo: '', destino: '', inicio: '', fim: '', verba: '', responsavelId: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  useTitulo(nova === '1' ? 'Nova viagem' : 'Viagens')

  useEffect(() => {
    api
      .get<{ data: Viagem[] }>('/viagens')
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false))
    api.get<{ data: { id: number; name: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [])

  useEffect(() => {
    if (nova === '1') {
      setForm({ titulo: '', destino: '', inicio: '', fim: '', verba: '', responsavelId: '' })
      setErro(null)
    }
  }, [nova])

  const visiveis = useMemo(
    () => filtrarPorTexto(rows, busca || '', (v) => [v.titulo, v.destino, v.clientes, v.responsavelNome]),
    [rows, busca]
  )

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/viagens', form)
      router.push(`/viagens/${r.data.id}`)
    } catch (err: any) {
      setErro(err?.message || 'Erro ao criar')
      setSalvando(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Abas itens={ABAS_VISTORIAS} />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Plane className="h-6 w-6" /> Viagens
          </h1>
          <p className="text-sm text-muted-foreground">
            Uma viagem cobre várias vistorias — cronograma, verba e comprovantes em um lugar só.
          </p>
        </div>
        <Button onClick={() => setNova('1')}>
          <Plus className="h-4 w-4" /> Nova viagem
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por destino, título, cliente ou responsável…"
          value={busca || ''}
          onChange={(e) => setBusca(e.target.value || null)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Viagem</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead className="text-center">Vistorias</TableHead>
              <TableHead className="text-right">Verba</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
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
                  {busca ? `Nenhuma viagem para “${busca}”.` : 'Nenhuma viagem — crie a primeira.'}
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((v) => (
                <TableRow key={v.id} className="cursor-pointer" onClick={() => router.push(`/viagens/${v.id}`)}>
                  <TableCell>
                    <span className="font-medium">{v.titulo || v.destino || `Viagem #${v.id}`}</span>
                    {v.destino && v.titulo !== v.destino && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {v.destino}
                      </span>
                    )}
                    {v.clientes && <p className="truncate text-xs text-muted-foreground">{v.clientes}</p>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{periodo(v)}</TableCell>
                  <TableCell className="text-muted-foreground">{v.responsavelNome || '—'}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{v.vistorias}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{dinheiro(v.verba)}</TableCell>
                  <TableCell className={`text-right ${v.verba > 0 && v.gasto > v.verba ? 'text-destructive' : ''}`}>
                    {dinheiro(v.gasto)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={nova === '1'} onOpenChange={(o) => !o && setNova(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova viagem</DialogTitle>
          </DialogHeader>
          <form onSubmit={criar} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ex.: Cuiabá — escolas do grupo"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Destino</Label>
                <Input
                  value={form.destino}
                  onChange={(e) => setForm({ ...form, destino: e.target.value })}
                  placeholder="Cidade - UF"
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Ida</Label>
                <Input type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Volta</Label>
                <Input type="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Verba (R$)</Label>
                <Input value={form.verba} onChange={(e) => setForm({ ...form, verba: e.target.value })} placeholder="0,00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <select
                className={SELECT_CLASS}
                value={form.responsavelId}
                onChange={(e) => setForm({ ...form, responsavelId: e.target.value })}
              >
                <option value="">Não definido</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNova(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Criando…' : 'Criar viagem'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
