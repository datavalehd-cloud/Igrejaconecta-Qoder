import { supabase } from '@/services/supabase/client'
import { can } from '@/utils/rbac'
import type { Registration, RegistrationStats, RoleKey } from '@/types'

/**
 * Inscrições (Fase 3, passo 2): escrever como visitante, listar como equipe,
 * contar para todo mundo.
 *
 * Três audiências diferentes, três fontes diferentes — e nenhuma delas é a mesma
 * tabela lida de qualquer jeito:
 *   * o visitante **escreve** por `register_for_event` (RPC SECURITY DEFINER).
 *     `event_registrations` não tem política de insert nem grant de escrita, então
 *     não existe caminho direto;
 *   * o visitante **lê** só agregados, pela view `event_registration_stats` —
 *     nome, e-mail e telefone de inscrito não são leitura pública (LGPD);
 *   * a equipe lê as linhas inteiras, e é a RLS (`registrations.manage`) que
 *     decide. Comunicador tem `events.manage` sem `registrations.manage`: vê a
 *     contagem, não vê a lista.
 *
 * O `ticket_code` nunca é devolvido pela RPC de inscrição: quem digitou o e-mail
 * ainda não provou que é dono dele. O código aparece só na lista da equipe e para
 * o dono confirmado da linha — por isso a tela pública mostra o estado
 * (confirmado / lista de espera) e não um ingresso.
 *
 * O `can(role, 'registrations.manage')` que aparece aqui é a primeira camada, a que
 * evita consulta e RPC condenadas; a guarda é a do banco (grupo N da suíte). As
 * frases batem com as que os RPCs devolvem, para a tela dizer o mesmo dos dois lados.
 */

export interface RegistrationResult {
  ok: boolean
  /** Estado gravado: `confirmed` ou `waitlist`. */
  status?: 'confirmed' | 'waitlist'
  error?: string
}

export interface WriteResult {
  ok: boolean
  error?: string
}

/** Projeção da lista da equipe. Como em `churchService`, o que limita as colunas
 * que chegam ao navegador é este `select`: a RLS é por linha, não por coluna. */
export const REGISTRATION_COLUMNS = [
  'id',
  'event_id',
  'church_id',
  'user_id',
  'visitor_name',
  'visitor_email',
  'visitor_phone',
  'status',
  'ticket_code',
  'checked_in_at',
  'created_at',
] as const satisfies readonly (keyof Registration)[]

export const REGISTRATION_EVENT_EMBED = 'events(id, name, slug, starts_at)'

export const REGISTRATION_SELECT = [...REGISTRATION_COLUMNS, REGISTRATION_EVENT_EMBED]

/** Agregados da view pública: nenhuma coluna com dado pessoal entra aqui. */
export const STATS_COLUMNS = [
  'event_id',
  'church_id',
  'capacity',
  'pending_count',
  'confirmed_count',
  'waitlist_count',
  'checked_in_count',
  'cancelled_count',
  'active_count',
  'spots_left',
] as const satisfies readonly (keyof RegistrationStats)[]

/** Códigos de `register_for_event` → texto da tela. */
export const REGISTER_MESSAGES: Record<string, string> = {
  confirmed: 'Inscrição confirmada. A equipe da igreja tem o seu código para o check-in no dia.',
  waitlist: 'O evento lotou: você entrou na lista de espera. Se abrir vaga, a igreja promove a sua inscrição.',
  ja_inscrita: 'Este e-mail já está inscrito neste evento.',
  evento_indisponivel: 'Este evento não está disponível para inscrição.',
  evento_encerrado: 'As inscrições para este evento já foram encerradas.',
  dados_invalidos: 'Confira o nome (mínimo 2 letras) e um e-mail válido.',
}

/** Códigos de `check_in_registration`. */
export const CHECK_IN_MESSAGES: Record<string, string> = {
  presente: 'Check-in registrado.',
  ja_presente: 'Esta pessoa já estava registrada como presente.',
  cancelada: 'Esta inscrição foi cancelada.',
  sem_permissao: 'Você não tem a permissão “Gerenciar inscrições” nesta igreja.',
}

/** Códigos de `cancel_event_registration`. */
export const CANCEL_MESSAGES: Record<string, string> = {
  cancelada: 'Inscrição cancelada.',
  cancelada_com_promocao: 'Inscrição cancelada — a próxima pessoa da lista de espera foi confirmada.',
  ja_cancelada: 'Esta inscrição já estava cancelada.',
  sem_permissao: 'Você não tem a permissão “Gerenciar inscrições” nesta igreja.',
}

