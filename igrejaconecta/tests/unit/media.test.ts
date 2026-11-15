import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEDIA_BUCKET,
  MEDIA_FORBIDDEN,
  MEDIA_MAX_BYTES,
  MEDIA_NAME_TAKEN,
  MEDIA_NO_CHURCH,
  MEDIA_UNCONFIRMED,
  bucketOfStorageUrl,
  extensionForMime,
  isOwnStorageImageUrl,
  mediaObjectPath,
  pathOfStorageUrl,
  publicStorageUrl,
  removeMedia,
  uploadMedia,
  validateImageFile,
} from '@/services/data/mediaService'
import { CHURCH_MEDIA_NOT_OURS, validateChurchMedia } from '@/services/data/churchProfileService'
import { EVENT_COVER_NOT_OURS, validateEventDraft } from '@/services/data/eventService'

/**
 * Mídia (M4). O que está em jogo aqui não é o upload em si — é a fronteira: só
 * jpeg/png/webp, só bucket público, só pasta da própria igreja e só URL que este
 * serviço produziu. Um `cover_url` de outro host faria o navegador de cada
 * visitante pedir imagem a um terceiro escolhido por quem cadastrou o evento.
 */

const ORIGIN = 'https://teste.supabase.co'
const CHURCH = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const OWN_URL = `${ORIGIN}/storage/v1/object/public/church-covers/${CHURCH}/${FILE_ID}.jpg`

const backend = vi.hoisted(() => ({
  supabase: null as { storage: { from: ReturnType<typeof vi.fn> } } | null,
  supabaseOrigin: 'https://teste.supabase.co',
}))
vi.mock('@/services/supabase/client', () => backend)

let uploadResult: { data: unknown; error: unknown }
let removeResult: { error: unknown }
const from = vi.fn()

beforeEach(() => {
  uploadResult = { data: null, error: null }
  removeResult = { error: null }
  from.mockImplementation((bucket: string) => ({
    bucket,
    upload: vi.fn(async () => uploadResult),
    remove: vi.fn(async () => removeResult),
  }))
  backend.supabase = { storage: { from } }
})

const file = (type: string, size = 1024) => ({ type, size })

describe('tipo e tamanho', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('%s vira .%s', (mime, ext) => {
    expect(extensionForMime(mime)).toBe(ext)
  })

  it.each([['image/svg+xml'], ['application/pdf'], ['image/gif'], ['']])('%s não entra', (mime) => {
    expect(extensionForMime(mime)).toBeNull()
    expect(validateImageFile(file(mime), 'church-logo')).toMatch(/jpeg, png ou webp/)
  })

  it('acima do teto é recusado antes de qualquer rede', () => {
    const over = validateImageFile(file('image/jpeg', MEDIA_MAX_BYTES['church-logo'] + 1), 'church-logo')
    expect(over).toMatch(/limite é 2 MB/)
    expect(from).not.toHaveBeenCalled()
  })

  it('logo tem teto menor que capa: os dois valores são os documentados', () => {
    expect(MEDIA_MAX_BYTES['church-logo']).toBe(2 * 1024 * 1024)
    expect(MEDIA_MAX_BYTES['event-cover']).toBe(5 * 1024 * 1024)
    expect(MEDIA_MAX_BYTES['church-cover']).toBe(5 * 1024 * 1024)
  })

  it('arquivo de 0 bytes é recusado', () => {
    expect(validateImageFile(file('image/png', 0), 'event-cover')).toMatch(/0 bytes/)
  })
})

describe('caminho e URL', () => {
  it('o caminho é pasta da igreja + nome gerado + extensão do MIME', () => {
    expect(mediaObjectPath(CHURCH, 'image/webp', FILE_ID)).toBe(`${CHURCH}/${FILE_ID}.webp`)
    expect(mediaObjectPath(CHURCH, 'image/svg+xml', FILE_ID)).toBeNull()
  })

  it('a URL pública é montada sobre a origem do próprio projeto', () => {
    expect(publicStorageUrl(ORIGIN, 'church-logos', `${CHURCH}/x.png`)).toBe(
      `${ORIGIN}/storage/v1/object/public/church-logos/${CHURCH}/x.png`,
    )
  })

  it('cada tipo cai num bucket público — nunca nos privados', () => {
    expect(Object.values(MEDIA_BUCKET).sort()).toEqual(['church-covers', 'church-covers', 'church-logos'])
    expect(Object.values(MEDIA_BUCKET)).not.toContain('church-documents')
    expect(Object.values(MEDIA_BUCKET)).not.toContain('church-gallery')
  })

  it.each([
    [OWN_URL, true],
    [`${ORIGIN}/storage/v1/object/public/church-logos/${CHURCH}/${FILE_ID}.png`, true],
    ['https://cdn.exemplo.com/capa.png', false],
    [`${ORIGIN}/storage/v1/object/public/church-documents/${CHURCH}/${FILE_ID}.jpg`, false],
    [`${ORIGIN}/storage/v1/object/public/church-covers/nao-e-uuid/${FILE_ID}.jpg`, false],
    [`${ORIGIN}/storage/v1/object/public/church-covers/${CHURCH}/foto.svg`, false],
    [`${ORIGIN}/storage/v1/object/public/church-covers/${CHURCH}/${FILE_ID}.jpg?token=abc`, false],
    ['', false],
    [null, false],
  ])('%s → %s', (url, esperado) => {
    expect(isOwnStorageImageUrl(url as string | null)).toBe(esperado)
  })

  it('bucket e caminho voltam da URL gravada', () => {
    expect(bucketOfStorageUrl(OWN_URL)).toBe('church-covers')
    expect(pathOfStorageUrl(OWN_URL, 'church-covers')).toBe(`${CHURCH}/${FILE_ID}.jpg`)
    expect(bucketOfStorageUrl('https://cdn.exemplo.com/capa.png')).toBeNull()
    expect(pathOfStorageUrl('https://cdn.exemplo.com/capa.png', 'church-covers')).toBeNull()
  })
})

