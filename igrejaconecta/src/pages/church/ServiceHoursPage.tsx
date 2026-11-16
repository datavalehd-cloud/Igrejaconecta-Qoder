import { useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Clock, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import {
  PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Select, EmptyState,
} from '@/components/common/primitives'
import { Notice } from '@/components/common/Notice'
import { DataTable, type Column } from '@/components/common/DataTable'
import { usePermissions } from '@/hooks/usePermissions'
import { useChurchBranches } from '@/hooks/useBranches'
import { useChurchServiceTimes } from '@/hooks/useServiceTimes'
import {
  createServiceTime,
  deleteServiceTime,
  formatStartsAt,
  updateServiceTime,
  validateServiceTimeDraft,
  weekdayLabel,
  WEEKDAY_LABELS,
  type ServiceTimeDraft,
} from '@/services/data/serviceTimeService'
import type { ChurchServiceTime } from '@/types'

/**
 * Horários dos cultos (0023). A tela era o último mock do painel: uma lista
 * semente e botões que não gravavam. Hoje cada linha vem do banco e cada ação
 * passa pelo serviço — que exige `church.manage` e devolve a resposta do banco,
 * nunca uma expectativa local. O que a própria tela promete ("aparecem no
 * perfil público e no mapa") é verdade: a política de leitura da 0023 dá os
 * horários das igrejas aprovadas e ativas ao `anon`, e o diretório/`/mapa`
 * os mostram.
 */

const EMPTY_DRAFT: ServiceTimeDraft = { branchId: null, weekday: 0, startsAt: '09:00', name: '' }

export function ServiceHoursPage() {
  const { role, churchId, can } = usePermissions()
  const { rows, loading, error, reload } = useChurchServiceTimes()
  const { rows: branches } = useChurchBranches()

  const canManage = can('church.manage')
  const actor = { churchId, role }
  const branchName = (id?: string | null) => branches.find((b) => b.id === id)?.name ?? null

  const [draft, setDraft] = useState<ServiceTimeDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [armed, setArmed] = useState<string | null>(null)

  const invalid = formOpen ? validateServiceTimeDraft(draft) : null

  function startAdd() {
    setDraft(EMPTY_DRAFT)
    setEditingId(null)
    setFormOpen(true)
    setNotice(null)
  }

  function startEdit(time: ChurchServiceTime) {
    setDraft({ branchId: time.branch_id ?? null, weekday: time.weekday, startsAt: formatStartsAt(time.starts_at), name: time.name })
    setEditingId(time.id)
    setFormOpen(true)
    setNotice(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || invalid) return
    setBusy(true)
    setNotice(null)
    const result = editingId
      ? await updateServiceTime(editingId, draft, actor)
      : await createServiceTime(draft, actor)
    setBusy(false)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setFormOpen(false)
    setEditingId(null)
    setNotice({ tone: 'ok', text: editingId ? 'Horário atualizado no banco.' : 'Horário cadastrado: ele já aparece no perfil público da igreja aprovada.' })
    reload()
  }

  async function remove(time: ChurchServiceTime) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await deleteServiceTime(time.id, actor)
    setBusy(false)
    setArmed(null)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error })
      return
    }
    setNotice({ tone: 'ok', text: 'Horário removido do banco.' })
    reload()
  }

  const columns: Column<ChurchServiceTime>[] = [
    { header: 'Dia', cell: (t) => <span className="font-medium text-navy">{weekdayLabel(t.weekday)}</span> },
    { header: 'Horário', cell: (t) => <span className="inline-flex items-center gap-1 text-slate-700"><Clock className="h-3.5 w-3.5 text-brand-600" />{formatStartsAt(t.starts_at)}</span> },
    { header: 'Culto', cell: (t) => t.name },
    { header: 'Filial', cell: (t) => <span className="text-slate-600">{branchName(t.branch_id) ?? '—'}</span> },
    ...(canManage
      ? [{
          header: '',
          className: 'text-right',
          cell: (t: ChurchServiceTime) => (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} aria-label={`Editar ${t.name}`} disabled={busy} onClick={() => startEdit(t)} />
              {armed === t.id ? (
                <>
                  <Button size="sm" variant="danger" title={`Confirmar: remover ${t.name}`} disabled={busy} onClick={() => remove(t)}>Confirmar</Button>
                  <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} aria-label="Cancelar exclusão" onClick={() => setArmed(null)} />
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="h-4 w-4 text-red-500" />}
                  aria-label={`Remover ${t.name}`}
                  title="Remover horário: desfaz um cadastro errado, pede confirmação"
                  disabled={busy}
                  onClick={() => setArmed(t.id)}
                />
              )}
            </div>
          ),
        } as Column<ChurchServiceTime>]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="Horários dos cultos"
        subtitle="Esses horários aparecem no perfil público e no mapa de igrejas."
        actions={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={startAdd}>Novo horário</Button> : undefined}
      />

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      {formOpen && canManage && (
        <Card className="mb-6">
          <CardHeader title={editingId ? 'Editar horário' : 'Novo horário'} subtitle="O que for salvo aqui vai para o banco e para a vitrine pública." />
          <CardBody>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <Field label="Dia da semana">
                <Select value={String(draft.weekday)} onChange={(e) => setDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}>
                  {WEEKDAY_LABELS.map((label, index) => <option key={label} value={String(index)}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Hora de início" hint="Formato 24h. O banco guarda como horário, não como texto.">
                <Input type="time" value={draft.startsAt} onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))} required />
              </Field>
              <Field label="Nome do culto" hint="De 2 a 80 caracteres — é o que o visitante lê.">
                <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Ex.: Culto da Família" required />
              </Field>
              <Field label="Filial" hint="Opcional. A filial precisa ser da sua igreja — o banco recusa outra.">
                <Select value={draft.branchId ?? ''} onChange={(e) => setDraft((d) => ({ ...d, branchId: e.target.value || null }))}>
                  <option value="">Sem filial vinculada</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Button type="submit" icon={<Check className="h-4 w-4" />} disabled={busy || Boolean(invalid)}>
                  {busy ? 'Salvando...' : editingId ? 'Salvar' : 'Cadastrar'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setFormOpen(false); setEditingId(null) }} disabled={busy}>Cancelar</Button>
                {invalid && <span className="text-xs text-red-600">{invalid}</span>}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {!canManage && (
        <p className="mb-4 text-sm text-slate-500">
          Você pode ver os horários desta igreja; cadastrar e editar é papel do administrador da igreja ou do SuperAdmin.
        </p>
      )}

      {error ? (
        <Card className="border-red-200">
          <CardBody className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
            <p className="text-xs text-slate-500">Sem a resposta do banco a lista fica vazia de propósito: horário inventado não vai para o perfil público.</p>
            <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Recarregar</Button>
          </CardBody>
        </Card>
      ) : loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando os horários da igreja...
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-8 w-8" />}
          title="Nenhum horário cadastrado"
          description={canManage
            ? 'Cadastre o primeiro pelo botão acima: ele passa a aparecer no perfil público e no mapa da igreja.'
            : 'Esta igreja ainda não cadastrou horários de culto.'}
        />
      ) : (
        <DataTable columns={columns} rows={rows} keyOf={(t) => t.id} />
      )}
    </div>
  )
}
