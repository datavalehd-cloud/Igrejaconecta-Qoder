import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button, Field, Input } from '@/components/common/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import type { RoleKey } from '@/types'

export function LoginPage() {
  useDocumentMeta({ title: 'Entrar', path: '/login', noindex: true })
  const { login, confirmMfa, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string })?.from

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [needsMfa, setNeedsMfa] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function destination(role?: RoleKey) {
    const fallback = role === 'superadmin' ? '/admin' : '/app'
    navigate(from ?? fallback, { replace: true })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await login(email, password)
    if (!res.ok) return setError(res.error ?? 'Falha no login.')
    if (res.requiresMfa) return setNeedsMfa(true)
    destination(res.role)
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await confirmMfa(mfaCode)
    if (!res.ok) return setError(res.error ?? 'Código inválido.')
    destination(res.role)
  }

  return (
    <AuthLayout
      title={needsMfa ? 'Verificação em duas etapas' : 'Entrar'}
      subtitle={needsMfa ? 'Administradores precisam confirmar o código MFA.' : 'Acesse o painel da sua igreja.'}
    >
      {needsMfa ? (
        <form onSubmit={handleMfa} className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
            <ShieldCheck className="h-4 w-4" /> MFA exigido para este papel.
          </div>
          <Field label="Código de 6 dígitos" hint="Informe o código gerado pelo seu app autenticador.">
            <Input inputMode="numeric" maxLength={6} placeholder="000000" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoFocus />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>Confirmar e entrar</Button>
          <button type="button" className="w-full text-sm text-slate-500 hover:text-navy" onClick={() => setNeedsMfa(false)}>
            Voltar
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="E-mail"><Input type="email" placeholder="voce@igreja.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Senha"><Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <div className="flex justify-end">
            <Link to="/recuperar-senha" className="text-sm text-brand-600 hover:underline">Esqueci minha senha</Link>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" icon={<LogIn className="h-4 w-4" />} disabled={loading}>Entrar</Button>

          <p className="text-center text-sm text-slate-500">
            Não tem conta? <Link to="/cadastro" className="font-semibold text-brand-600 hover:underline">Cadastre sua igreja</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
