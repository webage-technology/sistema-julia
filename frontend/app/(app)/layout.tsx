'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Users, Briefcase, LogOut, Building2 } from 'lucide-react'
import { api, getToken, clearToken } from '@/lib/api'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/users', label: 'Usuários', icon: Users },
  { href: '/clients', label: 'Clientes', icon: Briefcase },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState<{ email: string } | null>(null)

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    api
      .get<{ user: { email: string } }>('/me')
      .then((r) => {
        setMe(r.user)
        setReady(true)
      })
      .catch(() => {
        clearToken()
        router.replace('/login')
      })
  }, [router])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>
    )
  }

  const logout = () => {
    clearToken()
    router.replace('/login')
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <span className="font-semibold">Sistema Julia</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4" /> {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 truncate px-2 text-xs text-muted-foreground">{me?.email}</div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
