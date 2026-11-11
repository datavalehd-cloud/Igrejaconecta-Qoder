-- ============================================================================
-- IgrejaConecta — a trilha de auditoria só é escrita pelo trigger da 0009.
--
-- Até aqui `audit_logs_insert` (0004) pedia apenas `is_superadmin()`: o SuperAdmin
-- podia inserir uma linha inventando ação e atribuindo `actor_id` a outra conta
-- (o antigo caso K5 media exatamente isso). Como o trigger da 0009 é SECURITY
-- INVOKER, ele insere como o próprio usuário e dependia dessa mesma política —
-- remover a política calaria a trilha automática, e torná-lo DEFINER elevaria
-- privilégio e ignoraria a RLS de auditoria.
--
-- A marca de transação resolve os dois lados: o trigger a liga imediatamente
-- antes do insert e a desliga logo depois. Pela API (PostgREST) ninguém consegue
-- ligá-la — não há RPC que chame set_config —, então o insert manual morre para
-- todos, inclusive SuperAdmin, sem nenhuma permissão nova.
--
-- Limite: quem executa SQL direto (SQL Editor, conexão como dono, service_role)
-- continua fora do alcance da RLS e pode ligar a marca. Isso não é fechável aqui.
-- ============================================================================

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (
    public.is_superadmin()
    and current_setting('igrejaconecta.audit_write', true) = 'on'
  );