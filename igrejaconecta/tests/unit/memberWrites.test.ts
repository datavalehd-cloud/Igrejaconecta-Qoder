import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { members } from '@/data/mock'
import {
  MEMBER_MANAGE_DENIED,
  SUPERADMIN_NOT_ASSIGNABLE,
  SUPERADMIN_NOT_GRANTABLE,
  acceptInvitation,
  changeMemberRole,
  inviteMember,
  listInvitations,
  pendingInvitationsForMe,
  revokeInvitation,
} from '@/services/data/memberService'
import {
  demoAcceptInvitation,
  demoChangeMemberRole,
  demoInvite,
  demoListInvitations,
  demoPendingInvitationsForMe,
  demoRevokeInvitation,
  resetMemberFixture,
} from '../fixtures/memberMirror'
import { demoRoster } from '../fixtures/rosterMirror'

/**
 * Convite, revogação, papel e aceite. As duas metades têm de dizer a mesma coisa:
 * o fixture (`tests/fixtures/memberMirror.ts`) especifica as recusas que a suíte SQL
 * prova nos grupos H1..H14, e os casos do client simulado amarram a consulta real ao
 * formato que a RLS de `church_invitations` (0008) aceita — inclusive o
 * `invited_by = auth.uid()`, sem o qual o insert volta 42501.
 */

const Church = 'ch1'
const mail = (tag: string) => `${tag}@convite.test`

const backend = vi.hoisted(() => ({ supabase: null as unknown as Record<string, unknown> | null }))
vi.mock('@/services/supabase/client', () => backend)

type Row = { data: unknown; error: unknown }

let readResult: Row = { data: [], error: null }
let roleResult: Row = { data: { id: 'r4' }, error: null }
let writeQueue: Row[] = []
const inserts: Record<string, unknown>[] = []
const updates: Record<string, unknown>[] = []
const queries: string[] = []
const rpcCalls: { fn: string; args?: unknown }[] = []
let rpcResult: Row = { data: null, error: null }

