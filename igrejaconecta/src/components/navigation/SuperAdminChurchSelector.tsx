import { useEffect, useState } from 'react'
import { Church as ChurchIcon } from 'lucide-react'
import { Select } from '@/components/common/primitives'
import { approvalLabel } from '@/components/common/approvalMap'
import { useAuth } from '@/contexts/AuthContext'
import { fetchSelectorChurches, type SelectorChurch } from '@/services/data/churchService'

/**
 * Seletor de igreja do painel para o SuperAdmin. Escolher aqui não abre acesso
 * nenhum: a RLS já trata SuperAdmin como gestor de qualquer igreja —
 * `has_church_permission` (0001) começa com `public.is_superadmin()` —, e o que
 * a escolha muda é só a igreja que as telas de `/app` vão consultar. A sessão só
 * aceita o valor se o banco confirmar a linha (`loadSession`); para os demais
 * papéis este componente não renderiza e a chave nem é lida.
 */
export function SuperAdminChurchSelector() {
  const { session, selectChurch } = useAuth()
  const [churches, setChurches] = useState<SelectorChurch[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const isSuperAdmin = session?.role === 'superadmin'

  useEffect(() => {
    if (!isSuperAdmin) return
    let alive = true
    fetchSelectorChurches()
      .then((rows) => {
        if (!alive) return
        setChurches(rows)
        setFailed(false)
      })
      .catch(() => {
        if (alive) {
          setChurches(null)
          setFailed(true)
        }
      })
    return () => {
      alive = false
    }
  }, [isSuperAdmin])

  if (!isSuperAdmin || !session) return null

  const current = churches?.find((church) => church.id === session.churchId) ?? null

  function choose(churchId: string) {
    setBusy(true)
    void selectChurch(churchId || null).finally(() => setBusy(false))
  }

  return (
    <div className="mx-3 mb-4 rounded-lg border border-brand-100 bg-brand-50 p-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-brand-700">
        <ChurchIcon className="h-3.5 w-3.5" />
        Igreja em operação
      </p>
      {failed ? (
        <p className="mt-2 text-xs text-red-700">
          Não foi possível listar as igrejas. O painel segue sem igreja ativa até a leitura funcionar.
        </p>
      ) : (
        <Select
          aria-label="Igreja em operação"
          className="mt-2 bg-white"
          value={session.churchId ?? ''}
          disabled={busy || churches === null}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">{churches === null ? 'Carregando igrejas...' : 'Nenhuma (somente plataforma)'}</option>
          {churches?.map((church) => (
            <option key={church.id} value={church.id}>
              {church.name}
              {church.approval_status !== 'approved' ? ` — ${approvalLabel(church.approval_status)}` : ''}
            </option>
          ))}
        </Select>
      )}
      {current && (
        <p className="mt-2 text-xs font-medium text-navy">
          SuperAdmin operando: {current.name}
          {current.approval_status !== 'approved' ? ` (${approvalLabel(current.approval_status)})` : ''}
        </p>
      )}
    </div>
  )
}
