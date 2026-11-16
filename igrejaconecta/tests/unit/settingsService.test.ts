import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUDIT_RETENTION_OPTIONS,
  PLATFORM_SETTING_KEY,
  PRIVACY_SETTING_KEY,
  SETTING_COLUMNS,
  SETTINGS_DENIED,
  SETTINGS_NAME_INVALID,
  SETTINGS_NOT_SAVED,
  fetchSystemSettings,
  parsePlatformSettings,
  parsePrivacySettings,
  platformValue,
  privacyValue,
  saveSystemSettings,
  validatePlatformDraft,
  type SystemSettingRow,
} from '@/services/data/settingsService'

/**
 * `system_settings` (0001/0002). A política SQL só abre leitura e escrita para
 * `is_superadmin()` e a suíte já mede isso (A4/B6/B7/C12); os casos daqui
 * garantem a primeira camada: sem SuperAdmin nenhuma consulta sai do navegador,
 * o upsert vai com `on conflict key`, e a linha que não volta NUNCA vira
 * "salvo". Os parsers são conferidos contra o JSON real do `seed.sql` — se o
 * seed mudar de forma e a tela parar de entender, este arquivo vermelheira.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

let readResult: { data: unknown; error: unknown } = { data: [], error: null }
const chain = {
  select: vi.fn(),
  order: vi.fn(),
  upsert: vi.fn(),
  maybeSingle: vi.fn(),
  // A leitura termina em `.order()` e é esperada com `await query`; o builder
  // real é thenable, e a cadeia simulada precisa ser também.
  then: vi.fn(),
}
const from = vi.fn()

const settingsDdl = tableBlock('0001_initial_schema.sql', 'system_settings')
const seedSql = readFileSync(new URL('../../supabase/seed.sql', import.meta.url), 'utf8')

function seedValue(key: string): Record<string, unknown> {
  const match = seedSql.match(new RegExp(`\\('${key}',\\s*'([^']+)'::jsonb\\)`))
  if (!match) throw new Error(`linha '${key}' não encontrada no seed.sql`)
  return JSON.parse(match[1])
}

function seedRow(key: string, value: Record<string, unknown>): SystemSettingRow {
  return { key, value, updated_at: '2026-11-15T12:00:00Z' }
}

beforeEach(() => {
  backend.supabase = { from }
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.upsert.mockReturnValue(chain)
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
  it('toda coluna projetada existe na tabela da migração 0001', () => {
    for (const column of SETTING_COLUMNS) {
      expect(hasColumn(settingsDdl, column), `system_settings.${column}`).toBe(true)
    }
  })
})

describe('leitura — gate superadmin antes de qualquer consulta', () => {
  it.each(['church_admin', 'pastor', 'manager', 'communicator', 'visitor', undefined] as const)(
    'papel %s não dispara consulta nenhuma e recebe lista vazia',
    async (role) => {
      expect(await fetchSystemSettings(role)).toEqual([])
      expect(from).not.toHaveBeenCalled()
    },
  )

  it('superadmin pede a projeção e a ordem por chave', async () => {
    readResult = { data: [], error: null }
    await fetchSystemSettings('superadmin')
    expect(from).toHaveBeenCalledWith('system_settings')
    expect(chain.select).toHaveBeenCalledWith(SETTING_COLUMNS.join(','))
    expect(chain.order).toHaveBeenCalledWith('key')
  })

  it('erro na leitura não recorre a valor de consola: lança', async () => {
    readResult = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchSystemSettings('superadmin')).rejects.toThrow('falha de rede')
  })

  it('banco sem linha nenhuma é estado legítimo devolvido como vazio', async () => {
    readResult = { data: [], error: null }
    expect(await fetchSystemSettings('superadmin')).toEqual([])
  })
})

describe('escrita — gate, upsert e a resposta do banco', () => {
  it.each(['church_admin', 'communicator', 'visitor', undefined] as const)(
    'papel %s não grava, e nenhuma consulta sai',
    async (role) => {
      expect(await saveSystemSettings(PLATFORM_SETTING_KEY, { name: 'X' }, role)).toEqual({
        ok: false,
        error: SETTINGS_DENIED,
      })
    },
  )
  it('o gate vem antes de qualquer consulta', async () => {
    await saveSystemSettings(PLATFORM_SETTING_KEY, { name: 'X' }, 'church_admin')
    expect(from).not.toHaveBeenCalled()
  })

  it('envia chave, valor e carimpo ISO com on conflict pela chave', async () => {
    const value = seedValue('platform')
    const saved = seedRow(PLATFORM_SETTING_KEY, value)
    chain.maybeSingle.mockResolvedValue({ data: saved, error: null })
    const result = await saveSystemSettings(PLATFORM_SETTING_KEY, value, 'superadmin')
    expect(result).toEqual({ ok: true, setting: saved })
    expect(chain.upsert).toHaveBeenCalledTimes(1)
    const [row, options] = chain.upsert.mock.calls[0] as [Record<string, unknown>, { onConflict: string }]
    expect(row.key).toBe(PLATFORM_SETTING_KEY)
    expect(row.value).toEqual(value)
    expect(Number.isNaN(Date.parse(row.updated_at as string))).toBe(false)
    expect(options).toEqual({ onConflict: 'key' })
    expect(chain.select).toHaveBeenCalledWith(SETTING_COLUMNS.join(','))
  })

  it('linha que não volta é falha explícita, nunca "salvo"', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await saveSystemSettings(PRIVACY_SETTING_KEY, {}, 'superadmin')).toEqual({
      ok: false,
      error: SETTINGS_NOT_SAVED,
    })
  })

  it.each([
    ['política de escrita', '42501', 'new row violates row-level security policy', SETTINGS_DENIED],
    ['chave duplicada sem on conflict', '23505', 'duplicate key value violates unique constraint', 'duplicate key value violates unique constraint'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { code, message } })
    expect(await saveSystemSettings(PLATFORM_SETTING_KEY, {}, 'superadmin')).toEqual({ ok: false, error: esperado })
  })
})

describe('validatePlatformDraft', () => {
  it('recusa nome aparádo curto ou comprido demais', () => {
    const base = { churchSignup: 'free' as const, mfaRequired: [] }
    expect(validatePlatformDraft({ ...base, name: '  a ' })).toBe(SETTINGS_NAME_INVALID)
    expect(validatePlatformDraft({ ...base, name: 'x'.repeat(121) })).toBe(SETTINGS_NAME_INVALID)
    expect(validatePlatformDraft({ ...base, name: 'Igreja Conecta' })).toBeNull()
  })
})

describe('parsers vs seed real', () => {
  it('entende a linha platform exatamente como o seed.sql a escreve', () => {
    const parsed = parsePlatformSettings(seedRow(PLATFORM_SETTING_KEY, seedValue('platform')))
    expect(parsed).toEqual({
      name: 'IgrejaConecta',
      churchSignup: 'free',
      mfaRequired: ['superadmin', 'church_admin'],
      updatedAt: '2026-11-15T12:00:00Z',
    })
  })

  it('round-trip: o valor gravado pelo formulário é o formato do seed', () => {
    const value = seedValue('platform')
    const parsed = parsePlatformSettings(seedRow(PLATFORM_SETTING_KEY, value))
    expect(parsed).not.toBeNull()
    expect(JSON.stringify(platformValue({ name: parsed!.name!, churchSignup: parsed!.churchSignup, mfaRequired: parsed!.mfaRequired })))
      .toBe(JSON.stringify(value))
  })

  it('entende a linha privacy exatamente como o seed.sql a escreve', () => {
    const parsed = parsePrivacySettings(seedRow(PRIVACY_SETTING_KEY, seedValue('privacy')))
    expect(parsed).toEqual({
      auditRetentionMonths: 12,
      locationSearchStorage: 'none',
      communicationOptIn: true,
      updatedAt: '2026-11-15T12:00:00Z',
    })
    expect(JSON.stringify(privacyValue({ auditRetentionMonths: 12, locationSearchStorage: 'none', communicationOptIn: true })))
      .toBe(JSON.stringify(seedValue('privacy')))
  })

  it('sem linha o parser devolve null: nada é inventado no lugar do banco', () => {
    expect(parsePlatformSettings(undefined)).toBeNull()
    expect(parsePrivacySettings(undefined)).toBeNull()
  })

  it('valor fora do tipo vira null/opção conhecida, não chute inventado', () => {
    const platform = parsePlatformSettings(seedRow(PLATFORM_SETTING_KEY, { name: '   ', church_signup: 'convite', mfa_required: 'sim' }))
    expect(platform!.name).toBeNull()
    expect(platform!.churchSignup).toBe('free')
    expect(platform!.mfaRequired).toEqual([])

    const privacy = parsePrivacySettings(seedRow(PRIVACY_SETTING_KEY, { audit_retention_months: 999, location_search_storage: '7d', communication_opt_in: 'sim' }))
    expect(privacy!.auditRetentionMonths).toBeNull()
    expect(privacy!.locationSearchStorage).toBe('none')
    expect(privacy!.communicationOptIn).toBeNull()
  })

  it('as opções da tela são as que o parser aceita', () => {
    expect(AUDIT_RETENTION_OPTIONS).toEqual([12, 24, 60])
    for (const months of AUDIT_RETENTION_OPTIONS) {
      expect(parsePrivacySettings(seedRow(PRIVACY_SETTING_KEY, { audit_retention_months: months }))!.auditRetentionMonths).toBe(months)
    }
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
