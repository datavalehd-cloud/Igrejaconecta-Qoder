/**
 * `2026-11-01` é uma data sem fuso. `new Date` lê esse formato como UTC, e em
 * UTC-3 ela vira o dia anterior na tela — o carimbo que o banco devolve tem hora
 * e fuso, então o ajuste vale só para a data seca.
 */
function toDate(iso: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
}

export function formatDate(iso: string): string {
  const d = toDate(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  const d = toDate(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Inscritos. `undefined` quer dizer "não há fonte confirmada" — a contagem ainda
 * está carregando ou o evento não veio na view — e a tela mostra "—" em vez de
 * zero, porque zero afirmaria que ninguém se inscreveu.
 */
export function formatRegistrations(count: number | undefined, capacity?: number | null): string {
  if (count === undefined) return '—'
  return capacity ? `${count} / ${capacity}` : `${count}`
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Ida e volta do campo `datetime-local`, que não tem fuso: o banco guarda
 * `timestamptz` (UTC), o campo quer a hora do relógio de quem edita. Sem a
 * conversão, um evento às 19h30 de Brasília seria gravado e devolvido como
 * 16h30 — o mesmo deslocamento que `toDate` resolve na leitura.
 */
export function toDateTimeInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO com fuso (UTC) a partir do valor do campo. Null quando o campo está vazio. */
export function fromDateTimeInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function whatsappLink(number: string, message?: string): string {
  const digits = number.replace(/\D/g, '')
  const text = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${digits}${text}`
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}
