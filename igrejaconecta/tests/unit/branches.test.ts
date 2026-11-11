import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { branches, members } from '@/data/mock'
import * as branchService from '@/services/data/branchService'
import {
  BRANCH_COLUMNS,
  BRANCH_INSERT_COLUMNS,
  BRANCH_MANAGE_DENIED,
  BRANCH_NO_CHURCH,
  BRANCH_NOT_FOUND,
  BRANCH_PATCH_COLUMNS,
  createBranch,
  demoChurchBranches,
  fetchChurchBranches,
  updateBranch,
  validateBranchDraft,
  type BranchActor,
  type BranchDraft,
} from '@/services/data/branchService'

/**
 * Filiais (0013, Fase 4). A RLS é por linha e não limita coluna, então a projeção
 * daqui é o contrato do que chega ao navegador; os espelhos demo têm de reproduzir
 * a audiência da política (membro **ativo** da própria igreja, SuperAdmin para
 * todas — caso O3: vínculo `invited` não lê). E não existe delete em camada
 * nenhuma: a tabela não tem política nem grant de delete (O7/O10), então o serviço
 * também não pode expor a operação.
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
  maybeSingle: vi.fn(),
  // A leitura termina em `.order()` (SuperAdmin) ou em `.eq()` (membro) e o
  // resultado é esperado com `await query`; o builder real é thenable, e a
  // cadeia simulada precisa ser também para os dois caminhos resolverem.
  then: vi.fn(),
}
const from = vi.fn()
const originalBranches = structuredClone(branches)

const branchesDdl = tableBlock('0013_branches_location.sql', 'church_branches')

function validDraft(overrides: Partial<BranchDraft> = {}): BranchDraft {
  return {
    name: '  Congregação Norte  ',
    address: ' Rua Quatro, 400 ',
    city: 'Cidade A',
    state: 'SP',
    lat: -23.15,
    lng: -45.9,
    leader: ' Pb. João ',
    ...overrides,
  }
}

function useRealClient() {
  backend.supabase = { from }
}

beforeEach(() => {
  backend.supabase = null
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.maybeSingle.mockResolvedValue({ data: null, error: null })
  chain.then.mockImplementation((onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
    Promise.resolve(readResult).then(onFulfilled, onRejected),
  )
  readResult = { data: [], error: null }
  from.mockReturnValue(chain)
})

afterEach(() => {
  vi.restoreAllMocks()
  branches.splice(0, branches.length, ...structuredClone(originalBranches))
  backend.supabase = null
})

describe('projeção — o que chega ao navegador', () => {
  it('toda coluna projetada existe na tabela da migração 0013', () => {
    for (const column of BRANCH_COLUMNS) {
      expect(hasColumn(branchesDdl, column), `church_branches.${column}`).toBe(true)
    }
  })

  it('deixa os carimbos de fora: a lista não precisa de created_at/updated_at', () => {
    expect(BRANCH_COLUMNS).not.toContain('created_at')
    expect(BRANCH_COLUMNS).not.toContain('updated_at')
    const [row] = demoChurchBranches('ch1', { role: 'church_admin', userId: 'u1' })
    expect(Object.keys(row!).sort()).toEqual([...BRANCH_COLUMNS].sort())
  })

  it('a criação envia a igreja da sessão; a edição não envia church_id', () => {
    expect(BRANCH_INSERT_COLUMNS).toContain('church_id')
    expect(BRANCH_PATCH_COLUMNS).not.toContain('church_id')
    // Transferir filial de igreja é recusado pelo banco (O5); o formulário não oferece o campo.
    for (const column of BRANCH_PATCH_COLUMNS) {
      expect(BRANCH_INSERT_COLUMNS).toContain(column)
    }
  })
})

describe('leitura demo — espelho de church_branches_read', () => {
  it('membro ativo lê as filiais da própria igreja, em ordem de nome', () => {
    const rows = demoChurchBranches('ch1', { role: 'church_admin', userId: 'u1' })
    expect(rows.map((b) => b.id)).toEqual(['b2', 'b1'])
    expect(rows.every((b) => b.church_id === 'ch1')).toBe(true)
  })

  it('não vaza filial da igreja vizinha', () => {
    const ids = demoChurchBranches('ch1', { role: 'church_admin', userId: 'u1' }).map((b) => b.id)
    expect(ids).not.toContain('b3')
    expect(demoChurchBranches('ch2', { role: 'church_admin', userId: 'u4' }).map((b) => b.id)).toEqual(['b3'])
  })

  it('vínculo convidado não lê filial (caso O3)', () => {
    // u3 é communicator em ch1 mas com status 'invited'.
    expect(members.find((m) => m.user_id === 'u3')?.status).toBe('invited')
    expect(demoChurchBranches('ch1', { role: 'communicator', userId: 'u3' })).toEqual([])
  })

  it('sem userId o recorte é a igreja, como nas outras leituras', () => {
    expect(demoChurchBranches('ch1').map((b) => b.id)).toEqual(['b2', 'b1'])
  })

  it('SuperAdmin lê todas, inclusive de igrejas de que não é membro', () => {
    const rows = demoChurchBranches(undefined, { role: 'superadmin' })
    expect(rows.map((b) => b.id)).toEqual(['b3', 'b2', 'b1'])
  })

  it('sem igreja na sessão e sem ser SuperAdmin não há o que listar', () => {
    expect(demoChurchBranches(undefined, { role: 'church_admin' })).toEqual([])
    expect(demoChurchBranches(undefined)).toEqual([])
  })
})

describe('leitura real — contrato da consulta', () => {
  it('membro pede a projeção, a ordem de nome e o recorte pela igreja', async () => {
    useRealClient()
    readResult = { data: [], error: null }
    await fetchChurchBranches('ch1', { role: 'church_admin' })
    expect(from).toHaveBeenCalledWith('church_branches')
    expect(chain.select).toHaveBeenCalledWith(BRANCH_COLUMNS.join(','))
    expect(chain.order).toHaveBeenCalledWith('name')
    expect(chain.eq).toHaveBeenCalledWith('church_id', 'ch1')
  })

  it('SuperAdmin não recorta por igreja: nenhuma chamada .eq', async () => {
    useRealClient()
    readResult = { data: [], error: null }
    await fetchChurchBranches(undefined, { role: 'superadmin' })
    expect(chain.select).toHaveBeenCalledWith(BRANCH_COLUMNS.join(','))
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('sem igreja na sessão não sai consulta nenhuma', async () => {
    useRealClient()
    expect(await fetchChurchBranches(undefined, { role: 'church_admin' })).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('erro na leitura não recorre à lista fictícia', async () => {
    useRealClient()
    readResult = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchChurchBranches('ch1', { role: 'church_admin' })).rejects.toThrow('falha de rede')
  })
})

describe('validateBranchDraft', () => {
  it('recusa nome curto', () => {
    expect(validateBranchDraft(validDraft({ name: '  ab ' }))).toBe(
      'Informe o nome da filial (pelo menos 3 caracteres).',
    )
  })

  it('repassa a validação de coordenada', () => {
    expect(validateBranchDraft(validDraft({ lat: 91 }))).toBe('A latitude precisa ser um número entre -90 e 90.')
    expect(validateBranchDraft(validDraft({ lat: -23.1, lng: null }))).toBe(
      'Informe latitude e longitude juntas, ou deixe as duas em branco.',
    )
  })

  it('aceita rascunho válido e coordenada opcional', () => {
    expect(validateBranchDraft(validDraft())).toBeNull()
    expect(validateBranchDraft(validDraft({ lat: null, lng: null }))).toBeNull()
  })
})

describe('escritas — portas de permissão', () => {
  it('papel sem church.manage não escreve, e nenhuma consulta sai', async () => {
    useRealClient()
    for (const role of ['manager', 'communicator', 'pastor', 'visitor'] as const) {
      const actor: BranchActor = { churchId: 'ch1', role }
      expect(await createBranch(validDraft(), actor)).toEqual({ ok: false, error: BRANCH_MANAGE_DENIED })
      expect(await updateBranch('b1', validDraft(), actor)).toEqual({ ok: false, error: BRANCH_MANAGE_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('SuperAdmin manda em church.manage, mas sem igreja ativa não cria', async () => {
    expect(await createBranch(validDraft(), { role: 'superadmin' })).toEqual({ ok: false, error: BRANCH_NO_CHURCH })
  })

  it('a porta vem antes da validação: papel errado recebe a mensagem de permissão', async () => {
    expect(await createBranch(validDraft({ name: 'x' }), { churchId: 'ch1', role: 'communicator' }))
      .toEqual({ ok: false, error: BRANCH_MANAGE_DENIED })
  })
})

describe('escrita demo — cria e edita, nunca apaga', () => {
  it('church_admin cria filial na própria igreja, com a igreja da sessão', async () => {
    const antes = branches.length
    const resultado = await createBranch(validDraft(), { churchId: 'ch1', role: 'church_admin' })
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(branches).toHaveLength(antes + 1)
    expect(resultado.branch.church_id).toBe('ch1')
    expect(resultado.branch.name).toBe('Congregação Norte')
    expect(resultado.branch.address).toBe('Rua Quatro, 400')
    expect(resultado.branch.leader).toBe('Pb. João')
    expect(Object.keys(resultado.branch).sort()).toEqual([...BRANCH_COLUMNS].sort())
  })

  it('church_admin edita a própria filial', async () => {
    const resultado = await updateBranch('b2', validDraft({ name: 'Zona Sul — Sede' }), {
      churchId: 'ch1',
      role: 'church_admin',
    })
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.branch.name).toBe('Zona Sul — Sede')
    expect(branches.find((b) => b.id === 'b2')?.name).toBe('Zona Sul — Sede')
  })

  it('SuperAdmin é transversal: edita filial de qualquer igreja', async () => {
    const resultado = await updateBranch('b3', validDraft({ name: 'Campus Renomeado' }), { role: 'superadmin' })
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.branch.name).toBe('Campus Renomeado')
  })

  it('church_admin de uma igreja não alcança a filial da vizinha: mesma mensagem de não-existente', async () => {
    // b3 é da ch2; a1 administra a ch1. Sem oráculo de existência.
    expect(await updateBranch('b3', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: BRANCH_NOT_FOUND })
    expect(await updateBranch('filial-que-nao-existe', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: BRANCH_NOT_FOUND })
    expect(branches.find((b) => b.id === 'b3')?.name).toBe('Campus Aquarius')
  })

  it('o serviço não expõe delete em nenhuma forma', async () => {
    const nomes = Object.keys(branchService)
    expect(nomes.filter((n) => /delete|remove|destroy|excluir/i.test(n))).toEqual([])
    const fonte = readFileSync(new URL('../../src/services/data/branchService.ts', import.meta.url), 'utf8')
    expect(fonte).not.toMatch(/\.delete\(/)
  })
})

describe('escrita real — contrato e erros do banco', () => {
  it('a criação envia só colunas reais, com a igreja da sessão', async () => {
    useRealClient()
    chain.maybeSingle.mockResolvedValue({ data: { id: 'br-real', church_id: 'ch-real' }, error: null })
    await createBranch(validDraft(), { churchId: 'ch-real', role: 'church_admin' })
    expect(chain.insert).toHaveBeenCalled()
    const enviado = chain.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(enviado.church_id).toBe('ch-real')
    expect(Object.keys(enviado).sort()).toEqual([...BRANCH_INSERT_COLUMNS].sort())
    expect(chain.select).toHaveBeenCalledWith(BRANCH_COLUMNS.join(','))
  })

  it('a edição não envia church_id', async () => {
    useRealClient()
    chain.maybeSingle.mockResolvedValue({ data: { id: 'b1' }, error: null })
    await updateBranch('b1', validDraft(), { churchId: 'ch1', role: 'church_admin' })
    const patch = chain.update.mock.calls[0]![0] as Record<string, unknown>
    expect(patch).not.toHaveProperty('church_id')
    expect(Object.keys(patch).sort()).toEqual([...BRANCH_PATCH_COLUMNS].sort())
    expect(chain.eq).toHaveBeenCalledWith('id', 'b1')
  })

  it('linha que não volta é a mesma mensagem de não-existente: sem oráculo', async () => {
    useRealClient()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await updateBranch('b3', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: BRANCH_NOT_FOUND })
  })

  it.each([
    ['política de gestão', '42501', 'new row violates row-level security policy', BRANCH_MANAGE_DENIED],
    ['coordenada fora do check', '23514', 'violates check constraint "church_branches_lat_check"', 'Coordenada fora do intervalo: a latitude vai de -90 a 90 e a longitude de -180 a 180.'],
    ['igreja inexistente', '23503', 'violates foreign key constraint', 'Igreja não encontrada. Atualize a lista e tente de novo.'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    useRealClient()
    chain.maybeSingle.mockResolvedValue({ data: null, error: { code, message } })
    expect(await createBranch(validDraft(), { churchId: 'ch-real', role: 'church_admin' }))
      .toEqual({ ok: false, error: esperado })
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
