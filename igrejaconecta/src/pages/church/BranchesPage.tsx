import { useState } from 'react'
import { Network, Pencil, Plus, Trash2, X } from 'lucide-react'
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
import { DataTable, type Column } from '@/components/common/DataTable'
import { CoordsField } from '@/components/common/CoordsField'
import { Notice } from '@/components/common/Notice'
import { useChurchBranches } from '@/hooks/useBranches'
import { usePermissions } from '@/hooks/usePermissions'
import { createBranch, deleteBranch, updateBranch, type BranchDraft } from '@/services/data/branchService'
import type { ChurchBranch } from '@/types'

/**
 * Filiais (Fase 4). A leitura vem de `church_branches` pela política
 * `church_branches_read` (membro ativo da própria igreja); a escrita passa por
 * `church.manage` e pelo WITH CHECK da 0013. Excluir é a mesma régua (0025):
 * `church.manage`, confirmação em dois passos, e o aviso de que nada mais é
 * apagado junto — eventos e horários viram "sem filial" pelo `on delete
 * set null` das FKs (0013/0023), medido nos casos O11/O12 da suíte.
 */

type Editing = { mode: 'create' } | { mode: 'edit'; branch: ChurchBranch }

function parseCoord(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

export function BranchesPage() {
  const { churchId, role, can } = usePermissions()
  const { rows, loading, error, reload } = useChurchBranches()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canManage = can('church.manage')

  async function remove(branch: ChurchBranch) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await deleteBranch(branch.id, { churchId, role })
    setBusy(false)
    setArmed(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    if (editing?.mode === 'edit' && editing.branch.id === branch.id) setEditing(null)
    setNotice({ tone: 'ok', text: `Filial "${branch.name}" removida: nenhum evento ou horário foi apagado junto — eles ficaram "sem filial".` })
    reload()
  }

  if (!churchId) {
    return (
      <div>
        <PageHeader title="Filiais" subtitle="Congregações e pontos de encontro da sua igreja." />
        <EmptyState
          icon={<Network className="h-6 w-6" />}
          title="A sua sessão não tem igreja ativa"
          description="Filial pertence a uma igreja. Entre com a conta de quem é membro para ver e cadastrar as filiais dela."
        />
      </div>
    )
  }

  const columns: Column<ChurchBranch>[] = [
    { header: 'Filial', cell: (b) => <span className="font-medium text-navy">{b.name}</span> },
    {
      header: 'Endereço',
      cell: (b) => (
        <span className="text-slate-600">
          {[b.address, b.city && b.state ? `${b.city}/${b.state}` : b.city].filter(Boolean).join(' — ') || '—'}
        </span>
      ),
    },
    {
      header: 'Coordenadas',
      cell: (b) =>
        b.lat != null && b.lng != null ? (
          <span className="font-mono text-xs text-slate-500">{b.lat.toFixed(4)}, {b.lng.toFixed(4)}</span>
        ) : (
          <span className="text-xs text-slate-400">sem coordenada</span>
        ),
    },
    { header: 'Responsável', cell: (b) => b.leader ?? '—' },
    ...(canManage
      ? [{
          header: 'Ações',
          className: 'text-right',
          cell: (b: ChurchBranch) => (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon={<Pencil className="h-4 w-4" />}
                aria-label={`Editar ${b.name}`}
                disabled={busy}
                onClick={() => { setNotice(null); setEditing({ mode: 'edit', branch: b }) }}
              />
              {armed === b.id ? (
                <>
                  <Button size="sm" variant="danger" title={`Confirmar: excluir a filial ${b.name}`} disabled={busy} onClick={() => remove(b)}>Confirmar</Button>
                  <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Cancelar exclusão" onClick={() => setArmed(null)} />
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="h-4 w-4 text-red-500" />}
                  aria-label={`Excluir filial ${b.name}`}
                  title="Excluir filial: não apaga eventos nem horários; pede confirmação"
                  disabled={busy}
                  onClick={() => setArmed(b.id)}
                />
              )}
            </div>
          ),
        } as Column<ChurchBranch>]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="Filiais"
        subtitle="Congregações, endereços, responsáveis e coordenadas."
        actions={
          canManage ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setNotice(null); setEditing({ mode: 'create' }) }}>
              Nova filial
            </Button>
          ) : undefined
        }
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      {editing && (
        <BranchForm
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); setNotice({ tone: 'ok', text }); reload() }}
          onError={(text) => setNotice({ tone: 'error', text })}
        />
      )}

      {error ? (
        <Notice tone="error" text={error} onClose={() => reload()} />
      ) : loading ? (
        <EmptyState icon={<Network className="h-8 w-8" />} title="Carregando..." description="Buscando as filiais da sua igreja." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Network className="h-8 w-8" />}
          title="Nenhuma filial"
          description="Cadastre congregações e pontos de encontro da sua igreja."
          action={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ mode: 'create' })}>Nova filial</Button> : undefined}
        />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} keyOf={(b) => b.id} />
          <Card className="mt-4">
            <CardBody className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <Badge tone="navy">Isolamento</Badge>
              Filiais só são visíveis para membros ativos da própria igreja.
              <span className="text-slate-400">
                Excluir filial não apaga evento nenhum: eventos e horários que apontavam para ela ficam
                "sem filial" (é o `set null` das FKs no banco, casos O11/O12 da suíte).
              </span>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

interface BranchFormState {
  name: string
  address: string
  city: string
  state: string
  leader: string
  lat: string
  lng: string
}

function toFormState(branch?: ChurchBranch): BranchFormState {
  return {
    name: branch?.name ?? '',
    address: branch?.address ?? '',
    city: branch?.city ?? '',
    state: branch?.state ?? '',
    leader: branch?.leader ?? '',
    lat: branch?.lat != null ? String(branch.lat) : '',
    lng: branch?.lng != null ? String(branch.lng) : '',
  }
}

function BranchForm({
  editing,
  onCancel,
  onSaved,
  onError,
}: {
  editing: Editing
  onCancel: () => void
  onSaved: (text: string) => void
  onError: (text: string) => void
}) {
  const { churchId, role } = usePermissions()
  const branch = editing.mode === 'edit' ? editing.branch : undefined
  const [form, setForm] = useState(() => toFormState(branch))
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof BranchFormState>(key: K, value: BranchFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const draft: BranchDraft = {
    name: form.name,
    address: form.address,
    city: form.city,
    state: form.state,
    leader: form.leader,
    lat: parseCoord(form.lat),
    lng: parseCoord(form.lng),
  }

  async function submit() {
    setBusy(true)
    const result = branch
      ? await updateBranch(branch.id, draft, { churchId, role })
      : await createBranch(draft, { churchId, role })
    setBusy(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onSaved(branch ? 'Filial atualizada.' : 'Filial cadastrada.')
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={branch ? `Editar filial — ${branch.name}` : 'Nova filial'}
        subtitle="A igreja da filial é a da sua sessão; não dá para movê-la para outra igreja."
        action={
          <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Fechar formulário" onClick={onCancel} />
        }
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Congregação Zona Sul" required />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Endereço">
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Rua, número, bairro" />
          </Field>
        </div>
        <Field label="Cidade">
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="São José dos Campos" />
        </Field>
        <Field label="UF" hint="Duas letras.">
          <Input value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="SP" maxLength={2} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Responsável">
            <Input value={form.leader} onChange={(e) => set('leader', e.target.value)} placeholder="Ex.: Pb. Ana Souza" />
          </Field>
        </div>
        <CoordsField lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))} />
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Salvando...' : branch ? 'Salvar alterações' : 'Cadastrar filial'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
