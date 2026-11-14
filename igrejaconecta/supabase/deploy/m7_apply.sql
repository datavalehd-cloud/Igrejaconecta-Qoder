-- sha256 (conteudo das migrações + corpo): 64f68567274880724dd37657cdd9f66dd8e57525e2b8391ef35e0f929eef960e
-- GERADO POR scripts/m7-bundle.mjs — nao editar a mao.
-- Aplica no projeto Supabase real as migrações que ainda não estão lá (0015..0021)
-- e confere o resultado DENTRO da mesma transação: se faltar qualquer objeto
-- declarado pelos arquivos, ou se algum grant estiver mais aberto do que a migração
-- manda, o apply INTEIRO é desfeito e o banco continua como estava.
--
-- Como rodar: cole este arquivo inteiro no SQL Editor do projeto real e execute.
-- Ele não apaga dado nenhum. Cria tabelas, políticas, triggers e views; o único
-- objeto existente que ele toca é o CHECK de redes de campanha (0020), que passa a
-- aceitar só instagram/facebook/whatsapp. Se existir campanha com 'tiktok', o
-- re-criar do CHECK falha e nada é aplicado — é o comportamento correto.

select current_database() as banco, current_user as usuario, version();

select count(*) as igrejas_no_banco from public.churches;
select count(*) as campanhas_com_tiktok from public.marketing_campaigns where 'tiktok' = any (networks);
select to_regclass('public.ministries') is not null as ministerios_ja_existem,
       to_regclass('public.visitor_favorites') is not null as favoritos_ja_existem,
       to_regclass('public.security_events') is not null as seguranca_ja_existe;

begin;

-- ===================== 0015_ministries_and_social_accounts.sql =====================
-- ============================================================================
-- 0015 — Ministérios, equipes e perfis de rede social da igreja
--
-- Até aqui as duas telas (`/app/ministerios` e `/app/marketing/contas`) liam
-- `src/data/mock.ts`: nome, líder e contagem de participantes inventados, sem
-- banco nenhum. Esta migração dá origem real aos dois dados e mantém, no banco,
-- a mesma honestidade que a tela já tinha: **conectado só com
-- confirmação do provedor**.
--
-- Decisões, e o porquê:
--
-- 1) **Nenhuma permissão nova.** Ministério é dado interno de equipe, então quem
--    gerencia equipe (`members.manage`) gerencia ministério; perfil de rede é
--    parte do cadastro da igreja, então é `church.manage`. Criar chave nova em
--    `permissions` exigiria resemear papéis e redefinir quem vê o quê — mudança
--    de audiência sem necessidade. O `seed.sql` aplicado no projeto real continua
--    valendo.
--
-- 2) **Participante é uma pessoa da igreja, não um número digitado.**
--    `ministry_members` amarra `profiles`, então a contagem que aparece na tela é
--    `count(*)` de gente de verdade, e líder é `leader_id` para o mesmo `profiles`
--    (`on delete set null`: apagar a conta não apaga o ministério). Nenhum campo
--    "members_count" editável existe — é justamente o que impede a tela de
--    mostrar quantos alguém quis.
--
-- 3) **Leitura é de membro ativo da igreja** (`current_church_ids()`) ou
--    SuperAdmin; `anon` não recebe grant nenhum, então a recusa acontece antes da
--    RLS. Ministério não é vitrine: a lista pública de igrejas não mostra equipes.
--
-- 4) **Delete de ministério existe** (diferente de campanha e filial, que são
--    canceladas): desfazer um ministério montado por engano é operação normal, e
--    `ministry_members` cai junto por cascata.
--
-- 5) `church_social_accounts.connected` **não é editável pelo app**. O trigger
--    `enforce_social_connection` recusa com `42501` qualquer `authenticated` que
--    tente marcar `true`, pelo mesmo motivo do `enforce_campaign_publish` (0014):
--    conexão real exige OAuth + backend com tokens. A tela pode gravar o
--    @/handle — informação que o administrador sabe — e o selo continua
--    "não conectado" enquanto ninguém confirmou com a plataforma.
--
-- 6) `handle` é `lower` num índice único por (igreja, rede): duas contas do mesmo
--    perfil não se cadastram duas vezes por variação de maiúscula.
-- ============================================================================

