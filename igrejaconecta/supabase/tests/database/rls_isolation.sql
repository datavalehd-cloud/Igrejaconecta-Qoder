-- ============================================================================
-- IgrejaConecta — Fase 1: testes de RLS e isolamento entre igrejas
--
-- COMO RODAR
--   Local (sem Docker, Postgres real embarcado):  npm run test:rls
--   Projeto real (SQL Editor do Supabase):       cole este arquivo inteiro e execute.
--   Projeto real (CLI, com o projeto linkado):   supabase db query --linked -f supabase/tests/database/rls_isolation.sql
--
-- Pré-requisito no projeto real: migrações 0001..0020 + seed aplicadas. O arquivo
-- supabase/tests/local/shim_supabase.sql NÃO é necessário lá (auth.* e storage.*
-- já existem) e não deve ser executado num projeto Supabase.
--
-- O arquivo inteiro roda dentro de UMA transação e termina com ROLLBACK: nenhum
-- usuário, igreja ou objeto de teste fica no banco depois da execução.
-- Cada caso usa SAVEPOINT, então uma falha para o script com mensagem clara
-- (prefixo RLS-FALHA) e o restante nem roda — mais fácil de corrigir.
--
-- O que é medido: se um membro da igreja A consegue ler/escrever dados da
-- igreja B, se o público vaza roster/auditoria, e se papéis administrativos
-- conseguem escalar privilégio (autoaprovar a própria igreja, forjar auditoria).
--
-- Coberto: tabelas da Fase 1/2 (profiles, churches, church_members,
-- member_permissions, audit_logs, system_settings, catálogos) e storage, mais
-- event_categories e events da Fase 3 (grupo M), event_registrations com as
-- RPCs de inscrição, check-in e cancelamento (grupo N), church_branches e
-- localização da Fase 4 (grupo O) e marketing_campaigns da Fase 5 (grupo P).
-- Da rodada "sem modo demo": ministérios e redes sociais da igreja (grupo Q),
-- favoritos e preferências do visitante (grupo R), redes de igrejas (grupo S),
-- suporte com tickets e mensagens (grupo T) e eventos de segurança (grupo U).
-- ============================================================================

begin;

-- Permite "set local role" para os papéis do Supabase a partir do usuário dono
-- da conexão (postgres no SQL Editor). Revertido no ROLLBACK final.
do $$
begin
  execute format('grant anon to %I', current_user);
  execute format('grant authenticated to %I', current_user);
  execute format('grant service_role to %I', current_user);
exception when insufficient_privilege or undefined_object then
  raise notice 'aviso: papéis já disponíveis (grant ignorado)';
end $$;

-- ============================================================================
-- Fixtures (identifiers fixos, guardados em GUCs app.* para os casos lerem)
-- ============================================================================

select set_config('app.user_a1',  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('app.user_a2',  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', false);
select set_config('app.user_b1',  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', false);
select set_config('app.user_su',  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', false);
select set_config('app.user_out', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
select set_config('app.church_a', '11111111-1111-4111-8111-111111111111', false);
select set_config('app.church_b', '22222222-2222-4222-8222-222222222222', false);
select set_config('app.church_c', '33333333-3333-4333-8333-333333333333', false);
select set_config('app.church_d', '44444444-4444-4444-8444-444444444444', false);
select set_config('app.church_e', '55555555-5555-4555-8555-555555555555', false);

-- Usuários: o trigger handle_new_user (0001) cria o profile junto.
insert into auth.users (id, email, raw_user_meta_data) values
  (current_setting('app.user_a1')::uuid,  'a1@igreja-a.test',  '{"full_name":"Administrador A"}'::jsonb),
  (current_setting('app.user_a2')::uuid,  'a2@igreja-a.test',  '{"full_name":"Gerente A"}'::jsonb),
  (current_setting('app.user_b1')::uuid,  'b1@igreja-b.test',  '{"full_name":"Administrador B"}'::jsonb),
  (current_setting('app.user_su')::uuid,  'su@igrejaconecta.app', '{"full_name":"SuperAdmin"}'::jsonb),
  (current_setting('app.user_out')::uuid, 'fora@exemplo.test', '{"full_name":"Sem Vinculo"}'::jsonb);

-- created_by fica NULL de propósito: os vínculos dos fixtures são todos
-- declarados no insert seguinte, então nenhum caso depende da 0006 exceto o
-- grupo G — que é justamente quem prova que o trigger de attachment funciona.
insert into public.churches (id, name, slug, approval_status, status, created_by) values
  (current_setting('app.church_a')::uuid, 'Igreja Teste A', 'teste-a', 'approved', 'active',   null),
  (current_setting('app.church_b')::uuid, 'Igreja Teste B', 'teste-b', 'approved', 'active',   null),
  (current_setting('app.church_c')::uuid, 'Igreja Teste C', 'teste-c', 'pending',  'inactive', null),
  -- D: pending E gerenciada pelo a1 — única forma de exercitar a autoaprovação
  -- (em A o valor não mudaria, e o trigger só age quando approval_status muda).
  (current_setting('app.church_d')::uuid, 'Igreja Teste D', 'teste-d', 'pending',  'inactive', null);

-- Vinculos explicitos: com created_by NULL a 0006 não anexa ninguém, então estes
-- inserts são a única origem dos papéis dos fixtures. O que importa aqui é o par
-- a1 (church_admin em A) / a2 (manager em A) — a diferença de permissão entre os
-- dois é o que os grupos A..H tentam romper — e o su como superadmin global.
insert into public.church_members (church_id, user_id, role_id, status) values
  (current_setting('app.church_a')::uuid, current_setting('app.user_a1')::uuid, (select id from public.roles where key = 'church_admin'), 'active'),
  (current_setting('app.church_a')::uuid, current_setting('app.user_a2')::uuid, (select id from public.roles where key = 'manager'),      'active'),
  (current_setting('app.church_b')::uuid, current_setting('app.user_b1')::uuid, (select id from public.roles where key = 'church_admin'), 'active'),
  (current_setting('app.church_d')::uuid, current_setting('app.user_a1')::uuid, (select id from public.roles where key = 'church_admin'), 'active'),
  (current_setting('app.church_a')::uuid, current_setting('app.user_su')::uuid, (select id from public.roles where key = 'superadmin'),   'active')
on conflict (church_id, user_id) do nothing;

insert into public.audit_logs (actor_id, action, target, church_id) values
  (current_setting('app.user_a1')::uuid, 'igreja.editada',   'church_a', current_setting('app.church_a')::uuid),
  (current_setting('app.user_b1')::uuid, 'igreja.editada',   'church_b', current_setting('app.church_b')::uuid),
  (null,                                  'plataforma.boot',  'system',   null);

insert into public.member_permissions (member_id, permission_id, granted)
select cm.id, p.id, true
from public.church_members cm
join public.permissions p on p.key = 'reports.view'
where cm.user_id = current_setting('app.user_a2')::uuid;

-- Storage: pasta = uuid da igreja (convenção da 0003).
insert into storage.objects (bucket_id, name, owner) values
  ('church-logos',     current_setting('app.church_a') || '/logo.png',   current_setting('app.user_a1')::uuid),
  ('church-covers',    current_setting('app.church_a') || '/capa.jpg',   current_setting('app.user_a1')::uuid),
  ('church-documents', current_setting('app.church_a') || '/ata.pdf',    current_setting('app.user_a1')::uuid),
  ('church-gallery',   current_setting('app.church_a') || '/culto.jpg',  current_setting('app.user_a1')::uuid),
  ('church-documents', current_setting('app.church_b') || '/ata.pdf',    current_setting('app.user_b1')::uuid),
  ('church-gallery',   current_setting('app.church_b') || '/culto.jpg',  current_setting('app.user_b1')::uuid);

-- ============================================================================
-- Helpers de contexto: troca de usuário dentro de um caso
-- ============================================================================
-- Uso:  set local role authenticated;
--       select set_config('request.jwt.claims', ..., true);
-- ...e no fim do caso: rollback to savepoint <caso>;

-- ---------------------------------------------------------------------------
-- GRUPO A — visitante anônimo não vê nada privado
-- ---------------------------------------------------------------------------

savepoint a1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.churches;
  if n <> 2 then raise exception 'RLS-FALHA A1: anon deveria ver só as 2 igrejas aprovadas, viu %', n; end if;
  if exists (select 1 from public.churches where approval_status = 'pending') then
    raise exception 'RLS-FALHA A1: anon viu uma igreja pendente';
  end if;
end $$;
rollback to savepoint a1;

savepoint a2;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.church_members;
  if n <> 0 then raise exception 'RLS-FALHA A2: anon leu % linhas de church_members (roster vazado)', n; end if;
  select count(*) into n from public.profiles;
  if n <> 0 then raise exception 'RLS-FALHA A3: anon leu % profiles', n; end if;
  select count(*) into n from public.audit_logs;
  if n <> 0 then raise exception 'RLS-FALHA A4: anon leu % audit_logs', n; end if;
  select count(*) into n from public.system_settings;
  if n <> 0 then raise exception 'RLS-FALHA A4: anon leu % system_settings', n; end if;
end $$;
rollback to savepoint a2;

savepoint a5;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare r int; p int;
begin
  -- Catálogo RBAC é leitura pública: é o que a UI usa para rotular papéis.
  select count(*) into r from public.roles;
  select count(*) into p from public.permissions;
  if r < 6 or p < 11 then raise exception 'RLS-FALHA A5: catalogo RBAC vazio para anon (roles=%, permissions=%)', r, p; end if;
end $$;
rollback to savepoint a5;

-- ---------------------------------------------------------------------------
-- GRUPO B — leitura cruzada entre igrejas (membro da igreja A)
-- ---------------------------------------------------------------------------

savepoint b1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.churches;
  if n <> 3 then raise exception 'RLS-FALHA B1: a1 deveria ver 3 igrejas (A,B + a propria D pendente), viu %', n; end if;
  if exists (select 1 from public.churches where id = current_setting('app.church_c')::uuid) then
    raise exception 'RLS-FALHA B1: a1 viu a igreja pendente C, que nao e sua';
  end if;
end $$;
rollback to savepoint b1;

savepoint b2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; other int;
begin
  select count(*) into n from public.church_members;
  if n <> 4 then raise exception 'RLS-FALHA B2: a1 deveria ver 4 membros (3 da igreja A + o proprio na D), viu %', n; end if;
  select count(*) into other from public.church_members where church_id = current_setting('app.church_b')::uuid;
  if other <> 0 then raise exception 'RLS-FALHA B2: a1 leu % membros da igreja B', other; end if;
end $$;
rollback to savepoint b2;

savepoint b3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'RLS-FALHA B3: a1 deveria ver apenas o proprio profile, viu %', n; end if;
  if not exists (select 1 from public.profiles where id = current_setting('app.user_a1')::uuid) then
    raise exception 'RLS-FALHA B3: a1 nao consegue ler o proprio profile (quebra o login)';
  end if;
  if exists (select 1 from public.profiles where id = current_setting('app.user_b1')::uuid) then
    raise exception 'RLS-FALHA B3: a1 leu o profile de b1';
  end if;
end $$;
rollback to savepoint b3;

savepoint b4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.audit_logs where church_id = current_setting('app.church_b')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA B4: a1 leu % audit_logs da igreja B', n; end if;
  select count(*) into n from public.audit_logs;
  if n <> 1 then raise exception 'RLS-FALHA B4: a1 deveria ver 1 audit_log (igreja A), viu %', n; end if;
end $$;
rollback to savepoint b4;

savepoint b5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.member_permissions;
  if n <> 1 then raise exception 'RLS-FALHA B5: a1 deveria ver 1 member_permission (igreja A), viu %', n; end if;
end $$;
rollback to savepoint b5;

savepoint b6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  if exists (select 1 from public.churches where approval_status = 'pending') then
    raise exception 'RLS-FALHA B6: usuario sem vinculo viu igreja pendente';
  end if;
  select count(*) into n from public.church_members;
  if n <> 0 then raise exception 'RLS-FALHA B6: sem vinculo leu % church_members', n; end if;
  select count(*) into n from public.audit_logs;
  if n <> 0 then raise exception 'RLS-FALHA B6: sem vinculo leu % audit_logs', n; end if;
  select count(*) into n from public.system_settings;
  if n <> 0 then raise exception 'RLS-FALHA B6: sem vinculo leu % system_settings', n; end if;
end $$;
rollback to savepoint b6;

savepoint b7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.churches;
  if n <> 4 then raise exception 'RLS-FALHA B7: superadmin deveria ver as 4 igrejas, viu %', n; end if;
  select count(*) into n from public.church_members;
  if n <> 5 then raise exception 'RLS-FALHA B7: superadmin deveria ver 5 membros, viu %', n; end if;
  select count(*) into n from public.profiles;
  if n <> 5 then raise exception 'RLS-FALHA B7: superadmin deveria ver 5 profiles, viu %', n; end if;
  select count(*) into n from public.system_settings;
  if n <> 2 then raise exception 'RLS-FALHA B7: superadmin deveria ver 2 system_settings, viu %', n; end if;
end $$;
rollback to savepoint b7;

-- ---------------------------------------------------------------------------
-- GRUPO C — escrita cruzada e escalada de privilégio
-- ---------------------------------------------------------------------------

-- C1/C2/C3: church_members só com members.manage na MESMA igreja.
savepoint c1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    insert into public.church_members (church_id, user_id, role_id, status)
    values (current_setting('app.church_b')::uuid, current_setting('app.user_out')::uuid,
            (select id from public.roles where key = 'manager'), 'active');
    raise exception 'RLS-FALHA C1: a1 inseriu membro na igreja B';
  exception when insufficient_privilege then null;  -- esperado
  end;
end $$;
rollback to savepoint c1;

savepoint c2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$ begin
  begin
    insert into public.church_members (church_id, user_id, role_id, status)
    values (current_setting('app.church_a')::uuid, current_setting('app.user_out')::uuid,
            (select id from public.roles where key = 'communicator'), 'active');
    raise exception 'RLS-FALHA C2: manager (sem members.manage) inseriu membro na propria igreja';
  exception when insufficient_privilege then null;  -- esperado
  end;
end $$;
rollback to savepoint c2;

savepoint c3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  insert into public.church_members (church_id, user_id, role_id, status)
  values (current_setting('app.church_a')::uuid, current_setting('app.user_out')::uuid,
          (select id from public.roles where key = 'communicator'), 'invited');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C3: church_admin nao conseguiu convidar membro na propria igreja'; end if;
end $$;
rollback to savepoint c3;

-- C4: não renomeia igreja alheia.
savepoint c4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  update public.churches set name = 'INVAIDADA' where id = current_setting('app.church_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C4: a1 atualizou a igreja B (% linhas)', n; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.churches where name = 'INVAIDADA') then
    raise exception 'RLS-FALHA C4: nome da igreja B foi alterado';
  end if;
end $$;
rollback to savepoint c4;

-- C5/C6/C7: approval_status é do SuperAdmin (correção da migração 0004).
savepoint c5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  update public.churches set approval_status = 'approved' where id = current_setting('app.church_c')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C5: a1 aprovou a igreja C de outro criador (% linhas)', n; end if;
end $$;
rollback to savepoint c5;

savepoint c6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    update public.churches set approval_status = 'approved' where id = current_setting('app.church_d')::uuid;
    raise exception 'RLS-FALHA C6: a1 autoaprovou a propria igreja pendente (escalada de privilegio)';
  exception
    when insufficient_privilege then null;                      -- trigger 0004 (errcode 42501): esperado
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;          -- nossa mensagem: propaga
      null;                                                     -- trigger sem errcode tambem vale
  end;
end $$;
reset role;
do $$ begin
  if (select approval_status from public.churches where id = current_setting('app.church_d')::uuid) <> 'pending' then
    raise exception 'RLS-FALHA C6: a igreja D deixou de estar pendente';
  end if;
end $$;
rollback to savepoint c6;

savepoint c7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C7: superadmin nao conseguiu suspender igreja (% linhas)', n; end if;
end $$;
rollback to savepoint c7;

-- C8: profile alheio não é editável.
savepoint c8;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  update public.profiles set full_name = 'FALSIFICADO' where id = current_setting('app.user_b1')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C8: a1 editou profile de b1 (% linhas)', n; end if;
  update public.profiles set full_name = 'Administrador A' where id = current_setting('app.user_a1')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C8: a1 nao conseguiu editar o proprio profile'; end if;
end $$;
rollback to savepoint c8;

-- C9: auditoria não é forjável por usuário comum (correção da 0004).
savepoint c9;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    insert into public.audit_logs (actor_id, action, target, church_id)
    values (current_setting('app.user_a1')::uuid, 'falso', 'forjamento', current_setting('app.church_a')::uuid);
    raise exception 'RLS-FALHA C9: usuario comum escreveu em audit_logs sobre si mesmo';
  exception when insufficient_privilege then null;  -- esperado
  end;
  begin
    insert into public.audit_logs (actor_id, action, target, church_id)
    values (current_setting('app.user_out')::uuid, 'falso', 'terceiro', current_setting('app.church_b')::uuid);
    raise exception 'RLS-FALHA C9: usuario comum escreveu audit_logs de outra pessoa/igreja';
  exception when insufficient_privilege then null;  -- esperado
  end;
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.audit_logs;
  if n <> 3 then raise exception 'RLS-FALHA C9: audit_logs tem % linhas apos tentativas de forjamento (esperado 3)', n; end if;
end $$;
rollback to savepoint c9;

-- C10: cadastro de igreja — própria pendente sim; aprovada ou em nome de outro, não.
savepoint c10;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  begin
    insert into public.churches (name, slug, approval_status, status, created_by)
    values ('Igreja Autoaprovada', 'auto-aprovada', 'approved', 'active', current_setting('app.user_out')::uuid);
    raise exception 'RLS-FALHA C10: usuario criou igreja ja aprovada';
  exception when insufficient_privilege then null;  -- esperado
  end;
  begin
    insert into public.churches (name, slug, approval_status, status, created_by)
    values ('Igreja Alheia', 'alheia', 'pending', 'active', current_setting('app.user_b1')::uuid);
    raise exception 'RLS-FALHA C10: usuario criou igreja em nome de outra pessoa';
  exception when insufficient_privilege then null;  -- esperado
  end;
  insert into public.churches (name, slug, approval_status, status, created_by)
  values ('Igreja Nova', 'igreja-nova', 'pending', 'inactive', current_setting('app.user_out')::uuid);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C10: criacao de igreja propria pendente falhou'; end if;
end $$;
rollback to savepoint c10;

-- C11: delete cruzado não acontece; o próprio convite da sua igreja pode ser removido.
savepoint c11;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  delete from public.church_members where church_id = current_setting('app.church_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C11: a1 removeu % membros da igreja B', n; end if;
  delete from public.church_members where church_id = current_setting('app.church_a')::uuid and user_id = current_setting('app.user_a2')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C11: church_admin nao conseguiu remover membro da propria igreja'; end if;
end $$;
rollback to savepoint c11;

-- C12: system_settings é do SuperAdmin.
savepoint c12;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  update public.system_settings set value = '{}'::jsonb where key = 'platform';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C12: a1 alterou system_settings (% linhas)', n; end if;
end $$;
rollback to savepoint c12;

-- C13/C14/C15: promover-se (ou a um laranja) a superadmin seria admin global da
-- plataforma; e remover o SuperAdmin existente derrubaria a administração.
savepoint c13;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    update public.church_members
       set role_id = (select id from public.roles where key = 'superadmin')
     where church_id = current_setting('app.church_a')::uuid
       and user_id = current_setting('app.user_a1')::uuid;
    raise exception 'RLS-FALHA C13: a1 promoveu a si mesmo a superadmin';
  exception when insufficient_privilege then null;   -- trigger 0005: esperado
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      null;
  end;
end $$;
reset role;
do $$
declare k text;
begin
  select r.key into k
  from public.church_members cm join public.roles r on r.id = cm.role_id
  where cm.church_id = current_setting('app.church_a')::uuid
    and cm.user_id = current_setting('app.user_a1')::uuid;
  if k <> 'church_admin' then raise exception 'RLS-FALHA C13: a1 terminou com papel %', k; end if;
end $$;
rollback to savepoint c13;

savepoint c14;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    insert into public.church_members (church_id, user_id, role_id, status)
    values (current_setting('app.church_a')::uuid, current_setting('app.user_out')::uuid,
            (select id from public.roles where key = 'superadmin'), 'active');
    raise exception 'RLS-FALHA C14: a1 criou um superadmin laranja na propria igreja';
  exception when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      null;
  end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.church_members
             where user_id = current_setting('app.user_out')::uuid) then
    raise exception 'RLS-FALHA C14: a linha do laranja foi criada';
  end if;
end $$;
rollback to savepoint c14;

savepoint c15;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    delete from public.church_members
     where user_id = current_setting('app.user_su')::uuid;
    raise exception 'RLS-FALHA C15: a1 removeu o SuperAdmin da plataforma';
  exception when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      null;
  end;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.church_members
                 where user_id = current_setting('app.user_su')::uuid) then
    raise exception 'RLS-FALHA C15: o vinculo do SuperAdmin deixou de existir';
  end if;
end $$;
rollback to savepoint c15;

-- C16: caminho legítimo — quem já é SuperAdmin pode atribuir o papel.
savepoint c16;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  insert into public.church_members (church_id, user_id, role_id, status)
  values (current_setting('app.church_b')::uuid, current_setting('app.user_out')::uuid,
          (select id from public.roles where key = 'superadmin'), 'active');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C16: SuperAdmin nao conseguiu atribuir o proprio papel'; end if;
end $$;
rollback to savepoint c16;

-- C17: o gerente (manager) da propria igreja nao edita o cadastro institucional.
-- A rota /app/igreja e a tela usam church.manage; aqui fica a prova de que o banco
-- nao deixa passar quando o app errar.
savepoint c17;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int;
begin
  update public.churches set name = 'RENOMEADA PELO GERENTE' where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C17: manager (a2) alterou o nome da igreja A (% linhas)', n; end if;
  update public.churches set description = 'DESCRICAO DO GERENTE' where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C17: manager (a2) alterou a descricao da igreja A (% linhas)', n; end if;
  update public.churches set city = 'OUTRA CIDADE' where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C17: manager (a2) alterou o endereco da igreja A (% linhas)', n; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.churches where id = current_setting('app.church_a')::uuid
             and (name <> 'Igreja Teste A' or description is not null or city is not null)) then
    raise exception 'RLS-FALHA C17: o cadastro da igreja A mudou pelas maos do gerente';
  end if;
end $$;
rollback to savepoint c17;

-- C18: caminho legítimo da tela — church_admin grava exatamente as colunas que o
-- perfil institucional escreve, e elas ficam. Anti-no-op: uma policy que aceita um
-- update genérico mas rejeita coluna por coluna nao passaria por aqui.
savepoint c18;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; rec record;
begin
  update public.churches
     set name = 'Igreja Teste A Editada',
         description = 'Descricao gravada pela tela',
         denomination = 'Batista',
         email = 'nova@igreja-a.test',
         phone = '35 3000-0000',
         whatsapp = '5535900000000',
         website = 'igrejatestea.test',
         address = 'Rua B, 200',
         city = 'Jacutinga',
         state = 'MG',
         zip = '37590-000',
         lat = -23.1857,
         lng = -45.8871
   where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C18: church_admin (a1) nao gravou o cadastro da propria igreja (% linhas)', n; end if;

  select c.name, c.city, c.zip, c.lat, c.lng, c.slug, c.status, c.approval_status
    into rec from public.churches c where c.id = current_setting('app.church_a')::uuid;
  if rec.name <> 'Igreja Teste A Editada' or rec.city <> 'Jacutinga' or rec.zip <> '37590-000'
     or rec.lat <> -23.1857 or rec.lng <> -45.8871 then
    raise exception 'RLS-FALHA C18: as colunas da tela nao chegaram ao banco (name=%, city=%, lat=%)', rec.name, rec.city, rec.lat;
  end if;
  -- O update da tela nao toca nas colunas travadas: se alguma mudou, a escrita vazou.
  if rec.slug <> 'teste-a' or rec.status <> 'active' or rec.approval_status <> 'approved' then
    raise exception 'RLS-FALHA C18: o update mudou slug/status/aproval (slug=%, status=%, approval=%)', rec.slug, rec.status, rec.approval_status;
  end if;
end $$;
rollback to savepoint c18;

-- C19: em profiles a política é só a própria conta — o SuperAdmin não tem a
-- exceção de escrita que tem em tudo o mais (é o que a tela "Meu perfil" depende).
savepoint c19;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  update public.profiles set phone = 'FALSO' where id = current_setting('app.user_a1')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA C19: SuperAdmin editou o profile de a1 (% linhas)', n; end if;
  update public.profiles set full_name = 'SuperAdmin Novo', phone = '35 99999-0000' where id = current_setting('app.user_su')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA C19: SuperAdmin nao conseguiu gravar o proprio perfil'; end if;
end $$;
rollback to savepoint c19;

-- ---------------------------------------------------------------------------
-- GRUPO D — storage: pasta = igreja. Pulado se storage não existir.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'SKIPPED: schema storage ausente (rode este arquivo no projeto Supabase para testar D1-D3)';
  end if;
end $$;

savepoint d1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int; priv int;
begin
  if to_regclass('storage.objects') is null then return; end if;
  select count(*) into n from storage.objects;
  select count(*) into priv from storage.objects where bucket_id in ('church-documents','church-gallery');
  if n <> 2 or priv <> 0 then
    raise exception 'RLS-FALHA D1: anon leu % objetos (privados: %); deveria ver 2 publicos e 0 privados', n, priv;
  end if;
end $$;
rollback to savepoint d1;

savepoint d2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; other int;
begin
  if to_regclass('storage.objects') is null then return; end if;
  select count(*) into n from storage.objects where split_part(name, '/', 1) = current_setting('app.church_a');
  if n <> 4 then raise exception 'RLS-FALHA D2: a1 leu % objetos da propria igreja, esperava 4', n; end if;
  select count(*) into other from storage.objects where split_part(name, '/', 1) = current_setting('app.church_b');
  if other <> 0 then raise exception 'RLS-FALHA D2: a1 leu % objetos da igreja B', other; end if;
end $$;
rollback to savepoint d2;

savepoint d3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  if to_regclass('storage.objects') is null then return; end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('church-documents', current_setting('app.church_b') || '/intruso.pdf', current_setting('app.user_a1')::uuid);
    raise exception 'RLS-FALHA D3: a1 fez upload na pasta da igreja B';
  exception when insufficient_privilege then null;  -- esperado
  end;
  insert into storage.objects (bucket_id, name, owner)
  values ('church-documents', current_setting('app.church_a') || '/proprio.pdf', current_setting('app.user_a1')::uuid);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA D3: upload na propria igreja falhou'; end if;
end $$;
rollback to savepoint d3;

-- ---------------------------------------------------------------------------
-- GRUPO E — guardas estruturais (pegam tabela nova sem RLS no futuro)
-- ---------------------------------------------------------------------------

savepoint e1;
do $$
declare n int;
begin
  select count(*) into n
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
  if n <> 0 then raise exception 'RLS-FALHA E1: % tabelas de public sem RLS habilitado', n; end if;
end $$;
rollback to savepoint e1;

-- Definicao unica de "politica aberta", compartilhada pela sonda e pela guarda E2:
-- SELECT/UPDATE/DELETE/ALL sem USING ou com USING (true), em qualquer tabela de public
-- salvo o catalog de papeis/permissoes (deliberadamente publico) e o de categorias
-- de evento (0011), que pelo mesmo motivo e catalogo. Tabela nova (registrations...)
-- ja cai aqui sem editar o teste. INSERT fica de fora porque INSERT
-- nao tem USING (o que importa e WITH CHECK, e os casos C testam escrita).
-- `qual is null` conta: politica sem USING equivale a USING (true).
create temp view guard_open_policy as
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename not in ('roles','permissions','role_permissions','event_categories')
  and cmd in ('SELECT','UPDATE','DELETE','ALL')
  and (qual is null or trim(both ' ()' from qual) = 'true');

-- E2-sonda: a guarda nao pode virar no-op. Cria uma tabela descartavel com as duas
-- formas de politica aberta e exige que o predicate acima as enxergue. Um bug de NULL
-- nesse tipo de predicate deixa a suite "verde" com roster vazado -- foi exatamente o
-- que aconteceu com a guarda E3 (`NULL not like '%...%'` nunca e verdadeiro).
savepoint e2probe;
create table public.__guard_probe_e2 (id int);
alter table public.__guard_probe_e2 enable row level security;
create policy __probe_using_true on public.__guard_probe_e2 for select to authenticated using (true);
create policy __probe_no_using on public.__guard_probe_e2 for select to authenticated;
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad from guard_open_policy;
  if coalesce(bad, '') not like '%__probe_using_true%' or coalesce(bad, '') not like '%__probe_no_using%' then
    raise exception 'RLS-FALHA E2-sonda: guarda de politicas abertas esta cega (pegou: %)', coalesce(bad, 'nada');
  end if;
end $$;
rollback to savepoint e2probe;

savepoint e2;
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad from guard_open_policy;
  if bad is not null then raise exception 'RLS-FALHA E2: politica aberta (USING true ou sem USING) em tabela privada: %', bad; end if;
end $$;
rollback to savepoint e2;

-- Definicao unica de "definer desprotegido": QUALQUER funcao SECURITY DEFINER de public
-- sem search_path fixo. Funcionar assim (e nao por lista de nomes) pega funcao nova de
-- qualquer migracao futura. coalesce e obrigatorio: sem SET, proconfig e NULL, e
-- `NULL not like '%...%'` nunca e verdadeiro -- foi assim que a guarda antiga virou no-op.
create temp view guard_unpinned_definer as
select p.proname
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.prosecdef = true
  and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%';

-- E3-sonda: mesma ideia da sonda de E2. Cria um definer sem SET agora e exige que o
-- predicate acima o nombre; depois desfaz.
savepoint e3probe;
create function public.__guard_probe_e3()
returns int language sql security definer
as $$ select 1; $$;
do $$
declare bad text;
begin
  select string_agg(proname, ', ') into bad from guard_unpinned_definer;
  if coalesce(bad, '') not like '%__guard_probe_e3%' then
    raise exception 'RLS-FALHA E3-sonda: guarda de SECURITY DEFINER esta cega (pegou: %)', coalesce(bad, 'nada');
  end if;
end $$;
rollback to savepoint e3probe;

savepoint e3;
do $$
declare bad text; missing text;
declare wanted text[] = array['current_church_ids','is_superadmin','has_church_permission',
                              'attach_creator_as_admin','handle_new_user',
                              'pending_invitations_for_me','accept_church_invitation'];
begin
  select string_agg(proname, ', ') into bad from guard_unpinned_definer;
  if bad is not null then raise exception 'RLS-FALHA E3: funcao SECURITY DEFINER sem search_path fixo: %', bad; end if;

  -- uma das funcoes de seguranca renomeada, apagada ou sem DEFINER derruba a guarda
  select string_agg(f, ', ') into missing
  from unnest(wanted) f
  where not exists (
    select 1 from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = f and p.prosecdef = true);
  if missing is not null then
    raise exception 'RLS-FALHA E3: funcao de seguranca sumiu de public ou deixou de ser SECURITY DEFINER: %', missing;
  end if;
end $$;
rollback to savepoint e3;

-- E4: a porta de publicação de eventos (0011) tem de existir, ser SECURITY INVOKER
-- e estar ligada como BEFORE INSERT OR UPDATE OF status.
--
-- INVOKER não é detalhe: a função decide olhando `current_user = 'service_role'`,
-- e sob DEFINER `current_user` vira o dono da função — o backend perderia a saída
-- e nenhum evento publicado poderia ser gravado por ele. O search_path fixo é o
-- mesmo motivo do E3. Sem esta guarda, remover o trigger deixaria o grupo M verde
-- até o primeiro caso de publicação, e o M6 passaria a ser a única rede.
savepoint e4;
do $$
declare n int; definer boolean; pinned boolean;
begin
  select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
    into definer, pinned
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'enforce_event_publish';
  if not found then
    raise exception 'RLS-FALHA E4: funcao enforce_event_publish sumiu de public';
  end if;
  if definer then
    raise exception 'RLS-FALHA E4: enforce_event_publish virou SECURITY DEFINER — o current_user do backend deixaria de ser service_role';
  end if;
  if not pinned then
    raise exception 'RLS-FALHA E4: enforce_event_publish sem search_path fixo';
  end if;

  select count(*) into n
  from pg_trigger
  where tgrelid = 'public.events'::regclass and tgname = 'trg_events_publish'
    and tgfoid = 'public.enforce_event_publish()'::regprocedure
    and not tgisinternal
    -- bits de tgtype: ROW=1, BEFORE=2, INSERT=4, UPDATE=16
    and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 4) = 4 and (tgtype & 16) = 16;
  if n <> 1 then
    raise exception 'RLS-FALHA E4: trg_events_publish nao esta como BEFORE INSERT OR UPDATE OF status em public.events';
  end if;
end $$;
rollback to savepoint e4;

-- ---------------------------------------------------------------------------
-- GRUPO F — view church_roster (0007): nomes da própria igreja, sem vazar
-- ---------------------------------------------------------------------------

savepoint f1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_roster;
  if n <> 4 then raise exception 'RLS-FALHA F1: a1 viu % linhas de roster (esperado 4: A x3 + D x1)', n; end if;
  select count(*) into n from public.church_roster where user_id = current_setting('app.user_b1')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA F1: roster vazou membro da igreja B (% linhas)', n; end if;
  -- a1 e church_admin (tem members.manage), entao contatos aparecem para ele
  select count(*) into n from public.church_roster where email is null;
  if n <> 0 then raise exception 'RLS-FALHA F1: a1 gerencia a igreja e deveria ver os contatos (% linhas sem e-mail)', n; end if;
end $$;
rollback to savepoint f1;

savepoint f2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int;
begin
  -- manager na A: ve os nomes da propria igreja...
  select count(*) into n from public.church_roster where church_id = current_setting('app.church_a')::uuid;
  if n <> 3 then raise exception 'RLS-FALHA F2: a2 viu % linhas do roster da igreja A (esperado 3)', n; end if;
  -- ...mas nao os contatos, porque nao tem members.manage na A
  select count(*) into n from public.church_roster
   where church_id = current_setting('app.church_a')::uuid and email is not null;
  if n <> 0 then raise exception 'RLS-FALHA F2: a2 leu % e-mails de colegas sem members.manage', n; end if;
  select count(*) into n from public.church_roster where church_id = current_setting('app.church_b')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA F2: a2 leu roster da igreja B (% linhas)', n; end if;
end $$;
rollback to savepoint f2;

savepoint f3;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.church_roster;
    raise exception 'RLS-FALHA F3: anon leu a view de roster';
  exception when insufficient_privilege then null;      -- revoke da 0007: esperado
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      null;
  end;
end $$;
rollback to savepoint f3;

savepoint f4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_roster;
  if n <> 1 then raise exception 'RLS-FALHA F4: b1 viu % linhas de roster (esperado 1, so a igreja B)', n; end if;
  if exists (select 1 from public.church_roster where user_id = current_setting('app.user_a1')::uuid) then
    raise exception 'RLS-FALHA F4: b1 leu membro da igreja A no roster';
  end if;
end $$;
rollback to savepoint f4;

savepoint f5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_roster;
  if n <> 5 then raise exception 'RLS-FALHA F5: superadmin viu % linhas de roster (esperado 5, todas as igrejas)', n; end if;
end $$;
rollback to savepoint f5;

-- ---------------------------------------------------------------------------
-- GRUPO G — onboarding do criador (0006): usar a propria igreja, sem virar admin
-- ---------------------------------------------------------------------------

savepoint g1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  insert into public.churches (id, name, slug, approval_status, status, created_by)
  values (current_setting('app.church_e')::uuid, 'Igreja Teste E', 'teste-e', 'pending', 'inactive',
          current_setting('app.user_out')::uuid);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA G1: cadastro da propria igreja falhou (% linhas)', n; end if;
end $$;
reset role;
do $$
declare k text;
begin
  select r.key into k
  from public.church_members cm join public.roles r on r.id = cm.role_id
  where cm.church_id = current_setting('app.church_e')::uuid
    and cm.user_id = current_setting('app.user_out')::uuid;
  if k is null then raise exception 'RLS-FALHA G1: criador ficou sem vinculo na propria igreja (onboarding quebrado)'; end if;
  if k <> 'church_admin' then raise exception 'RLS-FALHA G1: criador terminou com papel % (esperado church_admin)', k; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.churches where id = current_setting('app.church_e')::uuid;
  if n <> 1 then raise exception 'RLS-FALHA G2: criador nao enxerga a propria igreja pendente (% linhas)', n; end if;
  update public.churches set name = 'Igreja Teste E editada' where id = current_setting('app.church_e')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA G2: criador nao conseguiu editar a propria igreja (% linhas)', n; end if;
  select count(*) into n from public.church_roster;
  if n <> 1 then raise exception 'RLS-FALHA G2: roster do criador mostra % linhas (esperado 1)', n; end if;
end $$;
do $$
declare n int;
begin
  select count(*) into n from public.system_settings;
  if n <> 0 then raise exception 'RLS-FALHA G3: criador virou admin da plataforma (% system_settings)', n; end if;
  select count(*) into n from public.churches;
  if n <> 3 then raise exception 'RLS-FALHA G3: criador ve % igrejas (esperado 3: A, B publicas + a propria E)', n; end if;
  if exists (select 1 from public.churches where id = current_setting('app.church_c')::uuid) then
    raise exception 'RLS-FALHA G3: criador viu a igreja pendente de outra pessoa';
  end if;
  if exists (select 1 from public.churches where id = current_setting('app.church_d')::uuid) then
    raise exception 'RLS-FALHA G3: criador viu a igreja pendente de outra pessoa (D)';
  end if;
end $$;
do $$ begin
  begin
    update public.church_members
       set role_id = (select id from public.roles where key = 'superadmin')
     where church_id = current_setting('app.church_e')::uuid
       and user_id = current_setting('app.user_out')::uuid;
    raise exception 'RLS-FALHA G4: criador se promoveu a superadmin na propria igreja';
  exception when insufficient_privilege then null;      -- trigger da 0005: esperado
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      null;
  end;
end $$;
rollback to savepoint g1;

-- ---------------------------------------------------------------------------
-- GRUPO H — convites e mudança de papel (0008): escrever sem escalar
-- ---------------------------------------------------------------------------

-- H1: quem tem members.manage cria convite na própria igreja.
savepoint h1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  insert into public.church_invitations (church_id, email, role_id, invited_by)
  values (current_setting('app.church_a')::uuid, 'convidado-h1@exemplo.test',
          (select id from public.roles where key = 'communicator'), current_setting('app.user_a1')::uuid);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA H1: a1 nao criou convite na propria igreja (% linhas)', n; end if;
end $$;
reset role;
do $$
declare st text; ib uuid;
begin
  select status, invited_by into st, ib from public.church_invitations
   where church_id = current_setting('app.church_a')::uuid and email = 'convidado-h1@exemplo.test';
  if st is null then raise exception 'RLS-FALHA H1: convite nao chegou ao banco'; end if;
  if st <> 'pending' then raise exception 'RLS-FALHA H1: convite nasceu com status %', st; end if;
  if ib <> current_setting('app.user_a1')::uuid then raise exception 'RLS-FALHA H1: invited_by gravado errado'; end if;
end $$;
rollback to savepoint h1;

-- H2: gerente sem members.manage não cria convite nem na própria igreja.
savepoint h2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$ begin
  begin
    insert into public.church_invitations (church_id, email, role_id, invited_by)
    values (current_setting('app.church_a')::uuid, 'convidado-h2@exemplo.test',
            (select id from public.roles where key = 'communicator'), current_setting('app.user_a2')::uuid);
    raise exception 'RLS-FALHA H2: gerente sem members.manage criou convite';
  exception when insufficient_privilege then null;      -- WITH CHECK da 0008: esperado
  end;
end $$;
rollback to savepoint h2;

-- H3: convite em outra igreja.
savepoint h3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    insert into public.church_invitations (church_id, email, role_id, invited_by)
    values (current_setting('app.church_b')::uuid, 'convidado-h3@exemplo.test',
            (select id from public.roles where key = 'communicator'), current_setting('app.user_a1')::uuid);
    raise exception 'RLS-FALHA H3: a1 criou convite na igreja B';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback to savepoint h3;

-- H4: convite para o papel superadmin (a mesma tomada de plataforma da 0005,
-- agora pela porta do convite).
savepoint h4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    insert into public.church_invitations (church_id, email, role_id, invited_by)
    values (current_setting('app.church_a')::uuid, 'convidado-h4@exemplo.test',
            (select id from public.roles where key = 'superadmin'), current_setting('app.user_a1')::uuid);
    raise exception 'RLS-FALHA H4: a1 criou convite para o papel superadmin';
  exception when insufficient_privilege then null;      -- trigger 0008: esperado
  end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.church_invitations where email = 'convidado-h4@exemplo.test') then
    raise exception 'RLS-FALHA H4: convite de superadmin existe no banco';
  end if;
end $$;
rollback to savepoint h4;

-- H5: forjar quem convidou.
savepoint h5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    insert into public.church_invitations (church_id, email, role_id, invited_by)
    values (current_setting('app.church_a')::uuid, 'convidado-h5@exemplo.test',
            (select id from public.roles where key = 'communicator'), current_setting('app.user_b1')::uuid);
    raise exception 'RLS-FALHA H5: a1 gravou invited_by de outra pessoa';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback to savepoint h5;

-- H6: anon não lê convite nem pede convite para si.
savepoint h6;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.church_invitations;
    raise exception 'RLS-FALHA H6: anon leu church_invitations';
  exception
    when insufficient_privilege then null;              -- revoke da 0008: esperado
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      null;
  end;
  begin
    perform count(*) from public.pending_invitations_for_me();
    raise exception 'RLS-FALHA H6: anon executou pending_invitations_for_me';
  exception
    when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      null;
  end;
end $$;
rollback to savepoint h6;

-- H7: aceite legítimo — o convidado vira membro com o papel do convite.
savepoint h7;
insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7', 'convidado-h7@exemplo.test', '{"full_name":"Convidado H7"}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
insert into public.church_invitations (church_id, email, role_id, invited_by)
values (current_setting('app.church_a')::uuid, 'convidado-h7@exemplo.test',
        (select id from public.roles where key = 'manager'), current_setting('app.user_a1')::uuid);
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7')::text, true);
do $$
declare n int; r text;
begin
  select count(*) into n from public.pending_invitations_for_me();
  if n <> 1 then raise exception 'RLS-FALHA H7: convidado viu % convites para si (esperado 1)', n; end if;
  select public.accept_church_invitation(id) into r from public.pending_invitations_for_me() limit 1;
  if r is distinct from 'aceito' then
    raise exception 'RLS-FALHA H7: aceite retornou %', coalesce(r, 'nulo');
  end if;
end $$;
reset role;
do $$
declare rk text; st text; inv_status text;
begin
  select r.key, cm.status into rk, st
    from public.church_members cm join public.roles r on r.id = cm.role_id
   where cm.church_id = current_setting('app.church_a')::uuid
     and cm.user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7'::uuid;
  if rk is distinct from 'manager' or st is distinct from 'active' then
    raise exception 'RLS-FALHA H7: aceite criou vinculo %/%', coalesce(rk, 'nulo'), coalesce(st, 'nulo');
  end if;
  select status into inv_status from public.church_invitations where email = 'convidado-h7@exemplo.test';
  if inv_status is distinct from 'accepted' then raise exception 'RLS-FALHA H7: convite ficou com status %', coalesce(inv_status, 'nulo'); end if;
end $$;
rollback to savepoint h7;

-- H8: aceitar convite endereçado a outro e-mail (a conta não é a destinatária).
-- O id do convite é guardado num GUC ainda como dono: o convidado NÃO sabe ler a
-- tabela (nenhuma política de select o atende), então buscar o id "dentro" do caso
-- devolveria 0 linhas e o aceite receberia NULL -- comparar com <> engoliria isso.
savepoint h8;
insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8', 'convidado-h8@exemplo.test', '{"full_name":"Convidado H8"}'::jsonb);
insert into public.church_invitations (church_id, email, role_id, invited_by)
values (current_setting('app.church_a')::uuid, 'convidado-h8@exemplo.test',
        (select id from public.roles where key = 'manager'), current_setting('app.user_a1')::uuid);
select set_config('app.inv_h8', (select id::text from public.church_invitations
                                  where email = 'convidado-h8@exemplo.test'), true);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare r text; n int;
begin
  select count(*) into n from public.pending_invitations_for_me();
  if n <> 0 then raise exception 'RLS-FALHA H8: outra pessoa viu % convites que nao sao dela', n; end if;
  select public.accept_church_invitation(current_setting('app.inv_h8')::uuid) into r;
  if r is distinct from 'email_nao_confirmado' then
    raise exception 'RLS-FALHA H8: aceite de terceiros retornou %', coalesce(r, 'nulo');
  end if;
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.church_members where user_id = current_setting('app.user_out')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA H8: quem nao foi convidado virou membro (% vinculos)', n; end if;
end $$;
rollback to savepoint h8;

-- H9: convite expirado não vira vínculo, e o status é materializado.
savepoint h9;
insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9', 'convidado-h9@exemplo.test', '{"full_name":"Convidado H9"}'::jsonb);
insert into public.church_invitations (church_id, email, role_id, invited_by, expires_at)
values (current_setting('app.church_a')::uuid, 'convidado-h9@exemplo.test',
        (select id from public.roles where key = 'manager'), current_setting('app.user_a1')::uuid,
        now() - interval '1 day');
select set_config('app.inv_h9', (select id::text from public.church_invitations
                                  where email = 'convidado-h9@exemplo.test'), true);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9')::text, true);
do $$
declare r text; n int;
begin
  select count(*) into n from public.pending_invitations_for_me();
  if n <> 0 then raise exception 'RLS-FALHA H9: convite expirado apareceu para o convidado (% linhas)', n; end if;
  select public.accept_church_invitation(current_setting('app.inv_h9')::uuid) into r;
  if r is distinct from 'expirada' then
    raise exception 'RLS-FALHA H9: aceite de convite vencido retornou %', coalesce(r, 'nulo');
  end if;
end $$;
reset role;
do $$
declare st text; n int;
begin
  select status into st from public.church_invitations where email = 'convidado-h9@exemplo.test';
  if st is distinct from 'expired' then raise exception 'RLS-FALHA H9: convite vencido ficou com status %', coalesce(st, 'nulo'); end if;
  select count(*) into n from public.church_members where user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9'::uuid;
  if n <> 0 then raise exception 'RLS-FALHA H9: convite vencido criou vinculo (% linhas)', n; end if;
end $$;
rollback to savepoint h9;

-- H10: convite de superadmin criado por cima do trigger (dono do banco) ainda
-- não vira papel global no aceite — a segunda trava da RPC.
savepoint h10;
insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10', 'convidado-h10@exemplo.test', '{"full_name":"Convidado H10"}'::jsonb);
insert into public.church_invitations (church_id, email, role_id, invited_by)
values (current_setting('app.church_a')::uuid, 'convidado-h10@exemplo.test',
        (select id from public.roles where key = 'superadmin'), current_setting('app.user_a1')::uuid);
select set_config('app.inv_h10', (select id::text from public.church_invitations
                                   where email = 'convidado-h10@exemplo.test'), true);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10')::text, true);
do $$
declare r text;
begin
  select public.accept_church_invitation(current_setting('app.inv_h10')::uuid) into r;
  if r is distinct from 'papel_bloqueado' then
    raise exception 'RLS-FALHA H10: aceite de convite superadmin retornou %', coalesce(r, 'nulo');
  end if;
end $$;
reset role;
do $$
declare n int; st text;
begin
  select count(*) into n from public.church_members where user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10'::uuid;
  if n <> 0 then raise exception 'RLS-FALHA H10: convite de superadmin virou vinculo (% linhas)', n; end if;
  select status into st from public.church_invitations where id = current_setting('app.inv_h10')::uuid;
  if st is distinct from 'pending' then raise exception 'RLS-FALHA H10: convite bloqueado ficou com status %', coalesce(st, 'nulo'); end if;
end $$;
rollback to savepoint h10;

-- H11: aceite duas vezes não reabre nem duplica.
savepoint h11;
insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'convidado-h11@exemplo.test', '{"full_name":"Convidado H11"}'::jsonb);
insert into public.church_invitations (church_id, email, role_id, invited_by)
values (current_setting('app.church_a')::uuid, 'convidado-h11@exemplo.test',
        (select id from public.roles where key = 'pastor'), current_setting('app.user_a1')::uuid);
