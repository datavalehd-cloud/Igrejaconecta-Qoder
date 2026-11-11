import { X } from 'lucide-react'

/** Aviso de resultado de escrita: o que o banco respondeu, com um jeito de sair do caminho. */
export function Notice({ tone, text, onClose }: { tone: 'ok' | 'error'; text: string; onClose: () => void }) {
  return (
    <div
      className={
        tone === 'ok'
          ? 'mb-4 flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          : 'mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'
      }
    >
      <span>{text}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso" className="text-slate-400 hover:text-slate-600">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
