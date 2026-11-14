import { members } from '@/data/mock'
import {
  SOCIAL_CONNECT_LOCKED,
  SOCIAL_DUPLICATE,
  SOCIAL_MANAGE_DENIED,
  SOCIAL_NO_CHURCH,
  SOCIAL_NOT_FOUND,
  validateHandle,
  validateSocialDraft,
  type SocialAccountActor,
  type SocialAccountDraft,
  type SocialAccountWriteResult,
} from '@/services/data/socialAccountService'
import { can } from '@/utils/rbac'
import type { ChurchSocialAccount } from '@/types'

/**
 * Loja em memória que espelha `church_social_accounts` (0015): as políticas de
 * leitura/escrita, o índice único por (igreja, rede, handle em minúsculas) e o
 * trigger `enforce_social_connection`. Vive fora do aplicativo — o que vale em
 * produção é o banco, e a recusa de verdade está provada na suíte SQL (Q6, Q7,
 * Q7b, Q8). Aqui a mesma régua continua escrita em TypeScript para a consulta
 * real não divergir do que a tela mostra.
 *
 * O ponto que este arquivo não pode errar: `connected` nunca nasce `true` por
 * caminho de app. `demoCreateSocialAccount` grava `false` e só
 * `demoSetSocialConnected` mexe na coluna, e apenas para quem é `backend` — o
 * espelho do `service_role` que falou com o provedor.
 */

export interface SocialBackendActor extends SocialAccountActor {
  /** true só para o teste que representa o backend com OAuth confirmado. */
  backend?: boolean
}

export const socialFixture: ChurchSocialAccount[] = [
  { id: 'soc1', church_id: 'ch1', network: 'instagram', handle: '@ibcentral', connected: false },
  { id: 'soc2', church_id: 'ch1', network: 'facebook', handle: 'Igreja Batista Central', connected: false },
  { id: 'soc3', church_id: 'ch1', network: 'youtube', handle: '@ibcentral', connected: false },
  { id: 'soc4', church_id: 'ch2', network: 'instagram', handle: '@assembleiavida', connected: false },
]

const original = structuredClone(socialFixture)

export function resetSocialFixture() {
  socialFixture.splice(0, socialFixture.length, ...structuredClone(original))
}

export function demoSocialAccounts(churchId?: string, actor?: SocialAccountActor): ChurchSocialAccount[] {
  const rows = actor?.role === 'superadmin' ? socialFixture : churchId ? socialFixture.filter((r) => r.church_id === churchId) : []
  // A policy de leitura é `current_church_ids()`, que só conta vínculo ativo.
  const visible = actor?.userId ? rows.filter((r) => isActiveMember(actor.userId!, r.church_id)) : rows
  return [...visible].sort((a, b) => a.network.localeCompare(b.network) || a.handle.localeCompare(b.handle))
}

export function demoCreateSocialAccount(draft: SocialAccountDraft, actor: SocialBackendActor): SocialAccountWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: SOCIAL_NO_CHURCH }
  const invalid = validateSocialDraft(draft)
  if (invalid) return { ok: false, error: invalid }
  if (duplicate(churchId, draft.network, draft.handle)) return { ok: false, error: SOCIAL_DUPLICATE }

  const row: ChurchSocialAccount = {
    id: crypto.randomUUID(),
    church_id: churchId,
    network: draft.network,
    handle: draft.handle.trim(),
    connected: false,
  }
  socialFixture.push(row)
  return { ok: true, account: row }
}

export function demoUpdateSocialHandle(id: string, handle: string, actor: SocialBackendActor): SocialAccountWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateHandle(handle)
  if (invalid) return { ok: false, error: invalid }

  const found = socialFixture.find((r) => r.id === id)
  if (!found || !canReach(found, actor)) return { ok: false, error: SOCIAL_NOT_FOUND }
  if (duplicate(found.church_id, found.network, handle, id)) return { ok: false, error: SOCIAL_DUPLICATE }
  found.handle = handle.trim()
  return { ok: true, account: found }
}

export function demoDeleteSocialAccount(
  id: string,
  actor: SocialBackendActor,
): { ok: true } | { ok: false; error: string } {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const index = socialFixture.findIndex((r) => r.id === id)
  const found = index < 0 ? undefined : socialFixture[index]
  if (!found || !canReach(found, actor)) return { ok: false, error: SOCIAL_NOT_FOUND }
  socialFixture.splice(index, 1)
  return { ok: true }
}

/**
 * Espelho do `enforce_social_connection` (0015): para o app a coluna é imutável,
 * nos dois sentidos — conectar e desconectar. O banco responde `42501` com a
 * frase abaixo; aqui a mesma frase, e o `backend` faz o papel do `service_role`.
 */
export function demoSetSocialConnected(id: string, connected: boolean, actor: SocialBackendActor): SocialAccountWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const found = socialFixture.find((r) => r.id === id)
  if (!found || !canReach(found, actor)) return { ok: false, error: SOCIAL_NOT_FOUND }
  if (found.connected !== connected && !actor.backend) return { ok: false, error: SOCIAL_CONNECT_LOCKED }
  found.connected = connected
  return { ok: true, account: found }
}

/** INSERT com `connected = true`: o trigger recusa antes de a linha nascer. */
export function demoInsertConnected(
  draft: SocialAccountDraft,
  actor: SocialBackendActor,
): SocialAccountWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: SOCIAL_NO_CHURCH }
  const invalid = validateSocialDraft(draft)
  if (invalid) return { ok: false, error: invalid }
  if (!actor.backend) return { ok: false, error: SOCIAL_CONNECT_LOCKED }

  const row: ChurchSocialAccount = {
    id: crypto.randomUUID(),
    church_id: churchId,
    network: draft.network,
    handle: draft.handle.trim(),
    connected: true,
  }
  socialFixture.push(row)
  return { ok: true, account: row }
}

/** `church_social_accounts_church_network_uidx`: única por (igreja, rede, handle em minúsculas). */
function duplicate(churchId: string, network: string, handle: string, exceptId?: string): boolean {
  const text = handle.trim().toLowerCase()
  return socialFixture.some(
    (r) => r.id !== exceptId && r.church_id === churchId && r.network === network && r.handle.toLowerCase() === text,
  )
}

/** USING das políticas de update/delete: `has_church_permission(church_id, 'church.manage')`. */
function canReach(row: ChurchSocialAccount, actor: SocialBackendActor): boolean {
  if (actor.role === 'superadmin') return true
  return Boolean(actor.churchId) && row.church_id === actor.churchId
}

function isActiveMember(userId: string, churchId: string): boolean {
  return members.some((m) => m.user_id === userId && m.church_id === churchId && m.status === 'active')
}

function gateWrite(actor: SocialAccountActor): string | null {
  return can(actor.role, 'church.manage') ? null : SOCIAL_MANAGE_DENIED
}
