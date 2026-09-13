-- =============================================================================
-- 0004_hardening.sql … セキュリティ強化（docs/design-security-hardening.md）
-- 0001_init.sql → 0002_storage.sql → 0003_settings.sql の後に実行する。
--
-- 本番稼働中の DB に当てるので、次の方針で書いてある。
--   * 何度実行しても壊れない（Postgres に `add constraint if not exists` は無いので
--     `do $$ ... $$` + `pg_constraint` の存在確認で包む）
--   * CHECK 制約は `not valid` で足してから `validate constraint` する。
--     既存行に違反があれば validate だけが失敗し、制約は「新規行にのみ効く」状態で残る
--     （= 既存データを壊さない）。事前確認の SQL は supabase/README.md を参照。
--
-- 入っているもの
--   1. photos.storage_path / thumb_path の形式チェック（他人のフォルダを指せない）
--   2. 同じ人が同じ対象に出せる未解決の通報は 1 件まで（部分ユニーク索引）
--   3. 自分の承認待ち写真の更新範囲を絞る（RLS + トリガー）
--   4. 1 日あたりの投稿上限（RLS の with check から呼ぶ関数）
--   5. public バケットの「一覧」ポリシーを外す（オブジェクト取得は影響を受けない）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 写真パスの検証
--    storage_path = '{user_id}/{uuid}.jpg' / thumb_path = '{user_id}/{uuid}_thumb.jpg'
--    （public/js/validate.js の storagePaths() と同じ形）
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.photos'::regclass and conname = 'photos_storage_path_chk'
  ) then
    alter table public.photos
      add constraint photos_storage_path_chk check (
        storage_path ~ ('^' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.photos'::regclass and conname = 'photos_thumb_path_chk'
  ) then
    alter table public.photos
      add constraint photos_thumb_path_chk check (
        thumb_path = regexp_replace(storage_path, '\.jpg$', '_thumb.jpg')
      ) not valid;
  end if;
end
$$;

-- 既存行の検証。ここで失敗したら該当行を直してからこのファイルを再実行する
-- （検証済みの制約に対する validate は何もしない＝再実行しても安全）。
alter table public.photos validate constraint photos_storage_path_chk;
alter table public.photos validate constraint photos_thumb_path_chk;

-- -----------------------------------------------------------------------------
-- 2. 通報の重複防止
--    同じ人（reporter_id）が同じ対象に出せる「未解決の」通報は 1 件まで。
--    reporter_id が NULL（匿名・削除済み）の行は対象外。
-- -----------------------------------------------------------------------------

create unique index if not exists reports_one_open_per_reporter
  on public.reports (target_type, target_id, reporter_id)
  where not resolved and reporter_id is not null;

-- -----------------------------------------------------------------------------
-- 3. 1 日あたりの投稿上限（RLS の with check から呼ぶ）
--    lib/db.js の DAILY_LIMITS と同じ値をポリシー側に書く。
-- -----------------------------------------------------------------------------

create or replace function public.under_daily_limit(p_table text, p_limit int)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    return true;   -- service role / SQL Editor は対象外
  end if;
  if p_table = 'photos' then
    select count(*) into n from public.photos
     where user_id = auth.uid() and created_at > now() - interval '1 day';
  elsif p_table = 'liveries' then
    select count(*) into n from public.liveries
     where created_by = auth.uid() and created_at > now() - interval '1 day';
  elsif p_table = 'reports' then
    select count(*) into n from public.reports
     where reporter_id = auth.uid() and created_at > now() - interval '1 day';
  else
    return false;
  end if;
  return n < p_limit;
end;
$$;

revoke all on function public.under_daily_limit(text, int) from public;
grant execute on function public.under_daily_limit(text, int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. RLS の作り直し
-- -----------------------------------------------------------------------------

-- 写真の投稿: 自分のフォルダのパスだけ・1 日 30 枚まで
-- （複数の permissive ポリシーは OR で結ばれるため、上限は必ずこの 1 本の中に書く）
drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and not is_primary
    and storage_path like auth.uid()::text || '/%'
    and public.under_daily_limit('photos', 30)
  );

-- 自分の写真を直せるのは「承認待ちのあいだ」だけ。代表写真には自分ではできない
drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos
  for update to authenticated
  using (public.is_admin() or (user_id = auth.uid() and status = 'pending'))
  with check (
    public.is_admin()
    or (user_id = auth.uid() and status = 'pending' and not is_primary)
  );

-- 塗装機の登録: 1 日 20 件まで
drop policy if exists liveries_insert on public.liveries;
create policy liveries_insert on public.liveries
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and status = 'pending'
    and public.under_daily_limit('liveries', 20)
  );

-- 所属（livery_id）と保存先（storage_path / thumb_path）と持ち主の付け替えを禁止する。
-- 管理者と service role（auth.uid() が NULL）は除外。
create or replace function public.photos_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.livery_id is distinct from old.livery_id
       or new.storage_path is distinct from old.storage_path
       or new.thumb_path is distinct from old.thumb_path
       or new.user_id is distinct from old.user_id then
      raise exception '写真の所属や保存先は変更できません' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists photos_guard_update_trg on public.photos;
create trigger photos_guard_update_trg
  before update on public.photos
  for each row execute function public.photos_guard_update();

-- -----------------------------------------------------------------------------
-- 5. バケットの「一覧」を閉じる
--    公開オブジェクトの取得（/storage/v1/object/public/...）は select ポリシーが無くても
--    動く（bucket.public = true のため）。list だけがポリシー依存なので削除する。
--    管理者の孤児掃除（/api/admin/sweep）は service role で list するので影響しない。
-- -----------------------------------------------------------------------------

drop policy if exists "livery-photos public read" on storage.objects;

-- 実行後の確認は supabase/README.md「7. 0004 の事前・事後チェック」を参照。
