import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHURCH_CREATE_DENIED,
  CHURCH_CREATE_NOT_READABLE,
  createChurch,
} from '@/services/data/churchService'

/**
 * Caminho real do cadastro de igreja (Supabase). O que se provou em produção em
 * 2026-11-12: o insert com `Prefer: return=representation` volta **42501** mesmo
 * com `created_by = auth.uid()` e `approval_status = 'pending'` corretos, porque o
 * RETURNING é avaliado antes do trigger `trg_churches_creator_admin` (0006) criar
 * o vínculo — e sem vínculo a linha nova não passa em `churches_public_read`
 * (0002). O mesmo corpo com `return=minimal` volta 201. Estes testes amarram o
 * formato em dois passos; voltar a encadear `.select()` no insert quebra aqui.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

type Row = { data: unknown; error: unknown }

const selectAfterInsert = vi.fn()
const insert = vi.fn()
const selectColumns = vi.fn()
const eq = vi.fn()
const maybeSingle = vi.fn()
const from = vi.fn()

let insertQueue: Row[] = []
let readResult: Row = { data: null, error: null }

const insertChain = {
  select: selectAfterInsert,
  then: (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
    Promise.resolve(insertQueue.shift() ?? { data: null, error: null }).then(onFulfilled, onRejected),
}
const readChain = { eq, maybeSingle }

const RLS_DENY = {
  code: '42501',
  message: 'new row violates row-level security policy for table "churches"',
}

function payloadOf(call: number) {
  return insert.mock.calls[call][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.resetAllMocks()
  insertQueue = []
  readResult = { data: null, error: null }
  insert.mockReturnValue(insertChain)
  selectColumns.mockReturnValue(readChain)
  eq.mockReturnValue(readChain)
  maybeSingle.mockImplementation(() => Promise.resolve(readResult))
  from.mockReturnValue({ insert, select: selectColumns })
  backend.supabase = { from }
})

afterEach(() => {
  backend.supabase = null
  vi.restoreAllMocks()
})

describe('createChurch no modo real — insert sem representação + releitura', () => {
  it('insere e relê a igreja pelo slug, sem encadear .select() no insert', async () => {
    insertQueue = [{ data: null, error: null }]
    readResult = { data: { id: 'c1', name: 'Igreja Piloto', approval_status: 'pending' }, error: null }

    const result = await createChurch({ name: 'Igreja Piloto' }, { id: 'u1' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.church.id).toBe('c1')
    expect(insert).toHaveBeenCalledTimes(1)
    expect(selectAfterInsert).not.toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('slug', payloadOf(0).slug)
  })

  it('manda o criador da sessão e a igreja como pendente', async () => {
    insertQueue = [{ data: null, error: null }]
    readResult = { data: { id: 'c1' }, error: null }

    await createChurch({ name: 'Igreja Piloto', city: '  Taubaté  ' }, { id: 'u1' })

    expect(payloadOf(0)).toMatchObject({
      created_by: 'u1',
      approval_status: 'pending',
      status: 'active',
      city: 'Taubaté',
    })
    expect(from).toHaveBeenCalledWith('churches')
  })

  it('recusa 42501 com a frase fixa na tela e o texto real do Postgres no console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    insertQueue = [{ data: null, error: RLS_DENY }]

    const result = await createChurch({ name: 'Igreja Piloto' }, { id: 'u1' })

    expect(result).toEqual({ ok: false, error: CHURCH_CREATE_DENIED })
    expect(warn.mock.calls.flat().join(' ')).toContain(RLS_DENY.message)
    expect(eq).not.toHaveBeenCalled()
  })

  it('slug duplicado tenta o sufixo seguinte em vez de falhar', async () => {
    insertQueue = [{ data: null, error: { code: '23505', message: 'duplicate key' } }, { data: null, error: null }]
    readResult = { data: { id: 'c2' }, error: null }

    const result = await createChurch({ name: 'Igreja Piloto' }, { id: 'u1' })

    expect(result.ok).toBe(true)
    expect(insert).toHaveBeenCalledTimes(2)
    expect(payloadOf(1).slug).not.toBe(payloadOf(0).slug)
    expect(eq).toHaveBeenCalledWith('slug', payloadOf(1).slug)
  })

  it('insert aceito mas releitura vazia não inventa a igreja', async () => {
    insertQueue = [{ data: null, error: null }]
    readResult = { data: null, error: null }

    const result = await createChurch({ name: 'Igreja Piloto' }, { id: 'u1' })

    expect(result).toEqual({ ok: false, error: CHURCH_CREATE_NOT_READABLE })
  })
})
