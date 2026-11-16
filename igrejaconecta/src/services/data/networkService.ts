import { supabase } from '@/services/supabase/client'
import { slugify } from '@/utils/format'
import type { RoleKey } from '@/types'
import type { ChurchNetwork, NetworkChurch } from '@/types'

/**
 * Redes de igrejas (0017) — a mesa por trás de `/admin/organizacoes`. A cerca é
 * a decisão 1 da migração: escrita EXCLUSIVA do SuperAdmin nas duas tabelas, e
 * é a mesma audiência de `church.approve` — criar rede é decisão de plataforma,
 * igreja nenhuma se autoassocia. O gate daqui é a primeira camada; as políticas
 * `church_networks_*`/`church_network_churches_*` são a segunda, e a suíte SQL
 * mede os dois lados (grupo S: S1 escrita do SuperAdmin, S2/S3 recusa do papel
 * da igreja, S4 anon sem grant, S5 estrutura).
 *
 * A lista vem da view `church_network_list`: `churches_count` é contado pelo
 * banco, nunca digitado — é a decisão explícita da 0017 de não deixar ninguém
 * "informar" quantas igrejas tem uma rede.
 *
 * `slug` nasce do nome uma vez (candidatos com sufixo de desempate, como em
 * igreja e evento) e depois não se edita: mudar o endereço de uma rede
 * quebraria o que apontasse para ele, e nenhuma tela pública consome o slug
 * ainda — a URL pública é o passo seguinte, não esta.
 */

export const NETWORK_COLUMNS = ['id', 'name', 'slug', 'description', 'churches_count'] as const satisfies readonly (keyof ChurchNetwork)[]
export const NETWORK_INSERT_COLUMNS = ['name', 'slug', 'description'] as const
export const NETWORK_PATCH_COLUMNS = ['name', 'description'] as const
export const MEMBERSHIP_SELECT = 'network_id, church_id, churches(id, name)'

export const NETWORK_DENIED =
  'Criar e gerir redes de igrejas é decisão de plataforma: só o SuperAdmin faz isso.'
export const NETWORK_NOT_FOUND = 'Rede não encontrada ou sem permissão para alterá-la. Atualize a lista.'
export const NETWORK_NAME_INVALID = 'Informe o nome da rede (de 2 a 80 caracteres).'
export const NETWORK_SLUG_TAKEN = 'Não deu para gerar um endereço único para esse nome. Tente outro nome.'
export const MEMBERSHIP_EXISTS = 'Esta igreja já pertence a esta rede.'
export const MEMBERSHIP_NOT_FOUND = 'Essa igreja não está nesta rede (ou a rede mudou). Atualize a lista.'
export const NETWORK_LINK_INVALID = 'Igreja ou rede não encontrada no banco. Atualize a lista e tente de novo.'

export interface NetworkActor {
  role?: RoleKey
}

export interface NetworkDraft {
  name: string
  description: string
}

export type NetworkWriteResult =
  | { ok: true; network: ChurchNetwork; error?: never }
  | { ok: false; error: string; network?: never }

export type MembershipResult = { ok: true; error?: never } | { ok: false; error: string }

/** Redes com contagem do banco, em ordem de nome. Só SuperAdmin dispara a consulta. */
export async function fetchNetworks(actor: NetworkActor): Promise<ChurchNetwork[]> {
  if (actor.role !== 'superadmin') return []
  const { data, error } = await supabase
    .from('church_network_list')
    .select(NETWORK_COLUMNS.join(','))
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ChurchNetwork[]
}

/** Slug base + sufixos de desempate, na ordem de tentativa (mesma régua da igreja). */
export function networkSlugCandidates(name: string): string[] {
  const base = slugify(name)
  if (!base) return []
  return [base, ...Array.from({ length: 9 }, (_, i) => `${base}-${i + 2}`)]
}

export function validateNetworkDraft(draft: NetworkDraft): string | null {
  const name = draft.name.trim()
  if (name.length < 2 || name.length > 80) return NETWORK_NAME_INVALID
  return null
}

