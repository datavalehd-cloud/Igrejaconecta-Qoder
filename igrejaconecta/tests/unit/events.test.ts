import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { categories, churches, events, registrations } from '@/data/mock'
import { DIRECTORY_COLUMNS } from '@/services/data/churchService'
import {
  EVENT_BRANCH_MISMATCH,
  EVENT_CATEGORY_COLUMNS,
  EVENT_INSERT_COLUMNS,
  EVENT_MANAGE_DENIED,
  EVENT_NO_CHURCH,
  EVENT_NOT_FOUND,
  EVENT_ORGANIZER_EMBED,
  EVENT_PATCH_COLUMNS,
  EVENT_PUBLISH_DENIED,
  EVENTS_MANAGED_COLUMNS,
  EVENTS_MANAGED_SELECT,
  EVENTS_PUBLIC_COLUMNS,
  EVENTS_PUBLIC_SELECT,
  createEvent,
  eventSlugTaken,
  fetchChurchEvents,
  fetchEventCategories,
  fetchPublicEventBySlug,
  fetchPublicEvents,
  setEventStatus,
  updateEvent,
  validateEventDraft,
  type EventDraft,
} from '@/services/data/eventService'
import {
  demoChurchEvents,
  demoCreateEvent,
  demoEventCategories,
  demoPublicEvents,
  demoPublicEventBySlug,
  demoSetEventStatus,
  demoUpdateEvent,
} from '../fixtures/eventMirror'
import type { ChurchEvent } from '@/types'

/**
 * As leituras de eventos têm duas metades: a RLS da migração 0011 (grupo M da
 * suíte SQL) e o código que monta a consulta. Estes testes conferem a segunda.
 *
 * Três coisas são amarradas aqui, para quebrarem no desenvolvimento e não no ar:
 *   * a projeção — é ela que limita as colunas que chegam ao navegador, já que a
 *     RLS é por linha (o caso M8 grava o avesso disso);
 *   * os espelhos demo, que têm de reproduzir a mesma audiência: publicado +
 *     público de igreja aprovada e ativa, rascunho só para quem é da igreja;
 *   * o que ainda não existe — `registrations_count` e `branch_id` estão no tipo
 *     e em nenhuma tabela, então não podem aparecer em projeção nem em linha.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), insert: vi.fn(), update: vi.fn(), maybeSingle: vi.fn() }
const from = vi.fn()
const originalEvents = structuredClone(events)
const originalChurches = structuredClone(churches)
const originalCategories = structuredClone(categories)

const publicSelect = EVENTS_PUBLIC_SELECT.join(',')
const managedSelect = EVENTS_MANAGED_SELECT.join(',')
const organizerColumns = EVENT_ORGANIZER_EMBED.match(/^churches\(([^)]+)\)$/)?.[1]!.split(',').map((c) => c.trim()).sort()

/** Rascunho válido, com espaços de propósito: aparar é parte do contrato. */
function validDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    name: '  Vigília de Avivamento  ',
    category_id: 'c8',
    description: ' Noite de intercessão ',
    starts_at: '2026-12-05T22:00:00.000Z',
    ends_at: null,
    address: ' Rua das Palmeiras, 120 ',
    city: 'São José dos Campos',
    cover_url: null,
    capacity: null,
    visibility: 'public',
    ...overrides,
  }
}

/** Linha como o PostgREST devolve numa escrita com `return=representation`. */
function managedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-real', church_id: 'ch-real', category_id: 'c8', slug: 'vigilia-de-avivamento',
    name: 'Vigília de Avivamento', description: null, starts_at: '2026-12-05T22:00:00Z', ends_at: null,
    address: null, city: null, cover_url: null, capacity: null, is_free: true, visibility: 'public',
    status: 'draft', event_categories: { name: 'Vigílias' },
    ...overrides,
  }
}

beforeEach(() => {
  // O app não tem mais caminho sem Supabase: o cliente simulado está montado para
  // todos os casos, e o que exercita a loja em memória chama o fixture direto.
  backend.supabase = { from }
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.order.mockResolvedValue({ data: [], error: null })
  chain.maybeSingle.mockResolvedValue({ data: null, error: null })
  from.mockReturnValue(chain)
})

afterEach(() => {
  vi.restoreAllMocks()
  events.splice(0, events.length, ...structuredClone(originalEvents))
  churches.splice(0, churches.length, ...structuredClone(originalChurches))
  categories.splice(0, categories.length, ...structuredClone(originalCategories))
  backend.supabase = null
})

/** Colunas de tabela de uma linha devolvida, sem os campos derivados pelo serviço. */
function tableColumns(row: object, derived: readonly string[]) {
  return Object.keys(row).filter((key) => !derived.includes(key)).sort()
}

