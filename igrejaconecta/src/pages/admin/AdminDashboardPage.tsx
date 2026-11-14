import { Link } from 'react-router-dom'
import { Building2, Users, CalendarDays, Ticket, Megaphone, Sparkles } from 'lucide-react'
import { PageHeader, Stat, Card, CardHeader, CardBody, Badge, Button } from '@/components/common/primitives'
import { ApprovalBadge } from '@/components/common/StatusBadges'
import { ApprovalActions } from '@/components/admin/ApprovalActions'
import { Notice } from '@/components/common/Notice'
import { useManagedChurches } from '@/hooks/useChurches'
import { useChurchApproval } from '@/hooks/useChurchApproval'
import { useRegistrationStats } from '@/hooks/useRegistrations'
import { useAdminEvents, usePlatformUsers, useAdminCampaigns } from '@/hooks/useAdmin'
import { countDistinctUsers } from '@/services/data/adminService'

export function AdminDashboardPage() {
  const { rows: churches, loading: churchesLoading, error: churchesError, reload } = useManagedChurches()
  const approval = useChurchApproval(reload)
  const { rows: allStats, loading: statsLoading } = useRegistrationStats()
  const { rows: allEvents, loading: eventsLoading } = useAdminEvents()
  const { rows: platformUsers, loading: usersLoading } = usePlatformUsers()
  const { rows: allCampaigns, loading: campaignsLoading } = useAdminCampaigns()
  const pending = churches.filter((c) => c.approval_status === 'pending' || c.approval_status === 'in_review')
  // Inscrições já têm fonte real: a view de agregados devolve tudo para o
  // SuperAdmin (ramo `is_superadmin()`), então a soma não depende de modo.
  const registrationsTotal = allStats.reduce((total, stat) => total + stat.active_count, 0)

  return (
    <div>
      <PageHeader title="Dashboard SuperAdmin" subtitle="Visão geral da plataforma IgrejaConecta." />

      {churchesError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{churchesError}</div>
      )}

      {approval.notice && <Notice tone={approval.notice.tone} text={approval.notice.text} onClose={approval.dismiss} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Total de igrejas" value={churchesLoading ? '—' : churches.length} hint={churchesLoading ? 'carregando' : `${churches.filter((c) => c.approval_status === 'approved').length} aprovadas`} tone="green" />
        <Stat label="Pendentes" value={churchesLoading ? '—' : pending.length} hint={churchesLoading ? 'carregando' : 'aguardando análise'} tone="amber" />
        <Stat label="Total de usuários" value={usersLoading ? '—' : countDistinctUsers(platformUsers)} hint={usersLoading ? 'carregando' : `${platformUsers.length} vínculos`} tone="navy" />
        <Stat label="Eventos" value={eventsLoading ? '—' : allEvents.length} hint={eventsLoading ? 'carregando' : `${allEvents.filter((e) => e.status === 'published').length} publicados`} tone="brand" />
        <Stat label="Inscrições" value={statsLoading ? '—' : registrationsTotal} hint={statsLoading ? 'carregando' : 'inscrições ativas'} tone="brand" />
        <Stat label="Campanhas" value={campaignsLoading ? '—' : allCampaigns.length} hint={campaignsLoading ? 'carregando' : 'todas as igrejas'} tone="green" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Igrejas aguardando aprovação" action={<Link to="/admin/igrejas"><Button size="sm" variant="outline">Gerenciar</Button></Link>} />
          <CardBody className="divide-y divide-line p-0">
            {churchesLoading && <p className="p-5 text-sm text-slate-500">Carregando pendências...</p>}
            {!churchesLoading && pending.length === 0 && <p className="p-5 text-sm text-slate-500">Nenhuma pendência. 🎉</p>}
            {pending.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Building2 className="h-4 w-4" /></span>
                  <div>
                    <p className="font-medium text-navy">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.city}/{c.state} · {c.denomination}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ApprovalBadge status={c.approval_status} />
                  <ApprovalActions key={`${c.id}:${c.approval_status}`} church={c} busy={approval.busyId === c.id} onRun={approval.run} />
                  <Link to="/admin/igrejas"><Button size="sm" variant="outline">Ver lista</Button></Link>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Monitoramento" />
          <CardBody className="space-y-3 text-sm">
            <ProviderRow icon={<Sparkles className="h-4 w-4" />} label="OpenAI" />
            <ProviderRow icon={<Megaphone className="h-4 w-4" />} label="Meta (IG/FB)" />
            <ProviderRow icon={<Ticket className="h-4 w-4" />} label="WhatsApp" />
            <ProviderRow icon={<CalendarDays className="h-4 w-4" />} label="Filas / pg_cron" />
            <ProviderRow icon={<Users className="h-4 w-4" />} label="Webhooks" />
            <p className="pt-1 text-xs text-slate-500">
              Nenhum provedor externo está conectado nesta versão local. Monitorar de
              verdade exige um backend com as chaves de cada serviço — veja{' '}
              <Link to="/admin/integracoes" className="text-brand-600 underline">Integrações</Link>.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function ProviderRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2 text-slate-600">{icon}{label}</span>
      <Badge tone="neutral">Não conectado</Badge>
    </div>
  )
}
