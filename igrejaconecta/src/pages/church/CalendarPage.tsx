import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, List } from 'lucide-react'
import { PageHeader, Button, Select, EmptyState } from '@/components/common/primitives'
import { EventStatusBadge } from '@/components/common/StatusBadges'
import { useChurchEvents, useEventCategories } from '@/hooks/useEvents'
import { formatDate } from '@/utils/format'
import { cn } from '@/utils/cn'

type View = 'month' | 'week' | 'day' | 'list'

export function CalendarPage() {
  const [view, setView] = useState<View>('month')
  const [category, setCategory] = useState('all')
  const [monthRef, setMonthRef] = useState(() => firstOfMonth(new Date()))
  const { rows: agenda, loading, error } = useChurchEvents()
  const { rows: categories } = useEventCategories()

  const churchEvents = agenda.filter((e) => (category === 'all' ? true : e.category_id === category))

  const byDay = useMemo(() => {
    const map = new Map<number, typeof churchEvents>()
    churchEvents.forEach((e) => {
      const d = new Date(e.starts_at)
      // Só o mês em exibição entra na grade: sem isso um evento de dezembro
      // apareceria no dia 12 de novembro.
      if (d.getFullYear() !== monthRef.getFullYear() || d.getMonth() !== monthRef.getMonth()) return
      const key = d.getDate()
      map.set(key, [...(map.get(key) ?? []), e])
    })
    return map
  }, [churchEvents, monthRef])

  const firstWeekday = monthRef.getDay()
  const daysInMonth = new Date(monthRef.getFullYear(), monthRef.getMonth() + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const monthLabel = monthRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  function shiftMonth(delta: number) {
    setMonthRef((current) => firstOfMonth(new Date(current.getFullYear(), current.getMonth() + delta, 1)))
  }

  return (
    <div>
      <PageHeader
        title="Calendário"
        subtitle="Visualize eventos por dia, semana, mês ou lista."
        actions={
          <>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
              <option value="all">Todas as categorias</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <div className="flex overflow-hidden rounded-lg border border-line">
              {(['month', 'week', 'day', 'list'] as View[]).map((v) => (
                <button key={v} onClick={() => setView(v)} className={cn('px-3 py-2 text-sm font-medium', view === v ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-surface')}>
                  {v === 'month' ? 'Mês' : v === 'week' ? 'Semana' : v === 'day' ? 'Dia' : 'Lista'}
                </button>
              ))}
            </div>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <EmptyState icon={<List className="h-6 w-6" />} title="Carregando agenda..." description="Consultando os eventos da sua igreja." />
      ) : view === 'list' ? (
        <div className="space-y-2">
          {churchEvents.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
              <div>
                <p className="font-medium text-navy">{e.name}</p>
                <p className="text-xs text-slate-500">{formatDate(e.starts_at)} · {e.category}</p>
              </div>
              <EventStatusBadge status={e.status} />
            </div>
          ))}
        </div>
      ) : view === 'month' ? (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <Button variant="ghost" size="sm" icon={<ChevronLeft className="h-4 w-4" />} aria-label="Mês anterior" onClick={() => shiftMonth(-1)} />
            <p className="font-semibold text-navy capitalize">{monthLabel}</p>
            <Button variant="ghost" size="sm" icon={<ChevronRight className="h-4 w-4" />} aria-label="Mês seguinte" onClick={() => shiftMonth(1)} />
          </div>
          <div className="grid grid-cols-7 border-b border-line bg-surface text-center text-xs font-semibold text-slate-500">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => (
              <div key={i} className={cn('min-h-[92px] border-b border-r border-line p-1.5', day === null && 'bg-surface/50')}>
                {day && (
                  <>
                    <span className="text-xs font-medium text-slate-400">{day}</span>
                    <div className="mt-1 space-y-1">
                      {(byDay.get(day) ?? []).map((e) => (
                        <div key={e.id} className="truncate rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{e.name}</div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-sm text-slate-500">
          <List className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Visão de {view === 'week' ? 'semana' : 'dia'} — estrutura pronta; os eventos filtrados por igreja/categoria/período aparecem aqui.
        </div>
      )}
    </div>
  )
}

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}