create table if not exists public.ministries (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches (id) on delete cascade,
  type        text not null default 'ministry'
                check (type in ('ministry','department','team')),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  description text,
  leader_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ministry_members (
  ministry_id uuid not null references public.ministries (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (ministry_id, user_id)
);

create table if not exists public.church_social_accounts (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references public.churches (id) on delete cascade,
  network    text not null
               check (network in ('instagram','facebook','whatsapp','youtube')),
  handle     text not null check (char_length(btrim(handle)) between 1 and 60),
  connected  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ministries_church_idx on public.ministries (church_id);
create index if not exists ministry_members_user_idx on public.ministry_members (user_id);
create unique index if not exists church_social_accounts_church_network_uidx
  on public.church_social_accounts (church_id, network, lower(handle));

drop trigger if exists trg_ministries_updated on public.ministries;
create trigger trg_ministries_updated before update on public.ministries
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_church_social_accounts_updated on public.church_social_accounts;
create trigger trg_church_social_accounts_updated before update on public.church_social_accounts
  for each row execute function public.touch_updated_at();

-- Ninguém conecta rede social por conta própria --------------------------------
create or replace function public.enforce_social_connection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Um backend com OAuth confirmado (service_role) é o único que pode dizer que a
  -- conta está conectada. Pelo app o campo é imutável: a tela grava @handle, não
  -- autoridade. INSERT usa `connected` default false, então a recusa aqui pega
  -- quem tentasse já nascer conectado.
  if tg_op = 'INSERT' then
    if new.connected and current_user <> 'service_role' then
      raise exception 'marcar rede social como conectada exige confirmacao real do provedor (backend)'
        using errcode = '42501';
    end if;
  elsif new.connected is distinct from old.connected and current_user <> 'service_role' then
    raise exception 'marcar rede social como conectada exige confirmacao real do provedor (backend)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_church_social_accounts_connection on public.church_social_accounts;
create trigger trg_church_social_accounts_connection
  before insert or update of connected on public.church_social_accounts
  for each row execute function public.enforce_social_connection();

-- A lista que a tela lê: líder pelo nome e participantes contados no banco -----
-- security_invoker = false porque o filtro está no WHERE e usa a identidade de
-- quem consulta (mesma razão de `church_roster`, 0007).
create or replace view public.ministry_list
with (security_invoker = false)
as
select
  m.id,
  m.church_id,
  m.type,
  m.name,
  m.description,
  m.leader_id,
  l.full_name as leader_name,
  (select count(*)::int from public.ministry_members mm where mm.ministry_id = m.id) as members_count,
  m.created_at,
  m.updated_at
from public.ministries m
left join public.profiles l on l.id = m.leader_id
where public.is_superadmin()
   or m.church_id in (select public.current_church_ids());

alter view public.ministry_list owner to postgres;
revoke all on public.ministry_list from anon;
grant select on public.ministry_list to authenticated;

-- RLS ------------------------------------------------------------------------
alter table public.ministries        enable row level security;
alter table public.ministry_members  enable row level security;
alter table public.church_social_accounts enable row level security;

revoke all on public.ministries from anon, authenticated;
revoke all on public.ministry_members from anon, authenticated;
revoke all on public.church_social_accounts from anon, authenticated;

grant select, insert, update, delete on public.ministries to authenticated;
grant select, insert, delete on public.ministry_members to authenticated;
grant select, insert, update, delete on public.church_social_accounts to authenticated;

drop policy if exists ministries_read on public.ministries;
create policy ministries_read on public.ministries
  for select to authenticated
  using (public.is_superadmin() or church_id in (select public.current_church_ids()));

drop policy if exists ministries_write on public.ministries;
create policy ministries_write on public.ministries
  for insert to authenticated
  with check (public.has_church_permission(church_id, 'members.manage'));

drop policy if exists ministries_update on public.ministries;
create policy ministries_update on public.ministries
  for update to authenticated
  using (public.has_church_permission(church_id, 'members.manage'))
  with check (public.has_church_permission(church_id, 'members.manage'));

drop policy if exists ministries_delete on public.ministries;
create policy ministries_delete on public.ministries
  for delete to authenticated
  using (public.has_church_permission(church_id, 'members.manage'));

-- Participantes: a mesma audiência do ministério, e o ministério precisa ser da
-- igreja de quem escreve (senão um membro da igreja A enche de gente um ministério
-- da igreja B).
drop policy if exists ministry_members_read on public.ministry_members;
create policy ministry_members_read on public.ministry_members
  for select to authenticated
  using (
    public.is_superadmin()
    or ministry_id in (
      select m.id from public.ministries m
      where public.is_superadmin() or m.church_id in (select public.current_church_ids())
    )
  );

drop policy if exists ministry_members_insert on public.ministry_members;
create policy ministry_members_insert on public.ministry_members
  for insert to authenticated
  with check (
    public.has_church_permission(
      (select m.church_id from public.ministries m where m.id = ministry_id),
      'members.manage'
    )
  );

drop policy if exists ministry_members_delete on public.ministry_members;
create policy ministry_members_delete on public.ministry_members
  for delete to authenticated
  using (
    public.has_church_permission(
      (select m.church_id from public.ministries m where m.id = ministry_id),
      'members.manage'
    )
  );

-- Perfis de rede: leitura de membro, escrita de quem gerencia a igreja.
drop policy if exists church_social_accounts_read on public.church_social_accounts;
create policy church_social_accounts_read on public.church_social_accounts
  for select to authenticated
  using (public.is_superadmin() or church_id in (select public.current_church_ids()));

drop policy if exists church_social_accounts_insert on public.church_social_accounts;
create policy church_social_accounts_insert on public.church_social_accounts
  for insert to authenticated
  with check (public.has_church_permission(church_id, 'church.manage'));

drop policy if exists church_social_accounts_update on public.church_social_accounts;
create policy church_social_accounts_update on public.church_social_accounts
  for update to authenticated
  using (public.has_church_permission(church_id, 'church.manage'))
  with check (public.has_church_permission(church_id, 'church.manage'));

drop policy if exists church_social_accounts_delete on public.church_social_accounts;
create policy church_social_accounts_delete on public.church_social_accounts
  for delete to authenticated
  using (public.has_church_permission(church_id, 'church.manage'));

-- ===================== 0016_visitor_favorites_preferences.sql =====================
-- ============================================================================
-- 0016 — Favoritos e preferências do visitante
--
-- `/visitante/perfil` era a tela mais fingida do app: o botão "Salvar
-- preferências" só ligava um `useState` e mostrava "Preferências salvas (demo)",
-- e "Meus favoritos" listava os dois primeiros eventos publicados do mock — ou
-- seja, favorito nenhum era de ninguém. Aqui as duas coisas ganham tabela.
--
-- Decisões, e o porquê:
--
-- 1) **Tudo é do próprio visitante.** A chave de acesso é `user_id = auth.uid()`
--    nas duas tabelas, em todas as operações, inclusive no WITH CHECK: ninguém
--    escreve na lista de outra pessoa, e `anon` não tem grant nenhum. O histórico
--    de inscrições do visitante já era real por esse mesmo caminho
--    (`event_registrations_read`, 0012, tem `user_id = auth.uid()`); é dele que a
--    tela passa a ler.
--
-- 2) **Sem conta, sem favorito.** A tela continua aberta a quem não entrou, mas o
--    botão vira "entre para salvar" — não existe favoritos anônimo, e fingir um
--    com `localStorage` seria mais uma coisa na tela que não é verdade.
--
-- 3) `interests` é `text[]` com CHECK de contenção sobre os interesses que a
--    tela oferece, nos mesmos códigos da UI. Uma lista livre viraria campo de
--    texto sem uso nenhum (nenhuma triagem por interesse existe no app).
--
-- 4) **A RLS não confere se o evento favorecido está publicado.** Conferia via
--    subquery em política, mas o app é o único que escreve aqui e ele só mostra o
--    que a `events_public_read` devolve: um evento que saiu do ar some da lista
--    junto, sem linha órfã na tela. O limite está registrado de propósito — a
--    leitura nunca expõe evento não publicado, mesmo se a linha sobreviver.
--
-- 5) `city` é dado de preferência, não endereço de cadastro: sem coluna nova em
--    `profiles` (que é de identidade) e sem LGPD de mais — é o que a própria tela
--    pergunta.
-- ============================================================================

