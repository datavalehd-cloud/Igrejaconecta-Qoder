import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  keyOf: (row: T) => string
  empty?: ReactNode
  onRowClick?: (row: T) => void
}

export function DataTable<T>({ columns, rows, keyOf, empty, onRowClick }: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface text-left">
            {columns.map((c) => (
              <th key={c.header} className={cn('px-4 py-3 font-semibold text-slate-600', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyOf(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-line last:border-0',
                onRowClick && 'cursor-pointer hover:bg-brand-50/40',
              )}
            >
              {columns.map((c) => (
                <td key={c.header} className={cn('px-4 py-3 text-slate-700', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
