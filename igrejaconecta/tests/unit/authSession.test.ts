import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mesmo esqueleto dos testes do seletor: o `supabase` que o backend de auth lê é
// uma propriedade do módulo mockado, trocada caso a caso.
const backend = vi.hoisted(() => ({ supabase: null as unknown }))
vi.mock('@/services/supabase/client', () => backend)

import { AUTH_SESSION_UNVERIFIED, createSupabaseBackend } from '@/services/auth/supabaseBackend'
import { writeSelectedChurchId } from '@/services/auth/churchSelector'

interface QueryResult {
  data: unknown
  error: unknown
}

interface FakeTable {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (onFulfilled?: (value: QueryResult) => unknown) => unknown
}

function makeTable(result: QueryResult): FakeTable {
  const table: FakeTable = {
    select: vi.fn(() => table),
    eq: vi.fn(() => table),
    order: vi.fn(() => table),
    maybeSingle: vi.fn(async () => result),
    then: (onFulfilled) => Promise.resolve(result).then(onFulfilled),
  }
  return table
}

const SB_SESSION = {
  user: { id: 'u1', email: 'ana@exemplo.org', user_metadata: { full_name: 'Ana' }, created_at: '2026-01-01T00:00:00Z' },
}

const PROFILE = {
  id: 'u1',
  full_name: 'Ana Admin',
  email: 'ana@exemplo.org',
  phone: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const NET_ERROR = { message: 'Network request failed' }
const ADMIN_MEMBERSHIP = [{ church_id: 'ch-sede', roles: { key: 'church_admin' } }]

function installClient(opts: {
  profiles?: QueryResult
  members?: QueryResult
  churches?: QueryResult
  factors?: QueryResult
  aal?: QueryResult
} = {}) {
  const tables = {
    profiles: makeTable(opts.profiles ?? { data: PROFILE, error: null }),
    church_members: makeTable(opts.members ?? { data: ADMIN_MEMBERSHIP, error: null }),
    churches: makeTable(opts.churches ?? { data: null, error: null }),
  }
  let authCallback: ((event: string, session: unknown) => void) | null = null
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: SB_SESSION } })),
    signInWithPassword: vi.fn(async () => ({ data: { session: SB_SESSION }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    mfa: {
      listFactors: vi.fn(async () => opts.factors ?? { data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null }),
      getAuthenticatorAssuranceLevel: vi.fn(async () => opts.aal ?? { data: { currentLevel: 'aal2', nextLevel: 'aal1' }, error: null }),
      challengeAndVerify: vi.fn(async () => ({ data: {}, error: null })),
    },
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
  }
  const from = vi.fn((name: string) => tables[name as keyof typeof tables] ?? makeTable({ data: null, error: null }))
  backend.supabase = { auth, from }
  return { tables, auth, fireAuth: () => authCallback?.('SIGNED_IN', SB_SESSION) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('loadSession fail-closed: erro de leitura não fabrica papel', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('leituras íntegras produzem a sessão completa', async () => {
    installClient()
    const session = await createSupabaseBackend().restore()
    expect(session).toMatchObject({ role: 'church_admin', churchId: 'ch-sede', mfaEnrolled: true, mfaVerified: true })
    expect(session?.profile.full_name).toBe('Ana Admin')
  })

  it('erro em profiles derruba a leitura em vez de esconder atrás do metadado', async () => {
    installClient({ profiles: { data: null, error: NET_ERROR } })
    await expect(createSupabaseBackend().restore()).rejects.toThrow('session-unverified')
  })

  it('erro em church_members não vira visitor silencioso', async () => {
    installClient({ members: { data: [], error: NET_ERROR } })
    await expect(createSupabaseBackend().restore()).rejects.toThrow('session-unverified')
  })

  it('fronteira essencial: lista vazia SEM erro é visitante legítimo', async () => {
    installClient({ members: { data: [], error: null } })
    const session = await createSupabaseBackend().restore()
    expect(session?.role).toBe('visitor')
    expect(session?.churchId).toBeUndefined()
  })

  it('erro na lista de fatores MFA derruba a leitura', async () => {
    installClient({ factors: { data: null, error: NET_ERROR } })
    await expect(createSupabaseBackend().restore()).rejects.toThrow('session-unverified')
  })

  it('erro no nível de garantia derruba a leitura em vez de fingir aal1', async () => {
    installClient({ aal: { data: null, error: NET_ERROR } })
    await expect(createSupabaseBackend().restore()).rejects.toThrow('session-unverified')
  })

  it('a sonda do seletor continua não rebaixando papel: erro só solta a igreja', async () => {
    writeSelectedChurchId('ch-escolhida')
    installClient({
      members: { data: [{ church_id: 'ch-global', roles: { key: 'superadmin' } }], error: null },
      churches: { data: null, error: NET_ERROR },
    })
    const session = await createSupabaseBackend().restore()
    expect(session?.role).toBe('superadmin')
    expect(session?.churchId).toBeUndefined()
  })
})

describe('login e MFA sem sessão fabricada', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('login com banco instável avisa e não emite sessão de visitor', async () => {
    const { auth } = installClient({ members: { data: [], error: NET_ERROR } })
    const emitted: unknown[] = []
    const backendAuth = createSupabaseBackend()
    backendAuth.subscribe((s) => emitted.push(s))

    const result = await backendAuth.login('ana@exemplo.org', 'senha-forte')
    expect(result).toEqual({ ok: false, error: AUTH_SESSION_UNVERIFIED })
    expect(auth.signInWithPassword).toHaveBeenCalled()
    await settle()
    expect(emitted).toEqual([])
  })

  it('confirmar o código MFA com re-read falho não entrega sessão fabricada', async () => {
    // Aal em aal1 com nextLevel aal2 é o que faz o login criar o desafio
    // (pendingFactorId) sem tocar no loadSession — é por onde se chega ao verifyMfa.
    const { auth } = installClient({
      aal: { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null },
      members: { data: [], error: NET_ERROR },
    })
    const backendAuth = createSupabaseBackend()
    const emitted: unknown[] = []
    backendAuth.subscribe((s) => emitted.push(s))

    const loginRes = await backendAuth.login('ana@exemplo.org', 'senha-forte')
    expect(loginRes).toEqual({ ok: true, requiresMfa: true })
    await settle()
    expect(emitted).toEqual([])

    const verifyResult = await backendAuth.verifyMfa('123456')
    expect(verifyResult).toEqual({ ok: false, error: AUTH_SESSION_UNVERIFIED })
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalled()
    await settle()
    expect(emitted).toEqual([])
  })

  it('evento de auth com leitura falha mantém silêncio em vez de rebaixar', async () => {
    const broken = installClient({ members: { data: [], error: NET_ERROR } })
    const emitted: unknown[] = []
    createSupabaseBackend().subscribe((s) => emitted.push(s))

    broken.fireAuth()
    await settle()
    expect(emitted).toEqual([])

    const healthy = installClient()
    const emittedOk: unknown[] = []
    createSupabaseBackend().subscribe((s) => emittedOk.push(s))
    healthy.fireAuth()
    await vi.waitFor(() => expect(emittedOk).toHaveLength(1))
    expect(emittedOk[0]).toMatchObject({ role: 'church_admin' })
  })

  it('verifyEnrollment diz a verdade sobre o fator mesmo se o re-read falhar', async () => {
    const goodFactors = installClient()
    const backendAuth = createSupabaseBackend()
    // Primeiro cadastro ok (desafio ainda não existe para login); aqui só
    // confirmo o fator com re-read saudável para fixar o caminho feliz...
    const ok = await backendAuth.verifyEnrollment('factor-1', '123456')
    expect(ok).toEqual({ ok: true })
    expect(goodFactors.auth.mfa.challengeAndVerify).toHaveBeenCalled()

    // ...e com a leitura de papel falhando: o fator foi verificado (fato do
    // provedor), então ok:true continua honesto — só não se emite sessão nova.
    installClient({ members: { data: [], error: NET_ERROR } })
    const backendBad = createSupabaseBackend()
    const emitted: unknown[] = []
    backendBad.subscribe((s) => emitted.push(s))
    const res = await backendBad.verifyEnrollment('factor-1', '123456')
    expect(res.ok).toBe(true)
    await settle()
    expect(emitted).toEqual([])
  })
})
