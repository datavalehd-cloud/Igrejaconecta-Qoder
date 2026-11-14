-- ============================================================================
-- 0018 — Suporte: tickets e mensagens
--
-- `/admin/suporte` dizia "Suporte ainda não existe". Passa a existir como
-- conversa entre quem abriu o chamado e a plataforma, com as duas tabelas que
-- uma caixa de suporte precisa — nada de "inbox" decorativa.
--
-- Decisões, e o porquê:
--
-- 1) **Quem abre, vê; quem é da igreja, vê o da própria igreja; SuperAdmin
--    vê tudo.** Isso é material: um chamado de igrejas costuma trazer prints,
--    nomes e reclamações de terceiros. Um membro comum de A não pode ler o
--    ticket de B, mas o administrador da igreja que é assunto do ticket precisa
--    acompanhe o assunto — mas **só quem gerencia a igreja** (`church.manage`),
--    não qualquer membro: um print com reclamação de terceiro não circula pela
--    igreja inteira. As três regras moram numa função só, `can_read_ticket`,
--    porque `support_messages` precisa da MESMA resposta sem poder consultar
--    `support_tickets` sob RLS dentro da própria política (recursão de política é
--    exatamente o que se quer evitar).
--
-- 2) **`can_read_ticket` é `security definer`**, no mesmo pé de
--    `current_church_ids()` e `has_church_permission()`: ela lê o autor e a
--    igreja do ticket com os direitos do dono, mas devolve apenas um booleano
--    calculado sobre `auth.uid()`. Não expõe linha nenhuma por si só.
--
-- 3) **Não existe delete de ticket nem de mensagem.** Suporte é trilha: se
--    errar apaga-se a evidência. Fecha-se (`status = 'closed'`) por quem abriu
--    ou pelo SuperAdmin. `anon` não tem grant nenhum, então abrir chamado exige
--    conta — decisão consciente: ticket anônimo não tem para quem responder.
--
-- 4) **`status` não é campo livre**: `open` / `answered` / `closed`, e só
--    autor e SuperAdmin mudam. Quem respondeu (SuperAdmin) marca `answered` na
--    mesma escrita da mensagem, no serviço — não no banco, porque o banco não
--    sabe quem é o atendente.
--
-- 5) `church_id` é nullable e `on delete set null`: chamado de visitante sem
--    igreja existe, e apagar uma igreja não apaga o histórico de suporte.
-- ============================================================================

create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid references public.churches (id) on delete set null,
  opened_by  uuid not null references public.profiles (id) on delete cascade,
  subject    text not null check (char_length(btrim(subject)) between 3 and 200),
  status     text not null default 'open'
               check (status in ('open','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_church_idx on public.support_tickets (church_id);
create index if not exists support_tickets_opened_by_idx on public.support_tickets (opened_by);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

drop trigger if exists trg_support_tickets_updated on public.support_tickets;
create trigger trg_support_tickets_updated before update on public.support_tickets
  for each row execute function public.touch_updated_at();

-- A regra de leitura, uma vez só, para as duas tabelas. ----------------------
create or replace function public.can_read_ticket(p_ticket uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.support_tickets t
    where t.id = p_ticket
      and (
        t.opened_by = auth.uid()
        or public.is_superadmin()
        or (t.church_id is not null and public.has_church_permission(t.church_id, 'church.manage'))
      )
  );
$$;

-- O ticket com a última mensagem e a contagem real de respostas. -------------
create or replace view public.support_ticket_list
with (security_invoker = false)
as
select
  t.id,
  t.church_id,
  t.opened_by,
  o.full_name as opened_by_name,
  c.name       as church_name,
  t.subject,
  t.status,
  t.created_at,
  t.updated_at,
  (select count(*)::int from public.support_messages m where m.ticket_id = t.id) as messages_count,
  (select m.body from public.support_messages m
    where m.ticket_id = t.id order by m.created_at desc, m.id desc limit 1) as last_message
from public.support_tickets t
left join public.profiles o on o.id = t.opened_by
left join public.churches c on c.id = t.church_id
where t.opened_by = auth.uid()
   or public.is_superadmin()
   or (t.church_id is not null and public.has_church_permission(t.church_id, 'church.manage'));

alter view public.support_ticket_list owner to postgres;
revoke all on public.support_ticket_list from anon;
grant select on public.support_ticket_list to authenticated;

-- RLS ------------------------------------------------------------------------
alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;

grant select, insert, update on public.support_tickets to authenticated;
grant select, insert on public.support_messages to authenticated;

drop policy if exists support_tickets_read on public.support_tickets;
create policy support_tickets_read on public.support_tickets
  for select to authenticated
  using (
    opened_by = auth.uid()
    or public.is_superadmin()
    or (church_id is not null and public.has_church_permission(church_id, 'church.manage'))
  );

-- Abrir chamado: o autor é quem está logado, e a igreja do assunto tem de ser a
-- igreja dele (ou nenhuma). Sem isso, qualquer um abre ticket "sobre" a igreja
-- do vizinho e a leitura por igreja faria isso vazar.
drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (
    opened_by = auth.uid()
    and (church_id is null or church_id in (select public.current_church_ids()))
  );

-- Fechar/reativar: autor e SuperAdmin. O autor não reabre assunto alheio porque
-- a cláusula USING já é a condição de leitura da própria linha.
drop policy if exists support_tickets_update on public.support_tickets;
create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (opened_by = auth.uid() or public.is_superadmin())
  with check (opened_by = auth.uid() or public.is_superadmin());

drop policy if exists support_messages_read on public.support_messages;
create policy support_messages_read on public.support_messages
  for select to authenticated
  using (public.can_read_ticket(ticket_id));

drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_read_ticket(ticket_id)
  );
