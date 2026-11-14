import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Heart, CalendarDays, LogIn, Trash2 } from 'lucide-react'
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  Badge,
  Field,
  Input,
  EmptyState,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { EventCard } from '@/components/common/Cards'
import { registrationStatusMap } from '@/components/common/approvalMap'
import { useAuth } from '@/contexts/AuthContext'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { usePublicEvents } from '@/hooks/useEvents'
import { useMyRegistrations } from '@/hooks/useRegistrations'
import { useVisitorFavorites, useVisitorPreferences } from '@/hooks/useVisitorProfile'
import { removeVisitorFavorite } from '@/services/data/visitorFavoriteService'
import {
  VISITOR_CITY_MAX,
  VISITOR_INTERESTS,
  saveVisitorPreferences,
  type VisitorPreferenceDraft,
} from '@/services/data/visitorPreferenceService'
import { formatDate } from '@/utils/format'
import type { PublicEvent, VisitorInterest } from '@/types'

/**
 * Perfil do visitante (`/visitante/perfil`). As três listas da tela têm banco:
 * favoritos e preferências vêm de `visitor_favorites`/`visitor_preferences` (0016)
 * e o histórico vem de `event_registrations` pelo id da sessão (0012).
 *
 * A tela continua aberta a quem não entrou, mas aí não há lista nenhuma — e
 * fingir uma (com `localStorage` ou com os dois primeiros eventos publicados) é o
 * que estava aqui antes. Sem conta, o que se oferece é entrar.
 */

/** Os rótulos dos interesses que a 0016 aceita no CHECK de `interests`. */
const INTEREST_LABELS: Record<VisitorInterest, string> = {
  jovens: 'Jovens',
  familia: 'Família / casais',
  mulheres: 'Mulheres',
  homens: 'Homens',
  acao_social: 'Ação social',
}