select set_config('app.inv_h11', (select id::text from public.church_invitations
                                   where email = 'convidado-h11@exemplo.test'), true);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1')::text, true);
do $$
declare r text;
begin
  select public.accept_church_invitation(current_setting('app.inv_h11')::uuid) into r;
  if r is distinct from 'aceito' then
    raise exception 'RLS-FALHA H11: primeiro aceite retornou %', coalesce(r, 'nulo');
  end if;
  select public.accept_church_invitation(current_setting('app.inv_h11')::uuid) into r;
  if r is distinct from 'nao_pendente' then
    raise exception 'RLS-FALHA H11: segundo aceite retornou %', coalesce(r, 'nulo');
  end if;
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.church_members
   where church_id = current_setting('app.church_a')::uuid
     and user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid;
  if n <> 1 then raise exception 'RLS-FALHA H11: aceite duplicado deixou % vinculos', n; end if;
end $$;
rollback to savepoint h11;

-- H12: revogar convite é escrita de quem gerencia membros.
savepoint h12;
insert into public.church_invitations (church_id, email, role_id, invited_by)
values (current_setting('app.church_a')::uuid, 'convidado-h12@exemplo.test',
        (select id from public.roles where key = 'communicator'), current_setting('app.user_a1')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int;
begin
  update public.church_invitations set status = 'revoked' where email = 'convidado-h12@exemplo.test';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA H12: gerente sem members.manage revogou convite (% linhas)', n; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  update public.church_invitations set status = 'revoked' where email = 'convidado-h12@exemplo.test';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA H12: admin nao conseguiu revogar o proprio convite (% linhas)', n; end if;
end $$;
reset role;
do $$
declare st text;
begin
  select status into st from public.church_invitations where email = 'convidado-h12@exemplo.test';
  if st is distinct from 'revoked' then raise exception 'RLS-FALHA H12: convite revogado ficou com status %', coalesce(st, 'nulo'); end if;
end $$;
rollback to savepoint h12;

-- H13: mudança de papel em church_members — na própria igreja sim, na alheia não.
savepoint h13;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  update public.church_members
     set role_id = (select id from public.roles where key = 'communicator')
   where church_id = current_setting('app.church_a')::uuid
     and user_id = current_setting('app.user_a2')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA H13: admin nao conseguiu mudar papel de colega (% linhas)', n; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int;
begin
  update public.church_members
     set role_id = (select id from public.roles where key = 'pastor')
   where church_id = current_setting('app.church_a')::uuid
     and user_id = current_setting('app.user_a2')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA H13: admin da B mudou papel na igreja A (% linhas)', n; end if;
end $$;
reset role;
do $$
declare rk text;
begin
  select r.key into rk
    from public.church_members cm join public.roles r on r.id = cm.role_id
   where cm.church_id = current_setting('app.church_a')::uuid
     and cm.user_id = current_setting('app.user_a2')::uuid;
  if rk is distinct from 'communicator' then raise exception 'RLS-FALHA H13: papel de a2 ficou %', coalesce(rk, 'nulo'); end if;
end $$;
rollback to savepoint h13;

-- H14: convite não muda de igreja (WITH CHECK do UPDATE).
savepoint h14;
insert into public.church_invitations (church_id, email, role_id, invited_by)
values (current_setting('app.church_a')::uuid, 'convidado-h14@exemplo.test',
        (select id from public.roles where key = 'communicator'), current_setting('app.user_a1')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  begin
    update public.church_invitations
       set church_id = current_setting('app.church_b')::uuid
     where email = 'convidado-h14@exemplo.test';
    raise exception 'RLS-FALHA H14: a1 moveu convite proprio para a igreja B';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback to savepoint h14;

-- ---------------------------------------------------------------------------
-- GRUPO I — listas de igrejas (churchService): as projeções e os filtros que as
-- telas mandam, conferidos contra a mesma RLS que elas atravessam.
--
-- Duas coisas este grupo guarda:
--   * os **nomes de coluna**: as projeções aparecem aqui escritas por extenso, então
--     uma migração que renomear ou remover uma coluna que a tela seleciona quebra a
--     suíte em vez de estourar em produção com "column does not exist";
--   * a **diferença entre as duas camadas** do diretório: a política (sozinha) e o
--     WHERE do app. Cada caso conta as duas, porque se o WHERE fosse a única guarda
--     a política já teria vazado — e é ela que vale para quem não roda nosso SQL.
--
-- Fixture extra do grupo: uma igreja 'in_review' e ativa, para o ramo in_review da
-- fila do SuperAdmin e para provar que o diretório também esconde quem está em
-- análise (os fixtures A..D só cobriam approved e pending).
-- ---------------------------------------------------------------------------

select set_config('app.church_f', '66666666-6666-4666-8666-666666666666', false);
insert into public.churches (id, name, slug, approval_status, status)
values (current_setting('app.church_f')::uuid, 'Igreja Teste F', 'teste-f', 'in_review', 'active');

savepoint i1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare with_filter int; without_filter int;
begin
  select count(*) into with_filter from (
    select id, name, slug, description, denomination, address, city, state, phone, whatsapp,
           status, approval_status, created_at, updated_at
    from public.churches
    where approval_status = 'approved' and status = 'active'
  ) d;
  if with_filter <> 2 then
    raise exception 'RLS-FALHA I1: diretório devolveu % igrejas para anon, esperava as 2 aprovadas e ativas', with_filter;
  end if;

  select count(*) into without_filter from (
    select id, name, slug, description, denomination, address, city, state, phone, whatsapp,
           status, approval_status, created_at, updated_at
    from public.churches
  ) d;
  if without_filter <> 2 then
    raise exception 'RLS-FALHA I1: sem o WHERE do app a política sozinha deixou anon ver % igrejas', without_filter;
  end if;
end $$;
rollback to savepoint i1;

-- a1 é admin de D (pending, inactive): a política dele alcança a própria igreja,
-- o diretório não — e a igreja C de terceiros não alcança ninguém.
savepoint i2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.churches
   where approval_status = 'approved' and status = 'active';
  if n <> 2 then raise exception 'RLS-FALHA I2: a1 viu % igrejas no diretório, esperava A e B', n; end if;

  select count(*) into n from public.churches;
  if n <> 3 then
    raise exception 'RLS-FALHA I2: a1 deveria ver A, B e a própria D (3 igrejas), viu %', n;
  end if;

  if exists (select 1 from public.churches where id = current_setting('app.church_c')::uuid) then
    raise exception 'RLS-FALHA I2: a1 leu a igreja C, que não é dele nem está aprovada';
  end if;
  if exists (select 1 from public.churches where id = current_setting('app.church_f')::uuid) then
    raise exception 'RLS-FALHA I2: a1 leu a igreja F (em análise) de terceiros';
  end if;
end $$;
rollback to savepoint i2;

-- Leitura de gestão (a mesma de /admin/igrejas) chamada por quem NÃO é SuperAdmin:
-- nada privado de terceiros entra, nem com a projeção completa (email/website/zip).
savepoint i3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from (
    select id, name, slug, description, denomination, address, city, state, phone, whatsapp,
           status, approval_status, created_at, updated_at, email, website, zip
    from public.churches
  ) m;
  if n <> 3 then
    raise exception 'RLS-FALHA I3: a1 recebeu % igrejas na leitura de gestão, esperava A, B e a própria D', n;
  end if;
  if exists (select 1 from public.churches
             where id in (current_setting('app.church_c')::uuid, current_setting('app.church_f')::uuid)) then
    raise exception 'RLS-FALHA I3: vazou C ou F (pendentes de terceiros) na leitura de gestão';
  end if;
end $$;
rollback to savepoint i3;

-- SuperAdmin: a fila de pendências é a contagem que o dashboard mostra.
savepoint i4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; pend int;
begin
  select count(*) into n from (
    select id, name, slug, description, denomination, address, city, state, phone, whatsapp,
           status, approval_status, created_at, updated_at, email, website, zip
    from public.churches
  ) m;
  if n <> 5 then raise exception 'RLS-FALHA I4: superadmin deveria ver as 5 igrejas, viu %', n; end if;

  select count(*) into pend from public.churches
   where approval_status = 'pending' or approval_status = 'in_review';
  if pend <> 3 then
    raise exception 'RLS-FALHA I4: fila de aprovação com % pendências, esperava 3 (C e D pendentes, F em análise)', pend;
  end if;
end $$;
rollback to savepoint i4;

-- "Minhas igrejas": o par de linhas que o embed church_members -> churches resolve.
-- O filtro status='active' do app tem dentes: sem ele a2 apareceria na igreja B só
-- com um convite ainda não aceito.
savepoint i5;
insert into public.church_members (church_id, user_id, role_id, status)
values (current_setting('app.church_b')::uuid, current_setting('app.user_a2')::uuid,
        (select id from public.roles where key = 'communicator'), 'invited');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare active int; all_rows int;
begin
  select count(*) into active
  from public.church_members cm
  join public.churches c on c.id = cm.church_id
  where cm.user_id = current_setting('app.user_a2')::uuid and cm.status = 'active';
  if active <> 1 then
    raise exception 'RLS-FALHA I5: a2 deveria ter 1 igreja ativa (A) no embed, viu %', active;
  end if;

  select count(*) into all_rows
  from public.church_members cm
  join public.churches c on c.id = cm.church_id
  where cm.user_id = current_setting('app.user_a2')::uuid;
  if all_rows <> 2 then
    raise exception 'RLS-FALHA I5: sem o filtro de status a2 mostrou % igrejas, esperava 2 (A e a B convidada)', all_rows;
  end if;
end $$;
rollback to savepoint i5;

-- Convite ainda não aceito não dá leitura da igreja: a linha de vínculo existe, o
-- nome da igreja vem null para o embed, e a lista fica vazia.
savepoint i6;
insert into public.church_members (church_id, user_id, role_id, status)
values (current_setting('app.church_c')::uuid, current_setting('app.user_out')::uuid,
        (select id from public.roles where key = 'communicator'), 'invited');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int; links int; embed int;
begin
  -- A igreja convidada continua invisível: sem o status='active' dentro de
  -- current_church_ids(), o convite sozinho abriria C. As aprovadas seguem
  -- visíveis a qualquer um, e é isso que o número abaixo garante.
  select count(*) into n from public.churches;
  if n <> 2 then
    raise exception 'RLS-FALHA I6: convite não aceito mudou a leitura de igrejas de % (esperava só as 2 aprovadas)', n;
  end if;
  if exists (select 1 from public.churches where id = current_setting('app.church_c')::uuid) then
    raise exception 'RLS-FALHA I6: convite não aceito liberou a leitura da igreja C';
  end if;

  -- E o embed do vínculo (o que fetchMyChurches recebe) continua null.
  select count(c.id) into embed
  from public.church_members cm
  left join public.churches c on c.id = cm.church_id
  where cm.user_id = current_setting('app.user_out')::uuid;
  if embed <> 0 then
    raise exception 'RLS-FALHA I6: o embed mostrou a igreja convidada (% nomes confirmados)', embed;
  end if;

  select count(*) into links from public.church_members
   where user_id = current_setting('app.user_out')::uuid;
  if links <> 1 then
    raise exception 'RLS-FALHA I6: o vinculo invited nao apareceu para o proprio usuario (% linhas)', links;
  end if;
end $$;
rollback to savepoint i6;

-- ---------------------------------------------------------------------------
-- GRUPO J — o efeito da escrita de aprovação (Fase 2, passo 4).
--
-- C5/C6/C7 já provam *quem pode escrever* `approval_status`. O que este grupo
-- prova é a consequência de audiência do flip, porque é ela que a tela de gestão
-- causa no mundo: aprovar põe a igreja no diretório público, suspender ou rejeitar
-- tira — e tirar do diretório não cega a própria igreja, que continua lendo a sua
-- linha pelo vínculo. Cada caso desfaz no savepoint, então A/B continuam
-- aprovadas para os grupos seguintes.
--
-- J4 é o avesso da proteção: a RLS é por linha, então `email`/`zip`/`website` de
-- uma igreja aprovada estão acessíveis a quem quer que consiga fazer SQL contra a
-- tabela. Não há asserção que "conserte" isso aqui — a proteção é a projeção do
-- app (DIRECTORY_COLUMNS/APPROVAL_COLUMNS), congelada nos testes unitários.
-- ---------------------------------------------------------------------------

savepoint j1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; got int;
begin
  update public.churches set approval_status = 'approved'
   where id = current_setting('app.church_f')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA J1: superadmin nao conseguiu aprovar a igreja F (% linhas)', n; end if;

  -- A projeção do update, por extenso: a tela lê de volta exatamente estas colunas.
  select count(*) into got from (
    select id, name, slug, approval_status, status, updated_at
    from public.churches
    where id = current_setting('app.church_f')::uuid and approval_status = 'approved'
  ) r;
  if got <> 1 then raise exception 'RLS-FALHA J1: o read-back do update nao confirmou a aprovacao de F'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from (
    select id, name, slug, description, denomination, address, city, state, phone, whatsapp,
           status, approval_status, created_at, updated_at
    from public.churches
    where approval_status = 'approved' and status = 'active'
  ) d;
  if n <> 3 then
    raise exception 'RLS-FALHA J1: diretório publico com % igrejas depois de aprovar F, esperava 3', n;
  end if;
  if not exists (select 1 from public.churches where id = current_setting('app.church_f')::uuid) then
    raise exception 'RLS-FALHA J1: F aprovada continuo fora do diretorio do anon';
  end if;
end $$;
rollback to savepoint j1;

-- Suspender tira do público e deixa de aparecer no mapa/busca; o membro da igreja
-- suspensa continua lendo a própria linha (é assim que ela consegue reclamar).
savepoint j2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.churches
   where approval_status = 'approved' and status = 'active';
  if n <> 1 then
    raise exception 'RLS-FALHA J2: suspensa ainda no diretorio publico (% igrejas, esperava so B)', n;
  end if;
  if exists (select 1 from public.churches where id = current_setting('app.church_a')::uuid) then
    raise exception 'RLS-FALHA J2: anon le a igreja suspensa A';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.churches where id = current_setting('app.church_a')::uuid;
  if n <> 1 then
    raise exception 'RLS-FALHA J2: a1 perdeu a leitura da propria igreja suspensa (% linhas)', n;
  end if;
end $$;
rollback to savepoint j2;

-- Rejeitar tem o mesmo efeito de audiência, por outro caminho.
savepoint j3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
update public.churches set approval_status = 'rejected' where id = current_setting('app.church_b')::uuid;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.churches
   where approval_status = 'approved' and status = 'active';
  if n <> 1 then
    raise exception 'RLS-FALHA J3: rejeitada no diretorio publico (% igrejas, esperava so A)', n;
  end if;
  if exists (select 1 from public.churches where id = current_setting('app.church_b')::uuid) then
    raise exception 'RLS-FALHA J3: anon le a igreja rejeitada B';
  end if;
end $$;
rollback to savepoint j3;

-- J4: sem projeção, quem faz SQL leva as colunas privadas da igreja aprovada.
savepoint j4;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from (select id, email, zip, website from public.churches) x;
  if n <> 2 then
    raise exception 'RLS-FALHA J4: anon contou % linhas pedindo email/zip/website, esperava as 2 aprovadas (a RLS nao esconde coluna)', n;
  end if;
end $$;
rollback to savepoint j4;

-- GRUPO K — leitura da trilha automática; K5 mede a recusa do insert manual (0010).

savepoint k1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; got int;
begin
  update public.churches set approval_status = 'approved'
   where id = current_setting('app.church_f')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA K1: superadmin nao aprovou F (% linhas)', n; end if;

  -- A projeção do read, por extenso: a tela lê exatamente estas colunas.
  select count(*) into got from (
    select id, created_at, action, target, metadata, actor_id, church_id
    from public.audit_logs
    where action = 'igreja.aprovada' and church_id = current_setting('app.church_f')::uuid
  ) r;
  if got <> 1 then raise exception 'RLS-FALHA K1: o superadmin nao le a propria trilha'; end if;

  -- As duas metades do embed, chegadas pelo caminho da tela (como authenticated/su).
  select count(*) into got from public.audit_logs al
    left join public.profiles p on p.id = al.actor_id
    left join public.churches c on c.id = al.church_id
   where al.action = 'igreja.aprovada' and al.church_id = current_setting('app.church_f')::uuid;
  if got <> 1 then raise exception 'RLS-FALHA K1: o join da trilha sumiu (% linhas)', got; end if;
  if exists (
    select 1 from public.audit_logs al
      left join public.profiles p on p.id = al.actor_id
      left join public.churches c on c.id = al.church_id
     where al.action = 'igreja.aprovada' and al.church_id = current_setting('app.church_f')::uuid
       and (p.email is null or c.name is null)
  ) then
    raise exception 'RLS-FALHA K1: o embed nao trouxe ator/igreja (a politica esconde a linha-mae e a tela mostraria vazio)';
  end if;
end $$;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.audit_logs;
  if n <> 0 then raise exception 'RLS-FALHA K1: anon leu % linhas de auditoria', n; end if;
end $$;
rollback to savepoint k1;

-- K2: a igreja suspensa enxerga a própria trilha (é assim que ela sabe o que
-- aconteceu com ela); a vizinha não enxerga nada dela.
savepoint k2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.audit_logs where action = 'igreja.suspensa';
  if n <> 1 then
    raise exception 'RLS-FALHA K2: a1 leu % linhas da suspensao da propria igreja, esperava 1', n;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.audit_logs where action = 'igreja.suspensa';
  if n <> 0 then
    raise exception 'RLS-FALHA K2: b1 leu % linhas da suspensao de outra igreja', n;
  end if;
end $$;
rollback to savepoint k2;

-- K3: imutabilidade. `update`/`delete` sem política não casam linha nenhuma — o
-- que a tela chama de "registro imutável" é exatamente isto, medido por row_count.
savepoint k3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  update public.audit_logs set action = 'igreja.rejeitada' where action = 'igreja.editada';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA K3: superadmin alterou % linhas de auditoria', n; end if;

  delete from public.audit_logs where action = 'igreja.editada';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA K3: superadmin apagou % linhas de auditoria', n; end if;

  select count(*) into n from public.audit_logs where action = 'igreja.editada';
  if n <> 2 then raise exception 'RLS-FALHA K3: restam % das 2 trilhas de fixture', n; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  update public.audit_logs set action = 'nada.aconteceu' where action = 'igreja.editada';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA K3: a1 reescreveu % linhas da propria auditoria', n; end if;
end $$;
rollback to savepoint k3;

-- K4: recusa não muda a igreja nem deixa rastro na trilha.
savepoint k4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare st text; n int;
begin
  begin
    update public.churches set approval_status = 'approved'
     where id = current_setting('app.church_d')::uuid;
    raise exception 'RLS-FALHA K4: a1 aprovou a propria igreja sem ser SuperAdmin';
  exception when insufficient_privilege then
    null;  -- o trigger da 0004 fez o trabalho dele
  end;

  select approval_status into st from public.churches where id = current_setting('app.church_d')::uuid;
  if st <> 'pending' then raise exception 'RLS-FALHA K4: a recusa deixou a igreja D em %', st; end if;

  select count(*) into n from public.audit_logs where church_id = current_setting('app.church_d')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA K4: a recusa gerou % linhas de trilha para a igreja D', n; end if;
end $$;
rollback to savepoint k4;

-- K5: o insert manual morreu (0010). Antes este caso media o limite oposto — o
-- SuperAdmin conseguia atribuir a ação a outra conta. Agora mede a recusa, e a
-- sonda no começo garante que o bloco não está verde porque tudo foi bloqueado.
savepoint k5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA K5: sonda nao alterou a igreja A (% linhas)', n; end if;
  select count(*) into n from public.audit_logs
    where church_id = current_setting('app.church_a')::uuid and action = 'igreja.suspensa';
  if n <> 1 then raise exception 'RLS-FALHA K5: sonda — o trigger parou de escrever (% linhas)', n; end if;

  begin
    insert into public.audit_logs (actor_id, action, target, church_id)
    values (current_setting('app.user_a1')::uuid, 'igreja.aprovada', 'Igreja Teste A',
            current_setting('app.church_a')::uuid);
    raise exception 'RLS-FALHA K5: superadmin inseriu trilha manual atribuindo a outra conta';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.audit_logs (actor_id, action, target, church_id, metadata)
    values (auth.uid(), 'igreja.aprovada', 'Igreja Teste A', current_setting('app.church_a')::uuid,
            jsonb_build_object('de', 'pending', 'para', 'approved'));
    raise exception 'RLS-FALHA K5: superadmin inventou trilha plausivel em nome proprio';
  exception when insufficient_privilege then null;
  end;

  -- A marca é limpa pelo trigger: nem o insert seguinte, na mesma transação de um
  -- update legítimo, encontra a janela aberta.
  update public.churches set approval_status = 'approved' where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA K5: segundo update nao atingiu a igreja A'; end if;
  begin
    insert into public.audit_logs (actor_id, action, church_id)
    values (auth.uid(), 'igreja.aprovada', current_setting('app.church_a')::uuid);
    raise exception 'RLS-FALHA K5: a marca do trigger vazou para outro insert da mesma transacao';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from public.audit_logs;
  if n <> 5 then raise exception 'RLS-FALHA K5: restam % linhas (3 de fixture + 2 do trigger)', n; end if;
end $$;
rollback to savepoint k5;

-- GRUPO L — atomicidade da aprovação e autoria automática (0009).

savepoint l1;
reset role;
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'record_church_approval_audit'
      and not p.prosecdef and 'search_path=public' = any(p.proconfig)
  ) then
    raise exception 'RLS-FALHA L1: auditoria deve usar SECURITY INVOKER e search_path fixo';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.churches'::regclass
      and tgname = 'trg_churches_approval_audit'
      and tgfoid = 'public.record_church_approval_audit()'::regprocedure
      and tgtype = 17 and tgenabled = 'O'
  ) then
    raise exception 'RLS-FALHA L1: trigger de auditoria AFTER UPDATE por linha ausente ou desativado';
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.audit_logs'::regclass and polname = 'audit_logs_insert'
      and pg_get_expr(polwithcheck, polrelid) like '%igrejaconecta.audit_write%'
  ) then
    raise exception 'RLS-FALHA L1: audit_logs_insert nao exige a marca do trigger (0010)';
  end if;