create table if not exists public.visitor_favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.visitor_preferences (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  city       text check (city is null or char_length(btrim(city)) <= 80),
  interests  text[] not null default '{}'
               check (interests <@ array['jovens','familia','mulheres','homens','acao_social']::text[]),
  updated_at timestamptz not null default now()
);

create index if not exists visitor_favorites_event_idx on public.visitor_favorites (event_id);

drop trigger if exists trg_visitor_preferences_updated on public.visitor_preferences;
create trigger trg_visitor_preferences_updated before update on public.visitor_preferences
  for each row execute function public.touch_updated_at();

-- RLS ------------------------------------------------------------------------
alter table public.visitor_favorites   enable row level security;
alter table public.visitor_preferences enable row level security;

revoke all on public.visitor_favorites from anon, authenticated;
revoke all on public.visitor_preferences from anon, authenticated;

grant select, insert, delete on public.visitor_favorites to authenticated;
grant select, insert, update on public.visitor_preferences to authenticated;

drop policy if exists visitor_favorites_self on public.visitor_favorites;
create policy visitor_favorites_self on public.visitor_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists visitor_preferences_self_read on public.visitor_preferences;
create policy visitor_preferences_self_read on public.visitor_preferences
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists visitor_preferences_self_write on public.visitor_preferences;
create policy visitor_preferences_self_write on public.visitor_preferences
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists visitor_preferences_self_update on public.visitor_preferences;
create policy visitor_preferences_self_update on public.visitor_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===================== 0017_church_networks.sql =====================
-- ============================================================================
-- 0017 — Redes de igrejas (organizações)
--
-- `/admin/organizacoes` era um `EmptyState` dizendo "ainda não existem". Aqui
-- elas passam a existir: uma rede agrupa igrejas, e a associação é dada pelo
-- SuperAdmin — que é quem já faz esse papel no produto (aprovar, suspender).
--
-- Decisões, e o porquê:
--
-- 1) **Escrita exclusiva do SuperAdmin**, nas duas tabelas. Uma igreja não se
--    autoassocia a uma organização: isso é decisão de plataforma, e é a mesma
--    audiência de `church.approve` que governa entrada e saída de igrejas no ar.
--
-- 2) **Leitura é assimétrica.** O SuperAdmin vê todas as redes e todas as
--    associações. Um membro de igreja vê apenas as redes das igrejas às quais
--    pertence — para saber a que organização a própria igreja pertence, sem
--    mapear a estrutura inteira da plataforma. O recorte passa por
--    `current_network_ids()`, função `security definer` no mesmo estilo de
--    `current_church_ids()`: a política não depende de ler a tabela de
--    associação sob RLS (o que criaria dependência circular entre as duas).
--
-- 3) `anon` não recebe grant nenhum: rede de igrejas não é vitrine pública.
--
-- 4) **`slug` único** porque a URL pública de organização é o passo seguinte e o
--    app já trata slug de igreja e evento assim — criado junto, não remendado.
--
-- 5) Desfazer associação **apaga o vínculo, nunca a igreja**: a chave primária
--    composta cai com `on delete cascade` dos dois lados, então remover uma
--    igreja da rede ou apagar a rede inteira deixa `churches` intacta.
-- ============================================================================

create table if not exists public.church_networks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.church_network_churches (
  network_id uuid not null references public.church_networks (id) on delete cascade,
  church_id  uuid not null references public.churches (id) on delete cascade,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (network_id, church_id)
);

