import { supabase } from '@/services/supabase/client'
import type { VisitorInterest, VisitorPreferences } from '@/types'

/**
 * Preferências do visitante (`visitor_preferences`, 0016): a cidade que ele procura
 * e os interesses que lhe interessam. Era o botão "Salvar preferências" de
 * `useState` — o clique mudava uma bandeirinha na tela e não escrevia em lugar
 * nenhum.
 *
 * Uma linha por conta, e o recorte é sempre `.eq('user_id', ...)` da própria
 * sessão: `visitor_preferences_self_read/_write/_update` (0016) têm `user_id =
 * auth.uid()` em USING e WITH CHECK, então não existe caminho para a preferência de
 * outra pessoa.
 *
 * A escrita é `upsert` porque a tabela tem as duas portas abertas (insert e update,
 * sem delete) e a chave é a própria conta: um único round trip, sem "existe? então
 * update" competindo consigo mesmo. O patch é literal e só leva as colunas do
 * formulário — `updated_at` é trigger (0016).
 */

export const VISITOR_PREFERENCE_COLUMNS = ['user_id', 'city', 'interests', 'updated_at'] as const satisfies readonly (keyof VisitorPreferences)[]

const VISITOR_PREFERENCE_SELECT = VISITOR_PREFERENCE_COLUMNS.join(',')

/** O que sai no patch. `user_id` vem da sessão, nunca do formulário. */
export const VISITOR_PREFERENCE_PATCH_COLUMNS = ['user_id', 'city', 'interests'] as const

/** O mesmo conjunto do CHECK `interests <@ array[...]` da 0016, na mesma ordem. */
export const VISITOR_INTERESTS = ['jovens', 'familia', 'mulheres', 'homens', 'acao_social'] as const satisfies readonly VisitorInterest[]

/** O CHECK de `city` da 0016: `char_length(btrim(city)) <= 80`. */
export const VISITOR_CITY_MAX = 80

export const VISITOR_PREFERENCE_LOGIN_REQUIRED = 'Entre na sua conta para salvar suas preferências: sem conta não há com quem ficar.'
export const VISITOR_PREFERENCE_NOT_SAVED = 'Não foi possível gravar as suas preferências. Atualize a tela e tente de novo.'
export const VISITOR_INTEREST_UNSUPPORTED = 'Interesse fora da lista: o banco aceita jovens, família/casais, mulheres, homens e ação social.'
export const VISITOR_CITY_TOO_LONG = `A cidade tem no máximo ${VISITOR_CITY_MAX} caracteres.`

export interface VisitorPreferenceDraft {
  city: string
  interests: VisitorInterest[]
}

export interface VisitorPreferenceActor {
  userId?: string
}

export type VisitorPreferenceResult =
  | { ok: true; preferences: VisitorPreferences; error?: never }
  | { ok: false; error: string; preferences?: never }

/** A linha da conta, ou `null` para quem nunca salvou — estado normal, não erro. */
export async function fetchVisitorPreferences(userId?: string): Promise<VisitorPreferences | null> {
  if (!userId) return null
  const { data, error } = await supabase
    .from('visitor_preferences')
    .select(VISITOR_PREFERENCE_SELECT)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as VisitorPreferences | null
}

export function validateVisitorPreference(draft: VisitorPreferenceDraft): string | null {
  if (draft.city.trim().length > VISITOR_CITY_MAX) return VISITOR_CITY_TOO_LONG
  if (draft.interests.some((interest) => !isVisitorInterest(interest))) return VISITOR_INTEREST_UNSUPPORTED
  return null
}

/** Lista de interesse sem repetição e na ordem do CHECK: o banco guarda o array. */
export function normalizeInterests(interests: readonly VisitorInterest[]): VisitorInterest[] {
  return VISITOR_INTERESTS.filter((interest) => interests.includes(interest))
}

/** O patch literal: as três colunas do formulário, com a cidade aparada e vazia virando `null`. */
export function buildVisitorPreferencePatch(
  draft: VisitorPreferenceDraft,
  userId: string,
): { user_id: string; city: string | null; interests: VisitorInterest[] } {
  const city = draft.city.trim()
  return { user_id: userId, city: city || null, interests: normalizeInterests(draft.interests) }
}

export async function saveVisitorPreferences(
  draft: VisitorPreferenceDraft,
  actor: VisitorPreferenceActor,
): Promise<VisitorPreferenceResult> {
  const userId = actor.userId
  if (!userId) return { ok: false, error: VISITOR_PREFERENCE_LOGIN_REQUIRED }
  const invalid = validateVisitorPreference(draft)
  if (invalid) return { ok: false, error: invalid }

  const { data, error } = await supabase
    .from('visitor_preferences')
    .upsert(buildVisitorPreferencePatch(draft, userId), { onConflict: 'user_id' })
    .select(VISITOR_PREFERENCE_SELECT)
    .maybeSingle()
  if (error) return { ok: false, error: describePreferenceDbError(error) }
  if (!data) return { ok: false, error: VISITOR_PREFERENCE_NOT_SAVED }
  return { ok: true, preferences: data as unknown as VisitorPreferences }
}

function isVisitorInterest(interest: string): interest is VisitorInterest {
  return (VISITOR_INTERESTS as readonly string[]).includes(interest)
}

function describePreferenceDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return VISITOR_PREFERENCE_LOGIN_REQUIRED
    case '23514':
      return `${VISITOR_INTEREST_UNSUPPORTED} A cidade vai até ${VISITOR_CITY_MAX} caracteres.`
    default:
      return error.message
  }
}
