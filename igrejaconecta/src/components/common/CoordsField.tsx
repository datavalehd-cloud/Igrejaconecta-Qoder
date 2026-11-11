import { useEffect, useRef } from 'react'
import { Navigation } from 'lucide-react'
import { Button, Field, Input } from '@/components/common/primitives'
import { useGeolocation } from '@/hooks/useGeolocation'
import type { LatLng } from '@/utils/geo'

/**
 * Par latitude/longitude com GPS do navegador (Fase 4). Decide "Só GPS +
 * digitação": o botão preenche as duas coordenadas a partir do que o navegador
 * confirma, e os campos também aceitam digitação. Não há geocodificador — o
 * endereço não vira coordenada sozinho, e a tela não finge que vira.
 *
 * O resultado do GPS é assíncrono; o efeito abaixo só empurra a coordenada para
 * o formulário uma vez por concessão (o ref segura o re-disparo quando a
 * identidade de `onChange` muda a cada render do pai).
 */
export function CoordsField({
  lat,
  lng,
  onChange,
  disabled,
}: {
  lat: string
  lng: string
  onChange: (lat: string, lng: string) => void
  disabled?: boolean
}) {
  const geo = useGeolocation()
  const pushed = useRef<LatLng | null>(null)

  useEffect(() => {
    if (geo.status === 'granted' && geo.coords && geo.coords !== pushed.current) {
      pushed.current = geo.coords
      onChange(String(geo.coords.lat), String(geo.coords.lng))
    }
  }, [geo.status, geo.coords, onChange])

  const busy = geo.status === 'requesting'

  return (
    <div className="sm:col-span-2">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Latitude" hint="GPS do navegador ou digite. Sem geocodificador: o endereço não vira coordenada sozinho.">
          <Input
            type="number"
            step="any"
            min={-90}
            max={90}
            value={lat}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value, lng)}
            placeholder="-23.1857"
          />
        </Field>
        <Field label="Longitude">
          <Input
            type="number"
            step="any"
            min={-180}
            max={180}
            value={lng}
            disabled={disabled}
            onChange={(e) => onChange(lat, e.target.value)}
            placeholder="-45.8871"
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<Navigation className="h-4 w-4" />}
          disabled={disabled || busy}
          onClick={geo.locate}
        >
          {busy ? 'Obtendo localização...' : 'Usar minha localização'}
        </Button>
        {geo.status === 'granted' && (
          <span className="text-xs text-green-700">Localização obtida do navegador.</span>
        )}
        {geo.error && <span className="text-xs text-amber-700">{geo.error}</span>}
      </div>
    </div>
  )
}
