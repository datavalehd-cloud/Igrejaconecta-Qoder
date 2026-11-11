import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, CalendarDays, Save, Send, Undo2, Upload } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Textarea, Select, Badge, EmptyState } from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { CoordsField } from '@/components/common/CoordsField'
import { EventStatusBadge } from '@/components/common/StatusBadges'
import { useChurchEvents, useEventCategories } from '@/hooks/useEvents'
import { useChurchBranches } from '@/hooks/useBranches'
import { usePermissions } from '@/hooks/usePermissions'
import {
  createEvent,
  setEventStatus,
  updateEvent,
  type EventCreationStatus,
  type EventDraft,
} from '@/services/data/eventService'
import { fromDateTimeInput, toDateTimeInput } from '@/utils/format'
import type { ChurchEvent, EventStatus, EventVisibility } from '@/types'

/**
 * Criar e editar evento (Fase 3, passo 3). A escrita vai para `public.events`
 * pelas políticas da 0011 — `events.manage` na linha da própria igreja — e
 * publicar passa pelo trigger `trg_events_publish`, que exige `events.publish`.
 *
 * O que esta tela não faz, de propósito:
 *   * não muda o `slug`: o endereço público nasce do nome na criação, e os links
 *     já divulgados continuam valendo;
 *   * não muda a igreja do evento (o WITH CHECK da política recusa — caso M10);
 *   * não oferece ingresso pago: o produto não cobra, então `is_free` fica no
 *     default do banco.
 *
 * Campos sem coluna na tabela ficam desabilitados com o motivo à vista, em vez de
 * sumirem: quem testa o desenho precisa saber o que ainda não grava. Filial e
 * coordenadas já gravam (Fase 4, migração 0013); só o vídeo continua sem coluna.
 */

interface FormState {
  name: string
  description: string
  categoryId: string
  startsAt: string
  endsAt: string
  address: string
  city: string
  coverUrl: string
  capacity: string
  visibility: EventVisibility
  branchId: string
  latitude: string
  longitude: string
}

