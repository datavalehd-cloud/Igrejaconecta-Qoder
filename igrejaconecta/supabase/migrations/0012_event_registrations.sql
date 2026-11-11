-- ============================================================================
-- IgrejaConecta — Fase 3, passo 2: inscrições, capacidade e check-in
--
-- A tabela de eventos (0011) é de leitura; a tela de detalhe mostrava "—" no
-- lugar dos inscritos porque não havia fonte confirmada. Aqui nasce a fonte.
--
-- Por que toda escrita passa por RPC SECURITY DEFINER:
--   * quem se inscreve é o **visitante** — na maioria das vezes anon, sem vínculo
--     algum com a igreja. Nenhuma política de insert o deixaria escrever, e abrir
--     uma política de insert para anon seria abrir a tabela inteira;
--   * por isso `event_registrations` NÃO tem política de insert/update/delete e
--     NÃO tem grant de escrita para anon/authenticated. RLS e grants fecham juntos:
--     só as três funções abaixo escrevem;
--   * leitura direta fica com quem tem `registrations.manage` na igreja da linha
--     (mais SuperAdmin e o dono da própria linha). Comunicador tem `events.manage`
--     sem `registrations.manage`: vê as contagens, não vê nomes nem e-mails.
--
-- Superfície anon (`register_for_event`) e o que a contém:
--   * um código só (`evento_indisponivel`) para evento inexistente, rascunho,
--     privado, unlisted e igreja suspensa/reprovada — a RPC não vira oráculo de
--     enumeração da agenda interna;
--   * a mesma audiência de `events_public_read`: publicado + público + igreja
--     aprovada e ativa. Inscrever-se num evento que o visitante não pode ver é
--     recusado, o que mantém as duas pontas coerentes;
--   * `select ... for update` na linha do evento serializa a disputa por vaga:
--     duas inscrições simultâneas não estouram a capacidade;
--   * único parcial por (evento, e-mail) entre as não canceladas — sem duplicata
--     e sem fila dupla;
--   * o `ticket_code` gerado NUNCA é devolvido por esta RPC. Ele é o ingresso do
--     check-in e só aparece para a equipe e para o dono confirmado da linha;
--     dizer "enviamos por e-mail" seria mentira (não há envio), então a tela
--     mostra apenas o estado confirmado pela função.
--
-- `church_id` é derivado do evento por trigger, sempre ativo (inclusive para
-- service_role e SQL Editor): é essa coluna que a RLS usa para isolar, então um
-- valor forjado moveria a inscrição para a igreja errada.
-- ============================================================================

create table if not exists public.event_registrations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  church_id     uuid not null references public.churches (id) on delete cascade,
  -- nulo para o visitante sem conta: a inscrição existe antes do usuário existir
  user_id       uuid references public.profiles (id) on delete set null,
  visitor_name  text not null,
  visitor_email text not null,
  visitor_phone text,
  status        text not null default 'pending'
                  check (status in ('pending','confirmed','waitlist','checked_in','cancelled')),
  ticket_code   text not null,
  checked_in_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Um inscrito ativo por e-mail por evento; cancelar libera nova inscrição.
create unique index if not exists uq_registration_active
  on public.event_registrations (event_id, lower(visitor_email))
  where status <> 'cancelled';

create unique index if not exists uq_registration_ticket
  on public.event_registrations (ticket_code);

create index if not exists idx_registrations_church
  on public.event_registrations (church_id, status);

create index if not exists idx_registrations_event
  on public.event_registrations (event_id, status);

drop trigger if exists trg_event_registrations_updated on public.event_registrations;
create trigger trg_event_registrations_updated before update on public.event_registrations
  for each row execute function public.touch_updated_at();

-- church_id sempre igual ao do evento ---------------------------------------
-- DEFINER porque quem inscreve (anon) não lê `events` fora da audiência pública
-- e a checagem precisa valer para qualquer linha, inclusive rascunho.
create or replace function public.enforce_registration_church()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  event_church uuid;
begin
  select church_id into event_church from public.events where id = new.event_id;
  if event_church is null then
    raise exception 'evento da inscrição não encontrado' using errcode = '23503';
  end if;
  if new.church_id <> event_church then
    raise exception 'church_id da inscrição precisa ser o do evento'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_event_registrations_church on public.event_registrations;
create trigger trg_event_registrations_church
  before insert or update of event_id, church_id on public.event_registrations
  for each row execute function public.enforce_registration_church();

revoke execute on function public.enforce_registration_church() from public;

