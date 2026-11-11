import { supabase } from '@/services/supabase/client'
import { can } from '@/utils/rbac'
import { events, registrations } from '@/data/mock'
import { churchIsOnAir } from '@/services/data/eventService'
import type { Registration, RegistrationStats, RoleKey } from '@/types'

/**
 * Inscrições (Fase 3, passo 2): escrever como visitante, listar como equipe,
 * contar para todo mundo.
 *
 * Três audiências diferentes, três fontes diferentes — e nenhuma delas é a mesma
 * tabela lida de qualquer jeito:
 *   * o visitante **escreve** por `register_for_event` (RPC SECURITY DEFINER).
 *     `event_registrations` não tem política de insert nem grant de escrita, então
 *     não existe caminho direto;
 *   * o visitante **lê** só agregados, pela view `event_registration_stats` —
 *     nome, e-mail e telefone de inscrito não são leitura pública (LGPD);
 *   * a equipe lê as linhas inteiras, e é a RLS (`registrations.manage`) que
 *     decide. Comunicador tem `events.manage` sem `registrations.manage`: vê a
 *     contagem, não vê a lista.
 *
 * O `ticket_code` nunca é devolvido pela RPC de inscrição: quem digitou o e-mail
 * ainda não provou que é dono dele. O código aparece só na lista da equipe e para
 * o dono confirmado da linha — por isso a tela pública mostra o estado
 * (confirmado / lista de espera) e não um ingresso.
 */

export interface RegistrationResult {
  ok: boolean
  /** Estado gravado: `confirmed` ou `waitlist`. */
  status?: 'confirmed' | 'waitlist'
  error?: string
}

export interface WriteResult {
  ok: boolean
  error?: string
}

/** Projeção da lista da equipe. Como em `churchService`, o que limita as colunas
 * que chegam ao navegador é este `select`: a RLS é por linha, não por coluna. */
export const REGISTRATION_COLUMNS = [
  'id',
  'event_id',
  'church_id',
  'user_id',
  'visitor_name',
  'visitor_email',
  'visitor_phone',
  'status',
  'ticket_code',
  'checked_in_at',
  'created_at',
] as const satisfies readonly (keyof Registration)[]

export const REGISTRATION_EVENT_EMBED = 'events(id, name, slug, starts_at)'

export const REGISTRATION_SELECT = [...REGISTRATION_COLUMNS, REGISTRATION_EVENT_EMBED]

/** Agregados da view pública: nenhuma coluna com dado pessoal entra aqui. */
export const STATS_COLUMNS = [
  'event_id',
  'church_id',
  'capacity',
  'pending_count',
  'confirmed_count',
  'waitlist_count',
  'checked_in_count',
  'cancelled_count',
  'active_count',
  'spots_left',
] as const satisfies readonly (keyof RegistrationStats)[]

/** Códigos de `register_for_event` → texto da tela. */
export const REGISTER_MESSAGES: Record<string, string> = {
  confirmed: 'Inscrição confirmada. A equipe da igreja tem o seu código para o check-in no dia.',
  waitlist: 'O evento lotou: você entrou na lista de espera. Se abrir vaga, a igreja promove a sua inscrição.',
  ja_inscrita: 'Este e-mail já está inscrito neste evento.',
  evento_indisponivel: 'Este evento não está disponível para inscrição.',
  evento_encerrado: 'As inscrições para este evento já foram encerradas.',
  dados_invalidos: 'Confira o nome (mínimo 2 letras) e um e-mail válido.',
}

/** Códigos de `check_in_registration`. */
export const CHECK_IN_MESSAGES: Record<string, string> = {
  presente: 'Check-in registrado.',
  ja_presente: 'Esta pessoa já estava registrada como presente.',
  cancelada: 'Esta inscrição foi cancelada.',
  sem_permissao: 'Você não tem a permissão “Gerenciar inscrições” nesta igreja.',
}

/** Códigos de `cancel_event_registration`. */
export const CANCEL_MESSAGES: Record<string, string> = {
  cancelada: 'Inscrição cancelada.',
  cancelada_com_promocao: 'Inscrição cancelada — a próxima pessoa da lista de espera foi confirmada.',
  ja_cancelada: 'Esta inscrição já estava cancelada.',
  sem_permissao: 'Você não tem a permissão “Gerenciar inscrições” nesta igreja.',
}

type RegistrationRow = Registration & { events: { id: string; name: string; slug: string; starts_at: string } | null }

// -- lista da equipe ----------------------------------------------------------

