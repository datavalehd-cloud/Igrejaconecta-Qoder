-- ============================================================================
-- 0016 — Favoritos e preferências do visitante
--
-- `/visitante/perfil` era a tela mais fingida do app: o botão "Salvar
-- preferências" só ligava um `useState` e mostrava "Preferências salvas (demo)",
-- e "Meus favoritos" listava os dois primeiros eventos publicados do mock — ou
-- seja, favorito nenhum era de ninguém. Aqui as duas coisas ganham tabela.
--
-- Decisões, e o porquê:
--
-- 1) **Tudo é do próprio visitante.** A chave de acesso é `user_id = auth.uid()`
--    nas duas tabelas, em todas as operações, inclusive no WITH CHECK: ninguém
--    escreve na lista de outra pessoa, e `anon` não tem grant nenhum. O histórico
--    de inscrições do visitante já era real por esse mesmo caminho
--    (`event_registrations_read`, 0012, tem `user_id = auth.uid()`); é dele que a
--    tela passa a ler.
--
-- 2) **Sem conta, sem favorito.** A tela continua aberta a quem não entrou, mas o
--    botão vira "entre para salvar" — não existe favoritos anônimo, e fingir um
--    com `localStorage` seria mais uma coisa na tela que não é verdade.
--
-- 3) `interests` é `text[]` com CHECK de contenção sobre os interesses que a
--    tela oferece, nos mesmos códigos da UI. Uma lista livre viraria campo de
--    texto sem uso nenhum (nenhuma triagem por interesse existe no app).
--
-- 4) **A RLS não confere se o evento favorecido está publicado.** Conferia via
--    subquery em política, mas o app é o único que escreve aqui e ele só mostra o
--    que a `events_public_read` devolve: um evento que saiu do ar some da lista
--    junto, sem linha órfã na tela. O limite está registrado de propósito — a
--    leitura nunca expõe evento não publicado, mesmo se a linha sobreviver.
--
-- 5) `city` é dado de preferência, não endereço de cadastro: sem coluna nova em
--    `profiles` (que é de identidade) e sem LGPD de mais — é o que a própria tela
--    pergunta.
-- ============================================================================

create table if not exists public.visitor_favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.visitor_preferences (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  city       text check (city is null or char_length(btrim(city)) <= 80),
  interests  text[] not null default '{}'
               check (interests <@ array['jovens','familia','mulheres','homens','acao_social']::text[]),
  updated_at timestamptz not null default now()
);

create index if not exists visitor_favorites_event_idx on public.visitor_favorites (event_id);

drop trigger if exists trg_visitor_preferences_updated on public.visitor_preferences;
create trigger trg_visitor_preferences_updated before update on public.visitor_preferences
  for each row execute function public.touch_updated_at();

-- RLS ------------------------------------------------------------------------
alter table public.visitor_favorites   enable row level security;
alter table public.visitor_preferences enable row level security;

revoke all on public.visitor_favorites from anon, authenticated;
revoke all on public.visitor_preferences from anon, authenticated;

grant select, insert, delete on public.visitor_favorites to authenticated;
grant select, insert, update on public.visitor_preferences to authenticated;

drop policy if exists visitor_favorites_self on public.visitor_favorites;
create policy visitor_favorites_self on public.visitor_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists visitor_preferences_self_read on public.visitor_preferences;
create policy visitor_preferences_self_read on public.visitor_preferences
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists visitor_preferences_self_write on public.visitor_preferences;
create policy visitor_preferences_self_write on public.visitor_preferences
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists visitor_preferences_self_update on public.visitor_preferences;
create policy visitor_preferences_self_update on public.visitor_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
