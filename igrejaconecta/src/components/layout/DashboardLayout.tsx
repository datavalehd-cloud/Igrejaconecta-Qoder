import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Menu, X, LogOut, ChevronDown, ShieldCheck } from 'lucide-react'
import { Logo } from './Logo'
import type { NavGroup } from '@/components/navigation/navConfig'
import { useAuth } from '@/contexts/AuthContext'
import { roleLabels } from '@/utils/rbac'
import { initials } from '@/utils/format'
import { cn } from '@/utils/cn'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

interface DashboardLayoutProps {
  groups: NavGroup[]
  /** Rótulo do painel exibido no topo da sidebar. */
  panelLabel: string
  accent?: 'brand' | 'navy'
}

export function DashboardLayout({ groups, panelLabel, accent = 'brand' }: DashboardLayoutProps) {
  // Painéis são privados: nunca indexar. O título da aba reflete o painel ativo.
  useDocumentMeta({ title: panelLabel, noindex: true })
  const { session, logout, demoAccounts, switchDemoRole, mode } = useAuth()
  const [open, setOpen] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const navigate = useNavigate()

  const accentBar = accent === 'navy' ? 'bg-navy' : 'bg-brand-600'

  function handleLogout() {
    logout()
    navigate('/')
  }

  const sidebar = (
    <aside className="flex h-full w-72 flex-col border-r border-line bg-white">
      <div className="flex items-center justify-between px-5 py-4">
        <Logo />
        <button className="lg:hidden text-slate-500" onClick={() => setOpen(false)} aria-label="Fechar menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className={cn('mx-5 mb-3 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white', accentBar)}>
        {panelLabel}
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-6">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/app' || item.to === '/admin'}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-slate-600 hover:bg-surface hover:text-navy',
                      )
                    }
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )

  return (
    <div className="min-h-screen bg-surface">
      {/* Sidebar desktop */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30">{sidebar}</div>

      {/* Sidebar mobile */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button className="lg:hidden text-slate-600" onClick={() => setOpen(true)} aria-label="Abrir menu">
              <Menu className="h-6 w-6" />
            </button>
            <span className="hidden sm:flex items-center gap-1.5 text-sm text-slate-500">
              <ShieldCheck className="h-4 w-4 text-green" />
              Isolamento multi-igreja ativo
            </span>
          </div>

          <div className="relative">
            <button
              onClick={() => setUserMenu((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
                {initials(session?.profile.full_name ?? '?')}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-semibold text-navy">{session?.profile.full_name}</span>
                <span className="block text-xs text-slate-500">{roleLabels[session?.role ?? 'visitor']}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>

            {userMenu && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-white p-2 shadow-lg">
                {mode === 'demo' && (
                  <>
                    <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Trocar papel (demo)
                    </p>
                    {demoAccounts.map((acc) => (
                      <button
                        key={acc.email}
                        onClick={() => { switchDemoRole(acc.email); setUserMenu(false) }}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface',
                          acc.email === session?.profile.email && 'bg-brand-50 text-brand-700',
                        )}
                      >
                        <span className="truncate">{acc.email}</span>
                        <span className="ml-2 shrink-0 text-xs text-slate-400">{roleLabels[acc.role]}</span>
                      </button>
                    ))}
                    <div className="my-1 border-t border-line" />
                  </>
                )}
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" /> Sair
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
