import { cn } from '@/utils/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-xl bg-navy text-white',
        'h-9 w-9 shrink-0',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <path d="M12 3v14M7 8h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="19.5" r="2.2" fill="#16A36A" />
      </svg>
    </span>
  )
}

interface LogoProps {
  className?: string
  variant?: 'light' | 'dark'
  compact?: boolean
}

export function Logo({ className, variant = 'dark', compact = false }: LogoProps) {
  const textColor = variant === 'light' ? 'text-white' : 'text-navy'
  return (
    <span className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <LogoMark />
      {!compact && (
        <span className={cn('text-lg font-extrabold tracking-tight leading-none', textColor)}>
          Igreja<span className="text-green">Conecta</span>
        </span>
      )}
    </span>
  )
}