end $$;
rollback to savepoint l1;

savepoint l2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare
  states text[] := array['approved','suspended','approved','rejected','in_review','pending'];
  actions text[] := array['igreja.aprovada','igreja.suspensa','igreja.reativada','igreja.rejeitada','igreja.em_analise','igreja.pendente'];
  previous text;
  n int;
  i int;
begin
  select approval_status into strict previous from public.churches where id = current_setting('app.church_f')::uuid;
  for i in 1..array_length(states, 1) loop
    update public.churches set approval_status = states[i], name = 'Nome confirmado ' || i
      where id = current_setting('app.church_f')::uuid;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'RLS-FALHA L2: update da transicao % nao atingiu uma igreja', i; end if;
    select count(*) into n from public.audit_logs
      where church_id = current_setting('app.church_f')::uuid
        and actor_id = auth.uid() and target = 'Nome confirmado ' || i
        and action = actions[i]
        and metadata = jsonb_build_object('de', previous, 'para', states[i]);
    if n <> 1 then raise exception 'RLS-FALHA L2: transicao % sem trilha unica com ator/nome/de/para corretos', i; end if;
    select count(*) into n from public.audit_logs where church_id = current_setting('app.church_f')::uuid;
    if n <> i then raise exception 'RLS-FALHA L2: trilhas duplicadas ou perdidas na transicao %', i; end if;
    previous := states[i];
  end loop;

  update public.churches set approval_status = 'pending' where id = current_setting('app.church_f')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA L2: repeticao do status nao atingiu uma igreja'; end if;
  update public.churches set name = 'Renomeada sem mudar aprovacao' where id = current_setting('app.church_f')::uuid;
  select count(*) into n from public.audit_logs where church_id = current_setting('app.church_f')::uuid;
  if n <> 6 then raise exception 'RLS-FALHA L2: status repetido ou mudanca de nome gerou auditoria de aprovacao'; end if;
end $$;
rollback to savepoint l2;

savepoint l3;
reset role;
create function pg_temp.reject_suspension_audit()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.action = 'igreja.suspensa' then
    raise exception 'AUDIT-TEST-FAIL' using errcode = 'P7001';
  end if;
  return new;
end $$;
create trigger audit_test_rejection before insert on public.audit_logs
  for each row execute function pg_temp.reject_suspension_audit();
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare
  rejected boolean := false;
  before_a jsonb;
  before_f jsonb;
  after_row jsonb;
  before_logs jsonb;
  after_logs jsonb;
  n int;
begin
  -- A sonda prova que a falha foi injetada, antes de usá-la como evidência de rollback.
  -- O caminho é o mesmo do app: um update que gera trilha (insert manual não passa mais).
  begin
    update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
  exception when sqlstate 'P7001' then rejected := true;
  end;
  if not rejected then raise exception 'RLS-FALHA L3: sonda nao recusou insert de auditoria'; end if;
  rejected := false;
  select to_jsonb(c) into strict before_a from public.churches c where id = current_setting('app.church_a')::uuid;
  select to_jsonb(c) into strict before_f from public.churches c where id = current_setting('app.church_f')::uuid;
  select jsonb_agg(to_jsonb(a) order by id) into before_logs from public.audit_logs a;
  begin
    update public.churches set approval_status = 'approved' where id = current_setting('app.church_f')::uuid;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'RLS-FALHA L3: primeiro update nao atingiu F'; end if;
    select count(*) into n from public.audit_logs where church_id = current_setting('app.church_f')::uuid and action = 'igreja.aprovada';
    if n <> 1 then raise exception 'RLS-FALHA L3: primeiro update nao escreveu trilha antes da falha'; end if;
    update public.churches set approval_status = 'suspended', name = 'Nao deve persistir'
      where id = current_setting('app.church_a')::uuid;
  exception when sqlstate 'P7001' then rejected := true;
  end;
  if not rejected then raise exception 'RLS-FALHA L3: falha da auditoria nao abortou a aprovacao'; end if;
  select to_jsonb(c) into strict after_row from public.churches c where id = current_setting('app.church_a')::uuid;
  if after_row is distinct from before_a then raise exception 'RLS-FALHA L3: igreja A mudou apesar da falha'; end if;
  select to_jsonb(c) into strict after_row from public.churches c where id = current_setting('app.church_f')::uuid;
  if after_row is distinct from before_f then raise exception 'RLS-FALHA L3: primeiro update de F sobreviveu ao rollback'; end if;
  select jsonb_agg(to_jsonb(a) order by id) into after_logs from public.audit_logs a;
  if after_logs is distinct from before_logs then raise exception 'RLS-FALHA L3: rollback deixou trilha parcial ou alterou historico'; end if;
end $$;
rollback to savepoint l3;

savepoint l4;
reset role;
create function pg_temp.discard_approval_audit()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  return null;
end $$;
create trigger audit_test_discard before insert on public.audit_logs
  for each row execute function pg_temp.discard_approval_audit();
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; rejected boolean := false; before_row jsonb; after_row jsonb;
begin
  begin
    update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
  exception when no_data_found then rejected := true;
  end;
  if not rejected then raise exception 'RLS-FALHA L4: sonda nao descartou o insert'; end if;
  rejected := false;
  select to_jsonb(c) into strict before_row from public.churches c where id = current_setting('app.church_a')::uuid;
  begin
    update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
  exception when no_data_found then rejected := true;
  end;
  if not rejected then raise exception 'RLS-FALHA L4: auditoria descartada silenciosamente permitiu alterar aprovacao'; end if;
  select to_jsonb(c) into strict after_row from public.churches c where id = current_setting('app.church_a')::uuid;
  if after_row is distinct from before_row then raise exception 'RLS-FALHA L4: igreja mudou com insert descartado'; end if;
  select count(*) into n from public.audit_logs;
  if n <> 3 then raise exception 'RLS-FALHA L4: historico mudou apos insert descartado'; end if;
end $$;
rollback to savepoint l4;

savepoint l5;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role","sub":null}', true);
do $$
declare n int;
begin
  update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA L5: backend nao alterou igreja A'; end if;
  select count(*) into n from public.audit_logs
    where church_id = current_setting('app.church_a')::uuid
      and action = 'igreja.suspensa' and actor_id is null
      and metadata = '{"de":"approved","para":"suspended"}'::jsonb;
  if n <> 1 then raise exception 'RLS-FALHA L5: backend sem usuario nao gerou trilha unica com ator nulo'; end if;
end $$;
rollback to savepoint l5;

-- ---------------------------------------------------------------------------
-- GRUPO M — eventos (0011): audiência do visitante, isolamento entre igrejas e a
-- porta de publicação.
--
-- O que este grupo garante, na ordem em que as telas dependem:
--   * o visitante só vê evento **publicado e público** de igreja **aprovada e
--     ativa** — suspender/rejeitar a igreja tira os eventos dela do ar junto (M4),
--     que é o efeito de audiência que o grupo J mede para o diretório;
--   * membro vê os próprios eventos em qualquer status, inclusive rascunho, e não
--     vê o rascunho da vizinha (M3);
--   * `visibility` não é controle de acesso: é intenção de produto. Quem segura a
--     linha é o vínculo com a igreja, e M5 grava isso por extenso;
--   * publicar exige `events.publish`, não basta `events.manage` (M6) — RLS não
--     controla valor de coluna, então é o trigger 42501 que vale;
--   * escrita cruzada entre igrejas é recusada (M7);
--   * editar a linha certa com o campo errado também é: mover o evento de igreja
--     esbarra no WITH CHECK, não no USING (M10) — o que o formulário de edição
--     passa a tentar assim que existe;
--   * as projeções do app são nomes de coluna reais (M1/M3/M8). Se uma migração
--     renomear uma coluna que a tela seleciona, a suíte quebra aqui em vez de
--     estourar em produção.
--
-- M8 é o avesso da proteção, como J4: a RLS é por linha, então uma coluna que a
-- projeção do visitante não pede continua legível para quem faz SQL direto.
-- A proteção é a projeção (EVENTS_PUBLIC_COLUMNS), congelada nos unitários.
-- ---------------------------------------------------------------------------

-- Fixture extra do grupo: um comunicador na igreja A. A matriz do seed dá a esse
-- papel `events.manage` sem `events.publish` — é exatamente a diferença que M6 mede.
select set_config('app.user_a3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', false);
select set_config('app.event_a_pub', 'eeeeeeee-0000-4000-8000-0000000000a1', false);
select set_config('app.event_a_dra', 'eeeeeeee-0000-4000-8000-0000000000a2', false);
select set_config('app.event_a_pri', 'eeeeeeee-0000-4000-8000-0000000000a3', false);
select set_config('app.event_a_unl', 'eeeeeeee-0000-4000-8000-0000000000a4', false);
select set_config('app.event_a_sch', 'eeeeeeee-0000-4000-8000-0000000000a5', false);
select set_config('app.event_b_pub', 'eeeeeeee-0000-4000-8000-0000000000b1', false);
select set_config('app.event_b_dra', 'eeeeeeee-0000-4000-8000-0000000000b2', false);
select set_config('app.event_c_pub', 'eeeeeeee-0000-4000-8000-0000000000c1', false);

insert into auth.users (id, email, raw_user_meta_data) values
  (current_setting('app.user_a3')::uuid, 'a3@igreja-a.test', '{"full_name":"Comunicador A"}'::jsonb);

insert into public.church_members (church_id, user_id, role_id, status) values
  (current_setting('app.church_a')::uuid, current_setting('app.user_a3')::uuid,
   (select id from public.roles where key = 'communicator'), 'active');

-- O total do catálogo é lido como dono e comparado depois: assim M2 não fica
-- amarrado ao número de categorias semeadas pela 0011.
select set_config('app.category_count', (select count(*) from public.event_categories)::text, false);

-- Eventos publicados entram como service_role: o trigger da 0011 exige
-- `events.publish` de quem publica, e o dono da conexão não tem vínculo nenhum.
set role service_role;
insert into public.events (id, church_id, category_id, slug, name, description, starts_at, city, capacity, is_free, visibility, status) values
  (current_setting('app.event_a_pub')::uuid, current_setting('app.church_a')::uuid,
   (select id from public.event_categories where slug = 'congressos'),
   'evento-a-publicado', 'Congresso A', 'Publicado e publico, igreja aprovada.',
   '2026-11-20T19:30:00-03:00', 'Cidade A', 500, false, 'public', 'published'),
  (current_setting('app.event_a_dra')::uuid, current_setting('app.church_a')::uuid,
   (select id from public.event_categories where slug = 'acoes-sociais'),
   'evento-a-rascunho', 'Ação Social A', 'Rascunho: o visitante nunca ve isto.',
   '2026-12-12T09:00:00-03:00', 'Cidade A', null, true, 'public', 'draft'),
  (current_setting('app.event_a_pri')::uuid, current_setting('app.church_a')::uuid,
   (select id from public.event_categories where slug = 'vigilias'),
   'evento-a-privado', 'Vigília A', 'Publicado, mas visibility private.',
   '2026-11-14T22:00:00-03:00', 'Cidade A', null, true, 'private', 'published'),
  (current_setting('app.event_a_unl')::uuid, current_setting('app.church_a')::uuid,
   (select id from public.event_categories where slug = 'jovens'),
   'evento-a-nao-listado', 'Encontro A', 'Publicado, visibility unlisted.',
   '2026-11-15T19:00:00-03:00', 'Cidade A', null, true, 'unlisted', 'published'),
  (current_setting('app.event_a_sch')::uuid, current_setting('app.church_a')::uuid,
   (select id from public.event_categories where slug = 'cultos-especiais'),
   'evento-a-agendado', 'Culto A', 'Agendado: ainda nao publicado.',
   '2026-11-18T19:30:00-03:00', 'Cidade A', null, true, 'public', 'scheduled'),
  (current_setting('app.event_b_pub')::uuid, current_setting('app.church_b')::uuid,
   (select id from public.event_categories where slug = 'conferencias'),
   'evento-b-publicado', 'Conferência B', 'Publicado e publico da igreja vizinha.',
   '2026-11-29T14:00:00-03:00', 'Cidade B', null, true, 'public', 'published'),
  (current_setting('app.event_b_dra')::uuid, current_setting('app.church_b')::uuid,
   (select id from public.event_categories where slug = 'mulheres'),
   'evento-b-rascunho', 'Encontro B', 'Rascunho da igreja vizinha.',
   '2026-12-01T14:00:00-03:00', 'Cidade B', null, true, 'public', 'draft'),
  -- Igreja C é pending/inactive: o evento está publicado, a igreja não.
  (current_setting('app.event_c_pub')::uuid, current_setting('app.church_c')::uuid,
   (select id from public.event_categories where slug = 'cruzadas'),
   'evento-c-publicado', 'Cruzada C', 'Igreja ainda nao aprovada.',
   '2026-11-25T19:00:00-03:00', 'Cidade C', null, true, 'public', 'published');
reset role;

-- M1: diretório público do visitante, com e sem o WHERE do app. As duas contagens
-- têm de dar o mesmo resultado — se o WHERE fosse a única guarda, a política já
-- teria vazado o rascunho, o privado e o evento da igreja não aprovada.
savepoint m1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare with_filter int; without_filter int;
begin
  select count(*) into with_filter from (
    select id, church_id, category_id, slug, name, description, starts_at, ends_at,
           address, city, cover_url, capacity, is_free, status
    from public.events
    where status = 'published' and visibility = 'public'
  ) d;
  if with_filter <> 2 then
    raise exception 'RLS-FALHA M1: diretorio de eventos devolveu % linhas para anon, esperava 2 (A e B publicados)', with_filter;
  end if;

  select count(*) into without_filter from (
    select id, church_id, category_id, slug, name, description, starts_at, ends_at,
           address, city, cover_url, capacity, is_free, status
    from public.events
  ) d;
  if without_filter <> 2 then
    raise exception 'RLS-FALHA M1: sem o WHERE do app a politica sozinha deixou anon ver % eventos', without_filter;
  end if;

  if exists (select 1 from public.events where id in (
       current_setting('app.event_a_dra')::uuid,
       current_setting('app.event_a_pri')::uuid,
       current_setting('app.event_a_unl')::uuid,
       current_setting('app.event_a_sch')::uuid,
       current_setting('app.event_c_pub')::uuid)) then
    raise exception 'RLS-FALHA M1: anon leu evento que nao esta no ar (rascunho, privado, nao listado, agendado ou de igreja nao aprovada)';
  end if;
end $$;
rollback to savepoint m1;

-- M2: categorias são catálogo público (como roles/permissions). O visitante lê e
-- não escreve.
savepoint m2;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.event_categories;
  if n <> current_setting('app.category_count')::int then
    raise exception 'RLS-FALHA M2: anon leu % categorias, o catalogo tem %', n, current_setting('app.category_count');
  end if;
  if not exists (select 1 from public.event_categories where slug = 'congressos') then
    raise exception 'RLS-FALHA M2: anon nao leu uma categoria conhecida do catalogo';
  end if;
end $$;
do $$
declare n int;
begin
  begin
    insert into public.event_categories (name, slug) values ('Categoria forjada', 'categoria-forjada');
    raise exception 'RLS-FALHA M2: anon criou categoria no catalogo';
  exception when insufficient_privilege then null; end;

  -- UPDATE/DELETE sem USING verdadeiro não dão erro: não alcançam linha nenhuma.
  update public.event_categories set name = 'Rebatizada' where slug = 'congressos';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA M2: anon renomeou % categoria(s) do catalogo', n; end if;

  delete from public.event_categories where slug = 'congressos';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA M2: anon apagou % categoria(s) do catalogo', n; end if;
end $$;
rollback to savepoint m2;

-- M3: o membro da igreja vê os próprios eventos em qualquer status, e da vizinha
-- só o que já é público. Projeção de gestão por extenso (a lista inclui
-- `visibility` e a localização — `branch_id`, `latitude`, `longitude` — que a
-- projeção do visitante não tem; a localização vem da migração 0013).
savepoint m3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare own int; all_visible int;
begin
  select count(*) into own from (
    select id, church_id, category_id, slug, name, description, starts_at, ends_at,
           address, city, cover_url, capacity, is_free, visibility, status,
           branch_id, latitude, longitude
    from public.events
    where church_id = current_setting('app.church_a')::uuid
  ) d;
  if own <> 5 then
    raise exception 'RLS-FALHA M3: a1 leu % eventos da propria igreja, esperava os 5 (publicado, rascunho, privado, nao listado, agendado)', own;
  end if;

  select count(*) into all_visible from public.events;
  if all_visible <> 6 then
    raise exception 'RLS-FALHA M3: a1 ve % eventos no total, esperava os 5 proprios + o publicado da igreja B', all_visible;
  end if;

  if exists (select 1 from public.events where id = current_setting('app.event_b_dra')::uuid) then
    raise exception 'RLS-FALHA M3: a1 leu o rascunho da igreja vizinha B';
  end if;
  if exists (select 1 from public.events where id = current_setting('app.event_c_pub')::uuid) then
    raise exception 'RLS-FALHA M3: a1 leu evento da igreja C, que nao e dele nem esta aprovada';
  end if;
