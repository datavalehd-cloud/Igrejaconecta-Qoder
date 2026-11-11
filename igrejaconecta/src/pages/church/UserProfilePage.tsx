import { useState } from 'react'
import { Save, ShieldCheck, KeyRound, LogOut, Building2 } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Badge } from '@/components/common/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { roleLabels, MFA_REQUIRED_ROLES } from '@/utils/rbac'
import { useMyChurches } from '@/hooks/useChurches'
import { initials } from '@/utils/format'
import type { MfaEnrollment } from '@/services/auth/authTypes'

export function UserProfilePage() {
  const { session, logout, mode, enrollMfa, verifyEnrollment } = useAuth()
  const { rows: myChurches, loading: churchesLoading, error: churchesError } = useMyChurches()
  const [saved, setSaved] = useState(false)
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaError, setMfaError] = useState<string | null>(null)
  const [mfaBusy, setMfaBusy] = useState(false)
  const [mfaDone, setMfaDone] = useState(false)
  if (!session) return null

  const mfaRequired = MFA_REQUIRED_ROLES.includes(session.role)

  async function startEnrollment() {
    setMfaBusy(true)
    setMfaError(null)
    const res = await enrollMfa()
    setMfaBusy(false)
    if (!res.ok || !res.enrollment) return setMfaError(res.error ?? 'Falha ao iniciar a ativação do MFA.')
    setEnrollment(res.enrollment)
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault()
    if (!enrollment) return
    setMfaBusy(true)
    setMfaError(null)
    const res = await verifyEnrollment(enrollment.factorId, mfaCode)
    setMfaBusy(false)
    if (!res.ok) return setMfaError(res.error ?? 'Código inválido.')
    setEnrollment(null)
    setMfaCode('')
    setMfaDone(true)
  }

  return (
    <div>
      <PageHeader title="Meu perfil" subtitle="Dados da conta, segurança e igrejas associadas." />

      {saved && <div className="mb-6 rounded-xl border border-green-600/20 bg-green-50 px-4 py-3 text-sm text-green-700">Perfil atualizado (demo).</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Dados pessoais" />
            <CardBody className="flex flex-col gap-4 sm:flex-row">
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-navy text-2xl font-bold text-white">{initials(session.profile.full_name)}</span>
              <div className="grid flex-1 gap-4 sm:grid-cols-2">
                <Field label="Nome completo"><Input defaultValue={session.profile.full_name} /></Field>
                <Field label="E-mail"><Input defaultValue={session.profile.email} /></Field>
                <Field label="Telefone"><Input defaultValue={session.profile.phone ?? ''} placeholder="(00) 00000-0000" /></Field>
                <Field label="Papel atual"><Input readOnly value={roleLabels[session.role]} /></Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Minhas igrejas" subtitle="Um usuário pode pertencer a várias igrejas com papéis distintos." />
            <CardBody className="space-y-2">
              {churchesError && <p className="text-sm text-red-700">{churchesError}</p>}
              {churchesLoading && <p className="text-sm text-slate-500">Consultando suas igrejas...</p>}
              {!churchesLoading && !churchesError && myChurches.length === 0 && (
                <p className="text-sm text-slate-500">
                  Nenhuma igreja ativa associada a esta conta. Quem te convidou ainda sem conta criada
                  aparece na tela Usuários, em "Convites para você".
                </p>
              )}
              {myChurches.map((c) => (
                <div key={c.church_id} className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-sm text-navy">
                    <Building2 className="h-4 w-4 text-brand-600" />{c.name}
                    {c.approval_status !== 'approved' && <Badge tone="amber">{c.approval_status}</Badge>}
                  </span>
                  <Badge tone="brand">{roleLabels[c.role_key]}</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Segurança" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-slate-600"><ShieldCheck className="h-4 w-4 text-brand-600" />MFA</span>
                <Badge tone={session.mfaEnrolled ? 'green' : mfaRequired ? 'amber' : 'neutral'}>
                  {session.mfaEnrolled ? 'Ativo' : mfaRequired ? 'Pendente' : 'Opcional'}
                </Badge>
              </div>

              {mode === 'supabase' && !session.mfaEnrolled && !enrollment && (
                <>
                  <p className="text-xs text-slate-500">
                    {mfaRequired
                      ? 'Seu papel exige verificação em duas etapas. Ative o MFA para acessar os painéis.'
                      : 'Proteja sua conta com um código gerado pelo app autenticador.'}
                  </p>
                  <Button variant="outline" size="sm" className="w-full" disabled={mfaBusy} onClick={startEnrollment} icon={<KeyRound className="h-4 w-4" />}>
                    {mfaBusy ? 'Preparando…' : 'Ativar MFA'}
                  </Button>
                </>
              )}

              {mode === 'supabase' && enrollment && (
                <form onSubmit={confirmEnrollment} className="space-y-3 rounded-lg border border-line bg-surface p-3">
                  <p className="text-xs text-slate-600">Escaneie o QR Code no Google Authenticator (ou similar) e digite o código gerado.</p>
                  <img src={enrollment.qrCode} alt="QR Code para configurar o MFA" className="mx-auto h-40 w-40" />
                  <p className="break-all text-center text-[11px] text-slate-400">Chave manual: {enrollment.secret}</p>
                  <Field label="Código de 6 dígitos">
                    <Input inputMode="numeric" maxLength={6} placeholder="000000" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required />
                  </Field>
                  <Button type="submit" size="sm" className="w-full" disabled={mfaBusy}>Confirmar ativação</Button>
                </form>
              )}

              {mfaDone && <p className="text-xs font-medium text-green-700">MFA ativado com sucesso.</p>}
              {mfaError && <p className="text-xs text-red-600">{mfaError}</p>}

              <Button variant="outline" size="sm" className="w-full" icon={<KeyRound className="h-4 w-4" />}>Alterar senha</Button>
              <Button variant="outline" size="sm" className="w-full">Gerenciar sessões ativas</Button>
              <Button variant="ghost" size="sm" className="w-full text-red-600" icon={<LogOut className="h-4 w-4" />} onClick={logout}>Sair</Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Privacidade (LGPD)" />
            <CardBody className="space-y-2 text-sm text-slate-600">
              <Button variant="outline" size="sm" className="w-full">Exportar meus dados</Button>
              <Button variant="ghost" size="sm" className="w-full text-red-600">Solicitar exclusão</Button>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button icon={<Save className="h-4 w-4" />} onClick={() => setSaved(true)}>Salvar alterações</Button>
      </div>
    </div>
  )
}
