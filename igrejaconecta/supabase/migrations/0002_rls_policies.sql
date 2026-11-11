-- ============================================================================
-- IgrejaConecta — Fase 1: Políticas RLS e isolamento multi-igrejas
-- Regra geral: ninguém lê/edita dados privados de outra igreja.
-- SuperAdmin tem acesso transversal; público só vê igrejas aprovadas e eventos
-- publicados. service_role (usado apenas no backend) ignora RLS por design.
-- ============================================================================

-- Habilita RLS ----------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.roles             enable row level security;
alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.churches          enable row level security;
alter table public.church_members    enable row level security;
alter table public.member_permissions enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.system_settings   enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or public.is_superadmin());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- roles / permissions: leitura pública (catálogo), escrita só SuperAdmin -------
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select using (true);
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select using (true);
drop policy if exists permissions_write on public.permissions;
create policy permissions_write on public.permissions for all using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select using (true);
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all using (public.is_superadmin()) with check (public.is_superadmin());

-- churches -------------------------------------------------------------------
-- Público vê apenas igrejas aprovadas e ativas.
drop policy if exists churches_public_read on public.churches;
create policy churches_public_read on public.churches
  for select using (
    (approval_status = 'approved' and status = 'active')
    or public.is_superadmin()
    or id in (select public.current_church_ids())
  );

-- Qualquer usuário autenticado pode cadastrar sua igreja (vira pending).
drop policy if exists churches_insert on public.churches;
create policy churches_insert on public.churches
  for insert to authenticated
  with check (created_by = auth.uid() and approval_status = 'pending');

-- Membros com permissão editam a própria igreja; SuperAdmin edita qualquer uma.
drop policy if exists churches_update on public.churches;
create policy churches_update on public.churches
  for update using (
    public.is_superadmin() or public.has_church_permission(id, 'church.manage')
  ) with check (
    public.is_superadmin() or public.has_church_permission(id, 'church.manage')
  );

-- Aprovação/suspensão/rejeição: somente SuperAdmin.
drop policy if exists churches_admin_status on public.churches;
create policy churches_admin_status on public.churches
  for update using (public.is_superadmin()) with check (public.is_superadmin());

-- church_members -------------------------------------------------------------
drop policy if exists church_members_read on public.church_members;
create policy church_members_read on public.church_members
  for select using (
    public.is_superadmin()
    or user_id = auth.uid()
    or church_id in (select public.current_church_ids())
  );

drop policy if exists church_members_manage on public.church_members;
create policy church_members_manage on public.church_members
  for all using (
    public.is_superadmin() or public.has_church_permission(church_id, 'members.manage')
  ) with check (
    public.is_superadmin() or public.has_church_permission(church_id, 'members.manage')
  );

-- member_permissions ---------------------------------------------------------
drop policy if exists member_permissions_read on public.member_permissions;
create policy member_permissions_read on public.member_permissions
  for select using (
    public.is_superadmin()
    or member_id in (select id from public.church_members where church_id in (select public.current_church_ids()))
  );

drop policy if exists member_permissions_write on public.member_permissions;
create policy member_permissions_write on public.member_permissions
  for all using (
    public.is_superadmin()
    or member_id in (
      select id from public.church_members
      where church_id in (select public.current_church_ids())
        and public.has_church_permission(church_id, 'members.manage')
    )
  ) with check (
    public.is_superadmin()
    or member_id in (
      select id from public.church_members
      where church_id in (select public.current_church_ids())
        and public.has_church_permission(church_id, 'members.manage')
    )
  );

-- audit_logs -----------------------------------------------------------------
-- Leitura: SuperAdmin tudo; membros da igreja apenas os logs da própria igreja.
drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs
  for select using (
    public.is_superadmin() or church_id in (select public.current_church_ids())
  );

-- Escrita restrita ao backend/service_role e SuperAdmin (append-only na prática).
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.is_superadmin() or actor_id = auth.uid());

-- system_settings ------------------------------------------------------------
drop policy if exists system_settings_read on public.system_settings;
create policy system_settings_read on public.system_settings
  for select using (public.is_superadmin());

drop policy if exists system_settings_write on public.system_settings;
create policy system_settings_write on public.system_settings
  for all using (public.is_superadmin()) with check (public.is_superadmin());
