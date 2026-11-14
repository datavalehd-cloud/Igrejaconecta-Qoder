import { supabase } from '@/services/supabase/client'
import { slugify } from '@/utils/format'
import { validateLatLng } from '@/utils/geo'
import { can } from '@/utils/rbac'
import type { ChurchEvent, EventCategory, EventOrganizer, EventStatus, EventVisibility, PublicEvent, RoleKey } from '@/types'

/**
 * Eventos (Fase 3). As leituras são quatro: o diretório público, o evento por
 * slug, a agenda da própria igreja e o catálogo de categorias. As escritas são
 * três: criar, editar e mudar o status — publicar entre elas.
 *
 * Como em `churchService`, a projeção é parte do contrato: a RLS de `events`
 * (0011) é por linha, então o que limita as colunas que chegam ao navegador é o
 * `select` daqui. Os casos M1/M3/M9 da suíte escrevem essas mesmas colunas por
 * extenso, e os testes unitários comparam as duas listas nos dois sentidos.
 *
 * O filtro `published + public` do diretório é **redundância**, não a guarda: quem
 * garante isso para o visitante é `events_public_read` (0011), que também exige
 * igreja aprovada e ativa — provado nos casos M1 e M4.
 *
 * A contagem de inscritos não vem daqui: `events` não tem esse número e a fonte
 * real é a view `event_registration_stats` (0012), lida por `registrationService`.
 * Juntar as duas coisas é papel da tela, nunca desta projeção — assim o "—" só
 * aparece quando não há fonte confirmada.
 */

/** Diretório público: o que o visitante pode ver. `visibility` fica de fora. */
export const EVENTS_PUBLIC_COLUMNS = [
  'id',
  'church_id',
  'category_id',
  'slug',
  'name',
  'description',
  'starts_at',
  'ends_at',
  'address',
  'city',
  'cover_url',
  'capacity',
  'is_free',
  'status',
] as const satisfies readonly (keyof ChurchEvent)[]

/**
 * Agenda da igreja: a mesma lista mais `visibility`, que a gestão precisa
 * mostrar, e a localização da Fase 4 — `branch_id`, `latitude`, `longitude`
 * (0013). As três ficam **fora** da projeção pública: o visitante continua vendo
 * o endereço em texto, e publicar coordenada de evento é decisão que ainda não
 * foi tomada.
 */
export const EVENTS_MANAGED_COLUMNS = [
  ...EVENTS_PUBLIC_COLUMNS,
  'visibility',
  'branch_id',
  'latitude',
  'longitude',
] as const satisfies readonly (keyof ChurchEvent)[]

/**
 * Embed da organizadora. As colunas são um subconjunto de `DIRECTORY_COLUMNS`
 * (churchService): o visitante não recebe aqui nada que o diretório já não daria.
 */
export const EVENT_ORGANIZER_EMBED = 'churches(id, name, slug, denomination, city, state, whatsapp)'

export const EVENTS_PUBLIC_SELECT = [...EVENTS_PUBLIC_COLUMNS, 'event_categories(name)', EVENT_ORGANIZER_EMBED]
export const EVENTS_MANAGED_SELECT = [...EVENTS_MANAGED_COLUMNS, 'event_categories(name)']
export const EVENT_CATEGORY_COLUMNS = ['id', 'name', 'slug', 'custom'] as const satisfies readonly (keyof EventCategory)[]

type PublicRow = PublicEvent & {
  event_categories: { name: string } | null
  churches: EventOrganizer | null
}

type ManagedRow = ChurchEvent & {
  event_categories: { name: string } | null
}

/** Eventos no ar, em ordem de início — a lista das páginas públicas. */
export async function fetchPublicEvents(): Promise<PublicEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENTS_PUBLIC_SELECT.join(','))
    .eq('status', 'published')
    .eq('visibility', 'public')
    .order('starts_at')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as PublicRow[]).map(toPublicEvent)
}

