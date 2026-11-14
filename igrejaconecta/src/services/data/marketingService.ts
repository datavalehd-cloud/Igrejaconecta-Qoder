import { supabase } from '@/services/supabase/client'
import { can } from '@/utils/rbac'
import type { Campaign, CampaignNetwork, RoleKey } from '@/types'

/**
 * Campanhas de divulgação (0014, Fase 5). Leitura e escrita exigem
 * `marketing.manage` na igreja da campanha (SuperAdmin atravessa). Não existe delete
 * em camada nenhuma: campanha é cancelada, não apagada (casos P8/P9 da suíte).
 *
 * O que distingue este serviço dos outros é a publicação: marcar
 * `status = 'published'` exige confirmação real do provedor, e isso só existe num
 * backend com OAuth + tokens (service_role). Aqui não há backend nem chave, então
 * `publishCampaign` NUNCA escreve — devolve sempre "não conectado". É o espelho, no
 * serviço, do trigger `enforce_campaign_publish` (caso P7) e da regra de só mostrar
 * estado confirmado pelo provedor.
 *
 * Como nos outros serviços, a projeção faz parte do contrato: a RLS é por linha e
 * deixaria ler a linha inteira — o que limita as colunas que chegam ao navegador é o
 * `select` daqui. `created_by` existe na tabela mas não é projetado (decisão 5).
 */

export const CAMPAIGN_COLUMNS = [
  'id',
  'church_id',
  'event_id',
  'name',
  'message',
  'networks',
  'status',
  'scheduled_for',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof Campaign)[]

/** Colunas enviadas na criação. `id` e os carimbos ficam com o banco. */
export const CAMPAIGN_INSERT_COLUMNS = [
  'church_id',
  'event_id',
  'name',
  'message',
  'networks',
  'status',
  'scheduled_for',
] as const

export const CAMPAIGN_MANAGE_DENIED =
  'Sem permissão para esta ação: criar e editar campanhas é papel de quem gerencia divulgação (administrador, gerente, comunicador ou SuperAdmin).'
export const CAMPAIGN_NOT_FOUND = 'Campanha não encontrada ou sem permissão para alterá-la. Atualize a lista.'
export const CAMPAIGN_NO_CHURCH = 'A sua sessão não tem igreja ativa: quem não é de uma igreja não cria campanha.'
export const CAMPAIGN_PUBLISH_NOT_CONNECTED =
  'Nenhuma rede está conectada: publicar de verdade exige OAuth + backend com tokens, que não existem aqui. A campanha continua como rascunho ou agendada — use a distribuição sem chave (WhatsApp, copiar link, compartilhar).'

/** As três redes que a 0020 deixou de pé. TikTok saiu, e a tela não oferece. */
export const CAMPAIGN_NETWORKS: CampaignNetwork[] = ['instagram', 'facebook', 'whatsapp']

/** Status que o app pode gravar. published/failed só pelo backend (trigger, caso P7). */
export type WritableCampaignStatus = 'draft' | 'scheduled' | 'cancelled'

export interface CampaignActor {
  churchId?: string
  role?: RoleKey
  userId?: string
}

export interface CampaignDraft {
  name: string
  message?: string | null
  networks: CampaignNetwork[]
  event_id?: string | null
}

export type CampaignWriteResult =
  | { ok: true; campaign: Campaign; error?: never }
  | { ok: false; error: string; campaign?: never }

/** Campanhas da igreja, mais recentes primeiro. Sem `churchId` não há o que listar. */
export async function fetchChurchCampaigns(churchId?: string, actor?: CampaignActor): Promise<Campaign[]> {
  // SuperAdmin vê todas (é o que o `is_superadmin()` dentro de has_church_permission
  // devolve); para qualquer outro papel o recorte é a igreja da sessão, e a
  // política é a segunda camada — não a única.
  const everyChurch = actor?.role === 'superadmin'
  if (!everyChurch && !churchId) return []

  let query = supabase
    .from('marketing_campaigns')
    .select(CAMPAIGN_COLUMNS.join(','))
    .order('created_at', { ascending: false })
  if (!everyChurch) query = query.eq('church_id', churchId!)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Campaign[]
}

