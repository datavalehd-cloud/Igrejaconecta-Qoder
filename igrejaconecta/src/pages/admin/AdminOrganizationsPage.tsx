import { useCallback, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, FolderTree, Loader2, Pencil, Plus, RefreshCw, Save, Users, X } from 'lucide-react'
import {
  PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Textarea, Select, Badge, EmptyState,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { DataTable, type Column } from '@/components/common/DataTable'
import { usePermissions } from '@/hooks/usePermissions'
import { useKeyedList } from '@/hooks/useKeyedList'
import { useNetworks, useNetworkChurches } from '@/hooks/useNetworks'
import { fetchSelectorChurches, type SelectorChurch } from '@/services/data/churchService'
import {
  addChurchToNetwork,
  createNetwork,
  deleteNetwork,
  networkSlugCandidates,
  removeChurchFromNetwork,
  updateNetwork,
  validateNetworkDraft,
  type NetworkActor,
  type NetworkDraft,
} from '@/services/data/networkService'
import type { ChurchNetwork } from '@/types'

/**
 * Redes de igrejas — `/admin/organizacoes` existia na mesa desde a 0017 e a
 * tela dizia "ainda não existem". Agora a tela é a interface daquelas tabelas:
 * rede agrupa igrejas, e só o SuperAdmin associa (decisão 1 — a mesma régua de
 * `church.approve`; a suíte SQL mede os dois lados no grupo S).
 *
 * O que a tela NÃO promete: "região" e "relatórios consolidados" do subtítulo
 * antigo não existem — a 0017 tem um nível (rede → igreja) e nenhum relatório
 * agregado por rede. O endereço (`slug`) nasce do nome uma vez e não se edita;
 * apagar a rede desfaz os vínculos mas deixa cada igreja inteira no ar
 * (cascata sobre o vínculo, não sobre a igreja — decisão 5).
 */

const EMPTY_DRAFT: NetworkDraft = { name: '', description: '' }

export function AdminOrganizationsPage() {
  const { role } = usePermissions()
  const actor = { role }

  const { rows: networks, loading, error, reload } = useNetworks()
  const { rows: churches, loading: churchesLoading, error: churchesError, reload: reloadChurches } = useSelector()

  const [draft, setDraft] = useState<NetworkDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [managingId, setManagingId] = useState<string | null>(null)

  const invalid = formOpen ? validateNetworkDraft(draft) : null

  function startAdd() {
    setDraft(EMPTY_DRAFT)
    setEditingId(null)
    setFormOpen(true)
    setNotice(null)
  }

  function startEdit(network: ChurchNetwork) {
    setDraft({ name: network.name, description: network.description ?? '' })
    setEditingId(network.id)
    setFormOpen(true)
    setNotice(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || invalid) return
    setBusy(true)
    setNotice(null)
    const result = editingId ? await updateNetwork(editingId, draft, actor) : await createNetwork(draft, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setFormOpen(false)
    setEditingId(null)
    setNotice({
      tone: 'ok',
      text: editingId
        ? `Rede atualizada no banco (endereço ${result.network.slug} mantido).`
        : `Rede criada: endereço /${result.network.slug} gerado do nome.`,
    })
    reload()
  }

  async function remove(network: ChurchNetwork) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await deleteNetwork(network.id, actor)
    setBusy(false)
    setArmed(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    if (managingId === network.id) setManagingId(null)
    setNotice({ tone: 'ok', text: `Rede "${network.name}" removida: os vínculos caíram com ela, as igrejas continuam no ar.` })
    reload()
  }

  const columns: Column<ChurchNetwork>[] = [
    {
      header: 'Rede',
      cell: (n) => (
        <div>
          <span className="font-medium text-navy">{n.name}</span>
          {n.description && <p className="text-xs text-slate-500">{n.description}</p>}
        </div>
      ),
    },
    { header: 'Endereço', cell: (n) => <span className="font-mono text-xs text-slate-600">/{n.slug}</span> },
    { header: 'Igrejas', cell: (n) => <Badge tone={n.churches_count > 0 ? 'green' : 'neutral'}>{n.churches_count}</Badge> },
    {
      header: '',
      className: 'text-right',
      cell: (n) => (
        <div className="flex justify-end gap-1">
          <Button
            variant={managingId === n.id ? 'primary' : 'ghost'}
            size="sm"
            icon={<Users className="h-4 w-4" />}
            aria-label={`Gerir igrejas de ${n.name}`}
            title="Igrejas desta rede: associar e desfazer"
            disabled={busy}
            onClick={() => setManagingId(managingId === n.id ? null : n.id)}
          />
          <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} aria-label={`Editar ${n.name}`} disabled={busy} onClick={() => startEdit(n)} />
          {armed === n.id ? (
            <>
              <Button size="sm" variant="danger" title={`Confirmar: remover a rede ${n.name}`} disabled={busy} onClick={() => remove(n)}>Confirmar</Button>
              <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Cancelar exclusão" onClick={() => setArmed(null)} />
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<X className="h-4 w-4 text-red-500" />}
              aria-label={`Remover rede ${n.name}`}
              title="Remover rede: desfaz os vínculos, nunca apaga igrejas; pede confirmação"
              disabled={busy}
              onClick={() => setArmed(n.id)}
            />
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Redes de igrejas"
        subtitle="Uma rede agrupa igrejas; quem associa e desassocia é o SuperAdmin."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={startAdd}>Nova rede</Button>}
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      {formOpen && (
        <Card className="mb-6">
          <CardHeader
            title={editingId ? 'Editar rede' : 'Nova rede'}
            subtitle={editingId ? 'O endereço (slug) não muda: ele nasce do nome na criação.' : 'O endereço público é gerado do nome, com sufixo se precisar.'}
          />
          <CardBody>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Nome da rede" hint="De 2 a 80 caracteres — é o que a plataforma lê na lista.">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ex.: Convenção Vida" required />
              </Field>
              <Field label="Descrição" hint="Opcional.">
                <Textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} disabled={busy || Boolean(invalid)}>
                  {busy ? 'Salvando...' : editingId ? 'Salvar' : 'Criar'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setFormOpen(false); setEditingId(null) }} disabled={busy}>Cancelar</Button>
                {invalid && <span className="text-xs text-red-600">{invalid}</span>}
                {!invalid && !editingId && draft.name.trim().length >= 2 && networkSlugCandidates(draft.name)[0] && (
                  <span className="text-xs text-slate-500">Endereço previsto: /{networkSlugCandidates(draft.name)[0]}</span>
                )}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {error ? (
        <Card className="border-red-200 mb-6">
          <CardBody className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
            <p className="text-xs text-slate-500">Sem a resposta do banco a lista fica vazia de propósito: rede inventada não vira vínculo real.</p>
            <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Recarregar</Button>
          </CardBody>
        </Card>
      ) : loading ? (
        <p className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando as redes de igrejas...
        </p>
      ) : networks.length === 0 ? (
        <EmptyState
          icon={<FolderTree className="h-8 w-8" />}
          title="Nenhuma rede cadastrada"
          description="Crie a primeira pelo botão acima: depois associe igrejas pelo botão de pessoas em cada linha."
        />
      ) : (
        <DataTable columns={columns} rows={networks} keyOf={(n) => n.id} />
      )}

      {managingId && (
        <ManageNetworkCard
          network={networks.find((n) => n.id === managingId) ?? null}
          actor={actor}
          churches={churches}
          churchesLoading={churchesLoading}
          churchesError={churchesError}
          reloadChurches={reloadChurches}
          busy={busy}
          setBusy={setBusy}
          onNotice={setNotice}
          onNetworksChanged={reload}
        />
      )}

      <p className="mt-6 text-sm text-slate-500">
        A 0017 tem um nível só — rede e igreja. Não existe "região" entre eles nem relatório
        consolidado por rede: o que esta tela oferece é o agrupamento e a contagem que o banco mede.
      </p>
    </div>
  )
}

function useSelector() {
  const fetcher = useCallback(() => fetchSelectorChurches(), [])
  return useKeyedList(true, 'network-church-picker', fetcher, 'Não foi possível carregar a lista de igrejas.')
}

function ManageNetworkCard({
  network, actor, churches, churchesLoading, churchesError, reloadChurches, busy, setBusy, onNotice, onNetworksChanged,
}: {
  network: ChurchNetwork | null
  actor: NetworkActor
  churches: SelectorChurch[]
  churchesLoading: boolean
  churchesError: string | null
  reloadChurches: () => void
  busy: boolean
  setBusy: (value: boolean) => void
  onNotice: (value: { tone: 'ok' | 'error'; text: string }) => void
  onNetworksChanged: () => void
}) {
  const { rows: members, loading: membersLoading, error: membersError, reload: reloadMembers } = useNetworkChurches(network?.id ?? null)
  const [pick, setPick] = useState('')

  if (!network) return null

  const memberIds = new Set(members.map((m) => m.church_id))
  const available = churches.filter((c) => !memberIds.has(c.id))

  async function add() {
    if (!pick || busy) return
    setBusy(true)
    const result = await addChurchToNetwork(network!.id, pick, actor)
    setBusy(false)
    if (!result.ok) {
      onNotice({ tone: 'error', text: result.error })
      return
    }
    setPick('')
    onNotice({ tone: 'ok', text: 'Igreja associada — a contagem da rede veio do banco.' })
    reloadMembers()
    reloadChurches()
    onNetworksChanged()
  }

  async function removeMember(churchId: string, churchName: string) {
    if (busy) return
    setBusy(true)
    const result = await removeChurchFromNetwork(network!.id, churchId, actor)
    setBusy(false)
    if (!result.ok) {
      onNotice({ tone: 'error', text: result.error })
      return
    }
    onNotice({ tone: 'ok', text: `Vínculo de "${churchName}" desfeito: a igreja continua no ar, só saiu da rede.` })
    reloadMembers()
    reloadChurches()
    onNetworksChanged()
  }

  return (
    <Card className="mb-6">
      <CardHeader title={`Igrejas de "${network.name}"`} subtitle="Associação é decisão de plataforma: nenhum papel de igreja mexe aqui (grupo S da suíte mede isso)." />
      <CardBody className="space-y-4">
        {membersError ? (
          <p className="flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{membersError}</span>
          </p>
        ) : membersLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Consultando os vínculos...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma igreja nesta rede ainda.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const name = m.churches?.name ?? m.church_id
              return (
                <span key={m.church_id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">
                  {name}
                  <button type="button" aria-label={`Desassociar ${name}`} title="Desfazer o vínculo (não apaga a igreja)" disabled={busy} onClick={() => removeMember(m.church_id, name)} className="text-red-500 hover:text-red-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Adicionar igreja">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || churchesLoading || Boolean(churchesError)}>
              <option value="">{churchesLoading ? 'carregando...' : churchesError ? 'lista de igrejas falhou' : 'Escolha uma igreja'}</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.approval_status === 'approved' ? '' : ' (pendente)'}</option>
              ))}
            </Select>
          </Field>
          <Button icon={<Check className="h-4 w-4" />} onClick={add} disabled={busy || !pick || available.length === 0}>Associar</Button>
        </div>
        {churchesError && (
          <p className="text-xs text-red-600">
            {churchesError} <button type="button" className="underline" onClick={reloadChurches}>tentar de novo</button>
          </p>
        )}
      </CardBody>
    </Card>
  )
}
