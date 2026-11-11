import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLATFORM_USER_SELECT,
  countDistinctUsers,
  demoPlatformUsers,
  fetchPlatformUsers,
} from '@/services/data/adminService'
import {
  EVENTS_MANAGED_COLUMNS,
  EVENTS_MANAGED_SELECT,
  demoAllEvents,
  fetchAllEvents,
} from '@/services/data/eventService'
import { demoChurchCampaigns } from '@/services/data/marketingService'
import { buildReportRows, groupReportRows, reportToCsv } from '@/utils/reports'
import { roleLabels } from '@/utils/rbac'
import type { Campaign, Church, ChurchEvent, PlatformUser, RegistrationStats, RoleKey } from '@/types'

/**
 * Leituras globais do SuperAdmin (Fase 8). Não há migração nem política nova: os
 * ramos `is_superadmin()` já existem (0002/0011) e são provados na suíte SQL. O que
 * estes testes amarram é a metade que vive no código:
 *   * o **gate** — quem não é `superadmin` recebe `[]` sem disparar consulta;
 *   * a **projeção** congelada — é ela que limita as colunas que chegam ao navegador,
 *     já que a RLS é por linha;
 *   * os **espelhos demo**, que reproduzem a mesma audiência transversal;
 *   * a **agregação/CSV** do relatório, puras e portanto mutáveis à prova.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn() }
const from = vi.fn()

const CHURCH_ROLES: RoleKey[] = ['church_admin', 'manager', 'communicator', 'pastor', 'visitor']

beforeEach(() => {
  backend.supabase = null
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockResolvedValue({ data: [], error: null })
  from.mockReturnValue(chain)
})

afterEach(() => {
  backend.supabase = null
})

function useRealClient() {
  backend.supabase = { from }
}

/** Colunas de tabela de uma linha devolvida, sem os campos derivados pelo serviço. */
function tableColumns(row: object, derived: readonly string[]) {
  return Object.keys(row).filter((key) => !derived.includes(key)).sort()
}

function migrationText(name: string) {
  return readFileSync(path.resolve(import.meta.dirname, `../../supabase/migrations/${name}`), 'utf8')
}

