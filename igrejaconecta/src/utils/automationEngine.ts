import { formatDateTime } from '@/utils/format'
import { absoluteUrl } from '@/utils/share'
import type { ChurchEvent, RegistrationStats } from '@/types'

/**
 * Motor de SIMULAÇÃO de automações (Fase 7). Isto é um cálculo local e determinístico
 * sobre os dados reais que a igreja já pode ler (eventos + contagens de inscrição): dado
 * um conjunto de regras ativas e um instante `now`, devolve o que cada regra *dispararia
 * agora* e a mensagem que *seria* enviada. Não é IA, não chama provedor, não usa chave e
 * NÃO envia nem agenda nada — enviar exige SMTP/WhatsApp/push e agendar exige um scheduler
 * (cron/fila/Edge Function), e nenhum dos dois existe aqui. Tudo que precisa deles fica
 * "não conectado" na tela. As chaves nunca vão para o frontend; o que salva passa pelas
 * permissões já existentes. Por isso este arquivo só importa format/share/types.
 */

export type AutomationTrigger = 'new_registration' | 'event_soon' | 'event_cancelled' | 'new_event'
export type AutomationChannel = 'email' | 'whatsapp' | 'push' | 'internal'

/** Janela do lembrete "evento próximo": dispara para o que começa nas próximas 24h. */
export const SOON_WINDOW_HOURS = 24

export interface AutomationRuleDef {
  id: string
  name: string
  trigger: AutomationTrigger
  channels: AutomationChannel[]
  summary: string
}

export const triggerLabel: Record<AutomationTrigger, string> = {
  new_registration: 'Nova inscrição',
  event_soon: 'Evento próximo (24h)',
  event_cancelled: 'Evento cancelado',
  new_event: 'Novo evento publicado',
}

export const channelLabel: Record<AutomationChannel, string> = {
  email: 'E-mail (SMTP)',
  whatsapp: 'WhatsApp Business',
  push: 'Push web',
  internal: 'Interno',
}

/**
 * O que cada canal exigiria para enviar de verdade. Todos ficam "não conectado": nenhum
 * provedor nem backend de envio existe aqui, então nada é marcado como conectado/enviado.
 */
export const channelRequires: Record<AutomationChannel, string> = {
  email: 'um provedor SMTP + backend que dispare no gatilho',
  whatsapp: 'WhatsApp Cloud API + backend que guarde o token',
  push: 'Web Push (VAPID) + service worker + backend',
  internal: 'um centro de notificações persistido + backend',
}

export const AUTOMATION_RULES: AutomationRuleDef[] = [
  {
    id: 'confirm-registration',
    name: 'Confirmar nova inscrição',
    trigger: 'new_registration',
    channels: ['whatsapp', 'email'],
    summary: 'Avisa quem se inscreveu que a vaga está confirmada, com data e local do evento.',
  },
  {
    id: 'remind-event-soon',
    name: 'Lembrete 24h antes do evento',
    trigger: 'event_soon',
    channels: ['whatsapp'],
    summary: 'Lembra os inscritos um dia antes de começar, com data e local.',
  },
  {
    id: 'notify-cancelled',
    name: 'Avisar inscritos em cancelamento',
    trigger: 'event_cancelled',
    channels: ['email'],
    summary: 'Comunica o cancelamento a todo mundo que se inscreveu.',
  },
  {
    id: 'publish-link',
    name: 'Gerar link público do evento',
    trigger: 'new_event',
    channels: ['internal'],
    summary: 'Prepara o link público quando um evento publicado e público entra no ar.',
  },
]

export interface AutomationContext {
  events: ChurchEvent[]
  stats: Map<string, RegistrationStats>
  now: Date
}

export interface AutomationMatch {
  eventId: string
  label: string
  detail: string
  recipients: number
  message: string
  link?: string
}

export interface AutomationDryRun {
  rule: AutomationRuleDef
  wouldFire: boolean
  matches: AutomationMatch[]
}

export interface AutomationSummary {
  activeRules: number
  rulesThatWouldFire: number
  messagesThatWouldSend: number
  eventsMatched: number
}

/** Inscritos com vaga real (pendente/confirmado/check-in) — o público de uma confirmação. */
function confirmedRecipients(stat?: RegistrationStats): number {
  if (!stat) return 0
  return stat.pending_count + stat.confirmed_count + stat.checked_in_count
}

/** Todo mundo que se inscreveu, inclusive lista de espera — o público de um cancelamento. */
function allSignupRecipients(stat?: RegistrationStats): number {
  if (!stat) return 0
  return stat.pending_count + stat.confirmed_count + stat.checked_in_count + stat.waitlist_count
}

function eventLocation(event: ChurchEvent): string | null {
  const where = [event.address?.trim(), event.city?.trim()].filter((v): v is string => Boolean(v))
  return where.length ? where.join(', ') : null
}

