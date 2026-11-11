import { useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { listInvitations, pendingInvitationsForMe } from '@/services/data/memberService'
import type { ChurchInvitation } from '@/types'

/** Convites pendentes da igreja da sessão — só para quem gerencia membros. */
export function useInvitations() {
  const { churchId, role, can } = usePermissions()
  const canManage = can('members.manage')
  const fetcher = useCallback(
    () => (churchId ? listInvitations(churchId, role) : Promise.resolve([] as ChurchInvitation[])),
    [churchId, role],
  )
  return useKeyedList(canManage && Boolean(churchId), `${churchId ?? ''}|${role ?? ''}`, fetcher, 'Não foi possível carregar os convites.')
}

/** Convites endereçados ao e-mail desta conta, em qualquer igreja. */
export function useMyInvitations() {
  const { session } = useAuth()
  const email = session?.profile.email
  const fetcher = useCallback(() => pendingInvitationsForMe(email), [email])
  return useKeyedList(Boolean(email), email ?? '', fetcher, 'Não foi possível carregar seus convites.')
}
