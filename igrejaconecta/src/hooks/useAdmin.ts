import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchAllEvents } from '@/services/data/eventService'
import { fetchPlatformUsers } from '@/services/data/adminService'
import { fetchChurchCampaigns } from '@/services/data/marketingService'

/**
 * Leituras globais do SuperAdmin (Fase 8), sobre a mesma base keyed-result das
 * outras listas: trocar de conta descarta a leitura anterior em vez de reaproveitá-la.
 *
 * Todas ligam **apenas** para SuperAdmin (`enabled = isSuperAdmin`). É a primeira
 * camada de defesa; a segunda é o serviço, que devolve `[]` para quem não é
 * `superadmin` antes de qualquer consulta; a terceira é a política no banco. Nenhum
 * papel de igreja recebe dados transversais por estas leituras.
 */

/** Eventos de todas as igrejas, em qualquer status (rascunho inclusive). */
export function useAdminEvents() {
  const { role, isSuperAdmin } = usePermissions()
  const fetcher = useCallback(() => fetchAllEvents(role), [role])
  return useKeyedList(isSuperAdmin, 'admin-events', fetcher, 'Não foi possível carregar os eventos.')
}

/** Diretório global de vínculos: uma linha por membership, com papel e igreja. */
export function usePlatformUsers() {
  const { role, isSuperAdmin } = usePermissions()
  const fetcher = useCallback(() => fetchPlatformUsers(role), [role])
  return useKeyedList(isSuperAdmin, 'platform-users', fetcher, 'Não foi possível carregar os usuários.')
}

/** Campanhas de todas as igrejas (o modo transversal já existe no marketingService). */
export function useAdminCampaigns() {
  const { role, isSuperAdmin } = usePermissions()
  const fetcher = useCallback(() => fetchChurchCampaigns(undefined, { role }), [role])
  return useKeyedList(isSuperAdmin, 'admin-campaigns', fetcher, 'Não foi possível carregar as campanhas.')
}
