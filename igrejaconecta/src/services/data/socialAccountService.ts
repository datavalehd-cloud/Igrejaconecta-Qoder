import { supabase } from '@/services/supabase/client'
import { can } from '@/utils/rbac'
import type { ChurchSocialAccount, RoleKey, SocialNetwork } from '@/types'

/**
 * Perfis de rede social da igreja (`church_social_accounts`, 0015). A tela
 * costumava listar contas inventadas; aqui cada linha vem do banco e o que se
 * grava é o `@handle` — informação que o administrador da igreja sabe.
 *
 * A peça que não pode afrouxar: **`connected` nunca sai deste serviço**. Ele não
 * está em `SOCIAL_INSERT_COLUMNS` nem no patch de update, e o trigger
 * `enforce_social_connection` (0015) recusa com `42501` qualquer `authenticated`
 * que tente escrevê-lo — inclusive nascendo conectado. Conexão confirmada é
 * afirmação sobre o provedor, e quem a faz é um backend que falou com ele. O selo
 * da tela é o valor que o banco devolve, nunca uma escolha de formulário.
 *
 * Escrita é `church.manage` (perfil de rede é parte do cadastro da igreja), mais
 * estreita que o guard da rota (`marketing.manage`): por isso a tela tem estado
 * leitura-ativada. A policy é a segunda camada; o gate abaixo é a primeira.
 */

export const SOCIAL_COLUMNS = [
  'id',
  'church_id',
  'network',
  'handle',
  'connected',
] as const satisfies readonly (keyof ChurchSocialAccount)[]

/** Colunas que saem na criação. `connected` não está aqui de propósito. */
export const SOCIAL_INSERT_COLUMNS = ['church_id', 'network', 'handle'] as const

/** O mesmo conjunto do CHECK de `church_social_accounts.network` (0015). */
export const SOCIAL_NETWORKS = ['instagram', 'facebook', 'whatsapp', 'youtube'] as const satisfies readonly SocialNetwork[]

const SOCIAL_SELECT = SOCIAL_COLUMNS.join(',')

/** O CHECK de `handle` da 0015: `char_length(btrim(handle)) between 1 and 60`. */
export const SOCIAL_HANDLE_MAX = 60

export const SOCIAL_MANAGE_DENIED =
  'Sem permissão para esta ação: perfil de rede social faz parte do cadastro da igreja e é de quem gerencia a igreja.'
export const SOCIAL_NOT_FOUND = 'Conta não encontrada ou sem permissão para alterá-la. Atualize a lista.'
export const SOCIAL_NO_CHURCH = 'A sua sessão não tem igreja ativa: quem não é de uma igreja não cadastra perfil de rede.'
export const SOCIAL_HANDLE_REQUIRED = `Informe o @handle da conta (até ${SOCIAL_HANDLE_MAX} caracteres).`
export const SOCIAL_NETWORK_UNSUPPORTED = 'Rede não suportada: o banco aceita Instagram, Facebook, WhatsApp e YouTube.'
export const SOCIAL_DUPLICATE = 'Essa conta já está cadastrada para esta igreja.'

/**
 * Tradução do `42501` do trigger `enforce_social_connection` (0015). O app não
 * tem caminho para chegar aqui — `connected` não está em `SOCIAL_INSERT_COLUMNS`
 * nem no patch de update — e é justamente por isso que a frase existe: o espelho
 * de teste (Q7) e o banco respondem a mesma coisa para quem tentar.
 */
export const SOCIAL_CONNECT_LOCKED =
  'Marcar uma rede como conectada exige a confirmação real do provedor (backend com OAuth).'

export interface SocialAccountActor {
  churchId?: string
  role?: RoleKey
}

export interface SocialAccountDraft {
  network: SocialNetwork
  handle: string
}

export type SocialAccountWriteResult =
  | { ok: true; account: ChurchSocialAccount; error?: never }
  | { ok: false; error: string; account?: never }

/** Perfis da igreja da sessão; o SuperAdmin alcança todas, sem recorte. */
export async function fetchSocialAccounts(
  churchId?: string,
  actor?: SocialAccountActor,
): Promise<ChurchSocialAccount[]> {
  const everyChurch = actor?.role === 'superadmin'
  if (!everyChurch && !churchId) return []

  let query = supabase.from('church_social_accounts').select(SOCIAL_SELECT).order('network').order('handle')
  if (!everyChurch) query = query.eq('church_id', churchId!)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ChurchSocialAccount[]
}

export function validateSocialDraft(draft: SocialAccountDraft): string | null {
  if (!isSocialNetwork(draft.network)) return SOCIAL_NETWORK_UNSUPPORTED
  return validateHandle(draft.handle)
}

export function validateHandle(handle: string): string | null {
  const text = handle.trim()
  if (!text || text.length > SOCIAL_HANDLE_MAX) return SOCIAL_HANDLE_REQUIRED
  return null
}

export async function createSocialAccount(
  draft: SocialAccountDraft,
  actor: SocialAccountActor,
): Promise<SocialAccountWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: SOCIAL_NO_CHURCH }
  const invalid = validateSocialDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const { data, error } = await supabase
    .from('church_social_accounts')
    .insert({ church_id: churchId, network: draft.network, handle: draft.handle.trim() })
    .select(SOCIAL_SELECT)
    .maybeSingle()
  if (error) return { ok: false, error: describeSocialDbError(error) }
  if (!data) return { ok: false, error: SOCIAL_NOT_FOUND }
  return { ok: true, account: data as unknown as ChurchSocialAccount }
}

/**
 * Só o `handle`. Trocar a rede de uma conta já cadastrada é cadastrar de novo:
 * assim o patch não tem como levar `connected` nem `church_id` por engano.
 */
export async function updateSocialHandle(
  id: string,
  handle: string,
  actor: SocialAccountActor,
): Promise<SocialAccountWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateHandle(handle)
  if (invalid) return { ok: false, error: invalid }

  const { data, error } = await supabase
    .from('church_social_accounts')
    .update({ handle: handle.trim() })
    .eq('id', id)
    .select(SOCIAL_SELECT)
    .maybeSingle()
  if (error) return { ok: false, error: describeSocialDbError(error) }
  // `maybeSingle` sem linha é a policy USING recusando em silêncio: quem é de
  // outra igreja recebe "não encontrada" e não descobre que a linha existe.
  if (!data) return { ok: false, error: SOCIAL_NOT_FOUND }
  return { ok: true, account: data as unknown as ChurchSocialAccount }
}

export async function deleteSocialAccount(
  id: string,
  actor: SocialAccountActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }

  const { data, error } = await supabase.from('church_social_accounts').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: describeSocialDbError(error) }
  if (!data || data.length === 0) return { ok: false, error: SOCIAL_NOT_FOUND }
  return { ok: true }
}

function gateWrite(actor: SocialAccountActor): string | null {
  return can(actor.role, 'church.manage') ? null : SOCIAL_MANAGE_DENIED
}

function isSocialNetwork(network: string): network is SocialNetwork {
  return (SOCIAL_NETWORKS as readonly string[]).includes(network)
}

function describeSocialDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return SOCIAL_NOT_FOUND
    case '23505':
      return SOCIAL_DUPLICATE
    case '23514':
      return `Rede ou @handle fora do permitido: o @handle vai de 1 a ${SOCIAL_HANDLE_MAX} caracteres e a rede é Instagram, Facebook, WhatsApp ou YouTube.`
    default:
      return error.message
  }
}
