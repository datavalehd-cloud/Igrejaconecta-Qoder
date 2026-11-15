import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CEP_INVALID, CEP_NOT_FOUND, CEP_UNREACHABLE,
  fetchAddressByCep, formatCep, onlyCepDigits,
} from '@/services/data/cepService'

// ViaCEP é HTTP puro: o `fetch` global é o único mundo externo destes testes.
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const BROKEN_JSON: Response = {
  ok: true,
  status: 200,
  json: async () => {
    throw new Error('Unexpected token')
  },
} as unknown as Response

describe('helpers de CEP', () => {
  it('limpa máscara e espaços', () => {
    expect(onlyCepDigits(' 01310-100 ')).toBe('01310100')
  })

  it('formata só quando tem 8 dígitos', () => {
    expect(formatCep('01310100')).toBe('01310-100')
    expect(formatCep('123')).toBe('123')
  })
})

describe('fetchAddressByCep', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recusa fora de 8 dígitos antes de qualquer rede', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAddressByCep('0131010')).toEqual({ ok: false, error: CEP_INVALID })
    expect(await fetchAddressByCep('013101000')).toEqual({ ok: false, error: CEP_INVALID })
    expect(await fetchAddressByCep('abc')).toEqual({ ok: false, error: CEP_INVALID })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('consulta a URL pública do ViaCEP e devolve o endereço montado', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAddressByCep('01310-100')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://viacep.com.br/ws/01310100/json/')
    expect(result).toEqual({
      ok: true,
      zip: '01310-100',
      address: 'Avenida Paulista, Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    })
  })

  it('sem bairro o endereço fica só na rua', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ logradouro: 'Rua X', localidade: 'Curitiba', uf: 'PR' }))
    const result = await fetchAddressByCep('80000000')
    expect(result.ok && result.address).toBe('Rua X')
  })

  it('CEP que o provedor marca como erro não vira endereço', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ erro: true }))
    expect(await fetchAddressByCep('99999999')).toEqual({ ok: false, error: CEP_NOT_FOUND })

    vi.stubGlobal('fetch', async () => jsonResponse({ erro: 'true' }))
    expect(await fetchAddressByCep('99999999')).toEqual({ ok: false, error: CEP_NOT_FOUND })
  })

  it('resposta sem os campos mínimos (rua/cidade/UF) é CEP não encontrado', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({}))
    expect(await fetchAddressByCep('01310100')).toEqual({ ok: false, error: CEP_NOT_FOUND })
  })

  it('404 é não encontrado; qualquer outra falha HTTP é indisponibilidade', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ erro: true }, 404))
    expect(await fetchAddressByCep('01310100')).toEqual({ ok: false, error: CEP_NOT_FOUND })

    vi.stubGlobal('fetch', async () => jsonResponse({}, 500))
    expect(await fetchAddressByCep('01310100')).toEqual({ ok: false, error: CEP_UNREACHABLE })
  })

  it('rede fora do ar e JSON corrompido viram aviso honesto, sem tocar nos campos', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await fetchAddressByCep('01310100')).toEqual({ ok: false, error: CEP_UNREACHABLE })

    vi.stubGlobal('fetch', async () => BROKEN_JSON)
    expect(await fetchAddressByCep('01310100')).toEqual({ ok: false, error: CEP_UNREACHABLE })
  })
})
