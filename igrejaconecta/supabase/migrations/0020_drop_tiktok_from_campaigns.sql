-- ============================================================================
-- 0020 — TikTok fora das redes de campanha
--
-- Decisão do produto nesta rodada: das quatro redes que a 0014 aceitava, TikTok
-- sai. O motivo não é técnico — é que TikTok Content Posting API exige aprovação
-- do app pela plataforma, e enquanto essa aprovação não existe a opção na tela
-- seria uma escolha que nunca leva a lugar nenhum. Menos opção mentirosa na
-- interface, menos estado para explicar.
--
-- Como a migração é feita:
--
-- 1) **Troca do CHECK, não remoção.** O nome da constraint é o que o Postgres
--    derivou na 0014 (`marketing_campaigns_networks_check`); ela é derrubada e
--    recriada com os três canais que restam, `instagram`, `facebook` e
--    `whatsapp`. `if exists` porque quem aplica em banco novo já passa pela 0014
--    com a constraint antiga, e quem aplica em banco recriado precisa do mesmo
--    resultado.
--
-- 2) **Nenhuma linha é reescrita.** O banco do projeto real está vazio de
--    campanhas, e se houvesse linha com 'tiktok' a recriação da constraint já
--    falharia — que é o comportamento correto: a migração não apaga dado de
--    ninguém escondido num `alter table`.
--
-- 3) A tabela de perfis de rede (0015) também não tem 'tiktok' no CHECK dela,
--    então as duas superfícies concordam: o app não oferece, o banco não aceita.
-- ============================================================================

alter table public.marketing_campaigns
  drop constraint if exists marketing_campaigns_networks_check;

alter table public.marketing_campaigns
  add constraint marketing_campaigns_networks_check
  check (networks <@ array['instagram','facebook','whatsapp']::text[]);
