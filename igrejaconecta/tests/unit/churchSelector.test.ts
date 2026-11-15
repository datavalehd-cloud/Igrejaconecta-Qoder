import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// O cliente real é criado no topo do módulo auth; o mock é o mesmo objeto que o
// backend lê quando `createSupabaseBackend()` é chamado — por isso o `from` e o
// resultado das tabelas podem ser trocados caso a caso.
const backend = vi.hoisted(() => ({ supabase: null as unknown }))
vi.mock('@/services/supabase/client', () => backend)

import { createSupabaseBackend } from '@/services/auth/supabaseBackend'
import { CHURCH_SELECTOR_KEY, readSelectedChurchId, writeSelectedChurchId } from '@/services/auth/churchSelector'

interface QueryResult {
  data: unknown
  error: unknown
}

/**
 * Tabela falsa que aceita as duas formas de leitura usadas em `loadSession`:
 * terminal (`maybeSingle()`) e o próprio builder aguardado direto, como o
 * supabase-js permite. `setResult` troca a resposta sem reinventar o builder.
 */
interface FakeTable {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (onFulfilled?: (value: QueryResult) => unknown) => unknown
  setResult: (next: QueryResult) => void
}

function makeTable(result: QueryResult): FakeTable {
  let current = result
  const table: FakeTable = {
    select: vi.fn(() => table),
    eq: vi.fn(() => table),
    order: vi.fn(() => table),
    maybeSingle: vi.fn(async () => current),
    then: (onFulfilled) => Promise.resolve(current).then(onFulfilled),
    setResult: (next) => {
      current = next
    },
  }
  return table
}

const PROFILE_ROW = {
  id: 'u1',
  full_name: 'Ana Admin',
  email: 'ana@exemplo.org',
  phone: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const SB_SESSION = {
  user: { id: 'u1', email: PROFILE_ROW.email, user_metadata: { full_name: PROFILE_ROW.full_name }, created_at: PROFILE_ROW.created_at },
}

const OK = { data: null, error: null }

interface Tables {
  profiles: FakeTable
  church_members: FakeTable
  churches: FakeTable
}

function installClient(tables: Tables) {
  const from = vi.fn((name: string) => tables[name as keyof Tables] ?? makeTable(OK))
  backend.supabase = {
    from,
    auth: {
      getSession: vi.fn(async () => ({ data: { session: SB_SESSION } })),
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: [] } })),
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' } })),
      },
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  }
  return from
}

function freshTables(memberships: unknown[]): Tables {
  return {
    profiles: makeTable({ data: PROFILE_ROW, error: null }),
    church_members: makeTable({ data: memberships, error: null }),
    churches: makeTable({ data: null, error: null }),
  }
}

function installLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  return store
}

async function restore() {
  return await createSupabaseBackend().restore()
}

describe('chave local da escolha de igreja', () => {
  beforeEach(() => installLocalStorage())
  afterEach(() => vi.unstubAllGlobals())

  it('grava e devolve a igreja escolhida', () => {
    writeSelectedChurchId('ch-1')
    expect(readSelectedChurchId()).toBe('ch-1')
  })

  it('null limpa a chave (modo somente plataforma não deixa rastro)', () => {
    writeSelectedChurchId('ch-1')
    writeSelectedChurchId(null)
    expect(readSelectedChurchId()).toBeNull()
  })

  it('grava na chave combinada do app', () => {
    const store = installLocalStorage()
    writeSelectedChurchId('ch-9')
    expect(store.get(CHURCH_SELECTOR_KEY)).toBe('ch-9')
  })

  it('storage quebrado não lança: ler dá null e gravar é melhor esforço', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(readSelectedChurchId()).toBeNull()
    expect(() => writeSelectedChurchId('ch-1')).not.toThrow()
    expect(() => writeSelectedChurchId(null)).not.toThrow()
  })
})

describe('loadSession: a escolha só vale para SuperAdmin e conferida no banco', () => {
  beforeEach(() => installLocalStorage())
  afterEach(() => vi.unstubAllGlobals())

  it('SuperAdmin com escolha existente opera na igreja escolhida', async () => {
    const tables = freshTables([{ church_id: 'ch-sede', roles: { key: 'superadmin' } }])
    installClient(tables)
    tables.churches.setResult({ data: { id: 'ch-outra' }, error: null })
    writeSelectedChurchId('ch-outra')

    const session = await restore()
    expect(session?.role).toBe('superadmin')
    expect(session?.churchId).toBe('ch-outra')
    expect(tables.churches.eq).toHaveBeenCalledWith('id', 'ch-outra')
  })

  it('escolha que o banco não devolve não vira igreja ativa (linha sumida ou RLS)', async () => {
    const tables = freshTables([{ church_id: 'ch-sede', roles: { key: 'superadmin' } }])
    installClient(tables)
    tables.churches.setResult({ data: null, error: null })
    writeSelectedChurchId('ch-apagada')

    const session = await restore()
    expect(session?.churchId).toBeUndefined()
    expect(tables.churches.eq).toHaveBeenCalled()
  })

  it('sonda que falha no banco também resulta em sem igreja, não na última conhecida', async () => {
    const tables = freshTables([{ church_id: 'ch-sede', roles: { key: 'superadmin' } }])
    installClient(tables)
    tables.churches.setResult({ data: { id: 'ch-qualquer' }, error: { message: 'network' } })
    writeSelectedChurchId('ch-x')

    const session = await restore()
    expect(session?.churchId).toBeUndefined()
  })

  it('SuperAdmin sem escolha nenhuma segue sem igreja e nem consulta churches', async () => {
    const tables = freshTables([{ church_id: 'ch-sede', roles: { key: 'superadmin' } }])
    const from = installClient(tables)

    const session = await restore()
    expect(session?.role).toBe('superadmin')
    expect(session?.churchId).toBeUndefined()
    expect(from).not.toHaveBeenCalledWith('churches')
  })

  it('church_admin com chave forjada mantém a igreja da associação e churches não é consultada', async () => {
    const tables = freshTables([{ church_id: 'ch-sede', roles: { key: 'church_admin' } }])
    const from = installClient(tables)
    tables.churches.setResult({ data: { id: 'ch-alheia' }, error: null })
    writeSelectedChurchId('ch-alheia')

    const session = await restore()
    expect(session?.role).toBe('church_admin')
    // O ponto do caso: forjar a chave no navegador não move a igreja de ninguém.
    expect(session?.churchId).toBe('ch-sede')
    expect(from).not.toHaveBeenCalledWith('churches')
  })

  it('visitor sem associação com chave forjada segue sem igreja', async () => {
    const tables = freshTables([])
    const from = installClient(tables)
    writeSelectedChurchId('ch-alheia')

    const session = await restore()
    expect(session?.role).toBe('visitor')
    expect(session?.churchId).toBeUndefined()
    expect(from).not.toHaveBeenCalledWith('churches')
  })

  it('a escolha do SuperAdmin é revalidada a cada leitura, não só no clique', async () => {
    const tables = freshTables([{ church_id: 'ch-sede', roles: { key: 'superadmin' } }])
    installClient(tables)
    writeSelectedChurchId('ch-boa')

    tables.churches.setResult({ data: { id: 'ch-boa' }, error: null })
    expect((await restore())?.churchId).toBe('ch-boa')
    // A linha deixou de existir (rejeição/apagada): a próxima leitura já derruba.
    tables.churches.setResult({ data: null, error: null })
    expect((await restore())?.churchId).toBeUndefined()
  })
})
