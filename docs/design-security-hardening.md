# セキュリティ強化 設計（0004_hardening）

作成日: 2026-09-13　対象: SpecialLiveryT（本番稼働中。既存データを壊さずに適用する）

チェック結果（会話ログ参照）のうち、要対応 1〜4 と低リスク 2 件を扱う。すべて既存 API の URL と画面の使い方を変えない。

## 1. 写真パスの検証（高）

### ルール
- `photos.storage_path` は `^{user_id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$`
- `photos.thumb_path` は同じ uuid で `_thumb.jpg`（= `storage_path` の `.jpg` を `_thumb.jpg` に置き換えたもの）
- `user_id` の部分は行の `user_id` と一致すること（他人のフォルダを指せない）

### DB（`supabase/migrations/0004_hardening.sql`）
```sql
-- 形式チェック（既存行は seed の data: を含まないので通る。万一通らない行があれば移行前に修正）
alter table public.photos
  add constraint photos_storage_path_chk check (
    storage_path ~ ('^' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  ) not valid;
alter table public.photos
  add constraint photos_thumb_path_chk check (
    thumb_path = regexp_replace(storage_path, '\.jpg$', '_thumb.jpg')
  ) not valid;
alter table public.photos validate constraint photos_storage_path_chk;
alter table public.photos validate constraint photos_thumb_path_chk;
```
`not valid` → `validate` の順にすることで、既存行に問題があれば `validate` で分かる（ロールバック可能）。本番 DB に既存の写真行があれば、移行前に `select id, storage_path from photos where storage_path !~ ...` で確認する手順を README に書く。

### RLS
`photos_insert` の with check に `storage_path like auth.uid()::text || '/%'` を追加（CHECK 制約と二重だが、RLS 違反のエラー文の方が分かりやすい）。

### コード
- `lib/db.js publicPhotoUrl(path)`: 本番（`!isMock()`）では `http(s)://` と `data:` を **null** にする（外部 URL を生成しない）。モックでは従来どおり通す。
- `lib/db.js getPhotoForFinalize` の select に `storage_path, thumb_path` を足し、`api/photos.js` の finalize で形式・`user_id` 一致を再検証（不一致は 400 で承認しない）。
- `lib/admin-api/approve.js` 経由の承認（`adminUpdateStatus`）でも同じ検証関数 `assertPhotoPaths(row)` を通す。検証関数は `lib/db.js` に 1 つ置き、正規表現は `public/js/validate.js` の `storagePaths()` と同じ定義にする（クライアントは既にこの形で生成している）。
- `lib/og-render.js` / `api/og.js`: `photoUrl` は `publicPhotoUrl` の結果しか使わない（既にそう）。加えて `api/og.js` 側で `photoUrl` が `SUPABASE_URL` で始まらなければ捨てる（多層防御）。

## 2. 通報の重複防止（高）

### DB
```sql
-- 同じ人が同じ対象に出せる未解決の通報は 1 件まで
create unique index if not exists reports_one_open_per_reporter
  on public.reports (target_type, target_id, reporter_id) where not resolved and reporter_id is not null;
```
### コード
- `lib/db.js addReport`: 挿入前に同じ (target, reporter) の未解決通報があれば **409** `dbError(409, 'この対象は既に通報済みです')`。ユニーク index 違反（PostgREST 409 / code 23505）も同じ 409 に正規化。
- 非表示判定は `count(distinct reporter_id)`（reporter_id が NULL の行は数えない）。PostgREST では distinct count が直接取れないので `select=reporter_id` で最大 50 件取って JS で distinct を数える。
- モックも同じ挙動。`REPORTS_TO_HIDE` は 3 のまま。
- `public/js/common.js AW.report`: 409 のときは「既に通報済みです」とトースト。

## 3. 自分の承認待ち写真・塗装機の更新範囲（中）

### RLS（`photos_update` を作り直す）
```sql
drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos
  for update to authenticated
  using (public.is_admin() or (user_id = auth.uid() and status = 'pending'))
  with check (
    public.is_admin()
    or (user_id = auth.uid() and status = 'pending' and not is_primary)
  );
```
### トリガー（livery_id と storage_path の付け替え禁止。管理者と service role は除外）
```sql
create or replace function public.photos_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.livery_id <> old.livery_id or new.storage_path <> old.storage_path or new.thumb_path <> old.thumb_path
       or new.user_id <> old.user_id then
      raise exception '写真の所属や保存先は変更できません' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists photos_guard_update_trg on public.photos;
create trigger photos_guard_update_trg before update on public.photos
  for each row execute function public.photos_guard_update();
```
塗装機（`liveries_update`）は投稿者が pending の間に内容を直せる用途があるので変更しない。ただし `created_by` は with check で固定済み。

