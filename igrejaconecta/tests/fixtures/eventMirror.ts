import { branches, categories, churches, events } from '@/data/mock'
import {
  EVENT_BRANCH_MISMATCH,
  EVENT_MANAGE_DENIED,
  EVENT_NOT_FOUND,
  EVENT_NO_CHURCH,
  EVENT_PUBLISH_DENIED,
  EVENTS_MANAGED_COLUMNS,
  EVENTS_PUBLIC_COLUMNS,
  eventSlugTaken,
  validateEventDraft,
  type EventActor,
  type EventCreationStatus,
  type EventDraft,
  type EventWriteResult,
} from '@/services/data/eventService'
import { slugify } from '@/utils/format'
import { can } from '@/utils/rbac'
import type { ChurchEvent, EventCategory, EventOrganizer, EventStatus, PublicEvent, RoleKey } from '@/types'

/**
 * Loja em memória que espelha `events`/`event_categories` e as políticas do grupo M
 * (0011) para os testes. Vive fora do aplicativo: o aplicativo só fala com o
 * Supabase, e aqui as mesmas recusas continuam especificadas em TypeScript, para a
 * consulta real não divergir do que a tela sempre mostrou.
 */

export function churchIsOnAir(churchId: string): boolean {
  const church = churches.find((c) => c.id === churchId)
  return church?.approval_status === 'approved' && church.status === 'active'
}

/** Espelha `events_public_read` + o WHERE do diretório, com a projeção do público. */
export function demoPublicEvents(): PublicEvent[] {
  return sortByStartsAt(
    events
      .filter((e) => e.status === 'published' && e.visibility === 'public')
      .filter((e) => churchIsOnAir(e.church_id)),
  ).map(demoPublicEvent)
}

export function demoPublicEventBySlug(slug: string): PublicEvent | null {
  const found = events.find(
    (e) => e.slug === slug && e.status === 'published' && e.visibility === 'public' && churchIsOnAir(e.church_id),
  )
  return found ? demoPublicEvent(found) : null
}

/** Espelha `events_church_read` recortado para a igreja da sessão, com a projeção de gestão. */
export function demoChurchEvents(churchId: string): ChurchEvent[] {
  return sortByStartsAt(events.filter((e) => e.church_id === churchId).map(demoManagedEvent))
}

/** Espelha `events_church_read` no ramo `is_superadmin()`: tudo, em qualquer status. */
export function demoAllEvents(role?: RoleKey): ChurchEvent[] {
  if (role !== 'superadmin') return []
  return sortByStartsAt(events.map(demoManagedEvent))
}

export function demoEventCategories(): EventCategory[] {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name))
}

// -- escritas -----------------------------------------------------------------

export function demoCreateEvent(draft: EventDraft, actor: EventActor, status: EventCreationStatus): EventWriteResult {
  const denied = gateWrite(actor) ?? (status === 'published' ? gatePublish(actor) : null)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: EVENT_NO_CHURCH }
  const invalid = validateEventDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const clean = normalizeDraft(draft)
  const slug = slugify(clean.name)
  if (events.some((e) => e.slug === slug)) return { ok: false, error: eventSlugTaken(slug) }
  const mismatch = demoBranchMismatch(clean.branch_id, churchId)
  if (mismatch) return { ok: false, error: mismatch }

  const row: ChurchEvent = {
    id: crypto.randomUUID(),
    church_id: churchId,
    church_name: churches.find((c) => c.id === churchId)?.name,
    slug,
    category_id: clean.category_id,
    category: categoryName(clean.category_id),
    name: clean.name,
    description: clean.description,
    starts_at: clean.starts_at,
    ends_at: clean.ends_at,
    address: clean.address,
    city: clean.city,
    cover_url: clean.cover_url,
    capacity: clean.capacity,
    is_free: true,
    visibility: clean.visibility,
    status,
    branch_id: clean.branch_id,
    latitude: clean.latitude,
    longitude: clean.longitude,
  }
  events.push(row)
  return { ok: true, event: demoManagedEvent(row) }
}

