import { useEffect, useState } from 'react'
import { ShieldCheck, Database, Bell, Lock, Loader2 } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Field, Input, Select, Badge } from '@/components/common/primitives'
import { supabaseHost } from '@/services/supabase/client'
import { fetchSecuritySummary, SECURITY_EVENT_LABEL, type SecuritySummaryRow } from '@/services/data/securityService'

/**
 * O cartão Segurança mostra o que o banco e o código aplicam de fato: RLS ligado
 * em todas as tabelas, MFA obrigatório para superadmin/church_admin e nenhuma
 * service_role no frontend. Os alertas (M5) vêm da view `security_event_summary`
 * da 0019 — contagem real de escrita recusada e de publicação sem confirmação.
 * Plataforma e LGPD não têm tabela de configuração nesta versão, então os campos
 * ficam somente leitura e não há botão de salvar (que só mentiria dizendo que gravou).
 */
export function AdminSettingsPage() {
  return (
    <div>
      <PageHeader title="Configurações" subtitle="Parâmetros globais da plataforma, segurança e privacidade." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Plataforma" subtitle="Somente leitura — não há armazenamento de configurações nesta versão." />
          <CardBody className="space-y-4">
            <Field label="Nome da plataforma"><Input defaultValue="IgrejaConecta" disabled /></Field>
            <Field label="Domínio"><Input defaultValue="igrejaconecta.app" disabled /></Field>
            <Field label="E-mail remetente"><Input defaultValue="no-reply@igrejaconecta.app" disabled /></Field>
            <Field label="Cadastro de igrejas">
              <Select defaultValue="free" disabled><option value="free">Livre (com aprovação posterior)</option><option value="invite">Somente por convite</option></Select>
            </Field>
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
          <CardHeader title="Privacidade (LGPD)" subtitle="Somente leitura — as retenções não são configuráveis nesta versão." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Retenção de logs de auditoria"><Select disabled><option>12 meses</option><option>24 meses</option><option>5 anos</option></Select></Field>
            <Field label="Retenção de busca de localização"><Select disabled><option>Não armazenar</option><option>30 dias</option><option>90 dias</option></Select></Field>
            <Field label="Consentimento de comunicação"><Select disabled><option>Exigir opt-in</option><option>Opt-out</option></Select></Field>
          </CardBody>
        </Card>
      </div>

      <p className="mt-6 flex items-start gap-2 text-sm text-slate-500">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        Estes parâmetros não são persistidos: não existe tabela de configurações da plataforma nesta
        versão local. O cartão Segurança, sim, reflete o que o banco e o código aplicam de fato.
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
