import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2, UploadCloud } from 'lucide-react'
import { MEDIA_ACCEPT, MEDIA_LABEL, MEDIA_MAX_BYTES, formatMegabytes, type MediaKind } from '@/services/data/mediaService'
import { Button } from './primitives'

/**
 * Seletor de imagem do Storage (M4). O componente **não envia nada**: ele escolhe
 * o arquivo, valida tipo e tamanho no aparelho e devolve o `File` para a página,
 * que decide quando enviar (o formulário de evento só envia no salvar, para não
 * deixar objeto público órfão de um rascunho abandonado).
 *
 * A pré-visualização é local (`URL.createObjectURL`) e some junto com a escolha —
 * o que a tela mostra como gravado é sempre a URL que o banco devolveu.
 */
interface MediaFieldProps {
  kind: MediaKind
  /** O que o banco tem. Null é estado normal: a igreja ainda não enviou. */
  currentUrl?: string | null
  /** O que foi escolhido agora e ainda não foi enviado. */
  pendingFile?: File | null
  busy?: boolean
  disabled?: boolean
  error?: string | null
  onPick: (file: File | null) => void
  /** Altura da pré-visualização. */
  className?: string
}

export function MediaField({
  kind,
  currentUrl,
  pendingFile,
  busy,
  disabled,
  error,
  onPick,
  className = 'h-40',
}: MediaFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingFile) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(pendingFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  const label = MEDIA_LABEL[kind].replace(/^A |^O /, '').toLowerCase()
  const shown = preview ?? currentUrl ?? null

  return (
    <div className="space-y-2">
      <div className={`relative overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
        {shown ? (
          <img
            src={shown}
            alt={`Pré-visualização d${kind === 'church-logo' ? 'o logotipo' : 'a capa'}`}
            className="h-full w-full object-cover"
            onError={() => setPreview(null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400">
            <ImagePlus className="h-6 w-6" />
            <span className="text-xs">Sem imagem: a tela mostra o fundo padrão.</span>
          </div>
        )}
        {pendingFile && (
          <span className="absolute bottom-2 left-2 rounded bg-navy/80 px-2 py-0.5 text-[11px] text-white">
            escolhida agora — ainda não enviada
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          className="hidden"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            event.target.value = ''
            setLocalError(null)
            onPick(file)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          icon={<UploadCloud className="h-4 w-4" />}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Enviando...' : 'Escolher imagem'}
        </Button>
        {(currentUrl || pendingFile) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || busy}
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => {
              setLocalError(null)
              onPick(null)
            }}
          >
            Remover
          </Button>
        )}
      </div>

      <p className="text-xs text-slate-400">
        jpeg, png ou webp · até {formatMegabytes(MEDIA_MAX_BYTES[kind])} · o arquivo é enviado para o Storage da sua
        igreja com nome gerado, nunca com o nome do seu aparelho.
      </p>
      {(localError || error) && (
        <p className="text-xs text-red-600">{localError ?? error}</p>
      )}
      {!localError && !error && pendingFile && (
        <p className="text-xs text-slate-500">
          {label} escolhida: o envio acontece quando você salvar — sem salvar, nada vai para o Storage.
        </p>
      )}
    </div>
  )
}
