'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronUp,
  CloudUpload,
  ImageUp,
  LayoutList,
  NotebookPen,
  Plus,
  RotateCw,
  Star,
  X,
} from 'lucide-react'
import { api, getToken } from '@/lib/api'
import { useTitulo } from '@/lib/url'
import { SELECT_CLASS, VistoriaDetalhe, ambientesAchatados } from '@/lib/vistorias'
import { atualizarNaFila, pendentesDaVistoria, removerDaFila, salvarNaFila } from '@/lib/filaCaptura'

interface ItemFila {
  key: number
  idbKey?: number // chave da cópia local no aparelho (IndexedDB)
  blob: Blob
  ambienteId: number | null
  capturadaEm: string
  claquete: boolean
  destaque: boolean
  tentativas: number
}

type Sheet = null | 'lista' | 'novo' | 'nota' | 'fim'

// Captura guiada (Fase 2): a foto nasce no ambiente selecionado, na ordem do
// caminho. Único gesto novo: um toque ao trocar de ambiente. As fotos sobem em
// fila (uma a uma, com retentativa) enquanto a Julia continua fotografando.
export default function CapturaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [det, setDet] = useState<VistoriaDetalhe | null>(null)
  const [atual, setAtual] = useState<number | null>(null)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [fila, setFila] = useState<ItemFila[]>([])
  const [enviadas, setEnviadas] = useState(0)
  const [semConexao, setSemConexao] = useState(false)
  const [ultima, setUltima] = useState<{ key?: number; fotoId?: number; url: string; destaque: boolean } | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [cam, setCam] = useState<'ligando' | 'ok' | 'erro'>('ligando')
  const [flash, setFlash] = useState(false)
  const [novoForm, setNovoForm] = useState({ pavimentoId: '', nome: '' })
  const [notaForm, setNotaForm] = useState({ nota: '', medidas: '' })
  const [concluindo, setConcluindo] = useState(false)
  const [recuperadas, setRecuperadas] = useState(0)
  const [persistente, setPersistente] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const nativoRef = useRef<HTMLInputElement>(null)
  const filaRef = useRef<ItemFila[]>([])
  const workerRef = useRef(false)
  const seqRef = useRef(1)
  const restauroRef = useRef(false)
  filaRef.current = fila

  // ------------------------------------------------------------ dados + auth
  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=/captura/${id}`)
      return
    }
    api.get<{ data: VistoriaDetalhe }>(`/vistorias/${id}`).then((r) => {
      setDet(r.data)
      const c: Record<number, number> = {}
      for (const p of r.data.pavimentos) for (const a of p.ambientes) c[a.id] = a.fotos
      setCounts(c)
      const primeiro = ambientesAchatados(r.data.pavimentos).find((a) => a.situacao !== 'nao_existe')
      setAtual(primeiro ? primeiro.id : null)
      if (r.data.status === 'preparo') api.put(`/vistorias/${id}`, { status: 'campo' }).catch(() => {})

      // Recupera fotos que ficaram pendentes em sessões anteriores (gravadas
      // no aparelho) e retoma o envio de onde parou.
      if (!restauroRef.current) {
        restauroRef.current = true
        pendentesDaVistoria(Number(id))
          .then((pend) => {
            if (!pend.length) return
            const itens: ItemFila[] = pend.map((p) => ({
              key: seqRef.current++,
              idbKey: p.key,
              blob: p.blob,
              ambienteId: p.ambienteId,
              capturadaEm: p.capturadaEm,
              claquete: p.claquete,
              destaque: p.destaque,
              tentativas: 0,
            }))
            setCounts((c) => {
              const m = { ...c }
              for (const it of itens) if (it.ambienteId != null) m[it.ambienteId] = (m[it.ambienteId] || 0) + 1
              return m
            })
            setRecuperadas(itens.length)
            setFila((f) => [...f, ...itens])
          })
          .catch(() => setPersistente(false))
      }
    })
  }, [id, router])

  useTitulo(det ? `Captura — ${det.imovelNome}` : 'Captura')

  // ------------------------------------------------------------ câmera
  useEffect(() => {
    let cancelado = false
    async function ligar() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
          audio: false,
        })
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setCam('ok')
      } catch {
        setCam('erro')
      }
    }
    ligar()
    return () => {
      cancelado = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Aviso ao sair só quando há foto SEM cópia local (fila persistente falhou) —
  // com a cópia no aparelho, fechar é seguro: o envio retoma na reabertura.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (filaRef.current.some((it) => it.idbKey == null)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ------------------------------------------------------------ fila de envio
  const bombear = useCallback(() => {
    if (workerRef.current) return
    workerRef.current = true
    ;(async () => {
      while (filaRef.current.length > 0) {
        const item = filaRef.current[0]
        try {
          const form = new FormData()
          form.append('foto', item.blob, 'captura.jpg')
          if (item.ambienteId != null) form.append('ambienteId', String(item.ambienteId))
          form.append('capturadaEm', item.capturadaEm)
          if (item.claquete) form.append('claquete', '1')
          if (item.destaque) form.append('destaque', '1')
          const r = await api.upload<{ data: { id: number } }>(`/vistorias/${id}/fotos`, form)
          setSemConexao(false)
          setEnviadas((n) => n + 1)
          setUltima((u) => (u && u.key === item.key ? { ...u, key: undefined, fotoId: r.data.id } : u))
          if (item.idbKey != null) removerDaFila(item.idbKey).catch(() => {})
          setFila((f) => f.filter((x) => x.key !== item.key))
        } catch (err: any) {
          const status = err?.status
          if (status >= 400 && status < 500 && item.ambienteId != null) {
            // Rejeição do servidor (ex.: ambiente excluído no escritório): não
            // descarta a foto — reenvia sem ambiente e ela cai na conferência.
            item.ambienteId = null
            item.claquete = false
            if (item.idbKey != null) {
              atualizarNaFila({
                key: item.idbKey,
                vistoriaId: Number(id),
                ambienteId: null,
                capturadaEm: item.capturadaEm,
                claquete: false,
                destaque: item.destaque,
                blob: item.blob,
                criadaEm: item.capturadaEm,
              }).catch(() => {})
            }
            continue
          }
          // Sem conexão (ou erro passageiro): espera e tenta de novo. A foto
          // está gravada no aparelho — nada se perde, mesmo fechando a tela.
          item.tentativas += 1
          if (item.tentativas >= 3) setSemConexao(true)
          await new Promise((r) => setTimeout(r, Math.min(1500 * item.tentativas, 10000)))
        }
      }
      workerRef.current = false
    })()
  }, [id])

  useEffect(() => {
    if (fila.length > 0) bombear()
  }, [fila, bombear])

  const enfileirar = useCallback(
    async (blob: Blob, capturadaEm: string) => {
      if (!atual) return
      const claquete = (counts[atual] || 0) === 0
      setCounts((c) => ({ ...c, [atual]: (c[atual] || 0) + 1 }))
      const item: ItemFila = {
        key: seqRef.current++,
        blob,
        ambienteId: atual,
        capturadaEm,
        claquete,
        destaque: false,
        tentativas: 0,
      }
      // Grava a cópia local ANTES de tentar enviar — fechar a aba não perde a foto.
      try {
        item.idbKey = await salvarNaFila({
          vistoriaId: Number(id),
          ambienteId: item.ambienteId,
          capturadaEm,
          claquete,
          destaque: false,
          blob,
          criadaEm: new Date().toISOString(),
        })
      } catch {
        setPersistente(false) // ex.: navegação privada sem IndexedDB — segue só em memória
      }
      setUltima((u) => {
        if (u?.url) URL.revokeObjectURL(u.url)
        return { key: item.key, url: URL.createObjectURL(blob), destaque: false }
      })
      setFila((f) => [...f, item])
    },
    [atual, counts, id]
  )

  const disparar = () => {
    const video = videoRef.current
    if (!video || cam !== 'ok' || !atual) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    setFlash(true)
    setTimeout(() => setFlash(false), 140)
    canvas.toBlob((blob) => blob && enfileirar(blob, new Date().toISOString()), 'image/jpeg', 0.92)
  }

  const receberNativo = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    enfileirar(f, new Date(f.lastModified || Date.now()).toISOString())
    if (nativoRef.current) nativoRef.current.value = ''
  }

  // ------------------------------------------------------------ ambientes
  const flat = useMemo(() => (det ? ambientesAchatados(det.pavimentos).filter((a) => a.situacao !== 'nao_existe') : []), [det])
  const ambAtual = flat.find((a) => a.id === atual) || null

  const proximo = () => {
    if (!flat.length) return
    const i = flat.findIndex((a) => a.id === atual)
    if (i >= 0 && i < flat.length - 1) setAtual(flat[i + 1].id)
    else setSheet('lista')
  }

  const alternarDestaque = async () => {
    if (!ultima) return
    if (ultima.key != null) {
      const novoValor = !ultima.destaque
      const alvo = fila.find((it) => it.key === ultima.key)
      if (alvo && alvo.idbKey != null) {
        atualizarNaFila({
          key: alvo.idbKey,
          vistoriaId: Number(id),
          ambienteId: alvo.ambienteId,
          capturadaEm: alvo.capturadaEm,
          claquete: alvo.claquete,
          destaque: novoValor,
          blob: alvo.blob,
          criadaEm: alvo.capturadaEm,
        }).catch(() => {})
      }
      setFila((f) => f.map((it) => (it.key === ultima.key ? { ...it, destaque: novoValor } : it)))
      setUltima({ ...ultima, destaque: novoValor })
    } else if (ultima.fotoId != null) {
      const novo = !ultima.destaque
      setUltima({ ...ultima, destaque: novo })
      api.put(`/fotos/${ultima.fotoId}`, { destaque: novo }).catch(() => {})
    }
  }

  const criarAmbiente = async (nomearDepois: boolean) => {
    if (!det) return
    const pavId = Number(novoForm.pavimentoId || det.pavimentos[0]?.id)
    if (!pavId) return
    const r = await api.post<{ data: import('@/lib/vistorias').Ambiente }>(`/pavimentos/${pavId}/ambientes`, {
      nome: nomearDepois ? '' : novoForm.nome.trim(),
      origem: 'campo',
      nomearDepois,
    })
    setDet((d) =>
      d
        ? {
            ...d,
            pavimentos: d.pavimentos.map((p) =>
              p.id === pavId ? { ...p, ambientes: [...p.ambientes, { ...r.data, fotos: 0 }] } : p
            ),
          }
        : d
    )
    setCounts((c) => ({ ...c, [r.data.id]: 0 }))
    setAtual(r.data.id)
    setNovoForm({ pavimentoId: String(pavId), nome: '' })
    setSheet(null)
  }

  const abrirNota = () => {
    if (!ambAtual) return
    setNotaForm({ nota: ambAtual.nota || '', medidas: ambAtual.medidas || '' })
    setSheet('nota')
  }

  const salvarNota = async () => {
    if (!atual) return
    await api.put(`/ambientes/${atual}`, notaForm)
    setDet((d) =>
      d
        ? {
            ...d,
            pavimentos: d.pavimentos.map((p) => ({
              ...p,
              ambientes: p.ambientes.map((a) => (a.id === atual ? { ...a, ...notaForm } : a)),
            })),
          }
        : d
    )
    setSheet(null)
  }

  const marcarNaoExiste = async (ambId: number) => {
    await api.put(`/ambientes/${ambId}`, { situacao: 'nao_existe' })
    setDet((d) =>
      d
        ? {
            ...d,
            pavimentos: d.pavimentos.map((p) => ({
              ...p,
              ambientes: p.ambientes.map((a) => (a.id === ambId ? { ...a, situacao: 'nao_existe' } : a)),
            })),
          }
        : d
    )
    if (atual === ambId) setAtual(flat.find((a) => a.id !== ambId)?.id ?? null)
  }

  const semFoto = useMemo(
    () => flat.filter((a) => a.origem === 'planta' && (counts[a.id] || 0) === 0),
    [flat, counts]
  )

  const concluir = async () => {
    setConcluindo(true)
    try {
      await api.put(`/vistorias/${id}`, { status: 'conferencia' })
      router.push(`/vistorias/${id}`)
    } catch {
      setConcluindo(false)
    }
  }

  if (!det) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-zinc-400">Carregando…</div>
  }

  const totalFotos = enviadas + fila.length

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      {/* A câmera ocupa a tela inteira e TUDO flutua por cima dela. Na horizontal
          — que é como a vistoria é fotografada — uma barra no rodapé roubava
          quase metade da altura útil (e a barra de endereço do navegador rouba o
          resto), então lá os controles vão para a lateral direita. */}
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
      {flash && <div className="absolute inset-0 z-30 bg-white/80" />}

      {/* Topo: onde estou + fila */}
      <header
        className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-3 pb-8"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <button onClick={() => router.push(`/vistorias/${id}`)} className="p-1 text-zinc-400" aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button onClick={() => setSheet('lista')} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[11px] uppercase tracking-wide text-zinc-400">
            {ambAtual ? ambAtual.pavimentoNome : det.imovelNome}
          </p>
          <p className="flex items-center gap-1 truncate text-lg font-semibold leading-tight">
            {ambAtual ? ambAtual.nome : 'Escolher ambiente'}
            <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" />
          </p>
        </button>
        <div className="text-right">
          <p className="text-lg font-semibold leading-tight">{atual ? counts[atual] || 0 : 0}</p>
          <p className="text-[11px] text-zinc-400">fotos aqui</p>
        </div>
        <div
          className={`ml-1 flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
            fila.length === 0 ? 'bg-emerald-900/70 text-emerald-300' : semConexao ? 'bg-rose-900/70 text-rose-300' : 'bg-zinc-800 text-zinc-300'
          }`}
          title={semConexao ? 'Sem conexão — as fotos ficam na fila e sobem quando voltar' : 'Fila de envio'}
        >
          {fila.length === 0 ? <Check className="h-3.5 w-3.5" /> : <CloudUpload className="h-3.5 w-3.5" />}
          {fila.length === 0 ? enviadas : fila.length}
        </div>
        {!persistente && (
          <span
            className="ml-1 rounded-full bg-amber-900/70 px-2 py-1 text-[10px] text-amber-300"
            title="Não consegui gravar cópia local (navegação privada?) — evite fechar com fotos na fila"
          >
            sem cópia local
          </span>
        )}
      </header>

      {/* Avisos sobre a imagem */}
      {ambAtual && (counts[ambAtual.id] || 0) === 0 && cam === 'ok' && (
        <p className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-amber-300">
          1ª foto do ambiente = claquete (planta/placa)
        </p>
      )}
      {/* A foto da vistoria é sempre na horizontal — em pé, o aviso fica no meio
          da tela e some sozinho quando o aparelho é virado. */}
      <div className="pointer-events-none absolute inset-0 z-20 hidden items-center justify-center portrait:flex">
        <p className="flex items-center gap-2 rounded-xl bg-black/75 px-4 py-3 text-sm font-semibold">
          <RotateCw className="h-5 w-5 text-amber-400" /> Vire o celular na horizontal
        </p>
      </div>
      {cam === 'erro' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center">
          <p className="text-sm text-zinc-300">
            Não consegui acessar a câmera pelo navegador. Você ainda pode fotografar com a câmera do sistema:
          </p>
          <button
            onClick={() => nativoRef.current?.click()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            Abrir câmera do celular
          </button>
        </div>
      )}
      {semConexao && fila.length > 0 && (
        <p className="absolute bottom-36 left-1/2 z-20 w-max max-w-[85%] -translate-x-1/2 rounded-full bg-rose-900/85 px-3 py-1 text-center text-xs text-rose-200 landscape:bottom-3 landscape:max-w-[55%]">
          Sem conexão — {fila.length} fotos guardadas no aparelho. Sobem sozinhas quando a conexão voltar, mesmo
          fechando e reabrindo esta tela.
        </p>
      )}
      {!semConexao && recuperadas > 0 && fila.length > 0 && (
        <p className="absolute bottom-36 left-1/2 z-20 w-max max-w-[85%] -translate-x-1/2 rounded-full bg-sky-900/85 px-3 py-1 text-center text-xs text-sky-200 landscape:bottom-3 landscape:max-w-[55%]">
          {fila.length} fotos recuperadas da sessão anterior — enviando…
        </p>
      )}

      {/* Controles: barra no rodapé em pé · coluna na lateral direita deitado.
          Os dois grupos só trocam de eixo (flex-col ⇄ flex-row), o conteúdo é o
          mesmo — cada botão continua com ícone E nome, que é o que permite achar
          a ação sem parar para ler. */}
      <footer
        className="absolute z-20 flex flex-col gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent
                   inset-x-0 bottom-0 px-3 pb-3 pt-10
                   landscape:inset-x-auto landscape:inset-y-0 landscape:right-0 landscape:w-auto landscape:flex-row
                   landscape:items-center landscape:gap-3 landscape:bg-gradient-to-l landscape:py-3 landscape:pl-12 landscape:pr-3 landscape:pt-16"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        }}
      >
        <div className="flex items-center justify-between gap-1 text-xs landscape:flex-col landscape:justify-center landscape:gap-1">
          <button onClick={() => setSheet('novo')} className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-zinc-200 drop-shadow">
            <Plus className="h-5 w-5" /> Novo
          </button>
          <button onClick={abrirNota} className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-zinc-200 drop-shadow disabled:opacity-40" disabled={!ambAtual}>
            <NotebookPen className="h-5 w-5" /> Nota
          </button>
          <button
            onClick={alternarDestaque}
            disabled={!ultima}
            className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 drop-shadow ${ultima?.destaque ? 'text-amber-400' : 'text-zinc-200'} disabled:opacity-40`}
          >
            <Star className={`h-5 w-5 ${ultima?.destaque ? 'fill-amber-400' : ''}`} /> Destaque
          </button>
          <button onClick={() => nativoRef.current?.click()} className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-zinc-200 drop-shadow">
            <ImageUp className="h-5 w-5" /> Nativa
          </button>
          <button onClick={() => setSheet('fim')} className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-zinc-200 drop-shadow">
            <Check className="h-5 w-5" /> Encerrar
          </button>
        </div>
        <div className="flex items-center justify-between landscape:flex-col landscape:justify-center landscape:gap-5">
          <button onClick={() => setSheet('lista')} className="flex h-12 w-16 items-center justify-center rounded-xl bg-zinc-800/80 landscape:h-11 landscape:w-14" aria-label="Lista de ambientes">
            <LayoutList className="h-6 w-6" />
          </button>
          {/* Deitado a miniatura entra na coluna, acima do disparo: à esquerda ela
              cairia por cima dos botões de ação. */}
          <div className="relative landscape:flex landscape:flex-col landscape:items-center landscape:gap-2">
            {ultima && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ultima.url}
                alt="Última foto"
                className={`absolute -left-20 top-1/2 h-14 w-14 -translate-y-1/2 rounded-lg border-2 object-cover landscape:static landscape:h-12 landscape:w-12 landscape:translate-y-0 ${
                  ultima.destaque ? 'border-amber-400' : 'border-zinc-700'
                }`}
              />
            )}
            <button
              onClick={disparar}
              disabled={cam !== 'ok' || !atual}
              className="h-[76px] w-[76px] rounded-full border-4 border-zinc-500 bg-white active:scale-95 disabled:opacity-30 landscape:h-[68px] landscape:w-[68px]"
              aria-label="Fotografar"
            />
          </div>
          <button onClick={proximo} className="flex h-12 w-16 items-center justify-center gap-1 rounded-xl bg-zinc-800/80 text-sm font-medium landscape:h-11 landscape:w-14" aria-label="Próximo ambiente">
            <ArrowRight className="h-6 w-6 landscape:rotate-90" />
          </button>
        </div>
      </footer>

      <input ref={nativoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => receberNativo(e.target.files)} />

      {/* Sheets */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setSheet(null)} />
          <div
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80%] overflow-auto rounded-t-2xl bg-zinc-900 p-4"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {sheet === 'lista' && 'Ambientes'}
                {sheet === 'novo' && 'Novo ambiente (não estava na planta)'}
                {sheet === 'nota' && `Nota — ${ambAtual?.nome || ''}`}
                {sheet === 'fim' && 'Encerrar captura'}
              </h2>
              <button onClick={() => setSheet(null)} className="p-1 text-zinc-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            {sheet === 'lista' && (
              <div className="space-y-3">
                {det.pavimentos.map((p) => (
                  <div key={p.id}>
                    <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">{p.nome}</p>
                    <div className="space-y-1">
                      {p.ambientes
                        .filter((a) => a.situacao !== 'nao_existe')
                        .map((a) => (
                          <button
                            key={a.id}
                            onClick={() => {
                              setAtual(a.id)
                              setSheet(null)
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${
                              a.id === atual ? 'bg-white text-black' : 'bg-zinc-800'
                            }`}
                          >
                            <span className="flex-1">
                              {a.nome}
                              {a.origem === 'campo' && <span className="ml-2 text-xs text-amber-500">novo</span>}
                            </span>
                            <span className="text-xs opacity-60">{counts[a.id] || 0} fotos</span>
                            {(counts[a.id] || 0) > 0 && <Check className="h-4 w-4 text-emerald-500" />}
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
                <button onClick={() => setSheet('novo')} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-600 px-3 py-2.5 text-sm text-zinc-300">
                  <Plus className="h-4 w-4" /> Novo ambiente
                </button>
              </div>
            )}

            {sheet === 'novo' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Pavimento</label>
                  <select
                    className={`${SELECT_CLASS} border-zinc-700 bg-zinc-800 text-white`}
                    value={novoForm.pavimentoId || String(det.pavimentos[0]?.id || '')}
                    onChange={(e) => setNovoForm({ ...novoForm, pavimentoId: e.target.value })}
                  >
                    {det.pavimentos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Nome do ambiente</label>
                  <input
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                    placeholder="Ex.: Depósito"
                    value={novoForm.nome}
                    onChange={(e) => setNovoForm({ ...novoForm, nome: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => criarAmbiente(false)}
                    disabled={!novoForm.nome.trim()}
                    className="flex-1 rounded-lg bg-white px-3 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
                  >
                    Criar e fotografar
                  </button>
                  <button onClick={() => criarAmbiente(true)} className="flex-1 rounded-lg bg-zinc-700 px-3 py-2.5 text-sm">
                    Nomear depois
                  </button>
                </div>
                <p className="text-xs text-zinc-500">
                  Ambientes criados aqui ficam marcados como divergência “não estava na planta”.
                </p>
              </div>
            )}

            {sheet === 'nota' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Observações</label>
                  <textarea
                    className="h-24 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                    placeholder="Ex.: trinca na parede norte, extintor vencido…"
                    value={notaForm.nota}
                    onChange={(e) => setNotaForm({ ...notaForm, nota: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Medidas</label>
                  <input
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
                    placeholder="Ex.: 3,20 × 4,15 m · pé-direito 2,70"
                    value={notaForm.medidas}
                    onChange={(e) => setNotaForm({ ...notaForm, medidas: e.target.value })}
                  />
                </div>
                <button onClick={salvarNota} className="w-full rounded-lg bg-white px-3 py-2.5 text-sm font-semibold text-black">
                  Salvar nota
                </button>
              </div>
            )}

            {sheet === 'fim' && (
              <div className="space-y-4">
                <p className="text-sm text-zinc-300">
                  {totalFotos} fotos nesta vistoria · {enviadas} enviadas
                  {fila.length > 0 ? ` · ${fila.length} na fila` : ''}
                </p>
                {semFoto.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-amber-400">
                      Ambientes previstos ainda sem foto — esquecimento ou não existem?
                    </p>
                    {semFoto.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-sm">
                        <span className="flex-1">
                          {a.pavimentoNome} — {a.nome}
                        </span>
                        <button
                          onClick={() => {
                            setAtual(a.id)
                            setSheet(null)
                          }}
                          className="rounded bg-white px-2 py-1 text-xs font-semibold text-black"
                        >
                          Fotografar
                        </button>
                        <button onClick={() => marcarNaoExiste(a.id)} className="rounded bg-rose-900 px-2 py-1 text-xs text-rose-200">
                          Não existe
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {fila.length > 0 && (
                  <p className="text-xs text-amber-400">
                    Aguarde o envio das {fila.length} fotos na fila para concluir. Elas estão gravadas no aparelho —
                    se precisar sair, nada se perde: reabra esta tela depois e o envio continua de onde parou.
                  </p>
                )}
                <button
                  onClick={concluir}
                  disabled={fila.length > 0 || concluindo}
                  className="w-full rounded-lg bg-emerald-500 px-3 py-3 text-sm font-bold text-black disabled:opacity-40"
                >
                  {concluindo ? 'Concluindo…' : 'Concluir captura → conferência'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
