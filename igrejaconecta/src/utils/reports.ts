import type {
  ApprovalStatus,
  Campaign,
  Church,
  ChurchEvent,
  EventStatus,
  PlatformUser,
  RegistrationStats,
  RoleKey,
} from '@/types'
import { roleLabels } from '@/utils/rbac'

/**
 * Agregados do relatório global do SuperAdmin (Fase 8). Tudo aqui é derivado das
 * leituras que a RLS já devolve para `is_superadmin()` — nenhum número é chutado
 * e nenhuma consulta nova é feita. As funções são puras (não tocam em DOM nem em
 * banco) para dar prova por mutação: quebrar a contagem ou o CSV faz o teste falhar.
 */

export interface ReportRow {
  categoria: string
  item: string
  quantidade: number
}

export interface ReportSection {
  title: string
  rows: ReportRow[]
}

export interface ReportInput {
  churches: Church[]
  events: ChurchEvent[]
  campaigns: Campaign[]
  users: PlatformUser[]
  registrationStats: RegistrationStats[]
}

const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  published: 'Publicado',
  cancelled: 'Cancelado',
  finished: 'Encerrado',
}

const CAMPAIGN_STATUS_LABEL: Record<Campaign['status'], string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  published: 'Publicada',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}

const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending: 'Pendente',
  in_review: 'Em análise',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  suspended: 'Suspensa',
}

/** Uma linha por chave do enum, na ordem do mapa — mesmo quando a contagem é zero. */
function tally<K extends string>(
  categoria: string,
  keys: readonly K[],
  label: Record<K, string>,
  count: (key: K) => number,
): ReportRow[] {
  return keys.map((key) => ({ categoria, item: label[key], quantidade: count(key) }))
}

function registrationRows(stats: RegistrationStats[]): ReportRow[] {
  const categoria = 'Inscrições por status'
  const sum = (pick: (s: RegistrationStats) => number) => stats.reduce((total, s) => total + pick(s), 0)
  return [
    { categoria, item: 'Pendentes', quantidade: sum((s) => s.pending_count) },
    { categoria, item: 'Confirmadas', quantidade: sum((s) => s.confirmed_count) },
    { categoria, item: 'Lista de espera', quantidade: sum((s) => s.waitlist_count) },
    { categoria, item: 'Check-in realizado', quantidade: sum((s) => s.checked_in_count) },
    { categoria, item: 'Canceladas', quantidade: sum((s) => s.cancelled_count) },
  ]
}

/** Constrói todas as seções do relatório, na ordem em que aparecem na tela e no CSV. */
export function buildReportRows(input: ReportInput): ReportRow[] {
  const { churches, events, campaigns, users, registrationStats } = input
  return [
    ...tally(
      'Igrejas por aprovação',
      Object.keys(APPROVAL_LABEL) as ApprovalStatus[],
      APPROVAL_LABEL,
      (k) => churches.filter((c) => c.approval_status === k).length,
    ),
    ...tally(
      'Eventos por status',
      Object.keys(EVENT_STATUS_LABEL) as EventStatus[],
      EVENT_STATUS_LABEL,
      (k) => events.filter((e) => e.status === k).length,
    ),
    ...tally(
      'Campanhas por status',
      Object.keys(CAMPAIGN_STATUS_LABEL) as Campaign['status'][],
      CAMPAIGN_STATUS_LABEL,
      (k) => campaigns.filter((c) => c.status === k).length,
    ),
    ...tally(
      'Usuários por papel',
      Object.keys(roleLabels) as RoleKey[],
      roleLabels,
      (k) => users.filter((u) => u.role === k).length,
    ),
    ...registrationRows(registrationStats),
  ]
}

/** Agrupa linhas contíguas pela categoria (a ordem de `buildReportRows` já garante o bloco). */
export function groupReportRows(rows: ReportRow[]): ReportSection[] {
  const sections: ReportSection[] = []
  for (const row of rows) {
    const last = sections[sections.length - 1]
    if (last && last.title === row.categoria) last.rows.push(row)
    else sections.push({ title: row.categoria, rows: [row] })
  }
  return sections
}

/** CSV no padrão já usado em Inscrições: células entre aspas, separador `;`, CRLF. */
export function reportToCsv(rows: ReportRow[]): string {
  const header = ['Categoria', 'Item', 'Quantidade']
  const lines = rows.map((r) => [r.categoria, r.item, String(r.quantidade)])
  return [header, ...lines]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';'))
    .join('\r\n')
}

/** Dispara o download do CSV. Única função que toca em DOM — por isso fica isolada. */
export function downloadReportCsv(filename: string, rows: ReportRow[]): void {
  const csv = reportToCsv(rows)
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
