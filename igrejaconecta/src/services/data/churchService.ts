import { supabase } from '@/services/supabase/client'
import { slugify } from '@/utils/format'
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
  const { data, error } = await supabase
    .from('churches')
    .select(DIRECTORY_COLUMNS.join(','))
    .eq('approval_status', 'approved')
    .eq('status', 'active')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Church[]
}

/**
 * Igrejas do mapa público: mesma audiência do diretório, projeção com
 * coordenadas. A ordenação por distância não é daqui — sem GPS não há origem, e
 * quem ordena é a tela com `sortByProximity` (utils/geo).
 */
export async function fetchMapChurches(): Promise<Church[]> {
  const { data, error } = await supabase
    .from('churches')
    .select(MAP_COLUMNS.join(','))
    .eq('approval_status', 'approved')
    .eq('status', 'active')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Church[]
}

/**
 * Lista de gestão do SuperAdmin. No modo real quem libera as linhas não aprovadas é
 * a `is_superadmin()` da política — um papel da igreja que chegasse aqui por
 * acidente receberia só a própria igreja (caso I3). O hook liga esta leitura apenas
 * para SuperAdmin; a política é a segunda camada.
 */
export async function fetchManagedChurches(): Promise<Church[]> {
  const { data, error } = await supabase
    .from('churches')
    .select(MANAGED_COLUMNS.join(','))
    .order('approval_status')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Church[]
}

/** Igrejas da conta com o papel de cada uma — o "Minhas igrejas" do perfil. */
export async function fetchMyChurches(userId?: string): Promise<MemberChurch[]> {
  if (!userId) return []
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

/**
 * Onboarding de igrejas (2026-11-12): o cadastro que faltava para uma comunidade
 * entrar na plataforma sem SQL. O insert manda `created_by` do ator e
 * `approval_status = 'pending'` — exatamente o que a política `churches_insert`
 * (0002) exige; o trigger `trg_churches_creator_admin` (0006) anexa o criador
 * como `church_admin` no mesmo statement. O slug é único: em conflito de
 * `churches_slug_unique` tenta sufixos `-2`… em vez de falhar de primeira.
 */
export interface ChurchDraft {
  name: string
  city?: string
  denomination?: string
  email?: string
  phone?: string
  state?: string
  website?: string
  whatsapp?: string
}

export interface ChurchCreator {
  id: string
}

export type ChurchCreateResult =
  | { ok: true; church: Church; error?: never }
  | { ok: false; error: string; church?: never }

export const CHURCH_CREATE_NO_ACTOR = 'Entre na sua conta para cadastrar a igreja.'
export const CHURCH_CREATE_INVALID_NAME = 'O nome da igreja precisa de pelo menos 3 caracteres.'
export const CHURCH_CREATE_SLUG_TAKEN = 'Não deu para gerar um endereço único para esse nome. Tente outro nome.'
export const CHURCH_CREATE_DENIED = 'Esta conta não pode cadastrar igreja: a política exige que o criador seja você e que a igreja entre como pendente.'
export const CHURCH_CREATE_NOT_READABLE = 'A igreja foi cadastrada, mas não voltou na leitura. Atualize o painel.'

/** Projeção devolvida a quem acabou de criar: o suficiente para a tela confirmar. */
export const CREATED_COLUMNS = [
  'id',
  'name',
  'slug',
  'city',
  'state',
  'status',
  'approval_status',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof Church)[]

/** Slug base + sufixos de desempate, na ordem de tentativa. */
export function churchSlugCandidates(name: string): string[] {
  const base = slugify(name)
  if (!base) return []
  return [base, ...Array.from({ length: 9 }, (_, i) => `${base}-${i + 2}`)]
}

function cleanText(value?: string): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed || null
}

export async function createChurch(draft: ChurchDraft, creator?: ChurchCreator): Promise<ChurchCreateResult> {
  if (!creator?.id) return { ok: false, error: CHURCH_CREATE_NO_ACTOR }
  const name = draft.name.trim()
  if (name.length < 3) return { ok: false, error: CHURCH_CREATE_INVALID_NAME }
  const candidates = churchSlugCandidates(name)
  if (candidates.length === 0) return { ok: false, error: CHURCH_CREATE_INVALID_NAME }

  const fields = {
    name,
    city: cleanText(draft.city),
    state: cleanText(draft.state),
    denomination: cleanText(draft.denomination),
    email: cleanText(draft.email),
    phone: cleanText(draft.phone),
    whatsapp: cleanText(draft.whatsapp),
    website: cleanText(draft.website),
  }

  for (const slug of candidates) {
    // Sem `.select()` aqui de propósito: o `return=representation` faz o Postgres
    // avaliar o RETURNING antes do trigger 0006 criar o vínculo, e a linha nova
    // ainda não passa em `churches_public_read` — o banco responde 42501 mesmo com
    // o insert correto. Insere e relê em seguida, já com o vínculo ativo.
    const { error } = await supabase
      .from('churches')
      .insert({ ...fields, slug, created_by: creator.id, status: 'active', approval_status: 'pending' })
    // 23505 = slug duplicado: tenta o próximo sufixo. Qualquer outro erro para.
    if (error && error.code !== '23505') return { ok: false, error: describeChurchCreateError(error) }
    if (error) continue

    const { data } = await supabase
      .from('churches')
      .select(CREATED_COLUMNS.join(','))
      .eq('slug', slug)
      .maybeSingle()
    if (!data) return { ok: false, error: CHURCH_CREATE_NOT_READABLE }
    return { ok: true, church: data as unknown as Church }
  }
  return { ok: false, error: CHURCH_CREATE_SLUG_TAKEN }
}

function describeChurchCreateError(error: { code?: string; message: string }): string {
  if (error.code === '42501') {
    // A frase da tela é fixa; o texto real do Postgres fica só no console.
    console.warn('[churchService] cadastro de igreja recusado pelo banco:', error.message)
    return CHURCH_CREATE_DENIED
  }
  return error.message
}

function sortByName<T extends { name: string }>(rows: T[]) {
  return sortByKey(rows, (r) => r.name)
}

function sortByKey<T>(rows: T[], key: (row: T) => string) {
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
}
