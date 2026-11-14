import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { churches, events, registrations } from '@/data/mock'
import {
  CANCEL_MESSAGES,
  CHECK_IN_MESSAGES,
  REGISTER_MESSAGES,
  REGISTRATION_COLUMNS,
  REGISTRATION_EVENT_EMBED,
  REGISTRATION_SELECT,
  STATS_COLUMNS,
  cancelRegistration,
  checkInRegistration,
  fetchChurchRegistrations,
  fetchRegistrationStats,
  registerForEvent,
} from '@/services/data/registrationService'
import {
  demoCancelRegistration,
  demoCheckIn,
  demoChurchRegistrations,
  demoRegisterForEvent,
  demoRegistrationStats,
} from '../fixtures/registrationMirror'
import { queueText, waitlistAdmission } from '@/utils/checkInPolicy'
import type { Registration, RegistrationStats } from '@/types'

/**
 * Inscrições têm duas metades, como eventos: a 0012 (com o grupo N da suíte SQL)
 * e o código que monta a consulta. Estes testes conferem a segunda e amarram as
 * duas pontas.
 *
 * O que não pode derivar em silêncio:
 *   * a projeção — é ela que limita as colunas que chegam ao navegador, já que a
 *     RLS é por linha;
 *   * a view pública — se alguém acrescentar nome, e-mail ou `ticket_code` nela,
 *     o visitante anon passa a ler dado pessoal de terceiro (caso N15);
 *   * os códigos de retorno das RPCs — cada um tem de ter mensagem na tela, e
 *     cada mensagem tem de corresponder a um código que o SQL realmente devolve;
 *   * o fixture (`tests/fixtures/registrationMirror.ts`), que reproduz a mesma
 *     audiência, a mesma fila e a mesma porta de permissão (`registrations.manage`,
 *     que o comunicador não tem).
 */

const backend = vi.hoisted(() => ({
  supabase: null as { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> } | null,
}))
vi.mock('@/services/supabase/client', () => backend)

const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn() }
const from = vi.fn()
const rpc = vi.fn()

const originalEvents = structuredClone(events)
const originalChurches = structuredClone(churches)
const originalRegistrations = structuredClone(registrations)

const registrationSelect = REGISTRATION_SELECT.join(',')
const statsSelect = STATS_COLUMNS.join(',')
const migration = readFileSync(
  path.resolve(import.meta.dirname, '../../supabase/migrations/0012_event_registrations.sql'),
  'utf8',
)
const suite = readFileSync(
  path.resolve(import.meta.dirname, '../../supabase/tests/database/rls_isolation.sql'),
  'utf8',
)

