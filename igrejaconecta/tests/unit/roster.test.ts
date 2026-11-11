import { describe, it, expect } from 'vitest'
import { demoRoster } from '@/services/data/rosterService'

describe('roster demo — espelha a view church_roster (0007)', () => {
  it('só devolve membros ativos da igreja pedida', () => {
    const rows = demoRoster('ch1', 'church_admin')
    expect(rows.map((r) => r.member_id)).toEqual(['cm2', 'cm1', 'cm5'])
    expect(rows.every((r) => r.membership_status === 'active')).toBe(true)
    expect(demoRoster('ch2', 'church_admin').map((r) => r.member_id)).toEqual(['cm4'])
  })

  it('ordena por nome, como o .order(full_name) do modo real', () => {
    expect(demoRoster('ch1', 'church_admin').map((r) => r.full_name)).toEqual(['Ana Souza', 'Marcos Lima', 'Paula Diniz'])
  })

  it('mostra contatos para quem tem members.manage', () => {
    const [ana] = demoRoster('ch1', 'church_admin')
    expect(ana.email).toBe('ana@ibcentral.org.br')
    expect(demoRoster('ch1', 'superadmin')[0].email).not.toBeNull()
  })

  it('mascara contatos de quem não tem members.manage', () => {
    for (const role of ['manager', 'communicator', 'pastor', 'visitor'] as const) {
      const rows = demoRoster('ch1', role)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.email === null && r.phone === null)).toBe(true)
    }
  })

  it('sem igreja não existe roster', () => {
    expect(demoRoster('ch-inexistente', 'church_admin')).toEqual([])
  })
})
