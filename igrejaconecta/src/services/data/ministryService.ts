import { supabase } from '@/services/supabase/client'
import { can } from '@/utils/rbac'
import type { Ministry, RoleKey } from '@/types'

/**
 * Ministérios e equipes (0015 + 0021). A leitura vem da view `ministry_list`, que
 * é quem junta o nome do líder (`left join profiles`) e conta participantes no
 * banco — por isso não existe campo "quantos" editável em lugar nenhum.
 *
 * Escrita só com `members.manage` (a mesma chave de gerenciar membros: a 0015 não
 * criou permissão nova de propósito), e o recorte de leitura é a igreja da sessão
 * — o SuperAdmin alcança todas porque a view checa `is_superadmin()`.
 *
 * A 0021 é o que torna o `leader_id` seguro: como a view é `security_invoker =
 * false`, o join do nome não passa pela RLS de `profiles` (que só deixa cada um
 * ler a si mesmo). Sem a guarda, escrever um uuid alheio devolvia o nome daquela
 * pessoa na tela. Aqui a camada de app não tenta reproduzir a regra: ela chama e
 * traduz o `42501` do banco em frase legível.
 */

export const MINISTRY_COLUMNS = [
  'id',
  'church_id',
  'type',
  'name',
  'description',
  'leader_id',
  'leader_name',
  'members_count',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof Ministry)[]

const MINISTRY_SELECT = MINISTRY_COLUMNS.join(',')

export const MINISTRY_MANAGE_DENIED =
  'Sem permissão para esta ação: ministério e equipe são geridos por quem gerencia os membros da igreja.'
export const MINISTRY_NOT_FOUND = 'Ministério não encontrado ou sem permissão para alterá-lo. Atualize a lista.'
export const MINISTRY_NO_CHURCH = 'A sua sessão não tem igreja ativa: quem não é de uma igreja não cadastra ministério.'
export const MINISTRY_LEADER_OUTSIDE =
  'O líder precisa ser membro ativo da mesma igreja do ministério. Escolha alguém da lista de membros.'
export const MINISTRY_MEMBER_OUTSIDE =
  'Só entra no ministério quem é membro ativo da igreja dele. A pessoa escolhida não é, ou você não gerencia este ministério.'

export interface MinistryActor {
  churchId?: string
  role?: RoleKey
}

export interface MinistryDraft {
  name: string
  type: Ministry['type']
  description?: string | null
  leader_id?: string | null
}

export interface MinistryMemberRow {
  ministry_id: string
  user_id: string
}

export type MinistryWriteResult =
  | { ok: true; ministry: Ministry; error?: never }
  | { ok: false; error: string; ministry?: never }

export type MinistryMembersResult =
  | { ok: true; members: MinistryMemberRow[]; error?: never }
  | { ok: false; error: string; members?: never }

/** Ministérios da igreja da sessão, em ordem de nome; o SuperAdmin vê todos. */
export async function fetchMinistries(churchId?: string, actor?: MinistryActor): Promise<Ministry[]> {
  const everyChurch = actor?.role === 'superadmin'
  if (!everyChurch && !churchId) return []

  let query = supabase.from('ministry_list').select(MINISTRY_SELECT).order('name')
  if (!everyChurch) query = query.eq('church_id', churchId!)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Ministry[]
}

/**
 * Quem está no ministério. `ministry_members` só tem `user_id`: o nome vem do
 * roster (`church_roster`, 0007), que é a fonte escolhida de propósito — a RLS de
 * `profiles` continua fechada e o nome chega pela mesma porta que já chegava.
 */
export async function fetchMinistryMembers(ministryId: string): Promise<MinistryMemberRow[]> {
  const { data, error } = await supabase
    .from('ministry_members')
    .select('ministry_id, user_id')
    .eq('ministry_id', ministryId)
  if (error) throw new Error(error.message)
  return (data ?? []) as MinistryMemberRow[]
}

export function validateMinistryDraft(draft: MinistryDraft): string | null {
  const name = draft.name.trim()
  if (name.length < 2) return 'Informe o nome do ministério (pelo menos 2 caracteres).'
  if (name.length > 80) return 'O nome do ministério tem no máximo 80 caracteres.'
  if (draft.type !== 'ministry' && draft.type !== 'department' && draft.type !== 'team') {
    return 'Tipo de ministério inválido: use ministério, departamento ou equipe.'
  }
  return null
}

