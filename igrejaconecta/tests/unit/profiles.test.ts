import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHURCH_EDITABLE_COLUMNS,
  CHURCH_LOCKED_COLUMNS,
  CHURCH_PROFILE_COLUMNS,
  CHURCH_PROFILE_MANAGE_DENIED,
  CHURCH_PROFILE_NAME_REQUIRED,
  CHURCH_PROFILE_NO_CHURCH,
  CHURCH_PROFILE_NOT_FOUND,
  buildChurchPatch,
  fetchChurchProfile,
  parseCoordinate,
  updateChurchProfile,
  validateChurchProfile,
  type ChurchProfileDraft,
} from '@/services/data/churchProfileService'
import {
  MY_PROFILE_COLUMNS,
  MY_PROFILE_EDITABLE_COLUMNS,
  MY_PROFILE_LOCKED_COLUMNS,
  MY_PROFILE_NAME_REQUIRED,
  MY_PROFILE_NO_ACTOR,
  MY_PROFILE_NOT_FOUND,
  buildMyProfilePatch,
  updateMyProfile,
  validateMyProfile,
  type MyProfileDraft,
} from '@/services/data/myProfileService'
import { can } from '@/utils/rbac'

/**
 * M3c — os dois perfis que gravam: `churches` (perfil institucional) e `profiles`
 * (perfil pessoal). O que importa aqui é o contrato do que sai pela rede, porque
 * RLS em Postgres é por linha: `churches_update` (0002) deixa um `church_admin`
 * escrever *qualquer* coluna da própria igreja. O recorte por coluna é deste
 * serviço, e o que prova que ele não abre é a lista de chaves do patch.
 *
 * A recusa de verdade (quem pode, de qual igreja) está na suíte SQL — C4/C5, C17
 * e C18. Aqui fica o que o SQL não vê: nenhuma chave travada no payload.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

let result: { data: unknown; error: unknown } = { data: null, error: null }

const chain: Record<string, ReturnType<typeof vi.fn>> = {}
for (const method of ['select', 'eq', 'update', 'maybeSingle', 'then']) {
  chain[method] = vi.fn()
}
chain.select!.mockImplementation(() => chain)
chain.eq!.mockImplementation(() => chain)
chain.update!.mockImplementation(() => chain)
chain.maybeSingle!.mockImplementation(async () => result)
chain.then!.mockImplementation((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
  Promise.resolve(result).then(onFulfilled, onRejected),
)
const from = vi.fn(() => chain)

const churchesDdl = tableBlock('0001_initial_schema.sql', 'churches')
const profilesDdl = tableBlock('0001_initial_schema.sql', 'profiles')
const migration04 = readFileSync(new URL('../../supabase/migrations/0004_rls_hardening.sql', import.meta.url), 'utf8')
const migration02 = readFileSync(new URL('../../supabase/migrations/0002_rls_policies.sql', import.meta.url), 'utf8')

function draft(overrides: Partial<ChurchProfileDraft> = {}): ChurchProfileDraft {
  return {
    name: 'Igreja Central',
    description: 'Uma igreja',
    denomination: 'Assembleia',
    email: 'contato@central.org',
    phone: '12 3000-0000',
    whatsapp: '5512999990000',
    website: 'central.org',
    address: 'Rua A, 100',
    city: 'Jacutinga',
    state: 'MG',
    zip: '37590-000',
    lat: '-23.1857',
    lng: '-45.8871',
    ...overrides,
  }
}

const admin = { churchId: 'ch1', role: 'church_admin' as const }

beforeEach(() => {
  backend.supabase = { from }
  vi.resetAllMocks()
  chain.select!.mockImplementation(() => chain)
  chain.eq!.mockImplementation(() => chain)
  chain.update!.mockImplementation(() => chain)
  chain.maybeSingle!.mockImplementation(async () => result)
  chain.then!.mockImplementation((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected),
  )
  from.mockImplementation(() => chain)
  result = { data: null, error: null }
})

afterEach(() => {
  vi.restoreAllMocks()
  backend.supabase = null
})

describe('igreja — projeção e o que a tabela tem', () => {
  it('toda coluna projetada existe na tabela churches da migração 0001', () => {
    for (const column of CHURCH_PROFILE_COLUMNS) {
      expect(ddlColumns(churchesDdl), column).toContain(column)
    }
  })

  it('editáveis + travadas cobrem a tabela inteira, menos as duas de arquivo', () => {
    // A régua é de conjunto: se alguém adicionar coluna na tabela sem dizer o que
    // a tela faz com ela, isto aqui quebra em vez de deixar a coluna solta.
    const handled = new Set<string>([...CHURCH_EDITABLE_COLUMNS, ...CHURCH_LOCKED_COLUMNS])
    expect(ddlColumns(churchesDdl).filter((c) => !handled.has(c))).toEqual(['logo_url', 'cover_url'])
  })

  it('nenhuma coluna aparece nas duas listas ao mesmo tempo', () => {
    const overlap = CHURCH_EDITABLE_COLUMNS.filter((c) => (CHURCH_LOCKED_COLUMNS as readonly string[]).includes(c))
    expect(overlap).toEqual([])
  })

  it('a tela não oferece logo nem capa: as duas também não estão na projeção', () => {
    // Não há upload (M4) e nenhuma tela renderiza a imagem. Mandar o campo em
    // branco apagaria o que o banco tivesse.
    expect(CHURCH_PROFILE_COLUMNS).not.toContain('logo_url' as never)
    expect(CHURCH_PROFILE_COLUMNS).not.toContain('cover_url' as never)
  })
})

describe('igreja — o patch', () => {
  it('as chaves do patch são exatamente as colunas editáveis, na ordem da lista', () => {
    expect(Object.keys(buildChurchPatch(draft()))).toEqual([...CHURCH_EDITABLE_COLUMNS])
  })

  it('nenhuma coluna travada entra no payload, nem com valor válido', () => {
    const payload = buildChurchPatch(draft())
    for (const locked of CHURCH_LOCKED_COLUMNS) {
      expect(Object.keys(payload)).not.toContain(locked)
    }
    // Os três que importam, ditos pelo nome: aprovação, status e endereço público.
    expect(payload).not.toHaveProperty('approval_status')
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('slug')
  })

  it('campo de texto em branco vira null: limpar funciona', () => {
    const payload = buildChurchPatch(draft({ description: '   ', city: '', zip: '' }))
    expect(payload).toMatchObject({ description: null, city: null, zip: null })
  })

  it('nome e descrição são aparados; coordenada aceita vírgula', () => {
    const payload = buildChurchPatch(draft({ name: '  Igreja Central  ', lat: '-23,1857' }))
    expect(payload.name).toBe('Igreja Central')
    expect(payload.lat).toBe(-23.1857)
  })

  it('parseCoordinate: vazio é null, lixo é null, número é número', () => {
    expect(parseCoordinate('')).toBeNull()
    expect(parseCoordinate('   ')).toBeNull()
    expect(parseCoordinate('abc')).toBeNull()
    expect(parseCoordinate('0')).toBe(0)
    expect(parseCoordinate(' -45.8871 ')).toBe(-45.8871)
  })
})

describe('igreja — validação', () => {
  it('nome curto é recusado com a mensagem do serviço', () => {
    expect(validateChurchProfile(draft({ name: '  Ib ' }))).toBe(CHURCH_PROFILE_NAME_REQUIRED)
    expect(validateChurchProfile(draft({ name: 'Ib' }))).toBe(CHURCH_PROFILE_NAME_REQUIRED)
    expect(validateChurchProfile(draft())).toBeNull()
  })

  it('latitude sem longitude (e o contrário) é recusada antes de consultar', () => {
    expect(validateChurchProfile(draft({ lng: '' }))).toBe('Informe latitude e longitude juntas, ou deixe as duas em branco.')
    expect(validateChurchProfile(draft({ lat: '' }))).toBe('Informe latitude e longitude juntas, ou deixe as duas em branco.')
  })

  it('coordenada fora do CHECK da 0013 é recusada em português', () => {
    expect(validateChurchProfile(draft({ lat: '-91' }))).toBe('A latitude precisa ser um número entre -90 e 90.')
    expect(validateChurchProfile(draft({ lng: '200' }))).toBe('A longitude precisa ser um número entre -180 e 180.')
  })

  it('as duas em branco são válidas: igreja sem coordenada é estado normal', () => {
    expect(validateChurchProfile(draft({ lat: '', lng: '' }))).toBeNull()
  })
})

describe('igreja — porta de permissão vem antes de qualquer consulta', () => {
  it('quem não gerencia a igreja recebe a recusa, e nada sai pela rede', async () => {
    expect(can('manager', 'church.manage')).toBe(false)
    expect(can('communicator', 'church.manage')).toBe(false)
    for (const role of ['manager', 'communicator', 'pastor', 'visitor'] as const) {
      expect(await updateChurchProfile(draft(), { churchId: 'ch1', role })).toEqual({ ok: false, error: CHURCH_PROFILE_MANAGE_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('sem papel na sessão também é recusa', async () => {
    expect(await updateChurchProfile(draft(), { churchId: 'ch1' })).toEqual({ ok: false, error: CHURCH_PROFILE_MANAGE_DENIED })
    expect(await updateChurchProfile(draft(), {})).toEqual({ ok: false, error: CHURCH_PROFILE_MANAGE_DENIED })
    expect(from).not.toHaveBeenCalled()
  })

  it('a recusa de papel vem antes da validação: papel errado não recebe "nome curto"', async () => {
    expect(await updateChurchProfile(draft({ name: 'x' }), { churchId: 'ch1', role: 'manager' }))
      .toEqual({ ok: false, error: CHURCH_PROFILE_MANAGE_DENIED })
  })

  it('SuperAdmin tem a porta, mas sem igreja ativa não escreve', async () => {
    expect(can('superadmin', 'church.manage')).toBe(true)
    expect(await updateChurchProfile(draft(), { role: 'superadmin' })).toEqual({ ok: false, error: CHURCH_PROFILE_NO_CHURCH })
    expect(from).not.toHaveBeenCalled()
  })

  it('campo inválido não chega ao banco', async () => {
    expect(await updateChurchProfile(draft({ name: '' }), admin)).toEqual({ ok: false, error: CHURCH_PROFILE_NAME_REQUIRED })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('igreja — contrato da consulta', () => {
  it('a leitura pede a tabela, a projeção e o recorte por id', async () => {
    const row = { id: 'ch1', name: 'Igreja Central', slug: 'central', status: 'active', approval_status: 'approved' }
    result = { data: row, error: null }
    expect(await fetchChurchProfile('ch1')).toEqual(row)
    expect(from).toHaveBeenCalledWith('churches')
    expect(chain.select).toHaveBeenCalledWith(CHURCH_PROFILE_COLUMNS.join(','))
    expect(chain.eq).toHaveBeenCalledWith('id', 'ch1')
  })

  it('sem igreja na sessão não sai consulta nenhuma', async () => {
    expect(await fetchChurchProfile(undefined)).toBeNull()
    expect(await fetchChurchProfile('')).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('erro na leitura não recorre a cadastro fictício', async () => {
    result = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchChurchProfile('ch1')).rejects.toThrow('falha de rede')
  })

  it('a escrita manda o patch pelo id da própria igreja e devolve a linha confirmada', async () => {
    const row = { ...draft(), id: 'ch1', slug: 'central', status: 'active', approval_status: 'approved' }
    result = { data: row, error: null }
    expect(await updateChurchProfile(draft({ name: 'Igreja Central Nova' }), admin)).toEqual({ ok: true, church: row })
    expect(chain.update).toHaveBeenCalledWith({ ...buildChurchPatch(draft({ name: 'Igreja Central Nova' })) })
    expect(chain.eq).toHaveBeenCalledWith('id', 'ch1')
    expect(chain.select).toHaveBeenCalledWith(CHURCH_PROFILE_COLUMNS.join(','))
  })

  it('linha que não volta é "não encontrada", sem dizer se existe', async () => {
    result = { data: null, error: null }
    expect(await updateChurchProfile(draft(), admin)).toEqual({ ok: false, error: CHURCH_PROFILE_NOT_FOUND })
  })

  it.each([
    ['policy recusando', '42501', 'row-level security', CHURCH_PROFILE_NOT_FOUND],
    ['CHECK de lat/lng', '23514', 'violates check constraint', 'Algum campo está fora do permitido: a latitude vai de -90 a 90, a longitude de -180 a 180, e as duas entram juntas.'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    result = { data: null, error: { code, message } }
    expect(await updateChurchProfile(draft(), admin)).toEqual({ ok: false, error: esperado })
  })
})

describe('igreja — a guarda de aprovação continua no banco', () => {
  it('a 0004 recusa mudança de approval_status fora do SuperAdmin', () => {
    // O app não manda a coluna; quem manda é a API direta. A camada do banco fica
    // onde está, e este teste avisa se ela sair.
    expect(migration04).toMatch(/if new\.approval_status is distinct from old\.approval_status\s*\n\s*and not public\.is_superadmin\(\) then/)
    expect(migration04).toMatch(/raise exception 'approval_status só pode ser alterado pelo SuperAdmin'\s*\n\s*using errcode = '42501'/)
    expect(migration04).toMatch(/create trigger trg_churches_approval_status\s*\n\s*before update on public\.churches/)
  })

  it('a 0002 dá a escrita de churches a church.manage, não a uma coluna', () => {
    const block = policyBlock(migration02, 'churches_update')
    expect(block).toContain("has_church_permission(id, 'church.manage')")
    expect(block).not.toMatch(/name\s*=|column/)
  })
})

describe('pessoal — o que a tela de perfil pode gravar', () => {
  it('toda coluna projetada existe na tabela profiles da migração 0001', () => {
    for (const column of MY_PROFILE_COLUMNS) {
      expect(ddlColumns(profilesDdl), column).toContain(column)
    }
  })

  it('o patch tem exatamente nome e telefone', () => {
    expect(Object.keys(buildMyProfilePatch({ full_name: ' Ana ', phone: ' 12 9 9999-0000 ' })))
      .toEqual([...MY_PROFILE_EDITABLE_COLUMNS])
    expect(buildMyProfilePatch({ full_name: 'Ana', phone: '   ' })).toEqual({ full_name: 'Ana', phone: null })
  })

  it('e-mail, id e avatar nunca saem do app', () => {
    const payload = buildMyProfilePatch({ full_name: 'Ana', phone: '12' })
    for (const locked of MY_PROFILE_LOCKED_COLUMNS) {
      expect(Object.keys(payload)).not.toContain(locked)
    }
    expect(MY_PROFILE_EDITABLE_COLUMNS).not.toContain('email' as never)
  })

  it('a política de escrita é só a própria conta: SuperAdmin não tem exceção', () => {
    const block = policyBlock(migration02, 'profiles_self_update')
    expect(block).toMatch(/using \(id = auth\.uid\(\)\) with check \(id = auth\.uid\(\)\)/)
    expect(block).not.toContain('is_superadmin')
  })
})

describe('pessoal — escrita', () => {
  const profileRow = { id: 'u1', full_name: 'Ana Lima', email: 'ana@central.org', phone: '12 99999-0000' }

  it('pede a tabela profiles, o recorte pelo próprio id e devolve a linha confirmada', async () => {
    result = { data: profileRow, error: null }
    const form: MyProfileDraft = { full_name: 'Ana Lima', phone: '12 99999-0000' }
    expect(await updateMyProfile(form, { userId: 'u1' })).toEqual({ ok: true, profile: profileRow })
    expect(from).toHaveBeenCalledWith('profiles')
    expect(chain.update).toHaveBeenCalledWith({ full_name: 'Ana Lima', phone: '12 99999-0000' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'u1')
    expect(chain.select).toHaveBeenCalledWith(MY_PROFILE_COLUMNS.join(','))
  })

  it('sem sessão não sai consulta nenhuma', async () => {
    expect(await updateMyProfile({ full_name: 'Ana', phone: '' }, {})).toEqual({ ok: false, error: MY_PROFILE_NO_ACTOR })
    expect(await updateMyProfile({ full_name: 'Ana', phone: '' }, { userId: '' })).toEqual({ ok: false, error: MY_PROFILE_NO_ACTOR })
    expect(from).not.toHaveBeenCalled()
  })

  it('nome vazio é recusado antes de consultar: é assim que a pessoa aparece', async () => {
    expect(validateMyProfile({ full_name: '   ', phone: '12' })).toBe(MY_PROFILE_NAME_REQUIRED)
    expect(await updateMyProfile({ full_name: '  ', phone: '' }, { userId: 'u1' })).toEqual({ ok: false, error: MY_PROFILE_NAME_REQUIRED })
    expect(from).not.toHaveBeenCalled()
  })

  it('linha que não volta e policy que recusa dizem a mesma coisa', async () => {
    result = { data: null, error: null }
    expect(await updateMyProfile({ full_name: 'Ana', phone: '' }, { userId: 'u1' })).toEqual({ ok: false, error: MY_PROFILE_NOT_FOUND })
    result = { data: null, error: { code: '42501', message: 'row-level security' } }
    expect(await updateMyProfile({ full_name: 'Ana', phone: '' }, { userId: 'u1' })).toEqual({ ok: false, error: MY_PROFILE_NOT_FOUND })
  })

  it('telefone em branco limpa o número gravado', async () => {
    result = { data: { ...profileRow, phone: null }, error: null }
    const res = await updateMyProfile({ full_name: 'Ana Lima', phone: '   ' }, { userId: 'u1' })
    expect(res.ok).toBe(true)
    expect(chain.update).toHaveBeenCalledWith({ full_name: 'Ana Lima', phone: null })
  })
})

function tableBlock(migration: string, table: string) {
  const sql = readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada em ${migration}`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

/** Os nomes de coluna declarados no bloco CREATE TABLE, na ordem do arquivo. */
function ddlColumns(block: string): string[] {
  return block
    .split('\n')
    // Coluna é o que está a dois espaços; as linhas de CHECK continuam mais fundo.
    .map((line) => line.match(/^ {2}([a-z_]+)\s+\S/)?.[1])
    .filter((name): name is string => Boolean(name))
}

function policyBlock(sql: string, policy: string): string {
  const start = sql.indexOf(`create policy ${policy} on`)
  if (start < 0) throw new Error(`policy ${policy} não encontrada`)
  const end = sql.indexOf(';', start)
  return sql.slice(start, end)
}
