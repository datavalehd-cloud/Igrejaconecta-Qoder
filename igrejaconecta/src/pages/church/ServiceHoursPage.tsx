import { Plus, Clock, Pencil, Trash2 } from 'lucide-react'
import { PageHeader, Button, Badge } from '@/components/common/primitives'
import { DataTable, type Column } from '@/components/common/DataTable'

interface ServiceHour { id: string; day: string; time: string; name: string; branch: string }

const seed: ServiceHour[] = [
  { id: 'h1', day: 'Domingo', time: '09:00', name: 'Culto da Família', branch: 'Sede — Centro' },
  { id: 'h2', day: 'Domingo', time: '18:30', name: 'Culto de Celebração', branch: 'Sede — Centro' },
  { id: 'h3', day: 'Quarta', time: '20:00', name: 'Culto de Oração', branch: 'Congregação Zona Sul' },
  { id: 'h4', day: 'Sexta', time: '19:30', name: 'Encontro de Jovens', branch: 'Sede — Centro' },
]

export function ServiceHoursPage() {
  const columns: Column<ServiceHour>[] = [
    { header: 'Dia', cell: (h) => <Badge tone="navy">{h.day}</Badge> },
    { header: 'Horário', cell: (h) => <span className="inline-flex items-center gap-1 font-medium text-navy"><Clock className="h-3.5 w-3.5 text-brand-600" />{h.time}</span> },
    { header: 'Culto', cell: (h) => h.name },
    { header: 'Filial', cell: (h) => <span className="text-slate-600">{h.branch}</span> },
    {
      header: '',
      className: 'text-right',
      cell: () => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} aria-label="Editar" />
          <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4 text-red-500" />} aria-label="Excluir" />
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Horários dos cultos"
        subtitle="Esses horários aparecem no perfil público e no mapa de igrejas."
        actions={<Button icon={<Plus className="h-4 w-4" />}>Novo horário</Button>}
      />
      <DataTable columns={columns} rows={seed} keyOf={(h) => h.id} />
    </div>
  )
}
