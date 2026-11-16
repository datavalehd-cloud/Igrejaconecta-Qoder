import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SERVICE_TIME_COLUMNS,
  SERVICE_TIME_INSERT_COLUMNS,
  SERVICE_TIME_MANAGE_DENIED,
  SERVICE_TIME_NAME_INVALID,
  SERVICE_TIME_NO_CHURCH,
  SERVICE_TIME_NOT_FOUND,
  SERVICE_TIME_PATCH_COLUMNS,
  SERVICE_TIME_TIME_INVALID,
  SERVICE_TIME_WEEKDAY_INVALID,
  WEEKDAY_LABELS,
  createServiceTime,
  deleteServiceTime,
  fetchChurchServiceTimes,
  fetchPublicServiceTimes,
  formatStartsAt,
  updateServiceTime,
  validateServiceTimeDraft,
  weekdayLabel,
  type ServiceTimeDraft,
} from '@/services/data/serviceTimeService'

/**
 * Horários de culto (0023). A projeção do serviço é o contrato do que chega ao
 * navegador — por isso um dos casos abaixo confere cada coluna projetada com o
 * DDL da migração, como em filiais. A audiência (membro ativo lê a própria;
 * `anon` só lê igreja aprovada e ativa) é especificada na suíte SQL (grupo Q);
 * aqui fica o que é decisão de código: gate `church.manage` antes de qualquer
 * consulta, normalização `hh:mm` → `hh:mm:ss`, e erro de banco sem oráculo.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

let readResult: { data: unknown; error: unknown } = { data: [], error: null }
const chain = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  maybeSingle: vi.fn(),
  // A leitura termina em `.order()`/`.eq()` e é esperada com `await query`; o
  // builder real é thenable, e a cadeia simulada precisa ser também. O delete
  // também: termina em `.select('id')` e resolve por aqui.
  then: vi.fn(),
}
const from = vi.fn()

const ddl = tableBlock('0023_church_service_times.sql', 'church_service_times')

function validDraft(overrides: Partial<ServiceTimeDraft> = {}): ServiceTimeDraft {
  return { branchId: null, weekday: 0, startsAt: '09:00', name: '  Culto da Família  ', ...overrides }
}

beforeEach(() => {
  backend.supabase = { from }
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.delete.mockReturnValue(chain)
  chain.maybeSingle.mockResolvedValue({ data: null, error: null })
  chain.then.mockImplementation((onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
    Promise.resolve(readResult).then(onFulfilled, onRejected),
  )
  readResult = { data: [], error: null }
  from.mockReturnValue(chain)
})

afterEach(() => {
  vi.restoreAllMocks()
  backend.supabase = null
})

describe('projeção — o que chega ao navegador', () => {
  it('toda coluna projetada existe na tabela da migração 0023', () => {
    for (const column of SERVICE_TIME_COLUMNS) {
      expect(hasColumn(ddl, column), `church_service_times.${column}`).toBe(true)
    }
  })

  it('a criação envia a igreja da sessão; a edição não envia church_id', () => {
    expect(SERVICE_TIME_INSERT_COLUMNS).toContain('church_id')
    expect(SERVICE_TIME_PATCH_COLUMNS).not.toContain('church_id')
    for (const column of SERVICE_TIME_PATCH_COLUMNS) {
      expect(SERVICE_TIME_INSERT_COLUMNS).toContain(column)
    }
  })
})

describe('leitura real — contrato da consulta', () => {
  it('membro pede a projeção, a ordem de semana/hora e o recorte pela igreja', async () => {
    await fetchChurchServiceTimes('ch1', { role: 'church_admin' })
    expect(from).toHaveBeenCalledWith('church_service_times')
    expect(chain.select).toHaveBeenCalledWith(SERVICE_TIME_COLUMNS.join(','))
    expect(chain.order).toHaveBeenCalledWith('weekday')
    expect(chain.order).toHaveBeenCalledWith('starts_at')
    expect(chain.eq).toHaveBeenCalledWith('church_id', 'ch1')
  })

  it('SuperAdmin não recorta por igreja: nenhuma chamada .eq', async () => {
    await fetchChurchServiceTimes(undefined, { role: 'superadmin' })
    expect(chain.select).toHaveBeenCalledWith(SERVICE_TIME_COLUMNS.join(','))
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('sem igreja na sessão e sem ser SuperAdmin não sai consulta nenhuma', async () => {
    expect(await fetchChurchServiceTimes(undefined, { role: 'church_admin' })).toEqual([])
    expect(await fetchChurchServiceTimes(undefined, { role: 'manager' })).toEqual([])
    expect(await fetchChurchServiceTimes()).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('a vitrine pública consulta sem recorte local: quem decide o anon é a política', async () => {
    await fetchPublicServiceTimes()
    expect(chain.eq).not.toHaveBeenCalled()
    expect(chain.select).toHaveBeenCalledWith(SERVICE_TIME_COLUMNS.join(','))
  })

  it('erro na leitura não recorre à lista fictícia', async () => {
    readResult = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchChurchServiceTimes('ch1', { role: 'church_admin' })).rejects.toThrow('falha de rede')
  })
})

describe('validateServiceTimeDraft', () => {
  it('recusa nome fora de 2 a 80 caracteres', () => {
    expect(validateServiceTimeDraft(validDraft({ name: '  a  ' }))).toBe(SERVICE_TIME_NAME_INVALID)
    expect(validateServiceTimeDraft(validDraft({ name: 'x'.repeat(81) }))).toBe(SERVICE_TIME_NAME_INVALID)
  })

  it('recusa dia fora de 0 a 6 ou fração', () => {
    expect(validateServiceTimeDraft(validDraft({ weekday: 7 }))).toBe(SERVICE_TIME_WEEKDAY_INVALID)
    expect(validateServiceTimeDraft(validDraft({ weekday: -1 }))).toBe(SERVICE_TIME_WEEKDAY_INVALID)
    expect(validateServiceTimeDraft(validDraft({ weekday: 1.5 }))).toBe(SERVICE_TIME_WEEKDAY_INVALID)
  })

  it('recusa hora que não é hh:mm de 24h', () => {
    for (const bad of ['9:00', '09:0', '24:00', '09:60', '', '0900']) {
      expect(validateServiceTimeDraft(validDraft({ startsAt: bad })), bad).toBe(SERVICE_TIME_TIME_INVALID)
    }
    expect(validateServiceTimeDraft(validDraft({ startsAt: '23:59' }))).toBeNull()
    expect(validateServiceTimeDraft(validDraft({ startsAt: '00:00' }))).toBeNull()
  })

  it('aceita rascunho válido com e sem filial', () => {
    expect(validateServiceTimeDraft(validDraft())).toBeNull()
    expect(validateServiceTimeDraft(validDraft({ branchId: 'br-1' }))).toBeNull()
  })
})

describe('escritas — portas de permissão', () => {
  it('papel sem church.manage não escreve, e nenhuma consulta sai', async () => {
    for (const role of ['manager', 'communicator', 'pastor', 'visitor'] as const) {
      const actor = { churchId: 'ch1', role }
      expect(await createServiceTime(validDraft(), actor)).toEqual({ ok: false, error: SERVICE_TIME_MANAGE_DENIED })
      expect(await updateServiceTime('t1', validDraft(), actor)).toEqual({ ok: false, error: SERVICE_TIME_MANAGE_DENIED })
      expect(await deleteServiceTime('t1', actor)).toEqual({ ok: false, error: SERVICE_TIME_MANAGE_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('a porta vem antes da validação: papel errado recebe a mensagem de permissão', async () => {
    expect(await createServiceTime(validDraft({ name: 'x' }), { churchId: 'ch1', role: 'communicator' }))
      .toEqual({ ok: false, error: SERVICE_TIME_MANAGE_DENIED })
  })

  it('SuperAdmin tem church.manage, mas sem igreja na sessão não cria', async () => {
    expect(await createServiceTime(validDraft(), { role: 'superadmin' })).toEqual({ ok: false, error: SERVICE_TIME_NO_CHURCH })
  })

  it('validação vem antes do banco: rascunho inválido não dispara consulta', async () => {
    expect(await createServiceTime(validDraft({ startsAt: '9h' }), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: SERVICE_TIME_TIME_INVALID })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('escrita real — contrato e erros do banco', () => {
  it('a criação envia só colunas reais, com a igreja da sessão e o nome aparado', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 't1', church_id: 'ch-real' }, error: null })
    const result = await createServiceTime(validDraft(), { churchId: 'ch-real', role: 'church_admin' })
    expect(result.ok).toBe(true)
    const enviado = chain.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(enviado.church_id).toBe('ch-real')
    expect(enviado.name).toBe('Culto da Família')
    expect(enviado.starts_at).toBe('09:00:00')
    expect(Object.keys(enviado).sort()).toEqual([...SERVICE_TIME_INSERT_COLUMNS].sort())
    expect(chain.select).toHaveBeenCalledWith(SERVICE_TIME_COLUMNS.join(','))
  })

  it('filial em branco vira null, não string vazia', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 't1' }, error: null })
    await createServiceTime(validDraft({ branchId: '   ' }), { churchId: 'ch1', role: 'church_admin' })
    expect(chain.insert.mock.calls[0]![0]).toHaveProperty('branch_id', null)
  })

  it('a edição não envia church_id e recorta pelo id', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 't1' }, error: null })
    await updateServiceTime('t1', validDraft({ weekday: 2, startsAt: '19:30' }), { churchId: 'ch1', role: 'church_admin' })
    const patch = chain.update.mock.calls[0]![0] as Record<string, unknown>
    expect(patch).not.toHaveProperty('church_id')
    expect(Object.keys(patch).sort()).toEqual([...SERVICE_TIME_PATCH_COLUMNS].sort())
    expect(patch.starts_at).toBe('19:30:00')
    expect(chain.eq).toHaveBeenCalledWith('id', 't1')
  })

  it('linha que não volta é a mesma mensagem de não-existente: sem oráculo', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await updateServiceTime('t-outra-igreja', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: SERVICE_TIME_NOT_FOUND })
  })

  it.each([
    ['política de gestão', '42501', 'new row violates row-level security policy', SERVICE_TIME_MANAGE_DENIED],
    ['check de formato', '23514', 'violates check constraint', 'O banco recusou o formato: dia da semana fora de 0 a 6, horário inválido ou nome fora de 2 a 80 caracteres.'],
    ['igreja/filial inexistente', '23503', 'violates foreign key constraint', 'Igreja ou filial não encontrada. Atualize a lista e tente de novo.'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { code, message } })
    expect(await createServiceTime(validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: esperado })
  })
})

describe('delete real', () => {
  it('linha devolvida é sucesso; nenhuma linha é não-existente, não sucesso silencioso', async () => {
    readResult = { data: [{ id: 't1' }], error: null }
    expect(await deleteServiceTime('t1', { churchId: 'ch1', role: 'church_admin' })).toEqual({ ok: true })
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 't1')

    readResult = { data: [], error: null }
    expect(await deleteServiceTime('t-que-nao-e-minha', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: SERVICE_TIME_NOT_FOUND })
  })

  it('erro do banco no delete também vira mensagem legível', async () => {
    readResult = { data: null, error: { code: '42501', message: 'row-level security' } }
    expect(await deleteServiceTime('t1', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: SERVICE_TIME_MANAGE_DENIED })
  })
})

describe('formatadores da tela', () => {
  it('time do Postgres chega com segundos e a tela mostra hh:mm', () => {
    expect(formatStartsAt('09:00:00')).toBe('09:00')
    expect(formatStartsAt('19:30')).toBe('19:30')
  })

  it('a semana começa no domingo, como o CHECK da 0023', () => {
    expect(WEEKDAY_LABELS).toHaveLength(7)
    expect(WEEKDAY_LABELS[0]).toBe('Domingo')
    expect(weekdayLabel(0)).toBe('Domingo')
    expect(weekdayLabel(6)).toBe('Sábado')
    expect(weekdayLabel(9)).toBe('9')
  })
})

function tableBlock(migration: string, table: string) {
  const sql = readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada em ${migration}`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

function hasColumn(block: string, column: string) {
  return new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(block)
}