export function validateCampaignDraft(draft: CampaignDraft): string | null {
  if (draft.name.trim().length < 3) return 'Informe o nome da campanha (pelo menos 3 caracteres).'
  const invalid = draft.networks.find((n) => !CAMPAIGN_NETWORKS.includes(n))
  if (invalid) return `Rede não suportada: ${invalid}.`
  return null
}

export async function createCampaign(draft: CampaignDraft, actor: CampaignActor): Promise<CampaignWriteResult> {
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

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .insert(pickKeys(row, CAMPAIGN_INSERT_COLUMNS))
    .select(CAMPAIGN_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeCampaignDbError(error) }
  if (!data) return { ok: false, error: CAMPAIGN_NOT_FOUND }
  return { ok: true, campaign: data as unknown as Campaign }
}

export async function updateCampaign(id: string, draft: CampaignDraft, actor: CampaignActor): Promise<CampaignWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  const invalid = validateCampaignDraft(draft)
  if (invalid) return { ok: false, error: invalid }

  // `church_id` fica de fora do patch de propósito: transferir campanha de igreja é
  // recusado pelo banco (caso P5) e o formulário não oferece o campo.
  const patch = {
    event_id: draft.event_id ?? null,
    name: draft.name.trim(),
    message: cleanText(draft.message),
    networks: dedupe(draft.networks),
  }

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update(patch)
    .eq('id', id)
    .select(CAMPAIGN_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeCampaignDbError(error) }
  // `maybeSingle` sem linha é o USING recusando em silêncio (quem é de fora não
  // alcança a linha): mesma mensagem de "não existe", sem oráculo.
  if (!data) return { ok: false, error: CAMPAIGN_NOT_FOUND }
  return { ok: true, campaign: data as unknown as Campaign }
}

/**
 * Muda o status para um dos graváveis pelo app (draft/scheduled/cancelled).
 * `published`/`failed` NÃO passam por aqui: o trigger recusa `authenticated` (caso
 * P7) e o serviço nem tenta — ver `publishCampaign`.
 */
export async function setCampaignStatus(
  id: string,
  status: WritableCampaignStatus,
  actor: CampaignActor,
  scheduledFor?: string | null,
): Promise<CampaignWriteResult> {
  const denied = gateWrite(actor)
  if (denied) return { ok: false, error: denied }
  if (status === 'scheduled' && !scheduledFor) {
    return { ok: false, error: 'Escolha a data e a hora para agendar a campanha.' }
  }

  const patch = {
    status,
    scheduled_for: status === 'scheduled' ? scheduledFor! : null,
  }

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update(patch)
    .eq('id', id)
    .select(CAMPAIGN_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeCampaignDbError(error) }
  if (!data) return { ok: false, error: CAMPAIGN_NOT_FOUND }
  return { ok: true, campaign: data as unknown as Campaign }
}

/**
 * Publicar de verdade exige confirmação real do provedor (OAuth + backend + tokens),
 * que não existe neste ambiente. O serviço NUNCA escreve `published`: devolve sempre
 * "não conectado". Assim a tela jamais mostra uma campanha como publicada sem o
 * provedor ter confirmado — o mesmo princípio do trigger P7 no banco.
 */
export async function publishCampaign(): Promise<CampaignWriteResult> {
  return { ok: false, error: CAMPAIGN_PUBLISH_NOT_CONNECTED }
}

function gateWrite(actor: CampaignActor): string | null {
  return can(actor.role, 'marketing.manage') ? null : CAMPAIGN_MANAGE_DENIED
}

/** Vazio vira null: é o que a coluna guarda e o que a tela mostra como "—". */
function cleanText(value?: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function dedupe(networks: CampaignNetwork[]): CampaignNetwork[] {
  return Array.from(new Set(networks))
}

function pickKeys(row: object, columns: readonly string[]): Record<string, unknown> {
  const source = row as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = source[column]
  return out
}

function describeCampaignDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      // Pode ser a RLS (sem marketing.manage) ou o trigger de publicação. O serviço
      // nunca tenta publicar, então na prática é a RLS; a distinção fica registrada.
      if (error.message.includes('confirmacao real do provedor')) return CAMPAIGN_PUBLISH_NOT_CONNECTED
      return CAMPAIGN_MANAGE_DENIED
    case '23514':
      return 'Rede ou status fora do conjunto permitido. Revise as redes selecionadas.'
    case '23503':
      return 'Igreja ou evento não encontrado. Atualize a lista e tente de novo.'
    default:
      return error.message
  }
}
