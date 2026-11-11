import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Navigation, Phone, Route, Search } from 'lucide-react'
import { PageHeader, Button, Badge, Input, Card, CardBody } from '@/components/common/primitives'
import { useMapChurches } from '@/hooks/useChurches'
import { usePublicEvents } from '@/hooks/useEvents'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { whatsappLink } from '@/utils/format'
import { directionsUrl, distanceKm, formatDistance, sortByProximity, toLatLng, type LatLng } from '@/utils/geo'
import type { Church } from '@/types'

/**
 * Fase 4 — mapa de verdade. O fundo é Leaflet + OpenStreetMap (decisão do
 * usuário): tiles reais, sem chave. O que entra na tela vem do banco — a projeção
 * do mapa (`MAP_COLUMNS`, diretório + `lat`/`lng`) — e só é plotada a igreja com
 * coordenada real. Sem coordenada não vira pino inventado: a lista diz "sem
 * coordenada" e o mapa não a mostra. O GPS é o do navegador (`useGeolocation`),
 * sem geocodificador: distância e ordenação por proximidade só existem depois que
 * o navegador confirma a posição. Se os tiles não carregarem (sem rede), o aviso é
 * honesto em vez de um desenho fingindo ser mapa.
 *
 * O mapa é movido de forma imperativa (`mapRef.setView`) a partir dos eventos que
 * importam — seleção, GPS e primeira carga — em vez de estado derivado: o
 * `center` do `MapContainer` só vale na montagem.
 */

const BRAZIL_CENTER: LatLng = { lat: -14.235, lng: -51.9253 }

const coordsOf = (c: Church): LatLng | null => toLatLng(c.lat, c.lng)

function churchIcon(active: boolean) {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:26px;height:26px;border-radius:9999px;background:${active ? '#16a34a' : '#0f2d4a'};border:3px solid #fff;box-shadow:0 2px 6px rgba(15,45,74,.45)"></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12],
  })
}

const userIcon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.25)"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

