import { supabase, supabaseOrigin } from '@/services/supabase/client'
import { notePermissionDenied } from '@/services/data/securityService'

/**
 * Mídia institucional (M4): capa de evento, capa e logotipo de igreja.
 *
 * O que este serviço decide, e por quê (revisão de risco da rodada):
 *
 * 1) **Bucket público, URL pública.** `church-logos` e `church-covers` são
 *    públicos (0003) porque a capa aparece na página pública do evento e no
 *    `og:image`, que crawler e WhatsApp buscam sem token — URL assinada expira e
 *    a imagem quebra no compartilhamento. O que torna o endereço não-adivinhável
 *    é o caminho `<churchId>/<uuid>.<ext>`, não a assinatura.
 *
 * 2) **Bucket é escolha do código, nunca do usuário.** `church-documents` e
 *    `church-gallery` são privados e não recebem nada daqui: um arquivo no lugar
 *    errado é imagem institucional publicada por engano ou documento que some da
 *    tela.
 *
 * 3) **Só jpeg/png/webp.** SVG é script embutível e não traz ganho para logo.
 *
 * 4) **Nome gerado, extensão derivada do MIME.** O nome que o usuário deu no
 *    aparelho vazaria título ou telefone no caminho público, e colisão seria
 *    substituição silenciosa.
 *
 * 5) **Nada no banco sem o caminho que o provedor devolveu.** `upload()` só é
 *    sucesso com `data.path`; a URL gravada é montada a partir dele, e o prefixo
 *    é o do próprio projeto — assim `cover_url` nunca aponta para um terceiro
 *    (o que faria o navegador de cada visitante pedir imagem a um host escolhido
 *    por quem cadastrou o evento, vazando IP e user-agent).
 */

export type PublicBucket = 'church-logos' | 'church-covers'

export type MediaKind = 'event-cover' | 'church-cover' | 'church-logo'

export const MEDIA_BUCKET = {
  'event-cover': 'church-covers',
  'church-cover': 'church-covers',
  'church-logo': 'church-logos',
} as const satisfies Record<MediaKind, PublicBucket>

export const MEDIA_LABEL = {
  'event-cover': 'A capa do evento',
  'church-cover': 'A capa da igreja',
  'church-logo': 'O logotipo',
} as const satisfies Record<MediaKind, string>

/** Tetos medidos no `File`, antes de qualquer rede. O limite do plano fica no dashboard e não é consultável daqui. */
export const MEDIA_MAX_BYTES = {
  'event-cover': 5 * 1024 * 1024,
  'church-cover': 5 * 1024 * 1024,
  'church-logo': 2 * 1024 * 1024,
} as const satisfies Record<MediaKind, number>

export const MEDIA_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export const MEDIA_ACCEPT = Object.keys(MEDIA_EXTENSIONS).join(',')

export const MEDIA_NO_CHURCH =
  'A sua sessão não tem igreja ativa: a imagem é enviada para a pasta da sua igreja.'
export const MEDIA_UNCONFIRMED =
  'O Storage não confirmou o caminho do arquivo: nada foi gravado. Tente enviar de novo.'
export const MEDIA_FORBIDDEN =
  'O Storage recusou o envio: o seu vínculo com esta igreja não está ativo. Atualize a tela e tente de novo.'
export const MEDIA_BUCKET_MISSING =
  'O bucket de imagens não existe neste projeto Supabase: rode a migração 0003.'
export const MEDIA_TOO_LARGE_BY_PROVIDER =
  'O provedor recusou o arquivo por tamanho. Envie uma imagem menor.'
export const MEDIA_NAME_TAKEN = 'Já existe um arquivo com este nome no Storage. Tente enviar de novo.'

/** O que a validação precisa do arquivo — `File` no navegador, objeto simples no teste. */
export interface ImageCandidate {
  type: string
  size: number
}

