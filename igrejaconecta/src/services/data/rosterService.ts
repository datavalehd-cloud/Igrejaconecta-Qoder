import { supabase } from '@/services/supabase/client'
import { members } from '@/data/mock'
import { can, roleLabels } from '@/utils/rbac'
import type { RosterEntry, RoleKey } from '@/types'

/**
 * Roster da igreja (Fase 2). No modo real a fonte é a view `church_roster`
 * (migração 0007), que já devolve só a própria igreja e já entrega email/phone
 * null para quem não tem 'members.manage'. Nada aqui filtra dado sensível: o que
 * o RLS devolve é o que aparece na tela.
 */

const ROSTER_COLUMNS =
  'member_id, church_id, user_id, full_name, avatar_url, role_key, role_name, membership_status, email, phone'

export async function fetchRoster(churchId: string, role?: RoleKey): Promise<RosterEntry[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('church_roster')
      .select(ROSTER_COLUMNS)
      .eq('church_id', churchId)
      .order('full_name')
    if (error) throw new Error(error.message)
    return (data ?? []) as RosterEntry[]
  }
  return demoRoster(churchId, role)
}

/** Espelha a view: membros ativos da igreja, contatos só para quem gerencia membros. */
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
