import { useEffect, useState } from 'react'
import { Crown, Pencil, Trash2, UserPlus, Users, UsersRound, X } from 'lucide-react'
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
  Select,
  Textarea,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { useMinistries } from '@/hooks/useMinistries'
import { usePermissions } from '@/hooks/usePermissions'
import { useRoster } from '@/hooks/useRoster'
import {
  addMinistryMember,
  createMinistry,
  deleteMinistry,
  fetchMinistryMembers,
  removeMinistryMember,
  updateMinistry,
  type MinistryDraft,
} from '@/services/data/ministryService'
import type { Ministry } from '@/types'

/**
 * Ministérios e equipes. A lista vem da view `ministry_list` (0015): o líder é
 * uma pessoa do roster (uuid + nome) e a contagem de participantes é `count(*)`
 * no banco — não há campo "quantos" para digitar. Quem gerencia membros
 * (`members.manage`) escreve; os outros só leem.
 *
 * Excluir ministério existe porque desfazer um cadastro errado é operação normal
 * (decisão registrada na 0015), e por apagar a participação das pessoas junto ele
 * pede confirmação antes de escrever.
 */

const typeLabel = { ministry: 'Ministério', department: 'Departamento', team: 'Equipe' } as const
const typeTone = { ministry: 'brand', department: 'navy', team: 'green' } as const

type Editing = { mode: 'create' } | { mode: 'edit'; ministry: Ministry }

