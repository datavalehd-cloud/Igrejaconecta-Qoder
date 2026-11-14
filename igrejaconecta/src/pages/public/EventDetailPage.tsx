import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarDays, Clock, MapPin, Users, Heart, Share2, Ticket, ArrowLeft, CheckCircle2, Copy, MessageCircle } from 'lucide-react'
import { Button, Badge, Card, CardBody, EmptyState, Field, Input } from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { EventCard } from '@/components/common/Cards'
import { usePublicEvent, usePublicEvents } from '@/hooks/useEvents'
import { useRegistrationStats } from '@/hooks/useRegistrations'
import { useVisitorFavorites } from '@/hooks/useVisitorProfile'
import { addVisitorFavorite, removeVisitorFavorite } from '@/services/data/visitorFavoriteService'
import { registerForEvent } from '@/services/data/registrationService'
import { formatDate, formatRegistrations, whatsappLink } from '@/utils/format'
import { absoluteUrl, canWebShare, copyToClipboard, utmLink, webShare, whatsappShareLink } from '@/utils/share'
import { eventToJsonLd } from '@/utils/seo'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

/**
 * Formulário de inscrição do visitante. Chama `register_for_event` (0012), que é
 * a única porta de escrita em `event_registrations`, e mostra exatamente o estado
 * que o banco confirmou: `confirmed` ou `waitlist`. Nenhum ingresso aparece aqui
 * — o `ticket_code` fica com a equipe, porque quem digitou o e-mail ainda não
 * provou que é dono dele.
 */
function RegisterForm({ eventId, full, onRegistered }: { eventId: string; full: boolean; onRegistered: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const response = await registerForEvent({ eventId, name, email, phone })
    setSaving(false)
    if (response.ok) {
      setResult({
        ok: true,
        text: response.status === 'waitlist'
          ? 'O evento lotou: você entrou na lista de espera. Se abrir vaga, a igreja promove a sua inscrição.'
          : 'Inscrição confirmada. A equipe da igreja tem o seu código para o check-in no dia.',
      })
      setName('')
      setEmail('')
      setPhone('')
      onRegistered()
    } else {
      setResult({ ok: false, text: response.error ?? 'Não foi possível concluir a inscrição.' })
    }
  }

  if (result?.ok) {
    return (
      <div className="mt-4 space-y-2">
        <div className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.text}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setResult(null)}>Inscrever outra pessoa</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <Field label="Nome completo">
        <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
      </Field>
      <Field label="E-mail">
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" />
      </Field>
      <Field label="WhatsApp (opcional)">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(12) 99999-0000" />
      </Field>
      {result && <Notice tone="error" text={result.text} onClose={() => setResult(null)} />}
      <Button type="submit" className="w-full" disabled={saving} icon={<Ticket className="h-4 w-4" />}>
        {saving ? 'Registrando…' : full ? 'Entrar na lista de espera' : 'Confirmar inscrição'}
      </Button>
    </form>
  )
}

/**
 * Coração de verdade (`visitor_favorites`, 0016). O estado vem da leitura da própria
 * conta, e o clique só pinta depois de o banco responder — até aqui era um
 * `useState(false)`: esvaziava ao trocar de página e não salvava nada.
 *
 * Sem conta não existe favorito a salvar (a RLS é `user_id = auth.uid()`), então o
 * botão vira link de entrada em vez de ligar o coração no vazio.
 */
