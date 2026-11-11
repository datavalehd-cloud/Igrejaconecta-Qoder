import { describe, it, expect } from 'vitest'
import { can, MFA_REQUIRED_ROLES } from '@/utils/rbac'

describe('RBAC — matriz de permissões por papel', () => {
  it('SuperAdmin tem acesso à administração da plataforma', () => {
    expect(can('superadmin', 'platform.admin')).toBe(true)
    expect(can('superadmin', 'church.approve')).toBe(true)
  })

  it('Administrador da igreja gerencia a própria igreja, mas não a plataforma', () => {
    expect(can('church_admin', 'church.manage')).toBe(true)
    expect(can('church_admin', 'members.manage')).toBe(true)
    expect(can('church_admin', 'platform.admin')).toBe(false)
    expect(can('church_admin', 'church.approve')).toBe(false)
  })

  it('Comunicador só atua em eventos/divulgação/IA', () => {
    expect(can('communicator', 'marketing.manage')).toBe(true)
    expect(can('communicator', 'ai.use')).toBe(true)
    expect(can('communicator', 'members.manage')).toBe(false)
    expect(can('communicator', 'church.manage')).toBe(false)
  })

  it('Visitante não tem permissões administrativas', () => {
    expect(can('visitor', 'events.manage')).toBe(false)
    expect(can('visitor', 'marketing.manage')).toBe(false)
  })

  it('Papel indefinido nega tudo', () => {
    expect(can(undefined, 'events.manage')).toBe(false)
  })

  it('MFA é exigido para SuperAdmin e Administrador da igreja', () => {
    expect(MFA_REQUIRED_ROLES).toContain('superadmin')
    expect(MFA_REQUIRED_ROLES).toContain('church_admin')
    expect(MFA_REQUIRED_ROLES).not.toContain('visitor')
  })
})
