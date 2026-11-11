import { LifeBuoy } from 'lucide-react'
import { PageHeader, EmptyState } from '@/components/common/primitives'

/**
 * Não existe tabela de chamados nesta versão. A página continua no menu, mas diz
 * a verdade em vez de listar tickets de mock com um formulário que não envia nada.
 */
export function AdminSupportPage() {
  return (
    <div>
      <PageHeader title="Suporte" subtitle="Central de chamados dos usuários da plataforma." />
      <EmptyState
        icon={<LifeBuoy className="h-6 w-6" />}
        title="Suporte ainda não existe"
        description="Não há tabela de chamados nesta versão, então não há tickets para listar nem formulário que envie de verdade. Uma central de suporte exigiria uma migração nova e um canal de atendimento, fora do escopo atual."
      />
    </div>
  )
}