export function ChurchMapPage() {
  useDocumentMeta({ title: 'Mapa de igrejas e eventos', path: '/mapa' })
  const { rows: churches, loading, error } = useMapChurches()
  const { rows: onAir } = usePublicEvents()
  const geo = useGeolocation()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [tileState, setTileState] = useState<'unknown' | 'ok' | 'failed'>('unknown')
  const mapRef = useRef<L.Map | null>(null)
  const centered = useRef(false)

  const located = geo.status === 'granted' ? geo.coords : null

  const visible = useMemo(
    () =>
      churches.filter(
        (c) =>
          query === '' ||
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          (c.city ?? '').toLowerCase().includes(query.toLowerCase()) ||
          (c.denomination ?? '').toLowerCase().includes(query.toLowerCase()),
      ),
    [churches, query],
  )

  // Com GPS confirmado, ordena por distância real (haversine); sem ele, mantém a
  // ordem de nome que o serviço já devolve — proximidade sem origem seria invenção.
  const sorted = useMemo(
    () => (located ? sortByProximity(visible, located, coordsOf) : visible),
    [visible, located],
  )

  const plotted = useMemo(() => sorted.filter((c) => coordsOf(c) !== null), [sorted])
  const missing = visible.length - plotted.length
  const active = sorted.find((c) => c.id === selected) ?? sorted[0] ?? null
  const activeCoords = active ? coordsOf(active) : null

  const tileHandlers = useMemo(
    () => ({
      tileload: () => setTileState('ok'),
      // Um tile que já carregou mantém o mapa "ok": erro isolado de borda não
      // derruba o aviso. Só marca falha enquanto nada carregou (sem rede).
      tileerror: () => setTileState((s) => (s === 'ok' ? 'ok' : 'failed')),
    }),
    [],
  )

  const centerOn = useCallback((point: LatLng, zoom?: number) => {
    mapRef.current?.setView([point.lat, point.lng], zoom ?? mapRef.current?.getZoom())
  }, [])

  // Primeira carga: centra na primeira igreja plotada uma única vez.
  useEffect(() => {
    if (centered.current || located) return
    const point = plotted[0] ? coordsOf(plotted[0]) : null
    if (point && mapRef.current) {
      centerOn(point, 11)
      centered.current = true
    }
  }, [plotted, located, centerOn])

  // GPS confirmado: move para a posição do visitante.
  useEffect(() => {
    if (!located || !mapRef.current) return
    centerOn(located, 13)
    centered.current = true
  }, [located, centerOn])

  const select = useCallback(
    (id: string) => {
      setSelected(id)
      const church = visible.find((c) => c.id === id)
      const point = church ? coordsOf(church) : null
      if (point) centerOn(point)
    },
    [visible, centerOn],
  )

  const initialCenter = located ?? (plotted[0] ? coordsOf(plotted[0]) : null) ?? BRAZIL_CENTER

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader
        title="Mapa de igrejas"
        subtitle="Encontre igrejas cadastradas perto de você ou pesquise por cidade, bairro ou denominação."
        actions={
          <Button
            variant="outline"
            icon={<Navigation className="h-4 w-4" />}
            onClick={geo.locate}
            disabled={geo.status === 'requesting'}
          >
            {geo.status === 'requesting' ? 'Localizando...' : 'Usar minha localização'}
          </Button>
        }
      />

      {geo.status === 'denied' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {geo.error} Sem problema — use a busca abaixo para encontrar igrejas.
        </div>
      )}
      {(geo.status === 'unavailable' || geo.status === 'granted') && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            geo.status === 'granted'
              ? 'border-green-600/20 bg-green-50 text-green-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
        >
          {geo.status === 'granted'
            ? 'Localização autorizada: a lista está ordenada pela distância real até você.'
            : geo.error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Lista */}
        <div className="lg:col-span-1">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Igreja, cidade, bairro ou denominação"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            {loading && <p className="text-sm text-slate-500">Carregando igrejas...</p>}
            {!loading && !error && visible.length === 0 && (
              <p className="text-sm text-slate-500">
                {churches.length === 0
                  ? 'Nenhuma igreja aprovada e ativa publicada ainda.'
                  : 'Nenhuma igreja encontrada para este termo.'}
              </p>
            )}
            {sorted.map((c) => {
              const coords = coordsOf(c)
              const km = distanceKm(located, coords)
              const events = onAir.filter((e) => e.church_id === c.id).length
              return (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    active?.id === c.id
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-line bg-white hover:border-brand-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-navy">{c.name}</p>
                    {located && coords && (
                      <span className="shrink-0 text-xs font-medium text-brand-600">{formatDistance(km)}</span>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    {c.city}/{c.state} · {c.denomination}
                  </p>
                  <p className="mt-1 text-xs text-brand-600">{events} evento(s) publicado(s)</p>
                  {!coords && (
                    <p className="mt-1 text-[11px] text-slate-400">sem coordenada — não aparece no mapa</p>
                  )}
                </button>
              )
            })}
            {!loading && missing > 0 && (
              <p className="px-1 pt-1 text-[11px] text-slate-400">
                {missing} igreja(s) sem coordenada: aparecem na lista, mas não no mapa.
              </p>
            )}
          </div>
        </div>

        {/* Mapa real + detalhe */}
        <div className="lg:col-span-2">
          <div className="relative h-[420px] overflow-hidden rounded-xl border border-line">
            <MapContainer
              ref={mapRef}
              center={[initialCenter.lat, initialCenter.lng]}
              zoom={located ? 13 : 11}
              scrollWheelZoom
              className="h-full w-full"
              style={{ height: '420px', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                eventHandlers={tileHandlers}
              />
              {located && <Marker position={[located.lat, located.lng]} icon={userIcon} />}
              {plotted.map((c) => {
                const point = coordsOf(c)!
                const km = distanceKm(located, point)
                return (
                  <Marker
                    key={c.id}
                    position={[point.lat, point.lng]}
                    icon={churchIcon(active?.id === c.id)}
                    eventHandlers={{ click: () => select(c.id) }}
                  >
                    <Popup>
                      <span className="font-semibold">{c.name}</span>
                      <br />
                      <span className="text-xs">
                        {c.city}/{c.state}
                        {located ? ` · ${formatDistance(km)}` : ''}
                      </span>
                    </Popup>
                  </Marker>
                )
              })}
            </MapContainer>

            {tileState === 'failed' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-100/85 px-6 text-center">
                <p className="max-w-sm text-sm text-slate-600">
                  O fundo do mapa (OpenStreetMap) não carregou — provavelmente sem conexão. Os pinos e a
                  lista continuam funcionando com os dados já baixados.
                </p>
              </div>
            )}
            {!loading && plotted.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <span className="rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-500 shadow">
                  Nenhuma igreja com coordenada para plotar ainda.
                </span>
              </div>
            )}
          </div>

          {active && (
            <Card className="mt-4">
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-navy">{active.name}</h3>
                    <p className="text-sm text-slate-500">{active.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Badge tone="navy">{active.denomination}</Badge>
                      {active.address && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {active.address}
                        </span>
                      )}
                      {active.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          {active.phone}
                        </span>
                      )}
                      {located && activeCoords && (
                        <span className="inline-flex items-center gap-1 font-medium text-brand-600">
                          <Navigation className="h-3.5 w-3.5" />
                          {formatDistance(distanceKm(located, activeCoords))} de você
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {activeCoords ? (
                      <a href={directionsUrl(activeCoords, located)} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" icon={<Route className="h-4 w-4" />}>
                          Rota
                        </Button>
                      </a>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Route className="h-4 w-4" />}
                        disabled
                        title="Esta igreja ainda não tem coordenada cadastrada."
                      >
                        Rota
                      </Button>
                    )}
                    {active.whatsapp && (
                      <a
                        href={whatsappLink(active.whatsapp, 'Olá! Encontrei vocês no IgrejaConecta.')}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="success" size="sm">
                          WhatsApp
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