function parseCoord(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function toFormState(event?: ChurchEvent): FormState {
  if (!event) {
    return {
      name: '', description: '', categoryId: '', startsAt: '', endsAt: '',
      address: '', city: '', coverUrl: '', capacity: '', visibility: 'public',
      branchId: '', latitude: '', longitude: '',
    }
  }
  return {
    name: event.name,
    description: event.description ?? '',
    categoryId: event.category_id,
    startsAt: toDateTimeInput(event.starts_at),
    endsAt: toDateTimeInput(event.ends_at),
    address: event.address ?? '',
    city: event.city ?? '',
    coverUrl: event.cover_url ?? '',
    capacity: event.capacity ? String(event.capacity) : '',
    visibility: event.visibility,
    branchId: event.branch_id ?? '',
    latitude: event.latitude != null ? String(event.latitude) : '',
    longitude: event.longitude != null ? String(event.longitude) : '',
  }
}

export function EventFormPage() {
  const { id } = useParams()
  const { churchId } = usePermissions()
  const { rows, loading } = useChurchEvents()

  const back = (
    <Link to="/app/eventos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy">
      <ArrowLeft className="h-4 w-4" /> Voltar para eventos
    </Link>
  )

  if (!churchId) {
    return (
      <div>
        {back}
        <PageHeader title="Evento" subtitle="Criar e editar os eventos da sua igreja." />
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="A sua sessão não tem igreja ativa"
          description="Evento pertence a uma igreja: o SuperAdmin não cria evento daqui, e quem ainda não entrou em nenhuma igreja também não. Use a conta de quem organiza o evento."
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div>
        {back}
        <PageHeader title="Evento" subtitle="Criar e editar os eventos da sua igreja." />
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Carregando..." description="Buscando a agenda da sua igreja." />
      </div>
    )
  }

  const editing = id ? rows.find((e) => e.id === id) : undefined

  if (id && !editing) {
    return (
      <div>
        {back}
        <PageHeader title="Evento" subtitle="Criar e editar os eventos da sua igreja." />
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="Evento não encontrado"
          description="Ele não existe ou não é da sua igreja. O banco devolve as duas situações do mesmo jeito, então a tela não sabe qual delas é."
        />
      </div>
    )
  }

  // `key` pelo id: trocar de evento remonta o formulário em vez de depender de
  // effect para repor os campos, e salvar não apaga o que está sendo digitado.
  return <EventForm key={editing?.id ?? 'novo'} event={editing} />
}

function EventForm({ event }: { event?: ChurchEvent }) {
  const navigate = useNavigate()
  const { can, churchId, role } = usePermissions()
  const { rows: categories, loading: categoriesLoading } = useEventCategories()
  const { rows: branchRows, loading: branchesLoading } = useChurchBranches()
  const [form, setForm] = useState(() => toFormState(event))
  // A escrita devolve a linha gravada: é ela que alimenta o cartão de status.
  // Reler a agenda aqui trocaria a chave do `useKeyedList`, a lista esvaziaria e o
  // formulário desmontaria no meio — o aviso de "salvo" sumiria junto.
  const [current, setCurrent] = useState(event)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const draft: EventDraft = {
    name: form.name,
    category_id: form.categoryId,
    description: form.description,
    starts_at: fromDateTimeInput(form.startsAt) ?? '',
    ends_at: fromDateTimeInput(form.endsAt),
    address: form.address,
    city: form.city,
    cover_url: form.coverUrl,
    capacity: form.capacity.trim() === '' ? null : Number(form.capacity),
    visibility: form.visibility,
    branch_id: form.branchId || null,
    latitude: parseCoord(form.latitude),
    longitude: parseCoord(form.longitude),
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const canPublish = can('events.publish')

  async function save(status: EventCreationStatus) {
    setBusy(`create-${status}`)
    const result = await createEvent(draft, { churchId, role }, status)
    setBusy(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    navigate('/app/eventos')
  }

  async function saveChanges() {
    if (!current) return
    setBusy('update')
    const result = await updateEvent(current.id, draft, { churchId, role })
    setBusy(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setCurrent(result.event)
    setNotice({ tone: 'ok', text: 'Alterações salvas.' })
  }

  async function transition(next: EventStatus, message: string) {
    if (!current) return
    setBusy(`status-${next}`)
    const result = await setEventStatus(current.id, next, { churchId, role })
    setBusy(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setCurrent(result.event)
    setNotice({ tone: 'ok', text: message })
  }

  return (
    <div>
      <Link to="/app/eventos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Voltar para eventos
      </Link>
      <PageHeader
        title={current ? 'Editar evento' : 'Novo evento'}
        subtitle={
          current
            ? `Endereço público: /${current.slug} — ele não muda, para os links já divulgados continuarem valendo.`
            : 'Preencha os dados e escolha a visibilidade. O endereço público é gerado a partir do nome.'
        }
        actions={
          current ? (
            <Button icon={<Save className="h-4 w-4" />} disabled={busy !== null} onClick={saveChanges}>
              {busy === 'update' ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          ) : (
            <>
              <Button variant="outline" icon={<Save className="h-4 w-4" />} disabled={busy !== null} onClick={() => save('draft')}>
                {busy === 'create-draft' ? 'Salvando...' : 'Salvar rascunho'}
              </Button>
              {canPublish && (
                <Button icon={<Send className="h-4 w-4" />} disabled={busy !== null} onClick={() => save('published')}>
                  {busy === 'create-published' ? 'Publicando...' : 'Publicar'}
                </Button>
              )}
            </>
          )
        }
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Detalhes do evento" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Nome">
                  <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Congresso de Jovens" required />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Descrição">
                  <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Descreva o evento..." />
                </Field>
              </div>
              <Field label="Categoria">
                <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">{categoriesLoading ? 'Carregando categorias...' : 'Selecione'}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Capacidade" hint="Em branco = sem limite. Quando enche, a inscrição entra como lista de espera.">
                <Input type="number" min={1} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="500" />
              </Field>
              <Field label="Data inicial" hint="Gravada com o fuso de quem edita; o banco guarda timestamptz.">
                <Input type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} required />
              </Field>
              <Field label="Data final">
                <Input type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Endereço">
                  <Input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Rua, número, bairro" />
                </Field>
              </div>
              <Field label="Cidade">
                <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="São José dos Campos" />
              </Field>
              <Field label="Filial" hint="Opcional. Tem de ser da mesma igreja do evento — o banco recusa filial de outra igreja.">
                <Select value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                  <option value="">{branchesLoading ? 'Carregando filiais...' : 'Sem filial (evento da igreja inteira)'}</option>
                  {branchRows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <CoordsField
                lat={form.latitude}
                lng={form.longitude}
                onChange={(latitude, longitude) => setForm((f) => ({ ...f, latitude, longitude }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Mídia" subtitle="Capa e vídeo promocional." />
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-dashed border-line bg-surface px-4 py-5">
                <div>
                  <p className="text-sm font-medium text-navy">Imagem de capa</p>
                  <p className="text-xs text-slate-400">1200×630 recomendado · o envio para o Storage ainda não está ligado</p>
                </div>
                <Button variant="outline" size="sm" disabled icon={<Upload className="h-4 w-4" />}>Enviar</Button>
              </div>
              <Field label="URL da capa" hint="Cole o endereço de uma imagem http(s) já hospedada.">
                <Input value={form.coverUrl} onChange={(e) => set('coverUrl', e.target.value)} placeholder="https://..." />
              </Field>
              <Field label="Vídeo (YouTube/Vimeo)" hint="Sem coluna na tabela de eventos ainda: não é gravado.">
                <Input disabled placeholder="https://..." />
              </Field>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Visibilidade e status" />
            <CardBody className="space-y-4">
              <Field label="Visibilidade" hint="Privado e não listado ficam fora do diretório público; a sua igreja continua vendo.">
                <Select value={form.visibility} onChange={(e) => set('visibility', e.target.value as EventVisibility)}>
                  <option value="public">Público</option>
                  <option value="unlisted">Não listado</option>
                  <option value="private">Privado</option>
                </Select>
              </Field>

              <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Status</p>
                {current ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <EventStatusBadge status={current.status} />
                    {current.status !== 'published' && canPublish && (
                      <Button size="sm" variant="success" icon={<Send className="h-3.5 w-3.5" />} disabled={busy !== null}
                        onClick={() => transition('published', 'Evento publicado: já aparece no diretório público.')}>
                        Publicar
                      </Button>
                    )}
                    {current.status === 'published' && (
                      <Button size="sm" variant="outline" icon={<Undo2 className="h-3.5 w-3.5" />} disabled={busy !== null}
                        onClick={() => transition('draft', 'Evento de volta ao rascunho: saiu do diretório público.')}>
                        Rascunho
                      </Button>
                    )}
                    {current.status !== 'cancelled' && current.status !== 'finished' && (
                      <Button size="sm" variant="danger" icon={<Ban className="h-3.5 w-3.5" />} disabled={busy !== null}
                        onClick={() => transition('cancelled', 'Evento cancelado: saiu do diretório público e as inscrições continuam registradas.')}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    {canPublish ? 'Nasce rascunho ou publicado, pelos botões acima.' : 'Nasce como rascunho: o seu papel não publica.'}
                  </p>
                )}
              </div>

              {!canPublish && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  O seu papel cria e edita eventos, mas não põe no ar: salve como rascunho e peça a publicação ao administrador da
                  igreja, ao gerente, ao pastor ou ao SuperAdmin.
                </p>
              )}

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Badge tone="green">SEO</Badge> Eventos públicos geram URL amigável e Open Graph.
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Inscrições" />
            <CardBody className="space-y-2 text-sm text-slate-600">
              <p>A inscrição é pelo próprio app: o visitante se inscreve na página pública do evento, sem conta e sem pagamento.</p>
              <p>Quando a capacidade enche, a inscrição entra como lista de espera. Duplicidade é barrada por e-mail, no banco.</p>
              <p className="text-xs text-slate-400">
                Confirmação por e-mail/WhatsApp e link de inscrição externo ainda não existem: precisam de provedor real e de
                colunas próprias.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
