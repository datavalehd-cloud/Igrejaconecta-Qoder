import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { churches, auditLogs } from '@/data/mock'
import * as auditService from '@/services/data/auditService'
import { AUDIT_ACTION, AUDIT_COLUMNS, AUDIT_SELECT, approvalAuditAction, fetchAuditTrail } from '@/services/data/auditService'
import { APPROVAL_COLUMNS, setChurchApprovalStatus, type ApprovalActor, type ApprovalResult } from '@/services/data/churchApprovalService'
import type { ApprovalStatus, Church } from '@/types'
import { demoSetApproval } from '../fixtures/churchMirror'

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

const admin = { id: 'u0', email: 'admin@igrejaconecta.app', role: 'superadmin' } satisfies ApprovalActor
const originalChurches = structuredClone(churches)
const originalAudit = structuredClone(auditLogs)
const transitions = [
  ['pending', 'approved', 'igreja.aprovada'],
  ['suspended', 'approved', 'igreja.reativada'],
  ['approved', 'suspended', 'igreja.suspensa'],
  ['pending', 'rejected', 'igreja.rejeitada'],
  ['rejected', 'in_review', 'igreja.em_analise'],
  ['in_review', 'pending', 'igreja.pendente'],
] as const satisfies readonly (readonly [ApprovalStatus, ApprovalStatus, string])[]
const statuses = ['pending', 'in_review', 'approved', 'rejected', 'suspended'] as const satisfies readonly ApprovalStatus[]
const confirmed = { id: 'ch3', name: 'Nome confirmado pelo banco', slug: 'confirmada', status: 'active', approval_status: 'approved', updated_at: '2026-11-10T10:00:00Z' }
const read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }
const update = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() }
const audit = { insert: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(), order: vi.fn() }
const from = vi.fn()

