import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { demoAccounts, type DemoAccount } from '@/services/auth/authService'
import { createDemoBackend } from '@/services/auth/demoBackend'
import { createSupabaseBackend } from '@/services/auth/supabaseBackend'
import type { AuthBackend, LoginResult, MfaEnrollment, RegisterResult, Session, SimpleResult } from '@/services/auth/authTypes'
import { isSupabaseConfigured } from '@/services/supabase/client'

export type { Session } from '@/services/auth/authTypes'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  /** true enquanto a sessão inicial está sendo restaurada. */
  initializing: boolean
  isAuthenticated: boolean
  mode: 'demo' | 'supabase'
  login: (email: string, password: string) => Promise<LoginResult>
  confirmMfa: (code: string) => Promise<SimpleResult>
  register: (fullName: string, email: string, password: string) => Promise<RegisterResult>
  recover: (email: string) => Promise<SimpleResult>
  updatePassword: (password: string) => Promise<SimpleResult>
  logout: () => void
  /** Recurso de demonstração: alterna o papel ativo para explorar os painéis. */
  switchDemoRole: (email: string) => void
  demoAccounts: DemoAccount[]
  enrollMfa: () => Promise<SimpleResult & { enrollment?: MfaEnrollment }>
  verifyEnrollment: (factorId: string, code: string) => Promise<SimpleResult>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Com chaves no .env.local usa Supabase Auth real; sem chaves, modo demo.
const backend: AuthBackend = isSupabaseConfigured ? createSupabaseBackend() : createDemoBackend()

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    let active = true
    const unsubscribe = backend.subscribe((s) => {
      if (active) setSession(s)
    })
    backend
      .restore()
      .then((s) => {
        if (!active) return
        setSession((prev) => prev ?? s)
        setInitializing(false)
      })
      .catch(() => {
        if (active) setInitializing(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true)
    try {
      return await backend.login(email, password)
    } finally {
      setLoading(false)
    }
  }, [])

  const confirmMfa = useCallback(async (code: string) => {
    setLoading(true)
    try {
      return await backend.verifyMfa(code)
    } finally {
      setLoading(false)
    }
  }, [])

  const register = useCallback(async (fullName: string, email: string, password: string) => {
    setLoading(true)
    try {
      return await backend.register(fullName, email, password)
    } finally {
      setLoading(false)
    }
  }, [])

  const recover = useCallback(async (email: string) => {
    setLoading(true)
    try {
      return await backend.recover(email)
    } finally {
      setLoading(false)
    }
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    setLoading(true)
    try {
      return (await backend.updatePassword?.(password)) ?? { ok: true }
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    void backend.logout()
  }, [])

  const switchDemoRole = useCallback((email: string) => {
    backend.switchDemo?.(email)
  }, [])

  const enrollMfa = useCallback(async () => {
    return (await backend.enrollMfa?.()) ?? { ok: false, error: 'MFA disponível apenas com o Supabase conectado.' }
  }, [])

  const verifyEnrollment = useCallback(async (factorId: string, code: string) => {
    return (await backend.verifyEnrollment?.(factorId, code)) ?? { ok: false, error: 'MFA disponível apenas com o Supabase conectado.' }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      initializing,
      isAuthenticated: Boolean(session),
      mode: backend.mode,
      login,
      confirmMfa,
      register,
      recover,
      updatePassword,
      logout,
      switchDemoRole,
      demoAccounts,
      enrollMfa,
      verifyEnrollment,
    }),
    [session, loading, initializing, login, confirmMfa, register, recover, updatePassword, logout, switchDemoRole, enrollMfa, verifyEnrollment],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}