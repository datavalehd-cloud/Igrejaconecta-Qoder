import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VISITOR_ALREADY_FAVORITE,
  VISITOR_FAVORITE_COLUMNS,
  VISITOR_FAVORITE_INSERT_COLUMNS,
  VISITOR_LOGIN_REQUIRED,
  VISITOR_NOT_FAVORITE,
  addVisitorFavorite,
  fetchVisitorFavorites,
  removeVisitorFavorite,
} from '@/services/data/visitorFavoriteService'
import {
  VISITOR_CITY_MAX,
  VISITOR_INTERESTS,
  VISITOR_INTEREST_UNSUPPORTED,
  VISITOR_PREFERENCE_COLUMNS,
  VISITOR_PREFERENCE_LOGIN_REQUIRED,
  VISITOR_PREFERENCE_NOT_SAVED,
  VISITOR_PREFERENCE_PATCH_COLUMNS,
  buildVisitorPreferencePatch,
  fetchVisitorPreferences,
  normalizeInterests,
  saveVisitorPreferences,
  validateVisitorPreference,
  type VisitorPreferenceDraft,
} from '@/services/data/visitorPreferenceService'
import { REGISTRATION_EVENT_EMBED, fetchMyRegistrations } from '@/services/data/registrationService'
import type { VisitorInterest } from '@/types'

