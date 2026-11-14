import { can } from '@/utils/rbac'
import { supabase } from '@/services/supabase/client'
import type { ChurchInvitation, InvitationForMe, InvitationStatus, RoleKey } from '@/types'

/**
 * Escrita de membros (Fase 2): convite por e-mail, revogação, mudança de papel e
 * aceite.
 *
 * Quem pode o quê é respondido pelo banco — as políticas de `church_invitations`
 * (0008) e o trigger `trg_church_invitations_role` (0008) — e o erro dele é o que
 * aparece na tela. O `can(actorRole, ...)` daqui é a primeira camada, a que evita
 * uma consulta que a RLS devolveria vazia; ela não substitui o banco.
 */

export interface WriteResult {
  ok: boolean
  error?: string
}

/** Papéis que uma igreja pode conceder — `superadmin` é global e não entra aqui. */
export const CHURCH_ROLE_KEYS: RoleKey[] = ['church_admin', 'manager', 'communicator', 'pastor']

export const MEMBER_MANAGE_DENIED = 'Você não tem a permissão “Gerenciar membros” nesta igreja.'
export const SUPERADMIN_NOT_GRANTABLE = 'O papel SuperAdmin não é concedido por convite.'
export const SUPERADMIN_NOT_ASSIGNABLE = 'O papel SuperAdmin não é concedido por aqui.'

const normalizeEmail = (email: string) => email.trim().toLowerCase()

function manageGate(actorRole?: RoleKey): WriteResult | null {
  return can(actorRole, 'members.manage') ? null : { ok: false, error: MEMBER_MANAGE_DENIED }
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
  if (input.roleKey === 'superadmin') return { ok: false, error: SUPERADMIN_NOT_GRANTABLE }
  const blocked = manageGate(input.actorRole)
  if (blocked) return blocked

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
  if (!can(actorRole, 'members.manage')) return []

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
  const blocked = manageGate(actorRole)
  if (blocked) return blocked

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
  if (input.roleKey === 'superadmin') return { ok: false, error: SUPERADMIN_NOT_ASSIGNABLE }
  const blocked = manageGate(input.actorRole)
  if (blocked) return blocked

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

/**
 * Quem é "eu" não é parâmetro: `pending_invitations_for_me()` (0008) filtra pelo
 * e-mail **confirmado** de `auth.users`, e é `security defininer` justamente porque
 * o convidado ainda não tem vínculo que nenhuma política de select deixaria ler.
 */
export async function pendingInvitationsForMe(): Promise<InvitationForMe[]> {
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

/** Status que o `accept_church_invitation` (0008) devolve, traduzidos para a tela. */
const ACCEPT_MESSAGES: Record<string, string> = {
  sem_sessao: 'Faça login para aceitar o convite.',
  inexistente: 'Este convite não existe mais.',
  nao_pendente: 'Este convite já foi aceito ou cancelado.',
  expirada: 'Este convite expirou.',
  email_nao_confirmado: 'O e-mail deste convite não confere com o da sua conta.',
  papel_bloqueado: 'Este convite não pode ser aceito por aqui.',
}

export async function acceptInvitation(id: string): Promise<WriteResult> {
  const { data, error } = await supabase.rpc('accept_church_invitation', { p_invitation: id })
  if (error) return { ok: false, error: describeDbError(error) }
  const status = String(data)
  if (status === 'aceito') return { ok: true }
  return { ok: false, error: ACCEPT_MESSAGES[status] ?? 'Não foi possível aceitar o convite.' }
}
