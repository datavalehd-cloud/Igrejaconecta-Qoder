/**
 * Identidade canônica do site (Fase 9). Estes valores alimentam canonical, Open
 * Graph, sitemap, manifest e JSON-LD — tudo que crawler e scraper de rede lê e que,
 * por isso, exige URL **absoluta**.
 *
 * `siteUrl` vem de `VITE_SITE_URL` no build; sem ele, usa o domínio de produção
 * pretendido (`igrejaconecta.app`, o mesmo que já aparece nos e-mails e nas
 * configurações do painel). **Nada está publicado ainda**: até existir um domínio
 * real, canonical e OG apontam para esse default — sobrescreva com `VITE_SITE_URL`
 * ao publicar. Sempre sem barra no fim.
 */
export const siteUrl: string = (
  (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://igrejaconecta.app'
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
