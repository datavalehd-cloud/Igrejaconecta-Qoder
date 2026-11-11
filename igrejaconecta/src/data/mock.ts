import type {
  AIGeneration,
  AuditLog,
  Campaign,
  Church,
  ChurchBranch,
  ChurchEvent,
  ChurchMember,
  EventCategory,
  Ministry,
  Profile,
  Registration,
  SocialAccount,
} from '@/types'

export const categories: EventCategory[] = [
  { id: 'c1', name: 'Cultos especiais', slug: 'cultos-especiais' },
  { id: 'c2', name: 'Congressos', slug: 'congressos' },
  { id: 'c3', name: 'Conferências', slug: 'conferencias' },
  { id: 'c4', name: 'Cruzadas', slug: 'cruzadas' },
  { id: 'c5', name: 'Encontros de jovens', slug: 'jovens' },
  { id: 'c6', name: 'Eventos de mulheres', slug: 'mulheres' },
  { id: 'c7', name: 'Eventos de homens', slug: 'homens' },
  { id: 'c8', name: 'Vigílias', slug: 'vigilias' },
  { id: 'c9', name: 'Escola bíblica', slug: 'escola-biblica' },
  { id: 'c10', name: 'Shows gospel', slug: 'shows-gospel' },
  { id: 'c11', name: 'Ações sociais', slug: 'acoes-sociais' },
  { id: 'c12', name: 'Eventos infantis', slug: 'infantis' },
  { id: 'c13', name: 'Encontros de casais', slug: 'casais' },
  { id: 'c14', name: 'Campanhas solidárias', slug: 'campanhas-solidarias' },
  { id: 'c15', name: 'Outros', slug: 'outros' },
]

export const churches: Church[] = [
  {
    id: 'ch1',
    name: 'Igreja Batista Central',
    slug: 'igreja-batista-central',
    description: 'Comunidade cristã no centro de São José dos Campos, com forte atuação social.',
    denomination: 'Batista',
    email: 'contato@ibcentral.org.br',
    phone: '(12) 3333-1000',
    whatsapp: '5512999990001',
    website: 'https://ibcentral.org.br',
    address: 'Rua das Palmeiras, 120 — Centro',
    city: 'São José dos Campos',
    state: 'SP',
    zip: '12210-000',
    lat: -23.1857,
    lng: -45.8871,
    status: 'active',
    approval_status: 'approved',
    created_at: '2026-01-10',
    updated_at: '2026-09-02',
  },
  {
    id: 'ch2',
    name: 'Comunidade Vida Nova',
    slug: 'comunidade-vida-nova',
    description: 'Igreja contemporânea focada em jovens e famílias.',
    denomination: 'Neopentecostal',
    email: 'contato@vidanova.com',
    phone: '(12) 3333-2000',
    whatsapp: '5512999990002',
    address: 'Av. Heitor Villa-Lobos, 900 — Jd. Aquarius',
    city: 'São José dos Campos',
    state: 'SP',
    zip: '12246-000',
    lat: -23.2099,
    lng: -45.9061,
    status: 'active',
    approval_status: 'approved',
    created_at: '2026-02-01',
    updated_at: '2026-08-21',
  },
  {
    id: 'ch3',
    name: 'Assembleia de Deus Esperança',
    slug: 'ad-esperanca',
    description: 'Congregação tradicional com ministérios de ensino e missões.',
    denomination: 'Assembleia de Deus',
    email: 'contato@adesperanca.org',
    phone: '(12) 3333-3000',
    address: 'Rua Bahia, 45 — Vila Industrial',
    city: 'Taubaté',
    state: 'SP',
    zip: '12050-000',
    lat: -23.0263,
    lng: -45.5565,
    status: 'active',
    approval_status: 'pending',
    created_at: '2026-10-28',
    updated_at: '2026-10-28',
  },
  {
    id: 'ch4',
    name: 'Igreja do Evangelho Quadrangular Monte Sião',
    slug: 'monte-siao',
    description: 'Rede de igrejas com várias filiais na região do Vale do Paraíba.',
    denomination: 'Quadrangular',
    email: 'contato@montesiao.org',
    phone: '(12) 3333-4000',
    address: 'Rua das Acácias, 77 — Bosque',
    city: 'Jacareí',
    state: 'SP',
    zip: '12300-000',
    lat: -23.3035,
    lng: -45.9668,
    status: 'inactive',
    approval_status: 'in_review',
    created_at: '2026-10-30',
    updated_at: '2026-11-01',
  },
]

