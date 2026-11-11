import type { RoleKey } from '@/types'

export const roleLabels: Record<RoleKey, string> = {
  superadmin: 'SuperAdmin',
  church_admin: 'Administrador da igreja',
  manager: 'Gerente',
  communicator: 'Comunicador',
  pastor: 'Pastor / Líder',
  visitor: 'Visitante',
}

export type Permission =
  | 'church.manage'
  | 'church.approve'
  | 'members.manage'
  | 'events.manage'
  | 'events.publish'
  | 'registrations.manage'
  | 'marketing.manage'
  | 'ai.use'
  | 'automation.manage'
  | 'reports.view'
  | 'platform.admin'

// RBAC: hierarquia de permissões por papel (Fase 1).
const rolePermissions: Record<RoleKey, Permission[]> = {
  superadmin: [
    'church.manage', 'church.approve', 'members.manage', 'events.manage',
    'events.publish', 'registrations.manage', 'marketing.manage', 'ai.use',
    'automation.manage', 'reports.view', 'platform.admin',
  ],
  church_admin: [
    'church.manage', 'members.manage', 'events.manage', 'events.publish',
    'registrations.manage', 'marketing.manage', 'ai.use', 'automation.manage',
    'reports.view',
  ],
  manager: [
    'events.manage', 'events.publish', 'registrations.manage',
    'marketing.manage', 'ai.use', 'automation.manage', 'reports.view',
  ],
  communicator: ['events.manage', 'marketing.manage', 'ai.use'],
  pastor: ['events.manage', 'events.publish', 'registrations.manage'],
  visitor: [],
}

export function can(role: RoleKey | undefined, permission: Permission): boolean {
  if (!role) return false
  return rolePermissions[role].includes(permission)
}

export const MFA_REQUIRED_ROLES: RoleKey[] = ['superadmin', 'church_admin']
