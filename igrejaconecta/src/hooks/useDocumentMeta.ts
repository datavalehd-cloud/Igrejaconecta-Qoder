import { useEffect } from 'react'
import { buildMeta, type MetaInput } from '@/utils/seo'

/**
 * Aplica no <head> o meta resolvido por utils/seo.ts (title, canonical, robots,
 * OG, Twitter e JSON-LD por rota). Faz **upsert** pelos seletores naturais
 * (meta[name=...], meta[property=...], link[rel=canonical]) — assim as tags
 * estáticas do index.html são atualizadas no lugar, nunca duplicadas.
 *
 * O JSON-LD por rota (ex.: schema.org/Event no detalhe) é marcado com data-seo e
 * removido no unmount; os JSON-LD estáticos de Organization/WebSite do index.html
 * não carregam a marca e por isso permanecem em todas as páginas.
 *
 * Limite honesto: num SPA puro isso é lido pelo Google (que executa JS) e define o
 * título da aba, mas scrapers de rede (Facebook/LinkedIn/X) só veem o HTML inicial
 * do index.html — OG por página exigiria prerender/SSR, que não existe aqui.
 */
const MARK = 'data-seo'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    el.setAttribute(MARK, '')
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    el.setAttribute(MARK, '')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function setJsonLd(obj: Record<string, unknown> | undefined) {
  document.head
    .querySelectorAll(`script[type="application/ld+json"][${MARK}]`)
    .forEach((node) => node.remove())
  if (!obj) return
  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.setAttribute(MARK, '')
  script.textContent = JSON.stringify(obj)
  document.head.appendChild(script)
}

export function useDocumentMeta(input: MetaInput = {}) {
  // Serializa para o effect só rerodar quando a entrada muda de fato.
  const key = JSON.stringify(input)
  useEffect(() => {
    const meta = buildMeta(JSON.parse(key) as MetaInput)
    document.title = meta.title
    upsertCanonical(meta.canonical)
    for (const tag of meta.tags) upsertMeta(tag.attr, tag.key, tag.content)
    setJsonLd(meta.jsonLd)
    return () => setJsonLd(undefined)
  }, [key])
}
