import { useMemo, useState } from 'react'
import { AlertTriangle, Download, RefreshCw, ScanLine, UserX, TicketCheck } from 'lucide-react'
import { PageHeader, Button, Select, EmptyState } from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { DataTable, type Column } from '@/components/common/DataTable'
import { RegistrationBadge } from '@/components/common/StatusBadges'
import { registrationLabel } from '@/components/common/approvalMap'
import { useChurchRegistrations } from '@/hooks/useRegistrations'
import { useChurchEvents } from '@/hooks/useEvents'
import { usePermissions } from '@/hooks/usePermissions'
import { cancelRegistration, checkInRegistration } from '@/services/data/registrationService'
import { formatDate } from '@/utils/format'
import { waitlistAdmission } from '@/utils/checkInPolicy'
import type { Registration } from '@/types'

/**
 * Inscrições da igreja (Fase 3, passo 2). A lista vem de `event_registrations`
 * pela projeção `REGISTRATION_SELECT` — é a única leitura que traz nome, e-mail e
 * o código do ingresso, e ela só existe para quem tem `registrations.manage`
 * (RLS). O filtro de evento é recorte de tela: sem ele a RLS já limitaria às
 * linhas da própria igreja.
 *
 * O check-in daqui obedece à mesma regra do balcão: quem está na lista de espera
 * só entra com um clique explícito, porque o banco promoveria a linha sozinha.
 */
export function RegistrationsPage() {
  const { rows, loading, error, reload, allowed } = useChurchRegistrations()
  const { rows: churchEvents } = useChurchEvents()
  const { role } = usePermissions()
  const [eventId, setEventId] = useState('all')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [awaiting, setAwaiting] = useState<{ registration: Registration; text: string } | null>(null)

  const filtered = useMemo(
    () => (eventId === 'all' ? rows : rows.filter((r) => r.event_id === eventId)),
    [rows, eventId],
  )

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Inscrições" subtitle="Participantes, confirmações, lista de espera, cancelamentos e check-in." />
        <EmptyState
          icon={<TicketCheck className="h-6 w-6" />}
          title="O seu papel não gerencia inscrições"
          description="Administrador da igreja, gerente, pastor e SuperAdmin têm a permissão “Gerenciar inscrições”. Sem ela o banco não devolve a lista — nomes, e-mails e códigos não aparecem aqui."
        />
      </div>
    )
  }

  async function commit(action: 'check-in' | 'cancel', registration: Registration) {
    setBusy(registration.id)
    const result = action === 'check-in'
      ? await checkInRegistration(registration.id, role)
      : await cancelRegistration(registration.id, role)
    setBusy(null)
    setNotice({
      tone: result.ok ? 'ok' : 'error',
      text: result.error ?? (action === 'check-in' ? 'Check-in registrado.' : 'Inscrição cancelada.'),
    })
    reload()
  }

  async function run(action: 'check-in' | 'cancel', registration: Registration) {
    if (action === 'check-in') {
      const gate = waitlistAdmission(registration)
      if (gate.needsConfirmation) {
        setAwaiting({ registration, text: gate.text })
        return
      }
    }
    await commit(action, registration)
  }

  async function confirmQueue() {
    if (!awaiting) return
    const target = awaiting.registration
    setAwaiting(null)
    await commit('check-in', target)
  }

  /** CSV gerado a partir do que a RLS devolveu — nunca de um mock paralelo. */
  function exportCsv() {
    const header = ['Nome', 'E-mail', 'Telefone', 'Evento', 'Código', 'Status', 'Inscrição', 'Check-in']
    const lines = filtered.map((r) => [
      r.visitor_name,
      r.visitor_email,
      r.visitor_phone ?? '',
      r.event_name ?? '',
      r.ticket_code ?? '',
      registrationLabel(r.status),
      r.created_at,
      r.checked_in_at ?? '',
    ])
    const csv = [header, ...lines]
      .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';'))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `inscricoes-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setNotice({ tone: 'ok', text: `${filtered.length} inscrição(ões) exportadas.` })
  }

  const columns: Column<Registration>[] = [
    {
      header: 'Participante',
      cell: (r) => (
        <div>
          <p className="font-medium text-navy">{r.visitor_name}</p>
          <p className="text-xs text-slate-500">{r.visitor_email}</p>
        </div>
      ),
    },
    { header: 'Evento', cell: (r) => <span className="text-slate-600">{r.event_name ?? '—'}</span> },
    { header: 'Código', cell: (r) => <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-navy">{r.ticket_code ?? '—'}</code> },
    { header: 'Inscrição', cell: (r) => formatDate(r.created_at) },
    { header: 'Status', cell: (r) => <RegistrationBadge status={r.status} /> },
    {
      header: '',
      className: 'text-right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy === r.id || r.status === 'checked_in' || r.status === 'cancelled'}
            onClick={() => run('check-in', r)}
            icon={<ScanLine className="h-4 w-4" />}
            aria-label={`Check-in de ${r.visitor_name}`}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy === r.id || r.status === 'cancelled'}
            onClick={() => run('cancel', r)}
            icon={<UserX className="h-4 w-4" />}
            aria-label={`Cancelar inscrição de ${r.visitor_name}`}
          />
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Inscrições"
        subtitle="Participantes, confirmações, lista de espera, cancelamentos e check-in."
        actions={
          <>
            <Select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-56" aria-label="Filtrar por evento">
              <option value="all">Todos os eventos</option>
              {churchEvents.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
            <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0} icon={<Download className="h-4 w-4" />}>
              Exportar CSV
            </Button>
          </>
        }
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Tentar de novo</Button>
        </div>
      )}

      {awaiting && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p className="text-sm text-amber-800">{awaiting.text}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={confirmQueue} icon={<TicketCheck className="h-4 w-4" />}>
              Confirmar admissão de {awaiting.registration.visitor_name}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAwaiting(null)}>Deixar na fila</Button>
          </div>
        </div>
      )}

      {loading ? (
        <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="Carregando inscrições..." description="Consultando a lista de participantes da sua igreja." />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          keyOf={(r) => r.id}
          empty={
            <EmptyState
              icon={<TicketCheck className="h-6 w-6" />}
              title="Nenhuma inscrição ainda"
              description="As inscrições aparecem aqui assim que um visitante se inscrever num evento publicado da sua igreja."
            />
          }
        />
      )}
    </div>
  )
}
