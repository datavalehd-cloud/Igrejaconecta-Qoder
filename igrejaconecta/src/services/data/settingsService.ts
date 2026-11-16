import { supabase } from '@/services/supabase/client'
import type { RoleKey } from '@/types'

/**
 * `system_settings` (0001), a mesa de parâmetros da plataforma. A cerca não é
 * nova: `system_settings_read`/`_write` (0002) só abrem para `is_superadmin()`,
 * e a suíte SQL já mede isso (A4, B6, B7, C12). O gate daqui é a primeira
 * camada — quem não é SuperAdmin nem dispara consulta — e a política é a
 * segunda; nenhuma das duas depende da outra.
 *
 * O serviço guarda e devolve o que está no banco, e nada além disso. Estes
 * valores são DECLARAÇÃO, não comportamento: o cadastro de igreja é sempre
 * livre com aprovação (nenhuma tela lê `church_signup` para decidir), o MFA é
 * exigido pelo código (`MFA_REQUIRED_ROLES`), e nenhum job expurga a trilha.
 * A UI tem que dizer isso em voz alta — um campo editável que a tela troca por
 * "ligado" sem o aplicativo obedecer seria uma funcionalidade de fachada.
 */

export const SETTING_COLUMNS = ['key', 'value', 'updated_at'] as const

export const PLATFORM_SETTING_KEY = 'platform'
export const PRIVACY_SETTING_KEY = 'privacy'
export type SettingKey = typeof PLATFORM_SETTING_KEY | typeof PRIVACY_SETTING_KEY

export const SETTINGS_DENIED =
  'Configurações do sistema são lidas e gravadas apenas pelo SuperAdmin da plataforma.'
export const SETTINGS_NOT_SAVED =
  'O banco não devolveu a linha salva. Nada foi confirmado — recarregue e tente de novo.'
export const SETTINGS_NAME_INVALID = 'Informe o nome da plataforma (de 2 a 120 caracteres).'

export const CHURCH_SIGNUP_OPTIONS = ['free', 'invite'] as const
export const AUDIT_RETENTION_OPTIONS = [12, 24, 60] as const
export const LOCATION_STORAGE_OPTIONS = ['none', '30d', '90d'] as const

export type ChurchSignup = (typeof CHURCH_SIGNUP_OPTIONS)[number]
export type LocationStorage = (typeof LOCATION_STORAGE_OPTIONS)[number]

export interface SystemSettingRow {
  key: string
  value: Record<string, unknown>
  updated_at: string
}

export interface PlatformSettings {
  name: string | null
  churchSignup: ChurchSignup
  mfaRequired: string[]
  updatedAt: string
}

export interface PrivacySettings {
  auditRetentionMonths: number | null
  locationSearchStorage: LocationStorage
  communicationOptIn: boolean | null
  updatedAt: string
}

export interface PlatformDraft {
  name: string
  churchSignup: ChurchSignup
  mfaRequired: string[]
}

export interface PrivacyDraft {
  auditRetentionMonths: number | null
  locationSearchStorage: LocationStorage
  communicationOptIn: boolean | null
}

/** Leitura da mesa. Sem linha nenhuma é estado legítimo (seed não aplicado). */
export async function fetchSystemSettings(role?: RoleKey): Promise<SystemSettingRow[]> {
  if (role !== 'superadmin') return []
  const { data, error } = await supabase
    .from('system_settings')
    .select(SETTING_COLUMNS.join(','))
    .order('key')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as SystemSettingRow[]
}

export type SettingsWriteResult =
  | { ok: true; setting: SystemSettingRow; error?: never }
  | { ok: false; error: string; setting?: never }

/**
 * Upsert por chave primária (`on conflict key`): a linha nasce com o seed, mas
 * um projeto sem seed ainda precisa conseguir gravar — insert puro estouraria
 * 23505 na segunda tentativa e update puro não criaria nada.
 */
export async function saveSystemSettings(
  key: SettingKey,
  value: Record<string, unknown>,
  role?: RoleKey,
): Promise<SettingsWriteResult> {
  if (role !== 'superadmin') return { ok: false, error: SETTINGS_DENIED }

  const { data, error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select(SETTING_COLUMNS.join(','))
    .maybeSingle()
  if (error) return { ok: false, error: describeSettingsDbError(error) }
  if (!data) return { ok: false, error: SETTINGS_NOT_SAVED }
  return { ok: true, setting: data as unknown as SystemSettingRow }
}

export function validatePlatformDraft(draft: PlatformDraft): string | null {
  const name = draft.name.trim()
  if (name.length < 2 || name.length > 120) return SETTINGS_NAME_INVALID
  return null
}

/** `value` do formato do seed → shape da tela. O que não é do tipo vira null, não chute. */
export function parsePlatformSettings(row?: SystemSettingRow): PlatformSettings | null {
  if (!row) return null
  const value = row.value ?? {}
  return {
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name : null,
    churchSignup: value.church_signup === 'invite' ? 'invite' : 'free',
    mfaRequired: Array.isArray(value.mfa_required)
      ? value.mfa_required.filter((item): item is string => typeof item === 'string')
      : [],
    updatedAt: row.updated_at,
  }
}

export function parsePrivacySettings(row?: SystemSettingRow): PrivacySettings | null {
  if (!row) return null
  const value = row.value ?? {}
  return {
    auditRetentionMonths:
      typeof value.audit_retention_months === 'number' && AUDIT_RETENTION_OPTIONS.includes(value.audit_retention_months as 12)
        ? value.audit_retention_months
        : null,
    locationSearchStorage: LOCATION_STORAGE_OPTIONS.includes(value.location_search_storage as LocationStorage)
      ? (value.location_search_storage as LocationStorage)
      : 'none',
    communicationOptIn: typeof value.communication_opt_in === 'boolean' ? value.communication_opt_in : null,
    updatedAt: row.updated_at,
  }
}

/** Shape da tela → `value` no formato do seed (round-trip estável). */
export function platformValue(draft: PlatformDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    church_signup: draft.churchSignup,
    mfa_required: draft.mfaRequired,
  }
}

export function privacyValue(draft: PrivacyDraft): Record<string, unknown> {
  return {
    audit_retention_months: draft.auditRetentionMonths,
    location_search_storage: draft.locationSearchStorage,
    communication_opt_in: draft.communicationOptIn,
  }
}

function describeSettingsDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return SETTINGS_DENIED
    default:
      return error.message
  }
}
