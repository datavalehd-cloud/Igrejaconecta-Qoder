import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { LifeBuoy, Loader2, MessageSquare, Plus, RefreshCw, Send, XCircle } from 'lucide-react'
import {
  PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Textarea, Badge, EmptyState, Select,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchSupportMessages,
  fetchSupportTickets,
  openSupportTicket,
  replySupportTicket,
  setSupportTicketStatus,
  SUPPORT_STATUS_LABEL,
  type SupportMessageRow,
  type SupportTicketRow,
  type SupportTicketStatus,
} from '@/services/data/supportService'

/**
 * Central de chamados (M5, migração 0018). A mesma tela serve aos dois lados:
 * quem gerencia uma igreja abre e acompanha os chamados da própria igreja, e o
 * SuperAdmin vê todos e responde. Quem recorta o que cada um vê é a view
 * `support_ticket_list` no banco — a tela não filtra nada por conta própria,
 * porque filtro de audiência no cliente é filtro que alguém desliga.
 *
 * Não há botão de excluir: chamado é trilha. Fechar e reabrir existem, e o banco
 * só confirma para quem abriu ou para o SuperAdmin.
 */

const STATUS_TONE: Record<SupportTicketStatus, 'green' | 'amber' | 'neutral'> = {
  open: 'amber',
  answered: 'green',
  closed: 'neutral',
}

