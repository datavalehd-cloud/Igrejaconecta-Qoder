import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SECURITY_EVENT_KINDS,
  SECURITY_EVENT_LABEL,
  fetchSecurityLog,
  fetchSecuritySummary,
  logSecurityEvent,
  notePermissionDenied,
  notePublishDenied,
} from '@/services/data/securityService'

const backend = vi.hoisted(() => ({ supabase: null as { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

const rpc = vi.fn()
const from = vi.fn()
const summary = { select: vi.fn() }
const log = { select: vi.fn() }

const migration = readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/0019_security_events.sql'), 'utf8')

function view(name: string): string {
  const start = migration.indexOf(`create or replace view public.${name}`)
  if (start < 0) throw new Error(`View ${name} ausente da migração 0019`)
  return migration.slice(start, migration.indexOf(';', start))
}

beforeEach(() => {
  vi.resetAllMocks()
  rpc.mockResolvedValue({ data: null, error: null })
  summary.select.mockResolvedValue({ data: [], error: null })
  log.select.mockResolvedValue({ data: [], error: null })
  from.mockImplementation((table: string) => {
    if (table === 'security_event_summary') return summary
    if (table === 'security_event_log') return log
    throw new Error(`Tabela inesperada: ${table}`)
  })
  backend.supabase = { rpc, from }
})

afterEach(() => {
  backend.supabase = null
})

describe('o sinal de segurança (cliente simulado)', () => {
  it('registra pela RPC log_security_event, nunca por insert direto na tabela', async () => {
    await logSecurityEvent('permission_denied', 'storage.upload:church-logos', 'ch1')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('log_security_event', {
      p_kind: 'permission_denied',
      p_target: 'storage.upload:church-logos',
      p_church: 'ch1',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('alvo e igreja ausentes viram null — a RPC já descarta string vazia, mas o cliente não inventa valor', async () => {
    await logSecurityEvent('publish_denied')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('log_security_event', { p_kind: 'publish_denied', p_target: null, p_church: null })
  })

  it('monitor que falha não derruba quem o chamou: a RPC caindo não propaga', async () => {
    rpc.mockRejectedValue(new Error('rpc fora do ar'))
    await expect(logSecurityEvent('permission_denied', 'alvo')).resolves.toBeUndefined()
    expect(() => notePermissionDenied('alvo', 'ch1')).not.toThrow()
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
  })

  it('note* são fire-and-forget: retornam nada, não esperam e entregam o kind certo', async () => {
    expect(notePermissionDenied('t1', 'ch1')).toBeUndefined()
    expect(notePublishDenied('t2')).toBeUndefined()
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    expect(rpc.mock.calls[0][1]).toEqual({ p_kind: 'permission_denied', p_target: 't1', p_church: 'ch1' })
    expect(rpc.mock.calls[1][1]).toEqual({ p_kind: 'publish_denied', p_target: 't2', p_church: null })
  })

  it('resumo lê a view com as colunas exatas e repassa as linhas confirmadas pelo banco', async () => {
    const rows = [{ kind: 'permission_denied', last_24h: 2, last_7d: 3, total: 9, last_at: '2026-11-14T10:00:00Z' }]
    summary.select.mockResolvedValue({ data: rows, error: null })
    expect(await fetchSecuritySummary()).toEqual(rows)
    expect(from).toHaveBeenCalledExactlyOnceWith('security_event_summary')
    expect(summary.select).toHaveBeenCalledExactlyOnceWith('kind,last_24h,last_7d,total,last_at')
  })

  it('registro lê a view de log com as colunas exatas', async () => {
    const rows = [{ id: 'e1', kind: 'publish_denied', target: null, church_id: null, church_name: null, actor_id: null, actor_name: null, actor_email: null, created_at: '2026-11-14T10:00:00Z' }]
    log.select.mockResolvedValue({ data: rows, error: null })
    expect(await fetchSecurityLog()).toEqual(rows)
    expect(from).toHaveBeenCalledExactlyOnceWith('security_event_log')
    expect(log.select).toHaveBeenCalledExactlyOnceWith('id,kind,target,church_id,church_name,actor_id,actor_name,actor_email,created_at')
  })

  it('resumo sem linhas devolve lista vazia, e erro do banco lança em vez de fingir zero', async () => {
    summary.select.mockResolvedValue({ data: null, error: null })
    expect(await fetchSecuritySummary()).toEqual([])
    summary.select.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    await expect(fetchSecuritySummary()).rejects.toThrow('leitura recusada')
  })

  it('registro sem linhas devolve lista vazia, e erro do banco lança em vez de fingir zero', async () => {
    log.select.mockResolvedValue({ data: null, error: null })
    expect(await fetchSecurityLog()).toEqual([])
    log.select.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    await expect(fetchSecurityLog()).rejects.toThrow('leitura recusada')
  })
})

describe('contrato com a migração 0019', () => {
  it('os kinds do cliente são exatamente os do check constraint da tabela', () => {
    const check = migration.match(/check \(kind in \(([^)]+)\)\)/)
    if (!check) throw new Error('Check constraint de kind ausente da 0019')
    const sqlKinds = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect([...SECURITY_EVENT_KINDS]).toEqual(sqlKinds)
    expect(Object.keys(SECURITY_EVENT_LABEL)).toEqual(sqlKinds)
    for (const kind of SECURITY_EVENT_KINDS) expect(SECURITY_EVENT_LABEL[kind].length).toBeGreaterThan(0)
  })

  it('os parâmetros da RPC existem com os nomes que o cliente envia', () => {
    const signature = migration.match(/function public\.log_security_event\(([^)]*)\)/)
    if (!signature) throw new Error('Função log_security_event ausente da 0019')
    for (const param of ['p_kind', 'p_target', 'p_church']) expect(signature[1]).toContain(param)
  })

  it('as duas views recortam para SuperAdmin: para os demais papéis o banco devolve zero linhas, não erro', () => {
    expect(view('security_event_summary')).toContain('public.is_superadmin()')
    expect(view('security_event_log')).toContain('public.is_superadmin()')
  })

  it('cada coluna que o cliente seleciona existe na view correspondente', () => {
    for (const col of ['kind', 'last_24h', 'last_7d', 'total', 'last_at']) {
      expect(view('security_event_summary')).toMatch(new RegExp(`\\b${col}\\b`))
    }
    for (const col of ['id', 'kind', 'target', 'church_id', 'church_name', 'actor_id', 'actor_name', 'actor_email', 'created_at']) {
      expect(view('security_event_log')).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('o serviço só alcança as duas views: nenhuma escrita direta em security_events', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../src/services/data/securityService.ts'), 'utf8')
    const tables = [...new Set([...source.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]))].sort()
    expect(tables).toEqual(['security_event_log', 'security_event_summary'])
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/)
  })
})
