import { formatDateTime, slugify } from '@/utils/format'
import type { CampaignNetwork, ChurchEvent } from '@/types'

/**
 * Gerador LOCAL de texto de campanha (Fase 6).
 *
 * É um modelo pronto (template) determinístico que roda no aparelho, sem chave e
 * sem provedor: monta nome, mensagem, redes sugeridas e hashtags a partir dos
 * dados REAIS do evento (nome, data, local, categoria, gratuidade, capacidade,
 * descrição). Para o mesmo evento e estilo, a saída é sempre a mesma.
 *
 * Isto NÃO é IA, e a tela nunca diz que é: nenhum modelo roda aqui. A IA de
 * provedor (OpenAI e afins) exigiria um backend que guardasse a chave com
 * segurança — a chave jamais pode ir para o frontend, onde ficaria exposta a quem
 * abrisse o código. Como esse backend não existe neste ambiente, o gerador local é
 * o caminho honesto: produz texto de verdade em vez de fingir resposta de modelo.
 *
 * O texto gerado é um RASCUNHO para editar. Salvar continua passando pelo
 * `marketingService` (porta `marketing.manage` + RLS da 0014) — este módulo não
 * toca no banco nem decide audiência.
 */

export type CampaignTextStyle = 'convite' | 'urgente' | 'informativo'

export const CAMPAIGN_TEXT_STYLES: { id: CampaignTextStyle; label: string; hint: string }[] = [
  { id: 'convite', label: 'Convite', hint: 'Tom acolhedor, chama para participar.' },
  { id: 'urgente', label: 'Contagem regressiva', hint: 'Urgência de data e de vagas.' },
  { id: 'informativo', label: 'Informativo', hint: 'Direto ao ponto: o que, quando, onde.' },
]

export interface CampaignText {
  name: string
  message: string
  networks: CampaignNetwork[]
  hashtags: string[]
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'para', 'com',
  'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'por', 'sobre', 'the',
])

const OPENERS: Record<CampaignTextStyle, (name: string) => string> = {
  convite: (name) => `${name}: você é nosso convidado!`,
  urgente: (name) => `${name} está chegando!`,
  informativo: (name) => `${name}: confira as informações.`,
}

const CTAS: Record<CampaignTextStyle, string> = {
  convite: 'Inscreva-se pelo link do evento e participe com a gente.',
  urgente: 'As vagas são limitadas — garanta a sua pelo link do evento.',
  informativo: 'Detalhes e inscrição no link do evento.',
}

/** Redes sugeridas: as três de maior alcance orgânico numa igreja. Editáveis na tela. */
const DEFAULT_NETWORKS: CampaignNetwork[] = ['whatsapp', 'instagram', 'facebook']

export function generateCampaignText(event: ChurchEvent, style: CampaignTextStyle = 'convite'): CampaignText {
  const hashtags = buildHashtags(event)
  return {
    name: `Divulgação — ${event.name}`.trim(),
    message: buildMessage(event, style, hashtags),
    networks: [...DEFAULT_NETWORKS],
    hashtags,
  }
}

function buildMessage(event: ChurchEvent, style: CampaignTextStyle, hashtags: string[]): string {
  const parts: string[] = [OPENERS[style](event.name)]

  const lead = firstSentence(event.description)
  if (lead) parts.push(lead)

  // Sem pagamento no produto: evento gratuito diz "Entrada gratuita"; o que não é
  // gratuito nunca vira "pago" — no máximo o lembrete de vagas, se houver capacidade.
  const facts: string[] = [`Data: ${formatDateTime(event.starts_at)}`]
  const where = location(event)
  if (where) facts.push(`Local: ${where}`)
  if (event.is_free) facts.push('Entrada gratuita.')
  else if (event.capacity) facts.push(`Vagas limitadas (${event.capacity}).`)
  parts.push(facts.join('\n'))

  parts.push(CTAS[style])

  if (hashtags.length) parts.push(hashtags.join(' '))

  return parts.join('\n\n')
}

function location(event: ChurchEvent): string | null {
  const where = [event.address?.trim(), event.city?.trim()].filter((v): v is string => Boolean(v))
  return where.length ? where.join(', ') : null
}

/** Primeira frase da descrição, com teto de tamanho — sem ela, nada de parágrafo vazio. */
function firstSentence(description?: string | null): string | null {
  const text = description?.trim()
  if (!text) return null
  const cut = text.split(/(?<=[.!?])\s+/)[0] ?? text
  return cut.length > 160 ? `${cut.slice(0, 157).trimEnd()}…` : cut
}

function buildHashtags(event: ChurchEvent): string[] {
  const tags: string[] = []
  for (const word of `${event.name} ${event.category ?? ''}`.split(/\s+/)) {
    const token = slugify(word).replace(/-/g, '')
    if (token.length < 3 || /^\d+$/.test(token) || STOPWORDS.has(token)) continue
    const tag = `#${token}`
    if (!tags.includes(tag)) tags.push(tag)
    if (tags.length === 4) break
  }
  if (!tags.includes('#IgrejaConecta')) tags.push('#IgrejaConecta')
  return tags
}
