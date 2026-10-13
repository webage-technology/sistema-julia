'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, Building2, CheckSquare, Eraser, FileCheck, HardDrive, History, Plus, Save, Send, Trash2, Trash, Upload, Wand2 } from 'lucide-react'
import { api, apiUrl } from '@/lib/api'
import { useParamEstado, useTitulo } from '@/lib/url'
import { SELECT_CLASS, TIPOS_SERVICO } from '@/lib/vistorias'
import { TIPOS_PROCESSO, dataHora, tamanho } from '@/lib/regularizacao'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Configurações do escritório (só administrador), com abas na URL (?aba=):
// escritório · textos padrão · documentos exigidos · checklists · notificações · backup.
interface Escritorio {
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  registro: string
  endereco: string
  cidade: string
  telefone: string
  email: string
  site: string
  temLogo: boolean
  cor: string
  fonteFotos: string
  carimboFotos: boolean
  prazoAlertaDias: number
  urlPublica: string
  notificacoes: {
    email?: { ativo?: boolean }
    smtp?: { host?: string; porta?: number; seguro?: boolean; usuario?: string; senha?: string; de?: string }
    whatsapp?: { ativo?: boolean; url?: string; instancia?: string; apikey?: string; destino?: string }
  }
}
interface Texto {
  id: number
  tipoServico: string
  secao: string
  titulo: string
  texto: string
}
interface DocModelo {
  id: number
  tipoServico: string
  nome: string
  descricao: string
  obrigatorio: boolean
}
interface ChkModelo {
  id: number
  tipoServico: string
  nome: string
  porAmbiente: boolean
}
// Um grupo de dados que a limpeza sabe apagar (ver backend/src/dados.js).
// `exige` são os grupos que vão junto por dependência (cliente arrasta imóvel).
interface GrupoDados {
  chave: string
  label: string
  descricao: string
  exige: string[]
  registros: number
}

const ABAS = [
  { k: '', label: 'Escritório', icon: Building2 },
  { k: 'textos', label: 'Textos padrão', icon: Wand2 },
  { k: 'documentos', label: 'Documentos exigidos', icon: FileCheck },
  { k: 'checklists', label: 'Checklists', icon: CheckSquare },
  { k: 'notificacoes', label: 'Notificações', icon: Bell },
  { k: 'backup', label: 'Backup e dados', icon: HardDrive },
]
const SECOES = [
  { v: 'introducao', label: 'Objetivo / introdução' },
  { v: 'metodologia', label: 'Metodologia' },
  { v: 'conclusao', label: 'Conclusão' },
  { v: 'observacoes', label: 'Observações' },
]
const TIPOS = [...new Set([...TIPOS_SERVICO.filter((t) => t !== 'Outro'), ...TIPOS_PROCESSO.filter((t) => t !== 'Outro'), 'Acessibilidade'])]

