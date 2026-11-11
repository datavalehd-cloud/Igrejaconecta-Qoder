-- ============================================================================
-- IgrejaConecta — Seed inicial (papéis e permissões)
-- Rode DEPOIS das migrações 0001 e 0002. Idempotente (on conflict do nothing).
-- Não insere usuários/igrejas reais; isso é feito pelo fluxo de cadastro.
-- ============================================================================

insert into public.roles (key, name, description) values
  ('superadmin',   'SuperAdmin',              'Administração global da plataforma'),
  ('church_admin', 'Administrador da igreja', 'Gerencia totalmente a própria igreja'),
  ('manager',      'Gerente',                 'Gerencia eventos, inscrições e divulgação'),
  ('communicator', 'Comunicador',             'Cria conteúdo e campanhas de divulgação'),
  ('pastor',       'Pastor / Líder',          'Liderança espiritual e eventos'),
  ('visitor',      'Visitante',               'Usuário sem vínculo administrativo')
on conflict (key) do nothing;

insert into public.permissions (key, label) values
  ('church.manage',       'Gerenciar igreja'),
  ('church.approve',      'Aprovar igrejas'),
  ('members.manage',      'Gerenciar membros'),
  ('events.manage',       'Gerenciar eventos'),
  ('events.publish',      'Publicar eventos'),
  ('registrations.manage','Gerenciar inscrições'),
  ('marketing.manage',    'Gerenciar divulgação'),
  ('ai.use',              'Usar IgrejaConecta AI'),
  ('automation.manage',   'Gerenciar automações'),
  ('reports.view',        'Ver relatórios'),
  ('platform.admin',      'Administrar plataforma')
on conflict (key) do nothing;

-- Matriz RBAC: papel -> permissões --------------------------------------------
with role_perms (role_key, perm_key) as (
  values
    ('superadmin','church.manage'),('superadmin','church.approve'),('superadmin','members.manage'),
    ('superadmin','events.manage'),('superadmin','events.publish'),('superadmin','registrations.manage'),
    ('superadmin','marketing.manage'),('superadmin','ai.use'),('superadmin','automation.manage'),
    ('superadmin','reports.view'),('superadmin','platform.admin'),
    ('church_admin','church.manage'),('church_admin','members.manage'),('church_admin','events.manage'),
    ('church_admin','events.publish'),('church_admin','registrations.manage'),('church_admin','marketing.manage'),
    ('church_admin','ai.use'),('church_admin','automation.manage'),('church_admin','reports.view'),
    ('manager','events.manage'),('manager','events.publish'),('manager','registrations.manage'),
    ('manager','marketing.manage'),('manager','ai.use'),('manager','automation.manage'),('manager','reports.view'),
    ('communicator','events.manage'),('communicator','marketing.manage'),('communicator','ai.use'),
    ('pastor','events.manage'),('pastor','events.publish'),('pastor','registrations.manage')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perms rp
join public.roles r on r.key = rp.role_key
join public.permissions p on p.key = rp.perm_key
on conflict do nothing;

-- Configurações padrão --------------------------------------------------------
insert into public.system_settings (key, value) values
  ('platform', '{"name":"IgrejaConecta","church_signup":"free","mfa_required":["superadmin","church_admin"]}'::jsonb),
  ('privacy', '{"audit_retention_months":12,"location_search_storage":"none","communication_opt_in":true}'::jsonb)
on conflict (key) do nothing;
