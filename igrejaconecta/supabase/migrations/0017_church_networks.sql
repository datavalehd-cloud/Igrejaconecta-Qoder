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
