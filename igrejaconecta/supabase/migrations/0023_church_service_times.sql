-- ============================================================================
-- 0023 — Horários de culto da igreja (dados públicos do cadastro)
--
-- A tela `/app/horarios` era o último reduto do mock: mostrava uma lista semente
-- e os botões não gravavam em lugar nenhum, embora prometessem "aparecem no
-- perfil público e no mapa". Esta migração cria a tabela que cumpre a promessa.
--
-- Decisões, e o porquê:
--
-- 1) **Nenhuma permissão nova.** Horário é parte do cadastro público da igreja,
--    então a escrita é `church.manage` — a mesma régua de `church_social_accounts`
--    (0015) e de `church_branches` (0013). Criar chave em `permissions` exigiria
--    resemear papéis no projeto real; não é preciso.
--
-- 2) **A leitura é pública, com a cerca da vitrine.** `anon` lê só horários de
--    igreja `approved` + `active` — espelho exato de `churches_public_read`
--    (0002): o que o diretório e o mapa mostram, o visitante pode ler. Membro
--    ativo e SuperAdmin leem sempre (podem gerir antes da aprovação).
--
-- 3) **Dia e hora com tipo, não com texto livre.** `weekday` é smallint 0..6
--    (0 = domingo) e `starts_at` é `time`: a ordenação "domingo a sábado, manhã
--    a noite" sai do banco sem depender de rótulo em português, e não existe
--    "25:00" nem "Dominguu". O rótulo do dia é decisão de UI, fica no app.
--
-- 4) `branch_id`** é opcional e sobrevive à filial por `on delete set null:**
--    tirar a congregação do ar não apaga a memória do culto que ali acontecia.
--    O vínculo filial/igreja é o mesmo do evento: trigger de espelho
--    (`enforce_service_time_branch`, padrão de `enforce_event_branch`, 0013)
--    recusa filial de outra igreja com 42501.
--
-- 5) **Delete existe** (como ministério e perfil de rede): desfazer horário
--    cadastrado por engano é operação normal, e não há estado "cancelado" que
--    faça sentido aqui.
-- ============================================================================

create table if not exists public.church_service_times (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references public.churches (id) on delete cascade,
  branch_id  uuid references public.church_branches (id) on delete set null,
  weekday    smallint not null check (weekday between 0 and 6),
  starts_at  time not null,
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists church_service_times_church_idx on public.church_service_times (church_id, weekday, starts_at);

drop trigger if exists trg_church_service_times_updated on public.church_service_times;
create trigger trg_church_service_times_updated before update on public.church_service_times
  for each row execute function public.touch_updated_at();

-- A filial do horário é da mesma igreja --------------------------------------
-- Cópias a lógica de `enforce_event_branch` (0013) para cá. Sem o `security
-- definer` a função não conseguiria ler `church_branches` sendo chamada por um
-- insert comum (a leitura de filial é restrita a membros), e o trigger existe
-- justamente para o caminho de escrita normal.
create or replace function public.enforce_service_time_branch()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  branch_church uuid;
begin
  if new.branch_id is null then
    return new;
  end if;

  select church_id into branch_church from public.church_branches where id = new.branch_id;
  if branch_church is null or branch_church <> new.church_id then
    raise exception 'a filial do horario precisa ser da mesma igreja'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_church_service_times_branch on public.church_service_times;
create trigger trg_church_service_times_branch
  before insert or update of branch_id, church_id on public.church_service_times
  for each row execute function public.enforce_service_time_branch();

-- `from public` sozinho não basta: default privileges do Supabase (e do shim
-- local) já nascem executáveis por anon/authenticated/service_role.
revoke execute on function public.enforce_service_time_branch() from public, anon, authenticated;

-- RLS ------------------------------------------------------------------------
alter table public.church_service_times enable row level security;

revoke all on public.church_service_times from anon, authenticated;

-- A vitrine: anon lê, mas só o que `churches_public_read` deixaria ver.
grant select on public.church_service_times to anon;
grant select, insert, update, delete on public.church_service_times to authenticated;

drop policy if exists church_service_times_read on public.church_service_times;
create policy church_service_times_read on public.church_service_times
  for select using (
    public.is_superadmin()
    or church_id in (select public.current_church_ids())
    or church_id in (
      select id from public.churches
      where approval_status = 'approved' and status = 'active'
    )
  );

drop policy if exists church_service_times_insert on public.church_service_times;
create policy church_service_times_insert on public.church_service_times
  for insert to authenticated
  with check (public.has_church_permission(church_id, 'church.manage'));

drop policy if exists church_service_times_update on public.church_service_times;
create policy church_service_times_update on public.church_service_times
  for update to authenticated
  using (public.has_church_permission(church_id, 'church.manage'))
  with check (public.has_church_permission(church_id, 'church.manage'));

drop policy if exists church_service_times_delete on public.church_service_times;
create policy church_service_times_delete on public.church_service_times
  for delete to authenticated
  using (public.has_church_permission(church_id, 'church.manage'));
