import type { PublicEvent } from '@/types'
import {
  siteUrl,
  siteName,
  siteTagline,
  siteDescription,
  locale,
  defaultImage,
} from '@/config/site'

/**
 * SEO do lado do cliente (Fase 9). Tudo aqui é **puro** — nenhuma função toca em
 * `document`; quem aplica no DOM é o hook `useDocumentMeta`. Assim a lógica é
 * testável no ambiente node (sem jsdom) e a prova por mutação quebra um campo e vê
 * o teste falhar.
 *
 * Limite honesto: num SPA puro, o que os scrapers de rede (Facebook/LinkedIn/X) e
 * alguns crawlers veem é o **HTML inicial** — `index.html` e os arquivos em
 * `public/`. As tags definidas por rota via JS são lidas pelo Google (que executa
 * JS) e valem para o título na aba e para a UX, mas **não** alimentam o cartão de
 * rede por página; isso exigiria prerender/SSR, que não existe aqui. O OG por
 * página fica documentado como limite, nunca fingido como se funcionasse.
 */

export interface MetaInput {
  /** Título específico da página (sem sufixo). Omitido = home. */
  title?: string
  description?: string
  /** Caminho da rota, ex.: '/eventos/vigilia'. Vira canonical absoluto. */
  path?: string
  /** Imagem de compartilhamento; absoluta ou caminho (vira absoluta). Default: og-image. */
  image?: string
  type?: 'website' | 'article'
  /** Páginas privadas (login, painéis) não devem ser indexadas. */
  noindex?: boolean
  /** JSON-LD já serializável (Evento, Organização...) injetado como <script>. */
  jsonLd?: Record<string, unknown>
}

export interface MetaTag {
  /** 'name' para meta comuns; 'property' para Open Graph. */
  attr: 'name' | 'property'
  key: string
  content: string
}

export interface ResolvedMeta {
  title: string
  description: string
  canonical: string
  noindex: boolean
  tags: MetaTag[]
  jsonLd?: Record<string, unknown>
}

/**
 * Rotas públicas fixas que entram no `sitemap.xml` estático. URLs de evento e de
 * igreja (`/eventos/:slug`) são dinâmicas — só um gerador no build ou no servidor,
 * com o banco real, poderia listá-las; por isso não estão aqui (ver README).
 */
export const SITEMAP_PATHS = ['/', '/eventos', '/igrejas', '/mapa', '/categorias', '/buscar'] as const

/** Título completo da aba: sufixo do site nas páginas internas, tagline na home. */
export function pageTitle(title?: string): string {
  return title ? `${title} · ${siteName}` : `${siteName} — ${siteTagline}`
}

/** URL absoluta do caminho, sem barra dupla e sem trailing slash (exceto na raiz). */
export function resolveCanonical(path = '/', base = siteUrl): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  const noTrail = clean.length > 1 ? clean.replace(/\/+$/, '') : '/'
  return `${base}${noTrail}`
}

/** Torna absoluta uma imagem que veio como caminho; sem imagem, usa a padrão. */
export function absoluteImage(image?: string, base = siteUrl): string {
  const src = image ?? defaultImage
  if (/^https?:\/\//.test(src)) return src
  return `${base}${src.startsWith('/') ? '' : '/'}${src}`
}

/** Monta o conjunto de tags <meta> de uma página a partir da entrada declarativa. */
export function buildMeta(input: MetaInput = {}): ResolvedMeta {
  const title = pageTitle(input.title)
  const description = input.description ?? siteDescription
  const canonical = resolveCanonical(input.path ?? '/')
  const image = absoluteImage(input.image)
  const noindex = input.noindex === true

  const tags: MetaTag[] = [
    { attr: 'name', key: 'description', content: description },
    { attr: 'property', key: 'og:site_name', content: siteName },
    { attr: 'property', key: 'og:title', content: title },
    { attr: 'property', key: 'og:description', content: description },
    { attr: 'property', key: 'og:type', content: input.type ?? 'website' },
    { attr: 'property', key: 'og:url', content: canonical },
    { attr: 'property', key: 'og:locale', content: locale },
    { attr: 'property', key: 'og:image', content: image },
    { attr: 'name', key: 'twitter:card', content: 'summary_large_image' },
    { attr: 'name', key: 'twitter:title', content: title },
    { attr: 'name', key: 'twitter:description', content: description },
    { attr: 'name', key: 'twitter:image', content: image },
    { attr: 'name', key: 'robots', content: noindex ? 'noindex, nofollow' : 'index, follow' },
  ]

  return { title, description, canonical, noindex, tags, jsonLd: input.jsonLd }
}

/** JSON-LD schema.org/Organization do site (estático, no index.html). */
export function organizationJsonLd(base = siteUrl): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteName,
    url: base,
    logo: `${base}/icon-512.png`,
    description: siteDescription,
  }
}

/** JSON-LD schema.org/WebSite do site (estático, no index.html). */
export function websiteJsonLd(base = siteUrl): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: base,
    description: siteDescription,
    inLanguage: 'pt-BR',
  }
}

/**
 * JSON-LD schema.org/Event a partir do evento **público real** — não de texto
 * inventado. Só entra o que existe: `endDate` quando há término, `image` quando há
 * capa, `geo` quando há coordenada real. `offers` aparece **só quando é grátis**
 * (preço 0): o app não tem pagamento, então não se inventa preço para evento pago.
 * Um evento cancelado é marcado como `EventCancelled`, não escondido.
 */
export function eventToJsonLd(event: PublicEvent, base = siteUrl): Record<string, unknown> {
  const url = resolveCanonical(`/eventos/${event.slug}`, base)
  const organizerName = event.church?.name ?? event.church_name ?? siteName

  const address: Record<string, unknown> = { '@type': 'PostalAddress', addressCountry: 'BR' }
  if (event.address) address.streetAddress = event.address
  if (event.city) address.addressLocality = event.city

  const location: Record<string, unknown> = { '@type': 'Place', name: organizerName, address }
  if (event.latitude != null && event.longitude != null) {
    location.geo = {
      '@type': 'GeoCoordinates',
      latitude: event.latitude,
      longitude: event.longitude,
    }
  }

  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    startDate: event.starts_at,
    eventStatus:
      event.status === 'cancelled'
        ? 'https://schema.org/EventCancelled'
        : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location,
    organizer: { '@type': 'Organization', name: organizerName },
    url,
  }
  if (event.description) json.description = event.description
  if (event.ends_at) json.endDate = event.ends_at
  if (event.cover_url) json.image = event.cover_url
  if (event.is_free) {
    json.offers = {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'BRL',
      availability: 'https://schema.org/InStock',
      url,
    }
  }
  return json
}
