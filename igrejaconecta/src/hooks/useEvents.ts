import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import {
  fetchChurchEvents,
  fetchEventCategories,
  fetchPublicEventBySlug,
  fetchPublicEvents,
} from '@/services/data/eventService'

/**
 * As quatro leituras de eventos sobre a mesma base keyed-result: trocar de igreja,
 * de slug ou de conta descarta a leitura anterior em vez de reaproveitá-la.
 */

/** Diretório público — também para visitante, por isso não liga na sessão. */
export function usePublicEvents() {
  const fetcher = useCallback(() => fetchPublicEvents(), [])
  return useKeyedList(true, 'public-events', fetcher, 'Não foi possível carregar os eventos.')
}

/** Um evento pelo slug (página pública). A base é lista, então `rows[0]` é o evento. */
export function usePublicEvent(slug?: string) {
  const fetcher = useCallback(async () => {
    const event = await fetchPublicEventBySlug(slug ?? '')
    return event === null ? [] : [event]
  }, [slug])
  const { rows, loading, error } = useKeyedList(Boolean(slug), slug ?? '', fetcher, 'Não foi possível carregar o evento.')
  return { event: rows[0] ?? null, loading, error }
}

/**
 * Agenda da igreja da sessão, em qualquer status. Qualquer membro lê (a política
 * `events_church_read` é o limite); as telas de escrita é que ficam atrás de
 * `events.manage`. SuperAdmin não tem igreja ativa na sessão: lista vazia.
 */
export function useChurchEvents() {
  const { churchId } = usePermissions()
  const fetcher = useCallback(() => fetchChurchEvents(churchId), [churchId])
  return useKeyedList(Boolean(churchId), churchId ?? '', fetcher, 'Não foi possível carregar os eventos da sua igreja.')
}

/** Catálogo de categorias: leitura pública, como o diretório. */
export function useEventCategories() {
  const fetcher = useCallback(() => fetchEventCategories(), [])
  return useKeyedList(true, 'event-categories', fetcher, 'Não foi possível carregar as categorias.')
}
