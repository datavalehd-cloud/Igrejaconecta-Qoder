import { useState, type FormEvent } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useChurchCampaigns } from '@/hooks/useCampaigns'
import { useChurchEvents } from '@/hooks/useEvents'
import {
  CAMPAIGN_NETWORKS,
  CAMPAIGN_PUBLISH_NOT_CONNECTED,
  createCampaign,
  publishCampaign,
  setCampaignStatus,
  updateCampaign,
  type CampaignActor,
  type CampaignDraft,
  type WritableCampaignStatus,
} from '@/services/data/marketingService'
import { absoluteUrl, canWebShare, copyToClipboard, utmLink, webShare, whatsappShareLink } from '@/utils/share'
import { CAMPAIGN_TEXT_STYLES, generateCampaignText, type CampaignTextStyle } from '@/utils/campaignText'
import { fromDateTimeInput, formatDateTime, toDateTimeInput } from '@/utils/format'
import {
  PageHeader, Button, Badge, Card, CardHeader, CardBody, Field, Input, Textarea, Select, Label, EmptyState,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { DataTable, type Column } from '@/components/common/DataTable'
import {
  Plus, Camera, ThumbsUp, MessageCircle, CalendarClock, Pencil, X, Send, Copy, Share2, Ban, RotateCcw, Sparkles,
} from 'lucide-react'
import type { Campaign, CampaignNetwork, ChurchEvent } from '@/types'

const networkIcon: Record<CampaignNetwork, typeof Camera> = {
  instagram: Camera,
  facebook: ThumbsUp,
  whatsapp: MessageCircle,
}
const networkLabel: Record<CampaignNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
}
const statusMap: Record<Campaign['status'], { label: string; tone: 'neutral' | 'brand' | 'green' | 'amber' | 'red' }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  scheduled: { label: 'Agendada', tone: 'brand' },
  published: { label: 'Publicada', tone: 'green' },
  failed: { label: 'Falhou', tone: 'red' },
  cancelled: { label: 'Cancelada', tone: 'amber' },
}

/**
 * URL pública do evento vinculado — só existe se o evento está `published` + `public`,
 * que é o que a página pública de fato serve. Se não, devolve null e a tela diz por
 * quê em vez de distribuir um link que abre em "evento não encontrado".
 */
function publicUrlFor(campaign: Campaign, events: ChurchEvent[]): string | null {
  if (!campaign.event_id) return null
  const event = events.find((e) => e.id === campaign.event_id)
  if (!event || event.status !== 'published' || event.visibility !== 'public') return null
  return absoluteUrl(`/eventos/${event.slug}`)
}

interface NoticeState { tone: 'ok' | 'error'; text: string }

