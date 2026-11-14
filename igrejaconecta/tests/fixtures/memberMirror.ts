import { churches, members } from '@/data/mock'
import {
  MEMBER_MANAGE_DENIED,
  SUPERADMIN_NOT_ASSIGNABLE,
  SUPERADMIN_NOT_GRANTABLE,
  type WriteResult,
} from '@/services/data/memberService'
import { can, roleLabels } from '@/utils/rbac'
import type { ChurchInvitation, InvitationForMe, RoleKey } from '@/types'

/**
 * Loja em memória que espelha `church_invitations` + `church_members` (0008) para os
 * testes. Vive fora do aplicativo: as recusas estão provadas na suíte SQL (grupos
 * H1..H14) e o aceite é o RPC `accept_church_invitation`; aqui elas continuam
 * especificadas em TypeScript, para a chamada real não divergir do que a tela
 * sempre mostrou — inclusive do convite só aparecer para o próprio e-mail, que é o
 * que o `security defininer` do `pending_invitations_for_me()` garante.
 */

const DEMO_DAY = 24 * 60 * 60 * 1000
const futureDate = (days: number) => new Date(Date.now() + days * DEMO_DAY).toISOString()
const normalizeEmail = (email: string) => email.trim().toLowerCase()

const originalMembers = structuredClone(members)
let invitations: ChurchInvitation[] = []

/** Convites nascem dos membros mockados como "convidado" (cm3, em ch1). */
function seed() {
  invitations = members
    .filter((m) => m.status === 'invited' && m.role && m.user?.email)
    .map((m) => ({
      id: `inv-${m.id}`,
      church_id: m.church_id,
      email: m.user!.email,
      role_key: m.role!,
      status: 'pending' as const,
      invited_by: m.user_id,
      expires_at: futureDate(30),
      created_at: m.created_at,
    }))
}

export function resetMemberFixture() {
  members.splice(0, members.length, ...structuredClone(originalMembers))
  seed()
}

seed()

function manageAllowed(role?: RoleKey): WriteResult | null {
  return can(role, 'members.manage') ? null : { ok: false, error: MEMBER_MANAGE_DENIED }
}

function isExpired(invitation: ChurchInvitation) {
  return new Date(invitation.expires_at).getTime() <= Date.now()
}

function churchName(churchId: string) {
  return churches.find((c) => c.id === churchId)?.name ?? 'Igreja'
}

function toForMe(invitation: ChurchInvitation): InvitationForMe {
  return {
    ...invitation,
    church_name: churchName(invitation.church_id),
    church_slug: churches.find((c) => c.id === invitation.church_id)?.slug ?? '',
    role_name: roleLabels[invitation.role_key],
  }
}

export function demoInvite(input: {
  churchId: string
  email: string
  roleKey: RoleKey
  actorRole?: RoleKey
}): WriteResult {
  const email = normalizeEmail(input.email)
  if (!email || !email.includes('@')) return { ok: false, error: 'Informe um e-mail válido.' }
  if (input.roleKey === 'superadmin') return { ok: false, error: SUPERADMIN_NOT_GRANTABLE }
  const blocked = manageAllowed(input.actorRole)
  if (blocked) return blocked
  if (invitations.some((i) => i.church_id === input.churchId && normalizeEmail(i.email) === email && i.status === 'pending')) {
    return { ok: false, error: 'Já existe um convite pendente para este e-mail.' }
  }
  invitations.push({
    id: `inv-${Date.now().toString(36)}-${invitations.length}`,
    church_id: input.churchId,
    email,
    role_key: input.roleKey,
    status: 'pending',
    invited_by: null,
    expires_at: futureDate(30),
    created_at: new Date().toISOString(),
  })
  return { ok: true }
}

/** Espelha `church_invitations_read`: só quem gerencia membros, e só o que está pendente e vivo. */
export function demoListInvitations(churchId: string, actorRole?: RoleKey): ChurchInvitation[] {
  if (!can(actorRole, 'members.manage')) return []
  return invitations
    .filter((i) => i.church_id === churchId && i.status === 'pending' && !isExpired(i))
    .map((i) => ({ ...i }))
}

export function demoRevokeInvitation(id: string, actorRole?: RoleKey): WriteResult {
  const blocked = manageAllowed(actorRole)
  if (blocked) return blocked
  const invitation = invitations.find((i) => i.id === id)
  if (!invitation || invitation.status !== 'pending') return { ok: false, error: 'Este convite não está mais pendente.' }
  invitation.status = 'revoked'
  return { ok: true }
}

export function demoChangeMemberRole(input: {
  memberId: string
  roleKey: RoleKey
  actorRole?: RoleKey
}): WriteResult {
  if (input.roleKey === 'superadmin') return { ok: false, error: SUPERADMIN_NOT_ASSIGNABLE }
  const blocked = manageAllowed(input.actorRole)
  if (blocked) return blocked
  const member = members.find((m) => m.id === input.memberId)
  if (!member) return { ok: false, error: 'Membro não encontrado.' }
  member.role = input.roleKey
  return { ok: true }
}

/** Espelha o filtro por e-mail confirmado do RPC `pending_invitations_for_me()`. */
export function demoPendingInvitationsForMe(email?: string): InvitationForMe[] {
  if (!email) return []
  const mine = normalizeEmail(email)
  return invitations
    .filter((i) => i.status === 'pending' && !isExpired(i) && normalizeEmail(i.email) === mine)
    .map(toForMe)
}

/** Espelha os status que `accept_church_invitation` devolve, inclusive o vínculo criado. */
export function demoAcceptInvitation(id: string, email?: string): WriteResult {
  const invitation = invitations.find((i) => i.id === id)
  if (!invitation) return { ok: false, error: 'Este convite não existe mais.' }
  if (invitation.status !== 'pending') return { ok: false, error: 'Este convite já foi aceito ou cancelado.' }
  if (isExpired(invitation)) {
    invitation.status = 'expired'
    return { ok: false, error: 'Este convite expirou.' }
  }
  if (!email || normalizeEmail(invitation.email) !== normalizeEmail(email)) {
    return { ok: false, error: 'O e-mail deste convite não confere com o da sua conta.' }
  }

  invitation.status = 'accepted'
  const existing = members.find(
    (m) => m.church_id === invitation.church_id && m.user?.email && normalizeEmail(m.user.email) === normalizeEmail(email),
  )
  if (existing) {
    existing.status = 'active'
    existing.role = invitation.role_key
    return { ok: true }
  }
  const profileId = `u-${invitation.id}`
  const today = new Date().toISOString().slice(0, 10)
  members.push({
    id: `cm-${invitation.id}`,
    church_id: invitation.church_id,
    user_id: profileId,
    role_id: invitation.role_key,
    role: invitation.role_key,
    status: 'active',
    created_at: today,
    user: {
      id: profileId,
      full_name: email.split('@')[0]!,
      email,
      created_at: today,
      updated_at: today,
    },
  })
  return { ok: true }
}
