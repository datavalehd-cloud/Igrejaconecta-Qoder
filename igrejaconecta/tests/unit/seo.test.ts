import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SITEMAP_PATHS,
  absoluteImage,
  buildMeta,
  eventToJsonLd,
  organizationJsonLd,
  pageTitle,
  resolveCanonical,
  websiteJsonLd,
} from '@/utils/seo'
import { defaultImage, siteName, siteTagline, siteUrl } from '@/config/site'
import type { PublicEvent } from '@/types'

/**
 * SEO/PWA (Fase 9). Duas frentes: (1) as funções puras de utils/seo.ts — canonical,
 * OG/Twitter, robots e o JSON-LD de Evento montado só com o que existe de verdade
 * (sem geo/capa/término quando não há; `offers` só para evento grátis, porque o app
 * não tem pagamento); (2) os arquivos estáticos que crawlers e o instalador de PWA
 * leem sem executar JS — index.html, robots, sitemap, manifest, sw.js — incluindo
 * anti-deriva: o manifest só pode referenciar ícones que existem e o SW nunca pode
 * cachear dado de terceiro nem rotas privadas.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const baseEvent: PublicEvent = {
  id: 'e1',
  slug: 'vigilia',
  name: 'Vigília',
  category_id: 'c1',
  church_id: 'ch1',
  starts_at: '2026-12-24T20:00:00.000Z',
  is_free: true,
  status: 'published',
}

describe('pageTitle', () => {
  it('home usa a tagline; internas ganham sufixo do site', () => {
    expect(pageTitle()).toBe(`${siteName} — ${siteTagline}`)
    expect(pageTitle('Eventos')).toBe(`Eventos · ${siteName}`)
  })
})

describe('resolveCanonical', () => {
  it('normaliza barras e devolve URL absoluta', () => {
    expect(resolveCanonical()).toBe(`${siteUrl}/`)
    expect(resolveCanonical('/')).toBe(`${siteUrl}/`)
    expect(resolveCanonical('/eventos/')).toBe(`${siteUrl}/eventos`)
    expect(resolveCanonical('eventos')).toBe(`${siteUrl}/eventos`)
  })
})

describe('absoluteImage', () => {
  it('sem imagem usa a padrão; absoluta passa; relativa vira absoluta', () => {
    expect(absoluteImage()).toBe(defaultImage)
    expect(absoluteImage('https://cdn.exemplo/x.png')).toBe('https://cdn.exemplo/x.png')
    expect(absoluteImage('/capa.png')).toBe(`${siteUrl}/capa.png`)
  })
})

describe('buildMeta', () => {
  it('robots respeita noindex e o canonical é absoluto', () => {
    const priv = buildMeta({ title: 'Entrar', path: '/login', noindex: true })
    expect(priv.tags.find((t) => t.key === 'robots')?.content).toBe('noindex, nofollow')
    expect(priv.canonical).toBe(`${siteUrl}/login`)

    const pub = buildMeta({ title: 'Eventos', path: '/eventos' })
    expect(pub.tags.find((t) => t.key === 'robots')?.content).toBe('index, follow')
    expect(pub.title).toBe(`Eventos · ${siteName}`)
  })

  it('emite OG e Twitter card completos com a imagem padrão', () => {
    const { tags } = buildMeta({ title: 'X' })
    const get = (key: string) => tags.find((t) => t.key === key)?.content
    expect(get('og:site_name')).toBe(siteName)
    expect(get('og:type')).toBe('website')
    expect(get('og:locale')).toBe('pt_BR')
    expect(get('og:image')).toBe(defaultImage)
    expect(get('twitter:card')).toBe('summary_large_image')
    expect(get('description')).toBeTruthy()
  })
})

describe('JSON-LD do site', () => {
  it('Organization e WebSite apontam para a URL canônica', () => {
    expect(organizationJsonLd()['@type']).toBe('Organization')
    expect(organizationJsonLd().url).toBe(siteUrl)
    expect(organizationJsonLd().logo).toBe(`${siteUrl}/icon-512.png`)
    expect(websiteJsonLd()['@type']).toBe('WebSite')
    expect(websiteJsonLd().inLanguage).toBe('pt-BR')
  })
})

describe('eventToJsonLd', () => {
  it('evento completo leva geo, capa, término e oferta grátis', () => {
    const full: PublicEvent = {
      ...baseEvent,
      description: 'Uma noite de oração.',
      ends_at: '2026-12-25T02:00:00.000Z',
      address: 'Rua A, 1',
      city: 'São Paulo',
      latitude: -23.5,
      longitude: -46.6,
      cover_url: 'https://cdn.exemplo/capa.png',
      church: { id: 'ch1', name: 'IBC', slug: 'ibc' },
    }
    const ld = eventToJsonLd(full)
    expect(ld['@type']).toBe('Event')
    expect(ld.name).toBe('Vigília')
    expect(ld.startDate).toBe(full.starts_at)
    expect(ld.endDate).toBe(full.ends_at)
    expect(ld.image).toBe(full.cover_url)
    expect(ld.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(ld.url).toBe(`${siteUrl}/eventos/vigilia`)

    const location = ld.location as Record<string, any>
    expect(location.name).toBe('IBC')
    expect(location.geo.latitude).toBe(-23.5)
    expect(location.address.addressLocality).toBe('São Paulo')
    expect(ld.organizer).toEqual({ '@type': 'Organization', name: 'IBC' })

    const offers = ld.offers as Record<string, any>
    expect(offers.price).toBe('0')
    expect(offers.priceCurrency).toBe('BRL')
  })

  it('sem geo/capa/término não inventa campos; cancelado é marcado; pago não ganha oferta', () => {
    const paid: PublicEvent = { ...baseEvent, is_free: false, status: 'cancelled' }
    const ld = eventToJsonLd(paid)
    expect(ld.offers).toBeUndefined()
    expect(ld.eventStatus).toBe('https://schema.org/EventCancelled')
    expect(ld.endDate).toBeUndefined()
    expect(ld.image).toBeUndefined()

    const location = ld.location as Record<string, any>
    expect(location.geo).toBeUndefined()
    // Sem igreja resolvida, o organizador cai no nome do site (não em vazio).
    expect(location.name).toBe(siteName)
  })

  it('church_name serve de organizador quando não há embed de igreja', () => {
    const ld = eventToJsonLd({ ...baseEvent, church_name: 'Comunidade Vida' })
    expect((ld.location as Record<string, any>).name).toBe('Comunidade Vida')
  })
})

describe('estáticos crawler-visible', () => {
  it('index.html traz OG, Twitter, canonical, theme-color, manifest e JSON-LD', () => {
    const html = read('index.html')
    for (const needle of [
      'rel="manifest"',
      'apple-touch-icon',
      'rel="canonical"',
      'name="theme-color"',
      'property="og:title"',
      'property="og:image"',
      'name="twitter:card"',
      'application/ld+json',
    ]) {
      expect(html, needle).toContain(needle)
    }
  })

  it('robots.txt libera tudo e aponta o sitemap', () => {
    const robots = read('public/robots.txt')
    expect(robots).toContain('Allow: /')
    expect(robots).toContain(`Sitemap: ${siteUrl}/sitemap.xml`)
  })

  it('sitemap.xml lista exatamente as rotas públicas fixas', () => {
    const sitemap = read('public/sitemap.xml')
    for (const path of SITEMAP_PATHS) {
      const url = path === '/' ? `${siteUrl}/` : `${siteUrl}${path}`
      expect(sitemap, path).toContain(`<loc>${url}</loc>`)
    }
  })

  it('manifest é pt-BR, standalone e só referencia ícones que existem', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest'))
    expect(manifest.lang).toBe('pt-BR')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toBe('#15345b')
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons as { src: string }[]) {
      expect(existsSync(join(ROOT, 'public', icon.src.replace(/^\//, ''))), icon.src).toBe(true)
    }
  })
})

describe('service worker (anti-deriva)', () => {
  it('cache versionado, terceiros só em rede e rotas privadas fora do cache', () => {
    const sw = read('public/sw.js')
    expect(sw).toMatch(/const CACHE = '[a-z-]+-v\d+'/)
    // Cross-origin (Supabase, mapa, fontes) retorna antes de qualquer cache.
    expect(sw).toContain('url.origin !== self.location.origin) return')
    // Rotas privadas nunca são servidas do cache; offline dão 503 honesto.
    expect(sw).toContain("'/app'")
    expect(sw).toContain("'/admin'")
    expect(sw).toContain('fetch(request).catch(() => offlineResponse())')
  })

  it('registro acontece só em produção', () => {
    const main = read('src/main.tsx')
    expect(main).toContain('import.meta.env.PROD')
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')")
  })
})
