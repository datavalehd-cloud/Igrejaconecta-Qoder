import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Sparkles, CalendarDays, Share2 } from 'lucide-react'
import { Button, SectionTitle } from '@/components/common/primitives'
import { EventCard, ChurchCard } from '@/components/common/Cards'
import { useDirectoryChurches } from '@/hooks/useChurches'
import { usePublicEvents } from '@/hooks/useEvents'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

const features = [
  { icon: CalendarDays, title: 'Eventos organizados', text: 'Cadastre cultos, congressos e ações sociais com inscrições e check-in.' },
  { icon: MapPin, title: 'Encontre igrejas', text: 'Mapa com igrejas próximas, rotas e horários dos cultos.' },
  { icon: Sparkles, title: 'IgrejaConecta AI', text: 'Gere textos, artes, vídeos e campanhas completas em segundos.' },
  { icon: Share2, title: 'Divulgação automática', text: 'Publique em Instagram, Facebook, TikTok e WhatsApp.' },
]

export function HomePage() {
  useDocumentMeta({ path: '/' })
  const { rows: onAir } = usePublicEvents()
  const featured = onAir.slice(0, 3)
  const { rows: verifiedChurches, loading: churchesLoading, error: churchesError } = useDirectoryChurches()
  const featuredChurches = verifiedChurches.slice(0, 3)

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy text-white">
        <div className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full bg-brand/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-72 w-72 rounded-full bg-green/20 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 text-green" /> Plataforma cristã de conexão e eventos
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight sm:text-5xl">
              Conectando igrejas e pessoas através de <span className="text-green">eventos</span>.
            </h1>
            <p className="mt-5 text-lg text-slate-300">
              Divulgue seus eventos, alcance novos visitantes, gerencie inscrições e crie
              materiais de divulgação com inteligência artificial.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/eventos"><Button size="lg" icon={<ArrowRight className="h-4 w-4" />}>Explorar eventos</Button></Link>
              <Link to="/cadastro">
                <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">
                  Cadastrar minha igreja
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-white p-5 shadow-sm">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-semibold text-navy">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Eventos em destaque */}
      <section className="bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <SectionTitle
            title="Eventos em destaque"
            subtitle="Congressos, cultos e encontros publicados pelas igrejas."
            action={<Link to="/eventos" className="text-sm font-semibold text-brand-600 hover:underline">Ver todos <ArrowRight className="inline h-4 w-4" /></Link>}
          />
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      </section>

      {/* Igrejas em destaque */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <SectionTitle
          title="Igrejas em destaque"
          subtitle="Comunidades verificadas perto de você."
          action={<Link to="/igrejas" className="text-sm font-semibold text-brand-600 hover:underline">Ver todas <ArrowRight className="inline h-4 w-4" /></Link>}
        />
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {churchesError && (
            <p className="text-sm text-red-700 sm:col-span-2 lg:col-span-3">{churchesError}</p>
          )}
          {!churchesError && churchesLoading && (
            <p className="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">Carregando igrejas verificadas...</p>
          )}
          {!churchesError && !churchesLoading && featuredChurches.length === 0 && (
            <p className="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
              Nenhuma igreja aprovada e ativa publicada ainda.
            </p>
          )}
          {featuredChurches.map((c) => <ChurchCard key={c.id} church={c} />)}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-navy px-6 py-12 text-center text-white sm:px-12">
          <h2 className="text-2xl font-bold sm:text-3xl">Sua igreja ainda não está no IgrejaConecta?</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-200">
            Cadastro gratuito. Crie o perfil da sua igreja, publique eventos e alcance
            novas pessoas na sua cidade.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/cadastro"><Button size="lg" variant="success">Criar conta de igreja</Button></Link>
            <Link to="/mapa">
              <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">Ver mapa</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
