import { supabase } from '@/services/supabase/client'
import { notePermissionDenied } from '@/services/data/securityService'

/**
 * Suporte (M5, migração 0018). A conversa mora em duas tabelas e a audiência em
 * uma função só (`can_read_ticket`): quem abriu, quem gerencia a igreja do
 * chamado e o SuperAdmin. O serviço não repete essa régua — ele só escolhe as
 * colunas e as mensagens; quem decide se a linha existe é o banco.
 *
 * O que não existe aqui, de propósito: delete de ticket ou de mensagem
 * (suporte é trilha) e ticket anônimo (`anon` não tem grant nenhum na 0018).
 */

export const SUPPORT_TICKET_LIST_COLUMNS = [
  'id', 'church_id', 'opened_by', 'opened_by_name', 'church_name',
  'subject', 'status', 'created_at', 'updated_at', 'messages_count', 'last_message',
] as const

export const SUPPORT_MESSAGE_COLUMNS = ['id', 'ticket_id', 'author_id', 'body', 'created_at'] as const

export type SupportTicketStatus = 'open' | 'answered' | 'closed'

export interface SupportTicketRow {
  id: string
  church_id: string | null
  opened_by: string
  opened_by_name: string | null
  church_name: string | null
  subject: string
  status: SupportTicketStatus
  created_at: string
  updated_at: string
  messages_count: number
  last_message: string | null
}

export interface SupportMessageRow {
  id: string
  ticket_id: string
  author_id: string
  body: string
  created_at: string
}

export interface SupportActor {
  userId?: string
  churchId?: string
  role?: string
}

export const SUPPORT_SUBJECT_REQUIRED = 'Descreva o assunto do chamado em pelo menos 3 caracteres.'
export const SUPPORT_BODY_REQUIRED = 'Escreva a mensagem do chamado: é por ela que o atendimento responde.'
export const SUPPORT_NO_ACTOR = 'Sem sessão não há chamado: o ticket precisa de autor para ter resposta.'

export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: 'Aberto',
  answered: 'Respondido',
  closed: 'Fechado',
}

function validateSubject(subject: string): string | null {
  const text = subject.trim()
  return text.length >= 3 && text.length <= 200 ? null : SUPPORT_SUBJECT_REQUIRED
}

function validateBody(body: string): string | null {
  const text = body.trim()
  return text.length >= 1 && text.length <= 4000 ? null : SUPPORT_BODY_REQUIRED
}

/** A view já recorta por autor/igreja/SuperAdmin: aqui só ordena. */
export async function fetchSupportTickets(): Promise<SupportTicketRow[]> {
  const { data, error } = await supabase
    .from('support_ticket_list')
    .select(SUPPORT_TICKET_LIST_COLUMNS.join(','))
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as SupportTicketRow[]
}

export async function fetchSupportMessages(ticketId: string): Promise<SupportMessageRow[]> {
  const { data, error } = await supabase
    .from('support_messages')
    .select(SUPPORT_MESSAGE_COLUMNS.join(','))
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as SupportMessageRow[]
}

export type SupportWriteResult =
  | { ok: true; ticketId: string; error?: never }
  | { ok: false; error: string; ticketId?: never }

/**
 * Abrir chamado: o autor é a sessão (a 0018 recusa outro), e a igreja do assunto
 * só pode ser uma igreja da própria sessão — senão o chamado "sobre" a igreja do
 * vizinho vazaria pela leitura por igreja.
 */
export async function openSupportTicket(
  input: { subject: string; body: string },
  actor: SupportActor,
): Promise<SupportWriteResult> {
  if (!actor.userId) return { ok: false, error: SUPPORT_NO_ACTOR }
  const subject = validateSubject(input.subject)
  if (subject) return { ok: false, error: subject }
  const body = validateBody(input.body)
  if (body) return { ok: false, error: body }

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .insert({ opened_by: actor.userId, church_id: actor.churchId || null, subject: input.subject.trim() })
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '42501') notePermissionDenied('support_tickets.insert', actor.churchId)
    return { ok: false, error: describeSupportError(error) }
  }
  if (!ticket) return { ok: false, error: 'O banco não devolveu o chamado criado: nada foi aberto.' }

  const { error: messageError } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticket.id, author_id: actor.userId, body: input.body.trim() })
  if (messageError) {
    if (messageError.code === '42501') notePermissionDenied('support_messages.insert', actor.churchId)
    return { ok: false, error: `${describeSupportError(messageError)} O chamado ficou aberto sem a primeira mensagem.` }
  }
  return { ok: true, ticketId: ticket.id }
}

/**
 * Responder. Marcar `answered` é escrita no ticket e só autor/SuperAdmin têm
 * UPDATE: o atendente marca quando responde, o autor não muda o próprio status
 * por aqui (fecha e reabre são ações próprias da tela).
 */
export async function replySupportTicket(
  ticketId: string,
  body: string,
  actor: SupportActor,
): Promise<SupportWriteResult> {
  if (!actor.userId) return { ok: false, error: SUPPORT_NO_ACTOR }
  const text = validateBody(body)
  if (text) return { ok: false, error: text }

  const { error } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticketId, author_id: actor.userId, body: body.trim() })
  if (error) {
    if (error.code === '42501') notePermissionDenied('support_messages.insert', actor.churchId)
    return { ok: false, error: describeSupportError(error) }
  }
  if (actor.role === 'superadmin') {
    await supabase.from('support_tickets').update({ status: 'answered' }).eq('id', ticketId).eq('status', 'open')
  }
  return { ok: true, ticketId }
}

export async function setSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus,
  actor: SupportActor,
): Promise<SupportWriteResult> {
  if (!actor.userId) return { ok: false, error: SUPPORT_NO_ACTOR }
  const { data, error } = await supabase
    .from('support_tickets')
    .update({ status })
    .eq('id', ticketId)
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '42501') notePermissionDenied('support_tickets.update', actor.churchId)
    return { ok: false, error: describeSupportError(error) }
  }
  if (!data) return { ok: false, error: 'Só quem abriu o chamado ou o SuperAdmin fecha e reabre: o banco não confirmou a mudança.' }
  return { ok: true, ticketId }
}

function describeSupportError(error: { code?: string; message?: string }): string {
  if (error.code === '42501') {
    return 'O banco recusou a escrita: este chamado não é seu, ou a igreja dele não é uma igreja sua.'
  }
  if (error.code === '23514') return 'Algum campo está fora do permitido: assunto de 3 a 200 caracteres, mensagem de 1 a 4000.'
  return error.message ?? 'O banco recusou a operação de suporte.'
}
