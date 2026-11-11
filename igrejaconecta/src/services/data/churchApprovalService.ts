import { auditLogs, churches } from '@/data/mock'
import { supabase } from '@/services/supabase/client'
import { approvalAuditAction } from '@/services/data/auditService'
import type { ApprovalStatus, Church, RoleKey } from '@/types'

export interface ApprovalActor {
  id: string
  email: string
  role?: RoleKey
}

export type ApprovalResult =
  | { ok: true; church: Church; error?: never }
  | { ok: false; error: string; church?: never }

export const APPROVAL_COLUMNS = ['id', 'name', 'slug', 'approval_status', 'status', 'updated_at'] as const satisfies readonly (keyof Church)[]

export async function setChurchApprovalStatus(
  churchId: string,
  next: ApprovalStatus,
  actor?: ApprovalActor,
): Promise<ApprovalResult> {
  if (!actor) return { ok: false, error: 'Sem permissão para esta ação: aprovação é exclusividade do SuperAdmin.' }

  if (!supabase) {
    if (actor.role !== 'superadmin') {
      return { ok: false, error: 'Sem permissão para esta ação: aprovação é exclusividade do SuperAdmin.' }
    }
    const church = churches.find((c) => c.id === churchId)
    if (!church) return { ok: false, error: 'Igreja não encontrada.' }
    if (church.approval_status !== next) {
      const timestamp = new Date().toISOString()
      const entry = {
        id: crypto.randomUUID(),
        actor: actor.email,
        action: approvalAuditAction(church.approval_status, next),
        target: church.name,
        church: church.name,
        metadata: { de: church.approval_status, para: next },
        created_at: timestamp,
      }
      // Sem await: a igreja só muda após a trilha estar pronta na memória demo.
      auditLogs.push(entry)
      church.approval_status = next
      church.updated_at = timestamp
    }
    return { ok: true, church: pickApproval(church) }
  }

  const { data, error } = await supabase
    .from('churches')
    .update({ approval_status: next })
    .eq('id', churchId)
    .select(APPROVAL_COLUMNS.join(','))
    .maybeSingle()

  if (error) return { ok: false, error: describeDbError(error) }
  if (!data) return { ok: false, error: 'Igreja não encontrada ou sem permissão para alterá-la. Atualize a lista.' }
  return { ok: true, church: data as unknown as Church }
}

function describeDbError(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Sem permissão para esta ação: aprovação é exclusividade do SuperAdmin.'
  return error.message
}

function pickApproval(church: Church): Church {
  const out: Record<string, unknown> = {}
  for (const column of APPROVAL_COLUMNS) out[column] = church[column]
  return out as unknown as Church
}
