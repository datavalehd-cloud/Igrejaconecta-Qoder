-- ============================================================================
-- 0024 — Vídeo promocional do evento (events.video_url)
--
-- O formulário de eventos tinha um campo "Vídeo (YouTube/Vimeo)" desabilitado
-- com o aviso "sem coluna na tabela: não é gravado". A coluna entra aqui, e o
-- campo passa a gravar de verdade.
--
-- Decisões, e o porquê:
--
-- 1) **Coluna em `events`, não tabela de mídia.** É um link por evento, com a
--    mesma vida do evento. Uma tabela `event_media` seria infraestrutura para
--    uma galeria que ninguém pediu — a capa já vive em `cover_url` pelo mesmo
--    motivo.
--
-- 2) **CHECK por host, não URL livre.** O rótulo do campo diz YouTube/Vimeo, e
--    é isso que o tocador da página pública sabe montar. URL livre abriria
--    espaço para `javascript:`, domínios de rastreamento e hospedagem alheia —
--    a tela nunca combinou de tocar vídeo de outro lugar. O CHECK aceita as
--    formas canônicas dos dois serviços; o app normaliza o que a pessoa cola
--    antes de gravar (utils/video.ts), então o valor armazenado é sempre uma
--    das três formas: watch do YouTube, youtu.be ou vimeo.com/<número>.
--
-- 3) **Leitura vai à projeção pública.** O sentido da coluna é o visitante ver
--    o vídeo; sem `video_url` em `EVENTS_PUBLIC_COLUMNS` ela só existiria para
--    quem edita. A cerca continua sendo a política de linha de `events` (0011):
--    rascunho, cancelado e igreja fora do ar não aparecem para `anon` — os
--    casos M1/M4 já medem isso, e o vídeo mora na mesma linha.
--
-- 4) **Nenhuma permissão nova, nenhum trigger novo.** Escrever vídeo é escrever
--    o resto do formulário: `events.manage` na linha da própria igreja (0011),
--    e publicar continua passando pelo `trg_events_publish`. Vídeo não é dado
--    de identidade nem de localização; não há checagem cruzada a fazer.
--
-- 5) **Opcional e sem cascata.** `text` anulável, blank vira null no app. Sem
--    FK, sem delete: apagar o evento leva a linha inteira, como sempre.
-- ============================================================================

-- `add column if not exists` é idempotente; o CHECK entra por separado para
-- poder ser re-declarado sem recriar a coluna (o estilo é o do 0013 com lat/lng).
alter table public.events add column if not exists video_url text;

alter table public.events drop constraint if exists events_video_url_shape;
alter table public.events
  add constraint events_video_url_shape check (
    video_url is null
    or video_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{6,}$'
    or video_url ~ '^https://youtu\.be/[A-Za-z0-9_-]{6,}$'
    or video_url ~ '^https://vimeo\.com/[0-9]+$'
  );