/** Começa dentro da janela (estritamente no futuro e até `hours` a partir de `now`). */
function startsWithin(event: ChurchEvent, now: Date, hours: number): boolean {
  const start = new Date(event.starts_at).getTime()
  if (Number.isNaN(start)) return false
  const diff = start - now.getTime()
  return diff > 0 && diff <= hours * 60 * 60 * 1000
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function confirmMessage(event: ChurchEvent): string {
  const facts = [`Data: ${formatDateTime(event.starts_at)}`]
  const where = eventLocation(event)
  if (where) facts.push(`Local: ${where}`)
  return [`Inscrição confirmada: ${event.name}.`, facts.join('\n'), 'Guarde este aviso. Até lá!'].join('\n\n')
}

function reminderMessage(event: ChurchEvent): string {
  const parts = [`Lembrete: ${event.name} começa em ${formatDateTime(event.starts_at)}.`]
  const where = eventLocation(event)
  if (where) parts.push(`Local: ${where}`)
  parts.push('Sua vaga está confirmada. Chegue com um pouco de antecedência.')
  return parts.join('\n\n')
}

function cancelledMessage(event: ChurchEvent): string {
  return [
    `Aviso: ${event.name} (${formatDateTime(event.starts_at)}) foi cancelado.`,
    'As inscrições estão encerradas. Para dúvidas, procure a igreja organizadora.',
  ].join('\n\n')
}

function linkMessage(event: ChurchEvent, link: string): string {
  return [
    `Novo evento publicado: ${event.name}.`,
    `Link público: ${link}`,
    'Use este link para divulgar no WhatsApp, nas redes e no site.',
  ].join('\n\n')
}

/**
 * Avalia uma regra contra o contexto e devolve o que ela dispararia agora. Pura e
 * determinística: percorre os eventos na ordem em que vêm e não depende de relógio
 * interno (o instante vem em `ctx.now`).
 */
export function evaluateRule(rule: AutomationRuleDef, ctx: AutomationContext): AutomationDryRun {
  const matches: AutomationMatch[] = []

  for (const event of ctx.events) {
    const stat = ctx.stats.get(event.id)

    if (rule.trigger === 'new_registration') {
      const recipients = confirmedRecipients(stat)
      if (event.status === 'published' && recipients > 0) {
        matches.push({
          eventId: event.id,
          label: event.name,
          detail: plural(recipients, 'inscrição ativa', 'inscrições ativas'),
          recipients,
          message: confirmMessage(event),
        })
      }
      continue
    }

    if (rule.trigger === 'event_soon') {
      const recipients = confirmedRecipients(stat)
      if (event.status === 'published' && recipients > 0 && startsWithin(event, ctx.now, SOON_WINDOW_HOURS)) {
        matches.push({
          eventId: event.id,
          label: event.name,
          detail: `começa em ${formatDateTime(event.starts_at)}`,
          recipients,
          message: reminderMessage(event),
        })
      }
      continue
    }

    if (rule.trigger === 'event_cancelled') {
      const recipients = allSignupRecipients(stat)
      if (event.status === 'cancelled' && recipients > 0) {
        matches.push({
          eventId: event.id,
          label: event.name,
          detail: `cancelado — ${plural(recipients, 'inscrito', 'inscritos')} para avisar`,
          recipients,
          message: cancelledMessage(event),
        })
      }
      continue
    }

    if (rule.trigger === 'new_event') {
      if (event.status === 'published' && event.visibility === 'public') {
        const link = absoluteUrl(`/eventos/${event.slug}`)
        matches.push({
          eventId: event.id,
          label: event.name,
          detail: 'publicado e público',
          recipients: 0,
          message: linkMessage(event, link),
          link,
        })
      }
      continue
    }
  }

  return { rule, wouldFire: matches.length > 0, matches }
}

/** Avalia só as regras ativas, na ordem do catálogo. Regras desativadas não disparam nada. */
export function evaluateAll(
  rules: AutomationRuleDef[],
  enabledIds: ReadonlySet<string>,
  ctx: AutomationContext,
): AutomationDryRun[] {
  return rules.filter((rule) => enabledIds.has(rule.id)).map((rule) => evaluateRule(rule, ctx))
}

/** Números honestos para o topo da tela — derivados do dry-run, nunca inventados. */
export function summarize(dryRuns: AutomationDryRun[]): AutomationSummary {
  const eventIds = new Set<string>()
  let messagesThatWouldSend = 0
  let rulesThatWouldFire = 0
  for (const run of dryRuns) {
    if (run.wouldFire) rulesThatWouldFire += 1
    for (const match of run.matches) {
      eventIds.add(match.eventId)
      messagesThatWouldSend += match.recipients
    }
  }
  return {
    activeRules: dryRuns.length,
    rulesThatWouldFire,
    messagesThatWouldSend,
    eventsMatched: eventIds.size,
  }
}
