import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseVideoUrl, videoProviderLabel } from '@/utils/video'

/**
 * Parser de vídeo (utils/video.ts) contra o CHECK `events_video_url_shape`
 * (0024). Duas cercas:
 *
 * 1) tudo que o parser aceita devolve uma `pageUrl` que o banco aceita — é a
 *    URL que o serviço grava depois de normalizar;
 * 2) o embed é montado a partir do id extraído, então nenhuma URL aceita
 *    consegue apontar o iframe para um host que não seja o do próprio serviço.
 *
 * Os casos recusatados reproduzem as tentativas do caso M11 da suíte SQL
 * (http, porta, userinfo, host alheio, javascript:, id curto, páginas do
 * Vimeo que não são vídeo).
 */

const CANONICAL_SHAPES = (() => {
  const sql = readFileSync(new URL('../../supabase/migrations/0024_event_video_url.sql', import.meta.url), 'utf8')
  const block = sql.slice(sql.indexOf('events_video_url_shape'))
  const patterns = [...block.matchAll(/~ '([^']+)'/g)].map((m) => m[1]!)
  if (patterns.length !== 3) throw new Error('as formas canônicas do CHECK mudaram — atualize a cerca')
  return patterns.map((p) => new RegExp(p))
})()

const YT_ID = 'dQw4w9WgXcQ'

