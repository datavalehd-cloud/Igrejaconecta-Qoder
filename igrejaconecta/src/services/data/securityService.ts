import { supabase } from '@/services/supabase/client'

/**
 * Eventos de segurança (M5, migração 0019). Dois sinais, dois pontos de chamada:
 * `permission_denied` quando uma escrita leva 42501 da RLS e `publish_denied`
 * quando alguém tenta marcar publicação sem o provedor ter confirmado.
 *
 * Ninguém escreve nesta tabela pela API: o insert mora dentro de
 * `log_security_event` (security definer), que grava `actor_id = auth.uid()`.
 * Por isso o registro do sinal é à prova de falha — se a RPC cair, a tela
 * continua mostrando o erro original; um monitor que derruba a operação que ele
 * monitora seria pior que monitor nenhum.
 *
 * A leitura é do SuperAdmin: as views já trazem zero linhas para qualquer outro
 * papel, então a tela de alertas mostra "nada registrado" em vez de recusar.
 */

export type SecurityEventKind = 'permission_denied' | 'publish_denied'

export const SECURITY_EVENT_KINDS: readonly SecurityEventKind[] = ['permission_denied', 'publish_denied']

export const SECURITY_EVENT_LABEL: Record<SecurityEventKind, string> = {
  permission_denied: 'Escrita recusada pela RLS',
  publish_denied: 'Publicação sem confirmação do provedor',
}

export interface SecuritySummaryRow {
  kind: SecurityEventKind
  last_24h: number
  last_7d: number
  total: number
  last_at: string | null
}

export interface SecurityLogRow {
  id: string
  kind: SecurityEventKind
  target: string | null
  church_id: string | null
  church_name: string | null
  actor_id: string | null
  actor_name: string | null
  actor_email: string | null
  created_at: string
}

/** Sinal de recusa: nunca lança, nunca espera. */
export function notePermissionDenied(target: string, churchId?: string | null): void {
  void logSecurityEvent('permission_denied', target, churchId)
}

export function notePublishDenied(target: string, churchId?: string | null): void {
  void logSecurityEvent('publish_denied', target, churchId)
}

export async function logSecurityEvent(
  kind: SecurityEventKind,
  target?: string | null,
  churchId?: string | null,
): Promise<void> {
  try {
    await supabase.rpc('log_security_event', {
      p_kind: kind,
      p_target: target ?? null,
      p_church: churchId ?? null,
    })
  } catch {
    // Monitor é sinal, não transação: a falha dele não altera o resultado da escrita.
  }
}

export async function fetchSecuritySummary(): Promise<SecuritySummaryRow[]> {
  const { data, error } = await supabase
    .from('security_event_summary')
    .select('kind,last_24h,last_7d,total,last_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as SecuritySummaryRow[]
}

export async function fetchSecurityLog(): Promise<SecurityLogRow[]> {
  const { data, error } = await supabase
    .from('security_event_log')
    .select('id,kind,target,church_id,church_name,actor_id,actor_name,actor_email,created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as SecurityLogRow[]
}
