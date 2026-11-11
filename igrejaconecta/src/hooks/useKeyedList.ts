import { useCallback, useEffect, useState } from 'react'

interface ListResult<T> {
  identity: string
  rows: T[]
  error: string | null
}

/**
 * Lista keyed-result: enquanto o resultado carregado não pertence à chave atual,
 * `rows` vem vazio. Assim trocar de igreja, papel ou conta descarta a leitura
 * anterior sem setState síncrono dentro do effect (o que o banco respondeu antes
 * não pode aparecer como se fosse a resposta nova).
 */
export function useKeyedList<T>(enabled: boolean, identity: string, fetcher: () => Promise<T[]>, fallbackError: string) {
  const [result, setResult] = useState<ListResult<T> | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${identity}|${tick}`
  const fresh = result !== null && result.identity === key

  useEffect(() => {
    if (!enabled) return
    let alive = true
    fetcher()
      .then((rows) => {
        if (alive) setResult({ identity: key, rows, error: null })
      })
      .catch((err: unknown) => {
        if (alive) setResult({ identity: key, rows: [], error: err instanceof Error ? err.message : fallbackError })
      })
    return () => {
      alive = false
    }
  }, [enabled, key, fetcher, fallbackError])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return {
    rows: fresh ? result.rows : [],
    loading: enabled && !fresh,
    error: fresh ? result.error : null,
    reload,
  }
}
