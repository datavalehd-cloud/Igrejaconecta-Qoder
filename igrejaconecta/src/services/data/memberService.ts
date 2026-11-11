import { churches, members } from '@/data/mock'
import { can, roleLabels } from '@/utils/rbac'
import { supabase } from '@/services/supabase/client'
import type { ChurchInvitation, InvitationForMe, InvitationStatus, RoleKey } from '@/types'

export interface WriteResult {
  ok: boolean
  error?: string
}

/** Papéis que uma igreja pode conceder — `superadmin` é global e não entra aqui. */
export const CHURCH_ROLE_KEYS: RoleKey[] = ['church_admin', 'manager', 'communicator', 'pastor']

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/**
 * Escrita de membros (Fase 2, passo 2): convite por e-mail, revogação, mudança de
 * papel e aceite de convite.
 *
 * No modo real nada aqui decide quem pode o quê: as políticas de
 * `church_invitations` (0008) e o trigger de papel respondem, e o erro do banco é
 * o que aparece na tela. Em modo demo não há banco, então a simulação espelha as
 * mesmas recusas — inclusive as que a suíte de RLS prova (grupos H1..H14).
 */

// -- loja demo ----------------------------------------------------------------

const DEMO_DAY = 24 * 60 * 60 * 1000
const futureDate = (days: number) => new Date(Date.now() + days * DEMO_DAY).toISOString()

/** Convites demo nascem dos membros mockados como "convidado". */
const demoInvitations: ChurchInvitation[] = members
  .filter((m) => m.status === 'invited' && m.role && m.user?.email)
  .map((m) => ({
    id: `inv-${m.id}`,
    church_id: m.church_id,
    email: m.user!.email,
    role_key: m.role!,
    status: 'pending' as InvitationStatus,
    invited_by: m.user_id,
    expires_at: futureDate(30),
    created_at: m.created_at,
  }))

function demoManageAllowed(role?: RoleKey): WriteResult | null {
  if (can(role, 'members.manage')) return null
  return { ok: false, error: 'Você não tem a permissão “Gerenciar membros” nesta igreja.' }
}

function isExpired(invitation: ChurchInvitation) {
  return new Date(invitation.expires_at).getTime() <= Date.now()
}

function demoChurchName(churchId: string) {
  return churches.find((c) => c.id === churchId)?.name ?? 'Igreja'
}

function demoToForMe(invitation: ChurchInvitation): InvitationForMe {
  return {
    ...invitation,
    church_name: demoChurchName(invitation.church_id),
    church_slug: churches.find((c) => c.id === invitation.church_id)?.slug ?? '',
    role_name: roleLabels[invitation.role_key],
  }
}

// -- convite ------------------------------------------------------------------

