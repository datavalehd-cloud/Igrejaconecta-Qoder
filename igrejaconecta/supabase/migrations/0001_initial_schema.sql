-- ============================================================================
-- IgrejaConecta — Fase 1: Fundação, autenticação e segurança multi-igrejas
-- Banco: PostgreSQL (Supabase). Aplique com `supabase db push` ou no SQL editor.
-- RLS habilitado em todas as tabelas. service_role NUNCA vai ao frontend.
-- ============================================================================

-- Extensões ------------------------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";        -- busca textual

-- Perfis (1:1 com auth.users) -------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Papéis (RBAC global) --------------------------------------------------------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,   -- superadmin, church_admin, manager, ...
  name        text not null,
  description text
);

-- Permissões ------------------------------------------------------------------
create table if not exists public.permissions (
  id     uuid primary key default gen_random_uuid(),
  key    text not null unique,        -- ex.: events.manage
  label  text not null
);

-- Associação papel -> permissão ----------------------------------------------
create table if not exists public.role_permissions (
  role_id       uuid references public.roles (id) on delete cascade,
  permission_id uuid references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

-- Igrejas ---------------------------------------------------------------------
create table if not exists public.churches (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  description      text,
  denomination     text,
  logo_url         text,
  cover_url        text,
  email            text,
  phone            text,
  whatsapp         text,
  website          text,
  address          text,
  city             text,
  state            text,
  zip              text,
  lat              double precision,
  lng              double precision,
  status           text not null default 'active'
                     check (status in ('active', 'inactive')),
  approval_status  text not null default 'pending'
                     check (approval_status in ('pending','in_review','approved','rejected','suspended')),
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Membros: associação usuário <-> igreja com papel ----------------------------
create table if not exists public.church_members (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role_id     uuid not null references public.roles (id),
  status      text not null default 'active'
                check (status in ('active','invited','blocked')),
  created_at  timestamptz not null default now(),
  unique (church_id, user_id)
);

-- Permissões extras por membro (override granular dentro da igreja) -----------
create table if not exists public.member_permissions (
  member_id     uuid references public.church_members (id) on delete cascade,
  permission_id uuid references public.permissions (id) on delete cascade,
  granted       boolean not null default true,
  primary key (member_id, permission_id)
);

-- Auditoria -------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id),
  action      text not null,
  target      text,
  church_id   uuid references public.churches (id) on delete set null,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Configurações do sistema ----------------------------------------------------
create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Índices ---------------------------------------------------------------------
create index if not exists idx_church_members_user on public.church_members (user_id);
create index if not exists idx_church_members_church on public.church_members (church_id);
create index if not exists idx_churches_approval on public.churches (approval_status);
create index if not exists idx_audit_logs_church on public.audit_logs (church_id, created_at desc);

-- ============================================================================
-- Funções auxiliares de segurança (SECURITY DEFINER, search_path fixo)
-- ============================================================================

-- Igrejas às quais o usuário atual pertence (status ativo)
create or replace function public.current_church_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select church_id from public.church_members
  where user_id = auth.uid() and status = 'active';
$$;

-- O usuário atual é SuperAdmin?
create or replace function public.is_superadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.church_members cm
    join public.roles r on r.id = cm.role_id
    where cm.user_id = auth.uid()
      and cm.status = 'active'
      and r.key = 'superadmin'
  );
$$;

-- O usuário tem uma permissão dentro de uma igreja (via papel ou override)?
create or replace function public.has_church_permission(p_church uuid, p_perm text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_superadmin()
  or exists (
    select 1
    from public.church_members cm
    join public.roles r on r.id = cm.role_id
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where cm.church_id = p_church
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and p.key = p_perm
  );
$$;

-- Trigger de updated_at -------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_churches_updated on public.churches;
create trigger trg_churches_updated before update on public.churches
  for each row execute function public.touch_updated_at();

-- Cria perfil automaticamente ao registrar usuário ----------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
