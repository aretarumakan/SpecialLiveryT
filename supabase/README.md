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

## 3. 認証プロバイダ（Google）

ログインは **Google Identity Services（GIS）を自サイトのオリジンで動かし**、受け取った ID トークンを
`supabase.auth.signInWithIdToken({ provider: 'google', token, nonce })` に渡す方式。
Supabase のリダイレクト（`https://<ref>.supabase.co/auth/v1/callback`）を経由しないので、
Google の同意画面には **アプリ名「スペマウォッチ」と自分のドメイン**が出る（`xxxx.supabase.co` は出ない）。

### 3-1. Google Cloud Console（https://console.cloud.google.com）

1. プロジェクトを作る（または既存のものを選ぶ）
2. **API とサービス → OAuth 同意画面**
   - User Type: **外部**、公開ステータスは「本番環境」（テスト中は自分を「テストユーザー」に入れる）
   - アプリ名: **スペマウォッチ** ← これが同意画面に出る文字
   - ユーザーサポートメール / デベロッパーの連絡先メール: 自分のアドレス
   - アプリのロゴ（任意。ロゴを入れると Google の審査が必要になる場合がある）
   - アプリのホームページ: `https://special-livery-t.vercel.app`
   - プライバシーポリシー / 利用規約: `https://special-livery-t.vercel.app/terms.html`
   - 承認済みドメイン: `special-livery-t.vercel.app`（Vercel の独自ドメインを足したらそれも）
   - スコープは既定のまま（`openid` / `email` / `profile`）。追加スコープは要らない
3. **API とサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **ウェブ アプリケーション**
   - **承認済みの JavaScript 生成元**（これが GIS で必須）
     - `https://special-livery-t.vercel.app`
     - `http://localhost:3000`（ローカル開発用）
   - **承認済みのリダイレクト URI は不要**（GIS はリダイレクトしない）。
     `https://<ref>.supabase.co/auth/v1/callback` を足す
   - 出てきた **クライアント ID**（`…apps.googleusercontent.com`）と**クライアント シークレット**を控える

### 3-2. Supabase ダッシュボード

Authentication → **Providers → Google** を開いて:

1. **Enable Sign in with Google** を ON
2. **Client ID** と **Client Secret** に 3-1 で作った値を入れる
3. **Authorized Client IDs**（＝ "Client IDs" 欄）にも**同じクライアント ID**を入れる。
   `signInWithIdToken` はこの欄に載っているクライアント ID のトークンしか受け付けない（ここが空だと
   `Unacceptable audience in id_token` などで弾かれる）
4. Authentication → **URL Configuration** の Site URL / Redirect URLs に Vercel の URL
   （例 `https://special-livery-t.vercel.app` と `http://localhost:3000`）を追加
   （GIS ではリダイレクトしないが、メールリンク用に入れておく）

※「Skip nonce check」は **ON にしない**。このアプリは毎回 nonce を作り、Google にはその SHA-256（hex）を、
Supabase には生の値を渡している（`public/js/nonce.js`）。

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
Supabase の値は Project Settings → **API**、`GOOGLE_CLIENT_ID` は Google Cloud Console にある。
変更後は **再デプロイ**しないと反映されない。

| 変数 | 値 | 用途 |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | サーバー・フロント両方 |
| `SUPABASE_ANON_KEY` | anon public key | 公開可。`/api/config` 経由でフロントに渡す |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **サーバー専用**。管理 API（承認・却下）だけが使う |
| `GOOGLE_CLIENT_ID` | 3-1 の OAuth クライアント ID | 公開可。`/api/config` の `googleClientId` としてブラウザに渡り、GIS のボタンに使う |

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
