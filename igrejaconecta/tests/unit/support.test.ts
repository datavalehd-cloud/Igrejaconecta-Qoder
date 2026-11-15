import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SUPPORT_BODY_REQUIRED,
  SUPPORT_MESSAGE_COLUMNS,
  SUPPORT_NO_ACTOR,
  SUPPORT_STATUS_LABEL,
  SUPPORT_SUBJECT_REQUIRED,
  SUPPORT_TICKET_LIST_COLUMNS,
  fetchSupportMessages,
  fetchSupportTickets,
  openSupportTicket,
  replySupportTicket,
  setSupportTicketStatus,
  type SupportActor,
} from '@/services/data/supportService'

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
const security = vi.hoisted(() => ({ notePermissionDenied: vi.fn() }))
vi.mock('@/services/supabase/client', () => backend)
vi.mock('@/services/data/securityService', () => security)

const member: SupportActor = { userId: 'u1', churchId: 'ch1', role: 'member' }
const superadmin: SupportActor = { userId: 'u0', role: 'superadmin' }

const from = vi.fn()
const list = { select: vi.fn(), order: vi.fn() }
const messages = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), insert: vi.fn() }
// `support_tickets` precisa ser thenable: marcar `answered` na resposta await o
// próprio builder (update().eq().eq()), como no supabase-js.
const tickets = { insert: vi.fn(), update: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() }
let updateOutcome: { data: unknown; error: unknown }

beforeEach(() => {
  vi.resetAllMocks()
  updateOutcome = { data: null, error: null }
  list.select.mockReturnValue(list)
  list.order.mockResolvedValue({ data: [], error: null })
  messages.select.mockReturnValue(messages)
  messages.eq.mockReturnValue(messages)
  messages.order.mockResolvedValue({ data: [], error: null })
  messages.insert.mockResolvedValue({ error: null })
  tickets.insert.mockReturnValue(tickets)
  tickets.update.mockReturnValue(tickets)
  tickets.select.mockReturnValue(tickets)
  tickets.eq.mockReturnValue(tickets)
  tickets.maybeSingle.mockResolvedValue({ data: { id: 't9' }, error: null })
  tickets.then.mockImplementation((onFulfilled?: (value: unknown) => unknown) => Promise.resolve(updateOutcome).then(onFulfilled))
  from.mockImplementation((table: string) => {
    if (table === 'support_ticket_list') return list
    if (table === 'support_messages') return messages
    if (table === 'support_tickets') return tickets
    throw new Error(`Tabela inesperada: ${table}`)
  })
  backend.supabase = { from }
})

afterEach(() => {
  backend.supabase = null
})

function invocationOrders(...methods: ReturnType<typeof vi.fn>[]) {
  const calls = methods.map((method) => method.mock.invocationCallOrder[0])
  expect(calls).toEqual([...calls].sort((a, b) => a - b))
}

describe('validação antes do banco', () => {
  it('sem sessão não há chamado: recusa antes de qualquer chamada', async () => {
    expect(await openSupportTicket({ subject: 'assunto válido', body: 'mensagem' }, {})).toEqual({ ok: false, error: SUPPORT_NO_ACTOR })
    expect(await replySupportTicket('t9', 'mensagem', {})).toEqual({ ok: false, error: SUPPORT_NO_ACTOR })
    expect(await setSupportTicketStatus('t9', 'closed', {})).toEqual({ ok: false, error: SUPPORT_NO_ACTOR })
    expect(from).not.toHaveBeenCalled()
  })

  // Os limites espelham os check constraints da 0018: assunto 3..200, mensagem 1..4000.
  it.each(['', 'ab', '   ', 'x'.repeat(201)])('assunto fora do limite (%s) recusa sem tocar o banco', async (subject) => {
    expect(await openSupportTicket({ subject, body: 'mensagem válida' }, member)).toEqual({ ok: false, error: SUPPORT_SUBJECT_REQUIRED })
    expect(from).not.toHaveBeenCalled()
  })

  it.each(['', '   ', 'x'.repeat(4001)])('mensagem fora do limite recusa sem tocar o banco', async (body) => {
    expect(await openSupportTicket({ subject: 'assunto válido', body }, member)).toEqual({ ok: false, error: SUPPORT_BODY_REQUIRED })
    expect(await replySupportTicket('t9', body, member)).toEqual({ ok: false, error: SUPPORT_BODY_REQUIRED })
    expect(from).not.toHaveBeenCalled()
  })

  it('assunto no limite exato (3 caracteres após trim) passa da validação', async () => {
    await openSupportTicket({ subject: '  abc  ', body: 'ok' }, member)
    expect(from).toHaveBeenCalledWith('support_tickets')
    expect(tickets.insert).toHaveBeenCalledExactlyOnceWith({ opened_by: 'u1', church_id: 'ch1', subject: 'abc' })
  })
})

