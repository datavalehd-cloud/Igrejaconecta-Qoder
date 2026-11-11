import { useMemo } from 'react'
import { FileDown, FileSpreadsheet, BarChart3 } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button } from '@/components/common/primitives'
import { useManagedChurches } from '@/hooks/useChurches'
import { useRegistrationStats } from '@/hooks/useRegistrations'
import { useAdminEvents, usePlatformUsers, useAdminCampaigns } from '@/hooks/useAdmin'
import { buildReportRows, downloadReportCsv, groupReportRows } from '@/utils/reports'

export function AdminReportsPage() {
  const { rows: churches, loading: churchesLoading } = useManagedChurches()
  const { rows: allEvents, loading: eventsLoading } = useAdminEvents()
  const { rows: allCampaigns, loading: campaignsLoading } = useAdminCampaigns()
  const { rows: platformUsers, loading: usersLoading } = usePlatformUsers()
  const { rows: registrationStats, loading: statsLoading } = useRegistrationStats()

  const loading = churchesLoading || eventsLoading || campaignsLoading || usersLoading || statsLoading
  const sections = useMemo(
    () => groupReportRows(buildReportRows({ churches, events: allEvents, campaigns: allCampaigns, users: platformUsers, registrationStats })),
    [churches, allEvents, allCampaigns, platformUsers, registrationStats],
  )

  function exportCsv() {
    const rows = buildReportRows({ churches, events: allEvents, campaigns: allCampaigns, users: platformUsers, registrationStats })
    downloadReportCsv(`relatorio-plataforma-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Consolidado do estado atual da plataforma, a partir dos dados já guardados." />

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-4">
        <BarChart3 className="h-5 w-5 text-brand-600" />
        <p className="text-sm text-slate-600">Os números refletem o estado atual — não há recorte por período nesta versão.</p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportCsv} disabled={loading}>Exportar CSV</Button>
          <Button icon={<FileDown className="h-4 w-4" />} disabled title="Exportar PDF não está conectado nesta versão local">Exportar PDF</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando relatórios...</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Card key={s.title}>
              <CardHeader title={s.title} />
              <CardBody className="divide-y divide-line p-0">
                {s.rows.map((r) => (
                  <div key={r.item} className="flex items-center justify-between px-5 py-2 text-sm">
                    <span className="text-slate-600">{r.item}</span>
                    <span className="font-semibold text-navy">{r.quantidade}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-slate-500">
        Exportar PDF e indicadores de receita, assinaturas ou consumo de IA não estão
        conectados — exigem backend e provedores externos, fora do escopo desta versão local.
      </p>
    </div>
  )
}
