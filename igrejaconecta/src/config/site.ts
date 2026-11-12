/**
 * Identidade canônica do site (Fase 9). Estes valores alimentam canonical, Open
 * Graph, sitemap, manifest e JSON-LD — tudo que crawler e scraper de rede lê e que,
 * por isso, exige URL **absoluta**.
 *
 * `siteUrl` vem de `VITE_SITE_URL` no build; sem ele, usa o endereço onde o site
 * está publicado (`igrejaconecta.vercel.app`). Canonical e OG precisam apontar
 * para o endereço que responde de verdade — um domínio que não existe ainda é
 * pior do que o subdomínio do Vercel. Se um dia houver domínio próprio, defina
 * `VITE_SITE_URL` no build **e** troque o mesmo endereço em `index.html`,
 * `public/robots.txt` e `public/sitemap.xml`: os testes de SEO exigem que os
 * quatro concordem. Sempre sem barra no fim.
 */
export const siteUrl: string = (
  (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://igrejaconecta.vercel.app'
).replace(/\/+$/, '')

export const siteName = 'IgrejaConecta'

export const siteTagline = 'Conectando igrejas e pessoas através de eventos'

export const siteDescription =
  'Plataforma que conecta igrejas e visitantes: gestão de eventos, inscrições, localização, divulgação digital e inteligência artificial. Sem cobrança.'

/** Cor da marca (navy do favicon) — theme-color do PWA e da barra do navegador. */
export const themeColor = '#15345b'

/** Fundo do splash e do ícone do PWA. */
export const backgroundColor = '#15345b'

export const locale = 'pt_BR'

/** Imagem padrão de compartilhamento (OG/Twitter), absoluta. */
export const defaultImage = `${siteUrl}/og-image.png`
