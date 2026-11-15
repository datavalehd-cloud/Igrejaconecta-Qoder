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

  /**
   * PDF de verdade, sem biblioteca: monta o documento do relatório numa janela de
   * impressão e entrega ao diálogo do navegador ("Salvar como PDF"). O que sai é
   * exatamente o que a tela mostra — os mesmos `sections`, sem número paralelo.
   */
  function exportPdf() {
    const stamp = new Date().toLocaleString('pt-BR')
    const body = sections
      .map(
        (s) => `<section><h2>${escapeHtml(s.title)}</h2><table>${s.rows
          .map((r) => `<tr><td>${escapeHtml(r.item)}</td><td class="n">${escapeHtml(String(r.quantidade))}</td></tr>`)
          .join('')}</table></section>`,
      )
      .join('')
    const win = window.open('', '_blank', 'width=840,height=1000')
    if (!win) return
    win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório IgrejaConecta</title>
<style>
  body { font-family: system-ui, sans-serif; color: #0f172a; margin: 40px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: #64748b; font-size: 12px; margin: 0 0 24px; }
  h2 { font-size: 14px; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #334155; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 6px 4px; border-bottom: 1px solid #e2e8f0; }
  td.n { text-align: right; font-weight: 600; }
</style></head><body>
<h1>Relatório da plataforma — IgrejaConecta</h1>
<p>Gerado em ${escapeHtml(stamp)} · estado atual, sem recorte por período.</p>
${body}
</body></html>`)
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Consolidado do estado atual da plataforma, a partir dos dados já guardados." />

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-4">
        <BarChart3 className="h-5 w-5 text-brand-600" />
        <p className="text-sm text-slate-600">Os números refletem o estado atual — não há recorte por período nesta versão.</p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportCsv} disabled={loading}>Exportar CSV</Button>
          <Button icon={<FileDown className="h-4 w-4" />} onClick={exportPdf} disabled={loading} title="Abre o relatório formatado no diálogo de impressão do navegador: salve como PDF">Exportar PDF</Button>
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
        O PDF sai pelo diálogo de impressão do navegador (salvar como PDF) com exatamente estes números.
        Indicadores de receita, assinaturas ou consumo de IA não estão conectados — exigem backend e
        provedores externos, fora do escopo desta versão.
      </p>
    </div>
  )
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