function tableBlock(migration: string, table: string) {
  const sql = migrationText(migration)
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada em ${migration}`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

function hasColumn(block: string, column: string) {
  return new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(block)
}

/** Texto de uma política, do `create policy` até o primeiro `;`. */
function policyBlock(sql: string, policy: string) {
  const start = sql.indexOf(`create policy ${policy} on`)
  if (start < 0) throw new Error(`política ${policy} ausente`)
  return sql.slice(start, sql.indexOf(';', start))
}

function stats(overrides: Partial<RegistrationStats>): RegistrationStats {
  return {
    event_id: 'e', church_id: 'c', capacity: null, pending_count: 0, confirmed_count: 0,
    waitlist_count: 0, checked_in_count: 0, cancelled_count: 0, active_count: 0, spots_left: null,
    ...overrides,
  }
}

describe('diretório global de usuários — espelho demo', () => {
  it('SuperAdmin vê todos os vínculos, com nome, igreja e papel resolvidos pelos IDs', () => {
    const rows = demoPlatformUsers('superadmin')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({
      user_id: 'u1', church_id: 'ch1', status: 'active', role: 'church_admin',
      church_name: 'Igreja Batista Central', name: 'Marcos Lima', email: 'marcos@ibcentral.org.br',
    })
  })

  it('resolve a igreja pelo church_id, não por texto gravado no vínculo', () => {
    const tiago = demoPlatformUsers('superadmin').find((u) => u.user_id === 'u4')
    expect(tiago).toMatchObject({ church_id: 'ch2', church_name: 'Comunidade Vida Nova', name: 'Tiago Reis', role: 'church_admin' })
  })

  it('ninguém além do SuperAdmin recebe o diretório global', () => {
    for (const role of CHURCH_ROLES) expect(demoPlatformUsers(role), role).toEqual([])
    expect(demoPlatformUsers()).toEqual([])
  })
})

describe('diretório global — contrato Supabase (cliente simulado)', () => {
  beforeEach(useRealClient)

  it('SuperAdmin pede a projeção congelada, ordena por created_at e não recorta por igreja', async () => {
    await fetchPlatformUsers('superadmin')
    expect(from).toHaveBeenCalledExactlyOnceWith('church_members')
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(PLATFORM_USER_SELECT)
    expect(chain.order).toHaveBeenCalledExactlyOnceWith('created_at')
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('quem não é SuperAdmin não dispara consulta nenhuma', async () => {
    for (const role of CHURCH_ROLES) expect(await fetchPlatformUsers(role), role).toEqual([])
    expect(await fetchPlatformUsers()).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('monta a linha a partir dos embeds confirmados pelo banco', async () => {
    chain.order.mockResolvedValue({
      data: [{ user_id: 'u-real', church_id: 'ch-real', status: 'active', roles: { key: 'manager' }, churches: { name: 'Igreja Real' }, profiles: { full_name: 'Pessoa Real', email: 'real@exemplo.com' } }],
      error: null,
    })
    const [row] = await fetchPlatformUsers('superadmin')
    expect(row).toEqual({
      user_id: 'u-real', church_id: 'ch-real', status: 'active', role: 'manager',
      church_name: 'Igreja Real', name: 'Pessoa Real', email: 'real@exemplo.com',
    })
  })

  it('papel/pessoa ausentes viram campo vazio; vínculo sem igreja confirmada não vira linha', async () => {
    chain.order.mockResolvedValue({
      data: [
        { user_id: 'u1', church_id: 'c1', status: 'invited', roles: null, churches: { name: 'Igreja' }, profiles: null },
        { user_id: 'u2', church_id: 'c2', status: 'active', roles: { key: 'pastor' }, churches: null, profiles: { full_name: 'X', email: 'x@y.z' } },
      ],
      error: null,
    })
    const rows = await fetchPlatformUsers('superadmin')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ user_id: 'u1', church_id: 'c1', status: 'invited', role: 'visitor', church_name: 'Igreja', name: '—', email: null })
  })

  it('erro na leitura não recorre à lista fictícia', async () => {
    chain.order.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    await expect(fetchPlatformUsers('superadmin')).rejects.toThrow('leitura recusada')
  })
})

describe('projeção PLATFORM_USER_SELECT — o contrato do que chega ao navegador', () => {
  it('é exatamente o combinado, sem coluna extra', () => {
    expect(PLATFORM_USER_SELECT).toBe('user_id, church_id, status, roles(key), churches(name), profiles(full_name, email)')
  })

  it('não vaza role_id, carimbos, telefone nem avatar', () => {
    for (const forbidden of ['role_id', 'created_at', 'updated_at', 'phone', 'avatar_url']) {
      expect(PLATFORM_USER_SELECT, `coluna ${forbidden} não deveria ir para o navegador`).not.toContain(forbidden)
    }
  })

  it('toda coluna projetada existe na tabela correspondente (0001)', () => {
    const membersDdl = tableBlock('0001_initial_schema.sql', 'church_members')
    for (const column of ['user_id', 'church_id', 'status']) expect(hasColumn(membersDdl, column), `church_members.${column}`).toBe(true)
    expect(hasColumn(tableBlock('0001_initial_schema.sql', 'roles'), 'key')).toBe(true)
    expect(hasColumn(tableBlock('0001_initial_schema.sql', 'churches'), 'name')).toBe(true)
    const profilesDdl = tableBlock('0001_initial_schema.sql', 'profiles')
    for (const column of ['full_name', 'email']) expect(hasColumn(profilesDdl, column), `profiles.${column}`).toBe(true)
  })

  it('os três embeds resolvem por FK real de church_members', () => {
    const ddl = tableBlock('0001_initial_schema.sql', 'church_members')
    expect(ddl).toMatch(/church_id\s+uuid not null references public\.churches \(id\)/)
    expect(ddl).toMatch(/user_id\s+uuid not null references public\.profiles \(id\)/)
    expect(ddl).toMatch(/role_id\s+uuid not null references public\.roles \(id\)/)
  })
})

describe('a leitura global está amparada em políticas reais (ramo is_superadmin)', () => {
  const rls = migrationText('0002_rls_policies.sql')

  it('church_members_read libera o SuperAdmin para ler todos os vínculos', () => {
    expect(policyBlock(rls, 'church_members_read')).toContain('public.is_superadmin()')
  })

  it('profiles_self_read libera o embed de nome/e-mail para o SuperAdmin', () => {
    expect(policyBlock(rls, 'profiles_self_read')).toContain('public.is_superadmin()')
  })

  it('churches_public_read deixa o SuperAdmin ler qualquer igreja, então churches(name) sempre resolve', () => {
    expect(policyBlock(rls, 'churches_public_read')).toContain('public.is_superadmin()')
  })

  it('roles é catálogo público, então roles(key) resolve', () => {
    expect(policyBlock(rls, 'roles_read')).toContain('using (true)')
  })

  it('events_church_read libera o SuperAdmin para ler todos os eventos', () => {
    expect(policyBlock(migrationText('0011_events.sql'), 'events_church_read')).toContain('public.is_superadmin()')
  })
})

describe('eventos globais — espelho demo', () => {
  it('SuperAdmin vê os eventos de todas as igrejas, em qualquer status, ordenados por início', () => {
    const rows = demoAllEvents('superadmin')
    expect(rows.map((e) => e.id)).toEqual(['e2', 'e1', 'e3', 'e4'])
    expect(rows.map((e) => e.church_id)).toEqual(['ch1', 'ch1', 'ch2', 'ch1'])
    expect(rows.filter((e) => e.status === 'published')).toHaveLength(2)
  })

  it('ninguém além do SuperAdmin recebe a agenda global', () => {
    for (const role of CHURCH_ROLES) expect(demoAllEvents(role), role).toEqual([])
    expect(demoAllEvents()).toEqual([])
  })

  it('a linha global tem as colunas de gestão — a mesma projeção da agenda da igreja, nada além', () => {
    const [row] = demoAllEvents('superadmin')
    expect(tableColumns(row!, ['category', 'church_name'])).toEqual([...EVENTS_MANAGED_COLUMNS].sort())
  })
})

describe('eventos globais — contrato Supabase (cliente simulado)', () => {
  beforeEach(useRealClient)

  it('SuperAdmin pede a projeção de gestão, ordena por início e não recorta por igreja', async () => {
    await fetchAllEvents('superadmin')
    expect(from).toHaveBeenCalledExactlyOnceWith('events')
    expect(chain.select).toHaveBeenCalledExactlyOnceWith(EVENTS_MANAGED_SELECT.join(','))
    expect(chain.order).toHaveBeenCalledExactlyOnceWith('starts_at')
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('quem não é SuperAdmin não dispara consulta nenhuma', async () => {
    expect(await fetchAllEvents('church_admin')).toEqual([])
    expect(await fetchAllEvents()).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('erro na leitura não recorre à agenda fictícia', async () => {
    chain.order.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    await expect(fetchAllEvents('superadmin')).rejects.toThrow('leitura recusada')
  })
})

describe('contagens honestas do painel (demo)', () => {
  it('o dashboard mostra 5 pessoas, 4 eventos (2 publicados) e 4 campanhas — nada chutado', () => {
    const users = demoPlatformUsers('superadmin')
    expect(users).toHaveLength(5)
    expect(countDistinctUsers(users)).toBe(5)
    const allEvents = demoAllEvents('superadmin')
    expect(allEvents).toHaveLength(4)
    expect(allEvents.filter((e) => e.status === 'published')).toHaveLength(2)
    expect(demoChurchCampaigns(undefined, { role: 'superadmin' })).toHaveLength(4)
  })

  it('countDistinctUsers conta pessoas, não vínculos', () => {
    const dup: PlatformUser[] = [
      { user_id: 'u1', church_id: 'a', status: 'active', role: 'church_admin', church_name: 'A', name: 'Um', email: 'u1@x' },
      { user_id: 'u1', church_id: 'b', status: 'active', role: 'manager', church_name: 'B', name: 'Um', email: 'u1@x' },
      { user_id: 'u2', church_id: 'a', status: 'active', role: 'visitor', church_name: 'A', name: 'Dois', email: 'u2@x' },
    ]
    expect(dup).toHaveLength(3)
    expect(countDistinctUsers(dup)).toBe(2)
  })
})

describe('relatório — agregação', () => {
  const input = {
    churches: [{ approval_status: 'approved' }, { approval_status: 'approved' }, { approval_status: 'pending' }] as unknown as Church[],
    events: [{ status: 'published' }, { status: 'published' }, { status: 'draft' }] as unknown as ChurchEvent[],
    campaigns: [{ status: 'scheduled' }, { status: 'draft' }] as unknown as Campaign[],
    users: [{ role: 'church_admin' }, { role: 'manager' }, { role: 'church_admin' }] as unknown as PlatformUser[],
    registrationStats: [stats({ confirmed_count: 2, checked_in_count: 1 }), stats({ pending_count: 3, waitlist_count: 1, cancelled_count: 1 })],
  }
  const rows = buildReportRows(input)
  const get = (categoria: string, item: string) => rows.find((r) => r.categoria === categoria && r.item === item)?.quantidade

  it('conta cada seção pelo campo certo', () => {
    expect(get('Igrejas por aprovação', 'Aprovada')).toBe(2)
    expect(get('Igrejas por aprovação', 'Pendente')).toBe(1)
    expect(get('Eventos por status', 'Publicado')).toBe(2)
    expect(get('Eventos por status', 'Rascunho')).toBe(1)
    expect(get('Campanhas por status', 'Agendada')).toBe(1)
    expect(get('Campanhas por status', 'Rascunho')).toBe(1)
    expect(get('Usuários por papel', roleLabels.church_admin)).toBe(2)
    expect(get('Usuários por papel', roleLabels.manager)).toBe(1)
  })

  it('inscrições somam os contadores de todas as linhas, sem usar active_count', () => {
    expect(get('Inscrições por status', 'Confirmadas')).toBe(2)
    expect(get('Inscrições por status', 'Check-in realizado')).toBe(1)
    expect(get('Inscrições por status', 'Pendentes')).toBe(3)
    expect(get('Inscrições por status', 'Lista de espera')).toBe(1)
    expect(get('Inscrições por status', 'Canceladas')).toBe(1)
  })

  it('toda chave do enum aparece, mesmo zerada — o relatório não esconde ausência', () => {
    expect(get('Igrejas por aprovação', 'Em análise')).toBe(0)
    expect(get('Igrejas por aprovação', 'Rejeitada')).toBe(0)
    expect(get('Igrejas por aprovação', 'Suspensa')).toBe(0)
    expect(get('Eventos por status', 'Agendado')).toBe(0)
    expect(get('Usuários por papel', roleLabels.pastor)).toBe(0)
    expect(rows).toHaveLength(5 + 5 + 5 + 6 + 5)
  })

  it('agrupa as linhas contíguas em seções, na ordem em que aparecem', () => {
    const sections = groupReportRows(rows)
    expect(sections.map((s) => s.title)).toEqual([
      'Igrejas por aprovação', 'Eventos por status', 'Campanhas por status', 'Usuários por papel', 'Inscrições por status',
    ])
    expect(sections[0]!.rows.map((r) => r.item)).toEqual(['Pendente', 'Em análise', 'Aprovada', 'Rejeitada', 'Suspensa'])
  })
})

describe('relatório — CSV', () => {
  it('tem cabeçalho, separador ; e CRLF, sem BOM (o BOM entra só no download)', () => {
    const csv = reportToCsv([{ categoria: 'Eventos por status', item: 'Publicado', quantidade: 2 }])
    expect(csv).toBe('"Categoria";"Item";"Quantidade"\r\n"Eventos por status";"Publicado";"2"')
    expect(csv.startsWith('\uFEFF')).toBe(false)
  })

  it('escapa aspas dobrando, como o CSV de inscrições', () => {
    expect(reportToCsv([{ categoria: 'C', item: 'asp"a', quantidade: 1 }])).toContain('"asp""a"')
  })
})
