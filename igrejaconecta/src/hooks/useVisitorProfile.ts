import { useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchVisitorFavorites } from '@/services/data/visitorFavoriteService'
import { fetchVisitorPreferences } from '@/services/data/visitorPreferenceService'
import type { VisitorFavorite, VisitorPreferences } from '@/types'

/**
 * As duas leituras da conta que entram em `/visitante/perfil` e no coração da
 * página de evento, sobre a mesma base keyed-result: trocar de conta descarta a
 * lista anterior (favorito de alguém não pode aparecer como sendo do visitante que
 * acabou de entrar).
 *
 * Quem decide o que é favorito e o que está no ar é a tela: aqui só sai a linha da
 * tabela. O evento desaparecido não vira linha inventada — a página conta quantos
 * ficaram para trás e diz isso.
 */

/** A lista de favoritos da sessão, com o id da conta para quem escreve. */
export function useVisitorFavorites() {
  const { session } = useAuth()
  const userId = session?.profile.id
  const fetcher = useCallback(() => fetchVisitorFavorites(userId), [userId])
  const { rows, loading, error, reload } = useKeyedList<VisitorFavorite>(
    Boolean(userId),
    userId ?? '',
    fetcher,
    'Não foi possível carregar os seus favoritos.',
  )
  const eventIds = useMemo(() => new Set(rows.map((row) => row.event_id)), [rows])
  return { userId, rows, eventIds, loading, error, reload }
}

/**
 * A preferência da conta, ou `null` quando ela nunca salvou nada — estado normal,
 * não erro. Sem sessão não sai consulta nenhuma.
 */
export function useVisitorPreferences() {
  const { session } = useAuth()
  const userId = session?.profile.id
  const fetcher = useCallback(async () => {
    const row = await fetchVisitorPreferences(userId)
    return row ? [row] : []
  }, [userId])
  const { rows, loading, error, reload } = useKeyedList<VisitorPreferences>(
    Boolean(userId),
    userId ?? '',
    fetcher,
    'Não foi possível carregar as suas preferências.',
  )
  return { userId, preferences: rows[0] ?? null, loading, error, reload }
}
