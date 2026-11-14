import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, Loader2, RefreshCw, Save } from 'lucide-react'
import {
  PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Textarea, Select, Badge, EmptyState,
} from '@/components/common/primitives'
import { ApprovalBadge } from '@/components/common/StatusBadges'
import { Notice } from '@/components/common/Notice'
import { CoordsField } from '@/components/common/CoordsField'
import { usePermissions } from '@/hooks/usePermissions'
import { useChurchProfile } from '@/hooks/useChurchProfile'
import {
  updateChurchProfile,
  CHURCH_PROFILE_NO_CHURCH,
  type ChurchProfileDraft,
} from '@/services/data/churchProfileService'
import { UF_LIST } from '@/utils/ufs'
import type { Church, RoleKey } from '@/types'

/**
 * Perfil institucional (M3c). A tela era o último reduto do mock: mostrava CNPJ e
 * "Responsável" — campos que não têm coluna em `churches` — e um card de redes
 * sociais que não gravava em lugar nenhum. Saíram em vez de serem inventados.
 *
 * O que a tela grava é o que a tabela tem. `slug`, `status` e `approval_status`
 * aparecem como leitura, nunca como patch — o recorte está em `churchProfileService`.
 * A rota já é de `church.manage` (AppRoutes), então aqui não há estado de
 * "não posso editar": quem chega, edita.
 */

const FORM_KEYS: (keyof ChurchProfileDraft)[] = [
  'name', 'description', 'denomination', 'email', 'phone', 'whatsapp', 'website',
  'address', 'city', 'state', 'zip', 'lat', 'lng',
]

