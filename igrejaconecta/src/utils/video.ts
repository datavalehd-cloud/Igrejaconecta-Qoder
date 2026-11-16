/**
 * Vídeo promocional do evento (0024). Duas funções, um contrato: o que o
 * `parseVideoUrl` aceita é o que o CHECK `events_video_url_shape` guarda, e o
 * que ele devolve é sempre uma das formas canônicas do banco. O tocador da
 * página pública recebe `embedUrl` montado a partir do **id extraído**, nunca a
 * URL crua de quem colou — `https://youtu.be/ID@host-alheio/` vira o vídeo do
 * YouTube, não um redirecionamento.
 */

export type VideoProvider = 'youtube' | 'vimeo'

export interface VideoLink {
  provider: VideoProvider
  id: string
  /** Forma canônica: é a que vai para o banco (0024). */
  pageUrl: string
  /** YouTube usa `youtube-nocookie` para o embed não plantar cookie de rastreamento no visitante. */
  embedUrl: string
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'])
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,}$/
const VIMEO_ID = /^[0-9]+$/

export function parseVideoUrl(value: string): VideoLink | null {
  const raw = value.trim()
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.port !== '') return null
  if (url.username !== '' || url.password !== '') return null

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (YOUTUBE_HOSTS.has(host)) return youtubeLink(url, segments)
  if (host === 'youtu.be') return oneSegmentId(segments, YOUTUBE_ID, (id) => youtubeLinkOf(id))
  if (VIMEO_HOSTS.has(host)) return vimeoLink(host, segments)
  return null
}

function youtubeLink(url: URL, segments: string[]): VideoLink | null {
  if (segments.length === 1 && segments[0] === 'watch') {
    // /watch?v=ID: só o `v` interessa; `&t=`, `&list=` e companhia ficam para trás
    // na URL canônica que o parse devolve.
    const v = url.searchParams.get('v')
    return v !== null && YOUTUBE_ID.test(v) ? youtubeLinkOf(v) : null
  }
  if (segments.length === 2 && ['embed', 'shorts', 'live'].includes(segments[0]!)) {
    const id = segments[1]!
    return YOUTUBE_ID.test(id) ? youtubeLinkOf(id) : null
  }
  return null
}

function oneSegmentId(segments: string[], pattern: RegExp, build: (id: string) => VideoLink | null): VideoLink | null {
  const id = segments.length === 1 ? segments[0] : undefined
  return id && pattern.test(id) ? build(id) : null
}

function youtubeLinkOf(id: string): VideoLink {
  return {
    provider: 'youtube',
    id,
    pageUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
  }
}

function vimeoLink(host: string, segments: string[]): VideoLink | null {
  if (host === 'player.vimeo.com') {
    // /video/ID — caminho canônico do embed.
    if (segments.length !== 2 || segments[0] !== 'video') return null
    return segments[1] && VIMEO_ID.test(segments[1]) ? vimeoLinkOf(segments[1]) : null
  }
  // vimeo.com/ID — e nada além disso (/channels, /groups e /staff são páginas
  // que não são vídeo de evento nenhum).
  if (segments.length !== 1) return null
  const id = segments[0]!
  if (['channels', 'groups', 'staff', 'manage', 'search'].includes(id)) return null
  return VIMEO_ID.test(id) ? vimeoLinkOf(id) : null
}

function vimeoLinkOf(id: string): VideoLink {
  return {
    provider: 'vimeo',
    id,
    pageUrl: `https://vimeo.com/${id}`,
    embedUrl: `https://player.vimeo.com/video/${id}`,
  }
}

/** Rótulo humano do serviço, para a frase de validação e para o texto do player. */
export function videoProviderLabel(provider: VideoProvider): string {
  return provider === 'youtube' ? 'YouTube' : 'Vimeo'
}
