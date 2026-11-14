import { supabase } from '@/services/supabase/client'
import { validateLatLng } from '@/utils/geo'
import { can } from '@/utils/rbac'
import type { Church, RoleKey } from '@/types'

/**
 * Perfil institucional da igreja (`churches`, 0001) para a tela `/app/igreja`.
 *
 * A tela existia sobre `@/data/mock` e com campos que não têm coluna no banco
 * (CNPJ, "responsável") — eles saíram em vez de serem inventados. O que se grava
 * aqui é o que a tabela tem.
 *
 * A fronteira que não pode afrouxar: **`slug`, `status`, `approval_status` e
 * `created_by` nunca saem deste serviço**. RLS em Postgres é por linha, não por
 * coluna, então `churches_update` (0002) deixaria um `church_admin` escrever
 * qualquer coluna da própria igreja — inclusive se autoaprovar (foi por isso que a
 * 0004 criou `enforce_church_approval_status`) e mudar o endereço público. O
 * recorte abaixo é a camada do app: o patch é montado coluna por coluna, então não
 * existe caminho por onde uma dessas colunas entrar por descuido.
 */

/**
 * O que a tela lê. Dois grupos ficam de fora:
 * - `created_by`: nenhum formulário precisa do uuid de quem cadastrou a igreja;
 * - `logo_url`/`cover_url`: existem na tabela, mas **nenhuma tela do app mostra**
 *   a logo ou a capa da igreja — enquanto não houver upload e exibição no Storage
 *   (passo M4), oferecer o campo seria gravar algo que ninguém renderiza.
 */
export const CHURCH_PROFILE_COLUMNS = [
  'id',
  'name',
  'slug',
  'description',
  'denomination',
  'email',
  'phone',
  'whatsapp',
  'website',
  'address',
  'city',
  'state',
  'zip',
  'lat',
  'lng',
  'status',
  'approval_status',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof Church)[]

/** O que a tela escreve. É a projeção menos as colunas travadas. */
export const CHURCH_EDITABLE_COLUMNS = [
  'name',
  'description',
  'denomination',
  'email',
  'phone',
  'whatsapp',
  'website',
  'address',
  'city',
  'state',
  'zip',
  'lat',
  'lng',
] as const satisfies readonly (keyof Church)[]

/**
 * Colunas que a tela mostra mas não manda. `slug` é o endereço público de uma
 * igreja já aprovada (e o canonical do SEO); `status` tira a igreja do portal.
 * Os dois são decisão de quem opera a plataforma, não de quem edita o cadastro.
 */
export const CHURCH_LOCKED_COLUMNS = [
  'id',
  'slug',
  'status',
  'approval_status',
  'created_by',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof Church)[]

const PROFILE_SELECT = CHURCH_PROFILE_COLUMNS.join(',')

export const CHURCH_PROFILE_MANAGE_DENIED =
  'Sem permissão para editar o cadastro da igreja: é de quem gerencia a igreja.'
export const CHURCH_PROFILE_NOT_FOUND =
  'Igreja não encontrada ou sem permissão para editá-la. Atualize a tela.'
export const CHURCH_PROFILE_NO_CHURCH =
  'A sua sessão não tem igreja ativa: o perfil institucional é de uma igreja.'
export const CHURCH_PROFILE_NAME_REQUIRED = 'O nome da igreja precisa de pelo menos 3 caracteres.'

export interface ChurchProfileActor {
  churchId?: string
  role?: RoleKey
}

/** Tudo como texto: é o que o formulário tem. O serviço converte limpando para `null`. */
export interface ChurchProfileDraft {
  name: string
  description: string
  denomination: string
  email: string
  phone: string
  whatsapp: string
  website: string
  address: string
  city: string
  state: string
  zip: string
  lat: string
  lng: string
}

export type ChurchProfileResult =
  | { ok: true; church: Church; error?: never }
  | { ok: false; error: string; church?: never }

/**
 * Uma igreja: a da sessão. Sem `.eq('id')` não há leitura de outra igreja, e a
 * política `churches_public_read` já esconde a linha de quem não é dela — linha
 * que não volta é "não encontrada", sem dizer por quê.
 */
export async function fetchChurchProfile(churchId?: string): Promise<Church | null> {
  if (!churchId) return null
  const { data, error } = await supabase
    .from('churches')
    .select(PROFILE_SELECT)
    .eq('id', churchId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as unknown as Church | null
}

/** O mesmo teto de texto do nome criado no onboarding; os demais campos são livres (a tabela não tem CHECK). */
export const CHURCH_NAME_MIN = 3

/** Latitude e longitude têm o mesmo formato: ou as duas, ou nenhuma (é a regra do `validateLatLng`). */
export function parseCoordinate(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const parsed = Number(text.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function validateChurchProfile(draft: ChurchProfileDraft): string | null {
  if (draft.name.trim().length < CHURCH_NAME_MIN) return CHURCH_PROFILE_NAME_REQUIRED
  return validateLatLng(parseCoordinate(draft.lat), parseCoordinate(draft.lng))
}

/**
 * O patch é literal, coluna por coluna: é o que impede uma chave travada de entrar
 * por um `...draft` esquecido. Campo de texto vazio vira `null` (limpar funciona),
 * coordenada em branco vira `null`.
 */
export function buildChurchPatch(draft: ChurchProfileDraft): Record<string, string | number | null> {
  return {
    name: draft.name.trim(),
    description: blankToNull(draft.description),
    denomination: blankToNull(draft.denomination),
    email: blankToNull(draft.email),
    phone: blankToNull(draft.phone),
    whatsapp: blankToNull(draft.whatsapp),
    website: blankToNull(draft.website),
    address: blankToNull(draft.address),
    city: blankToNull(draft.city),
    state: blankToNull(draft.state),
    zip: blankToNull(draft.zip),
    lat: parseCoordinate(draft.lat),
    lng: parseCoordinate(draft.lng),
  }
}

export async function updateChurchProfile(
  draft: ChurchProfileDraft,
  actor: ChurchProfileActor,
): Promise<ChurchProfileResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: CHURCH_PROFILE_NO_CHURCH }
  const invalid = validateChurchProfile(draft)
  if (invalid) return { ok: false, error: invalid }

  const { data, error } = await supabase
    .from('churches')
    .update(buildChurchPatch(draft))
    .eq('id', churchId)
    .select(PROFILE_SELECT)
    .maybeSingle()
  if (error) return { ok: false, error: describeProfileDbError(error) }
  // Sem linha: a policy USING não deixou escrever (igreja de outra conta).
  if (!data) return { ok: false, error: CHURCH_PROFILE_NOT_FOUND }
  return { ok: true, church: data as unknown as Church }
}

function gateWrite(actor: ChurchProfileActor): string | null {
  return can(actor.role, 'church.manage') ? null : CHURCH_PROFILE_MANAGE_DENIED
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed || null
}

function describeProfileDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return CHURCH_PROFILE_NOT_FOUND
    case '23514':
      return 'Algum campo está fora do permitido: a latitude vai de -90 a 90, a longitude de -180 a 180, e as duas entram juntas.'
    default:
      return error.message
  }
}