export function ChurchProfilePage() {
  const { role } = usePermissions()
  const { church, loading, error, reload } = useChurchProfile()

  if (loading) {
    return (
      <div>
        <PageHeader title="Perfil institucional" subtitle="Dados públicos da sua igreja exibidos no portal e no mapa." />
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando o cadastro da igreja...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Perfil institucional" subtitle="Dados públicos da sua igreja exibidos no portal e no mapa." />
        <ReadFailure text={error} onRetry={reload} />
      </div>
    )
  }

  if (!church) {
    return (
      <div>
        <PageHeader title="Perfil institucional" subtitle="Dados públicos da sua igreja exibidos no portal e no mapa." />
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="Nenhuma igreja nesta sessão"
          description={CHURCH_PROFILE_NO_CHURCH}
          action={
            <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Perfil institucional"
        subtitle="Dados públicos da sua igreja exibidos no portal e no mapa."
        actions={<Badge tone="green">Salva no banco</Badge>}
      />

      {church.approval_status !== 'approved' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Building2 className="h-5 w-5" />
          Sua igreja está com status <ApprovalBadge status={church.approval_status} />. Um SuperAdmin vai analisar o cadastro.
        </div>
      )}

      <ProfileEditor key={church.id} church={church} role={role} onSaved={reload} />
    </div>
  )
}

function ProfileEditor({
  church,
  role,
  onSaved,
}: {
  church: Church
  role: RoleKey | undefined
  onSaved: () => void
}) {
  const [seed, setSeed] = useState<ChurchProfileDraft>(() => draftFrom(church))
  const [form, setForm] = useState<ChurchProfileDraft>(seed)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const dirty = FORM_KEYS.some((key) => form[key] !== seed[key])

  const update =
    (field: keyof ChurchProfileDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setNotice(null)
    const result = await updateChurchProfile(form, { churchId: church.id, role })
    setSaving(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    // O banco é a fonte do que aparece nos campos: re-semeia semente e formulário.
    const next = draftFrom(result.church)
    setSeed(next)
    setForm(next)
    setNotice({ tone: 'ok', text: 'Cadastro atualizado: o que está nos campos é o que o banco devolveu.' })
    onSaved()
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

        <Card>
          <CardHeader title="Informações básicas" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da igreja">
              <Input value={form.name} onChange={update('name')} />
            </Field>
            <Field label="Denominação">
              <Input value={form.denomination} onChange={update('denomination')} />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Descrição"
                hint="Só o que existe na tabela de igrejas. Campos como CNPJ e responsável não têm onde ser gravados, então não aparecem aqui."
              >
                <Textarea value={form.description} onChange={update('description')} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contato" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="E-mail"><Input type="email" value={form.email} onChange={update('email')} /></Field>
            <Field label="Telefone"><Input value={form.phone} onChange={update('phone')} /></Field>
            <Field label="WhatsApp"><Input value={form.whatsapp} onChange={update('whatsapp')} /></Field>
            <Field label="Site"><Input value={form.website} onChange={update('website')} /></Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Endereço e localização" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Endereço completo"><Input value={form.address} onChange={update('address')} /></Field>
            </div>
            <Field label="CEP"><Input value={form.zip} onChange={update('zip')} /></Field>
            <Field label="Cidade"><Input value={form.city} onChange={update('city')} /></Field>
            <Field label="Estado">
              <Select value={form.state} onChange={update('state')}>
                <option value="">Selecione</option>
                {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </Select>
            </Field>
            <CoordsField
              lat={form.lat}
              lng={form.lng}
              onChange={(lat, lng) => setForm((current) => ({ ...current, lat, lng }))}
            />
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" icon={<Save className="h-4 w-4" />} disabled={saving || !dirty}>
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </Button>
          <Button type="button" variant="outline" onClick={() => setForm(seed)} disabled={saving || !dirty}>
            Descartar
          </Button>
          {!dirty && <span className="text-xs text-slate-500">Nada para salvar: os campos estão iguais ao que o banco tem.</span>}
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Situação" />
          <CardBody className="space-y-2 text-sm">
            <Row label="Aprovação"><ApprovalBadge status={church.approval_status} /></Row>
            <Row label="Status">
              <Badge tone={church.status === 'active' ? 'green' : 'neutral'}>
                {church.status === 'active' ? 'Ativa' : 'Inativa'}
              </Badge>
            </Row>
            <Row label="Slug público"><code className="text-xs text-slate-600">/{church.slug}</code></Row>
            <Row label="Cadastrada em"><span className="text-slate-600">{formatDate(church.created_at)}</span></Row>
            <Row label="Última alteração"><span className="text-slate-600">{formatDate(church.updated_at)}</span></Row>
            <p className="pt-2 text-xs text-slate-400">
              Aprovar, suspender e mudar o endereço público são decisões do SuperAdmin: estes campos não saem desta tela como escrita.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Redes sociais" subtitle="As contas conectadas têm tela própria." />
          <CardBody>
            <Link to="/app/redes">
              <Button type="button" variant="outline" size="sm">Abrir redes sociais</Button>
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Identidade visual" />
          <CardBody className="space-y-2 text-sm text-slate-500">
            <p>Logotipo e imagem de capa ainda não têm upload neste aplicativo.</p>
            <p>Enquanto a tela não envia nem mostra o arquivo, não há botão: oferta sem função é o que não se mostra.</p>
          </CardBody>
        </Card>
      </div>
    </form>
  )
}

function ReadFailure({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <Card className="border-red-200">
      <CardBody className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{text}</span>
        </p>
        <p className="text-xs text-slate-500">
          Sem a resposta do banco a tela não mostra cadastro: o que aparecesse aqui seria dado inventado.
        </p>
        <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>
          Recarregar
        </Button>
      </CardBody>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      {children}
    </div>
  )
}

function draftFrom(church: Church): ChurchProfileDraft {
  const text = (value: string | null | undefined) => value ?? ''
  return {
    name: text(church.name),
    description: text(church.description),
    denomination: text(church.denomination),
    email: text(church.email),
    phone: text(church.phone),
    whatsapp: text(church.whatsapp),
    website: text(church.website),
    address: text(church.address),
    city: text(church.city),
    state: text(church.state),
    zip: text(church.zip),
    lat: coordinateText(church.lat),
    lng: coordinateText(church.lng),
  }
}

function coordinateText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}
