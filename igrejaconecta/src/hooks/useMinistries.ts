import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchMinistries } from '@/services/data/ministryService'

/**
 * Ministérios da igreja da sessão sobre a base keyed-result: trocar de igreja ou
 * de conta descarta a leitura anterior. A leitura é de membro **ativo** (a view
 * `ministry_list` usa `current_church_ids()`, que só conta vínculo ativo); o
 * SuperAdmin alcança todos. Escrever é outra régua: `members.manage`.
 */
export function useMinistries() {
  const { churchId, role } = usePermissions()
  const fetcher = useCallback(() => fetchMinistries(churchId, { churchId, role }), [churchId, role])
  return useKeyedList(Boolean(churchId), churchId ?? '', fetcher, 'Não foi possível carregar os ministérios.')
}
