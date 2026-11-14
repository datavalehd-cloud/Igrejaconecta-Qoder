import { members, ministries, ministryMembers, profiles } from '@/data/mock'
import {
  MINISTRY_LEADER_OUTSIDE,
  MINISTRY_MANAGE_DENIED,
  MINISTRY_MEMBER_OUTSIDE,
  MINISTRY_NO_CHURCH,
  MINISTRY_NOT_FOUND,
  validateMinistryDraft,
  type MinistryActor,
  type MinistryDraft,
  type MinistryWriteResult,
} from '@/services/data/ministryService'
import { can } from '@/utils/rbac'
import type { Ministry } from '@/types'

/**
 * Loja em memória que espelha `ministries` + `ministry_members` + a view
 * `ministry_list` (0015) com a guarda de audiência da 0021. Vive fora do
 * aplicativo: o que vale em produção é o banco, e a suíte SQL (grupo Q9) é o que
 * prova a recusa. Aqui a mesma régua continua escrita em TypeScript para a
 * consulta real não divergir do que a tela sempre mostrou.
 *
 * Nada neste arquivo guarda "quantos participantes": `members_count` é derivado
 * de `ministryMembers` na leitura, exatamente como o `count(*)` da view.
 */

const NOT_A_PROFILE = 'A pessoa indicada não é uma conta desta plataforma. Atualize a lista de membros.'

export function demoMinistries(churchId?: string, actor?: MinistryActor): Ministry[] {
  const rows = actor?.role === 'superadmin'
    ? ministries
    : churchId
      ? ministries.filter((m) => m.church_id === churchId)
      : []
  // Vínculo `invited` não lê (a view usa `current_church_ids()`, que só conta
  // ativo). Só faz diferença quando a sessão informa o usuário.
  const visible = actor?.userId ? rows.filter((m) => isActiveMember(actor.userId!, m.church_id)) : rows
  return [...visible].sort((a, b) => a.name.localeCompare(b.name)).map(project)
}

export function demoCreateMinistry(draft: MinistryDraft, actor: MinistryActor): MinistryWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: MINISTRY_NO_CHURCH }
  const invalid = validateMinistryDraft(draft)
  if (invalid) return { ok: false, error: invalid }
  const refused = guardPerson(churchId, draft.leader_id, MINISTRY_LEADER_OUTSIDE)
  if (refused) return { ok: false, error: refused }

  const row: Ministry = {
    id: crypto.randomUUID(),
    church_id: churchId,
    type: draft.type,
    name: draft.name.trim(),
    description: cleanText(draft.description),
    leader_id: cleanId(draft.leader_id),
    members_count: 0,
  }
  ministries.push(row)
  return { ok: true, ministry: project(row) }
}

export function demoUpdateMinistry(id: string, draft: MinistryDraft, actor: MinistryActor): MinistryWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateMinistryDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const found = demoEditableMinistry(id, actor)
  if (!found) return { ok: false, error: MINISTRY_NOT_FOUND }
  const refused = guardPerson(found.church_id, draft.leader_id, MINISTRY_LEADER_OUTSIDE)
  if (refused) return { ok: false, error: refused }

  Object.assign(found, {
    name: draft.name.trim(),
    type: draft.type,
    description: cleanText(draft.description),
    leader_id: cleanId(draft.leader_id),
  })
  return { ok: true, ministry: project(found) }
}

export function demoDeleteMinistry(id: string, actor: MinistryActor): { ok: true } | { ok: false; error: string } {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const index = ministries.findIndex((m) => m.id === id)
  const found = index < 0 ? undefined : ministries[index]
  // Alcançar a linha é a política de delete (USING): quem é de fora recebe
  // "não encontrado", sem saber se o ministério existe.
  if (!found || !canReach(found, actor)) return { ok: false, error: MINISTRY_NOT_FOUND }
  ministries.splice(index, 1)
  // `on delete cascade`: desfazer o ministério desfaz as participações.
  for (let i = ministryMembers.length - 1; i >= 0; i -= 1) {
    if (ministryMembers[i]!.ministry_id === id) ministryMembers.splice(i, 1)
  }
  return { ok: true }
}

