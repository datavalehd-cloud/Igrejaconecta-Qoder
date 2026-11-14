-- ============================================================================
-- 0015 — Ministérios, equipes e perfis de rede social da igreja
--
-- Até aqui as duas telas (`/app/ministerios` e `/app/marketing/contas`) liam
-- `src/data/mock.ts`: nome, líder e contagem de participantes inventados, sem
-- banco nenhum. Esta migração dá origem real aos dois dados e mantém, no
--_storage_, a mesma honestidade que a tela já tinha: **conectado só com
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
