import { supabase } from '@/services/supabase/client'
import { can } from '@/utils/rbac'
import type { ChurchServiceTime, RoleKey } from '@/types'

/**
 * Horários de culto (0023). Escrita só com `church.manage` — a mesma régua de
 * perfil de rede e filial, porque horário é parte do cadastro da igreja; o
 * banco repete a régua na política, e nenhuma das duas dependes da outra.
 *
 * A leitura tem duas audiências honestas: a tela de gestão vê os horários da
 * própria igreja (qualquer membro ativo), e as páginas públicas veem só os de
 * igreja aprovada e ativa — é `churches_public_read` espelhado na 0023, não um
 * filtro inventado aqui.
 *
 * Como nos outros serviços, a projeção faz parte do contrato: o `select` daqui
 * é o que chega ao navegador.
 */

export const SERVICE_TIME_COLUMNS = ['id', 'church_id', 'branch_id', 'weekday', 'starts_at', 'name'] as const satisfies readonly (keyof ChurchServiceTime)[]

export const SERVICE_TIME_INSERT_COLUMNS = ['church_id', 'branch_id', 'weekday', 'starts_at', 'name'] as const
export const SERVICE_TIME_PATCH_COLUMNS = ['branch_id', 'weekday', 'starts_at', 'name'] as const

/** 0 = domingo, a ordem do `weekday` no banco. */
export const WEEKDAY_LABELS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const

export const SERVICE_TIME_MANAGE_DENIED =
  'Sem permissão para esta ação: cadastrar e editar horários de culto é papel do administrador da igreja ou do SuperAdmin.'
export const SERVICE_TIME_NOT_FOUND = 'Horário não encontrado ou sem permissão para alterá-lo. Atualize a lista.'
export const SERVICE_TIME_NO_CHURCH = 'A sua sessão não tem igreja ativa: quem não é de uma igreja não cadastra horário.'
export const SERVICE_TIME_NAME_INVALID = 'Informe o nome do culto (de 2 a 80 caracteres).'
export const SERVICE_TIME_WEEKDAY_INVALID = 'Escolha um dia da semana.'
export const SERVICE_TIME_TIME_INVALID = 'Horário no formato inválido: use hh:mm.'

export interface ServiceTimeActor {
  churchId?: string
  role?: RoleKey
}

export interface ServiceTimeDraft {
  branchId: string | null
  weekday: number
  startsAt: string
  name: string
}

export type ServiceTimeWriteResult =
  | { ok: true; serviceTime: ChurchServiceTime; error?: never }
  | { ok: false; error: string; serviceTime?: never }

/** Horários da igreja em ordem de semana (domingo primeiro) e hora. */
export async function fetchChurchServiceTimes(churchId?: string, actor?: ServiceTimeActor): Promise<ChurchServiceTime[]> {
  // SuperAdmin vê todas (é o que a `is_superadmin()` da política devolve); para
  // qualquer outro papel o recorte é a igreja da sessão — a política é a
  // segunda camada, não a única.
  const everyChurch = actor?.role === 'superadmin'
  if (!everyChurch && !churchId) return []
  return orderedRead(everyChurch ? undefined : churchId!)
}

/**
 * Vitrine pública: todos os horários que o banco deixa `anon` ver (igreja
 * aprovada e ativa). A página agrupa por igreja — o recorte é da política,
 * não daqui.
 */
export async function fetchPublicServiceTimes(): Promise<ChurchServiceTime[]> {
  return orderedRead(undefined)
}

async function orderedRead(churchId?: string): Promise<ChurchServiceTime[]> {
  let query = supabase
    .from('church_service_times')
    .select(SERVICE_TIME_COLUMNS.join(','))
    .order('weekday')
    .order('starts_at')
  if (churchId) query = query.eq('church_id', churchId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ChurchServiceTime[]
}

export function validateServiceTimeDraft(draft: ServiceTimeDraft): string | null {
  const name = draft.name.trim()
  if (name.length < 2 || name.length > 80) return SERVICE_TIME_NAME_INVALID
  if (!Number.isInteger(draft.weekday) || draft.weekday < 0 || draft.weekday > 6) return SERVICE_TIME_WEEKDAY_INVALID
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startsAt)) return SERVICE_TIME_TIME_INVALID
  return null
}

export async function createServiceTime(draft: ServiceTimeDraft, actor: ServiceTimeActor): Promise<ServiceTimeWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  if (!actor.churchId) return { ok: false, error: SERVICE_TIME_NO_CHURCH }
  const invalid = validateServiceTimeDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const row = {
    church_id: actor.churchId,
    branch_id: draft.branchId?.trim() ? draft.branchId : null,
    weekday: draft.weekday,
    starts_at: `${draft.startsAt}:00`,
    name: draft.name.trim(),
  }

  const { data, error } = await supabase
    .from('church_service_times')
    .insert(row)
    .select(SERVICE_TIME_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeServiceTimeDbError(error) }
  if (!data) return { ok: false, error: SERVICE_TIME_NOT_FOUND }
  return { ok: true, serviceTime: data as unknown as ChurchServiceTime }
}

export async function updateServiceTime(id: string, draft: ServiceTimeDraft, actor: ServiceTimeActor): Promise<ServiceTimeWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateServiceTimeDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const patch = {
    branch_id: draft.branchId?.trim() ? draft.branchId : null,
    weekday: draft.weekday,
    starts_at: `${draft.startsAt}:00`,
    name: draft.name.trim(),
  }

  const { data, error } = await supabase
    .from('church_service_times')
    .update(patch)
    .eq('id', id)
    .select(SERVICE_TIME_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeServiceTimeDbError(error) }
  // `maybeSingle` sem linha é o USING recusando em silêncio: mesma mensagem de
  // "não existe", sem oráculo sobre quem pode o quê.
  if (!data) return { ok: false, error: SERVICE_TIME_NOT_FOUND }
  return { ok: true, serviceTime: data as unknown as ChurchServiceTime }
}

export async function deleteServiceTime(id: string, actor: ServiceTimeActor): Promise<{ ok: true; error?: never } | { ok: false; error: string }> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }

  const { data, error } = await supabase.from('church_service_times').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: describeServiceTimeDbError(error) }
  if (!data || data.length === 0) return { ok: false, error: SERVICE_TIME_NOT_FOUND }
  return { ok: true }
}

/** `time` do Postgres vem "09:00:00"; a tela trabalha em "09:00". */
export function formatStartsAt(value: string): string {
  return value.slice(0, 5)
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? String(weekday)
}

function gateWrite(actor: ServiceTimeActor): string | null {
  return can(actor.role, 'church.manage') ? null : SERVICE_TIME_MANAGE_DENIED
}

function describeServiceTimeDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return SERVICE_TIME_MANAGE_DENIED
    case '23514':
      return 'O banco recusou o formato: dia da semana fora de 0 a 6, horário inválido ou nome fora de 2 a 80 caracteres.'
    case '23503':
      return 'Igreja ou filial não encontrada. Atualize a lista e tente de novo.'
    default:
      return error.message
  }
}
