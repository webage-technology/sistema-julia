'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Users,
  Briefcase,
  LogOut,
  Building2,
  Home,
  ClipboardList,
  Bot,
  CalendarDays,
  Camera,
  FileText,
  Menu,
  X,
  LayoutDashboard,
  FolderOpen,
  Wallet,
  Settings,
  Search,
} from 'lucide-react'
import { api, getToken, sair } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ehAdmin, mexeDinheiro, PAPEL_LABEL } from '@/lib/papeis'
import { Sino } from '@/components/sino'
import { BuscaGlobal } from '@/components/busca-global'
import { RegistrarSW } from '@/components/registrar-sw'

// Na ordem do trabalho: o painel diz o que precisa de atenção; o processo é o
// contrato com o cliente; depois os cadastros que ele agrega (cliente, imóvel,
// vistoria), os entregáveis e a agenda. Usuários e configurações no fim.
const NAV = [
  { href: '/painel', label: 'Painel', icon: LayoutDashboard },
  { href: '/processos', label: 'Processos', icon: FolderOpen },
  { href: '/clients', label: 'Clientes', icon: Briefcase },
  { href: '/imoveis', label: 'Imóveis', icon: Home },
  // Cronograma (/viagens) não fica no menu: é aba dentro de Vistorias.
  { href: '/vistorias', label: 'Vistorias', icon: ClipboardList },
  { href: '/relatorios', label: 'Relatórios', icon: FileText },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/financeiro', label: 'Financeiro', icon: Wallet, financeiro: true },
  { href: '/users', label: 'Usuários', icon: Users },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, adminOnly: true },
  // Ponte com o Claude Code do WebAge Hub — só faz sentido para quem administra.
  { href: '/ia', label: 'IA', icon: Bot, adminOnly: true },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState<{ id?: number; name?: string; email: string; role?: string } | null>(null)
  // No celular o menu é uma gaveta: fica fora da tela até o usuário abrir.
  const [menu, setMenu] = useState(false)
  const [busca, setBusca] = useState(false)

  // Navegou? A gaveta fecha sozinha — senão ela tampa a página que acabou de abrir.
  useEffect(() => {
    setMenu(false)
  }, [pathname])

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/painel')}`)
      return
    }
    api
      .get<{ user: { id?: number; name?: string; email: string; role?: string } }>('/me')
      .then((r) => {
        setMe(r.user)
        setReady(true)
      })
      .catch(async () => {
        await sair()
        router.replace('/login')
      })
  }, [router, pathname])

  // Ctrl+K (ou Cmd+K) abre a busca de qualquer tela.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBusca((b) => !b)
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>
    )
  }

  const logout = async () => {
    await sair()
    router.replace('/login')
  }

  const visivel = (item: (typeof NAV)[number]) => {
    if (item.adminOnly && !ehAdmin(me?.role)) return false
    if (item.financeiro && !mexeDinheiro(me?.role)) return false
    return true
  }

  return (
    <div className="flex min-h-screen">
      <RegistrarSW />
      <BuscaGlobal aberta={busca} onFechar={() => setBusca(false)} />
      {/* Fundo escuro por trás da gaveta: tocar fora fecha o menu. */}
      {menu && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden print:hidden"
          onClick={() => setMenu(false)}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-sidebar text-sidebar-foreground transition-transform',
          // No desktop volta a ser coluna do layout, sempre visível.
          'lg:static lg:z-auto lg:translate-x-0 lg:transition-none print:hidden',
          menu ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <span className="font-semibold text-white">Sistema Julia</span>
          <button
            onClick={() => setMenu(false)}
            className="-mr-2 ml-auto rounded-md p-2 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Ação principal do sistema: é para isso que o app existe. */}
        <div className="space-y-2 p-3 pb-0">
          <Link
            href="/iniciar"
            className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Camera className="h-5 w-5" /> Iniciar vistoria
          </Link>
          <button
            onClick={() => setBusca(true)}
            className="flex w-full items-center gap-2 rounded-md border border-sidebar-border px-3 py-2 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <Search className="h-4 w-4" /> Buscar…
            <kbd className="ml-auto rounded border border-sidebar-border px-1 text-[10px]">Ctrl K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-auto p-3">
          {NAV.filter(visivel).map((item) => {
            // /viagens (Cronograma) vive dentro de Vistorias — mantém o item aceso.
            const active =
              pathname.startsWith(item.href) ||
              (item.href === '/vistorias' && pathname.startsWith('/viagens')) ||
              (item.href === '/configuracoes' && (pathname.startsWith('/auditoria') || pathname.startsWith('/lixeira')))
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                // Item aceso: fundo claro + barra vermelha na borda. O vermelho
                // fica no ícone e na barra; o botão cheio é só da ação principal.
                className={cn(
                  'flex items-center gap-3 rounded-md border-l-[3px] py-2.5 pl-3 pr-3 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary bg-white/10 text-white'
                    : 'border-transparent hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-primary' : 'text-zinc-500')} />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <Sino />
          {/* Atalho para a agenda só do usuário logado (a geral fica no menu). */}
          {me?.id && (
            <Link
              href={`/agenda?responsavel=${me.id}`}
              className="mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5 hover:text-white"
            >
              <CalendarDays className="h-4 w-4 text-zinc-500" /> Minha agenda
            </Link>
          )}
          <div className="mb-1 truncate px-3 text-xs text-zinc-500" title={me?.email}>
            {me?.name || me?.email}
            {me?.role && <span className="ml-1 text-zinc-600">· {PAPEL_LABEL[me.role] || me.role}</span>}
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4 text-zinc-500" /> Sair
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra do celular: é daqui que o menu sai e volta. */}
        <div className="sticky top-0 z-30 flex items-center gap-2 bg-sidebar px-2 py-2 text-white lg:hidden print:hidden">
          <button onClick={() => setMenu(true)} className="rounded-md p-2 hover:bg-white/10" aria-label="Abrir menu">
            <Menu className="h-6 w-6" />
          </button>
          <span className="font-semibold">Sistema Julia</span>
          <button onClick={() => setBusca(true)} className="ml-auto rounded-md p-2 hover:bg-white/10" aria-label="Buscar">
            <Search className="h-5 w-5" />
          </button>
          <Link
            href="/iniciar"
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            <Camera className="h-4 w-4" /> Vistoria
          </Link>
        </div>
        <main className="flex-1 overflow-auto p-4 lg:p-8 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  )
}