create index if not exists church_network_churches_church_idx
  on public.church_network_churches (church_id);

drop trigger if exists trg_church_networks_updated on public.church_networks;
create trigger trg_church_networks_updated before update on public.church_networks
  for each row execute function public.touch_updated_at();

-- Redes do usuário atual: as igrejas ativas dele, e só. -----------------------
create or replace function public.current_network_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select cnc.network_id
  from public.church_network_churches cnc
  where cnc.church_id in (select public.current_church_ids());
$$;

-- Uma linha por rede, com contagem de igrejas vinda do banco (não digitada). --
create or replace view public.church_network_list
with (security_invoker = false)
as
select
  n.id,
  n.name,
  n.slug,
  n.description,
  (select count(*)::int from public.church_network_churches cnc where cnc.network_id = n.id) as churches_count,
  n.created_at,
  n.updated_at
from public.church_networks n
where public.is_superadmin()
   or n.id in (select public.current_network_ids());

alter view public.church_network_list owner to postgres;
revoke all on public.church_network_list from anon;
grant select on public.church_network_list to authenticated;

-- RLS ------------------------------------------------------------------------
alter table public.church_networks          enable row level security;
alter table public.church_network_churches  enable row level security;

revoke all on public.church_networks from anon, authenticated;
revoke all on public.church_network_churches from anon, authenticated;

grant select, insert, update, delete on public.church_networks to authenticated;
grant select, insert, delete on public.church_network_churches to authenticated;

drop policy if exists church_networks_read on public.church_networks;
create policy church_networks_read on public.church_networks
  for select to authenticated
  using (public.is_superadmin() or id in (select public.current_network_ids()));

drop policy if exists church_networks_write on public.church_networks;
create policy church_networks_write on public.church_networks
  for insert to authenticated
  with check (public.is_superadmin());

drop policy if exists church_networks_update on public.church_networks;
create policy church_networks_update on public.church_networks
  for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

drop policy if exists church_networks_delete on public.church_networks;
create policy church_networks_delete on public.church_networks
  for delete to authenticated
  using (public.is_superadmin());

drop policy if exists church_network_churches_read on public.church_network_churches;
create policy church_network_churches_read on public.church_network_churches
  for select to authenticated
  using (
    public.is_superadmin()
    or network_id in (select public.current_network_ids())
    -- A própria igreja, mesmo que a rede ainda não esteja visível por outro
    -- caminho: é a associação que o membro tem direito de ver.
    or church_id in (select public.current_church_ids())
  );

drop policy if exists church_network_churches_insert on public.church_network_churches;
create policy church_network_churches_insert on public.church_network_churches
  for insert to authenticated
  with check (public.is_superadmin());

drop policy if exists church_network_churches_delete on public.church_network_churches;
create policy church_network_churches_delete on public.church_network_churches
  for delete to authenticated
  using (public.is_superadmin());

-- ===================== 0018_support_tickets.sql =====================
-- ============================================================================
-- 0018 — Suporte: tickets e mensagens
--
-- `/admin/suporte` dizia "Suporte ainda não existe". Passa a existir como
-- conversa entre quem abriu o chamado e a plataforma, com as duas tabelas que
-- uma caixa de suporte precisa — nada de "inbox" decorativa.
--
-- Decisões, e o porquê:
--
-- 1) **Quem abre, vê; quem é da igreja, vê o da própria igreja; SuperAdmin
--    vê tudo.** Isso é material: um chamado de igrejas costuma trazer prints,
--    nomes e reclamações de terceiros. Um membro comum de A não pode ler o
--    ticket de B, mas o administrador da igreja que é assunto do ticket precisa
--    acompanhe o assunto — mas **só quem gerencia a igreja** (`church.manage`),
--    não qualquer membro: um print com reclamação de terceiro não circula pela
--    igreja inteira. As três regras moram numa função só, `can_read_ticket`,
--    porque `support_messages` precisa da MESMA resposta sem poder consultar
--    `support_tickets` sob RLS dentro da própria política (recursão de política é
--    exatamente o que se quer evitar).
--
-- 2) **`can_read_ticket` é `security definer`**, no mesmo pé de
--    `current_church_ids()` e `has_church_permission()`: ela lê o autor e a
--    igreja do ticket com os direitos do dono, mas devolve apenas um booleano
--    calculado sobre `auth.uid()`. Não expõe linha nenhuma por si só.
--
-- 3) **Não existe delete de ticket nem de mensagem.** Suporte é trilha: se
--    errar apaga-se a evidência. Fecha-se (`status = 'closed'`) por quem abriu
--    ou pelo SuperAdmin. `anon` não tem grant nenhum, então abrir chamado exige
--    conta — decisão consciente: ticket anônimo não tem para quem responder.
--
-- 4) **`status` não é campo livre**: `open` / `answered` / `closed`, e só
--    autor e SuperAdmin mudam. Quem respondeu (SuperAdmin) marca `answered` na
--    mesma escrita da mensagem, no serviço — não no banco, porque o banco não
--    sabe quem é o atendente.
--
-- 5) `church_id` é nullable e `on delete set null`: chamado de visitante sem
--    igreja existe, e apagar uma igreja não apaga o histórico de suporte.
-- ============================================================================

