import { useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchChurchRegistrations, fetchMyRegistrations, fetchRegistrationStats } from '@/services/data/registrationService'
import type { Registration, RegistrationStats } from '@/types'

/**
 * Leituras de inscrições sobre a mesma base keyed-result das demais: trocar de
 * igreja ou de conta descarta a leitura anterior em vez de reaproveitá-la.
 */

/**
 * Lista da equipe (nomes, e-mails e códigos). A porta é `registrations.manage`
 * na RLS; `allowed` existe para a tela dizer "o seu papel não gerencia
 * inscrições" em vez de fingir que a lista está vazia.
 */
export function useChurchRegistrations() {
  const { churchId, role, can } = usePermissions()
  const allowed = can('registrations.manage')
  const fetcher = useCallback(() => fetchChurchRegistrations(churchId, role), [churchId, role])
  return {
    ...useKeyedList(allowed && Boolean(churchId), churchId ?? '', fetcher, 'Não foi possível carregar as inscrições.'),
    allowed,
  }
}

/**
 * Inscrições da própria conta — o "Minhas inscrições" de `/visitante/perfil`. O
 * recorte é o id da sessão, e é por isso que quem se inscreveu sem entrar não vê
 * nada aqui: a linha não tem dono provado.
 */
export function useMyRegistrations() {
  const { session } = useAuth()
  const userId = session?.profile.id
  const fetcher = useCallback(() => fetchMyRegistrations(userId), [userId])
  return useKeyedList<Registration>(Boolean(userId), userId ?? '', fetcher, 'Não foi possível carregar as suas inscrições.')
}

/**
 * Contagens por evento. Vale para o visitante também: a view devolve só
 * agregados e a própria audiência decide o que ele enxerga (eventos no ar para
 * anon, os da própria igreja para membro, tudo para SuperAdmin).
 */
export function useRegistrationStats() {
  const fetcher = useCallback(() => fetchRegistrationStats(), [])
  const result = useKeyedList(true, 'registration-stats', fetcher, 'Não foi possível carregar as contagens de inscritos.')
  const byEvent = useMemo(
    () => new Map<string, RegistrationStats>(result.rows.map((stat) => [stat.event_id, stat])),
    [result.rows],
  )
  return { ...result, byEvent }
}
