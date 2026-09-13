-- =============================================================================
-- 空港ウォッチ / ユーザー参加型 特別塗装機データベース
-- 0001_init.sql  … テーブル・RLS・トリガー・初期データ
-- Supabase の SQL Editor にこのファイルの内容を貼り付けて実行する（1 回だけ）。
-- 詳細設計: docs/design-crowd-livery.md §2
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. テーブル
-- -----------------------------------------------------------------------------

-- ユーザープロフィール（auth.users と 1:1。サインアップ時にトリガーで作成）
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  sns_url      text,
  role         text not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz not null default now()
);

comment on table public.profiles is 'auth.users と 1:1 の公開プロフィール。display_name を写真クレジットに使う。';

-- 特別塗装（1 行 = 1 塗装。塗り替えは別行として登録する）
create table if not exists public.liveries (
  id            bigint generated always as identity primary key,
  reg           text not null,
  hex           text,
  name          text not null,
  name_en       text,
  airline       text,
  aircraft_type text,
  note          text,
  color         text,
  since         date,
  until_date    date,
  source_url    text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  created_by    uuid references public.profiles (id),
  approved_by   uuid references public.profiles (id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint liveries_reg_format check (reg ~ '^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$'),
  constraint liveries_note_len check (note is null or char_length(note) <= 140),
  constraint liveries_color_format check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

comment on column public.liveries.until_date is 'NULL = 運航中';

-- 同じ機体に同名の塗装を重複登録させない（却下済みは除外して再投稿を許す）
create unique index if not exists liveries_reg_name_uniq
  on public.liveries (upper(reg), name)
  where status <> 'rejected';
create index if not exists liveries_reg_idx on public.liveries (upper(reg));
create index if not exists liveries_status_idx on public.liveries (status);
create index if not exists liveries_created_by_idx on public.liveries (created_by);

-- 写真（1 塗装に複数。代表写真は is_primary = true が 1 枚）
create table if not exists public.photos (
  id            bigint generated always as identity primary key,
  livery_id     bigint not null references public.liveries (id) on delete cascade,
  user_id       uuid not null references public.profiles (id),
  storage_path  text not null,
  thumb_path    text not null,
  credit_name   text not null,
  taken_on      date,
  airport_icao  text,
  caption       text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on column public.photos.storage_path is 'livery-photos バケット内のパス {user_id}/{uuid}.jpg';

-- 代表写真は 1 塗装に 1 枚だけ
create unique index if not exists photos_primary_uniq
  on public.photos (livery_id)
  where is_primary;
create index if not exists photos_livery_idx on public.photos (livery_id);
create index if not exists photos_user_idx on public.photos (user_id);
create index if not exists photos_status_idx on public.photos (status);

-- 通報
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  target_type text not null check (target_type in ('livery', 'photo')),
  target_id   bigint not null,
  reason      text not null,
  reporter_id uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  resolved    boolean not null default false
);

create index if not exists reports_target_idx on public.reports (target_type, target_id) where not resolved;

-- -----------------------------------------------------------------------------
-- 2. 関数
-- -----------------------------------------------------------------------------

-- 管理者判定。RLS ポリシーから呼ぶので security definer（profiles の RLS を通らない＝再帰しない）
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- updated_at の自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists liveries_set_updated_at on public.liveries;
create trigger liveries_set_updated_at
  before update on public.liveries
  for each row execute function public.set_updated_at();

-- サインアップ時に profiles を作る。表示名は full_name → name → メールのローカル部
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), '');
  if v_name is null then
    v_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  if v_name is null then
    v_name := 'ユーザー' || left(replace(new.id::text, '-', ''), 6);
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 一般ユーザーが自分の role を書き換えられないようにする
-- （RLS ポリシーから profiles を再参照すると再帰するので、トリガーで守る）
create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() が NULL = SQL Editor / service role からの操作なので許可する
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_trg on public.profiles;
create trigger profiles_guard_role_trg
  before update on public.profiles
  for each row execute function public.profiles_guard_role();

