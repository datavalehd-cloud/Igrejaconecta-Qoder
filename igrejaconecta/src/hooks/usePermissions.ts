import { useAuth } from '@/contexts/AuthContext'
import { can, type Permission } from '@/utils/rbac'

/** Sessão atual + checagem de permissão do papel ativo. */
export function usePermissions() {
  const { session } = useAuth()
  return {
    role: session?.role,
    churchId: session?.churchId,
    can: (permission: Permission) => can(session?.role, permission),
    isSuperAdmin: session?.role === 'superadmin',
  }
}
