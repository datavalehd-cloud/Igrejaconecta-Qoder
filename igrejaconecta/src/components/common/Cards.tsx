import { Link } from 'react-router-dom'
import { CalendarDays, MapPin, Church as ChurchIcon, BadgeCheck } from 'lucide-react'
import type { Church, PublicEvent } from '@/types'
import { formatDate } from '@/utils/format'
import { Badge } from './primitives'
import { ApprovalBadge, EventStatusBadge } from './StatusBadges'

function CoverGradient({ seed, label }: { seed: string; label?: string }) {
  const gradients = [
    'from-navy to-brand-600',
    'from-brand-600 to-green-600',
    'from-navy-800 to-brand-700',
    'from-green-700 to-brand-600',
  ]
  const idx = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % gradients.length
  return (
    <div className={`relative flex h-40 items-end bg-gradient-to-br ${gradients[idx]} p-4`}>
      <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:16px_16px]" />
      {label && <span className="relative text-sm font-semibold text-white/90">{label}</span>}
    </div>
  )
}

export function EventCard({ event }: { event: PublicEvent }) {
  return (
    <Link
      to={`/eventos/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm transition hover:shadow-md"
    >
      <CoverGradient seed={event.id} label={event.category} />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="brand"><CalendarDays className="h-3 w-3" />{formatDate(event.starts_at)}</Badge>
          {event.is_free && <Badge tone="green">Gratuito</Badge>}
        </div>
        <h3 className="font-semibold text-navy group-hover:text-brand-700">{event.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{event.description}</p>
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><ChurchIcon className="h-3.5 w-3.5" />{event.church_name}</span>
          {event.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{event.city}</span>}
        </div>
      </div>
    </Link>
  )
}

export function ChurchCard({ church }: { church: Church }) {
  const verified = church.approval_status === 'approved'
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <CoverGradient seed={church.id} label={church.denomination ?? undefined} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-navy">{church.name}</h3>
          {verified ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
              <BadgeCheck className="h-4 w-4" /> Verificada
            </span>
          ) : (
            <ApprovalBadge status={church.approval_status} />
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{church.description}</p>
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          {church.address && <p className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{church.address} — {church.city}/{church.state}</p>}
        </div>
      </div>
    </div>
  )
}

export { EventStatusBadge }
