import { useState, type ChangeEvent, type FormEvent } from 'react'
import { ShieldCheck, KeyRound, LogOut, Building2, Save } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Badge } from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { useAuth } from '@/contexts/AuthContext'
import { roleLabels, MFA_REQUIRED_ROLES } from '@/utils/rbac'
import { useMyChurches } from '@/hooks/useChurches'
import { initials } from '@/utils/format'
import { updateMyProfile, type MyProfileDraft } from '@/services/data/myProfileService'
import type { MfaEnrollment } from '@/services/auth/authTypes'
import type { Profile } from '@/types'

export function UserProfilePage() {
  const { session, logout, enrollMfa, verifyEnrollment } = useAuth()
  const { rows: myChurches, loading: churchesLoading, error: churchesError } = useMyChurches()
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PersonalDataCard profile={session.profile} roleLabel={roleLabels[session.role]} />

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

              {!session.mfaEnrolled && !enrollment && (
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

              {enrollment && (
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

              <PasswordForm />

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled
                title="Ver e revogar sessões ativas exige API de sessões, que este aplicativo ainda não usa"
              >
                Gerenciar sessões ativas
              </Button>
              <Button variant="ghost" size="sm" className="w-full text-red-600" icon={<LogOut className="h-4 w-4" />} onClick={logout}>Sair</Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Privacidade (LGPD)" />
            <CardBody className="space-y-2 text-sm text-slate-600">
              <Button variant="outline" size="sm" className="w-full" disabled title="Nenhum exportador foi construído: não há o que entregar">
                Exportar meus dados
              </Button>
              <Button variant="ghost" size="sm" className="w-full text-red-600" disabled title="Excluir conta não existe no aplicativo: é pedido a quem opera a plataforma">
                Solicitar exclusão
              </Button>
              <p className="text-xs text-slate-400">
                Os dois botões estão desativados porque a função não existe ainda. Um pedido de exclusão se faz
                por contato com quem opera a plataforma — apagar conta e dados não tem volta, então não se oferece
                um botão que só abriria um formulário sem efeito.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * Dados pessoais (M3c). Nome e telefone gravam em `profiles` pela própria conta
 * (`profiles_self_update`, 0002). O e-mail fica fora do formulário de propósito:
 * ele é o login, e a fonte da verdade é `auth.users` — escrever na cópia de
 * `profiles` deixaria a tela mostrando um e-mail com o qual ninguém entra.
 */
function PersonalDataCard({ profile, roleLabel }: { profile: Profile; roleLabel: string }) {
  const { refresh } = useAuth()
  const [seed, setSeed] = useState<MyProfileDraft>(() => draftFrom(profile))
  const [form, setForm] = useState<MyProfileDraft>(seed)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const dirty = form.full_name !== seed.full_name || form.phone !== seed.phone

  const update =
    (field: keyof MyProfileDraft) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setNotice(null)
    const result = await updateMyProfile(form, { userId: profile.id })
    if (!result.ok) {
      setSaving(false)
      setNotice({ tone: 'error', text: result.error })
      return
    }
    const next = draftFrom(result.profile)
    setSeed(next)
    setForm(next)
    setSaving(false)
    setNotice({ tone: 'ok', text: 'Perfil atualizado no banco.' })
    // Um update em `profiles` não dispara evento de auth: a sessão é relida à mão
    // para o cabeçalho e as demais telas acompanharem o nome novo.
    await refresh()
  }

  return (
    <Card>
      <CardHeader
        title="Dados pessoais"
        subtitle="Nome e telefone são os dados da sua conta no banco. O e-mail é o seu login."
        action={<Badge tone="green">Salva no banco</Badge>}
      />
      <CardBody className="flex flex-col gap-4 sm:flex-row">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-navy text-2xl font-bold text-white">
          {initials(form.full_name)}
        </span>
        <form onSubmit={onSubmit} className="flex-1 space-y-4">
          {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo">
              <Input value={form.full_name} onChange={update('full_name')} />
            </Field>
            <Field label="Telefone">
              <Input value={form.phone} onChange={update('phone')} placeholder="(00) 00000-0000" />
            </Field>
            <Field label="E-mail" hint="Trocar o login exige confirmar a posse do novo endereço — não é um campo deste formulário.">
              <Input readOnly value={profile.email} />
            </Field>
            <Field label="Papel atual"><Input readOnly value={roleLabel} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" icon={<Save className="h-4 w-4" />} disabled={saving || !dirty}>
              {saving ? 'Salvando...' : 'Salvar perfil'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(seed)} disabled={saving || !dirty}>
              Descartar
            </Button>
            {!dirty && <span className="text-xs text-slate-500">Nada para salvar.</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

/** Senha nova no Supabase Auth (`auth.updateUser`). Não tem nada a ver com `profiles`. */
function PasswordForm() {
  const { updatePassword } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const mismatch = confirm.length > 0 && password !== confirm

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy || password.length < 8 || password !== confirm) return
    setBusy(true)
    setError(null)
    const res = await updatePassword(password)
    setBusy(false)
    if (!res.ok) return setError(res.error ?? 'Não foi possível alterar a senha.')
    setPassword('')
    setConfirm('')
    setDone(true)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" className="w-full" icon={<KeyRound className="h-4 w-4" />} onClick={() => { setOpen((v) => !v); setDone(false) }}>
        {open ? 'Cancelar' : 'Alterar senha'}
      </Button>
      {done && <p className="text-xs font-medium text-green-700">Senha alterada nesta sessão.</p>}
      {open && (
        <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-line bg-surface p-3">
          <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          <Field label="Confirmar nova senha">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          {mismatch && <p className="text-xs text-red-600">As duas senhas precisam ser iguais.</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button type="submit" size="sm" className="w-full" disabled={busy || mismatch || password.length < 8}>
            {busy ? 'Gravando...' : 'Gravar nova senha'}
          </Button>
        </form>
      )}
    </div>
  )
}

function draftFrom(profile: Profile): MyProfileDraft {
  return { full_name: profile.full_name ?? '', phone: profile.phone ?? '' }
}