describe('abrir chamado', () => {
  it('grava o ticket com o autor da sessão e só depois a primeira mensagem', async () => {
    const result = await openSupportTicket({ subject: ' Erro ao publicar ', body: ' Corpo da mensagem ' }, member)
    expect(result).toEqual({ ok: true, ticketId: 't9' })
    expect(tickets.insert).toHaveBeenCalledExactlyOnceWith({ opened_by: 'u1', church_id: 'ch1', subject: 'Erro ao publicar' })
    expect(tickets.select).toHaveBeenCalledExactlyOnceWith('id')
    expect(messages.insert).toHaveBeenCalledExactlyOnceWith({ ticket_id: 't9', author_id: 'u1', body: 'Corpo da mensagem' })
    invocationOrders(tickets.insert, messages.insert)
  })

  it.each([undefined, ''])('igreja ausente ou vazia vira church_id null — chamado não pode "sobre" igreja nenhuma', async (churchId) => {
    expect(await openSupportTicket({ subject: 'assunto válido', body: 'mensagem' }, { userId: 'u1', churchId })).toEqual({ ok: true, ticketId: 't9' })
    expect(tickets.insert).toHaveBeenCalledExactlyOnceWith({ opened_by: 'u1', church_id: null, subject: 'assunto válido' })
  })

  it('recusa 42501 no ticket vira sinal de segurança e mensagem honesta, sem tentar a mensagem', async () => {
    tickets.maybeSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'violates row-level security' } })
    const result = await openSupportTicket({ subject: 'assunto válido', body: 'mensagem' }, member)
    expect(result).toEqual({ ok: false, error: 'O banco recusou a escrita: este chamado não é seu, ou a igreja dele não é uma igreja sua.' })
    expect(security.notePermissionDenied).toHaveBeenCalledExactlyOnceWith('support_tickets.insert', 'ch1')
    expect(messages.insert).not.toHaveBeenCalled()
  })

  it('recusa 42501 na primeira mensagem também vira sinal, e o erro diz que o chamado ficou aberto', async () => {
    messages.insert.mockResolvedValue({ error: { code: '42501', message: 'violates row-level security' } })
    const result = await openSupportTicket({ subject: 'assunto válido', body: 'mensagem' }, member)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Falha tratada como sucesso')
    expect(result.error).toContain('O chamado ficou aberto sem a primeira mensagem.')
    expect(security.notePermissionDenied).toHaveBeenCalledExactlyOnceWith('support_messages.insert', 'ch1')
  })

  it('banco sem linha de retorno não confirma abertura', async () => {
    tickets.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await openSupportTicket({ subject: 'assunto válido', body: 'mensagem' }, member))
      .toEqual({ ok: false, error: 'O banco não devolveu o chamado criado: nada foi aberto.' })
    expect(messages.insert).not.toHaveBeenCalled()
    expect(security.notePermissionDenied).not.toHaveBeenCalled()
  })

  it('erro 23514 explica os limites; erro genérico repassa a mensagem do banco; nenhum vira sinal', async () => {
    tickets.maybeSingle.mockResolvedValue({ data: null, error: { code: '23514', message: 'check' } })
    expect(await openSupportTicket({ subject: 'assunto válido', body: 'mensagem' }, member))
      .toEqual({ ok: false, error: 'Algum campo está fora do permitido: assunto de 3 a 200 caracteres, mensagem de 1 a 4000.' })
    tickets.maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout no banco' } })
    expect(await openSupportTicket({ subject: 'assunto válido', body: 'mensagem' }, member))
      .toEqual({ ok: false, error: 'timeout no banco' })
    expect(security.notePermissionDenied).not.toHaveBeenCalled()
  })
})

