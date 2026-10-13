'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, FolderOpen, LayoutGrid, List, Plus, Search, Stamp } from 'lucide-react'
import { api } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { ClienteOpcao, Imovel, SELECT_CLASS, filtrarPorTexto, nomeDoCliente } from '@/lib/vistorias'
import { ETAPAS, ETAPA_COR, ETAPA_LABEL, Processo, TIPOS_PROCESSO, dia } from '@/lib/regularizacao'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

// Processos: o quadro por etapa (o "em que pé está" de cada cliente) e a
// lista. Tudo na URL: ?etapa=, ?busca=, ?ver=lista, ?novo=1.
export default function ProcessosPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Processo[]>([])
  const [clientes, setClientes] = useState<ClienteOpcao[]>([])
  const [imoveis, setImoveis] = useState<Imovel[]>([])
  const [usuarios, setUsuarios] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [etapa, setEtapa] = useParamEstado('etapa')
  const [busca, setBusca] = useParamEstado('busca')
  const [ver, setVer] = useParamEstado('ver')
  const [novo, setNovo] = useParamEstado('novo')
  const [responsavel, setResponsavel] = useParamEstado('responsavel')
  const [arquivados, setArquivados] = useParamEstado('arquivados')
  const open = novo === '1'
  const [form, setForm] = useState({ clientId: '', imovelId: '', titulo: '', tipo: TIPOS_PROCESSO[0], responsavelId: '', previsao: '', descricao: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  useTitulo(open ? 'Novo processo' : 'Processos')

  const carregar = useCallback(() => {
    setLoading(true)
    api
      .get<{ data: Processo[] }>(`/processos${responsavel ? `?responsavelId=${responsavel}` : ''}`)
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false))
  }, [responsavel])
  useEffect(() => {
    carregar()
  }, [carregar])
  useEffect(() => {
    api.get<{ data: ClienteOpcao[] }>('/clients').then((r) => setClientes(r.data))
    api.get<{ data: Imovel[] }>('/imoveis').then((r) => setImoveis(r.data))
    api.get<{ data: { id: number; name: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [])

  useEffect(() => {
    if (open) {
      setForm({ clientId: '', imovelId: '', titulo: '', tipo: TIPOS_PROCESSO[0], responsavelId: '', previsao: '', descricao: '' })
      setErro(null)
    }
  }, [open])

  const visiveis = useMemo(() => {
    let lista = rows
    if (arquivados !== '1') lista = lista.filter((p) => p.etapa !== 'arquivado')
    if (etapa) lista = lista.filter((p) => p.etapa === etapa)
    return filtrarPorTexto(lista, busca || '', (p) => [p.numero, p.titulo, p.tipo, p.clienteNome, p.imovelNome, p.responsavelNome])
  }, [rows, etapa, busca, arquivados])

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/processos', {
        ...form,
        imovelId: form.imovelId || null,
        responsavelId: form.responsavelId || null,
        previsao: form.previsao || null,
      })
      router.push(`/processos/${r.data.id}`)
    } catch (err: any) {
      setErro(err?.message || 'Erro ao criar')
      setSalvando(false)
    }
  }

  const imoveisDoCliente = imoveis.filter((i) => String(i.clientId) === form.clientId)
  const modoLista = ver === 'lista'

  const Cartao = ({ p }: { p: Processo }) => (
    <Link href={`/processos/${p.id}`} className="block rounded-md border bg-card p-3 text-sm shadow-sm transition-colors hover:bg-accent/50">
      <p className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{p.numero}</span>
        {p.prioridade === 'urgente' && <span className="rounded bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">URGENTE</span>}
        {p.prioridade === 'alta' && <span className="rounded bg-zinc-900 px-1.5 text-[10px] font-semibold text-white">ALTA</span>}
      </p>
      <p className="font-medium leading-tight">{p.titulo}</p>
      <p className="truncate text-xs text-muted-foreground">
        {p.clienteNome}
        {p.imovelNome ? ` · ${p.imovelNome}` : ''}
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {p.proximoPrazo && (
          <span className={`flex items-center gap-1 ${p.proximoPrazo < new Date().toISOString().slice(0, 10) ? 'font-semibold text-primary' : ''}`}>
            <Stamp className="h-3 w-3" /> {dia(p.proximoPrazo)}
          </span>
        )}
        {p.docsPendentes > 0 && (
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {p.docsPendentes} doc.
          </span>
        )}
        {p.responsavelNome && <span className="ml-auto truncate">{p.responsavelNome.split(' ')[0]}</span>}
      </p>
    </Link>
  )

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FolderOpen className="h-6 w-6" /> Processos
          </h1>
          <p className="text-sm text-muted-foreground">
            Cada regularização, habite-se ou AVCB é um processo: etapa, prazos com a prefeitura, documentos e vistorias num lugar só.
          </p>
        </div>
        <span className="flex gap-2">
          <Button variant="outline" size="icon" title={modoLista ? 'Ver quadro' : 'Ver lista'} onClick={() => setVer(modoLista ? null : 'lista')}>
            {modoLista ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </Button>
          <Button onClick={() => setNovo('1')}>
            <Plus className="h-4 w-4" /> Novo processo
          </Button>
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por número, título, cliente, imóvel…" value={busca || ''} onChange={(e) => setBusca(e.target.value || null)} />
        </div>
        <select className={`${SELECT_CLASS} w-auto`} value={responsavel || ''} onChange={(e) => setResponsavel(e.target.value || null)}>
          <option value="">Todos os responsáveis</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        {modoLista && (
          <select className={`${SELECT_CLASS} w-auto`} value={etapa || ''} onChange={(e) => setEtapa(e.target.value || null)}>
            <option value="">Todas as etapas</option>
            {ETAPAS.map((e) => (
              <option key={e} value={e}>
                {ETAPA_LABEL[e]}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={arquivados === '1'} onChange={(e) => setArquivados(e.target.checked ? '1' : null)} /> mostrar arquivados
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : modoLista ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Processo</TableHead>
                <TableHead>Cliente / imóvel</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>Próximo prazo</TableHead>
                <TableHead className="text-center">Docs.</TableHead>
                <TableHead>Responsável</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {busca ? `Nenhum processo para “${busca}”.` : 'Nenhum processo — crie o primeiro.'}
                  </TableCell>
                </TableRow>
              ) : (
                visiveis.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/processos/${p.id}`)}>
                    <TableCell className="font-mono text-xs">{p.numero}</TableCell>
                    <TableCell>
                      <span className="font-medium">{p.titulo}</span>
                      <span className="block text-xs text-muted-foreground">{p.tipo}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.clienteNome}
                      {p.imovelNome ? <span className="block text-xs">{p.imovelNome}</span> : null}
                    </TableCell>
                    <TableCell>
                      <span className={`rounded px-2 py-0.5 text-xs ${ETAPA_COR[p.etapa] || ''}`}>{ETAPA_LABEL[p.etapa] || p.etapa}</span>
                    </TableCell>
                    <TableCell className={p.proximoPrazo && p.proximoPrazo < new Date().toISOString().slice(0, 10) ? 'font-semibold text-primary' : 'text-muted-foreground'}>
                      {p.proximoPrazo ? dia(p.proximoPrazo) : '—'}
                    </TableCell>
                    <TableCell className={`text-center ${p.docsPendentes ? 'text-primary' : 'text-muted-foreground'}`}>{p.docsPendentes || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{p.responsavelNome || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      ) : (
        // Colunas que encolhem junto com a tela: antes tinham largura mínima
        // fixa e a última saía da área visível, escondendo o número de
        // processos da etapa ("Levantamento 0"). Agora o nome é que corta, e a
        // contagem fica sempre à vista.
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {ETAPAS.filter((e) => e !== 'arquivado' || arquivados === '1').map((e) => {
            const lista = visiveis.filter((p) => p.etapa === e)
            return (
              <div key={e} className="min-w-0 space-y-2">
                <p className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${ETAPA_COR[e]}`} title={`${ETAPA_LABEL[e]}: ${lista.length}`}>
                  <span className="min-w-0 flex-1 truncate">{ETAPA_LABEL[e]}</span>
                  <span className="shrink-0 tabular-nums">{lista.length}</span>
                </p>
                {lista.map((p) => (
                  <Cartao key={p.id} p={p} />
                ))}
                {lista.length === 0 && <p className="px-2 text-xs text-muted-foreground">—</p>}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Novo processo</DialogTitle>
          </DialogHeader>
          <form onSubmit={criar} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <select className={SELECT_CLASS} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value, imovelId: '' })} required>
                <option value="">Selecione…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomeDoCliente(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Imóvel (opcional)</Label>
              <select className={SELECT_CLASS} value={form.imovelId} onChange={(e) => setForm({ ...form, imovelId: e.target.value })} disabled={!form.clientId}>
                <option value="">Sem imóvel definido</option>
                {imoveisDoCliente.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo de serviço</Label>
                <select className={SELECT_CLASS} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  {TIPOS_PROCESSO.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">Define a lista de documentos exigidos.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Previsão de conclusão</Label>
                <Input type="date" value={form.previsao} onChange={(e) => setForm({ ...form, previsao: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Regularização do galpão para habite-se" required />
            </div>
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <select className={SELECT_CLASS} value={form.responsavelId} onChange={(e) => setForm({ ...form, responsavelId: e.target.value })}>
                <option value="">Eu mesmo</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Descrição / escopo</Label>
              <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovo(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando || !form.clientId || !form.titulo.trim()}>
                {salvando ? 'Criando…' : 'Criar processo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
