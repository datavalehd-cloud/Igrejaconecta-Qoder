import type { ApprovalStatus, RegistrationStatus } from '@/types'

export type BadgeTone = 'neutral' | 'brand' | 'green' | 'amber' | 'red' | 'navy'

/**
 * Texto e cor de cada `approval_status`, num arquivo sem componente de propósito:
 * o badge da lista e o aviso da escrita precisam do mesmo texto, e duas tabelas
 * parecidas sempre divergem.
 */
export const approvalMap: Record<ApprovalStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pendente', tone: 'amber' },
  in_review: { label: 'Em análise', tone: 'brand' },
  approved: { label: 'Aprovada', tone: 'green' },
  rejected: { label: 'Rejeitada', tone: 'red' },
  suspended: { label: 'Suspensa', tone: 'red' },
}

export function approvalLabel(status: ApprovalStatus): string {
  return approvalMap[status].label
}

/** O mesmo motivo do `approvalMap`: o badge da lista e o CSV da equipe usam um texto só. */
export const registrationStatusMap: Record<RegistrationStatus, { label: string; tone: BadgeTone }> = {
  confirmed: { label: 'Confirmada', tone: 'green' },
  pending: { label: 'Pendente', tone: 'amber' },
  waitlist: { label: 'Lista de espera', tone: 'brand' },
  cancelled: { label: 'Cancelada', tone: 'red' },
  checked_in: { label: 'Check-in feito', tone: 'navy' },
}

export function registrationLabel(status: RegistrationStatus): string {
  return registrationStatusMap[status].label
}
