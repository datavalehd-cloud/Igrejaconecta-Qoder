import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Check, MessageCircle, Pencil, Play, Plus, ShieldAlert, ThumbsUp, Trash2, UsersRound, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { usePermissions } from '@/hooks/usePermissions'
import { useSocialAccounts } from '@/hooks/useSocialAccounts'
import {
  SOCIAL_NETWORKS,
  createSocialAccount,
  deleteSocialAccount,
  updateSocialHandle,
  validateHandle,
  type SocialAccountActor,
} from '@/services/data/socialAccountService'
import type { ChurchSocialAccount, SocialNetwork } from '@/types'

/**
 * Perfis de rede da igreja — `church_social_accounts` (0015). Antes esta tela
 * listava quatro contas inventadas; agora cada linha vem do banco e o que se
 * grava é o `@handle`, informação que o administrador da igreja sabe.
 *
 * O que a tela **não** pode fazer é afirmar conexão. Não existe checkbox
 * "conectado": o selo é o `connected` que o banco devolve, e o serviço nunca
 * envia a coluna — o trigger `enforce_social_connection` recusa até um insert
 * que nascesse conectado. Enquanto não houver backend que falou com o provedor,
 * "Não conectado" é o estado honesto, e o que funciona de verdade continua sendo
 * a distribuição sem chave da Central de divulgação.
 *
 * Escrever é `church.manage` (mais estreito que o guard da rota, que é
 * `marketing.manage`): gerente e comunicador veem os perfis e editam zero.
 */

const meta: Record<SocialNetwork, { icon: typeof Camera; name: string; color: string; placeholder: string }> = {
  instagram: { icon: Camera, name: 'Instagram', color: 'text-pink-600', placeholder: '@suaigreja' },
  facebook: { icon: ThumbsUp, name: 'Facebook', color: 'text-brand-600', placeholder: 'Igreja Batista Central' },
  whatsapp: { icon: MessageCircle, name: 'WhatsApp', color: 'text-green-600', placeholder: '5512999990001' },
  youtube: { icon: Play, name: 'YouTube', color: 'text-red-600', placeholder: '@ibcentral' },
}

