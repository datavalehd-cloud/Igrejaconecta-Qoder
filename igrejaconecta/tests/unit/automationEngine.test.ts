import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_RULES,
  SOON_WINDOW_HOURS,
  evaluateAll,
  evaluateRule,
  summarize,
  type AutomationContext,
  type AutomationRuleDef,
} from '@/utils/automationEngine'
import type { ChurchEvent, RegistrationStats } from '@/types'

/**
 * Motor de SIMULAÇÃO de automações (Fase 7): cálculo local e determinístico sobre dados
 * reais, sem provedor e sem chave. Estes testes travam quatro coisas: (1) cada gatilho
 * casa exatamente com o que deve — status, visibilidade, janela de 24h e público-alvo —
 * e nada além; (2) regra desativada não dispara; (3) a saída é estável e as mensagens são
 * honestas, dizendo o que *seria* enviado, sem emoji e sem alegar envio/execução; e (4) o
 * módulo não tem por onde ler nem enviar segredo (a última asserção lê a fonte).
 */

const now = new Date('2026-11-11T12:00:00')

function ev(p: Partial<ChurchEvent> & Pick<ChurchEvent, 'id' | 'slug' | 'name' | 'starts_at' | 'status'>): ChurchEvent {
  const base: ChurchEvent = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    starts_at: p.starts_at,
    status: p.status,
    category_id: 'c1',
    church_id: 'ch1',
    is_free: true,
    visibility: 'public',
    address: 'Rua das Palmeiras, 120 — Centro',
    city: 'São José dos Campos',
  }
  return { ...base, ...p }
}

function stat(event_id: string, c: Partial<RegistrationStats> = {}): RegistrationStats {
  const base: RegistrationStats = {
    event_id,
    church_id: 'ch1',
    capacity: null,
    pending_count: 0,
    confirmed_count: 0,
    waitlist_count: 0,
    checked_in_count: 0,
    cancelled_count: 0,
    active_count: 0,
    spots_left: null,
  }
  return { ...base, ...c }
}

// Publicado e começa em 10h -> dentro da janela de 24h.
const soonPublished = ev({ id: 'soon', slug: 'vigilia-amanha', name: 'Vigília Amanhã', starts_at: '2026-11-11T22:00:00', status: 'published' })
// Dentro de 24h, mas rascunho -> o lembrete não dispara.
const soonDraft = ev({ id: 'soondraft', slug: 'rascunho-amanha', name: 'Rascunho Amanhã', starts_at: '2026-11-11T23:00:00', status: 'draft' })
// Publicado, mas começa em 9 dias -> fora da janela.
const farPublished = ev({ id: 'far', slug: 'congresso-de-jovens-2026', name: 'Congresso de Jovens 2026', starts_at: '2026-11-20T19:30:00', status: 'published', is_free: false, capacity: 500 })
// Cancelado com inscritos -> o aviso de cancelamento dispara.
const cancelled = ev({ id: 'cx', slug: 'retiro-cancelado', name: 'Retiro Cancelado', starts_at: '2026-11-15T09:00:00', status: 'cancelled' })
// Publicado, mas privado -> não gera link público.
const privatePublished = ev({ id: 'pv', slug: 'ensaio-fechado', name: 'Ensaio Fechado', starts_at: '2026-11-30T09:00:00', status: 'published', visibility: 'private' })
// Publicado, mas unlisted -> não é "público", não gera link.
const unlistedPublished = ev({ id: 'ul', slug: 'evento-unlisted', name: 'Evento Unlisted', starts_at: '2026-11-30T10:00:00', status: 'published', visibility: 'unlisted' })

const allEvents = [soonPublished, soonDraft, farPublished, cancelled, privatePublished, unlistedPublished]

const stats = new Map<string, RegistrationStats>([
  ['soon', stat('soon', { confirmed_count: 5, pending_count: 2 })],                       // 7 com vaga real
  ['far', stat('far', { confirmed_count: 3, checked_in_count: 1, waitlist_count: 2 })],   // 4 com vaga, 6 no total
  ['cx', stat('cx', { confirmed_count: 4, waitlist_count: 3 })],                          // 7 para avisar
  ['pv', stat('pv', { confirmed_count: 9 })],                                             // privado, mas tem inscritos
])

