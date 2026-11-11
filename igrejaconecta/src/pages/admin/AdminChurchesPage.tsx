import { useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import { PageHeader, Button, Input, Select, Badge, EmptyState } from '@/components/common/primitives'
import { DataTable, type Column } from '@/components/common/DataTable'
import { ApprovalBadge } from '@/components/common/StatusBadges'
import { ApprovalActions } from '@/components/admin/ApprovalActions'
import { Notice } from '@/components/common/Notice'
import { useManagedChurches } from '@/hooks/useChurches'
import { useChurchApproval } from '@/hooks/useChurchApproval'
import type { Church } from '@/types'

export function AdminChurchesPage() {
  const { rows, loading, error, reload } = useManagedChurches()
  const { busyId, notice, run, dismiss } = useChurchApproval(reload)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')

  const filtered = rows
    .filter((c) => (status === 'all' ? true : c.approval_status === status))
    .filter((c) => (query ? c.name.toLowerCase().includes(query.toLowerCase()) : true))

  const columns: Column<Church>[] = [
    { header: 'Igreja', cell: (c) => <div><p className="font-medium text-navy">{c.name}</p><p className="text-xs text-slate-500">{c.city}/{c.state} · {c.denomination}</p></div> },
    { header: 'Contato', cell: (c) => <span className="text-slate-600">{c.email ?? '—'}</span> },
    { header: 'Status', cell: (c) => <ApprovalBadge status={c.approval_status} /> },
    { header: 'Conta', cell: (c) => <Badge tone={c.status === 'active' ? 'green' : 'neutral'}>{c.status === 'active' ? 'Ativa' : 'Inativa'}</Badge> },
    {
      header: 'Ações',
      className: 'text-right',
      cell: (c) => (
        // A chave reinicia a confirmação pendente quando o status muda: depois de
        // escrever, a linha não pode continuar oferecendo "Confirmar".
        <ApprovalActions key={`${c.id}:${c.approval_status}`} church={c} busy={busyId === c.id} onRun={run} />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Gestão de igrejas"
        subtitle="Consulte, aprove, rejeite, suspenda e reative igrejas da plataforma."
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>
            Atualizar
          </Button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={reload}>Tentar de novo</Button>
        </div>
      )}

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={dismiss} />}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Buscar igreja..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select className="w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Todos os status</option>
          <option value="pending">Pendente</option>
          <option value="in_review">Em análise</option>
          <option value="approved">Aprovada</option>
          <option value="rejected">Rejeitada</option>
          <option value="suspended">Suspensa</option>
        </Select>
      </div>

      {loading ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="Carregando igrejas..." description="Listando todas as igrejas da plataforma." />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          keyOf={(c) => c.id}
          empty={<EmptyState title="Nenhuma igreja neste filtro" description="Ajuste o status ou o termo de busca." />}
        />
      )}
    </div>
  )
}