export async function createNetwork(draft: NetworkDraft, actor: NetworkActor): Promise<NetworkWriteResult> {
  const denied = gate(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateNetworkDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const candidates = networkSlugCandidates(draft.name)
  if (candidates.length === 0) return { ok: false, error: NETWORK_NAME_INVALID }

  const row = {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
  }

  for (const slug of candidates) {
    // Insere sem `.select()`: a releitura é pela VIEW (projeção da tela), e a
    // view já tem a audiência do SuperAdmin — mesma separação leitura/escrita
    // da igreja no onboarding.
    const { error } = await supabase.from('church_networks').insert({ ...row, slug })
    if (error && error.code !== '23505') return { ok: false, error: describeNetworkDbError(error) }
    if (error) continue

    const { data, error: readError } = await supabase
      .from('church_network_list')
      .select(NETWORK_COLUMNS.join(','))
      .eq('slug', slug)
      .maybeSingle()
    if (readError) return { ok: false, error: describeNetworkDbError(readError) }
    if (!data) return { ok: false, error: NETWORK_NOT_FOUND }
    return { ok: true, network: data as unknown as ChurchNetwork }
  }
  return { ok: false, error: NETWORK_SLUG_TAKEN }
}

export async function updateNetwork(id: string, draft: NetworkDraft, actor: NetworkActor): Promise<NetworkWriteResult> {
  const denied = gate(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateNetworkDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  // `slug` não vai no patch: o endereço nasce com o nome e fica (decisão da
  // tela abaixo, não limitação do banco — a política deixaria).
  const patch: Record<string, unknown> = {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
  }

  const { data, error } = await supabase
    .from('church_networks')
    .update(patch)
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, error: describeNetworkDbError(error) }
  if (!data || data.length === 0) return { ok: false, error: NETWORK_NOT_FOUND }

  const { data: row, error: readError } = await supabase
    .from('church_network_list')
    .select(NETWORK_COLUMNS.join(','))
    .eq('id', id)
    .maybeSingle()
  if (readError) return { ok: false, error: describeNetworkDbError(readError) }
  if (!row) return { ok: false, error: NETWORK_NOT_FOUND }
  return { ok: true, network: row as unknown as ChurchNetwork }
}

/**
 * Apagar a rede cai em cascata sobre os vínculos (`on delete cascade`, decisão
 * 5 da 0017) e NÃO toca `churches`: desfazer a organização das igrejas continua
 * deixando cada igreja no ar, inteira.
 */
export async function deleteNetwork(id: string, actor: NetworkActor): Promise<MembershipResult> {
  const denied = gate(actor)
  if (denied) return { ok: false, error: denied }
  const { data, error } = await supabase.from('church_networks').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: describeNetworkDbError(error) }
  if (!data || data.length === 0) return { ok: false, error: NETWORK_NOT_FOUND }
  return { ok: true }
}

/** Igrejas da rede, com o nome embutido pela FK e em ordem de nome. */
export async function fetchNetworkChurches(networkId: string, actor: NetworkActor): Promise<NetworkChurch[]> {
  if (actor.role !== 'superadmin') return []
  const { data, error } = await supabase
    .from('church_network_churches')
    .select(MEMBERSHIP_SELECT)
    .eq('network_id', networkId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as NetworkChurch[]
  return rows.sort((a, b) => (a.churches?.name ?? '').localeCompare(b.churches?.name ?? ''))
}

export async function addChurchToNetwork(networkId: string, churchId: string, actor: NetworkActor): Promise<MembershipResult> {
  const denied = gate(actor)
  if (denied) return { ok: false, error: denied }
  const { error } = await supabase
    .from('church_network_churches')
    .insert({ network_id: networkId, church_id: churchId })
  if (error) {
    // PK composta: 23505 aqui significa "já está na rede", não "slug ocupado".
    if (error.code === '23505') return { ok: false, error: MEMBERSHIP_EXISTS }
    return { ok: false, error: describeNetworkDbError(error) }
  }
  return { ok: true }
}

export async function removeChurchFromNetwork(networkId: string, churchId: string, actor: NetworkActor): Promise<MembershipResult> {
  const denied = gate(actor)
  if (denied) return { ok: false, error: denied }
  const { data, error } = await supabase
    .from('church_network_churches')
    .delete()
    .eq('network_id', networkId)
    .eq('church_id', churchId)
    .select('church_id')
  if (error) return { ok: false, error: describeNetworkDbError(error) }
  if (!data || data.length === 0) return { ok: false, error: MEMBERSHIP_NOT_FOUND }
  return { ok: true }
}

function gate(actor: NetworkActor): string | null {
  return actor.role === 'superadmin' ? null : NETWORK_DENIED
}

function describeNetworkDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return NETWORK_DENIED
    case '23514':
      return NETWORK_NAME_INVALID
    case '23503':
      return NETWORK_LINK_INVALID
    default:
      return error.message
  }
}
