import { describe, expect, it } from 'vitest'
import {
  directionsUrl,
  distanceKm,
  formatDistance,
  haversineKm,
  sortByProximity,
  toLatLng,
  validateLatLng,
  type LatLng,
} from '@/utils/geo'

/**
 * Geografia da Fase 4 sem provedor externo: a coordenada vem do GPS ou é digitada,
 * a distância é haversine (linha reta, não rota de rua) e quem não tem coordenada
 * fica sem distância — nunca em zero, nunca com posição inventada. Estes testes
 * amarram exactly isso: os limites espelham os CHECK da migração 0013, e a
 * ordenação por proximidade não pode fabricar lugar para igreja sem coordenada.
 */

describe('toLatLng — o filtro de "está plotada"', () => {
  it('devolve a coordenada quando os dois números são finitos', () => {
    expect(toLatLng(-23.55, -46.63)).toEqual({ lat: -23.55, lng: -46.63 })
    expect(toLatLng(0, 0)).toEqual({ lat: 0, lng: 0 })
  })

  it('devolve null quando falta um lado', () => {
    expect(toLatLng(null, -46.63)).toBeNull()
    expect(toLatLng(-23.55, null)).toBeNull()
    expect(toLatLng(undefined, -46.63)).toBeNull()
    expect(toLatLng(-23.55, undefined)).toBeNull()
  })

  it('devolve null para número não finito (NaN, Infinity)', () => {
    expect(toLatLng(Number.NaN, -46.63)).toBeNull()
    expect(toLatLng(-23.55, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('validateLatLng — espelho dos CHECK da 0013', () => {
  it('aceita os dois em branco', () => {
    expect(validateLatLng(null, null)).toBeNull()
    expect(validateLatLng(undefined, undefined)).toBeNull()
  })

  it('exige os dois juntos', () => {
    const esperado = 'Informe latitude e longitude juntas, ou deixe as duas em branco.'
    expect(validateLatLng(-23.5, null)).toBe(esperado)
    expect(validateLatLng(null, -46.6)).toBe(esperado)
  })

  it('recusa latitude fora de [-90, 90]', () => {
    expect(validateLatLng(91, 0)).toBe('A latitude precisa ser um número entre -90 e 90.')
    expect(validateLatLng(-90.1, 0)).toBe('A latitude precisa ser um número entre -90 e 90.')
    expect(validateLatLng(Number.NaN, 0)).toBe('A latitude precisa ser um número entre -90 e 90.')
  })

  it('recusa longitude fora de [-180, 180]', () => {
    expect(validateLatLng(0, 181)).toBe('A longitude precisa ser um número entre -180 e 180.')
    expect(validateLatLng(0, -180.5)).toBe('A longitude precisa ser um número entre -180 e 180.')
    expect(validateLatLng(0, Number.NaN)).toBe('A longitude precisa ser um número entre -180 e 180.')
  })

  it('aceita os extremos do intervalo e coordenadas reais', () => {
    expect(validateLatLng(90, 180)).toBeNull()
    expect(validateLatLng(-90, -180)).toBeNull()
    expect(validateLatLng(-23.1857, -45.8871)).toBeNull()
  })
})

describe('haversineKm — distância em linha reta', () => {
  it('é zero entre um ponto e ele mesmo', () => {
    const p: LatLng = { lat: -23.1857, lng: -45.8871 }
    expect(haversineKm(p, p)).toBeCloseTo(0, 6)
  })

  it('é simétrica', () => {
    const a: LatLng = { lat: -23.55, lng: -46.63 }
    const b: LatLng = { lat: -22.9, lng: -43.17 }
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6)
  })

  it('um grau de latitude vale ~111 km', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 1)
  })

  it('meia volta ao mundo vale ~20015 km, sem estourar o asin', () => {
    // Polo a polo: h chega a 1 e o sqrt podia passar de 1 por arredondamento;
    // o Math.min(1, ...) segura. Sem ele, asin(>1) devolve NaN.
    const km = haversineKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 })
    expect(Number.isFinite(km)).toBe(true)
    expect(km).toBeCloseTo(20015, -1)
  })
})

describe('distanceKm — null quando falta coordenada', () => {
  it('devolve a distância com os dois lados', () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 1)
  })

  it('devolve null sem um dos lados', () => {
    expect(distanceKm(null, { lat: 1, lng: 0 })).toBeNull()
    expect(distanceKm({ lat: 1, lng: 0 }, null)).toBeNull()
    expect(distanceKm(null, null)).toBeNull()
  })
})

