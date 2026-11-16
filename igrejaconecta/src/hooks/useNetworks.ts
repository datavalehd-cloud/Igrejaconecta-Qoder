import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchNetworkChurches, fetchNetworks } from '@/services/data/networkService'
import type { ChurchNetwork, NetworkChurch } from '@/types'

/**
 * Redes de igrejas (0017) no painel do SuperAdmin. O keyed list leva o papel na
 * chave: trocar de conta descarta a leitura anterior. O serviço já não dispara
 * consulta para quem não é SuperAdmin — o `enabled` é a mesma régua na tela.
 */
export function useNetworks() {
  const { role } = usePermissions()
  const enabled = role === 'superadmin'
  const fetcher = useCallback(() => fetchNetworks({ role }), [role])
  return useKeyedList<ChurchNetwork>(enabled, `networks|${role ?? ''}`, fetcher, 'Não foi possível carregar as redes de igrejas.')
}

/** Igrejas de uma rede (vínculos `church_network_churches` com a igreja embutida). */
export function useNetworkChurches(networkId: string | null) {
  const { role } = usePermissions()
  const enabled = Boolean(networkId) && role === 'superadmin'
  const fetcher = useCallback(
    () => (networkId ? fetchNetworkChurches(networkId, { role }) : Promise.resolve([])),
    [networkId, role],
  )
  return useKeyedList<NetworkChurch>(enabled, networkId ?? '', fetcher, 'Não foi possível carregar as igrejas da rede.')
}
