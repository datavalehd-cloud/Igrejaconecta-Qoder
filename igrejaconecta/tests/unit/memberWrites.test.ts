import { describe, it, expect, vi } from 'vitest'
import { demoRoster } from '@/services/data/rosterService'
import {
  acceptInvitation,
  changeMemberRole,
  inviteMember,
  listInvitations,
  pendingInvitationsForMe,
  revokeInvitation,
} from '@/services/data/memberService'

/**
 * A loja demo não é enfeite: ela é o que a tela mostra enquanto não há projeto
 * Supabase, então cada caso aqui espelha um caso da suíte de RLS (grupos H1..H14).
 * Se as duas leituras divergirem, a demonstração estaria exibindo algo que o banco
 * recusaria.
 */

// Estes casos são sobre a loja demo. Sem o mock o client real existe (o `.env.local`
// também é carregado no modo de teste) e a suíte escreveria no banco que está no ar.
vi.mock('@/services/supabase/client', () => ({ supabase: null }))

const Church = 'ch1'
const mail = (tag: string) => `${tag}@convite.test`

async function invitationFor(email: string) {
  const rows = await listInvitations(Church, 'church_admin')
  return rows.find((i) => i.email === email)
}

describe('convites demo — espelha church_invitations (0008)', () => {
  it('recusa convite de quem não tem members.manage (H2)', async () => {
    const email = mail('sem-permissao')
    const result = await inviteMember({ churchId: Church, email, roleKey: 'communicator', actorRole: 'manager' })
    expect(result.ok).toBe(false)
    expect(await invitationFor(email)).toBeUndefined()
  })

  it('cria convite pendente com e-mail normalizado (H1)', async () => {
    const result = await inviteMember({ churchId: Church, email: '  Novo@convite.test ', roleKey: 'communicator', actorRole: 'church_admin' })
    expect(result.ok).toBe(true)
    const invitation = await invitationFor('novo@convite.test')
    expect(invitation?.status).toBe('pending')
    expect(invitation?.role_key).toBe('communicator')
  })

  it('não aceita dois convites pendentes para o mesmo e-mail (índice único)', async () => {
    const email = mail('duplicado')
    await inviteMember({ churchId: Church, email, roleKey: 'communicator', actorRole: 'church_admin' })
    const second = await inviteMember({ churchId: Church, email, roleKey: 'pastor', actorRole: 'church_admin' })
    expect(second.ok).toBe(false)
    const rows = await listInvitations(Church, 'church_admin')
    expect(rows.filter((i) => i.email === email)).toHaveLength(1)
  })

  it('convite para o papel superadmin é recusado (H4)', async () => {
    const email = mail('escala')
    const result = await inviteMember({ churchId: Church, email, roleKey: 'superadmin', actorRole: 'church_admin' })
    expect(result.ok).toBe(false)
    expect(await invitationFor(email)).toBeUndefined()
  })

  it('revogar tira o convite da lista e não revoga duas vezes (H12)', async () => {
    const email = mail('revogar')
    await inviteMember({ churchId: Church, email, roleKey: 'communicator', actorRole: 'church_admin' })
    const invitation = await invitationFor(email)
    expect(invitation).toBeDefined()

    const blocked = await revokeInvitation(invitation!.id, 'manager')
    expect(blocked.ok).toBe(false)
    expect((await invitationFor(email))?.status).toBe('pending')

    expect((await revokeInvitation(invitation!.id, 'church_admin')).ok).toBe(true)
    expect(await invitationFor(email)).toBeUndefined()
    expect((await revokeInvitation(invitation!.id, 'church_admin')).ok).toBe(false)
  })

  it('muda papel de quem gerencia membros e recusa quem não gerencia (H13)', async () => {
    const before = demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')
    expect(before?.role_key).toBe('manager')

    expect((await changeMemberRole({ memberId: 'cm2', roleKey: 'communicator', actorRole: 'manager' })).ok).toBe(false)
    expect(demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')?.role_key).toBe('manager')

    expect((await changeMemberRole({ memberId: 'cm2', roleKey: 'communicator', actorRole: 'church_admin' })).ok).toBe(true)
    expect(demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')?.role_key).toBe('communicator')
  })

  it('papel superadmin não se concede pela mudança de papel (0005/0008)', async () => {
    const result = await changeMemberRole({ memberId: 'cm2', roleKey: 'superadmin', actorRole: 'church_admin' })
    expect(result.ok).toBe(false)
    expect(demoRoster(Church, 'church_admin').find((r) => r.member_id === 'cm2')?.role_key).not.toBe('superadmin')
  })

  it('convite aparece apenas para o próprio e-mail (H8)', async () => {
    const email = mail('destinatario')
    await inviteMember({ churchId: Church, email, roleKey: 'manager', actorRole: 'church_admin' })

    expect(await pendingInvitationsForMe(mail('outra-pessoa'))).toEqual([])
    const mine = await pendingInvitationsForMe(email)
    expect(mine).toHaveLength(1)
    expect(mine[0].church_name).toBe('Igreja Batista Central')
    expect(mine[0].role_name).toBe('Gerente')
  })

  it('quem não foi convidado não consegue aceitar (H8)', async () => {
    const email = mail('ladrao')
    await inviteMember({ churchId: Church, email, roleKey: 'manager', actorRole: 'church_admin' })
    const [invitation] = await pendingInvitationsForMe(email)

    const result = await acceptInvitation(invitation.id, mail('outra-conta'))
    expect(result.ok).toBe(false)
    const rows = demoRoster(Church, 'church_admin')
    expect(rows.some((r) => r.email === email)).toBe(false)
  })

  it('aceite cria o vínculo ativo e o convite deixa de estar pendente (H7/H11)', async () => {
    const email = mail('aceite')
    await inviteMember({ churchId: Church, email, roleKey: 'pastor', actorRole: 'church_admin' })
    const [invitation] = await pendingInvitationsForMe(email)

    expect((await acceptInvitation(invitation.id, email)).ok).toBe(true)
    const row = demoRoster(Church, 'church_admin').find((r) => r.email === email)
    expect(row?.role_key).toBe('pastor')
    expect(row?.membership_status).toBe('active')
    expect(await pendingInvitationsForMe(email)).toEqual([])
    expect((await acceptInvitation(invitation.id, email)).ok).toBe(false)
  })

  it('aceite sem o e-mail da sessão é recusado (sem_sessao)', async () => {
    const email = mail('sem-sessao')
    await inviteMember({ churchId: Church, email, roleKey: 'communicator', actorRole: 'church_admin' })
    const [invitation] = await pendingInvitationsForMe(email)
    expect((await acceptInvitation(invitation.id, undefined)).ok).toBe(false)
  })
})