describe('formatDistance — exibição honesta', () => {
  it('mostra "—" sem distância confirmada', () => {
    expect(formatDistance(null)).toBe('—')
    expect(formatDistance(Number.NaN)).toBe('—')
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('abaixo de 1 km mostra em metros arredondados', () => {
    expect(formatDistance(0.85)).toBe('850 m')
    expect(formatDistance(0.9994)).toBe('999 m')
    expect(formatDistance(0)).toBe('0 m')
  })

  it('de 1 km em diante mostra em km com uma casa e vírgula pt-BR', () => {
    expect(formatDistance(1)).toBe('1 km')
    expect(formatDistance(1.234)).toBe('1,2 km')
    expect(formatDistance(12.36)).toBe('12,4 km')
  })
})

interface Spot {
  id: string
  lat?: number
  lng?: number
}
const coordsOf = (s: Spot) => toLatLng(s.lat, s.lng)

describe('sortByProximity — mais perto primeiro, sem inventar posição', () => {
  const origin: LatLng = { lat: -23.55, lng: -46.63 }
  const spots: Spot[] = [
    { id: 'longe', lat: -23.9, lng: -46.9 },
    { id: 'perto', lat: -23.56, lng: -46.64 },
    { id: 'semcoord' },
    { id: 'medio', lat: -23.7, lng: -46.7 },
  ]

  it('sem origem devolve a ordem original, em cópia nova', () => {
    const resultado = sortByProximity(spots, null, coordsOf)
    expect(resultado.map((s) => s.id)).toEqual(['longe', 'perto', 'semcoord', 'medio'])
    expect(resultado).not.toBe(spots)
  })

  it('com origem ordena do mais perto ao mais longe', () => {
    const resultado = sortByProximity(spots, origin, coordsOf)
    expect(resultado.map((s) => s.id)).toEqual(['perto', 'medio', 'longe', 'semcoord'])
  })

  it('quem não tem coordenada vai para o fim, na ordem em que estava', () => {
    const comDuasSemCoord: Spot[] = [
      { id: 'semA' },
      { id: 'perto', lat: -23.56, lng: -46.64 },
      { id: 'semB' },
    ]
    const resultado = sortByProximity(comDuasSemCoord, origin, coordsOf)
    expect(resultado.map((s) => s.id)).toEqual(['perto', 'semA', 'semB'])
  })

  it('distâncias iguais mantêm a ordem de entrada (estável)', () => {
    const mesma: Spot[] = [
      { id: 'a', lat: -23.6, lng: -46.7 },
      { id: 'b', lat: -23.6, lng: -46.7 },
    ]
    expect(sortByProximity(mesma, origin, coordsOf).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('não altera o array de origem', () => {
    const antes = spots.map((s) => s.id)
    sortByProximity(spots, origin, coordsOf)
    expect(spots.map((s) => s.id)).toEqual(antes)
  })
})

describe('directionsUrl — link, não integração', () => {
  const to: LatLng = { lat: -23.1857, lng: -45.8871 }

  it('com origem confirmada leva origin e destination', () => {
    const from: LatLng = { lat: -23.55, lng: -46.63 }
    expect(directionsUrl(to, from)).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=-23.55,-46.63&destination=-23.1857,-45.8871',
    )
  })

  it('sem origem leva só o destino (o Maps resolve a partida)', () => {
    expect(directionsUrl(to)).toBe('https://www.google.com/maps/dir/?api=1&destination=-23.1857,-45.8871')
    expect(directionsUrl(to, null)).toBe('https://www.google.com/maps/dir/?api=1&destination=-23.1857,-45.8871')
  })
})