describe('upload', () => {
  it('sem igreja na sessão não envia nada', async () => {
    const result = await uploadMedia(file('image/png'), 'church-logo', undefined)
    expect(result).toEqual({ ok: false, error: MEDIA_NO_CHURCH })
    expect(from).not.toHaveBeenCalled()
  })

  it('tipo recusado não chega ao provedor', async () => {
    const result = await uploadMedia(file('image/svg+xml'), 'church-logo', CHURCH)
    expect(result.ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('sucesso devolve a URL montada sobre o caminho que o provedor confirmou', async () => {
    uploadResult = { data: { path: `${CHURCH}/${FILE_ID}.jpg` }, error: null }
    const result = await uploadMedia(file('image/jpeg'), 'event-cover', CHURCH)
    expect(result).toEqual({ ok: true, bucket: 'church-covers', path: `${CHURCH}/${FILE_ID}.jpg`, url: OWN_URL })
    expect(from).toHaveBeenCalledWith('church-covers')
  })

  it('caminho confirmado fora da pasta da igreja não vale', async () => {
    uploadResult = { data: { path: `outra-igreja/${FILE_ID}.jpg` }, error: null }
    const result = await uploadMedia(file('image/jpeg'), 'event-cover', CHURCH)
    expect(result).toEqual({ ok: false, error: MEDIA_UNCONFIRMED })
  })

  it('sem caminho confirmado, nada foi gravado', async () => {
    uploadResult = { data: null, error: null }
    expect(await uploadMedia(file('image/jpeg'), 'event-cover', CHURCH)).toEqual({ ok: false, error: MEDIA_UNCONFIRMED })
  })

  it.each([
    [{ message: 'new row violates row-level security policy' }, MEDIA_FORBIDDEN],
    [{ message: 'The resource already exists' }, MEDIA_NAME_TAKEN],
    [{ message: 'Bucket not found' }, 'O bucket de imagens não existe neste projeto Supabase: rode a migração 0003.'],
    [{ message: 'The object exceeded the maximum allowed size' }, 'O provedor recusou o arquivo por tamanho. Envie uma imagem menor.'],
    [{ message: 'Failed to fetch' }, 'Failed to fetch'],
  ])('erro do provedor vira mensagem honesta: %o', async (error, esperado) => {
    uploadResult = { data: null, error }
    const result = await uploadMedia(file('image/jpeg'), 'event-cover', CHURCH)
    expect(result).toEqual({ ok: false, error: esperado })
  })

  it('remove devolve o que o provedor disse', async () => {
    expect(await removeMedia('church-covers', `${CHURCH}/x.jpg`)).toBe(true)
    removeResult = { error: { message: 'não achei' } }
    expect(await removeMedia('church-covers', `${CHURCH}/x.jpg`)).toBe(false)
    expect(await removeMedia('church-covers', null)).toBe(false)
  })
})

describe('as duas telas só aceitam URL nossa', () => {
  it('mídia da igreja', () => {
    expect(validateChurchMedia({ logo_url: null, cover_url: null })).toBeNull()
    expect(validateChurchMedia({ logo_url: OWN_URL, cover_url: null })).toBeNull()
    expect(validateChurchMedia({ logo_url: 'https://cdn.exemplo.com/logo.png', cover_url: null })).toBe(
      CHURCH_MEDIA_NOT_OURS,
    )
  })

  it('capa do evento', () => {
    const draft = {
      name: 'Culto de celebração',
      category_id: 'culto',
      starts_at: '2026-12-05T22:00:00.000Z',
      visibility: 'public' as const,
      cover_url: 'https://cdn.exemplo.com/capa.png',
    }
    expect(validateEventDraft(draft)).toBe(EVENT_COVER_NOT_OURS)
    expect(validateEventDraft({ ...draft, cover_url: OWN_URL })).toBeNull()
    expect(validateEventDraft({ ...draft, cover_url: null })).toBeNull()
  })
})
