import {
  LayoutDashboard, Church, Network, Users, Mail, UsersRound, Clock, CalendarDays,
  CalendarRange, Ticket, ScanLine, Megaphone, Share2, Sparkles, Workflow, Building2,
  FolderTree, Plug, FileText, ShieldCheck, BarChart3, LifeBuoy, Settings, type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const churchNav: NavGroup[] = [
  {
    title: 'Geral',
    items: [
      { label: 'Visão geral', to: '/app', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Igreja',
    items: [
      { label: 'Perfil institucional', to: '/app/igreja', icon: Church },
      { label: 'Filiais', to: '/app/filiais', icon: Network },
      { label: 'Usuários', to: '/app/usuarios', icon: Users },
      { label: 'Convites', to: '/app/convites', icon: Mail },
      { label: 'Ministérios & equipes', to: '/app/ministerios', icon: UsersRound },
      { label: 'Horários dos cultos', to: '/app/horarios', icon: Clock },
    ],
  },
  {
    title: 'Eventos',
    items: [
      { label: 'Eventos', to: '/app/eventos', icon: CalendarDays },
      { label: 'Calendário', to: '/app/calendario', icon: CalendarRange },
      { label: 'Inscrições', to: '/app/inscricoes', icon: Ticket },
      { label: 'Check-in', to: '/app/checkin', icon: ScanLine },
    ],
  },
  {
    title: 'Divulgação',
    items: [
      { label: 'Campanhas', to: '/app/marketing', icon: Megaphone },
      { label: 'Redes sociais', to: '/app/redes', icon: Share2 },
      { label: 'IgrejaConecta AI', to: '/app/ia', icon: Sparkles },
      { label: 'Automações', to: '/app/automacoes', icon: Workflow },
    ],
  },
]

export const adminNav: NavGroup[] = [
  {
    title: 'Plataforma',
    items: [
      { label: 'Dashboard', to: '/admin', icon: LayoutDashboard },
      { label: 'Igrejas', to: '/admin/igrejas', icon: Building2 },
      { label: 'Usuários', to: '/admin/usuarios', icon: Users },
      { label: 'Organizações', to: '/admin/organizacoes', icon: FolderTree },
    ],
  },
  {
    title: 'Operação',
    items: [
      { label: 'Integrações', to: '/admin/integracoes', icon: Plug },
      { label: 'Logs do sistema', to: '/admin/logs', icon: FileText },
      { label: 'Auditoria', to: '/admin/auditoria', icon: ShieldCheck },
      { label: 'Relatórios', to: '/admin/relatorios', icon: BarChart3 },
    ],
  },
  {
    title: 'Administração',
    items: [
      { label: 'Suporte', to: '/admin/suporte', icon: LifeBuoy },
      { label: 'Configurações', to: '/admin/configuracoes', icon: Settings },
    ],
  },
]