describe('responder chamado', () => {
  it('quem não é SuperAdmin só grava a mensagem, sem tocar o status', async () => {
    expect(await replySupportTicket('t5', ' resposta ', member)).toEqual({ ok: true, ticketId: 't5' })
    expect(messages.insert).toHaveBeenCalledExactlyOnceWith({ ticket_id: 't5', author_id: 'u1', body: 'resposta' })
    expect(tickets.update).not.toHaveBeenCalled()
  })

  it('SuperAdmin marca answered só em ticket ainda aberto, depois de gravar a mensagem', async () => {
    expect(await replySupportTicket('t5', 'resposta do atendimento', superadmin)).toEqual({ ok: true, ticketId: 't5' })
    expect(tickets.update).toHaveBeenCalledExactlyOnceWith({ status: 'answered' })
    expect(tickets.eq.mock.calls).toEqual([['id', 't5'], ['status', 'open']])
    invocationOrders(messages.insert, tickets.update)
  })

  it('a marca de answered é melhor esforço: sem confirmação do banco a resposta continua gravada', async () => {
    updateOutcome = { data: null, error: { code: '42501', message: 'recusado' } }
    expect(await replySupportTicket('t5', 'resposta', superadmin)).toEqual({ ok: true, ticketId: 't5' })
    expect(messages.insert).toHaveBeenCalledTimes(1)
  })

  it('recusa 42501 na mensagem vira sinal de segurança e falha a operação', async () => {
    messages.insert.mockResolvedValue({ error: { code: '42501', message: 'violates row-level security' } })
    const result = await replySupportTicket('t5', 'resposta', member)
    expect(result).toEqual({ ok: false, error: 'O banco recusou a escrita: este chamado não é seu, ou a igreja dele não é uma igreja sua.' })
    expect(security.notePermissionDenied).toHaveBeenCalledExactlyOnceWith('support_messages.insert', 'ch1')
    expect(tickets.update).not.toHaveBeenCalled()
  })
})

describe('fechar e reabrir', () => {
  it.each(['closed', 'open'] as const)('confirma %s só com a linha devolvida pelo banco', async (status) => {
    tickets.maybeSingle.mockResolvedValue({ data: { id: 't5' }, error: null })
    expect(await setSupportTicketStatus('t5', status, member)).toEqual({ ok: true, ticketId: 't5' })
    expect(tickets.update).toHaveBeenCalledExactlyOnceWith({ status })
    expect(tickets.eq).toHaveBeenCalledExactlyOnceWith('id', 't5')
    expect(tickets.select).toHaveBeenCalledExactlyOnceWith('id')
  })

  it('recusa 42501 vira sinal de segurança e mensagem honesta', async () => {
    tickets.maybeSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'violates row-level security' } })
    const result = await setSupportTicketStatus('t5', 'closed', member)
    expect(result).toEqual({ ok: false, error: 'O banco recusou a escrita: este chamado não é seu, ou a igreja dele não é uma igreja sua.' })
    expect(security.notePermissionDenied).toHaveBeenCalledExactlyOnceWith('support_tickets.update', 'ch1')
  })

  it('banco sem confirmação (RLS filtra a linha) não finge sucesso', async () => {
    tickets.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await setSupportTicketStatus('t5', 'closed', member)).toEqual({
      ok: false,
      error: 'Só quem abriu o chamado ou o SuperAdmin fecha e reabre: o banco não confirmou a mudança.',
    })
  })
})