type RegistrationRow = Registration & { events: { id: string; name: string; slug: string; starts_at: string } | null }

// -- lista da equipe ----------------------------------------------------------

export async function fetchChurchRegistrations(churchId?: string, role?: RoleKey): Promise<Registration[]> {
  if (!churchId || !can(role, 'registrations.manage')) return []
  const { data, error } = await supabase
    .from('event_registrations')
    .select(REGISTRATION_SELECT.join(','))
    .eq('church_id', churchId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(describeDbError(error))
  return ((data ?? []) as unknown as RegistrationRow[]).map(toRegistration)
}

// -- histórico do próprio visitante -------------------------------------------

/**
 * "Minhas inscrições" de `/visitante/perfil`. A fonte é a mesma tabela da lista da
 * equipe, mas o recorte é o id da sessão: `event_registrations_read` (0012) libera
 * a linha por `user_id = auth.uid()` — e `user_id` só é preenchido pela RPC quando
 * quem se inscreveu estava logado. Recortar pelo e-mail digitado no formulário
 * seria dizer que alguém é dono de uma linha que nunca provou ser sua.
 */
export async function fetchMyRegistrations(userId?: string): Promise<Registration[]> {
  if (!userId) return []
  const { data, error } = await supabase
    .from('event_registrations')
    .select(REGISTRATION_SELECT.join(','))
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(describeDbError(error))
  return ((data ?? []) as unknown as RegistrationRow[]).map(toRegistration)
}

// -- contagem -----------------------------------------------------------------

/**
 * Estatísticas por evento. A audiência é decidida pela view: o visitante recebe
 * só os eventos no ar, o membro recebe os da própria igreja e o SuperAdmin todos.
 * Pedir sem filtro é seguro justamente por isso — o recorte não é a guarda.
 */
export async function fetchRegistrationStats(): Promise<RegistrationStats[]> {
  const { data, error } = await supabase
    .from('event_registration_stats')
    .select(STATS_COLUMNS.join(','))
  if (error) throw new Error(describeDbError(error))
  return (data ?? []) as unknown as RegistrationStats[]
}

// -- inscrição do visitante ---------------------------------------------------

export async function registerForEvent(input: {
  eventId: string
  name: string
  email: string
  phone?: string
}): Promise<RegistrationResult> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (name.length < 2 || !email.includes('@')) {
    return { ok: false, error: REGISTER_MESSAGES.dados_invalidos }
  }

  const { data, error } = await supabase.rpc('register_for_event', {
    p_event: input.eventId,
    p_name: name,
    p_email: email,
    p_phone: input.phone?.trim() || null,
  })
  if (error) return { ok: false, error: describeDbError(error) }
  const code = String(data)
  if (code === 'confirmed' || code === 'waitlist') return { ok: true, status: code }
  return { ok: false, error: REGISTER_MESSAGES[code] ?? 'Não foi possível concluir a inscrição.' }
}

// -- check-in e cancelamento --------------------------------------------------

export async function checkInRegistration(id: string, actorRole?: RoleKey): Promise<WriteResult> {
  if (!can(actorRole, 'registrations.manage')) return { ok: false, error: CHECK_IN_MESSAGES.sem_permissao }
  const { data, error } = await supabase.rpc('check_in_registration', { p_registration: id })
  if (error) return { ok: false, error: describeDbError(error) }
  const code = String(data)
  return code === 'presente'
    ? { ok: true }
    : { ok: false, error: CHECK_IN_MESSAGES[code] ?? 'Não foi possível registrar o check-in.' }
}

export async function cancelRegistration(id: string, actorRole?: RoleKey): Promise<WriteResult> {
  if (!can(actorRole, 'registrations.manage')) return { ok: false, error: CANCEL_MESSAGES.sem_permissao }
  const { data, error } = await supabase.rpc('cancel_event_registration', { p_registration: id })
  if (error) return { ok: false, error: describeDbError(error) }
  const code = String(data)
  return code === 'cancelada' || code === 'cancelada_com_promocao'
    ? { ok: true, error: code === 'cancelada_com_promocao' ? CANCEL_MESSAGES.cancelada_com_promocao : undefined }
    : { ok: false, error: CANCEL_MESSAGES[code] ?? 'Não foi possível cancelar a inscrição.' }
}

// -- helpers ------------------------------------------------------------------

function toRegistration(row: RegistrationRow): Registration {
  const { events: event, ...registration } = row
  return { ...registration, event_name: event?.name, event_slug: event?.slug }
}

function describeDbError(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Sem permissão para esta ação na sua igreja.'
  if (error.code === '23505') return 'Este e-mail já está inscrito neste evento.'
  return error.message
}
