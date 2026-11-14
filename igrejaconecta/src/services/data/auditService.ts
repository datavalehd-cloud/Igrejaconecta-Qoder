import { supabase } from '@/services/supabase/client'
import type { ApprovalStatus, AuditLog } from '@/types'

interface AuditRow {
  id: string
  created_at: string
  action: string
  target: string | null
  metadata: Record<string, unknown> | null
  actor_id: string | null
  church_id: string | null
  profiles: { email: string } | null
  churches: { name: string } | null
}

export const AUDIT_COLUMNS = [
  'id', 'created_at', 'action', 'target', 'metadata', 'actor_id', 'church_id',
] as const satisfies readonly (keyof AuditRow)[]

export const AUDIT_SELECT = [...AUDIT_COLUMNS, 'profiles(email)', 'churches(name)'] as const

export const AUDIT_ACTION = {
  churchApproved: 'igreja.aprovada',
  churchReactivated: 'igreja.reativada',
  churchRejected: 'igreja.rejeitada',
  churchSuspended: 'igreja.suspensa',
  churchUnderReview: 'igreja.em_analise',
  churchPending: 'igreja.pendente',
} as const

export function approvalAuditAction(from: ApprovalStatus, to: ApprovalStatus): string {
  switch (to) {
    case 'approved':
      return from === 'suspended' ? AUDIT_ACTION.churchReactivated : AUDIT_ACTION.churchApproved
    case 'rejected':
      return AUDIT_ACTION.churchRejected
    case 'suspended':
      return AUDIT_ACTION.churchSuspended
    case 'in_review':
      return AUDIT_ACTION.churchUnderReview
    case 'pending':
      return AUDIT_ACTION.churchPending
  }
}

export async function fetchAuditTrail(): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select(AUDIT_SELECT.join(','))
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as AuditRow[]).map(toAuditLog)
}

function toAuditLog(row: AuditRow): AuditLog {
  return {
    id: row.id,
    actor: row.profiles?.email ?? '—',
    action: row.action,
    target: row.target ?? '—',
    church: row.churches?.name ?? null,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
  }
}
