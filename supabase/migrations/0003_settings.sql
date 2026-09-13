-- =============================================================================
-- 0003_settings.sql … アプリ設定（app_settings）
-- 0001_init.sql → 0002_storage.sql の後に実行する。
-- 既存のデプロイでも 1 回だけ実行が必要（写真の自動承認の既定値が入る）。
--
-- 設定は秘密ではない（写真を自動承認するかどうか、など画面の挙動）ので誰でも読める。
-- 書き込みは is_admin() だけ。再実行しても壊れない。
-- =============================================================================

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is 'アプリ全体の設定。value は JSON（真偽値・数値・文字列・オブジェクト）。';
comment on column public.app_settings.key is '設定キー。auto_approve_photos = 写真を自動承認するか（true/false）';

-- updated_at の自動更新（0001_init.sql の関数を使い回す）
drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: 読み取りは誰でも / 追加・更新は管理者のみ（削除はさせない）
-- -----------------------------------------------------------------------------

alter table public.app_settings enable row level security;

drop policy if exists app_settings_select_all on public.app_settings;
create policy app_settings_select_all on public.app_settings
  for select to anon, authenticated
  using (true);

drop policy if exists app_settings_insert_admin on public.app_settings;
create policy app_settings_insert_admin on public.app_settings
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists app_settings_update_admin on public.app_settings;
create policy app_settings_update_admin on public.app_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;

-- -----------------------------------------------------------------------------
-- 初期値（既定は「写真を自動で承認する」= ON）
-- 既に行があれば触らない（所有者が OFF にした設定を巻き戻さない）
-- -----------------------------------------------------------------------------

insert into public.app_settings (key, value)
values ('auto_approve_photos', 'true'::jsonb)
on conflict (key) do nothing;