export function CampaignsPage() {
  const { session } = useAuth()
  const { churchId, role, can } = usePermissions()
  const { rows: campaigns, loading, error: listError, reload } = useChurchCampaigns()
  const { rows: events } = useChurchEvents()

  const actor: CampaignActor = { churchId, role, userId: session?.profile.id }
  const canManage = can('marketing.manage')

  const [editing, setEditing] = useState<Campaign | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState<Campaign | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)

  const detail = selected ? campaigns.find((c) => c.id === selected.id) ?? selected : null

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(campaign: Campaign) {
    setEditing(campaign)
    setFormOpen(true)
    setSelected(campaign)
  }
  function closeForm() {
    setFormOpen(false)
    setEditing(null)
  }

  async function changeStatus(campaign: Campaign, status: WritableCampaignStatus, scheduledFor?: string | null) {
    const result = await setCampaignStatus(campaign.id, status, actor, scheduledFor)
    if (result.ok) {
      setSelected(result.campaign)
      setNotice({ tone: 'ok', text: `Campanha ${statusMap[status].label.toLowerCase()}.` })
      reload()
    } else {
      setNotice({ tone: 'error', text: result.error })
    }
  }

  async function tryPublish() {
    // publishCampaign nunca escreve: devolve sempre "não conectado". O aviso é honesto.
    const result = await publishCampaign()
    if (!result.ok) setNotice({ tone: 'error', text: result.error })
  }

  if (!churchId && role !== 'superadmin') {
    return (
      <div>
        <PageHeader title="Central de divulgação" subtitle="Campanhas de divulgação da sua igreja." />
        <EmptyState title="Sem igreja ativa" description="A sua sessão não tem igreja ativa. Quem não é de uma igreja não gerencia divulgação." />
      </div>
    )
  }

  const columns: Column<Campaign>[] = [
    {
      header: 'Campanha',
      cell: (c) => {
        const event = events.find((e) => e.id === c.event_id)
        return (
          <div>
            <p className="font-medium text-navy">{c.name}</p>
            <p className="text-xs text-slate-500">{event?.name ?? 'Sem evento vinculado'}</p>
          </div>
        )
      },
    },
    {
      header: 'Redes',
      cell: (c) => (
        <div className="flex gap-1">
          {c.networks.length === 0 && <span className="text-xs text-slate-400">—</span>}
          {c.networks.map((n) => {
            const Icon = networkIcon[n]
            return <span key={n} className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-slate-600" title={networkLabel[n]}><Icon className="h-3.5 w-3.5" /></span>
          })}
        </div>
      ),
    },
    { header: 'Agendamento', cell: (c) => c.scheduled_for ? <span className="inline-flex items-center gap-1 text-slate-600"><CalendarClock className="h-3.5 w-3.5" />{formatDateTime(c.scheduled_for)}</span> : <span className="text-slate-400">—</span> },
    { header: 'Status', cell: (c) => <Badge tone={statusMap[c.status].tone}>{statusMap[c.status].label}</Badge> },
    {
      header: '',
      className: 'text-right',
      cell: (c) => (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelected(c)}>Abrir</Button>
          {canManage && <Button variant="outline" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(c)}>Editar</Button>}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Central de divulgação"
        subtitle="Crie campanhas, prepare o conteúdo, agende e distribua sem chave."
        actions={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Nova campanha</Button> : undefined}
      />

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Publicar numa rede exige OAuth + backend com tokens, que não existem aqui. Enquanto isso, a campanha fica em
        rascunho ou agendada e você distribui sem chave: link de WhatsApp, copiar link (com UTM) e compartilhar.
        Nada é marcado como publicado sem confirmação real do provedor.
      </div>

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}
      {listError && <Notice tone="error" text={listError} onClose={() => reload()} />}

      {formOpen && canManage && (
        <CampaignForm
          key={editing?.id ?? 'new'}
          initial={editing}
          events={events}
          onCancel={closeForm}
          onSaved={(campaign, wasEdit) => {
            closeForm()
            setSelected(campaign)
            setNotice({ tone: 'ok', text: wasEdit ? 'Campanha atualizada.' : 'Campanha criada como rascunho.' })
            reload()
          }}
          onError={(text) => setNotice({ tone: 'error', text })}
        />
      )}

      {loading ? (
        <EmptyState title="Carregando campanhas..." description="Consultando as campanhas da sua igreja." />
      ) : (
        <DataTable
          columns={columns}
          rows={campaigns}
          keyOf={(c) => c.id}
          empty={<EmptyState title="Nenhuma campanha" description={canManage ? 'Crie a primeira campanha de divulgação da sua igreja.' : 'A sua igreja ainda não tem campanhas de divulgação.'} action={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Nova campanha</Button> : undefined} />}
        />
      )}

      {detail && (
        <CampaignDetail
          campaign={detail}
          events={events}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onChangeStatus={changeStatus}
          onPublish={tryPublish}
          onEdit={() => openEdit(detail)}
          onNotice={setNotice}
        />
      )}
    </div>
  )
}

/* ---------------------------------- Form ---------------------------------- */

