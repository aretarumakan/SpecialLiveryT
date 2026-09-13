# 詳細設計: ユーザー参加型 特別塗装機データベース

作成日: 2026-09-13　対象: SpecialLiveryT（Vercel）　方針: 非商用・無料枠のみ

## 0. ねらい

- 特別塗装機のリストを利用者の登録で維持する
- 登録・写真投稿した人に「代表写真（サムネイル）に自分の写真が載る」「撮影者名が出る」インセンティブを与える
- 塗装ごとの共有ページを SNS に投稿できるようにし、拡散で登録者を増やす
- 既存の空港ウォッチ画面は、塗装 DB を Supabase から読むように置き換える（Planespotters の写真は特別塗装機以外で引き続き使う）

## 1. 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| ホスティング | Vercel（Hobby） | 既存。静的ページ + Serverless Functions |
| DB / 認証 / 画像 | Supabase（Free） | Postgres + Auth + Storage が一体。RLS で権限制御 |
| フロント | 静的 HTML + 素の JS + `@supabase/supabase-js` v2（CDN の ESM） | 既存ページと統一。ビルド不要 |
| OG 画像 | `@vercel/og`（Edge Function） | 共有ページ用 |
| 画像処理 | ブラウザ側で Canvas により長辺 1600px / 320px に縮小して 2 枚アップロード | サーバー処理不要・Storage 節約 |

Supabase の接続情報は環境変数で渡す: `SUPABASE_URL`, `SUPABASE_ANON_KEY`（公開可、フロントにも配る）, `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用。管理系 API のみ）。
フロントは `GET /api/config` で `{ supabaseUrl, supabaseAnonKey }` を受け取る（キーを HTML に埋め込まない）。

**モック層**: 環境変数が無いとき（ローカル開発・CI）は `lib/db.js` がメモリ内ストアに切り替わり、`lib/liveries.js` の 11 機を初期データとして返す。ログインはダミーユーザー（`?mockUser=admin|user1`）で代替。これによりエージェントは Supabase 無しで全画面を検証できる。

## 2. データモデル（Postgres / `supabase/migrations/0001_init.sql`）

```sql
-- ユーザープロフィール（auth.users と 1:1。サインアップ時にトリガーで作成）
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,            -- 表示名（クレジットに使う）
  sns_url text,                          -- X / Instagram など任意
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