## 4. レート制限（中）

RLS の with check にカウント条件を足す（API を増やさない。Hobby の関数数制限を守る）。

```sql
create or replace function public.under_daily_limit(p_table text, p_limit int) returns boolean
language plpgsql security definer set search_path = public stable as $$
declare n int;
begin
  if p_table = 'photos' then
    select count(*) into n from public.photos where user_id = auth.uid() and created_at > now() - interval '1 day';
  elsif p_table = 'liveries' then
    select count(*) into n from public.liveries where created_by = auth.uid() and created_at > now() - interval '1 day';
  elsif p_table = 'reports' then
    select count(*) into n from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day';
  else
    return false;
  end if;
  return n < p_limit;
end $$;
```
- `photos_insert`: `and public.under_daily_limit('photos', 30)`
- `liveries_insert`: `and public.under_daily_limit('liveries', 20)`
- 通報はサービスキー経由なので `lib/db.js addReport` で同じ関数を `rpc/under_daily_limit` … ではなく、`reports` を `reporter_id=eq.<uid>&created_at=gt.<24h前>` で count して **20 件/日** を超えたら 429。
- 上限値は `lib/db.js` の定数 `DAILY_LIMITS = { photos: 30, liveries: 20, reports: 20 }` にも持ち、投稿画面のエラー文（RLS 違反 → 「1 日の投稿上限に達しました」）に使う。Storage の upload は行の insert より先に行われるため、`upload.js` は insert 失敗時に既にアップロードした 2 ファイルを削除する（既存の後始末を流用）。

## 5. 低リスク

### 5-1. バケットの一覧を閉じる
public バケットのオブジェクト取得（`/object/public/...`）は `storage.objects` の select ポリシーが無くても動く。一覧（list）だけがポリシー依存なので、`livery-photos public read` ポリシーは **削除**する。管理者の孤児掃除（`sweep`）はサービスキーで list するので影響なし。
```sql
drop policy if exists "livery-photos public read" on storage.objects;
```
README の「公開 URL の形」は変えない。移行後に実際の画像 URL が 200 で開けることを確認する手順を書く。

### 5-2. セキュリティヘッダ（`vercel.json`）
全パスに:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`（`/livery/:reg` も含む。埋め込み需要が出たら緩める）
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- CSP は **導入しない**（GIS・supabase-js CDN・data: 画像・inline script が多く、今回の範囲で壊さずに書くのは難しい。将来課題として README に記載）

### 5-3. role の露出
`profiles_select_all` はそのまま（表示名と SNS を公開する設計のため）。role を隠すには列単位の制御が要るので、代わりに **API 応答から role を落とす**: `/api/livery` と `/api/liveries` の撮影者情報に role を含めない（現状含めていないことを確認して、テストで固定する）。

### 5-4. 運用
`env.example` と README に「本番で `MOCK_DB=1` を設定しない」「`SUPABASE_SERVICE_ROLE_KEY` は Config でなく Secret として保存」を明記。

## 6. 適用順と検証

1. コードを先にデプロイ（`publicPhotoUrl` の変更・検証関数・409/429 処理・ヘッダ）。DB 変更前でも壊れない
2. Supabase SQL Editor で `0004_hardening.sql` を実行（冪等。`validate constraint` が失敗したら該当行を直して再実行）
3. 確認: 写真の公開 URL が開ける／投稿 → 公開／同じ写真への 2 回目の通報が「通報済み」／管理画面の承認・却下・代表差し替え／`curl -I` でヘッダ

### テスト（`node --test test/`）
- `assertPhotoPaths`: 正常・他人のフォルダ・拡張子違い・サムネイル不一致・外部 URL
- `publicPhotoUrl`: 本番モードで `http://` と `data:` が null、モックで通る
- finalize: 不正パスは 400 で承認されない
- addReport: 同一人物 2 回目は 409、3 人で非表示、1 人 3 回では非表示にならない、21 件目は 429
- vercel.json のヘッダ存在

## 7. 変更ファイル一覧（実装者向け）
- `supabase/migrations/0004_hardening.sql`（新規）、`supabase/README.md`（実行手順・事前確認 SQL）
- `lib/db.js`（publicPhotoUrl, assertPhotoPaths, addReport, DAILY_LIMITS, getPhotoForFinalize）
- `api/photos.js`, `lib/admin-api/approve.js`（検証呼び出し）, `api/og.js`（URL 起点チェック）
- `public/js/common.js`（409 表示）, `public/js/upload.js`（RLS 違反時の文言）
- `vercel.json`（headers）
- `README.md`, `env.example`
- `test/security.test.js`（新規）