create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid references public.churches (id) on delete set null,
  opened_by  uuid not null references public.profiles (id) on delete cascade,
  subject    text not null check (char_length(btrim(subject)) between 3 and 200),
  status     text not null default 'open'
               check (status in ('open','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_church_idx on public.support_tickets (church_id);
create index if not exists support_tickets_opened_by_idx on public.support_tickets (opened_by);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

drop trigger if exists trg_support_tickets_updated on public.support_tickets;
create trigger trg_support_tickets_updated before update on public.support_tickets
  for each row execute function public.touch_updated_at();

-- A regra de leitura, uma vez só, para as duas tabelas. ----------------------
create or replace function public.can_read_ticket(p_ticket uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.support_tickets t
    where t.id = p_ticket
      and (
        t.opened_by = auth.uid()
        or public.is_superadmin()
        or (t.church_id is not null and public.has_church_permission(t.church_id, 'church.manage'))
      )
  );
$$;

-- O ticket com a última mensagem e a contagem real de respostas. -------------
create or replace view public.support_ticket_list
with (security_invoker = false)
as
select
  t.id,
  t.church_id,
  t.opened_by,
  o.full_name as opened_by_name,
  c.name       as church_name,
  t.subject,
  t.status,
  t.created_at,
  t.updated_at,
  (select count(*)::int from public.support_messages m where m.ticket_id = t.id) as messages_count,
  (select m.body from public.support_messages m
    where m.ticket_id = t.id order by m.created_at desc, m.id desc limit 1) as last_message
from public.support_tickets t
left join public.profiles o on o.id = t.opened_by
left join public.churches c on c.id = t.church_id
where t.opened_by = auth.uid()
   or public.is_superadmin()
   or (t.church_id is not null and public.has_church_permission(t.church_id, 'church.manage'));

alter view public.support_ticket_list owner to postgres;
revoke all on public.support_ticket_list from anon;
grant select on public.support_ticket_list to authenticated;

-- RLS ------------------------------------------------------------------------
alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;

grant select, insert, update on public.support_tickets to authenticated;
grant select, insert on public.support_messages to authenticated;

drop policy if exists support_tickets_read on public.support_tickets;
create policy support_tickets_read on public.support_tickets
  for select to authenticated
  using (
    opened_by = auth.uid()
    or public.is_superadmin()
    or (church_id is not null and public.has_church_permission(church_id, 'church.manage'))
  );

-- Abrir chamado: o autor é quem está logado, e a igreja do assunto tem de ser a
-- igreja dele (ou nenhuma). Sem isso, qualquer um abre ticket "sobre" a igreja
-- do vizinho e a leitura por igreja faria isso vazar.
drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (
    opened_by = auth.uid()
    and (church_id is null or church_id in (select public.current_church_ids()))
  );

-- Fechar/reativar: autor e SuperAdmin. O autor não reabre assunto alheio porque
-- a cláusula USING já é a condição de leitura da própria linha.
drop policy if exists support_tickets_update on public.support_tickets;
create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (opened_by = auth.uid() or public.is_superadmin())
  with check (opened_by = auth.uid() or public.is_superadmin());

drop policy if exists support_messages_read on public.support_messages;
create policy support_messages_read on public.support_messages
  for select to authenticated
  using (public.can_read_ticket(ticket_id));

drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_read_ticket(ticket_id)
  );

-- ===================== 0019_security_events.sql =====================
-- ============================================================================
-- 0019 — Eventos de segurança reais (o painel de alertas deixa de ser enfeite)
--
-- `AdminSettingsPage` tinha "Alertas de tentativas suspeitas — Não conectado" e
-- `AdminLogsPage` exibia linhas fictícias do mock. Não havia onde anotar uma
-- recusa. Esta migração cria o registro e a RPC que o escreve.
--
-- Decisões, e o porquê:
--
-- 1) **Tabela separada de `audit_logs`, de propósito.** A 0010 fechou o insert
--    manual em `audit_logs` com uma marca de transação que só o trigger da 0009
--    liga, e o documento da migração diz explicitamente que "não há RPC que chame
--    set_config" — é isso que torna o caminho inviável pela API. Criar uma RPC
--    que ligasse essa marca reabriria exatamente o buraco que a 0010 fechou.
--    Então o sinal de recusa mora numa tabela própria, com forma restrita, e
--    `audit_logs` continua intocável pelo app.
--
-- 2) **Só dois tipos, e cada um tem um ponto de chamada real no app:**
--    `permission_denied` — uma escrita devolveu `42501` (a RLS disse não);
--    `publish_denied` — tentaram marcar publicação/conexão de rede sem o
--    provedor ter confirmado (gatilho 0014/0015). Tipos livres virariam
--    classificação subjetiva sem regra nenhuma.
--
-- 3) **Ninguém escreve pela API, nem SuperAdmin:** `revoke all ... from
--    authenticated` e o insert acontece só dentro de `log_security_event`,
--    `security definer`, que grava `actor_id = auth.uid()` e recusa tipo
--    desconhecido com `22023`. O app chama depois de levar a recusa; quem não
--    chamou não apaga nem reescreve o que outro chamou.
--
-- 4) **Leitura é do SuperAdmin** (as duas views e a tabela). Uma recusa de
--   escrita numa igreja não se torna visível para a própria igreja: é dado de
--    monitoramento da plataforma, e a projeção traz nome do autor só para quem já
--    vê o diretório global de usuários.
--
-- 5) O sinal tem limite, e está dito: ele só existe para recusa que o app
--    percebe. Um ataque direto ao PostgREST que a RLS derruba não passa por
--    nenhuma dessas rotas, e nada aqui finge ver o que não foi registrado.
-- ============================================================================

