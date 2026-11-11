import { Plus, UsersRound, Crown, Users } from 'lucide-react'
import { PageHeader, Button, Card, CardBody, Badge } from '@/components/common/primitives'
import { ministries } from '@/data/mock'
import { useAuth } from '@/contexts/AuthContext'

const typeLabel = { ministry: 'Ministério', department: 'Departamento', team: 'Equipe' } as const
const typeTone = { ministry: 'brand', department: 'navy', team: 'green' } as const

export function MinistriesPage() {
  const { session } = useAuth()
  const rows = ministries.filter((m) => m.church_id === (session?.churchId ?? 'ch1'))

  return (
    <div>
      <PageHeader
        title="Ministérios & equipes"
        subtitle="Organize ministérios, departamentos, equipes, líderes e participantes."
        actions={<Button icon={<Plus className="h-4 w-4" />}>Novo ministério</Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((m) => (
          <Card key={m.id}>
            <CardBody>
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><UsersRound className="h-5 w-5" /></span>
                <Badge tone={typeTone[m.type]}>{typeLabel[m.type]}</Badge>
              </div>
              <h3 className="mt-3 font-semibold text-navy">{m.name}</h3>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500"><Crown className="h-3.5 w-3.5" />{m.leader ?? 'Sem líder'}</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500"><Users className="h-3.5 w-3.5" />{m.members_count} participantes</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
