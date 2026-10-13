'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, FileSpreadsheet, Receipt, Wallet } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { dia, dinheiro } from '@/lib/regularizacao'
import { SELECT_CLASS } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

// Financeiro: a verba de campo. É o valor que o escritório disponibiliza ao
// analista para ele conseguir fazer a vistoria — tantos dias fora, tanto de
// almoço, Uber, hospedagem e passagem. A base é a mesma da planilha de
// despesas de viagem (o .xlsx de prestação de contas), só que somada por
// viagem e por analista: quanto saiu, quanto voltou comprovado, o que sobrou.
interface ViagemFinanceiro {
  id: number
  titulo: string
  destino: string
  inicio: string | null
  fim: string | null
  dias: number | null
  responsavelId: number | null
  responsavelNome: string | null
  clientes: string | null
  vistorias: number
  verba: number
  gasto: number
  saldo: number
  porDia: number | null
  encerrada: boolean
  despesas: number
  semComprovante: number
  passagem: number
  hospedagem: number
  transporte: number
  alimentacao: number
  outro: number
}
interface Dados {
  viagens: ViagemFinanceiro[]
  porAnalista: { responsavelId: number; nome: string; viagens: number; dias: number; verba: number; gasto: number; saldo: number }[]
  categorias: Record<string, string>
  // Gasto já separado nas colunas da planilha de despesas de viagem.
  planilha: Record<string, number>
  planilhaLabels: Record<string, string>
  totais: {
    verba: number
    gasto: number
    saldo: number
    dias: number
    aPrestar: number
    excedido: number
    alimentacao: number
    transporte: number
    hospedagem: number
    passagem: number
    outro: number
    semComprovante: number
  }
}

const periodo = (v: ViagemFinanceiro) => {
  if (!v.inicio) return 'sem data'
  const ini = dia(v.inicio)
  return v.fim && v.fim !== v.inicio ? `${ini} a ${dia(v.fim)}` : ini
}

