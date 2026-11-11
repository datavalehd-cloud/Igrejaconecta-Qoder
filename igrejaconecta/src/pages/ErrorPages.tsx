import { Link } from 'react-router-dom'
import { Home, ShieldX } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/common/primitives'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function NotFoundPage() {
  useDocumentMeta({ title: 'Página não encontrada', noindex: true })
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <Logo className="mb-8" />
      <p className="text-7xl font-extrabold text-brand-600">404</p>
      <h1 className="mt-4 text-2xl font-bold text-navy">Página não encontrada</h1>
      <p className="mt-2 max-w-md text-slate-500">
        O endereço que você tentou acessar não existe ou foi movido.
      </p>
      <Link to="/" className="mt-8">
        <Button icon={<Home className="h-4 w-4" />}>Voltar ao início</Button>
      </Link>
    </div>
  )
}

export function AccessDeniedPage() {
  useDocumentMeta({ title: 'Acesso negado', noindex: true })
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500">
        <ShieldX className="h-8 w-8" />
      </span>
      <p className="text-5xl font-extrabold text-navy">403</p>
      <h1 className="mt-4 text-2xl font-bold text-navy">Acesso negado</h1>
      <p className="mt-2 max-w-md text-slate-500">
        Você não tem permissão para visualizar esta página. Verifique seu papel e as permissões
        da igreja, ou fale com um administrador.
      </p>
      <div className="mt-8 flex gap-3">
        <Link to="/"><Button variant="outline" icon={<Home className="h-4 w-4" />}>Início</Button></Link>
        <Link to="/app"><Button>Ir para meu painel</Button></Link>
      </div>
    </div>
  )
}
