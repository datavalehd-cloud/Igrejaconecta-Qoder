import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Bell, Database, Info, Loader2, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Select, Badge } from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { usePermissions } from '@/hooks/usePermissions'
import { useSystemSettings } from '@/hooks/useSystemSettings'
import { siteUrl } from '@/config/site'
import { supabaseHost } from '@/services/supabase/client'
import { fetchSecuritySummary, SECURITY_EVENT_LABEL, type SecuritySummaryRow } from '@/services/data/securityService'
import {
  AUDIT_RETENTION_OPTIONS,
  PLATFORM_SETTING_KEY,
  PRIVACY_SETTING_KEY,
  platformValue,
  parsePlatformSettings,
  parsePrivacySettings,
  privacyValue,
  saveSystemSettings,
  validatePlatformDraft,
  type PlatformDraft,
  type PrivacyDraft,
  type SystemSettingRow,
} from '@/services/data/settingsService'

/**
 * O cartão Segurança mostra o que o banco e o código aplicam de fato: RLS ligado
 * em todas as tabelas, MFA obrigatório para superadmin/church_admin e nenhuma
 * service_role no frontend. Os alertas (M5) vêm da view `security_event_summary`
 * da 0019 — contagem real de escrita recusada e de publicação sem confirmação.
 *
 * Plataforma e LGPD agora são reais: vêm das linhas `platform` e `privacy` de
 * `system_settings` (0001), que a política (0002) só abre para SuperAdmin — na
 * leitura e na escrita. O botão Salvar faz upsert de verdade e mostra o
 * `updated_at` que o banco devolveu. A honestidade fica no resto: Domínio é o
 * endereço canônico definido no build (`VITE_SITE_URL`), não um valor de banco;
 * não existe campo de e-mail remetente porque o app não envia e-mail nenhum; e
 * salvar estes valores não muda comportamento — o cadastro de igreja segue
 * livre com aprovação, o MFA é exigido pelo código, e nenhum job expurga a
 * trilha. O rodapé diz isso.
 */
