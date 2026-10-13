'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarDays, Camera, CircleCheck, FileCheck, FileClock, FolderOpen, HardDrive, MapPin, Stamp, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { useTitulo } from '@/lib/url'
import { ETAPAS, ETAPA_COR, ETAPA_LABEL, Prazo, dinheiro, dia, dataHora } from '@/lib/regularizacao'
import { STATUS_COR, STATUS_LABEL } from '@/lib/vistorias'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// Painel: o que precisa de atenção hoje — a sua próxima vistoria, as próximas
// vistorias do escritório, os relatórios pendentes, prazos, processos por etapa,
// documentos faltando, verba de viagem e o backup.
interface Painel {
  processos: { total: number; porEtapa: Record<string, number>; atrasados: number }
  prazos: { itens: Prazo[]; total: number; vencidos: number }
  vistorias: { proximas: any[]; relatoriosPendentes: any[]; porStatus: Record<string, number>; fotosMes: number }
  minhas: { abertas: number; hoje: number; relatorios: number; proxima: any | null }
  documentos: { n: number; processos: number }
  financeiro: { verbaEmCampo: number; gastoMes: number; aPrestarContas: number }
  notificacoes: { naoLidas: number }
  laudos: any[]
  backup: { configurado: boolean; ultimo: { em: string; nome: string } | null; atrasado: boolean } | null
}

