import { useMemo, useState } from 'react'
import { Workflow, BellOff } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Badge, Stat, EmptyState } from '@/components/common/primitives'
import { useChurchEvents } from '@/hooks/useEvents'
import { useRegistrationStats } from '@/hooks/useRegistrations'
import { usePermissions } from '@/hooks/usePermissions'
import {
  AUTOMATION_RULES,
  channelLabel,
  channelRequires,
  evaluateAll,
  summarize,
  triggerLabel,
  type AutomationChannel,
  type AutomationContext,
} from '@/utils/automationEngine'

const CHANNELS: AutomationChannel[] = ['email', 'whatsapp', 'push', 'internal']

/**
 * Instante de referência da simulação, capturado uma vez no carregamento do módulo.
 * Mantém a prévia estável na sessão (não se recalcula a cada render) e evita chamar
 * `new Date()` durante o render. É uma prévia ao vivo do que dispararia — nunca um
 * agendamento: nada aqui executa ou envia.
 */
const SIMULATION_INSTANT = new Date()

/** Interruptor real: muda o estado local e, com ele, o que a simulação dispara. */
function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? 'bg-green-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export function AutomationPage() {
  const { churchId, role, can } = usePermissions()
  const canManage = can('automation.manage')

  const { rows: events, loading: eventsLoading } = useChurchEvents()
  const { byEvent: stats, loading: statsLoading } = useRegistrationStats()
  const loading = eventsLoading || statsLoading

  const [enabledIds, setEnabledIds] = useState<Set<string>>(() => new Set(AUTOMATION_RULES.map((r) => r.id)))

  const ctx = useMemo<AutomationContext>(() => ({ events, stats, now: SIMULATION_INSTANT }), [events, stats])
  const dryRuns = useMemo(() => evaluateAll(AUTOMATION_RULES, enabledIds, ctx), [enabledIds, ctx])
  const summary = useMemo(() => summarize(dryRuns), [dryRuns])
  const byRule = useMemo(() => new Map(dryRuns.map((d) => [d.rule.id, d])), [dryRuns])

  function toggleRule(id: string) {
    setEnabledIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!churchId && role !== 'superadmin') {
    return (
      <div>
        <PageHeader title="Automações" subtitle="Regras de aviso e divulgação da sua igreja." />
        <EmptyState title="Sem igreja ativa" description="A sua sessão não tem igreja ativa. Automações simulam sobre os eventos e inscrições de uma igreja." />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Automações"
        subtitle="Configuração local + simulação: veja o que cada regra dispararia agora com os dados reais da sua igreja."
      />

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Nenhuma automação <strong>executa</strong> aqui. Disparar de verdade exigiria um <strong>scheduler</strong> no
        servidor (pg_cron, fila ou Edge Function) para detectar o gatilho e um <strong>provedor de envio</strong> (SMTP,
        WhatsApp Cloud ou Web Push) com um backend que guardasse as chaves — nada disso existe neste ambiente. O que
        funciona é local e honesto: você liga e desliga cada regra e vê <strong>o que ela dispararia agora</strong>.
        Nenhuma mensagem sai daqui e nada fica marcado como enviado ou agendado.
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Regras ativas" value={summary.activeRules} tone="green" hint="ligadas por você" />
        <Stat label="Disparariam agora" value={summary.rulesThatWouldFire} tone="brand" hint="com os dados atuais" />
        <Stat label="Mensagens na simulação" value={summary.messagesThatWouldSend} tone="amber" hint="seriam enviadas" />
        <Stat label="Envios reais" value={0} tone="neutral" hint="não conectado" />
      </div>

      {events.length === 0 && !loading && (
        <div className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-slate-600">
          Sua igreja ainda não tem eventos legíveis aqui — a simulação fica vazia até haver eventos e inscrições reais.
          Crie um evento e volte para ver o que cada regra dispararia.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {AUTOMATION_RULES.map((rule) => {
            const enabled = enabledIds.has(rule.id)
            const dry = byRule.get(rule.id)
            return (
              <Card key={rule.id}>
                <CardHeader
                  title={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {rule.name}
                      <Badge tone="navy">{triggerLabel[rule.trigger]}</Badge>
                    </span>
                  }
                  subtitle={rule.summary}
                  action={<Toggle on={enabled} onChange={() => toggleRule(rule.id)} disabled={!canManage} label={`Ativar ${rule.name}`} />}
                />
                <CardBody>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {rule.channels.map((c) => (
                      <Badge key={c} tone="neutral">{channelLabel[c]} — não conectado</Badge>
                    ))}
                  </div>

                  {!enabled ? (
                    <p className="text-sm text-slate-500">Desativada — não entra na simulação.</p>
                  ) : loading ? (
                    <p className="text-sm text-slate-400">Carregando os dados da sua igreja…</p>
                  ) : dry && dry.wouldFire ? (
                    <div>
                      <p className="mb-2 text-sm font-medium text-navy">
                        Dispararia agora para {dry.matches.length} {dry.matches.length === 1 ? 'evento' : 'eventos'}:
                      </p>
                      <ul className="space-y-2">
                        {dry.matches.map((m) => (
                          <li key={m.eventId} className="rounded-lg border border-line bg-surface px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-medium text-navy">{m.label}</span>
                              <span className="text-xs text-slate-500">{m.detail}</span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap rounded border border-line bg-white px-3 py-2 text-xs text-slate-600">{m.message}</p>
                            {m.recipients > 0 && (
                              <p className="mt-1 text-xs text-slate-400">
                                {m.recipients} {m.recipients === 1 ? 'pessoa receberia' : 'pessoas receberiam'} — se houvesse provedor. Nada é enviado.
                              </p>
                            )}
                            {m.link && <p className="mt-1 break-all text-xs text-slate-400">Link público: {m.link}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Nada dispararia agora com os dados atuais da sua igreja.</p>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Canais de envio" subtitle="Todos exigem provedor + backend com chave. Nenhum está conectado." />
            <CardBody>
              {CHANNELS.map((c) => (
                <div key={c} className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-navy">{channelLabel[c]}</p>
                    <p className="text-xs text-slate-500">Para conectar: {channelRequires[c]}.</p>
                  </div>
                  <Badge tone="neutral">Não conectado</Badge>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Execução e agendamento" />
            <CardBody className="space-y-2 text-sm text-slate-600">
              <p className="inline-flex items-center gap-2 font-medium text-navy">
                <Workflow className="h-4 w-4 text-brand-600" />
                Para executar de verdade, precisaria de:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>um <strong>scheduler</strong> no servidor (pg_cron, fila ou Edge Function) que detecte o gatilho;</li>
                <li>um <strong>provedor de envio</strong> (SMTP, WhatsApp Cloud, Web Push) com backend que guarde as chaves;</li>
                <li>idempotência e logs no backend, para não enviar duas vezes.</li>
              </ul>
              <p className="inline-flex items-start gap-2 pt-1 text-xs text-slate-400">
                <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Nada disso existe aqui. Esta página não finge execução: mostra só o que cada regra ativa dispararia agora,
                calculado no seu navegador com os dados reais. As chaves nunca vão para o frontend.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