beforeEach(() => {
  backend.supabase = null
  vi.resetAllMocks()
  read.select.mockReturnValue(read)
  read.eq.mockReturnValue(read)
  read.maybeSingle.mockResolvedValue({ data: { approval_status: 'pending' }, error: null })
  update.update.mockReturnValue(update)
  update.eq.mockReturnValue(update)
  update.select.mockReturnValue(update)
  update.maybeSingle.mockResolvedValue({ data: confirmed, error: null })
  audit.insert.mockReturnValue(audit)
  audit.select.mockReturnValue(audit)
  audit.maybeSingle.mockResolvedValue({ data: { id: 'log-confirmado' }, error: null })
  audit.order.mockResolvedValue({ data: [], error: null })
  from.mockImplementation((table: string) => {
    if (table === 'audit_logs') return audit
    if (table === 'churches') return { select: read.select, update: update.update }
    throw new Error(`Tabela inesperada: ${table}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  churches.splice(0, churches.length, ...structuredClone(originalChurches))
  auditLogs.splice(0, auditLogs.length, ...structuredClone(originalAudit))
  backend.supabase = null
})

function useRealClient() {
  backend.supabase = { from }
}

function approvalProjection(church: Church) {
  return Object.fromEntries(APPROVAL_COLUMNS.map((column) => [column, church[column]]))
}

function expectFailure(result: ApprovalResult) {
  expect(result).toEqual({ ok: false, error: expect.any(String) })
  if (result.ok) throw new Error('Falha tratada como aprovação confirmada')
  expect(result.error).not.toBe('')
}

function expectOnlyChurchUpdate(churchId = 'ch3', next: ApprovalStatus = 'approved') {
  expect(from).toHaveBeenCalledExactlyOnceWith('churches')
  expect(update.update).toHaveBeenCalledExactlyOnceWith({ approval_status: next })
  expect(update.eq).toHaveBeenCalledExactlyOnceWith('id', churchId)
  expect(update.select).toHaveBeenCalledExactlyOnceWith(APPROVAL_COLUMNS.join(','))
  expect(update.maybeSingle).toHaveBeenCalledExactlyOnceWith()
  for (const method of [read.select, read.eq, read.maybeSingle, audit.insert, audit.select, audit.maybeSingle, audit.order]) {
    expect(method).not.toHaveBeenCalled()
  }
  const calls = [from, update.update, update.eq, update.select, update.maybeSingle].map((method) => method.mock.invocationCallOrder[0])
  expect(calls).toEqual([...calls].sort((a, b) => a - b))
  expect(churches).toEqual(originalChurches)
  expect(auditLogs).toEqual(originalAudit)
}

describe('trilha — loja do fixture', () => {
  it('prepara a trilha antes de mudar a igreja', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = '2026-11-10T10:00:00.000Z'
    vi.setSystemTime(new Date(now))
    const id = '00000000-0000-4000-8000-000000000001'
    const church = churches.find((c) => c.id === 'ch3')!
    const before = structuredClone(church)
    const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      expect(church).toEqual(before)
      expect(auditLogs.slice()).toEqual(originalAudit)
      return id
    })
    const action = vi.spyOn(auditService, 'approvalAuditAction')
    const expectedLog = {
      id, actor: admin.email, action: 'igreja.aprovada', target: church.name,
      church: church.name, metadata: { de: 'pending', para: 'approved' }, created_at: now,
    }
    const push = vi.spyOn(auditLogs, 'push').mockImplementation((...rows) => {
      expect(church).toEqual(before)
      expect(rows).toEqual([expectedLog])
      return Array.prototype.push.apply(auditLogs, rows)
    })

    const result = demoSetApproval('ch3', 'approved', admin)
    expect(result).toEqual({ ok: true, church: approvalProjection(church) })
    expect(church).toEqual({ ...before, approval_status: 'approved', updated_at: now })
    expect(uuid).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledExactlyOnceWith('pending', 'approved')
    expect(push).toHaveBeenCalledExactlyOnceWith(expectedLog)
    expect(auditLogs.slice()).toEqual([...originalAudit, expectedLog])
  })

  it('não registra recusa de papel nem igreja inexistente', () => {
    for (const role of ['church_admin', 'manager', 'pastor', 'communicator', 'visitor', undefined] as const) {
      expectFailure(demoSetApproval('ch3', 'approved', { ...admin, role }))
    }
    expectFailure(demoSetApproval('inexistente', 'approved', admin))
    expect(auditLogs).toEqual(originalAudit)
    expect(churches).toEqual(originalChurches)
  })

  it.each(statuses)('repetir %s não muda a data nem prepara ou acrescenta trilha', (status) => {
    const church = churches.find((c) => c.id === 'ch3')!
    church.approval_status = status
    const before = structuredClone(churches)
    const uuid = vi.spyOn(crypto, 'randomUUID')
    const push = vi.spyOn(auditLogs, 'push')
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(demoSetApproval(church.id, status, admin)).toEqual({ ok: true, church: approvalProjection(church) })
    }
    expect(uuid).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(churches).toEqual(before)
    expect(auditLogs.slice()).toEqual(originalAudit)
  })

  it.each(['ação', 'UUID', 'data', 'push'] as const)('falha em %s deixa igreja e histórico intactos', (stage) => {
    const church = churches.find((c) => c.id === 'ch3')!
    const before = structuredClone(church)
    const failure = new Error(`Falha de preparação: ${stage}`)
    const fail = () => { throw failure }
    const spy = stage === 'ação' ? vi.spyOn(auditService, 'approvalAuditAction').mockImplementation(fail)
      : stage === 'UUID' ? vi.spyOn(crypto, 'randomUUID').mockImplementation(fail)
        : stage === 'data' ? vi.spyOn(Date.prototype, 'toISOString').mockImplementation(fail)
          : vi.spyOn(auditLogs, 'push').mockImplementation(fail)

    // A trilha precede a igreja: se a preparação estoura, nada é escrito nem mutado.
    expect(() => demoSetApproval('ch3', 'approved', admin)).toThrow(failure)
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
    expect(church).toEqual(before)
    expect(churches).toEqual(originalChurches)
    expect(auditLogs).toEqual(originalAudit)
  })

  it('registra suspensão e reativação com IDs distintos e sem reescrever o histórico', () => {
    demoSetApproval('ch1', 'suspended', admin)
    demoSetApproval('ch1', 'approved', admin)
    const added = auditLogs.slice(originalAudit.length)
    expect(added.map((l) => l.action)).toEqual(['igreja.suspensa', 'igreja.reativada'])
    expect(added.map((l) => l.metadata)).toEqual([{ de: 'approved', para: 'suspended' }, { de: 'suspended', para: 'approved' }])
    expect(new Set(added.map((l) => l.id)).size).toBe(2)
    expect(auditLogs.slice(0, originalAudit.length)).toEqual(originalAudit)
  })

  it.each(transitions)('deriva %s → %s como %s', (previous, next, action) => {
    expect(approvalAuditAction(previous, next)).toBe(action)
  })

  it.each(transitions)('persiste %s → %s com o mesmo verbo %s', (previous, next, action) => {
    const church = churches.find((c) => c.id === 'ch3')!
    church.approval_status = previous
    const result = demoSetApproval(church.id, next, admin)
    expect(result).toEqual({ ok: true, church: approvalProjection(church) })
    expect(church.approval_status).toBe(next)
    expect(auditLogs.slice(originalAudit.length)).toEqual([expect.objectContaining({
      actor: admin.email, action, target: church.name, church: church.name,
      metadata: { de: previous, para: next },
    })])
    expect(auditLogs.slice(0, originalAudit.length)).toEqual(originalAudit)
  })
})

describe('contrato Supabase da trilha (cliente simulado)', () => {
  beforeEach(useRealClient)

  it('sessão ausente recusa antes de qualquer chamada ao banco', async () => {
    expectFailure(await setChurchApprovalStatus('ch3', 'approved'))
    expect(from).not.toHaveBeenCalled()
  })

  it('aguarda um único update e retorna apenas a igreja com os valores do banco', async () => {
    let resolveUpdate!: (value: unknown) => void
    update.maybeSingle.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    const settled = vi.fn()
    const pending = setChurchApprovalStatus('ch3', 'approved', admin).then((result) => {
      settled(result)
      return result
    })
    await vi.waitFor(() => expect(update.maybeSingle).toHaveBeenCalledOnce())
    expect(settled).not.toHaveBeenCalled()
    expectOnlyChurchUpdate()
    const row = { ...confirmed, approval_status: 'in_review', status: 'inactive' }
    resolveUpdate({ data: row, error: null })
    expect(await pending).toEqual({ ok: true, church: row })
    expectOnlyChurchUpdate()
  })

  it.each(statuses)('envia só approval_status para %s, sem ler o estado anterior', async (next) => {
    const row = { ...confirmed, approval_status: next }
    update.maybeSingle.mockResolvedValue({ data: row, error: null })
    expect(await setChurchApprovalStatus('ch3', next, admin)).toEqual({ ok: true, church: row })
    expectOnlyChurchUpdate('ch3', next)
  })

  it.each([
    [null, { code: '42501', message: 'recusado' }],
    [null, { message: 'falha no update' }],
    [null, null],
    [confirmed, { message: 'erro mesmo com dados na resposta' }],
  ])('erro ou ausência de linha não confirma sucesso (%j, %j)', async (data, error) => {
    update.maybeSingle.mockResolvedValue({ data, error })
    expectFailure(await setChurchApprovalStatus('ch3', 'approved', admin))
    expectOnlyChurchUpdate()
  })

  it('erro SQL da auditoria falha a operação inteira, sem sucesso parcial ou nova tentativa', async () => {
    const error = { code: 'P0001', message: 'falha SQL em record_church_approval_audit' }
    update.maybeSingle.mockResolvedValue({ data: null, error })
    expect(await setChurchApprovalStatus('ch3', 'approved', admin)).toEqual({ ok: false, error: error.message })
    expectOnlyChurchUpdate()
  })

  it.each(['resposta perdida', 'throw síncrono'] as const)('propaga %s ao chamador, sem retry', async (failure) => {
    const error = new Error(failure)
    if (failure === 'resposta perdida') update.maybeSingle.mockRejectedValue(error)
    else update.maybeSingle.mockImplementation(() => { throw error })
    await expect(setChurchApprovalStatus('ch3', 'approved', admin)).rejects.toBe(error)
    expectOnlyChurchUpdate()
  })

  it('não usa identidade, email ou papel informados como autoridade nem os envia ao banco', async () => {
    const actor: ApprovalActor = { id: 'ator-forjado', email: 'forjado@cliente.test', role: 'church_admin' }
    expect(await setChurchApprovalStatus('ch3', 'approved', actor)).toEqual({ ok: true, church: confirmed })
    expectOnlyChurchUpdate()
  })

  it('a recusa do banco prevalece mesmo quando o cliente informa SuperAdmin', async () => {
    update.maybeSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'recusado' } })
    const result = await setChurchApprovalStatus('ch3', 'approved', admin)
    expectFailure(result)
    if (result.ok) throw new Error('A recusa do banco foi ignorada')
    expect(result.error).toContain('exclusividade do SuperAdmin')
    expectOnlyChurchUpdate()
  })

  it('lê projeção e embeds sem substituir dados ausentes pelos mocks', async () => {
    const row = { id: 'log-real', created_at: '2026-11-10T10:00:00Z', action: 'igreja.aprovada', target: 'Alvo confirmado', metadata: { de: 'pending', para: 'approved' }, actor_id: admin.id, church_id: 'ch3', profiles: { email: 'ator@banco.test' }, churches: { name: 'Nome atual' } }
    audit.order.mockResolvedValue({ data: [row, { ...row, id: 'sem-embed', profiles: null, churches: null, target: null, metadata: null }], error: null })
    const rows = await fetchAuditTrail()
    expect(audit.select).toHaveBeenCalledExactlyOnceWith(AUDIT_SELECT.join(','))
    expect(audit.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(rows[0]).toMatchObject({ actor: 'ator@banco.test', target: 'Alvo confirmado', church: 'Nome atual', metadata: row.metadata })
    expect(rows[1]).toMatchObject({ actor: '—', target: '—', church: null, metadata: {} })
    expect(rows).toHaveLength(2)
  })

  it('lista vazia real permanece vazia', async () => {
    expect(await fetchAuditTrail()).toEqual([])
  })

  it('erro da leitura real não recorre à lista fictícia', async () => {
    audit.order.mockResolvedValue({ data: null, error: { message: 'leitura recusada' } })
    await expect(fetchAuditTrail()).rejects.toThrow('leitura recusada')
  })
})

describe('trilha — contrato com o grupo K', () => {
  const suite = readFileSync(path.resolve(import.meta.dirname, '../../supabase/tests/database/rls_isolation.sql'), 'utf8')
  const start = suite.indexOf('-- GRUPO K')
  if (start < 0) throw new Error('Grupo K ausente da suíte SQL')
  const group = suite.slice(start)
  const k1 = group.match(/^\s*savepoint k1;([\s\S]*?)^\s*rollback to savepoint k1;/m)?.[1]
  if (!k1) throw new Error('Bloco K1 ausente da suíte SQL')

  it('K1 produz a trilha pelo update, sem insert manual no cliente', () => {
    const sql = k1.replace(/--[^\r\n]*/g, '')
    expect(sql).toMatch(/update\s+public\.churches\s+set\s+approval_status\s*=/i)
    expect(sql).not.toMatch(/insert\s+into\s+public\.audit_logs\b/i)
  })

  it('compara as colunas nos dois sentidos, sem aceitar colunas extras', () => {
    const projection = k1.match(/^\s*select (id,[^\n]+)\r?\n\s*from public\.audit_logs$/m)
    if (!projection) throw new Error('Projeção explícita da auditoria ausente em K1')
    const columns = projection[1].split(',').map((c) => c.trim()).sort()
    expect([...AUDIT_COLUMNS].sort()).toEqual(columns)
    expect(AUDIT_SELECT).toEqual([...AUDIT_COLUMNS, 'profiles(email)', 'churches(name)'])
    expect(k1).toContain('left join public.profiles p on p.id = al.actor_id')
    expect(k1).toContain('left join public.churches c on c.id = al.church_id')
    expect(k1).toContain('(p.email is null or c.name is null)')
  })

  it('mantém todos os verbos iguais aos literais da função de auditoria 0009', () => {
    const migration = readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/0009_church_approval_audit.sql'), 'utf8')
    const definition = migration.match(/create\s+(?:or\s+replace\s+)?function\s+public\.record_church_approval_audit\s*\(\s*\)[\s\S]*?\bas\s+(\$[\w]*\$)([\s\S]*?)\1\s*;/i)
    if (!definition) throw new Error('Função public.record_church_approval_audit ausente da migração 0009')
    const body = definition[2].replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '')
    const sqlActions = [...new Set([...body.matchAll(/'(igreja\.[a-z_]+)'/g)].map((match) => match[1]))].sort()
    const expectedActions = transitions.map(([, , action]) => action).sort()
    expect(sqlActions).toEqual(expectedActions)
    expect(Object.values(AUDIT_ACTION).sort()).toEqual(sqlActions)
    expect(transitions.map(([previous, next]) => approvalAuditAction(previous, next)).sort()).toEqual(sqlActions)
  })

  it('a marca que autoriza o insert é a mesma nas duas migrações e é limpa depois', () => {
    const dir = path.resolve(import.meta.dirname, '../../supabase/migrations')
    const trigger = readFileSync(path.join(dir, '0009_church_approval_audit.sql'), 'utf8')
    const guard = readFileSync(path.join(dir, '0010_audit_insert_guard.sql'), 'utf8')
    const marks = [...trigger.matchAll(/set_config\('([^']+)',\s*'([^']*)',\s*true\)/g)].map((m) => [m[1], m[2]])
    expect(marks).toHaveLength(2)
    expect(marks[0][1]).toBe('on')
    expect(marks[1]).toEqual([marks[0][0], ''])
    expect(trigger.indexOf(`'${marks[0][1]}', true`)).toBeLessThan(trigger.indexOf('insert into public.audit_logs'))
    expect(trigger.indexOf(`'', true`)).toBeGreaterThan(trigger.indexOf('returning id into strict'))
    expect(guard).toContain(`current_setting('${marks[0][0]}', true) = 'on'`)
    expect(guard).toMatch(/with check\s*\(\s*public\.is_superadmin\(\)/i)
  })
})
