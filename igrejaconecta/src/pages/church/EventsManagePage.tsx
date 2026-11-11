import { Link } from 'react-router-dom'
import { Plus, CalendarDays, ExternalLink, Pencil, RefreshCw, ScanLine, TicketCheck } from 'lucide-react'
import { PageHeader, Button, Badge, Card, CardBody, EmptyState } from '@/components/common/primitives'
import { DataTable, type Column } from '@/components/common/DataTable'
import { EventStatusBadge } from '@/components/common/StatusBadges'
import { useChurchEvents } from '@/hooks/useEvents'
import { useRegistrationStats } from '@/hooks/useRegistrations'
import { formatDate, formatRegistrations } from '@/utils/format'
import type { ChurchEvent } from '@/types'

export function EventsManagePage() {
  const { rows, loading, error, reload } = useChurchEvents()
  // A contagem vem da view de agregados (0012), não da tabela de eventos: sem ela
  // o valor é traço, nunca um número inventado.
  const { byEvent } = useRegistrationStats()

  const columns: Column<ChurchEvent>[] = [
    {
      header: 'Evento',
      cell: (e) => (
        <div>
          <p className="font-medium text-navy">{e.name}</p>
          <p className="text-xs text-slate-500">{e.category} · /{e.slug}</p>
        </div>
      ),
    },
    { header: 'Data', cell: (e) => <span className="inline-flex items-center gap-1 text-slate-600"><CalendarDays className="h-3.5 w-3.5" />{formatDate(e.starts_at)}</span> },
    { header: 'Inscritos', cell: (e) => <Badge tone="brand">{formatRegistrations(byEvent.get(e.id)?.active_count, e.capacity)}</Badge> },
    { header: 'Visibilidade', cell: (e) => <Badge tone={e.visibility === 'public' ? 'green' : 'neutral'}>{e.visibility === 'public' ? 'Público' : e.visibility === 'private' ? 'Privado' : 'Não listado'}</Badge> },
    { header: 'Status', cell: (e) => <EventStatusBadge status={e.status} /> },
    {
      header: '',
      className: 'text-right',
      cell: (e) => (
        <div className="flex justify-end gap-1">
          {/* A página pública só existe para o que está no ar: rascunho não tem URL. */}
          {e.status === 'published' && (
            <Link to={`/eventos/${e.slug}`}><Button variant="ghost" size="sm" icon={<ExternalLink className="h-4 w-4" />} aria-label="Ver página pública" /></Link>
          )}
          <Link to="/app/inscricoes"><Button variant="ghost" size="sm" icon={<TicketCheck className="h-4 w-4" />} aria-label="Ver inscrições" /></Link>
          <Link to="/app/checkin"><Button variant="ghost" size="sm" icon={<ScanLine className="h-4 w-4" />} aria-label="Check-in" /></Link>
          <Link to={`/app/eventos/${e.id}/editar`}><Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} aria-label={`Editar ${e.name}`} /></Link>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Eventos"
        subtitle="Crie, publique, agende e gerencie os eventos da sua igreja."
        actions={<Link to="/app/eventos/novo"><Button icon={<Plus className="h-4 w-4" />}>Novo evento</Button></Link>}
      />
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>
            Tentar de novo
          </Button>
        </div>
      )}

      {loading ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Carregando eventos..." description="Consultando a agenda da sua igreja." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(e) => e.id}
          empty={<EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Nenhum evento ainda" description="Crie o primeiro evento da sua igreja — ele começa como rascunho e só vai a público quando alguém com permissão de publicar aprovar." />}
        />
      )}
      <Card className="mt-4"><CardBody className="text-sm text-slate-500">Cada evento tem URL pública amigável, inscrições com lista de espera quando a capacidade enche e check-in pelo código do ingresso.</CardBody></Card>
    </div>
  )
}
