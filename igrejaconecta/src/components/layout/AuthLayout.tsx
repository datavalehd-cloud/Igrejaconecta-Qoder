import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Logo } from './Logo'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      {/* Painel de marca */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-navy p-10 text-white lg:flex">
        <Link to="/" className="w-fit">
          <Logo variant="light" />
        </Link>
        <div>
          <h2 className="text-3xl font-bold leading-tight">
            Conectando igrejas e pessoas através de eventos.
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            Gestão completa de eventos, localização, divulgação digital e inteligência
            artificial — tudo em um só lugar, com segurança multi-igreja.
          </p>
        </div>
        <p className="text-sm text-slate-400">© {new Date().getFullYear()} IgrejaConecta</p>
        <div className="pointer-events-none absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-brand/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-10 h-56 w-56 rounded-full bg-green/20 blur-3xl" />
      </div>

      {/* Formulário */}
      <div className="flex w-full items-center justify-center px-4 py-10 lg:w-1/2">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy">
            <ArrowLeft className="h-4 w-4" /> Voltar ao site
          </Link>
          <div className="mb-6 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold text-navy">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}

          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
