// Tipos de domínio do IgrejaConecta (Fase 1+).
// Espelham as tabelas descritas nas migrações SQL em /supabase/migrations.

export type RoleKey =
  | 'superadmin'
  | 'church_admin'
  | 'manager'
  | 'communicator'
  | 'pastor'
  | 'visitor'

export type ApprovalStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'suspended'

export type ChurchStatus = 'active' | 'inactive'

export type EventStatus = 'draft' | 'scheduled' | 'published' | 'cancelled' | 'finished'

export type EventVisibility = 'public' | 'private' | 'unlisted'

export interface Profile {
  id: string
  full_name: string
  email: string
  phone?: string | null
  avatar_url?: string | null
  created_at: string
  updated_at: string
}

export interface Role {
  id: string
  key: RoleKey
  name: string
  description: string
}

export interface Church {
  id: string
  name: string
  slug: string
  description?: string | null
  denomination?: string | null
  logo_url?: string | null
  cover_url?: string | null
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  website?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  lat?: number | null
  lng?: number | null
  status: ChurchStatus
  approval_status: ApprovalStatus
  /** Quem cadastrou a igreja (0001). Só leitura: nenhuma tela escreve nesta coluna. */
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface ChurchMember {
  id: string
  church_id: string
  user_id: string
  role_id: string
  role?: RoleKey
  status: 'active' | 'invited' | 'blocked'
  created_at: string
  user?: Profile
}

/**
 * Linha da view `church_roster` (migração 0007): quem é da igreja, com o papel
 * dela. `email`/`phone` chegam null quando quem consulta não tem 'members.manage'
 * — a view mascara, o frontend não decide isso.
 */
export interface RosterEntry {
  member_id: string
  church_id: string
  user_id: string
  full_name: string
  avatar_url?: string | null
  role_key: RoleKey
  role_name: string
  membership_status: 'active' | 'invited' | 'blocked'
  email: string | null
  phone: string | null
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

/**
 * Linha de `church_invitations` (migração 0008). O convite existe antes de quem o
 * recebe ter conta — por isso ele não é uma linha de `church_members`.
 */
export interface ChurchInvitation {
  id: string
  church_id: string
  email: string
  role_key: RoleKey
  status: InvitationStatus
  invited_by?: string | null
  expires_at: string
  created_at: string
}

/** Resultado de `pending_invitations_for_me()`: convite + igreja + papel resolvidos. */
export interface InvitationForMe extends ChurchInvitation {
  church_name: string
  church_slug: string
  role_name: string
}

/**
 * Igreja associada à conta, do jeito que as telas consomem: nome + papel. Vem do
 * embed `church_members -> churches`, então o que se vê é o que a RLS de `churches`
 * devolve para esta pessoa (a própria igreja, mesmo ainda não aprovada).
 */
export interface MemberChurch {
  church_id: string
  name: string
  city?: string | null
  state?: string | null
  approval_status: ApprovalStatus
  role_key: RoleKey
}

/**
 * Diretório global de usuários do SuperAdmin (Fase 8). Uma linha por **vínculo**
 * (`church_members`), não por pessoa: quem é de duas igrejas aparece duas vezes,
 * com o papel de cada uma. É a forma que a RLS já devolve ao SuperAdmin —
 * `church_members_read` e `profiles_self_read` têm o ramo `is_superadmin()` —,
 * limitada pela projeção `PLATFORM_USER_SELECT` do `adminService`. O nome e o
 * e-mail vêm do `profiles` embutido; sem vínculo confirmado (`churches` nulo) a
 * linha não aparece, como em `fetchMyChurches`.
 */
export interface PlatformUser {
  user_id: string
  name: string
  email: string | null
  role: RoleKey
  church_id: string
  church_name: string | null
  status: ChurchMember['status']
}

/**
 * Filial / congregação (0013). É dado de **gestão**: a leitura vale para membro
 * ativo da própria igreja e para o SuperAdmin, e `anon` não tem grant nenhum — o
 * mapa público plota igrejas (`churches.lat/lng`), não filiais. Sem delete: a
 * tela não oferece excluir porque a tabela não tem política nem grant de delete.
 */
export interface ChurchBranch {
  id: string
  church_id: string
  name: string
  address?: string | null
  city?: string | null
  state?: string | null
  lat?: number | null
  lng?: number | null
  leader?: string | null
}

/** Shape da view `ministry_list` (0015): líder por uuid + nome, contagem no banco. */
export interface Ministry {
  id: string
  church_id: string
  type: 'ministry' | 'department' | 'team'
  name: string
  description?: string | null
  leader_id?: string | null
  leader_name?: string | null
  members_count: number
  created_at?: string
  updated_at?: string
}

export interface EventCategory {
  id: string
  name: string
  slug: string
  custom?: boolean
}

export interface ChurchEvent {
  id: string
  slug: string
  name: string
  description?: string | null
  category_id: string
  category?: string
  church_id: string
  church_name?: string
  branch_id?: string | null
  latitude?: number | null
  longitude?: number | null
  starts_at: string
  ends_at?: string | null
  address?: string | null
  city?: string | null
  cover_url?: string | null
  capacity?: number | null
  is_free: boolean
  visibility: EventVisibility
  status: EventStatus
}

/**
 * Igreja organizadora do evento, do jeito que a página pública a mostra. Vem do
 * embed `events -> churches`, então o que aparece é o que a RLS de `churches`
 * devolve para quem consulta — nada, se a igreja saiu do ar (e nesse caso o
 * evento também não aparece).
 */
export interface EventOrganizer {
  id: string
  name: string
  slug: string
  denomination?: string | null
  city?: string | null
  state?: string | null
  whatsapp?: string | null
}

/**
 * Evento na leitura pública: sem `visibility`, que é intenção da igreja e não
 * dado do visitante (a projeção `EVENTS_PUBLIC_COLUMNS` não a pede), e com a
 * organizadora resolvida pelo embed.
 */
export type PublicEvent = Omit<ChurchEvent, 'visibility'> & { church?: EventOrganizer | null }

export type RegistrationStatus = 'pending' | 'confirmed' | 'waitlist' | 'cancelled' | 'checked_in'

/**
 * Inscrição em evento (0012). Os campos que o mock não preenche são opcionais
 * porque só existem no banco real: `church_id` é derivado do evento por trigger,
 * `user_id` só é preenchido quando o visitante tem conta, e `ticket_code` só é
 * lido por quem tem `registrations.manage` (ou pelo dono da linha).
 */
export interface Registration {
  id: string
  event_id: string
  church_id?: string
  user_id?: string | null
  visitor_name: string
  visitor_email: string
  visitor_phone?: string | null
  status: RegistrationStatus
  ticket_code?: string
  checked_in_at?: string | null
  created_at: string
  /** Nome do evento, resolvido pelo embed `events` — não é coluna da tabela. */
  event_name?: string
  /** Slug do mesmo embed: a rota pública é `/eventos/:slug`, não por id. */
  event_slug?: string
}

/**
 * Agregados por evento da view `event_registration_stats`. É a única leitura de
 * inscrições que o visitante anon pode fazer: só números, nenhum dado pessoal.
 * `spots_left` é null quando o evento não tem capacidade definida.
 */
export interface RegistrationStats {
  event_id: string
  church_id: string
  capacity: number | null
  pending_count: number
  confirmed_count: number
  waitlist_count: number
  checked_in_count: number
  cancelled_count: number
  active_count: number
  spots_left: number | null
}

export interface Campaign {
  id: string
  church_id: string
  event_id?: string | null
  name: string
  message?: string | null
  networks: CampaignNetwork[]
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'cancelled'
  scheduled_for?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/**
 * Redes de PERFIL da igreja — o mesmo conjunto do CHECK de
 * `church_social_accounts.network` (0015). YouTube está aqui e não está em
 * campanha de propósito: o banco aceita o perfil e recusa a divulgação.
 */
export type SocialNetwork = 'instagram' | 'facebook' | 'whatsapp' | 'youtube'

/**
 * Redes de CAMPANHA — o CHECK de `marketing_campaigns.networks` depois da 0020,
 * que tirou o TikTok. É tipo separado de `SocialNetwork` porque os conjuntos não
 * são iguais; unificá-los faria a tela oferecer uma rede que o banco recusa.
 */
export type CampaignNetwork = 'instagram' | 'facebook' | 'whatsapp'

/**
 * Linha de `church_social_accounts` (0015). `connected` não é editável pelo app:
 * o trigger `enforce_social_connection` recusa com `42501`, e o único caminho
 * para `true` é um backend que falou com o provedor.
 */
export interface ChurchSocialAccount {
  id: string
  church_id: string
  network: SocialNetwork
  handle: string
  connected: boolean
}

/** Os interesses aceitos pelo CHECK de `visitor_preferences.interests` (0016). */
export type VisitorInterest = 'jovens' | 'familia' | 'mulheres' | 'homens' | 'acao_social'

/**
 * Preferência do visitante (0016): uma linha por conta e só a própria conta
 * alcança. `city` é dado de preferência — nome, e-mail e telefone ficam em
 * `profiles`, que é de identidade e tem fluxo próprio.
 */
export interface VisitorPreferences {
  user_id: string
  city: string | null
  interests: VisitorInterest[]
  updated_at: string
}

/**
 * Favorito do visitante (0016). A chave é o par (conta, evento): não há id
 * próprio e não há update — o grant da tabela é select/insert/delete.
 */
export interface VisitorFavorite {
  user_id: string
  event_id: string
  created_at: string
}

export interface AIGeneration {
  id: string
  kind: 'text' | 'image' | 'video' | 'campaign'
  prompt: string
  status: 'done' | 'processing' | 'failed' | 'approved'
  created_at: string
}

export interface AuditLog {
  id: string
  actor: string
  action: string
  target: string
  church?: string | null
  metadata?: Record<string, unknown>
  created_at: string
}