// Coordenadas reais de São José dos Campos. A Zona Sul fica sem lat/lng de
// propósito: é o estado honesto de filial que ninguém marcou no mapa, e a tela
// tem de mostrar "sem coordenada" em vez de inventar posição (caso O9 da suíte
// prova que NULL é aceito no banco).
export const branches: ChurchBranch[] = [
  { id: 'b1', church_id: 'ch1', name: 'Sede — Centro', city: 'São José dos Campos', state: 'SP', address: 'Rua das Palmeiras, 120', lat: -23.1857, lng: -45.8871, leader: 'Pr. Marcos Lima' },
  { id: 'b2', church_id: 'ch1', name: 'Congregação Zona Sul', city: 'São José dos Campos', state: 'SP', address: 'Av. dos Evangélicos, 12', leader: 'Pb. Ana Souza' },
  { id: 'b3', church_id: 'ch2', name: 'Campus Aquarius', city: 'São José dos Campos', state: 'SP', address: 'Av. Heitor Villa-Lobos, 900', lat: -23.2099, lng: -45.9061, leader: 'Pr. Tiago Reis' },
]

export const ministries: Ministry[] = [
  { id: 'm1', church_id: 'ch1', name: 'Ministério de Louvor', type: 'ministry', leader: 'Juliana Prado', members_count: 14 },
  { id: 'm2', church_id: 'ch1', name: 'Jovens (UJC)', type: 'team', leader: 'Pedro Alves', members_count: 42 },
  { id: 'm3', church_id: 'ch1', name: 'Ação Social', type: 'department', leader: 'Rita Campos', members_count: 9 },
  { id: 'm4', church_id: 'ch1', name: 'Comunicação', type: 'team', leader: 'Lucas Moreira', members_count: 6 },
]

export const members: ChurchMember[] = [
  { id: 'cm1', church_id: 'ch1', user_id: 'u1', role_id: 'r2', role: 'church_admin', status: 'active', created_at: '2026-01-12', user: { id: 'u1', full_name: 'Marcos Lima', email: 'marcos@ibcentral.org.br', created_at: '2026-01-12', updated_at: '2026-01-12' } },
  { id: 'cm2', church_id: 'ch1', user_id: 'u2', role_id: 'r3', role: 'manager', status: 'active', created_at: '2026-02-03', user: { id: 'u2', full_name: 'Ana Souza', email: 'ana@ibcentral.org.br', created_at: '2026-02-03', updated_at: '2026-02-03' } },
  { id: 'cm3', church_id: 'ch1', user_id: 'u3', role_id: 'r4', role: 'communicator', status: 'invited', created_at: '2026-11-05', user: { id: 'u3', full_name: 'Lucas Moreira', email: 'lucas@ibcentral.org.br', created_at: '2026-11-05', updated_at: '2026-11-05' } },
  { id: 'cm4', church_id: 'ch2', user_id: 'u4', role_id: 'r2', role: 'church_admin', status: 'active', created_at: '2026-02-05', user: { id: 'u4', full_name: 'Tiago Reis', email: 'tiago@vidanova.com', created_at: '2026-02-05', updated_at: '2026-02-05' } },
  // A comunicadora ativa existe para o demo alcançar as portas que só o papel dela
  // mede: `events.manage` sem `events.publish`, e nada de `registrations.manage`.
  // `cm3` continua convidado — é o fixture de "convite não aceito não vira igreja".
  { id: 'cm5', church_id: 'ch1', user_id: 'u5', role_id: 'r4', role: 'communicator', status: 'active', created_at: '2026-11-06', user: { id: 'u5', full_name: 'Paula Diniz', email: 'paula@ibcentral.org.br', created_at: '2026-11-06', updated_at: '2026-11-06' } },
]

export const events: ChurchEvent[] = [
  { id: 'e1', slug: 'congresso-de-jovens-2026', name: 'Congresso de Jovens 2026', description: 'Três dias de adoração, ensino e comunhão com preletores nacionais.', category_id: 'c2', category: 'Congressos', church_id: 'ch1', church_name: 'Igreja Batista Central', starts_at: '2026-11-20T19:30:00', ends_at: '2026-11-22T22:00:00', address: 'Rua das Palmeiras, 120 — Centro', city: 'São José dos Campos', is_free: false, visibility: 'public', status: 'published', capacity: 500, branch_id: 'b1', latitude: -23.1857, longitude: -45.8871 },
  { id: 'e2', slug: 'vigilia-de-oracao', name: 'Vigília de Oração', description: 'Noite de intercessão pela cidade e pelas famílias.', category_id: 'c8', category: 'Vigílias', church_id: 'ch1', church_name: 'Igreja Batista Central', starts_at: '2026-11-14T22:00:00', address: 'Rua das Palmeiras, 120 — Centro', city: 'São José dos Campos', is_free: true, visibility: 'public', status: 'published' },
  { id: 'e3', slug: 'encontro-de-mulheres', name: 'Encontro de Mulheres — Florescer', description: 'Tarde especial com louvor, palavra e comunhão.', category_id: 'c6', category: 'Eventos de mulheres', church_id: 'ch2', church_name: 'Comunidade Vida Nova', starts_at: '2026-11-29T14:00:00', address: 'Av. Heitor Villa-Lobos, 900', city: 'São José dos Campos', is_free: true, visibility: 'public', status: 'scheduled' },
  { id: 'e4', slug: 'acao-social-natal', name: 'Ação Social de Natal', description: 'Distribuição de cestas e atendimento gratuito à comunidade.', category_id: 'c11', category: 'Ações sociais', church_id: 'ch1', church_name: 'Igreja Batista Central', starts_at: '2026-12-12T09:00:00', address: 'Praça Central', city: 'São José dos Campos', is_free: true, visibility: 'public', status: 'draft' },
]

