-- ============================================================================
-- 0013 — Filiais e localização (Fase 4)
--
-- Duas coisas entram aqui: a tabela `church_branches` e as colunas de localização
-- do evento (`branch_id`, `latitude`, `longitude`). As coordenadas das igrejas já
-- existiam desde a 0001 (`churches.lat` / `churches.lng`) e nunca foram usadas.
--
-- Decisões, e o porquê de cada uma:
--
-- 1) Filial é dado de **gestão**, não de vitrine. A leitura vale para quem é
--    membro ativo da própria igreja e para o SuperAdmin; `anon` não recebe grant
--    nenhum. O mapa público plota **igrejas** (lat/lng de `churches`), não filiais:
--    publicar a lista de congregações de uma igreja é decisão dela, não nossa, e
--    ninguém pediu isso nesta fase.
--
-- 2) Escrever exige `church.manage` — administrador da igreja ou SuperAdmin.
--    Gerente, comunicador e pastor cadastram eventos, não endereços da igreja.
--
-- 3) **Não há política de delete** e o grant de `authenticated` não inclui delete.
--    Excluir filial não está exposto na UI; se um dia estiver, as duas camadas têm
--    de ser abertas de propósito, com caso na suíte. `events.branch_id` é
--    `on delete set null` para o caminho do `service_role` (backend) não deixar o
--    evento apontando para uma filial que não existe — apagar o evento é pior.
--
-- 4) `events.branch_id` tem de ser da **mesma igreja** do evento. Sem isso um
--    administrador poderia vincular o evento a uma filial alheia e a tela passaria
--    a exibir um endereço de outra igreja. O trigger devolve **uma** mensagem para
--    "não existe" e para "é de outra igreja": sem oráculo de existência.
--
--    Ele é `SECURITY DEFINER` como `enforce_registration_church` (0012), mas aqui
--    a razão é outra e vale registrar para ninguém inventar uma que não existe:
--    hoje quem escreve evento (`events.manage`) é necessariamente membro ativo da
--    mesma igreja ou SuperAdmin, e portanto já lê as filiais dela — trocar DEFINER
--    por INVOKER não muda comportamento nenhum, e o grupo O **não** consegue
--    medir essa diferença. O que o DEFINER compra é independência: se um dia a
--    leitura de filiais for endurecida (só administrador, por exemplo), a
--    checagem continua valendo. O caso O10 trava a decisão estruturalmente.
--
-- 5) Coordenadas são opcionais e validadas por CHECK. Não há geocodificação: quem
--    cadastra usa o GPS do navegador (botão "usar minha localização") ou digita.
--    Endereço sem coordenada é honesto — o mapa diz que a igreja não está plotada
--    em vez de inventar posição.
--
-- 6) `leader` é texto, não FK para `profiles`: o responsável por uma congregação
--    pode não ter conta na plataforma, e obrigar a conta criaria usuário fantasma.
--
-- 7) `churches.lat`/`lng` existiam desde a 0001 sem validação nenhuma. O mapa da
--    Fase 4 passa a consumi-los, e coordenada fora do intervalo não é um erro
--    visível: é um pino no meio do oceano. Recebem o mesmo CHECK de eventos e
--    filiais para que as três origens de coordenada tenham a mesma regra.
-- ============================================================================

alter table public.churches drop constraint if exists churches_lat_range;
alter table public.churches
  add constraint churches_lat_range check (lat is null or (lat >= -90 and lat <= 90));
alter table public.churches drop constraint if exists churches_lng_range;
alter table public.churches
  add constraint churches_lng_range check (lng is null or (lng >= -180 and lng <= 180));

create table if not exists public.church_branches (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches (id) on delete cascade,
  name        text not null,
  address     text,
  city        text,
  state       text,
  lat         double precision check (lat is null or (lat >= -90 and lat <= 90)),
  lng         double precision check (lng is null or (lng >= -180 and lng <= 180)),
  leader      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists church_branches_church_idx on public.church_branches (church_id);

drop trigger if exists trg_church_branches_updated on public.church_branches;
create trigger trg_church_branches_updated before update on public.church_branches
  for each row execute function public.touch_updated_at();

-- Localização do evento --------------------------------------------------------
alter table public.events
  add column if not exists branch_id uuid references public.church_branches (id) on delete set null,
  add column if not exists latitude double precision check (latitude is null or (latitude >= -90 and latitude <= 90)),
  add column if not exists longitude double precision check (longitude is null or (longitude >= -180 and longitude <= 180));

create index if not exists events_branch_idx on public.events (branch_id);

-- A filial do evento é da mesma igreja -----------------------------------------
create or replace function public.enforce_event_branch()
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
    raise exception 'a filial do evento precisa ser da mesma igreja'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_events_branch on public.events;
create trigger trg_events_branch
  before insert or update of branch_id, church_id on public.events
  for each row execute function public.enforce_event_branch();

-- `from public` sozinho não basta: o Supabase (e o shim local) concedem EXECUTE
-- por *default privileges* a anon/authenticated/service_role, então cada função
-- nova já nasce executável por eles. Listar os papéis é o que fecha de verdade.
-- É higiene, não barreira — função de trigger não pode ser chamada diretamente.
revoke execute on function public.enforce_event_branch() from public, anon, authenticated;

-- RLS ------------------------------------------------------------------------
alter table public.church_branches enable row level security;

revoke all on public.church_branches from anon, authenticated;
grant select, insert, update on public.church_branches to authenticated;

drop policy if exists church_branches_read on public.church_branches;
create policy church_branches_read on public.church_branches
  for select to authenticated using (
    public.is_superadmin()
    or church_id in (select public.current_church_ids())
  );

drop policy if exists church_branches_insert on public.church_branches;
create policy church_branches_insert on public.church_branches
  for insert to authenticated
  with check (public.has_church_permission(church_id, 'church.manage'));

-- WITH CHECK também — mas vale dizer o que ele cobre, porque não é a única
-- barreira contra transferir filial de igreja. Num UPDATE o Postgres exige que a
-- linha nova satisfaça também as políticas de SELECT da tabela, então quem não
-- lê filial da outra igreja já é barrado pela leitura antes de chegar aqui. O
-- WITH CHECK cobre o caso que a leitura deixa passar: quem é membro ativo das
-- duas igrejas e só administra uma. É o bloco do `ab` no caso O5 da suíte.
drop policy if exists church_branches_update on public.church_branches;
create policy church_branches_update on public.church_branches
  for update to authenticated
  using (public.has_church_permission(church_id, 'church.manage'))
  with check (public.has_church_permission(church_id, 'church.manage'));