export async function inviteMember(input: {
  churchId: string
  email: string
  roleKey: RoleKey
  actorRole?: RoleKey
}): Promise<WriteResult> {
  const email = normalizeEmail(input.email)
  if (!email || !email.includes('@')) return { ok: false, error: 'Informe um e-mail válido.' }
  if (input.roleKey === 'superadmin') return { ok: false, error: 'O papel SuperAdmin não é concedido por convite.' }

  if (!supabase) {
    const blocked = demoManageAllowed(input.actorRole)
    if (blocked) return blocked
    if (demoInvitations.some((i) => i.church_id === input.churchId && normalizeEmail(i.email) === email && i.status === 'pending')) {
      return { ok: false, error: 'Já existe um convite pendente para este e-mail.' }
    }
    demoInvitations.push({
      id: `inv-${Date.now().toString(36)}`,
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

  const roleRow = await supabase.from('roles').select('id').eq('key', input.roleKey).maybeSingle()
  if (roleRow.error) return { ok: false, error: describeDbError(roleRow.error) }
  if (!roleRow.data) return { ok: false, error: 'Papel não encontrado no banco.' }

  const { error } = await supabase.from('church_invitations').insert({
    church_id: input.churchId,
    email,
    role_id: roleRow.data.id,
    status: 'pending',
    invited_by: (await currentUserId()) ?? null,
  })
  return error ? { ok: false, error: describeDbError(error) } : { ok: true }
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

function describeDbError(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Sem permissão para esta ação na sua igreja.'
  if (error.code === '23505') return 'Já existe um convite pendente para este e-mail.'
  return error.message
}

// -- lista de convites --------------------------------------------------------

const INVITATION_SELECT = 'id, church_id, email, status, invited_by, expires_at, created_at, role:roles(key)'

export async function listInvitations(churchId: string, actorRole?: RoleKey): Promise<ChurchInvitation[]> {
  if (!supabase) {
    if (!can(actorRole, 'members.manage')) return []
    return demoInvitations
      .filter((i) => i.church_id === churchId && i.status === 'pending' && !isExpired(i))
      .map((i) => ({ ...i }))
  }

  const { data, error } = await supabase
    .from('church_invitations')
    .select(INVITATION_SELECT)
    .eq('church_id', churchId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw new Error(describeDbError(error))
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    church_id: row.church_id as string,
    email: row.email as string,
    role_key: (row.role as { key: RoleKey }).key,
    status: row.status as InvitationStatus,
    invited_by: (row.invited_by as string | null) ?? null,
    expires_at: row.expires_at as string,
    created_at: row.created_at as string,
  }))
}

export async function revokeInvitation(id: string, actorRole?: RoleKey): Promise<WriteResult> {
  if (!supabase) {
    const blocked = demoManageAllowed(actorRole)
    if (blocked) return blocked
    const invitation = demoInvitations.find((i) => i.id === id)
    if (!invitation || invitation.status !== 'pending') return { ok: false, error: 'Este convite não está mais pendente.' }
    invitation.status = 'revoked'
    return { ok: true }
  }

  const { data, error } = await supabase
    .from('church_invitations')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) return { ok: false, error: describeDbError(error) }
  if (!data || data.length === 0) return { ok: false, error: 'Este convite não está mais pendente.' }
  return { ok: true }
}

// -- papel do membro ----------------------------------------------------------

export async function changeMemberRole(input: {
  memberId: string
  roleKey: RoleKey
  actorRole?: RoleKey
}): Promise<WriteResult> {
  if (input.roleKey === 'superadmin') return { ok: false, error: 'O papel SuperAdmin não é concedido por aqui.' }

  if (!supabase) {
    const blocked = demoManageAllowed(input.actorRole)
    if (blocked) return blocked
    const member = members.find((m) => m.id === input.memberId)
    if (!member) return { ok: false, error: 'Membro não encontrado.' }
    member.role = input.roleKey
    return { ok: true }
  }

  const roleRow = await supabase.from('roles').select('id').eq('key', input.roleKey).maybeSingle()
  if (roleRow.error) return { ok: false, error: describeDbError(roleRow.error) }
  if (!roleRow.data) return { ok: false, error: 'Papel não encontrado no banco.' }

  const { data, error } = await supabase
    .from('church_members')
    .update({ role_id: roleRow.data.id })
    .eq('id', input.memberId)
    .select('id')
  if (error) return { ok: false, error: describeDbError(error) }
  if (!data || data.length === 0) return { ok: false, error: 'Sem permissão para mudar o papel deste membro.' }
  return { ok: true }
}

// -- convites endereçados à própria conta -------------------------------------

export async function pendingInvitationsForMe(email?: string): Promise<InvitationForMe[]> {
  if (!supabase) {
    if (!email) return []
    const mine = normalizeEmail(email)
    return demoInvitations
      .filter((i) => i.status === 'pending' && !isExpired(i) && normalizeEmail(i.email) === mine)
      .map(demoToForMe)
  }

  const { data, error } = await supabase.rpc('pending_invitations_for_me')
  if (error) throw new Error(describeDbError(error))
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    church_id: row.church_id as string,
    church_name: row.church_name as string,
    church_slug: row.church_slug as string,
    email: row.email as string,
    role_key: row.role_key as RoleKey,
    role_name: row.role_name as string,
    status: 'pending' as InvitationStatus,
    invited_by: null,
    expires_at: row.expires_at as string,
    created_at: row.invited_at as string,
  }))
}

const ACCEPT_MESSAGES: Record<string, string> = {
  sem_sessao: 'Faça login para aceitar o convite.',
  inexistente: 'Este convite não existe mais.',
  nao_pendente: 'Este convite já foi aceito ou cancelado.',
  expirada: 'Este convite expirou.',
  email_nao_confirmado: 'O e-mail deste convite não confere com o da sua conta.',
  papel_bloqueado: 'Este convite não pode ser aceito por aqui.',
}

export async function acceptInvitation(id: string, email?: string): Promise<WriteResult> {
  if (!supabase) {
    const invitation = demoInvitations.find((i) => i.id === id)
    if (!invitation) return { ok: false, error: ACCEPT_MESSAGES.inexistente }
    if (invitation.status !== 'pending') return { ok: false, error: ACCEPT_MESSAGES.nao_pendente }
    if (isExpired(invitation)) {
      invitation.status = 'expired'
      return { ok: false, error: ACCEPT_MESSAGES.expirada }
    }
    if (!email || normalizeEmail(invitation.email) !== normalizeEmail(email)) {
      return { ok: false, error: ACCEPT_MESSAGES.email_nao_confirmado }
    }

    invitation.status = 'accepted'
    const existing = members.find((m) => m.church_id === invitation.church_id && m.user?.email && normalizeEmail(m.user.email) === normalizeEmail(email))
    if (existing) {
      existing.status = 'active'
      existing.role = invitation.role_key
      return { ok: true }
    }
    const profileId = `u-${invitation.id}`
    members.push({
      id: `cm-${invitation.id}`,
      church_id: invitation.church_id,
      user_id: profileId,
      role_id: invitation.role_key,
      role: invitation.role_key,
      status: 'active',
      created_at: new Date().toISOString().slice(0, 10),
      user: {
        id: profileId,
        full_name: email.split('@')[0],
        email,
        created_at: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString().slice(0, 10),
      },
    })
    return { ok: true }
  }

  const { data, error } = await supabase.rpc('accept_church_invitation', { p_invitation: id })
  if (error) return { ok: false, error: describeDbError(error) }
  const status = String(data)
  if (status === 'aceito') return { ok: true }
  return { ok: false, error: ACCEPT_MESSAGES[status] ?? 'Não foi possível aceitar o convite.' }
}