export function VisitorProfilePage() {
  useDocumentMeta({ title: 'Meu perfil de visitante', path: '/visitante/perfil', noindex: true })
  const { isAuthenticated, initializing } = useAuth()
  const {
    userId,
    rows: favoriteRows,
    loading: favoritesLoading,
    error: favoritesError,
    reload: reloadFavorites,
  } = useVisitorFavorites()
  const { rows: onAir } = usePublicEvents()
  const { preferences, loading: preferencesLoading, error: preferencesError, reload: reloadPreferences } = useVisitorPreferences()
  const {
    rows: myRegistrations,
    loading: registrationsLoading,
    error: registrationsError,
    reload: reloadRegistrations,
  } = useMyRegistrations()

  // O evento favoritado que ainda está no ar é o que a política de `events`
  // devolve; o que saiu do ar não vira linha inventada — vira conta na nota.
  const favorites = useMemo(() => {
    const byId = new Map(onAir.map((event) => [event.id, event]))
    const listed: PublicEvent[] = []
    for (const row of favoriteRows) {
      const event = byId.get(row.event_id)
      if (event) listed.push(event)
    }
    return { listed, offAir: favoriteRows.length - listed.length }
  }, [favoriteRows, onAir])

  const favoritesBusy = isAuthenticated && favoritesLoading
  const registrationsBusy = isAuthenticated && registrationsLoading

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader
        title="Meu perfil de visitante"
        subtitle="Favoritos e preferências salvos na sua conta, e o histórico das suas inscrições."
      />

      {!isAuthenticated && (
        <Card className="mb-6">
          <CardHeader title="Nada salvo ainda" subtitle="Favoritos e preferências pertencem a uma conta." />
          <CardBody className="space-y-3">
            <p className="text-sm text-slate-600">
              Sem entrar não existe lista sua: o que aparecesse aqui seria inventado. Crie uma conta ou entre
              para salvar eventos e preferências.
            </p>
            <div className="flex gap-2">
              <Link to="/login">
                <Button icon={<LogIn className="h-4 w-4" />}>Entrar</Button>
              </Link>
              <Link to="/cadastro">
                <Button variant="outline">Criar conta</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {isAuthenticated && (
        <PreferenceCard
          key={userId ?? 'sem-conta'}
          userId={userId}
          saved={preferences}
          loading={preferencesLoading}
          error={preferencesError}
          onSaved={reloadPreferences}
        />
      )}

      <div className="mt-6">
        <h2 className="mb-3 inline-flex items-center gap-2 font-semibold text-navy">
          <Heart className="h-4 w-4 text-red-500" /> Meus favoritos
        </h2>
        {favoritesError && <Notice tone="error" text={favoritesError} onClose={reloadFavorites} />}
        {initializing ? (
          <EmptyState title="Consultando a sua sessão..." description="Sem conta confirmada não há lista para ler." />
        ) : favoritesBusy ? (
          <EmptyState title="Carregando favoritos..." description="Consultando os eventos que você salvou." />
        ) : favorites.listed.length === 0 ? (
          <EmptyState
            icon={<Heart className="h-8 w-8" />}
            title="Nenhum favorito no ar"
            description={
              isAuthenticated
                ? 'Toque no coração em um evento publicado para salvá-lo aqui.'
                : 'Entre na sua conta para salvar eventos.'
            }
          />
        ) : (
          <div className="space-y-4">
            {favorites.listed.map((event) => (
              <div key={event.id} className="flex items-start gap-3">
                <div className="flex-1">
                  <EventCard event={event} />
                </div>
                <RemoveFavoriteButton eventId={event.id} userId={userId} onRemoved={reloadFavorites} />
              </div>
            ))}
            {favorites.offAir > 0 && (
              <p className="text-xs text-slate-500">
                {favorites.offAir} favorito(s) que você salvou não está mais publicado — some da lista enquanto
                o evento não voltar ao ar.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 inline-flex items-center gap-2 font-semibold text-navy">
          <CalendarDays className="h-4 w-4 text-brand-600" /> Minhas inscrições
        </h2>
        {registrationsError && <Notice tone="error" text={registrationsError} onClose={reloadRegistrations} />}
        {registrationsBusy ? (
          <EmptyState title="Carregando inscrições..." description="Consultando as inscrições da sua conta." />
        ) : myRegistrations.length === 0 ? (
          <EmptyState
            title="Sem inscrições nesta conta"
            description={
              isAuthenticated
                ? 'Inscreva-se entrando na sua conta: inscrição feita sem conta fica com a igreja, e não aparece aqui.'
                : 'Quando você se inscrever em um evento entrando na sua conta, ele aparece aqui com o código do check-in.'
            }
          />
        ) : (
          <ul className="space-y-3">
            {myRegistrations.map((registration) => {
              const status = registrationStatusMap[registration.status]
              return (
                <li key={registration.id} className="rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* A rota pública é por slug, e o slug vem do embed `events`. Linha
                        de evento que já saiu do banco não vira link quebrado. */}
                    {registration.event_slug ? (
                      <Link
                        to={`/eventos/${registration.event_slug}`}
                        className="font-medium text-navy hover:text-brand-700"
                      >
                        {registration.event_name ?? 'Evento'}
                      </Link>
                    ) : (
                      <span className="font-medium text-navy">{registration.event_name ?? 'Evento'}</span>
                    )}
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Inscrito em {formatDate(registration.created_at)}</p>
                  {registration.ticket_code ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Código para o check-in: <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-navy">{registration.ticket_code}</code>
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      O código aparece quando a igreja confirma a inscrição — quem se inscreve sem conta recebe a lista por dentro.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {isAuthenticated && (
        <p className="mt-8 text-xs text-slate-500">
          Nome, e-mail e telefone não mudam aqui: são da sua conta e se editam no{' '}
          <Link to="/app/perfil" className="font-medium text-brand-700 hover:underline">
            seu perfil
          </Link>
          .
        </p>
      )}
    </div>
  )
}

/**
 * Cidade e interesses da conta (`visitor_preferences`, 0016). O botão salva e a
 * tela remarca com o que o banco devolve — o que está nos campos depois do "salvo"
 * é a resposta do banco, não o pedido.
 */
function PreferenceCard({
  userId,
  saved,
  loading,
  error,
  onSaved,
}: {
  userId?: string
  saved: { city: string | null; interests: VisitorInterest[] } | null
  loading: boolean
  error: string | null
  onSaved: () => void
}) {
  const seed = useMemo<VisitorPreferenceDraft>(
    () => ({ city: saved?.city ?? '', interests: saved?.interests ?? [] }),
    [saved],
  )
  const [form, setForm] = useState<VisitorPreferenceDraft>(seed)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const dirty = form.city !== seed.city || form.interests.join('|') !== seed.interests.join('|')

  if (loading) {
    return (
      <Card>
        <CardHeader title="Minhas preferências" subtitle="Consultando o que a sua conta salvou." />
        <CardBody>
          <EmptyState title="Carregando preferências..." description="Nada é mostrado antes da resposta do banco." />
        </CardBody>
      </Card>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setNotice(null)
    const result = await saveVisitorPreferences(form, { userId })
    setSaving(false)
    if (result.ok) {
      setForm({ city: result.preferences.city ?? '', interests: result.preferences.interests })
      setNotice({ tone: 'ok', text: 'Preferências gravadas: o que está nos campos é o que o banco devolveu.' })
      onSaved()
    } else {
      setNotice({ tone: 'error', text: result.error })
    }
  }

  function toggleInterest(interest: VisitorInterest) {
    setForm((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest],
    }))
  }

  return (
    <Card>
      <CardHeader title="Minhas preferências" subtitle="Só o que a sua conta vê — e só o que o banco guarda." />
      <CardBody className="space-y-4">
        {error && <Notice tone="error" text={error} onClose={onSaved} />}
        {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Cidade" hint={`Até ${VISITOR_CITY_MAX} caracteres. É o que você procura, não o endereço do seu cadastro.`}>
            <Input
              value={form.city}
              maxLength={VISITOR_CITY_MAX}
              onChange={(e) => setForm((current) => ({ ...current, city: e.target.value }))}
              placeholder="Ex.: Jacutinga"
            />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-navy">Interesses</legend>
            <div className="flex flex-wrap gap-2">
              {VISITOR_INTERESTS.map((interest) => {
                const checked = form.interests.includes(interest)
                return (
                  <label
                    key={interest}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      checked ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-white text-slate-600'
                    }`}
                  >
                    <input type="checkbox" className="h-4 w-4" checked={checked} onChange={() => toggleInterest(interest)} />
                    {INTEREST_LABELS[interest]}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? 'Salvando…' : 'Salvar preferências'}
            </Button>
            <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setForm(seed)}>
              Descartar
            </Button>
            {!dirty && <span className="text-xs text-slate-500">Nada para salvar: os campos estão iguais ao que o banco tem.</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function RemoveFavoriteButton({
  eventId,
  userId,
  onRemoved,
}: {
  eventId: string
  userId?: string
  onRemoved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    const result = await removeVisitorFavorite(eventId, userId)
    setBusy(false)
    if (result.ok) onRemoved()
    else setError(result.error)
  }

  return (
    <div className="w-40 shrink-0 space-y-1">
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        icon={<Trash2 className="h-4 w-4" />}
        disabled={busy}
        onClick={remove}
      >
        {busy ? 'Removendo…' : 'Remover'}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