-- Código do ingresso ----------------------------------------------------------
-- Alfabeto sem 0/1 (md5 só tem 0-9a-f, e 0 vira 2, 1 vira 3): quem digita no
-- balcão não confunde com O/I. Unicidade garantida pelo índice; a RPC tenta de novo.
create or replace function public.new_ticket_code()
returns text
language sql volatile
set search_path = public
as $$
  select substr(code, 1, 3) || '-' || substr(code, 4, 6)
  from (
    select upper(translate(
      substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 6),
      '01', '23')) as code
  ) t;
$$;

-- RLS ------------------------------------------------------------------------
alter table public.event_registrations enable row level security;

-- Nome, e-mail e telefone de visitante são dados pessoais (LGPD): anon não tem
-- grant nenhum, e authenticated só recebe SELECT. Escrita é exclusividade das
-- RPCs DEFINER, que rodam como dono da função.
revoke all on public.event_registrations from anon, authenticated;
grant select on public.event_registrations to authenticated;

drop policy if exists event_registrations_read on public.event_registrations;
create policy event_registrations_read on public.event_registrations
  for select to authenticated using (
    public.is_superadmin()
    or public.has_church_permission(church_id, 'registrations.manage')
    or user_id = auth.uid()
  );

-- Inscrição do visitante ------------------------------------------------------
create or replace function public.register_for_event(
  p_event uuid,
  p_name  text,
  p_email text,
  p_phone text default null
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  ev         public.events%rowtype;
  occupied   bigint;
  new_status text;
  profile_id uuid;
  attempts   integer := 0;
  inserted   boolean := false;
begin
  if p_name is null or length(trim(p_name)) < 2 then
    return 'dados_invalidos';
  end if;
  if p_email is null or position('@' in trim(p_email)) = 0 then
    return 'dados_invalidos';
  end if;

  -- trava a linha do evento: a contagem de vagas fica serializada
  select * into ev from public.events where id = p_event for update;

  -- um código só para tudo que não está no ar: sem oráculo de enumeração
  if ev.id is null or ev.status <> 'published' or ev.visibility <> 'public' then
    return 'evento_indisponivel';
  end if;
  if not exists (
    select 1 from public.churches c
    where c.id = ev.church_id and c.approval_status = 'approved' and c.status = 'active'
  ) then
    return 'evento_indisponivel';
  end if;
  if ev.starts_at <= now() then
    return 'evento_encerrado';
  end if;

  if exists (
    select 1 from public.event_registrations r
    where r.event_id = ev.id
      and lower(r.visitor_email) = lower(trim(p_email))
      and r.status <> 'cancelled'
  ) then
    return 'ja_inscrita';
  end if;

  select count(*) into occupied
  from public.event_registrations
  where event_id = ev.id and status in ('pending','confirmed','checked_in');

  new_status := case
    when ev.capacity is null or occupied < ev.capacity then 'confirmed'
    else 'waitlist'
  end;

  select id into profile_id from public.profiles where id = auth.uid();

  -- colisão de código é improvável, mas o índice é único: tenta de novo
  while not inserted and attempts < 3 loop
    attempts := attempts + 1;
    begin
      insert into public.event_registrations
        (event_id, church_id, user_id, visitor_name, visitor_email, visitor_phone, status, ticket_code)
      values
        (ev.id, ev.church_id, profile_id, trim(p_name), lower(trim(p_email)),
         nullif(trim(coalesce(p_phone, '')), ''), new_status, public.new_ticket_code());
      inserted := true;
    exception
      when unique_violation then null;
    end;
  end loop;

  if not inserted then
    raise exception 'não foi possível registrar a inscrição' using errcode = '23505';
  end if;

  return new_status;
end;
$$;

-- Check-in --------------------------------------------------------------------
create or replace function public.check_in_registration(p_registration uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  reg public.event_registrations%rowtype;
begin
  -- permissão antes de existência: id inexistente devolve o mesmo código de uma
  -- linha alheia, então a função não serve para sondar quais inscrições existem
  if not (public.is_superadmin()
          or exists (select 1 from public.event_registrations r
                     where r.id = p_registration
                       and public.has_church_permission(r.church_id, 'registrations.manage'))) then
    return 'sem_permissao';
  end if;

  select * into reg from public.event_registrations where id = p_registration;
  if reg.status = 'cancelled' then
    return 'cancelada';
  end if;
  if reg.status = 'checked_in' then
    return 'ja_presente';
  end if;

  update public.event_registrations
    set status = 'checked_in', checked_in_at = now()
    where id = reg.id;

  return 'presente';
end;
$$;

-- Cancelamento (dono da linha ou equipe) + promoção da lista de espera --------
create or replace function public.cancel_event_registration(p_registration uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  reg        public.event_registrations%rowtype;
  ev         public.events%rowtype;
  occupied   bigint;
  promoted   uuid;
begin
  -- permissão antes de existência: quem não tem acesso recebe `sem_permissao`
  -- tanto para linha alheia quanto para id inexistente, sem oráculo
  if not (
    public.is_superadmin()
    or exists (
      select 1 from public.event_registrations r
      where r.id = p_registration
        and (public.has_church_permission(r.church_id, 'registrations.manage')
             or (r.user_id is not null and r.user_id = auth.uid()))
    )
  ) then
    return 'sem_permissao';
  end if;

  select * into reg from public.event_registrations where id = p_registration;
  if reg.status = 'cancelled' then
    return 'ja_cancelada';
  end if;

  select * into ev from public.events where id = reg.event_id for update;

  update public.event_registrations set status = 'cancelled' where id = reg.id;

  if ev.capacity is null then
    return 'cancelada';
  end if;

  select count(*) into occupied
  from public.event_registrations
  where event_id = ev.id and status in ('pending','confirmed','checked_in');

  if occupied >= ev.capacity then
    return 'cancelada';
  end if;

  select id into promoted
  from public.event_registrations
  where event_id = ev.id and status = 'waitlist'
  order by created_at, id
  limit 1;

  if promoted is null then
    return 'cancelada';
  end if;

  update public.event_registrations set status = 'confirmed' where id = promoted;
  return 'cancelada_com_promocao';
end;
$$;

-- Estatísticas por evento -----------------------------------------------------
-- Só agregados: nenhum nome, e-mail, telefone ou código sai daqui. É o que
-- permite dar a contagem de inscritos ao visitante sem abrir a tabela.
--
-- A view roda como dona (security_invoker = false, explícito como na 0007) e o
-- isolamento está no WHERE, parentezado por audiência:
--   1) SuperAdmin vê tudo;
--   2) quem é da igreja vê os próprios eventos, inclusive rascunho;
--   3) qualquer um (anon inclusive) vê os eventos no ar — exatamente a audiência
--      de `events_public_read`, sem revelar nada além do número.
-- LEFT JOIN para que evento sem inscrição apareça com zero em vez de sumir: a
-- ausência de linha não pode ser ambígua entre "zero" e "não autorizado".
create or replace view public.event_registration_stats
with (security_invoker = false)
as
select
  e.id          as event_id,
  e.church_id,
  e.capacity,
  count(r.id) filter (where r.status = 'pending')    as pending_count,
  count(r.id) filter (where r.status = 'confirmed')  as confirmed_count,
  count(r.id) filter (where r.status = 'waitlist')   as waitlist_count,
  count(r.id) filter (where r.status = 'checked_in') as checked_in_count,
  count(r.id) filter (where r.status = 'cancelled')  as cancelled_count,
  count(r.id) filter (where r.status <> 'cancelled') as active_count,
  case when e.capacity is null then null
       else greatest(
         e.capacity - count(r.id) filter (where r.status in ('pending','confirmed','checked_in')),
         0)
  end as spots_left
from public.events e
left join public.event_registrations r on r.event_id = e.id
where public.is_superadmin()
   or (e.church_id in (select public.current_church_ids()))
   or (e.status = 'published'
       and e.visibility = 'public'
       and exists (
         select 1 from public.churches c
         where c.id = e.church_id
           and c.approval_status = 'approved'
           and c.status = 'active'
       ))
group by e.id, e.church_id, e.capacity;

alter view public.event_registration_stats owner to postgres;
revoke all on public.event_registration_stats from public;
grant select on public.event_registration_stats to anon, authenticated, service_role;

-- Funções novas nascem com EXECUTE para PUBLIC: revoke de "public" e não só de
-- "anon", senão não fecha nada (mesma lição da 0008).
revoke execute on function public.new_ticket_code() from public, anon;
revoke execute on function public.register_for_event(uuid, text, text, text) from public;
revoke execute on function public.check_in_registration(uuid) from public, anon;
revoke execute on function public.cancel_event_registration(uuid) from public, anon;

grant execute on function public.register_for_event(uuid, text, text, text)
  to anon, authenticated, service_role;
grant execute on function public.check_in_registration(uuid) to authenticated, service_role;
grant execute on function public.cancel_event_registration(uuid) to authenticated, service_role;
