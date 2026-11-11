import { useState, type ReactElement } from 'react'
import { CheckCircle2, Loader2, PauseCircle, RotateCcw, X, XCircle } from 'lucide-react'
import { Button } from '@/components/common/primitives'
import type { ApprovalStatus, Church } from '@/types'

/**
 * As ações de aprovação de uma igreja. O que cada status oferece vem da máquina
 * de estados do `approval_status`, não da tela: quem está pendente é aprovado ou
 * rejeitado, quem está aprovada é suspensa, e quem foi suspensa/rejeitada tem uma
 * volta (reativar / reanalisar).
 *
 * Suspender e rejeitar tiram a igreja do diretório público na hora (grupo J da
 * suíte de RLS), por isso pedem uma segunda confirmação antes de escrever.
 */
type Action = { next: ApprovalStatus; label: string; confirm: boolean; icon: ReactElement }

const ACTIONS: Record<ApprovalStatus, Action[]> = {
  pending: [
    { next: 'approved', label: 'Aprovar', confirm: false, icon: <CheckCircle2 className="h-4 w-4 text-green-600" /> },
    { next: 'rejected', label: 'Rejeitar', confirm: true, icon: <XCircle className="h-4 w-4 text-red-500" /> },
  ],
  in_review: [
    { next: 'approved', label: 'Aprovar', confirm: false, icon: <CheckCircle2 className="h-4 w-4 text-green-600" /> },
    { next: 'rejected', label: 'Rejeitar', confirm: true, icon: <XCircle className="h-4 w-4 text-red-500" /> },
  ],
  approved: [
    { next: 'suspended', label: 'Suspender', confirm: true, icon: <PauseCircle className="h-4 w-4 text-amber-600" /> },
    { next: 'rejected', label: 'Rejeitar', confirm: true, icon: <XCircle className="h-4 w-4 text-red-500" /> },
  ],
  suspended: [{ next: 'approved', label: 'Reativar', confirm: false, icon: <RotateCcw className="h-4 w-4 text-brand-600" /> }],
  rejected: [{ next: 'in_review', label: 'Reanalisar', confirm: false, icon: <RotateCcw className="h-4 w-4 text-brand-600" /> }],
}

export function ApprovalActions({
  church,
  busy,
  onRun,
}: {
  church: Church
  busy: boolean
  onRun: (church: Church, next: ApprovalStatus) => void
}) {
  const [armed, setArmed] = useState<ApprovalStatus | null>(null)
  const actions = ACTIONS[church.approval_status]

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {actions.map((action) => {
        const confirming = armed === action.next
        if (confirming) {
          return (
            <span key={action.next} className="flex items-center gap-1">
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                title={`Confirmar: ${action.label.toLowerCase()} ${church.name}`}
                onClick={() => {
                  setArmed(null)
                  onRun(church, action.next)
                }}
              >
                Confirmar {action.label.toLowerCase()}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArmed(null)} aria-label="Cancelar" icon={<X className="h-4 w-4" />} />
            </span>
          )
        }
        return (
          <Button
            key={action.next}
            variant="ghost"
            size="sm"
            disabled={busy}
            title={action.confirm ? `${action.label}: tira a igreja do ar, pede confirmação` : action.label}
            onClick={() => (action.confirm ? setArmed(action.next) : onRun(church, action.next))}
            icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : action.icon}
            aria-label={action.label}
          />
        )
      })}
    </div>
  )
}