-- 代表写真のルール（docs/design-crowd-livery.md §2）
--  * 承認済みでない代表写真は代表から降りる
--  * 代表が居なければ、承認済みで最も古い写真が代表になる
--  * 戻り値は代表写真の id（居なければ NULL）
create or replace function public.decide_primary(p_livery_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary bigint;
begin
  -- 却下・承認待ちに戻った代表写真を降格する
  update public.photos
     set is_primary = false
   where livery_id = p_livery_id
     and is_primary
     and status <> 'approved';

  select id into v_primary
    from public.photos
   where livery_id = p_livery_id and is_primary
   limit 1;

  if v_primary is not null then
    return v_primary;
  end if;

  -- 代表が居ない → 承認済みで最も古い写真を代表にする
  select id into v_primary
    from public.photos
   where livery_id = p_livery_id and status = 'approved'
   order by created_at, id
   limit 1;

  if v_primary is not null then
    update public.photos set is_primary = true where id = v_primary;
  end if;

  return v_primary;
end;
$$;

revoke all on function public.decide_primary(bigint) from public;
grant execute on function public.decide_primary(bigint) to service_role;

-- 管理者による代表写真の手動差し替え
create or replace function public.set_primary_photo(p_photo_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_livery bigint;
  v_status text;
begin
  select livery_id, status into v_livery, v_status from public.photos where id = p_photo_id;
  if v_livery is null then
    raise exception '写真が見つかりません: %', p_photo_id;
  end if;
  if v_status <> 'approved' then
    raise exception '承認済みの写真だけを代表にできます: %', p_photo_id;
  end if;

  -- 降格 → 昇格の 2 文のあいだに photos_primary_sync が別の写真を代表にしてしまうと
  -- 部分一意索引に当たるので、このトランザクションだけトリガーを黙らせる
  perform set_config('app.skip_primary_sync', '1', true);
  update public.photos set is_primary = false where livery_id = v_livery and is_primary and id <> p_photo_id;
  update public.photos set is_primary = true  where id = p_photo_id and not is_primary;
  perform set_config('app.skip_primary_sync', '0', true);
  return p_photo_id;
end;
$$;

revoke all on function public.set_primary_photo(bigint) from public;
grant execute on function public.set_primary_photo(bigint) to service_role;

-- 写真の増減・承認状態の変化に追随して代表写真を決め直す
create or replace function public.photos_primary_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_livery_id bigint;
begin
  -- set_primary_photo の最中は何もしない
  if coalesce(current_setting('app.skip_primary_sync', true), '0') = '1' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_livery_id := old.livery_id;
  else
    v_livery_id := new.livery_id;
  end if;
  perform public.decide_primary(v_livery_id);
  return null;
end;
$$;

-- pg_trigger_depth() < 2 … decide_primary 自身の update による再帰を止める
drop trigger if exists photos_primary_sync_trg on public.photos;
create trigger photos_primary_sync_trg
  after insert or delete or update of status, is_primary on public.photos
  for each row
  when (pg_trigger_depth() < 2)
  execute function public.photos_primary_sync();

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.liveries enable row level security;
alter table public.photos   enable row level security;
alter table public.reports  enable row level security;

-- profiles: 誰でも読める（メールアドレスは保持していない）／本人のみ作成・更新
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to anon, authenticated
  using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- role の書き換えは profiles_guard_role トリガーが防ぐ（ポリシー内で profiles を
-- 再参照すると RLS が再帰するため、トリガーで守っている）

-- liveries: approved は匿名でも読める。自分の投稿と管理者は全部読める
drop policy if exists liveries_select on public.liveries;
create policy liveries_select on public.liveries
  for select to anon, authenticated
  using (status = 'approved' or created_by = auth.uid() or public.is_admin());

drop policy if exists liveries_insert on public.liveries;
create policy liveries_insert on public.liveries
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'pending');

drop policy if exists liveries_update on public.liveries;
create policy liveries_update on public.liveries
  for update to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (created_by = auth.uid() and status = 'pending'));

drop policy if exists liveries_delete on public.liveries;
create policy liveries_delete on public.liveries
  for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status = 'pending'));

-- photos: approved は匿名でも読める。自分の写真は読む・消せる
drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos
  for select to anon, authenticated
  using (status = 'approved' or user_id = auth.uid() or public.is_admin());

drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and not is_primary);

drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos
  for update to authenticated
  using (public.is_admin() or (user_id = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (user_id = auth.uid() and status = 'pending'));

drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos
  for delete to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- reports: 投稿はログイン済み、閲覧・更新は管理者のみ
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists reports_select_admin on public.reports;
create policy reports_select_admin on public.reports
  for select to authenticated
  using (public.is_admin());

drop policy if exists reports_update_admin on public.reports;
create policy reports_update_admin on public.reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 4. 権限（Supabase の既定でも付くが明示しておく）
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles, public.liveries, public.photos to anon, authenticated;
grant insert, update, delete on public.profiles, public.liveries, public.photos to authenticated;
grant insert on public.reports to authenticated;
grant select, update on public.reports to authenticated;
grant all on public.profiles, public.liveries, public.photos, public.reports to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. 初期データ（lib/liveries.js の SPECIAL_LIVERIES 11 件。承認済み・投稿者なし）
-- -----------------------------------------------------------------------------

insert into public.liveries (reg, name, airline, aircraft_type, note, color, status, approved_at)
values
  ('JA01XJ', 'A350 導入記念 1号機',            'JAL',     'A350-900', '赤色「AIRBUS A350」ロゴ',       '#d7263d', 'approved', now()),
  ('JA02XJ', 'A350 導入記念 2号機',            'JAL',     'A350-900', 'シルバー「AIRBUS A350」ロゴ',   '#8a8f98', 'approved', now()),
  ('JA03XJ', 'A350 導入記念 3号機',            'JAL',     'A350-900', '緑色「AIRBUS A350」ロゴ',       '#2a9d4b', 'approved', now()),
  ('JA15XJ', 'oneworld アライアンス塗装機',    'JAL',     'A350-900', 'ワンワールド特別塗装',          '#1f4e9c', 'approved', now()),
  ('JA339J', 'JAL Jubilee Express',            'JAL',     'B737-800', '東京ディズニーシー25周年記念',  '#7b3fa0', 'approved', now()),
  ('JA228J', 'J-AIR 30th Anniversary JET',     'J-AIR',   'E170',     'ジェイエア30周年記念',          '#c8102e', 'approved', now()),
  ('JA819A', 'ピカチュウジェット NH',          'ANA',     'B787-8',   'ポケモン特別塗装',              '#f4c20d', 'approved', now()),
  ('JA923A', 'イーブイジェット NH',            'ANA',     'B787-9',   'ポケモン特別塗装',              '#b5651d', 'approved', now()),
  ('JA58AN', 'ANA ふるさと JET',               'ANA',     'B737-800', '地域応援特別塗装',              '#1e5aa8', 'approved', now()),
  ('JA73AB', 'ピカチュウジェットBC 1号機',     'Skymark', 'B737-800', '黄色・風船デザイン',            '#f4c20d', 'approved', now()),
  ('JA73NG', 'ピカチュウジェットBC 2号機',     'Skymark', 'B737-800', 'ホエルオーデザイン',            '#3a8fd9', 'approved', now())
on conflict do nothing;

-- 初期管理者の昇格は supabase/README.md の 1 行 SQL を参照（メールは所有者が入れる）。