export function SupportCenterPage() {
  const { session } = useAuth()
  const userId = session?.profile.id
  const role = session?.role
  // Chamado aberto por SuperAdmin é da plataforma (`church_id` nulo), como sempre
  // foi: a política de insert (0018) só aceita igreja em que o autor é membro
  // ativo, e a igreja do seletor não é necessariamente essa. Para os papéis de
  // igreja o ator continua sendo a própria.
  const churchId = role === 'superadmin' ? undefined : session?.churchId

  const [tickets, setTickets] = useState<SupportTicketRow[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(async () => {
    setFailure(null)
    try {
      setTickets(await fetchSupportTickets())
    } catch (err) {
      setTickets(null)
      setFailure(err instanceof Error ? err.message : 'Não foi possível ler os chamados.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const actor = { userId, churchId, role }
  const current = tickets?.find((t) => t.id === selected) ?? null

  async function submitNew(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await openSupportTicket({ subject, body }, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setSubject('')
    setBody('')
    setComposing(false)
    setSelected(result.ticketId)
    setNotice({ tone: 'ok', text: 'Chamado aberto: ele aparece na lista e fica visível para quem gerencia a sua igreja e para o SuperAdmin.' })
    await load()
  }

  async function reply(text: string) {
    if (!current || busy) return
    setBusy(true)
    setNotice(null)
    const result = await replySupportTicket(current.id, text, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setNotice({ tone: 'ok', text: 'Resposta gravada no chamado.' })
    await load()
  }

  async function setStatus(status: SupportTicketStatus) {
    if (!current || busy) return
    setBusy(true)
    setNotice(null)
    const result = await setSupportTicketStatus(current.id, status, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setNotice({ tone: 'ok', text: status === 'closed' ? 'Chamado fechado.' : 'Chamado reaberto.' })
    await load()
  }

  return (
    <div>
      <PageHeader
        title="Suporte"
        subtitle="Chamados entre a sua igreja e a plataforma, gravados no banco."
        actions={
          <Button type="button" variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setComposing((v) => !v)}>
            {composing ? 'Fechar formulário' : 'Novo chamado'}
          </Button>
        }
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      {composing && (
        <Card className="mb-6">
          <CardHeader title="Abrir chamado" subtitle="Assunto e primeira mensagem. O autor é a sua conta." />
          <CardBody>
            <form onSubmit={submitNew} className="grid gap-4">
              <Field label="Assunto">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: erro ao publicar evento" required />
              </Field>
              <Field label="Mensagem" hint="De 1 a 4000 caracteres: é o texto que o atendimento lê.">
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} required />
              </Field>
              <div>
                <Button type="submit" icon={<Send className="h-4 w-4" />} disabled={busy}>
                  {busy ? 'Enviando...' : 'Abrir chamado'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <TicketList
            tickets={tickets}
            failure={failure}
            selected={selected}
            onPick={(id) => { setSelected(id); setNotice(null) }}
            onRetry={load}
          />
        </div>
        <div className="lg:col-span-3">
          {current ? (
            <Conversation
              key={current.id}
              ticket={current}
              userId={userId}
              role={role}
              busy={busy}
              onReply={reply}
              onSetStatus={setStatus}
            />
          ) : (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<MessageSquare className="h-8 w-8" />}
                  title="Nenhum chamado selecionado"
                  description="Escolha um chamado na lista para ler a conversa. Só aparecem aqui os chamados que o banco deixa a sua conta ver."
                />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function TicketList({
  tickets, failure, selected, onPick, onRetry,
}: {
  tickets: SupportTicketRow[] | null
  failure: string | null
  selected: string | null
  onPick: (id: string) => void
  onRetry: () => void
}) {
  if (failure) {
    return (
      <Card className="border-red-200">
        <CardBody className="space-y-3">
          <p className="text-sm text-red-700">{failure}</p>
          <p className="text-xs text-slate-500">Sem a resposta do banco a lista fica vazia de propósito: chamado inventado não tem atendimento.</p>
          <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>Recarregar</Button>
        </CardBody>
      </Card>
    )
  }
  if (!tickets) {
    return (
      <Card>
        <CardBody>
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Lendo os chamados...</p>
        </CardBody>
      </Card>
    )
  }
  if (tickets.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<LifeBuoy className="h-8 w-8" />}
            title="Nenhum chamado"
            description="Ainda não há chamados visíveis para a sua conta. Abra o primeiro pelo botão acima."
          />
        </CardBody>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader title="Chamados" subtitle={`${tickets.length} visíveis para a sua conta`} />
      <CardBody className="space-y-2">
        {tickets.map((ticket) => (
          <button
            key={ticket.id}
            type="button"
            onClick={() => onPick(ticket.id)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
              selected === ticket.id ? 'border-brand-400 bg-brand-50' : 'border-line bg-surface hover:border-brand-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-slate-800">{ticket.subject}</span>
              <Badge tone={STATUS_TONE[ticket.status]}>{SUPPORT_STATUS_LABEL[ticket.status]}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {ticket.opened_by_name ?? 'Autor sem nome'} · {ticket.church_name ?? 'sem igreja'} · {ticket.messages_count} mensagem(ns)
            </p>
          </button>
        ))}
      </CardBody>
    </Card>
  )
}

function Conversation({
  ticket, userId, role, busy, onReply, onSetStatus,
}: {
  ticket: SupportTicketRow
  userId?: string
  role?: string
  busy: boolean
  onReply: (text: string) => void
  onSetStatus: (status: SupportTicketStatus) => void
}) {
  const [messages, setMessages] = useState<SupportMessageRow[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let alive = true
    fetchSupportMessages(ticket.id)
      .then((rows) => { if (alive) { setMessages(rows); setFailure(null) } })
      .catch((err) => { if (alive) { setMessages(null); setFailure(err instanceof Error ? err.message : 'Falha ao ler a conversa.') } })
    return () => { alive = false }
  }, [ticket.id])

  const canManageStatus = userId === ticket.opened_by || role === 'superadmin'

  return (
    <Card>
      <CardHeader
        title={ticket.subject}
        subtitle={`Aberto por ${ticket.opened_by_name ?? 'autor sem nome'} em ${new Date(ticket.created_at).toLocaleString('pt-BR')}`}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[ticket.status]}>{SUPPORT_STATUS_LABEL[ticket.status]}</Badge>
          {ticket.church_name && <Badge tone="neutral">{ticket.church_name}</Badge>}
          {canManageStatus && ticket.status !== 'closed' && (
            <Button type="button" size="sm" variant="outline" icon={<XCircle className="h-3.5 w-3.5" />} disabled={busy} onClick={() => onSetStatus('closed')}>
              Fechar
            </Button>
          )}
          {canManageStatus && ticket.status === 'closed' && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onSetStatus('open')}>
              Reabrir
            </Button>
          )}
        </div>

        {failure && <p className="text-sm text-red-700">{failure}</p>}
        {!failure && !messages && (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Lendo a conversa...</p>
        )}
        {messages && (
          <div className="space-y-3">
            {messages.length === 0 && <p className="text-sm text-slate-500">Este chamado ainda não tem mensagens.</p>}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg border px-3 py-2 ${message.author_id === userId ? 'border-brand-200 bg-brand-50' : 'border-line bg-surface'}`}
              >
                <p className="text-xs text-slate-400">
                  {message.author_id === userId ? 'Você' : message.author_id === ticket.opened_by ? 'Quem abriu o chamado' : 'Atendimento'} ·{' '}
                  {new Date(message.created_at).toLocaleString('pt-BR')}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{message.body}</p>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft
            setDraft('')
            onReply(text)
          }}
          className="grid gap-3"
        >
          <Field label="Responder">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} required />
          </Field>
          <div>
            <Button type="submit" size="sm" icon={<Send className="h-3.5 w-3.5" />} disabled={busy}>
              {busy ? 'Enviando...' : 'Enviar resposta'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