const ctx: AutomationContext = { events: allEvents, stats, now }

function rule(id: string): AutomationRuleDef {
  const found = AUTOMATION_RULES.find((r) => r.id === id)
  if (!found) throw new Error(`regra não encontrada: ${id}`)
  return found
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u

describe('automationEngine — determinismo', () => {
  it('o mesmo contexto produz exatamente a mesma saída', () => {
    const enabled = new Set(AUTOMATION_RULES.map((r) => r.id))
    expect(evaluateAll(AUTOMATION_RULES, enabled, ctx)).toEqual(evaluateAll(AUTOMATION_RULES, enabled, ctx))
  })

  it('o catálogo tem as quatro regras, uma por gatilho', () => {
    expect(AUTOMATION_RULES.map((r) => r.trigger).sort()).toEqual(['event_cancelled', 'event_soon', 'new_event', 'new_registration'])
    expect(SOON_WINDOW_HOURS).toBe(24)
  })
})

describe('automationEngine — new_registration (confirmar inscrição)', () => {
  const run = evaluateRule(rule('confirm-registration'), ctx)

  it('casa publicado com inscrição ativa e ignora rascunho, cancelado e sem inscrito', () => {
    expect(run.matches.map((m) => m.eventId).sort()).toEqual(['far', 'pv', 'soon'])
    expect(run.wouldFire).toBe(true)
  })

  it('conta só quem tem vaga real (pendente + confirmado + check-in), sem lista de espera', () => {
    expect(run.matches.find((m) => m.eventId === 'soon')!.recipients).toBe(7)
    expect(run.matches.find((m) => m.eventId === 'far')!.recipients).toBe(4)
  })

  it('a prévia traz o nome, a data e a cidade do evento, sem emoji', () => {
    const soon = run.matches.find((m) => m.eventId === 'soon')!
    expect(soon.message).toContain('Vigília Amanhã')
    expect(soon.message).toContain('São José dos Campos')
    expect(soon.message).not.toMatch(EMOJI)
  })
})

describe('automationEngine — event_soon (lembrete 24h)', () => {
  const run = evaluateRule(rule('remind-event-soon'), ctx)

  it('só casa publicado que começa dentro de 24h e tem inscritos', () => {
    expect(run.matches.map((m) => m.eventId)).toEqual(['soon'])
    expect(run.matches[0]!.recipients).toBe(7)
  })

  it('ignora rascunho dentro da janela e publicado fora dela', () => {
    const ids = run.matches.map((m) => m.eventId)
    expect(ids).not.toContain('soondraft')
    expect(ids).not.toContain('far')
  })

  it('a prévia é um lembrete com a data de início', () => {
    expect(run.matches[0]!.message).toContain('Lembrete')
    expect(run.matches[0]!.detail).toContain('começa em')
  })
})

describe('automationEngine — event_cancelled (avisar cancelamento)', () => {
  const run = evaluateRule(rule('notify-cancelled'), ctx)

  it('só casa evento cancelado e conta todo mundo que se inscreveu, inclusive a espera', () => {
    expect(run.matches.map((m) => m.eventId)).toEqual(['cx'])
    expect(run.matches[0]!.recipients).toBe(7)
  })

  it('a prévia comunica o cancelamento sem alegar que foi enviada', () => {
    const msg = run.matches[0]!.message
    expect(msg).toContain('cancelado')
    expect(msg.toLowerCase()).not.toContain('enviado')
  })
})

describe('automationEngine — new_event (link público)', () => {
  const run = evaluateRule(rule('publish-link'), ctx)

  it('só casa publicado E público, e gera o link do slug', () => {
    expect(run.matches.map((m) => m.eventId).sort()).toEqual(['far', 'soon'])
    expect(run.matches.find((m) => m.eventId === 'soon')!.link).toContain('/eventos/vigilia-amanha')
  })

  it('exclui privado, unlisted, rascunho e cancelado', () => {
    const ids = run.matches.map((m) => m.eventId)
    for (const out of ['pv', 'ul', 'soondraft', 'cx']) expect(ids).not.toContain(out)
  })

  it('o link é do próprio app, não de rede nenhuma, e não leva chave', () => {
    for (const m of run.matches) {
      expect(m.link).not.toMatch(/wa\.me|facebook|instagram|tiktok/i)
      expect(m.message).not.toMatch(/api[_-]?key/i)
    }
  })
})

describe('automationEngine — evaluateAll respeita o estado local', () => {
  it('avalia só as regras ativas, na ordem do catálogo', () => {
    const runs = evaluateAll(AUTOMATION_RULES, new Set(['confirm-registration', 'publish-link']), ctx)
    expect(runs.map((r) => r.rule.id)).toEqual(['confirm-registration', 'publish-link'])
  })

  it('sem nenhuma regra ativa, não há dry-run nenhum', () => {
    expect(evaluateAll(AUTOMATION_RULES, new Set(), ctx)).toEqual([])
  })
})

describe('automationEngine — summarize (números honestos)', () => {
  const enabled = new Set(AUTOMATION_RULES.map((r) => r.id))
  const s = summarize(evaluateAll(AUTOMATION_RULES, enabled, ctx))

  it('deriva do dry-run, sem inventar execução', () => {
    expect(s.activeRules).toBe(4)
    expect(s.rulesThatWouldFire).toBe(4)
    // confirm (7+4+9) + lembrete (7) + cancelado (7) + link (0)
    expect(s.messagesThatWouldSend).toBe(34)
    // eventos distintos casados: soon, far, pv, cx
    expect(s.eventsMatched).toBe(4)
  })
})

describe('automationEngine — mensagens honestas', () => {
  const enabled = new Set(AUTOMATION_RULES.map((r) => r.id))
  const allMatches = evaluateAll(AUTOMATION_RULES, enabled, ctx).flatMap((r) => r.matches)

  it('nenhuma prévia usa emoji', () => {
    for (const m of allMatches) expect(m.message).not.toMatch(EMOJI)
  })

  it('nenhuma prévia alega envio, entrega ou execução', () => {
    for (const m of allMatches) {
      const lower = m.message.toLowerCase()
      for (const bad of ['enviado', 'enviada', 'enviamos', 'entregue', 'executado', 'disparado', 'agendado com sucesso']) {
        expect(lower).not.toContain(bad)
      }
    }
  })

  it('nenhuma prévia vaza campo ausente', () => {
    for (const m of allMatches) {
      for (const bad of ['undefined', 'null', 'NaN']) expect(m.message).not.toContain(bad)
    }
  })
})

describe('fronteira de honestidade — nenhum segredo no motor local', () => {
  const fonte = readFileSync(new URL('../../src/utils/automationEngine.ts', import.meta.url), 'utf8')

  it('não lê variável de ambiente, não chama rede e não toca no cliente Supabase', () => {
    // Nomes de canal (SMTP, WhatsApp) aparecem como rótulo honesto do que conectar
    // exigiria; o que importa é que o módulo não tem por onde ler nem enviar uma chave.
    expect(fonte).not.toMatch(/import\.meta\.env/)
    expect(fonte).not.toMatch(/\bfetch\s*\(/)
    expect(fonte).not.toMatch(/supabase/i)
    expect(fonte).not.toMatch(/api[_-]?key/i)
  })

  it('só importa utilitários puros e tipos — nenhuma dependência de provedor', () => {
    const imports = fonte.match(/^import .*$/gm) ?? []
    expect(imports).toEqual([
      "import { formatDateTime } from '@/utils/format'",
      "import { absoluteUrl } from '@/utils/share'",
      "import type { ChurchEvent, RegistrationStats } from '@/types'",
    ])
  })
})
