# Supabase のセットアップ（所有者が行う作業）

詳細設計 `docs/design-crowd-livery.md` §8 の手順。コード側は環境変数が無ければモックで動くので、
この設定は「本番で本当のデータを使う」ときだけ必要。

## 1. プロジェクト作成

1. https://supabase.com にログインして **New project**（Free プラン）
2. Region: **Northeast Asia (Tokyo)**、Database Password は控えておく

## 2. SQL の実行

SQL Editor で、次の順にファイルの中身を貼り付けて実行する。

| 順 | ファイル | 内容 |
|---|---|---|
| 1 | `supabase/migrations/0001_init.sql` | テーブル（profiles / liveries / photos / reports）、RLS、トリガー、初期 11 件の塗装データ |
| 2 | `supabase/migrations/0002_storage.sql` | バケット `livery-photos`（public read・3MB・JPEG のみ）と Storage ポリシー |
| 3 | `supabase/migrations/0003_settings.sql` | アプリ設定 `app_settings`（写真の自動承認。既定 ON）。**既に動かしている場合もこれだけ追加で実行する** |

いずれも再実行しても壊れないように書いてある（`if not exists` / `drop policy if exists` / `on conflict`）。
`0003` を実行していないと `/admin.html` の「設定」が読めず、写真の自動承認は働かない（＝全部が承認待ちになる）。

## 3. 認証プロバイダ

Authentication → **Providers** で Google を有効化（任意で X / Twitter も）。

- Authorized redirect URL に Supabase が表示する `https://<ref>.supabase.co/auth/v1/callback` を Google 側に登録
- Authentication → **URL Configuration** の Site URL / Redirect URLs に Vercel の URL
  （例 `https://special-livery-t.vercel.app` と `http://localhost:3000`）を追加

## 4. 自分を管理者に昇格

一度サイトからログインして `profiles` に行ができたあと、SQL Editor でこの 1 行を実行する
（メールアドレスは自分のものに置き換える）。

```sql
update public.profiles set role = 'admin'
 where id = (select id from auth.users where email = 'owner@example.com');
```

確認:

```sql
select p.id, p.display_name, p.role from public.profiles p where p.role = 'admin';
```

**2 人目からは SQL を書かなくてよい**。`/admin.html` の「管理者」で表示名かメールアドレスで探して
「管理者にする」／「管理者を外す」を押す（`POST /api/admin/role`）。自分自身は外せない・
管理者が 0 人になる操作は断られるので、この SQL に戻る必要があるのは全員を失ったときだけ。

## 5. Vercel の環境変数

Vercel → Project → Settings → Environment Variables に次を設定して再デプロイする。
値は Supabase の Project Settings → **API** にある。

| 変数 | 値 | 用途 |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | サーバー・フロント両方 |
| `SUPABASE_ANON_KEY` | anon public key | 公開可。`/api/config` 経由でフロントに渡す |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **サーバー専用**。管理 API（承認・却下）だけが使う |

`SUPABASE_URL` が未設定のあいだ、`lib/db.js` は自動でモック（`lib/liveries.js` の 11 件）に切り替わる。
意図的にモックで動かしたいときは `MOCK_DB=1` を設定する。

## 6. 動作確認

1. `/api/config` が `{"mock":false,...}` を返す
2. `/liveries.html` に初期 11 件が並ぶ
3. `/api/status?icao=RJTT` の `special` に `liveryId` が入っている
4. （フェーズ C 以降）`/admin.html` で承認待ちバッジが出る
5. `/api/config` の `autoApprovePhotos` が `true`（= 0003 が入っている）

## バックアップ

Free プランは自動バックアップが短いので、ときどき SQL Editor で

```sql
select * from public.liveries order by id;
select * from public.photos order by id;
```

の結果を CSV でダウンロードしておく。