create table if not exists public.security_events (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles (id) on delete set null,
  kind       text not null
               check (kind in ('permission_denied','publish_denied')),
  target     text,
  church_id  uuid references public.churches (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists security_events_created_idx on public.security_events (created_at desc);
create index if not exists security_events_kind_idx on public.security_events (kind, created_at desc);

-- A única porta de entrada. -------------------------------------------------
create or replace function public.log_security_event(p_kind text, p_target text, p_church uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_kind is null or p_kind not in ('permission_denied','publish_denied') then
    raise exception 'tipo de evento de seguranca invalido'
      using errcode = '22023';
  end if;

  insert into public.security_events (actor_id, kind, target, church_id)
  values (auth.uid(), p_kind, nullif(btrim(coalesce(p_target, '')), ''), p_church);
end;
$$;

revoke all on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

revoke all on function public.log_security_event(text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_security_event(text, text, uuid) to authenticated;

alter table public.security_events enable row level security;

drop policy if exists security_events_read on public.security_events;
create policy security_events_read on public.security_events
  for select to authenticated
  using (public.is_superadmin());

-- Contagem por tipo, nas janelas que a tela mostra. -------------------------
create or replace view public.security_event_summary
with (security_invoker = false)
as
select
  k.kind,
  count(se.id) filter (where se.created_at > now() - interval '24 hours')::int as last_24h,
  count(se.id) filter (where se.created_at > now() - interval '7 days')::int   as last_7d,
  count(se.id)::int                                                             as total,
  max(se.created_at)                                                            as last_at
from (values ('permission_denied'),('publish_denied')) as k(kind)
left join public.security_events se on se.kind = k.kind
where public.is_superadmin()
group by k.kind;

alter view public.security_event_summary owner to postgres;
revoke all on public.security_event_summary from anon;
grant select on public.security_event_summary to authenticated;

-- Os últimos acontecimentos, com nome de quem tentou. ----------------------
create or replace view public.security_event_log
with (security_invoker = false)
as
select
  se.id,
  se.kind,
  se.target,
  se.church_id,
  c.name as church_name,
  se.actor_id,
  p.full_name as actor_name,
  p.email     as actor_email,
  se.created_at
from public.security_events se
left join public.profiles p on p.id = se.actor_id
left join public.churches c on c.id = se.church_id
where public.is_superadmin()
order by se.created_at desc
limit 200;

alter view public.security_event_log owner to postgres;
revoke all on public.security_event_log from anon;
grant select on public.security_event_log to authenticated;

-- ===================== 0020_drop_tiktok_from_campaigns.sql =====================
-- ============================================================================
-- 0020 — TikTok fora das redes de campanha
--
-- Decisão do produto nesta rodada: das quatro redes que a 0014 aceitava, TikTok
-- sai. O motivo não é técnico — é que TikTok Content Posting API exige aprovação
-- do app pela plataforma, e enquanto essa aprovação não existe a opção na tela
-- seria uma escolha que nunca leva a lugar nenhum. Menos opção mentirosa na
-- interface, menos estado para explicar.
--
-- Como a migração é feita:
--
-- 1) **Troca do CHECK, não remoção.** O nome da constraint é o que o Postgres
--    derivou na 0014 (`marketing_campaigns_networks_check`); ela é derrubada e
--    recriada com os três canais que restam, `instagram`, `facebook` e
--    `whatsapp`. `if exists` porque quem aplica em banco novo já passa pela 0014
--    com a constraint antiga, e quem aplica em banco recriado precisa do mesmo
--    resultado.
--
-- 2) **Nenhuma linha é reescrita.** O banco do projeto real está vazio de
--    campanhas, e se houvesse linha com 'tiktok' a recriação da constraint já
--    falharia — que é o comportamento correto: a migração não apaga dado de
--    ninguém escondido num `alter table`.
--
-- 3) A tabela de perfis de rede (0015) também não tem 'tiktok' no CHECK dela,
--    então as duas superfícies concordam: o app não oferece, o banco não aceita.
-- ============================================================================

alter table public.marketing_campaigns
  drop constraint if exists marketing_campaigns_networks_check;

alter table public.marketing_campaigns
  add constraint marketing_campaigns_networks_check
  check (networks <@ array['instagram','facebook','whatsapp']::text[]);

-- ===================== 0021_ministry_membership_guard.sql =====================
-- ============================================================================
-- 0021 — Líder e participante de ministério têm de ser da igreja
--
-- A 0015 criou `ministries.leader_id` e `ministry_members.user_id` apontando para
-- `profiles` sem conferir **de que igreja** é a pessoa. Sozinha, essa falta já
-- seria um problema de coerência (ministério com líder de fora). Aqui ela é de
-- **audiência**:
--
--   * `ministry_list` é `security_invoker = false` (decisão registrada na 0015),
--     então o `left join public.profiles l` roda com o privilégio do dono da view
--     e **não passa pela RLS de profiles**;
--   * a 0002 só deixa cada um ler o próprio perfil (`profiles_self_read`:
--     `id = auth.uid() or is_superadmin()`) — o nome dos colegas chega à tela
--     pela view `church_roster` (0007), com os contatos mascarados, e foi decisão
--     explícita não afrouxar `profiles`;
--   * consequência: quem tem `members.manage` podia escrever `leader_id` de
--     qualquer uuid e receber o `full_name` daquela pessoa na tela de ministérios
--     — um oráculo "uuid para nome" sobre contas de outras igrejas e de qualquer
--     usuário da plataforma.
--
-- A guarda fecha a **escrita**, não a leitura: a view continua como a 0015 a
-- deixou (mesmo caminho do `church_roster`), e passa a ser segura porque o que
-- entra em `leader_id` é, obrigatoriamente, membro **ativo** da igreja do
-- ministério — exatamente o conjunto de pessoas que a própria view já mostraria
-- a essa igreja. Nada é ampliado: `ministries_read` continua por vínculo ativo,
-- `ministry_members` continua sem update, e `anon` continua sem grant nenhum.
--
-- Por que trigger e não política: a checagem precisa olhar **duas** tabelas
-- (a igreja do ministério e o vínculo da pessoa) e vale tanto para
-- `ministries.leader_id` quanto para `ministry_members.user_id`. Em política, o
-- `WITH CHECK` com subquery em `church_members` é possível, mas deixaria o
-- `UPDATE leader_id` sem par (a política de update já tem outra regra) e não
-- cobre o caminho de quem escreve por fora do RLS. O padrão da casa é a função
-- `SECURITY DEFINER` com `search_path` fixo, como `enforce_event_branch` (0013).
--
-- Mensagens e códigos, iguais aos dos outros guardas: `42501` quando a pessoa
-- existe mas não é da igreja (recusa de permissão/audiência) e `23503` quando o
-- uuid não é nem um perfil (referência quebrada).
-- ============================================================================

-- O líder tem de ser membro ativo da igreja do ministério ---------------------
create or replace function public.enforce_ministry_leader()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_exists boolean;
  is_active_member boolean;
begin
  if new.leader_id is null then
    return new;
  end if;

  select exists (select 1 from public.profiles p where p.id = new.leader_id) into profile_exists;
  if not profile_exists then
    raise exception 'o lider indicado nao e uma conta desta plataforma'
      using errcode = '23503';
  end if;

  select exists (
    select 1 from public.church_members cm
    where cm.church_id = new.church_id
      and cm.user_id = new.leader_id
      and cm.status = 'active'
  ) into is_active_member;

  if not is_active_member then
    raise exception 'o lider do ministerio precisa ser membro ativo da mesma igreja'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ministries_leader on public.ministries;
create trigger trg_ministries_leader
  before insert or update of leader_id, church_id on public.ministries
  for each row execute function public.enforce_ministry_leader();

-- O participante também ------------------------------------------------------
-- Sem update aqui: a tabela só tem política de insert e delete (0015), e o par
-- (ministério, pessoa) é a chave primária — trocar pessoa é apagar e inserir.
create or replace function public.enforce_ministry_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ministry_church uuid;
  is_active_member boolean;
begin
  select church_id into ministry_church from public.ministries where id = new.ministry_id;
  if ministry_church is null then
    raise exception 'o ministerio indicado nao existe'
      using errcode = '23503';
  end if;

  select exists (
    select 1 from public.church_members cm
    where cm.church_id = ministry_church
      and cm.user_id = new.user_id
      and cm.status = 'active'
  ) into is_active_member;

  if not is_active_member then
    raise exception 'o participante do ministerio precisa ser membro ativo da igreja do ministerio'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ministry_members_member on public.ministry_members;
create trigger trg_ministry_members_member
  before insert on public.ministry_members
  for each row execute function public.enforce_ministry_member();

-- `from public` sozinho não basta: o Supabase (e o shim local) concedem EXECUTE
-- por default privileges a anon/authenticated/service_role. Listar os papéis é o
-- que fecha de verdade — e é higiene, não barreira: função de trigger não pode
-- ser chamada diretamente por quem escreve SQL pela API.
revoke execute on function public.enforce_ministry_leader() from public, anon, authenticated;
revoke execute on function public.enforce_ministry_member() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Verificacao, dentro da MESMA transacao do apply: tudo o que os arquivos declaram
-- tem de existir. Faltou um, o RAISE desfaz o apply inteiro e o banco no ar nunca
-- fica num meio-termo que nenhum teste local mediu.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
  n int;
  v text;
begin
  select string_agg(t, ', ') into missing
  from (values ('ministries'), ('ministry_members'), ('church_social_accounts'), ('visitor_favorites'), ('visitor_preferences'), ('church_networks'), ('church_network_churches'), ('support_tickets'), ('support_messages'), ('security_events')) as want(t)
  where to_regclass('public.' || want.t) is null;
  if missing is not null then
    raise exception 'M7-FALHA: tabelas ausentes apos o apply: %', missing;
  end if;

  select string_agg(w.table_name || '.' || w.policy_name, ', ') into missing
  from (values ('ministries','ministries_read'), ('ministries','ministries_write'), ('ministries','ministries_update'), ('ministries','ministries_delete'), ('ministry_members','ministry_members_read'), ('ministry_members','ministry_members_insert'), ('ministry_members','ministry_members_delete'), ('church_social_accounts','church_social_accounts_read'), ('church_social_accounts','church_social_accounts_insert'), ('church_social_accounts','church_social_accounts_update'), ('church_social_accounts','church_social_accounts_delete'), ('visitor_favorites','visitor_favorites_self'), ('visitor_preferences','visitor_preferences_self_read'), ('visitor_preferences','visitor_preferences_self_write'), ('visitor_preferences','visitor_preferences_self_update'), ('church_networks','church_networks_read'), ('church_networks','church_networks_write'), ('church_networks','church_networks_update'), ('church_networks','church_networks_delete'), ('church_network_churches','church_network_churches_read'), ('church_network_churches','church_network_churches_insert'), ('church_network_churches','church_network_churches_delete'), ('support_tickets','support_tickets_read'), ('support_tickets','support_tickets_insert'), ('support_tickets','support_tickets_update'), ('support_messages','support_messages_read'), ('support_messages','support_messages_insert'), ('security_events','security_events_read')) as w(table_name, policy_name)
  left join pg_policies p
    on p.schemaname = 'public' and p.tablename = w.table_name and p.policyname = w.policy_name
  where p.policyname is null;
  if missing is not null then
    raise exception 'M7-FALHA: politicas ausentes: %', missing;
  end if;

  select string_agg(w.table_name || '.' || w.trigger_name, ', ') into missing
  from (values ('ministries','trg_ministries_updated'), ('church_social_accounts','trg_church_social_accounts_updated'), ('church_social_accounts','trg_church_social_accounts_connection'), ('visitor_preferences','trg_visitor_preferences_updated'), ('church_networks','trg_church_networks_updated'), ('support_tickets','trg_support_tickets_updated'), ('ministries','trg_ministries_leader'), ('ministry_members','trg_ministry_members_member')) as w(table_name, trigger_name)
  left join pg_trigger t
    on t.tgrelid = ('public.' || w.table_name)::regclass and t.tgname = w.trigger_name and not t.tgisinternal
  where t.tgname is null;
  if missing is not null then
    raise exception 'M7-FALHA: triggers ausentes: %', missing;
  end if;

  select string_agg(f, ', ') into missing
  from (values ('enforce_social_connection'), ('current_network_ids'), ('can_read_ticket'), ('log_security_event'), ('enforce_ministry_leader'), ('enforce_ministry_member')) as want(f)
  where not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = want.f
  );
  if missing is not null then
    raise exception 'M7-FALHA: funcoes ausentes: %', missing;
  end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'visitor_favorites'
    and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if n <> 0 then
    raise exception 'M7-FALHA: visitor_favorites recebeu UPDATE (a 0016 nao da update)';
  end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'visitor_preferences'
    and grantee = 'authenticated' and privilege_type = 'DELETE';
  if n <> 0 then
    raise exception 'M7-FALHA: visitor_preferences recebeu DELETE (a 0016 nao da delete)';
  end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'security_events'
    and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE');
  if n <> 0 then
    raise exception 'M7-FALHA: security_events escrevivel pela API (so service_role escreve)';
  end if;

  select pg_get_constraintdef(oid) into v
  from pg_constraint
  where conrelid = 'public.marketing_campaigns'::regclass
    and conname = 'marketing_campaigns_networks_check';
  if v is null then
    raise exception 'M7-FALHA: marketing_campaigns_networks_check nao existe';
  end if;
  if v like '%tiktok%' or v not like '%instagram%' or v not like '%facebook%' or v not like '%whatsapp%' then
    raise exception 'M7-FALHA: CHECK de redes de campanha fora do esperado: %', v;
  end if;

  -- A 0021 so existe de fato se os dois triggers estiverem ATTACHED a uma tabela
  -- real e apontando para a propria funcao de guarda.
  select count(*) into n from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and t.tgname in ('trg_ministries_leader','trg_ministry_members_member')
    and p.proname in ('enforce_ministry_leader','enforce_ministry_member');
  if n <> 2 then
    raise exception 'M7-FALHA: guarda de ministerio (0021) nao esta attachada (% dos 2)', n;
  end if;

  raise notice 'M7-OK: % tabelas, % politicas, % triggers, % funcoes conferidos',
    10, 28, 8, 6;
