import { members } from '@/data/mock'
import { can, roleLabels } from '@/utils/rbac'
import type { RosterEntry, RoleKey } from '@/types'

/**
 * Espelho da view `church_roster` (migração 0007): membros ativos da igreja e
 * contatos só para quem tem `members.manage`. Vive só nos testes — o aplicativo
 * lê a view no Supabase e a régua é a RLS, não este código.
 */
export function demoRoster(churchId: string, role?: RoleKey): RosterEntry[] {
  const seesContacts = can(role, 'members.manage')
  return members
    .filter((m) => m.church_id === churchId && m.status === 'active')
    .map((m) => ({
      member_id: m.id,
      church_id: m.church_id,
      user_id: m.user_id,
      full_name: m.user?.full_name ?? '',
      avatar_url: m.user?.avatar_url ?? null,
      role_key: m.role ?? 'visitor',
      role_name: roleLabels[m.role ?? 'visitor'],
      membership_status: m.status,
      email: seesContacts ? m.user?.email ?? null : null,
      phone: seesContacts ? m.user?.phone ?? null : null,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}
