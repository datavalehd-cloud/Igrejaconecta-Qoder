-- ============================================================================
-- 0019 — Eventos de segurança reais (o painel de alertas deixa de ser enfeite)
--
-- `AdminSettingsPage` tinha "Alertas de tentativas suspeitas — Não conectado" e
-- `AdminLogsPage` exibia linhas fictícias do mock. Não havia onde anotar uma
-- recusa. Esta migração cria o registro e a RPC que o escreve.
--
-- Decisões, e o porquê:
--
-- 1) **Tabela separada de `audit_logs`, de propósito.** A 0010 fechou o insert
--    manual em `audit_logs` com uma marca de transação que só o trigger da 0009
--    liga, e o documento da migração diz explicitamente que "não há RPC que chame
--    set_config" — é isso que torna o caminho inviável pela API. Criar uma RPC
--    que ligasse essa marca reabriria exatamente o buraco que a 0010 fechou.
--    Então o sinal de recusa mora numa tabela própria, com forma restrita, e
--    `audit_logs` continua intocável pelo app.
--
-- 2) **Só dois tipos, e cada um tem um ponto de chamada real no app:**
--    `permission_denied` — uma escrita devolveu `42501` (a RLS disse não);
--    `publish_denied` — tentaram marcar publicação/conexão de rede sem o
--    provedor ter confirmado (gatilho 0014/0015). Tipos livres virariam
--    classificação subjetiva sem regra nenhuma.
--
-- 3) **Ninguém escreve pela API, nem SuperAdmin:** `revoke all ... from
--    authenticated` e o insert acontece só dentro de `log_security_event`,
--    `security definer`, que grava `actor_id = auth.uid()` e recusa tipo
--    desconhecido com `22023`. O app chama depois de levar a recusa; quem não
--    chamou não apaga nem reescreve o que outro chamou.
--
-- 4) **Leitura é do SuperAdmin** (as duas views e a tabela). Uma recusa de
--   escrita numa igreja não se torna visível para a própria igreja: é dado de
--    monitoramento da plataforma, e a projeção traz nome do autor só para quem já
--    vê o diretório global de usuários.
--
-- 5) O sinal tem limite, e está dito: ele só existe para recusa que o app
--    percebe. Um ataque direto ao PostgREST que a RLS derruba não passa por
--    nenhuma dessas rotas, e nada aqui finge ver o que não foi registrado.
-- ============================================================================

create table if not exists public.security_events (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles (id) on delete set null,
  kind       text not null
               check (kind in ('permission_denied','publish_denied')),
  target     text,
  church_id  uuid references public.churches (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists security_events_created_idx on public.security_events (created_at desc);
create index if not exists security_events_kind_idx on public.security_events (kind, created_at desc);

-- A única porta de entrada. -------------------------------------------------
create or replace function public.log_security_event(p_kind text, p_target text, p_church uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_kind is null or p_kind not in ('permission_denied','publish_denied') then
    raise exception 'tipo de evento de seguranca invalido'
      using errcode = '22023';
  end if;

  insert into public.security_events (actor_id, kind, target, church_id)
  values (auth.uid(), p_kind, nullif(btrim(coalesce(p_target, '')), ''), p_church);
end;
$$;

revoke all on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

revoke all on function public.log_security_event(text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_security_event(text, text, uuid) to authenticated;

alter table public.security_events enable row level security;

drop policy if exists security_events_read on public.security_events;
create policy security_events_read on public.security_events
  for select to authenticated
  using (public.is_superadmin());

-- Contagem por tipo, nas janelas que a tela mostra. -------------------------
create or replace view public.security_event_summary
with (security_invoker = false)
as
select
  k.kind,
  count(se.id) filter (where se.created_at > now() - interval '24 hours')::int as last_24h,
  count(se.id) filter (where se.created_at > now() - interval '7 days')::int   as last_7d,
  count(se.id)::int                                                             as total,
  max(se.created_at)                                                            as last_at
from (values ('permission_denied'),('publish_denied')) as k(kind)
left join public.security_events se on se.kind = k.kind
where public.is_superadmin()
group by k.kind;

alter view public.security_event_summary owner to postgres;
revoke all on public.security_event_summary from anon;
grant select on public.security_event_summary to authenticated;

-- Os últimos acontecimentos, com nome de quem tentou. ----------------------
create or replace view public.security_event_log
with (security_invoker = false)
as
select
  se.id,
  se.kind,
  se.target,
  se.church_id,
  c.name as church_name,
  se.actor_id,
  p.full_name as actor_name,
  p.email     as actor_email,
  se.created_at
from public.security_events se
left join public.profiles p on p.id = se.actor_id
left join public.churches c on c.id = se.church_id
where public.is_superadmin()
order by se.created_at desc
limit 200;

alter view public.security_event_log owner to postgres;
revoke all on public.security_event_log from anon;
grant select on public.security_event_log to authenticated;