export function SocialAccountsPage() {
  const { churchId, role, can } = usePermissions()
  const { rows, loading, error, reload } = useSocialAccounts()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)

  const canManage = can('church.manage')
  const actor: SocialAccountActor = { churchId, role }

  if (!churchId) {
    return (
      <div>
        <PageHeader title="Redes sociais" subtitle="Perfis de rede cadastrados para a sua igreja." />
        <EmptyState
          icon={<UsersRound className="h-6 w-6" />}
          title="A sua sessão não tem igreja ativa"
          description="Perfil de rede é dado interno de uma igreja. Entre com a conta de quem é membro para ver e gerenciar os perfis dela."
        />
      </div>
    )
  }

  async function add(network: SocialNetwork, handle: string) {
    setBusy(true)
    const result = await createSocialAccount({ network, handle }, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return false
    }
    setNotice({ tone: 'ok', text: `Perfil de ${meta[network].name} cadastrado.` })
    reload()
    return true
  }

  async function save(id: string, handle: string) {
    setBusy(true)
    const result = await updateSocialHandle(id, handle, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return false
    }
    setNotice({ tone: 'ok', text: '@handle atualizado.' })
    reload()
    return true
  }

  async function remove(account: ChurchSocialAccount) {
    setArmed(null)
    setBusy(true)
    const result = await deleteSocialAccount(account.id, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setNotice({ tone: 'ok', text: `Perfil "${account.handle}" removido.` })
    reload()
  }

  return (
    <div>
      <PageHeader
        title="Redes sociais"
        subtitle="O @handle de cada perfil da igreja, e o estado real da conexão com cada plataforma."
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}
      {error && <Notice tone="error" text={error} onClose={() => reload()} />}

      <Card className="my-6 border-amber-200 bg-amber-50">
        <CardBody className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Conectado não é escolha desta tela</p>
            <p className="mt-1">
              Marcar uma conta como conectada exige a confirmação do próprio provedor, que só vem de um backend com
              OAuth e guarda de tokens — isso não existe aqui. Por isso o aplicativo grava o @handle e o selo continua
              &ldquo;Não conectado&rdquo;: nem o banco aceita que o app escreva o contrário. Para divulgar hoje, use a{' '}
              <Link to="/app/marketing" className="font-medium underline">Central de divulgação</Link> — WhatsApp,
              copiar link com UTM e compartilhamento nativo funcionam sem chave nenhuma.
            </p>
          </div>
        </CardBody>
      </Card>

      {canManage ? null : (
        <Card className="mb-6">
          <CardBody className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Badge tone="navy">Somente leitura</Badge>
            Você vê os perfis da igreja, mas não os edita: perfil de rede faz parte do cadastro da igreja e é de quem
            gerencia a igreja (<span className="text-slate-400">administrador ou SuperAdmin</span>).
          </CardBody>
        </Card>
      )}

      {loading ? (
        <EmptyState icon={<UsersRound className="h-8 w-8" />} title="Carregando..." description="Buscando os perfis de rede da sua igreja." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {SOCIAL_NETWORKS.map((network) => (
            <NetworkCard
              key={network}
              network={network}
              rows={rows.filter((r) => r.network === network)}
              canManage={canManage}
              busy={busy}
              armed={armed}
              onArm={setArmed}
              onAdd={add}
              onSave={save}
              onRemove={remove}
            />
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardBody className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <Badge tone="navy">Isolamento</Badge>
          Cada perfil pertence a uma igreja e é visto só por quem é membro ativo dela.
          <span className="text-slate-400">
            Duas contas iguais na mesma igreja são recusadas pelo banco, não por esta tela.
          </span>
        </CardBody>
      </Card>
    </div>
  )
}

interface NetworkCardProps {
  network: SocialNetwork
  rows: ChurchSocialAccount[]
  canManage: boolean
  busy: boolean
  armed: string | null
  onArm: (id: string | null) => void
  onAdd: (network: SocialNetwork, handle: string) => Promise<boolean>
  onSave: (id: string, handle: string) => Promise<boolean>
  onRemove: (account: ChurchSocialAccount) => Promise<void>
}

function NetworkCard({ network, rows, canManage, busy, armed, onArm, onAdd, onSave, onRemove }: NetworkCardProps) {
  const m = meta[network]
  const Icon = m.icon
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const invalid = adding || editingId !== null ? validateHandle(draft) : null

  function startAdd() {
    setEditingId(null)
    setDraft('')
    setAdding(true)
  }

  function startEdit(account: ChurchSocialAccount) {
    setAdding(false)
    setDraft(account.handle)
    setEditingId(account.id)
  }

  function close() {
    setAdding(false)
    setEditingId(null)
    setDraft('')
  }

  async function submit() {
    const handle = draft.trim()
    const ok = editingId ? await onSave(editingId, handle) : await onAdd(network, handle)
    if (ok) close()
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-surface ${m.color}`}>
              <Icon className="h-4 w-4" />
            </span>
            {m.name}
          </span>
        }
        action={
          rows.some((r) => r.connected) ? (
            <Badge tone="green">Conectada</Badge>
          ) : (
            <Badge tone="neutral">{rows.length === 0 ? 'Não cadastrada' : 'Não conectado'}</Badge>
          )
        }
      />
      <CardBody className="grid gap-3">
        {rows.length === 0 && !adding && (
          <p className="text-sm text-slate-500">Nenhum perfil cadastrado nesta rede.</p>
        )}

        <ul className="grid gap-2">
          {rows.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-2">
              {editingId === account.id ? (
                <HandleField value={draft} onChange={setDraft} invalid={invalid} placeholder={m.placeholder} busy={busy} />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-navy">{account.handle}</span>
              )}

              {canManage && editingId !== account.id && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} aria-label={`Editar ${account.handle}`} disabled={busy} onClick={() => startEdit(account)} />
                  {armed === account.id ? (
                    <>
                      <Button size="sm" variant="danger" title={`Confirmar: remover ${account.handle}`} disabled={busy} onClick={() => onRemove(account)}>
                        Confirmar
                      </Button>
                      <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Cancelar exclusão" onClick={() => onArm(null)} />
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-4 w-4 text-red-500" />}
                      aria-label={`Remover ${account.handle}`}
                      title="Remover perfil: desfaz um cadastro errado, pede confirmação"
                      disabled={busy}
                      onClick={() => onArm(account.id)}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {canManage && (adding ? (
          <div className="grid gap-2">
            <HandleField value={draft} onChange={setDraft} invalid={invalid} placeholder={m.placeholder} busy={busy} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={close} disabled={busy}>Cancelar</Button>
              <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={submit} disabled={busy || Boolean(invalid)}>
                {busy ? 'Salvando...' : editingId ? 'Salvar' : 'Cadastrar'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-start border-t border-slate-100 pt-3">
            <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} disabled={busy} onClick={startAdd}>
              Cadastrar {m.name}
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function HandleField({
  value,
  onChange,
  invalid,
  placeholder,
  busy,
}: {
  value: string
  onChange: (value: string) => void
  invalid: string | null
  placeholder: string
  busy: boolean
}) {
  return (
    <div className="min-w-0 flex-1">
      <Field label="@handle" hint={invalid ?? 'Como a conta aparece. Máximo de 60 caracteres.'}>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={busy} />
      </Field>
    </div>
  )
}
