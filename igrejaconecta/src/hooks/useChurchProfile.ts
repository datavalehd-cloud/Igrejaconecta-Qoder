import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchChurchProfile } from '@/services/data/churchProfileService'
import type { Church } from '@/types'

/**
 * O cadastro da igreja da sessão sobre a base keyed-result: trocar de igreja
 * descarta a leitura anterior (a tela edita a linha que leu, e editar a igreja
 * errada é exatamente o que não pode acontecer).
 *
 * `church === null` com `loading === false` e sem erro é estado normal: a sessão
 * não tem igreja ativa, ou a linha não está ao alcance de quem consulta.
 */
export function useChurchProfile() {
  const { churchId } = usePermissions()
  const fetcher = useCallback(async () => {
    const row = await fetchChurchProfile(churchId)
    return row ? [row] : []
  }, [churchId])
  const { rows, loading, error, reload } = useKeyedList<Church>(
    Boolean(churchId),
    churchId ?? '',
    fetcher,
    'Não foi possível carregar o cadastro da igreja.',
  )
  return { church: rows[0] ?? null, loading, error, reload }
}
