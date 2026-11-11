-- ============================================================================
-- IgrejaConecta — Fase 1: endurecimento de RLS (resultados dos testes de isolamento)
--
-- Dois defeitos encontrados ao escrever a suíte `supabase/tests/database/rls_isolation.sql`:
--
-- 1) Autoaprovação. Em `churches` coexistiam `churches_update` (membro com
--    'church.manage') e `churches_admin_status` (SuperAdmin). Políticas PERMISSIVE
--    são combinadas por OU, então o administrador da própria igreja conseguia
--    escrever em `approval_status` e se aprovar sem o SuperAdmin. RLS não faz
--    controle por coluna; a correção é um trigger que recusa a mudança de
--    `approval_status` para quem não é SuperAdmin.
--
-- 2) Forja de auditoria. `audit_logs_insert` aceitava `actor_id = auth.uid()`, ou
--    seja, qualquer usuário autenticado podia inventar registros de auditoria em
--    próprio nome. Auditoria passa a ser escrita somente pelo SuperAdmin via app
--    e pelo backend (service_role, que ignora RLS por design).
-- ============================================================================

-- 1) approval_status é coluna do SuperAdmin -----------------------------------
create or replace function public.enforce_church_approval_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- service_role (Edge Functions / jobs) continua autorizado: não há RLS nem
  -- auth.uid() nesse caminho, e a especificação delega a ele a escrita de sistema.
  if current_user = 'service_role' then
    return new;
  end if;

  if new.approval_status is distinct from old.approval_status
     and not public.is_superadmin() then
    raise exception 'approval_status só pode ser alterado pelo SuperAdmin'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_churches_approval_status on public.churches;
create trigger trg_churches_approval_status
  before update on public.churches
  for each row execute function public.enforce_church_approval_status();

-- 2) auditoria: escrita restrita ao SuperAdmin --------------------------------
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.is_superadmin());
