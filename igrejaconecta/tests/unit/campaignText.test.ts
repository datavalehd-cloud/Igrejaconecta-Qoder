import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { events } from '@/data/mock'
import { formatDateTime } from '@/utils/format'
import { CAMPAIGN_NETWORKS, validateCampaignDraft } from '@/services/data/marketingService'
import {
  CAMPAIGN_TEXT_STYLES,
  generateCampaignText,
} from '@/utils/campaignText'
import type { ChurchEvent } from '@/types'

/**
 * Gerador LOCAL de texto de campanha (Fase 6). É template determinístico, sem chave
 * e sem provedor — não é IA. Estes testes travam três coisas: (1) a saída é estável
 * e usável como rascunho de campanha real, (2) nunca vaza campo ausente como
 * "undefined" nem implica preço (produto sem cobrança), e (3) o módulo não toca em
 * segredo nenhum — a asserção final lê a fonte e exige que não haja chave/API ali.
 */

const congresso = events.find((e) => e.id === 'e1')!
const vigilia = events.find((e) => e.id === 'e2')!

const minimalEvent: ChurchEvent = {
  id: 'ex',
  slug: 'evento-minimo',
  name: 'Culto de Gratidão',
  category_id: 'c1',
  church_id: 'ch1',
  starts_at: '2026-12-01T19:00:00',
  is_free: false,
  visibility: 'public',
  status: 'published',
}

describe('generateCampaignText — determinismo e formato', () => {
  it('mesmo evento e estilo produzem exatamente a mesma saída', () => {
    expect(generateCampaignText(congresso, 'convite')).toEqual(generateCampaignText(congresso, 'convite'))
  })

  it('o nome carrega o nome do evento e vale como nome de campanha', () => {
    const { name } = generateCampaignText(congresso)
    expect(name).toContain(congresso.name)
    expect(name.trim().length).toBeGreaterThanOrEqual(3)
  })

  it('a mensagem traz a data formatada e a cidade do evento', () => {
    const { message } = generateCampaignText(congresso)
    expect(message).toContain(formatDateTime(congresso.starts_at))
    expect(message).toContain('São José dos Campos')
  })

  it('cada rede sugerida é uma rede suportada', () => {
    const { networks } = generateCampaignText(congresso)
    expect(networks.length).toBeGreaterThan(0)
    for (const n of networks) expect(CAMPAIGN_NETWORKS).toContain(n)
  })

  it('as redes sugeridas não compartilham referência entre chamadas', () => {
    const a = generateCampaignText(congresso)
    const b = generateCampaignText(congresso)
    const antes = [...b.networks]
    a.networks.push('whatsapp')
    expect(b.networks).toEqual(antes)
  })

  it('a saída inteira valida como rascunho de campanha', () => {
    const t = generateCampaignText(congresso)
    expect(validateCampaignDraft({ name: t.name, message: t.message, networks: t.networks, event_id: congresso.id })).toBeNull()
  })

  it('a mensagem aponta para o link, mas não embute URL (essa vem da distribuição)', () => {
    const { message } = generateCampaignText(congresso)
    expect(message.toLowerCase()).toContain('link')
    expect(message).not.toContain('http')
  })
})

describe('generateCampaignText — fatos do evento, sem inventar', () => {
  it('evento gratuito diz "Entrada gratuita"', () => {
    expect(generateCampaignText(vigilia).message).toContain('Entrada gratuita')
  })

  it('evento não gratuito com capacidade diz "Vagas limitadas", nunca preço', () => {
    const { message } = generateCampaignText(congresso)
    expect(message).toContain('Vagas limitadas (500)')
    expect(message).not.toContain('gratuita')
    for (const word of ['R$', 'pago', 'preço', 'valor', 'ingresso pago']) {
      expect(message).not.toContain(word)
    }
  })

  it('evento não gratuito sem capacidade não inventa vagas nem preço', () => {
    const { message } = generateCampaignText(minimalEvent)
    expect(message).not.toContain('Vagas limitadas')
    expect(message).not.toContain('gratuita')
  })

  it('sem campos opcionais a mensagem não vaza undefined/null/NaN', () => {
    const { message, name } = generateCampaignText(minimalEvent)
    for (const bad of ['undefined', 'null', 'NaN']) {
      expect(message).not.toContain(bad)
      expect(name).not.toContain(bad)
    }
    expect(message).toContain(formatDateTime(minimalEvent.starts_at))
  })
})

describe('generateCampaignText — hashtags', () => {
  it('toda hashtag começa com #, sem espaço nem acento', () => {
    const { hashtags } = generateCampaignText(congresso)
    expect(hashtags.length).toBeGreaterThan(0)
    for (const tag of hashtags) {
      expect(tag.startsWith('#')).toBe(true)
      expect(tag).not.toMatch(/[\sà-úÀ-Ú]/)
    }
  })

  it('inclui a marca e descarta número puro', () => {
    const { hashtags } = generateCampaignText(congresso)
    expect(hashtags).toContain('#IgrejaConecta')
    expect(hashtags.some((t) => /^#\d+$/.test(t))).toBe(false)
  })

  it('hashtags de evento com acento no nome saem sem acento', () => {
    // "Culto de Gratidão" -> gratidão vira gratidao; "de" é stopword.
    const { hashtags } = generateCampaignText(minimalEvent)
    expect(hashtags).toContain('#gratidao')
    expect(hashtags).not.toContain('#de')
  })
})

describe('generateCampaignText — estilos', () => {
  it('os três estilos produzem mensagens diferentes entre si', () => {
    const [convite, urgente, informativo] = CAMPAIGN_TEXT_STYLES.map((s) => generateCampaignText(congresso, s.id).message)
    expect(new Set([convite, urgente, informativo]).size).toBe(3)
  })

  it('todo estilo declarado gera texto válido', () => {
    for (const style of CAMPAIGN_TEXT_STYLES.map((s) => s.id)) {
      const t = generateCampaignText(congresso, style)
      expect(validateCampaignDraft({ name: t.name, message: t.message, networks: t.networks })).toBeNull()
    }
  })
})

describe('fronteira de honestidade — nenhum segredo no gerador local', () => {
  const fonte = readFileSync(new URL('../../src/utils/campaignText.ts', import.meta.url), 'utf8')

  it('não lê variável de ambiente, não chama rede e não toca no cliente Supabase', () => {
    // Nomes de provedor podem aparecer em comentário (documentando o que NÃO é);
    // o que importa é que o módulo não tem por onde ler nem enviar uma chave.
    expect(fonte).not.toMatch(/import\.meta\.env/)
    expect(fonte).not.toMatch(/\bfetch\s*\(/)
    expect(fonte).not.toMatch(/supabase/i)
    expect(fonte).not.toMatch(/api[_-]?key/i)
  })

  it('só importa utilitário puro e tipos — nenhuma dependência de provedor', () => {
    const imports = fonte.match(/^import .*$/gm) ?? []
    expect(imports).toEqual([
      "import { formatDateTime, slugify } from '@/utils/format'",
      "import type { CampaignNetwork, ChurchEvent } from '@/types'",
    ])
  })
})
