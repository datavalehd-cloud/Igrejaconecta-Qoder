import { supabase } from '@/services/supabase/client'
import type { VisitorFavorite } from '@/types'

/**
 * Favoritos do visitante (`visitor_favorites`, 0016). Antes o coração da página de
 * evento era um `useState` e "Meus favoritos" listava os dois primeiros eventos
 * publicados — favorito nenhum era de ninguém.
 *
 * A chave de acesso é `user_id = auth.uid()` nas três operações, e é assim nos dos
 * lados: `visitor_favorites_self` (0016) tem a mesma expressão em USING e em WITH
 * CHECK, e este serviço só sabe consultar a linha da própria sessão. Não existe
 * parâmetro de "outra conta" para errar, e sem sessão nenhuma consulta sai — o que
 * a tela mostra é "entre para salvar", não uma lista vazia fingida de vazia.
 *
 * A tabela não tem UPDATE (o grant é select/insert/delete, medido em R5): a lista
 * muda adicionando e removendo o par (conta, evento). Por isso o delete é pelos
 * dois campos e a chave primária composta dispensa o costumeiro `.eq('id')`.
 */

export const VISITOR_FAVORITE_COLUMNS = ['user_id', 'event_id', 'created_at'] as const satisfies readonly (keyof VisitorFavorite)[]

/** O insert literal: só as duas colunas que o visitante tem o direito de mandar. */
export const VISITOR_FAVORITE_INSERT_COLUMNS = ['user_id', 'event_id'] as const

const VISITOR_FAVORITE_SELECT = VISITOR_FAVORITE_COLUMNS.join(',')

export const VISITOR_LOGIN_REQUIRED = 'Entre na sua conta para salvar favoritos: sem conta não há lista sua.'
export const VISITOR_NOT_FAVORITE = 'Esse evento não está na sua lista de favoritos (ou já saiu dela).'
export const VISITOR_ALREADY_FAVORITE = 'Este evento já está nos seus favoritos.'

export type VisitorFavoriteResult =
  | { ok: true; favorite: VisitorFavorite; error?: never }
  | { ok: false; error: string; favorite?: never }

/** A lista da conta, do mais recente ao mais antigo. Sem sessão, não sai consulta. */
export async function fetchVisitorFavorites(userId?: string): Promise<VisitorFavorite[]> {
  if (!userId) return []
  const { data, error } = await supabase
    .from('visitor_favorites')
    .select(VISITOR_FAVORITE_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as VisitorFavorite[]
}

/**
 * `23505` aqui não é falha de permissão nem linha fantasma: a PK é o par (conta,
 * evento), e apertar duas vezes o mesmo botão é caminho normal. A frase diz o que
 * está de pé — o evento já está na lista — e a tela relê em vez de deduplicar
 * sozinha.
 */
export async function addVisitorFavorite(eventId: string, userId?: string): Promise<VisitorFavoriteResult> {
  if (!userId) return { ok: false, error: VISITOR_LOGIN_REQUIRED }

  const { data, error } = await supabase
    .from('visitor_favorites')
    .insert({ user_id: userId, event_id: eventId })
    .select(VISITOR_FAVORITE_SELECT)
    .maybeSingle()
  if (error) return { ok: false, error: describeFavoriteDbError(error) }
  if (!data) return { ok: false, error: VISITOR_NOT_FAVORITE }
  return { ok: true, favorite: data as unknown as VisitorFavorite }
}

export async function removeVisitorFavorite(eventId: string, userId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: VISITOR_LOGIN_REQUIRED }

  const { data, error } = await supabase
    .from('visitor_favorites')
    .delete()
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .select('event_id')
  if (error) return { ok: false, error: describeFavoriteDbError(error) }
  // Linha que não volta é a mesma frase de "não estava na lista": a policy USING
  // também devolve zero linhas para uma linha de outra conta, e não se entrega
  // aqui um oráculo do que existe.
  if (!data || data.length === 0) return { ok: false, error: VISITOR_NOT_FAVORITE }
  return { ok: true }
}

function describeFavoriteDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return VISITOR_LOGIN_REQUIRED
    case '23505':
      return VISITOR_ALREADY_FAVORITE
    case '23503':
      return 'Não foi possível salvar o favorito: o evento não está mais disponível.'
    default:
      return error.message
  }
}
