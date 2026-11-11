import { useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchDirectoryChurches, fetchManagedChurches, fetchMapChurches, fetchMyChurches } from '@/services/data/churchService'

/**
 * As três listas de igrejas sobre a mesma base keyed-result: trocar de conta ou de
 * igreja descarta a leitura anterior em vez de reaproveitá-la.
 */

/** Diretório público — também para visitante, por isso não liga na sessão. */
export function useDirectoryChurches() {
  const fetcher = useCallback(() => fetchDirectoryChurches(), [])
  return useKeyedList(true, 'directory', fetcher, 'Não foi possível carregar as igrejas.')
}

/** Igrejas do mapa público (Fase 4): diretório + coordenadas, mesma audiência. */
export function useMapChurches() {
  const fetcher = useCallback(() => fetchMapChurches(), [])
  return useKeyedList(true, 'map', fetcher, 'Não foi possível carregar as igrejas.')
}

/** Fila de gestão da plataforma: só o SuperAdmin recebe mais que a própria igreja. */
export function useManagedChurches() {
  const { isSuperAdmin } = usePermissions()
  const fetcher = useCallback(() => fetchManagedChurches(), [])
  return useKeyedList(isSuperAdmin, 'managed', fetcher, 'Não foi possível carregar as igrejas.')
}

/** Igrejas associadas à conta, com o papel em cada uma. */
export function useMyChurches() {
  const { session } = useAuth()
  const userId = session?.profile.id
  const fetcher = useCallback(() => fetchMyChurches(userId), [userId])
  return useKeyedList(Boolean(userId), userId ?? '', fetcher, 'Não foi possível carregar suas igrejas.')
}