export const registrations: Registration[] = [
  { id: 'r1', event_id: 'e1', event_name: 'Congresso de Jovens 2026', visitor_name: 'Camila Torres', visitor_email: 'camila@email.com', status: 'confirmed', created_at: '2026-11-01' },
  { id: 'r2', event_id: 'e1', event_name: 'Congresso de Jovens 2026', visitor_name: 'Rafael Nunes', visitor_email: 'rafael@email.com', status: 'checked_in', created_at: '2026-11-02' },
  { id: 'r3', event_id: 'e1', event_name: 'Congresso de Jovens 2026', visitor_name: 'Beatriz Lopes', visitor_email: 'bia@email.com', status: 'waitlist', created_at: '2026-11-03' },
  { id: 'r4', event_id: 'e2', event_name: 'Vigília de Oração', visitor_name: 'João Pedro', visitor_email: 'jp@email.com', status: 'pending', created_at: '2026-11-05' },
]

export const campaigns: Campaign[] = [
  { id: 'cp1', church_id: 'ch1', event_id: 'e1', name: 'Divulgação Congresso de Jovens', message: 'Vem aí o Congresso de Jovens 2026! Inscrições abertas no link.', networks: ['instagram', 'facebook', 'whatsapp'], status: 'scheduled', scheduled_for: '2026-12-10T09:00:00', created_at: '2026-11-06T10:00:00' },
  { id: 'cp2', church_id: 'ch1', event_id: 'e2', name: 'Vigília — contagem regressiva', message: 'Noite de intercessão pela cidade e pelas famílias. Participe da vigília.', networks: ['instagram', 'tiktok'], status: 'draft', created_at: '2026-11-07T14:30:00' },
  { id: 'cp3', church_id: 'ch1', event_id: 'e4', name: 'Ação Social de Natal', message: 'Distribuição de cestas e atendimento gratuito à comunidade.', networks: ['facebook', 'whatsapp'], status: 'scheduled', scheduled_for: '2026-12-05T18:00:00', created_at: '2026-11-08T09:15:00' },
  { id: 'cp4', church_id: 'ch2', event_id: 'e3', name: 'Florescer — convite mulheres', message: 'Tarde especial com louvor, palavra e comunhão.', networks: ['instagram'], status: 'draft', created_at: '2026-11-08T16:45:00' },
]

// Nenhuma conta aparece como conectada: conectar de verdade exige OAuth + backend
// com tokens, que não existem neste ambiente. Estado confirmado pelo provedor é o
// único que pode dizer "conectado" — enquanto não há, é tudo desconectado.
export const socialAccounts: SocialAccount[] = [
  { id: 'sa1', network: 'instagram', label: '@ibcentral', connected: false },
  { id: 'sa2', network: 'facebook', label: 'Igreja Batista Central', connected: false },
  { id: 'sa3', network: 'tiktok', label: '@ibcentral.jovens', connected: false },
  { id: 'sa4', network: 'whatsapp', label: '+55 12 99999-0001', connected: false },
]

export const aiGenerations: AIGeneration[] = [
  { id: 'ai1', kind: 'campaign', prompt: 'Campanha completa para o Congresso de Jovens', status: 'approved', created_at: '2026-11-06' },
  { id: 'ai2', kind: 'image', prompt: 'Arte Stories — Vigília de Oração', status: 'done', created_at: '2026-11-05' },
  { id: 'ai3', kind: 'text', prompt: 'Convite de WhatsApp para o Encontro de Mulheres', status: 'done', created_at: '2026-11-04' },
  { id: 'ai4', kind: 'video', prompt: 'Vídeo promocional 30s — Congresso', status: 'processing', created_at: '2026-11-07' },
]

export const auditLogs: AuditLog[] = [
  { id: 'al1', actor: 'admin@igrejaconecta.app', action: 'igreja.aprovada', target: 'Igreja Batista Central', church: 'Igreja Batista Central', metadata: { de: 'pending', para: 'approved' }, created_at: '2026-01-11T10:00:00' },
  { id: 'al2', actor: 'admin@igrejaconecta.app', action: 'membro.papel_alterado', target: 'Ana Souza → Gerente', church: 'Igreja Batista Central', created_at: '2026-02-04T14:22:00' },
  { id: 'al3', actor: 'tiago@vidanova.com', action: 'evento.publicado', target: 'Encontro de Mulheres', church: 'Comunidade Vida Nova', created_at: '2026-11-01T18:40:00' },
]

export const profiles: Profile[] = members.map((m) => m.user!)