function FavoriteButton({
  eventId,
  userId,
  favorite,
  reading,
  onChanged,
}: {
  eventId: string
  userId?: string
  favorite: boolean
  reading: boolean
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!userId) {
    return (
      <Link to="/login" className="flex-1">
        <Button variant="outline" className="w-full" icon={<Heart className="h-4 w-4" />}>
          Entre para salvar
        </Button>
      </Link>
    )
  }

  async function toggle() {
    setSaving(true)
    setError(null)
    const result = favorite
      ? await removeVisitorFavorite(eventId, userId)
      : await addVisitorFavorite(eventId, userId)
    setSaving(false)
    if (result.ok) onChanged()
    else setError(result.error ?? 'Não foi possível atualizar o favorito.')
  }

  return (
    <div className="flex-1">
      <Button
        variant="outline"
        className="w-full"
        disabled={saving || reading}
        icon={<Heart className={favorite ? 'h-4 w-4 fill-red-500 text-red-500' : 'h-4 w-4'} />}
        onClick={toggle}
      >
        {saving ? 'Salvando…' : reading ? 'Consultando…' : favorite ? 'Nos favoritos' : 'Favoritar'}
      </Button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function EventDetailPage() {
  const { slug } = useParams()
  const { event, loading, error } = usePublicEvent(slug)
  const { rows: onAir } = usePublicEvents()
  const { byEvent, reload: reloadStats } = useRegistrationStats()
  const {
    userId,
    eventIds,
    loading: favoritesLoading,
    reload: reloadFavorites,
  } = useVisitorFavorites()

  // Meta e JSON-LD do evento real. Enquanto carrega não se indexa nem se inventa;
  // só quando confirmado inexistente vira noindex ("não encontrado").
  const notFound = !loading && !event
  useDocumentMeta(
    event
      ? {
          title: event.name,
          description: event.description ?? undefined,
          path: `/eventos/${event.slug}`,
          image: event.cover_url ?? undefined,
          jsonLd: eventToJsonLd(event),
        }
      : {
          title: notFound ? 'Evento não encontrado' : 'Evento',
          path: slug ? `/eventos/${slug}` : '/eventos',
          noindex: notFound,
        },
  )

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState title="Carregando evento..." description="Consultando o evento publicado." />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        <EmptyState title="Evento não encontrado" description="O evento pode ter sido removido, não está mais publicado ou o link está incorreto." action={<Link to="/eventos"><Button>Ver eventos</Button></Link>} />
      </div>
    )
  }

  const church = event.church ?? null
  const stats = byEvent.get(event.id)
  const full = stats?.spots_left === 0
  // Link público desta página, marcado com UTM para saber de onde veio o acesso.
  const shareUrl = utmLink(absoluteUrl(`/eventos/${event.slug}`), {
    source: 'igrejaconecta', medium: 'social', campaign: event.name, content: event.slug,
  })
  const shareText = `Participe do evento "${event.name}" — ${formatDate(event.starts_at)}${event.city ? ` em ${event.city}` : ''}. ${shareUrl}`
  const related = onAir.filter((e) => e.id !== event.id).slice(0, 3)

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link to="/eventos" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Voltar para eventos
      </Link>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="relative flex h-56 items-end bg-gradient-to-br from-navy to-brand-600 p-6 sm:h-72">
          <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="relative">
            <Badge tone="brand" className="bg-white/20 text-white border-white/30">{event.category}</Badge>
            <h1 className="mt-3 text-3xl font-extrabold text-white sm:text-4xl">{event.name}</h1>
          </div>
        </div>

        <div className="grid gap-8 p-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow icon={<CalendarDays className="h-4 w-4" />} label="Data" value={formatDate(event.starts_at)} />
              <InfoRow icon={<Clock className="h-4 w-4" />} label="Horário" value={new Date(event.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} />
              <InfoRow icon={<MapPin className="h-4 w-4" />} label="Local" value={[event.address ?? 'A definir', event.city].filter(Boolean).join(' — ')} />
              <InfoRow
                icon={<Users className="h-4 w-4" />}
                label="Inscritos"
                value={formatRegistrations(stats?.active_count, event.capacity)}
              />
            </div>

            <h2 className="mt-8 text-lg font-semibold text-navy">Sobre o evento</h2>
            <p className="mt-2 whitespace-pre-line text-slate-600">{event.description}</p>

            {church && (
              <div className="mt-8">
                <h2 className="text-lg font-semibold text-navy">Organizado por</h2>
                <Card className="mt-3">
                  <CardBody className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-navy">{church.name}</p>
                      <p className="text-sm text-slate-500">
                        {[church.denomination, church.city ? `${church.city}${church.state ? `/${church.state}` : ''}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {church.whatsapp && (
                      <a href={whatsappLink(church.whatsapp, `Olá! Vi a igreja de vocês no IgrejaConecta.`)} target="_blank" rel="noopener noreferrer">
                        <Button variant="success" size="sm">WhatsApp</Button>
                      </a>
                    )}
                  </CardBody>
                </Card>
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="lg:col-span-1">
            <Card className="sticky top-20">
              <CardBody>
                <p className="text-sm text-slate-500">
                  {event.is_free ? <Badge tone="green">Gratuito</Badge> : <Badge tone="amber">Pago</Badge>}
                  {typeof stats?.spots_left === 'number' && (
                    <span className="ml-2 text-xs text-slate-500">
                      {stats.spots_left > 0 ? `${stats.spots_left} vaga(s) restante(s)` : 'Lotado — lista de espera'}
                    </span>
                  )}
                </p>
                <RegisterForm eventId={event.id} full={full} onRegistered={reloadStats} />
                <div className="mt-3 flex gap-2">
                  <FavoriteButton
                    eventId={event.id}
                    userId={userId}
                    favorite={eventIds.has(event.id)}
                    reading={favoritesLoading}
                    onChanged={reloadFavorites}
                  />
                </div>
                <EventShare url={shareUrl} title={event.name} text={shareText} />
                <p className="mt-3 text-xs text-slate-400">
                  A inscrição entra na lista de participantes da igreja, que faz o check-in pelo código do ingresso no dia
                  do evento. Não enviamos e-mail nem WhatsApp por aqui — quem avisa é a igreja.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <div className="mt-12">
          <h2 className="mb-4 text-lg font-semibold text-navy">Você também pode gostar</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
      <span className="mt-0.5 text-brand-600">{icon}</span>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm font-medium text-navy">{value}</p>
      </div>
    </div>
  )
}

/**
 * Distribuição sem chave: WhatsApp, copiar link (com UTM) e compartilhamento nativo.
 * Nada aqui fala com rede social nem finge sucesso — se o navegador não tem clipboard
 * ou Web Share, o aviso diz isso e sobra o caminho manual.
 */
function EventShare({ url, title, text }: { url: string; title: string; text: string }) {
  const [feedback, setFeedback] = useState<string | null>(null)

  async function copy() {
    const ok = await copyToClipboard(url)
    setFeedback(ok ? 'Link copiado.' : 'Não foi possível copiar; selecione o link manualmente.')
  }

  async function share() {
    const result = await webShare({ title, text, url })
    if (!result.ok && result.reason !== 'cancelled') {
      setFeedback(result.reason === 'unsupported'
        ? 'Este navegador não tem compartilhamento nativo; use WhatsApp ou copie o link.'
        : 'Não foi possível abrir o compartilhamento.')
    }
  }

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-medium text-slate-500">Divulgar este evento</p>
      <div className="flex gap-2">
        <a href={whatsappShareLink(text)} target="_blank" rel="noopener noreferrer" className="flex-1">
          <Button variant="success" className="w-full" size="sm" icon={<MessageCircle className="h-4 w-4" />}>WhatsApp</Button>
        </a>
        <Button variant="outline" className="flex-1" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copy}>Copiar</Button>
        <Button variant="outline" className="flex-1" size="sm" icon={<Share2 className="h-4 w-4" />} onClick={share} disabled={!canWebShare()}>Share</Button>
      </div>
      {feedback && <p className="mt-1.5 text-xs text-slate-500">{feedback}</p>}
    </div>
  )
}
