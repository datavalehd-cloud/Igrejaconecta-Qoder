import { branches, members } from '@/data/mock'
import {
  BRANCH_COLUMNS,
  BRANCH_MANAGE_DENIED,
  BRANCH_NO_CHURCH,
  BRANCH_NOT_FOUND,
  validateBranchDraft,
  type BranchActor,
  type BranchDraft,
  type BranchWriteResult,
} from '@/services/data/branchService'
import { can } from '@/utils/rbac'
import type { ChurchBranch } from '@/types'

/**
 * Loja em memória que espelha `church_branches` (0013) para os testes. Vive fora do
 * aplicativo: as regras de audiência e de "sem oráculo" estão provadas na suíte SQL
 * (grupo O); aqui elas continuam especificadas em TypeScript, para a consulta real
 * não divergir do que a tela sempre mostrou.
 */

/** Espelha `church_branches_read`: membro ativo da igreja, ou SuperAdmin para todas. */
export function demoChurchBranches(churchId?: string, actor?: BranchActor): ChurchBranch[] {
  if (actor?.role === 'superadmin') return sortByName(branches.map((b) => pickColumns(b, BRANCH_COLUMNS)))
  if (!churchId) return []
  // Vínculo `invited` não lê filial (caso O3). A checagem só vale quando a sessão
  // informa o usuário; sem ele o recorte é a igreja, como nas outras leituras.
  if (actor?.userId && !isActiveMember(actor.userId, churchId)) return []
  return sortByName(branches.filter((b) => b.church_id === churchId).map((b) => pickColumns(b, BRANCH_COLUMNS)))
}

export function demoCreateBranch(draft: BranchDraft, actor: BranchActor): BranchWriteResult {
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
  branches.push(row)
  return { ok: true, branch: pickColumns(row, BRANCH_COLUMNS) }
}

export function demoUpdateBranch(id: string, draft: BranchDraft, actor: BranchActor): BranchWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateBranchDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const found = demoEditableBranch(id, actor)
  if (!found) return { ok: false, error: BRANCH_NOT_FOUND }
  Object.assign(found, {
    name: draft.name.trim(),
    address: cleanText(draft.address),
    city: cleanText(draft.city),
    state: cleanText(draft.state),
    lat: draft.lat ?? null,
    lng: draft.lng ?? null,
    leader: cleanText(draft.leader),
  })
  return { ok: true, branch: pickColumns(found, BRANCH_COLUMNS) }
}

export function resetBranchFixture() {
  branches.splice(0, branches.length, ...structuredClone(originalBranches))
}

/** Espelha USING + WITH CHECK de `church_branches_update`, com o SuperAdmin transversal. */
function demoEditableBranch(id: string, actor: BranchActor): ChurchBranch | undefined {
  const found = branches.find((b) => b.id === id)
  if (!found) return undefined
  if (actor.role === 'superadmin') return found
  return found.church_id === actor.churchId ? found : undefined
}

const originalBranches = structuredClone(branches)

function gateWrite(actor: BranchActor): string | null {
  return can(actor.role, 'church.manage') ? null : BRANCH_MANAGE_DENIED
}

function isActiveMember(userId: string, churchId: string): boolean {
  return members.some((m) => m.user_id === userId && m.church_id === churchId && m.status === 'active')
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

function sortByName(rows: ChurchBranch[]): ChurchBranch[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name))
}
