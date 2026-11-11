import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button, Field, Input } from '@/components/common/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function RecoverPasswordPage() {
  useDocumentMeta({ title: 'Recuperar senha', path: '/recuperar-senha', noindex: true })
  const { recover, loading, mode } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await recover(email)
    setSent(true)
  }

  return (
    <AuthLayout title="Recuperar senha" subtitle="Informe seu e-mail e enviaremos um link de redefinição.">
      {sent ? (
        <div className="rounded-xl border border-green-600/20 bg-green-50 p-5 text-center">
          <MailCheck className="mx-auto h-10 w-10 text-green-600" />
          <p className="mt-3 font-semibold text-green-700">Link enviado!</p>
          <p className="mt-1 text-sm text-green-700/80">
            Verifique sua caixa de entrada em <strong>{email}</strong>.{' '}
            {mode === 'demo' ? '(No modo demo o e-mail não é realmente enviado.)' : 'Confira também a caixa de spam.'}
          </p>
          <Link to="/login" className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline">Voltar ao login</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@igreja.com" required /></Field>
          <Button type="submit" className="w-full" disabled={loading}>Enviar link de recuperação</Button>
          <p className="text-center text-sm text-slate-500">
            Lembrou a senha? <Link to="/login" className="font-semibold text-brand-600 hover:underline">Entrar</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
