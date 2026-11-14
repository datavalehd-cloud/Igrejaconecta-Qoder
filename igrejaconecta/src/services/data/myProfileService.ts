import { supabase } from '@/services/supabase/client'
import type { Profile } from '@/types'

/**
 * Perfil pessoal (`profiles`, 0001) para `/app/perfil`. A tela já mostrava os
 * dados da sessão e avisava que editar não gravava; aqui o nome e o telefone
 * passam a ser gravados de fato.
 *
 * A política que ampara isto é `profiles_self_update` (0002): `using (id = auth.uid())
 * with check (id = auth.uid())` — ninguém escreve no perfil de outra conta, e o
 * SuperAdmin **não** tem exceção aqui (a 0002 só dá a ele a leitura). Por isso o
 * único recorte deste serviço é `.eq('id', actor.userId)` com o id da própria
 * sessão: não há parâmetro de "outro usuário" para errar.
 *
 * Duas colunas ficam de fora de propósito:
 * - `email` é o login, e a fonte da verdade é `auth.users`. Escrever só na cópia
 *   de `profiles` deixaria a tela dizendo um e-mail com o qual ninguém entra;
 *   mudar e-mail é o fluxo de confirmação do Supabase, não um update aqui.
 * - `avatar_url` é arquivo: enquanto não houver upload no Storage (passo M4), a
 *   tela não oferece campo de imagem.
 */

export const MY_PROFILE_COLUMNS = [
  'id',
  'full_name',
  'email',
  'phone',
  'avatar_url',
] as const satisfies readonly (keyof Profile)[]

/** O que o formulário tem autorização para mandar. */
export const MY_PROFILE_EDITABLE_COLUMNS = ['full_name', 'phone'] as const satisfies readonly (keyof Profile)[]

/** O que nunca sai daqui, mesmo por engano. */
export const MY_PROFILE_LOCKED_COLUMNS = [
  'id',
  'email',
  'avatar_url',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof Profile)[]

const MY_PROFILE_SELECT = MY_PROFILE_COLUMNS.join(',')

export const MY_PROFILE_NO_ACTOR = 'Entre na sua conta para editar o seu perfil.'
export const MY_PROFILE_NAME_REQUIRED = 'Informe o seu nome: é assim que você aparece para a sua igreja.'
export const MY_PROFILE_NOT_FOUND = 'Não foi possível gravar o seu perfil. Atualize a tela e tente de novo.'

export interface MyProfileActor {
  userId?: string
}

export interface MyProfileDraft {
  full_name: string
  phone: string
}

export type MyProfileResult =
  | { ok: true; profile: Profile; error?: never }
  | { ok: false; error: string; profile?: never }

export function validateMyProfile(draft: MyProfileDraft): string | null {
  return draft.full_name.trim() ? null : MY_PROFILE_NAME_REQUIRED
}

/** Patch literal de novo: só as duas colunas editáveis, e `updated_at` é trigger (0001). */
export function buildMyProfilePatch(draft: MyProfileDraft): Record<string, string | null> {
  const phone = draft.phone.trim()
  return { full_name: draft.full_name.trim(), phone: phone || null }
}

export async function updateMyProfile(draft: MyProfileDraft, actor: MyProfileActor): Promise<MyProfileResult> {
  if (!actor.userId) return { ok: false, error: MY_PROFILE_NO_ACTOR }
  const invalid = validateMyProfile(draft)
  if (invalid) return { ok: false, error: invalid }

  const { data, error } = await supabase
    .from('profiles')
    .update(buildMyProfilePatch(draft))
    .eq('id', actor.userId)
    .select(MY_PROFILE_SELECT)
    .maybeSingle()
  if (error) return { ok: false, error: describeMyProfileDbError(error) }
  if (!data) return { ok: false, error: MY_PROFILE_NOT_FOUND }
  return { ok: true, profile: data as unknown as Profile }
}

function describeMyProfileDbError(error: { code?: string; message: string }): string {
  if (error.code === '42501') return MY_PROFILE_NOT_FOUND
  return error.message
}
