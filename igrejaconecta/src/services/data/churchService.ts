import { supabase } from '@/services/supabase/client'
import { churches, members } from '@/data/mock'
import type { ApprovalStatus, Church, MemberChurch, RoleKey } from '@/types'

/**
 * Listas de igrejas (Fase 2, passo 3). São três leituras, cada uma com a projeção
 * que a tela realmente usa: no modo real o que chega ao navegador é o que o
 * `select` pede — a política de `churches` filtra por linha e deixaria ler a linha
 * inteira, então a projeção é a parte do contrato que depende daqui.
 *
 * O filtro `approved + active` do diretório é **redundância**, não a guarda: quem
 * garante isso para o visitante é `churches_public_read` (0002), provado nos grupos
 * A e B da suíte. Ele está aqui porque "Igrejas" e "Mapa" listam comunidades
 * verificadas, e a igreja ainda não aprovada de quem está logado não deve entrar
 * na lista só porque o dono dela é quem consulta.
 */

/**
 * Projeção do diretório público. Ficam de fora `email`, `website`, `zip`, `lat`,
 * `lng` e `created_by`: a RLS é por linha e deixaria ler tudo, mas nenhum visitante
 * precisa do e-mail institucional nem do uuid de quem cadastrou a igreja. Quem
 * precisa disso é a lista de gestão, abaixo.
 */
export const DIRECTORY_COLUMNS = [
  'id',
  'name',
  'slug',
  'description',
  'denomination',
  'address',
  'city',
  'state',
  'phone',
  'whatsapp',
  'status',
  'approval_status',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof Church)[]

/** Direção da plataforma: tudo, inclusive os status que o público não pode ver. */
export const MANAGED_COLUMNS = [...DIRECTORY_COLUMNS, 'email', 'website', 'zip'] as const satisfies readonly (keyof Church)[]

/**
 * Projeção do mapa (Fase 4): o diretório mais as coordenadas. `lat`/`lng` ficam
 * de fora de `DIRECTORY_COLUMNS` de propósito — a lista de igrejas não precisa
 * deles —, e o mapa é o único lugar que os pede. No banco a coluna já era legível
 * por anon (a RLS de `churches` é por linha); o que muda aqui é o que o app passa
 * a **exibir**, e por isso é exposição nova de dado: a revisão de risco da Fase 4
 * trata dela por escrito. Coordenada ausente é estado normal — o mapa diz que a
 * igreja não está plotada em vez de inventar posição.
 */
export const MAP_COLUMNS = [...DIRECTORY_COLUMNS, 'lat', 'lng'] as const satisfies readonly (keyof Church)[]

/** Embed do vínculo: a igreja é lida *através* de `church_members`. */
export const MEMBERSHIP_SELECT = 'church_id, status, roles(key), churches(id, name, city, state, approval_status)'

interface MembershipRow {
  church_id: string
  status: string
  roles: { key: string } | null
  churches: { id: string; name: string; city: string | null; state: string | null; approval_status: ApprovalStatus } | null
}

/** Igreja aprovada e ativa, em ordem de nome. */
export async function fetchDirectoryChurches(): Promise<Church[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('churches')
      .select(DIRECTORY_COLUMNS.join(','))
      .eq('approval_status', 'approved')
      .eq('status', 'active')
      .order('name')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Church[]
  }
  return demoDirectoryChurches()
}

/** Espelha `churches_public_read` + o WHERE do diretório, com a projeção do público. */
export function demoDirectoryChurches(): Church[] {
  return sortByName(
    churches
      .filter((c) => c.approval_status === 'approved' && c.status === 'active')
      .map((c) => pick(c, DIRECTORY_COLUMNS)),
  )
}

/**
 * Igrejas do mapa público: mesma audiência do diretório, projeção com
 * coordenadas. A ordenação por distância não é daqui — sem GPS não há origem, e
 * quem ordena é a tela com `sortByProximity` (utils/geo).
 */
export async function fetchMapChurches(): Promise<Church[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('churches')
      .select(MAP_COLUMNS.join(','))
      .eq('approval_status', 'approved')
      .eq('status', 'active')
      .order('name')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Church[]
  }
  return demoMapChurches()
}

export function demoMapChurches(): Church[] {
  return sortByName(
    churches
      .filter((c) => c.approval_status === 'approved' && c.status === 'active')
      .map((c) => pick(c, MAP_COLUMNS)),
  )
}

/**
 * Lista de gestão do SuperAdmin. No modo real quem libera as linhas não aprovadas é
 * a `is_superadmin()` da política — um papel da igreja que chegasse aqui por
 * acidente receberia só a própria igreja (caso I3). O hook liga esta leitura apenas
 * para SuperAdmin; a política é a segunda camada.
 */
export async function fetchManagedChurches(): Promise<Church[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('churches')
      .select(MANAGED_COLUMNS.join(','))
      .order('approval_status')
      .order('name')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Church[]
  }
  return demoManagedChurches()
}

/** Todas as igrejas e todos os status, na ordem da tela de gestão (caso I4). */
export function demoManagedChurches(): Church[] {
  // Estável: ordena por nome e depois por status, o mesmo par `.order(approval_status)
  // .order(name)` que o modo real manda.
  return sortByKey(
    sortByName(churches.map((c) => pick(c, MANAGED_COLUMNS))),
    (c) => c.approval_status,
  )
}

/** Igrejas da conta com o papel de cada uma — o "Minhas igrejas" do perfil. */
export async function fetchMyChurches(userId?: string): Promise<MemberChurch[]> {
  if (!userId) return []
  if (supabase) {
    const { data, error } = await supabase
      .from('church_members')
      .select(MEMBERSHIP_SELECT)
      .eq('user_id', userId)
      .eq('status', 'active')
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as MembershipRow[]
    return sortByName(
      rows
        // `churches` vem null quando a RLS esconde a linha: sem nome confirmado
        // pelo banco a associação não aparece na lista, não se inventa um nome.
        .filter((r) => r.churches !== null)
        .map((r) => ({
          church_id: r.church_id,
          name: r.churches!.name,
          city: r.churches!.city,
          state: r.churches!.state,
          approval_status: r.churches!.approval_status,
          role_key: (r.roles?.key ?? 'visitor') as RoleKey,
        })),
    )
  }
  return demoMyChurches(userId)
}

/** Vínculos ativos da pessoa, resolvidos até a igreja (casos I5/I6). */
export function demoMyChurches(userId: string): MemberChurch[] {
  return sortByName(
    members
      .filter((m) => m.user_id === userId && m.status === 'active')
      .flatMap((m) => {
        const church = churches.find((c) => c.id === m.church_id)
        if (!church) return []
        return [{
          church_id: church.id,
          name: church.name,
          city: church.city ?? null,
          state: church.state ?? null,
          approval_status: church.approval_status,
          role_key: m.role ?? 'visitor',
        }]
      }),
  )
}

function pick(church: Church, columns: readonly (keyof Church)[]): Church {
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = church[column]
  return out as unknown as Church
}

function sortByName<T extends { name: string }>(rows: T[]) {
  return sortByKey(rows, (r) => r.name)
}

function sortByKey<T>(rows: T[], key: (row: T) => string) {
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
}