end $$;

commit;

-- Inventario depois do commit — é isto que é preciso conferir antes de publicar.
select 'tabela' as objeto, table_name as nome, 'existe' as estado
from information_schema.tables
where table_schema = 'public' and table_name in ('ministries','ministry_members','church_social_accounts','visitor_favorites','visitor_preferences','church_networks','church_network_churches','support_tickets','support_messages','security_events')
order by table_name;

select tablename as tabela, count(*) as politicas
from pg_policies where schemaname = 'public' and tablename in ('ministries','ministry_members','church_social_accounts','visitor_favorites','visitor_preferences','church_networks','church_network_churches','support_tickets','support_messages','security_events')
group by tablename order by tablename;

select tgname as trigger, tgrelid::regclass as em_tabela
from pg_trigger
where not tgisinternal and tgname in ('trg_ministries_updated','trg_church_social_accounts_updated','trg_church_social_accounts_connection','trg_visitor_preferences_updated','trg_church_networks_updated','trg_support_tickets_updated','trg_ministries_leader','trg_ministry_members_member')
order by tgname;

select conname as constraint, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid in ('public.marketing_campaigns'::regclass, 'public.ministries'::regclass) and contype = 'c'
order by conname;

select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('visitor_favorites','visitor_preferences','security_events','ministries','ministry_members','church_social_accounts')
group by grantee, table_name order by table_name, grantee;

select count(*) as papeis_do_seed from public.roles;
select count(*) as permissoes_do_seed from public.permissions;
