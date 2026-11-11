import { supabase } from '@/services/supabase/client'
import { branches, members } from '@/data/mock'
import { can } from '@/utils/rbac'
import { validateLatLng } from '@/utils/geo'
import type { ChurchBranch, RoleKey } from '@/types'

/**
 * Filiais (0013, Fase 4). Leitura para membro **ativo** da própria igreja e para
 * o SuperAdmin; escrita só com `church.manage`. Não existe delete em camada
 * nenhuma: a tabela não tem política nem grant de delete (casos O7 e O10 da
 * suíte), então o serviço não expõe a operação. Se um dia a tela oferecer
 * "excluir filial", banco e serviço têm de ser abertos juntos, de propósito.
 *
 * Como nos outros serviços, a projeção faz parte do contrato: a RLS de
 * `church_branches` é por linha e deixaria ler a linha inteira — o que limita as
 * colunas que chegam ao navegador é o `select` daqui.
 */

export const BRANCH_COLUMNS = [
  'id',
  'church_id',
  'name',
  'address',
  'city',
  'state',
  'lat',
  'lng',
  'leader',
] as const satisfies readonly (keyof ChurchBranch)[]

export const BRANCH_MANAGE_DENIED =
  'Sem permissão para esta ação: cadastrar e editar filiais é papel do administrador da igreja ou do SuperAdmin.'
export const BRANCH_NOT_FOUND = 'Filial não encontrada ou sem permissão para alterá-la. Atualize a lista.'
export const BRANCH_NO_CHURCH = 'A sua sessão não tem igreja ativa: quem não é de uma igreja não cadastra filial.'

export interface BranchActor {
  churchId?: string
  role?: RoleKey
  userId?: string
}

export interface BranchDraft {
  name: string
  address?: string | null
  city?: string | null
  state?: string | null
  lat?: number | null
  lng?: number | null
  leader?: string | null
}

export type BranchWriteResult =
  | { ok: true; branch: ChurchBranch; error?: never }
  | { ok: false; error: string; branch?: never }

/** Colunas enviadas na criação. `id` e os carimbos ficam com o banco. */
export const BRANCH_INSERT_COLUMNS = [
  'church_id',
  'name',
  'address',
  'city',
  'state',
  'lat',
  'lng',
  'leader',
] as const

/** Colunas enviadas na edição: as mesmas menos `church_id`.
 * Transferir filial de igreja é recusado pelo banco (caso O5) e o formulário não
 * oferece o campo — a igreja da filial é a da sessão. */
export const BRANCH_PATCH_COLUMNS = [
  'name',
  'address',
  'city',
  'state',
  'lat',
  'lng',
  'leader',
] as const

/** Filiais da igreja, em ordem de nome. Sem `churchId` não há o que listar. */
export async function fetchChurchBranches(churchId?: string, actor?: BranchActor): Promise<ChurchBranch[]> {
  // SuperAdmin vê todas (é o que a `is_superadmin()` da política devolve); para
  // qualquer outro papel o recorte é a igreja da sessão, e a política é a
  // segunda camada — não a única.
  const everyChurch = actor?.role === 'superadmin'
  if (!everyChurch && !churchId) return []

  if (supabase) {
    let query = supabase.from('church_branches').select(BRANCH_COLUMNS.join(',')).order('name')
    if (!everyChurch) query = query.eq('church_id', churchId!)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as ChurchBranch[]
  }
  return demoChurchBranches(churchId, actor)
}

/** Espelha `church_branches_read`: membro ativo da igreja, ou SuperAdmin para todas. */
export function demoChurchBranches(churchId?: string, actor?: BranchActor): ChurchBranch[] {
  if (actor?.role === 'superadmin') return sortByName(branches.map((b) => pickColumns(b, BRANCH_COLUMNS)))
  if (!churchId) return []
  // Vínculo `invited` não lê filial (caso O3). A checagem só vale quando a sessão
  // informa o usuário; sem ele o recorte é a igreja, como nas outras leituras.
  if (actor?.userId && !isActiveMember(actor.userId, churchId)) return []
  return sortByName(
    branches.filter((b) => b.church_id === churchId).map((b) => pickColumns(b, BRANCH_COLUMNS)),
  )
}

