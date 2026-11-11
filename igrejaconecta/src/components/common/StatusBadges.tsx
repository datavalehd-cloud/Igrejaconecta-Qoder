import { Badge } from './primitives'
import { approvalMap, registrationStatusMap, type BadgeTone } from './approvalMap'
import type { ApprovalStatus, ChurchEvent, EventStatus, Registration } from '@/types'

const eventStatusMap: Record<EventStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  scheduled: { label: 'Agendado', tone: 'brand' },
  published: { label: 'Publicado', tone: 'green' },
  cancelled: { label: 'Cancelado', tone: 'red' },
  finished: { label: 'Encerrado', tone: 'navy' },
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const m = approvalMap[status]
  return <Badge tone={m.tone}>{m.label}</Badge>
}

export function EventStatusBadge({ status }: { status: ChurchEvent['status'] }) {
  const m = eventStatusMap[status]
  return <Badge tone={m.tone}>{m.label}</Badge>
}

export function RegistrationBadge({ status }: { status: Registration['status'] }) {
  const m = registrationStatusMap[status]
  return <Badge tone={m.tone}>{m.label}</Badge>
}
