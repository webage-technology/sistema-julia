'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Download, Images, Library, Loader2, Save } from 'lucide-react'
import { api, apiUrl, baixarBlob } from '@/lib/api'
import { useTitulo } from '@/lib/url'
import { Relatorio } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// O documento. Tudo o que sai no Word é editável aqui: a capa, o texto livre da
// localização e a legenda de cada foto. O que não é editável é derivado da
// vistoria (imóvel, cliente, ambientes) — muda lá e reflete aqui.
interface FotoRel {
  id: number
  legenda: string
  incluida: boolean
  claquete: boolean
  destaque: boolean
}
interface Secao {
  id: number
  nome: string
  pavimentoNome: string
  numero: string
  fotos: FotoRel[]
}
type Detalhe = Relatorio & { secoes: Secao[] }

export default function RelatorioDocumentoPage() {
  const { id } = useParams<{ id: string }>()
  const [det, setDet] = useState<Detalhe | null>(null)
  const [salvo, setSalvo] = useState<string | null>(null)
  const [baixandoPdf, setBaixandoPdf] = useState(false)

  const carregar = useCallback(() => {
    api.get<{ data: Detalhe }>(`/relatorios/${id}`).then((r) => setDet(r.data))
  }, [id])
  useEffect(() => {
    carregar()
  }, [carregar])

  useTitulo(det ? `${det.titulo} — ${det.imovelNome}` : 'Relatório')

  // Daqui para baixo não pode haver hook (o return só acontece no 1º render).
  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  const avisar = (texto: string) => {
    setSalvo(texto)
    setTimeout(() => setSalvo(null), 2000)
  }

  // Cabeçalho e texto livre salvam ao sair do campo — sem botão "salvar" para
  // esquecer. O mesmo padrão das divergências do EVTL.
  const salvarCampo = async (campos: Partial<Relatorio>) => {
    const r = await api.put<{ data: Relatorio }>(`/relatorios/${id}`, campos)
    setDet((d) => d && { ...d, ...r.data })
    avisar('Salvo')
  }

  const marcar = async (ids: number[], incluir: boolean) => {
    if (!ids.length) return
    const alvo = new Set(ids)
    setDet(
      (d) =>
        d && {
          ...d,
          secoes: d.secoes.map((s) => ({
            ...s,
            fotos: s.fotos.map((f) => (alvo.has(f.id) ? { ...f, incluida: incluir } : f)),
          })),
        }
    )
    try {
      await api.post(`/relatorios/${id}/fotos`, { ids, incluir })
    } catch {
      carregar() // servidor recusou: volta ao que ele tem
    }
  }

  // A legenda é da FOTO: escrita aqui, serve a qualquer relatório dela.
  const salvarLegenda = async (fotoId: number, legenda: string) => {
    setDet(
      (d) =>
        d && {
          ...d,
          secoes: d.secoes.map((s) => ({
            ...s,
            fotos: s.fotos.map((f) => (f.id === fotoId ? { ...f, legenda } : f)),
          })),
        }
    )
    await api.put(`/fotos/${fotoId}`, { legenda })
    avisar('Legenda salva')
  }

  const todas = det.secoes.flatMap((s) => s.fotos)
  const incluidas = todas.filter((f) => f.incluida)
  // O número da imagem no Word é contínuo e segue a ordem das seções — o mesmo
  // cálculo do backend, para conferir antes de gerar.
  const numeroDaImagem = new Map<number, number>()
  let n = 0
  for (const f of todas) if (f.incluida) numeroDaImagem.set(f.id, ++n)

  // Modelo do escritório (.docx): o documento é o arquivo dela, preenchido com
  // os cadastros — as fotos não entram, então a escolha de fotos some da tela.
  const doWord = det.modeloTipo === 'docx'

  // O mesmo recorte de fotos, em PDF: é o laudo fotográfico do servidor
  // limitado às fotos deste documento. O modelo do escritório não tem PDF —
  // ele é o .docx dela, preenchido.
  const baixarPdf = async () => {
    setBaixandoPdf(true)
    try {
      const blob = await api.blob(`/vistorias/${det.vistoriaId}/laudos/previa`, {
        modelo: 'fotografico',
        opcoes: { titulo: det.titulo, relatorioId: Number(id) },
      })
      baixarBlob(blob, `${det.titulo.replace(/[\\/:*?"<>|]/g, '-')}.pdf`)
    } catch (err: any) {
      alert(err?.message || 'Falha ao gerar o PDF')
    } finally {
      setBaixandoPdf(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href={`/relatorios?vistoria=${det.vistoriaId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Relatórios da vistoria #{det.vistoriaId}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{det.titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {det.modeloNome || det.modelo} · {det.imovelNome} · {det.clienteNome} ·{' '}
            <Link href={`/vistorias/${det.vistoriaId}`} className="text-primary hover:underline">
              vistoria #{det.vistoriaId}
            </Link>
          </p>
        </div>
        <span className="flex items-center gap-2">
          {salvo && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Save className="h-3.5 w-3.5" /> {salvo}
            </span>
          )}
          {/* Modelo do escritório não depende de foto: sai sempre. O fotográfico
              precisa de pelo menos uma, senão o documento sairia vazio. */}
          {!doWord && (
            <Button variant="outline" onClick={baixarPdf} disabled={!incluidas.length || baixandoPdf}>
              {baixandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar PDF
            </Button>
          )}
          <a href={doWord || incluidas.length ? apiUrl(`/relatorios/${id}/docx`) : undefined}>
            <Button disabled={!doWord && !incluidas.length}>
              <Download className="h-4 w-4" /> Baixar Word (.docx)
            </Button>
          </a>
        </span>
      </div>

      {/* Capa */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{doWord ? 'Dados do documento' : 'Capa'}</CardTitle>
          <CardDescription>
            {doWord ? (
              <>
                Preenchem os campos <code className="rounded bg-muted px-1">{'{{titulo}}'}</code>,{' '}
                <code className="rounded bg-muted px-1">{'{{endereco}}'}</code>,{' '}
                <code className="rounded bg-muted px-1">{'{{data}}'}</code> e{' '}
                <code className="rounded bg-muted px-1">{'{{fonte}}'}</code> do modelo. Cliente, imóvel, vistoria e
                responsável vêm dos cadastros e não se editam aqui.
              </>
            ) : (
              'É o que sai na primeira página do documento.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Título</Label>
            <Input
              defaultValue={det.titulo}
              onBlur={(e) => e.target.value !== det.titulo && salvarCampo({ titulo: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Endereço do imóvel</Label>
            <Input
              defaultValue={det.subtitulo}
              placeholder={det.endereco || 'Av. Exemplo, n° 000 — Bairro, Cidade — UF'}
              onBlur={(e) => e.target.value !== det.subtitulo && salvarCampo({ subtitulo: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data da capa</Label>
            <Input
              defaultValue={det.dataTexto}
              placeholder="09/2026"
              onBlur={(e) => e.target.value !== det.dataTexto && salvarCampo({ dataTexto: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fonte das fotos (legenda)</Label>
            <Input
              defaultValue={det.fonte}
              onBlur={(e) => e.target.value !== det.fonte && salvarCampo({ fonte: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Espaço livre — é aqui que a Julia escreve o que o sistema não sabe */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {doWord ? 'Texto do documento' : '1. Localização do imóvel e informações gerais'}
          </CardTitle>
          <CardDescription>
            {doWord ? (
              <>
                Entra onde o modelo tiver <code className="rounded bg-muted px-1">{'{{texto}}'}</code>. Escreva o que o
                sistema não tem — contexto do imóvel, escopo do trabalho, quem acompanhou, o que ficou pendente.
              </>
            ) : (
              'Espaço livre do documento: sai logo abaixo do endereço, um parágrafo por linha. Escreva o que o sistema não tem — contexto do imóvel, escopo do trabalho, quem acompanhou, o que ficou pendente.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            defaultValue={det.texto}
            placeholder="Ex.: A vistoria foi realizada em 12/09/2026, acompanhada pelo responsável técnico do empreendimento…"
            onBlur={(e) => e.target.value !== det.texto && salvarCampo({ texto: e.target.value })}
          />
        </CardContent>
      </Card>

      {/* Fotos por ambiente — só o modelo nativo monta as páginas de fotos */}
      {!doWord && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Vistoria — fotos por ambiente</CardTitle>
          <CardDescription>
            Cada ambiente vira uma subseção (2.1, 2.2…) com as fotos em duas colunas. Clique na foto para tirar ou pôr
            de volta; escreva a legenda ao lado — vazia, sai o nome do ambiente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3">
            <p className="min-w-40 flex-1 text-sm text-muted-foreground">
              {incluidas.length} de {todas.length} fotos no relatório
            </p>
            <Button variant="outline" onClick={() => marcar(todas.map((f) => f.id), true)}>
              Incluir todas
            </Button>
            <Button variant="outline" onClick={() => marcar(todas.map((f) => f.id), false)}>
              Nenhuma
            </Button>
          </div>

          {det.secoes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Esta vistoria ainda não tem fotos ligadas a ambientes. Faça a conferência (ou importe uma vistoria já
              realizada) para que as fotos apareçam aqui.
            </p>
          )}

          {det.secoes.map((s) => {
            const daSecao = s.fotos.filter((f) => f.incluida)
            const todasMarcadas = s.fotos.length > 0 && daSecao.length === s.fotos.length
            return (
              <div key={s.id} className="rounded-md border">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                  <span className="text-xs font-semibold text-primary">{s.numero}</span>
                  <span className="flex-1 text-sm font-semibold">{s.nome}</span>
                  <span className="text-xs text-muted-foreground">{s.pavimentoNome}</span>
                  <span className="text-xs text-muted-foreground">
                    {daSecao.length}/{s.fotos.length} fotos
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => marcar(s.fotos.map((f) => f.id), !todasMarcadas)}>
                    {todasMarcadas ? 'Tirar todas' : 'Incluir todas'}
                  </Button>
                </div>
                <ul className="divide-y">
                  {s.fotos.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 p-3">
                      <button
                        onClick={() => marcar([f.id], !f.incluida)}
                        title={f.incluida ? 'Tirar do relatório' : 'Incluir no relatório'}
                        className={`relative w-28 shrink-0 overflow-hidden rounded border-2 transition-opacity ${
                          f.incluida ? 'border-primary' : 'border-transparent opacity-40 hover:opacity-75'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={apiUrl(`/fotos/${f.id}/thumb`)}
                          alt={s.nome}
                          className="aspect-[4/3] w-full object-cover"
                        />
                        {f.incluida && (
                          <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                        {f.claquete && (
                          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-amber-300">
                            C
                          </span>
                        )}
                      </button>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {f.incluida
                            ? `Imagem ${String(numeroDaImagem.get(f.id)).padStart(2, '0')}`
                            : 'Fora do relatório'}
                        </p>
                        <Input
                          className="h-9"
                          defaultValue={f.legenda}
                          placeholder={s.nome}
                          onBlur={(e) => e.target.value !== f.legenda && salvarLegenda(f.id, e.target.value)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Images className="h-3.5 w-3.5" /> A numeração das imagens é contínua no documento inteiro e segue esta
            ordem.
          </p>
        </CardContent>
      </Card>
      )}

      {/* Modelo do escritório: o que sai é o .docx dele, preenchido. */}
      {doWord && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">De onde vêm os dados</CardTitle>
            <CardDescription>
              O documento é o seu modelo do Word, preenchido com o cadastro do cliente, do imóvel e desta vistoria. As
              fotos não entram neste modelo — para o documento com as páginas de fotos, use o Relatório fotográfico.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="divide-y rounded-md border">
              {[
                ['Cliente', det.clienteNome],
                ['Imóvel', det.imovelNome],
                ['Endereço', det.subtitulo || det.endereco],
                ['Vistoria', `#${det.vistoriaId}${det.dataVistoria ? ` · ${det.dataVistoria.split('-').reverse().join('/')}` : ''}`],
                ['Tipo de serviço', det.tipoServico],
              ].map(([rotulo, valor]) => (
                <li key={rotulo} className="flex gap-3 px-3 py-1.5">
                  <span className="w-32 shrink-0 text-muted-foreground">{rotulo}</span>
                  <span className="min-w-0 flex-1">{valor || '—'}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Para corrigir algum destes dados, edite o cadastro correspondente — o documento é gerado na hora do
              download, então a correção já sai no próximo.
            </p>
            <Link
              href="/relatorios/modelos"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Library className="h-4 w-4" /> Ver os campos deste e dos outros modelos
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