export function demoMinistryMembers(ministryId: string): string[] {
  return ministryMembers.filter((row) => row.ministry_id === ministryId).map((row) => row.user_id)
}

export function demoAddMinistryMember(
  ministryId: string,
  userId: string,
  actor: MinistryActor,
): { ok: true } | { ok: false; error: string } {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const ministry = ministries.find((m) => m.id === ministryId)
  if (!ministry) return { ok: false, error: MINISTRY_NOT_FOUND }
  if (ministryMembers.some((row) => row.ministry_id === ministryId && row.user_id === userId)) {
    return { ok: false, error: 'Essa pessoa já participa do ministério.' }
  }
  const refused = guardPerson(ministry.church_id, userId, MINISTRY_MEMBER_OUTSIDE)
  if (refused) return { ok: false, error: refused }
  ministryMembers.push({ ministry_id: ministryId, user_id: userId })
  return { ok: true }
}

export function demoRemoveMinistryMember(
  ministryId: string,
  userId: string,
  actor: MinistryActor,
): { ok: true } | { ok: false; error: string } {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const ministry = ministries.find((m) => m.id === ministryId)
  if (!ministry || !canReach(ministry, actor)) return { ok: false, error: MINISTRY_NOT_FOUND }
  const index = ministryMembers.findIndex((row) => row.ministry_id === ministryId && row.user_id === userId)
  if (index < 0) return { ok: false, error: 'Essa pessoa não está mais no ministério. Atualize a lista.' }
  ministryMembers.splice(index, 1)
  return { ok: true }
}

export function resetMinistryFixture() {
  ministries.splice(0, ministries.length, ...structuredClone(originalMinistries))
  ministryMembers.splice(0, ministryMembers.length, ...structuredClone(originalMinistryMembers))
}

const originalMinistries = structuredClone(ministries)
const originalMinistryMembers = structuredClone(ministryMembers)

/**
 * Espelho do `enforce_ministry_leader`/`enforce_ministry_member` (0021): primeiro
 * a referência (a pessoa é uma conta?), depois a audiência (é membro **ativo**
 * da igreja do ministério?).
 */
function guardPerson(churchId: string, personId: string | null | undefined, message: string): string | null {
  const id = cleanId(personId)
  if (!id) return null
  if (!profiles.some((p) => p.id === id)) return NOT_A_PROFILE
  if (!isActiveMember(id, churchId)) return message
  return null
}

function demoEditableMinistry(id: string, actor: MinistryActor): Ministry | undefined {
  const found = ministries.find((m) => m.id === id)
  if (!found) return undefined
  return canReach(found, actor) ? found : undefined
}

/** USING das políticas de update/delete: `has_church_permission(church_id, 'members.manage')`. */
function canReach(ministry: Ministry, actor: MinistryActor): boolean {
  if (actor.role === 'superadmin') return true
  return Boolean(actor.churchId) && ministry.church_id === actor.churchId
}

/** A view não devolve `leader_name` nem `members_count` guardados: são derivados. */
function project(ministry: Ministry): Ministry {
  return {
    id: ministry.id,
    church_id: ministry.church_id,
    type: ministry.type,
    name: ministry.name,
    description: ministry.description ?? null,
    leader_id: ministry.leader_id ?? null,
    leader_name: ministry.leader_id ? profiles.find((p) => p.id === ministry.leader_id)?.full_name ?? null : null,
    members_count: ministryMembers.filter((row) => row.ministry_id === ministry.id).length,
    created_at: ministry.created_at,
    updated_at: ministry.updated_at,
  }
}

function isActiveMember(userId: string, churchId: string): boolean {
  return members.some((m) => m.user_id === userId && m.church_id === churchId && m.status === 'active')
}

function gateWrite(actor: MinistryActor): string | null {
  return can(actor.role, 'members.manage') ? null : MINISTRY_MANAGE_DENIED
}

function cleanText(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function cleanId(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}
