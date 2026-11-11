import { useMemo, useState } from 'react'
import { Search, CalendarDays, Church as ChurchIcon } from 'lucide-react'
import { PageHeader, Input, Select, EmptyState } from '@/components/common/primitives'
import { EventCard, ChurchCard } from '@/components/common/Cards'
import { useDirectoryChurches } from '@/hooks/useChurches'
import { useEventCategories, usePublicEvents } from '@/hooks/useEvents'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function EventsPage() {
  useDocumentMeta({ title: 'Eventos', path: '/eventos' })
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [city, setCity] = useState('all')
  const { rows: onAir, loading, error } = usePublicEvents()
  const { rows: categories } = useEventCategories()

  const cities = useMemo(
    () => Array.from(new Set(onAir.map((e) => e.city).filter(Boolean))) as string[],
    [onAir],
  )

  // O que está no ar já vem filtrado pela política (publicado, público e de igreja
  // aprovada); aqui só entram os filtros que o visitante escolhe na tela.
  const filtered = onAir
    .filter((e) => (category === 'all' ? true : e.category_id === category))
    .filter((e) => (city === 'all' ? true : e.city === city))
    .filter((e) => (query ? e.name.toLowerCase().includes(query.toLowerCase()) : true))

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Eventos" subtitle="Encontre cultos, congressos e encontros perto de você." />

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-8 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-3">
        <div className="relative sm:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Buscar evento..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">Todas as categorias</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="all">Todas as cidades</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      {loading ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Carregando eventos..." description="Consultando os eventos publicados pelas igrejas verificadas." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum evento encontrado" description="Ajuste os filtros ou volte mais tarde." />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => <EventCard key={e.id} event={e} />)}
        </div>
      )}
    </div>
  )
}

export function ChurchesPage() {
  useDocumentMeta({ title: 'Igrejas', path: '/igrejas' })
  const { rows, loading, error } = useDirectoryChurches()

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Igrejas" subtitle="Comunidades cadastradas e verificadas no IgrejaConecta." />

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <EmptyState icon={<ChurchIcon className="h-6 w-6" />} title="Carregando igrejas..." description="Consultando as comunidades verificadas." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ChurchIcon className="h-6 w-6" />}
          title="Nenhuma igreja publicada"
          description="Aparecem aqui só as igrejas aprovadas e com a conta ativa."
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => <ChurchCard key={c.id} church={c} />)}
        </div>
      )}
    </div>
  )
}

export function CategoriesPage() {
  useDocumentMeta({ title: 'Categorias', path: '/categorias' })
  const { rows: categories, loading: categoriesLoading, error: categoriesError } = useEventCategories()
  const { rows: onAir } = usePublicEvents()

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Categorias" subtitle="Navegue pelos tipos de eventos disponíveis." />

      {categoriesError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{categoriesError}</div>
      )}

      {categoriesLoading ? (
        <EmptyState title="Carregando categorias..." description="Consultando o catálogo de categorias." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const count = onAir.filter((e) => e.category_id === c.id).length
            return (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
                <span className="font-medium text-navy">{c.name}</span>
                <span className="text-sm text-slate-400">{count} evento(s) no ar</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
