-- ============================================================================
-- IgrejaConecta — Fase 2: roster da própria igreja (nomes visíveis sem vazar)
--
-- Problema: `profiles_self_read` só deixa ler o próprio perfil (mais SuperAdmin).
-- Isolamento correto, mas `/app/usuarios`, check-in de evento e lista de
-- participantes ficam sem nome nenhum.
--
-- Solução: NÃO afrouxar `profiles` (telefone e e-mail de todos os membros
-- virando leitura pública da igreja seria exposição desnecessária sob LGPD), e
-- sim uma view de roster que:
--   1) traz o essencial para identificação (nome, avatar, papel, status);
--   2) mostra e-mail/telefone somente para quem tem 'members.manage' na igreja.
--
-- A view roda com os direitos do dono (security_invoker = false, explícito para
-- não restar dúvida) porque o filtro de isolamento está no WHERE e usa a
-- identidade de quem consulta: current_church_ids() lê auth.uid() em tempo de
-- execução. Sem vínculo, sem linhas; para anon, current_church_ids() é vazio.
-- SuperAdmin vê todos os rosters, como já acontece nas demais políticas.
-- ============================================================================

create or replace view public.church_roster
with (security_invoker = false)
as
select
  cm.id          as member_id,
  cm.church_id,
  cm.user_id,
  p.full_name,
  p.avatar_url,
  r.key          as role_key,
  r.name         as role_name,
  cm.status      as membership_status,
  case when public.has_church_permission(cm.church_id, 'members.manage')
       then p.email else null end as email,
  case when public.has_church_permission(cm.church_id, 'members.manage')
       then p.phone else null end as phone
from public.church_members cm
join public.profiles p on p.id = cm.user_id
join public.roles r on r.id = cm.role_id
where cm.status = 'active'
  and (public.is_superadmin() or cm.church_id in (select public.current_church_ids()));

alter view public.church_roster owner to postgres;
revoke all on public.church_roster from anon;
grant select on public.church_roster to authenticated;
