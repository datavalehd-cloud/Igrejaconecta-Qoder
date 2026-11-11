import { useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchChurchBranches } from '@/services/data/branchService'

/**
 * Filiais da igreja da sessão sobre a base keyed-result: trocar de igreja ou de
 * conta descarta a leitura anterior. Qualquer membro **ativo** lê (a política
 * `church_branches_read` é o limite, e o vínculo `invited` não lê — caso O3); as
 * escritas é que ficam atrás de `church.manage`. O `userId` vai junto para o
 * espelho demo aplicar a mesma régua de vínculo ativo que o banco aplica.
 */
export function useChurchBranches() {
  const { session } = useAuth()
  const { churchId, role } = usePermissions()
  const userId = session?.profile.id
  const fetcher = useCallback(
    () => fetchChurchBranches(churchId, { churchId, role, userId }),
    [churchId, role, userId],
  )
  return useKeyedList(Boolean(churchId), churchId ?? '', fetcher, 'Não foi possível carregar as filiais.')
}
