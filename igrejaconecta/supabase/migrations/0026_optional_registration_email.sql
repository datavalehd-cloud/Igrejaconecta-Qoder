-- ============================================================================
-- IgrejaConecta — e-mail opcional na inscrição do visitante
--
-- O pedido: na tela de inscrição (`/eventos/:slug`, "Confirmar inscrição") o
-- e-mail era obrigatório; passa a ser opcional. O campo continua validando o
-- formato quando preenchido — opcional não quer dizer "sem regra", quer dizer
-- "pode ficar em branco".
--
-- Decisões:
--
-- 1) `visitor_email` perde o NOT NULL. Guardar string vazia seria pior: o índice
--    único parcial `uq_registration_active (event_id, lower(visitor_email))` da
--    0012 tratá-la-ia como chave, então a segunda pessoa sem e-mail do mesmo
--    evento apanharia `ja_inscrita` falsa. Com NULL, o Postgres considera valores
--    nulos distintos no índice único: cada inscrição sem e-mail é sua própria
--    linha, e a anti-duplicidade por e-mail segue valendo para quem informa.
--
-- 2) A deduplicação por e-mail é a única âncora do visitante anon — sem login, o
--    `user_id` fica nulo (0012) e sem e-mail não há como dizer "já me inscrevi".
--    Isso é aceitável: o produto nunca devolve ingresso ao anon (`ticket_code` fica
--    com a equipe), e quem se inscreve sem conta já não tinha como recuperar a
--    linha. Fazer o e-mail obrigatório para proteger a dedupe seria cobrar dado
--    pessoal de quem só quer garantir vaga.
--
-- 3) A assinatura de `register_for_event` (uuid, text, text, text) não muda: só o
--    corpo. Trocar o tipo ou a ordem dos argumentos criaria uma função sobrecarregada
--    nova e deixaria a antiga viva — os `grant`/`revoke` da 0012, que os testes de
--    contrato leem, continuariam apontando para a versão que recusa e-mail vazio.
--    `CREATE OR REPLACE` com a mesma lista de argumentos substitui no lugar.
--
-- 4) A validação fica em duas camadas e as duas batem com o que o HTML já faz:
--    e-mail em branco passa; e-mail preenchido sem `@` cai em `dados_invalidos`.
--    O `type="email"` do formulário já bloqueia formato inválido no navegador,
--    mas a RPC é a guarda real (o formulário é só a primeira camada).
--
-- Reversível: `alter table ... alter column visitor_email set not null` volta atrás
-- desde que não exista linha com e-mail nulo; este arquivo só relaxa, não apaga.
-- ============================================================================

alter table public.event_registrations
  alter column visitor_email drop not null;

-- Redefinição de `register_for_event` com a mesma assinatura da 0012. -----------
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
  email_norm text;
begin
  if p_name is null or length(trim(p_name)) < 2 then
    return 'dados_invalidos';
  end if;

  -- e-mail opcional: vira NULL quando em branco; se preenchido, exige o '@'.
  email_norm := nullif(lower(trim(coalesce(p_email, ''))), '');
  if email_norm is not null and position('@' in email_norm) = 0 then
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

  -- sem e-mail não há chave para dizer "já inscrito"; a duplicidade só se aplica
  -- a quem informou endereço.
  if email_norm is not null and exists (
    select 1 from public.event_registrations r
    where r.event_id = ev.id
      and lower(r.visitor_email) = email_norm
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
        (ev.id, ev.church_id, profile_id, trim(p_name), email_norm,
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