-- 特別塗装（1 行 = 1 塗装。塗り替えは別行）
create table liveries (
  id bigint generated always as identity primary key,
  reg text not null,                     -- 登録記号（大文字・ハイフン込み）例 JA819A
  hex text,                              -- ICAO 24bit（小文字 6 桁）任意。adsbdb で補完
  name text not null,                    -- 塗装名（和名）
  name_en text,                          -- 英名 任意
  airline text,                          -- 航空会社 表示名
  aircraft_type text,                    -- 機種 表示名 任意
  note text,                             -- 一言説明（140 字以内）
  color text,                            -- アクセント色 #rrggbb 任意
  since date,                            -- 運航開始
  until_date date,                       -- 運航終了（NULL = 運航中）
  source_url text,                       -- 出典（プレスリリース等）必須
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index liveries_reg_name_uniq on liveries (upper(reg), name) where status <> 'rejected';
create index liveries_reg_idx on liveries (upper(reg));

-- 写真（1 塗装に複数。代表写真は is_primary = true が 1 枚）
create table photos (
  id bigint generated always as identity primary key,
  livery_id bigint not null references liveries(id) on delete cascade,
  user_id uuid not null references profiles(id),
  storage_path text not null,            -- livery-photos/{user_id}/{uuid}.jpg
  thumb_path text not null,              -- livery-photos/{user_id}/{uuid}_thumb.jpg
  credit_name text not null,             -- 投稿時点の表示名を固定
  taken_on date,
  airport_icao text,                     -- 撮影空港 任意
  caption text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index photos_primary_uniq on photos (livery_id) where is_primary;

-- 通報
create table reports (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('livery','photo')),
  target_id bigint not null,
  reason text not null,
  reporter_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);
```

**代表写真のルール**（`decide_primary()` 関数 + トリガー、または承認 API 内で実施）
- 写真が承認されたとき、その塗装に代表写真が無ければ自動で代表にする（= 最初に承認された投稿者がサムネイル権を得る）
- 管理者は代表写真を手動で差し替えられる
- 代表写真の投稿者が写真を削除したら、次に古い承認済み写真が代表になる

**RLS（行レベルセキュリティ）**
- `profiles`: 誰でも `display_name, sns_url, role` を読める。本人のみ更新
- `liveries`: `status='approved'` は匿名でも読める。ログイン済みは自分の pending/rejected も読める。insert はログイン済み（`created_by = auth.uid()` 強制、status は pending 固定）。update/delete は admin のみ（自分の pending 行の編集も可）
- `photos`: 同様。insert は `user_id = auth.uid()`。自分の写真は削除可
- `reports`: insert はログイン済み、select/update は admin
- admin 判定は `exists(select 1 from profiles where id = auth.uid() and role='admin')` を関数 `is_admin()` にする

**Storage**: バケット `livery-photos`（public read）。ポリシー: 認証ユーザーは `{自分の uid}/` 配下のみ upload/delete。1 ファイル 3MB 上限、`image/jpeg` のみ。

**初期管理者**: 移行 SQL の末尾に `update profiles set role='admin' where id = (select id from auth.users where email = '<owner email>')` を実行する手順を README に記載（メールは所有者が入れる）。

## 3. API（Vercel Functions, `api/`）

| エンドポイント | 認証 | 役割 |
|---|---|---|
| `GET /api/config` | 不要 | `{ supabaseUrl, supabaseAnonKey, mock: bool }` |
| `GET /api/status?icao=` | 不要 | 既存。特別塗装判定を `lib/db.js` の `getApprovedLiveries()`（60 秒メモリキャッシュ）に置換。`special` に `{ name, airline, type, note, color, liveryId, photoUrl, thumbUrl, credit }` を含める |
| `GET /api/liveries?status=approved&airline=&q=` | 不要 | 一覧（承認済み）。写真は代表写真の thumb URL を JOIN |
| `GET /api/livery?reg=JA819A` | 不要 | 共有ページ用データ: 塗装 + 承認済み写真一覧 + **現在地**（adsb.lol `/v2/reg/{reg}` → 最寄り空港 / 飛行中の便名・目的地。20 秒キャッシュ） |
| `GET /livery/:reg` | 不要 | HTML を返す Function（`api/livery-page.js`、vercel.json の rewrite）。`<meta property="og:*">` を埋めた上で共有ページの静的 JS を読み込む |
| `GET /api/og?reg=JA819A` | 不要 | Edge Function。代表写真 + 塗装名 + 登録記号 + 撮影者クレジット + 現在地 1 行を 1200×630 で描画 |
| `POST /api/admin/approve` | admin（Authorization: Bearer <user JWT>） | body `{ type:'livery'|'photo', id, action:'approve'|'reject', reason? }`。service role で更新し、代表写真ルールを適用 |
| `POST /api/hex-fill` | admin | hex 空欄の塗装を adsbdb で補完（既存設計の流用） |

登録・写真投稿は **フロントから supabase-js で直接 insert / upload**（RLS が守る）。サーバー API は公開読み取りと管理操作だけに絞る。

`lib/db.js` の公開関数（モックと本物で同じシグネチャ）:
`getApprovedLiveries()`, `getLiveryByReg(reg)`, `listLiveries(filter)`, `adminUpdateStatus(...)`, `getPendingCounts()`。

## 4. 画面（`public/`）

すべて既存 `index.html` のダークテーマ・カード UI を踏襲。共通ヘッダ部品 `public/js/common.js`（ナビ、ログイン状態、Supabase クライアント初期化、トースト）。

| パス | 内容 |
|---|---|
| `/`（既存） | ヘッダに「特別塗装」「投稿」リンク。特別塗装機カードの写真は DB の代表写真を優先（無ければ Planespotters）。カードの塗装名タップで `/livery/:reg` へ |
| `/liveries.html` | 承認済み塗装の一覧。検索（登録記号・塗装名）、航空会社チップ、「運航中のみ」既定 ON。各カード: 代表写真・塗装名・登録記号・航空会社・期間・撮影者名。写真が無いカードは「あなたの写真を載せませんか」ボタン |
| `/livery/:reg` | 共有ページ。大きな代表写真（撮影者名・SNS リンク）、塗装情報、出典リンク、**今どこにいる**（駐機中の空港 / 飛行中 便名 → 目的地 あと n 分 / 受信なし）、ギャラリー（承認済み写真）、「X に投稿」「LINE で送る」「リンクをコピー」ボタン、「写真を投稿」「情報の修正を提案」「通報」。同じ登録記号に複数塗装がある場合は運航中を先頭にタブ表示 |
| `/submit.html` | ログイン必須。2 モード: (a) 新しい塗装を登録（登録記号・塗装名・航空会社・機種・開始日・出典 URL 必須・一言・任意で写真同時投稿）、(b) 既存の塗装に写真を追加（登録記号で検索して選ぶ）。写真は Canvas で縮小 → Storage に 2 枚 upload → `photos` insert。送信後「承認待ちです」表示 |
| `/me.html` | 自分の投稿一覧と状態（承認待ち/承認/却下+理由）、表示名・SNS URL の編集、写真の削除 |
| `/admin.html` | admin のみ。承認待ちの塗装と写真をカードで表示し「承認 / 却下（理由）」。代表写真の差し替え。通報一覧。hex 補完ボタン |
| `/terms.html` | 利用規約・写真の取り扱い（§6） |
| `/login.html` | Google / X でログイン（Supabase OAuth）。初回は表示名入力 |

**ログイン導線**: 未ログインで投稿ボタンを押すと `/login.html?next=/submit.html`。ログイン後 `profiles` が無ければ表示名を聞いて作成。

**OG 画像・共有文面**
- `og:title` = `{塗装名}（{登録記号}）| 空港ウォッチ`、`og:description` = `{航空会社} {機種}・{期間}・写真: {撮影者名}`、`og:image` = `/api/og?reg=`
- X 投稿文の既定: `✈ {塗装名}（{登録記号}）は今 {現在地}！ {URL} #空港ウォッチ #特別塗装機`

## 5. 承認フロー

1. 投稿 → `pending`。管理者にはメールでなく `/admin.html` のバッジ（`getPendingCounts()`）で知らせる
2. 管理者が承認 → `approved`。塗装が承認されると `/api/status` の 60 秒キャッシュ後に空港ウォッチに反映
3. 却下は理由必須。投稿者は `/me.html` で理由を見て再投稿できる
4. 通報が 3 件以上付いた写真は自動で非表示（`status='pending'` に戻す）にし、管理者が再判断

**重複・誤登録の抑止**: 登録記号入力時に既存塗装をその場で表示（「この機体には既に『〜』が登録されています。写真を追加しますか？」）。登録記号は `^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$` で検証し、adsbdb `/v0/aircraft/{reg}` で存在確認して機種・航空会社を自動入力（失敗しても続行可）。

## 6. 権利・規約（`/terms.html` に載せる要点）

- 写真の著作権は撮影者に残る。投稿者はこのサイトでの表示・縮小・OG 画像への合成・SNS カードでの表示を非独占で許諾する
- 投稿できるのは自分で撮影した写真のみ。他人の写真・公式画像の転載は禁止
- 表示は常に撮影者名付き。削除は本人がいつでも可能（`/me.html`）。削除依頼窓口として所有者の連絡先を記載
- 登録情報（登録記号・塗装名・期間）は事実情報として扱う。出典は公式発表を推奨
- 位置データは adsb.lol（ODbL）— フッターにクレジットを明記。機体写真（一般機）は Planespotters.net API を規約どおりクレジット付きで使用
- 個人情報は表示名と SNS URL のみ。メールアドレスは表示しない

## 7. 実装フェーズ（Opus エージェントへの割り当て）

| フェーズ | 内容 | 成果物 |
|---|---|---|
| A | Supabase スキーマ（SQL 移行・RLS・Storage ポリシー）、`lib/db.js`（本物 + モック）、`/api/config`、`/api/status` の DB 連携、`/api/liveries`、`/liveries.html`、テスト | `supabase/migrations/0001_init.sql`, `lib/db.js`, `api/config.js`, `api/liveries.js`, `public/liveries.html`, `public/js/common.js` |
| B | 認証（`/login.html`、profiles 作成）、`/submit.html`（塗装登録・写真投稿・Canvas 縮小・Storage upload）、`/me.html`、`/terms.html` | 同名ファイル + `public/js/upload.js` |
| C | 管理画面 `/admin.html`、`/api/admin/approve`、代表写真ルール、通報、hex 補完 | 同名ファイル |
| D | 共有ページ `/livery/:reg`（`api/livery-page.js` + rewrite）、`/api/livery`（現在地付き）、`/api/og`、SNS ボタン、トップ画面からの導線と DB 写真優先表示 | 同名ファイル + `index.html` 修正 |

各フェーズ共通の受け入れ条件
- `node test/run.js` と `node --test test/` が通る（モックモード）
- `MOCK` モードで全画面が手元の `python3 -m http.server` または `npx vercel dev` 相当で開ける（`vercel dev` は未インストール。`test/dev-server.js` で `api/*.js` を素の Node http でマウントする簡易サーバーを A で作る）
- 本物の Supabase が無くても壊れない。環境変数が揃えば同じコードで動く（コードパスの分岐は `lib/db.js` と `public/js/common.js` の 2 箇所に閉じる）
- 日本語 UI、既存のデザイントークン（CSS 変数）を再利用
- コミットは対象ファイルを明示して `git add`。push は行わない（所有者が行う）

## 8. 所有者が行う設定（コード完成後）

1. https://supabase.com で無料プロジェクト作成（リージョン: Tokyo）
2. SQL Editor で `supabase/migrations/0001_init.sql` を実行、続けて `0002_storage.sql`
3. Authentication → Providers で Google（と任意で X）を有効化。Redirect URL に Vercel の URL を追加
4. 自分でログイン後、SQL で自分を admin に昇格（README の 1 行）
5. Vercel の Environment Variables に `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` を設定して再デプロイ
6. `/admin.html` を開き、`lib/liveries.js` 由来の初期 11 件（移行 SQL に seed として含める）が承認済みで入っていることを確認