beforeEach(() => {
  // O app não tem mais caminho sem Supabase: o client simulado está montado para
  // todos os casos, e o que exercita a loja em memória chama o fixture direto.
  backend.supabase = { from, rpc }
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockResolvedValue({ data: [], error: null })
  from.mockReturnValue(chain)
  rpc.mockResolvedValue({ data: 'confirmed', error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
  events.splice(0, events.length, ...structuredClone(originalEvents))
  churches.splice(0, churches.length, ...structuredClone(originalChurches))
  registrations.splice(0, registrations.length, ...structuredClone(originalRegistrations))
  backend.supabase = null
})

/** Evento-fixture: o mock tem datas de 2026 e o teste não pode depender do relógio. */
function eventFixture(overrides: Partial<(typeof originalEvents)[number]> = {}) {
  const event = {
    ...originalEvents[0]!,
    id: 'e-reg',
    slug: 'evento-de-teste',
    church_id: 'ch1',
    status: 'published' as const,
    visibility: 'public' as const,
    starts_at: '2099-06-01T19:00:00',
    capacity: 2,
    ...overrides,
  }
  events.push(event)
  return event
}

function tableBlock(table: string) {
  const start = migration.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada na 0012`)
  return migration.slice(start, migration.indexOf('\n);', start))
}

function hasColumn(block: string, column: string) {
  return new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(block)
}

function functionBlock(name: string) {
  const start = migration.indexOf(`function public.${name}(`)
  if (start < 0) throw new Error(`função ${name} não encontrada na 0012`)
  const end = migration.indexOf('\n$$;', start)
  return migration.slice(start, end)
}

function viewBlock() {
  const start = migration.indexOf('create or replace view public.event_registration_stats')
  if (start < 0) throw new Error('view de estatísticas não encontrada na 0012')
  return migration.slice(start, migration.indexOf('group by e.id', start))
}

/** Todos os códigos que as três RPCs devolvem com `return '...'`. */
function sqlReturnCodes() {
  const codes = new Set<string>()
  for (const name of ['register_for_event', 'check_in_registration', 'cancel_event_registration']) {
    for (const match of functionBlock(name).matchAll(/return '([a-z_]+)'/g)) codes.add(match[1]!)
  }
  return codes
}

/** Bloco de um caso do grupo N, entre o savepoint e o rollback dele. */
function caseBlock(name: string) {
  const group = suite.indexOf('-- GRUPO N')
  if (group < 0) throw new Error('Grupo N ausente da suíte SQL')
  const start = suite.indexOf(`savepoint ${name};`, group)
  const end = suite.indexOf(`rollback to savepoint ${name};`, group)
  if (start < 0 || end < 0) throw new Error(`Bloco ${name} ausente do grupo N`)
  return suite.slice(start, end)
}

describe('contrato SQL — 0012', () => {
  it('a tabela existe, tem RLS e não tem política nem grant de escrita', () => {
    expect(migration).toContain('alter table public.event_registrations enable row level security')
    expect(migration).toContain('revoke all on public.event_registrations from anon, authenticated')
    expect(migration).toContain('grant select on public.event_registrations to authenticated')
    expect(migration).not.toContain('grant insert')
    expect(migration).not.toContain('grant update')
    // a única política é a de leitura
    expect(migration.match(/create policy \w+ on public\.event_registrations/g)).toHaveLength(1)
    expect(migration).toContain('for select to authenticated using')
  })

  it('toda coluna projetada pela lista da equipe existe na tabela', () => {
    const ddl = tableBlock('event_registrations')
    for (const column of REGISTRATION_COLUMNS) {
      expect(hasColumn(ddl, column), `event_registrations.${column}`).toBe(true)
    }
  })

  it('a view pública tem exatamente as colunas que o app seleciona', () => {
    const view = viewBlock()
    const aliases = [...view.matchAll(/ as ([a-z_]+)/g)].map((m) => m[1]!)
    const plain = STATS_COLUMNS.filter((column) => view.includes(`e.${column}`))
    for (const column of STATS_COLUMNS) {
      expect(aliases.includes(column) || plain.includes(column), `coluna ${column} da view`).toBe(true)
    }
    // nos dois sentidos: a view não pode devolver coluna que o app não seleciona
    for (const alias of aliases) {
      expect(STATS_COLUMNS.includes(alias), `coluna ${alias} da view fora da projeção`).toBe(true)
    }
    // sonda anti-no-op: se a extração parar de achar nada, os casos acima viram enfeite
    expect(aliases.length).toBeGreaterThanOrEqual(7)
    expect(plain).toEqual(['church_id', 'capacity'])
  })

  it('a view pública não expõe dado pessoal de inscrito', () => {
    const view = viewBlock()
    for (const forbidden of ['visitor_name', 'visitor_email', 'visitor_phone', 'ticket_code', 'user_id']) {
      expect(view, `view expõe ${forbidden}`).not.toContain(forbidden)
    }
    expect(view).toContain('with (security_invoker = false)')
    expect(migration).toContain('grant select on public.event_registration_stats to anon, authenticated, service_role')
  })

  it('as três RPCs são SECURITY DEFINER com search_path fixo', () => {
    for (const name of ['register_for_event', 'check_in_registration', 'cancel_event_registration']) {
      const head = migration.slice(migration.indexOf(`function public.${name}(`))
      expect(head.slice(0, 400)).toContain('security definer')
      expect(head.slice(0, 400)).toContain('set search_path = public')
    }
    expect(migration).toContain('revoke execute on function public.register_for_event(uuid, text, text, text) from public')
    expect(migration).toMatch(
      /grant execute on function public\.register_for_event\(uuid, text, text, text\)\s+to anon, authenticated, service_role/,
    )
    expect(migration).toContain('revoke execute on function public.check_in_registration(uuid) from public, anon')
    expect(migration).toContain('revoke execute on function public.cancel_event_registration(uuid) from public, anon')
  })

  it('a inscrição do visitante trava a linha do evento e não devolve ingresso', () => {
    const body = functionBlock('register_for_event')
    expect(body).toContain('for update')
    expect(body).toContain("return 'evento_indisponivel'")
    // o único retorno que não é um código literal é o estado gravado; nenhum
    // deles é o ticket_code
    const returns = [...body.matchAll(/return ([^;\n]+)/g)].map((m) => m[1]!.trim())
    expect(returns.length).toBeGreaterThanOrEqual(5)
    expect(returns.every((r) => r.startsWith("'") || r === 'new_status')).toBe(true)
    expect(body).toContain("then 'confirmed'")
    expect(body).toContain("else 'waitlist'")
  })

  it('church_id é derivado do evento por trigger, com 42501 se forjado', () => {
    expect(migration).toContain('create trigger trg_event_registrations_church')
    expect(migration).toContain("errcode = '42501'")
    expect(functionBlock('enforce_registration_church')).toContain('security definer')
  })

  it('permissão é conferida antes de a inscrição existir, nas duas RPCs da equipe', () => {
    for (const name of ['check_in_registration', 'cancel_event_registration']) {
      const body = functionBlock(name)
      const gate = body.indexOf("return 'sem_permissao'")
      const read = body.indexOf('select * into reg')
      expect(gate, `${name} sem porta de permissão`).toBeGreaterThan(-1)
      expect(read, `${name} sem leitura da inscrição`).toBeGreaterThan(-1)
      // id inexistente devolve o mesmo código de linha alheia: sem oráculo de existência
      expect(body.slice(0, gate)).toContain('has_church_permission')
      expect(gate, `${name} lê a inscrição antes de conferir permissão`).toBeLessThan(read)
    }
  })

  it('cada código do SQL tem mensagem na tela e cada mensagem tem código no SQL', () => {
    const codes = sqlReturnCodes()
    // os dois estados de sucesso saem por `new_status`, não por um literal
    codes.add('confirmed')
    codes.add('waitlist')
    const mapped = new Set([
      ...Object.keys(REGISTER_MESSAGES),
      ...Object.keys(CHECK_IN_MESSAGES),
      ...Object.keys(CANCEL_MESSAGES),
    ])
    for (const code of codes) {
      expect(mapped.has(code), `código ${code} sem mensagem na tela`).toBe(true)
    }
    for (const message of mapped) {
      expect(codes.has(message), `mensagem para código ${message} que o SQL não devolve`).toBe(true)
    }
    // sonda: sem isso, um SQL que pare de devolver código algum passaria nos dois sentidos
    expect(codes.size).toBeGreaterThanOrEqual(10)
  })

  it('o grupo N cobre os casos que estes testes espelham', () => {
    for (const name of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11', 'n12', 'n13', 'n14', 'n15']) {
      expect(caseBlock(name).length, `caso ${name}`).toBeGreaterThan(100)
    }
    expect(caseBlock('n3')).toContain('sem_permissao')
    expect(caseBlock('n12')).toContain('church_id')
  })
})

describe('projeção — o que chega ao navegador', () => {
  it('a lista da equipe é a projeção mais o embed do evento', () => {
    expect(REGISTRATION_SELECT).toEqual([...REGISTRATION_COLUMNS, REGISTRATION_EVENT_EMBED])
    expect(REGISTRATION_EVENT_EMBED).toBe('events(id, name, slug, starts_at)')
  })

  it('a linha do demo tem exatamente as colunas da projeção, mais o nome do evento', () => {
    const [row] = demoChurchRegistrations('ch1')
    expect(row).toBeDefined()
    const keys = Object.keys(row!).filter((key) => key !== 'event_name').sort()
    expect(keys).toEqual([...REGISTRATION_COLUMNS].sort().filter((column) => column !== 'church_id' && column !== 'user_id' && column !== 'visitor_phone' && column !== 'checked_in_at'))
  })

  it('sem igreja da sessão não há lista — o recorte não é a guarda, mas sem ele não há o que pedir', async () => {

    await expect(fetchChurchRegistrations()).resolves.toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('papel sem registrations.manage não pede a lista: o espelho não mostra o que o banco recusa (N3)', async () => {

    // os papéis são os do seed: comunicador tem events.manage, não registrations.manage
    await expect(fetchChurchRegistrations('ch1', 'communicator')).resolves.toEqual([])
    await expect(fetchChurchRegistrations('ch1', 'visitor')).resolves.toEqual([])
    expect(from).not.toHaveBeenCalled()

    for (const role of ['superadmin', 'church_admin', 'manager', 'pastor'] as const) {
      await fetchChurchRegistrations('ch1', role)
    }
    expect(from).toHaveBeenCalledTimes(4)
  })
})

describe('cliente real — consultas e RPCs', () => {
  it('a lista da equipe seleciona a projeção e resolve o nome do evento pelo embed', async () => {

    chain.order.mockResolvedValue({
      data: [
        {
          id: 'r1',
          event_id: 'e1',
          church_id: 'ch1',
          user_id: null,
          visitor_name: 'Ana',
          visitor_email: 'ana@email.test',
          visitor_phone: null,
          status: 'confirmed',
          ticket_code: 'A2F-9C3',
          checked_in_at: null,
          created_at: '2026-11-01',
          events: { id: 'e1', name: 'Congresso', slug: 'congresso', starts_at: '2099-06-01T19:00:00' },
        },
      ],
      error: null,
    })

    const rows = await fetchChurchRegistrations('ch1', 'church_admin')
    expect(from).toHaveBeenCalledWith('event_registrations')
    expect(chain.select).toHaveBeenCalledWith(registrationSelect)
    expect(chain.eq).toHaveBeenCalledWith('church_id', 'ch1')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event_name).toBe('Congresso')
    expect(rows[0]!.ticket_code).toBe('A2F-9C3')
    expect((rows[0] as unknown as Record<string, unknown>).events).toBeUndefined()
  })

  it('a contagem vem da view de agregados, sem filtro nenhum no cliente', async () => {

    chain.select.mockResolvedValue({
      data: [{
        event_id: 'e1', church_id: 'ch1', capacity: 500, pending_count: 0, confirmed_count: 2,
        waitlist_count: 1, checked_in_count: 0, cancelled_count: 0, active_count: 3, spots_left: 497,
      }],
      error: null,
    })
    const stats = await fetchRegistrationStats()
    expect(from).toHaveBeenCalledWith('event_registration_stats')
    expect(chain.select).toHaveBeenCalledWith(statsSelect)
    expect(stats[0]!.active_count).toBe(3)
    expect(stats[0]!.spots_left).toBe(497)
    // a audiência é decidida pela view: nenhum .eq() limita o que volta
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('a inscrição chama a RPC com dados normalizados e devolve o estado confirmado', async () => {

    rpc.mockResolvedValue({ data: 'waitlist', error: null })
    const result = await registerForEvent({ eventId: 'e1', name: '  Carla Dias ', email: ' CARLA@Email.test ', phone: '  ' })
    expect(rpc).toHaveBeenCalledWith('register_for_event', {
      p_event: 'e1',
      p_name: 'Carla Dias',
      p_email: 'carla@email.test',
      p_phone: null,
    })
    expect(result).toEqual({ ok: true, status: 'waitlist' })
  })

  it('a recusa da RPC vira a mensagem do mapa, não o código cru', async () => {

    rpc.mockResolvedValue({ data: 'ja_inscrita', error: null })
    const result = await registerForEvent({ eventId: 'e1', name: 'Carla Dias', email: 'carla@email.test' })
    expect(result).toEqual({ ok: false, error: REGISTER_MESSAGES.ja_inscrita })
  })

  it('erro do banco com 42501 vira mensagem de permissão', async () => {

    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    const result = await checkInRegistration('r1', 'church_admin')
    expect(result).toEqual({ ok: false, error: 'Sem permissão para esta ação na sua igreja.' })
  })

  it('dados inválidos nem chegam ao banco', async () => {

    const result = await registerForEvent({ eventId: 'e1', name: 'A', email: 'sem-arroba' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe(REGISTER_MESSAGES.dados_invalidos)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('check-in e cancelamento passam o id da inscrição para as RPCs', async () => {

    rpc.mockResolvedValue({ data: 'presente', error: null })
    await expect(checkInRegistration('r9', 'pastor')).resolves.toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('check_in_registration', { p_registration: 'r9' })

    rpc.mockResolvedValue({ data: 'cancelada_com_promocao', error: null })
    const cancelled = await cancelRegistration('r9', 'pastor')
    expect(rpc).toHaveBeenCalledWith('cancel_event_registration', { p_registration: 'r9' })
    expect(cancelled.ok).toBe(true)
    expect(cancelled.error).toBe(CANCEL_MESSAGES.cancelada_com_promocao)
  })

  it('papel sem registrations.manage não chega na RPC: a recusa é a mesma do banco (N3)', async () => {
    for (const role of ['communicator', 'visitor', undefined] as const) {
      expect(await checkInRegistration('r1', role)).toEqual({ ok: false, error: CHECK_IN_MESSAGES.sem_permissao })
      expect(await cancelRegistration('r1', role)).toEqual({ ok: false, error: CANCEL_MESSAGES.sem_permissao })
    }
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('loja do fixture — espelha o grupo N', () => {
  it('inscreve no evento publicado, deriva a igreja e gera o código (N4)', () => {
    eventFixture()
    const result = demoRegisterForEvent({ eventId: 'e-reg', name: ' Carla Dias ', email: ' CARLA@Email.test ', phone: '(12) 99999-0000' })
    expect(result).toEqual({ ok: true, status: 'confirmed' })

    const [row] = registrations.filter((r) => r.visitor_email === 'carla@email.test')
    expect(row!.church_id).toBe('ch1')
    expect(row!.visitor_name).toBe('Carla Dias')
    expect(row!.visitor_phone).toBe('(12) 99999-0000')
    expect(row!.ticket_code).toMatch(/^[2-9A-F]{3}-[2-9A-F]{3}$/)
  })

  it.each([
    ['rascunho', { status: 'draft' as const }],
    ['privado', { visibility: 'private' as const }],
    ['não listado', { visibility: 'unlisted' as const }],
    ['agendado', { status: 'scheduled' as const }],
  ])('evento %s não recebe inscrição e a recusa é a mesma de um evento inexistente (N5)', (_label, overrides) => {
    eventFixture(overrides)
    const blocked = demoRegisterForEvent({ eventId: 'e-reg', name: 'Espião', email: 'espiao@email.test' })
    const missing = demoRegisterForEvent({ eventId: 'nao-existe', name: 'Espião', email: 'espiao@email.test' })
    expect(blocked.error).toBe(REGISTER_MESSAGES.evento_indisponivel)
    expect(missing.error).toBe(blocked.error)
    expect(registrations.some((r) => r.visitor_email === 'espiao@email.test')).toBe(false)
  })

  it('igreja suspensa tira o evento do ar para inscrição (N5)', () => {
    eventFixture()
    churches.find((c) => c.id === 'ch1')!.approval_status = 'suspended'
    const result = demoRegisterForEvent({ eventId: 'e-reg', name: 'Carla', email: 'carla@email.test' })
    expect(result.error).toBe(REGISTER_MESSAGES.evento_indisponivel)
  })

  it('evento que já começou não recebe inscrição (N6)', () => {
    eventFixture({ starts_at: '2020-01-10T19:00:00' })
    const result = demoRegisterForEvent({ eventId: 'e-reg', name: 'Atrasado', email: 'atrasado@email.test' })
    expect(result.error).toBe(REGISTER_MESSAGES.evento_encerrado)
  })

  it('o mesmo e-mail não entra duas vezes no mesmo evento (N6)', () => {
    eventFixture()
    demoRegisterForEvent({ eventId: 'e-reg', name: 'Ana', email: 'ana@Duplicada.test' })
    const second = demoRegisterForEvent({ eventId: 'e-reg', name: 'Ana de novo', email: 'ANA@duplicada.test' })
    expect(second.error).toBe(REGISTER_MESSAGES.ja_inscrita)
    expect(registrations.filter((r) => r.visitor_email === 'ana@duplicada.test')).toHaveLength(1)
  })

  it('capacidade cheia manda para a lista de espera e zera as vagas (N7)', () => {
    eventFixture({ capacity: 2 })
    expect(demoRegisterForEvent({ eventId: 'e-reg', name: 'Um', email: 'um@email.test' }).status).toBe('confirmed')
    expect(demoRegisterForEvent({ eventId: 'e-reg', name: 'Dois', email: 'dois@email.test' }).status).toBe('confirmed')
    expect(demoRegisterForEvent({ eventId: 'e-reg', name: 'Três', email: 'tres@email.test' }).status).toBe('waitlist')

    const stats = demoRegistrationStats().find((s) => s.event_id === 'e-reg')!
    expect(stats.confirmed_count).toBe(2)
    expect(stats.waitlist_count).toBe(1)
    expect(stats.active_count).toBe(3)
    expect(stats.spots_left).toBe(0)
  })

  it('evento sem capacidade não tem fila nem vagas contadas', () => {
    eventFixture({ capacity: null })
    for (const index of [1, 2, 3, 4]) {
      expect(demoRegisterForEvent({ eventId: 'e-reg', name: `Pessoa ${index}`, email: `p${index}@email.test` }).status).toBe('confirmed')
    }
    const stats = demoRegistrationStats().find((s) => s.event_id === 'e-reg')!
    expect(stats.spots_left).toBeNull()
    expect(stats.waitlist_count).toBe(0)
  })

  it('cancelar libera vaga e promove o mais antigo da fila (N8)', () => {
    eventFixture({ capacity: 1 })
    demoRegisterForEvent({ eventId: 'e-reg', name: 'Primeiro', email: 'um@email.test' })
    demoRegisterForEvent({ eventId: 'e-reg', name: 'Segundo', email: 'dois@email.test' })
    demoRegisterForEvent({ eventId: 'e-reg', name: 'Terceiro', email: 'tres@email.test' })

    const first = registrations.find((r) => r.visitor_email === 'um@email.test')!
    const result = demoCancelRegistration(first.id, 'church_admin')
    expect(result.ok).toBe(true)
    expect(result.error).toBe(CANCEL_MESSAGES.cancelada_com_promocao)
    expect(first.status).toBe('cancelled')
    expect(registrations.find((r) => r.visitor_email === 'dois@email.test')!.status).toBe('confirmed')
    expect(registrations.find((r) => r.visitor_email === 'tres@email.test')!.status).toBe('waitlist')
  })

  it('cancelar duas vezes é recusado (N10)', () => {
    eventFixture()
    demoRegisterForEvent({ eventId: 'e-reg', name: 'Ana', email: 'ana@email.test' })
    const row = registrations.find((r) => r.visitor_email === 'ana@email.test')!
    demoCancelRegistration(row.id, 'church_admin')
    const again = demoCancelRegistration(row.id, 'church_admin')
    expect(again.ok).toBe(false)
    expect(again.error).toBe(CANCEL_MESSAGES.ja_cancelada)
  })

  it('comunicador não faz check-in nem cancela: falta registrations.manage (N3)', () => {
    eventFixture()
    demoRegisterForEvent({ eventId: 'e-reg', name: 'Ana', email: 'ana@email.test' })
    const row = registrations.find((r) => r.visitor_email === 'ana@email.test')!

    const checkIn = demoCheckIn(row.id, 'communicator')
    expect(checkIn.ok).toBe(false)
    expect(checkIn.error).toBe(CHECK_IN_MESSAGES.sem_permissao)
    expect(row.status).toBe('confirmed')

    const cancel = demoCancelRegistration(row.id, 'communicator')
    expect(cancel.ok).toBe(false)
    expect(row.status).toBe('confirmed')
  })

  it('check-in registra presença, não repete e não aceita inscrição cancelada (N10)', () => {
    eventFixture()
    demoRegisterForEvent({ eventId: 'e-reg', name: 'Ana', email: 'ana@email.test' })
    const row = registrations.find((r) => r.visitor_email === 'ana@email.test')!

    expect(demoCheckIn(row.id, 'pastor').ok).toBe(true)
    expect(row.status).toBe('checked_in')
    expect(row.checked_in_at).toBeTruthy()

    expect(demoCheckIn(row.id, 'pastor').error).toBe(CHECK_IN_MESSAGES.ja_presente)

    demoCancelRegistration(row.id, 'pastor')
    expect(demoCheckIn(row.id, 'pastor').error).toBe(CHECK_IN_MESSAGES.cancelada)
  })

  it('check-in de inscrição inexistente não inventa presença', () => {
    expect(demoCheckIn('nao-existe', 'church_admin').ok).toBe(false)
  })

  it('a lista da equipe traz só os eventos da própria igreja, com código e nome do evento', () => {
    const rows = demoChurchRegistrations('ch1')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.event_id.startsWith('e'))).toBe(true)
    expect(rows.every((r) => Boolean(r.ticket_code))).toBe(true)
    expect(rows.map((r) => r.event_id)).not.toContain('e3')
    expect(demoChurchRegistrations('ch2')).toEqual([])
  })

  it('a contagem do demo cobre todo evento, inclusive o que não tem inscrição', () => {
    eventFixture({ id: 'e-vazio', slug: 'evento-vazio', capacity: 10 })
    const stats = demoRegistrationStats().find((s) => s.event_id === 'e-vazio')!
    expect(stats.active_count).toBe(0)
    expect(stats.spots_left).toBe(10)
    expect(demoRegistrationStats().map((s) => s.event_id)).toEqual(events.map((e) => e.id))
  })

  it('a loja do fixture grava a inscrição e ela aparece na lista da equipe', () => {
    eventFixture()
    const before = registrations.length
    expect(demoRegisterForEvent({ eventId: 'e-reg', name: 'Ana', email: 'ana@email.test' }).ok).toBe(true)
    expect(registrations).toHaveLength(before + 1)
    expect(demoChurchRegistrations('ch1').map((r) => r.visitor_email)).toContain('ana@email.test')
  })

  it('a linha devolvida pelo fixture satisfaz o tipo de inscrição', () => {
    const row: Registration = demoChurchRegistrations('ch1')[0]!
    expect(row.status).toMatch(/^(pending|confirmed|waitlist|checked_in|cancelled)$/)
    expect(row.created_at).toBeTruthy()
  })
})

describe('tela de check-in — o Resumo lê duas fontes e recarrega as duas', () => {
  /**
   * Medido em produção (2026-11-13, sessão de gerente): depois de um check-in a
   * tela dizia `Check-in feito 0` ao lado de `Presentes 67%`, porque 'Inscritos',
   * 'Check-in feito' e 'Lista de espera' vêm da view `event_registration_stats`
   * (carregada uma vez) e 'Presentes' da lista, que o `reload()` refazia. Ninguém
   * recarrega a página no balcão.
   */
  const pageSource = readFileSync(
    path.resolve(import.meta.dirname, '../../src/pages/church/CheckInPage.tsx'),
    'utf8',
  )
  const hookSource = readFileSync(
    path.resolve(import.meta.dirname, '../../src/hooks/useRegistrations.ts'),
    'utf8',
  )
  const keyedListSource = readFileSync(
    path.resolve(import.meta.dirname, '../../src/hooks/useKeyedList.ts'),
    'utf8',
  )

  it('cada recarga da lista vem acompanhada da recarga das estatísticas', () => {
    const recargasDeLista = pageSource.match(/(?<![A-Za-z0-9_.])reload\(\)/g) ?? []
    expect(recargasDeLista.length).toBeGreaterThan(0)
    expect(pageSource).toMatch(/reload: reloadStats\s*\}\s*=\s*useRegistrationStats\(\)/)
    expect(
      pageSource.match(/reload\(\)\s*\n\s*reloadStats\(\)/g) ?? [],
      'recarregar a lista sem recarregar a view deixa o painel se contradizendo',
    ).toHaveLength(recargasDeLista.length)
  })

  it('o reload das estatísticas é o refetch do hook, não um no-op', () => {
    expect(hookSource).toMatch(/export function useRegistrationStats\(\)[\s\S]*?return \{ \.\.\.result, byEvent \}/)
    expect(keyedListSource).toMatch(/const reload = useCallback\(\(\) => setTick\(\(t\) => t \+ 1\), \[\]\)/)
    expect(keyedListSource).toMatch(/\n    reload,\n  \}/)
    // sonda anti-no-op: sem o tick, o effect não tem por que rodar de novo
    expect(keyedListSource).toMatch(/\[enabled, key, fetcher, fallbackError\]/)
  })

  it('não sobra recarga de lista sozinha, nem no "Tentar de novo"', () => {
    // o botão de erro recarregava só a lista: o painel continuava com a view
    // antiga e o "Presentes %" subia sozinho
    expect(pageSource, 'todo caminho de recarga tem de sair do reloadAll').not.toMatch(/onClick=\{reload\}/)
    expect(pageSource).toMatch(/onClick=\{reloadAll\}/)
    expect(pageSource).toMatch(/function reloadAll\(\) \{[\s\S]*?reload\(\)[\s\S]*?reloadStats\(\)/)
    expect((pageSource.match(/(?<![A-Za-z0-9_.])reload\(\)/g) ?? []).length, 'um único ponto recarrega a lista').toBe(1)
  })
})

describe('lista de espera no balcão — a confirmação vem antes da RPC', () => {
  /**
   * `check_in_registration` (0012) promove qualquer linha não cancelada, inclusive
   * a da fila, e não tem trava de capacidade: um Enter no código de quem estava na
   * fila já marcou presença. A decisão é do balcão, então o freio mora na tela — e
   * as duas telas que fazem check-in freiam igual.
   */
  const checkInSource = readFileSync(
    path.resolve(import.meta.dirname, '../../src/pages/church/CheckInPage.tsx'),
    'utf8',
  )
  const listSource = readFileSync(
    path.resolve(import.meta.dirname, '../../src/pages/church/RegistrationsPage.tsx'),
    'utf8',
  )

  /** O corpo de uma função do componente, até o `}` que fecha no mesmo recuo. */
  function corpoDe(source: string, nome: string): string {
    const inicio = source.indexOf(`function ${nome}(`)
    expect(inicio, `a tela não tem mais a função ${nome}`).toBeGreaterThan(-1)
    const resto = source.slice(inicio)
    const fim = resto.search(/\r?\n {2}\}\r?\n/)
    expect(fim, `não achei o fim do corpo de ${nome}`).toBeGreaterThan(-1)
    return resto.slice(0, fim)
  }

  const statsBase: RegistrationStats = {
    event_id: 'e1',
    church_id: 'ch1',
    capacity: 2,
    pending_count: 0,
    confirmed_count: 0,
    waitlist_count: 1,
    checked_in_count: 1,
    cancelled_count: 0,
    active_count: 1,
    spots_left: 0,
  }

  it('só a fila precisa de confirmação; os demais estados vão direto', () => {
    expect(waitlistAdmission({ status: 'waitlist', visitor_name: 'Edison Prado' }).needsConfirmation).toBe(true)
    for (const status of ['pending', 'confirmed', 'checked_in', 'cancelled'] as const) {
      expect(
        waitlistAdmission({ status, visitor_name: 'Edison Prado' }),
        `${status} não é lista de espera e não pode travar o balcão`,
      ).toEqual({ needsConfirmation: false, text: '' })
    }
  })

  it('o aviso diz quem é a pessoa e não inventa lotação', () => {
    const semContagem = waitlistAdmission({ status: 'waitlist', visitor_name: 'Edison Prado' }).text
    expect(semContagem).toContain('Edison Prado')
    expect(semContagem).toContain('lista de espera')
    expect(semContagem).toContain('vaga garantida')
    expect(semContagem).not.toMatch(/\d+ de \d+/)

    expect(queueText('Edison Prado', statsBase)).toContain('1 de 2 lugares já foram marcados')
    expect(queueText('Edison Prado', { ...statsBase, capacity: null })).toContain('não tem capacidade definida')
  })

  it('a tela de check-in chama a RPC só depois do clique de confirmar', () => {
    const gate = corpoDe(checkInSource, 'handleCheck')
    expect(gate).toMatch(/const gate = waitlistAdmission\(target, stats\)/)
    expect(gate).toMatch(/if \(gate\.needsConfirmation\)[\s\S]*?setAwaiting\([\s\S]*?return/)
    expect(gate, 'o Enter não pode alcançar a RPC direto').not.toContain('checkInRegistration(')
    expect(corpoDe(checkInSource, 'commit')).toContain('checkInRegistration(target.id, role)')
    expect(corpoDe(checkInSource, 'confirmQueue')).toMatch(/setAwaiting\(null\)[\s\S]*await commit\(target\)/)
    expect(checkInSource).toContain('Deixar na fila')
    expect(checkInSource.match(/checkInRegistration\(/g) ?? []).toHaveLength(1)
  })

  it('a lista de inscrições freia do mesmo jeito', () => {
    const gate = corpoDe(listSource, 'run')
    expect(gate).toMatch(/const gate = waitlistAdmission\(registration\)/)
    expect(gate).toMatch(/if \(gate\.needsConfirmation\)[\s\S]*?setAwaiting\([\s\S]*?return/)
    expect(gate, 'o botão da linha não pode alcançar a RPC direto').not.toContain('checkInRegistration(')
    expect(corpoDe(listSource, 'commit')).toContain('checkInRegistration(registration.id, role)')
    expect(listSource).toContain('Deixar na fila')
    expect(listSource.match(/checkInRegistration\(/g) ?? []).toHaveLength(1)
  })

  it('o SQL de verdade continua sem trava: quem freia é a tela', () => {
    const inicio = migration.indexOf('create or replace function public.check_in_registration')
    expect(inicio, 'sumiu a RPC de check-in da 0012').toBeGreaterThan(-1)
    const corpo = migration.slice(inicio, migration.indexOf('\n$$;', inicio))
    expect(corpo).toContain("if reg.status = 'cancelled' then")
    expect(corpo).toMatch(/set status = 'checked_in', checked_in_at = now\(\)/)
    expect(corpo.toLowerCase()).not.toContain('capacity')
  })
})
