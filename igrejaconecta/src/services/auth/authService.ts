import type { Profile, RoleKey } from '@/types'

/**
 * Camada de autenticação. Em produção delega ao Supabase Auth; no modo demo
 * (sem chaves no .env.local) simula as operações para permitir navegar por
 * todas as telas e validar RBAC e isolamento entre igrejas.
 */

export interface DemoAccount {
  email: string
  password: string
  role: RoleKey
  churchId?: string
  profile: Profile
  mfaRequired: boolean
}

/**
 * Contas do modo demo. O comunicador está aqui de propósito: é o único papel com
 * `events.manage` sem `events.publish` e sem `registrations.manage`, então sem ele
 * as duas portas (publicar evento, ver inscrições) só existiriam nos testes.
 */
export const demoAccounts: DemoAccount[] = [
  {
    email: 'admin@igrejaconecta.app',
    password: 'demo1234',
    role: 'superadmin',
    mfaRequired: true,
    profile: { id: 'u0', full_name: 'Administrador Geral', email: 'admin@igrejaconecta.app', created_at: '2026-01-01', updated_at: '2026-01-01' },
  },
  {
    email: 'marcos@ibcentral.org.br',
    password: 'demo1234',
    role: 'church_admin',
    churchId: 'ch1',
    mfaRequired: true,
    profile: { id: 'u1', full_name: 'Marcos Lima', email: 'marcos@ibcentral.org.br', phone: '(12) 99999-0001', created_at: '2026-01-12', updated_at: '2026-01-12' },
  },
  {
    email: 'ana@ibcentral.org.br',
    password: 'demo1234',
    role: 'manager',
    churchId: 'ch1',
    mfaRequired: false,
    profile: { id: 'u2', full_name: 'Ana Souza', email: 'ana@ibcentral.org.br', created_at: '2026-02-03', updated_at: '2026-02-03' },
  },
  {
    email: 'paula@ibcentral.org.br',
    password: 'demo1234',
    role: 'communicator',
    churchId: 'ch1',
    mfaRequired: false,
    profile: { id: 'u5', full_name: 'Paula Diniz', email: 'paula@ibcentral.org.br', created_at: '2026-11-06', updated_at: '2026-11-06' },
  },
  {
    email: 'visitante@email.com',
    password: 'demo1234',
    role: 'visitor',
    mfaRequired: false,
    profile: { id: 'u9', full_name: 'Visitante Demo', email: 'visitante@email.com', created_at: '2026-11-01', updated_at: '2026-11-01' },
  },
]

export interface AuthResult {
  ok: boolean
  error?: string
  requiresMfa?: boolean
  account?: DemoAccount
}

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms))

export async function signIn(email: string, password: string): Promise<AuthResult> {
  await delay()
  const account = demoAccounts.find((a) => a.email.toLowerCase() === email.trim().toLowerCase())
  if (!account || account.password !== password) {
    return { ok: false, error: 'E-mail ou senha inválidos.' }
  }
  if (account.mfaRequired) {
    return { ok: true, requiresMfa: true, account }
  }
  return { ok: true, account }
}

export async function verifyMfa(account: DemoAccount, code: string): Promise<AuthResult> {
  await delay()
  // No demo, qualquer código de 6 dígitos é aceito.
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Informe um código de 6 dígitos.' }
  }
  return { ok: true, account }
}

export async function signUp(fullName: string, email: string, _password: string): Promise<{ ok: boolean; error?: string }> {
  await delay()
  if (!fullName.trim() || !email.includes('@')) {
    return { ok: false, error: 'Preencha nome e um e-mail válido.' }
  }
  return { ok: true }
}

export async function recoverPassword(_email: string): Promise<{ ok: boolean }> {
  await delay()
  return { ok: true }
}
