import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button, Field, Input } from '@/components/common/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function RegisterPage() {
  useDocumentMeta({ title: 'Criar conta', path: '/cadastro', noindex: true })
  const { register, loading } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (form.password !== form.confirm) return setError('As senhas não conferem.')
    if (form.password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.')
    const res = await register(form.fullName, form.email, form.password)
    if (!res.ok) return setError(res.error ?? 'Falha no cadastro.')
    // Com confirmação de e-mail desativada no Supabase, a sessão já é criada.
    if (res.needsConfirmation === false) return navigate('/app', { replace: true })
    navigate('/confirmar-email', { state: { email: form.email } })
  }

  return (
    <AuthLayout title="Criar conta" subtitle="Cadastre-se para gerenciar sua igreja e eventos.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nome completo"><Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Seu nome" required /></Field>
        <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="voce@igreja.com" required /></Field>
        <Field label="Senha" hint="Mínimo de 8 caracteres."><Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required /></Field>
        <Field label="Confirmar senha"><Input type="password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} required /></Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" icon={<UserPlus className="h-4 w-4" />} disabled={loading}>Criar conta</Button>
        <p className="text-center text-sm text-slate-500">
          Já tem conta? <Link to="/login" className="font-semibold text-brand-600 hover:underline">Entrar</Link>
        </p>
      </form>
    </AuthLayout>
  )
}