function tableBlock(migration: string, table: string) {
  const sql = readFileSync(path.resolve(import.meta.dirname, `../../supabase/migrations/${migration}`), 'utf8')
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada em ${migration}`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

function hasColumn(block: string, column: string) {
  return new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(block)
}

/**
 * Colunas de localização que a migração 0013 acrescenta a `events` por ALTER —
 * não estão no `create table` de 0011, então a existência delas é conferida lá.
 */
const EVENT_LOCATION_COLUMNS = ['branch_id', 'latitude', 'longitude']

function migrationText(name: string) {
  return readFileSync(path.resolve(import.meta.dirname, `../../supabase/migrations/${name}`), 'utf8')
}

function addsColumn(migration: string, column: string) {
  return new RegExp(`add column if not exists ${column}\\s`, 'm').test(migrationText(migration))
}

/** Bloco de um caso do grupo M, entre o savepoint e o rollback dele. */
function caseBlock(name: string) {
  const suite = readFileSync(path.resolve(import.meta.dirname, '../../supabase/tests/database/rls_isolation.sql'), 'utf8')
  const group = suite.indexOf('-- GRUPO M')
  if (group < 0) throw new Error('Grupo M ausente da suíte SQL')
  const start = suite.indexOf(`savepoint ${name};`, group)
  const end = suite.indexOf(`rollback to savepoint ${name};`, group)
  if (start < 0 || end < 0) throw new Error(`Bloco ${name} ausente do grupo M`)
  return suite.slice(start, end)
}

/** Todas as projeções explícitas de `public.events` de um caso, já ordenadas. */
function projectionsOf(block: string) {
  const found = [...block.matchAll(/select (id,[\s\S]*?)\r?\n\s*from public\.events/g)]
  if (found.length === 0) throw new Error('nenhuma projeção explícita de events no bloco')
  return found.map((match) => match[1].split(',').map((column) => column.trim()).sort())
}

/**
 * Código do serviço sem comentários — o doc comment cita `registrations_count`
 * justamente para explicar que ele fica de fora.
 */
function serviceCode() {
  return readFileSync(path.resolve(import.meta.dirname, '../../src/services/data/eventService.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('projeção — o que chega ao navegador', () => {
  it('a agenda da igreja é o diretório público mais a visibilidade e a localização', () => {
    expect([...EVENTS_MANAGED_COLUMNS].sort())
      .toEqual([...EVENTS_PUBLIC_COLUMNS, 'visibility', 'branch_id', 'latitude', 'longitude'].sort())
  })

  it('o público não recebe visibilidade, carimbos nem campos sem tabela', () => {
    for (const forbidden of ['visibility', 'created_at', 'updated_at', 'registrations_count', 'branch_id']) {
      expect(EVENTS_PUBLIC_COLUMNS, `coluna ${forbidden} não deveria ir para o visitante`).not.toContain(forbidden)
    }
    expect(publicSelect).not.toContain('registrations_count')
    expect(publicSelect).not.toContain('branch_id')
    expect(managedSelect).not.toContain('registrations_count')
  })

  it('a linha pública do demo tem exatamente as colunas da projeção', () => {
    const [row] = demoPublicEvents()
    expect(tableColumns(row!, ['category', 'church', 'church_name'])).toEqual([...EVENTS_PUBLIC_COLUMNS].sort())
    expect(row).not.toHaveProperty('visibility')
    expect(row).not.toHaveProperty('registrations_count')
  })

  it('a linha de gestão do demo tem exatamente as colunas da projeção', () => {
    const [row] = demoChurchEvents('ch1')
    expect(tableColumns(row!, ['category', 'church_name'])).toEqual([...EVENTS_MANAGED_COLUMNS].sort())
    expect(row).toHaveProperty('visibility')
    expect(row).not.toHaveProperty('registrations_count')
  })

  it('a organizadora embedada não pede nada que o diretório de igrejas já não dê', () => {
    expect(organizerColumns.length).toBeGreaterThan(0)
    for (const column of organizerColumns) {
      expect(DIRECTORY_COLUMNS, `churches.${column} fora do diretório público`).toContain(column)
    }
    expect(EVENTS_PUBLIC_SELECT).toEqual([...EVENTS_PUBLIC_COLUMNS, 'event_categories(name)', EVENT_ORGANIZER_EMBED])
    expect(EVENTS_MANAGED_SELECT).toEqual([...EVENTS_MANAGED_COLUMNS, 'event_categories(name)'])
  })

  it('toda coluna projetada existe na tabela (0011) ou no ALTER de localização (0013)', () => {
    const eventsDdl = tableBlock('0011_events.sql', 'events')
    const categoriesDdl = tableBlock('0011_events.sql', 'event_categories')
    for (const column of EVENTS_MANAGED_COLUMNS) {
      const exists = EVENT_LOCATION_COLUMNS.includes(column)
        ? addsColumn('0013_branches_location.sql', column)
        : hasColumn(eventsDdl, column)
      expect(exists, `events.${column}`).toBe(true)
    }
    for (const column of EVENT_CATEGORY_COLUMNS) {
      expect(hasColumn(categoriesDdl, column), `event_categories.${column}`).toBe(true)
    }
    expect(hasColumn(eventsDdl, 'registrations_count')).toBe(false)
    // branch_id não está no create de 0011: quem o acrescenta é o ALTER de 0013.
    expect(hasColumn(eventsDdl, 'branch_id')).toBe(false)
  })
})

describe('diretório público — espelho dos casos M1 e M4', () => {
  it('só tem evento publicado e público de igreja aprovada e ativa', () => {
    const rows = demoPublicEvents()
    expect(rows.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(rows.every((e) => e.status === 'published')).toBe(true)
  })

  it('esconde o agendado (e3) e o rascunho (e4)', () => {
    const ids = demoPublicEvents().map((e) => e.id)
    expect(ids).not.toContain('e3')
    expect(ids).not.toContain('e4')
    expect(demoPublicEventBySlug('encontro-de-mulheres')).toBeNull()
    expect(demoPublicEventBySlug('acao-social-natal')).toBeNull()
  })

  it.each(['private', 'unlisted'] as const)('o ramo visibility=%s tem dentes: publicado não basta', (visibility) => {
    events.push({ ...originalEvents[0]!, id: 'e-oculto', slug: 'evento-oculto', visibility, starts_at: '2026-11-16T20:00:00' })
    expect(demoPublicEvents().map((e) => e.id)).not.toContain('e-oculto')
    expect(demoPublicEventBySlug('evento-oculto')).toBeNull()
    // A agenda da igreja continua vendo: visibilidade é intenção, não permissão.
    expect(demoChurchEvents('ch1').map((e) => e.id)).toContain('e-oculto')
  })

  it('suspender a igreja tira os eventos dela do ar, sem tocar neles', () => {
    churches.find((c) => c.id === 'ch1')!.approval_status = 'suspended'
    expect(demoPublicEvents().map((e) => e.id)).toEqual([])
    expect(demoPublicEventBySlug('vigilia-de-oracao')).toBeNull()
    expect(demoChurchEvents('ch1').map((e) => e.id)).toEqual(['e2', 'e1', 'e4'])
  })

  it('igreja aprovada com conta inativa também sai do ar (o ramo status=active tem dentes)', () => {
    // Nenhum fixture é aprovado E inativo, então a linha entra aqui só para o
    // filtro poder errar — mesma técnica do caso M4b na suíte SQL.
    churches.find((c) => c.id === 'ch1')!.status = 'inactive'
    expect(demoPublicEvents().map((e) => e.id)).toEqual([])
    expect(demoChurchEvents('ch1')).toHaveLength(3)
  })

  it('resolve categoria e organizadora pelos IDs, não pelo texto gravado no mock', () => {
    const event = events.find((e) => e.id === 'e1')!
    event.category = 'Nome errado de propósito'
    event.church_name = 'Igreja errada de propósito'
    const [row] = demoPublicEvents().filter((e) => e.id === 'e1')
    expect(row).toMatchObject({ category: 'Congressos', church_name: 'Igreja Batista Central' })
    expect(Object.keys(row!.church!).sort()).toEqual(organizerColumns)
    expect(row!.church).toMatchObject({ id: 'ch1', slug: churches.find((c) => c.id === 'ch1')!.slug })
  })

  it('slug inexistente é null, não o primeiro evento', () => {
    expect(demoPublicEventBySlug('nao-existe')).toBeNull()
  })
})

describe('agenda da igreja — espelho dos casos M3 e M5', () => {
  it('traz os próprios eventos em qualquer status, em ordem de início', () => {
    expect(demoChurchEvents('ch1').map((e) => e.id)).toEqual(['e2', 'e1', 'e4'])
  })

  it('não traz nada da igreja vizinha, nem o que está no ar', () => {
    expect(demoChurchEvents('ch2').map((e) => e.id)).toEqual(['e3'])
    expect(demoChurchEvents('ch-inexistente')).toEqual([])
  })
})

describe('catálogo de categorias — espelho do caso M2', () => {
  it('é o mesmo do banco, em ordem de nome', () => {
    const migration = readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/0011_events.sql'), 'utf8')
    const seed = migration.slice(migration.indexOf('insert into public.event_categories'), migration.indexOf('on conflict (slug) do nothing;'))
    const seeded = [...seed.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map((m) => ({ name: m[1]!, slug: m[2]! }))
    expect(seeded).toHaveLength(categories.length)
    expect(demoEventCategories().map((c) => [c.name, c.slug])).toEqual(
      seeded.sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.name, c.slug]),
    )
  })

  it('não devolve a lista do mock por referência', () => {
    const rows = demoEventCategories()
    expect(rows).not.toBe(categories)
    rows.pop()
    expect(categories).toHaveLength(originalCategories.length)
  })
})

describe('contrato Supabase (cliente simulado)', () => {

  it('o diretório pede a projeção pública, os dois filtros e a ordem de início', async () => {
    await fetchPublicEvents()
    expect(from).toHaveBeenCalledExactlyOnceWith('events')
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(publicSelect)
    expect(chain.eq.mock.calls).toEqual([['status', 'published'], ['visibility', 'public']])
    expect(chain.order).toHaveBeenCalledExactlyOnceWith('starts_at')
    expect(chain.maybeSingle).not.toHaveBeenCalled()
  })

  it('o slug pede maybeSingle, sem filtros de status nem ordem', async () => {
    await fetchPublicEventBySlug('congresso-de-jovens-2026')
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(publicSelect)
    expect(chain.eq).toHaveBeenCalledExactlyOnceWith('slug', 'congresso-de-jovens-2026')
    expect(chain.maybeSingle).toHaveBeenCalledExactlyOnceWith()
    expect(chain.order).not.toHaveBeenCalled()
  })

  it('a agenda pede a projeção de gestão recortada pela igreja da sessão', async () => {
    await fetchChurchEvents('ch-real')
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(managedSelect)
    expect(chain.eq).toHaveBeenCalledExactlyOnceWith('church_id', 'ch-real')
    expect(chain.order).toHaveBeenCalledExactlyOnceWith('starts_at')
  })

  it('sem igreja na sessão não há o que listar, e nenhuma consulta sai', async () => {
    expect(await fetchChurchEvents()).toEqual([])
    expect(await fetchChurchEvents(undefined)).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('as categorias pedem a projeção do catálogo em ordem de nome', async () => {
    await fetchEventCategories()
    expect(from).toHaveBeenCalledExactlyOnceWith('event_categories')
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(EVENT_CATEGORY_COLUMNS.join(','))
    expect(chain.order).toHaveBeenCalledExactlyOnceWith('name')
  })

  it('monta categoria e organizadora a partir dos embeds confirmados pelo banco', async () => {
    const row = {
      id: 'ev-1', church_id: 'ch-1', category_id: 'cat-1', slug: 'evento-real', name: 'Evento real',
      description: null, starts_at: '2026-11-20T19:30:00Z', ends_at: null, address: null, city: 'Cidade real',
      cover_url: null, capacity: 500, is_free: false, status: 'published',
      event_categories: { name: 'Categoria confirmada' },
      churches: { id: 'ch-1', name: 'Igreja confirmada', slug: 'igreja-confirmada', denomination: null, city: 'Cidade real', state: 'SP', whatsapp: null },
    }
    chain.order.mockResolvedValue({ data: [row], error: null })
    const [event] = await fetchPublicEvents()
    const { event_categories: _categoria, churches: _igreja, ...colunas } = row
    expect(event).toEqual({ ...colunas, category: row.event_categories?.name, church_name: row.churches?.name, church: row.churches })
    expect(event).not.toHaveProperty('visibility')
  })

  it('embed ausente vira campo vazio, nunca o mock', async () => {
    chain.order.mockResolvedValue({
      data: [{ id: 'ev-2', church_id: 'ch-2', category_id: null, slug: 'sem-embed', name: 'Sem embed', starts_at: '2026-12-01T10:00:00Z', is_free: true, status: 'published', event_categories: null, churches: null }],
      error: null,
    })
    const [event] = await fetchPublicEvents()
    expect(event).toMatchObject({ id: 'ev-2', category: undefined, church_name: undefined, church: null })
    expect(event).not.toHaveProperty('registrations_count')
    expect(await fetchPublicEvents()).toHaveLength(1)
  })

  it('lista vazia do banco permanece vazia', async () => {
    expect(await fetchPublicEvents()).toEqual([])
    expect(await fetchChurchEvents('ch-real')).toEqual([])
    expect(await fetchEventCategories()).toEqual([])
    expect(await fetchPublicEventBySlug('qualquer')).toBeNull()
  })

  it.each([
    ['diretório', () => fetchPublicEvents()],
    ['slug', () => fetchPublicEventBySlug('x')],
    ['agenda', () => fetchChurchEvents('ch-real')],
    ['categorias', () => fetchEventCategories()],
  ])('erro na leitura de %s não recorre à lista fictícia', async (_label, call) => {
    chain.order.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    chain.maybeSingle.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    await expect(call()).rejects.toThrow('leitura recusada')
  })
})

describe('eventos — contrato com o grupo M e a migração 0011', () => {
  it('M1 escreve por extenso as mesmas colunas do diretório público', () => {
    const projections = projectionsOf(caseBlock('m1'))
    expect(projections.length).toBeGreaterThanOrEqual(2)
    for (const columns of projections) {
      expect(columns).toEqual([...EVENTS_PUBLIC_COLUMNS].sort())
    }
  })

  it('M3 escreve por extenso as mesmas colunas da agenda de gestão', () => {
    for (const columns of projectionsOf(caseBlock('m3'))) {
      expect(columns).toEqual([...EVENTS_MANAGED_COLUMNS].sort())
    }
  })

  it('M9 junta as duas tabelas que o serviço embeda e cobra nome e slug', () => {
    const m9 = caseBlock('m9')
    expect(m9).toContain('left join public.event_categories c on c.id = e.category_id')
    expect(m9).toContain('left join public.churches ch on ch.id = e.church_id')
    expect(m9).toContain('(c.name is null or ch.name is null or ch.slug is null)')
    for (const column of ['name', 'slug']) {
      expect(organizerColumns).toContain(column)
    }
  })

  it('M2 cobra o catálogo inteiro e recusa escrita do visitante', () => {
    const m2 = caseBlock('m2')
    expect(m2).toContain("app.category_count")
    expect(m2).toMatch(/insert into public\.event_categories/)
    expect(m2).toMatch(/when insufficient_privilege/)
    expect(m2).toMatch(/get diagnostics n = row_count/)
  })

  it('a porta de publicação exige events.publish, é INVOKER e tem search_path fixo', () => {
    const migration = readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/0011_events.sql'), 'utf8')
    const definition = migration.match(/create\s+or\s+replace\s+function\s+public\.enforce_event_publish\s*\(\s*\)([\s\S]*?)\bas\s+(\$[\w]*\$)([\s\S]*?)\2\s*;/i)
    if (!definition) throw new Error('Função public.enforce_event_publish ausente da migração 0011')
    expect(definition[1].toLowerCase()).toContain('set search_path = public')
    expect(definition[1].toLowerCase()).not.toContain('security definer')
    expect(definition[3]).toContain("current_user = 'service_role'")
    expect(definition[3]).toContain("'events.publish'")
    expect(definition[3]).toMatch(/errcode = '42501'/)
    expect(migration).toMatch(/create trigger trg_events_publish\s+before insert or update of status on public\.events/i)
  })

  it('E4 continua vigiando a função e o trigger antes das fixtures', () => {
    const suite = readFileSync(path.resolve(import.meta.dirname, '../../supabase/tests/database/rls_isolation.sql'), 'utf8')
    const e4 = suite.slice(suite.indexOf('savepoint e4;'), suite.indexOf('rollback to savepoint e4;'))
    expect(e4).toContain("p.proname = 'enforce_event_publish'")
    expect(e4).toContain('p.prosecdef')
    expect(e4).toContain('search_path=')
    expect(e4).toContain("tgname = 'trg_events_publish'")
    expect(suite.indexOf('savepoint e4;')).toBeLessThan(suite.indexOf('savepoint m1;'))
  })

  it('o passo 3 escreve em events, e continua sem apagar nem mexer no catálogo', () => {
    const source = serviceCode()
    for (const method of ['.insert(', '.update(']) {
      expect(source, `escrita ${method} do passo 3`).toContain(method)
    }
    // Apagar evento levaria as inscrições junto: `event_registrations.event_id` é
    // `on delete cascade` (0012). A tela cancela, não apaga.
    expect(source).not.toContain('.delete(')
    expect(source).not.toContain('.upsert(')
    expect(source).not.toContain('.rpc(')
    const migration = readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/0012_event_registrations.sql'), 'utf8')
    expect(migration).toMatch(/event_id\s+uuid not null references public\.events \(id\) on delete cascade/)
    // O catálogo é do SuperAdmin (M2): o serviço só o lê.
    expect(source.match(/from\('event_categories'\)/g)).toHaveLength(1)
  })

  it('nenhuma leitura devolve contagem de inscritos sem fonte confirmada', () => {
    expect(serviceCode()).not.toContain('registrations_count')
    const rows: ChurchEvent[] = [...demoPublicEvents(), ...demoChurchEvents('ch1'), ...demoChurchEvents('ch2')]
    for (const row of rows) expect(row).not.toHaveProperty('registrations_count')
  })
})

describe('escritas — portas de permissão (espelho de M6 e M7)', () => {
  it('papel sem events.manage não escreve, e nenhuma consulta sai', async () => {
    for (const role of ['visitor', undefined] as const) {
      const actor = { churchId: 'ch1', role }
      expect(await createEvent(validDraft(), actor, 'draft')).toEqual({ ok: false, error: EVENT_MANAGE_DENIED })
      expect(await updateEvent('e1', validDraft(), actor)).toEqual({ ok: false, error: EVENT_MANAGE_DENIED })
      expect(await setEventStatus('e1', 'cancelled', actor)).toEqual({ ok: false, error: EVENT_MANAGE_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('os cinco papéis com events.manage chegam ao banco', async () => {
    for (const role of ['superadmin', 'church_admin', 'manager', 'pastor', 'communicator'] as const) {
      await createEvent(validDraft(), { churchId: 'ch-real', role }, 'draft')
    }
    expect(from).toHaveBeenCalledTimes(5)
    expect(chain.insert).toHaveBeenCalledTimes(5)
  })

  it('publicar sem events.publish é recusado antes de qualquer consulta (M6)', async () => {
    expect(await createEvent(validDraft(), { churchId: 'ch1', role: 'communicator' }, 'published'))
      .toEqual({ ok: false, error: EVENT_PUBLISH_DENIED })
    expect(await setEventStatus('e1', 'published', { churchId: 'ch1', role: 'communicator' }))
      .toEqual({ ok: false, error: EVENT_PUBLISH_DENIED })
    expect(from).not.toHaveBeenCalled()
  })

  it('o mesmo comunicador cria, edita e cancela: a porta é só a publicação', async () => {
    chain.maybeSingle.mockResolvedValue({ data: managedRow(), error: null })
    const actor = { churchId: 'ch-real', role: 'communicator' as const }
    expect((await createEvent(validDraft(), actor, 'draft')).ok).toBe(true)
    expect((await updateEvent('ev-real', validDraft(), actor)).ok).toBe(true)
    expect((await setEventStatus('ev-real', 'cancelled', actor)).ok).toBe(true)
    expect(chain.insert.mock.calls[0]![0]).toMatchObject({ status: 'draft' })
  })

  it('sem igreja na sessão ninguém cria — nem o SuperAdmin, que não tem igreja ativa', async () => {
    expect(await createEvent(validDraft(), { role: 'superadmin' }, 'draft')).toEqual({ ok: false, error: EVENT_NO_CHURCH })
    expect(await createEvent(validDraft(), {}, 'draft')).toEqual({ ok: false, error: EVENT_MANAGE_DENIED })
    expect(from).not.toHaveBeenCalled()
  })

  it('a porta vem antes da validação: papel errado recebe a mensagem de permissão', async () => {
    expect(await createEvent(validDraft({ name: '' }), { churchId: 'ch1', role: 'visitor' }, 'draft'))
      .toEqual({ ok: false, error: EVENT_MANAGE_DENIED })
    expect(await createEvent(validDraft({ name: '' }), { churchId: 'ch1', role: 'communicator' }, 'published'))
      .toEqual({ ok: false, error: EVENT_PUBLISH_DENIED })
  })
})

describe('escritas — contrato Supabase (cliente simulado)', () => {
  it('a criação envia só colunas reais, com a igreja da sessão e o slug vindo do nome', async () => {
    chain.maybeSingle.mockResolvedValue({ data: managedRow(), error: null })
    const result = await createEvent(validDraft(), { churchId: 'ch-real', role: 'church_admin' }, 'draft')
    expect(from).toHaveBeenCalledExactlyOnceWith('events')
    const row = chain.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(row).sort()).toEqual([...EVENT_INSERT_COLUMNS].sort())
    expect(row).toMatchObject({
      church_id: 'ch-real',
      slug: 'vigilia-de-avivamento',
      status: 'draft',
      name: 'Vigília de Avivamento',
      description: 'Noite de intercessão',
      address: 'Rua das Palmeiras, 120',
      ends_at: null,
      capacity: null,
    })
    for (const absent of ['is_free', 'id', 'created_at', 'updated_at', 'category', 'church_name']) {
      expect(row, `coluna ${absent} não é do formulário`).not.toHaveProperty(absent)
    }
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(managedSelect)
    expect(chain.maybeSingle).toHaveBeenCalledExactlyOnceWith()
    expect(chain.update).not.toHaveBeenCalled()
    const { event_categories: _categoria, ...colunas } = managedRow()
    expect(result).toEqual({ ok: true, event: { ...colunas, category: 'Vigílias' } })
  })

  it('a edição não envia church_id, slug nem status: status é transição à parte', async () => {
    chain.maybeSingle.mockResolvedValue({ data: managedRow(), error: null })
    await updateEvent('ev-real', validDraft(), { churchId: 'ch-real', role: 'manager' })
    const patch = chain.update.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(patch).sort()).toEqual([...EVENT_PATCH_COLUMNS].sort())
    expect(chain.eq).toHaveBeenCalledExactlyOnceWith('id', 'ev-real')
    expect(chain.insert).not.toHaveBeenCalled()
    expect(EVENT_PATCH_COLUMNS).toEqual(EVENT_INSERT_COLUMNS.filter((c) => !['church_id', 'slug', 'status'].includes(c)))
  })

  it('a transição de status envia só o status, pela projeção de gestão', async () => {
    chain.maybeSingle.mockResolvedValue({ data: managedRow({ status: 'published' }), error: null })
    await setEventStatus('ev-real', 'published', { churchId: 'ch-real', role: 'manager' })
    expect(chain.update).toHaveBeenCalledExactlyOnceWith({ status: 'published' })
    expect(chain.eq).toHaveBeenCalledExactlyOnceWith('id', 'ev-real')
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(managedSelect)
  })

  it('toda coluna escrita existe na tabela (0011) ou no ALTER de localização (0013)', () => {
    const ddl = tableBlock('0011_events.sql', 'events')
    for (const column of [...EVENT_INSERT_COLUMNS, ...EVENT_PATCH_COLUMNS]) {
      const exists = EVENT_LOCATION_COLUMNS.includes(column)
        ? addsColumn('0013_branches_location.sql', column)
        : hasColumn(ddl, column)
      expect(exists, `events.${column}`).toBe(true)
    }
  })

  it('linha que não volta é a mesma mensagem de sem permissão: sem oráculo de existência', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await updateEvent('evento-da-vizinha', validDraft(), { churchId: 'ch-real', role: 'manager' }))
      .toEqual({ ok: false, error: EVENT_NOT_FOUND })
    expect(await setEventStatus('evento-da-vizinha', 'published', { churchId: 'ch-real', role: 'manager' }))
      .toEqual({ ok: false, error: EVENT_NOT_FOUND })
    expect(await createEvent(validDraft(), { churchId: 'ch-real', role: 'manager' }, 'draft'))
      .toEqual({ ok: false, error: EVENT_NOT_FOUND })
  })

  it.each([
    ['trigger de publicação', '42501', 'publicar evento exige a permissão events.publish', EVENT_PUBLISH_DENIED],
    ['política de gestão', '42501', 'new row violates row-level security policy for table "events"', EVENT_MANAGE_DENIED],
    ['trigger de filial', '42501', 'a filial do evento precisa ser da mesma igreja', EVENT_BRANCH_MISMATCH],
    ['slug duplicado', '23505', 'duplicate key value violates unique constraint "events_slug_key"', eventSlugTaken('vigilia-de-avivamento')],
    ['categoria inexistente', '23503', 'violates foreign key constraint "events_category_id_fkey"', 'Categoria, igreja ou filial não encontrada. Atualize a lista e tente de novo.'],
    ['capacidade fora do check', '23514', 'violates check constraint "events_capacity_check"', 'Valor fora do permitido: revise capacidade, datas, coordenadas e visibilidade.'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { code, message } })
    expect(await createEvent(validDraft(), { churchId: 'ch-real', role: 'manager' }, 'draft'))
      .toEqual({ ok: false, error: esperado })
  })

  it('na edição o 23505 não inventa slug: a mensagem é genérica', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })
    expect(await updateEvent('ev-real', validDraft(), { churchId: 'ch-real', role: 'manager' }))
      .toEqual({ ok: false, error: 'Já existe um evento com estes dados.' })
  })
})

describe('validação — o que não chega ao banco', () => {
  it('rascunho completo passa', () => {
    expect(validateEventDraft(validDraft())).toBeNull()
  })

  it.each([
    ['nome curto', validDraft({ name: 'V' }), 'Informe o nome do evento (pelo menos 3 caracteres).'],
    ['nome que não gera endereço', validDraft({ name: '!!!' }), 'O nome precisa ter letras ou números para gerar o endereço do evento.'],
    ['sem categoria', validDraft({ category_id: '' }), 'Escolha a categoria do evento.'],
    ['sem data de início', validDraft({ starts_at: '' }), 'Informe a data e a hora de início.'],
    ['fim antes do início', validDraft({ ends_at: '2026-12-01T10:00:00.000Z' }), 'A data final precisa ser depois do início.'],
    ['fim igual ao início', validDraft({ ends_at: '2026-12-05T22:00:00.000Z' }), 'A data final precisa ser depois do início.'],
    ['capacidade zero', validDraft({ capacity: 0 }), 'A capacidade precisa ser um número inteiro maior que zero — deixe em branco para não ter limite.'],
    ['capacidade quebrada', validDraft({ capacity: 12.5 }), 'A capacidade precisa ser um número inteiro maior que zero — deixe em branco para não ter limite.'],
    ['capa fora de http(s)', validDraft({ cover_url: 'javascript:alert(1)' }), 'A imagem de capa precisa ser uma URL http(s).'],
    ['latitude fora do intervalo', validDraft({ latitude: 91, longitude: -45.9 }), 'A latitude precisa ser um número entre -90 e 90.'],
    ['longitude fora do intervalo', validDraft({ latitude: -23.2, longitude: 181 }), 'A longitude precisa ser um número entre -180 e 180.'],
    ['só um lado da coordenada', validDraft({ latitude: -23.2, longitude: null }), 'Informe latitude e longitude juntas, ou deixe as duas em branco.'],
  ])('%s é recusado', (_rotulo, draft, mensagem) => {
    expect(validateEventDraft(draft)).toBe(mensagem)
  })

  it('coordenada válida e filial da própria igreja passam', () => {
    expect(validateEventDraft(validDraft({ latitude: -23.1857, longitude: -45.8871 }))).toBeNull()
    expect(validateEventDraft(validDraft({ latitude: null, longitude: null }))).toBeNull()
  })

  it('a validação vale para criar e para editar, e nada é gravado quando falha', () => {
    const ruim = validDraft({ ends_at: '2026-12-01T10:00:00.000Z' })
    expect(demoCreateEvent(ruim, { churchId: 'ch1', role: 'manager' }, 'draft').ok).toBe(false)
    expect(demoUpdateEvent('e1', ruim, { churchId: 'ch1', role: 'manager' }).ok).toBe(false)
    expect(events).toEqual(originalEvents)
  })
})

describe('escritas — loja do fixture (as mesmas recusas do banco)', () => {
  it('criar rascunho entra na agenda da igreja e não no diretório público', () => {
    const result = demoCreateEvent(validDraft(), { churchId: 'ch1', role: 'manager' }, 'draft')
    expect(result.ok).toBe(true)
    expect(demoChurchEvents('ch1').map((e) => e.id)).toContain(result.event!.id)
    expect(demoPublicEvents().map((e) => e.id)).not.toContain(result.event!.id)
    expect(result.event).toMatchObject({
      church_id: 'ch1',
      slug: 'vigilia-de-avivamento',
      status: 'draft',
      category: 'Vigílias',
      church_name: 'Igreja Batista Central',
      is_free: true,
      name: 'Vigília de Avivamento',
      description: 'Noite de intercessão',
      address: 'Rua das Palmeiras, 120',
    })
  })

  it('criar publicado já entra no diretório público, com a igreja aprovada e ativa', () => {
    const result = demoCreateEvent(validDraft(), { churchId: 'ch1', role: 'church_admin' }, 'published')
    expect(result.ok).toBe(true)
    expect(demoPublicEvents().map((e) => e.id)).toContain(result.event!.id)
    expect(demoPublicEventBySlug('vigilia-de-avivamento')).not.toBeNull()
  })

  it('criar com filial da própria igreja grava branch_id e coordenada', () => {
    const result = demoCreateEvent(
      validDraft({ branch_id: 'b1', latitude: -23.1857, longitude: -45.8871 }),
      { churchId: 'ch1', role: 'manager' },
      'draft',
    )
    expect(result.ok).toBe(true)
    expect(result.event).toMatchObject({ branch_id: 'b1', latitude: -23.1857, longitude: -45.8871 })
  })

  it('filial de outra igreja é recusada — o fixture espelha o trigger enforce_event_branch (O8)', () => {
    // b3 é da ch2; criar em ch1 apontando para b3 é o que o trigger recusa no banco.
    const resultado = demoCreateEvent(validDraft({ branch_id: 'b3' }), { churchId: 'ch1', role: 'manager' }, 'draft')
    expect(resultado).toEqual({ ok: false, error: EVENT_BRANCH_MISMATCH })
    expect(events).toEqual(originalEvents)
  })

  it('filial inexistente recebe a mesma mensagem de filial alheia: sem oráculo de existência', () => {
    const resultado = demoCreateEvent(
      validDraft({ branch_id: 'filial-que-nao-existe' }),
      { churchId: 'ch1', role: 'manager' },
      'draft',
    )
    expect(resultado).toEqual({ ok: false, error: EVENT_BRANCH_MISMATCH })
  })

  it('editar apontando para filial de outra igreja também é recusado', () => {
    const resultado = demoUpdateEvent('e1', validDraft({ branch_id: 'b3' }), { churchId: 'ch1', role: 'manager' })
    expect(resultado).toEqual({ ok: false, error: EVENT_BRANCH_MISMATCH })
    expect(events.find((e) => e.id === 'e1')!.branch_id).toBe('b1')
  })

  it('publicar com a igreja suspensa não põe no ar: quem decide é a audiência da igreja', () => {
    churches.find((c) => c.id === 'ch1')!.approval_status = 'suspended'
    const result = demoCreateEvent(validDraft(), { churchId: 'ch1', role: 'church_admin' }, 'published')
    expect(result.ok).toBe(true)
    expect(demoPublicEvents()).toEqual([])
    expect(demoChurchEvents('ch1').map((e) => e.id)).toContain(result.event!.id)
  })

  it('o comunicador cria e edita, mas não publica — igual ao banco (M6)', () => {
    const actor = { churchId: 'ch1', role: 'communicator' as const }
    const criado = demoCreateEvent(validDraft(), actor, 'draft')
    expect(criado.ok).toBe(true)
    const id = criado.event!.id

    expect(demoCreateEvent(validDraft({ name: 'Outro evento' }), actor, 'published'))
      .toEqual({ ok: false, error: EVENT_PUBLISH_DENIED })
    expect(demoSetEventStatus(id, 'published', actor)).toEqual({ ok: false, error: EVENT_PUBLISH_DENIED })
    expect(events.find((e) => e.id === id)!.status).toBe('draft')
    expect(events).toHaveLength(originalEvents.length + 1)

    expect(demoUpdateEvent(id, validDraft({ name: 'Vigília de Avivamento (editada)' }), actor).ok).toBe(true)
    expect(events.find((e) => e.id === id)!.name).toBe('Vigília de Avivamento (editada)')
    expect(demoSetEventStatus(id, 'cancelled', actor).ok).toBe(true)
  })

  it('slug duplicado é recusado, com o endereço na mensagem e sem gravar nada', () => {
    const result = demoCreateEvent(validDraft({ name: 'Congresso de Jovens 2026' }), { churchId: 'ch1', role: 'manager' }, 'draft')
    expect(result).toEqual({ ok: false, error: eventSlugTaken('congresso-de-jovens-2026') })
    expect(events).toHaveLength(originalEvents.length)
  })

  it('editar não troca igreja, slug, is_free nem status', () => {
    const antes = events.find((e) => e.id === 'e1')!
    const fixas = { church_id: antes.church_id, slug: antes.slug, is_free: antes.is_free, status: antes.status }
    const result = demoUpdateEvent('e1', validDraft(), { churchId: 'ch1', role: 'manager' })
    expect(result.ok).toBe(true)
    expect(events.find((e) => e.id === 'e1')).toMatchObject(fixas)
    expect(result.event!.slug).toBe(fixas.slug)
    expect(result.event!.name).toBe('Vigília de Avivamento')
  })

  it('editar evento de outra igreja devolve "não encontrado", sem confirmar que existe', () => {
    expect(demoUpdateEvent('e3', validDraft(), { churchId: 'ch1', role: 'manager' })).toEqual({ ok: false, error: EVENT_NOT_FOUND })
    expect(demoSetEventStatus('e3', 'cancelled', { churchId: 'ch1', role: 'manager' })).toEqual({ ok: false, error: EVENT_NOT_FOUND })
    expect(events.find((e) => e.id === 'e3')).toEqual(originalEvents.find((e) => e.id === 'e3'))
  })

  it('o SuperAdmin alcança o evento de qualquer igreja, sem trocar a igreja dele', () => {
    expect(demoUpdateEvent('e3', validDraft({ name: 'Florescer (novo nome)' }), { role: 'superadmin' }).ok).toBe(true)
    expect(events.find((e) => e.id === 'e3')).toMatchObject({ name: 'Florescer (novo nome)', church_id: 'ch2' })
  })

  it('cancelar tira do diretório público e mantém as inscrições do evento', () => {
    expect(demoPublicEventBySlug('vigilia-de-oracao')).not.toBeNull()
    expect(demoSetEventStatus('e2', 'cancelled', { churchId: 'ch1', role: 'church_admin' }).ok).toBe(true)
    expect(demoPublicEventBySlug('vigilia-de-oracao')).toBeNull()
    expect(demoChurchEvents('ch1').map((e) => e.id)).toContain('e2')
    expect(registrations.filter((r) => r.event_id === 'e2')).toHaveLength(1)
  })

  it('a linha criada tem as colunas de gestão mais as derivadas, e nada além', () => {
    const result = demoCreateEvent(validDraft(), { churchId: 'ch1', role: 'manager' }, 'draft')
    const gravada = events.find((e) => e.id === result.event!.id)!
    expect(Object.keys(gravada).sort()).toEqual([...new Set([...EVENTS_MANAGED_COLUMNS, 'category', 'church_name'])].sort())
    expect(tableColumns(result.event!, ['category', 'church_name'])).toEqual([...EVENTS_MANAGED_COLUMNS].sort())
    expect(gravada).not.toHaveProperty('registrations_count')
  })
})

describe('escritas — contrato com o grupo M da suíte SQL', () => {
  it('M10 mede o WITH CHECK que impede mover o evento de igreja', () => {
    const m10 = caseBlock('m10')
    expect(m10).toMatch(/update public\.events set church_id = current_setting\('app\.church_b'\)::uuid/)
    expect(m10).toContain('when insufficient_privilege')
    expect(m10).toContain("current_setting('app.event_a_pub')::uuid")
    expect(m10).toMatch(/RLS-FALHA M10/)
    // O destino recusado é conferido lendo a linha de novo, não só pelo erro.
    expect(m10).toMatch(/select church_id into church_now/)
  })
})