describe('leituras', () => {
  it('a lista lê a view sem filtro de audiência no cliente: só select e order', async () => {
    const rows = [{ id: 't1', status: 'open', subject: 'assunto', messages_count: 2 }]
    list.order.mockResolvedValue({ data: rows, error: null })
    expect(await fetchSupportTickets()).toEqual(rows)
    expect(from).toHaveBeenCalledExactlyOnceWith('support_ticket_list')
    expect(list.select).toHaveBeenCalledExactlyOnceWith(SUPPORT_TICKET_LIST_COLUMNS.join(','))
    expect(list.order).toHaveBeenCalledExactlyOnceWith('updated_at', { ascending: false })
  })

  it('lista vazia real permanece vazia e erro do banco lança', async () => {
    list.order.mockResolvedValue({ data: null, error: null })
    expect(await fetchSupportTickets()).toEqual([])
    list.order.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    await expect(fetchSupportTickets()).rejects.toThrow('leitura recusada')
  })

  it('a conversa recorta pelo ticket e vem em ordem cronológica', async () => {
    const rows = [{ id: 'm1', ticket_id: 't5', author_id: 'u1', body: 'texto', created_at: '2026-11-14T10:00:00Z' }]
    messages.order.mockResolvedValue({ data: rows, error: null })
    expect(await fetchSupportMessages('t5')).toEqual(rows)
    expect(from).toHaveBeenCalledExactlyOnceWith('support_messages')
    expect(messages.select).toHaveBeenCalledExactlyOnceWith(SUPPORT_MESSAGE_COLUMNS.join(','))
    expect(messages.eq).toHaveBeenCalledExactlyOnceWith('ticket_id', 't5')
    expect(messages.order).toHaveBeenCalledExactlyOnceWith('created_at', { ascending: true })
    messages.order.mockResolvedValue({ data: null, error: { message: 'conversa recusada' } })
    await expect(fetchSupportMessages('t5')).rejects.toThrow('conversa recusada')
  })
})

describe('contrato com a migração 0018', () => {
  const migration = readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/0018_support_tickets.sql'), 'utf8')
  const viewStart = migration.indexOf('create or replace view public.support_ticket_list')
  const viewSql = migration.slice(viewStart, migration.indexOf(';', viewStart))
  const messagesStart = migration.indexOf('create table if not exists public.support_messages')
  const messagesSql = migration.slice(messagesStart, migration.indexOf(');', messagesStart))

  it('os status do cliente são exatamente os do check constraint', () => {
    const check = migration.match(/check \(status in \(([^)]+)\)\)/)
    if (!check) throw new Error('Check constraint de status ausente da 0018')
    expect(Object.keys(SUPPORT_STATUS_LABEL)).toEqual([...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
  })

  it('os limites de assunto e mensagem são os mesmos do banco', () => {
    expect(migration).toMatch(/check \(char_length\(btrim\(subject\)\) between 3 and 200\)/)
    expect(migration).toMatch(/check \(char_length\(btrim\(body\)\) between 1 and 4000\)/)
  })

  it('cada coluna que o cliente seleciona existe na origem', () => {
    if (viewStart < 0) throw new Error('View support_ticket_list ausente da 0018')
    for (const col of SUPPORT_TICKET_LIST_COLUMNS) expect(viewSql).toMatch(new RegExp(`\\b${col}\\b`))
    for (const col of SUPPORT_MESSAGE_COLUMNS) expect(messagesSql).toMatch(new RegExp(`^\\s*${col}\\s`, 'm'))
  })

  it('a audiência mora na view (autor, church.manage, SuperAdmin) — o cliente não recorta por conta própria', () => {
    expect(viewSql).toContain('auth.uid()')
    expect(viewSql).toContain('public.is_superadmin()')
    expect(viewSql).toContain(`'church.manage'`)
  })

  it('suporte é trilha: nenhum delete no serviço e nenhuma política de delete na migração', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../src/services/data/supportService.ts'), 'utf8')
    expect(source).not.toMatch(/\.delete\(/)
    expect(migration).not.toMatch(/for delete/i)
    const tables = [...new Set([...source.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]))].sort()
    expect(tables).toEqual(['support_messages', 'support_ticket_list', 'support_tickets'])
  })
})