/** Um evento pelo slug. Null quando não existe ou não está no ar para quem consulta. */
export async function fetchPublicEventBySlug(slug: string): Promise<PublicEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENTS_PUBLIC_SELECT.join(','))
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toPublicEvent(data as unknown as PublicRow) : null
}

/**
 * Agenda da própria igreja, em qualquer status (rascunho inclusive). Quem libera
 * as linhas é `events_church_read`; pedir a igreja da sessão é o recorte da tela,
 * não a guarda — sem `churchId` não há o que listar.
 */
export async function fetchChurchEvents(churchId?: string): Promise<ChurchEvent[]> {
  if (!churchId) return []
  const { data, error } = await supabase
    .from('events')
    .select(EVENTS_MANAGED_SELECT.join(','))
    .eq('church_id', churchId)
    .order('starts_at')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ManagedRow[]).map(toManagedEvent)
}

/**
 * Agenda global do SuperAdmin (Fase 8): todos os eventos, de todas as igrejas, em
 * qualquer status. Não há política nova — `events_church_read` (0011) já tem o ramo
 * `is_superadmin()`. Quem não é SuperAdmin recebe `[]` antes de consultar (o gate é
 * a primeira camada; a política é a segunda). A projeção é a mesma de gestão
 * (`EVENTS_MANAGED_SELECT`), que já traz `church_id` para a tela resolver o nome da
 * igreja na lista que ela já carrega — sem embed novo.
 */
export async function fetchAllEvents(role?: RoleKey): Promise<ChurchEvent[]> {
  if (role !== 'superadmin') return []
  const { data, error } = await supabase
    .from('events')
    .select(EVENTS_MANAGED_SELECT.join(','))
    .order('starts_at')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ManagedRow[]).map(toManagedEvent)
}

/** Catálogo de categorias (0011): leitura pública, escrita só do SuperAdmin. */
export async function fetchEventCategories(): Promise<EventCategory[]> {
  const { data, error } = await supabase
    .from('event_categories')
    .select(EVENT_CATEGORY_COLUMNS.join(','))
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as EventCategory[]
}

function toPublicEvent(row: PublicRow): PublicEvent {
  const { event_categories: category, churches: church, ...event } = row
  return { ...event, category: category?.name, church_name: church?.name, church }
}

function toManagedEvent(row: ManagedRow): ChurchEvent {
  const { event_categories: category, ...event } = row
  return { ...event, category: category?.name }
}

// ---------------------------------------------------------------------------
// Escritas (Fase 3, passo 3)
// ---------------------------------------------------------------------------

/**
 * Aqui a equipe escreve direto na tabela, diferente das inscrições (0012): quem
 * cria e edita é `authenticated` com vínculo na igreja, e `events_insert` /
 * `events_update` (0011) já exigem `events.manage` na linha certa. Publicar
 * segue sendo a exceção de sempre — RLS não controla valor de coluna, então quem
 * recusa o comunicador é o trigger `trg_events_publish` com 42501 (caso M6).
 *
 * Três campos não vêm do formulário:
 *   * `church_id` — é a igreja da sessão. Mover o evento para outra igreja é
 *     recusado pelo WITH CHECK da política (caso M10 da suíte);
 *   * `slug` — nasce do nome uma vez só; mudar o endereço depois quebraria os
 *     links já divulgados;
 *   * `is_free` — o IgrejaConecta não cobra ingresso, então a coluna fica no
 *     default do banco e a tela não oferece a opção "pago".
 *
 * As portas de permissão abaixo não são a guarda: a guarda é a política e o
 * trigger. Elas existem para o recusado ter a mesma mensagem legível que o banco
 * daria, sem disparar uma consulta condenada.
 */

export const EVENT_MANAGE_DENIED =
  'Sem permissão para esta ação: gerenciar eventos é papel do comunicador, do gerente, do pastor ou do administrador da igreja.'