export async function fetchChurchRegistrations(churchId?: string, role?: RoleKey): Promise<Registration[]> {
  // A porta é `event_registrations_read` (0012): sem `registrations.manage` o
  // banco devolve zero linhas. O recorte aqui não é a guarda — é o que impede o
  // espelho demo de mostrar o que o banco recusaria.
  if (!churchId || !can(role, 'registrations.manage')) return []
  if (supabase) {
    const { data, error } = await supabase
      .from('event_registrations')
      .select(REGISTRATION_SELECT.join(','))
      .eq('church_id', churchId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(describeDbError(error))
    return ((data ?? []) as unknown as RegistrationRow[]).map(toRegistration)
  }
  return demoChurchRegistrations(churchId)
}

/** Espelha `event_registrations_read` recortado para a igreja da sessão. */
export function demoChurchRegistrations(churchId: string): Registration[] {
  const churchEventIds = new Set(events.filter((e) => e.church_id === churchId).map((e) => e.id))
  return registrations
    .filter((r) => churchEventIds.has(r.event_id))
    .map((r) => ({ ...r, ticket_code: r.ticket_code ?? demoTicketFor(r.id) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// -- contagem -----------------------------------------------------------------

/**
 * Estatísticas por evento. A audiência é decidida pela view: o visitante recebe
 * só os eventos no ar, o membro recebe os da própria igreja e o SuperAdmin todos.
 * Pedir sem filtro é seguro justamente por isso — o recorte não é a guarda.
 */
export async function fetchRegistrationStats(): Promise<RegistrationStats[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('event_registration_stats')
      .select(STATS_COLUMNS.join(','))
    if (error) throw new Error(describeDbError(error))
    return (data ?? []) as unknown as RegistrationStats[]
  }
  return demoRegistrationStats()
}

const OCCUPYING = ['pending', 'confirmed', 'checked_in']

export function demoRegistrationStats(): RegistrationStats[] {
  return events.map((event) => {
    const mine = registrations.filter((r) => r.event_id === event.id)
    const count = (status: string) => mine.filter((r) => r.status === status).length
    const capacity = event.capacity ?? null
    const occupying = mine.filter((r) => OCCUPYING.includes(r.status)).length
    return {
      event_id: event.id,
      church_id: event.church_id,
      capacity,
      pending_count: count('pending'),
      confirmed_count: count('confirmed'),
      waitlist_count: count('waitlist'),
      checked_in_count: count('checked_in'),
      cancelled_count: count('cancelled'),
      active_count: mine.filter((r) => r.status !== 'cancelled').length,
      spots_left: capacity === null ? null : Math.max(capacity - occupying, 0),
    }
  })
}

// -- inscrição do visitante ---------------------------------------------------

export async function registerForEvent(input: {
  eventId: string
  name: string
  email: string
  phone?: string
}): Promise<RegistrationResult> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (name.length < 2 || !email.includes('@')) {
    return { ok: false, error: REGISTER_MESSAGES.dados_invalidos }
  }

  if (supabase) {
    const { data, error } = await supabase.rpc('register_for_event', {
      p_event: input.eventId,
      p_name: name,
      p_email: email,
      p_phone: input.phone?.trim() || null,
    })
    if (error) return { ok: false, error: describeDbError(error) }
    const code = String(data)
    if (code === 'confirmed' || code === 'waitlist') return { ok: true, status: code }
    return { ok: false, error: REGISTER_MESSAGES[code] ?? 'Não foi possível concluir a inscrição.' }
  }

  return demoRegisterForEvent({ eventId: input.eventId, name, email, phone: input.phone })
}

/** Espelha `register_for_event`: mesma audiência, mesma fila, mesmo código. */
export function demoRegisterForEvent(input: {
  eventId: string
  name: string
  email: string
  phone?: string
}): RegistrationResult {
  const event = events.find((e) => e.id === input.eventId)
  if (!event || event.status !== 'published' || event.visibility !== 'public' || !churchIsOnAir(event.church_id)) {
    return { ok: false, error: REGISTER_MESSAGES.evento_indisponivel }
  }
  if (new Date(event.starts_at).getTime() <= Date.now()) {
    return { ok: false, error: REGISTER_MESSAGES.evento_encerrado }
  }
  if (registrations.some((r) => r.event_id === event.id && r.visitor_email === input.email && r.status !== 'cancelled')) {
    return { ok: false, error: REGISTER_MESSAGES.ja_inscrita }
  }

  const occupying = registrations.filter((r) => r.event_id === event.id && OCCUPYING.includes(r.status)).length
  const capacity = event.capacity ?? null
  const status = capacity === null || occupying < capacity ? 'confirmed' : 'waitlist'

  registrations.push({
    id: `reg-${Date.now().toString(36)}`,
    event_id: event.id,
    event_name: event.name,
    church_id: event.church_id,
    visitor_name: input.name,
    visitor_email: input.email,
    visitor_phone: input.phone?.trim() || null,
    status,
    ticket_code: demoTicketFor(`reg-${Date.now().toString(36)}`),
    created_at: new Date().toISOString().slice(0, 10),
  })
  return { ok: true, status }
}

// -- check-in e cancelamento --------------------------------------------------

export async function checkInRegistration(id: string, actorRole?: RoleKey): Promise<WriteResult> {
  if (supabase) {
    const { data, error } = await supabase.rpc('check_in_registration', { p_registration: id })
    if (error) return { ok: false, error: describeDbError(error) }
    const code = String(data)
    return code === 'presente'
      ? { ok: true }
      : { ok: false, error: CHECK_IN_MESSAGES[code] ?? 'Não foi possível registrar o check-in.' }
  }
  return demoCheckIn(id, actorRole)
}

/** Espelha `check_in_registration`, inclusive a porta de permissão. */
export function demoCheckIn(id: string, actorRole?: RoleKey): WriteResult {
  if (!can(actorRole, 'registrations.manage')) return { ok: false, error: CHECK_IN_MESSAGES.sem_permissao }
  const registration = registrations.find((r) => r.id === id)
  if (!registration) return { ok: false, error: 'Inscrição não encontrada.' }
  if (registration.status === 'cancelled') return { ok: false, error: CHECK_IN_MESSAGES.cancelada }
  if (registration.status === 'checked_in') return { ok: false, error: CHECK_IN_MESSAGES.ja_presente }
  registration.status = 'checked_in'
  registration.checked_in_at = new Date().toISOString()
  return { ok: true }
}

export async function cancelRegistration(id: string, actorRole?: RoleKey): Promise<WriteResult> {
  if (supabase) {
    const { data, error } = await supabase.rpc('cancel_event_registration', { p_registration: id })
    if (error) return { ok: false, error: describeDbError(error) }
    const code = String(data)
    return code === 'cancelada' || code === 'cancelada_com_promocao'
      ? { ok: true, error: code === 'cancelada_com_promocao' ? CANCEL_MESSAGES.cancelada_com_promocao : undefined }
      : { ok: false, error: CANCEL_MESSAGES[code] ?? 'Não foi possível cancelar a inscrição.' }
  }
  return demoCancelRegistration(id, actorRole)
}

/** Espelha `cancel_event_registration`: permissão, cancelamento e promoção da fila. */
export function demoCancelRegistration(id: string, actorRole?: RoleKey): WriteResult {
  if (!can(actorRole, 'registrations.manage')) return { ok: false, error: CANCEL_MESSAGES.sem_permissao }
  const registration = registrations.find((r) => r.id === id)
  if (!registration) return { ok: false, error: 'Inscrição não encontrada.' }
  if (registration.status === 'cancelled') return { ok: false, error: CANCEL_MESSAGES.ja_cancelada }

  registration.status = 'cancelled'

  const event = events.find((e) => e.id === registration.event_id)
  const capacity = event?.capacity ?? null
  if (capacity === null) return { ok: true }

  const occupying = registrations.filter(
    (r) => r.event_id === registration.event_id && OCCUPYING.includes(r.status),
  ).length
  if (occupying >= capacity) return { ok: true }

  const next = registrations
    .filter((r) => r.event_id === registration.event_id && r.status === 'waitlist')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
  if (!next) return { ok: true }

  next.status = 'confirmed'
  return { ok: true, error: CANCEL_MESSAGES.cancelada_com_promocao }
}

// -- helpers ------------------------------------------------------------------

function toRegistration(row: RegistrationRow): Registration {
  const { events: event, ...registration } = row
  return { ...registration, event_name: event?.name }
}

function describeDbError(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Sem permissão para esta ação na sua igreja.'
  if (error.code === '23505') return 'Este e-mail já está inscrito neste evento.'
  return error.message
}

/** O mesmo alfabeto da 0012 (sem 0/1), só para a lista demo ter código. */
const TICKET_ALPHABET = '23456789ABCDEF'

function demoTicketFor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const digits = Array.from({ length: 6 }, (_, i) => TICKET_ALPHABET[(hash >> (i * 5)) % TICKET_ALPHABET.length]).join('')
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}