describe('parseVideoUrl — o que é aceito', () => {
  it.each([
    ['watch clássico', `https://www.youtube.com/watch?v=${YT_ID}`],
    ['watch com parâmetros de sobra', `https://www.youtube.com/watch?v=${YT_ID}&t=42&list=PLx&si=abc`],
    ['watch no host sem www', `https://youtube.com/watch?v=${YT_ID}`],
    ['watch no mobile', `https://m.youtube.com/watch?v=${YT_ID}`],
    ['forma /embed/', `https://www.youtube.com/embed/${YT_ID}`],
    ['forma /shorts/', `https://www.youtube.com/shorts/${YT_ID}`],
    ['forma /live/', `https://www.youtube.com/live/${YT_ID}`],
    ['link curto', `https://youtu.be/${YT_ID}`],
    ['link curto com tracking', `https://youtu.be/${YT_ID}?si=xyz`],
  ])('YouTube — %s', (_rotulo, url) => {
    const link = parseVideoUrl(url)
    expect(link).not.toBeNull()
    expect(link!.provider).toBe('youtube')
    expect(link!.id).toBe(YT_ID)
    expect(link!.pageUrl).toBe(`https://www.youtube.com/watch?v=${YT_ID}`)
    expect(link!.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${YT_ID}`)
  })

  it.each([
    ['forma vimeo.com/<id>', 'https://vimeo.com/76979871'],
    ['forma www.vimeo.com', 'https://www.vimeo.com/76979871'],
    ['forma player /video/', 'https://player.vimeo.com/video/76979871'],
  ])('Vimeo — %s', (_rotulo, url) => {
    const link = parseVideoUrl(url)
    expect(link).not.toBeNull()
    expect(link!.provider).toBe('vimeo')
    expect(link!.id).toBe('76979871')
    expect(link!.pageUrl).toBe('https://vimeo.com/76979871')
    expect(link!.embedUrl).toBe('https://player.vimeo.com/video/76979871')
  })

  it('espaço em volta não muda nada (é o que o campo recebe de quem cola)', () => {
    expect(parseVideoUrl(`  https://youtu.be/${YT_ID}  `)?.pageUrl).toBe(`https://www.youtube.com/watch?v=${YT_ID}`)
  })

  it('os rótulos de serviço saem como a frase de validação espera', () => {
    expect(videoProviderLabel('youtube')).toBe('YouTube')
    expect(videoProviderLabel('vimeo')).toBe('Vimeo')
  })
})

describe('parseVideoUrl — o que é recusado (M11)', () => {
  it.each([
    ['em branco', ''],
    ['só espaço', '   '],
    ['texto solto', 'meu vídeo do youtube'],
    ['sem esquema', `youtube.com/watch?v=${YT_ID}`],
    ['sem TLS', `http://www.youtube.com/watch?v=${YT_ID}`],
    ['com porta', `https://www.youtube.com:8443/watch?v=${YT_ID}`],
    ['com userinfo', `https://pessoa:senha@www.youtube.com/watch?v=${YT_ID}`],
    ['host alheio', `https://evil.example.com/watch?v=${YT_ID}`],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['watch sem o parâmetro v', 'https://www.youtube.com/watch?list=PLx'],
    ['watch com v vazio', 'https://www.youtube.com/watch?v='],
    ['id do YouTube curto demais', `https://youtu.be/abc`],
    ['página de canal', `https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw`],
    ['embed sem id', 'https://www.youtube.com/embed/'],
    ['Vimeo com id não numérico', 'https://vimeo.com/abc'],
    ['Vimeo páginas que não são vídeo', 'https://vimeo.com/channels/staffpicks'],
    ['Vimeo groups', 'https://vimeo.com/groups/minimal'],
    ['player.vimeo fora da forma /video/', 'https://player.vimeo.com/76979871'],
  ])('%s', (_rotulo, url) => {
    expect(parseVideoUrl(url)).toBeNull()
  })
})

describe('cerca parser ↔ CHECK (0024)', () => {
  const aceitas = [
    `https://www.youtube.com/watch?v=${YT_ID}`,
    `https://m.youtube.com/watch?v=${YT_ID}&t=42`,
    `https://www.youtube.com/embed/${YT_ID}`,
    `https://www.youtube.com/shorts/d_-abc123XY`,
    `https://youtu.be/${YT_ID}`,
    'https://vimeo.com/76979871',
    'https://player.vimeo.com/video/76979871',
  ]

  it.each(aceitas)('a pageUrl de %s passa em alguma forma do CHECK', (url) => {
    const link = parseVideoUrl(url)
    expect(link, 'entrada aceita pelo parser').not.toBeNull()
    expect(CANONICAL_SHAPES.some((shape) => shape.test(link!.pageUrl))).toBe(true)
  })

  it.each(aceitas)('normalizar de novo não muda o valor (o banco recebe a forma final)', (url) => {
    const uma = parseVideoUrl(url)
    const duas = parseVideoUrl(uma!.pageUrl)
    expect(duas!.pageUrl).toBe(uma!.pageUrl)
  })

  it('as três formas do CHECK são todas parseáveis — o que o banco guarda o player conhece', () => {
    for (const exemplo of [
      `https://www.youtube.com/watch?v=${YT_ID}`,
      `https://youtu.be/${YT_ID}`,
      'https://vimeo.com/76979871',
    ]) {
      expect(CANONICAL_SHAPES.some((shape) => shape.test(exemplo))).toBe(true)
      expect(parseVideoUrl(exemplo), exemplo).not.toBeNull()
    }
  })

  it('o CHECK recusa as formas que só o parser traduz, e é por isso que o serviço normaliza', () => {
    // O M11 da suíte mostra o banco recusando /embed/; o app nunca envia ela.
    expect(CANONICAL_SHAPES.some((shape) => shape.test(`https://www.youtube.com/embed/${YT_ID}`))).toBe(false)
  })

  it('nenhuma URL aceita devolve embed fora do host do próprio serviço', () => {
    for (const url of aceitas) {
      const link = parseVideoUrl(url)!
      expect(
        link.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/') ||
          link.embedUrl.startsWith('https://player.vimeo.com/video/'),
        `${url} → ${link.embedUrl}`,
      ).toBe(true)
      // O id vai montado no caminho: sem espaço para @, ?, # ou / de quem colou.
      expect(link.embedUrl.slice(link.embedUrl.lastIndexOf('/') + 1)).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})
