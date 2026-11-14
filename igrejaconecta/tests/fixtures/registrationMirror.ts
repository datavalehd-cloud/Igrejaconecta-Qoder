import { events, registrations } from '@/data/mock'
import {
  CANCEL_MESSAGES,
  CHECK_IN_MESSAGES,
  REGISTER_MESSAGES,
  type RegistrationResult,
  type WriteResult,
} from '@/services/data/registrationService'
import { churchIsOnAir } from './eventMirror'
import { can } from '@/utils/rbac'
import type { Registration, RegistrationStats, RoleKey } from '@/types'

/**
 * Loja em memória que espelha `event_registrations` + as três RPCs da 0012 para os
 * testes. Vive fora do aplicativo: a audiência, a fila e a promoção estão provadas
 * no grupo N da suíte SQL; aqui elas continuam especificadas em TypeScript, para a
 * chamada real não divergir do que a tela sempre mostrou.
 */

const OCCUPYING = ['pending', 'confirmed', 'checked_in']

/** Espelha `event_registrations_read` recortado para a igreja da sessão. */
export function demoChurchRegistrations(churchId: string): Registration[] {
  const churchEventIds = new Set(events.filter((e) => e.church_id === churchId).map((e) => e.id))
  return registrations
    .filter((r) => churchEventIds.has(r.event_id))
    .map((r) => ({ ...r, ticket_code: r.ticket_code ?? ticketFor(r.id) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Espelha a view `event_registration_stats`: um agregado por evento. */
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

/** Espelha `register_for_event`: mesma normalização, audiência, fila e código. */
export function demoRegisterForEvent(input: {
  eventId: string
  name: string
  email: string
  phone?: string
}): RegistrationResult {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (name.length < 2 || !email.includes('@')) return { ok: false, error: REGISTER_MESSAGES.dados_invalidos }

  const event = events.find((e) => e.id === input.eventId)
  if (!event || event.status !== 'published' || event.visibility !== 'public' || !churchIsOnAir(event.church_id)) {
    return { ok: false, error: REGISTER_MESSAGES.evento_indisponivel }
  }
  if (new Date(event.starts_at).getTime() <= Date.now()) {
    return { ok: false, error: REGISTER_MESSAGES.evento_encerrado }
  }
  if (registrations.some((r) => r.event_id === event.id && r.visitor_email === email && r.status !== 'cancelled')) {
    return { ok: false, error: REGISTER_MESSAGES.ja_inscrita }
  }

  const occupying = registrations.filter((r) => r.event_id === event.id && OCCUPYING.includes(r.status)).length
  const capacity = event.capacity ?? null
  const status = capacity === null || occupying < capacity ? 'confirmed' : 'waitlist'

  const id = `reg-${crypto.randomUUID()}`
  registrations.push({
    id,
    event_id: event.id,
    event_name: event.name,
    church_id: event.church_id,
    visitor_name: name,
    visitor_email: email,
    visitor_phone: input.phone?.trim() || null,
    status,
    ticket_code: ticketFor(id),
    created_at: new Date().toISOString().slice(0, 10),
  })
  return { ok: true, status }
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

/** O mesmo alfabeto da 0012 (sem 0/1), para a lista do fixture ter código. */
const TICKET_ALPHABET = '23456789ABCDEF'

function ticketFor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const digits = Array.from({ length: 6 }, (_, i) => TICKET_ALPHABET[(hash >>> (i * 5)) % TICKET_ALPHABET.length]).join('')
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}
