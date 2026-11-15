import { useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { PageHeader, Button, Badge, EmptyState } from '@/components/common/primitives'
import { DataTable, type Column } from '@/components/common/DataTable'
import { useAuth } from '@/contexts/AuthContext'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchAuditTrail } from '@/services/data/auditService'
import { fetchSecurityLog, SECURITY_EVENT_LABEL, type SecurityLogRow } from '@/services/data/securityService'
import { formatDateTime } from '@/utils/format'
import type { AuditLog } from '@/types'

export function AuditLogsPage() {
  const { session } = useAuth()
  const fetcher = useCallback(() => fetchAuditTrail(), [])
  const { rows, loading, error, reload } = useKeyedList(
    session?.role === 'superadmin',
    `${session?.profile.id ?? ''}|${session?.role ?? ''}`,
    fetcher,
    'Não foi possível carregar a auditoria.',
  )
  const columns: Column<AuditLog>[] = [
    { header: 'Quando', cell: (l) => formatDateTime(l.created_at) },
    { header: 'Ator', cell: (l) => <span className="text-slate-600">{l.actor}</span> },
    { header: 'Ação', cell: (l) => <Badge tone="brand">{l.action}</Badge> },
    { header: 'Alvo', cell: (l) => l.target },
    { header: 'Igreja', cell: (l) => l.church ?? '—' },
  ]

  return (
    <div>
      <PageHeader
        title="Auditoria"
        subtitle="Histórico de operações registradas, sem edição ou exclusão pelo aplicativo."
        actions={<Button variant="outline" onClick={reload} icon={<RefreshCw className="h-4 w-4" />}>Atualizar</Button>}
      />
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={reload}>Tentar de novo</Button>
        </div>
      ) : loading ? (
        <EmptyState title="Carregando auditoria..." description="Consultando os registros disponíveis para sua conta." />
      ) : (
        <DataTable columns={columns} rows={rows} keyOf={(l) => l.id} empty={<EmptyState title="Nenhum registro de auditoria" description="As ações registradas aparecerão aqui." />} />
      )}
    </div>
  )
}

/**
 * Logs do sistema (M5). O que existe de verdade é o registro de segurança da
 * 0019: recusa de escrita pela RLS e tentativa de publicação sem confirmação do
 * provedor. Edge Function, fila e webhook não existem nesta versão — a lista de
 * "jobs processados" que havia aqui era inventada, e inventar log é o jeito mais
 * rápido de esconder um problema real.
 */
export function SystemLogsPage() {
  const { session } = useAuth()
  const fetcher = useCallback(() => fetchSecurityLog(), [])
  const { rows, loading, error, reload } = useKeyedList(
    true,
    `${session?.profile.id ?? ''}|${session?.role ?? ''}`,
    fetcher,
    'Não foi possível carregar os eventos de segurança.',
  )
  const columns: Column<SecurityLogRow>[] = [
    { header: 'Quando', cell: (l) => formatDateTime(l.created_at) },
    { header: 'Tipo', cell: (l) => <Badge tone={l.kind === 'permission_denied' ? 'amber' : 'red'}>{SECURITY_EVENT_LABEL[l.kind]}</Badge> },
    { header: 'Alvo', cell: (l) => <code className="text-xs text-slate-600">{l.target ?? '—'}</code> },
    { header: 'Quem tentou', cell: (l) => <span className="text-slate-600">{l.actor_name ?? l.actor_email ?? 'conta sem perfil'}</span> },
    { header: 'Igreja', cell: (l) => l.church_name ?? '—' },
  ]

  return (
    <div>
      <PageHeader
        title="Logs do sistema"
        subtitle="Eventos de segurança registrados pelo aplicativo: escrita recusada pela RLS e publicação sem confirmação."
        actions={<Button variant="outline" onClick={reload} icon={<RefreshCw className="h-4 w-4" />}>Atualizar</Button>}
      />
      <p className="mb-4 text-xs text-slate-500">
        Execuções de Edge Function, filas e webhooks não existem nesta versão: não há nada delas para mostrar. O registro é
        escrito só pela função `log_security_event` do banco, com o autor da sessão — ninguém insere linha aqui pela tela.
      </p>
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={reload}>Tentar de novo</Button>
        </div>
      ) : loading ? (
        <EmptyState title="Carregando eventos..." description="Consultando o registro de segurança." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(l) => l.id}
          empty={<EmptyState title="Nenhum evento de segurança" description="Nenhuma escrita recusada e nenhuma publicação sem confirmação foram registradas." />}
        />
      )}
    </div>
  )
}
