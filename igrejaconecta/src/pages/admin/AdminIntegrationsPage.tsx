import { Plug, ShieldAlert } from 'lucide-react'
import { PageHeader, Card, CardBody, Badge } from '@/components/common/primitives'

const integrations = [
  { name: 'OpenAI', desc: 'Geração de textos, artes e vídeos.', requirement: 'Chave de API + backend que faça as chamadas (a chave nunca vai ao frontend).' },
  { name: 'Meta (Instagram/Facebook)', desc: 'Graph API — publicação e métricas.', requirement: 'OAuth + revisão de escopos + backend que guarde o token de longa duração.' },
  { name: 'TikTok', desc: 'Content Posting API.', requirement: 'App aprovado pela plataforma + OAuth + backend.' },
  { name: 'WhatsApp Business', desc: 'Cloud API oficial + webhooks.', requirement: 'Remetente verificado, templates aprovados e backend de webhooks.' },
  { name: 'Google Maps', desc: 'Maps, Places, Geocoding e Routes.', requirement: 'Chave de API com restrições + billing ativo na conta Google.' },
] as const

/**
 * Nenhum provedor está conectado nesta versão local, e a página diz isso sem
 * números de mentira. Conectar de verdade exigiria as chaves de cada serviço e
 * um backend que as guarde (service_role nunca vai ao frontend) — o mesmo motivo
 * de `/app/redes`. Cada cartão mostra o que seria necessário, não um status falso.
 */
export function AdminIntegrationsPage() {
  return (
    <div>
      <PageHeader title="Integrações" subtitle="Estado real das conexões externas da plataforma." />

      <Card className="mb-6 border-amber-200 bg-amber-50">
        <CardBody className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Nenhum provedor está conectado</p>
            <p className="mt-1">
              Não há consumo, status ou logs para mostrar: esta versão local não chama nenhum serviço
              externo. Conectar de verdade exige as chaves de cada provedor e um backend que as guarde
              com segurança. Por isso não exibimos números de mentira — cada cartão diz o que seria necessário.
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {integrations.map((i) => (
          <Card key={i.name}>
            <CardBody>
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface text-brand-600"><Plug className="h-5 w-5" /></span>
                <Badge tone="neutral">Não conectado</Badge>
              </div>
              <h3 className="mt-3 font-semibold text-navy">{i.name}</h3>
              <p className="text-sm text-slate-500">{i.desc}</p>
              <p className="mt-3 text-xs text-slate-400">Para conectar: {i.requirement}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
