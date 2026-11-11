import { FolderTree } from 'lucide-react'
import { PageHeader, EmptyState } from '@/components/common/primitives'

/**
 * Não existe tabela de organizações nesta versão — cada igreja é cadastrada por
 * conta própria. A página continua no menu, mas diz a verdade em vez de listar
 * redes fabricadas com contagens de igrejas e filiais que não existem.
 */
export function AdminOrganizationsPage() {
  return (
    <div>
      <PageHeader
        title="Redes de igrejas"
        subtitle="Gestão hierárquica: organização, região, igreja e filial, com relatórios consolidados."
      />
      <EmptyState
        icon={<FolderTree className="h-6 w-6" />}
        title="Redes de igrejas ainda não existem"
        description="Não há tabela de organizações nesta versão: cada igreja é cadastrada por conta própria. Agrupar igrejas em convenções e regiões exigiria uma migração nova, fora do escopo atual."
      />
    </div>
  )
}
