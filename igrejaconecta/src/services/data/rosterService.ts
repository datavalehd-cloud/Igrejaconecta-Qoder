import { supabase } from '@/services/supabase/client'
import type { RosterEntry } from '@/types'

/**
 * Roster da igreja (Fase 2). A fonte é a view `church_roster` (migração 0007),
 * que já devolve só a própria igreja e já entrega email/phone null para quem não
 * tem 'members.manage'. Nada aqui filtra dado sensível: o que o RLS devolve é o
 * que aparece na tela.
 */

const ROSTER_COLUMNS =
  'member_id, church_id, user_id, full_name, avatar_url, role_key, role_name, membership_status, email, phone'

export async function fetchRoster(churchId: string): Promise<RosterEntry[]> {
  const { data, error } = await supabase
    .from('church_roster')
    .select(ROSTER_COLUMNS)
    .eq('church_id', churchId)
    .order('full_name')
  if (error) throw new Error(error.message)
  return (data ?? []) as RosterEntry[]
}