export const EVENT_PUBLISH_DENIED =
  'O seu papel não publica eventos. Salve como rascunho: administrador da igreja, gerente, pastor ou SuperAdmin põem no ar.'
export const EVENT_NOT_FOUND = 'Evento não encontrado ou sem permissão para alterá-lo. Atualize a lista.'
export const EVENT_NO_CHURCH = 'A sua sessão não tem igreja ativa: quem não é de uma igreja não cria evento.'
export const EVENT_BRANCH_MISMATCH =
  'A filial escolhida não pertence a esta igreja. Selecione uma filial da própria igreja ou deixe sem filial.'

export function eventSlugTaken(slug: string): string {
  return `Já existe um evento com o endereço /${slug}. Ajuste o nome — o endereço é gerado a partir dele.`
}

export interface EventActor {
  churchId?: string
  role?: RoleKey
}

/** O que o formulário entrega. `status` não está aqui: é decisão da ação. */
export interface EventDraft {
  name: string
  category_id: string
  description?: string | null
  starts_at: string
  ends_at?: string | null
  address?: string | null
  city?: string | null
  cover_url?: string | null
  capacity?: number | null
  visibility: EventVisibility
  branch_id?: string | null
  latitude?: number | null
  longitude?: number | null
}

export type EventWriteResult =
  | { ok: true; event: ChurchEvent; error?: never }
  | { ok: false; error: string; event?: never }

/** Criação nasce rascunho ou publicada; qualquer transição depois é `setEventStatus`. */
export type EventCreationStatus = 'draft' | 'published'

/** Colunas enviadas na criação. `is_free`, `id` e os carimbos ficam com o banco. */
export const EVENT_INSERT_COLUMNS = [
  'church_id',
  'category_id',
  'slug',
  'name',
  'description',
  'starts_at',
  'ends_at',
  'address',
  'city',
  'cover_url',
  'capacity',
  'visibility',
  'status',
  'branch_id',
  'latitude',
  'longitude',
] as const

/**
 * Colunas enviadas na edição: as mesmas menos `church_id`, `slug` e `status`.
 * Status é transição (`setEventStatus`), para a porta de publicação existir num
 * lugar só — o formulário não consegue publicar por tabela.
 */
export const EVENT_PATCH_COLUMNS = [
  'category_id',
  'name',
  'description',
  'starts_at',
  'ends_at',
  'address',
  'city',
  'cover_url',
  'capacity',
  'visibility',
  'branch_id',
  'latitude',
  'longitude',
] as const

interface NormalizedDraft {
  name: string
  category_id: string
  description: string | null
  starts_at: string
  ends_at: string | null
  address: string | null
  city: string | null
  cover_url: string | null
  capacity: number | null
  visibility: EventVisibility
  branch_id: string | null
  latitude: number | null
  longitude: number | null
}

export function validateEventDraft(draft: EventDraft): string | null {
  if (draft.name.trim().length < 3) return 'Informe o nome do evento (pelo menos 3 caracteres).'
  if (!draft.category_id) return 'Escolha a categoria do evento.'
  if (!slugify(draft.name)) return 'O nome precisa ter letras ou números para gerar o endereço do evento.'
  const starts = Date.parse(draft.starts_at)
  if (Number.isNaN(starts)) return 'Informe a data e a hora de início.'
  if (draft.ends_at) {
    const ends = Date.parse(draft.ends_at)
    if (Number.isNaN(ends)) return 'Data final inválida.'
    if (ends <= starts) return 'A data final precisa ser depois do início.'
  }
  if (draft.capacity !== null && draft.capacity !== undefined) {
    if (!Number.isInteger(draft.capacity) || draft.capacity <= 0) {
      return 'A capacidade precisa ser um número inteiro maior que zero — deixe em branco para não ter limite.'
    }
  }
  if (draft.cover_url && !/^https?:\/\//i.test(draft.cover_url)) {
    return 'A imagem de capa precisa ser uma URL http(s).'
  }
  const coords = validateLatLng(draft.latitude ?? null, draft.longitude ?? null)
  if (coords) return coords
  return null
}