export function demoUpdateEvent(id: string, draft: EventDraft, actor: EventActor): EventWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateEventDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const found = demoEditableEvent(id, actor)
  if (!found) return { ok: false, error: EVENT_NOT_FOUND }
  const clean = normalizeDraft(draft)
  const mismatch = demoBranchMismatch(clean.branch_id, found.church_id)
  if (mismatch) return { ok: false, error: mismatch }

  Object.assign(found, clean)
  found.category = categoryName(clean.category_id)
  return { ok: true, event: demoManagedEvent(found) }
}

export function demoSetEventStatus(id: string, status: EventStatus, actor: EventActor): EventWriteResult {
  const denied = gateWrite(actor) ?? (status === 'published' ? gatePublish(actor) : null)
  if (denied) return { ok: false, error: denied }

  const found = demoEditableEvent(id, actor)
  if (!found) return { ok: false, error: EVENT_NOT_FOUND }
  found.status = status
  return { ok: true, event: demoManagedEvent(found) }
}

function gateWrite(actor: EventActor): string | null {
  return can(actor.role, 'events.manage') ? null : EVENT_MANAGE_DENIED
}

function gatePublish(actor: EventActor): string | null {
  return can(actor.role, 'events.publish') ? null : EVENT_PUBLISH_DENIED
}

/** Espelha `enforce_event_branch`: filial inexistente e filial alheia, mesma mensagem. */
function demoBranchMismatch(branchId: string | null, churchId: string): string | null {
  if (!branchId) return null
  const branch = branches.find((b) => b.id === branchId)
  return branch && branch.church_id === churchId ? null : EVENT_BRANCH_MISMATCH
}

/** Espelha USING + WITH CHECK de `events_update`: linha da igreja do autor, SuperAdmin transversal. */
function demoEditableEvent(id: string, actor: EventActor): ChurchEvent | undefined {
  const found = events.find((e) => e.id === id)
  if (!found) return undefined
  if (actor.role === 'superadmin') return found
  return found.church_id === actor.churchId ? found : undefined
}

function normalizeDraft(draft: EventDraft) {
  return {
    name: draft.name.trim(),
    category_id: draft.category_id,
    description: cleanText(draft.description),
    starts_at: draft.starts_at,
    ends_at: cleanText(draft.ends_at),
    address: cleanText(draft.address),
    city: cleanText(draft.city),
    cover_url: cleanText(draft.cover_url),
    capacity: draft.capacity ?? null,
    visibility: draft.visibility,
    branch_id: draft.branch_id ?? null,
    latitude: draft.latitude ?? null,
    longitude: draft.longitude ?? null,
  }
}

function cleanText(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function categoryName(categoryId: string): string | undefined {
  return categories.find((c) => c.id === categoryId)?.name
}

function demoPublicEvent(event: ChurchEvent): PublicEvent {
  const church = organizer(event.church_id)
  return {
    ...pickColumns(event, EVENTS_PUBLIC_COLUMNS),
    category: categoryName(event.category_id),
    church_name: church?.name ?? event.church_name,
    church,
  } as PublicEvent
}

function demoManagedEvent(event: ChurchEvent): ChurchEvent {
  return {
    ...pickColumns(event, EVENTS_MANAGED_COLUMNS),
    category: categoryName(event.category_id),
    church_name: event.church_name,
  } as ChurchEvent
}

function organizer(churchId: string): EventOrganizer | null {
  const church = churches.find((c) => c.id === churchId)
  if (!church) return null
  return {
    id: church.id,
    name: church.name,
    slug: church.slug,
    denomination: church.denomination ?? null,
    city: church.city ?? null,
    state: church.state ?? null,
    whatsapp: church.whatsapp ?? null,
  }
}

function pickColumns(event: ChurchEvent, columns: readonly (keyof ChurchEvent)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = event[column]
  return out
}

function sortByStartsAt<T extends { starts_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}
