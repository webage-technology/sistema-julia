'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Camera,
  CircleAlert,
  CircleCheck,
  Download,
  // (Camera é usado no botão principal e nos contadores de fotos)
  FileText,
  Images,
  Pencil,
  Plus,
  Plane,
  Printer,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS, STATUS_COR, STATUS_LABEL, TIPOS_SERVICO, VistoriaDetalhe, emRelatorio } from '@/lib/vistorias'
import { Abas, abasDaVistoria } from '@/components/abas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Lote {
  total: number
  feitas: number
  erros: string[]
}

export default function VistoriaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)
  const arquivosRef = useRef<HTMLInputElement>(null)
  const [lote, setLote] = useState<Lote | null>(null)
  // Diálogos com endereço próprio: ?captura=1 (link/QR) · ?editar=1
  const [captura, setCaptura] = useParamEstado('captura')
  const [editar, setEditar] = useParamEstado('editar')
  const [finalizar, setFinalizar] = useParamEstado('finalizar')
  const capturaOpen = captura === '1'
  const editOpen = editar === '1'
  const [capturaUrl, setCapturaUrl] = useState('')
  const [editForm, setEditForm] = useState({ tipoServico: '', dataVistoria: '', participantes: '' })
  const [ren, setRen] = useState<{ tipo: 'pavimento' | 'ambiente'; id: number; nome: string } | null>(null)
  const [novoAmb, setNovoAmb] = useState<Record<number, string>>({})
  const [novoPav, setNovoPav] = useState('')
  const [usuarios, setUsuarios] = useState<{ id: number; name: string }[]>([])

  const load = useCallback(() => {
    api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`).then((r) => setDet(r.data))
  }, [id])
  useEffect(() => {
    load()
    api.get<{ data: { id: number; name: string }[] }>('/users').then((r) => setUsuarios(r.data))
  }, [load])

  useTitulo(det ? `Vistoria #${det.id} — ${det.imovelNome}` : 'Vistoria')

  // Preenche os formulários ao abrir (inclusive por link direto ou voltar).
  useEffect(() => {
    if (capturaOpen) setCapturaUrl(`${window.location.origin}/captura/${id}`)
  }, [capturaOpen, id])
  useEffect(() => {
    if (editOpen && det) {
      setEditForm({
        tipoServico: det.tipoServico,
        dataVistoria: det.dataVistoria || '',
        participantes: det.participantes,
      })
    }
  }, [editOpen, det])

  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  // Upload em lote: uma foto por requisição, 3 em paralelo, com progresso.
  // A data de captura vem do EXIF no servidor; lastModified é só fallback.
  const enviarLote = async (files: FileList | null) => {
    if (!files?.length) return
    const lista = Array.from(files)
    setLote({ total: lista.length, feitas: 0, erros: [] })
    let i = 0
    const worker = async () => {
      while (i < lista.length) {
        const f = lista[i++]
        const form = new FormData()
        form.append('foto', f)
        if (f.lastModified) form.append('capturadaEm', new Date(f.lastModified).toISOString())
        try {
          await api.upload(`/vistorias/${id}/fotos`, form)
        } catch (err: any) {
          setLote((l) => l && { ...l, erros: [...l.erros, `${f.name}: ${err?.message || 'erro'}`] })
        } finally {
          setLote((l) => l && { ...l, feitas: l.feitas + 1 })
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (arquivosRef.current) arquivosRef.current.value = ''
    load()
  }

  const mudarStatus = async (status: string) => {
    await api.put(`/vistorias/${id}`, { status })
    load()
  }

  const salvarEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.put(`/vistorias/${id}`, { ...editForm, dataVistoria: editForm.dataVistoria || null })
    setEditar(null)
    load()
  }

  const salvarRen = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ren) return
    await api.put(`/${ren.tipo === 'pavimento' ? 'pavimentos' : 'ambientes'}/${ren.id}`, {
      nome: ren.nome,
      ...(ren.tipo === 'ambiente' ? { nomearDepois: false } : {}),
    })
    setRen(null)
    load()
  }

  const addAmbiente = async (pavId: number) => {
    const nome = (novoAmb[pavId] || '').trim()
    if (!nome) return
    await api.post(`/pavimentos/${pavId}/ambientes`, { nome })
    setNovoAmb({ ...novoAmb, [pavId]: '' })
    load()
  }

  const addPavimento = async () => {
    if (!novoPav.trim()) return
    await api.post(`/vistorias/${id}/pavimentos`, { nome: novoPav.trim() })
    setNovoPav('')
    load()
  }

  const toggleNaoExiste = async (ambId: number, atual: string) => {
    await api.put(`/ambientes/${ambId}`, { situacao: atual === 'nao_existe' ? 'previsto' : 'nao_existe' })
    load()
  }

  const removerAmbiente = async (ambId: number, nome: string, fotos: number) => {
    const aviso =
      fotos > 0
        ? `Excluir "${nome}"? As ${fotos} fotos dele NÃO serão apagadas — voltam para "sem ambiente".`
        : `Excluir "${nome}"?`
    if (!confirm(aviso)) return
    await api.del(`/ambientes/${ambId}`)
    load()
  }

  const abrirCaptura = () => setCaptura('1')

  const excluirVistoria = async () => {
    if (!confirm(`Excluir a vistoria #${det.id} com ${det.totais.fotos} fotos? Não dá para desfazer.`)) return
    await api.del(`/vistorias/${id}`)
    router.push('/vistorias')
  }

  // Encerrar a etapa de fotos: a vistoria passa a ser trabalho de escritório.
  // Não apaga nada e é reversível — por isso pendência não bloqueia, só avisa.
  const finalizarVistoria = async () => {
    await api.put(`/vistorias/${id}`, { status: 'relatorio' })
    setFinalizar(null)
    router.push(`/vistorias/${id}/relatorio`)
  }

  const reabrirFotos = async () => {
    await api.put(`/vistorias/${id}`, { status: 'campo' })
    load()
  }

  const dataFmt = det.dataVistoria ? det.dataVistoria.split('-').reverse().join('/') : null

  // Fase do trabalho: fotografando (campo) ou escrevendo o laudo (escritório).
  const fase = emRelatorio(det.status)
  const ambientes = det.pavimentos.flatMap((p) => p.ambientes)
  const semFoto = ambientes.filter((a) => a.situacao !== 'nao_existe' && a.fotos === 0)
  const semNome = ambientes.filter((a) => a.nomearDepois)
  const pendencias = [
    det.totais.fotos === 0 && 'Nenhuma foto foi enviada nesta vistoria.',
    det.totais.semAmbiente > 0 && `${det.totais.semAmbiente} fotos ainda sem ambiente (aguardando conferência).`,
    semFoto.length > 0 && `${semFoto.length} ambientes previstos ficaram sem nenhuma foto.`,
    semNome.length > 0 && `${semNome.length} ambientes criados em campo ainda estão sem nome.`,
  ].filter(Boolean) as string[]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Abas itens={abasDaVistoria(id)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Vistoria #{det.id} — {det.imovelNome}
          </h1>
          <p className="text-sm text-muted-foreground">
            {det.clienteNome} · {det.tipoServico || 'Sem tipo'}
            {dataFmt ? ` · ${dataFmt}` : ''}
            {det.participantes ? ` · ${det.participantes}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className={`${SELECT_CLASS} w-auto`} value={det.status} onChange={(e) => mudarStatus(e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Button variant="outline" size="icon" onClick={() => setEditar('1')}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={excluirVistoria}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Etapa: é aqui que a vistoria vira de trabalho de campo em trabalho de
          escritório. Fica antes de tudo porque decide o que a tela destaca. */}
      <Card className={fase ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-primary/40'}>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${fase ? 'bg-white text-zinc-900' : STATUS_COR[det.status]}`}>
            {STATUS_LABEL[det.status] || det.status}
          </span>
          <p className={`min-w-64 flex-1 text-sm ${fase ? 'text-zinc-300' : 'text-muted-foreground'}`}>
            {fase
              ? 'Etapa de fotos encerrada. O trabalho agora é o laudo — divergências e relatório ficam na aba Relatório.'
              : 'Enquanto a vistoria está aberta, o foco é fotografar. Terminou o campo? Finalize para passar ao relatório.'}
          </p>
          {fase ? (
            <>
              <Button className="bg-white text-zinc-900 hover:bg-zinc-200" onClick={() => router.push(`/vistorias/${id}/relatorio`)}>
                <FileText className="h-4 w-4" /> Ir para o relatório
              </Button>
              <Button variant="ghost" className="text-zinc-300 hover:bg-white/10 hover:text-white" onClick={reabrirFotos}>
                <RotateCcw className="h-4 w-4" /> Reabrir fotos
              </Button>
            </>
          ) : (
            <Button size="lg" onClick={() => setFinalizar('1')}>
              <CircleCheck className="h-5 w-5" /> Finalizar vistoria
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="min-w-64 space-y-1.5">
            <Label>Tipo de vistoria</Label>
            <select
              className={SELECT_CLASS}
              value={det.tipoServico || ''}
              onChange={async (e) => {
                await api.put(`/vistorias/${id}`, { tipoServico: e.target.value })
                load()
              }}
            >
              <option value="">Não definido</option>
              {!TIPOS_SERVICO.includes(det.tipoServico) && det.tipoServico && (
                <option value={det.tipoServico}>{det.tipoServico}</option>
              )}
              {TIPOS_SERVICO.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="min-w-56 space-y-1.5">
            <Label>Profissional responsável</Label>
            <select
              className={SELECT_CLASS}
              value={det.responsavelId ?? ''}
              onChange={async (e) => {
                await api.put(`/vistorias/${id}`, { responsavelId: e.target.value ? Number(e.target.value) : null })
                load()
              }}
            >
              <option value="">Não definido</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              {det.viagemId
                ? `Faz parte da viagem “${det.viagemTitulo}” — cronograma e despesas ficam lá.`
                : 'Sem viagem vinculada. Vistorias na mesma ida entram numa viagem só.'}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push(det.viagemId ? `/viagens/${det.viagemId}` : `/viagens?nova=1`)}
          >
            <Plane className="h-4 w-4" /> {det.viagemId ? 'Abrir viagem' : 'Criar viagem'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ações</CardTitle>
          <CardDescription>
            {det.totais.fotos} fotos no total
            {det.totais.semAmbiente > 0 ? ` · ${det.totais.semAmbiente} aguardando conferência` : ''}
            {det.temPlanta ? '' : ' · imóvel sem planta anexada'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {/* Ação principal — troca com a etapa: antes de finalizar é a câmera,
              depois é o laudo. Só uma coisa por vez fica em vermelho cheio. */}
          {fase ? (
            <Button size="lg" onClick={() => router.push(`/vistorias/${id}/relatorio`)}>
              <FileText className="h-5 w-5" /> Abrir relatório
            </Button>
          ) : (
            <Button size="lg" onClick={() => router.push(`/captura/${id}`)}>
              <Camera className="h-5 w-5" />
              {det.totais.fotos > 0 ? 'Continuar vistoria' : 'Iniciar vistoria'}
            </Button>
          )}
          {fase && (
            <Button variant="outline" onClick={() => router.push(`/captura/${id}`)}>
              <Camera className="h-4 w-4" /> Fotografar mesmo assim
            </Button>
          )}
          <Button variant="outline" onClick={abrirCaptura}>
            <Smartphone className="h-4 w-4" /> Abrir no celular (QR)
          </Button>
          <Button variant="outline" onClick={() => arquivosRef.current?.click()} disabled={!!lote && lote.feitas < lote.total}>
            <Images className="h-4 w-4" /> Enviar fotos (lote)
          </Button>
          <input
            ref={arquivosRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => enviarLote(e.target.files)}
          />
          <Button variant="outline" onClick={() => router.push(`/vistorias/${id}/conferencia`)} disabled={det.totais.fotos === 0}>
            <SlidersHorizontal className="h-4 w-4" /> Conferência
            {det.totais.semAmbiente > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                {det.totais.semAmbiente}
              </span>
            )}
          </Button>
          <Button variant="outline" onClick={() => window.open(`/vistorias/${id}/claquetes`, '_blank')}>
            <Printer className="h-4 w-4" /> Cartões de claquete
          </Button>
          <a href={det.totais.fotos > 0 ? apiUrl(`/vistorias/${id}/export`) : undefined}>
            <Button variant="outline" disabled={det.totais.fotos === 0}>
              <Download className="h-4 w-4" /> Exportar pastas (ZIP)
            </Button>
          </a>
          {det.temPlanta && (
            <a href={apiUrl(`/imoveis/${det.imovelId}/planta`)} target="_blank" rel="noreferrer">
              <Button variant="ghost">
                <FileText className="h-4 w-4" /> Ver planta
              </Button>
            </a>
          )}
        </CardContent>
        {lote && (
          <CardContent className="pt-0">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {lote.feitas < lote.total ? (
                <p>
                  Enviando fotos… {lote.feitas}/{lote.total}
                </p>
              ) : (
                <p className="font-medium">
                  Envio concluído: {lote.total - lote.erros.length} de {lote.total} fotos.
                  {lote.erros.length === 0 ? ' Siga para a Conferência.' : ''}
                </p>
              )}
              <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${lote.total ? Math.round((lote.feitas / lote.total) * 100) : 0}%` }}
                />
              </div>
              {lote.erros.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-destructive">
                  {lote.erros.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pavimentos e ambientes</CardTitle>
          <CardDescription>
            Ambientes criados em campo aparecem com a marca “não estava na planta” — as divergências da vistoria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {det.pavimentos.map((p) => (
            <div key={p.id} className="rounded-md border">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="flex-1 text-sm font-semibold">{p.nome}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRen({ tipo: 'pavimento', id: p.id, nome: p.nome })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
              <ul className="divide-y">
                {p.ambientes.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                    <span className={a.situacao === 'nao_existe' ? 'text-muted-foreground line-through' : ''}>{a.nome}</span>
                    {/* Divergência é o que o laudo precisa enxergar: vermelho.
                        Pendência de cadastro é só cinza. */}
                    {a.origem === 'campo' && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/30">
                        não estava na planta
                      </span>
                    )}
                    {a.situacao === 'nao_existe' && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-medium text-white">não existe no local</span>
                    )}
                    {a.nomearDepois && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border">nomear</span>
                    )}
                    {(a.nota || a.medidas) && (
                      <span className="text-xs text-muted-foreground" title={`${a.nota}${a.medidas ? ` · ${a.medidas}` : ''}`}>
                        📝
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Camera className="h-3 w-3" /> {a.fotos}
                      </span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRen({ tipo: 'ambiente', id: a.id, nome: a.nome })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={a.situacao === 'nao_existe' ? 'Voltar a previsto' : 'Marcar como inexistente no local'}
                        onClick={() => toggleNaoExiste(a.id, a.situacao)}
                      >
                        <span className="text-xs">∅</span>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removerAmbiente(a.id, a.nome, a.fotos)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </span>
                  </li>
                ))}
                <li className="flex items-center gap-2 px-3 py-2">
                  <Input
                    className="h-8"
                    placeholder="Adicionar ambiente"
                    value={novoAmb[p.id] || ''}
                    onChange={(e) => setNovoAmb({ ...novoAmb, [p.id]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addAmbiente(p.id)
                      }
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => addAmbiente(p.id)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </li>
              </ul>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              className="h-9 max-w-xs"
              placeholder="Novo pavimento"
              value={novoPav}
              onChange={(e) => setNovoPav(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addPavimento()
                }
              }}
            />
            <Button size="sm" variant="outline" onClick={addPavimento}>
              <Plus className="h-4 w-4" /> Pavimento
            </Button>
            <Link href={`/imoveis/${det.imovelId}`} className="ml-auto text-sm text-primary hover:underline">
              Editar modelo do imóvel →
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Link/QR da captura no celular */}
      <Dialog open={capturaOpen} onOpenChange={(o) => !o && setCaptura(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capturar no celular</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              No celular, abra o endereço abaixo (ou aponte a câmera para o QR) e entre com seu login. Dica: use
              “Adicionar à Tela de Início” no Safari para virar um app.
            </p>
            {capturaUrl && (
              <>
                <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{capturaUrl}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={apiUrl(`/qr?text=${encodeURIComponent(capturaUrl)}`)}
                  alt="QR do link de captura"
                  className="mx-auto h-44 w-44"
                />
              </>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setCaptura(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalizar: mostra o que ficou para trás antes de virar a chave. */}
      <Dialog open={finalizar === '1'} onOpenChange={(o) => !o && setFinalizar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar vistoria</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              A etapa de fotos é encerrada e a vistoria passa para <strong className="text-foreground">Relatório</strong>.
              Nada é apagado e dá para reabrir depois — é só a tela deixando de puxar para a câmera.
            </p>
            {pendencias.length === 0 ? (
              <p className="flex items-center gap-2 rounded-md border bg-muted p-3 font-medium">
                <CircleCheck className="h-4 w-4 shrink-0" />
                {det.totais.fotos} fotos, nenhum ambiente pendente.
              </p>
            ) : (
              <div className="space-y-2 rounded-md border border-primary/50 bg-primary/5 p-3">
                <p className="flex items-center gap-2 font-semibold text-primary">
                  <CircleAlert className="h-4 w-4 shrink-0" /> Ficou pendente
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {pendencias.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Dá para finalizar assim mesmo — as pendências continuam listadas na conferência.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFinalizar(null)}>
              Cancelar
            </Button>
            <Button onClick={finalizarVistoria}>
              <CircleCheck className="h-4 w-4" /> Finalizar e ir ao relatório
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar dados */}
      <Dialog open={editOpen} onOpenChange={(o) => !o && setEditar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar vistoria</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo de serviço</Label>
              <select
                className={SELECT_CLASS}
                value={editForm.tipoServico}
                onChange={(e) => setEditForm({ ...editForm, tipoServico: e.target.value })}
              >
                {!TIPOS_SERVICO.includes(editForm.tipoServico) && <option value={editForm.tipoServico}>{editForm.tipoServico || '—'}</option>}
                {TIPOS_SERVICO.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={editForm.dataVistoria}
                  onChange={(e) => setEditForm({ ...editForm, dataVistoria: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Participantes</Label>
                <Input
                  value={editForm.participantes}
                  onChange={(e) => setEditForm({ ...editForm, participantes: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditar(null)}>
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Renomear */}
      <Dialog open={!!ren} onOpenChange={(o) => !o && setRen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear {ren?.tipo}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarRen} className="space-y-4">
            <Input value={ren?.nome || ''} onChange={(e) => ren && setRen({ ...ren, nome: e.target.value })} required />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRen(null)}>
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
