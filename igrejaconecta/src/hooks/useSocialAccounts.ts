import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchSocialAccounts } from '@/services/data/socialAccountService'

/**
 * Perfis de rede da igreja da sessão sobre a base keyed-result: trocar de igreja
 * ou de conta descarta a leitura anterior. Ler é de membro ativo; escrever é
 * `church.manage`, uma régua mais estreita que o guard da rota — por isso a tela
 * pergunta `can('church.manage')` em vez de assumir que quem vê pode editar.
 */
export function useSocialAccounts() {
  const { churchId, role } = usePermissions()
  const fetcher = useCallback(() => fetchSocialAccounts(churchId, { churchId, role }), [churchId, role])
  return useKeyedList(Boolean(churchId), churchId ?? '', fetcher, 'Não foi possível carregar os perfis de rede.')
}
