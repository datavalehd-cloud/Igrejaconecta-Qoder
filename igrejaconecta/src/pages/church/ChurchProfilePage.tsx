import { useState } from 'react'
import { Building2, Save, Upload } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Textarea, Select, Badge } from '@/components/common/primitives'
import { ApprovalBadge } from '@/components/common/StatusBadges'
import { churches } from '@/data/mock'
import { useAuth } from '@/contexts/AuthContext'

export function ChurchProfilePage() {
  const { session } = useAuth()
  const church = churches.find((c) => c.id === session?.churchId) ?? churches[0]!
  const [saved, setSaved] = useState(false)

  return (
    <div>
      <PageHeader
        title="Perfil institucional"
        subtitle="Dados públicos da sua igreja exibidos no portal e no mapa."
        actions={<Button icon={<Save className="h-4 w-4" />} onClick={() => setSaved(true)}>Salvar alterações</Button>}
      />

      {church.approval_status !== 'approved' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Building2 className="h-5 w-5" />
          Sua igreja está com status <ApprovalBadge status={church.approval_status} />. Um SuperAdmin vai analisar o cadastro.
        </div>
      )}
      {saved && <div className="mb-6 rounded-xl border border-green-600/20 bg-green-50 px-4 py-3 text-sm text-green-700">Alterações salvas (demo).</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Informações básicas" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da igreja"><Input defaultValue={church.name} /></Field>
              <Field label="CNPJ (opcional)"><Input placeholder="00.000.000/0000-00" /></Field>
              <Field label="Denominação"><Input defaultValue={church.denomination ?? ''} /></Field>
              <Field label="Responsável"><Input defaultValue="Pr. Marcos Lima" /></Field>
              <Field label="E-mail"><Input type="email" defaultValue={church.email ?? ''} /></Field>
              <Field label="Telefone"><Input defaultValue={church.phone ?? ''} /></Field>
              <Field label="WhatsApp"><Input defaultValue={church.whatsapp ?? ''} /></Field>
              <Field label="Site"><Input defaultValue={church.website ?? ''} /></Field>
              <div className="sm:col-span-2">
                <Field label="Descrição"><Textarea defaultValue={church.description ?? ''} /></Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Redes sociais" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Instagram"><Input placeholder="@suaigreja" /></Field>
              <Field label="Facebook"><Input placeholder="facebook.com/..." /></Field>
              <Field label="TikTok"><Input placeholder="@suaigreja" /></Field>
              <Field label="YouTube"><Input placeholder="youtube.com/@..." /></Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Endereço e localização" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Endereço completo"><Input defaultValue={church.address ?? ''} /></Field></div>
              <Field label="CEP"><Input defaultValue={church.zip ?? ''} /></Field>
              <Field label="Cidade"><Input defaultValue={church.city ?? ''} /></Field>
              <Field label="Estado">
                <Select defaultValue={church.state ?? 'SP'}>
                  {['SP', 'RJ', 'MG', 'PR', 'SC', 'RS', 'BA', 'GO', 'DF'].map((uf) => <option key={uf}>{uf}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Latitude"><Input defaultValue={church.lat?.toString() ?? ''} /></Field>
                <Field label="Longitude"><Input defaultValue={church.lng?.toString() ?? ''} /></Field>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Identidade visual" />
            <CardBody className="space-y-4">
              <UploadBox label="Logotipo" />
              <UploadBox label="Imagem de capa" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Situação" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Aprovação</span><ApprovalBadge status={church.approval_status} /></div>
              <div className="flex justify-between"><span className="text-slate-500">Status</span><Badge tone={church.status === 'active' ? 'green' : 'neutral'}>{church.status === 'active' ? 'Ativa' : 'Inativa'}</Badge></div>
              <div className="flex justify-between"><span className="text-slate-500">Slug público</span><code className="text-xs text-slate-600">/{church.slug}</code></div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

function UploadBox({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-dashed border-line bg-surface px-4 py-5 text-center">
      <div className="text-left">
        <p className="text-sm font-medium text-navy">{label}</p>
        <p className="text-xs text-slate-400">PNG ou JPG até 5MB</p>
      </div>
      <Button variant="outline" size="sm" icon={<Upload className="h-4 w-4" />}>Enviar</Button>
    </div>
  )
}
