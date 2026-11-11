import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Menu, X, Search } from 'lucide-react'
import { Logo } from './Logo'
import { Button } from '@/components/common/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/utils/cn'

const links = [
  { to: '/', label: 'Início' },
  { to: '/eventos', label: 'Eventos' },
  { to: '/igrejas', label: 'Igrejas' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/categorias', label: 'Categorias' },
]

export function PublicLayout() {
  const { isAuthenticated, session } = useAuth()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const panelPath = session?.role === 'superadmin' ? '/admin' : '/app'

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="shrink-0">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'text-brand-700 bg-brand-50' : 'text-slate-600 hover:text-navy hover:bg-surface',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Link to="/buscar" className="text-slate-500 hover:text-navy" aria-label="Buscar">
              <Search className="h-5 w-5" />
            </Link>
            {isAuthenticated ? (
              <Button variant="secondary" size="sm" onClick={() => navigate(panelPath)}>
                Meu painel
              </Button>
            ) : (
              <>
                <Link to="/login"><Button variant="outline" size="sm">Entrar</Button></Link>
                <Link to="/cadastro"><Button size="sm">Cadastrar igreja</Button></Link>
              </>
            )}
          </div>

          <button className="md:hidden text-slate-600" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {open && (
          <div className="border-t border-line bg-white md:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col px-4 py-2">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/'}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface"
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="my-2 border-t border-line" />
              {isAuthenticated ? (
                <Link to={panelPath} onClick={() => setOpen(false)}>
                  <Button variant="secondary" className="w-full">Meu painel</Button>
                </Link>
              ) : (
                <div className="flex gap-2 pb-2">
                  <Link to="/login" className="flex-1" onClick={() => setOpen(false)}>
                    <Button variant="outline" className="w-full">Entrar</Button>
                  </Link>
                  <Link to="/cadastro" className="flex-1" onClick={() => setOpen(false)}>
                    <Button className="w-full">Cadastrar</Button>
                  </Link>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-navy text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo variant="light" />
            <p className="mt-3 max-w-sm text-sm text-slate-400">
              Plataforma que conecta igrejas e visitantes: gestão de eventos, localização,
              divulgação digital e inteligência artificial.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-white">Navegar</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/eventos" className="hover:text-white">Eventos</Link></li>
              <li><Link to="/igrejas" className="hover:text-white">Igrejas</Link></li>
              <li><Link to="/mapa" className="hover:text-white">Mapa</Link></li>
              <li><Link to="/categorias" className="hover:text-white">Categorias</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-white">Para igrejas</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/cadastro" className="hover:text-white">Cadastrar igreja</Link></li>
              <li><Link to="/login" className="hover:text-white">Entrar no painel</Link></li>
              <li><Link to="/recuperar-senha" className="hover:text-white">Recuperar senha</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-400 sm:flex-row sm:px-6">
            <p>© {new Date().getFullYear()} IgrejaConecta. Todos os direitos reservados.</p>
            <p>
              Desenvolvido por{' '}
              <a
                href="https://datavalehd.online"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:text-white"
              >
                <span className="text-[#2563A6]">Data</span><span className="text-[#16A36A]">Vale</span>
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
