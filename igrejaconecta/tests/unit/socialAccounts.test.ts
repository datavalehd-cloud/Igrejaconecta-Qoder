import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAMPAIGN_NETWORKS } from '@/services/data/marketingService'
import {
  SOCIAL_COLUMNS,
  SOCIAL_CONNECT_LOCKED,
  SOCIAL_DUPLICATE,
  SOCIAL_HANDLE_REQUIRED,
  SOCIAL_INSERT_COLUMNS,
  SOCIAL_MANAGE_DENIED,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_UNSUPPORTED,
  SOCIAL_NO_CHURCH,
  SOCIAL_NOT_FOUND,
  createSocialAccount,
  deleteSocialAccount,
  fetchSocialAccounts,
  updateSocialHandle,
  validateHandle,
  validateSocialDraft,
  type SocialAccountActor,
  type SocialAccountDraft,
} from '@/services/data/socialAccountService'
import { can } from '@/utils/rbac'
import {
  demoCreateSocialAccount,
  demoDeleteSocialAccount,
  demoInsertConnected,
  demoSetSocialConnected,
  demoSocialAccounts,
  demoUpdateSocialHandle,
  resetSocialFixture,
  socialFixture,
} from '../fixtures/socialMirror'

/**
 * Perfis de rede da igreja (`church_social_accounts`, 0015) e o que a 0020 fez
 * com as redes de campanha. A recusa de verdade está na suíte SQL (Q6 handle,
 * Q7/Q7b conexão, Q8 estrutura); aqui fica especificada a mesma régua em
 * TypeScript e, sobretudo, o contrato do que sai pela rede: `connected` nunca.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

let accountsResult: { data: unknown; error: unknown } = { data: [], error: null }

const chain: Record<string, ReturnType<typeof vi.fn>> = {}
for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
  chain[method] = vi.fn(() => chain)
}
chain.maybeSingle = vi.fn(async () => accountsResult)
chain.then = vi.fn((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
  Promise.resolve(accountsResult).then(onFulfilled, onRejected),
)
const from = vi.fn(() => chain)

const socialDdl = tableBlock('0015_ministries_and_social_accounts.sql', 'church_social_accounts')
const migration15 = readFileSync(new URL('../../supabase/migrations/0015_ministries_and_social_accounts.sql', import.meta.url), 'utf8')
const migration20 = readFileSync(new URL('../../supabase/migrations/0020_drop_tiktok_from_campaigns.sql', import.meta.url), 'utf8')

function validDraft(overrides: Partial<SocialAccountDraft> = {}): SocialAccountDraft {
  return { network: 'instagram', handle: '  @ibcentral  ', ...overrides }
}

const admin: SocialAccountActor = { churchId: 'ch1', role: 'church_admin' }

beforeEach(() => {
  backend.supabase = { from }
  vi.resetAllMocks()
  chain.maybeSingle!.mockImplementation(async () => accountsResult)
  chain.then!.mockImplementation((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(accountsResult).then(onFulfilled, onRejected),
  )
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
    chain[method]!.mockImplementation(() => chain)
  }
  from.mockImplementation(() => chain)
  accountsResult = { data: [], error: null }
})

afterEach(() => {
  vi.restoreAllMocks()
  resetSocialFixture()
  backend.supabase = null
})

describe('projeção — o que chega ao navegador', () => {
  it('toda coluna projetada existe na tabela da migração 0015', () => {
    for (const column of SOCIAL_COLUMNS) {
      expect(new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(socialDdl), `church_social_accounts.${column}`).toBe(true)
    }
  })

  it('a projeção é exatamente a tabela: sem derived, sem campos de token', () => {
    expect(Object.keys(socialFixture[0]!).sort()).toEqual([...SOCIAL_COLUMNS].sort())
  })

  it('o insert não leva connected — nem por descuido, nem por default', () => {
    expect([...SOCIAL_INSERT_COLUMNS]).toEqual(['church_id', 'network', 'handle'])
    expect(SOCIAL_INSERT_COLUMNS).not.toContain('connected' as never)
    expect(socialDdl).toMatch(/connected\s+boolean not null default false/)
  })

  it('o trigger que segura a conexão vigia a coluna certa', () => {
    expect(migration15).toMatch(/create trigger trg_church_social_accounts_connection\s*\n\s*before insert or update of connected/)
    expect(migration15).toMatch(/raise exception 'marcar rede social como conectada exige confirmacao real do provedor \(backend\)'[\s\S]{0,80}errcode = '42501'/)
  })
})

describe('as duas listas de rede são duas, e o TikTok não está em nenhuma', () => {
  it('SOCIAL_NETWORKS é exatamente o CHECK de church_social_accounts.network', () => {
    const check = socialDdl.match(/check \(network in \(([^)]*)\)\)/)
    expect(check).not.toBeNull()
    expect(listOf(check![1]!).sort()).toEqual([...SOCIAL_NETWORKS].sort())  })

  it('CAMPAIGN_NETWORKS é exatamente o CHECK recriado pela 0020', () => {
    const check = migration20.match(/check \(networks <@ array\[([^\]]*)\]::text\[\]\)/)
    expect(check).not.toBeNull()
    expect(listOf(check![1]!).sort()).toEqual([...CAMPAIGN_NETWORKS].sort())
  })

  it('tiktok saiu do app inteiro: nem perfil, nem campanha, e o tipo não oferece', () => {
    expect(SOCIAL_NETWORKS).not.toContain('tiktok' as never)
    expect(CAMPAIGN_NETWORKS).not.toContain('tiktok' as never)
    expect(migration15).not.toContain('tiktok')
    // YouTube é o contrário: perfil aceita, campanha não.
    expect(SOCIAL_NETWORKS).toContain('youtube')
    expect(CAMPAIGN_NETWORKS).not.toContain('youtube' as never)
  })
})

describe('leitura demo — espelho das políticas', () => {
  it('membro lê só a própria igreja, em ordem de rede e handle', () => {
    const rows = demoSocialAccounts('ch1', admin)
    expect(rows.map((r) => r.id)).toEqual(['soc2', 'soc1', 'soc3'])
    expect(rows.every((r) => r.church_id === 'ch1')).toBe(true)
  })

  it('não vaza perfil da igreja vizinha', () => {
    expect(demoSocialAccounts('ch1', admin).map((r) => r.id)).not.toContain('soc4')
    expect(demoSocialAccounts('ch2', { churchId: 'ch2', role: 'church_admin' }).map((r) => r.id)).toEqual(['soc4'])
  })

  it('vínculo convidado não lê (a policy usa current_church_ids)', () => {
    expect(demoSocialAccounts('ch1', { churchId: 'ch1', role: 'communicator', userId: 'u3' })).toEqual([])
    expect(demoSocialAccounts('ch1', { churchId: 'ch1', role: 'communicator', userId: 'u5' }).length).toBeGreaterThan(0)
  })

  it('SuperAdmin lê todas; sem igreja na sessão não há o que listar', () => {
    expect(demoSocialAccounts(undefined, { role: 'superadmin' })).toHaveLength(4)
    expect(demoSocialAccounts(undefined, admin)).toEqual([])
  })

  it('nada nasce conectado no espelho — conectar é afirmação do provedor', () => {
    expect(socialFixture.every((r) => !r.connected)).toBe(true)
  })
})

describe('leitura real — contrato da consulta', () => {
  it('membro pede a tabela, a projeção, a ordem e o recorte por igreja', async () => {
    await fetchSocialAccounts('ch1', admin)
    expect(from).toHaveBeenCalledWith('church_social_accounts')
    expect(chain.select).toHaveBeenCalledWith(SOCIAL_COLUMNS.join(','))
    expect(chain.order).toHaveBeenCalledWith('network')
    expect(chain.order).toHaveBeenCalledWith('handle')
    expect(chain.eq).toHaveBeenCalledWith('church_id', 'ch1')
  })

  it('SuperAdmin não recorta por igreja: nenhuma chamada .eq', async () => {
    await fetchSocialAccounts(undefined, { role: 'superadmin' })
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('sem igreja na sessão não sai consulta nenhuma', async () => {
    expect(await fetchSocialAccounts(undefined, admin)).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('erro na leitura não recorre à lista fictícia', async () => {
    accountsResult = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchSocialAccounts('ch1', admin)).rejects.toThrow('falha de rede')
  })
})

describe('validateHandle / validateSocialDraft', () => {
  it('handle vazio ou só espaço não vale; 60 caracteres é o teto do CHECK', () => {
    expect(validateHandle('   ')).toBe(SOCIAL_HANDLE_REQUIRED)
    expect(validateHandle('x'.repeat(61))).toBe(SOCIAL_HANDLE_REQUIRED)
    expect(validateHandle('x'.repeat(60))).toBeNull()
  })

  it('rede fora do CHECK do banco é recusada antes de consultar', () => {
    expect(validateSocialDraft(validDraft({ network: 'tiktok' as SocialAccountDraft['network'] }))).toBe(SOCIAL_NETWORK_UNSUPPORTED)
    expect(validateSocialDraft(validDraft())).toBeNull()
  })
})

describe('escritas — portas de permissão', () => {
  it('quem entra na rota mas não gerencia a igreja não escreve, e nenhuma consulta sai', async () => {
    // A rota é guardada por marketing.manage; a escrita é church.manage. Gerente e
    // comunicador atravessam o guard e param aqui — a tela mostra leitura-ativada.
    expect(can('manager', 'marketing.manage')).toBe(true)
    expect(can('manager', 'church.manage')).toBe(false)
    for (const role of ['manager', 'communicator', 'pastor', 'visitor'] as const) {
      const actor: SocialAccountActor = { churchId: 'ch1', role }
      expect(await createSocialAccount(validDraft(), actor)).toEqual({ ok: false, error: SOCIAL_MANAGE_DENIED })
      expect(await updateSocialHandle('soc1', '@novo', actor)).toEqual({ ok: false, error: SOCIAL_MANAGE_DENIED })
      expect(await deleteSocialAccount('soc1', actor)).toEqual({ ok: false, error: SOCIAL_MANAGE_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('SuperAdmin tem a porta, mas sem igreja ativa não cadastra', async () => {
    expect(await createSocialAccount(validDraft(), { role: 'superadmin' })).toEqual({ ok: false, error: SOCIAL_NO_CHURCH })
  })

  it('a porta vem antes da validação: papel errado recebe a mensagem de permissão', async () => {
    expect(await createSocialAccount(validDraft({ handle: '  ' }), { churchId: 'ch1', role: 'manager' }))
      .toEqual({ ok: false, error: SOCIAL_MANAGE_DENIED })
  })
})

describe('connected é imutável pelo app', () => {
  it('nem o insert nem o update levam a coluna em nenhum payload', async () => {
    accountsResult = { data: socialFixture[0], error: null }
    await createSocialAccount(validDraft(), admin)
    expect(Object.keys(chain.insert!.mock.calls[0]![0] as Record<string, unknown>).sort())
      .toEqual(['church_id', 'handle', 'network'])
    await updateSocialHandle('soc1', '@ibcentral.novo', admin)
    expect(Object.keys(chain.update!.mock.calls[0]![0] as Record<string, unknown>)).toEqual(['handle'])
  })

  it('o espelho recusa conectar e desconectar pelo app, e aceita pelo backend', () => {
    expect(demoSetSocialConnected('soc1', true, admin)).toEqual({ ok: false, error: SOCIAL_CONNECT_LOCKED })
    expect(socialFixture.find((r) => r.id === 'soc1')!.connected).toBe(false)

    expect(demoSetSocialConnected('soc1', true, { ...admin, backend: true }).ok).toBe(true)
    expect(demoSetSocialConnected('soc1', false, admin)).toEqual({ ok: false, error: SOCIAL_CONNECT_LOCKED })
    expect(socialFixture.find((r) => r.id === 'soc1')!.connected).toBe(true)
  })

  it('inserir já conectada é recusado; pelo backend a linha nasce conectada', () => {
    expect(demoInsertConnected(validDraft(), admin)).toEqual({ ok: false, error: SOCIAL_CONNECT_LOCKED })
    expect(socialFixture).toHaveLength(4)
    const created = demoInsertConnected(validDraft({ handle: '@conectada' }), { ...admin, backend: true })
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.account.connected).toBe(true)
  })

  it('criar pelo app sempre grava connected false', () => {
    const created = demoCreateSocialAccount(validDraft({ handle: '@novaprof' }), admin)
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.account.connected).toBe(false)
  })
})

describe('sem oráculo de existência', () => {
  it('perfil da igreja vizinha dá a mesma mensagem de não-existente', () => {
    expect(demoUpdateSocialHandle('soc4', '@outra', admin)).toEqual({ ok: false, error: SOCIAL_NOT_FOUND })
    expect(demoDeleteSocialAccount('soc4', admin)).toEqual({ ok: false, error: SOCIAL_NOT_FOUND })
    expect(demoUpdateSocialHandle('id-que-nao-existe', '@novo', admin)).toEqual({ ok: false, error: SOCIAL_NOT_FOUND })
    expect(socialFixture.find((r) => r.id === 'soc4')!.church_id).toBe('ch2')
  })

  it('linha que não volta do banco é a mesma mensagem', async () => {
    accountsResult = { data: null, error: null }
    expect(await updateSocialHandle('soc4', '@novo', admin)).toEqual({ ok: false, error: SOCIAL_NOT_FOUND })
    accountsResult = { data: [], error: null }
    expect(await deleteSocialAccount('soc4', admin)).toEqual({ ok: false, error: SOCIAL_NOT_FOUND })
  })
})

describe('escrita real — contrato e erros do banco', () => {
  it('a criação manda o recorte da sessão e devolve a linha confirmada', async () => {
    const row = { id: 'nova', church_id: 'ch1', network: 'whatsapp', handle: '5512999990001', connected: false }
    accountsResult = { data: row, error: null }
    expect(await createSocialAccount(validDraft({ network: 'whatsapp', handle: ' 5512999990001 ' }), admin))
      .toEqual({ ok: true, account: row })
    expect(chain.insert).toHaveBeenCalledWith({ church_id: 'ch1', network: 'whatsapp', handle: '5512999990001' })
    expect(chain.select).toHaveBeenCalledWith(SOCIAL_COLUMNS.join(','))
  })

  it('a edição só manda o handle e aponta para a linha pelo id', async () => {
    const row = { ...socialFixture[0]!, handle: '@ibcentral.jovens' }
    accountsResult = { data: row, error: null }
    expect(await updateSocialHandle('soc1', ' @ibcentral.jovens ', admin)).toEqual({ ok: true, account: row })
    expect(chain.update).toHaveBeenCalledWith({ handle: '@ibcentral.jovens' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'soc1')
  })

  it('remover manda o delete por id e avisa quando a linha não estava alcançável', async () => {
    accountsResult = { data: [{ id: 'soc1' }], error: null }
    expect(await deleteSocialAccount('soc1', admin)).toEqual({ ok: true })
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'soc1')
  })

  it.each([
    ['policy recusando', '42501', 'row-level security', SOCIAL_NOT_FOUND],
    ['índice único de (igreja, rede, handle)', '23505', 'duplicate key value', SOCIAL_DUPLICATE],
    ['CHECK de rede ou handle', '23514', 'violates check constraint', 'Rede ou @handle fora do permitido: o @handle vai de 1 a 60 caracteres e a rede é Instagram, Facebook, WhatsApp ou YouTube.'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    accountsResult = { data: null, error: { code, message } }
    expect(await createSocialAccount(validDraft(), admin)).toEqual({ ok: false, error: esperado })
  })

  it('duplicata e handle inválido no espelho seguem a mesma régua do banco', () => {
    expect(demoCreateSocialAccount(validDraft({ handle: ' @IBCENTRAL ' }), admin)).toEqual({ ok: false, error: SOCIAL_DUPLICATE })
    expect(demoCreateSocialAccount(validDraft({ handle: '   ' }), admin)).toEqual({ ok: false, error: SOCIAL_HANDLE_REQUIRED })
    expect(socialFixture).toHaveLength(4)
  })

  it('o espelho edita e apaga de verdade a linha da própria igreja', () => {
    expect(demoUpdateSocialHandle('soc1', '@ibcentral.jovens', admin).ok).toBe(true)
    expect(socialFixture.find((r) => r.id === 'soc1')!.handle).toBe('@ibcentral.jovens')
    expect(demoDeleteSocialAccount('soc3', admin)).toEqual({ ok: true })
    expect(socialFixture.map((r) => r.id)).toEqual(['soc1', 'soc2', 'soc4'])
  })
})

function tableBlock(migration: string, table: string) {
  const sql = readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada em ${migration}`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

/** `'a','b','c'` → ['a','b','c'] — o que está escrito no CHECK, sem interpretações. */
function listOf(raw: string): string[] {
  return raw.split(',').map((item) => item.trim().replace(/^'|'$/g, '')).filter(Boolean)
}
