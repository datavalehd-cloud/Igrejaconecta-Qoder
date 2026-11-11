-- ============================================================================
-- IgrejaConecta — Fase 2: Buckets de Storage e políticas de acesso
-- Buckets: church-logos, church-covers (públicos para leitura);
--          church-documents, church-gallery (restritos à igreja).
-- ============================================================================

insert into storage.buckets (id, name, public) values
  ('church-logos',     'church-logos',     true),
  ('church-covers',    'church-covers',    true),
  ('church-documents', 'church-documents', false),
  ('church-gallery',   'church-gallery',   false)
on conflict (id) do nothing;

-- Leitura pública de logos e capas
drop policy if exists "public_read_logos" on storage.objects;
create policy "public_read_logos" on storage.objects
  for select using (bucket_id in ('church-logos', 'church-covers'));

-- Upload: usuário autenticado, dentro de uma pasta com o id da igreja à qual pertence
drop policy if exists "members_upload" on storage.objects;
create policy "members_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('church-logos','church-covers','church-gallery','church-documents')
    and (storage.foldername(name))[1] in (select public.current_church_ids()::text)
  );

-- Leitura restrita (documentos/galeria): membros da própria igreja ou SuperAdmin
drop policy if exists "members_read_private" on storage.objects;
create policy "members_read_private" on storage.objects
  for select using (
    public.is_superadmin()
    or (storage.foldername(name))[1] in (select public.current_church_ids()::text)
  );
