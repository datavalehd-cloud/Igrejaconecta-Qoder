-- ============================================================================
-- IgrejaConecta — Fase 2: convites de membro e mudança de papel pela API
--
-- A tela de Usuários passou a ler o roster real (0007); agora ela também escreve.
-- Convidar por e-mail não cabe em `church_members`, porque `user_id` é NOT NULL e
-- referencia `profiles` — quem ainda não tem conta não tem linha para referenciar.
-- Daí uma tabela própria: o convite existe antes do usuário existir.
--
-- Segurança:
--   * RLS só deixa ler/escrever convite quem tem 'members.manage' NA igreja da
--     linha, e `invited_by` precisa ser o próprio autor (sem forjar quem convidou).
--   * Um convite nunca pode apontar para o papel `superadmin`: o mesmo buraco da
--     0005 (Administrador de igreja se promovendo e tomando a plataforma) voltaria
--     pela porta do convite — o convite viraria vínculo com papel global no aceite.
--   * O aceite é uma RPC SECURITY DEFINER porque o convidado ainda não tem vínculo
--     algum, então nenhuma política dele o deixaria escrever em church_members. Ela
--     só aceita convite cujo e-mail bate com o da sessão **confirmada** — senão
--     qualquer conta se aproveitaria de um convite aberto pelo e-mail de outra pessoa.
-- ============================================================================

create table if not exists public.church_invitations (
  id               uuid primary key default gen_random_uuid(),
  church_id        uuid not null references public.churches (id) on delete cascade,
  email            text not null,
  role_id          uuid not null references public.roles (id),
  status           text not null default 'pending'
                     check (status in ('pending','accepted','revoked','expired')),
  invited_by       uuid references public.profiles (id) on delete set null,
  accepted_user_id uuid references public.profiles (id) on delete set null,
  expires_at       timestamptz not null default now() + interval '30 days',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Um convite pendente por e-mail por igreja; revogado/expirado libera novo convite.
create unique index if not exists uq_invitation_pending
  on public.church_invitations (church_id, lower(email))
  where status = 'pending';

create index if not exists idx_church_invitations_church
  on public.church_invitations (church_id, status);

create index if not exists idx_church_invitations_email
  on public.church_invitations (lower(email));

drop trigger if exists trg_church_invitations_updated on public.church_invitations;
create trigger trg_church_invitations_updated before update on public.church_invitations
  for each row execute function public.touch_updated_at();

-- RLS ------------------------------------------------------------------------
alter table public.church_invitations enable row level security;

-- O e-mail de quem foi convidado é dado pessoal e enumeração de igreja: anon não
-- enxerga a tabela. Em projeto real o Supabase concede tudo a anon por default
-- privileges em tabelas novas de public, então o revoke é obrigatório.
revoke all on public.church_invitations from anon;
grant select, insert, update, delete on public.church_invitations to authenticated;

drop policy if exists church_invitations_read on public.church_invitations;
create policy church_invitations_read on public.church_invitations
  for select to authenticated using (
    public.is_superadmin() or public.has_church_permission(church_id, 'members.manage')
  );

drop policy if exists church_invitations_insert on public.church_invitations;
create policy church_invitations_insert on public.church_invitations
  for insert to authenticated with check (
    (public.is_superadmin() or public.has_church_permission(church_id, 'members.manage'))
    and invited_by = auth.uid()
  );

drop policy if exists church_invitations_update on public.church_invitations;
create policy church_invitations_update on public.church_invitations
  for update to authenticated using (
    public.is_superadmin() or public.has_church_permission(church_id, 'members.manage')
  ) with check (
    public.is_superadmin() or public.has_church_permission(church_id, 'members.manage')
  );

drop policy if exists church_invitations_delete on public.church_invitations;
create policy church_invitations_delete on public.church_invitations
  for delete to authenticated using (
    public.is_superadmin() or public.has_church_permission(church_id, 'members.manage')
  );

-- Papel superadmin não se concede por convite -------------------------------
create or replace function public.enforce_invitation_role_grant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  super_id uuid;
begin
  -- migrações, SQL Editor e service_role continuam autorizados
  if current_user <> 'authenticated' then
    return new;
  end if;

  select id into super_id from public.roles where key = 'superadmin';
  if super_id is null then
    return new;
  end if;

  if new.role_id = super_id and not public.is_superadmin() then
    raise exception 'apenas o SuperAdmin pode convidar para o papel superadmin'
      using errcode = '42501';
  end if;
  if TG_OP = 'UPDATE' and old.role_id = super_id and not public.is_superadmin() then
    raise exception 'apenas o SuperAdmin pode alterar um convite de superadmin'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_church_invitations_role on public.church_invitations;
create trigger trg_church_invitations_role
  before insert or update on public.church_invitations
  for each row execute function public.enforce_invitation_role_grant();

revoke execute on function public.enforce_invitation_role_grant() from public;

-- Convites endereçados ao e-mail da sessão ----------------------------------
-- DEFINER: o convidado não tem vínculo, então nenhuma política de select o
-- deixaria ler a linha. O filtro é pelo e-mail **confirmado** de auth.users.
create or replace function public.pending_invitations_for_me()
returns table (
  id          uuid,
  church_id   uuid,
  church_name text,
  church_slug text,
  email       text,
  role_key    text,
  role_name   text,
  invited_at  timestamptz,
  expires_at  timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select i.id, i.church_id, c.name, c.slug, i.email, r.key, r.name, i.created_at, i.expires_at
  from public.church_invitations i
  join public.churches c on c.id = i.church_id
  join public.roles r on r.id = i.role_id
  where i.status = 'pending'
    and i.expires_at > now()
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.email_confirmed_at is not null
        and lower(u.email) = lower(i.email)
    );
$$;

-- Aceitar convite: cria o vínculo e marca o convite --------------------------
create or replace function public.accept_church_invitation(p_invitation uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  inv       public.church_invitations%rowtype;
  super_id  uuid;
begin
  if auth.uid() is null then
    return 'sem_sessao';
  end if;

  select * into inv from public.church_invitations where id = p_invitation;
  if inv.id is null then
    return 'inexistente';
  end if;
  if inv.status <> 'pending' then
    return 'nao_pendente';
  end if;

  if inv.expires_at <= now() then
    update public.church_invitations set status = 'expired' where id = inv.id;
    return 'expirada';
  end if;

  -- o e-mail do convite precisa ser o da sessão, e confirmado
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = lower(inv.email)
  ) then
    return 'email_nao_confirmado';
  end if;

  -- segunda trava: mesmo um convite criado no braço (SQL Editor/service_role)
  -- não vira vínculo com papel global
  select id into super_id from public.roles where key = 'superadmin';
  if super_id is not null and inv.role_id = super_id then
    return 'papel_bloqueado';
  end if;

  insert into public.church_members (church_id, user_id, role_id, status)
  values (inv.church_id, auth.uid(), inv.role_id, 'active')
  on conflict (church_id, user_id) do nothing;

  update public.church_invitations
    set status = 'accepted', accepted_user_id = auth.uid()
    where id = inv.id;

  return 'aceito';
end;
$$;

-- Funções novas nascem com EXECUTE para PUBLIC (além do grant nomeado do
-- Supabase), então revoke só de "anon" não fecha nada: precisa tirar de public.
revoke execute on function public.pending_invitations_for_me() from public, anon;
revoke execute on function public.accept_church_invitation(uuid) from public, anon;
grant execute on function public.pending_invitations_for_me() to authenticated, service_role;
grant execute on function public.accept_church_invitation(uuid) to authenticated, service_role;
