-- ============================================================================
-- Bundle da Rodada K — 0024 (events.video_url) + 0025 (delete de filial)
-- Projeto real: dlucvyjxidrfyjwuouvp — colar INTEIRO no SQL Editor e executar.
-- Ordem das partes fixa: 0024 antes de 0025 (a segunda não depende da
-- primeira, mas é a ordem das migrações no repositório). As duas são
-- idempotentes: add column if not exists / drop constraint|policy if exists /
-- grant aditivo. Rodar de novo não duplica nada.
-- O bloco final é SOMENTE LEITURA: confere os três objetos criados.
-- ============================================================================

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


-- ============================================================================
-- 0025 — Excluir filial (church_branches: grant + política de delete)
--
-- A 0013 (decisão 3) fechou o delete de propósito e escreveu o contrato para
-- reabri-lo: "se um dia a tela oferecer 'excluir filial', as duas camadas têm
-- de ser abertas de propósito, com caso na suíte". É o que acontece aqui, a
-- pedido da auditoria de lacunas (grupo 4).
--
-- Decisões, e o porquê:
--
-- 1) **`church.manage`, a mesma régua de quem cadastra e edita.** Filial é
--    dado de cadastro da igreja (decisão 2 da 0013); excluir não é uma
--    operação de poder diferente de editar. Nenhuma permissão nova nasce aqui,
--    e `has_church_permission` já traz o SuperAdmin no bojo (0001) — a mesma
--    razão pela qual insert/update não precisam de ramo `is_superadmin()`.
--
-- 2) **`using` sem `with check`.** Delete não produz valor novo; a única
--    pergunta é se a linha alcançável é administrável por quem pede. Quem é de
--    fora não alcança a linha pela política e o comando devolve **zero linhas**
--    — sem erro e sem oráculo de existência, o mesmo comportamento do UPDATE
--    cruzado medido no caso O5.
--
-- 3) **Excluir filial não apaga nada junto**, e isso não é uma promessa vazia:
--    são as FKs que já existem. `events.branch_id` (0013) e
--    `church_service_times.branch_id` (0023) são `on delete set null` — os
--    eventos e horários sobrevivem como "sem filial". O caminho contrário
--    (apagar os eventos junto) destruiria inscrições reais para corrigir um
--    cadastro, e por isso a 0013 escolheu set null na origem. A UI avisa isso
--    antes de confirmar; o caso O11 da suíte mede.
--
-- 4) **Grant re-declarado por inteiro** (`select, insert, update, delete`)
--    porque `grant` é aditivo e idempotente — reescrever a lista deixa a
--    migração relável em uma leitura só, sem depender do estado anterior.
--
-- 5) O `church_id in (select current_church_ids())` da política de leitura não
--    serve de guarda de delete: quem é **membro** lê filiais, quem **administra**
--    apaga. São conjuntos diferentes de propósito (O4 mede a leitura sem
--    escrita), e a política de delete usa só o segundo.
-- ============================================================================

revoke all on public.church_branches from anon, authenticated;
grant select, insert, update, delete on public.church_branches to authenticated;

drop policy if exists church_branches_delete on public.church_branches;
create policy church_branches_delete on public.church_branches
  for delete to authenticated
  using (public.has_church_permission(church_id, 'church.manage'));


-- ============================================================================
-- Conferência (leitura; a saída aparece no próprio editor):
-- 1 linha em cada bloco = aplicado.
-- ============================================================================

-- 1) CHECK do vídeo presente e com as três formas:
select pg_get_constraintdef(oid) as video_shape
from pg_constraint
where conname = 'events_video_url_shape' and contype = 'c';

-- 2) política DELETE de filial na régua church.manage:
select policyname, cmd, qual
from pg_policies
where tablename = 'church_branches' and cmd = 'DELETE';

-- 3) grant de delete: authenticated sim, anon não:
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'church_branches'
  and grantee in ('anon', 'authenticated')
  and privilege_type = 'DELETE'
order by grantee;
