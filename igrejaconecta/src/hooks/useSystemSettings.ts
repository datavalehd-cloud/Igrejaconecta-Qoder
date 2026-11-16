import { useCallback } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import {
  fetchSystemSettings,
  PLATFORM_SETTING_KEY,
  PRIVACY_SETTING_KEY,
  type SystemSettingRow,
} from '@/services/data/settingsService'

/**
 * Mesa `system_settings` (0001/0002). Só SuperAdmin chega aqui — a rota já é
 * `requireSuperAdmin` e o serviço nem dispara consulta para outro papel, porque
 * a política de leitura é `is_superadmin()` pura. A chave do keyed list leva o
 * papel: trocar de conta descarta a leitura anterior.
 */
export function useSystemSettings() {
  const { role } = usePermissions()
  const enabled = role === 'superadmin'
  const fetcher = useCallback(() => fetchSystemSettings(role), [role])
  const { rows, loading, error, reload } = useKeyedList<SystemSettingRow>(
    enabled,
    `settings|${role ?? ''}`,
    fetcher,
    'Não foi possível ler as configurações do sistema.',
  )
  const platform = rows.find((row) => row.key === PLATFORM_SETTING_KEY)
  const privacy = rows.find((row) => row.key === PRIVACY_SETTING_KEY)
  return { platform, privacy, loading, error, reload }
}
