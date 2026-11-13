import { useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, ScanLine, TicketCheck, QrCode } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button, Input, Badge, Select, EmptyState } from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { useChurchEvents } from '@/hooks/useEvents'
import { useChurchRegistrations, useRegistrationStats } from '@/hooks/useRegistrations'
import { usePermissions } from '@/hooks/usePermissions'
import { checkInRegistration } from '@/services/data/registrationService'
import { waitlistAdmission } from '@/utils/checkInPolicy'
import type { Registration } from '@/types'

/**
 * Check-in do dia do evento (Fase 3, passo 2). Não há leitor de câmera nem
 * geração de QR Code no projeto — fingir isso seria mostrar uma capacidade que
 * não existe. O que existe: o código do ingresso (o mesmo da lista de
 * inscrições) digitado ou lido por um scanner USB, que digita e dá Enter, e o
 * registro gravado por `check_in_registration`.
 *
 * Quem está na lista de espera não tem vaga garantida e o banco mesmo assim
 * promoveria a inscrição no primeiro Enter: a tela trava esse caso atrás de uma
 * confirmação explícita (ver `utils/checkInPolicy`).
 */
export function CheckInPage() {
  const { rows: churchEvents } = useChurchEvents()
  const { rows: registrations, loading, error, reload, allowed } = useChurchRegistrations()
  const { byEvent, reload: reloadStats } = useRegistrationStats()
  const { role } = usePermissions()

  const [eventId, setEventId] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [awaiting, setAwaiting] = useState<{ registration: Registration; text: string } | null>(null)

  const selectedEvent = eventId || churchEvents[0]?.id || ''
  const eventRegs = useMemo(
    () => registrations.filter((r) => r.event_id === selectedEvent),
    [registrations, selectedEvent],
  )
  const stats = byEvent.get(selectedEvent)
  const presentCount = eventRegs.filter((r) => r.status === 'checked_in').length
  // Cancelada não espera ninguém no balcão: entra na lista, mas não no denominador.
  const expectedCount = eventRegs.filter((r) => r.status !== 'cancelled').length

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Check-in" subtitle="Valide a presença dos participantes pelo código do ingresso no dia do evento." />
        <EmptyState
          icon={<TicketCheck className="h-6 w-6" />}
          title="O seu papel não faz check-in"
          description="Administrador da igreja, gerente, pastor e SuperAdmin têm a permissão “Gerenciar inscrições”. Sem ela o banco recusa o registro de presença."
        />
      </div>
    )
  }

  // Os dois caminhos que mexem no painel — a gravação do check-in e o "Tentar de
  // novo" da lista quebrada — refazem as duas fontes juntos: 'Check-in feito' vem
  // da view e 'Presentes' da lista, e recarregar só a lista deixa 0 ao lado de 67%.
  function reloadAll() {
    reload()
    reloadStats()
  }

  async function commit(target: Registration) {
    const result = await checkInRegistration(target.id, role)
    setNotice({ tone: result.ok ? 'ok' : 'error', text: result.error ?? `Check-in de ${target.visitor_name} registrado.` })
    if (result.ok) {
      setLog((l) => [`${new Date().toLocaleTimeString('pt-BR')} — ${target.visitor_name} (${target.ticket_code})`, ...l].slice(0, 8))
    }
    setCode('')
    reloadAll()
  }

  async function handleCheck() {
    if (awaiting) return
    const typed = code.trim().toUpperCase()
    if (!typed) return
    const normalized = typed.replace(/[^A-Z0-9]/g, '')
    const target = eventRegs.find(
      (r) => (r.ticket_code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === normalized,
    )
    if (!target) {
      setNotice({ tone: 'error', text: `Nenhuma inscrição deste evento tem o código "${typed}".` })
      setCode('')
      return
    }

    const gate = waitlistAdmission(target, stats)
    if (gate.needsConfirmation) {
      setAwaiting({ registration: target, text: gate.text })
      return
    }
    await commit(target)
  }

  async function confirmQueue() {
    if (!awaiting) return
    const target = awaiting.registration
    setAwaiting(null)
    await commit(target)
  }

  function leaveInQueue() {
    setAwaiting(null)
    setCode('')
  }

  return (
    <div>
      <PageHeader title="Check-in" subtitle="Valide a presença dos participantes pelo código do ingresso no dia do evento." />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reloadAll}>Tentar de novo</Button>
        </div>
      )}

      {churchEvents.length === 0 ? (
        <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="Nenhum evento" description="Crie um evento para fazer o check-in dos participantes." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Código do ingresso"
              action={
                <Select value={selectedEvent} onChange={(e) => setEventId(e.target.value)} className="w-56" aria-label="Evento">
                  {churchEvents.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              }
            />
            <CardBody className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Digite ou bipe o código (ex.: A2F-9C3)"
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setAwaiting(null) }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                  aria-label="Código do ingresso"
                />
                <Button onClick={handleCheck} disabled={!code.trim() || Boolean(awaiting)} icon={<ScanLine className="h-4 w-4" />}>Registrar</Button>
              </div>

              {awaiting && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <p className="text-sm text-amber-800">{awaiting.text}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={confirmQueue} icon={<TicketCheck className="h-4 w-4" />}>
                      Confirmar admissão de {awaiting.registration.visitor_name}
                    </Button>
                    <Button variant="outline" size="sm" onClick={leaveInQueue}>Deixar na fila</Button>
                  </div>
                </div>
              )}

              {log.length > 0 && (
                <div className="rounded-lg bg-navy p-3 font-mono text-xs text-green">
                  {log.map((entry) => <div key={entry}>› {entry}</div>)}
                </div>
              )}

              {loading ? (
                <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="Carregando inscrições..." description="Consultando a lista do evento." />
              ) : (
                <div className="divide-y divide-line rounded-lg border border-line">
                  {eventRegs.length === 0 && (
                    <p className="px-3 py-4 text-sm text-slate-500">Nenhuma inscrição neste evento ainda.</p>
                  )}
                  {eventRegs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-navy">{r.visitor_name}</p>
                        <p className="text-xs text-slate-500">{r.visitor_email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-navy">{r.ticket_code ?? '—'}</code>
                        <Badge tone={r.status === 'checked_in' ? 'green' : r.status === 'cancelled' ? 'red' : 'neutral'}>
                          {r.status === 'checked_in' ? 'Presente' : r.status === 'cancelled' ? 'Cancelada' : r.status === 'waitlist' ? 'Lista de espera' : 'Confirmada'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Resumo" />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Inscritos</span>
                <Badge tone="brand">{stats ? stats.active_count : eventRegs.length}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Check-in feito</span>
                <Badge tone="green">{stats ? stats.checked_in_count : presentCount}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Lista de espera</span>
                <Badge tone="amber">{stats ? stats.waitlist_count : eventRegs.filter((r) => r.status === 'waitlist').length}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Presentes</span>
                <span className="font-semibold text-navy">
                  {Math.round((presentCount / Math.max(expectedCount, 1)) * 100)}%
                </span>
              </div>
              <div className="rounded-lg bg-surface p-3 text-center">
                <QrCode className="mx-auto h-10 w-10 text-navy" />
                <p className="mt-1 text-xs text-slate-500">
                  O código de cada ingresso está na lista acima e em Inscrições. QR Code impresso ainda não é gerado pelo
                  sistema — confira o código digitado ou bipado por scanner USB.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
