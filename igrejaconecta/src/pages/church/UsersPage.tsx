import { useState, type FormEvent } from 'react'
import { Mail, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { PageHeader, Button, Badge, Card, CardHeader, CardBody, EmptyState, Field, Input, Select } from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { DataTable, type Column } from '@/components/common/DataTable'
import { useAuth } from '@/contexts/AuthContext'
import { useRoster } from '@/hooks/useRoster'
import { useInvitations, useMyInvitations } from '@/hooks/useInvitations'
import { usePermissions } from '@/hooks/usePermissions'
import { CHURCH_ROLE_KEYS, acceptInvitation, changeMemberRole, inviteMember, revokeInvitation } from '@/services/data/memberService'
import { roleLabels } from '@/utils/rbac'
import { formatDate, initials } from '@/utils/format'
import type { InvitationForMe, RosterEntry, RoleKey } from '@/types'

const statusTone = { active: 'green', invited: 'amber', blocked: 'red' } as const
const statusLabel = { active: 'Ativo', invited: 'Convidado', blocked: 'Bloqueado' } as const

function InviteForm({
  churchId,
  role,
  onDone,
}: {
  churchId: string
  role?: RoleKey
  onDone: (result: { ok: boolean; text: string }) => void
}) {
  const [email, setEmail] = useState('')
  const [roleKey, setRoleKey] = useState<RoleKey>('communicator')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await inviteMember({ churchId, email, roleKey, actorRole: role })
    setSaving(false)
    onDone(
      result.ok
        ? { ok: true, text: `Convite enviado para ${email.trim().toLowerCase()}.` }
        : { ok: false, text: result.error ?? 'Não foi possível enviar o convite.' },
    )
    if (result.ok) setEmail('')
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[240px] flex-1">
        <Field label="E-mail">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" />
        </Field>
      </div>
      <div className="min-w-[200px]">
        <Field label="Papel">
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value as RoleKey)}>
            {CHURCH_ROLE_KEYS.map((key) => (
              <option key={key} value={key}>{roleLabels[key]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={saving}>{saving ? 'Enviando…' : 'Enviar convite'}</Button>
    </form>
  )
}

export function UsersPage() {
  const { rows, loading, error, reload } = useRoster()
  const invitations = useInvitations()
  const mine = useMyInvitations()
  const { can, role, churchId } = usePermissions()
  const { session } = useAuth()
  const canManage = can('members.manage')

  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busyMember, setBusyMember] = useState<string | null>(null)

  const contactsMasked = rows.length > 0 && rows.every((r) => r.email === null)

  function onInviteDone(result: { ok: boolean; text: string }) {
    setNotice({ tone: result.ok ? 'ok' : 'error', text: result.text })
    if (result.ok) {
      setFormOpen(false)
      invitations.reload()
      mine.reload()
    }
  }

  async function cancelInvitation(id: string) {
    const result = await revokeInvitation(id, role)
    setNotice(result.ok ? { tone: 'ok', text: 'Convite cancelado.' } : { tone: 'error', text: result.error ?? 'Não foi possível cancelar o convite.' })
    invitations.reload()
    mine.reload()
  }

  async function onRoleChange(memberId: string, next: RoleKey) {
    setBusyMember(memberId)
    const result = await changeMemberRole({ memberId, roleKey: next, actorRole: role })
    setBusyMember(null)
    if (!result.ok) setNotice({ tone: 'error', text: result.error ?? 'Não foi possível mudar o papel.' })
    reload()
  }

  async function onAccept(invitation: InvitationForMe) {
    const result = await acceptInvitation(invitation.id)
    setNotice(result.ok ? { tone: 'ok', text: `Você entrou na ${invitation.church_name}.` } : { tone: 'error', text: result.error ?? 'Não foi possível aceitar o convite.' })
    mine.reload()
    reload()
  }

  const columns: Column<RosterEntry>[] = [
    {
      header: 'Usuário',
      cell: (m) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{initials(m.full_name)}</span>
          <div>
            <p className="font-medium text-navy">{m.full_name}</p>
            <p className="text-xs text-slate-500">{m.email ?? 'contato reservado'}</p>
          </div>
        </div>
      ),
    },
    {
      header: 'Papel',
      cell: (m) =>
        canManage ? (
          <Select
            aria-label={`Papel de ${m.full_name}`}
            value={m.role_key}
            disabled={busyMember === m.member_id}
            onChange={(event) => onRoleChange(m.member_id, event.target.value as RoleKey)}
            className="max-w-[220px] py-1.5 text-sm"
          >
            {CHURCH_ROLE_KEYS.map((key) => (
              <option key={key} value={key}>{roleLabels[key]}</option>
            ))}
          </Select>
        ) : (
          <span>{roleLabels[m.role_key]}</span>
        ),
    },
    { header: 'Status', cell: (m) => <Badge tone={statusTone[m.membership_status]}>{statusLabel[m.membership_status]}</Badge> },
  ]

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle={canManage ? 'Convide pessoas, defina papéis e controle o acesso à sua igreja.' : 'Quem faz parte da sua igreja, com o papel de cada pessoa.'}
        actions={canManage ? <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setFormOpen((v) => !v)}>Convidar usuário</Button> : undefined}
      />

      {mine.rows.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Convites para você" subtitle="Aceite para entrar na igreja com o papel convidado." />
          <CardBody className="space-y-3">
            {mine.rows.map((invitation) => (
              <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <div className="text-sm">
                  <p className="font-medium text-navy">{invitation.church_name}</p>
                  <p className="text-xs text-slate-500">{invitation.role_name} · {invitation.email}</p>
                </div>
                <Button size="sm" onClick={() => onAccept(invitation)}>Aceitar convite</Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {formOpen && canManage && churchId && (
        <Card className="mb-6">
          <CardHeader title="Convidar por e-mail" subtitle="O convite vale até a pessoa aceitar ou até expirar — 30 dias." />
          <CardBody>
            {/* key por conta: o rascunho de quem convidava não pode reaparecer para outra pessoa. */}
            <InviteForm key={session?.profile.id ?? 'sessao'} churchId={churchId} role={role} onDone={onInviteDone} />
          </CardBody>
        </Card>
      )}

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>
            Tentar de novo
          </Button>
        </div>
      )}

      {loading ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="Carregando membros..." description="Consultando a sua igreja." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(m) => m.member_id}
          empty={<EmptyState icon={<Users className="h-6 w-6" />} title="Nenhum membro visível" description="Aparecem aqui as pessoas ativas da sua igreja." />}
        />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {canManage && (
        <Card>
          <CardHeader title="Convites pendentes" action={<Badge tone="amber">{invitations.rows.length}</Badge>} />
          <CardBody className="space-y-3">
            {invitations.error && <p className="text-sm text-red-700">{invitations.error}</p>}
            {invitations.rows.length === 0 && !invitations.loading && (
              <p className="text-sm text-slate-500">Nenhum convite pendente. Use “Convidar usuário” para chamar alguém pelo e-mail.</p>
            )}
            {invitations.rows.map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <div>
                    <p className="text-navy">{invitation.email}</p>
                    <p className="text-xs text-slate-500">{roleLabels[invitation.role_key]} · expira em {formatDate(invitation.expires_at)}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => cancelInvitation(invitation.id)}>Cancelar</Button>
              </div>
            ))}
          </CardBody>
        </Card>
        )}

        <Card>
          <CardHeader title="Papéis disponíveis (RBAC)" />
          <CardBody className="space-y-2 text-sm">
            {CHURCH_ROLE_KEYS.map((r) => (
              <div key={r} className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-navy"><ShieldCheck className="h-4 w-4 text-brand-600" />{roleLabels[r]}</span>
                <Badge tone="neutral">por igreja</Badge>
              </div>
            ))}
            <p className="pt-2 text-xs text-slate-400">Um usuário pode pertencer a várias igrejas com papéis diferentes em cada uma.</p>
            {contactsMasked && (
              <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-slate-500">
                Você vê nomes e papéis, mas e-mail e telefone aparecem apenas para quem tem a permissão “Gerenciar membros” — é o banco que decide, não esta tela.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
