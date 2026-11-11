-- ============================================================================
-- IgrejaConecta — Fase 1/2: quem cria a igreja passa a ser administrador dela
--
-- A suíte de isolamento mostrou o buraco de onboarding: `churches_insert` aceita
-- o cadastro (created_by = auth.uid(), approval_status = 'pending'), mas sem
-- linha em church_members o criador não consegue nem SELECIONAR a própria igreja
-- (`churches_public_read` exige 'approved' ou membership) nem editá-la
-- (`churches_update` exige church.manage). Na prática a igreja sumia depois do
-- cadastro e dependia de um SuperAdmin anexar alguém manualmente.
--
-- O attachment é feito por trigger SECURITY DEFINER — mesmo padrão do
-- handle_new_user do Supabase — porque a política de church_members barraria o
-- próprio criador (ele ainda não tem members.manage em lugar nenhum).
--
-- O papel anexado é 'church_admin', nunca 'superadmin': o guarda da 0005 continua
-- valendo para atribuições de superadmin.
-- ============================================================================

create or replace function public.attach_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
begin
  if new.created_by is null then
    return new;
  end if;

  select id into admin_id from public.roles where key = 'church_admin';
  if admin_id is null then
    -- seed ainda não aplicado: não invente papel, deixe o fluxo de cadastro avisar
    return new;
  end if;

  insert into public.church_members (church_id, user_id, role_id, status)
  values (new.id, new.created_by, admin_id, 'active')
  on conflict (church_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_churches_creator_admin on public.churches;
create trigger trg_churches_creator_admin
  after insert on public.churches
  for each row execute function public.attach_creator_as_admin();
