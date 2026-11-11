-- ============================================================================
-- IgrejaConecta — Fase 1: fecha a escalada pelo papel superadmin
--
-- A suíte supabase/tests/database/rls_isolation.sql provou o seguinte caminho
-- (casos C13/C14/C15): um church_admin tem 'members.manage' na própria igreja,
-- o policy church_members_manage deixa gerenciar membros dali, e is_superadmin()
-- é GLOBAL (basta uma linha ativa com role 'superadmin' em qualquer igreja).
-- Bastava, então, um administrador se promover — ou promover um laranja — para
-- virar SuperAdmin da plataforma inteira.
--
-- A mesma política também permitia deletar/alterar a linha de um SuperAdmin
-- (derrubar a administração da plataforma a partir de dentro de uma igreja).
--
-- Regra: o papel 'superadmin' só pode ser atribuído, alterado ou removido por
-- quem JÁ é SuperAdmin (ou pelo backend / SQL Editor, onde não há contexto de
-- request autenticada). Não dá para resolver por policy porque RLS não olha o
-- valor anterior da linha nem a identidade do papel envolvido.
-- ============================================================================

create or replace function public.enforce_superadmin_role_grant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  super_id uuid;
begin
  -- Fora de request autenticada (migrações, SQL Editor, service_role) não há
  -- o que escalar: anon/authenticated continuam barrados pelas próprias
  -- políticas, que pedem members.manage na igreja.
  if current_user <> 'authenticated' then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  select id into super_id from public.roles where key = 'superadmin';
  if super_id is null then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  if TG_OP in ('INSERT', 'UPDATE') and new.role_id = super_id and not public.is_superadmin() then
    raise exception 'apenas o SuperAdmin pode atribuir o papel superadmin'
      using errcode = '42501';
  end if;

  if TG_OP in ('UPDATE', 'DELETE') and old.role_id = super_id and not public.is_superadmin() then
    raise exception 'apenas o SuperAdmin pode alterar ou remover um SuperAdmin'
      using errcode = '42501';
  end if;

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_church_members_superadmin on public.church_members;
create trigger trg_church_members_superadmin
  before insert or update or delete on public.church_members
  for each row execute function public.enforce_superadmin_role_grant();

revoke execute on function public.enforce_superadmin_role_grant() from public;
