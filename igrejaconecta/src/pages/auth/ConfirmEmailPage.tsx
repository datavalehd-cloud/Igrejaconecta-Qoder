import { Link, useLocation } from 'react-router-dom'
import { MailCheck, RefreshCw } from 'lucide-react'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/common/primitives'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function ConfirmEmailPage() {
  useDocumentMeta({ title: 'Confirmar e-mail', path: '/confirmar-email', noindex: true })
  const location = useLocation()
  const email = (location.state as { email?: string })?.email ?? 'seu e-mail'

  return (
    <AuthLayout title="Confirme seu e-mail" subtitle="Enviamos um link de confirmação para ativar sua conta.">
      <div className="rounded-xl border border-line bg-white p-6 text-center">
        <MailCheck className="mx-auto h-12 w-12 text-brand-600" />
        <p className="mt-4 text-sm text-slate-600">
          Enviamos um e-mail para <strong className="text-navy">{email}</strong>. Clique no link para
          confirmar seu cadastro e acessar o painel.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          No modo demo a confirmação é simulada. Com o Supabase conectado, o link real valida a conta.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link to="/login"><Button className="w-full">Já confirmei, ir para o login</Button></Link>
          <button className="inline-flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-navy">
            <RefreshCw className="h-4 w-4" /> Reenviar e-mail
          </button>
        </div>
      </div>
    </AuthLayout>
  )
}
