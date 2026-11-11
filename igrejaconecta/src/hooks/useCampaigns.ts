import { useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchChurchCampaigns } from '@/services/data/marketingService'

/**
 * Campanhas da igreja da sessão sobre a base keyed-result: trocar de igreja, de papel
 * ou de conta descarta a leitura anterior. A rota /app/marketing já exige
 * `marketing.manage`; aqui a política `marketing_campaigns_read` é o limite real (o
 * SuperAdmin atravessa). O `userId` vai junto para o espelho demo aplicar a mesma
 * régua de vínculo ativo que o banco aplica — convidado não lê campanha (caso P3).
 */
export function useChurchCampaigns() {
  const { session } = useAuth()
  const { churchId, role } = usePermissions()
  const userId = session?.profile.id
  const fetcher = useCallback(
    () => fetchChurchCampaigns(churchId, { churchId, role, userId }),
    [churchId, role, userId],
  )
  return useKeyedList(true, churchId ?? `role:${role ?? 'none'}`, fetcher, 'Não foi possível carregar as campanhas.')
}
