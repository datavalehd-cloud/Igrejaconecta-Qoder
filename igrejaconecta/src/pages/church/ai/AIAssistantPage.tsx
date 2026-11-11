import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Type, Image as ImageIcon, Video, Wand2, Copy } from 'lucide-react'
import {
  PageHeader, Button, Card, CardHeader, CardBody, Badge, Field, Select, Label, EmptyState,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useChurchEvents } from '@/hooks/useEvents'
import { createCampaign, type CampaignActor, type CampaignDraft } from '@/services/data/marketingService'
import { copyToClipboard } from '@/utils/share'
import {
  CAMPAIGN_TEXT_STYLES,
  generateCampaignText,
  type CampaignTextStyle,
  type CampaignText,
} from '@/utils/campaignText'

/**
 * IgrejaConecta AI (Fase 6), com a fronteira honesta entre o que existe e o que não
 * existe. O gerador de **texto de campanha** é real: um modelo local (template) que
 * roda no navegador, sem chave e sem provedor, montando a mensagem com os dados do
 * evento. Isso NÃO é IA e a página diz isso — nenhum modelo é chamado.
 *
 * Artes, vídeos e texto de modelo (IA de provedor) exigem um backend que guarde a
 * chave com segurança; a chave nunca pode ir para o frontend, onde ficaria exposta.
 * Esse backend não existe aqui, então essas funções ficam "não conectado" e nada é
 * fingido — o mesmo princípio de `publishCampaign` (Fase 5) e de `/app/redes`.
 *
 * Salvar o texto gerado passa pelo `marketingService` (porta `marketing.manage` +
 * RLS da 0014): esta página não cria um caminho de escrita novo.
 */

interface NoticeState { tone: 'ok' | 'error'; text: string }
interface SessionItem { id: string; name: string; style: string; at: string }

const providerTools = [
  { id: 'image', label: 'Artes (imagem)', icon: ImageIcon, requirement: 'um provedor de geração de imagem + backend que guarde a chave.' },
  { id: 'video', label: 'Vídeos', icon: Video, requirement: 'um provedor de vídeo (roteiro, cenas, render) + backend com chave.' },
  { id: 'campaign', label: 'Campanha completa', icon: Wand2, requirement: 'artes e roteiro de provedor; hoje só o texto existe, gerado localmente.' },
] as const