export default function ConfiguracoesPage() {
  const [aba, setAba] = useParamEstado('aba')
  const [e, setE] = useState<Escritorio | null>(null)
  const [textos, setTextos] = useState<Texto[]>([])
  const [docs, setDocs] = useState<DocModelo[]>([])
  const [chks, setChks] = useState<ChkModelo[]>([])
  const [backup, setBackup] = useState<any>(null)
  const [envios, setEnvios] = useState<any[]>([])
  const [grupos, setGrupos] = useState<GrupoDados[]>([])
  const [limpar, setLimpar] = useParamEstado('limpar')
  const [selecao, setSelecao] = useState<string[]>([])
  const [confirmacao, setConfirmacao] = useState('')
  const [limpando, setLimpando] = useState(false)
  const [erroLimpeza, setErroLimpeza] = useState<string | null>(null)
  const [salvo, setSalvo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [teste, setTeste] = useState({ canal: 'email', destinatario: '' })
  const logoRef = useRef<HTMLInputElement>(null)
  const [novoTexto, setNovoTexto] = useState({ tipoServico: '', secao: 'conclusao', titulo: '', texto: '' })
  const [novoDoc, setNovoDoc] = useState({ tipoServico: TIPOS[0], nome: '', obrigatorio: true })
  const [novoChk, setNovoChk] = useState({ tipoServico: TIPOS[0], nome: '', porAmbiente: true })
  const abaAtual = aba || ''
  useTitulo('Configurações')

  const carregar = useCallback(() => {
    api.get<{ data: Escritorio }>('/escritorio').then((r) => setE(r.data))
    api.get<{ data: Texto[] }>('/textos-padrao').then((r) => setTextos(r.data))
    api.get<{ data: DocModelo[] }>('/documentos-modelo').then((r) => setDocs(r.data))
    api.get<{ data: ChkModelo[] }>('/checklist-modelos').then((r) => setChks(r.data))
    api.get<{ data: any }>('/backup/estado').then((r) => setBackup(r.data)).catch(() => {})
    api.get<{ data: any[] }>('/notificacoes/envios').then((r) => setEnvios(r.data)).catch(() => {})
    api.get<{ data: GrupoDados[] }>('/dados/resumo').then((r) => setGrupos(r.data)).catch(() => {})
  }, [])
  useEffect(() => {
    carregar()
  }, [carregar])

  const avisar = (t: string) => {
    setSalvo(t)
    setTimeout(() => setSalvo(null), 2000)
  }
  const salvar = async (campos: Partial<Escritorio> | Record<string, unknown>) => {
    setErro(null)
    try {
      const r = await api.put<{ data: Escritorio }>('/escritorio', campos)
      setE(r.data)
      avisar('Salvo')
    } catch (err: any) {
      setErro(err?.message || 'Falha ao salvar')
    }
  }

  if (!e) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const campo = (rotulo: string, chave: keyof Escritorio, extra?: { placeholder?: string; tipo?: string; dica?: string }) => (
    <div className="space-y-1.5">
      <Label>{rotulo}</Label>
      <Input
        type={extra?.tipo || 'text'}
        defaultValue={String(e[chave] ?? '')}
        placeholder={extra?.placeholder}
        onBlur={(ev) => ev.target.value !== String(e[chave] ?? '') && salvar({ [chave]: ev.target.value })}
      />
      {extra?.dica && <p className="text-xs text-muted-foreground">{extra.dica}</p>}
    </div>
  )

  const notif = e.notificacoes || {}
  const salvarNotif = (parte: Record<string, unknown>) => salvar({ notificacoes: { ...notif, ...parte } })

  // Limpeza de dados: marcar um grupo marca também os que ele arrasta
  // (cliente → imóvel → vistoria), para a conta bater com o que o backend apaga.
  const expandir = (chaves: string[]) => {
    const alvo = new Set<string>()
    const fila = [...chaves]
    while (fila.length) {
      const c = fila.shift() as string
      if (alvo.has(c)) continue
      alvo.add(c)
      fila.push(...(grupos.find((g) => g.chave === c)?.exige || []))
    }
    return alvo
  }
  const alvos = expandir(selecao)
  const totalAlvo = grupos.filter((g) => alvos.has(g.chave)).reduce((s, g) => s + g.registros, 0)
  const fecharLimpeza = () => {
    setLimpar(null)
    setSelecao([])
    setConfirmacao('')
    setErroLimpeza(null)
  }
  const limparDados = async () => {
    setLimpando(true)
    setErroLimpeza(null)
    try {
      await api.post('/dados/limpar', { grupos: [...alvos], confirmacao })
      fecharLimpeza()
      avisar('Dados apagados')
      carregar()
    } catch (err: any) {
      setErroLimpeza(err?.message || 'Falha ao apagar')
    } finally {
      setLimpando(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Configurações</h1>
          <p className="text-sm text-muted-foreground">Identidade do escritório, textos que se repetem, modelos por tipo de serviço, avisos e cópia de segurança.</p>
        </div>
        <span className="flex items-center gap-2 text-sm">
          {salvo && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Save className="h-3.5 w-3.5" /> {salvo}
            </span>
          )}
          <Link href="/auditoria" className="flex items-center gap-1 text-primary hover:underline">
            <History className="h-4 w-4" /> Auditoria
          </Link>
          <Link href="/lixeira" className="flex items-center gap-1 text-primary hover:underline">
            <Trash className="h-4 w-4" /> Lixeira
          </Link>
        </span>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted p-1">
        {ABAS.map((a) => {
          const Icon = a.icon
          const ativo = abaAtual === a.k
          return (
            <button key={a.k} onClick={() => setAba(a.k || null)} className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${ativo ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}>
              <Icon className="h-4 w-4" /> {a.label}
            </button>
          )
        })}
      </div>

      {abaAtual === '' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Identidade</CardTitle>
              <CardDescription>Vai para a capa e o rodapé dos laudos, para a legenda das fotos e para o portal do cliente.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {campo('Nome fantasia', 'nomeFantasia')}
              {campo('Razão social', 'razaoSocial')}
              {campo('CNPJ', 'cnpj', { placeholder: '00.000.000/0000-00' })}
              {campo('Registro (CAU/CREA da empresa)', 'registro', { placeholder: 'CAU PJ 12345-6' })}
              <div className="sm:col-span-2">{campo('Endereço', 'endereco')}</div>
              {campo('Cidade (local de assinatura)', 'cidade')}
              {campo('Telefone', 'telefone')}
              {campo('E-mail', 'email', { tipo: 'email' })}
              {campo('Site', 'site')}
            </CardContent>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Timbre</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  {e.temLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${apiUrl('/escritorio/logo')}?v=${Date.now()}`} alt="Logo" className="h-16 max-w-[200px] rounded border bg-white object-contain p-1" />
                  ) : (
                    <span className="text-sm text-muted-foreground">Sem logo.</span>
                  )}
                  <input
                    ref={logoRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={async (ev) => {
                      const f = ev.target.files?.[0]
                      if (!f) return
                      const fd = new FormData()
                      fd.append('logo', f)
                      try {
                        await api.upload('/escritorio/logo', fd)
                        carregar()
                        avisar('Logo enviado')
                      } catch (err: any) {
                        setErro(err?.message || 'Falha ao enviar')
                      }
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={() => logoRef.current?.click()}>
                    <Upload className="h-4 w-4" /> {e.temLogo ? 'Trocar logo' : 'Enviar logo'}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Cor dos títulos (hex)</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={`#${e.cor}`} onChange={(ev) => salvar({ cor: ev.target.value.replace('#', '') })} className="h-10 w-12 cursor-pointer rounded border" />
                      <Input defaultValue={e.cor} onBlur={(ev) => ev.target.value !== e.cor && salvar({ cor: ev.target.value })} />
                    </div>
                  </div>
                  {campo('Fonte das fotos (legenda)', 'fonteFotos', { dica: 'Sai como “Fonte: … (ano)” embaixo de cada foto.' })}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Vistoria e prazos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={e.carimboFotos} onChange={(ev) => salvar({ carimboFotos: ev.target.checked })} />
                  <span>
                    <span className="font-medium">Carimbar data, hora, ambiente e GPS nas fotos</span>
                    <span className="block text-xs text-muted-foreground">Vale para as fotos enviadas daqui em diante (o original nunca muda). Para as antigas, use “Reaplicar carimbo” na vistoria.</span>
                  </span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Avisar prazos com antecedência de (dias)</Label>
                    <Input type="number" min={1} defaultValue={e.prazoAlertaDias} onBlur={(ev) => Number(ev.target.value) !== e.prazoAlertaDias && salvar({ prazoAlertaDias: Number(ev.target.value) })} />
                  </div>
                  {campo('Endereço público do sistema', 'urlPublica', { placeholder: 'https://sistema-julia-dev.webage.com.br', dica: 'Usado nos links de e-mail, WhatsApp e do portal do cliente.' })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {abaAtual === 'textos' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Textos padrão dos laudos</CardTitle>
            <CardDescription>Objetivo, metodologia e conclusão por tipo de serviço. Sem tipo = vale para todos. O laudo em PDF carrega o texto do tipo da vistoria; dá para trocar na hora de emitir.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {textos.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <select className={`${SELECT_CLASS} h-8 w-auto text-xs`} value={t.tipoServico} onChange={(ev) => api.put(`/textos-padrao/${t.id}`, { tipoServico: ev.target.value }).then(carregar)}>
                    <option value="">Todos os tipos</option>
                    {TIPOS.map((tp) => (
                      <option key={tp}>{tp}</option>
                    ))}
                  </select>
                  <select className={`${SELECT_CLASS} h-8 w-auto text-xs`} value={t.secao} onChange={(ev) => api.put(`/textos-padrao/${t.id}`, { secao: ev.target.value }).then(carregar)}>
                    {SECOES.map((s) => (
                      <option key={s.v} value={s.v}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <Input className="h-8 w-56 text-xs" defaultValue={t.titulo} placeholder="Título (opcional)" onBlur={(ev) => ev.target.value !== t.titulo && api.put(`/textos-padrao/${t.id}`, { titulo: ev.target.value }).then(carregar)} />
                  <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => confirm('Excluir este texto?') && api.del(`/textos-padrao/${t.id}`).then(carregar)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue={t.texto} onBlur={(ev) => ev.target.value !== t.texto && api.put(`/textos-padrao/${t.id}`, { texto: ev.target.value }).then(() => avisar('Salvo'))} />
              </div>
            ))}
            <form
              className="rounded-md border border-dashed p-3"
              onSubmit={async (ev) => {
                ev.preventDefault()
                if (!novoTexto.texto.trim()) return
                await api.post('/textos-padrao', novoTexto)
                setNovoTexto({ tipoServico: '', secao: 'conclusao', titulo: '', texto: '' })
                carregar()
              }}
            >
              <p className="mb-2 text-sm font-medium">Novo texto</p>
              <div className="mb-2 flex flex-wrap gap-2">
                <select className={`${SELECT_CLASS} h-8 w-auto text-xs`} value={novoTexto.tipoServico} onChange={(ev) => setNovoTexto({ ...novoTexto, tipoServico: ev.target.value })}>
                  <option value="">Todos os tipos</option>
                  {TIPOS.map((tp) => (
                    <option key={tp}>{tp}</option>
                  ))}
                </select>
                <select className={`${SELECT_CLASS} h-8 w-auto text-xs`} value={novoTexto.secao} onChange={(ev) => setNovoTexto({ ...novoTexto, secao: ev.target.value })}>
                  {SECOES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Input className="h-8 w-56 text-xs" value={novoTexto.titulo} placeholder="Título (opcional)" onChange={(ev) => setNovoTexto({ ...novoTexto, titulo: ev.target.value })} />
              </div>
              <textarea className="mb-2 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={novoTexto.texto} onChange={(ev) => setNovoTexto({ ...novoTexto, texto: ev.target.value })} placeholder="Escreva o parágrafo padrão…" />
              <Button type="submit" size="sm">
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {abaAtual === 'documentos' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Documentos exigidos por tipo de serviço</CardTitle>
            <CardDescription>Ao criar um processo desse tipo, esta lista vira o checklist de documentos do cliente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[...new Set(docs.map((d) => d.tipoServico))].map((tipo) => (
              <div key={tipo} className="rounded-md border">
                <p className="border-b bg-muted/40 px-3 py-2 text-sm font-semibold">{tipo}</p>
                <ul className="divide-y">
                  {docs
                    .filter((d) => d.tipoServico === tipo)
                    .map((d) => (
                      <li key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <Input className="h-8 flex-1" defaultValue={d.nome} onBlur={(ev) => ev.target.value !== d.nome && api.put(`/documentos-modelo/${d.id}`, { nome: ev.target.value }).then(carregar)} />
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={d.obrigatorio} onChange={(ev) => api.put(`/documentos-modelo/${d.id}`, { obrigatorio: ev.target.checked }).then(carregar)} /> obrigatório
                        </label>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => api.del(`/documentos-modelo/${d.id}`).then(carregar)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            <form
              className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3"
              onSubmit={async (ev) => {
                ev.preventDefault()
                if (!novoDoc.nome.trim()) return
                await api.post('/documentos-modelo', novoDoc)
                setNovoDoc({ ...novoDoc, nome: '' })
                carregar()
              }}
            >
              <div className="space-y-1.5">
                <Label>Tipo de serviço</Label>
                <select className={SELECT_CLASS} value={novoDoc.tipoServico} onChange={(ev) => setNovoDoc({ ...novoDoc, tipoServico: ev.target.value })}>
                  {TIPOS.map((tp) => (
                    <option key={tp}>{tp}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label>Documento</Label>
                <Input value={novoDoc.nome} onChange={(ev) => setNovoDoc({ ...novoDoc, nome: ev.target.value })} placeholder="Ex.: Certidão de zoneamento" />
              </div>
              <label className="flex items-center gap-1 pb-2 text-sm">
                <input type="checkbox" checked={novoDoc.obrigatorio} onChange={(ev) => setNovoDoc({ ...novoDoc, obrigatorio: ev.target.checked })} /> obrigatório
              </label>
              <Button type="submit" size="sm">
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {abaAtual === 'checklists' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Checklists por tipo de serviço</CardTitle>
            <CardDescription>Itens “por ambiente” viram um item em cada cômodo da vistoria; os gerais, um só. Aplicados na vistoria com um clique e marcáveis no celular.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[...new Set(chks.map((c) => c.tipoServico))].map((tipo) => (
              <div key={tipo} className="rounded-md border">
                <p className="border-b bg-muted/40 px-3 py-2 text-sm font-semibold">{tipo}</p>
                <ul className="divide-y">
                  {chks
                    .filter((c) => c.tipoServico === tipo)
                    .map((c) => (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <Input className="h-8 flex-1" defaultValue={c.nome} onBlur={(ev) => ev.target.value !== c.nome && api.put(`/checklist-modelos/${c.id}`, { nome: ev.target.value }).then(carregar)} />
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={c.porAmbiente} onChange={(ev) => api.put(`/checklist-modelos/${c.id}`, { porAmbiente: ev.target.checked }).then(carregar)} /> por ambiente
                        </label>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => api.del(`/checklist-modelos/${c.id}`).then(carregar)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            <form
              className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3"
              onSubmit={async (ev) => {
                ev.preventDefault()
                if (!novoChk.nome.trim()) return
                await api.post('/checklist-modelos', novoChk)
                setNovoChk({ ...novoChk, nome: '' })
                carregar()
              }}
            >
              <div className="space-y-1.5">
                <Label>Tipo de serviço</Label>
                <select className={SELECT_CLASS} value={novoChk.tipoServico} onChange={(ev) => setNovoChk({ ...novoChk, tipoServico: ev.target.value })}>
                  {TIPOS.map((tp) => (
                    <option key={tp}>{tp}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label>Item</Label>
                <Input value={novoChk.nome} onChange={(ev) => setNovoChk({ ...novoChk, nome: ev.target.value })} placeholder="Ex.: Extintor dentro da validade" />
              </div>
              <label className="flex items-center gap-1 pb-2 text-sm">
                <input type="checkbox" checked={novoChk.porAmbiente} onChange={(ev) => setNovoChk({ ...novoChk, porAmbiente: ev.target.checked })} /> por ambiente
              </label>
              <Button type="submit" size="sm">
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {abaAtual === 'notificacoes' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">E-mail (SMTP)</CardTitle>
              <CardDescription>Avisos de prazo, vistoria amanhã e laudo emitido por e-mail para o responsável; também a redefinição de senha.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!notif.email?.ativo} onChange={(ev) => salvarNotif({ email: { ativo: ev.target.checked } })} /> Enviar avisos por e-mail
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['host', 'Servidor SMTP', 'smtp.gmail.com'],
                    ['porta', 'Porta', '587'],
                    ['usuario', 'Usuário', 'contato@escritorio.com.br'],
                    ['senha', 'Senha', ''],
                    ['de', 'Remetente (De)', 'Escritório <contato@…>'],
                  ] as const
                ).map(([k, rotulo, ph]) => (
                  <div key={k} className="space-y-1.5">
                    <Label>{rotulo}</Label>
                    <Input
                      type={k === 'senha' ? 'password' : 'text'}
                      defaultValue={String((notif.smtp as any)?.[k] ?? '')}
                      placeholder={ph}
                      onBlur={(ev) => ev.target.value !== String((notif.smtp as any)?.[k] ?? '') && salvarNotif({ smtp: { ...(notif.smtp || {}), [k]: k === 'porta' ? Number(ev.target.value) : ev.target.value } })}
                    />
                  </div>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!notif.smtp?.seguro} onChange={(ev) => salvarNotif({ smtp: { ...(notif.smtp || {}), seguro: ev.target.checked } })} /> Conexão segura (SSL, porta 465)
                </label>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">WhatsApp (Evolution API)</CardTitle>
              <CardDescription>Os mesmos avisos num número do escritório, pela instância da Evolution.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!notif.whatsapp?.ativo} onChange={(ev) => salvarNotif({ whatsapp: { ...(notif.whatsapp || {}), ativo: ev.target.checked } })} /> Enviar avisos por WhatsApp
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['url', 'URL da Evolution', 'https://evolution.exemplo.com'],
                    ['instancia', 'Instância', 'escritorio'],
                    ['apikey', 'API key', ''],
                    ['destino', 'Número de destino', '5511999990000'],
                  ] as const
                ).map(([k, rotulo, ph]) => (
                  <div key={k} className="space-y-1.5">
                    <Label>{rotulo}</Label>
                    <Input
                      type={k === 'apikey' ? 'password' : 'text'}
                      defaultValue={String((notif.whatsapp as any)?.[k] ?? '')}
                      placeholder={ph}
                      onBlur={(ev) => ev.target.value !== String((notif.whatsapp as any)?.[k] ?? '') && salvarNotif({ whatsapp: { ...(notif.whatsapp || {}), [k]: ev.target.value } })}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Testar e acompanhar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (ev) => {
                  ev.preventDefault()
                  try {
                    await api.post('/notificacoes/testar', teste)
                    avisar('Teste enviado')
                  } catch (err: any) {
                    setErro(err?.message || 'Falha no teste')
                  }
                }}
              >
                <div className="space-y-1.5">
                  <Label>Canal</Label>
                  <select className={SELECT_CLASS} value={teste.canal} onChange={(ev) => setTeste({ ...teste, canal: ev.target.value })}>
                    <option value="email">E-mail</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
                <div className="min-w-64 space-y-1.5">
                  <Label>Destinatário</Label>
                  <Input value={teste.destinatario} onChange={(ev) => setTeste({ ...teste, destinatario: ev.target.value })} placeholder="e-mail ou número" />
                </div>
                <Button type="submit" size="sm" variant="outline">
                  <Send className="h-4 w-4" /> Enviar teste
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => api.post('/notificacoes/varrer').then(() => avisar('Varredura feita')).then(carregar)}>
                  <Wand2 className="h-4 w-4" /> Rodar varredura agora
                </Button>
              </form>
              {envios.length > 0 && (
                <ul className="max-h-64 divide-y overflow-auto rounded-md border text-xs">
                  {envios.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className={`rounded px-1.5 ${n.status === 'enviada' ? 'bg-emerald-100 text-emerald-900' : n.status === 'erro' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{n.status}</span>
                      <span className="w-16">{n.canal}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {n.titulo} → {n.destinatario}
                      </span>
                      {n.erro && <span className="truncate text-primary">{n.erro}</span>}
                      <span className="text-muted-foreground">{dataHora(n.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {abaAtual === 'backup' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className={backup?.atrasado ? 'border-primary/60' : ''}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cópia de segurança</CardTitle>
              <CardDescription>O banco e as fotos vivem nesta máquina. O script copia os dois para a pasta backups/ e a tarefa agendada do Windows roda todo dia.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {backup?.ultimo ? (
                <p>
                  Última cópia: <strong>{dataHora(backup.ultimo.em)}</strong> ({backup.ultimo.nome}, {tamanho(backup.ultimo.tamanho)}) · {backup.arquivos} arquivo(s), {tamanho(backup.tamanhoTotal)} no total.
                </p>
              ) : (
                <p className="font-medium text-primary">Nenhuma cópia encontrada em backups/.</p>
              )}
              <div className="rounded-md bg-muted p-3 font-mono text-xs">
                <p># uma vez, como administrador, na raiz do projeto:</p>
                <p>powershell -ExecutionPolicy Bypass -File scripts\registrar-backup.ps1</p>
                <p className="mt-2"># ou manualmente:</p>
                <p>powershell -ExecutionPolicy Bypass -File scripts\backup.ps1</p>
              </div>
              <p className="text-xs text-muted-foreground">O script mantém 14 cópias e apaga as mais antigas. Para guardar fora da máquina, aponte BACKUP_DESTINO_EXTRA para um disco externo ou pasta sincronizada.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <Link href="/lixeira" className="text-primary hover:underline">
                  Lixeira
                </Link>{' '}
                — clientes, imóveis, vistorias e processos excluídos, para restaurar ou apagar de vez.
              </p>
              <p>
                <Link href="/auditoria" className="text-primary hover:underline">
                  Auditoria
                </Link>{' '}
                — quem fez o quê, quando.
              </p>
              <p>
                <Link href="/users" className="text-primary hover:underline">
                  Usuários
                </Link>{' '}
                — papéis, registro profissional e links de redefinição de senha.
              </p>
              <div className="border-t pt-3">
                <Button variant="destructive" size="sm" onClick={() => setLimpar('1')}>
                  <Eraser className="h-4 w-4" /> Limpar dados do sistema
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">Você escolhe o que apagar. Some de vez — não vai para a lixeira e não tem volta. Faça uma cópia de segurança antes.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Limpeza de dados (/configuracoes?aba=backup&limpar=1) */}
      <Dialog open={limpar === '1'} onOpenChange={(o) => !o && fecharLimpeza()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Limpar dados do sistema
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Marque o que apagar. O que sai daqui não vai para a lixeira: some do banco e do disco.</p>
          <ul className="max-h-80 divide-y overflow-auto rounded-md border">
            {grupos.map((g) => {
              const arrastado = alvos.has(g.chave) && !selecao.includes(g.chave)
              return (
                <li key={g.chave} className="px-3 py-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={alvos.has(g.chave)}
                      disabled={arrastado || g.registros === 0}
                      onChange={(ev) => setSelecao(ev.target.checked ? [...selecao, g.chave] : selecao.filter((c) => c !== g.chave))}
                    />
                    <span className={g.registros === 0 ? 'text-muted-foreground' : ''}>
                      <span className="font-medium">{g.label}</span> <span className="text-xs text-muted-foreground">({g.registros} registro(s))</span>
                      {arrastado && <span className="ml-1 text-xs text-destructive">vai junto</span>}
                      <span className="block text-xs text-muted-foreground">{g.descricao}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="space-y-1.5">
            <Label>
              Para confirmar, escreva <strong>APAGAR</strong>
            </Label>
            <Input value={confirmacao} onChange={(ev) => setConfirmacao(ev.target.value)} placeholder="APAGAR" />
          </div>
          {erroLimpeza && <p className="text-sm text-destructive">{erroLimpeza}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={fecharLimpeza}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" disabled={limpando || !alvos.size || confirmacao.trim().toUpperCase() !== 'APAGAR'} onClick={limparDados}>
              <Trash2 className="h-4 w-4" /> {limpando ? 'Apagando…' : `Apagar ${totalAlvo} registro(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