export function AdminSettingsPage() {
  const { role } = usePermissions()
  const { platform, privacy, loading, error, reload } = useSystemSettings()

  const [platformEdits, setPlatformEdits] = useState<PlatformDraft | null>(null)
  const [privacyEdits, setPrivacyEdits] = useState<PrivacyDraft | null>(null)
  const [busy, setBusy] = useState<'platform' | 'privacy' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  // A base do formulário é sempre a linha que o banco devolveu; a edição local
  // só existe até a próxima resposta (salvar ou recarregar descarta o rascunho
  // por cima do que foi confirmado).
  const platformDraft = platformEdits ?? platformBaseOf(platform)
  const privacyDraft = privacyEdits ?? privacyBaseOf(privacy)

  async function savePlatform(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const invalid = validatePlatformDraft(platformDraft)
    if (invalid) {
      setNotice({ tone: 'error', text: invalid })
      return
    }
    setBusy('platform')
    setNotice(null)
    const result = await saveSystemSettings(PLATFORM_SETTING_KEY, platformValue(platformDraft), role)
    setBusy(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setPlatformEdits(null)
    setNotice({ tone: 'ok', text: `Linha "platform" gravada — ${formatStamp(result.setting.updated_at)}.` })
    reload()
  }

  async function savePrivacy(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy('privacy')
    setNotice(null)
    const result = await saveSystemSettings(PRIVACY_SETTING_KEY, privacyValue(privacyDraft), role)
    setBusy(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setPrivacyEdits(null)
    setNotice({ tone: 'ok', text: `Linha "privacy" gravada — ${formatStamp(result.setting.updated_at)}.` })
    reload()
  }

  const platformDirty = platform
    ? differs(platform.value, platformValue(platformDraft))
    : validatePlatformDraft(platformDraft) === null
  const privacyDirty = privacy ? differs(privacy.value, privacyValue(privacyDraft)) : true

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Parâmetros globais da plataforma, segurança e privacidade." />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {error ? (
          <Card className="border-red-200 lg:col-span-2">
            <CardHeader title="Configurações do sistema" subtitle="A leitura de `system_settings` falhou." />
            <CardBody className="space-y-3">
              <p className="flex items-start gap-2 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
              <p className="text-xs text-slate-500">
                Sem a resposta do banco nada é editado: um formulário preenchido sobre uma consulta que
                falhou mostraria valores que ninguém confirmou.
              </p>
              <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Recarregar</Button>
            </CardBody>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader
                title="Plataforma"
                subtitle={platform ? `Lida de system_settings · última gravação ${formatStamp(platform.updated_at)}` : 'Sem linha "platform" no banco — o formulário cria na primeira gravação.'}
              />
              <CardBody>
                {loading ? (
                  <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Lendo system_settings...</p>
                ) : (
                  <form onSubmit={savePlatform} className="space-y-4">
                    <Field label="Nome da plataforma" hint="É o valor guardado em `system_settings`; os cabeçalhos do app usam a constante de código `siteName`.">
                      <Input value={platformDraft.name} onChange={(e) => setPlatformEdits({ ...platformDraft, name: e.target.value })} />
                    </Field>
                    <Field label="Domínio" hint="Endereço canônico definido no build (VITE_SITE_URL) — alimenta canonical, OG e sitemap. Não é valor de banco.">
                      <Input value={siteUrl} disabled />
                    </Field>
                    <Field label="Cadastro de igrejas" hint="Valor declarado: hoje o app aceita cadastro livre com aprovação posterior, qualquer que seja a escolha aqui.">
                      <Select value={platformDraft.churchSignup} onChange={(e) => setPlatformEdits({ ...platformDraft, churchSignup: e.target.value === 'invite' ? 'invite' : 'free' })}>
                        <option value="free">Livre (com aprovação posterior)</option>
                        <option value="invite">Somente por convite</option>
                      </Select>
                    </Field>
                    <Field label="MFA obrigatório para" hint="Leitura do banco. Quem exige o MFA no login é o código (`MFA_REQUIRED_ROLES`), não este valor.">
                      {platformDraft.mfaRequired.length > 0 ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {platformDraft.mfaRequired.map((r) => <Badge key={r} tone="green">{r}</Badge>)}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-500">— (lista vazia no banco)</span>
                      )}
                    </Field>
                    <div className="flex items-center gap-2">
                      <Button type="submit" icon={<Save className="h-4 w-4" />} disabled={Boolean(busy) || !platformDirty}>
                        {busy === 'platform' ? 'Salvando...' : platform ? 'Salvar' : 'Criar linha'}
                      </Button>
                      {!platformDirty && platform && <span className="text-xs text-slate-500">Igual ao banco.</span>}
                    </div>
                  </form>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Segurança" subtitle="O que está valendo de verdade no banco e no código." />
              <CardBody className="space-y-3 text-sm">
                <Row icon={<ShieldCheck className="h-4 w-4 text-green-600" />} label="RLS (Row Level Security)"><Badge tone="green">Ativado</Badge></Row>
                <Row icon={<ShieldCheck className="h-4 w-4 text-green-600" />} label="MFA para administradores"><Badge tone="green">Obrigatório</Badge></Row>
                <Row icon={<ShieldCheck className="h-4 w-4 text-brand-600" />} label="service_role no frontend"><Badge tone="red">Bloqueado</Badge></Row>
                <Row icon={<Bell className="h-4 w-4 text-slate-400" />} label="Alertas de tentativas suspeitas"><SecurityAlerts /></Row>
                <Row icon={<Database className="h-4 w-4 text-brand-600" />} label="Backend de dados (Supabase)"><Badge tone="green">{supabaseHost}</Badge></Row>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader
                title="Privacidade (LGPD)"
                subtitle={privacy ? `Lida de system_settings · última gravação ${formatStamp(privacy.updated_at)}` : 'Sem linha "privacy" no banco — o formulário cria na primeira gravação.'}
              />
              <CardBody>
                {loading ? (
                  <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Lendo system_settings...</p>
                ) : (
                  <form onSubmit={savePrivacy} className="grid gap-4 sm:grid-cols-3">
                    <Field label="Retenção de logs de auditoria" hint="Nenhum job expurga a trilha por este número; é declaração registrada.">
                      <Select
                        value={privacyDraft.auditRetentionMonths === null ? '' : String(privacyDraft.auditRetentionMonths)}
                        onChange={(e) => setPrivacyEdits({ ...privacyDraft, auditRetentionMonths: e.target.value === '' ? null : Number(e.target.value) })}
                      >
                        <option value="">Não definido no banco</option>
                        {AUDIT_RETENTION_OPTIONS.map((months) => <option key={months} value={String(months)}>{months} meses</option>)}
                      </Select>
                    </Field>
                    <Field label="Retenção de busca de localização" hint="A busca por CEP consulta a ViaCEP e hoje nada é armazenado; o valor fica declarado aqui.">
                      <Select
                        value={privacyDraft.locationSearchStorage}
                        onChange={(e) => setPrivacyEdits({ ...privacyDraft, locationSearchStorage: e.target.value === '30d' || e.target.value === '90d' ? e.target.value : 'none' })}
                      >
                        <option value="none">Não armazenar</option>
                        <option value="30d">30 dias</option>
                        <option value="90d">90 dias</option>
                      </Select>
                    </Field>
                    <Field label="Consentimento de comunicação" hint="Nenhuma tela lê este valor para exigir consentimento; as campanhas operam por confirmação explícita de quem envia.">
                      <Select
                        value={privacyDraft.communicationOptIn === null ? '' : String(privacyDraft.communicationOptIn)}
                        onChange={(e) => setPrivacyEdits({ ...privacyDraft, communicationOptIn: e.target.value === '' ? null : e.target.value === 'true' })}
                      >
                        <option value="">Não definido no banco</option>
                        <option value="true">Exigir opt-in</option>
                        <option value="false">Opt-out</option>
                      </Select>
                    </Field>
                    <div className="flex items-center gap-2 sm:col-span-3">
                      <Button type="submit" icon={<Save className="h-4 w-4" />} disabled={Boolean(busy) || !privacyDirty}>
                        {busy === 'privacy' ? 'Salvando...' : privacy ? 'Salvar' : 'Criar linha'}
                      </Button>
                      {!privacyDirty && privacy && <span className="text-xs text-slate-500">Igual ao banco.</span>}
                    </div>
                  </form>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>

      <p className="mt-6 flex items-start gap-2 text-sm text-slate-500">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Plataforma e LGPD vêm de <code>system_settings</code> e o Salvar grava no banco de fato — mas
          estes valores são declaração registrada, não interruptor: o cadastro de igrejas segue livre
          com aprovação posterior, o MFA é exigido pelo código e nada expurga a trilha automaticamente.
          E não há campo de e-mail remetente: o app não envia e-mail por nenhum provedor.
        </span>
      </p>
    </div>
  )
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2 text-slate-600">{icon}{label}</span>
      {children}
    </div>
  )
}

/**
 * Contagens da 0019. Sem linha na view não há número: o cartão mostra zero só
 * quando o banco respondeu com zero, e mostra falha quando a consulta falha.
 */
function SecurityAlerts() {
  const [rows, setRows] = useState<SecuritySummaryRow[] | null>(null)
  const [failure, setFailure] = useState(false)

  useEffect(() => {
    let alive = true
    fetchSecuritySummary()
      .then((data) => { if (alive) { setRows(data); setFailure(false) } })
      .catch(() => { if (alive) { setRows(null); setFailure(true) } })
    return () => { alive = false }
  }, [])

  if (failure) return <Badge tone="red">Consulta falhou</Badge>
  if (!rows) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
  const hot = rows.filter((r) => r.last_24h > 0)
  return (
    <span className="text-right text-xs text-slate-500">
      {rows.map((r) => `${SECURITY_EVENT_LABEL[r.kind]}: ${r.last_24h} em 24h / ${r.total} no total`).join(' · ')}
      {hot.length === 0 && ' — nada nas últimas 24h'}
    </span>
  )
}

function formatStamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Sujo = o valor do formulário difere do `value` que o banco devolveu. Sem
 * linha ainda, "sujo" é poder criar: plataforma exige nome válido, privacidade
 * não tem campo obrigatório. A comparação é com o JSON cru da linha porque ele
 * é a resposta do provedor, não uma projeção da tela.
 */
function differs(savedValue: unknown, draftValue: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(draftValue) !== JSON.stringify(savedValue ?? {})
  } catch {
    return true
  }
}

function platformBaseOf(row: SystemSettingRow | undefined): PlatformDraft {
  const parsed = parsePlatformSettings(row)
  return parsed
    ? { name: parsed.name ?? '', churchSignup: parsed.churchSignup, mfaRequired: parsed.mfaRequired }
    : { name: '', churchSignup: 'free', mfaRequired: [] }
}

function privacyBaseOf(row: SystemSettingRow | undefined): PrivacyDraft {
  const parsed = parsePrivacySettings(row)
  return parsed
    ? {
        auditRetentionMonths: parsed.auditRetentionMonths,
        locationSearchStorage: parsed.locationSearchStorage,
        communicationOptIn: parsed.communicationOptIn,
      }
    : { auditRetentionMonths: null, locationSearchStorage: 'none', communicationOptIn: null }
}