export function AIAssistantPage() {
  const { session } = useAuth()
  const { churchId, role, can } = usePermissions()
  const { rows: events } = useChurchEvents()

  const actor: CampaignActor = { churchId, role, userId: session?.profile.id }
  const canManage = can('marketing.manage')

  const [eventId, setEventId] = useState('')
  const [style, setStyle] = useState<CampaignTextStyle>('convite')
  const [result, setResult] = useState<CampaignText | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [created, setCreated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [log, setLog] = useState<SessionItem[]>([])

  const selectedEvent = events.find((e) => e.id === eventId) ?? null

  function generate() {
    if (!selectedEvent) {
      setNotice({ tone: 'error', text: 'Escolha um evento da sua igreja para gerar o texto.' })
      return
    }
    const text = generateCampaignText(selectedEvent, style)
    setResult(text)
    setCreated(false)
    setNotice(null)
    setLog((prev) => [
      { id: `${Date.now()}-${prev.length}`, name: text.name, style: styleLabel(style), at: clockNow() },
      ...prev,
    ].slice(0, 8))
  }

  async function copyMessage() {
    if (!result) return
    const ok = await copyToClipboard(result.message)
    setNotice(ok
      ? { tone: 'ok', text: 'Mensagem copiada.' }
      : { tone: 'error', text: 'O navegador não permitiu copiar. Selecione o texto e copie manualmente.' })
  }

  async function createDraft() {
    if (!result || !selectedEvent) return
    setSaving(true)
    const draft: CampaignDraft = {
      name: result.name,
      message: result.message,
      networks: result.networks,
      event_id: selectedEvent.id,
    }
    const res = await createCampaign(draft, actor)
    setSaving(false)
    if (res.ok) {
      setCreated(true)
      setNotice({ tone: 'ok', text: 'Rascunho de campanha criado. Edite, agende e distribua na Central de divulgação.' })
    } else {
      setNotice({ tone: 'error', text: res.error })
    }
  }

  return (
    <div>
      <PageHeader
        title="IgrejaConecta AI"
        subtitle="Texto de campanha gerado no aparelho, sem chave. Artes, vídeos e IA de provedor exigem backend com chave — não conectados."
      />

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        O gerador de texto abaixo é um <strong>modelo local (template), não é IA</strong>: monta a mensagem com os
        dados reais do evento e roda no seu navegador, sem provedor e sem chave. IA de provedor (texto, arte ou vídeo
        de modelo) exigiria um <strong>backend que guardasse a chave</strong> — a chave nunca pode ir para o frontend,
        onde ficaria exposta. Como esse backend não existe aqui, essas funções ficam "não conectado" e nada é fingido.
      </div>

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Gerador de texto de campanha"
              subtitle="Modelo local, sem IA e sem chave. O texto entra como rascunho para você editar."
              action={<Badge tone="green">Funciona agora</Badge>}
            />
            <CardBody className="space-y-4">
              {events.length === 0 ? (
                <EmptyState
                  icon={<Type className="h-5 w-5" />}
                  title="Nenhum evento para usar como base"
                  description="O gerador monta o texto a partir de um evento da sua igreja. Crie um evento em Eventos e volte aqui."
                />
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Evento" hint="Fonte dos dados reais do texto.">
                      <Select value={eventId} onChange={(e) => { setEventId(e.target.value); setCreated(false) }}>
                        <option value="">Selecione um evento…</option>
                        {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Estilo" hint={CAMPAIGN_TEXT_STYLES.find((s) => s.id === style)?.hint}>
                      <Select value={style} onChange={(e) => setStyle(e.target.value as CampaignTextStyle)}>
                        {CAMPAIGN_TEXT_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </Select>
                    </Field>
                  </div>

                  <Button icon={<Sparkles className="h-4 w-4" />} onClick={generate} disabled={!eventId}>Gerar texto</Button>

                  {result && (
                    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
                      <div>
                        <Label>Nome da campanha</Label>
                        <p className="text-sm font-medium text-navy">{result.name}</p>
                      </div>
                      <div>
                        <Label>Mensagem</Label>
                        <p className="whitespace-pre-line text-sm text-slate-700">{result.message}</p>
                      </div>
                      <div>
                        <Label>Hashtags</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {result.hashtags.map((h) => <Badge key={h} tone="brand">{h}</Badge>)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button variant="outline" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copyMessage}>Copiar mensagem</Button>
                        {canManage && (
                          <Button size="sm" icon={<Wand2 className="h-4 w-4" />} onClick={createDraft} disabled={saving || created}>
                            {created ? 'Rascunho criado' : saving ? 'Criando…' : 'Criar rascunho de campanha'}
                          </Button>
                        )}
                        {created && (
                          <Link to="/app/marketing">
                            <Button variant="ghost" size="sm">Abrir Central de divulgação</Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-slate-400">
                    Nenhum provedor de IA foi chamado e nenhuma chave é usada. Salvar passa pela mesma permissão
                    (marketing.manage) e pela RLS da Central de divulgação.
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Artes, vídeos e IA de provedor"
              subtitle="Exigem um provedor e um backend que guarde a chave com segurança."
              action={<Badge tone="neutral">Não conectado</Badge>}
            />
            <CardBody className="space-y-3">
              {providerTools.map((t) => (
                <div key={t.id} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
                  <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-slate-400">
                    <t.icon className="h-4 w-4" />
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-navy">{t.label}</p>
                      <Badge tone="neutral">Não conectado</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">Para conectar: {t.requirement}</p>
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-400">
                Sem botão de gerar de mentira: nada aqui finge uma arte, um vídeo ou uma resposta de modelo que não
                aconteceu.
              </p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Gerado nesta sessão" subtitle="Só o que você acabou de gerar, neste navegador." />
          <CardBody className="space-y-3">
            {log.length === 0 ? (
              <p className="rounded-lg bg-surface p-3 text-center text-xs text-slate-500">
                Nada gerado ainda. Escolha um evento e clique em "Gerar texto".
              </p>
            ) : (
              log.map((item) => (
                <div key={item.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="brand">{item.style}</Badge>
                    <span className="text-xs text-slate-400">{item.at}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-navy">{item.name}</p>
                </div>
              ))
            )}
            <div className="rounded-lg bg-surface p-3 text-center text-xs text-slate-500">
              Sem cobrança e sem envio a provedor: o texto é gerado e fica no seu aparelho.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function styleLabel(style: CampaignTextStyle): string {
  return CAMPAIGN_TEXT_STYLES.find((s) => s.id === style)?.label ?? style
}

function clockNow(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
