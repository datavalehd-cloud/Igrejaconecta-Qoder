import { useMemo, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { PageHeader, Input, EmptyState, SectionTitle } from '@/components/common/primitives'
import { EventCard, ChurchCard } from '@/components/common/Cards'
import { useDirectoryChurches } from '@/hooks/useChurches'
import { usePublicEvents } from '@/hooks/useEvents'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function SearchPage() {
  useDocumentMeta({ title: 'Buscar', path: '/buscar' })
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const { rows: verifiedChurches, loading: churchesLoading, error: churchesError } = useDirectoryChurches()
  const { rows: onAir } = usePublicEvents()

  const matchedEvents = useMemo(
    () => (term
      ? onAir.filter((e) => e.name.toLowerCase().includes(term) || (e.category ?? '').toLowerCase().includes(term) || (e.church_name ?? '').toLowerCase().includes(term))
      : []),
    [term, onAir],
  )
  const matchedChurches = useMemo(
    () => (term ? verifiedChurches.filter((c) => c.name.toLowerCase().includes(term) || (c.city ?? '').toLowerCase().includes(term)) : []),
    [term, verifiedChurches],
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Busca" subtitle="Pesquise eventos e igrejas em toda a plataforma." />
      <div className="relative mb-8 max-w-xl">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" autoFocus placeholder="Digite um termo..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {churchesError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{churchesError}</div>
      )}

      {!term ? (
        <EmptyState icon={<SearchIcon className="h-8 w-8" />} title="Comece a digitar" description="Busque por nome de evento, categoria, igreja, cidade ou denominação." />
      ) : churchesLoading ? (
        <EmptyState icon={<SearchIcon className="h-8 w-8" />} title="Buscando igrejas..." description="Consultando as comunidades verificadas." />
      ) : matchedEvents.length + matchedChurches.length === 0 ? (
        <EmptyState title="Nada encontrado" description={`Nenhum resultado para "${q}".`} />
      ) : (
        <div className="space-y-10">
          {matchedEvents.length > 0 && (
            <section>
              <SectionTitle title="Eventos" subtitle={`${matchedEvents.length} resultado(s)`} />
              <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {matchedEvents.map((e) => <EventCard key={e.id} event={e} />)}
              </div>
            </section>
          )}
          {matchedChurches.length > 0 && (
            <section>
              <SectionTitle title="Igrejas" subtitle={`${matchedChurches.length} resultado(s)`} />
              <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {matchedChurches.map((c) => <ChurchCard key={c.id} church={c} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
