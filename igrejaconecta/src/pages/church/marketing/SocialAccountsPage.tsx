import { Link } from 'react-router-dom'
import { Camera, ThumbsUp, Music2, MessageCircle, ShieldAlert, Megaphone } from 'lucide-react'
import { PageHeader, Button, Badge, Card, CardBody } from '@/components/common/primitives'
import { socialAccounts } from '@/data/mock'
import type { SocialNetwork } from '@/types'

const meta: Record<SocialNetwork, { icon: typeof Camera; name: string; color: string; requirement: string }> = {
  instagram: { icon: Camera, name: 'Instagram', color: 'text-pink-600', requirement: 'Conta profissional + Meta Graph API com token de longa duração.' },
  facebook: { icon: ThumbsUp, name: 'Facebook', color: 'text-brand-600', requirement: 'Página autorizada + Meta Graph API (OAuth e revisão de escopos).' },
  tiktok: { icon: Music2, name: 'TikTok', color: 'text-slate-800', requirement: 'TikTok Content Posting API, sujeita a aprovação do app pela plataforma.' },
  whatsapp: { icon: MessageCircle, name: 'WhatsApp', color: 'text-green-600', requirement: 'WhatsApp Cloud API oficial + remetente verificado e templates aprovados.' },
}

/**
 * Nada aqui está conectado, e a página diz isso sem rodeios. Conectar de verdade
 * exigiria OAuth + um backend que guarde tokens (service_role), o que não existe
 * neste ambiente — e nunca clicamos em "Authorize" de terceiros em nome do usuário.
 * O que existe sem chave é a distribuição na Central de divulgação: WhatsApp,
 * copiar link (com UTM) e compartilhar. Nenhuma conta aparece como conectada e
 * nenhuma campanha como publicada sem confirmação real do provedor.
 */
export function SocialAccountsPage() {
  return (
    <div>
      <PageHeader
        title="Redes sociais"
        subtitle="Estado real das conexões e o caminho de distribuição que existe hoje, sem chave."
      />

      <Card className="mb-6 border-amber-200 bg-amber-50">
        <CardBody className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Nenhuma rede está conectada</p>
            <p className="mt-1">
              Publicar automaticamente exige OAuth e um backend que guarde os tokens com segurança (service_role) —
              isso não existe aqui. Por isso não oferecemos botão de "conectar" de mentira: ele prometeria uma
              integração que não acontece. Enquanto não houver backend, distribua sem chave pela{' '}
              <Link to="/app/marketing" className="font-medium underline">Central de divulgação</Link>.
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {socialAccounts.map((acc) => {
          const m = meta[acc.network]
          const Icon = m.icon
          return (
            <Card key={acc.id}>
              <CardBody className="flex items-start gap-4">
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-surface ${m.color}`}><Icon className="h-6 w-6" /></span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-navy">{m.name}</p>
                    <Badge tone="neutral">Não conectado</Badge>
                  </div>
                  <p className="text-sm text-slate-500">{acc.label}</p>
                  <p className="mt-2 text-xs text-slate-400">Para conectar: {m.requirement}</p>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>

      <Card className="mt-6">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-navy">Distribuição sem chave</p>
            <p className="text-sm text-slate-500">
              Link de WhatsApp, copiar link com UTM e compartilhamento nativo funcionam hoje, sem token nenhum.
            </p>
          </div>
          <Link to="/app/marketing">
            <Button icon={<Megaphone className="h-4 w-4" />}>Ir para campanhas</Button>
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}
