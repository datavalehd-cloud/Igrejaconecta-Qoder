import { supabase } from '@/services/supabase/client'
import { churches, members } from '@/data/mock'
import type { PlatformUser, RoleKey } from '@/types'

/**
 * Leituras globais do SuperAdmin (Fase 8). Tudo aqui é **transversal**: atravessa
 * todas as igrejas, coisa que nenhum papel de igreja faz. Não há migração nem
 * política nova — os ramos `is_superadmin()` já existem e são testados na suíte
 * (`church_members_read` e `profiles_self_read` em 0002, grupo B). O que este
 * serviço faz é **exibir** ao dono da plataforma dados que a RLS já lhe devolve.
 *
 * Duas camadas de defesa, como em `marketingService.fetchChurchCampaigns`:
 *   1. o **gate** daqui — quem não é `superadmin` recebe `[]`, sem consulta nenhuma;
 *   2. a **política** no banco — segunda camada, não a única.
 *
 * A projeção faz parte do contrato: a RLS é por linha e deixaria ler a linha
 * inteira de `church_members`/`profiles`; o que limita as colunas que chegam ao
 * navegador é o `select` abaixo, congelado e comparado com o espelho demo nos
 * testes. `role_id`, `created_at` e o resto de `profiles` (telefone, avatar) ficam
 * de fora — a tela de gestão global precisa de nome, e-mail, papel, igreja e status.
 */

/**
 * Projeção do diretório global. `roles(key)` resolve o papel, `churches(name)` a
 * igreja e `profiles(full_name, email)` a pessoa. Nenhuma coluna além destas chega
 * ao navegador.
 */
export const PLATFORM_USER_SELECT =
  'user_id, church_id, status, roles(key), churches(name), profiles(full_name, email)'

interface PlatformUserRow {
  user_id: string
  church_id: string
  status: PlatformUser['status']
  roles: { key: string } | null
  churches: { name: string } | null
  profiles: { full_name: string | null; email: string | null } | null
}

/**
 * Diretório global de vínculos. Só o SuperAdmin recebe algo; qualquer outro papel
 * volta `[]` antes de qualquer consulta (o gate é a primeira camada). Uma linha por
 * vínculo — quem é de duas igrejas aparece duas vezes.
 */
export async function fetchPlatformUsers(role?: RoleKey): Promise<PlatformUser[]> {
  if (role !== 'superadmin') return []
  if (supabase) {
    const { data, error } = await supabase
      .from('church_members')
      .select(PLATFORM_USER_SELECT)
      .order('created_at')
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as PlatformUserRow[])
      // Vínculo sem igreja confirmada pela RLS não vira linha: não se inventa nome.
      .filter((row) => row.churches !== null)
      .map(toPlatformUser)
  }
  return demoPlatformUsers(role)
}

/** Espelha `church_members_read` + `profiles_self_read` no ramo `is_superadmin()`. */
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

/** Usuários distintos (uma pessoa conta uma vez, ainda que seja de várias igrejas). */
export function countDistinctUsers(rows: PlatformUser[]): number {
  return new Set(rows.map((r) => r.user_id)).size
}

function toPlatformUser(row: PlatformUserRow): PlatformUser {
  return {
    user_id: row.user_id,
    church_id: row.church_id,
    status: row.status,
    role: (row.roles?.key ?? 'visitor') as RoleKey,
    church_name: row.churches?.name ?? null,
    name: row.profiles?.full_name ?? '—',
    email: row.profiles?.email ?? null,
  }
}
