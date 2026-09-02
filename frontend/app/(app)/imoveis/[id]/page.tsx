'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  FileText,
  Loader2,
  Pencil,
  Plus,
  ScanText,
  Trash2,
  Upload,
} from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { Pavimento, SELECT_CLASS, STATUS_COR, STATUS_LABEL, TIPOS_SERVICO } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Sugestao {
  pavimentos: { nome: string; ambientes: string[] }[]
  ignorados: { texto: string; ocorrencias: number }[]
  observacoes: string
  paginas: number
  textosLidos: number
  prancha: { total: number; presentes: number[] } | null
}

interface Detalhe {
  id: number
  clientId: number
  nome: string
  endereco: string
  clienteNome: string
  plantaNome: string
  temPlanta: boolean
  plantas?: { nome: string }[]
  pavimentos: Pavimento[]
  vistorias: { id: number; tipoServico: string; dataVistoria: string | null; status: string; fotos: number }[]
}

export default function ImovelPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [det, setDet] = useState<Detalhe | null>(null)
  const [novoPav, setNovoPav] = useState('')
  const [novoAmb, setNovoAmb] = useState<Record<number, string>>({})
  const plantaRef = useRef<HTMLInputElement>(null)

  // Diálogos com endereço próprio: ?editar=1 · ?nova-vistoria=1
  // (renomear fica fora da URL: é ação de um item da lista, não uma tela)
  const [editar, setEditar] = useParamEstado('editar')
  const [novaVistoria, setNovaVistoria] = useParamEstado('nova-vistoria')
  const editOpen = editar === '1'
  const nvOpen = novaVistoria === '1'
  const [editForm, setEditForm] = useState({ nome: '', endereco: '' })
  const [ren, setRen] = useState<{ tipo: 'pavimento' | 'ambiente'; id: number; nome: string } | null>(null)
  const [nvForm, setNvForm] = useState({ tipoServico: TIPOS_SERVICO[0], dataVistoria: '', participantes: '' })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Leitura da planta pela IA: /imoveis/:id?ler-planta=1
  const [lerPlanta, setLerPlanta] = useParamEstado('ler-planta')
  const lerOpen = lerPlanta === '1'
  const [lendo, setLendo] = useState(false)
  const [sugestao, setSugestao] = useState<Sugestao | null>(null)
  const [erroLeitura, setErroLeitura] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})
  const [extras, setExtras] = useState<Record<string, boolean>>({}) // textos não usados, promovidos a ambiente
  const [pavExtras, setPavExtras] = useState('')
  const [verIgnorados, setVerIgnorados] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [modeloLeitura, setModeloLeitura] = useState<'sonnet' | 'opus'>('sonnet')

  const load = useCallback(() => {
    api.get<{ data: Detalhe }>(`/imoveis/${id}`).then((r) => setDet(r.data))
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  useTitulo(det ? (nvOpen ? `Nova vistoria — ${det.nome}` : det.nome) : 'Imóvel')

  // Preenche os formulários ao abrir (inclusive por link direto ou voltar).
  useEffect(() => {
    if (editOpen && det) setEditForm({ nome: det.nome, endereco: det.endereco })
  }, [editOpen, det])
  useEffect(() => {
    if (nvOpen) {
      setNvForm({ tipoServico: TIPOS_SERVICO[0], dataVistoria: '', participantes: '' })
      setErro(null)
    }
  }, [nvOpen])

  // Lê a planta assim que o diálogo abre (inclusive por link direto).
  // A leitura roda no servidor e é consultada de 2 em 2 segundos: segurar a
  // requisição por 1 minuto estouraria o limite do proxy (erro 500 aos 30 s).
  useEffect(() => {
    if (!lerOpen) return
    let cancelado = false
    setLendo(true)
    setSugestao(null)
    setErroLeitura(null)
    setSegundos(0)

    const receber = (dados: Sugestao) => {
      setSugestao(dados)
      // Tudo vem marcado: o normal é aceitar e só desmarcar o que não serve.
      const m: Record<string, boolean> = {}
      dados.pavimentos.forEach((p, pi) => p.ambientes.forEach((_, ai) => (m[`${pi}:${ai}`] = true)))
      setMarcados(m)
      // Os textos não usados começam desmarcados — são sugestão de resgate.
      setExtras({})
      setVerIgnorados(false)
      setPavExtras(dados.pavimentos[0]?.nome || 'Pavimento único')
    }

    const acompanhar = async (leituraId: number) => {
      while (!cancelado) {
        await new Promise((r) => setTimeout(r, 2000))
        if (cancelado) return
        const r = await api.get<{ data: { status: string; dados: Sugestao; mensagem: string; segundos: number } }>(
          `/planta/leituras/${leituraId}`
        )
        if (cancelado) return
        setSegundos(r.data.segundos)
        if (r.data.status === 'ok') return receber(r.data.dados)
        if (r.data.status === 'erro') throw new Error(r.data.mensagem)
      }
    }

    api
      .post<{ data: { leituraId: number } }>(`/imoveis/${id}/planta/ler`, { model: modeloLeitura })
      .then((r) => acompanhar(r.data.leituraId))
      .catch((err) => !cancelado && setErroLeitura(err?.message || 'Falha ao ler a planta'))
      .finally(() => !cancelado && setLendo(false))

    return () => {
      cancelado = true
    }
  }, [lerOpen, id, modeloLeitura])

  // Daqui para baixo não pode haver hook: este return acontece só no 1º render,
  // e o React exige a mesma quantidade de hooks em todos os renders.
  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const trocarOrdem = async (
    tipo: 'pavimentos' | 'ambientes',
    lista: { id: number; ordem: number }[],
    idx: number,
    dir: -1 | 1
  ) => {
    const outro = idx + dir
    if (outro < 0 || outro >= lista.length) return
    const a = lista[idx]
    const b = lista[outro]
    await api.put(`/${tipo}/${a.id}`, { ordem: b.ordem === a.ordem ? b.ordem + (dir === -1 ? -1 : 1) : b.ordem })
    await api.put(`/${tipo}/${b.id}`, { ordem: a.ordem })
    load()
  }

  const addPavimento = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!novoPav.trim()) return
    await api.post(`/imoveis/${id}/pavimentos`, { nome: novoPav.trim() })
    setNovoPav('')
    load()
  }

  const addAmbiente = async (pavId: number) => {
    const nome = (novoAmb[pavId] || '').trim()
    if (!nome) return
    await api.post(`/pavimentos/${pavId}/ambientes`, { nome })
    setNovoAmb({ ...novoAmb, [pavId]: '' })
    load()
  }

  const removerItem = async (tipo: 'pavimentos' | 'ambientes', itemId: number, nome: string) => {
    if (!confirm(`Excluir "${nome}" do modelo?`)) return
    await api.del(`/${tipo}/${itemId}`)
    load()
  }

  const salvarRen = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ren) return
    await api.put(`/${ren.tipo === 'pavimento' ? 'pavimentos' : 'ambientes'}/${ren.id}`, { nome: ren.nome })
    setRen(null)
    load()
  }

  const salvarEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.put(`/imoveis/${id}`, editForm)
    setEditar(null)
    load()
  }

  // Aceita várias pranchas de uma vez (01/05, 02/05…) — cada uma traz os
  // ambientes do seu trecho, e a leitura processa todas juntas.
  const enviarPlanta = async (files: FileList | null) => {
    if (!files?.length) return
    const form = new FormData()
    for (const f of Array.from(files)) form.append('planta', f)
    try {
      await api.upload(`/imoveis/${id}/planta`, form)
      load()
    } catch (err: any) {
      alert(err?.message || 'Erro ao enviar planta')
    }
  }

  const aplicarSugestao = async () => {
    if (!sugestao) return
    const pavimentos = sugestao.pavimentos
      .map((p, pi) => ({ nome: p.nome, ambientes: p.ambientes.filter((_, ai) => marcados[`${pi}:${ai}`]) }))
      .filter((p) => p.ambientes.length)

    // Textos resgatados entram no pavimento escolhido (criando-o se preciso).
    const resgatados = sugestao.ignorados.filter((t) => extras[t.texto]).map((t) => t.texto)
    if (resgatados.length) {
      const alvo = pavimentos.find((p) => p.nome === pavExtras)
      if (alvo) alvo.ambientes.push(...resgatados)
      else pavimentos.push({ nome: pavExtras || 'Pavimento único', ambientes: resgatados })
    }
    if (!pavimentos.length) return
    setBusy(true)
    try {
      const r = await api.post<{ data: { pavimentos: number; ambientes: number } }>(`/imoveis/${id}/estrutura`, {
        pavimentos,
      })
      setLerPlanta(null)
      load()
      alert(`Adicionados: ${r.data.ambientes} ambientes em ${r.data.pavimentos || 'nenhum'} novo(s) pavimento(s).`)
    } catch (err: any) {
      setErroLeitura(err?.message || 'Falha ao adicionar')
    } finally {
      setBusy(false)
    }
  }

  const totalMarcados = Object.values(marcados).filter(Boolean).length + Object.values(extras).filter(Boolean).length

  const criarVistoria = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setBusy(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/vistorias', {
        imovelId: det.id,
        ...nvForm,
        dataVistoria: nvForm.dataVistoria || null,
      })
      router.push(`/vistorias/${r.data.id}`)
    } catch (err: any) {
      setErro(err?.message || 'Erro ao criar vistoria')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{det.nome}</h1>
          <p className="text-sm text-muted-foreground">
            {det.clienteNome}
            {det.endereco ? ` · ${det.endereco}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditar('1')}>
            <Pencil className="h-4 w-4" /> Editar
          </Button>
          <Button onClick={() => setNovaVistoria('1')}>
            <Plus className="h-4 w-4" /> Nova vistoria
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Plantas</CardTitle>
          <CardDescription>
            PDF ou imagem — <strong>pode enviar várias pranchas de uma vez</strong> (01/05, 02/05…), já que cada uma
            traz os ambientes de um trecho. É a referência do modelo de ambientes e o que você fotografa como claquete.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {det.plantas?.length ? (
            <span className="flex flex-wrap items-center gap-3">
              {det.plantas.map((p, i) => (
                <a
                  key={p.nome}
                  href={apiUrl(`/imoveis/${det.id}/planta?arquivo=${i}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" /> {p.nome}
                </a>
              ))}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Nenhuma planta anexada.</span>
          )}
          <input
            ref={plantaRef}
            type="file"
            accept=".pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => enviarPlanta(e.target.files)}
          />
          <Button variant="outline" size="sm" onClick={() => plantaRef.current?.click()}>
            <Upload className="h-4 w-4" /> {det.temPlanta ? 'Substituir plantas' : 'Enviar plantas'}
          </Button>
          {det.temPlanta && (
            <Button size="sm" onClick={() => setLerPlanta('1')}>
              <ScanText className="h-4 w-4" /> Ler planta e sugerir ambientes
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Modelo de pavimentos e ambientes</CardTitle>
          <CardDescription>
            Cadastre na ordem prevista do caminho. Cada nova vistoria nasce com uma cópia deste modelo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {det.pavimentos.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum pavimento — comece adicionando um (ex.: Térreo).</p>
          )}
          {det.pavimentos.map((p, pi) => (
            <div key={p.id} className="rounded-md border">
              <div className="flex items-center gap-1 border-b bg-muted/40 px-3 py-2">
                <span className="flex-1 text-sm font-semibold">{p.nome}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('pavimentos', det.pavimentos, pi, -1)} disabled={pi === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('pavimentos', det.pavimentos, pi, 1)} disabled={pi === det.pavimentos.length - 1}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRen({ tipo: 'pavimento', id: p.id, nome: p.nome })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removerItem('pavimentos', p.id, p.nome)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              <ul className="divide-y">
                {p.ambientes.map((a, ai) => (
                  <li key={a.id} className="flex items-center gap-1 px-3 py-1.5">
                    <span className="w-6 text-xs text-muted-foreground">{ai + 1}.</span>
                    <span className="flex-1 text-sm">{a.nome}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('ambientes', p.ambientes, ai, -1)} disabled={ai === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => trocarOrdem('ambientes', p.ambientes, ai, 1)} disabled={ai === p.ambientes.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRen({ tipo: 'ambiente', id: a.id, nome: a.nome })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removerItem('ambientes', a.id, a.nome)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
                <li className="flex items-center gap-2 px-3 py-2">
                  <Input
                    className="h-8"
                    placeholder="Novo ambiente (ex.: Cozinha)"
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
                    <Plus className="h-3.5 w-3.5" /> Ambiente
                  </Button>
                </li>
              </ul>
            </div>
          ))}
          <form onSubmit={addPavimento} className="flex items-center gap-2">
            <Input
              className="h-9 max-w-xs"
              placeholder="Novo pavimento (ex.: Térreo)"
              value={novoPav}
              onChange={(e) => setNovoPav(e.target.value)}
            />
            <Button type="submit" size="sm">
              <Plus className="h-4 w-4" /> Pavimento
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vistorias deste imóvel</CardTitle>
        </CardHeader>
        <CardContent>
          {det.vistorias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma vistoria ainda.</p>
          ) : (
            <ul className="divide-y">
              {det.vistorias.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/vistorias/${v.id}`}
                    className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50"
                  >
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">
                      <span className="font-medium">#{v.id}</span> · {v.tipoServico || 'Sem tipo'}
                      {v.dataVistoria ? ` · ${v.dataVistoria.split('-').reverse().join('/')}` : ''}
                    </span>
                    <span className="text-muted-foreground">{v.fotos} fotos</span>
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COR[v.status] || ''}`}>
                      {STATUS_LABEL[v.status] || v.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Leitura da planta pela IA */}
      <Dialog open={lerOpen} onOpenChange={(o) => !o && setLerPlanta(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Ambientes lidos da planta</DialogTitle>
          </DialogHeader>

          {lendo && (
            <div className="space-y-1 py-6">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo a planta e separando os ambientes… ({segundos}s)
              </p>
              <p className="text-xs text-muted-foreground">
                Costuma levar de 30 s a 1 min e meio. Pode continuar usando o sistema — a leitura roda no servidor.
              </p>
            </div>
          )}

          {erroLeitura && !lendo && <p className="py-4 text-sm text-destructive">{erroLeitura}</p>}

          {sugestao && !lendo && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {sugestao.paginas} página(s), {sugestao.textosLidos} textos lidos. Desmarque o que não for ambiente de
                vistoria — nada é gravado até você confirmar.
              </p>

              {sugestao.prancha && sugestao.prancha.presentes.length < sugestao.prancha.total && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>
                    Faltam pranchas: você enviou {sugestao.prancha.presentes.length} de {sugestao.prancha.total}{' '}
                    {sugestao.prancha.presentes.length === 1 ? `(a nº ${sugestao.prancha.presentes[0]})` : ''}.
                  </strong>{' '}
                  Cada prancha traz os ambientes do seu trecho — os pavimentos e as salas que não aparecem aqui
                  (coordenação, financeiro, diretoria…) estão nas outras. Envie todas de uma vez em “Substituir
                  plantas” e leia de novo.
                </p>
              )}
              {sugestao.pavimentos.length === 0 && (
                <p className="text-sm">Nenhum ambiente reconhecido nesta planta. Cadastre manualmente abaixo.</p>
              )}
              {sugestao.pavimentos.map((p, pi) => {
                const chaves = p.ambientes.map((_, ai) => `${pi}:${ai}`)
                const todos = chaves.every((k) => marcados[k])
                return (
                  <div key={pi} className="rounded-md border">
                    <label className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={todos}
                        onChange={() =>
                          setMarcados((m) => ({ ...m, ...Object.fromEntries(chaves.map((k) => [k, !todos])) }))
                        }
                      />
                      {p.nome}
                      <span className="ml-auto text-xs font-normal text-muted-foreground">
                        {p.ambientes.length} ambientes
                      </span>
                    </label>
                    <ul className="grid gap-1 p-3 sm:grid-cols-2">
                      {p.ambientes.map((a, ai) => (
                        <li key={ai}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!!marcados[`${pi}:${ai}`]}
                              onChange={() => setMarcados((m) => ({ ...m, [`${pi}:${ai}`]: !m[`${pi}:${ai}`] }))}
                            />
                            {a}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
              {sugestao.ignorados.length > 0 && (
                <div className="rounded-md border border-dashed">
                  <button
                    type="button"
                    onClick={() => setVerIgnorados((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <span className="font-medium">Textos da planta que a IA não usou</span>
                    <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">
                      {sugestao.ignorados.length}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {verIgnorados ? 'ocultar' : 'conferir'}
                    </span>
                  </button>
                  {verIgnorados && (
                    <div className="space-y-2 border-t p-3">
                      <p className="text-xs text-muted-foreground">
                        Quase tudo aqui é legenda, cota ou item de incêndio. Se algum for ambiente de verdade, marque
                        para incluir.
                      </p>
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {sugestao.ignorados.map((t) => (
                          <li key={t.texto}>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={!!extras[t.texto]}
                                onChange={() => setExtras((m) => ({ ...m, [t.texto]: !m[t.texto] }))}
                              />
                              <span className="truncate" title={t.texto}>
                                {t.texto}
                                {t.ocorrencias > 1 && (
                                  <span className="ml-1 text-xs text-muted-foreground">({t.ocorrencias}x)</span>
                                )}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {Object.values(extras).some(Boolean) && sugestao.pavimentos.length > 0 && (
                        <label className="flex items-center gap-2 text-xs">
                          Incluir no pavimento:
                          <select
                            className={`${SELECT_CLASS} h-8 w-auto`}
                            value={pavExtras}
                            onChange={(e) => setPavExtras(e.target.value)}
                          >
                            {sugestao.pavimentos.map((p) => (
                              <option key={p.nome}>{p.nome}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}

              {sugestao.observacoes && (
                <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <strong>Observação da IA:</strong> {sugestao.observacoes}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            {sugestao && !lendo && modeloLeitura === 'sonnet' ? (
              <Button type="button" variant="ghost" onClick={() => setModeloLeitura('opus')} title="Releitura mais cuidadosa (demora mais)">
                <ScanText className="h-4 w-4" /> Faltou ambiente? Ler de novo com mais capacidade
              </Button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setLerPlanta(null)}>
                Cancelar
              </Button>
              <Button onClick={aplicarSugestao} disabled={busy || lendo || totalMarcados === 0}>
                {busy ? 'Adicionando…' : `Adicionar ${totalMarcados} ambientes ao modelo`}
              </Button>
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar imóvel */}
      <Dialog open={editOpen} onOpenChange={(o) => !o && setEditar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar imóvel</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvarEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={editForm.nome} onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Endereço</Label>
              <Input value={editForm.endereco} onChange={(e) => setEditForm({ ...editForm, endereco: e.target.value })} />
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

      {/* Renomear pavimento/ambiente */}
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

      {/* Nova vistoria */}
      <Dialog open={nvOpen} onOpenChange={(o) => !o && setNovaVistoria(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova vistoria — {det.nome}</DialogTitle>
          </DialogHeader>
          <form onSubmit={criarVistoria} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A vistoria nasce com uma cópia do modelo de ambientes deste imóvel
              {det.pavimentos.length === 0 ? ' (vazio — os ambientes poderão ser criados em campo)' : ''}.
            </p>
            <div className="space-y-1.5">
              <Label>Tipo de serviço</Label>
              <select
                className={SELECT_CLASS}
                value={nvForm.tipoServico}
                onChange={(e) => setNvForm({ ...nvForm, tipoServico: e.target.value })}
              >
                {TIPOS_SERVICO.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data prevista</Label>
                <Input
                  type="date"
                  value={nvForm.dataVistoria}
                  onChange={(e) => setNvForm({ ...nvForm, dataVistoria: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Participantes</Label>
                <Input
                  value={nvForm.participantes}
                  onChange={(e) => setNvForm({ ...nvForm, participantes: e.target.value })}
                />
              </div>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovaVistoria(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Criando…' : 'Criar vistoria'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
