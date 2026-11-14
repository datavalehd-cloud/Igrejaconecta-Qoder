import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, CheckCircle2 } from 'lucide-react'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button, Field, Input } from '@/components/common/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function ResetPasswordPage() {
  useDocumentMeta({ title: 'Redefinir senha', path: '/redefinir-senha', noindex: true })
  const { updatePassword, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.')
    if (password !== confirm) return setError('As senhas não conferem.')
    const res = await updatePassword(password)
    if (!res.ok) return setError(res.error ?? 'Não foi possível redefinir a senha. Solicite um novo link.')
    setDone(true)
  }

  return (
    <AuthLayout title="Redefinir senha" subtitle="Defina uma nova senha para a sua conta.">
      {done ? (
        <div className="rounded-xl border border-green-600/20 bg-green-50 p-5 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <p className="mt-3 font-semibold text-green-700">Senha redefinida!</p>
          <p className="mt-1 text-sm text-green-700/80">
            Sua conta já está protegida com a nova senha.
          </p>
          <Button className="mt-4 w-full" onClick={() => navigate('/app', { replace: true })}>Ir para o painel</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          <Field label="Confirmar nova senha">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" icon={<KeyRound className="h-4 w-4" />} disabled={loading}>Salvar nova senha</Button>
        </form>
      )}
    </AuthLayout>
  )
}