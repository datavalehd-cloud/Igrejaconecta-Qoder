import { auditLogs, churches, members } from '@/data/mock'
import { approvalAuditAction } from '@/services/data/auditService'
import { APPROVAL_COLUMNS } from '@/services/data/churchApprovalService'
import {
  CREATED_COLUMNS,
  CHURCH_CREATE_INVALID_NAME,
  CHURCH_CREATE_SLUG_TAKEN,
  churchSlugCandidates,
  type ChurchCreateResult,
  type ChurchDraft,
  type ChurchCreator,
  DIRECTORY_COLUMNS,
  MANAGED_COLUMNS,
  MAP_COLUMNS,
} from '@/services/data/churchService'
import type { ApprovalStatus, Church, ChurchMember, MemberChurch, RoleKey } from '@/types'

/**
 * Loja em memória das igrejas e dos vínculos, para os testes especificarem as
 * regras que a RLS já prova em SQL (grupos A, B, I e J): diretório só com
 * `approved + active`, lista de gestão com todos os status e na ordem da tela,
 * vínculo ativo resolvido até a igreja e o criador que vira `church_admin`
 * (trigger 0006). O aplicativo não passa por aqui — ele consulta o Supabase.
 */

const originalChurches = structuredClone(churches)
const originalMembers = structuredClone(members)

export function resetChurchFixture() {
  churches.splice(0, churches.length, ...structuredClone(originalChurches))
  members.splice(0, members.length, ...structuredClone(originalMembers))
}

/** Espelha `churches_public_read` + o WHERE do diretório, com a projeção do público. */
export function demoDirectoryChurches(): Church[] {
  return sortByName(
    churches
      .filter((c) => c.approval_status === 'approved' && c.status === 'active')
      .map((c) => pick(c, DIRECTORY_COLUMNS)),
  )
}

/** Mesma audiência do diretório, projeção com coordenadas (mapa). */
export function demoMapChurches(): Church[] {
  return sortByName(
    churches
      .filter((c) => c.approval_status === 'approved' && c.status === 'active')
      .map((c) => pick(c, MAP_COLUMNS)),
  )
}

/** Todas as igrejas e todos os status, na ordem da tela de gestão (caso I4). */
export function demoManagedChurches(): Church[] {
  // Estável: ordena por nome e depois por status, o mesmo par `.order(approval_status)
  // .order(name)` que a consulta real manda.
  return sortByKey(
    sortByName(churches.map((c) => pick(c, MANAGED_COLUMNS))),
    (c) => c.approval_status,
  )
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

/**
 * Espelha `churches_insert` (0002) + `trg_churches_creator_admin` (0006) e o
 * desempate de slug: quem cadastra vira `church_admin` da igreja pendente.
 */
export function demoCreateChurch(draft: ChurchDraft, creator?: ChurchCreator): ChurchCreateResult {
  if (!creator?.id) return { ok: false, error: 'Entre na sua conta para cadastrar a igreja.' }
  const name = draft.name.trim()
  if (name.length < 3) return { ok: false, error: CHURCH_CREATE_INVALID_NAME }
  const candidates = churchSlugCandidates(name)
  if (candidates.length === 0) return { ok: false, error: CHURCH_CREATE_INVALID_NAME }

  const taken = new Set(churches.map((c) => c.slug))
  const slug = candidates.find((candidate) => !taken.has(candidate))
  if (!slug) return { ok: false, error: CHURCH_CREATE_SLUG_TAKEN }

  const timestamp = new Date().toISOString()
  const church: Church = {
    id: crypto.randomUUID(),
    slug,
    name,
    city: cleanText(draft.city),
    state: cleanText(draft.state),
    denomination: cleanText(draft.denomination),
    email: cleanText(draft.email),
    phone: cleanText(draft.phone),
    whatsapp: cleanText(draft.whatsapp),
    website: cleanText(draft.website),
    description: null,
    logo_url: null,
    cover_url: null,
    address: null,
    zip: null,
    lat: null,
    lng: null,
    status: 'active',
    approval_status: 'pending',
    created_at: timestamp,
    updated_at: timestamp,
  }
  churches.push(church)
  // Espelha o trigger 0006: quem cria vira church_admin ativo da igreja.
  const link: ChurchMember = {
    id: crypto.randomUUID(),
    church_id: church.id,
    user_id: creator.id,
    role_id: 'r2',
    role: 'church_admin',
    status: 'active',
    created_at: timestamp,
  }
  members.push(link)
  return { ok: true, church: pick(church, CREATED_COLUMNS) }
}

/**
 * Espelha aRPC `set_church_approval_status` (0011): trilha antes da mudança de
 * status, no mesmo statement — aqui, na mesma chamada, sem `await` no meio. Só o
 * SuperAdmin alcança a igreja e a trilha usa o nome dela, não um texto inventado.
 */
export function demoSetApproval(
  churchId: string,
  next: ApprovalStatus,
  actor: { id: string; email: string; role?: RoleKey },
): { ok: true; church: Church; error?: never } | { ok: false; error: string; church?: never } {
  if (actor.role !== 'superadmin') {
    return { ok: false, error: 'Sem permissão para esta ação: aprovação é exclusividade do SuperAdmin.' }
  }
  const church = churches.find((c) => c.id === churchId)
  if (!church) return { ok: false, error: 'Igreja não encontrada.' }
  if (church.approval_status !== next) {
    const timestamp = new Date().toISOString()
    auditLogs.push({
      id: crypto.randomUUID(),
      actor: actor.email,
      action: approvalAuditAction(church.approval_status, next),
      target: church.name,
      church: church.name,
      metadata: { de: church.approval_status, para: next },
      created_at: timestamp,
    })
    church.approval_status = next
    church.updated_at = timestamp
  }
  return { ok: true, church: pickApproval(church) }
}

function cleanText(value?: string): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed || null
}

function pick(church: Church, columns: readonly (keyof Church)[]): Church {
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = church[column]
  return out as unknown as Church
}

function pickApproval(church: Church): Church {
  return pick(church, APPROVAL_COLUMNS)
}

function sortByName<T extends { name: string }>(rows: T[]) {
  return sortByKey(rows, (r) => r.name)
}

function sortByKey<T>(rows: T[], key: (row: T) => string) {
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
}
