import { useCallback, useEffect, useState } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { fetchRoster } from '@/services/data/rosterService'
import type { RosterEntry } from '@/types'

interface RosterResult {
  key: string
  rows: RosterEntry[]
  error: string | null
}

/**
 * Roster da igreja da sessão. Em modo real, o que a RLS devolver é o que aparece.
 * `loading`/`rows` são derivados do resultado já carregado, então trocar de igreja
 * ou de papel descarta a leitura anterior sem setState síncrono dentro do effect.
 */
export function useRoster() {
  const { churchId, role } = usePermissions()
  const [result, setResult] = useState<RosterResult | null>(null)
  const [tick, setTick] = useState(0)

  const key = `${churchId ?? ''}|${role ?? ''}|${tick}`
  const fresh = result !== null && result.key === key

  useEffect(() => {
    if (!churchId) return
    let alive = true
    fetchRoster(churchId, role)
      .then((rows) => {
        if (alive) setResult({ key, rows, error: null })
      })
      .catch((err: unknown) => {
        if (alive) setResult({ key, rows: [], error: err instanceof Error ? err.message : 'Não foi possível carregar os membros.' })
      })
    return () => {
      alive = false
    }
  }, [key, churchId, role])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return {
    rows: fresh ? result.rows : [],
    loading: Boolean(churchId) && !fresh,
    error: fresh ? result.error : null,
    reload,
  }
}
