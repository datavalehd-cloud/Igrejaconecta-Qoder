/**
 * Busca de endereço por CEP (ViaCEP). É a única fala com esse provedor no app, e
 * é leitura pública de mão única: sem chave, sem token, sem dado pessoal — o que
 * se envia são os 8 dígitos do próprio CEP, que qualquer um pode consultar. Quando
 * o provedor não responde ou não conhece o CEP, dizemos isso e deixamos o
 * preenchimento à mão; nunca inventamos endereço.
 */

export type CepResult =
  | { ok: true; zip: string; address: string; city: string; state: string }
  | { ok: false; error: string }

export const CEP_INVALID = 'Para buscar, o CEP precisa ter exatamente 8 dígitos.'
export const CEP_NOT_FOUND = 'Esse CEP não foi encontrado na consulta. Confira os dígitos.'
export const CEP_UNREACHABLE = 'A consulta de CEP não respondeu agora. Preencha o endereço à mão.'

const VIACEP_URL = 'https://viacep.com.br/ws/'

export function onlyCepDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function formatCep(digits: string): string {
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

interface ViaCepBody {
  erro?: boolean | string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
}

export async function fetchAddressByCep(value: string): Promise<CepResult> {
  const digits = onlyCepDigits(value)
  if (digits.length !== 8) return { ok: false, error: CEP_INVALID }

  let response: Response
  try {
    response = await fetch(`${VIACEP_URL}${digits}/json/`)
  } catch {
    return { ok: false, error: CEP_UNREACHABLE }
  }
  if (response.status === 404) return { ok: false, error: CEP_NOT_FOUND }
  if (!response.ok) return { ok: false, error: CEP_UNREACHABLE }

  let body: ViaCepBody
  try {
    body = (await response.json()) as ViaCepBody
  } catch {
    return { ok: false, error: CEP_UNREACHABLE }
  }
  if (body.erro === true || body.erro === 'true') return { ok: false, error: CEP_NOT_FOUND }

  const street = (body.logradouro ?? '').trim()
  const district = (body.bairro ?? '').trim()
  const city = (body.localidade ?? '').trim()
  const state = (body.uf ?? '').trim()
  const address = [street, district].filter(Boolean).join(', ')
  // CEP "existe" só com o mínimo recheável: rua (ou bairro), cidade e UF.
  if (!address || !city || !state) return { ok: false, error: CEP_NOT_FOUND }

  return { ok: true, zip: formatCep(digits), address, city, state }
}
