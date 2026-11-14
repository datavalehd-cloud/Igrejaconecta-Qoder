import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'
import type { Profile, RoleKey } from '@/types'
import type { AuthBackend, Session } from './authTypes'

const ROLE_KEYS: RoleKey[] = ['superadmin', 'church_admin', 'manager', 'communicator', 'pastor', 'visitor']

interface MembershipRow {
  church_id: string
  roles: { key: string } | null
}

function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha inválidos.'
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.'
  if (/rate limit|too many requests/i.test(message)) return 'Muitas tentativas. Aguarde um instante e tente novamente.'
  if (/password/i.test(message) && /at least/i.test(message)) return 'A senha deve ter pelo menos 8 caracteres.'
  return message
}

/**
 * Auth real via Supabase (anon key + RLS). O perfil e o papel vêm do banco
 * (profiles + church_members/roles); o isolamento multi-igreja é garantido
 * pelas políticas RLS, nunca por este código. service_role nunca é usado.
 */
export function createSupabaseBackend(): AuthBackend {
  const client: SupabaseClient = supabase

  const listeners = new Set<(s: Session | null) => void>()
  // Fator aguardando o código de 6 dígitos na tela de login.
  let pendingFactorId: string | null = null

  function emit(session: Session | null) {
    listeners.forEach((cb) => cb(session))
  }

  async function loadSession(sb: SupabaseSession): Promise<Session> {
    const userId = sb.user.id

    const { data: profileRow } = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
    const now = new Date().toISOString()
    const profile: Profile = (profileRow as Profile | null) ?? {
      id: userId,
      full_name: (sb.user.user_metadata?.full_name as string | undefined) ?? '',
      email: sb.user.email ?? '',
      created_at: sb.user.created_at ?? now,
      updated_at: sb.user.created_at ?? now,
    }

    const { data: membershipRows } = await client
      .from('church_members')
      .select('church_id, roles(key)')
      .eq('user_id', userId)
      .eq('status', 'active')
    const memberships = (membershipRows ?? []) as unknown as MembershipRow[]

    // SuperAdmin é global; caso contrário usa a primeira associação ativa.
    const active = memberships.find((m) => m.roles?.key === 'superadmin') ?? memberships[0]
    const roleKey = active?.roles?.key
    const role: RoleKey = ROLE_KEYS.includes(roleKey as RoleKey) ? (roleKey as RoleKey) : 'visitor'

    const { data: factors } = await client.auth.mfa.listFactors()
    const mfaEnrolled = Boolean(factors?.totp?.some((f) => f.status === 'verified'))
    const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel()

    return {
      profile,
      role,
      churchId: role === 'superadmin' ? undefined : active?.church_id,
      mfaEnrolled,
      mfaVerified: aal?.currentLevel === 'aal2',
    }
  }

  return {

    async restore() {
      const { data } = await client.auth.getSession()
      if (!data.session) return null
      return loadSession(data.session)
    },

    subscribe(cb) {
      listeners.add(cb)
      const { data } = client.auth.onAuthStateChange((event, sbSession) => {
        if (event === 'SIGNED_OUT') {
          pendingFactorId = null
          emit(null)
          return
        }
        // Enquanto o desafio MFA está pendente a UI permanece não autenticada.
        if (pendingFactorId || !sbSession) return
        // Consultas ao banco fora do callback para não travar o lock do auth.
        void loadSession(sbSession).then(emit).catch(() => undefined)
      })
      return () => {
        listeners.delete(cb)
        data.subscription.unsubscribe()
      }
    },

    async login(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error || !data.session) return { ok: false, error: translateAuthError(error?.message ?? 'Falha no login.') }

      const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: factors } = await client.auth.mfa.listFactors()
        const factor = factors?.totp?.find((f) => f.status === 'verified')
        if (factor) {
          // O desafio é criado dentro de challengeAndVerify(), na confirmação.
          pendingFactorId = factor.id
          return { ok: true, requiresMfa: true }
        }
        // Sem fator verificado: entra em aal1 e a ativação é exigida no perfil.
      }

      const session = await loadSession(data.session)
      emit(session)
      return { ok: true, role: session.role }
    },

    async verifyMfa(code) {
      if (!pendingFactorId) return { ok: false, error: 'Nenhum desafio MFA ativo. Entre novamente.' }
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: pendingFactorId, code })
      if (error) return { ok: false, error: 'Código inválido ou expirado.' }
      pendingFactorId = null
      const { data } = await client.auth.getSession()
      if (!data.session) return { ok: false, error: 'Sessão expirada. Entre novamente.' }
      const session = await loadSession(data.session)
      emit(session)
      return { ok: true, role: session.role }
    },

    async register(fullName, email, password) {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      })
      if (error) return { ok: false, error: translateAuthError(error.message) }
      // Supabase retorna identities vazio quando o e-mail já existe (anti-enumeração).
      if (data.user && data.user.identities?.length === 0) {
        return { ok: false, error: 'Este e-mail já está cadastrado.' }
      }
      return { ok: true, needsConfirmation: !data.session }
    },

    async recover(email) {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      })
      if (error) return { ok: false, error: translateAuthError(error.message) }
      return { ok: true }
    },

    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password })
      if (error) return { ok: false, error: translateAuthError(error.message) }
      return { ok: true }
    },

    async logout() {
      pendingFactorId = null
      await client.auth.signOut()
      emit(null)
    },

    async enrollMfa() {
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'IgrejaConecta' })
      if (error || !data) return { ok: false, error: 'Não foi possível iniciar a ativação do MFA.' }
      return {
        ok: true,
        enrollment: { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qrCode: data.totp.qr_code },
      }
    },

    async verifyEnrollment(factorId, code) {
      // challengeAndVerify cria o desafio e confirma o código em uma chamada;
      // ao concluir, o fator passa a 'verified' e a sessão sobe para aal2.
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code })
      if (error) return { ok: false, error: 'Código inválido. Confira o app autenticador e tente novamente.' }
      const { data } = await client.auth.getSession()
      if (data.session) emit(await loadSession(data.session))
      return { ok: true }
    },
  }
}