/**
 * Distribuição sem chave (Fase 5). Nada aqui fala com Meta/TikTok/WhatsApp Cloud:
 * são os caminhos que existem sem OAuth, sem backend e sem segredo nenhum — link de
 * WhatsApp (wa.me), copiar link, Web Share nativo e UTM para marcar a origem. A
 * postagem real numa rede exigiria token e servidor; enquanto isso não existe, a
 * campanha fica em rascunho/agendada e o que se distribui é o link público do
 * evento. Tudo é honesto: se o navegador não tem clipboard nem Web Share, o
 * resultado diz isso em vez de fingir sucesso.
 */

export interface ShareData {
  title?: string
  text?: string
  url?: string
}

export type ShareResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error' }

/** URL absoluta a partir de um caminho do app, usando a origem atual. */
export function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${clean}`
}

function slugParam(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Acrescenta parâmetros UTM a um link, preservando os que já existem. `campaign` e
 * `content` são normalizados (sem espaço/acentos) para não sujar a análise. Se o
 * link não for uma URL parseável, devolve-o como veio — sem inventar origem.
 */
export function utmLink(
  url: string,
  params: { source?: string; medium?: string; campaign?: string; content?: string },
): string {
  try {
    const target = new URL(url)
    if (params.source) target.searchParams.set('utm_source', params.source)
    if (params.medium) target.searchParams.set('utm_medium', params.medium)
    if (params.campaign) target.searchParams.set('utm_campaign', slugParam(params.campaign))
    if (params.content) target.searchParams.set('utm_content', slugParam(params.content))
    return target.toString()
  } catch {
    return url
  }
}

/**
 * Link de compartilhamento do WhatsApp sem número de destino: abre o app com o texto
 * pronto e a pessoa escolhe para quem enviar. Diferente de `whatsappLink`
 * (format.ts), que mira um número específico da igreja.
 */
export function whatsappShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** O Web Share nativo está disponível neste navegador? */
export function canWebShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/**
 * Chama o Web Share nativo. Devolve o motivo exato quando não dá: 'unsupported'
 * (sem a API), 'cancelled' (a pessoa fechou) ou 'error'. Nunca finge sucesso.
 */
export async function webShare(data: ShareData): Promise<ShareResult> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return { ok: false, reason: 'unsupported' }
  }
  try {
    await navigator.share({ title: data.title, text: data.text, url: data.url })
    return { ok: true }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: 'error' }
  }
}

/**
 * Copia para a área de transferência. `true` só quando o navegador confirmou a
 * escrita; sem clipboard (contexto inseguro, permissão negada) devolve `false` e a
 * tela pede para copiar manualmente — sem fingir que copiou.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
