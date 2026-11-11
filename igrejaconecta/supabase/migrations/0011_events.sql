-- ============================================================================
-- IgrejaConecta — Fase 3, passo 1: eventos (catálogo de categorias + eventos)
--
-- Até aqui as telas de eventos liam o mock. Esta migração cria as duas tabelas e o
-- RLS; as inscrições são o passo 2, então `registrations_count` continua sendo o
-- que a tela mostra como "—" até existir fonte confirmada.
--
-- Decisões:
--
-- 1) `event_categories` é catálogo público, como `roles`. A guarda E2 da suíte
--    lista explicitamente os catálogos; o nome desta tabela foi acrescentado lá,
--    e a sonda do E2 continua provando que a guarda não ficou cega. O conteúdo é
--    o mesmo do demo: `tests/unit/events.test.ts` compara as duas listas, então
--    categoria nova entra nos dois lados ou em nenhum.
--
-- 2) O visitante só vê evento **publicado e público** de igreja **aprovada e
--    ativa**. O `status = 'published'` sozinho não basta: suspender/rejeitar a
--    igreja (Fase 2) tem de tirar os eventos dela do ar junto — é o mesmo efeito
--    de audiência que o grupo J mede para o diretório, agora medido no grupo M.
--
-- 3) Membro da igreja vê os próprios eventos em qualquer status (rascunho
--    inclusive); outra igreja não vê nada. `visibility = 'private'` não é controle
--    de acesso: é intenção de produto, e o caso M5 grava isso por extenso.
--
-- 4) Publicar exige `events.publish`, não apenas `events.manage`. A matriz do seed
--    dá `events.manage` ao comunicador sem `events.publish`: sem este trigger ele
--    colocaria um rascunho no ar. RLS não controla coluna nem valor, então é um
--    trigger `42501`, no mesmo padrão do `approval_status` (0004).
-- ============================================================================

create table if not exists public.event_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  custom boolean not null default false
);

insert into public.event_categories (name, slug) values
  ('Cultos especiais',       'cultos-especiais'),
  ('Congressos',             'congressos'),
  ('Conferências',           'conferencias'),
  ('Cruzadas',               'cruzadas'),
  ('Encontros de jovens',    'jovens'),
  ('Eventos de mulheres',    'mulheres'),
  ('Eventos de homens',      'homens'),
  ('Vigílias',               'vigilias'),
  ('Escola bíblica',         'escola-biblica'),
  ('Shows gospel',           'shows-gospel'),
  ('Ações sociais',          'acoes-sociais'),
  ('Eventos infantis',       'infantis'),
  ('Encontros de casais',    'casais'),
  ('Campanhas solidárias',   'campanhas-solidarias'),
  ('Outros',                 'outros')
on conflict (slug) do nothing;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  category_id uuid references public.event_categories (id) on delete set null,
  slug text not null unique,
  name text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  address text,
  city text,
  cover_url text,
  capacity integer check (capacity is null or capacity > 0),
  is_free boolean not null default true,
  visibility text not null default 'public'
    check (visibility in ('public', 'private', 'unlisted')),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'cancelled', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_events_church_start on public.events (church_id, starts_at desc);
create index if not exists idx_events_public_start on public.events (starts_at desc)
  where status = 'published' and visibility = 'public';

drop trigger if exists trg_events_updated on public.events;
create trigger trg_events_updated before update on public.events
  for each row execute function public.touch_updated_at();

-- Publicar exige a permissão de publicar --------------------------------------
create or replace function public.enforce_event_publish()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if new.status = 'published' and not public.is_superadmin()
     and not public.has_church_permission(new.church_id, 'events.publish') then
    raise exception 'publicar evento exige a permissão events.publish'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_events_publish on public.events;
create trigger trg_events_publish
  before insert or update of status on public.events
  for each row execute function public.enforce_event_publish();

-- RLS ------------------------------------------------------------------------
alter table public.event_categories enable row level security;
alter table public.events enable row level security;

drop policy if exists event_categories_read on public.event_categories;
create policy event_categories_read on public.event_categories
  for select using (true);

drop policy if exists event_categories_write on public.event_categories;
create policy event_categories_write on public.event_categories
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- Visitante: só o que está no ar, de igreja que também está no ar.
drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select using (
    status = 'published'
    and visibility = 'public'
    and exists (
      select 1 from public.churches c
      where c.id = events.church_id
        and c.approval_status = 'approved'
        and c.status = 'active'
    )
  );

-- Quem é da igreja vê os próprios eventos em qualquer status; SuperAdmin vê tudo.
drop policy if exists events_church_read on public.events;
create policy events_church_read on public.events
  for select to authenticated using (
    public.is_superadmin()
    or church_id in (select public.current_church_ids())
  );

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (
    public.is_superadmin()
    or public.has_church_permission(church_id, 'events.manage')
  );

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update using (
    public.is_superadmin()
    or public.has_church_permission(church_id, 'events.manage')
  ) with check (
    public.is_superadmin()
    or public.has_church_permission(church_id, 'events.manage')
  );

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete using (
    public.is_superadmin()
    or public.has_church_permission(church_id, 'events.manage')
  );
