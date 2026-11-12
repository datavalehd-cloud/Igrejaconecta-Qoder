import { demoAccounts, signIn, signUp, recoverPassword, verifyMfa, type DemoAccount } from './authService'
import { members } from '@/data/mock'
import type { AuthBackend, Session } from './authTypes'

const SESSION_KEY = 'igrejaconecta.demo.session'

function toSession(account: DemoAccount): Session {
  return { profile: account.profile, role: account.role, churchId: account.churchId, mfaEnrolled: account.mfaRequired, mfaVerified: true }
}

/**
 * O demo espelha o backend real: papel e igreja saem do vínculo ativo na loja, não
 * de uma foto tirada no login. Sem isto, quem cadastra a igreja pelo onboarding
 * continua "sem igreja" — o vínculo novo existe em `members`, mas a sessão
 * guardada no sessionStorage ainda diz que não. SuperAdmin é global e não tem
 * igreja, igual em `supabaseBackend`.
 */
function refresh(session: Session): Session {
  if (session.role === 'superadmin') return { ...session, churchId: undefined }
  const vinculo = members.find((m) => m.user_id === session.profile.id && m.status === 'active')
  if (!vinculo) return session
  return { ...session, churchId: vinculo.church_id, role: vinculo.role ?? session.role }
}

function readStored(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function createDemoBackend(): AuthBackend {
  const listeners = new Set<(s: Session | null) => void>()
  let current: Session | null = readStored()
  let pendingMfa: DemoAccount | null = null

  function emit(session: Session | null) {
    current = session
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(SESSION_KEY)
    listeners.forEach((cb) => cb(session))
  }

  return {
    mode: 'demo',
    async restore() {
      if (!current) return null
      current = refresh(current)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(current))
      return current
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async login(email, password) {
      const res = await signIn(email, password)
      if (!res.ok) return { ok: false, error: res.error }
      if (res.requiresMfa && res.account) {
        pendingMfa = res.account
        return { ok: true, requiresMfa: true }
      }
      if (res.account) emit(toSession(res.account))
      return { ok: true, role: res.account?.role }
    },
    async verifyMfa(code) {
      if (!pendingMfa) return { ok: false, error: 'Nenhum desafio MFA ativo.' }
      const res = await verifyMfa(pendingMfa, code)
      if (!res.ok) return { ok: false, error: res.error }
      emit(toSession(pendingMfa))
      const role = pendingMfa.role
      pendingMfa = null
      return { ok: true, role }
    },
    async register(fullName, email, password) {
      const res = await signUp(fullName, email, password)
      return { ok: res.ok, error: res.error, needsConfirmation: res.ok }
    },
    async recover(email) {
      const res = await recoverPassword(email)
      return { ok: res.ok }
    },
    async logout() {
      pendingMfa = null
      emit(null)
    },
    switchDemo(email) {
      const account = demoAccounts.find((a) => a.email === email)
      if (account) emit(toSession(account))
    },
  }
}