export default function FinanceiroPage() {
  const [d, setD] = useState<Dados | null>(null)
  const [usuarios, setUsuarios] = useState<{ id: number; name: string }[]>([])
  const [inicio, setInicio] = useParamEstado('inicio')
  const [fim, setFim] = useParamEstado('fim')
  const [analista, setAnalista] = useParamEstado('analista')
  const [erro, setErro] = useState<string | null>(null)
  useTitulo('Financeiro')

  const carregar = useCallback(() => {
    const q = new URLSearchParams()
    if (inicio) q.set('inicio', inicio)
    if (fim) q.set('fim', fim)
    if (analista) q.set('responsavelId', analista)
    api
      .get<{ data: Dados }>(`/financeiro?${q}`)
      .then((r) => setD(r.data))
      .catch((e) => setErro(e?.message || 'Sem acesso'))
  }, [inicio, fim, analista])
  useEffect(() => {
    carregar()
  }, [carregar])
  useEffect(() => {
    api.get<{ data: { id: number; name: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [])

  if (erro) return <p className="text-sm text-destructive">{erro}</p>
  if (!d) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const t = d.totais

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Wallet className="h-6 w-6" /> Financeiro
          </h1>
          <p className="text-sm text-muted-foreground">
            A verba de cada ida a campo: o valor disponibilizado ao analista pelos dias de vistoria (alimentação, Uber, hospedagem, passagem) e o que
            já voltou comprovado na planilha de despesas.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <select className={`${SELECT_CLASS} w-auto`} value={analista || ''} onChange={(e) => setAnalista(e.target.value || null)}>
            <option value="">Todos os analistas</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <Input type="date" className="w-40" value={inicio || ''} onChange={(e) => setInicio(e.target.value || null)} title="Viagens a partir de" />
          <span className="text-muted-foreground">a</span>
          <Input type="date" className="w-40" value={fim || ''} onChange={(e) => setFim(e.target.value || null)} title="Até" />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Verba liberada', dinheiro(t.verba), false],
          ['Gasto comprovado', dinheiro(t.gasto), false],
          ['Saldo', dinheiro(t.saldo), t.saldo < 0],
          ['A prestar contas', dinheiro(t.aPrestar), t.aPrestar > 0],
          ['Dias em campo', String(t.dias || 0), false],
        ].map(([r, v, alerta]) => (
          <div key={String(r)} className={`rounded-md border p-3 ${alerta ? 'border-primary/50 bg-primary/5' : ''}`}>
            <p className="text-xs text-muted-foreground">{String(r)}</p>
            <p className={`text-lg font-semibold ${alerta ? 'text-primary' : ''}`}>{String(v)}</p>
          </div>
        ))}
      </div>

      {/* Em que o dinheiro foi gasto — as mesmas colunas da planilha de despesas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" /> Onde a verba foi usada
          </CardTitle>
          <CardDescription>
            Nas mesmas colunas da planilha de despesas de viagem — é o que vai para o Excel de prestação de contas.{' '}
            {t.semComprovante > 0 ? `${t.semComprovante} lançamento(s) ainda sem comprovante.` : 'Todos os lançamentos têm comprovante.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries(d.planilhaLabels).map(([k, label]) => (
              <div key={k} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-base font-semibold">{dinheiro(d.planilha[k] || 0)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Por categoria do sistema: {(['alimentacao', 'transporte', 'hospedagem', 'passagem', 'outro'] as const).map((k) => `${d.categorias[k]} ${dinheiro(t[k])}`).join(' · ')}
          </p>
        </CardContent>
      </Card>

      {/* Uma linha por ida a campo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" /> Verba por viagem
          </CardTitle>
          <CardDescription>
            O valor por dia é a verba dividida pelos dias em campo — é o que o analista tem para almoço, deslocamento e o resto do dia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Viagem</TableHead>
                <TableHead>Analista</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-center">Dias</TableHead>
                <TableHead className="text-right">Verba</TableHead>
                <TableHead className="text-right">Por dia</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="text-right">Planilha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.viagens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    Nenhuma viagem no período. A verba é lançada na viagem, em{' '}
                    <Link href="/viagens" className="text-primary hover:underline">
                      Vistorias → Cronograma
                    </Link>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                d.viagens.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <Link href={`/viagens/${v.id}`} className="font-medium hover:underline">
                        {v.titulo || v.destino || `Viagem #${v.id}`}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {v.destino}
                        {v.vistorias ? ` · ${v.vistorias} vistoria(s)` : ''}
                        {v.clientes ? ` · ${v.clientes}` : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{v.responsavelNome || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{periodo(v)}</TableCell>
                    <TableCell className="text-center text-muted-foreground">{v.dias ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium">{dinheiro(v.verba)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{v.porDia ? dinheiro(v.porDia) : '—'}</TableCell>
                    <TableCell className="text-right">{dinheiro(v.gasto)}</TableCell>
                    <TableCell className={`text-right font-medium ${v.saldo < 0 ? 'text-destructive' : ''}`}>
                      {dinheiro(v.saldo)}
                      {v.encerrada && v.saldo > 0 && <span className="block text-[11px] font-normal text-primary">a prestar contas</span>}
                      {v.semComprovante > 0 && (
                        <span className="block text-[11px] font-normal text-amber-600">
                          <AlertTriangle className="inline h-3 w-3" /> {v.semComprovante} sem comprovante
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <a href={apiUrl(`/viagens/${v.id}/relatorio.xlsx`)}>
                        <Button size="sm" variant="outline" title="Baixar a planilha de despesas desta viagem">
                          <FileSpreadsheet className="h-4 w-4" /> Excel
                        </Button>
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Quanto está na mão de cada um */}
      {d.porAnalista.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Por analista</CardTitle>
            <CardDescription>Quanto cada um recebeu para ir a campo no período e quanto já comprovou.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.porAnalista.map((a) => (
                <li key={a.responsavelId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{a.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.viagens} viagem(ns) · {a.dias} dia(s)
                  </span>
                  <span className="w-28 text-right">{dinheiro(a.verba)}</span>
                  <span className="w-28 text-right text-muted-foreground">{dinheiro(a.gasto)}</span>
                  <span className={`w-28 text-right font-medium ${a.saldo < 0 ? 'text-destructive' : ''}`}>{dinheiro(a.saldo)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
