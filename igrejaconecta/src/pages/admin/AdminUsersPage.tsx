import { useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader, Input, Badge, EmptyState } from '@/components/common/primitives'
import { DataTable, type Column } from '@/components/common/DataTable'
import { usePlatformUsers } from '@/hooks/useAdmin'
import { roleLabels } from '@/utils/rbac'
import { initials } from '@/utils/format'
import type { PlatformUser } from '@/types'

const statusTone = { active: 'green', invited: 'amber', blocked: 'red' } as const
const statusLabel = { active: 'Ativo', invited: 'Convidado', blocked: 'Bloqueado' } as const

export function AdminUsersPage() {
  const { rows, loading, error } = usePlatformUsers()
  const [query, setQuery] = useState('')
  const filtered = rows.filter((u) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      u.name.toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q) ||
      (u.church_name ?? '').toLowerCase().includes(q)
    )
  })

  const columns: Column<PlatformUser>[] = [
    { header: 'Usuário', cell: (u) => <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{initials(u.name)}</span><div><p className="font-medium text-navy">{u.name}</p><p className="text-xs text-slate-500">{u.email ?? '—'}</p></div></div> },
    { header: 'Papel', cell: (u) => roleLabels[u.role] },
    { header: 'Igreja', cell: (u) => u.church_name ?? '—' },
    { header: 'Status', cell: (u) => <Badge tone={statusTone[u.status]}>{statusLabel[u.status]}</Badge> },
  ]

  return (
    <div>
      <PageHeader title="Gestão de usuários" subtitle="Diretório global de vínculos: quem pertence a cada igreja e com qual papel." />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <p className="mb-4 max-w-2xl rounded-lg border border-line bg-slate-50 px-4 py-3 text-xs text-slate-600">
        Somente leitura. Não existe bloqueio global de plataforma: bloquear, reativar ou
        mudar o papel de um membro é feito no cadastro de cada igreja, pelo painel da própria igreja.
      </p>

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" placeholder="Buscar por nome, e-mail ou igreja..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando usuários...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title={query ? 'Nenhum usuário encontrado' : 'Nenhum vínculo registrado'}
          description={query ? 'Ajuste a busca para encontrar usuários, e-mails ou igrejas.' : 'Assim que houver membros nas igrejas, eles aparecem aqui.'}
        />
      ) : (
        <DataTable columns={columns} rows={filtered} keyOf={(u) => `${u.user_id}:${u.church_id}`} />
      )}
    </div>
  )
}