end $$;
rollback to savepoint m3;

-- M4: suspender ou rejeitar a igreja tira os eventos dela do diretório público —
-- sem tocar no evento, só no status da igreja. O membro continua lendo os seus
-- (é assim que a igreja suspensa consegue ver a própria agenda).
savepoint m4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
update public.churches set approval_status = 'suspended' where id = current_setting('app.church_a')::uuid;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.events where status = 'published' and visibility = 'public';
  if n <> 1 then
    raise exception 'RLS-FALHA M4: com a igreja A suspensa o diretorio tem % eventos, esperava so o da igreja B', n;
  end if;
  if exists (select 1 from public.events where id = current_setting('app.event_a_pub')::uuid) then
    raise exception 'RLS-FALHA M4: anon continuou vendo o evento da igreja suspensa';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.events where church_id = current_setting('app.church_a')::uuid;
  if n <> 5 then
    raise exception 'RLS-FALHA M4: a1 perdeu a agenda da propria igreja suspensa (% eventos, esperava 5)', n;
  end if;
end $$;
rollback to savepoint m4;

-- Rejeitar tem o mesmo efeito, por outro caminho.
savepoint m4b;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
update public.churches set approval_status = 'rejected' where id = current_setting('app.church_b')::uuid;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.events where status = 'published' and visibility = 'public';
  if n <> 1 then
    raise exception 'RLS-FALHA M4b: com a igreja B rejeitada o diretorio tem % eventos, esperava so o da igreja A', n;
  end if;
end $$;
rollback to savepoint m4b;

-- M5: `visibility` não é controle de acesso. Quem decide é o vínculo: um visitante
-- sem nenhuma permissão de eventos, anexado à igreja A dentro deste caso, lê o
-- evento privado e o não listado; o anon não lê nenhum dos dois.
savepoint m5;
insert into public.church_members (church_id, user_id, role_id, status) values
  (current_setting('app.church_a')::uuid, current_setting('app.user_out')::uuid,
   (select id from public.roles where key = 'visitor'), 'active');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.events where church_id = current_setting('app.church_a')::uuid;
  if n <> 5 then
    raise exception 'RLS-FALHA M5: visitante da igreja A leu % eventos, esperava os 5 (o muro e o vinculo, nao o visibility)', n;
  end if;
  if not exists (select 1 from public.events
                 where id = current_setting('app.event_a_pri')::uuid and visibility = 'private') then
    raise exception 'RLS-FALHA M5: membro sem permissao nao leu o evento privado da propria igreja';
  end if;
end $$;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from public.events where id in (
    current_setting('app.event_a_pri')::uuid, current_setting('app.event_a_unl')::uuid);
  if n <> 0 then
    raise exception 'RLS-FALHA M5: anon leu % eventos private/unlisted', n;
  end if;
end $$;
rollback to savepoint m5;

-- M6: publicar exige `events.publish`. O comunicador tem `events.manage`: cria,
-- edita texto, mas não põe no ar. O gerente (que tem as duas) põe.
-- A existência do trigger e o INVOKER ficam no E4; aqui se mede o comportamento.
savepoint m6;
do $$
declare before_status text;
begin
  select status into before_status from public.events where id = current_setting('app.event_a_dra')::uuid;
  if before_status <> 'draft' then
    raise exception 'RLS-FALHA M6: fixture do rascunho nao esta como draft (esta %)', before_status;
  end if;
end $$;

