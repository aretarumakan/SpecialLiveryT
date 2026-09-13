-- =============================================================================
-- 0002_storage.sql … 写真バケット livery-photos と Storage ポリシー
-- 0001_init.sql の後に実行する。
-- 詳細設計: docs/design-crowd-livery.md §2「Storage」
-- =============================================================================

-- public read / 1 ファイル 3MB / image/jpeg のみ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('livery-photos', 'livery-photos', true, 3145728, array['image/jpeg'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 3145728,
      allowed_mime_types = array['image/jpeg'];

-- -----------------------------------------------------------------------------
-- ポリシー（storage.objects は既定で RLS 有効）
-- name は "{auth.uid()}/{uuid}.jpg" の形。(storage.foldername(name))[1] が uid。
-- -----------------------------------------------------------------------------

drop policy if exists "livery-photos public read" on storage.objects;
create policy "livery-photos public read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'livery-photos');

drop policy if exists "livery-photos insert own folder" on storage.objects;
create policy "livery-photos insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'livery-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(name) ~ '\.jpe?g$'
  );

drop policy if exists "livery-photos update own folder" on storage.objects;
create policy "livery-photos update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'livery-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'livery-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(name) ~ '\.jpe?g$'
  );

drop policy if exists "livery-photos delete own folder" on storage.objects;
create policy "livery-photos delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'livery-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 公開 URL の形:
--   {SUPABASE_URL}/storage/v1/object/public/livery-photos/{user_id}/{uuid}.jpg
