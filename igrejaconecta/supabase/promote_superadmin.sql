-- ============================================================================
-- Promove datavalehd@gmail.com a superadmin da plataforma.
--
-- Onde rodar: Supabase Studio do projeto dlucvyjxidrfyjwuouvp → SQL Editor →
-- colar este arquivo inteiro → Run. (A guarda da migração 0005 só permite
-- atribuir 'superadmin' via SQL Editor / quem já é superadmin.)
--
-- TOTALMENTE AUTÔNOMO — não depende de você criar igreja pelo site:
--   1. Se já tem associação ativa em alguma igreja → promove a existente.
--   2. Se criou igreja mas ficou sem vínculo (trigger 0006 pulou) → reanexa.
--   3. Se NÃO tem igreja nenhuma → cria uma igreja administrativa 'pending'
--      (invisível na listagem pública, que só mostra 'approved') e anexa você
--      como superadmin nela.
--
-- Idempotente: pode rodar de novo sem efeito colateral.
-- ============================================================================

begin;

-- Garante que os papéis existem (seed.sql pode não ter sido aplicado).
insert into public.roles (key, name, description) values
  ('superadmin',   'SuperAdmin',              'Administração global da plataforma'),
  ('church_admin', 'Administrador da igreja', 'Gerencia totalmente a própria igreja')
on conflict (key) do nothing;

do $$
declare
  v_user   uuid;
  v_role   uuid;
  v_member uuid;
  v_church uuid;
begin
  select id into v_user
    from public.profiles
   where lower(email) = 'datavalehd@gmail.com';

  if v_user is null then
    raise exception 'Conta datavalehd@gmail.com nao encontrada em profiles. Crie a conta no site (Criar conta) e rode este script de novo.';
  end if;

  select id into v_role from public.roles where key = 'superadmin';

  -- Cenário 1: associação ativa existente → promove e termina.
  select id into v_member
    from public.church_members
   where user_id = v_user
     and status = 'active'
   limit 1;

  if v_member is not null then
    update public.church_members set role_id = v_role where id = v_member;
    raise notice 'OK (cenário 1): associação % promovida a superadmin', v_member;
    return;
  end if;

  -- Cenário 2: igreja já criada por você (mesmo sem vínculo).
  select id into v_church
    from public.churches
   where created_by = v_user
   order by created_at
   limit 1;

  -- Cenário 3: nenhuma igreja → cria uma administrativa 'pending'.
  if v_church is null then
    insert into public.churches (name, slug, created_by, status, approval_status)
    values ('Administração IgrejaConecta',
            'igrejaconecta-admin-' || left(v_user::text, 8),
            v_user, 'active', 'pending')
    returning id into v_church;
    raise notice 'OK (cenário 3): igreja administrativa criada %', v_church;
  end if;

  -- Anexa (ou corrige) o vínculo como superadmin. O trigger 0006 pode já ter
  -- criado church_admin ao inserir a igreja; o on conflict garante superadmin.
  insert into public.church_members (church_id, user_id, role_id, status)
  values (v_church, v_user, v_role, 'active')
  on conflict (church_id, user_id)
  do update set role_id = v_role, status = 'active';

  raise notice 'OK: datavalehd@gmail.com é superadmin (igreja %)', v_church;
end $$;

commit;
