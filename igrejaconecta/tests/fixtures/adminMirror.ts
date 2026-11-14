import { churches, members } from '@/data/mock'
import type { PlatformUser, RoleKey } from '@/types'

/**
 * Espelho de `church_members_read` + `profiles_self_read` no ramo
 * `is_superadmin()` (0002/0011). Vive só nos testes: no aplicativo a audiência
 * transversal é decidida pela RLS e pelo gate de `fetchPlatformUsers`.
 */
export function demoPlatformUsers(role?: RoleKey): PlatformUser[] {
  if (role !== 'superadmin') return []
  return members
    .filter((m) => m.user !== undefined)
    .map((m) => ({
      user_id: m.user_id,
      church_id: m.church_id,
      status: m.status,
      role: m.role ?? 'visitor',
      church_name: churches.find((c) => c.id === m.church_id)?.name ?? null,
      name: m.user!.full_name,
      email: m.user!.email,
    }))
}
