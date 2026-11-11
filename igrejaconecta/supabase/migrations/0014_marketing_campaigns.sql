-- ============================================================================
-- 0014 — Campanhas de divulgação (Fase 5)
--
-- Uma tabela nova, `marketing_campaigns`, e uma guarda de publicação. O escopo é
-- deliberadamente o que dá para ser real sem chave nem backend: a campanha em si
-- (rascunho, conteúdo preparado, redes alvo, agendamento) grava no banco com RLS;
-- a **postagem** numa rede não existe aqui e não é fingida.
--
-- Decisões, e o porquê de cada uma:
--
-- 1) Campanha é dado de **gestão**, privado da igreja — não é vitrine. `anon` não
--    recebe grant nenhum (a recusa acontece antes da RLS). Ler e escrever exige
--    `marketing.manage`: SuperAdmin, administrador da igreja, gerente e comunicador.
--    Pastor não tem `marketing.manage` (rbac e seed), então não vê campanha — é a
--    mesma audiência que a rota `/app/marketing` já exige.
--
-- 2) **Postar em rede exige OAuth + backend + tokens** (Meta Graph, TikTok Content
--    Posting, WhatsApp Cloud). Nada disso existe neste ambiente, e segredo nenhum
--    passa pelo app. Por isso o trigger `enforce_campaign_publish` só deixa
--    `service_role` marcar `status = 'published'` (ou `'failed'`): é o papel de um
--    backend real que acabou de confirmar com o provedor. Pelo `authenticated` a
--    transição é recusada com `42501` — nenhuma campanha nasce "publicada" sem
--    confirmação real. O frontend nem tenta: `publishCampaign` devolve "não
--    conectado" sem escrever. É o espelho, no banco, da regra de só mostrar estado
--    confirmado pelo provedor.
--
-- 3) **Não há política de delete** e o grant de `authenticated` não inclui delete,
--    como em `church_branches` (0013). Campanha é **cancelada** (`status =
--    'cancelled'`), não apagada. `event_id` é `on delete set null` (apagar o evento
--    não deve apagar o histórico de divulgação); `church_id` é `on delete cascade`.
--
-- 4) `networks` é `text[]` com CHECK de contenção: só os quatro canais que a tela
--    conhece. A distribuição **sem chave** (link de WhatsApp, link copiado, UTM,
--    Web Share) é calculada na tela a partir do evento/igreja — não é gravada, e
--    não depende de provedor nenhum.
--
-- 5) `created_by` existe para trilha futura, mas **não é projetado** pelo serviço
--    (como `churches.created_by`): o uuid de quem criou não precisa chegar à lista.
--
-- 6) `message` é o conteúdo preparado. Open Graph/SEO por evento exigiria
--    prerender/SSR (o app é SPA) — fica fora desta migração e está dito no README.
-- ============================================================================

create table if not exists public.marketing_campaigns (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references public.churches (id) on delete cascade,
  event_id      uuid references public.events (id) on delete set null,
  name          text not null,
  message       text,
  networks      text[] not null default '{}'
                  check (networks <@ array['instagram','facebook','tiktok','whatsapp']::text[]),
  status        text not null default 'draft'
                  check (status in ('draft','scheduled','published','failed','cancelled')),
  scheduled_for timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists marketing_campaigns_church_idx on public.marketing_campaigns (church_id);
create index if not exists marketing_campaigns_event_idx on public.marketing_campaigns (event_id);

drop trigger if exists trg_marketing_campaigns_updated on public.marketing_campaigns;
create trigger trg_marketing_campaigns_updated before update on public.marketing_campaigns
  for each row execute function public.touch_updated_at();

-- Publicar só com confirmação real do provedor --------------------------------
create or replace function public.enforce_campaign_publish()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- O backend (service_role) que acabou de falar com a plataforma é o único que
  -- pode marcar publicada/falhou. Pelo app, recusado: nada é fingido como enviado.
  if new.status in ('published', 'failed') and current_user <> 'service_role' then
    raise exception 'marcar campanha como publicada exige confirmacao real do provedor (backend)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_campaigns_publish on public.marketing_campaigns;
create trigger trg_campaigns_publish
  before insert or update of status on public.marketing_campaigns
  for each row execute function public.enforce_campaign_publish();

-- RLS ------------------------------------------------------------------------
alter table public.marketing_campaigns enable row level security;

revoke all on public.marketing_campaigns from anon, authenticated;
grant select, insert, update on public.marketing_campaigns to authenticated;

-- `has_church_permission` já embute `is_superadmin()`, então o SuperAdmin
-- atravessa igrejas nas três políticas sem cláusula extra.
drop policy if exists marketing_campaigns_read on public.marketing_campaigns;
create policy marketing_campaigns_read on public.marketing_campaigns
  for select to authenticated
  using (public.has_church_permission(church_id, 'marketing.manage'));

drop policy if exists marketing_campaigns_insert on public.marketing_campaigns;
create policy marketing_campaigns_insert on public.marketing_campaigns
  for insert to authenticated
  with check (public.has_church_permission(church_id, 'marketing.manage'));

-- WITH CHECK também: num UPDATE o Postgres já exige que a linha nova satisfaça as
-- políticas de SELECT, então quem não lê campanha da outra igreja é barrado antes.
-- O WITH CHECK cobre quem é membro das duas igrejas e só divulga uma.
drop policy if exists marketing_campaigns_update on public.marketing_campaigns;
create policy marketing_campaigns_update on public.marketing_campaigns
  for update to authenticated
  using (public.has_church_permission(church_id, 'marketing.manage'))
  with check (public.has_church_permission(church_id, 'marketing.manage'));