/** Vazio vira null: é o que a coluna guarda e o que a tela mostra como "—". */
function cleanText(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function normalizeDraft(draft: EventDraft): NormalizedDraft {
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

function pickKeys(row: object, columns: readonly string[]): Record<string, unknown> {
  const source = row as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = source[column]
  return out
}

export async function createEvent(
  draft: EventDraft,
  actor: EventActor,
  status: EventCreationStatus,
): Promise<EventWriteResult> {
  const denied = gateWrite(actor) ?? (status === 'published' ? gatePublish(actor) : null)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: EVENT_NO_CHURCH }
  const invalid = validateEventDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const clean = normalizeDraft(draft)
  const slug = slugify(clean.name)

  const { data, error } = await supabase
    .from('events')
    .insert(pickKeys({ ...clean, church_id: churchId, slug, status }, EVENT_INSERT_COLUMNS))
    .select(EVENTS_MANAGED_SELECT.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeEventDbError(error, slug) }
  if (!data) return { ok: false, error: EVENT_NOT_FOUND }
  return { ok: true, event: toManagedEvent(data as unknown as ManagedRow) }
}

export async function updateEvent(id: string, draft: EventDraft, actor: EventActor): Promise<EventWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateEventDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const clean = normalizeDraft(draft)
  const patch = pickKeys(clean, EVENT_PATCH_COLUMNS)

  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', id)
    .select(EVENTS_MANAGED_SELECT.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeEventDbError(error) }
  if (!data) return { ok: false, error: EVENT_NOT_FOUND }
  return { ok: true, event: toManagedEvent(data as unknown as ManagedRow) }
}

/**
 * Transição de status. Publicar é a única que exige `events.publish`; cancelar e
 * voltar a rascunho são gestão comum. Quem confere no banco é o trigger — a porta
 * daqui só adianta a mensagem legível.
 */
export async function setEventStatus(id: string, status: EventStatus, actor: EventActor): Promise<EventWriteResult> {
  const denied = gateWrite(actor) ?? (status === 'published' ? gatePublish(actor) : null)
  if (denied) return { ok: false, error: denied }

  const { data, error } = await supabase
    .from('events')
    .update({ status })
    .eq('id', id)
    .select(EVENTS_MANAGED_SELECT.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeEventDbError(error) }
  if (!data) return { ok: false, error: EVENT_NOT_FOUND }
  return { ok: true, event: toManagedEvent(data as unknown as ManagedRow) }
}

function gateWrite(actor: EventActor): string | null {
  return can(actor.role, 'events.manage') ? null : EVENT_MANAGE_DENIED
}

function gatePublish(actor: EventActor): string | null {
  return can(actor.role, 'events.publish') ? null : EVENT_PUBLISH_DENIED
}

function describeEventDbError(error: { code?: string; message: string }, slug?: string): string {
  switch (error.code) {
    case '42501':
      // O trigger `enforce_event_branch` e o de publicação estouram os dois 42501;
      // a mensagem é o que separa "filial de outra igreja" de "sem events.publish".
      if (error.message.includes('filial')) return EVENT_BRANCH_MISMATCH
      return error.message.includes('events.publish') ? EVENT_PUBLISH_DENIED : EVENT_MANAGE_DENIED
    case '23505':
      return slug ? eventSlugTaken(slug) : 'Já existe um evento com estes dados.'
    case '23503':
      return 'Categoria, igreja ou filial não encontrada. Atualize a lista e tente de novo.'
    case '23514':
      return 'Valor fora do permitido: revise capacidade, datas, coordenadas e visibilidade.'
    default:
      return error.message
  }
}
