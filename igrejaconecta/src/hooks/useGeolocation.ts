import { useCallback, useState } from 'react'
import type { LatLng } from '@/utils/geo'

/**
 * GPS do navegador (Fase 4), sem provedor externo: `navigator.geolocation` é a
 * única fonte. O estado reflete o que o navegador confirmou — `coords` só é
 * preenchido em `granted`, nunca antes e nunca inventado. Quem nega ou não tem
 * o recurso recebe `denied`/`unavailable` com um motivo em português, e a tela
 * oferece a digitação manual como saída (decisão "Só GPS + digitação").
 */
export type GeoStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'

export interface Geolocation {
  status: GeoStatus
  coords: LatLng | null
  error: string | null
  locate: () => void
  reset: () => void
}

export function useGeolocation(): Geolocation {
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [coords, setCoords] = useState<LatLng | null>(null)
  const [error, setError] = useState<string | null>(null)

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setCoords(null)
      setStatus('unavailable')
      setError('Este navegador não oferece geolocalização. Digite as coordenadas.')
      return
    }
    setStatus('requesting')
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude })
        setStatus('granted')
      },
      (failure) => {
        setCoords(null)
        if (failure.code === failure.PERMISSION_DENIED) {
          setStatus('denied')
          setError('Permissão de localização negada. Libere o acesso no navegador ou digite as coordenadas.')
        } else {
          setStatus('unavailable')
          setError('Não foi possível obter a localização agora. Tente de novo ou digite as coordenadas.')
        }
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setCoords(null)
    setError(null)
  }, [])

  return { status, coords, error, locate, reset }
}