function isActiveMember(userId: string, churchId: string): boolean {
  return members.some((m) => m.user_id === userId && m.church_id === churchId && m.status === 'active')
}

export function validateBranchDraft(draft: BranchDraft): string | null {
  if (draft.name.trim().length < 3) return 'Informe o nome da filial (pelo menos 3 caracteres).'
  const coords = validateLatLng(draft.lat ?? null, draft.lng ?? null)
  if (coords) return coords
  return null
}

export async function createBranch(draft: BranchDraft, actor: BranchActor): Promise<BranchWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: BRANCH_NO_CHURCH }
  const invalid = validateBranchDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const row: ChurchBranch = {
    id: crypto.randomUUID(),
    church_id: churchId,
    name: draft.name.trim(),
    address: cleanText(draft.address),
    city: cleanText(draft.city),
    state: cleanText(draft.state),
    lat: draft.lat ?? null,
    lng: draft.lng ?? null,
    leader: cleanText(draft.leader),
  }

  if (!supabase) {
    branches.push(row)
    return { ok: true, branch: pickColumns(row, BRANCH_COLUMNS) }
  }

  const { data, error } = await supabase
    .from('church_branches')
    .insert(pickKeys(row, BRANCH_INSERT_COLUMNS))
    .select(BRANCH_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeBranchDbError(error) }
  if (!data) return { ok: false, error: BRANCH_NOT_FOUND }
  return { ok: true, branch: data as unknown as ChurchBranch }
}

export async function updateBranch(id: string, draft: BranchDraft, actor: BranchActor): Promise<BranchWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateBranchDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const patch = {
    name: draft.name.trim(),
    address: cleanText(draft.address),
    city: cleanText(draft.city),
    state: cleanText(draft.state),
    lat: draft.lat ?? null,
    lng: draft.lng ?? null,
    leader: cleanText(draft.leader),
  }

  if (!supabase) {
    const found = demoEditableBranch(id, actor)
    if (!found) return { ok: false, error: BRANCH_NOT_FOUND }
    Object.assign(found, patch)
    return { ok: true, branch: pickColumns(found, BRANCH_COLUMNS) }
  }

  const { data, error } = await supabase
    .from('church_branches')
    .update(patch)
    .eq('id', id)
    .select(BRANCH_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeBranchDbError(error) }
  // `maybeSingle` sem linha é o USING recusando em silêncio (quem é de fora não
  // alcança a linha): mesma mensagem de "não existe", sem oráculo.
  if (!data) return { ok: false, error: BRANCH_NOT_FOUND }
  return { ok: true, branch: data as unknown as ChurchBranch }
}

function gateWrite(actor: BranchActor): string | null {
  return can(actor.role, 'church.manage') ? null : BRANCH_MANAGE_DENIED
}

/** Espelha USING + WITH CHECK de `church_branches_update`, com o SuperAdmin transversal. */
function demoEditableBranch(id: string, actor: BranchActor): ChurchBranch | undefined {
  const found = branches.find((b) => b.id === id)
  if (!found) return undefined
  if (actor.role === 'superadmin') return found
  return found.church_id === actor.churchId ? found : undefined
}

/** Vazio vira null: é o que a coluna guarda e o que a tela mostra como "—". */
function cleanText(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function pickColumns(branch: ChurchBranch, columns: readonly (keyof ChurchBranch)[]): ChurchBranch {
  const source = branch as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = source[column]
  return out as unknown as ChurchBranch
}

function pickKeys(row: object, columns: readonly string[]): Record<string, unknown> {
  const source = row as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = source[column]
  return out
}

function sortByName(rows: ChurchBranch[]): ChurchBranch[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name))
}

function describeBranchDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return BRANCH_MANAGE_DENIED
    case '23514':
      return 'Coordenada fora do intervalo: a latitude vai de -90 a 90 e a longitude de -180 a 180.'
    case '23503':
      return 'Igreja não encontrada. Atualize a lista e tente de novo.'
    default:
      return error.message
  }
}
