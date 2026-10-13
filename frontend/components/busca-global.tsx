'use client'

// Busca global (Ctrl+K ou o campo do menu): uma caixa só acha cliente, imóvel,
// processo, vistoria, protocolo, laudo e arquivo. Setas navegam, Enter abre.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, ClipboardList, FileCheck, FileText, FolderOpen, Home, Search, Stamp } from 'lucide-react'
import { api } from '@/lib/api'
import { ETAPA_LABEL } from '@/lib/regularizacao'
import { STATUS_LABEL } from '@/lib/vistorias'

interface Resultado {
  chave: string
  grupo: string
  titulo: string
  detalhe: string
  href: string
  icone: typeof Search
}

export function BuscaGlobal({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [itens, setItens] = useState<Resultado[]>([])
  const [ativo, setAtivo] = useState(0)
  const [buscando, setBuscando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (aberta) {
      setQ('')
      setItens([])
      setAtivo(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [aberta])

  const buscar = useCallback(async (texto: string) => {
    if (texto.trim().length < 2) return setItens([])
    setBuscando(true)
    try {
      const r = await api.get<{ data: any }>(`/busca?q=${encodeURIComponent(texto.trim())}`)
      const d = r.data
      const lista: Resultado[] = [
        ...d.processos.map((p: any) => ({ chave: `p${p.id}`, grupo: 'Processos', titulo: `${p.numero} — ${p.titulo}`, detalhe: `${p.clienteNome} · ${ETAPA_LABEL[p.etapa] || p.etapa}`, href: `/processos/${p.id}`, icone: FolderOpen })),
        ...d.clientes.map((c: any) => ({ chave: `c${c.id}`, grupo: 'Clientes', titulo: c.nome, detalhe: [c.documento, c.email].filter(Boolean).join(' · '), href: `/clients?editar=${c.id}`, icone: Briefcase })),
        ...d.imoveis.map((i: any) => ({ chave: `i${i.id}`, grupo: 'Imóveis', titulo: i.nome, detalhe: `${i.clienteNome}${i.endereco ? ` · ${i.endereco}` : ''}`, href: `/imoveis/${i.id}`, icone: Home })),
        ...d.vistorias.map((v: any) => ({ chave: `v${v.id}`, grupo: 'Vistorias', titulo: `Vistoria #${v.id} — ${v.imovelNome}`, detalhe: `${v.tipoServico || 'sem tipo'} · ${STATUS_LABEL[v.status] || v.status}`, href: `/vistorias/${v.id}`, icone: ClipboardList })),
        ...d.protocolos.map((pr: any) => ({ chave: `pr${pr.id}`, grupo: 'Protocolos', titulo: `${pr.numero || pr.assunto}`, detalhe: `${pr.processoTitulo} · ${pr.status}`, href: `/processos/${pr.processoId}?protocolo=${pr.id}`, icone: Stamp })),
        ...d.laudos.map((l: any) => ({ chave: `l${l.id}`, grupo: 'Laudos emitidos', titulo: `${l.numero} v${l.versao}`, detalhe: `${l.titulo} · ${l.imovelNome}`, href: `/relatorios?aba=emitidos&busca=${encodeURIComponent(l.numero)}`, icone: FileCheck })),
        ...d.arquivos.map((a: any) => ({ chave: `a${a.id}`, grupo: 'Arquivos', titulo: a.nome, detalhe: a.categoria, href: a.processoId ? `/processos/${a.processoId}?aba=arquivos` : a.imovelId ? `/imoveis/${a.imovelId}` : '/processos', icone: FileText })),
      ]
      setItens(lista)
      setAtivo(0)
    } catch {
      setItens([])
    } finally {
      setBuscando(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => buscar(q), 250)
    return () => clearTimeout(t)
  }, [q, buscar])

  const abrir = (r: Resultado) => {
    onFechar()
    router.push(r.href)
  }

  if (!aberta) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onClick={onFechar}>
      <div className="w-full max-w-xl overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAtivo((a) => Math.min(a + 1, itens.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setAtivo((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && itens[ativo]) abrir(itens[ativo])
              else if (e.key === 'Escape') onFechar()
            }}
            placeholder="Buscar cliente, imóvel, processo, protocolo, laudo…"
            className="h-12 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="rounded border px-1.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <ul className="max-h-[60vh] overflow-auto py-1">
          {q.trim().length < 2 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Digite ao menos duas letras. Também acha por número: #12, PROC-2026-001, LIP-2026-003.</li>}
          {q.trim().length >= 2 && !buscando && itens.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nada encontrado para “{q}”.</li>}
          {itens.map((r, i) => {
            const Icone = r.icone
            const novoGrupo = i === 0 || itens[i - 1].grupo !== r.grupo
            return (
              <li key={r.chave}>
                {novoGrupo && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{r.grupo}</p>}
                <button
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => abrir(r)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === ativo ? 'bg-accent' : ''}`}
                >
                  <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.titulo}</span>
                    {r.detalhe && <span className="block truncate text-xs text-muted-foreground">{r.detalhe}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
