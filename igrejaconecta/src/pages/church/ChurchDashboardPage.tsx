import { Link } from 'react-router-dom'
import { CalendarDays, Users, Ticket, Megaphone, Plus, Building2 } from 'lucide-react'
import { PageHeader, Stat, Card, CardHeader, CardBody, Button, Badge } from '@/components/common/primitives'
import { EventStatusBadge } from '@/components/common/StatusBadges'
import { useAuth } from '@/contexts/AuthContext'
import { useChurchBranches } from '@/hooks/useBranches'
import { useChurchCampaigns } from '@/hooks/useCampaigns'
import { useMyChurches } from '@/hooks/useChurches'
import { useChurchEvents } from '@/hooks/useEvents'
import { useRegistrationStats } from '@/hooks/useRegistrations'
import { useRoster } from '@/hooks/useRoster'
import { formatDate } from '@/utils/format'

export function ChurchDashboardPage() {
  const { session } = useAuth()
  const { rows: myChurches, loading: churchesLoading } = useMyChurches()
  const { rows: myEvents, loading: eventsLoading } = useChurchEvents()
  const { rows: allStats, loading: statsLoading } = useRegistrationStats()
  const { rows: roster, loading: rosterLoading } = useRoster()
  const { rows: myCampaigns, loading: campaignsLoading } = useChurchCampaigns()
  const { rows: branches, loading: branchesLoading } = useChurchBranches()
  // A sessão pode estar defasada logo depois do onboarding (o vínculo novo ainda
  // não foi recarregado), então a lista de vínculos é o desempate.
  const church = myChurches.find((c) => c.church_id === session?.churchId) ?? myChurches[0]
  // Quem ainda não tem igreja não tem papel nela, então os atalhos de gestão não
  // levam a lugar nenhum: a entrada é o onboarding. SuperAdmin fica de fora —
  // ele aprova igrejas em /admin/igrejas, não cria uma para si.
  const noChurch = !churchesLoading && !church && session?.role !== 'superadmin'
  const myEventIds = new Set(myEvents.map((e) => e.id))
  const registrationsTotal = allStats
    .filter((s) => myEventIds.has(s.event_id))
    .reduce((total, s) => total + s.active_count, 0)
  const activeMembers = roster.filter((r) => r.membership_status === 'active').length

  return (
    <div>
      <PageHeader
        title={`Olá, ${session?.profile.full_name.split(' ')[0]} 👋`}
        subtitle={
          churchesLoading
            ? 'Consultando a sua igreja...'
            : church
              ? `Painel de ${church.name} · status ${church.approval_status === 'approved' ? 'aprovada' : church.approval_status}`
              : 'Nenhuma igreja ativa associada a esta conta.'
        }
        actions={
          noChurch
            ? <Link to="/app/onboarding"><Button icon={<Plus className="h-4 w-4" />}>Cadastrar igreja</Button></Link>
            : <Link to="/app/eventos/novo"><Button icon={<Plus className="h-4 w-4" />}>Novo evento</Button></Link>
        }
      />

      {noChurch && (
        <Card className="mb-6 border-brand-100 bg-brand-50">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600"><Building2 className="h-4 w-4" /></span>
              <div>
                <p className="font-semibold text-navy">Sua conta ainda não tem igreja</p>
                <p className="text-sm text-slate-600">Cadastre a comunidade e você entra como administrador dela. O cadastro fica pendente até a aprovação do SuperAdmin.</p>
              </div>
            </div>
            <Link to="/app/onboarding"><Button variant="outline">Cadastrar igreja</Button></Link>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Eventos" value={eventsLoading ? '—' : myEvents.length} hint={eventsLoading ? 'consultando a agenda' : `${myEvents.filter((e) => e.status === 'published').length} publicados`} tone="brand" />
        <Stat label="Inscrições" value={statsLoading || eventsLoading ? '—' : registrationsTotal} hint={statsLoading || eventsLoading ? 'consultando os eventos' : 'inscritos ativos'} tone="green" />
        <Stat label="Membros" value={rosterLoading ? '—' : activeMembers} hint={rosterLoading ? 'consultando a equipe' : 'na equipe'} tone="navy" />
        <Stat label="Campanhas" value={campaignsLoading ? '—' : myCampaigns.length} hint={campaignsLoading ? 'consultando as campanhas' : `${myCampaigns.filter((c) => c.status === 'published').length} publicadas`} tone="amber" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Próximos eventos"
            action={<Link to="/app/eventos" className="text-sm font-semibold text-brand-600 hover:underline">Ver todos</Link>}
          />
          <CardBody className="divide-y divide-line p-0">
            {eventsLoading && (
              <p className="p-5 text-sm text-slate-500">Consultando a agenda da sua igreja...</p>
            )}
            {!eventsLoading && myEvents.length === 0 && <p className="p-5 text-sm text-slate-500">Nenhum evento ainda.</p>}
            {!eventsLoading && myEvents.slice(0, 5).map((e) => (
              <Link key={e.id} to="/app/eventos" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><CalendarDays className="h-4 w-4" /></span>
                  <div>
                    <p className="font-medium text-navy">{e.name}</p>
                    <p className="text-xs text-slate-500">{formatDate(e.starts_at)}</p>
                  </div>
                </div>
                <EventStatusBadge status={e.status} />
              </Link>
            ))}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Atalhos" />
            <CardBody className="grid grid-cols-2 gap-2">
              <QuickLink to="/app/eventos/novo" icon={<Plus className="h-4 w-4" />} label="Novo evento" />
              <QuickLink to="/app/marketing" icon={<Megaphone className="h-4 w-4" />} label="Campanha" />
              <QuickLink to="/app/inscricoes" icon={<Ticket className="h-4 w-4" />} label="Inscrições" />
              <QuickLink to="/app/usuarios" icon={<Users className="h-4 w-4" />} label="Equipe" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Status da conta" />
            <CardBody className="space-y-2 text-sm">
              <Row label="Igreja">
                {church ? (
                  <Badge tone={church.approval_status === 'approved' ? 'green' : 'amber'}>{church.approval_status}</Badge>
                ) : (
                  <span className="text-slate-400">{churchesLoading ? 'carregando...' : 'sem igreja associada'}</span>
                )}
              </Row>
              <Row label="Plano"><span className="text-slate-600">Gratuito (sem cobrança)</span></Row>
              <Row label="Filiais">
                <span className="text-slate-600">
                  {branchesLoading
                    ? 'consultando...'
                    : `${branches.length} ${branches.length === 1 ? 'cadastrada' : 'cadastradas'}`}
                </span>
              </Row>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

function QuickLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-4 text-center text-xs font-medium text-slate-600 hover:border-brand-100 hover:bg-brand-50 hover:text-brand-700">
      <span className="text-brand-600">{icon}</span>
      {label}
    </Link>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      {children}
    </div>
  )
}
