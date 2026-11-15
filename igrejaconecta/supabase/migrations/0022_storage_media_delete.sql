-- ============================================================================
-- 0022 — Trocar e remover imagem: DELETE de objeto na pasta da própria igreja
--
-- A 0003 criou `members_upload` (INSERT) e as duas políticas de leitura, mas
-- nenhuma de DELETE. Enquanto nada era enviado isso não aparecia; com o upload
-- de capa de evento e de logo/capa da igreja (M4) aparece de dois modos:
--
-- 1) substituir a imagem deixaria o arquivo anterior público para sempre —
--    órfão, com URL previsível e sem linha nenhuma no banco apontando para ele;
-- 2) "remover a capa" não existiria, então a tela teria de oferecer um botão
--    que não faz nada — e oferta sem função é o que este projeto não mostra.
--
-- Decisões, e o porquê:
--
-- * **Só os dois buckets públicos** (`church-logos`, `church-covers`). Documento
--   e galeria são trilha da igreja (ata, foto de culto): apagar isso não é
--   manutenção de imagem institucional e não entra aqui. O bucket vem do código
--   do serviço, nunca do usuário.
-- * **Pasta = uuid da igreja**, a mesma régua do INSERT: um membro não apaga
--   imagem de outra igreja, e quem não tem vínculo ativo não apaga nada
--   (`current_church_ids()` só devolve vínculo `active`).
-- * **`to authenticated`**: `anon` não apaga objeto nem na hipótese de a
--   expressão da pasta casar por engano. O ramo `is_superadmin()` acompanha
--   `members_read_private` — a plataforma precisa conseguir limpar o que uma
--   igreja deixou para trás.
-- * DELETE usa `USING`, não `WITH CHECK`: aqui não existe "valor novo" para
--   conferir, só a linha que some.
--
-- A leitura já existia (`public_read_logos` vale para `roles=public`), então o
-- `remove()` da API do Storage — que seleciona antes de apagar — enxerga a linha.
-- Provado nos casos D4..D7 da suíte de isolamento.
-- ============================================================================

drop policy if exists "members_delete_public_media" on storage.objects;
create policy "members_delete_public_media" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('church-logos', 'church-covers')
    and (
      public.is_superadmin()
      or (storage.foldername(name))[1] in (select public.current_church_ids()::text)
    )
  );
