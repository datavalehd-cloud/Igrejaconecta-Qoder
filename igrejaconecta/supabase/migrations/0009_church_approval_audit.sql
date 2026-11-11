create or replace function public.record_church_approval_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  audit_id uuid;
  audit_action text;
begin
  audit_action := case new.approval_status
    when 'approved' then case when old.approval_status = 'suspended' then 'igreja.reativada' else 'igreja.aprovada' end
    when 'suspended' then 'igreja.suspensa'
    when 'rejected' then 'igreja.rejeitada'
    when 'in_review' then 'igreja.em_analise'
    when 'pending' then 'igreja.pendente'
  end;

  -- A marca autoriza este insert na política audit_logs_insert (0010) e é limpa
  -- logo abaixo: nem outro insert da mesma transação passa por ela.
  perform set_config('igrejaconecta.audit_write', 'on', true);

  -- STRICT também aborta o UPDATE se outro trigger descartar o INSERT sem erro.
  insert into public.audit_logs (actor_id, action, target, church_id, metadata)
  values (auth.uid(), audit_action, new.name, new.id,
          jsonb_build_object('de', old.approval_status, 'para', new.approval_status))
  returning id into strict audit_id;

  perform set_config('igrejaconecta.audit_write', '', true);

  return new;
end;
$$;

drop trigger if exists trg_churches_approval_audit on public.churches;
create trigger trg_churches_approval_audit
  after update of approval_status on public.churches
  for each row
  when (old.approval_status is distinct from new.approval_status)
  execute function public.record_church_approval_audit();
