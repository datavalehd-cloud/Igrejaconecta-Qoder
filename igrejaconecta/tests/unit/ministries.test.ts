import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { members, ministries, ministryMembers } from '@/data/mock'
import * as ministryService from '@/services/data/ministryService'
import {
  MINISTRY_COLUMNS,
  MINISTRY_LEADER_OUTSIDE,
  MINISTRY_MANAGE_DENIED,
  MINISTRY_MEMBER_OUTSIDE,
  MINISTRY_NO_CHURCH,
  MINISTRY_NOT_FOUND,
  addMinistryMember,
  createMinistry,
  deleteMinistry,
  fetchMinistries,
  removeMinistryMember,
  updateMinistry,
  validateMinistryDraft,
  type MinistryActor,
  type MinistryDraft,
} from '@/services/data/ministryService'
import {
  demoAddMinistryMember,
  demoCreateMinistry,
  demoDeleteMinistry,
  demoMinistries,
  demoMinistryMembers,
  demoRemoveMinistryMember,
  demoUpdateMinistry,
  resetMinistryFixture,
} from '../fixtures/ministryMirror'

/**
 * Ministérios (0015) com a guarda de audiência da 0021. A lista vem da view
 * `ministry_list`, que deriva líder e contagem — por isso nenhum teste precisa de
 * um número digitado, e um `members_count` escrito à mão no fixture é ignorado.
 * A recusa de verdade está provada na suíte SQL (Q9); aqui a mesma régua fica
 * especificada em TypeScript e o contrato da consulta fica preso.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

const NOT_A_PROFILE = 'A pessoa indicada não é uma conta desta plataforma. Atualize a lista de membros.'

let ministriesResult: { data: unknown; error: unknown } = { data: null, error: null }
let listResult: { data: unknown; error: unknown } = { data: [], error: null }
let membersResult: { data: unknown; error: unknown } = { data: [], error: null }

function makeChain(result: () => { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => result())
  chain.then = vi.fn((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(onFulfilled, onRejected),
  )
  return chain
}

const ministriesChain = makeChain(() => ministriesResult)
const listChain = makeChain(() => listResult)
const membersChain = makeChain(() => membersResult)
const from = vi.fn()
const chains = new Map<string, Record<string, ReturnType<typeof vi.fn>>>([
  ['ministries', ministriesChain],
  ['ministry_list', listChain],
  ['ministry_members', membersChain],
])

const ministryListDdl = viewBody('0015_ministries_and_social_accounts.sql', 'ministry_list')

function validDraft(overrides: Partial<MinistryDraft> = {}): MinistryDraft {
  return { name: '  Ministério de Meios  ', type: 'ministry', description: '  Rádio e redes  ', leader_id: 'u2', ...overrides }
}

beforeEach(() => {
  backend.supabase = { from }
  vi.resetAllMocks()
  // `resetAllMocks` joga fora as implementações, e são elas que devolvem o
  // resultado que cada teste escolheu: sem reamarrar, a cadeia vira mudo.
  for (const [table, chain] of chains) {
    const result = table === 'ministry_list' ? () => listResult : table === 'ministry_members' ? () => membersResult : () => ministriesResult
    chain.maybeSingle!.mockImplementation(async () => result())
    chain.then!.mockImplementation((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(onFulfilled, onRejected),
    )
  }
  from.mockImplementation((table: string) => chains.get(table)!)
  ministriesResult = { data: null, error: null }
  listResult = { data: [], error: null }
  membersResult = { data: [], error: null }
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMinistryFixture()
  backend.supabase = null
})

describe('projeção — o que chega ao navegador', () => {
  it('toda coluna projetada existe na view ministry_list da migração 0015', () => {
    for (const column of MINISTRY_COLUMNS) {
      expect(matchesWord(ministryListDdl, column), `ministry_list.${column}`).toBe(true)
    }
  })

  it('a view é que forma líder e contagem: nenhuma coluna digitada', () => {
    expect(ministryListDdl).toMatch(/l\.full_name\s+as\s+leader_name/)
    expect(ministryListDdl).toMatch(/count\(\*\)::int[\s\S]*as\s+members_count/)
    expect(MINISTRY_COLUMNS).not.toContain('leader')
  })

  it('o espelho devolve exatamente as colunas projetadas', () => {
    const [row] = demoMinistries('ch1', { role: 'church_admin' })
    expect(Object.keys(row!).sort()).toEqual([...MINISTRY_COLUMNS].sort())
  })

  it('a contagem vem das participações, nunca do número guardado no fixture', () => {
    ministries.find((m) => m.id === 'm1')!.members_count = 99
    const louvor = demoMinistries('ch1').find((m) => m.id === 'm1')!
    expect(louvor.members_count).toBe(demoMinistryMembers('m1').length)
  })

  it('o serviço não envia contagem nem nome de líder em nenhuma escrita', async () => {
    ministriesResult = { data: { id: 'novo' }, error: null }
    listResult = { data: { id: 'novo' }, error: null }
    await createMinistry(validDraft(), { churchId: 'ch1', role: 'church_admin' })
    const enviado = ministriesChain.insert!.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(enviado).sort()).toEqual(['church_id', 'description', 'leader_id', 'name', 'type'])
    ministriesChain.insert!.mockClear()
    await updateMinistry('m1', validDraft(), { churchId: 'ch1', role: 'church_admin' })
    const patch = ministriesChain.update!.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(patch).sort()).toEqual(['description', 'leader_id', 'name', 'type'])
  })
})

describe('leitura demo — espelho de ministry_list', () => {
  it('membro lê só a própria igreja, em ordem de nome, com o líder pelo nome', () => {
    const rows = demoMinistries('ch1', { role: 'church_admin' })
    expect(rows.map((m) => m.name)).toEqual(['Ação Social', 'Comunicação', 'Jovens (UJC)', 'Ministério de Louvor'])
    expect(rows.every((m) => m.church_id === 'ch1')).toBe(true)
    expect(rows.find((m) => m.id === 'm1')!.leader_name).toBe('Ana Souza')
    expect(rows.find((m) => m.id === 'm3')!.leader_name).toBeNull()
  })

  it('não vaza ministério da igreja vizinha', () => {
    expect(demoMinistries('ch1', { role: 'church_admin' }).map((m) => m.id)).not.toContain('m5')
    expect(demoMinistries('ch2', { role: 'church_admin' }).map((m) => m.id)).toEqual(['m5'])
  })

  it('vínculo convidado não lê (a view usa current_church_ids)', () => {
    expect(members.find((m) => m.user_id === 'u3')?.status).toBe('invited')
    expect(demoMinistries('ch1', { role: 'communicator', userId: 'u3' })).toEqual([])
    expect(demoMinistries('ch1', { role: 'communicator', userId: 'u5' }).length).toBeGreaterThan(0)
  })

  it('SuperAdmin lê todas', () => {
    expect(demoMinistries(undefined, { role: 'superadmin' }).map((m) => m.id)).toEqual([
      'm3', 'm4', 'm2', 'm5', 'm1',
    ])
  })

  it('sem igreja na sessão e sem ser SuperAdmin não há o que listar', () => {
    expect(demoMinistries(undefined, { role: 'church_admin' })).toEqual([])
    expect(demoMinistries(undefined)).toEqual([])
  })
})

describe('leitura real — contrato da consulta', () => {
  it('membro pede a view, a projeção, a ordem e o recorte por igreja', async () => {
    listResult = { data: [], error: null }
    await fetchMinistries('ch1', { role: 'church_admin' })
    expect(from).toHaveBeenCalledWith('ministry_list')
    expect(listChain.select).toHaveBeenCalledWith(MINISTRY_COLUMNS.join(','))
    expect(listChain.order).toHaveBeenCalledWith('name')
    expect(listChain.eq).toHaveBeenCalledWith('church_id', 'ch1')
  })

  it('SuperAdmin não recorta por igreja: nenhuma chamada .eq', async () => {
    await fetchMinistries(undefined, { role: 'superadmin' })
    expect(listChain.select).toHaveBeenCalledWith(MINISTRY_COLUMNS.join(','))
    expect(listChain.eq).not.toHaveBeenCalled()
  })

  it('sem igreja na sessão não sai consulta nenhuma', async () => {
    expect(await fetchMinistries(undefined, { role: 'church_admin' })).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('erro na leitura não recorre à lista fictícia', async () => {
    listResult = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchMinistries('ch1', { role: 'church_admin' })).rejects.toThrow('falha de rede')
  })

  it('participantes vêm da tabela, pelo ministério', async () => {
    membersResult = { data: [{ ministry_id: 'm1', user_id: 'u1' }], error: null }
    expect(await ministryService.fetchMinistryMembers('m1')).toEqual([{ ministry_id: 'm1', user_id: 'u1' }])
    expect(from).toHaveBeenCalledWith('ministry_members')
    expect(membersChain.select).toHaveBeenCalledWith('ministry_id, user_id')
    expect(membersChain.eq).toHaveBeenCalledWith('ministry_id', 'm1')
  })
})

describe('validateMinistryDraft', () => {
  it('recusa nome curto e nome longo', () => {
    expect(validateMinistryDraft(validDraft({ name: '  a ' }))).toBe('Informe o nome do ministério (pelo menos 2 caracteres).')
    expect(validateMinistryDraft(validDraft({ name: 'x'.repeat(81) }))).toBe('O nome do ministério tem no máximo 80 caracteres.')
  })

  it('recusa tipo que não é um dos três do banco', () => {
    expect(validateMinistryDraft(validDraft({ type: 'celula' as MinistryDraft['type'] }))).toBe(
      'Tipo de ministério inválido: use ministério, departamento ou equipe.',
    )
  })

  it('descrição não tem regra: vazia é aceita', () => {
    expect(validateMinistryDraft(validDraft({ description: '   ' }))).toBeNull()
    expect(validateMinistryDraft(validDraft())).toBeNull()
  })
})

describe('escritas — portas de permissão', () => {
  it('papel sem members.manage não escreve, e nenhuma consulta sai', async () => {
    for (const role of ['manager', 'communicator', 'pastor', 'visitor'] as const) {
      const actor: MinistryActor = { churchId: 'ch1', role }
      expect(await createMinistry(validDraft(), actor)).toEqual({ ok: false, error: MINISTRY_MANAGE_DENIED })
      expect(await updateMinistry('m1', validDraft(), actor)).toEqual({ ok: false, error: MINISTRY_MANAGE_DENIED })
      expect(await deleteMinistry('m1', actor)).toEqual({ ok: false, error: MINISTRY_MANAGE_DENIED })
      expect(await addMinistryMember('m1', 'u2', actor)).toEqual({ ok: false, error: MINISTRY_MANAGE_DENIED })
      expect(await removeMinistryMember('m1', 'u2', actor)).toEqual({ ok: false, error: MINISTRY_MANAGE_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('SuperAdmin tem a porta, mas sem igreja ativa não cria', async () => {
    expect(await createMinistry(validDraft(), { role: 'superadmin' })).toEqual({ ok: false, error: MINISTRY_NO_CHURCH })
  })

  it('a porta vem antes da validação: papel errado recebe a mensagem de permissão', async () => {
    expect(await createMinistry(validDraft({ name: 'x' }), { churchId: 'ch1', role: 'communicator' }))
      .toEqual({ ok: false, error: MINISTRY_MANAGE_DENIED })
  })
})

describe('espelho da guarda 0021 — líder e participante são da igreja', () => {
  it('líder de outra igreja é recusado no create e no update, e nada fica', () => {
    expect(demoCreateMinistry(validDraft({ leader_id: 'u4' }), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_LEADER_OUTSIDE })
    expect(demoUpdateMinistry('m1', validDraft({ leader_id: 'u4' }), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_LEADER_OUTSIDE })
    expect(ministries).toHaveLength(5)
    expect(ministries.find((m) => m.id === 'm1')!.leader_id).toBe('u2')
  })

  it('líder convidado também não vale: a régua é vínculo ativo', () => {
    expect(members.find((m) => m.user_id === 'u3')!.status).toBe('invited')
    expect(demoCreateMinistry(validDraft({ leader_id: 'u3' }), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_LEADER_OUTSIDE })
  })

  it('uuid que não é conta cai na referência, não na audiência', () => {
    expect(demoCreateMinistry(validDraft({ leader_id: 'u9' }), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: NOT_A_PROFILE })
  })

  it('sem líder é aceito: NULL não é pessoa de fora', () => {
    const created = demoCreateMinistry(validDraft({ leader_id: '' }), { churchId: 'ch1', role: 'church_admin' })
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.ministry.leader_id).toBeNull()
  })

  it('participante de fora e convidado são recusados; ativo da igreja entra', () => {
    expect(demoAddMinistryMember('m1', 'u4', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_MEMBER_OUTSIDE })
    expect(demoAddMinistryMember('m1', 'u3', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_MEMBER_OUTSIDE })
    expect(demoAddMinistryMember('m1', 'u2', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: 'Essa pessoa já participa do ministério.' })

    expect(demoAddMinistryMember('m3', 'u5', { churchId: 'ch1', role: 'church_admin' })).toEqual({ ok: true })
    expect(demoMinistryMembers('m3')).toEqual(['u5'])
  })

  it('excluir ministério leva as participações junto (cascade)', () => {
    expect(demoMinistryMembers('m1').length).toBe(3)
    expect(demoDeleteMinistry('m1', { churchId: 'ch1', role: 'church_admin' })).toEqual({ ok: true })
    expect(ministries.find((m) => m.id === 'm1')).toBeUndefined()
    expect(ministryMembers.filter((r) => r.ministry_id === 'm1')).toEqual([])
  })

  it('tirar participante apaga o par; repetir e tentar na igreja vizinha não fingem sucesso', () => {
    expect(demoRemoveMinistryMember('m1', 'u1', { churchId: 'ch1', role: 'church_admin' })).toEqual({ ok: true })
    expect(demoMinistryMembers('m1')).toEqual(['u2', 'u5'])
    expect(demoRemoveMinistryMember('m1', 'u1', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: 'Essa pessoa não está mais no ministério. Atualize a lista.' })
    // m5 é da ch2: quem administra a ch1 não alcança nem para tirar gente.
    expect(demoRemoveMinistryMember('m5', 'u4', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_NOT_FOUND })
    expect(demoMinistryMembers('m5')).toEqual(['u4'])
  })
})

describe('sem oráculo de existência', () => {
  it('ministério da igreja vizinha dá a mesma mensagem de não-existente', () => {
    expect(demoUpdateMinistry('m5', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_NOT_FOUND })
    expect(demoDeleteMinistry('m5', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_NOT_FOUND })
    expect(demoUpdateMinistry('ministerio-que-nao-existe', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_NOT_FOUND })
    expect(ministries.find((m) => m.id === 'm5')!.church_id).toBe('ch2')
  })

  it('SuperAdmin é transversal: edita e exclui ministério de qualquer igreja', () => {
    // O líder tem de ser da igreja do ministério, não da sessão: por isso u4
    // (admin da ch2) e não u2. A guarda da 0021 vale para o SuperAdmin também.
    expect(demoUpdateMinistry('m5', validDraft({ name: 'Louvor Renovado', leader_id: 'u4' }), { role: 'superadmin' }).ok).toBe(true)
    expect(demoDeleteMinistry('m5', { role: 'superadmin' })).toEqual({ ok: true })
  })

  it('linha que não volta do banco é a mesma mensagem: update sem permissão não revela nada', async () => {
    ministriesResult = { data: null, error: null }
    expect(await updateMinistry('m5', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_NOT_FOUND })
    ministriesResult = { data: [], error: null }
    expect(await deleteMinistry('m5', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_NOT_FOUND })
    ministriesResult = { data: { id: 'm5' }, error: null }
    listResult = { data: null, error: null }
    expect(await updateMinistry('m5', validDraft(), { role: 'superadmin' }))
      .toEqual({ ok: false, error: MINISTRY_NOT_FOUND })
  })
})

describe('escrita real — contrato e erros do banco', () => {
  it('a criação grava minimal e rele a linha pela view', async () => {
    ministriesResult = { data: { id: 'novo' }, error: null }
    listResult = { data: { id: 'novo', name: 'Ministério de Meios', members_count: 0 }, error: null }
    const result = await createMinistry(validDraft(), { churchId: 'ch1', role: 'church_admin' })
    expect(result).toEqual({ ok: true, ministry: { id: 'novo', name: 'Ministério de Meios', members_count: 0 } })
    const enviado = ministriesChain.insert!.mock.calls[0]![0] as Record<string, unknown>
    expect(enviado).toEqual({
      church_id: 'ch1',
      name: 'Ministério de Meios',
      type: 'ministry',
      description: 'Rádio e redes',
      leader_id: 'u2',
    })
    expect(listChain.select).toHaveBeenCalledWith(MINISTRY_COLUMNS.join(','))
    expect(listChain.eq).toHaveBeenCalledWith('id', 'novo')
  })

  it('a edição manda só as colunas editáveis e o id', async () => {
    ministriesResult = { data: { id: 'm1' }, error: null }
    listResult = { data: { id: 'm1' }, error: null }
    await updateMinistry('m1', validDraft({ leader_id: null }), { churchId: 'ch1', role: 'church_admin' })
    const patch = ministriesChain.update!.mock.calls[0]![0] as Record<string, unknown>
    expect(patch.leader_id).toBeNull()
    expect(patch).not.toHaveProperty('church_id')
    expect(ministriesChain.eq).toHaveBeenCalledWith('id', 'm1')
  })

  it.each([
    ['líder de fora da igreja', '42501', 'row-level security', MINISTRY_LEADER_OUTSIDE],
    ['pessoa que não é conta', '23503', 'violates foreign key constraint', NOT_A_PROFILE],
    ['nome ou tipo fora do check', '23514', 'violates check constraint', 'Nome ou tipo fora do permitido: o nome vai de 2 a 80 caracteres e o tipo é ministério, departamento ou equipe.'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    ministriesResult = { data: null, error: { code, message } }
    expect(await createMinistry(validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: esperado })
  })

  it('participante: insert manda o par e devolve as linhas; duplicata tem frase própria', async () => {
    membersResult = { data: [{ ministry_id: 'm3', user_id: 'u5' }], error: null }
    expect(await addMinistryMember('m3', 'u5', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: true, members: [{ ministry_id: 'm3', user_id: 'u5' }] })
    expect(membersChain.insert).toHaveBeenCalledWith({ ministry_id: 'm3', user_id: 'u5' })

    membersResult = { data: null, error: { code: '23505', message: 'duplicate key value' } }
    expect(await addMinistryMember('m3', 'u5', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: 'Essa pessoa já participa do ministério.' })

    membersResult = { data: null, error: { code: '42501', message: 'row-level security' } }
    expect(await addMinistryMember('m3', 'u5', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_MEMBER_OUTSIDE })

    membersResult = { data: null, error: null }
    expect(await addMinistryMember('m3', '', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: MINISTRY_MEMBER_OUTSIDE })
    expect(membersChain.insert).not.toHaveBeenCalledWith({ ministry_id: 'm3', user_id: '' })
  })

  it('remover participante apaga pelo par e avisa quando não estava', async () => {
    membersResult = { data: [{ ministry_id: 'm3' }], error: null }
    expect(await removeMinistryMember('m3', 'u5', { churchId: 'ch1', role: 'church_admin' })).toEqual({ ok: true })
    expect(membersChain.eq).toHaveBeenCalledWith('ministry_id', 'm3')
    expect(membersChain.eq).toHaveBeenCalledWith('user_id', 'u5')

    membersResult = { data: [], error: null }
    expect(await removeMinistryMember('m3', 'u5', { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: 'Essa pessoa não está mais no ministério. Atualize a lista.' })
  })
})

function viewBody(migration: string, view: string) {
  const sql = readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')
  const start = sql.indexOf(`create or replace view public.${view}`)
  if (start < 0) throw new Error(`view ${view} não encontrada em ${migration}`)
  const end = sql.indexOf('\nfrom public.', start)
  if (end < 0) throw new Error(`corpo da view ${view} não delimitado`)
  return sql.slice(start, end)
}

/** Coluna da view: `m.id`, `l.full_name as leader_name` — sem casar dentro de `leader_id`. */
function matchesWord(body: string, column: string) {
  return new RegExp(`\\b${column}\\b`).test(body)
}