export async function createMinistry(draft: MinistryDraft, actor: MinistryActor): Promise<MinistryWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: MINISTRY_NO_CHURCH }
  const invalid = validateMinistryDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const row = {
    church_id: churchId,
    name: draft.name.trim(),
    type: draft.type,
    description: cleanText(draft.description),
    leader_id: cleanId(draft.leader_id),
  }

  const { data, error } = await supabase.from('ministries').insert(row).select('id').maybeSingle()
  if (error) return { ok: false, error: describeMinistryDbError(error, MINISTRY_LEADER_OUTSIDE) }
  if (!data) return { ok: false, error: MINISTRY_NOT_FOUND }
  return readBack(data.id)
}

export async function updateMinistry(id: string, draft: MinistryDraft, actor: MinistryActor): Promise<MinistryWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateMinistryDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const patch = {
    name: draft.name.trim(),
    type: draft.type,
    description: cleanText(draft.description),
    leader_id: cleanId(draft.leader_id),
  }

  // A `id`+`select('id')` minimal, e a releitura vem da view: é ela que tem
  // `leader_name` e `members_count`, e é ela que a tela mostra.
  const { data, error } = await supabase
    .from('ministries')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: describeMinistryDbError(error, MINISTRY_LEADER_OUTSIDE) }
  // `maybeSingle` sem linha é o USING recusando em silêncio: quem é de fora não
  // alcança a linha, e a resposta não pode dizer "existe mas é de outra igreja".
  if (!data) return { ok: false, error: MINISTRY_NOT_FOUND }
  return readBack(data.id)
}

export async function deleteMinistry(id: string, actor: MinistryActor): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }

  const { data, error } = await supabase.from('ministries').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: describeMinistryDbError(error, MINISTRY_NOT_FOUND) }
  if (!data || data.length === 0) return { ok: false, error: MINISTRY_NOT_FOUND }
  return { ok: true }
}

/**
 * Adicionar participante. A guarda da 0021 é o que diz se a pessoa pode estar
 * aqui; este serviço só traduz a recusa. `23505` é o par já existir — a tela
 * oferece gente que ainda não está, mas duas abas abertas chegam nele.
 */
export async function addMinistryMember(
  ministryId: string,
  userId: string,
  actor: MinistryActor,
): Promise<MinistryMembersResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  if (!userId) return { ok: false, error: MINISTRY_MEMBER_OUTSIDE }

  const { data, error } = await supabase
    .from('ministry_members')
    .insert({ ministry_id: ministryId, user_id: userId })
    .select('ministry_id, user_id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Essa pessoa já participa do ministério.' }
    return { ok: false, error: describeMinistryDbError(error, MINISTRY_MEMBER_OUTSIDE) }
  }
  return { ok: true, members: (data ?? []) as MinistryMemberRow[] }
}

export async function removeMinistryMember(
  ministryId: string,
  userId: string,
  actor: MinistryActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }

  const { data, error } = await supabase
    .from('ministry_members')
    .delete()
    .eq('ministry_id', ministryId)
    .eq('user_id', userId)
    .select('ministry_id')
  if (error) return { ok: false, error: describeMinistryDbError(error, MINISTRY_MEMBER_OUTSIDE) }
  if (!data || data.length === 0) return { ok: false, error: 'Essa pessoa não está mais no ministério. Atualize a lista.' }
  return { ok: true }
}

async function readBack(id: string): Promise<MinistryWriteResult> {
  const { data, error } = await supabase
    .from('ministry_list')
    .select(MINISTRY_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: MINISTRY_NOT_FOUND }
  return { ok: true, ministry: data as unknown as Ministry }
}

function gateWrite(actor: MinistryActor): string | null {
  return can(actor.role, 'members.manage') ? null : MINISTRY_MANAGE_DENIED
}

/** Vazio vira null: é o que a coluna guarda e o que a tela mostra como "—". */
function cleanText(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

/** `''` e uuid zerado de `<select>` não são pessoa nenhuma: vão como NULL. */
function cleanId(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function describeMinistryDbError(error: { code?: string; message: string }, permissionMessage: string): string {
  switch (error.code) {
    case '42501':
      return permissionMessage
    case '23503':
      return 'A pessoa indicada não é uma conta desta plataforma. Atualize a lista de membros.'
    case '23514':
      return 'Nome ou tipo fora do permitido: o nome vai de 2 a 80 caracteres e o tipo é ministério, departamento ou equipe.'
    default:
      return error.message
  }
}