// Distância até a vistoria em palavra, que é como se fala da agenda de campo.
const quando = (dias: number | null | undefined) =>
  dias == null ? 'sem data' : dias <= 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`

export default function PainelPage() {
  const router = useRouter()
  const [d, setD] = useState<Painel | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useTitulo('Painel')

  useEffect(() => {
    api
      .get<{ data: Painel }>('/painel')
      .then((r) => setD(r.data))
      .catch((e) => setErro(e?.message || 'Falha ao carregar'))
  }, [])

  if (erro) return <p className="text-sm text-destructive">{erro}</p>
  if (!d) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const Numero = ({ rotulo, valor, alerta, href }: { rotulo: string; valor: string | number; alerta?: boolean; href?: string }) => {
    const corpo = (
      <div className={`rounded-md border p-3 ${alerta ? 'border-primary/50 bg-primary/5' : ''}`}>
        <p className="text-xs text-muted-foreground">{rotulo}</p>
        <p className={`text-xl font-semibold ${alerta ? 'text-primary' : ''}`}>{valor}</p>
      </div>
    )
    return href ? <Link href={href}>{corpo}</Link> : corpo
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Painel</h1>
        <p className="text-sm text-muted-foreground">O que precisa de atenção hoje, {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Numero rotulo="Próximas vistorias" valor={d.vistorias.proximas.length} href="/vistorias" />
        <Numero rotulo="Vistorias em campo" valor={d.vistorias.porStatus.campo || 0} href="/vistorias" />
        <Numero rotulo="Relatórios pendentes" valor={d.vistorias.porStatus.relatorio || 0} alerta={(d.vistorias.porStatus.relatorio || 0) > 0} href="/vistorias" />
        <Numero rotulo="Prazos em 7 dias" valor={d.prazos.total} alerta={d.prazos.vencidos > 0} href="/agenda" />
        <Numero rotulo="Processos ativos" valor={d.processos.total - (d.processos.porEtapa.concluido || 0) - (d.processos.porEtapa.arquivado || 0)} href="/processos" />
        <Numero rotulo="Docs. obrigatórios faltando" valor={d.documentos.n} alerta={d.documentos.n > 0} href="/processos" />
      </div>

      {/* A vistoria de quem está olhando o painel: o que ele precisa saber para sair para o campo. */}
      {d.minhas.proxima && (
        <Card className="border-primary/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" /> Sua próxima vistoria · {quando(d.minhas.proxima.dias)}
            </CardTitle>
            <CardDescription>
              Você é o responsável — {d.minhas.abertas} vistoria(s) em aberto no seu nome
              {d.minhas.relatorios > 0 ? ` · ${d.minhas.relatorios} aguardando relatório` : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-lg font-semibold">{d.minhas.proxima.imovelNome}</p>
              <p className="text-sm text-muted-foreground">
                {dia(d.minhas.proxima.dataVistoria)} · {d.minhas.proxima.clienteNome} · {d.minhas.proxima.tipoServico || 'sem tipo'}
              </p>
              {d.minhas.proxima.endereco && (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {d.minhas.proxima.endereco}
                  {d.minhas.proxima.municipio ? ` — ${d.minhas.proxima.municipio}${d.minhas.proxima.uf ? `/${d.minhas.proxima.uf}` : ''}` : ''}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Numero rotulo="Ambientes previstos" valor={d.minhas.proxima.ambientes} />
              <Numero rotulo="Fotos já enviadas" valor={d.minhas.proxima.fotos} />
              <Numero rotulo="Planta" valor={d.minhas.proxima.temPlanta ? 'sim' : 'não'} alerta={!d.minhas.proxima.temPlanta} />
              <Numero rotulo="Etapa" valor={STATUS_LABEL[d.minhas.proxima.status] || d.minhas.proxima.status} />
            </div>
            {(d.minhas.proxima.participantes || d.minhas.proxima.processoNumero || d.minhas.proxima.viagemTitulo) && (
              <p className="text-sm text-muted-foreground">
                {d.minhas.proxima.participantes ? `Participantes: ${d.minhas.proxima.participantes}. ` : ''}
                {d.minhas.proxima.processoNumero ? `Processo ${d.minhas.proxima.processoNumero}. ` : ''}
                {d.minhas.proxima.viagemTitulo ? `Viagem: ${d.minhas.proxima.viagemTitulo}.` : ''}
              </p>
            )}
            <Button size="sm" onClick={() => router.push(`/vistorias/${d.minhas.proxima.id}`)}>
              Abrir vistoria
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Próximas vistorias */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" /> Próximas vistorias
            </CardTitle>
            <CardDescription>
              {d.vistorias.fotosMes} fotos enviadas neste mês ·{' '}
              {Object.entries(d.vistorias.porStatus)
                .map(([s, n]) => `${n} ${STATUS_LABEL[s] || s}`)
                .join(' · ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.vistorias.proximas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma vistoria marcada daqui para frente.</p>
            ) : (
              <ul className="divide-y">
                {d.vistorias.proximas.map((v) => (
                  <li key={v.id}>
                    <Link href={`/vistorias/${v.id}`} className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50">
                      <span className={`w-16 shrink-0 text-xs font-semibold ${v.dias <= 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                        {quando(v.dias)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{v.imovelNome}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {dia(v.dataVistoria)} · {v.clienteNome} · {v.tipoServico || 'sem tipo'}
                          {v.responsavelNome ? ` · ${v.responsavelNome}` : ''}
                        </span>
                      </span>
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COR[v.status] || ''}`}>{STATUS_LABEL[v.status] || v.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/agenda')}>
              <CalendarDays className="h-4 w-4" /> Abrir agenda
            </Button>
          </CardContent>
        </Card>

        {/* Relatórios pendentes: o campo acabou e o laudo não saiu. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileClock className="h-4 w-4" /> Relatórios pendentes
            </CardTitle>
            <CardDescription>Vistorias com as fotos encerradas, esperando o relatório.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.vistorias.relatoriosPendentes.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleCheck className="h-4 w-4" /> Nenhum relatório pendente.
              </p>
            ) : (
              <ul className="divide-y">
                {d.vistorias.relatoriosPendentes.map((v) => (
                  <li key={v.id}>
                    <Link href={`/vistorias/${v.id}/relatorio`} className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50">
                      <span className={`w-14 shrink-0 text-xs font-semibold ${v.diasParado > 7 ? 'text-primary' : 'text-muted-foreground'}`}>
                        {v.diasParado == null ? '—' : `${v.diasParado}d`}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{v.imovelNome}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {v.clienteNome} · {v.tipoServico || 'sem tipo'}
                          {v.responsavelNome ? ` · ${v.responsavelNome}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{v.rascunhos > 0 ? 'rascunho' : 'não começou'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Prazos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stamp className="h-4 w-4" /> Prazos próximos
            </CardTitle>
            <CardDescription>Comunique-se e validade de documentos dos próximos 7 dias.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.prazos.itens.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleCheck className="h-4 w-4" /> Nenhum prazo nos próximos 7 dias.
              </p>
            ) : (
              <ul className="divide-y">
                {d.prazos.itens.map((p) => (
                  <li key={p.chave}>
                    <Link href={p.link} className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50">
                      <span className={`w-14 shrink-0 text-xs font-semibold ${p.vencido ? 'text-primary' : 'text-muted-foreground'}`}>
                        {p.vencido ? 'VENCIDO' : `${p.dias}d`}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.titulo}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {dia(p.data)} · {p.processoNumero} · {p.clienteNome}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Processos por etapa */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4" /> Processos por etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {ETAPAS.map((e) => (
                <Link key={e} href={`/processos?etapa=${e}`} className={`rounded-md px-3 py-2 text-sm ${ETAPA_COR[e]}`}>
                  <span className="font-semibold">{d.processos.porEtapa[e] || 0}</span> {ETAPA_LABEL[e]}
                </Link>
              ))}
            </div>
            {d.processos.total === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhum processo ainda.{' '}
                <Link href="/processos?novo=1" className="text-primary hover:underline">
                  Abra o primeiro
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>

        {/* Financeiro: a verba que o analista leva para campo */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" /> Verba de viagem
            </CardTitle>
            <CardDescription>O que foi disponibilizado aos analistas para fazer as vistorias.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <Numero rotulo="Em campo" valor={dinheiro(d.financeiro.verbaEmCampo)} href="/financeiro" />
            <Numero rotulo="Gasto no mês" valor={dinheiro(d.financeiro.gastoMes)} href="/financeiro" />
            <Numero rotulo="A prestar contas" valor={dinheiro(d.financeiro.aPrestarContas)} alerta={d.financeiro.aPrestarContas > 0} href="/financeiro" />
          </CardContent>
        </Card>

        {/* Últimos laudos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck className="h-4 w-4" /> Últimos laudos emitidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.laudos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum laudo emitido em PDF ainda.</p>
            ) : (
              <ul className="divide-y">
                {d.laudos.map((l) => (
                  <li key={l.id}>
                    <Link href={`/vistorias/${l.vistoriaId}/relatorio?modelo=${l.modelo}`} className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50">
                      <span className="font-mono text-xs">{l.numero} v{l.versao}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {l.titulo} · {l.imovelNome}
                      </span>
                      <span className="text-xs text-muted-foreground">{dataHora(l.emitidoEm)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Backup (só administrador) */}
        {d.backup && (
          <Card className={d.backup.atrasado ? 'border-primary/50' : ''}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="h-4 w-4" /> Backup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {d.backup.ultimo ? (
                <p>
                  Última cópia: <strong>{dataHora(d.backup.ultimo.em)}</strong> ({d.backup.ultimo.nome})
                </p>
              ) : (
                <p className="flex items-center gap-2 text-primary">
                  <AlertTriangle className="h-4 w-4" /> Nenhuma cópia encontrada.
                </p>
              )}
              {d.backup.atrasado && (
                <p className="text-muted-foreground">
                  O banco e as fotos vivem só nesta máquina. Configure a tarefa agendada em{' '}
                  <Link href="/configuracoes?aba=backup" className="text-primary hover:underline">
                    Configurações → Backup
                  </Link>
                  .
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