function fakeTable(table: string) {
  let verb = ''
  const chain: Record<string, (...args: never[]) => unknown> = {}
  const record = (call: string) => void queries.push(`${table}.${call}`)
  const result = (): Row => {
    if (table === 'roles') return roleResult
    if (verb === 'insert') return writeQueue.shift() ?? { data: null, error: null }
    if (verb === 'update') return readResult
    return readResult
  }
  chain.select = ((columns: string) => {
    record(`select(${columns})`)
    return chain
  }) as (...args: never[]) => unknown
  chain.eq = ((column: string, value: unknown) => {
    record(`eq(${column},${String(value)})`)
    return chain
  }) as (...args: never[]) => unknown
  chain.gt = ((column: string, value: unknown) => {
    record(`gt(${column})`)
    return chain
  }) as (...args: never[]) => unknown
  chain.order = ((column: string) => {
    record(`order(${column})`)
    return chain
  }) as (...args: never[]) => unknown
  chain.insert = ((payload: Record<string, unknown>) => {
    verb = 'insert'
    inserts.push(payload)
    record('insert')
    return chain
  }) as (...args: never[]) => unknown
  chain.update = ((patch: Record<string, unknown>) => {
    verb = 'update'
    updates.push(patch)
    record('update')
    return chain
  }) as (...args: never[]) => unknown
  chain.maybeSingle = (() => Promise.resolve(result())) as (...args: never[]) => unknown
  chain.then = ((onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(onFulfilled, onRejected)) as (...args: never[]) => unknown
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  readResult = { data: [], error: null }
  roleResult = { data: { id: 'r4' }, error: null }
  writeQueue = []
  rpcResult = { data: null, error: null }
  inserts.length = 0
  updates.length = 0
  queries.length = 0
  rpcCalls.length = 0
  resetMemberFixture()
  backend.supabase = {
    from: (table: string) => fakeTable(table),
    rpc: (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(rpcResult)
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }
})

afterEach(() => {
  backend.supabase = null
  resetMemberFixture()
})

function invitationFor(email: string) {
  return demoListInvitations(Church, 'church_admin').find((i) => i.email === email)
}

describe('fixture — espelho de church_invitations (0008), grupos H1..H14', () => {
  it('recusa convite de quem não tem members.manage (H2)', () => {
    const email = mail('sem-permissao')
    const result = demoInvite({ churchId: Church, email, roleKey: 'communicator', actorRole: 'manager' })
    expect(result).toEqual({ ok: false, error: MEMBER_MANAGE_DENIED })
    expect(invitationFor(email)).toBeUndefined()
  })

  it('cria convite pendente com e-mail normalizado (H1)', () => {
    expect(demoInvite({ churchId: Church, email: '  Novo@convite.test ', roleKey: 'communicator', actorRole: 'church_admin' }).ok).toBe(true)
    const invitation = invitationFor('novo@convite.test')
    expect(invitation?.status).toBe('pending')
    expect(invitation?.role_key).toBe('communicator')
  })

  it('não aceita dois convites pendentes para o mesmo e-mail (índice único)', () => {
    const email = mail('duplicado')
    demoInvite({ churchId: Church, email, roleKey: 'communicator', actorRole: 'church_admin' })
    expect(demoInvite({ churchId: Church, email, roleKey: 'pastor', actorRole: 'church_admin' }).ok).toBe(false)
    expect(demoListInvitations(Church, 'church_admin').filter((i) => i.email === email)).toHaveLength(1)
  })

  it('convite para o papel superadmin é recusado (H4)', () => {
    const email = mail('escala')
    expect(demoInvite({ churchId: Church, email, roleKey: 'superadmin', actorRole: 'church_admin' }))
      .toEqual({ ok: false, error: SUPERADMIN_NOT_GRANTABLE })
    expect(invitationFor(email)).toBeUndefined()
  })

  it('revogar tira o convite da lista e não revoga duas vezes (H12)', () => {
    const email = mail('revogar')
    demoInvite({ churchId: Church, email, roleKey: 'communicator', actorRole: 'church_admin' })
    const invitation = invitationFor(email)!

    expect(demoRevokeInvitation(invitation.id, 'manager').ok).toBe(false)
    expect(invitationFor(email)?.status).toBe('pending')

    expect(demoRevokeInvitation(invitation.id, 'church_admin').ok).toBe(true)
    expect(invitationFor(email)).toBeUndefined()
    expect(demoRevokeInvitation(invitation.id, 'church_admin').ok).toBe(false)
  })

  it('muda papel de quem gerencia membros e recusa quem não gerencia (H13)', () => {
    expect(demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')?.role_key).toBe('manager')

    expect(demoChangeMemberRole({ memberId: 'cm2', roleKey: 'communicator', actorRole: 'manager' }).ok).toBe(false)
    expect(demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')?.role_key).toBe('manager')

    expect(demoChangeMemberRole({ memberId: 'cm2', roleKey: 'communicator', actorRole: 'church_admin' }).ok).toBe(true)
    expect(demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')?.role_key).toBe('communicator')
  })

  it('papel superadmin não se concede pela mudança de papel (0005/0008)', () => {
    expect(demoChangeMemberRole({ memberId: 'cm2', roleKey: 'superadmin', actorRole: 'church_admin' }))
      .toEqual({ ok: false, error: SUPERADMIN_NOT_ASSIGNABLE })
    expect(demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')?.role_key).not.toBe('superadmin')
  })

  it('convite aparece apenas para o próprio e-mail (H8)', () => {
    const email = mail('destinatario')
    demoInvite({ churchId: Church, email, roleKey: 'manager', actorRole: 'church_admin' })

    expect(demoPendingInvitationsForMe(mail('outra-pessoa'))).toEqual([])
    const mine = demoPendingInvitationsForMe(email)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.church_name).toBe('Igreja Batista Central')
    expect(mine[0]!.role_name).toBe('Gerente')
  })

  it('quem não foi convidado não consegue aceitar (H8)', () => {
    const email = mail('ladrao')
    demoInvite({ churchId: Church, email, roleKey: 'manager', actorRole: 'church_admin' })
    const [invitation] = demoPendingInvitationsForMe(email)

    expect(demoAcceptInvitation(invitation!.id, mail('outra-conta')).ok).toBe(false)
    expect(demoRoster(Church, 'church_admin').some((r) => r.email === email)).toBe(false)
  })

  it('aceite cria o vínculo ativo e o convite deixa de estar pendente (H7/H11)', () => {
    const email = mail('aceite')
    demoInvite({ churchId: Church, email, roleKey: 'pastor', actorRole: 'church_admin' })
    const [invitation] = demoPendingInvitationsForMe(email)

    expect(demoAcceptInvitation(invitation!.id, email).ok).toBe(true)
    const row = demoRoster(Church, 'church_admin').find((r) => r.email === email)
    expect(row?.role_key).toBe('pastor')
    expect(row?.membership_status).toBe('active')
    expect(demoPendingInvitationsForMe(email)).toEqual([])
    expect(demoAcceptInvitation(invitation!.id, email).ok).toBe(false)
  })

  it('aceite sem o e-mail da sessão é recusado (sem_sessao)', () => {
    const email = mail('sem-sessao')
    demoInvite({ churchId: Church, email, roleKey: 'communicator', actorRole: 'church_admin' })
    const [invitation] = demoPendingInvitationsForMe(email)
    expect(demoAcceptInvitation(invitation!.id, undefined).ok).toBe(false)
  })

  it('quem não gerencia membros não vê a lista (church_invitations_read)', () => {
    demoInvite({ churchId: Church, email: mail('escondido'), roleKey: 'communicator', actorRole: 'church_admin' })
    expect(demoListInvitations(Church, 'communicator')).toEqual([])
    expect(demoListInvitations(Church, 'pastor')).toEqual([])
    expect(demoListInvitations(Church)).toEqual([])
  })
})

describe('caminho real — a consulta que a RLS aceita', () => {
  it('convidar resolve o papel pelo key e manda invited_by da sessão', async () => {
    roleResult = { data: { id: 'r4' }, error: null }
    writeQueue = [{ data: null, error: null }]

    expect(await inviteMember({ churchId: 'ch-real', email: '  Novo@convite.test ', roleKey: 'communicator', actorRole: 'church_admin' })).toEqual({ ok: true })

    expect(queries).toContain('roles.select(id)')
    expect(queries).toContain('roles.eq(key,communicator)')
    expect(inserts[0]).toEqual({
      church_id: 'ch-real',
      email: 'novo@convite.test',
      role_id: 'r4',
      status: 'pending',
      invited_by: 'u1',
    })
  })

  it('papel sem members.manage não dispara consulta nenhuma', async () => {
    for (const role of ['communicator', 'pastor', 'visitor', undefined] as const) {
      expect(await inviteMember({ churchId: 'ch-real', email: mail('x'), roleKey: 'pastor', actorRole: role }))
        .toEqual({ ok: false, error: MEMBER_MANAGE_DENIED })
      expect(await revokeInvitation('inv-1', role)).toEqual({ ok: false, error: MEMBER_MANAGE_DENIED })
      expect(await changeMemberRole({ memberId: 'cm2', roleKey: 'pastor', actorRole: role }))
        .toEqual({ ok: false, error: MEMBER_MANAGE_DENIED })
      expect(await listInvitations('ch-real', role)).toEqual([])
    }
    expect(queries).toEqual([])
  })

  it('superadmin não se concede por convite nem por mudança de papel, antes de falar com o banco', async () => {
    expect(await inviteMember({ churchId: 'ch-real', email: mail('escala'), roleKey: 'superadmin', actorRole: 'superadmin' }))
      .toEqual({ ok: false, error: SUPERADMIN_NOT_GRANTABLE })
    expect(await changeMemberRole({ memberId: 'cm2', roleKey: 'superadmin', actorRole: 'superadmin' }))
      .toEqual({ ok: false, error: SUPERADMIN_NOT_ASSIGNABLE })
    expect(queries).toEqual([])
  })

  it('papel que não existe no banco não vira convite', async () => {
    roleResult = { data: null, error: null }
    expect(await inviteMember({ churchId: 'ch-real', email: mail('x'), roleKey: 'pastor', actorRole: 'church_admin' }))
      .toEqual({ ok: false, error: 'Papel não encontrado no banco.' })
    expect(inserts).toEqual([])
  })

  it('a lista pede pendentes vivos da igreja, na projeção de gestão', async () => {
    readResult = { data: [], error: null }
    await listInvitations('ch-real', 'church_admin')
    expect(queries[0]).toBe('church_invitations.select(id, church_id, email, status, invited_by, expires_at, created_at, role:roles(key))')
    expect(queries).toContain('church_invitations.eq(church_id,ch-real)')
    expect(queries).toContain('church_invitations.eq(status,pending)')
    expect(queries.some((q) => q.startsWith('church_invitations.gt(expires_at)'))).toBe(true)
    expect(queries).toContain('church_invitations.order(created_at)')
  })

  it('revogar restringe à linha pendente: sem linha, o convite já não era mais pendente', async () => {
    readResult = { data: [], error: null }
    expect(await revokeInvitation('inv-1', 'church_admin')).toEqual({ ok: false, error: 'Este convite não está mais pendente.' })
    expect(updates[0]).toEqual({ status: 'revoked' })
    expect(queries).toContain('church_invitations.eq(id,inv-1)')
    expect(queries).toContain('church_invitations.eq(status,pending)')

    readResult = { data: [{ id: 'inv-1' }], error: null }
    expect(await revokeInvitation('inv-2', 'church_admin')).toEqual({ ok: true })
  })

  it('mudar papel escreve role_id, nunca o nome do papel', async () => {
    roleResult = { data: { id: 'r3' }, error: null }
    readResult = { data: [{ id: 'cm2' }], error: null }

    expect(await changeMemberRole({ memberId: 'cm2', roleKey: 'manager', actorRole: 'church_admin' })).toEqual({ ok: true })
    expect(updates[0]).toEqual({ role_id: 'r3' })
    expect(queries).toContain('church_members.eq(id,cm2)')

    readResult = { data: [], error: null }
    expect(await changeMemberRole({ memberId: 'cm9', roleKey: 'manager', actorRole: 'church_admin' }))
      .toEqual({ ok: false, error: 'Sem permissão para mudar o papel deste membro.' })
  })

  it('os convites "para mim" vêm do RPC, sem e-mail como parâmetro', async () => {
    rpcResult = { data: [], error: null }
    expect(await pendingInvitationsForMe()).toEqual([])
    expect(rpcCalls).toEqual([{ fn: 'pending_invitations_for_me', args: undefined }])
  })

  it('aceitar chama o RPC e traduz o status dele', async () => {
    rpcResult = { data: 'aceito', error: null }
    expect(await acceptInvitation('inv-1')).toEqual({ ok: true })
    expect(rpcCalls[0]).toEqual({ fn: 'accept_church_invitation', args: { p_invitation: 'inv-1' } })

    for (const [status, message] of [
      ['expirada', 'Este convite expirou.'],
      ['email_nao_confirmado', 'O e-mail deste convite não confere com o da sua conta.'],
      ['sem_sessao', 'Faça login para aceitar o convite.'],
      ['nao_pendente', 'Este convite já foi aceito ou cancelado.'],
      ['inexistente', 'Este convite não existe mais.'],
      ['papel_bloqueado', 'Este convite não pode ser aceito por aqui.'],
    ] as const) {
      rpcResult = { data: status, error: null }
      expect(await acceptInvitation('inv-1')).toEqual({ ok: false, error: message })
    }

    rpcResult = { data: null, error: { code: '42501', message: 'permission denied' } }
    expect(await acceptInvitation('inv-1')).toEqual({ ok: false, error: 'Sem permissão para esta ação na sua igreja.' })
  })

  it('42501 e 23505 viram as frases da tela', async () => {
    writeQueue = [{ data: null, error: { code: '42501', message: 'row-level security' } }]
    expect(await inviteMember({ churchId: 'ch-real', email: mail('x'), roleKey: 'pastor', actorRole: 'church_admin' }))
      .toEqual({ ok: false, error: 'Sem permissão para esta ação na sua igreja.' })

    writeQueue = [{ data: null, error: { code: '23505', message: 'duplicate key' } }]
    expect(await inviteMember({ churchId: 'ch-real', email: mail('x'), roleKey: 'pastor', actorRole: 'church_admin' }))
      .toEqual({ ok: false, error: 'Já existe um convite pendente para este e-mail.' })
  })

  it('o caminho real não escreve na loja do fixture', async () => {
    const antes = members.length
    writeQueue = [{ data: null, error: null }]
    roleResult = { data: { id: 'r4' }, error: null }
    await inviteMember({ churchId: 'ch-real', email: mail('real'), roleKey: 'communicator', actorRole: 'church_admin' })
    expect(demoListInvitations('ch-real', 'church_admin')).toEqual([])
    expect(members).toHaveLength(antes)
  })
})