-- O comunicador tenta publicar e é recusado; editar o texto continua permitido.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a3'))::text, true);
do $$
declare n int; status_now text;
begin
  begin
    update public.events set status = 'published' where id = current_setting('app.event_a_dra')::uuid;
    raise exception 'RLS-FALHA M6: comunicador (so events.manage) publicou o evento';
  exception when insufficient_privilege then null; end;

  select status into status_now from public.events where id = current_setting('app.event_a_dra')::uuid;
  if status_now <> 'draft' then
    raise exception 'RLS-FALHA M6: o update recusado mudou o status para %', status_now;
  end if;

  update public.events set description = 'Texto editado pelo comunicador'
   where id = current_setting('app.event_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'RLS-FALHA M6: comunicador nao conseguiu editar o proprio rascunho (% linhas)', n;
  end if;

  begin
    insert into public.events (church_id, category_id, slug, name, starts_at, status)
    values (current_setting('app.church_a')::uuid,
            (select id from public.event_categories where slug = 'congressos'),
            'evento-ja-publicado', 'Nasce publicado', '2026-12-20T19:30:00-03:00', 'published');
    raise exception 'RLS-FALHA M6: comunicador inseriu evento ja publicado';
  exception when insufficient_privilege then null; end;

  insert into public.events (church_id, category_id, slug, name, starts_at, status)
  values (current_setting('app.church_a')::uuid,
          (select id from public.event_categories where slug = 'congressos'),
          'evento-rascunho-do-comunicador', 'Rascunho do comunicador', '2026-12-21T19:30:00-03:00', 'draft');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA M6: comunicador nao conseguiu criar rascunho'; end if;
end $$;

-- O gerente da mesma igreja tem `events.publish`: para ele a porta abre.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int; status_now text;
begin
  update public.events set status = 'published' where id = current_setting('app.event_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA M6: gerente nao publicou o evento (% linhas)', n; end if;
  select status into status_now from public.events where id = current_setting('app.event_a_dra')::uuid;
  if status_now <> 'published' then
    raise exception 'RLS-FALHA M6: depois do update do gerente o status ficou %', status_now;
  end if;
end $$;
rollback to savepoint m6;

-- M7: escrita cruzada. Ninguém de fora edita, apaga ou cria evento em outra igreja.
savepoint m7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int;
begin
  update public.events set name = 'Rebatizado pela vizinha' where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA M7: b1 editou evento da igreja A (% linhas)', n; end if;

  delete from public.events where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA M7: b1 apagou evento da igreja A (% linhas)', n; end if;

  begin
    insert into public.events (church_id, slug, name, starts_at, status)
    values (current_setting('app.church_a')::uuid, 'evento-plantado-em-a', 'Plantado na igreja A',
            '2026-12-25T19:00:00-03:00', 'draft');
    raise exception 'RLS-FALHA M7: b1 criou evento dentro da igreja A';
  exception when insufficient_privilege then null; end;
end $$;

-- O SuperAdmin segue alcançando tudo: a política dele é transversal.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  update public.events set name = 'Rebatizado pela plataforma' where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA M7: superadmin nao editou o evento da igreja A (% linhas)', n; end if;
end $$;
rollback to savepoint m7;

-- M8: a RLS é por linha. O anon consegue pedir colunas que a projeção pública não
-- inclui (`visibility`, `church_id` de outra igreja...) — quem limita o que chega
-- ao navegador é a projeção do serviço, não a política.
savepoint m8;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  select count(*) into n from (select id, church_id, visibility, status from public.events) x;
  if n <> 2 then
    raise exception 'RLS-FALHA M8: anon contou % linhas pedindo colunas fora da projecao publica, esperava as 2 no ar (RLS nao esconde coluna)', n;
  end if;
end $$;
rollback to savepoint m8;

-- M9: os embeds que o serviço pede (`event_categories(name)` e a igreja
-- organizadora) resolvem para o visitante. Se um deles vier null, a tela mostra
-- o evento sem categoria ou sem "Organizado por" — e o motivo seria RLS, não dado
-- faltando. Os dois joins são explícitos porque é assim que o PostgREST monta o
-- embed, e a projeção da organizadora é a mesma do diretório público (0002).
savepoint m9;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int; vazios int;
begin
  select count(*) into n
  from public.events e
  left join public.event_categories c on c.id = e.category_id
  left join public.churches ch on ch.id = e.church_id
  where e.status = 'published' and e.visibility = 'public';
  if n <> 2 then
    raise exception 'RLS-FALHA M9: o diretorio com embed devolveu % linhas para anon, esperava 2', n;
  end if;

  select count(*) into vazios
  from public.events e
  left join public.event_categories c on c.id = e.category_id
  left join public.churches ch on ch.id = e.church_id
  where e.status = 'published' and e.visibility = 'public'
    and (c.name is null or ch.name is null or ch.slug is null);
  if vazios <> 0 then
    raise exception 'RLS-FALHA M9: % evento(s) no ar sem categoria ou sem organizadora legivel', vazios;
  end if;
end $$;
rollback to savepoint m9;

-- M10: mover o evento de igreja. O USING de `events_update` olha a igreja atual
-- (a2 gerencia a igreja A, então alcança a linha); quem barra a mudança é o WITH
-- CHECK, que avalia o `church_id` novo. Sem ele, um gerente "transferiria" o
-- evento para outra igreja — e as inscrições iriam junto, porque
-- `event_registrations.church_id` é derivado do evento (0012). É a lacuna que um
-- formulário de edição abre e que o M7 não cobre: o M7 mede escrita cruzada, este
-- mede a linha certa escrita com o campo errado.
--
-- Para provar por mutação: trocar `with check (...)` por `with check (true)`.
-- Só apagar a cláusula não prova nada — sem WITH CHECK o Postgres reusa a
-- expressão do USING para a linha nova, e o comportamento é idêntico.
savepoint m10;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int; church_now uuid;
begin
  begin
    update public.events set church_id = current_setting('app.church_b')::uuid
     where id = current_setting('app.event_a_pub')::uuid;
    raise exception 'RLS-FALHA M10: gerente da igreja A moveu o evento para a igreja B';
  exception when insufficient_privilege then null; end;

  -- A recusa tem de ser recusa de verdade: a linha continua na igreja A.
  select church_id into church_now from public.events where id = current_setting('app.event_a_pub')::uuid;
  if church_now <> current_setting('app.church_a')::uuid then
    raise exception 'RLS-FALHA M10: o evento mudou de igreja (%), esperava a igreja A', church_now;
  end if;

  -- E a mesma sessão continua podendo editar o que é dela: se o WITH CHECK
  -- estivesse barrando tudo, o formulário não serviria para nada.
  update public.events set name = 'Nome ajustado pelo gerente'
   where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA M10: gerente nao editou o proprio evento (% linhas)', n; end if;
end $$;

-- De fora nem a tentativa existe: b1 não alcança a linha (USING), então o update
-- afeta zero linhas em vez de estourar 42501. As duas respostas são corretas e
-- diferentes — e é por isso que este bloco é separado do anterior.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int; church_now uuid;
begin
  update public.events set church_id = current_setting('app.church_b')::uuid
   where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA M10: b1 puxou o evento da igreja A para a B (% linhas)', n; end if;

  select church_id into church_now from public.events where id = current_setting('app.event_a_pub')::uuid;
  if church_now <> current_setting('app.church_a')::uuid then
    raise exception 'RLS-FALHA M10: depois da tentativa do b1 o evento nao esta mais na igreja A (%)', church_now;
  end if;
end $$;
rollback to savepoint m10;

-- ---------------------------------------------------------------------------
-- GRUPO N — inscrições (0012): escrita por visitante anon, capacidade, check-in
-- e o que cada audiência enxerga.
--
-- O que este grupo garante:
--   * a tabela não tem grant de escrita nem política de insert/update/delete:
--     quem escreve é a RPC, e N1/N11 medem a recusa direto na tabela;
--   * anon não lê inscrição nenhuma (N1) — nome, e-mail e telefone de visitante
--     são dados pessoais e não viram leitura pública;
--   * `registrations.manage` é a porta da lista: o comunicador tem
--     `events.manage` e fica de fora (N3), a equipe da igreja lê as suas e não
--     as da vizinha (N2);
--   * a RPC de inscrição tem a mesma audiência de `events_public_read`, e tudo
--     que não está no ar devolve UM código só (N5) — sem oráculo de enumeração;
--   * capacidade não estoura: excedente vira lista de espera (N7) e o
--     cancelamento promove o mais antigo da fila (N8);
--   * check-in e cancelamento exigem permissão na igreja da linha; o dono da
--     própria inscrição pode cancelá-la (N9, N10);
--   * `church_id` é derivado do evento e não pode ser forjado (N12);
--   * o `ticket_code` nunca sai pela RPC (N4) e a view pública só tem agregados
--     (N13, N15);
--   * quem se inscreve logado lê apenas a própria linha (N14).
-- ---------------------------------------------------------------------------

select set_config('app.event_a_lot', 'eeeeeeee-0000-4000-8000-0000000000a6', false);
select set_config('app.event_a_old', 'eeeeeeee-0000-4000-8000-0000000000a7', false);
select set_config('app.reg_a_conf', 'ffffffff-0000-4000-8000-0000000000a1', false);
select set_config('app.reg_a_wait', 'ffffffff-0000-4000-8000-0000000000a2', false);
select set_config('app.reg_b_conf', 'ffffffff-0000-4000-8000-0000000000b1', false);

-- Um evento com capacidade 2 (para medir fila) e um que já começou (para medir a
-- recusa de inscrição tardia). Publicados entram como service_role, como no M.
set role service_role;
insert into public.events (id, church_id, category_id, slug, name, description, starts_at, city, capacity, is_free, visibility, status) values
  (current_setting('app.event_a_lot')::uuid, current_setting('app.church_a')::uuid,
   (select id from public.event_categories where slug = 'jovens'),
   'evento-a-lotado', 'Encontro com Vagas', 'Capacidade 2: a terceira inscricao vai para a fila.',
   '2026-11-21T19:00:00-03:00', 'Cidade A', 2, true, 'public', 'published'),
  (current_setting('app.event_a_old')::uuid, current_setting('app.church_a')::uuid,
   (select id from public.event_categories where slug = 'cultos-especiais'),
   'evento-a-passado', 'Culto Já Realizado', 'Comecou antes de agora.',
   '2026-01-10T19:00:00-03:00', 'Cidade A', null, true, 'public', 'published');
reset role;

-- Inscrições de referência, criadas como dono da conexão. O trigger de church_id
-- roda aqui também: se ele só valesse para `authenticated`, estes inserts seriam
-- a prova de que a derivação é decorativa.
insert into public.event_registrations (id, event_id, church_id, visitor_name, visitor_email, status, ticket_code) values
  (current_setting('app.reg_a_conf')::uuid, current_setting('app.event_a_pub')::uuid, current_setting('app.church_a')::uuid,
   'Ana Souza', 'ana@email.test', 'confirmed', 'AAA-222'),
  (current_setting('app.reg_a_wait')::uuid, current_setting('app.event_a_pub')::uuid, current_setting('app.church_a')::uuid,
   'Bruno Lima', 'bruno@email.test', 'waitlist', 'BBB-333'),
  (current_setting('app.reg_b_conf')::uuid, current_setting('app.event_b_pub')::uuid, current_setting('app.church_b')::uuid,
   'Carla Nunes', 'carla@email.test', 'confirmed', 'CCC-444');

-- N1: anon não tem grant nenhum na tabela — nem para ler, nem para escrever.
-- Diferente de "RLS devolveu 0 linhas": aqui a consulta é recusada antes.
savepoint n1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  begin
    select count(*) into n from public.event_registrations;
    raise exception 'RLS-FALHA N1: anon conseguiu ler % inscricao(oes)', n;
  exception when insufficient_privilege then null; end;

  begin
    insert into public.event_registrations (event_id, church_id, visitor_name, visitor_email, status, ticket_code)
    values (current_setting('app.event_a_pub')::uuid, current_setting('app.church_a')::uuid,
            'Invasor', 'invasor@email.test', 'confirmed', 'ZZZ-999');
    raise exception 'RLS-FALHA N1: anon inseriu inscricao direto na tabela';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint n1;

-- N2: equipe da igreja A lê as inscrições da A e não lê as da B.
savepoint n2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare da_outras int; total int;
begin
  select count(*) into total from public.event_registrations;
  if total <> 2 then
    raise exception 'RLS-FALHA N2: church_admin da A leu % inscricoes, esperava 2 (as da propria igreja)', total;
  end if;

  select count(*) into da_outras from public.event_registrations
  where church_id <> current_setting('app.church_a')::uuid;
  if da_outras <> 0 then
    raise exception 'RLS-FALHA N2: church_admin da A leu % inscricao(oes) de outra igreja', da_outras;
  end if;

  if exists (select 1 from public.event_registrations where id = current_setting('app.reg_b_conf')::uuid) then
    raise exception 'RLS-FALHA N2: church_admin da A leu a inscricao da igreja B';
  end if;
end $$;
rollback to savepoint n2;

-- N3: comunicador tem `events.manage` sem `registrations.manage` — não lê a
-- lista nem faz check-in. É a diferença de permissão dentro da MESMA igreja.
savepoint n3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a3'))::text, true);
do $$
declare n int; resultado text;
begin
  select count(*) into n from public.event_registrations;
  if n <> 0 then
    raise exception 'RLS-FALHA N3: comunicador da A leu % inscricao(oes) sem ter registrations.manage', n;
  end if;

  resultado := public.check_in_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'sem_permissao' then
    raise exception 'RLS-FALHA N3: check-in do comunicador devolveu "%" em vez de sem_permissao', resultado;
  end if;

  resultado := public.cancel_event_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'sem_permissao' then
    raise exception 'RLS-FALHA N3: cancelamento do comunicador devolveu "%" em vez de sem_permissao', resultado;
  end if;
end $$;
rollback to savepoint n3;

-- N4: visitante anon se inscreve no evento publicado. A linha nasce com o
-- church_id do evento e com código de ingresso, mas o código NÃO volta na
-- resposta — a RPC devolve só o estado, porque quem digitou o e-mail ainda não
-- provou que é dono dele.
savepoint n4;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare resultado text;
begin
  resultado := public.register_for_event(
    current_setting('app.event_a_pub')::uuid, 'Carla Dias', 'CARLA.Dias@Email.test ', '12 99999-0000');
  if resultado <> 'confirmed' then
    raise exception 'RLS-FALHA N4: inscricao do visitante devolveu "%", esperava confirmed', resultado;
  end if;
  if position('-' in resultado) > 0 or length(resultado) > 25 then
    raise exception 'RLS-FALHA N4: a RPC devolveu "%" — parece codigo de ingresso, e ele nao pode sair por aqui', resultado;
  end if;
end $$;
reset role;
do $$
declare reg public.event_registrations%rowtype;
begin
  select * into reg from public.event_registrations where visitor_email = 'carla.dias@email.test';
  if reg.id is null then
    raise exception 'RLS-FALHA N4: a inscricao do visitante nao foi gravada';
  end if;
  if reg.church_id <> current_setting('app.church_a')::uuid then
    raise exception 'RLS-FALHA N4: church_id gravado nao e o do evento';
  end if;
  if reg.ticket_code is null or length(reg.ticket_code) < 6 then
    raise exception 'RLS-FALHA N4: inscricao sem codigo de ingresso utilizavel';
  end if;
  if reg.user_id is not null then
    raise exception 'RLS-FALHA N4: inscricao anonima saiu com user_id preenchido';
  end if;
  if reg.visitor_name <> 'Carla Dias' then
    raise exception 'RLS-FALHA N4: nome gravado "%" nao foi normalizado', reg.visitor_name;
  end if;
  if reg.visitor_phone <> '12 99999-0000' then
    raise exception 'RLS-FALHA N4: telefone nao foi gravado';
  end if;
end $$;
-- A contagem pública do evento passa de 2 para 3 (a view é a fonte do número).
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare ativos int;
begin
  select active_count into ativos from public.event_registration_stats
  where event_id = current_setting('app.event_a_pub')::uuid;
  if ativos is distinct from 3 then
    raise exception 'RLS-FALHA N4: estatistica publica mostrou % inscritos, esperava 3', ativos;
  end if;
end $$;
rollback to savepoint n4;

-- N5: tudo que não está no ar devolve O MESMO código. Se a RPC distinguisse
-- "não existe" de "é rascunho", o visitante teria um oráculo da agenda interna.
savepoint n5;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare alvo text; resultado text; alvos text[] := array[
  'app.event_a_dra', 'app.event_a_pri', 'app.event_a_unl', 'app.event_a_sch', 'app.event_c_pub'];
begin
  foreach alvo in array alvos loop
    resultado := public.register_for_event(current_setting(alvo)::uuid, 'Espião de Agenda', 'espiao@email.test');
    if resultado <> 'evento_indisponivel' then
      raise exception 'RLS-FALHA N5: inscricao em % devolveu "%", esperava evento_indisponivel', alvo, resultado;
    end if;
  end loop;

  resultado := public.register_for_event('eeeeeeee-9999-4999-8999-999999999999'::uuid, 'Espião de Agenda', 'espiao@email.test');
  if resultado <> 'evento_indisponivel' then
    raise exception 'RLS-FALHA N5: evento inexistente devolveu "%", esperava evento_indisponivel', resultado;
  end if;
end $$;
rollback to savepoint n5;

-- N6: evento que já começou, dados inválidos e e-mail duplicado.
savepoint n6;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare resultado text; antes int; depois int;
begin
  resultado := public.register_for_event(current_setting('app.event_a_old')::uuid, 'Atrasado', 'atrasado@email.test');
  if resultado <> 'evento_encerrado' then
    raise exception 'RLS-FALHA N6: inscricao em evento encerrado devolveu "%"', resultado;
  end if;

  resultado := public.register_for_event(current_setting('app.event_a_pub')::uuid, 'A', 'curto@email.test');
  if resultado <> 'dados_invalidos' then
    raise exception 'RLS-FALHA N6: nome de 1 caractere devolveu "%"', resultado;
  end if;

  resultado := public.register_for_event(current_setting('app.event_a_pub')::uuid, 'Sem Arroba', 'sem-arroba');
  if resultado <> 'dados_invalidos' then
    raise exception 'RLS-FALHA N6: e-mail sem arroba devolveu "%"', resultado;
  end if;

  -- o e-mail da fixture é ana@email.test: repetir nao pode criar segunda fila
  resultado := public.register_for_event(current_setting('app.event_a_pub')::uuid, 'Ana de Novo', 'ANA@email.test');
  if resultado <> 'ja_inscrita' then
    raise exception 'RLS-FALHA N6: e-mail ja inscrito devolveu "%"', resultado;
  end if;
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.event_registrations where lower(visitor_email) = 'ana@email.test';
  if n <> 1 then
    raise exception 'RLS-FALHA N6: o e-mail duplicado virou % linhas', n;
  end if;
end $$;
rollback to savepoint n6;

-- N7: capacidade 2. A terceira inscrição vai para a lista de espera e a
-- estatística pública mostra a fila e zero vagas — sem estourar o evento.
savepoint n7;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare r1 text; r2 text; r3 text; confirmados int; fila int; vagas int;
begin
  r1 := public.register_for_event(current_setting('app.event_a_lot')::uuid, 'Primeiro', 'um@email.test');
  r2 := public.register_for_event(current_setting('app.event_a_lot')::uuid, 'Segundo', 'dois@email.test');
  r3 := public.register_for_event(current_setting('app.event_a_lot')::uuid, 'Terceiro', 'tres@email.test');
  if r1 <> 'confirmed' or r2 <> 'confirmed' then
    raise exception 'RLS-FALHA N7: as duas primeiras inscricoes deveriam confirmar (%, %)', r1, r2;
  end if;
  if r3 <> 'waitlist' then
    raise exception 'RLS-FALHA N7: a terceira inscricao devolveu "%", esperava waitlist', r3;
  end if;

  select confirmed_count, waitlist_count, spots_left into confirmados, fila, vagas
  from public.event_registration_stats where event_id = current_setting('app.event_a_lot')::uuid;
  if confirmados <> 2 or fila <> 1 or vagas <> 0 then
    raise exception 'RLS-FALHA N7: estatistica mostrou % confirmados, % na fila e % vagas (esperava 2/1/0)',
      confirmados, fila, vagas;
  end if;
end $$;
rollback to savepoint n7;

-- N8: cancelar uma inscrição confirmada libera vaga e promove o mais antigo da
-- fila. A promoção é automática e acontece dentro da mesma transação.
savepoint n8;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare r3 text;
begin
  perform public.register_for_event(current_setting('app.event_a_lot')::uuid, 'Primeiro', 'um@email.test');
  perform public.register_for_event(current_setting('app.event_a_lot')::uuid, 'Segundo', 'dois@email.test');
  r3 := public.register_for_event(current_setting('app.event_a_lot')::uuid, 'Terceiro', 'tres@email.test');
  if r3 <> 'waitlist' then
    raise exception 'RLS-FALHA N8: a fixture do caso nao colocou o terceiro na fila (devolveu "%")', r3;
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare resultado text; alvo uuid;
begin
  select id into alvo from public.event_registrations where visitor_email = 'um@email.test';
  resultado := public.cancel_event_registration(alvo);
  if resultado <> 'cancelada_com_promocao' then
    raise exception 'RLS-FALHA N8: cancelamento devolveu "%", esperava cancelada_com_promocao', resultado;
  end if;
end $$;
reset role;
do $$
declare promovido text; confirmados int;
begin
  select status into promovido from public.event_registrations where visitor_email = 'tres@email.test';
  if promovido <> 'confirmed' then
    raise exception 'RLS-FALHA N8: o terceiro da fila ficou "%" depois da vaga abrir', promovido;
  end if;
  select confirmed_count into confirmados from public.event_registration_stats
  where event_id = current_setting('app.event_a_lot')::uuid;
  if confirmados <> 2 then
    raise exception 'RLS-FALHA N8: o evento ficou com % confirmados, esperava 2 (capacidade)', confirmados;
  end if;
end $$;
rollback to savepoint n8;

-- N9: quem não é da igreja não cancela inscrição alheia; o dono da própria
-- linha cancela a sua (ramo `user_id = auth.uid()`).
savepoint n9;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare resultado text;
begin
  resultado := public.cancel_event_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'sem_permissao' then
    raise exception 'RLS-FALHA N9: usuario sem vinculo cancelou inscricao alheia ("%")', resultado;
  end if;

  resultado := public.cancel_event_registration(current_setting('app.reg_b_conf')::uuid);
  if resultado <> 'sem_permissao' then
    raise exception 'RLS-FALHA N9: usuario logado sem vinculo cancelou inscricao da igreja B ("%")', resultado;
  end if;

  -- id inexistente: mesmo código de linha alheia, sem revelar se existe
  resultado := public.cancel_event_registration('ffffffff-9999-4999-8999-999999999999'::uuid);
  if resultado <> 'sem_permissao' then
    raise exception 'RLS-FALHA N9: cancelamento de id inexistente devolveu "%", esperava sem_permissao', resultado;
  end if;

  -- o mesmo usuario se inscreve logado: a RPC grava o user_id da sessao
  resultado := public.register_for_event(current_setting('app.event_b_pub')::uuid, 'Fora do Clero', 'fora@exemplo.test');
  if resultado <> 'confirmed' then
    raise exception 'RLS-FALHA N9: a fixture do caso nao confirmou a inscricao ("%")', resultado;
  end if;

  resultado := public.cancel_event_registration(
    (select id from public.event_registrations where visitor_email = 'fora@exemplo.test'));
  if resultado <> 'cancelada' then
    raise exception 'RLS-FALHA N9: o dono da linha nao cancelou a propria inscricao ("%")', resultado;
  end if;
end $$;
rollback to savepoint n9;

-- N10: check-in — presente, repetido, sobre inscrição cancelada, id inexistente
-- e a tentativa cruzada (admin da B sobre inscrição da A).
savepoint n10;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare resultado text;
begin
  resultado := public.check_in_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'presente' then
    raise exception 'RLS-FALHA N10: check-in da equipe devolveu "%", esperava presente', resultado;
  end if;

  resultado := public.check_in_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'ja_presente' then
    raise exception 'RLS-FALHA N10: check-in repetido devolveu "%", esperava ja_presente', resultado;
  end if;

  resultado := public.check_in_registration(current_setting('app.reg_a_wait')::uuid);
  if resultado <> 'presente' then
    raise exception 'RLS-FALHA N10: check-in de quem estava na fila devolveu "%"', resultado;
  end if;

  -- id inexistente devolve o mesmo código de linha alheia: a função não pode
  -- servir de sonda para descobrir quais inscrições existem
  resultado := public.check_in_registration('ffffffff-9999-4999-8999-999999999999'::uuid);
  if resultado <> 'sem_permissao' then
    raise exception 'RLS-FALHA N10: inscricao inexistente devolveu "%", esperava sem_permissao', resultado;
  end if;

  resultado := public.cancel_event_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'cancelada' then
    raise exception 'RLS-FALHA N10: cancelamento de quem ja estava presente devolveu "%", esperava cancelada', resultado;
  end if;

  resultado := public.check_in_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'cancelada' then
    raise exception 'RLS-FALHA N10: check-in de inscricao cancelada devolveu "%", esperava cancelada', resultado;
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare resultado text;
begin
  resultado := public.check_in_registration(current_setting('app.reg_a_conf')::uuid);
  if resultado <> 'sem_permissao' then
    raise exception 'RLS-FALHA N10: admin da igreja B fez check-in na igreja A ("%")', resultado;
  end if;
end $$;
reset role;
do $$
declare marcada int;
begin
  select count(*) into marcada from public.event_registrations
  where id = current_setting('app.reg_a_wait')::uuid and status = 'checked_in' and checked_in_at is not null;
  if marcada <> 1 then
    raise exception 'RLS-FALHA N10: o check-in nao gravou status e horario';
  end if;
end $$;
rollback to savepoint n10;

-- N11: nem a equipe escreve direto na tabela — só SELECT foi concedido. Sem
-- grant de escrita e sem política de insert/update/delete, a RPC é o único
-- caminho, o que mantém a derivação de church_id e a fila valendo para todos.
savepoint n11;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  begin
    insert into public.event_registrations (event_id, church_id, visitor_name, visitor_email, status, ticket_code)
    values (current_setting('app.event_a_pub')::uuid, current_setting('app.church_a')::uuid,
            'Manual', 'manual@email.test', 'confirmed', 'MMM-111');
    raise exception 'RLS-FALHA N11: church_admin inseriu inscricao direto na tabela';
  exception when insufficient_privilege then null; end;

  begin
    update public.event_registrations set status = 'checked_in' where id = current_setting('app.reg_a_conf')::uuid;
    raise exception 'RLS-FALHA N11: church_admin atualizou inscricao direto na tabela';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.event_registrations where id = current_setting('app.reg_a_conf')::uuid;
    raise exception 'RLS-FALHA N11: church_admin apagou inscricao direto na tabela';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint n11;

-- N12: church_id forjado. A coluna é a chave do isolamento, então o trigger
-- confere com o evento para QUALQUER autor — inclusive service_role e SQL Editor.
savepoint n12;
do $$
begin
  begin
    insert into public.event_registrations (event_id, church_id, visitor_name, visitor_email, status, ticket_code)
    values (current_setting('app.event_a_pub')::uuid, current_setting('app.church_b')::uuid,
            'Forjado', 'forjado@email.test', 'confirmed', 'FFF-000');
    raise exception 'RLS-FALHA N12: inscricao com church_id de outra igreja foi aceita';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint n12;

-- N13: audiência da view de estatísticas. O visitante vê os eventos no ar (com
-- zero quando ninguém se inscreveu — LEFT JOIN, para ausência de linha não ser
-- ambígua); o membro vê os da própria igreja em qualquer status; a vizinha não.
savepoint n13;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare no_ar int; ocultos int; zerado int;
begin
  select count(*) into no_ar from public.event_registration_stats;
  if no_ar <> 4 then
    raise exception 'RLS-FALHA N13: anon viu % linhas de estatistica, esperava 4 (eventos no ar)', no_ar;
  end if;

  select count(*) into ocultos from public.event_registration_stats
  where event_id in (current_setting('app.event_a_dra')::uuid,
                     current_setting('app.event_a_pri')::uuid,
                     current_setting('app.event_a_unl')::uuid,
                     current_setting('app.event_a_sch')::uuid,
                     current_setting('app.event_b_dra')::uuid,
                     current_setting('app.event_c_pub')::uuid);
  if ocultos <> 0 then
    raise exception 'RLS-FALHA N13: anon viu estatistica de % evento(s) fora do ar', ocultos;
  end if;

  select active_count into zerado from public.event_registration_stats
  where event_id = current_setting('app.event_a_old')::uuid;
  if zerado is distinct from 0 then
    raise exception 'RLS-FALHA N13: evento sem inscricao mostrou "%" em vez de 0', zerado;
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare rascunho int; vizinha int;
begin
  select count(*) into rascunho from public.event_registration_stats
  where event_id = current_setting('app.event_a_dra')::uuid;
  if rascunho <> 1 then
    raise exception 'RLS-FALHA N13: membro da A nao viu a estatistica do proprio rascunho';
  end if;

  select count(*) into vizinha from public.event_registration_stats
  where event_id = current_setting('app.event_b_dra')::uuid;
  if vizinha <> 0 then
    raise exception 'RLS-FALHA N13: membro da A viu a estatistica do rascunho da igreja B';
  end if;
end $$;
rollback to savepoint n13;

-- N14: quem se inscreve logado lê apenas a própria linha — o ramo
-- `user_id = auth.uid()` não pode virar leitura da lista inteira.
savepoint n14;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare resultado text;
begin
  resultado := public.register_for_event(current_setting('app.event_a_pub')::uuid, 'Visitante Logado', 'logado@email.test');
  if resultado <> 'confirmed' then
    raise exception 'RLS-FALHA N14: inscricao de usuario logado devolveu "%"', resultado;
  end if;
end $$;
do $$
declare n int; alheias int; codigo text;
begin
  select count(*) into n from public.event_registrations;
  if n <> 1 then
    raise exception 'RLS-FALHA N14: usuario sem vinculo leu % inscricoes, esperava 1 (a propria)', n;
  end if;

  select count(*) into alheias from public.event_registrations
  where user_id is distinct from current_setting('app.user_out')::uuid;
  if alheias <> 0 then
    raise exception 'RLS-FALHA N14: usuario sem vinculo leu % inscricao(oes) de outras pessoas', alheias;
  end if;

  select ticket_code into codigo from public.event_registrations;
  if codigo is null then
    raise exception 'RLS-FALHA N14: o dono da linha nao consegue ler o proprio codigo de ingresso';
  end if;
end $$;
reset role;
do $$
declare vinculo uuid;
begin
  select user_id into vinculo from public.event_registrations where visitor_email = 'logado@email.test';
  if vinculo <> current_setting('app.user_out')::uuid then
    raise exception 'RLS-FALHA N14: a inscricao logada nao gravou o user_id da sessao';
  end if;
end $$;
rollback to savepoint n14;

-- N15: a view pública é só de agregados. Se alguém acrescentar nome, e-mail,
-- telefone ou código de ingresso nela, o visitante anon passa a ler dados
-- pessoais de terceiros — este caso quebra antes.
savepoint n15;
do $$
declare vaza int; colunas int;
begin
  select count(*) into vaza from information_schema.columns
  where table_schema = 'public' and table_name = 'event_registration_stats'
    and (column_name like '%email%' or column_name like '%name%'
         or column_name like '%phone%' or column_name like '%ticket%');
  if vaza <> 0 then
    raise exception 'RLS-FALHA N15: a view de estatisticas expoe % coluna(s) com dado pessoal', vaza;
  end if;

  select count(*) into colunas from information_schema.columns
  where table_schema = 'public' and table_name = 'event_registration_stats';
  if colunas < 10 then
    raise exception 'RLS-FALHA N15: a view tem % colunas — sonda anti-no-op: o caso anterior pode nao estar medindo nada', colunas;
  end if;
end $$;
rollback to savepoint n15;

-- ---------------------------------------------------------------------------
-- GRUPO O — filiais e localização (0013): quem lê endereço de congregação, quem
-- escreve nele, e o que impede um evento de apontar para a filial alheia.
--
-- O que este grupo garante:
--   * `church_branches` não é vitrine: anon não recebe grant nenhum, então a
--     recusa acontece ANTES da RLS (O1). O mapa público plota igrejas, não
--     congregações — publicar a lista de filiais é decisão da igreja;
--   * membro ativo lê as filiais da própria igreja e não as da vizinha (O2);
--     vínculo `invited` não lê nada (O3), porque `current_church_ids()` só
--     devolve vínculos ativos;
--   * escrever exige `church.manage`: gerente e comunicador leem, não inserem e
--     não editam (O4). O caso mede as duas respostas de propósito — INSERT sem
--     WITH CHECK estoura 42501, UPDATE sem USING afeta zero linhas em silêncio;
--   * church_admin cadastra e edita; transferir a filial de igreja é recusado
--     (O5) — e o caso separa os três atores, porque a camada que recusa cada um
--     é diferente (leitura para quem não é da outra igreja, WITH CHECK para quem
--     é membro das duas e administra só uma, USING silencioso para quem é de
--     fora);
--   * SuperAdmin atravessa igrejas para ler e escrever (O6);
--   * excluir não existe: sem política e sem grant, nem o SuperAdmin apaga (O7);
--   * `events.branch_id` de outra igreja é recusado com a MESMA mensagem e o
--     MESMO SQLSTATE de uma filial inexistente (O8) — sem oráculo de existência
--     — e trocar a igreja de um evento já vinculado também esbarra no trigger;
--   * coordenada fora do intervalo é recusada nas três origens (O9) e NULL é
--     aceito: endereço sem GPS é estado honesto, o mapa diz "não plotada" em vez
--     de inventar posição;
--   * guardas estruturais (O10): trigger DEFINER com search_path fixo e sem
--     EXECUTE público, ausência de delete, WITH CHECK real e as colunas que o
--     app projeta.
-- ---------------------------------------------------------------------------

-- Fixtures do grupo. a4 é membro `invited` da igreja A: papel com church.manage
-- na matriz, mas vínculo não ativo — se a leitura olhasse o papel em vez do
-- status, O3 deixaria de medir alguma coisa.
select set_config('app.user_a4',       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', false);
select set_config('app.user_ab',       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', false);
select set_config('app.branch_a_sede', '99999999-0000-4000-8000-0000000000a1', false);
select set_config('app.branch_a_zs',   '99999999-0000-4000-8000-0000000000a2', false);
select set_config('app.branch_b_1',    '99999999-0000-4000-8000-0000000000b1', false);

insert into auth.users (id, email, raw_user_meta_data) values
  (current_setting('app.user_a4')::uuid, 'a4@igreja-a.test', '{"full_name":"Convidada A"}'::jsonb),
  (current_setting('app.user_ab')::uuid, 'ab@duas-igrejas.test', '{"full_name":"Admin A e Gerente B"}'::jsonb);

insert into public.church_members (church_id, user_id, role_id, status) values
  (current_setting('app.church_a')::uuid, current_setting('app.user_a4')::uuid,
   (select id from public.roles where key = 'manager'), 'invited'),
  -- ab administra a igreja A e é só gerente na B. É a única forma de alcançar o
  -- WITH CHECK de `church_branches_update`: ele LÊ a filial das duas igrejas
  -- (a política de leitura não barra a transferência), mas só tem church.manage
  -- numa delas. Ver O5.
  (current_setting('app.church_a')::uuid, current_setting('app.user_ab')::uuid,
   (select id from public.roles where key = 'church_admin'), 'active'),
  (current_setting('app.church_b')::uuid, current_setting('app.user_ab')::uuid,
   (select id from public.roles where key = 'manager'), 'active');

-- A filial Zona Sul nasce sem coordenada de propósito: é ela que os casos de
-- NULL aceito e de "igreja não plotada" usam.
insert into public.church_branches (id, church_id, name, address, city, state, lat, lng, leader) values
  (current_setting('app.branch_a_sede')::uuid, current_setting('app.church_a')::uuid,
   'Sede — Centro', 'Rua Um, 100', 'Cidade A', 'SP', -23.1857, -45.8871, 'Pr. Adauto'),
  (current_setting('app.branch_a_zs')::uuid, current_setting('app.church_a')::uuid,
   'Congregação Zona Sul', 'Rua Dois, 200', 'Cidade A', 'SP', null, null, null),
  (current_setting('app.branch_b_1')::uuid, current_setting('app.church_b')::uuid,
   'Sede — Centro', 'Rua Três, 300', 'Cidade B', 'SP', -23.2099, -45.9061, 'Pr. Bruno');

-- Sonda anti-no-op do grupo inteiro: se as fixtures não entraram, todos os casos
-- de "não lê" abaixo passam verdes sem medir nada.
do $$
declare n int;
begin
  select count(*) into n from public.church_branches;
  if n <> 3 then
    raise exception 'RLS-FALHA O-sonda: esperava 3 filiais de fixture, encontrei %', n;
  end if;
end $$;

-- O1: anon não tem grant nenhum na tabela. Não é "RLS devolveu 0 linhas": a
-- consulta é recusada antes, o que também vale para insert e delete.
savepoint o1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  begin
    select count(*) into n from public.church_branches;
    raise exception 'RLS-FALHA O1: anon leu % filial(is) — filial não é dado público', n;
  exception when insufficient_privilege then null; end;

  begin
    insert into public.church_branches (church_id, name)
    values (current_setting('app.church_a')::uuid, 'Filial do invasor');
    raise exception 'RLS-FALHA O1: anon inseriu filial direto na tabela';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.church_branches where church_id = current_setting('app.church_a')::uuid;
    raise exception 'RLS-FALHA O1: anon apagou filial';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint o1;

-- O2: church_admin da A lê as filiais da A, não lê as da B, e a projeção que o
-- branchService pede existe com estes nomes de coluna.
savepoint o2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare total int; de_outras int;
begin
  select count(*) into total from public.church_branches;
  if total <> 2 then
    raise exception 'RLS-FALHA O2: church_admin da A leu % filiais, esperava 2', total;
  end if;

  select count(*) into de_outras from public.church_branches
  where church_id <> current_setting('app.church_a')::uuid;
  if de_outras <> 0 then
    raise exception 'RLS-FALHA O2: church_admin da A leu % filial(is) de outra igreja', de_outras;
  end if;

  if exists (select 1 from public.church_branches where id = current_setting('app.branch_b_1')::uuid) then
    raise exception 'RLS-FALHA O2: a1 leu a filial da igreja B';
  end if;

  -- Anti-deriva: se uma migração renomear coluna que a tela de filiais projeta,
  -- a suíte quebra aqui em vez de a tela estourar em produção.
  perform id, church_id, name, address, city, state, lat, lng, leader, created_at, updated_at
  from public.church_branches where id = current_setting('app.branch_a_sede')::uuid;
  if not found then
    raise exception 'RLS-FALHA O2: a projeção de filiais não devolveu a linha da sede';
  end if;
end $$;
rollback to savepoint o2;

-- O3: vínculo `invited` não lê filial nenhuma. O convite (0008) dá acesso ao
-- roster só depois do aceite; endereço de congregação segue a mesma régua.
savepoint o3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a4'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_branches;
  if n <> 0 then
    raise exception 'RLS-FALHA O3: convidada da A leu % filial(is) — vínculo invited não é ativo', n;
  end if;

  begin
    insert into public.church_branches (church_id, name)
    values (current_setting('app.church_a')::uuid, 'Filial da convidada');
    raise exception 'RLS-FALHA O3: convidada inseriu filial';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint o3;

-- O4: quem tem events.manage sem church.manage lê mas não escreve. Gerente (a2)
-- e comunicador (a3) são os dois papéis que a UI expõe na tela de eventos; sem
-- este caso, o formulário de filiais apareceria para quem não pode salvar.
savepoint o4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_branches;
  if n <> 2 then
    raise exception 'RLS-FALHA O4: gerente da A leu % filiais, esperava 2', n;
  end if;

  begin
    insert into public.church_branches (church_id, name)
    values (current_setting('app.church_a')::uuid, 'Filial do gerente');
    raise exception 'RLS-FALHA O4: gerente sem church.manage inseriu filial';
  exception when insufficient_privilege then null; end;

  -- UPDATE sem USING não estoura: afeta zero linhas. Medir as duas respostas é o
  -- ponto do caso — quem só esperasse erro aqui deixaria o silêncio passar.
  update public.church_branches set name = 'Renomeada pelo gerente'
   where id = current_setting('app.branch_a_sede')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA O4: gerente editou filial (% linhas)', n; end if;

  -- Sonda: a recusa é de permissão, não de sessão quebrada. O mesmo gerente
  -- continua gravando eventos, que é o que a matriz dele autoriza.
  update public.events set name = 'Nome ajustado pelo gerente'
   where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA O4: sonda — gerente perdeu a escrita de eventos (% linhas)', n; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a3'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_branches;
  if n <> 2 then
    raise exception 'RLS-FALHA O4: comunicador da A leu % filiais, esperava 2', n;
  end if;

  begin
    insert into public.church_branches (church_id, name)
    values (current_setting('app.church_a')::uuid, 'Filial do comunicador');
    raise exception 'RLS-FALHA O4: comunicador sem church.manage inseriu filial';
  exception when insufficient_privilege then null; end;

  update public.church_branches set lat = 0, lng = 0
   where id = current_setting('app.branch_a_sede')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA O4: comunicador moveu a filial (% linhas)', n; end if;
end $$;
rollback to savepoint o4;

-- O5: quem administra a igreja cadastra e edita filial; transferir a filial para
-- outra igreja é recusado. Vale registrar QUAL camada recusa cada ator, porque
-- não é a mesma nos três blocos:
--
--   * a1 (membro só da A): quem barra é a política de LEITURA. Num UPDATE o
--     Postgres exige que a linha nova também satisfaça as políticas de SELECT da
--     tabela, e a1 não lê filial da igreja B. Trocar o WITH CHECK de
--     `church_branches_update` por `true` NÃO muda este bloco — medido, com o
--     banco dumpando as políticas no momento da tentativa.
--   * ab (church_admin na A, gerente na B): ele lê as filiais das duas igrejas,
--     então a leitura não barra; o que recusa é o WITH CHECK de
--     `church_branches_update`, porque `church.manage` na B ele não tem. É o
--     único bloco sensível à mutação do WITH CHECK — para provar, trocar
--     `with check (...)` por `with check (true)` e ver ESTE bloco falhar. Só
--     apagar a cláusula não prova nada: sem WITH CHECK o Postgres reusa o USING.
--   * b1 (de fora): nem tenta. Não alcança a linha pelo USING e o update afeta
--     zero linhas em silêncio.
savepoint o5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; nova uuid; igreja uuid; nome text;
begin
  insert into public.church_branches (church_id, name, city, state)
  values (current_setting('app.church_a')::uuid, 'Congregação Norte', 'Cidade A', 'SP')
  returning id into nova;
  if nova is null then
    raise exception 'RLS-FALHA O5: church_admin nao conseguiu cadastrar filial';
  end if;

  update public.church_branches
     set name = 'Congregação Norte — Sede', address = 'Rua Quatro, 400', lat = -23.15, lng = -45.90
   where id = nova;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA O5: church_admin nao editou a propria filial (% linhas)', n; end if;

  select name into nome from public.church_branches where id = nova;
  if nome <> 'Congregação Norte — Sede' then
    raise exception 'RLS-FALHA O5: a edicao nao persistiu (nome = %)', nome;
  end if;

  begin
    update public.church_branches set church_id = current_setting('app.church_b')::uuid
     where id = nova;
    raise exception 'RLS-FALHA O5: church_admin da A transferiu a filial para a igreja B';
  exception when insufficient_privilege then null; end;

  select church_id into igreja from public.church_branches where id = nova;
  if igreja <> current_setting('app.church_a')::uuid then
    raise exception 'RLS-FALHA O5: a filial mudou de igreja (%)', igreja;
  end if;
end $$;

-- ab: o caso que o WITH CHECK de `church_branches_update` existe para cobrir.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_ab'))::text, true);
do $$
declare n int; igreja uuid;
begin
  -- Premissa, não resultado: ab tem de LER a filial da B. Se não lesse, a recusa
  -- abaixo viria da política de leitura (como no bloco do a1) e este caso não
  -- estaria medindo o WITH CHECK.
  if not exists (select 1 from public.church_branches where id = current_setting('app.branch_b_1')::uuid) then
    raise exception 'RLS-FALHA O5: premissa quebrada — ab nao le a filial da B, entao o WITH CHECK nao e o que esta sendo medido';
  end if;
  if not exists (select 1 from public.church_branches where id = current_setting('app.branch_a_sede')::uuid) then
    raise exception 'RLS-FALHA O5: premissa quebrada — ab nao le a filial da A';
  end if;

  begin
    update public.church_branches set church_id = current_setting('app.church_b')::uuid
     where id = current_setting('app.branch_a_sede')::uuid;
    raise exception 'RLS-FALHA O5: ab transferiu a filial da A para a B sendo só gerente na B';
  exception when insufficient_privilege then null; end;

  select church_id into igreja from public.church_branches where id = current_setting('app.branch_a_sede')::uuid;
  if igreja <> current_setting('app.church_a')::uuid then
    raise exception 'RLS-FALHA O5: a sede mudou de igreja (%) depois da tentativa do ab', igreja;
  end if;

  -- A recusa é por igreja, não global: na A ele administra e edita.
  update public.church_branches set leader = 'Pr. Adauto (revisto)'
   where id = current_setting('app.branch_a_sede')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA O5: ab nao editou a filial da igreja que administra (% linhas)', n; end if;
end $$;

-- De fora nem a tentativa existe: b1 não alcança a filial da A (USING), então o
-- update afeta zero linhas em vez de estourar 42501. As duas respostas são
-- corretas e diferentes — por isso este bloco é separado do anterior.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int; igreja uuid;
begin
  update public.church_branches set church_id = current_setting('app.church_b')::uuid
   where id = current_setting('app.branch_a_sede')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA O5: b1 puxou a filial da A para a B (% linhas)', n; end if;

  select church_id into igreja from public.church_branches where id = current_setting('app.branch_a_sede')::uuid;
  if igreja <> current_setting('app.church_a')::uuid then
    raise exception 'RLS-FALHA O5: depois da tentativa do b1 a filial nao esta mais na A (%)', igreja;
  end if;

  select count(*) into n from public.church_branches;
  if n <> 1 then
    raise exception 'RLS-FALHA O5: b1 leu % filiais, esperava 1 (a da propria igreja)', n;
  end if;
end $$;
rollback to savepoint o5;

-- O6: SuperAdmin atravessa igrejas nas duas direções. Ele é membro ativo da
-- igreja A; ler e escrever na B vem de `is_superadmin()`, não do vínculo. Se a
-- política de leitura passasse a exigir vínculo, este caso quebraria.
savepoint o6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare total int; linhas int; nova uuid;
begin
  select count(*) into total from public.church_branches;
  if total <> 3 then
    raise exception 'RLS-FALHA O6: superadmin leu % filiais, esperava as 3 do fixture', total;
  end if;

  select count(*) into linhas from public.church_branches
  where church_id = current_setting('app.church_b')::uuid;
  if linhas <> 1 then
    raise exception 'RLS-FALHA O6: superadmin nao leu a filial da igreja B (%)', linhas;
  end if;

  insert into public.church_branches (church_id, name, city, state)
  values (current_setting('app.church_b')::uuid, 'Congregação Leste', 'Cidade B', 'SP')
  returning id into nova;
  if nova is null then
    raise exception 'RLS-FALHA O6: superadmin nao cadastrou filial na igreja B';
  end if;

  update public.church_branches set leader = 'Pra. Carla' where id = nova;
  get diagnostics linhas = row_count;
  if linhas <> 1 then raise exception 'RLS-FALHA O6: superadmin nao editou a filial da B (% linhas)', linhas; end if;
end $$;
rollback to savepoint o6;

-- O7: excluir filial não está aberto. As duas respostas possíveis são corretas e
-- este caso aceita ambas: sem grant de delete a consulta é recusada antes
-- (42501); com grant e sem política de delete o default-deny apaga zero linhas
-- em silêncio. O que não é aceitável é a linha sumir — e é isso que se mede.
-- Quem detecta o grant em si é o O10, não este caso.
-- O único caminho de remoção é o backend (service_role) ou o cascade da igreja,
-- e abrir isso é decisão de produto, não de migração.
savepoint o7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  begin
    delete from public.church_branches where id = current_setting('app.branch_a_sede')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'RLS-FALHA O7: church_admin apagou filial (% linhas)', n; end if;
  exception when insufficient_privilege then null; end;

  select count(*) into n from public.church_branches where id = current_setting('app.branch_a_sede')::uuid;
  if n <> 1 then raise exception 'RLS-FALHA O7: a filial sumiu depois da tentativa de delete'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  begin
    delete from public.church_branches where id = current_setting('app.branch_b_1')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'RLS-FALHA O7: superadmin apagou filial pela API (% linhas)', n; end if;
  exception when insufficient_privilege then null; end;

  select count(*) into n from public.church_branches where id = current_setting('app.branch_b_1')::uuid;
  if n <> 1 then raise exception 'RLS-FALHA O7: a filial da B sumiu depois da tentativa do superadmin'; end if;
end $$;
rollback to savepoint o7;

-- O8: a filial do evento tem de ser da mesma igreja. Quem tenta é o gerente (a2),
-- que alcança o evento mas não lê `branch_b_1` — e a recusa vem igual, porque
-- "não enxergo a filial" e "a filial é de outra igreja" devolvem a MESMA
-- mensagem. O que este caso NÃO mede, registrado para ninguém revendê-lo como
-- prova: trocar o trigger de SECURITY DEFINER por INVOKER não muda comportamento
-- nenhum aqui, já que quem escreve evento lê as filiais da própria igreja. Essa
-- decisão fica travada estruturalmente no O10.
savepoint o8;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare msg_outra text; msg_fantasma text; filial uuid; n int;
begin
  begin
    update public.events set branch_id = current_setting('app.branch_b_1')::uuid
     where id = current_setting('app.event_a_pub')::uuid;
    raise exception 'RLS-FALHA O8: gerente da A vinculou o evento a uma filial da B';
  exception
    when insufficient_privilege then msg_outra := sqlerrm;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      msg_outra := sqlerrm;
  end;
  if coalesce(msg_outra, '') not like '%filial do evento precisa ser da mesma igreja%' then
    raise exception 'RLS-FALHA O8: recusa do vinculo cruzado veio com outra mensagem: %', coalesce(msg_outra, 'nenhuma');
  end if;

  -- Filial que não existe: MESMA mensagem e MESMO SQLSTATE. Se uma dissesse
  -- "é de outra igreja" e a outra "não encontrada", o gerente teria um oráculo
  -- para enumerar UUIDs de filiais de terceiros.
  begin
    update public.events set branch_id = '99999999-0000-4000-8000-0000000000ff'::uuid
     where id = current_setting('app.event_a_pub')::uuid;
    raise exception 'RLS-FALHA O8: evento aceitou filial inexistente';
  exception
    when insufficient_privilege then msg_fantasma := sqlerrm;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      msg_fantasma := sqlerrm;
  end;
  if msg_fantasma <> msg_outra then
    raise exception 'RLS-FALHA O8: mensagens diferentes para filial alheia e inexistente (oráculo de existência): "%" vs "%"',
      coalesce(msg_fantasma, 'nenhuma'), coalesce(msg_outra, 'nenhuma');
  end if;

  select branch_id into filial from public.events where id = current_setting('app.event_a_pub')::uuid;
  if filial is not null then
    raise exception 'RLS-FALHA O8: o evento ficou com branch_id (%) depois das tentativas', filial;
  end if;

  -- E o caminho legítimo funciona: filial da própria igreja.
  update public.events set branch_id = current_setting('app.branch_a_sede')::uuid
   where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA O8: gerente nao vinculou o evento à própria filial (% linhas)', n; end if;

  select branch_id into filial from public.events where id = current_setting('app.event_a_pub')::uuid;
  if filial <> current_setting('app.branch_a_sede')::uuid then
    raise exception 'RLS-FALHA O8: o vinculo nao persistiu (%)', filial;
  end if;
end $$;

-- Com o evento já vinculado, trocar a igreja dele deixaria a filial órfã de
-- sentido. O trigger é `UPDATE OF branch_id, church_id` por isso: sem a metade
-- `church_id`, o WITH CHECK do M10 continuaria barrando o gerente, mas um
-- SuperAdmin (que atravessa o WITH CHECK) levaria o evento para outra igreja com
-- a filial alheia junto.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare msg text; filial uuid; igreja uuid;
begin
  begin
    update public.events set church_id = current_setting('app.church_b')::uuid
     where id = current_setting('app.event_a_pub')::uuid;
    raise exception 'RLS-FALHA O8: superadmin moveu o evento para a B levando a filial da A';
  exception
    when insufficient_privilege then msg := sqlerrm;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      msg := sqlerrm;
  end;
  if coalesce(msg, '') not like '%filial do evento precisa ser da mesma igreja%' then
    raise exception 'RLS-FALHA O8: a troca de igreja nao foi barrada pelo trigger de filial (mensagem: %)', coalesce(msg, 'nenhuma');
  end if;

  select church_id, branch_id into igreja, filial from public.events
   where id = current_setting('app.event_a_pub')::uuid;
  if igreja <> current_setting('app.church_a')::uuid or filial <> current_setting('app.branch_a_sede')::uuid then
    raise exception 'RLS-FALHA O8: o evento saiu do estado anterior (igreja %, filial %)', igreja, filial;
  end if;

  -- Desvincular é permitido: o evento volta a ser da igreja inteira.
  update public.events set branch_id = null where id = current_setting('app.event_a_pub')::uuid;
  select branch_id into filial from public.events where id = current_setting('app.event_a_pub')::uuid;
  if filial is not null then raise exception 'RLS-FALHA O8: nao deu para desvincular a filial'; end if;
end $$;
rollback to savepoint o8;

-- O9: intervalo de coordenada nas três origens (igreja, filial e evento). NULL é
-- aceito em todas — endereço sem GPS é o estado normal de quem ainda não usou o
-- botão "usar minha localização".
savepoint o9;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  begin
    insert into public.church_branches (church_id, name, lat, lng)
    values (current_setting('app.church_a')::uuid, 'Filial fora do mapa', 91.0, 0);
    raise exception 'RLS-FALHA O9: latitude 91 aceita em filial';
  exception when check_violation then null; end;

  begin
    insert into public.church_branches (church_id, name, lat, lng)
    values (current_setting('app.church_a')::uuid, 'Filial fora do mapa', 0, -180.5);
    raise exception 'RLS-FALHA O9: longitude -180.5 aceita em filial';
  exception when check_violation then null; end;

  insert into public.church_branches (church_id, name, lat, lng)
  values (current_setting('app.church_a')::uuid, 'Filial sem GPS', null, null);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA O9: filial sem coordenada nao foi aceita (% linhas)', n; end if;

  begin
    update public.events set latitude = -95 where id = current_setting('app.event_a_pub')::uuid;
    raise exception 'RLS-FALHA O9: latitude -95 aceita em evento';
  exception when check_violation then null; end;

  begin
    update public.events set longitude = 200 where id = current_setting('app.event_a_pub')::uuid;
    raise exception 'RLS-FALHA O9: longitude 200 aceita em evento';
  exception when check_violation then null; end;

  begin
    update public.churches set lat = 90.1 where id = current_setting('app.church_a')::uuid;
    raise exception 'RLS-FALHA O9: latitude 90.1 aceita em igreja';
  exception when check_violation then null; end;

  begin
    update public.churches set lng = 181 where id = current_setting('app.church_a')::uuid;
    raise exception 'RLS-FALHA O9: longitude 181 aceita em igreja';
  exception when check_violation then null; end;

  -- Sonda: o CHECK não virou NOT NULL por engano nem bloqueia o intervalo válido.
  update public.churches set lat = -23.1857, lng = -45.8871
   where id = current_setting('app.church_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA O9: coordenada válida recusada na igreja (% linhas)', n; end if;

  update public.events set latitude = -23.1857, longitude = -45.8871
   where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA O9: coordenada válida recusada no evento (% linhas)', n; end if;
end $$;
rollback to savepoint o9;

-- O10: guardas estruturais. Os casos acima provam comportamento; estes provam
-- que a estrutura que os produz não mudou por baixo deles.
savepoint o10;
do $$
declare definer boolean; pinned boolean; executavel boolean; n int;
declare faltando text; colunas text[];
begin
  select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
    into definer, pinned
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'enforce_event_branch';
  if not found then
    raise exception 'RLS-FALHA O10: funcao enforce_event_branch sumiu de public';
  end if;
  if not definer then
    raise exception 'RLS-FALHA O10: enforce_event_branch deixou de ser SECURITY DEFINER — a checagem passaria a depender de quem escreve continuar podendo ler filial';
  end if;
  if not pinned then
    raise exception 'RLS-FALHA O10: enforce_event_branch sem search_path fixo';
  end if;

  select has_function_privilege('authenticated', 'public.enforce_event_branch()', 'execute') into executavel;
  if executavel then
    raise exception 'RLS-FALHA O10: enforce_event_branch voltou a ter EXECUTE para authenticated';
  end if;
  select has_function_privilege('anon', 'public.enforce_event_branch()', 'execute') into executavel;
  if executavel then
    raise exception 'RLS-FALHA O10: enforce_event_branch voltou a ter EXECUTE para anon';
  end if;

  select count(*) into n from pg_trigger
  where tgrelid = 'public.events'::regclass and tgname = 'trg_events_branch'
    and tgfoid = 'public.enforce_event_branch()'::regprocedure
    and not tgisinternal
    -- bits de tgtype: ROW=1, BEFORE=2, INSERT=4, UPDATE=16
    and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 4) = 4 and (tgtype & 16) = 16;
  if n <> 1 then
    raise exception 'RLS-FALHA O10: trg_events_branch nao esta como BEFORE INSERT OR UPDATE em public.events';
  end if;

  select array(select a.attname
               from unnest(t.tgattr) as x(attnum)
               join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = x.attnum
               order by 1)
    into colunas
  from pg_trigger t
  where t.tgrelid = 'public.events'::regclass and t.tgname = 'trg_events_branch';
  if array_to_string(colunas, ',') <> 'branch_id,church_id' then
    raise exception 'RLS-FALHA O10: trg_events_branch vigia % — esperava branch_id,church_id',
      coalesce(array_to_string(colunas, ','), 'nenhuma coluna');
  end if;

  select count(*) into n from pg_trigger
  where tgrelid = 'public.church_branches'::regclass and tgname = 'trg_church_branches_updated'
    and tgfoid = 'public.touch_updated_at()'::regprocedure and not tgisinternal;
  if n <> 1 then
    raise exception 'RLS-FALHA O10: church_branches ficou sem o trigger de updated_at';
  end if;

  -- Exclusão fechada nas duas camadas.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'church_branches' and cmd = 'DELETE';
  if n <> 0 then
    raise exception 'RLS-FALHA O10: apareceu % política(s) de delete em church_branches', n;
  end if;
  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'church_branches'
    and privilege_type = 'DELETE' and grantee in ('anon', 'authenticated');
  if n <> 0 then
    raise exception 'RLS-FALHA O10: % grant(s) de DELETE em church_branches para anon/authenticated', n;
  end if;

  -- WITH CHECK real nas duas escritas. `trim(...) <> 'true'` é a rede
  -- estrutural da mutação que o O5 pede: apagar a cláusula não muda o
  -- comportamento (o Postgres reusa o USING), trocar por `true` muda — e é o que
  -- este predicate pega.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'church_branches'
    and cmd in ('INSERT', 'UPDATE')
    and with_check is not null and trim(both ' ()' from with_check) <> 'true';
  if n <> 2 then
    raise exception 'RLS-FALHA O10: esperava WITH CHECK real em insert e update de church_branches, encontrei %', n;
  end if;

  -- Anti-deriva das colunas que o app projeta.
  select string_agg(f, ', ' order by f) into faltando
  from unnest(array['id','church_id','name','address','city','state','lat','lng','leader','created_at','updated_at']) f
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'church_branches' and c.column_name = f);
  if faltando is not null then
    raise exception 'RLS-FALHA O10: colunas sumiram de church_branches: %', faltando;
  end if;

  select string_agg(f, ', ' order by f) into faltando
  from unnest(array['branch_id','latitude','longitude']) f
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'events' and c.column_name = f);
  if faltando is not null then
    raise exception 'RLS-FALHA O10: colunas de localizacao sumiram de events: %', faltando;
  end if;

  -- Seis CHECKs de intervalo: lat/lng em churches e church_branches, latitude/
  -- longitude em events. Nenhuma outra restrição destas tabelas cita 90 ou 180.
  select count(*) into n
  from pg_constraint c
  where c.contype = 'c'
    and c.conrelid in ('public.churches'::regclass, 'public.church_branches'::regclass, 'public.events'::regclass)
    and (pg_get_constraintdef(c.oid) like '%90%' or pg_get_constraintdef(c.oid) like '%180%');
  if n <> 6 then
    raise exception 'RLS-FALHA O10: esperava 6 CHECKs de intervalo de coordenada, encontrei %', n;
  end if;
end $$;
rollback to savepoint o10;

-- ---------------------------------------------------------------------------
-- GRUPO P — campanhas de divulgação (0014): quem lê/escreve campanha, o isolamento
-- entre igrejas e a guarda de publicação. Campanha é dado privado de gestão, não
-- vitrine: a audiência é `marketing.manage` (SuperAdmin, administrador, gerente e
-- comunicador) — o mesmo papel que a rota `/app/marketing` já exige. Pastor NÃO tem
-- `marketing.manage` (seed e rbac), então é o ator negativo do grupo.
--
-- Diferença estrutural que vale registrar ANTES dos casos, para ninguém revendê-la
-- como prova do que ela não é: em `church_branches` (0013) a LEITURA usa vínculo
-- (`current_church_ids`) e a ESCRITA usa `church.manage` — duas réguas diferentes,
-- e é por isso que o ator `ab` (membro das duas igrejas, administra uma) isola o
-- WITH CHECK de update. Aqui leitura e escrita usam a MESMA régua
-- (`marketing.manage`). Num UPDATE o Postgres exige que a linha nova satisfaça
-- também as políticas de SELECT, então transferir campanha para uma igreja onde o
-- ator não tem `marketing.manage` já é barrado pela leitura — o WITH CHECK de
-- update fica redundante em comportamento. A cláusula que ainda isola uma barreira
-- real é a de INSERT: nele não há linha antiga nem SELECT aplicado à linha nova,
-- então a única coisa que impede criar campanha em igreja alheia é o WITH CHECK de
-- insert. P4 isola isso; P5 mede o update; P9 trava a estrutura dos dois.
-- ---------------------------------------------------------------------------

-- Fixture extra do grupo: um pastor na igreja A. A matriz do seed dá a esse papel
-- events.manage/events.publish/registrations.manage SEM marketing.manage — é
-- exatamente a ausência que P3 mede. As campanhas usam o prefixo ...0c0N para não
-- colidir com as filiais (...00aN/...00bN) nem com os eventos (eeeeeeee-...).
select set_config('app.user_a5',   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', false);
select set_config('app.camp_a_dra', '99999999-0000-4000-8000-000000000c01', false);
select set_config('app.camp_a_sch', '99999999-0000-4000-8000-000000000c02', false);
select set_config('app.camp_b_dra', '99999999-0000-4000-8000-000000000c03', false);

insert into auth.users (id, email, raw_user_meta_data) values
  (current_setting('app.user_a5')::uuid, 'a5@igreja-a.test', '{"full_name":"Pastor A"}'::jsonb);

insert into public.church_members (church_id, user_id, role_id, status) values
  (current_setting('app.church_a')::uuid, current_setting('app.user_a5')::uuid,
   (select id from public.roles where key = 'pastor'), 'active');

-- As campanhas entram como dono da conexão (superuser, atravessa RLS). status draft
-- e scheduled não esbarram no trigger de publicação. camp_a_dra vai vinculada ao
-- evento publicado da A (fixture do grupo M) para os casos terem um evento real.
insert into public.marketing_campaigns
  (id, church_id, event_id, name, message, networks, status, scheduled_for) values
  (current_setting('app.camp_a_dra')::uuid, current_setting('app.church_a')::uuid,
   current_setting('app.event_a_pub')::uuid, 'Divulgacao Congresso A',
   'Texto base da campanha do congresso.', array['instagram','whatsapp'], 'draft', null),
  (current_setting('app.camp_a_sch')::uuid, current_setting('app.church_a')::uuid,
   null, 'Campanha Agendada A', 'Conteudo programado.', array['facebook'],
   'scheduled', '2026-12-20T19:00:00-03:00'),
  (current_setting('app.camp_b_dra')::uuid, current_setting('app.church_b')::uuid,
   null, 'Campanha B', 'Rascunho da igreja vizinha.', array['whatsapp'], 'draft', null);

-- Sonda anti-no-op do grupo inteiro: se as campanhas não entraram, todos os casos de
-- "não lê" abaixo passam verdes sem medir nada.
do $$
declare n int;
begin
  select count(*) into n from public.marketing_campaigns;
  if n <> 3 then
    raise exception 'RLS-FALHA P-sonda: esperava 3 campanhas de fixture, encontrei %', n;
  end if;
end $$;

-- P1: anon não tem grant nenhum na tabela (0014 faz `revoke all ... from anon`). Não
-- é "RLS devolveu 0 linhas": a consulta é recusada antes, no grant — e vale para
-- insert e delete também. Campanha não é dado público.
savepoint p1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  begin
    select count(*) into n from public.marketing_campaigns;
    raise exception 'RLS-FALHA P1: anon leu % campanha(s) — campanha não é dado público', n;
  exception when insufficient_privilege then null; end;

  begin
    insert into public.marketing_campaigns (church_id, name)
    values (current_setting('app.church_a')::uuid, 'Campanha do invasor');
    raise exception 'RLS-FALHA P1: anon inseriu campanha direto na tabela';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.marketing_campaigns where church_id = current_setting('app.church_a')::uuid;
    raise exception 'RLS-FALHA P1: anon apagou campanha';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint p1;

-- P2: quem tem marketing.manage lê as campanhas da própria igreja, não lê as da
-- vizinha, e a projeção que o marketingService pede existe com estes nomes de
-- coluna. Três blocos: a1 (church_admin), a3 (comunicador — o papel que a tela
-- /app/marketing expõe) e b1 (lê só a da B: o isolamento medido pelo outro lado).
savepoint p2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare total int; de_outras int;
begin
  select count(*) into total from public.marketing_campaigns;
  if total <> 2 then
    raise exception 'RLS-FALHA P2: church_admin da A leu % campanhas, esperava 2', total;
  end if;

  select count(*) into de_outras from public.marketing_campaigns
  where church_id <> current_setting('app.church_a')::uuid;
  if de_outras <> 0 then
    raise exception 'RLS-FALHA P2: church_admin da A leu % campanha(s) de outra igreja', de_outras;
  end if;

  if exists (select 1 from public.marketing_campaigns where id = current_setting('app.camp_b_dra')::uuid) then
    raise exception 'RLS-FALHA P2: a1 leu a campanha da igreja B';
  end if;

  -- Anti-deriva: se uma migração renomear coluna que a tela de campanhas projeta, a
  -- suíte quebra aqui em vez de a tela estourar em produção. created_by fica de fora
  -- de propósito — o serviço não o projeta (decisão 5 da 0014).
  perform id, church_id, event_id, name, message, networks, status, scheduled_for, created_at, updated_at
  from public.marketing_campaigns where id = current_setting('app.camp_a_dra')::uuid;
  if not found then
    raise exception 'RLS-FALHA P2: a projeção de campanhas não devolveu a linha do rascunho';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a3'))::text, true);
do $$
declare total int;
begin
  select count(*) into total from public.marketing_campaigns;
  if total <> 2 then
    raise exception 'RLS-FALHA P2: comunicador da A leu % campanhas, esperava 2', total;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare total int; da_a int;
begin
  select count(*) into total from public.marketing_campaigns;
  if total <> 1 then
    raise exception 'RLS-FALHA P2: church_admin da B leu % campanhas, esperava 1 (a da própria igreja)', total;
  end if;
  select count(*) into da_a from public.marketing_campaigns
  where church_id = current_setting('app.church_a')::uuid;
  if da_a <> 0 then
    raise exception 'RLS-FALHA P2: b1 leu % campanha(s) da igreja A', da_a;
  end if;
end $$;
rollback to savepoint p2;

-- P3: pastor não tem marketing.manage, então não lê campanha nenhuma e não escreve.
-- Três atores negativos: a5 (pastor ativo da A), a4 (vínculo `invited` na A — o
-- papel manager TEM marketing.manage, mas o vínculo não é ativo, então a leitura
-- olha o status e não o papel; espelha o O3) e user_out (sem vínculo). O bloco do
-- pastor tem sonda: ele continua gravando evento, que é o que a matriz dele
-- autoriza, então a recusa é de permissão específica, não de sessão quebrada.
savepoint p3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a5'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.marketing_campaigns;
  if n <> 0 then
    raise exception 'RLS-FALHA P3: pastor da A leu % campanha(s) — pastor não tem marketing.manage', n;
  end if;

  begin
    insert into public.marketing_campaigns (church_id, name)
    values (current_setting('app.church_a')::uuid, 'Campanha do pastor');
    raise exception 'RLS-FALHA P3: pastor sem marketing.manage inseriu campanha';
  exception when insufficient_privilege then null; end;

  update public.marketing_campaigns set name = 'Renomeada pelo pastor'
   where id = current_setting('app.camp_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA P3: pastor editou campanha (% linhas)', n; end if;

  -- Sonda: a recusa é de permissão, não de sessão. O mesmo pastor continua gravando
  -- evento (events.manage), que é o que a matriz dele autoriza.
  update public.events set name = 'Nome ajustado pelo pastor'
   where id = current_setting('app.event_a_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P3: sonda — pastor perdeu a escrita de eventos (% linhas)', n; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a4'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.marketing_campaigns;
  if n <> 0 then
    raise exception 'RLS-FALHA P3: convidada da A leu % campanha(s) — vínculo invited não é ativo', n;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.marketing_campaigns;
  if n <> 0 then
    raise exception 'RLS-FALHA P3: usuário sem vínculo leu % campanha(s)', n;
  end if;
end $$;
rollback to savepoint p3;

-- P4: criar campanha exige marketing.manage NA IGREJA DO church_id. É o WITH CHECK
-- de insert — e aqui ele é a ÚNICA barreira, porque no INSERT não há linha antiga
-- nem política de SELECT aplicada à linha nova (diferente do update; ver a nota do
-- grupo). a1 (membro só da A) tenta criar campanha na B: recusado com 42501. Na
-- própria A: aceito. b1 tenta na A: recusado. Mutar o WITH CHECK de insert para
-- `true` faz o bloco do a1 na B passar a inserir — é o que isola esta cláusula.
savepoint p4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare nova uuid;
begin
  begin
    insert into public.marketing_campaigns (church_id, name, networks, status)
    values (current_setting('app.church_b')::uuid, 'Campanha plantada na B', array['whatsapp'], 'draft');
    raise exception 'RLS-FALHA P4: church_admin da A criou campanha na igreja B';
  exception when insufficient_privilege then null; end;

  insert into public.marketing_campaigns (church_id, name, networks, status)
  values (current_setting('app.church_a')::uuid, 'Campanha legítima da A', array['instagram','facebook'], 'draft')
  returning id into nova;
  if nova is null then
    raise exception 'RLS-FALHA P4: church_admin não conseguiu criar campanha na própria igreja';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
begin
  begin
    insert into public.marketing_campaigns (church_id, name)
    values (current_setting('app.church_a')::uuid, 'Campanha plantada na A');
    raise exception 'RLS-FALHA P4: church_admin da B criou campanha na igreja A';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint p4;

-- P5: editar campanha de outra igreja. Duas respostas corretas e diferentes, como
-- em O5/O7:
--   * a1 sobre camp_b_dra (igreja B): a1 nem LÊ a campanha da B (read policy =
--     marketing.manage, que ele não tem lá), então o USING do update não alcança a
--     linha e ela afeta ZERO linhas em silêncio — não estoura 42501.
--   * a1 transferindo camp_a_dra (da própria A) para a B: a linha antiga ele lê, mas
--     a linha nova cairia numa igreja onde não tem marketing.manage. Num UPDATE o
--     Postgres exige que a linha nova satisfaça também as políticas de SELECT, e a
--     leitura da B já barra — então estoura 42501. (O WITH CHECK de update chegaria
--     à mesma conclusão; aqui ele é redundante, ver a nota do grupo. O que isola o
--     WITH CHECK de verdade é o INSERT, no P4.)
savepoint p5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; igreja uuid;
begin
  update public.marketing_campaigns set name = 'Renomeada por a1'
   where id = current_setting('app.camp_b_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA P5: a1 editou a campanha da B (% linhas)', n; end if;

  begin
    update public.marketing_campaigns set church_id = current_setting('app.church_b')::uuid
     where id = current_setting('app.camp_a_dra')::uuid;
    raise exception 'RLS-FALHA P5: a1 transferiu a campanha da A para a B';
  exception when insufficient_privilege then null; end;

  select church_id into igreja from public.marketing_campaigns where id = current_setting('app.camp_a_dra')::uuid;
  if igreja <> current_setting('app.church_a')::uuid then
    raise exception 'RLS-FALHA P5: a campanha mudou de igreja (%) depois da tentativa', igreja;
  end if;

  -- O caminho legítimo funciona: editar o conteúdo da campanha da própria igreja.
  update public.marketing_campaigns set message = 'Texto revisado por a1'
   where id = current_setting('app.camp_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P5: a1 não editou a própria campanha (% linhas)', n; end if;
end $$;
rollback to savepoint p5;

-- P6: SuperAdmin atravessa igrejas nas duas direções. su é membro ativo da A, mas lê
-- e escreve na B via `is_superadmin()` embutido em `has_church_permission`. Se a
-- política de leitura passasse a exigir vínculo sem o atalho de superadmin, este caso
-- quebraria. Atenção: P6 NÃO marca publicada — isso é barrado para QUALQUER
-- authenticated, inclusive o superadmin (ver P7); aqui su só lê/cria/edita rascunho.
savepoint p6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare total int; linhas int; nova uuid;
begin
  select count(*) into total from public.marketing_campaigns;
  if total <> 3 then
    raise exception 'RLS-FALHA P6: superadmin leu % campanhas, esperava as 3 do fixture', total;
  end if;

  select count(*) into linhas from public.marketing_campaigns
  where church_id = current_setting('app.church_b')::uuid;
  if linhas <> 1 then
    raise exception 'RLS-FALHA P6: superadmin não leu a campanha da igreja B (%)', linhas;
  end if;

  insert into public.marketing_campaigns (church_id, name, networks, status)
  values (current_setting('app.church_b')::uuid, 'Campanha do superadmin na B', array['instagram'], 'draft')
  returning id into nova;
  if nova is null then
    raise exception 'RLS-FALHA P6: superadmin não criou campanha na igreja B';
  end if;

  update public.marketing_campaigns set message = 'Editado pelo superadmin'
   where id = current_setting('app.camp_b_dra')::uuid;
  get diagnostics linhas = row_count;
  if linhas <> 1 then raise exception 'RLS-FALHA P6: superadmin não editou a campanha da B (% linhas)', linhas; end if;
end $$;
rollback to savepoint p6;

-- P7: a guarda de publicação. authenticated NÃO consegue marcar campanha como
-- published nem failed — o trigger enforce_campaign_publish recusa com 42501 e a
-- mensagem diz o porquê (confirmação real do provedor). A recusa é do TRIGGER, não
-- da RLS: a1 tem marketing.manage na A, então o WITH CHECK de insert/update passa; o
-- que barra é o `current_user <> 'service_role'` do trigger. Por isso a assertiva casa
-- a MENSAGEM, não só o SQLSTATE (que é o mesmo 42501 de uma violação de RLS). As
-- transições legítimas (scheduled, cancelled, draft) passam — o trigger só vigia
-- published/failed. E o service_role (papel de um backend que acabou de confirmar com
-- a plataforma) consegue publicar: é o único caminho real até 'published'.
savepoint p7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare msg text; n int; st text;
begin
  -- Insert já publicado: recusado pelo trigger.
  begin
    insert into public.marketing_campaigns (church_id, name, networks, status)
    values (current_setting('app.church_a')::uuid, 'Nasce publicada', array['instagram'], 'published');
    raise exception 'RLS-FALHA P7: authenticated inseriu campanha já publicada';
  exception
    when insufficient_privilege then msg := sqlerrm;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      msg := sqlerrm;
  end;
  if coalesce(msg, '') not like '%confirmacao real do provedor%' then
    raise exception 'RLS-FALHA P7: insert publicado veio com outra recusa: %', coalesce(msg, 'nenhuma');
  end if;

  -- Update para published: recusado pelo trigger.
  msg := null;
  begin
    update public.marketing_campaigns set status = 'published'
     where id = current_setting('app.camp_a_dra')::uuid;
    raise exception 'RLS-FALHA P7: authenticated marcou campanha como publicada';
  exception
    when insufficient_privilege then msg := sqlerrm;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      msg := sqlerrm;
  end;
  if coalesce(msg, '') not like '%confirmacao real do provedor%' then
    raise exception 'RLS-FALHA P7: update para published veio com outra recusa: %', coalesce(msg, 'nenhuma');
  end if;

  -- Update para failed: também recusado (o trigger cobre published E failed).
  msg := null;
  begin
    update public.marketing_campaigns set status = 'failed'
     where id = current_setting('app.camp_a_dra')::uuid;
    raise exception 'RLS-FALHA P7: authenticated marcou campanha como failed';
  exception
    when insufficient_privilege then msg := sqlerrm;
    when raise_exception then
      if sqlerrm like 'RLS-FALHA%' then raise; end if;
      msg := sqlerrm;
  end;
  if coalesce(msg, '') not like '%confirmacao real do provedor%' then
    raise exception 'RLS-FALHA P7: update para failed veio com outra recusa: %', coalesce(msg, 'nenhuma');
  end if;

  -- A campanha segue draft depois das três tentativas.
  select status into st from public.marketing_campaigns where id = current_setting('app.camp_a_dra')::uuid;
  if st <> 'draft' then
    raise exception 'RLS-FALHA P7: campanha saiu de draft (%) depois das tentativas de publicar', st;
  end if;

  -- Transições legítimas passam: o trigger só vigia published/failed.
  update public.marketing_campaigns set status = 'scheduled', scheduled_for = '2026-12-25T20:00:00-03:00'
   where id = current_setting('app.camp_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P7: agendar campanha falhou (% linhas)', n; end if;

  update public.marketing_campaigns set status = 'cancelled'
   where id = current_setting('app.camp_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P7: cancelar campanha falhou (% linhas)', n; end if;

  update public.marketing_campaigns set status = 'draft', scheduled_for = null
   where id = current_setting('app.camp_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P7: voltar para draft falhou (% linhas)', n; end if;
end $$;

-- service_role publica: é o papel do backend que acabou de confirmar com a rede.
-- bypassrls (shim) + o `return new` do trigger para current_user = 'service_role'.
set role service_role;
do $$
declare n int; st text; nova uuid;
begin
  update public.marketing_campaigns set status = 'published'
   where id = current_setting('app.camp_a_dra')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P7: service_role não publicou a campanha (% linhas)', n; end if;

  select status into st from public.marketing_campaigns where id = current_setting('app.camp_a_dra')::uuid;
  if st <> 'published' then
    raise exception 'RLS-FALHA P7: campanha não ficou published pelo service_role (%)', st;
  end if;

  insert into public.marketing_campaigns (church_id, name, networks, status)
  values (current_setting('app.church_a')::uuid, 'Publicada pelo backend', array['facebook'], 'published')
  returning id into nova;
  if nova is null then
    raise exception 'RLS-FALHA P7: service_role não inseriu campanha publicada';
  end if;
end $$;
reset role;
rollback to savepoint p7;

-- P8: excluir campanha não está aberto. authenticated não tem grant de delete (0014
-- concede só select/insert/update) e não há política de delete, então a recusa vem
-- antes da RLS. As duas respostas possíveis são corretas e o caso aceita ambas (42501
-- sem grant, ou 0 linhas com default-deny) — o que não é aceitável é a linha sumir.
-- Campanha é cancelada (P7), não apagada. Quem detecta o grant/política de delete em
-- si é o P9.
savepoint p8;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  begin
    delete from public.marketing_campaigns where id = current_setting('app.camp_a_dra')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'RLS-FALHA P8: church_admin apagou campanha (% linhas)', n; end if;
  exception when insufficient_privilege then null; end;

  select count(*) into n from public.marketing_campaigns where id = current_setting('app.camp_a_dra')::uuid;
  if n <> 1 then raise exception 'RLS-FALHA P8: a campanha sumiu depois da tentativa de delete'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int;
begin
  begin
    delete from public.marketing_campaigns where id = current_setting('app.camp_b_dra')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'RLS-FALHA P8: superadmin apagou campanha pela API (% linhas)', n; end if;
  exception when insufficient_privilege then null; end;

  select count(*) into n from public.marketing_campaigns where id = current_setting('app.camp_b_dra')::uuid;
  if n <> 1 then raise exception 'RLS-FALHA P8: a campanha da B sumiu depois da tentativa do superadmin'; end if;
end $$;
rollback to savepoint p8;

-- P9: guardas estruturais + CHECKs de domínio. Primeiro o comportamento (redes e
-- status fora do conjunto são recusados no caminho normal de escrita, como a1); depois
-- o catálogo (a estrutura que produz os resultados acima não mudou por baixo deles).
savepoint p9;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  begin
    insert into public.marketing_campaigns (church_id, name, networks, status)
    values (current_setting('app.church_a')::uuid, 'Rede inválida', array['twitter'], 'draft');
    raise exception 'RLS-FALHA P9: rede fora do conjunto aceita em networks';
  exception when check_violation then null; end;

  -- 0020 tirou TikTok do produto: a rede deixou de ser opção na tela e de existir
  -- no banco. Se a constraint antiga sobrevivesse por aqui, este insert passasse.
  begin
    insert into public.marketing_campaigns (church_id, name, networks, status)
    values (current_setting('app.church_a')::uuid, 'Rede fora do produto', array['tiktok'], 'draft');
    raise exception 'RLS-FALHA P9: tiktok ainda aceito em networks (0020 nao valeu)';
  exception when check_violation then null; end;

  begin
    insert into public.marketing_campaigns (church_id, name, networks, status)
    values (current_setting('app.church_a')::uuid, 'Status inválido', array['whatsapp'], 'aprovada');
    raise exception 'RLS-FALHA P9: status fora do conjunto aceito';
  exception when check_violation then null; end;

  -- Sonda: o conjunto válido passa, e networks vazio também — campanha sem rede alvo
  -- definida ainda é um rascunho legítimo.
  insert into public.marketing_campaigns (church_id, name, networks, status)
  values (current_setting('app.church_a')::uuid, 'Redes válidas', array['instagram','facebook'], 'draft');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P9: redes válidas recusadas (% linhas)', n; end if;

  insert into public.marketing_campaigns (church_id, name, networks, status)
  values (current_setting('app.church_a')::uuid, 'Sem rede ainda', '{}'::text[], 'draft');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA P9: networks vazio recusado (% linhas)', n; end if;
end $$;
rollback to savepoint p9;

-- P9b: estrutura no catálogo. `reset role` garante que as contagens de grant rodem
-- como dono (superuser vê todos os grants; um papel restrito veria um subconjunto e
-- a assertiva de "anon sem grant" passaria vazia).
savepoint p9b;
reset role;
do $$
declare pinned boolean; n int; faltando text; colunas text[];
begin
  -- A função de publicação existe e tem search_path fixo. Ela NÃO é security definer
  -- de propósito: a guarda é `current_user <> 'service_role'`, que não depende de
  -- privilégio elevado — diferente de enforce_event_branch (0013), que é definer por
  -- independência futura. search_path fixo é a higiene que importa aqui.
  select coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
    into pinned
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'enforce_campaign_publish';
  if not found then
    raise exception 'RLS-FALHA P9: função enforce_campaign_publish sumiu de public';
  end if;
  if not pinned then
    raise exception 'RLS-FALHA P9: enforce_campaign_publish sem search_path fixo';
  end if;

  -- O trigger de publicação está como BEFORE INSERT OR UPDATE em nível de linha,
  -- executando a função certa. bits de tgtype: ROW=1, BEFORE=2, INSERT=4, UPDATE=16.
  select count(*) into n from pg_trigger
  where tgrelid = 'public.marketing_campaigns'::regclass and tgname = 'trg_campaigns_publish'
    and tgfoid = 'public.enforce_campaign_publish()'::regprocedure
    and not tgisinternal
    and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 4) = 4 and (tgtype & 16) = 16;
  if n <> 1 then
    raise exception 'RLS-FALHA P9: trg_campaigns_publish não está como BEFORE INSERT OR UPDATE em marketing_campaigns';
  end if;

  -- E vigia exatamente a coluna status (UPDATE OF status): sem isso ele dispararia em
  -- qualquer update, e com uma coluna a menos deixaria passar a transição.
  select array(select a.attname
               from unnest(t.tgattr) as x(attnum)
               join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = x.attnum
               order by 1)
    into colunas
  from pg_trigger t
  where t.tgrelid = 'public.marketing_campaigns'::regclass and t.tgname = 'trg_campaigns_publish';
  if array_to_string(colunas, ',') <> 'status' then
    raise exception 'RLS-FALHA P9: trg_campaigns_publish vigia % — esperava status',
      coalesce(array_to_string(colunas, ','), 'nenhuma coluna');
  end if;

  -- Trigger de updated_at presente.
  select count(*) into n from pg_trigger
  where tgrelid = 'public.marketing_campaigns'::regclass and tgname = 'trg_marketing_campaigns_updated'
    and tgfoid = 'public.touch_updated_at()'::regprocedure and not tgisinternal;
  if n <> 1 then
    raise exception 'RLS-FALHA P9: marketing_campaigns ficou sem o trigger de updated_at';
  end if;

  -- Exclusão fechada nas duas camadas: sem política de delete e sem grant de delete.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'marketing_campaigns' and cmd = 'DELETE';
  if n <> 0 then
    raise exception 'RLS-FALHA P9: apareceu % política(s) de delete em marketing_campaigns', n;
  end if;
  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'marketing_campaigns'
    and privilege_type = 'DELETE' and grantee in ('anon', 'authenticated');
  if n <> 0 then
    raise exception 'RLS-FALHA P9: % grant(s) de DELETE em marketing_campaigns para anon/authenticated', n;
  end if;

  -- anon sem grant nenhum: a recusa do P1 é estrutural, não só comportamental.
  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'marketing_campaigns' and grantee = 'anon';
  if n <> 0 then
    raise exception 'RLS-FALHA P9: anon tem % grant(s) em marketing_campaigns', n;
  end if;

  -- Três políticas (read, insert, update), todas citando marketing.manage.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'marketing_campaigns';
  if n <> 3 then
    raise exception 'RLS-FALHA P9: esperava 3 políticas em marketing_campaigns, encontrei %', n;
  end if;
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'marketing_campaigns'
    and (coalesce(qual, '') like '%marketing.manage%' or coalesce(with_check, '') like '%marketing.manage%');
  if n <> 3 then
    raise exception 'RLS-FALHA P9: % política(s) de marketing_campaigns não citam marketing.manage', 3 - n;
  end if;

  -- WITH CHECK real em insert e update. `trim(...) <> 'true'` pega a mutação de trocar
  -- a cláusula por `true`. No insert ela é a única barreira contra criar campanha em
  -- igreja alheia (P4 isola); no update é redundante em comportamento com a leitura
  -- (ver a nota do grupo), mas travá-la aqui impede que alguém a afrouxe no texto sem
  -- a suíte notar.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'marketing_campaigns'
    and cmd in ('INSERT', 'UPDATE')
    and with_check is not null and trim(both ' ()' from with_check) <> 'true';
  if n <> 2 then
    raise exception 'RLS-FALHA P9: esperava WITH CHECK real em insert e update de marketing_campaigns, encontrei %', n;
  end if;

  -- Anti-deriva das colunas que o serviço projeta (created_by fica de fora: existe na
  -- tabela mas não é projetado, decisão 5 da 0014).
  select string_agg(f, ', ' order by f) into faltando
  from unnest(array['id','church_id','event_id','name','message','networks','status','scheduled_for','created_at','updated_at']) f
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'marketing_campaigns' and c.column_name = f);
  if faltando is not null then
    raise exception 'RLS-FALHA P9: colunas sumiram de marketing_campaigns: %', faltando;
  end if;

  -- Os dois CHECKs de domínio existem: networks (contenção dos canais) e status (enum).
  select count(*) into n from pg_constraint
  where contype = 'c' and conrelid = 'public.marketing_campaigns'::regclass
    and pg_get_constraintdef(oid) like '%instagram%';
  if n <> 1 then
    raise exception 'RLS-FALHA P9: CHECK de networks (contenção dos canais) sumiu de marketing_campaigns';
  end if;
  select count(*) into n from pg_constraint
  where contype = 'c' and conrelid = 'public.marketing_campaigns'::regclass
    and pg_get_constraintdef(oid) like '%published%' and pg_get_constraintdef(oid) like '%cancelled%';
  if n <> 1 then
    raise exception 'RLS-FALHA P9: CHECK de status sumiu de marketing_campaigns';
  end if;
end $$;
rollback to savepoint p9b;

-- ============================================================================
-- GRUPOS Q..U — o que as migrações 0015..0020 acrescentaram ao banco
--
-- Q ministérios + perfis de rede social (0015, e a guarda de líder/participante
-- da 0021 nos casos Q9/Q9b/Q9c) · R favoritos e preferências do visitante (0016)
-- · S redes de igrejas (0017) · T suporte (0018) ·
-- U eventos de segurança (0019) — a 0020 (TikTok fora) é provada no P9.
--
-- Estes grupos existem porque as cinco telas correspondentes liam
-- `src/data/mock.ts`. A régua é a mesma dos outros: dado de igreja não cruza
-- igreja, papel sem a permissão não escreve, e o que a tela mostra como número
-- (participantes, igrejas da rede, respostas do ticket) é contagem do banco.
-- ============================================================================

select set_config('app.min_a',     'a1a1a1a1-0000-4000-8000-000000000001', false);
select set_config('app.min_a_two', 'a1a1a1a1-0000-4000-8000-000000000002', false);
select set_config('app.min_b',     'b1b1b1b1-0000-4000-8000-000000000001', false);
select set_config('app.soc_a',     'c1c1c1c1-0000-4000-8000-000000000001', false);
select set_config('app.soc_b',     'c2c2c2c2-0000-4000-8000-000000000001', false);
select set_config('app.net_a',     'd1d1d1d1-0000-4000-8000-000000000001', false);
select set_config('app.net_b',     'd2d2d2d2-0000-4000-8000-000000000001', false);
select set_config('app.tick_a',    'e1e1e1e1-0000-4000-8000-000000000001', false);
select set_config('app.tick_out',  'e2e2e2e2-0000-4000-8000-000000000001', false);
select set_config('app.msg_tick_a','e3e3e3e3-0000-4000-8000-000000000001', false);

-- Fixtures entram como dono da conexão, como nos grupos anteriores.
insert into public.ministries (id, church_id, type, name, description, leader_id) values
  (current_setting('app.min_a')::uuid,     current_setting('app.church_a')::uuid, 'ministry',   'Ministerio de Jovens A', 'Encontros semanais.', current_setting('app.user_a1')::uuid),
  (current_setting('app.min_a_two')::uuid, current_setting('app.church_a')::uuid, 'team',       'Equipe de Louvor A',     null,                null),
  (current_setting('app.min_b')::uuid,     current_setting('app.church_b')::uuid, 'department', 'Secretaria B',           null,                current_setting('app.user_b1')::uuid);

-- Três participantes no ministério A: é essa contagem, e não um campo digitado,
-- que a tela de ministérios mostra.
insert into public.ministry_members (ministry_id, user_id) values
  (current_setting('app.min_a')::uuid, current_setting('app.user_a1')::uuid),
  (current_setting('app.min_a')::uuid, current_setting('app.user_a2')::uuid),
  (current_setting('app.min_a')::uuid, current_setting('app.user_a3')::uuid),
  (current_setting('app.min_b')::uuid, current_setting('app.user_b1')::uuid);

insert into public.church_social_accounts (id, church_id, network, handle) values
  (current_setting('app.soc_a')::uuid, current_setting('app.church_a')::uuid, 'instagram', 'igreja.a'),
  (current_setting('app.soc_b')::uuid, current_setting('app.church_b')::uuid, 'facebook',  'igreja.b');

insert into public.visitor_favorites (user_id, event_id) values
  (current_setting('app.user_a1')::uuid,  current_setting('app.event_a_pub')::uuid),
  (current_setting('app.user_a1')::uuid,  current_setting('app.event_b_pub')::uuid),
  (current_setting('app.user_b1')::uuid,  current_setting('app.event_b_pub')::uuid),
  (current_setting('app.user_out')::uuid, current_setting('app.event_a_pub')::uuid);

insert into public.visitor_preferences (user_id, city, interests) values
  (current_setting('app.user_a1')::uuid, 'Sao Paulo', array['jovens']),
  (current_setting('app.user_b1')::uuid, 'Campinas',  array['familia','mulheres']);

-- net_a liga A e B (rede compartilhada); net_b é só da B — o recorte de S.
insert into public.church_networks (id, name, slug, description) values
  (current_setting('app.net_a')::uuid, 'Rede Teste Alfa', 'rede-teste-alfa', 'Duas igrejas.'),
  (current_setting('app.net_b')::uuid, 'Rede Teste Beta', 'rede-teste-beta', 'So a igreja B.');

insert into public.church_network_churches (network_id, church_id) values
  (current_setting('app.net_a')::uuid, current_setting('app.church_a')::uuid),
  (current_setting('app.net_a')::uuid, current_setting('app.church_b')::uuid),
  (current_setting('app.net_b')::uuid, current_setting('app.church_b')::uuid);

insert into public.support_tickets (id, church_id, opened_by, subject) values
  (current_setting('app.tick_a')::uuid,   current_setting('app.church_a')::uuid, current_setting('app.user_a1')::uuid,  'Convite de membro nao chega'),
  (current_setting('app.tick_out')::uuid, null,                                  current_setting('app.user_out')::uuid, 'Como cadastro minha igreja?');

insert into public.support_messages (id, ticket_id, author_id, body) values
  (current_setting('app.msg_tick_a')::uuid, current_setting('app.tick_a')::uuid, current_setting('app.user_a1')::uuid, 'Print anexado no e-mail de teste.');

-- ---------------------------------------------------------------------------
-- GRUPO Q — ministérios e perfis de rede social (0015)
-- ---------------------------------------------------------------------------

-- Q1: anon não vê nada. Nestas tabelas o resultado da recusa pode ser "zero
-- linhas" ou "permission denied" (o revoke da 0015 é mais estrito que a própria
-- RLS); os dois significam a mesma coisa para o público, e qualquer linha é falha.
savepoint q1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  begin select count(*) into n from public.ministries;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA Q1: anon leu % ministerios', n; end if;
  begin select count(*) into n from public.ministry_members;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA Q1: anon leu % participantes de ministerio', n; end if;
  begin select count(*) into n from public.church_social_accounts;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA Q1: anon leu % perfis de rede social', n; end if;
  begin select count(*) into n from public.ministry_list;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA Q1: anon leu % linhas da view ministry_list', n; end if;
end $$;
rollback to savepoint q1;

-- Q2: a1 (church_admin da A e da D) lê os dois ministérios da A, com líder pelo
-- nome e a contagem real de participantes; nada da B.
savepoint q2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; c int; ld text;
begin
  select count(*) into n from public.ministries;
  if n <> 2 then raise exception 'RLS-FALHA Q2: a1 deveria ver 2 ministerios (A), viu %', n; end if;
  select count(*) into n from public.ministries where church_id = current_setting('app.church_b')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA Q2: a1 leu % ministerios da igreja B', n; end if;

  select members_count, leader_name into c, ld
    from public.ministry_list where id = current_setting('app.min_a')::uuid;
  if c <> 3 then raise exception 'RLS-FALHA Q2: ministry_list deveria contar 3 participantes, informou %', c; end if;
  if ld is distinct from 'Administrador A' then
    raise exception 'RLS-FALHA Q2: leader_name esperado "Administrador A", veio %', coalesce(ld, 'null');
  end if;

  select count(*) into n from public.ministry_list;
  if n <> 2 then raise exception 'RLS-FALHA Q2: a1 deveria ver 2 linhas na view, viu %', n; end if;
end $$;
rollback to savepoint q2;

-- Q3: leitura é de membro; escrita é de quem tem members.manage. O gerente (a2)
-- lê os ministérios da própria igreja e não consegue criar um.
savepoint q3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.ministries;
  if n <> 2 then raise exception 'RLS-FALHA Q3: gerente a2 deveria ler os 2 ministerios da propria igreja, leu %', n; end if;

  begin
    insert into public.ministries (church_id, name, type) values (current_setting('app.church_a')::uuid, 'Ministerio do gerente', 'ministry');
    raise exception 'RLS-FALHA Q3: manager (sem members.manage) criou ministerio na propria igreja';
  exception when insufficient_privilege then null; end;

  -- UPDATE/DELETE sem USING não estoura: afeta zero linhas. Medir as duas
  -- respostas é o ponto do caso — quem só esperasse erro deixaria o silêncio passar.
  update public.ministries set name = 'Renomeado pelo gerente' where id = current_setting('app.min_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA Q3: manager renomeou ministerio (% linhas)', n; end if;

  delete from public.ministries where id = current_setting('app.min_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA Q3: manager apagou ministerio (% linhas)', n; end if;

  -- Sonda: a recusa é de permissão, não de sessão quebrada. O mesmo gerente
  -- continua lendo os ministérios da igreja dele.
  select count(*) into n from public.ministries;
  if n <> 2 then raise exception 'RLS-FALHA Q3: sonda — o gerente perdeu a leitura da propria igreja (% linhas)', n; end if;

  -- O mesmo gerente também não mexe nos perfis de rede: é church.manage (decisão 1).
  begin
    insert into public.church_social_accounts (church_id, network, handle)
      values (current_setting('app.church_a')::uuid, 'youtube', 'canal.a');
    raise exception 'RLS-FALHA Q3: manager cadastrou perfil de rede social da igreja';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint q3;

-- Q4: cruzar igreja nem pensar — nem lendo, nem escrevendo no ministério vizinho.
savepoint q4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.ministries where church_id = current_setting('app.church_a')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA Q4: b1 leu % ministerios da igreja A', n; end if;
  select count(*) into n from public.church_social_accounts where church_id = current_setting('app.church_a')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA Q4: b1 leu % perfis de rede da igreja A', n; end if;

  begin
    insert into public.ministries (church_id, name, type) values (current_setting('app.church_a')::uuid, 'Ministerio invasor', 'ministry');
    raise exception 'RLS-FALHA Q4: b1 criou ministerio na igreja A';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.ministry_members (ministry_id, user_id)
      values (current_setting('app.min_a')::uuid, current_setting('app.user_b1')::uuid);
    raise exception 'RLS-FALHA Q4: b1 se inscreveu como participante de um ministerio da igreja A';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint q4;

-- Q5: quem gerencia membros escreve no ministério da própria igreja, inclusive
-- colocando gente, e a contagem da view acompanha (anti-número-digitado).
savepoint q5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; c int;
begin
  insert into public.ministries (church_id, name, type) values (current_setting('app.church_a')::uuid, 'Ministerio novo de a1', 'team');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA Q5: church_admin nao conseguiu criar ministerio na propria igreja'; end if;

  -- Participante com gente de verdade: `ab` é membro **ativo** da A. A 0021 não
  -- deixa colocar quem não é da igreja, então a escolha do fixture é parte do
  -- caso (com `a4`, que é `invited`, a recusa correta passaria por falha aqui).
  insert into public.ministry_members (ministry_id, user_id)
    values (current_setting('app.min_a')::uuid, current_setting('app.user_ab')::uuid);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA Q5: a1 nao conseguiu adicionar participante ao ministerio da propria igreja'; end if;

  select members_count into c from public.ministry_list where id = current_setting('app.min_a')::uuid;
  if c <> 4 then raise exception 'RLS-FALHA Q5: depois de adicionar um, a view deveria contar 4, contou %', c; end if;

  delete from public.ministries where name = 'Ministerio novo de a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA Q5: church_admin nao conseguiu apagar o proprio ministerio'; end if;
end $$;
rollback to savepoint q5;

-- Q6: perfil de rede social é escrito por quem gerencia a igreja, e o @handle é
-- a única coisa que muda.
savepoint q6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; h text;
begin
  insert into public.church_social_accounts (church_id, network, handle)
    values (current_setting('app.church_a')::uuid, 'whatsapp', '5511999990000');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA Q6: church_admin nao cadastrou perfil de rede da propria igreja'; end if;

  update public.church_social_accounts set handle = 'igreja.a.novo' where id = current_setting('app.soc_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA Q6: church_admin nao conseguiu trocar o @handle da propria igreja'; end if;
  select handle into h from public.church_social_accounts where id = current_setting('app.soc_a')::uuid;
  if h <> 'igreja.a.novo' then raise exception 'RLS-FALHA Q6: handle deveria ser igreja.a.novo, veio %', h; end if;

  -- Duas contas do mesmo perfil na mesma igreja: recusado pelo índice único.
  begin
    insert into public.church_social_accounts (church_id, network, handle)
      values (current_setting('app.church_a')::uuid, 'whatsapp', '5511999990000');
    raise exception 'RLS-FALHA Q6: duplicata de (igreja, rede, handle) aceita';
  exception when unique_violation then null; end;
end $$;
rollback to savepoint q6;

-- Q7: a guarda que importa — conectado é afirmação sobre o provedor, e quem a
-- faz é só um backend que falou com ele. Pelo app, 42501; por service_role, passa.
savepoint q7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; c boolean;
begin
  begin
    update public.church_social_accounts set connected = true where id = current_setting('app.soc_a')::uuid;
    raise exception 'RLS-FALHA Q7: authenticated marcou rede social como conectada';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.church_social_accounts (church_id, network, handle, connected)
      values (current_setting('app.church_a')::uuid, 'youtube', 'canal.a', true);
    raise exception 'RLS-FALHA Q7: authenticated inseriu conta ja conectada';
  exception when insufficient_privilege then null; end;

  select connected into c from public.church_social_accounts where id = current_setting('app.soc_a')::uuid;
  if c then raise exception 'RLS-FALHA Q7: a conta apareceu conectada mesmo com a recusa'; end if;
end $$;
rollback to savepoint q7;

savepoint q7b;
set local role service_role;
do $$
declare n int; c boolean;
begin
  update public.church_social_accounts set connected = true where id = current_setting('app.soc_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA Q7b: service_role nao conseguiu marcar a conexao (o backend legitimo ficou travado)'; end if;
  select connected into c from public.church_social_accounts where id = current_setting('app.soc_a')::uuid;
  if not c then raise exception 'RLS-FALHA Q7b: conectado nao ficou true para service_role'; end if;
end $$;

-- E desligar também é privilégio do backend, não do app: a conexão confirmada
-- por provedor não pode ser editada de volta pelo aplicativo.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; c boolean;
begin
  begin
    update public.church_social_accounts set connected = false where id = current_setting('app.soc_a')::uuid;
    raise exception 'RLS-FALHA Q7b: authenticated desligou uma conexao confirmada';
  exception when insufficient_privilege then null; end;
  select connected into c from public.church_social_accounts where id = current_setting('app.soc_a')::uuid;
  if not c then raise exception 'RLS-FALHA Q7b: a conexao sumiu mesmo com a recusa'; end if;
end $$;
rollback to savepoint q7b;

-- Q8: estrutura anti-deriva (políticas, grants, view e o CHECK de rede).
savepoint q8;
reset role;
do $$
declare n int; faltando text; faltando_arr text[];
begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'ministries';
  if n <> 4 then raise exception 'RLS-FALHA Q8: esperava 4 politicas em ministries, encontrei %', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'ministry_members';
  if n <> 3 then raise exception 'RLS-FALHA Q8: esperava 3 politicas em ministry_members, encontrei %', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'church_social_accounts';
  if n <> 4 then raise exception 'RLS-FALHA Q8: esperava 4 politicas em church_social_accounts, encontrei %', n; end if;

  -- Escrita das três tabelas citando a permissão certa: ministries é equipe,
  -- rede social é cadastro da igreja.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'ministries'
    and (coalesce(qual,'') like '%members.manage%' or coalesce(with_check,'') like '%members.manage%');
  if n <> 3 then raise exception 'RLS-FALHA Q8: % das 4 politicas de ministries nao citam members.manage (a de leitura é por vinculo)', 4 - n; end if;
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'church_social_accounts' and cmd in ('INSERT','UPDATE','DELETE');
  if n <> 3 then raise exception 'RLS-FALHA Q8: faltam politicas de escrita em church_social_accounts (% encontradas)', n; end if;
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'church_social_accounts'
    and (coalesce(qual,'') like '%church.manage%' or coalesce(with_check,'') like '%church.manage%');
  if n <> 3 then raise exception 'RLS-FALHA Q8: % politica(s) de escrita de church_social_accounts nao citam church.manage', 3 - n; end if;

  -- anon sem grant nenhum, nas três tabelas e na view.
  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('ministries','ministry_members','church_social_accounts','ministry_list')
    and grantee = 'anon';
  if n <> 0 then raise exception 'RLS-FALHA Q8: anon tem % grant(s) nas tabelas de ministerio', n; end if;

  -- A view existe, é do dono e só authenticated lê.
  select count(*) into n from information_schema.views
  where table_schema = 'public' and table_name = 'ministry_list';
  if n <> 1 then raise exception 'RLS-FALHA Q8: view ministry_list sumiu'; end if;

  -- O trigger que segura a conexão está BEFORE INSERT OR UPDATE OF connected.
  select count(*) into n from pg_trigger t
  where t.tgrelid = 'public.church_social_accounts'::regclass and t.tgname = 'trg_church_social_accounts_connection'
    and t.tgfoid = 'public.enforce_social_connection()'::regprocedure and not t.tgisinternal
    and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16;
  if n <> 1 then raise exception 'RLS-FALHA Q8: trg_church_social_accounts_connection nao esta como BEFORE INSERT OR UPDATE de linha'; end if;

  select array(select a.attname from unnest(t.tgattr) as x(attnum)
                 join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = x.attnum order by 1) into faltando_arr
  from pg_trigger t where t.tgrelid = 'public.church_social_accounts'::regclass
    and t.tgname = 'trg_church_social_accounts_connection';
  if array_to_string(faltando_arr, ',') <> 'connected' then
    raise exception 'RLS-FALHA Q8: o trigger de conexao vigia % — esperava connected', coalesce(array_to_string(faltando_arr, ','), 'nenhuma coluna');
  end if;

  -- CHECK de network: o conjunto novo, sem tiktok.
  select count(*) into n from pg_constraint
  where contype = 'c' and conrelid = 'public.church_social_accounts'::regclass
    and pg_get_constraintdef(oid) like '%instagram%';
  if n <> 1 then raise exception 'RLS-FALHA Q8: CHECK de network sumiu de church_social_accounts'; end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.church_social_accounts'::regclass
             and pg_get_constraintdef(oid) like '%tiktok%') then
    raise exception 'RLS-FALHA Q8: church_social_accounts ainda aceita tiktok';
  end if;

  -- Colunas que o serviço projeta.
  select string_agg(f, ', ' order by f) into faltando
  from unnest(array['id','church_id','type','name','description','leader_id','created_at','updated_at']) f
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema='public' and c.table_name='ministries' and c.column_name=f);
  if faltando is not null then raise exception 'RLS-FALHA Q8: colunas sumiram de ministries: %', faltando; end if;
end $$;
rollback to savepoint q8;

-- Q9: a guarda de audiência da 0021. A view `ministry_list` é
-- `security_invoker = false` (mesma razão do `church_roster`), então o join que
-- forma `leader_name` não passa pela RLS de `profiles` — que pela 0002 só deixa
-- cada um ler a si mesmo. Sem a guarda, quem tem `members.manage` escrevia um
-- uuid alheio em `leader_id` e a tela devolvia o nome daquela pessoa: um oráculo
-- "uuid para nome" sobre outras igrejas e sobre qualquer conta da plataforma.
savepoint q9;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; ld text;
begin
  begin
    update public.ministries set leader_id = current_setting('app.user_b1')::uuid
      where id = current_setting('app.min_a')::uuid;
    raise exception 'RLS-FALHA Q9: leader de outra igreja aceito no update';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.ministries (church_id, name, type, leader_id)
      values (current_setting('app.church_a')::uuid, 'Ministerio com lider de fora', 'team',
              current_setting('app.user_b1')::uuid);
    raise exception 'RLS-FALHA Q9: leader de outra igreja aceito no insert';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.ministry_members (ministry_id, user_id)
      values (current_setting('app.min_a')::uuid, current_setting('app.user_b1')::uuid);
    raise exception 'RLS-FALHA Q9: participante de outra igreja aceito';
  exception when insufficient_privilege then null; end;

  -- Convidada A tem papel de manager na A, mas o vínculo é `invited`: antes do
  -- aceite ela ainda não é audiência de ninguém. É o caso que obriga a guarda a
  -- ler o `status`, não só a existence do vínculo.
  begin
    insert into public.ministries (church_id, name, type, leader_id)
      values (current_setting('app.church_a')::uuid, 'Ministerio com lider convidada', 'team',
              current_setting('app.user_a4')::uuid);
    raise exception 'RLS-FALHA Q9: leader invited aceito na propria igreja';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.ministry_members (ministry_id, user_id)
      values (current_setting('app.min_a')::uuid, current_setting('app.user_a4')::uuid);
    raise exception 'RLS-FALHA Q9: participante invited aceito no ministerio da A';
  exception when insufficient_privilege then null; end;

  -- Sem vínculo nenhum com a A também não entra: a régua é da igreja do
  -- ministério, não "qualquer conta da plataforma".
  begin
    insert into public.ministry_members (ministry_id, user_id)
      values (current_setting('app.min_a')::uuid, current_setting('app.user_out')::uuid);
    raise exception 'RLS-FALHA Q9: conta sem vinculo virou participante do ministerio da A';
  exception when insufficient_privilege then null; end;

  -- uuid que não é conta nenhuma: referência quebrada, não audiência.
  begin
    update public.ministries set leader_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
      where id = current_setting('app.min_a')::uuid;
    raise exception 'RLS-FALHA Q9: leader que nao e conta aceito';
  exception when foreign_key_violation then null; end;

  -- O nome que a igreja vê continua sendo o de dentro da própria igreja.
  select leader_name into ld from public.ministry_list where id = current_setting('app.min_a')::uuid;
  if ld is distinct from 'Administrador A' then
    raise exception 'RLS-FALHA Q9: depois das recusas o leader_name virou %', coalesce(ld, 'null');
  end if;
  select count(*) into n from public.ministries
    where name in ('Ministerio com lider de fora', 'Ministerio com lider convidada');
  if n <> 0 then raise exception 'RLS-FALHA Q9: % ministerio(s) recusado(s) ficaram na tabela', n; end if;
  select count(*) into n from public.ministry_members
    where ministry_id = current_setting('app.min_a')::uuid
      and user_id in (current_setting('app.user_b1')::uuid,
                      current_setting('app.user_out')::uuid,
                      current_setting('app.user_a4')::uuid);
  if n <> 0 then raise exception 'RLS-FALHA Q9: % participante(s) de fora ficaram na tabela', n; end if;
end $$;
rollback to savepoint q9;

-- Q9b: sonda anti-no-op — a guarda não virou bloqueio geral. A mesma pessoa, com
-- a mesma escrita, passa quando é gente da própria igreja.
savepoint q9b;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; c int; ld text; novo uuid;
begin
  insert into public.ministries (church_id, name, type, leader_id)
    values (current_setting('app.church_a')::uuid, 'Ministerio sonda de a1', 'team',
            current_setting('app.user_a2')::uuid)
    returning id into novo;
  if novo is null then raise exception 'RLS-FALHA Q9b: ministerio legitimo nao foi criado'; end if;

  select leader_name into ld from public.ministry_list where id = novo;
  if ld is distinct from 'Gerente A' then
    raise exception 'RLS-FALHA Q9b: o lider legitimo nao apareceu na view (veio %)', coalesce(ld, 'null');
  end if;

  insert into public.ministry_members (ministry_id, user_id)
    values (current_setting('app.min_a_two')::uuid, current_setting('app.user_a2')::uuid);
  select members_count into c from public.ministry_list where id = current_setting('app.min_a_two')::uuid;
  if c <> 1 then raise exception 'RLS-FALHA Q9b: participante legitimo nao entrou na contagem (contou %)', c; end if;

  select count(*) into n from public.ministries where id = novo;
  if n <> 1 then raise exception 'RLS-FALHA Q9b: a leitura da propria igreja nao encontra o ministerio criado'; end if;
end $$;
rollback to savepoint q9b;

-- Q9c: estrutura da 0021 — os dois triggers existem, vigiam as colunas certas e
-- as funções continuam DEFINER com search_path fixo e sem EXECUTE para o app.
savepoint q9c;
reset role;
do $$
declare n int; watched text[];
begin
  select count(*) into n from pg_trigger t
  where t.tgrelid = 'public.ministries'::regclass and t.tgname = 'trg_ministries_leader'
    and t.tgfoid = 'public.enforce_ministry_leader()'::regprocedure and not t.tgisinternal
    -- bits de tgtype: ROW=1, BEFORE=2, INSERT=4, UPDATE=16
    and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16;
  if n <> 1 then raise exception 'RLS-FALHA Q9c: trg_ministries_leader nao esta como BEFORE INSERT OR UPDATE de linha'; end if;

  select array(select a.attname from unnest(t.tgattr) as x(attnum)
                 join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = x.attnum order by 1) into watched
  from pg_trigger t where t.tgrelid = 'public.ministries'::regclass
    and t.tgname = 'trg_ministries_leader';
  if watched is distinct from array['church_id','leader_id'] then
    raise exception 'RLS-FALHA Q9c: o trigger de lider vigia % — esperava church_id,leader_id',
      coalesce(array_to_string(watched, ','), 'nenhuma coluna');
  end if;

  select count(*) into n from pg_trigger t
  where t.tgrelid = 'public.ministry_members'::regclass and t.tgname = 'trg_ministry_members_member'
    and t.tgfoid = 'public.enforce_ministry_member()'::regprocedure and not t.tgisinternal
    and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4;
  if n <> 1 then raise exception 'RLS-FALHA Q9c: trg_ministry_members_member nao esta como BEFORE INSERT de linha'; end if;

  select count(*) into n from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('enforce_ministry_leader','enforce_ministry_member')
    and p.prosecdef and p.proconfig @> array['search_path=public'];
  if n <> 2 then raise exception 'RLS-FALHA Q9c: % das 2 funcoes de guarda esta DEFINER com search_path fixo', n; end if;

  if has_function_privilege('anon', 'public.enforce_ministry_leader()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_ministry_leader()', 'EXECUTE')
     or has_function_privilege('anon', 'public.enforce_ministry_member()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_ministry_member()', 'EXECUTE') then
    raise exception 'RLS-FALHA Q9c: anon/authenticated recuperou EXECUTE nas funcoes da 0021';
  end if;
end $$;
rollback to savepoint q9c;

-- ---------------------------------------------------------------------------
-- GRUPO R — favoritos e preferências do visitante (0016)
-- ---------------------------------------------------------------------------

savepoint r1;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  begin select count(*) into n from public.visitor_favorites;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA R1: anon leu % favoritos', n; end if;
  begin select count(*) into n from public.visitor_preferences;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA R1: anon leu % preferencias', n; end if;
end $$;
rollback to savepoint r1;

-- R2: cada um vê só a própria lista — inclusive quem não tem vínculo nenhum.
savepoint r2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.visitor_favorites;
  if n <> 1 then raise exception 'RLS-FALHA R2: visitante sem vinculo deveria ver 1 favorito proprio, viu %', n; end if;
  select count(*) into n from public.visitor_favorites f
    where f.user_id in (current_setting('app.user_a1')::uuid, current_setting('app.user_b1')::uuid);
  if n <> 0 then raise exception 'RLS-FALHA R2: visitante leu % favoritos de outras contas', n; end if;
end $$;
rollback to savepoint r2;

savepoint r2b;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.visitor_favorites;
  if n <> 2 then raise exception 'RLS-FALHA R2b: a1 deveria ver os 2 favoritos dele, viu %', n; end if;
  select count(*) into n from public.visitor_preferences;
  if n <> 1 then raise exception 'RLS-FALHA R2b: a1 deveria ver 1 preferencia propria, viu %', n; end if;
end $$;
rollback to savepoint r2b;

-- R3: escrever na lista do outro é recusado na cláusula WITH CHECK, e apagar o
-- favorito alheio não apaga nada (0 linhas, não erro — é o que a RLS faz).
savepoint r3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  begin
    insert into public.visitor_favorites (user_id, event_id)
      values (current_setting('app.user_b1')::uuid, current_setting('app.event_a_pub')::uuid);
    raise exception 'RLS-FALHA R3: a1 inseriu favorito na lista de b1';
  exception when insufficient_privilege then null; end;

  delete from public.visitor_favorites
   where user_id = current_setting('app.user_b1')::uuid
     and event_id = current_setting('app.event_b_pub')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA R3: a1 apagou % favorito(s) de b1', n; end if;

  begin
    insert into public.visitor_preferences (user_id, city, interests)
      values (current_setting('app.user_b1')::uuid, 'Bauru', array['jovens']);
    raise exception 'RLS-FALHA R3: a1 gravou preferencia na conta de b1';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint r3;

-- R4: o caminho honesto funciona — salvar na própria lista, trocar a própria
-- cidade — e interesse fora do conjunto não entra.
savepoint r4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; c text;
begin
  insert into public.visitor_favorites (user_id, event_id)
    values (current_setting('app.user_a1')::uuid, current_setting('app.event_a_pri')::uuid);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA R4: a1 nao conseguiu favoritar um evento na propria lista'; end if;

  update public.visitor_preferences set city = 'Sorocaba' where user_id = current_setting('app.user_a1')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA R4: a1 nao conseguiu atualizar a propria cidade'; end if;
  select city into c from public.visitor_preferences where user_id = current_setting('app.user_a1')::uuid;
  if c <> 'Sorocaba' then raise exception 'RLS-FALHA R4: cidade deveria ser Sorocaba, veio %', c; end if;

  begin
    update public.visitor_preferences set interests = array['futbol'] where user_id = current_setting('app.user_a1')::uuid;
    raise exception 'RLS-FALHA R4: interesse fora do conjunto foi aceito';
  exception when check_violation then null; end;
end $$;
rollback to savepoint r4;

-- R5: estrutura — uma política `for all` por tabela self, sem update de
-- favoritos (não há o que atualizar) e sem grant para anon.
savepoint r5;
reset role;
do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname='public' and tablename='visitor_favorites';
  if n <> 1 then raise exception 'RLS-FALHA R5: esperava 1 politica em visitor_favorites, achei %', n; end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='visitor_favorites'
    and cmd = 'ALL' and coalesce(qual,'') like '%auth.uid()%' and coalesce(with_check,'') like '%auth.uid()%';
  if n <> 1 then raise exception 'RLS-FALHA R5: a politica de visitor_favorites nao e a `for all` com user_id = auth.uid()'; end if;

  select count(*) into n from pg_policies where schemaname='public' and tablename='visitor_preferences';
  if n <> 3 then raise exception 'RLS-FALHA R5: esperava 3 politicas em visitor_preferences, achei %', n; end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and table_name in ('visitor_favorites','visitor_preferences') and grantee='anon';
  if n <> 0 then raise exception 'RLS-FALHA R5: anon tem % grant(s) nas tabelas de visitante', n; end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and table_name='visitor_favorites' and privilege_type='UPDATE' and grantee='authenticated';
  if n <> 0 then raise exception 'RLS-FALHA R5: apareceu grant de UPDATE em visitor_favorites (% linha(s))', n; end if;

  if exists (select 1 from pg_constraint where conrelid='public.visitor_preferences'::regclass
             and pg_get_constraintdef(oid) like '%tiktok%') then
    raise exception 'RLS-FALHA R5: CHECK de interesses mentions tiktok (nao era pra existir)';
  end if;
end $$;
rollback to savepoint r5;

-- ---------------------------------------------------------------------------
-- GRUPO S — redes de igrejas / organizações (0017)
-- ---------------------------------------------------------------------------

-- S1: o SuperAdmin cria rede e associa igreja — é a única audiência que pode.
savepoint s1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; c int;
begin
  insert into public.church_networks (name, slug, description) values ('Rede do SuperAdmin', 'rede-do-superadmin', 'criada no caso S1');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA S1: superadmin nao conseguiu criar rede'; end if;

  insert into public.church_network_churches (network_id, church_id)
    select id, current_setting('app.church_d')::uuid from public.church_networks where slug = 'rede-do-superadmin';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA S1: superadmin nao conseguiu associar a igreja D'; end if;

  select churches_count into c from public.church_network_list where slug = 'rede-do-superadmin';
  if c <> 1 then raise exception 'RLS-FALHA S1: a rede nova deveria contar 1 igreja, contou %', coalesce(c::text, 'null'); end if;

  delete from public.church_network_churches
   where network_id = (select id from public.church_networks where slug = 'rede-do-superadmin');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA S1: superadmin nao conseguiu desfazer a associacao'; end if;
end $$;
rollback to savepoint s1;

-- S2: o recorte do membro. a1 pertence a uma rede compartilhada (net_a) e não
-- pertence à rede vizinha (net_b): vê a primeira, não a segunda.
savepoint s2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_network_list;
  if n <> 1 then raise exception 'RLS-FALHA S2: a1 deveria ver 1 rede (a dele), viu %', n; end if;
  if exists (select 1 from public.church_network_list where id = current_setting('app.net_b')::uuid) then
    raise exception 'RLS-FALHA S2: a1 viu a rede exclusiva da igreja B';
  end if;

  select count(*) into n from public.church_network_churches where network_id = current_setting('app.net_b')::uuid;
  if n <> 0 then raise exception 'RLS-FALHA S2: a1 leu % associacoes da rede alheia net_b', n; end if;

  -- Dentro da própria rede, as associações são visíveis: as igrejas aprovadas já
  -- são públicas (churches_public_read), então isto não abre nada que não soubéssemos.
  select churches_count into n from public.church_network_list where id = current_setting('app.net_a')::uuid;
  if n <> 2 then raise exception 'RLS-FALHA S2: net_a deveria contar 2 igrejas, contou %', n; end if;
end $$;
rollback to savepoint s2;

-- S3: membro de igreja não cria rede, não se autoassocia e não desassocia.
savepoint s3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  begin
    insert into public.church_networks (name, slug) values ('Rede da igreja A', 'rede-da-igreja-a');
    raise exception 'RLS-FALHA S3: church_admin criou rede de igrejas';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.church_network_churches (network_id, church_id)
      values (current_setting('app.net_b')::uuid, current_setting('app.church_a')::uuid);
    raise exception 'RLS-FALHA S3: a1 se associou por conta propria a uma rede';
  exception when insufficient_privilege then null; end;

  delete from public.church_network_churches
   where network_id = current_setting('app.net_a')::uuid and church_id = current_setting('app.church_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA S3: a1 removeu % igreja(s) da rede compartilhada', n; end if;
end $$;
rollback to savepoint s3;

-- S4: anônimo não vê rede nenhuma; visitante sem vínculo também não.
savepoint s4;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  begin select count(*) into n from public.church_networks;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA S4: anon leu % redes de igrejas', n; end if;
  begin select count(*) into n from public.church_network_churches;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA S4: anon leu % associacoes', n; end if;
  begin select count(*) into n from public.church_network_list;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA S4: anon leu % linhas da view de redes', n; end if;
end $$;
rollback to savepoint s4;

savepoint s4b;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.church_network_list;
  if n <> 0 then raise exception 'RLS-FALHA S4b: sem vinculo viu % redes (nao tem igreja em nenhuma)', n; end if;
end $$;
rollback to savepoint s4b;

-- S5: estrutura — escrita exclusiva de SuperAdmin nas duas tabelas, slug único e
-- com formato de URL, e a função de recorte é SECURITY DEFINER com search_path.
savepoint s5;
reset role;
do $$
declare n int; pinned boolean; found boolean;
begin
  select count(*) into n from pg_policies where schemaname='public' and tablename='church_networks';
  if n <> 4 then raise exception 'RLS-FALHA S5: esperava 4 politicas em church_networks, achei %', n; end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='church_network_churches';
  if n <> 3 then raise exception 'RLS-FALHA S5: esperava 3 politicas em church_network_churches, achei %', n; end if;

  select count(*) into n from pg_policies
  where schemaname='public' and tablename='church_networks' and cmd in ('INSERT','UPDATE','DELETE')
    and (coalesce(with_check,'') like '%is_superadmin()%' or coalesce(qual,'') like '%is_superadmin()%');
  if n <> 3 then raise exception 'RLS-FALHA S5: % politica(s) de escrita de rede nao exigem is_superadmin()', 3 - n; end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and table_name in ('church_networks','church_network_churches','church_network_list') and grantee='anon';
  if n <> 0 then raise exception 'RLS-FALHA S5: anon tem % grant(s) nas tabelas de rede', n; end if;

  select exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                 where ns.nspname='public' and p.proname='current_network_ids'),
         (p.proconfig @> array['search_path=public']::text[])
    into found, pinned
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'current_network_ids';
  if not found then raise exception 'RLS-FALHA S5: current_network_ids() sumiu de public'; end if;
  if not pinned then raise exception 'RLS-FALHA S5: current_network_ids() sem search_path fixo'; end if;

  -- Slug: único e no formato de URL.
  begin
    insert into public.church_networks (name, slug) values ('Duplicado', 'rede-teste-alfa');
    raise exception 'RLS-FALHA S5: slug duplicado aceito em church_networks';
  exception when unique_violation then null; end;
  begin
    insert into public.church_networks (name, slug) values ('Fora de formato', 'Rede com Espaco');
    raise exception 'RLS-FALHA S5: slug fora do formato aceito';
  exception when check_violation then null; end;
end $$;
rollback to savepoint s5;

-- ---------------------------------------------------------------------------
-- GRUPO T — suporte: tickets e mensagens (0018)
-- ---------------------------------------------------------------------------

-- T1: quem abriu vê; vizinho não; SuperAdmin vê tudo.
savepoint t1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.support_tickets;
  if n <> 1 then raise exception 'RLS-FALHA T1: a1 deveria ver 1 ticket (o dele), viu %', n; end if;
  select count(*) into n from public.support_ticket_list;
  if n <> 1 then raise exception 'RLS-FALHA T1: a view deveria devolver 1 ticket para a1, devolveu %', n; end if;
  select messages_count into n from public.support_ticket_list where id = current_setting('app.tick_a')::uuid;
  if n <> 1 then raise exception 'RLS-FALHA T1: a contagem de respostas do ticket deveria ser 1, veio %', n; end if;
end $$;
rollback to savepoint t1;

savepoint t1b;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_b1'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.support_tickets;
  if n <> 0 then raise exception 'RLS-FALHA T1b: b1 leu % ticket(s) da igreja A', n; end if;
  select count(*) into n from public.support_messages;
  if n <> 0 then raise exception 'RLS-FALHA T1b: b1 leu % mensagens do ticket alheio', n; end if;
end $$;
rollback to savepoint t1b;

savepoint t1c;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; nm_igreja text; nm_autor text;
begin
  select count(*) into n from public.support_ticket_list;
  if n <> 2 then raise exception 'RLS-FALHA T1c: superadmin deveria ver os 2 tickets, viu %', n; end if;
  select church_name, opened_by_name into nm_igreja, nm_autor
  from public.support_ticket_list where id = current_setting('app.tick_a')::uuid;
  if nm_igreja is null then raise exception 'RLS-FALHA T1c: a view nao projeta a igreja do ticket para o superadmin'; end if;
  if nm_autor is null then raise exception 'RLS-FALHA T1c: a view nao projeta o nome de quem abriu o ticket'; end if;
end $$;
rollback to savepoint t1c;

-- T2: audiência apertada de propósito — gerente da MESMA igreja não é quem
-- gerencia a igreja, então não lê o ticket de um membro dela.
savepoint t2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a2'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.support_tickets;
  if n <> 0 then raise exception 'RLS-FALHA T2: manager (sem church.manage) leu % ticket(s) da propria igreja', n; end if;
  select count(*) into n from public.support_messages;
  if n <> 0 then raise exception 'RLS-FALHA T2: manager leu % mensagens do ticket de a1', n; end if;
end $$;
rollback to savepoint t2;

-- T3: abrir chamado — o autor é quem está logado, e a igreja do assunto tem de
-- ser a sua. Visitante sem vínculo abre sem igreja.
savepoint t3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  insert into public.support_tickets (church_id, opened_by, subject)
    values (current_setting('app.church_a')::uuid, current_setting('app.user_a1')::uuid, 'Problema no check-in');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA T3: a1 nao conseguiu abrir chamado da propria igreja'; end if;

  begin
    insert into public.support_tickets (church_id, opened_by, subject)
      values (current_setting('app.church_b')::uuid, current_setting('app.user_a1')::uuid, 'Sobre a igreja vizinha');
    raise exception 'RLS-FALHA T3: a1 abriu ticket sobre a igreja B';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.support_tickets (church_id, opened_by, subject)
      values (null, current_setting('app.user_b1')::uuid, 'Forjando o autor');
    raise exception 'RLS-FALHA T3: a1 abriu ticket em nome de b1';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint t3;

savepoint t3b;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_out'))::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.support_tickets;
  if n <> 1 then raise exception 'RLS-FALHA T3b: visitante sem vinculo deveria ver 1 ticket (o dele), viu %', n; end if;
  insert into public.support_tickets (church_id, opened_by, subject)
    values (null, current_setting('app.user_out')::uuid, 'Como cadastro minha igreja? parte 2');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA T3b: visitante sem vinculo nao conseguiu abrir chamado'; end if;
end $$;
rollback to savepoint t3b;

-- T4: responder. No próprio ticket todo mundo do direito pode; no alheio, não.
savepoint t4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  insert into public.support_messages (ticket_id, author_id, body)
    values (current_setting('app.tick_a')::uuid, current_setting('app.user_a1')::uuid, 'Complemento do autor.');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA T4: autor nao conseguiu responder no proprio ticket'; end if;

  begin
    insert into public.support_messages (ticket_id, author_id, body)
      values (current_setting('app.tick_out')::uuid, current_setting('app.user_a1')::uuid, 'Resposta indevida');
    raise exception 'RLS-FALHA T4: a1 respondeu no ticket de outra pessoa';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint t4;

savepoint t4b;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; st text;
begin
  insert into public.support_messages (ticket_id, author_id, body)
    values (current_setting('app.tick_a')::uuid, current_setting('app.user_su')::uuid, 'Suporte respondeu.');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA T4b: superadmin nao conseguiu responder ao ticket'; end if;

  update public.support_tickets set status = 'answered' where id = current_setting('app.tick_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA T4b: superadmin nao conseguiu marcar o ticket como respondido'; end if;
  select status into st from public.support_tickets where id = current_setting('app.tick_a')::uuid;
  if st <> 'answered' then raise exception 'RLS-FALHA T4b: status deveria ser answered, veio %', st; end if;
end $$;
rollback to savepoint t4b;

-- T5: fechar por quem abriu, e nada de apagar suporte.
savepoint t5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int; st text;
begin
  update public.support_tickets set status = 'closed' where id = current_setting('app.tick_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RLS-FALHA T5: autor nao conseguiu fechar o proprio ticket'; end if;
  select status into st from public.support_tickets where id = current_setting('app.tick_a')::uuid;
  if st <> 'closed' then raise exception 'RLS-FALHA T5: status esperado closed, veio %', st; end if;

  -- Ticket alheio não aparece para UPDATE: a recusa é zero linhas, não erro.
  update public.support_tickets set status = 'closed' where id = current_setting('app.tick_out')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FALHA T5: a1 fechou o ticket de outra pessoa (% linhas)', n; end if;

  begin
    delete from public.support_tickets where id = current_setting('app.tick_a')::uuid;
    raise exception 'RLS-FALHA T5: delete de ticket foi aceito pelo papel';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.support_messages where id = current_setting('app.msg_tick_a')::uuid;
    raise exception 'RLS-FALHA T5: delete de mensagem do suporte foi aceito';
  exception when insufficient_privilege then null; end;

  select count(*) into n from public.support_messages where ticket_id = current_setting('app.tick_a')::uuid;
  if n <> 1 then raise exception 'RLS-FALHA T5: depois das recusas, o ticket deveria manter 1 mensagem, tem %', n; end if;
end $$;
rollback to savepoint t5;

-- T6: estrutura — sem delete, sem grant para anon, e `can_read_ticket` é
-- SECURITY DEFINER com search_path fixo (é a porta das duas tabelas).
savepoint t6;
reset role;
do $$
declare n int; pinned boolean; found boolean; definer boolean;
begin
  select count(*) into n from pg_policies where schemaname='public' and tablename='support_tickets';
  if n <> 3 then raise exception 'RLS-FALHA T6: esperava 3 politicas em support_tickets, achei %', n; end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='support_messages';
  if n <> 2 then raise exception 'RLS-FALHA T6: esperava 2 politicas em support_messages, achei %', n; end if;

  select count(*) into n from pg_policies
  where schemaname='public' and tablename in ('support_tickets','support_messages') and cmd = 'DELETE';
  if n <> 0 then raise exception 'RLS-FALHA T6: apareceu % politica(s) de delete no suporte', n; end if;

  -- Sem política de delete não basta: sem grant de delete também, senão o
  -- comando passa direto pela tabela e a trilha de suporte deixa de ser trilha.
  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and table_name in ('support_tickets','support_messages')
    and grantee='authenticated' and privilege_type = 'DELETE';
  if n <> 0 then raise exception 'RLS-FALHA T6: authenticated tem grant de DELETE no suporte (% linha(s))', n; end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and table_name in ('support_tickets','support_messages','support_ticket_list')
    and grantee='anon';
  if n <> 0 then raise exception 'RLS-FALHA T6: anon tem % grant(s) nas tabelas de suporte', n; end if;

  select count(*) into n from information_schema.views
  where table_schema='public' and table_name = 'support_ticket_list';
  if n <> 1 then raise exception 'RLS-FALHA T6: a view support_ticket_list sumiu'; end if;

  select exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                 where ns.nspname='public' and p.proname='can_read_ticket'),
         (p.prosecdef),
         (p.proconfig @> array['search_path=public']::text[])
    into found, definer, pinned
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'can_read_ticket';
  if not found then raise exception 'RLS-FALHA T6: can_read_ticket() sumiu de public'; end if;
  if not definer then raise exception 'RLS-FALHA T6: can_read_ticket() deixou de ser SECURITY DEFINER (a politica de support_messages para de funcionar)'; end if;
  if not pinned then raise exception 'RLS-FALHA T6: can_read_ticket() sem search_path fixo'; end if;

  -- A regra de audiência está escrita na função, na view e na política: se uma
  -- das três for afrouxada de volta para "qualquer membro da igreja", este caso
  -- falha antes de o código chegar na tela.
  select count(*) into n
  from (
    select pg_get_functiondef(p.oid) as src from pg_proc p
     where p.proname = 'can_read_ticket'
    union all
    select pg_get_viewdef('public.support_ticket_list'::regclass, true)
    union all
    select coalesce(qual,'') from pg_policies
     where schemaname='public' and tablename='support_tickets' and cmd='SELECT'
  ) s
  where s.src like '%church.manage%';
  if n <> 3 then raise exception 'RLS-FALHA T6: % dos 3 lugares da audiencia do suporte nao citam church.manage', n; end if;
end $$;
rollback to savepoint t6;

-- ---------------------------------------------------------------------------
-- GRUPO U — eventos de segurança (0019)
-- ---------------------------------------------------------------------------

-- U1: a RPC é a única porta, escreve com a identidade de quem chama e recusa
-- tipo desconhecido. Quem chamou não é SuperAdmin, então continua sem ler nada.
savepoint u1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$
declare n int;
begin
  perform public.log_security_event('permission_denied', 'events.insert', current_setting('app.church_b')::uuid);

  select count(*) into n from public.security_events;
  if n <> 0 then raise exception 'RLS-FALHA U1: a1 leu % evento(s) de seguranca (leitura e do SuperAdmin)', n; end if;

  begin
    perform public.log_security_event('outra_coisa', 'nada', null);
    raise exception 'RLS-FALHA U1: tipo de evento desconhecido foi aceito pela RPC';
  exception when invalid_parameter_value then null; end;

  begin
    insert into public.security_events (actor_id, kind) values (current_setting('app.user_a1')::uuid, 'permission_denied');
    raise exception 'RLS-FALHA U1: insert direto em security_events foi aceito pela API';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint u1;

-- U2: o SuperAdmin lê o que a RPC gravou, com nome de quem tentou, e as duas
-- visões (resumo por tipo e log dos últimos) concordam com a contagem.
savepoint u2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_a1'))::text, true);
do $$ begin
  perform public.log_security_event('permission_denied', 'marketing_campaigns.insert', current_setting('app.church_a')::uuid);
  perform public.log_security_event('publish_denied', 'church_social_accounts.update', current_setting('app.church_a')::uuid);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('app.user_su'))::text, true);
do $$
declare n int; c int; ultimo_evento timestamptz; nm text;
begin
  select count(*) into n from public.security_events;
  if n <> 2 then raise exception 'RLS-FALHA U2: superadmin deveria ver 2 eventos, viu %', n; end if;

  select last_24h into c from public.security_event_summary where kind = 'permission_denied';
  if c <> 1 then raise exception 'RLS-FALHA U2: o resumo deveria marcar 1 recusa de permissao em 24h, marcou %', coalesce(c::text, 'null'); end if;
  select total, last_at into c, ultimo_evento from public.security_event_summary where kind = 'publish_denied';
  if c <> 1 or ultimo_evento is null then raise exception 'RLS-FALHA U2: o resumo de publish_denied veio % / %', coalesce(c::text,'null'), coalesce(ultimo_evento::text,'null'); end if;

  select count(*) into n from public.security_event_log;
  if n <> 2 then raise exception 'RLS-FALHA U2: o log do superadmin deveria ter 2 linhas, tem %', n; end if;
  select actor_name into nm from public.security_event_log where kind = 'publish_denied';
  if nm is distinct from 'Administrador A' then raise exception 'RLS-FALHA U2: o log nao projeta o nome de quem tentou (%)', coalesce(nm,'null'); end if;
end $$;
rollback to savepoint u2;

-- U3: sem vínculo nenhum também não lê; e anônimo nem executa a RPC.
savepoint u3;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon","sub":null}', true);
do $$
declare n int;
begin
  begin select count(*) into n from public.security_events;
        exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'RLS-FALHA U3: anon leu % eventos de seguranca', n; end if;
  begin
    perform public.log_security_event('permission_denied', 'nada', null);
    raise exception 'RLS-FALHA U3: anon executou log_security_event';
  exception when insufficient_privilege then null; end;
end $$;
rollback to savepoint u3;

-- U4: estrutura — uma política de leitura, sem grant de escrita para ninguém,
-- execute só para authenticated, e a RPC com search_path fixo.
savepoint u4;
reset role;
do $$
declare n int; pinned boolean; found boolean; n_bool boolean;
begin
  select count(*) into n from pg_policies where schemaname='public' and tablename='security_events';
  if n <> 1 then raise exception 'RLS-FALHA U4: esperava 1 politica em security_events, achei %', n; end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='security_events'
    and cmd = 'SELECT' and qual like '%is_superadmin()%';
  if n <> 1 then raise exception 'RLS-FALHA U4: a politica de security_events nao e leitura de SuperAdmin'; end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and table_name='security_events' and grantee='anon';
  if n <> 0 then raise exception 'RLS-FALHA U4: anon tem % grant(s) em security_events', n; end if;
  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and table_name='security_events' and grantee='authenticated'
    and privilege_type in ('INSERT','UPDATE','DELETE');
  if n <> 0 then raise exception 'RLS-FALHA U4: authenticated tem grant de escrita em security_events (% linha(s))', n; end if;

  select has_function_privilege('anon', 'public.log_security_event(text,text,uuid)', 'EXECUTE') into n_bool;
  if n_bool then raise exception 'RLS-FALHA U4: anon consegue executar log_security_event'; end if;
  if not has_function_privilege('authenticated', 'public.log_security_event(text,text,uuid)', 'EXECUTE') then
    raise exception 'RLS-FALHA U4: authenticated nao consegue executar log_security_event (o app inteiro fica mudo)';
  end if;

  select exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                 where ns.nspname='public' and p.proname='log_security_event'),
         (p.proconfig @> array['search_path=public']::text[])
    into found, pinned
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'log_security_event';
  if not found then raise exception 'RLS-FALHA U4: log_security_event() sumiu de public'; end if;
  if not pinned then raise exception 'RLS-FALHA U4: log_security_event() sem search_path fixo'; end if;

  select count(*) into n from information_schema.views
  where table_schema='public' and table_name in ('security_event_summary','security_event_log');
  if n <> 2 then raise exception 'RLS-FALHA U4: faltam views de monitoramento (% encontradas)', n; end if;
end $$;
rollback to savepoint u4;

do $$ begin raise notice 'RLS-ISOLATION: todos os casos passaram'; end $$;

-- Nada é persistido: fixtures e testes vivem só nesta transação.
rollback;
