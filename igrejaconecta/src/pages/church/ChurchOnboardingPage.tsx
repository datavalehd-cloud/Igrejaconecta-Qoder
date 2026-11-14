import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useMyChurches } from '@/hooks/useChurches'
import { createChurch, type ChurchDraft } from '@/services/data/churchService'
import {
  PageHeader, Button, Badge, Card, CardHeader, CardBody, Field, Input, Select, EmptyState,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { Building2, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react'
import { UF_LIST } from '@/utils/ufs'
import type { Church } from '@/types'

/**
 * Onboarding de igreja (2026-11-12). A igreja entra como `pending` e o criador é
 * anexado como `church_admin` pelo trigger `trg_churches_creator_admin` (0006) —
 * a tela não escolhe o papel nem o status, e por isso diz com todas as letras que
 * nada funciona antes da aprovação do SuperAdmin.
 */

const EMPTY_FORM = {
  name: '',
  city: '',
  state: '',
  denomination: '',
  email: '',
  phone: '',
  whatsapp: '',
  website: '',
}

export function ChurchOnboardingPage() {
  const { session } = useAuth()
  const { churchId, isSuperAdmin } = usePermissions()
  const { rows: myChurches, loading: churchesLoading } = useMyChurches()
  const [form, setForm] = useState<ChurchDraft & { state: string }>({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Church | null>(null)

  const update = (field: keyof typeof EMPTY_FORM) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!session || saving) return
    setSaving(true)
    setError(null)
    const result = await createChurch(form, { id: session.profile.id })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCreated(result.church)
  }

  if (isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Cadastrar igreja" subtitle="SuperAdmin não cria igreja para si." />
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title="A sua conta é a direção da plataforma"
          description="SuperAdmin analisa e aprova as igrejas cadastradas pelos próprios líderes. O cadastro é feito pela conta de quem vai gerir a igreja."
          action={<Link to="/admin/igrejas"><Button icon={<ArrowRight className="h-4 w-4" />}>Ir para aprovações</Button></Link>}
        />
      </div>
    )
  }

  if (created) {
    return (
      <div>
        <PageHeader title="Cadastrar igreja" subtitle="Cadastro enviado." />
        <Card className="border-green-200 bg-green-50/50">
          <CardHeader
            title={<span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />{created.name}</span>}
            subtitle="A igreja foi criada e você entrou como administrador dela."
            action={<Badge tone="amber">aguardando aprovação</Badge>}
          />
          <CardBody className="space-y-3 text-sm text-slate-600">
            <p>O SuperAdmin precisa aprovar a igreja antes de ela aparecer no diretório público e de os seus eventos serem publicados.</p>
            <p>Assim que a aprovação sair, saia e entre de novo para a sessão carregar o papel de administrador da igreja.</p>
            <p>Ative a verificação em duas etapas em <Link className="font-semibold text-brand-600 hover:underline" to="/app/perfil">Meu perfil</Link> — ela é obrigatória para quem administra igreja.</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => window.location.assign('/app')} disabled={saving}>
                {saving ? 'Recarregando...' : 'Recarregar sessão'}
              </Button>
              <Link to="/app/perfil"><Button variant="outline">Ir para Meu perfil</Button></Link>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (churchesLoading) {
    return (
      <div>
        <PageHeader title="Cadastrar igreja" subtitle="Consultando as igrejas da sua conta..." />
        <Card><CardBody className="text-sm text-slate-500">Consultando...</CardBody></Card>
      </div>
    )
  }

  // O vínculo vivo manda, não a sessão: logo depois do cadastro a sessão ainda é a
  // de antes, e sem isto a tela ofereceria criar a mesma igreja de novo.
  const linked = myChurches.find((c) => c.church_id === churchId) ?? myChurches[0]
  if (linked) {
    const sessaoDesatualizada = linked.church_id !== churchId
    return (
      <div>
        <PageHeader title="Cadastrar igreja" subtitle="Esta conta já está vinculada a uma igreja." />
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title={linked.name}
          description={
            linked.approval_status === 'approved'
              ? 'Igreja aprovada. Use a tela da igreja para editar os dados; uma segunda comunidade precisa de uma conta própria.'
              : `Aguardando aprovação do SuperAdmin. ${sessaoDesatualizada ? 'O vínculo acabou de ser criado: recarregue para a sessão reconhecer a igreja.' : 'Use a tela da igreja para completar os dados.'}`
          }
          action={
            sessaoDesatualizada
              ? <Button onClick={() => window.location.assign('/app')}>Recarregar sessão</Button>
              : <Link to="/app/igreja"><Button icon={<ArrowRight className="h-4 w-4" />}>Abrir dados da igreja</Button></Link>
          }
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Cadastrar igreja"
        subtitle="Preencha os dados da comunidade. Ela entra como pendente e você vira o administrador dela."
      />

      {error && <Notice tone="error" text={error} onClose={() => setError(null)} />}

      <form onSubmit={onSubmit} className="max-w-3xl">
        <Card>
          <CardHeader title="Identificação" subtitle="Só o nome é obrigatório." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Nome da igreja" hint="Como aparece no diretório público.">
                <Input
                  name="name"
                  value={form.name}
                  onChange={update('name')}
                  required
                  minLength={3}
                  placeholder="Igreja Batista Central"
                />
              </Field>
            </div>
            <Field label="Denominação"><Input name="denomination" value={form.denomination ?? ''} onChange={update('denomination')} placeholder="Batista" /></Field>
            <Field label="Cidade"><Input name="city" value={form.city ?? ''} onChange={update('city')} placeholder="São Paulo" /></Field>
            <Field label="Estado (UF)">
              <Select name="state" value={form.state} onChange={update('state')}>
                <option value="">Selecione</option>
                {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </Select>
            </Field>
            <Field label="E-mail"><Input type="email" name="email" value={form.email ?? ''} onChange={update('email')} placeholder="contato@suaigreja.org" /></Field>
            <Field label="WhatsApp" hint="Usado nos botões de contato e nas campanhas.">
              <Input name="whatsapp" value={form.whatsapp ?? ''} onChange={update('whatsapp')} placeholder="11999998888" />
            </Field>
            <Field label="Telefone"><Input name="phone" value={form.phone ?? ''} onChange={update('phone')} placeholder="11 3333-4444" /></Field>
            <div className="sm:col-span-2">
              <Field label="Site"><Input type="url" name="website" value={form.website ?? ''} onChange={update('website')} placeholder="https://suaigreja.org" /></Field>
            </div>
          </CardBody>
        </Card>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving}>{saving ? 'Enviando...' : 'Cadastrar igreja'}</Button>
          <Link to="/app"><Button type="button" variant="outline">Cancelar</Button></Link>
        </div>
      </form>
    </div>
  )
}