/**
 * M3d — a última tela que lia a loja de mocks passou a ler `visitor_favorites` e
 * `visitor_preferences` (0016), e o histórico de inscrições do visitante passou a
 * sair de `event_registrations` pelo id da sessão.
 *
 * O que estes testes seguram é o payload: as duas tabelas são de uma pessoa só
 * (`user_id = auth.uid()` em USING **e** em WITH CHECK), então a única maneira de
 * escrever na linha errada é mandar a coluna errada. A recusa de audiência em si é
 * do grupo R da suíte SQL; aqui fica a prova de que o app nunca pede o que o banco
 * não deixaria, e nunca consulta sem sessão.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

let result: { data: unknown; error: unknown } = { data: null, error: null }

const chain: Record<string, ReturnType<typeof vi.fn>> = {}
for (const method of ['select', 'eq', 'order', 'insert', 'delete', 'upsert', 'maybeSingle', 'then']) {
  chain[method] = vi.fn()
}
for (const method of ['select', 'eq', 'order', 'insert', 'delete', 'upsert']) {
  chain[method]!.mockImplementation(() => chain)
}
chain.maybeSingle!.mockImplementation(async () => result)
chain.then!.mockImplementation((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
  Promise.resolve(result).then(onFulfilled, onRejected),
)
const from = vi.fn(() => chain)

function wire() {
  backend.supabase = { from }
  for (const method of ['select', 'eq', 'order', 'insert', 'delete', 'upsert']) {
    chain[method]!.mockImplementation(() => chain)
  }
  chain.maybeSingle!.mockImplementation(async () => result)
  chain.then!.mockImplementation((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected),
  )
  from.mockImplementation(() => chain)
  result = { data: null, error: null }
}

beforeEach(() => {
  vi.resetAllMocks()
  wire()
})

afterEach(() => {
  vi.restoreAllMocks()
  backend.supabase = null
})

const migration = readFileSync(new URL('../../supabase/migrations/0016_visitor_favorites_preferences.sql', import.meta.url), 'utf8')
const favoritesDdl = tableBlock('visitor_favorites')
const preferencesDdl = tableBlock('visitor_preferences')

function draft(overrides: Partial<VisitorPreferenceDraft> = {}): VisitorPreferenceDraft {
  return { city: 'Jacutinga', interests: ['jovens', 'familia'], ...overrides }
}

describe('favoritos — a projeção é a tabela da 0016', () => {
  it('as colunas lidas são exatamente as três de visitor_favorites', () => {
    expect(ddlColumns(favoritesDdl)).toEqual([...VISITOR_FAVORITE_COLUMNS])
  })

  it('o insert manda só o par (conta, evento): created_at é default do banco', () => {
    expect(VISITOR_FAVORITE_INSERT_COLUMNS).toEqual(['user_id', 'event_id'])
    expect(VISITOR_FAVORITE_INSERT_COLUMNS).not.toContain('created_at' as never)
  })

  it('a política é a própria conta nos dois lados, e o grant não tem update', () => {
    const block = policyBlock('visitor_favorites_self')
    expect(block).toMatch(/using \(user_id = auth\.uid\(\)\)/)
    expect(block).toMatch(/with check \(user_id = auth\.uid\(\)\)/)
    // Sem UPDATE na tabela, a lista muda por insert/delete — é o que o serviço faz.
    expect(grantLines('visitor_favorites').join(' ')).toContain('select, insert, delete')
    expect(grantLines('visitor_favorites').join(' ')).not.toContain('update')
  })
})

describe('favoritos — leitura da própria conta', () => {
  it('pede a tabela, a projeção e o recorte pelo id da sessão, do mais recente ao mais antigo', async () => {
    const rows = [{ user_id: 'u1', event_id: 'e1', created_at: '2026-11-10T12:00:00Z' }]
    result = { data: rows, error: null }
    expect(await fetchVisitorFavorites('u1')).toEqual(rows)
    expect(from).toHaveBeenCalledWith('visitor_favorites')
    expect(chain.select).toHaveBeenCalledWith(VISITOR_FAVORITE_COLUMNS.join(','))
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('sem sessão não sai consulta nenhuma — e o retorno é lista vazia, não erro', async () => {
    expect(await fetchVisitorFavorites()).toEqual([])
    expect(await fetchVisitorFavorites('')).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('erro na leitura não recorre a favorito inventado', async () => {
    result = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchVisitorFavorites('u1')).rejects.toThrow('falha de rede')
  })
})

describe('favoritos — escrita', () => {
  it('salvar insere o par literal e devolve a linha confirmada', async () => {
    const row = { user_id: 'u1', event_id: 'e9', created_at: '2026-11-13T10:00:00Z' }
    result = { data: row, error: null }
    expect(await addVisitorFavorite('e9', 'u1')).toEqual({ ok: true, favorite: row })
    expect(chain.insert).toHaveBeenCalledWith({ user_id: 'u1', event_id: 'e9' })
    expect(chain.insert!.mock.calls[0]![0]).not.toHaveProperty('created_at')
    expect(chain.select).toHaveBeenCalledWith(VISITOR_FAVORITE_COLUMNS.join(','))
  })

  it('remover pelo par (conta, evento): a PK composta dispensa o id', async () => {
    result = { data: [{ event_id: 'e9' }], error: null }
    expect(await removeVisitorFavorite('e9', 'u1')).toEqual({ ok: true })
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq.mock.calls.map((call) => call)).toEqual([
      ['user_id', 'u1'],
      ['event_id', 'e9'],
    ])
    expect(chain.select).toHaveBeenCalledWith('event_id')
  })

  it('sem conta os dois botões recusam antes de tocar no banco', async () => {
    expect(await addVisitorFavorite('e9')).toEqual({ ok: false, error: VISITOR_LOGIN_REQUIRED })
    expect(await removeVisitorFavorite('e9', '')).toEqual({ ok: false, error: VISITOR_LOGIN_REQUIRED })
    expect(from).not.toHaveBeenCalled()
  })

  it('linha que não voltou no delete diz "não estava na lista", sem dizer se existe', async () => {
    result = { data: [], error: null }
    expect(await removeVisitorFavorite('e9', 'u1')).toEqual({ ok: false, error: VISITOR_NOT_FAVORITE })
  })

  it.each([
    ['policy recusando', '42501', VISITOR_LOGIN_REQUIRED],
    ['par duplicado', '23505', VISITOR_ALREADY_FAVORITE],
    ['evento que sumiu', '23503', 'Não foi possível salvar o favorito: o evento não está mais disponível.'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, esperado) => {
    result = { data: null, error: { code, message: 'row-level security' } }
    expect(await addVisitorFavorite('e9', 'u1')).toEqual({ ok: false, error: esperado })
  })

  it('inserir sem linha de volta não é sucesso silencioso', async () => {
    result = { data: null, error: null }
    expect(await addVisitorFavorite('e9', 'u1')).toEqual({ ok: false, error: VISITOR_NOT_FAVORITE })
  })
})

describe('preferências — a projeção e os CHECKs da 0016', () => {
  it('as colunas lidas são exatamente as quatro de visitor_preferences', () => {
    expect(ddlColumns(preferencesDdl)).toEqual([...VISITOR_PREFERENCE_COLUMNS])
  })

  it('os interesses da tela são os do CHECK, na mesma ordem e sem tiktok', () => {
    const match = preferencesDdl.match(/array\[([^\]]+)\]/)
    expect(match, 'CHECK de interests sumiu da migração').not.toBeNull()
    const allowed = match![1]!.split(',').map((item) => item.trim().replaceAll("'", ''))
    expect([...VISITOR_INTERESTS]).toEqual(allowed)
    expect(VISITOR_INTERESTS).not.toContain('tiktok' as never)
  })

  it('o limite de cidade é o do CHECK da tabela', () => {
    const match = preferencesDdl.match(/char_length\(btrim\(city\)\) <= (\d+)/)
    expect(match, 'CHECK de city sumiu da migração').not.toBeNull()
    expect(VISITOR_CITY_MAX).toBe(Number(match![1]))
  })

  it('o patch tem exatamente as três colunas do formulário — updated_at é trigger', () => {
    expect(Object.keys(buildVisitorPreferencePatch(draft(), 'u1'))).toEqual([...VISITOR_PREFERENCE_PATCH_COLUMNS])
    expect(VISITOR_PREFERENCE_PATCH_COLUMNS).not.toContain('updated_at' as never)
  })

  it('cidade aparada e vazia viram null; interesse repetido sai uma vez, na ordem do CHECK', () => {
    expect(buildVisitorPreferencePatch(draft({ city: '  ' }), 'u1')).toEqual({
      user_id: 'u1',
      city: null,
      interests: ['jovens', 'familia'],
    })
    expect(buildVisitorPreferencePatch(draft({ city: ' Jacutinga ' }), 'u1').city).toBe('Jacutinga')
    expect(normalizeInterests(['familia', 'jovens', 'jovens', 'acao_social'])).toEqual([
      'jovens',
      'familia',
      'acao_social',
    ])
  })

  it('a escrita é upsert pela chave da conta: um round trip, sem "existe? então update"', async () => {
    const row = { user_id: 'u1', city: 'Jacutinga', interests: ['jovens', 'familia'], updated_at: '2026-11-13T10:00:00Z' }
    result = { data: row, error: null }
    expect(await saveVisitorPreferences(draft(), { userId: 'u1' })).toEqual({ ok: true, preferences: row })
    expect(from).toHaveBeenCalledWith('visitor_preferences')
    expect(chain.upsert).toHaveBeenCalledWith(buildVisitorPreferencePatch(draft(), 'u1'), { onConflict: 'user_id' })
    expect(chain.select).toHaveBeenCalledWith(VISITOR_PREFERENCE_COLUMNS.join(','))
  })

  it('sem sessão não se consulta nem se escreve preferência de ninguém', async () => {
    expect(await fetchVisitorPreferences()).toBeNull()
    expect(await saveVisitorPreferences(draft(), {})).toEqual({ ok: false, error: VISITOR_PREFERENCE_LOGIN_REQUIRED })
    expect(from).not.toHaveBeenCalled()
  })

  it('cidade comprida e interesse fora do CHECK são recusados antes do banco', async () => {
    const tooLong = 'a'.repeat(VISITOR_CITY_MAX + 1)
    expect(validateVisitorPreference(draft({ city: tooLong }))).toBe(`A cidade tem no máximo ${VISITOR_CITY_MAX} caracteres.`)
    expect(await saveVisitorPreferences(draft({ city: tooLong }), { userId: 'u1' }))
      .toEqual({ ok: false, error: `A cidade tem no máximo ${VISITOR_CITY_MAX} caracteres.` })
    const rogue = { city: 'Jacutinga', interests: ['tiktok' as VisitorInterest] }
    expect(validateVisitorPreference(rogue)).toBe(VISITOR_INTEREST_UNSUPPORTED)
    expect(await saveVisitorPreferences(rogue, { userId: 'u1' })).toEqual({ ok: false, error: VISITOR_INTEREST_UNSUPPORTED })
    expect(from).not.toHaveBeenCalled()
  })

  it('linha que não volta e policy que recusa dizem a mesma coisa', async () => {
    result = { data: null, error: null }
    expect(await saveVisitorPreferences(draft(), { userId: 'u1' })).toEqual({ ok: false, error: VISITOR_PREFERENCE_NOT_SAVED })
    result = { data: null, error: { code: '42501', message: 'row-level security' } }
    expect(await saveVisitorPreferences(draft(), { userId: 'u1' })).toEqual({
      ok: false,
      error: VISITOR_PREFERENCE_LOGIN_REQUIRED,
    })
  })

  it('23514 do banco é explicado pelos dois CHECKs da tabela', async () => {
    result = { data: null, error: { code: '23514', message: 'violates check constraint' } }
    expect(await saveVisitorPreferences(draft(), { userId: 'u1' })).toEqual({
      ok: false,
      error: `${VISITOR_INTEREST_UNSUPPORTED} A cidade vai até ${VISITOR_CITY_MAX} caracteres.`,
    })
  })

  it('as três políticas de preferência são da própria conta, e o grant não tem delete', () => {
    for (const name of ['visitor_preferences_self_read', 'visitor_preferences_self_write', 'visitor_preferences_self_update']) {
      expect(policyBlock(name), name).toContain('user_id = auth.uid()')
    }
    expect(policyBlock('visitor_preferences_self_update')).toMatch(/using \(user_id = auth\.uid\(\)\)/)
    expect(policyBlock('visitor_preferences_self_update')).toMatch(/with check \(user_id = auth\.uid\(\)\)/)
    expect(grantLines('visitor_preferences').join(' ')).toContain('select, insert, update')
    expect(grantLines('visitor_preferences').join(' ')).not.toContain('delete')
  })

  it('anon não tem grant em nenhuma das duas tabelas', () => {
    for (const table of ['visitor_favorites', 'visitor_preferences']) {
      expect(migration).toContain(`revoke all on public.${table} from anon, authenticated;`)
      for (const line of grantLines(table)) {
        expect(line, `${table} grantada a anon: ${line}`).not.toContain('to anon')
      }
    }
  })
})

describe('histórico — as inscrições do próprio visitante', () => {
  it('a leitura é recortada pelo user_id da sessão, com o embed que dá nome e slug', async () => {
    result = {
      data: [
        {
          id: 'r1',
          event_id: 'e1',
          church_id: 'ch1',
          user_id: 'u1',
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
    }
    const rows = await fetchMyRegistrations('u1')
    expect(from).toHaveBeenCalledWith('event_registrations')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(REGISTRATION_EVENT_EMBED).toContain('slug')
    // A rota pública é /eventos/:slug, e o id do evento não serve de link.
    expect(rows[0]).toMatchObject({ event_name: 'Congresso', event_slug: 'congresso' })
    expect(rows[0]).not.toHaveProperty('events')
  })

  it('sem sessão não sai consulta: inscrição sem dono provado não é lista de ninguém', async () => {
    expect(await fetchMyRegistrations()).toEqual([])
    expect(await fetchMyRegistrations('')).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})

function tableBlock(table: string) {
  const start = migration.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada na 0016`)
  return migration.slice(start, migration.indexOf('\n);', start))
}

/** Os nomes de coluna declarados no bloco CREATE TABLE, na ordem do arquivo. */
function ddlColumns(block: string): string[] {
  const constraints = new Set(['primary', 'constraint', 'foreign', 'unique', 'check'])
  return block
    .split('\n')
    // Coluna é o que está a dois espaços; as linhas de CHECK continuam mais fundo.
    .map((line) => line.match(/^ {2}([a-z_]+)\s+\S/)?.[1])
    .filter((name): name is string => Boolean(name && !constraints.has(name)))
}

function policyBlock(name: string): string {
  const start = migration.indexOf(`create policy ${name} on`)
  if (start < 0) throw new Error(`policy ${name} não encontrada na 0016`)
  return migration.slice(start, migration.indexOf(';', start))
}

function grantLines(table: string): string[] {
  return migration
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('grant') && line.includes(`public.${table} `))
}
