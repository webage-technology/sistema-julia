'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FolderUp, Images, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { useTitulo } from '@/lib/url'
import { Separacao, VistoriaDetalhe, resumoSeparacao, separarPorCartoes } from '@/lib/vistorias'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Importar uma vistoria JÁ REALIZADA — as fotos que já estão no computador,
// separadas em pastas por pavimento/ambiente. É o caminho inverso do
// "Exportar pastas (ZIP)": a mesma estrutura ("01 - Térreo/02 - Cozinha/…")
// volta para dentro do sistema, com os ambientes criados na hora.
//
// Escolhe-se a PASTA (não o .zip): o navegador entrega os arquivos com o caminho
// relativo, e o envio é foto a foto — com progresso, sem limite de tamanho total
// e reaproveitando o processamento que já existe (EXIF, HEIC, miniaturas). Um
// .zip teria de caber numa requisição só. Se as fotos vieram zipadas, basta
// descompactar antes e apontar para a pasta.
const EXT_IMAGEM = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i

interface Arquivo {
  file: File
  pasta: string // caminho relativo SEM a pasta raiz e sem o nome do arquivo
}

interface Progresso {
  total: number
  feitas: number
  erros: string[]
  ambientes: number
  pavimentos: number
  separacao?: Separacao
}

export default function ImportarVistoriaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)
  const [arquivos, setArquivos] = useState<Arquivo[]>([])
  const [prog, setProg] = useState<Progresso | null>(null)
  const pastaRef = useRef<HTMLInputElement>(null)
  const soltosRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(() => {
    api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`).then((r) => setDet(r.data))
  }, [id])
  useEffect(() => {
    carregar()
  }, [carregar])

  useTitulo(det ? `Importar fotos — vistoria #${det.id}` : 'Importar vistoria')

  // Prévia: quantas fotos vão para cada pasta (é o que virará ambiente).
  const porPasta = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const a of arquivos) mapa.set(a.pasta, (mapa.get(a.pasta) || 0) + 1)
    return [...mapa.entries()].sort((x, y) => x[0].localeCompare(y[0]))
  }, [arquivos])

  if (!det) return <p className="text-sm text-muted-foreground">Carregando…</p>

  // O navegador dá o caminho como "<pasta escolhida>/01 - Térreo/…/foto.jpg".
  // Tiramos a raiz (que é só o nome da pasta no computador) e o nome do arquivo.
  const escolher = (files: FileList | null) => {
    if (!files?.length) return
    const lista: Arquivo[] = []
    for (const file of Array.from(files)) {
      if (!EXT_IMAGEM.test(file.name)) continue // Thumbs.db, .DS_Store, PDFs…
      const partes = (file.webkitRelativePath || '').split('/')
      lista.push({ file, pasta: partes.length > 1 ? partes.slice(1, -1).join('/') : '' })
    }
    lista.sort((a, b) => `${a.pasta}/${a.file.name}`.localeCompare(`${b.pasta}/${b.file.name}`))
    setArquivos(lista)
    setProg(null)
  }

  // 1) o servidor cria os pavimentos/ambientes das pastas e devolve pasta →
  // ambienteId; 2) as fotos sobem uma a uma, já com o ambiente resolvido.
  const importar = async () => {
    if (!arquivos.length) return
    const pastas = [...new Set(arquivos.map((a) => a.pasta))]
    let mapa: Record<string, number | null> = {}
    let criados = { pavimentos: 0, ambientes: 0 }
    try {
      const r = await api.post<{ data: { pastas: Record<string, number | null>; pavimentos: number; ambientes: number } }>(
        `/vistorias/${id}/importar`,
        { pastas }
      )
      mapa = r.data.pastas
      criados = { pavimentos: r.data.pavimentos, ambientes: r.data.ambientes }
    } catch (err: any) {
      alert(err?.message || 'Falha ao criar os ambientes das pastas')
      return
    }

    setProg({ total: arquivos.length, feitas: 0, erros: [], ...criados })
    let i = 0
    const worker = async () => {
      while (i < arquivos.length) {
        const a = arquivos[i++]
        const form = new FormData()
        form.append('foto', a.file)
        const amb = mapa[a.pasta]
        if (amb) form.append('ambienteId', String(amb))
        // A data real vem do EXIF no servidor; isto é só o plano B.
        if (a.file.lastModified) form.append('capturadaEm', new Date(a.file.lastModified).toISOString())
        try {
          await api.upload(`/vistorias/${id}/fotos`, form)
        } catch (err: any) {
          setProg((p) => p && { ...p, erros: [...p.erros, `${a.file.name}: ${err?.message || 'erro'}`] })
        } finally {
          setProg((p) => p && { ...p, feitas: p.feitas + 1 })
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    // Fotos soltas (sem pasta) com cartão de claquete: separa sozinho.
    if (arquivos.some((a) => !mapa[a.pasta])) {
      try {
        const s = await separarPorCartoes(id)
        setProg((p) => p && { ...p, separacao: s })
      } catch {
        /* sem separação, as soltas ficam na conferência como antes */
      }
    }
    carregar()
  }

  const emAndamento = !!prog && prog.feitas < prog.total
  const concluido = !!prog && prog.feitas === prog.total

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/vistorias/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Vistoria #{det.id} — {det.imovelNome}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Importar vistoria já realizada</h1>
        <p className="text-sm text-muted-foreground">
          Traga as fotos que já estão no computador. Se elas estão separadas em pastas por pavimento e ambiente, os
          ambientes são criados junto — e o relatório sai direto, sem conferência.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Escolha as fotos</CardTitle>
          <CardDescription>
            O ideal é escolher a <strong>pasta</strong> da vistoria, no formato{' '}
            <code className="rounded bg-muted px-1">Térreo/Cozinha/foto.jpg</code> — o mesmo que “Exportar pastas (ZIP)”
            gera. Vieram num .zip? Descompacte antes e aponte para a pasta. Fotos soltas também servem: se foram
            tiradas com os <strong>cartões de claquete (QR)</strong>, o sistema separa por ambiente sozinho; sem
            cartão, você separa na conferência.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => pastaRef.current?.click()} disabled={emAndamento}>
            <FolderUp className="h-4 w-4" /> Escolher pasta da vistoria
          </Button>
          <input
            ref={pastaRef}
            type="file"
            multiple
            className="hidden"
            // webkitdirectory não está na tipagem do React — é atributo do DOM.
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={(e) => escolher(e.target.files)}
          />
          <Button variant="outline" onClick={() => soltosRef.current?.click()} disabled={emAndamento}>
            <Images className="h-4 w-4" /> Escolher fotos soltas
          </Button>
          <input
            ref={soltosRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => escolher(e.target.files)}
          />
        </CardContent>
      </Card>

      {arquivos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              2. Confira: {arquivos.length} fotos em {porPasta.length} pasta(s)
            </CardTitle>
            <CardDescription>
              Cada pasta vira um ambiente (o primeiro nível vira o pavimento). Prefixos de numeração como “01 - ” são
              removidos, e o que já existe na vistoria é reaproveitado — nada é duplicado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="max-h-72 divide-y overflow-auto rounded-md border text-sm">
              {porPasta.map(([pasta, n]) => (
                <li key={pasta} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="flex-1 truncate">{pasta || <em className="text-muted-foreground">sem ambiente (vai para a conferência)</em>}</span>
                  <span className="text-xs text-muted-foreground">{n} fotos</span>
                </li>
              ))}
            </ul>
            <Button size="lg" onClick={importar} disabled={emAndamento}>
              <Upload className="h-5 w-5" /> Importar {arquivos.length} fotos
            </Button>
          </CardContent>
        </Card>
      )}

      {prog && (
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            {emAndamento ? (
              <p>
                Enviando fotos… {prog.feitas}/{prog.total}
              </p>
            ) : (
              <p className="font-medium">
                Importação concluída: {prog.total - prog.erros.length} de {prog.total} fotos
                {prog.ambientes > 0 ? `, ${prog.ambientes} ambientes criados` : ''}
                {prog.pavimentos > 0 ? ` em ${prog.pavimentos} pavimento(s)` : ''}.
              </p>
            )}
            {prog.separacao && <p>{resumoSeparacao(prog.separacao)}</p>}
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${prog.total ? Math.round((prog.feitas / prog.total) * 100) : 0}%` }}
              />
            </div>
            {prog.erros.length > 0 && (
              <ul className="list-disc pl-5 text-destructive">
                {prog.erros.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {concluido && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={() => router.push(`/relatorios?vistoria=${id}`)}>Ir para os relatórios</Button>
                <Button variant="outline" onClick={() => router.push(`/vistorias/${id}/conferencia`)}>
                  Abrir a conferência
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
