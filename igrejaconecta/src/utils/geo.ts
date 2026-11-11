/**
 * Geografia da Fase 4. Não há provedor externo aqui: a coordenada vem do GPS do
 * navegador ou é digitada, e a distância é haversine sobre a esfera — distância
 * em linha reta, não rota de rua. A tela diz isso em vez de chamar de "distância
 * de carro", e quem não tem coordenada fica sem distância (null), nunca em zero.
 */

export interface LatLng {
  lat: number
  lng: number
}

/** Coordenada presente e finita. É o filtro de "está plotada no mapa". */
export function toLatLng(lat?: number | null, lng?: number | null): LatLng | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/**
 * Os mesmos limites dos CHECK da 0013 (lat em [-90, 90], lng em [-180, 180]).
 * Validar aqui não substitui o banco — é para o formulário dizer o que há de
 * errado em português em vez de devolver 23514.
 */
export function validateLatLng(lat?: number | null, lng?: number | null): string | null {
  const hasLat = lat !== null && lat !== undefined
  const hasLng = lng !== null && lng !== undefined
  if (hasLat !== hasLng) return 'Informe latitude e longitude juntas, ou deixe as duas em branco.'
  if (!hasLat) return null
  if (!Number.isFinite(lat!) || lat! < -90 || lat! > 90) return 'A latitude precisa ser um número entre -90 e 90.'
  if (!Number.isFinite(lng!) || lng! < -180 || lng! > 180) return 'A longitude precisa ser um número entre -180 e 180.'
  return null
}

const EARTH_RADIUS_KM = 6371

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  // min(1, ...) segura o arredenamento que levaria sqrt um pouco acima de 1.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Null quando falta coordenada de qualquer um dos dois lados. */
export function distanceKm(from: LatLng | null, to: LatLng | null): number | null {
  if (!from || !to) return null
  return haversineKm(from, to)
}

export function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return '—'
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`
}

/**
 * Mais perto primeiro. Quem não tem coordenada vai para o fim na ordem em que
 * estava — inventar posição para aparecer no meio da lista seria mentir. Sem
 * origem (GPS negado ou ainda não pedido) a ordem original é devolvida intacta.
 */
export function sortByProximity<T>(rows: T[], from: LatLng | null, coords: (row: T) => LatLng | null): T[] {
  if (!from) return [...rows]
  return rows
    .map((row, index) => ({ row, index, km: distanceKm(from, coords(row)) }))
    .sort((a, b) => {
      if (a.km === null && b.km === null) return a.index - b.index
      if (a.km === null) return 1
      if (b.km === null) return -1
      return a.km - b.km || a.index - b.index
    })
    .map((entry) => entry.row)
}

/**
 * Rota no Google Maps. É um link, não uma integração: nenhuma chave, nenhuma
 * chamada nossa — quem clica sai do IgrejaConecta. Sem origem confirmada o link
 * leva só ao destino, e o Maps resolve a partida do lado dele.
 */
export function directionsUrl(to: LatLng, from?: LatLng | null): string {
  const destination = `${to.lat},${to.lng}`
  if (!from) return `https://www.google.com/maps/dir/?api=1&destination=${destination}`
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${destination}`
}