export function MinistriesPage() {
  const { churchId, role, can } = usePermissions()
  const { rows, loading, error, reload } = useMinistries()
  const roster = useRoster()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [teamOf, setTeamOf] = useState<Ministry | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const canManage = can('members.manage')
  const actor = { churchId, role }
  const activeMembers = roster.rows.filter((r) => r.membership_status === 'active')

  if (!churchId) {
    return (
      <div>
        <PageHeader title="Ministérios & equipes" subtitle="Organize ministérios, departamentos, líderes e participantes." />
        <EmptyState
          icon={<UsersRound className="h-6 w-6" />}
          title="A sua sessão não tem igreja ativa"
          description="Ministério é dado interno de uma igreja. Entre com a conta de quem é membro para ver e gerenciar os ministérios dela."
        />
      </div>
    )
  }

  async function runDelete(ministry: Ministry) {
    setArmed(null)
    setBusy(true)
    const result = await deleteMinistry(ministry.id, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    if (editing?.mode === 'edit' && editing.ministry.id === ministry.id) setEditing(null)
    if (teamOf?.id === ministry.id) setTeamOf(null)
    setNotice({ tone: 'ok', text: `Ministério "${ministry.name}" excluído.` })
    reload()
  }

  return (
    <div>
      <PageHeader
        title="Ministérios & equipes"
        subtitle="Organize ministérios, departamentos, equipes, líderes e participantes."
        actions={
          canManage ? (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => { setNotice(null); setEditing({ mode: 'create' }) }}>
              Novo ministério
            </Button>
          ) : undefined
        }
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}
      {error && <Notice tone="error" text={error} onClose={() => reload()} />}

      {editing && (
        <MinistryForm
          editing={editing}
          members={activeMembers}
          onCancel={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); setNotice({ tone: 'ok', text }); reload() }}
          onError={(text) => setNotice({ tone: 'error', text })}
        />
      )}

      {teamOf && (
        <MinistryTeam
          key={teamOf.id}
          ministry={teamOf}
          members={activeMembers}
          onClose={() => setTeamOf(null)}
          onNotice={(tone, text) => setNotice({ tone, text })}
          onChanged={() => { setTeamOf(null); setNotice({ tone: 'ok', text: 'Participantes atualizados.' }); reload() }}
        />
      )}

      {loading ? (
        <EmptyState icon={<UsersRound className="h-8 w-8" />} title="Carregando..." description="Buscando os ministérios da sua igreja." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UsersRound className="h-8 w-8" />}
          title="Nenhum ministério cadastrado"
          description="Crie o primeiro ministério, departamento ou equipe da igreja."
          action={canManage ? <Button onClick={() => setEditing({ mode: 'create' })}>Novo ministério</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((m) => (
              <Card key={m.id}>
                <CardBody>
                  <div className="flex items-start justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <UsersRound className="h-5 w-5" />
                    </span>
                    <Badge tone={typeTone[m.type]}>{typeLabel[m.type]}</Badge>
                  </div>
                  <h3 className="mt-3 font-semibold text-navy">{m.name}</h3>
                  {m.description && <p className="mt-1 text-sm text-slate-500">{m.description}</p>}
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500">
                    <Crown className="h-3.5 w-3.5" />
                    {m.leader_name ?? 'Sem líder'}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500">
                    <Users className="h-3.5 w-3.5" />
                    {m.members_count} participante{m.members_count === 1 ? '' : 's'}
                  </p>

                  {canManage && (
                    <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        aria-label={`Editar ${m.name}`}
                        disabled={busy}
                        onClick={() => { setNotice(null); setEditing({ mode: 'edit', ministry: m }) }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Users className="h-4 w-4" />}
                        aria-label={`Participantes de ${m.name}`}
                        disabled={busy}
                        onClick={() => { setNotice(null); setTeamOf(m) }}
                      />
                      {armed === m.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            title={`Confirmar: excluir ${m.name}`}
                            onClick={() => runDelete(m)}
                          >
                            Confirmar exclusão
                          </Button>
                          <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Cancelar" onClick={() => setArmed(null)} />
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-4 w-4 text-red-500" />}
                          aria-label={`Excluir ${m.name}`}
                          title="Excluir ministério: tira também as participações, pede confirmação"
                          disabled={busy}
                          onClick={() => setArmed(m.id)}
                        />
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>

          <Card className="mt-4">
            <CardBody className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <Badge tone="navy">Isolamento</Badge>
              Ministério é visto só por quem é membro ativo da própria igreja.
              <span className="text-slate-400">
                Líder e participantes têm de ser gente ativa desta igreja — a contagem é feita no banco, não digitada.
              </span>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

interface MinistryFormState {
  name: string
  type: Ministry['type']
  description: string
  leader_id: string
}

function toFormState(ministry?: Ministry): MinistryFormState {
  return {
    name: ministry?.name ?? '',
    type: ministry?.type ?? 'ministry',
    description: ministry?.description ?? '',
    leader_id: ministry?.leader_id ?? '',
  }
}

function MinistryForm({
  editing,
  members,
  onCancel,
  onSaved,
  onError,
}: {
  editing: Editing
  members: { user_id: string; full_name: string }[]
  onCancel: () => void
  onSaved: (text: string) => void
  onError: (text: string) => void
}) {
  const { churchId, role } = usePermissions()
  const ministry = editing.mode === 'edit' ? editing.ministry : undefined
  const [form, setForm] = useState(() => toFormState(ministry))
  const [busy, setBusy] = useState(false)

  // O líder escolhido nem sempre está na lista de hoje (a pessoa pode ter saído
  // da igreja). Sumir com a opção dela silenciosamente faria o salvar gravar
  // "sem líder"; melhor mostrar o que está gravado e deixar o banco recusar.
  const leaderOptions = [...members]
  if (form.leader_id && !leaderOptions.some((m) => m.user_id === form.leader_id)) {
    leaderOptions.unshift({ user_id: form.leader_id, full_name: ministry?.leader_name ?? 'Pessoa fora da lista de membros' })
  }

  const set = <K extends keyof MinistryFormState>(key: K, value: MinistryFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function submit() {
    const draft: MinistryDraft = {
      name: form.name,
      type: form.type,
      description: form.description,
      leader_id: form.leader_id,
    }
    setBusy(true)
    const result = ministry
      ? await updateMinistry(ministry.id, draft, { churchId, role })
      : await createMinistry(draft, { churchId, role })
    setBusy(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onSaved(ministry ? 'Ministério atualizado.' : 'Ministério cadastrado.')
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={ministry ? `Editar ministério — ${ministry.name}` : 'Novo ministério'}
        subtitle="A igreja do ministério é a da sua sessão; líder e participantes precisam ser gente ativa dela."
        action={
          <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Fechar formulário" onClick={onCancel} />
        }
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Ministério de Louvor" required />
        </Field>
        <Field label="Tipo">
          <Select value={form.type} onChange={(e) => set('type', e.target.value as Ministry['type'])}>
            <option value="ministry">Ministério</option>
            <option value="department">Departamento</option>
            <option value="team">Equipe</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Descrição" hint="Opcional. Aparece no cartão do ministério.">
            <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="O que este ministério faz" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Líder" hint="Só membros ativos da igreja aparecem aqui.">
            <Select value={form.leader_id} onChange={(e) => set('leader_id', e.target.value)}>
              <option value="">Sem líder</option>
              {leaderOptions.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Salvando...' : ministry ? 'Salvar alterações' : 'Cadastrar ministério'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function MinistryTeam({
  ministry,
  members,
  onClose,
  onNotice,
  onChanged,
}: {
  ministry: Ministry
  members: { user_id: string; full_name: string }[]
  onClose: () => void
  onNotice: (tone: 'ok' | 'error', text: string) => void
  onChanged: () => void
}) {
  const { churchId, role } = usePermissions()
  const actor = { churchId, role }
  const [userIds, setUserIds] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchMinistryMembers(ministry.id)
      .then((rows) => {
        if (alive) setUserIds(rows.map((r) => r.user_id))
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os participantes.')
      })
    return () => {
      alive = false
    }
  }, [ministry.id])

  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.full_name ?? 'Pessoa fora da lista de membros'
  const available = members.filter((m) => !userIds?.includes(m.user_id))

  async function add() {
    if (!pick) return
    setBusy(true)
    const result = await addMinistryMember(ministry.id, pick, actor)
    setBusy(false)
    if (!result.ok) {
      onNotice('error', result.error)
      return
    }
    onChanged()
  }

  async function remove(id: string) {
    setBusy(true)
    const result = await removeMinistryMember(ministry.id, id, actor)
    setBusy(false)
    if (!result.ok) {
      onNotice('error', result.error)
      return
    }
    setUserIds((current) => (current ?? []).filter((u) => u !== id))
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={`Participantes — ${ministry.name}`}
        subtitle="Quem está no ministério é contado no banco; a lista abaixo é a mesma régua que o banco usa."
        action={<Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Fechar participantes" onClick={onClose} />}
      />
      <CardBody className="grid gap-4">
        {loadError ? (
          <Notice tone="error" text={loadError} onClose={() => onClose()} />
        ) : userIds === null ? (
          <p className="text-sm text-slate-500">Carregando participantes...</p>
        ) : userIds.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum participante ainda.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {userIds.map((id) => (
              <li key={id} className="flex items-center gap-1 rounded-lg bg-slate-50 py-1 pl-3 pr-1 text-sm text-navy">
                {nameOf(id)}
                <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label={`Tirar ${nameOf(id)}`} disabled={busy} onClick={() => remove(id)} />
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label="Adicionar membro ativo">
              <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
                <option value="">{available.length === 0 ? 'Ninguém mais disponível' : 'Escolha uma pessoa'}</option>
                {available.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button onClick={add} disabled={busy || !pick}>
            {busy ? 'Salvando...' : 'Adicionar'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