export function extensionForMime(mime: string): string | null {
  return (MEDIA_EXTENSIONS as Readonly<Record<string, string>>)[mime.toLowerCase()] ?? null
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

export function validateImageFile(file: ImageCandidate, kind: MediaKind): string | null {
  const label = MEDIA_LABEL[kind]
  if (!extensionForMime(file.type)) {
    return `${label} precisa ser jpeg, png ou webp — o tipo enviado foi "${file.type || 'desconhecido'}". SVG não entra: é script embutível.`
  }
  const max = MEDIA_MAX_BYTES[kind]
  if (file.size > max) {
    return `${label} tem ${formatMegabytes(file.size)} e o limite é ${formatMegabytes(max)}.`
  }
  if (file.size <= 0) {
    return `${label} está vazia: o arquivo tem 0 bytes.`
  }
  return null
}

/** Caminho do objeto. `randomId` vem de fora no teste para a asserção não depender de sorteio. */
export function mediaObjectPath(churchId: string, mime: string, randomId: string): string | null {
  const extension = extensionForMime(mime)
  if (!extension) return null
  return `${churchId}/${randomId}.${extension}`
}

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

export function publicStorageUrl(origin: string, bucket: PublicBucket, path: string): string {
  return `${origin.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path}`
}

/**
 * Só vale URL que este serviço produz: bucket público deste projeto, pasta com o
 * uuid de uma igreja e arquivo com nome gerado. Qualquer outra coisa — inclusive
 * um `https://` válido de outro host — é recusada antes de chegar ao banco.
 */
export function isOwnStorageImageUrl(
  url: string | null | undefined,
  origin: string = supabaseOrigin,
): boolean {
  if (!url) return false
  const expected = new RegExp(
    `^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/+$/, '')}` +
      `/storage/v1/object/public/(?:${MEDIA_BUCKET['church-logo']}|${MEDIA_BUCKET['event-cover']})` +
      `/${UUID_PATTERN}/[^/]+\\.(?:jpg|png|webp)$`,
  )
  return expected.test(url)
}

export type MediaUploadResult =
  | { ok: true; bucket: PublicBucket; path: string; url: string; error?: never }
  | { ok: false; error: string; bucket?: never; path?: never; url?: never }

export async function uploadMedia(
  file: ImageCandidate & { name?: string },
  kind: MediaKind,
  churchId?: string,
): Promise<MediaUploadResult> {
  const invalid = validateImageFile(file, kind)
  if (invalid) return { ok: false, error: invalid }
  if (!churchId) return { ok: false, error: MEDIA_NO_CHURCH }

  const bucket = MEDIA_BUCKET[kind]
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const path = mediaObjectPath(churchId, file.type, randomId)
  if (!path) return { ok: false, error: validateImageFile(file, kind) ?? MEDIA_UNCONFIRMED }

  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    // Recusa da policy de upload é exatamente o sinal que a 0019 guarda.
    if (String(error.status ?? error.statusCode ?? '') === '42501' || /row-level security|violates/i.test(error.message ?? '')) {
      notePermissionDenied(`storage.upload:${bucket}`, churchId)
    }
    return { ok: false, error: describeStorageError(error) }
  }

  // Confirmação do provedor: o caminho que ele gravou, não o que pedimos.
  const confirmed = data?.path
  if (!confirmed || !confirmed.startsWith(`${churchId}/`)) {
    return { ok: false, error: MEDIA_UNCONFIRMED }
  }
  const url = publicStorageUrl(supabaseOrigin, bucket, confirmed)
  if (!isOwnStorageImageUrl(url)) return { ok: false, error: MEDIA_UNCONFIRMED }
  return { ok: true, bucket, path: confirmed, url }
}

/**
 * Remove o objeto que a tela substituiu. Falha aqui não desfaz nada do que já foi
 * gravado no banco — por isso devolve booleano e quem chama decide o aviso.
 */
export async function removeMedia(bucket: PublicBucket, path: string | null | undefined): Promise<boolean> {
  if (!path) return false
  const { error } = await supabase.storage.from(bucket).remove([path])
  return !error
}

/** Bucket de uma URL já gravada: serve para apagar o arquivo antigo na troca. */
export function bucketOfStorageUrl(url: string | null | undefined): PublicBucket | null {
  for (const bucket of [MEDIA_BUCKET['church-logo'], MEDIA_BUCKET['event-cover']] as PublicBucket[]) {
    if (url?.includes(`/storage/v1/object/public/${bucket}/`)) return bucket
  }
  return null
}

/** Caminho dentro do bucket, para o `remove()`. Null se a URL não é nossa. */
export function pathOfStorageUrl(url: string | null | undefined, bucket: PublicBucket): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const at = url?.indexOf(marker) ?? -1
  if (!url || at < 0) return null
  return decodeURIComponent(url.slice(at + marker.length))
}

function describeStorageError(error: { message?: string; status?: number; statusCode?: number | string }): string {
  const message = error.message ?? ''
  // `statusCode` vem como string no supabase-js: o 42501 da policy chega nesse formato.
  const status = error.status ?? Number(error.statusCode ?? 0)
  if (status === 413 || /maximum allowed size|too large|payload/i.test(message)) {
    return MEDIA_TOO_LARGE_BY_PROVIDER
  }
  if (/row-level security|row level security|violates/i.test(message) || status === 42501) {
    return MEDIA_FORBIDDEN
  }
  if (/already exists/i.test(message)) return MEDIA_NAME_TAKEN
  if (/bucket not found/i.test(message)) return MEDIA_BUCKET_MISSING
  return message || 'O Storage recusou o envio.'
}
