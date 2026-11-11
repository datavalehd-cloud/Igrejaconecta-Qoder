import type { Profile, RoleKey } from '@/types'

export interface Session {
  profile: Profile
  role: RoleKey
  churchId?: string
  /** Possui fator TOTP verificado cadastrado. */
  mfaEnrolled?: boolean
  /** A sessão atual está em nível aal2 (MFA confirmado nesta sessão). */
  mfaVerified?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  requiresMfa?: boolean
  /** Papel da sessão criada — usado para decidir o destino pós-login. */
  role?: RoleKey
}

export interface RegisterResult {
  ok: boolean
  error?: string
  needsConfirmation?: boolean
}

export interface SimpleResult {
  ok: boolean
  error?: string
  role?: RoleKey
}

export interface MfaEnrollment {
  factorId: string
  secret: string
  uri: string
  /** QR Code em data-URI (SVG) para escanear no app autenticador. */
  qrCode: string
}

/**
 * Contrato único de autenticação. Duas implementações:
 *  - demoBackend: dados mockados (sem chaves no .env.local)
 *  - supabaseBackend: Supabase Auth real (quando configurado)
 * A UI (AuthContext + páginas) não sabe qual está ativa.
 */
export interface AuthBackend {
  mode: 'demo' | 'supabase'
  restore(): Promise<Session | null>
  subscribe(cb: (session: Session | null) => void): () => void
  login(email: string, password: string): Promise<LoginResult>
  verifyMfa(code: string): Promise<SimpleResult>
  register(fullName: string, email: string, password: string): Promise<RegisterResult>
  recover(email: string): Promise<SimpleResult>
  updatePassword?(password: string): Promise<SimpleResult>
  logout(): Promise<void>
  switchDemo?(email: string): void
  enrollMfa?(): Promise<SimpleResult & { enrollment?: MfaEnrollment }>
  verifyEnrollment?(factorId: string, code: string): Promise<SimpleResult>
}
