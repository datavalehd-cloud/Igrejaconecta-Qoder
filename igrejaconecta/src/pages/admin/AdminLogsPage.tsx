import { useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { PageHeader, Button, Badge, EmptyState } from '@/components/common/primitives'
import { DataTable, type Column } from '@/components/common/DataTable'
import { useAuth } from '@/contexts/AuthContext'
import { useKeyedList } from '@/hooks/useKeyedList'
import { fetchAuditTrail } from '@/services/data/auditService'
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

interface SysLog { id: string; time: string; level: 'info' | 'warn' | 'error'; source: string; message: string }

const sysLogs: SysLog[] = [
  { id: 's2', time: '2026-11-08 08:40', level: 'warn', source: 'meta-publish', message: 'Rate limit próximo do limite para a página @ibcentral.' },
  { id: 's3', time: '2026-11-08 08:05', level: 'info', source: 'process-scheduled-jobs', message: '12 jobs de lembrete processados com sucesso.' },
  { id: 's4', time: '2026-11-07 22:31', level: 'info', source: 'whatsapp-webhook', message: 'Webhook validado e 45 status atualizados.' },
  { id: 's5', time: '2026-11-07 20:11', level: 'warn', source: 'send-notification', message: 'E-mail com retry (falha temporária no provedor SMTP).' },
]

const levelTone = { info: 'brand', warn: 'amber', error: 'red' } as const

export function SystemLogsPage() {
  const columns: Column<SysLog>[] = [
    { header: 'Horário', cell: (l) => l.time },
    { header: 'Nível', cell: (l) => <Badge tone={levelTone[l.level]}>{l.level}</Badge> },
    { header: 'Função', cell: (l) => <code className="text-xs text-slate-600">{l.source}</code> },
    { header: 'Mensagem', cell: (l) => <span className="text-slate-600">{l.message}</span> },
  ]

  return (
    <div>
      <PageHeader title="Logs do sistema" subtitle="Execuções de Edge Functions, filas, webhooks e tarefas agendadas." />
      <DataTable columns={columns} rows={sysLogs} keyOf={(l) => l.id} />
    </div>
  )
}
