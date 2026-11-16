import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as networkService from '@/services/data/networkService'
import {
  MEMBERSHIP_EXISTS,
  MEMBERSHIP_NOT_FOUND,
  MEMBERSHIP_SELECT,
  NETWORK_DENIED,
  NETWORK_INSERT_COLUMNS,
  NETWORK_LINK_INVALID,
  NETWORK_NAME_INVALID,
  NETWORK_NOT_FOUND,
  NETWORK_PATCH_COLUMNS,
  NETWORK_COLUMNS,
  NETWORK_SLUG_TAKEN,
  addChurchToNetwork,
  createNetwork,
  deleteNetwork,
  fetchNetworkChurches,
  fetchNetworks,
  networkSlugCandidates,
  removeChurchFromNetwork,
  updateNetwork,
  validateNetworkDraft,
  type NetworkActor,
  type NetworkDraft,
} from '@/services/data/networkService'
import type { ChurchNetwork } from '@/types'

/**
 * Redes de igrejas (0017, `/admin/organizacoes`). A audiência é exclusiva do
 * SuperAdmin nas duas pontas — a política decide no banco (grupo S: S1/S2/S3/S4),
 * e o gate do serviço garante que um papel errado nem dispara consulta. Os
 * casos daqui cobrem o contrato do que sai do navegador: projeção conferida com
 * a migração (com `churches_count` nascendo da VIEW, não de coluna digitável),
 * slug que não entra no patch, 23505 de criação lido como "desempate de slug" e
 * 23505 de vínculo lido como "já está na rede", e toda recusa silenciosa com a
 * mesma mensagem de inexistente — sem oráculo sobre o que existe.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

const chain = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  maybeSingle: vi.fn(),
  then: vi.fn(),
}
const from = vi.fn()

let awaits: { data?: unknown; error?: unknown }[] = []
function queue(...values: { data?: unknown; error?: unknown }[]) {
  awaits = values
}

const networksSql = readFileSync(new URL('../../supabase/migrations/0017_church_networks.sql', import.meta.url), 'utf8')
const networksDdl = tableBlock(networksSql, 'church_networks')

function draft(overrides: Partial<NetworkDraft> = {}): NetworkDraft {
  return { name: '  Convenção Vida  ', description: '  União de igrejas  ', ...overrides }
}

const SUPER: NetworkActor = { role: 'superadmin' }

function viewRow(overrides: Partial<ChurchNetwork> = {}): ChurchNetwork {
  return { id: 'n1', name: 'Convenção Vida', slug: 'convencao-vida', description: 'União de igrejas', churches_count: 2, ...overrides }
}

beforeEach(() => {
  backend.supabase = { from }
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.delete.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.maybeSingle.mockResolvedValue({ data: null, error: null })
  chain.then.mockImplementation((onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) => {
    const next = awaits.shift() ?? { data: [], error: null }
    return Promise.resolve(next).then(onFulfilled, onRejected)
  })
  awaits = []
  from.mockReturnValue(chain)
})

afterEach(() => {
  vi.restoreAllMocks()
  backend.supabase = null
})

describe('projeção — o que chega ao navegador', () => {
  it('toda coluna projetada existe na tabela da 0017, exceto a contagem', () => {
    for (const column of NETWORK_COLUMNS) {
      if (column === 'churches_count') continue
      expect(hasColumn(networksDdl, column), `church_networks.${column}`).toBe(true)
    }
  })

  it('churches_count não é coluna digitável: é contado pela view', () => {
    expect(hasColumn(networksDdl, 'churches_count')).toBe(false)
    expect(networksSql).toMatch(/\(select count\(\*\)::int[\s\S]*?\) as churches_count/)
  })

  it('a criação manda slug e a edição não (o endereço nasce uma vez)', () => {
    expect(NETWORK_INSERT_COLUMNS).toContain('slug')
    expect(NETWORK_PATCH_COLUMNS).not.toContain('slug')
    for (const column of NETWORK_PATCH_COLUMNS) expect(NETWORK_INSERT_COLUMNS).toContain(column)
  })

  it('o vínculo embute a igreja pela FK: nome vem do join, não do app', () => {
    expect(MEMBERSHIP_SELECT).toContain('churches(id, name)')
  })
})

describe('leitura — gate antes de qualquer consulta', () => {
  it.each(['church_admin', 'pastor', 'manager', 'communicator', 'visitor', undefined] as const)(
    'papel %s não dispara consulta em lista nenhuma',
    async (role) => {
      const actor: NetworkActor = { role }
      expect(await fetchNetworks(actor)).toEqual([])
      expect(await fetchNetworkChurches('n1', actor)).toEqual([])
      expect(from).not.toHaveBeenCalled()
    },
  )

  it('SuperAdmin lê a view pela projeção e em ordem de nome', async () => {
    queue({ data: [], error: null })
    await fetchNetworks(SUPER)
    expect(from).toHaveBeenCalledWith('church_network_list')
    expect(chain.select).toHaveBeenCalledWith(NETWORK_COLUMNS.join(','))
    expect(chain.order).toHaveBeenCalledWith('name')
  })

  it('erro na leitura não recorre a lista fictícia: lança', async () => {
    queue({ data: null, error: { message: 'falha de rede' } })
    await expect(fetchNetworks(SUPER)).rejects.toThrow('falha de rede')
  })

  it('a lista de igrejas da rede embute a igreja e ordena por nome (ordem do join não é garantida)', async () => {
    queue({
      data: [
        { network_id: 'n1', church_id: 'c2', churches: { id: 'c2', name: 'Assembleia Betel' } },
        { network_id: 'n1', church_id: 'c1', churches: { id: 'c1', name: 'Comunidade Vida' } },
      ],
      error: null,
    })
    const rows = await fetchNetworkChurches('n1', SUPER)
    expect(from).toHaveBeenCalledWith('church_network_churches')
    expect(chain.select).toHaveBeenCalledWith(MEMBERSHIP_SELECT)
    expect(chain.eq).toHaveBeenCalledWith('network_id', 'n1')
    expect(rows.map((r) => r.churches?.name)).toEqual(['Assembleia Betel', 'Comunidade Vida'])
  })
})

describe('validateNetworkDraft e candidates de slug', () => {
  it('recusa nome fora de 2 a 80 (o mesmo CHECK do banco)', () => {
    expect(validateNetworkDraft(draft({ name: '  a ' }))).toBe(NETWORK_NAME_INVALID)
    expect(validateNetworkDraft(draft({ name: 'x'.repeat(81) }))).toBe(NETWORK_NAME_INVALID)
    expect(validateNetworkDraft(draft())).toBeNull()
  })

  it('candidate gera base + sufixos, e nome sem caracteres de slug não vira endereço', () => {
    expect(networkSlugCandidates('Convenção Vida!')).toEqual([
      'convencao-vida', 'convencao-vida-2', 'convencao-vida-3', 'convencao-vida-4', 'convencao-vida-5',
      'convencao-vida-6', 'convencao-vida-7', 'convencao-vida-8', 'convencao-vida-9', 'convencao-vida-10',
    ])
    expect(networkSlugCandidates('???')).toEqual([])
  })

  it('nome sem nada aproveitável para de mão e não dispara consulta', async () => {
    expect(await createNetwork(draft({ name: '???' }), SUPER)).toEqual({ ok: false, error: NETWORK_NAME_INVALID })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('criação', () => {
  it('papel sem SuperAdmin não cria, e nada sai', async () => {
    for (const role of ['church_admin', 'manager', 'visitor'] as const) {
      expect(await createNetwork(draft(), { role })).toEqual({ ok: false, error: NETWORK_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('insere com o slug da base e relê pela view', async () => {
    queue({ error: null })
    chain.maybeSingle.mockResolvedValue({ data: viewRow(), error: null })
    const result = await createNetwork(draft(), SUPER)
    expect(result.ok).toBe(true)
    const enviado = chain.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(enviado).sort()).toEqual([...NETWORK_INSERT_COLUMNS].sort())
    expect(enviado).toMatchObject({ name: 'Convenção Vida', slug: 'convencao-vida', description: 'União de igrejas' })
    expect(from).toHaveBeenNthCalledWith(2, 'church_network_list')
    expect(chain.eq).toHaveBeenCalledWith('slug', 'convencao-vida')
  })

  it('descrição em branco vira null, não string vazia', async () => {
    queue({ error: null })
    chain.maybeSingle.mockResolvedValue({ data: viewRow({ description: null }), error: null })
    await createNetwork(draft({ description: '   ' }), SUPER)
    expect(chain.insert.mock.calls[0]![0]).toMatchObject({ description: null })
  })

  it('slug ocupado tenta o sufixo seguinte e o insert vencedor não é refeito', async () => {
    queue(
      { error: { code: '23505', message: 'duplicate key' } },
      { error: null },
    )
    chain.maybeSingle.mockResolvedValue({ data: viewRow({ slug: 'convencao-vida-2' }), error: null })
    const result = await createNetwork(draft(), SUPER)
    expect(result.ok).toBe(true)
    expect(chain.insert).toHaveBeenCalledTimes(2)
    expect(chain.insert.mock.calls[1]![0]).toMatchObject({ slug: 'convencao-vida-2' })
  })

  it('dez candidatos ocupados devolvem a mensagem de endereço, sem inventar rede', async () => {
    queue(...Array.from({ length: 10 }, () => ({ error: { code: '23505', message: 'duplicate key' } })))
    expect(await createNetwork(draft(), SUPER)).toEqual({ ok: false, error: NETWORK_SLUG_TAKEN })
    expect(chain.insert).toHaveBeenCalledTimes(10)
    expect(chain.maybeSingle).not.toHaveBeenCalled()
  })

  it('insert aceito mas linha sumida da view é falha explícita', async () => {
    queue({ error: null })
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await createNetwork(draft(), SUPER)).toEqual({ ok: false, error: NETWORK_NOT_FOUND })
  })

  it('erro de política no insert vira a mensagem de audiência, não o texto cru', async () => {
    queue({ error: { code: '42501', message: 'new row violates row-level security policy' } })
    expect(await createNetwork(draft(), SUPER)).toEqual({ ok: false, error: NETWORK_DENIED })
  })
})

describe('edição e remoção da rede', () => {
  it('o patch nunca leva slug nem id, e a releitura vem da view', async () => {
    queue({ data: [{ id: 'n1' }], error: null })
    chain.maybeSingle.mockResolvedValue({ data: viewRow({ name: 'Convenção Vida Nova' }), error: null })
    const result = await updateNetwork('n1', draft({ name: ' Convenção Vida Nova ' }), SUPER)
    expect(result.ok).toBe(true)
    const patch = chain.update.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(patch).sort()).toEqual([...NETWORK_PATCH_COLUMNS].sort())
    expect(patch).not.toHaveProperty('slug')
    expect(chain.eq).toHaveBeenCalledWith('id', 'n1')
    expect(from).toHaveBeenNthCalledWith(2, 'church_network_list')
  })

  it('update que não devolve linha é a mesma mensagem de inexistente (sem oráculo)', async () => {
    queue({ data: [], error: null })
    expect(await updateNetwork('n-outra', draft(), SUPER)).toEqual({ ok: false, error: NETWORK_NOT_FOUND })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('gate vem antes da validação: papel errado recebe a mensagem de permissão', async () => {
    expect(await updateNetwork('n1', draft({ name: 'x' }), { role: 'church_admin' })).toEqual({ ok: false, error: NETWORK_DENIED })
    expect(await deleteNetwork('n1', { role: 'communicator' })).toEqual({ ok: false, error: NETWORK_DENIED })
    expect(await addChurchToNetwork('n1', 'c1', { role: 'pastor' })).toEqual({ ok: false, error: NETWORK_DENIED })
    expect(await removeChurchFromNetwork('n1', 'c1', { role: 'visitor' })).toEqual({ ok: false, error: NETWORK_DENIED })
    expect(from).not.toHaveBeenCalled()
  })

  it('delete sem linha respondida é inexistente; com linha é sucesso', async () => {
    queue({ data: [], error: null })
    expect(await deleteNetwork('n-sumido', SUPER)).toEqual({ ok: false, error: NETWORK_NOT_FOUND })
    queue({ data: [{ id: 'n1' }], error: null })
    expect(await deleteNetwork('n1', SUPER)).toEqual({ ok: true })
    expect(chain.select).toHaveBeenCalledWith('id')
  })
})

describe('vínculo igreja ↔ rede', () => {
  it('23505 no vínculo é "já está na rede" (a PK composta), não "slug ocupado"', async () => {
    queue({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    expect(await addChurchToNetwork('n1', 'c1', SUPER)).toEqual({ ok: false, error: MEMBERSHIP_EXISTS })
    expect(from).toHaveBeenCalledWith('church_network_churches')
  })

  it('fk inventada é mensagem de vínculo, e 42501 é a de audiência', async () => {
    queue({ error: { code: '23503', message: 'violates foreign key constraint' } })
    expect(await addChurchToNetwork('n-nao-existe', 'c-nao-existe', SUPER)).toEqual({ ok: false, error: NETWORK_LINK_INVALID })
    queue({ error: { code: '42501', message: 'violates row-level security policy' } })
    expect(await addChurchToNetwork('n1', 'c1', SUPER)).toEqual({ ok: false, error: NETWORK_DENIED })
  })

  it('desfazer recorta pelos dois ids e zero linhas devolvidas é "não está na rede"', async () => {
    queue({ data: [{ church_id: 'c1' }], error: null })
    expect(await removeChurchFromNetwork('n1', 'c1', SUPER)).toEqual({ ok: true })
    expect(chain.eq).toHaveBeenCalledWith('network_id', 'n1')
    expect(chain.eq).toHaveBeenCalledWith('church_id', 'c1')
    queue({ data: [], error: null })
    expect(await removeChurchFromNetwork('n1', 'c-outro', SUPER)).toEqual({ ok: false, error: MEMBERSHIP_NOT_FOUND })
  })
})

describe('superfície do módulo', () => {
  it('o serviço expõe exatamente as portas da 0017 (sem "mover igreja entre redes" disfarçada)', () => {
    expect(Object.keys(networkService).sort()).toEqual([
      'MEMBERSHIP_EXISTS',
      'MEMBERSHIP_NOT_FOUND',
      'MEMBERSHIP_SELECT',
      'NETWORK_COLUMNS',
      'NETWORK_DENIED',
      'NETWORK_INSERT_COLUMNS',
      'NETWORK_LINK_INVALID',
      'NETWORK_NAME_INVALID',
      'NETWORK_NOT_FOUND',
      'NETWORK_PATCH_COLUMNS',
      'NETWORK_SLUG_TAKEN',
      'addChurchToNetwork',
      'createNetwork',
      'deleteNetwork',
      'fetchNetworkChurches',
      'fetchNetworks',
      'networkSlugCandidates',
      'removeChurchFromNetwork',
      'updateNetwork',
      'validateNetworkDraft',
    ])
  })
})

function tableBlock(sql: string, table: string) {
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

function hasColumn(block: string, column: string) {
  return new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(block)
}
