import { useCallback, useState } from 'react'
import { approvalLabel } from '@/components/common/approvalMap'
import { useAuth } from '@/contexts/AuthContext'
import { setChurchApprovalStatus } from '@/services/data/churchApprovalService'
import type { ApprovalStatus, Church } from '@/types'

export type ApprovalNotice = { tone: 'ok' | 'error'; text: string }

export function useChurchApproval(reload: () => void) {
  const { session } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<ApprovalNotice | null>(null)

  const run = useCallback(
    async (church: Church, next: ApprovalStatus) => {
      setBusyId(church.id)
      setNotice(null)
      try {
        const actor = session ? { id: session.profile.id, email: session.profile.email, role: session.role } : undefined
        const result = await setChurchApprovalStatus(church.id, next, actor)
        if (!result.ok) {
          setNotice({ tone: 'error', text: result.error })
          return
        }
        const confirmed = result.church
        const status = `${confirmed.name}: ${approvalLabel(confirmed.approval_status).toLowerCase()}.`
        setNotice({ tone: 'ok', text: status })
        reload()
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível confirmar a alteração. Atualize a lista antes de tentar novamente.' })
      } finally {
        setBusyId(null)
      }
    },
    [session, reload],
  )

  return { busyId, notice, run, dismiss: () => setNotice(null) }
}
