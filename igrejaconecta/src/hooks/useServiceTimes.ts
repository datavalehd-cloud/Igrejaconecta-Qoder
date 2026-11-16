import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchChurchServiceTimes, fetchPublicServiceTimes } from '@/services/data/serviceTimeService'
import type { ChurchServiceTime } from '@/types'

/**
 * Horários de culto da igreja da sessão (0023). Qualquer membro ativo lê (a
 * política `church_service_times_read` é o limite); SuperAdmin lê todos, com ou
 * sem igreja selecionada. Trocar de igreja ou de conta descarta a leitura
 * anterior — a chave do keyed list leva as duas identidades.
 */
export function useChurchServiceTimes() {
  const { churchId, role } = usePermissions()
  const enabled = Boolean(churchId) || role === 'superadmin'
  const fetcher = useCallback(
    () => fetchChurchServiceTimes(churchId, { churchId, role }),
    [churchId, role],
  )
  return useKeyedList(enabled, `${churchId ?? ''}|${role ?? ''}`, fetcher, 'Não foi possível carregar os horários.')
}

/**
 * Vitrine: os horários que o banco deixa o visitante ver (igreja aprovada e
 * ativa). A página agrupa por igreja — o recorte é da política, não do hook.
 */
export function usePublicServiceTimes() {
  const fetcher = useCallback(() => fetchPublicServiceTimes(), [])
  const { rows, loading, error } = useKeyedList(true, 'service-times-public', fetcher, 'Não foi possível carregar os horários públicos.')
  const byChurch = new Map<string, ChurchServiceTime[]>()
  for (const time of rows) {
    const list = byChurch.get(time.church_id)
    if (list) list.push(time)
    else byChurch.set(time.church_id, [time])
  }
  return { byChurch, loading, error }
}
