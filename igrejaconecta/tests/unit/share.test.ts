import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  absoluteUrl,
  canWebShare,
  copyToClipboard,
  utmLink,
  webShare,
  whatsappShareLink,
} from '@/utils/share'

/**
 * Distribuição sem chave (Fase 5). Os testes rodam em node (sem jsdom), então
 * `window`/`navigator` são stubados. O que importa é a honestidade: sem clipboard
 * ou sem Web Share, o resultado diz que não deu — nunca finge sucesso. E o UTM
 * normaliza a origem sem inventar nada quando o link não é parseável.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('absoluteUrl', () => {
  it('usa a origem atual e garante a barra inicial', () => {
    vi.stubGlobal('window', { location: { origin: 'https://exemplo.com' } })
    expect(absoluteUrl('/eventos/abc')).toBe('https://exemplo.com/eventos/abc')
    expect(absoluteUrl('eventos/abc')).toBe('https://exemplo.com/eventos/abc')
  })

  it('sem window (SSR/node) devolve o caminho como veio', () => {
    vi.stubGlobal('window', undefined)
    expect(absoluteUrl('/eventos/abc')).toBe('/eventos/abc')
  })
})

describe('utmLink', () => {
  it('acrescenta os parâmetros UTM', () => {
    const link = utmLink('https://exemplo.com/eventos/abc', {
      source: 'igrejaconecta', medium: 'social', campaign: 'congresso', content: 'instagram',
    })
    const url = new URL(link)
    expect(url.searchParams.get('utm_source')).toBe('igrejaconecta')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('congresso')
    expect(url.searchParams.get('utm_content')).toBe('instagram')
  })

  it('normaliza campaign/content: sem espaço nem acento', () => {
    const url = new URL(utmLink('https://exemplo.com/e', { campaign: 'Divulgação Congresso', content: 'Stories / Feed' }))
    expect(url.searchParams.get('utm_campaign')).toBe('divulgacao-congresso')
    expect(url.searchParams.get('utm_content')).toBe('stories-feed')
  })

  it('preserva parâmetros que já existem no link', () => {
    const url = new URL(utmLink('https://exemplo.com/e?ref=boletim', { source: 'igrejaconecta' }))
    expect(url.searchParams.get('ref')).toBe('boletim')
    expect(url.searchParams.get('utm_source')).toBe('igrejaconecta')
  })

  it('só acrescenta os campos informados', () => {
    const url = new URL(utmLink('https://exemplo.com/e', { source: 'igrejaconecta' }))
    expect(url.searchParams.has('utm_medium')).toBe(false)
    expect(url.searchParams.has('utm_campaign')).toBe(false)
  })

  it('link não parseável volta como veio: sem inventar origem', () => {
    expect(utmLink('não é url', { source: 'igrejaconecta' })).toBe('não é url')
  })
})

describe('whatsappShareLink', () => {
  it('abre o WhatsApp sem número de destino, com o texto codificado', () => {
    const link = whatsappShareLink('Participe do evento & inscreva-se')
    expect(link).toBe('https://wa.me/?text=Participe%20do%20evento%20%26%20inscreva-se')
  })
})

describe('canWebShare', () => {
  it('true só quando o navegador tem navigator.share', () => {
    vi.stubGlobal('navigator', { share: () => {} })
    expect(canWebShare()).toBe(true)
    vi.stubGlobal('navigator', {})
    expect(canWebShare()).toBe(false)
  })
})

describe('webShare', () => {
  it('devolve ok quando o compartilhamento nativo confirma', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    expect(await webShare({ title: 'Evento', text: 'texto', url: 'https://exemplo.com' })).toEqual({ ok: true })
    expect(share).toHaveBeenCalledWith({ title: 'Evento', text: 'texto', url: 'https://exemplo.com' })
  })

  it('sem a API devolve unsupported (não finge sucesso)', async () => {
    vi.stubGlobal('navigator', {})
    expect(await webShare({ url: 'https://exemplo.com' })).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('pessoa fechou o diálogo → cancelled', async () => {
    const abort = new Error('fechado')
    abort.name = 'AbortError'
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(abort) })
    expect(await webShare({ url: 'https://exemplo.com' })).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('outra falha → error', async () => {
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await webShare({ url: 'https://exemplo.com' })).toEqual({ ok: false, reason: 'error' })
  })
})

describe('copyToClipboard', () => {
  it('true só quando o navegador confirma a escrita', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyToClipboard('https://exemplo.com')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://exemplo.com')
  })

  it('sem clipboard devolve false (a tela pede cópia manual)', async () => {
    vi.stubGlobal('navigator', {})
    expect(await copyToClipboard('https://exemplo.com')).toBe(false)
  })

  it('clipboard que lança (permissão negada) devolve false', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) } })
    expect(await copyToClipboard('https://exemplo.com')).toBe(false)
  })
})