function CampaignForm({
  initial, events, onCancel, onSaved, onError,
}: {
  initial: Campaign | null
  events: ChurchEvent[]
  onCancel: () => void
  onSaved: (campaign: Campaign, wasEdit: boolean) => void
  onError: (text: string) => void
}) {
  const { session } = useAuth()
  const { churchId, role } = usePermissions()
  const actor: CampaignActor = { churchId, role, userId: session?.profile.id }

  const [name, setName] = useState(initial?.name ?? '')
  const [message, setMessage] = useState(initial?.message ?? '')
  const [eventId, setEventId] = useState(initial?.event_id ?? '')
  const [networks, setNetworks] = useState<CampaignNetwork[]>(initial?.networks ?? [])
  const [saving, setSaving] = useState(false)
  const [style, setStyle] = useState<CampaignTextStyle>('convite')

  function toggleNetwork(network: CampaignNetwork) {
    setNetworks((current) => current.includes(network) ? current.filter((n) => n !== network) : [...current, network])
  }

  // Modelo local (sem IA, sem chave): preenche o formulário a partir do evento.
  // Salvar continua passando pelo serviço guardado — isto só sugere o texto.
  function applySuggestion() {
    const event = events.find((e) => e.id === eventId)
    if (!event) {
      onError('Escolha um evento vinculado para gerar a sugestão de texto.')
      return
    }
    const suggestion = generateCampaignText(event, style)
    setName(suggestion.name)
    setMessage(suggestion.message)
    setNetworks(suggestion.networks)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const draft: CampaignDraft = { name, message, networks, event_id: eventId || null }
    const result = initial
      ? await updateCampaign(initial.id, draft, actor)
      : await createCampaign(draft, actor)
    setSaving(false)
    if (result.ok) onSaved(result.campaign, Boolean(initial))
    else onError(result.error)
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title={initial ? 'Editar campanha' : 'Nova campanha'}
        subtitle="O conteúdo entra como rascunho. A distribuição acontece depois, sem chave."
        action={<Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={onCancel}>Fechar</Button>}
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nome da campanha">
            <Input required minLength={3} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Divulgação Congresso de Jovens" />
          </Field>
          <Field label="Evento vinculado" hint="Só eventos publicados e públicos geram link de distribuição.">
            <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Sem evento</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}{ev.status !== 'published' || ev.visibility !== 'public' ? ' (sem página pública)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Sugestão de texto (modelo local, sem IA)"
            hint={eventId
              ? 'Monta nome, mensagem e redes a partir do evento escolhido. Roda no aparelho, sem provedor — revise e edite antes de salvar.'
              : 'Escolha um evento vinculado para gerar a sugestão.'}
          >
            <div className="flex gap-2">
              <Select
                value={style}
                onChange={(e) => setStyle(e.target.value as CampaignTextStyle)}
                disabled={!eventId}
                aria-label="Estilo do texto"
                className="flex-1"
              >
                {CAMPAIGN_TEXT_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
              <Button type="button" variant="outline" icon={<Sparkles className="h-4 w-4" />} onClick={applySuggestion} disabled={!eventId}>
                Gerar sugestão
              </Button>
            </div>
          </Field>
          <Field label="Mensagem" hint="Texto que vai no WhatsApp e no compartilhamento.">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Escreva o conteúdo da divulgação..." />
          </Field>
          <div>
            <Label>Redes</Label>
            <div className="flex flex-wrap gap-2">
              {CAMPAIGN_NETWORKS.map((network) => {
                const Icon = networkIcon[network]
                const active = networks.includes(network)
                return (
                  <button
                    key={network}
                    type="button"
                    onClick={() => toggleNetwork(network)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-slate-600 hover:bg-surface'}`}
                  >
                    <Icon className="h-4 w-4" /> {networkLabel[network]}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar rascunho'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

/* --------------------------------- Detail --------------------------------- */

function CampaignDetail({
  campaign, events, canManage, onClose, onChangeStatus, onPublish, onEdit, onNotice,
}: {
  campaign: Campaign
  events: ChurchEvent[]
  canManage: boolean
  onClose: () => void
  onChangeStatus: (campaign: Campaign, status: WritableCampaignStatus, scheduledFor?: string | null) => void
  onPublish: () => void
  onEdit: () => void
  onNotice: (notice: NoticeState) => void
}) {
  const [scheduleValue, setScheduleValue] = useState(toDateTimeInput(campaign.scheduled_for))
  const publicUrl = publicUrlFor(campaign, events)
  const taggedUrl = publicUrl ? utmLink(publicUrl, { source: 'igrejaconecta', medium: 'social', campaign: campaign.name }) : null
  const shareText = `${campaign.name}${campaign.message ? `\n\n${campaign.message}` : ''}${taggedUrl ? `\n\n${taggedUrl}` : ''}`

  async function copyLink() {
    if (!taggedUrl) {
      onNotice({ tone: 'error', text: 'Esta campanha não tem link público: vincule um evento publicado e público para distribuir.' })
      return
    }
    const ok = await copyToClipboard(taggedUrl)
    onNotice(ok
      ? { tone: 'ok', text: 'Link copiado com UTM de origem.' }
      : { tone: 'error', text: 'O navegador não permitiu copiar. Selecione e copie o link abaixo manualmente.' })
  }

  async function share() {
    if (!taggedUrl) {
      onNotice({ tone: 'error', text: 'Sem link público para compartilhar: vincule um evento publicado e público.' })
      return
    }
    const result = await webShare({ title: campaign.name, text: campaign.message ?? undefined, url: taggedUrl })
    if (!result.ok && result.reason !== 'cancelled') {
      onNotice({ tone: 'error', text: result.reason === 'unsupported' ? 'Este navegador não tem compartilhamento nativo. Use o link de WhatsApp ou copie o link.' : 'Não foi possível abrir o compartilhamento nativo.' })
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader
        title={campaign.name}
        subtitle={<span className="inline-flex items-center gap-2"><Badge tone={statusMap[campaign.status].tone}>{statusMap[campaign.status].label}</Badge>{campaign.scheduled_for && <span className="text-xs text-slate-500">{formatDateTime(campaign.scheduled_for)}</span>}</span>}
        action={<Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={onClose}>Fechar</Button>}
      />
      <CardBody className="space-y-5">
        {campaign.message && <p className="whitespace-pre-line text-sm text-slate-600">{campaign.message}</p>}

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Redes preparadas</p>
          <div className="flex flex-wrap gap-2">
            {campaign.networks.length === 0 && <span className="text-sm text-slate-400">Nenhuma rede selecionada</span>}
            {campaign.networks.map((n) => (
              <Badge key={n} tone="navy">{networkLabel[n]} — não conectado</Badge>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <p className="text-sm font-medium text-navy">Distribuição sem chave</p>
          {taggedUrl ? (
            <>
              <p className="mt-1 break-all text-xs text-slate-500">{taggedUrl}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={whatsappShareLink(shareText)} target="_blank" rel="noopener noreferrer">
                  <Button variant="success" size="sm" icon={<MessageCircle className="h-4 w-4" />}>WhatsApp</Button>
                </a>
                <Button variant="outline" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copyLink}>Copiar link</Button>
                <Button variant="outline" size="sm" icon={<Share2 className="h-4 w-4" />} onClick={share} disabled={!canWebShare()}>
                  Compartilhar
                </Button>
              </div>
              {!canWebShare() && <p className="mt-2 text-xs text-slate-400">Este navegador não tem compartilhamento nativo — use WhatsApp ou copie o link.</p>}
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              {campaign.event_id
                ? 'O evento vinculado não está publicado e público, então não há página para distribuir. Publique o evento para liberar o link.'
                : 'Vincule um evento publicado e público para gerar o link de distribuição.'}
            </p>
          )}
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <div>
              <Label>Agendar para</Label>
              <Input type="datetime-local" value={scheduleValue} onChange={(e) => setScheduleValue(e.target.value)} />
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<CalendarClock className="h-4 w-4" />}
              disabled={!scheduleValue}
              onClick={() => onChangeStatus(campaign, 'scheduled', fromDateTimeInput(scheduleValue))}
            >
              Agendar
            </Button>
            {campaign.status !== 'draft' && (
              <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => onChangeStatus(campaign, 'draft')}>
                Reabrir rascunho
              </Button>
            )}
            {campaign.status !== 'cancelled' && (
              <Button variant="ghost" size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => onChangeStatus(campaign, 'cancelled')}>
                Cancelar
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>Editar</Button>
            <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={onPublish}>Publicar</Button>
          </div>
        ) : (
          <p className="border-t border-line pt-4 text-sm text-slate-500">
            Você pode ver e distribuir, mas só quem gerencia divulgação (administrador, gerente ou comunicador) edita e agenda.
          </p>
        )}

        <p className="text-xs text-slate-400">{CAMPAIGN_PUBLISH_NOT_CONNECTED}</p>
      </CardBody>
    </Card>
  )
}
