import { campaigns, members } from '@/data/mock'
import {
  CAMPAIGN_COLUMNS,
  CAMPAIGN_MANAGE_DENIED,
  CAMPAIGN_NO_CHURCH,
  CAMPAIGN_NOT_FOUND,
  validateCampaignDraft,
  type CampaignActor,
  type CampaignDraft,
  type CampaignWriteResult,
  type WritableCampaignStatus,
} from '@/services/data/marketingService'
import { can } from '@/utils/rbac'
import type { Campaign } from '@/types'

/**
 * Loja em memória que espelha `marketing_campaigns` e a política
 * `marketing_campaigns_read/update` (0014, grupo P) para os testes. A publicação
 * não está aqui: `publishCampaign` nunca escreve em caminho nenhum, e é o trigger
 * (caso P7) que prova isso no banco.
 */

export function demoChurchCampaigns(churchId?: string, actor?: CampaignActor): Campaign[] {
  if (actor?.role === 'superadmin') return sortByNewest(campaigns.map(project))
  if (!churchId) return []
  // Pastor e visitante não têm marketing.manage: não leem campanha nenhuma (caso P3).
  if (!can(actor?.role, 'marketing.manage')) return []
  // Vínculo `invited` não lê (P3). A checagem só vale quando a sessão informa o
  // usuário; sem ele o recorte é a igreja, como nas outras leituras.
  if (actor?.userId && !isActiveMember(actor.userId, churchId)) return []
  return sortByNewest(campaigns.filter((c) => c.church_id === churchId).map(project))
}

export function demoCreateCampaign(draft: CampaignDraft, actor: CampaignActor): CampaignWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const churchId = actor.churchId
  if (!churchId) return { ok: false, error: CAMPAIGN_NO_CHURCH }
  const invalid = validateCampaignDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const row: Campaign = {
    id: crypto.randomUUID(),
    church_id: churchId,
    event_id: draft.event_id ?? null,
    name: draft.name.trim(),
    message: cleanText(draft.message),
    networks: dedupe(draft.networks),
    status: 'draft',
    scheduled_for: null,
  }
  campaigns.push(row)
  return { ok: true, campaign: project(row) }
}

export function demoUpdateCampaign(id: string, draft: CampaignDraft, actor: CampaignActor): CampaignWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateCampaignDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  const found = demoEditableCampaign(id, actor)
  if (!found) return { ok: false, error: CAMPAIGN_NOT_FOUND }
  // `church_id` fica de fora de propósito: transferir campanha é recusado pelo banco (P5).
  Object.assign(found, {
    event_id: draft.event_id ?? null,
    name: draft.name.trim(),
    message: cleanText(draft.message),
    networks: dedupe(draft.networks),
  })
  return { ok: true, campaign: project(found) }
}

export function demoSetCampaignStatus(
  id: string,
  status: WritableCampaignStatus,
  actor: CampaignActor,
  scheduledFor?: string | null,
): CampaignWriteResult {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  if (status === 'scheduled' && !scheduledFor) {
    return { ok: false, error: 'Escolha a data e a hora para agendar a campanha.' }
  }

  const found = demoEditableCampaign(id, actor)
  if (!found) return { ok: false, error: CAMPAIGN_NOT_FOUND }
  Object.assign(found, { status, scheduled_for: status === 'scheduled' ? scheduledFor! : null })
  return { ok: true, campaign: project(found) }
}

function gateWrite(actor: CampaignActor): string | null {
  return can(actor.role, 'marketing.manage') ? null : CAMPAIGN_MANAGE_DENIED
}

/** Espelha USING + WITH CHECK de `marketing_campaigns_update`, com SuperAdmin transversal. */
function demoEditableCampaign(id: string, actor: CampaignActor): Campaign | undefined {
  const found = campaigns.find((c) => c.id === id)
  if (!found) return undefined
  if (actor.role === 'superadmin') return found
  return found.church_id === actor.churchId ? found : undefined
}

function isActiveMember(userId: string, churchId: string): boolean {
  return members.some((m) => m.user_id === userId && m.church_id === churchId && m.status === 'active')
}

function cleanText(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function dedupe(networks: Campaign['networks']): Campaign['networks'] {
  return Array.from(new Set(networks))
}

function project(campaign: Campaign): Campaign {
  const source = campaign as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const column of CAMPAIGN_COLUMNS) out[column] = source[column]
  return out as unknown as Campaign
}

function sortByNewest(rows: Campaign[]): Campaign[] {
  return [...rows].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}
