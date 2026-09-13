# 空港ウォッチ（SpecialLiveryT）

日本の空港を選ぶと「空港にいる機体」「到着予定」「出発直後」を 30 秒ごとに更新して表示するスマホ向け Web アプリ。
特別塗装機（`lib/liveries.js` の `SPECIAL_LIVERIES`）は金色枠と説明付きでハイライトし、各機体の写真を右側に表示する。

- ホスティング: Vercel（GitHub 連携で `main` への push が自動デプロイ）
- 空港を URL で指定: `/#RJFF`（福岡）のようにハッシュで ICAO コードを付ける

特別塗装機のリストは利用者の投稿で育てる（Supabase）。写真を投稿した人の名前が代表写真のクレジットに出る。
詳細設計は `docs/design-crowd-livery.md`（フェーズ A〜D をすべて実装済み＝一覧・投稿・管理画面・共有ページ）。
塗装ごとの共有ページ `/livery/:reg` は OG 画像つきで SNS に貼れる。

## 構成

| パス | 役割 |
|---|---|
| `public/index.html` | 空港ウォッチの画面（静的）。`/api/status` を 30 秒ごとに fetch。機体写真は Planespotters API をブラウザから直接取得 |
| `public/liveries.html` | 承認済み特別塗装の一覧（検索・航空会社チップ・「運航中のみ」） |
| `public/login.html` | ログイン（Google OAuth。モックではダミーユーザーの 2 ボタン）。初回は表示名の確認 |
| `public/submit.html` | 投稿（(a) 新しい塗装を登録 / (b) 既存の塗装に写真を追加）。`public/js/upload.js` が処理 |
| `public/me.html` | マイページ（自分の投稿と状態、写真の削除、表示名・SNS URL の編集） |
| `public/admin.html` | 管理画面（admin のみ）。承認待ちの塗装・写真の承認／却下、通報、代表写真の差し替え、設定（写真の自動承認）、管理者の追加／削除、ツール |
| `public/terms.html` | 利用規約・写真の取り扱い（連絡先は `【連絡先を記入】` を置換する） |
| `public/css/app.css` | 共通のデザイントークン（CSS 変数）と土台・ナビ・トーストのスタイル |
| `public/js/common.js` | 共通ヘッダ／ナビ、`/api/config` 取得、supabase-js の遅延読み込み、`window.AW`（`getSession` / `requireLogin` / `signOut` / `authHeaders` / `report`）。admin には「管理」リンクと承認待ちバッジを出す |
| `public/js/upload.js` | 投稿画面の処理（既存塗装の照会・adsbdb 自動入力・Canvas 縮小・Storage upload・insert） |
| `public/js/validate.js` | 入力検証の純関数（ブラウザと `node --test` で共用。登録記号・URL・日付・表示名） |
| `public/js/mockdb.js` | モックモード用のクライアント側ストア（localStorage）。Supabase 無しで投稿の流れを試せる |
| `api/status.js` | `GET /api/status?icao=RJTT`。`s-maxage=20` でエッジ共有 |
| `api/config.js` | `GET /api/config` → `{ supabaseUrl, supabaseAnonKey, mock, autoApprovePhotos }`（`no-store`） |
| `api/photos.js` | `POST /api/photos`（ログイン必須）。`{op:'finalize', photoId}` = 投稿直後の自分の写真を公開処理に回す（自動承認が ON なら承認する） |
| `api/liveries.js` | `GET /api/liveries?airline=&q=&active=1` → 承認済み一覧（`s-maxage=60`） |
| `api/livery.js` | `GET /api/livery?reg=` → 共有ページ用（塗装・承認済み写真・**現在地**。`s-maxage=20`） |
| `api/livery-page.js` | `GET /livery/:reg` の HTML（og:* をサーバーで埋める。vercel.json の rewrite 経由） |
| `api/og.js` | `GET /api/og?reg=` → 1200×630 の OG 画像（Node Function・`@vercel/og` 0.6 系。1.x は Edge/Node とも Vercel で動かないため固定） |
| `api/report.js` | `POST /api/report`（ログイン必須）。通報を登録。写真は未解決 3 件で自動的に承認待ちへ戻す |
| `api/admin.js` + `lib/admin-api/*.js` | 管理 API（admin のみ）。`/api/admin/:op` を vercel.json の rewrite で 1 関数に集約（Hobby プランの 12 関数制限のため）。op = `approve` / `pending` / `primary` / `reports` / `hex-fill` / `sweep` / `credit-backfill` / `users` / `role` / `settings` |
| `lib/auth.js` | 呼び出し元の本人確認。`Bearer <JWT>` を Supabase Auth に検証させて `profiles.role` を見る（モックは `Bearer mock:<id>`） |
| `lib/admin.js` | 管理バッチ（adsbdb で hex 補完・Storage の孤児ファイル掃除）。fetch を差し替えられる |
| `lib/status.js` | 取得・判定ロジック（adsb.lol → adsb.fi フォールバック、adsbdb 経路、駐機/到着/出発の判定）。`lookupRoute()` を公開 |
| `lib/position.js` | 1 機だけの現在地（adsb.lol `/v2/reg/{reg}`）。駐機中/飛行中/受信なし/不明 + 最寄り空港・経路・到着まで |
| `lib/og-render.js` | OG 画像の要素ツリーと日本語フォントのサブセット取得（`@vercel/og` は import しない） |
| `lib/db.js` | 塗装 DB のアクセス層。Supabase（PostgREST に素の fetch）とメモリ内モックを同じ関数で提供 |
| `lib/airports.js` | 日本の主要 45 空港（ICAO/IATA/座標/空港とみなす半径） |
| `lib/liveries.js` | 特別塗装機の初期データ・航空会社名・機種名の辞書 |
| `supabase/migrations/` | Postgres スキーマ・RLS・Storage ポリシー・初期データ・アプリ設定（`0003_settings.sql`） |
| `supabase/README.md` | 所有者が行う Supabase の設定手順（admin 昇格の SQL 1 行を含む） |
| `test/dev-server.js` | 依存なしのローカルサーバー（`vercel dev` の代わり）。`public/` 配信 + `api/*.js` のマウント |
| `test/*.test.js` | 単体テスト（`node --test test/`） |
| `test/run.js` | 実データでハンドラを実行する簡易テスト（`node test/run.js RJTT`） |
| `docs/` | 詳細設計（ユーザー参加型 DB・特別塗装機モード）、データソース調査 |

## データソース（無料・API キー不要）

| 用途 | サービス | 備考 |
|---|---|---|
| 機体位置・登録記号・機種 | [adsb.lol](https://adsb.lol)（ADS-B） | 障害時は [adsb.fi](https://adsb.fi) に自動フォールバック |
| 便名 → 出発地/目的地 | [adsbdb](https://www.adsbdb.com) | 便名ごとに 6 時間キャッシュ |
| 機体写真（一般機） | [Planespotters.net](https://www.planespotters.net) 公開 API | ブラウザから直接取得。撮影者クレジット表示が利用条件。30 秒あたり新規 8 件に制限（緩めるとブロックされる） |
| 1 機の現在地 | adsb.lol `/v2/reg/{reg}` | 共有ページの「今どこ？」。登録記号ごとに 20 秒キャッシュ（短時間に連投すると 429 が返る） |
| 日本語フォント | Google Fonts CSS API（`text=` サブセット） | OG 画像用。描く文字だけの TTF（10〜20KB）をリクエスト時に取得しメモリに保持 |

※ いずれも個人・非商用での利用を前提にした条件。有料化する場合は `docs/research-data-sources.md` を参照。

## 判定ロジック
- 空港にいる: `alt_baro == ground` かつ空港中心から `radiusNm` 以内。上空 1500ft 未満は「着陸中/離陸中」。
- 到着予定: adsbdb の目的地が当該空港（確定）。経路不明時は「空港へ向かって降下中・距離に対して妥当な高度」で推定（「推定」バッジ）。
- 出発: 出発地が当該空港で 60nm 以内、または空港から離れる方向に上昇中。

## 開発

```
npm install               # @vercel/og（OG 画像）だけ。node_modules はコミットしない
npm run dev               # モックDBで http://localhost:3000（依存なしの test/dev-server.js）
npm test                  # 単体テスト = node --test test/（ネットワーク不要）
node test/run.js RJTT     # API ロジックを実データで確認（外部 API を叩く）
npm run dev:supabase      # 環境変数の Supabase に接続して起動
npx vercel dev            # Vercel 相当（vercel CLI が必要）
```

`npm run dev` はモックモードなので Supabase が無くても全画面が開ける（`MOCK_SEED_PENDING=1` が
承認待ちのダミーと、JA819A の承認済み写真 1 枚＝data URL の SVG を入れるので共有ページも絵が出る）。
`/api/og` だけはプレースホルダの SVG（下の「共有ページ」を参照）。
`node --test test/` は `test/index.js` を入口に各 `*.test.js` を読み込む
（Node 22 の test runner は位置引数のディレクトリを展開しないため）。

### 環境変数

`env.example` をコピーして使う。Vercel では Project → Settings → Environment Variables に設定する。

| 変数 | 必須 | 用途 |
|---|---|---|
| `SUPABASE_URL` | 本番のみ | Supabase プロジェクトの URL。未設定ならモック（`lib/liveries.js` の 11 件）で動く |
| `SUPABASE_ANON_KEY` | 本番のみ | 公開可。`/api/config` 経由でブラウザに渡す |
| `SUPABASE_SERVICE_ROLE_KEY` | 本番のみ | サーバー専用。承認・却下 API だけが使う |
| `MOCK_DB` | 任意 | `1` にすると `SUPABASE_URL` があってもモックで動く |
| `MOCK_SEED_PENDING` | 任意 | `1` でモックにダミーを入れる（承認待ち: 塗装2・写真2・通報1／承認済み: JA819A の写真1）。`npm run dev` が自動で付ける |

コードパスの分岐は `lib/db.js`（サーバー側）と `public/js/common.js`（ブラウザ側）の 2 箇所で判定し、
投稿画面はその結果（`AW.config.mock`）を見て `public/js/mockdb.js` か supabase-js のどちらかを呼ぶ。
環境変数が揃えば同じコードで本番になる。

### Supabase のセットアップ

`supabase/README.md` を参照（SQL の実行順、OAuth、admin 昇格の 1 行 SQL、Vercel の環境変数）。

## 特別塗装機の追加
- 利用者: `/liveries.html` → 「あなたの写真を載せませんか」／`/submit.html` から投稿し、管理者が `/admin.html` で承認する
- 初期データ: `lib/liveries.js` の `SPECIAL_LIVERIES`（`supabase/migrations/0001_init.sql` の seed と Supabase が無いときのフォールバックを兼ねる）

### 投稿のしくみ（フェーズ B）

- ログインは Supabase Auth の **Google のみ**（X は `login.html` にコメントアウトで用意。Providers で有効化したら開放する）
- 投稿はサーバー API を通さず、ブラウザから supabase-js で直接 insert / upload する。権限は RLS（`0001_init.sql`）と
  Storage ポリシー（`0002_storage.sql`）が守る。クライアントは RLS が要求する値（`status='pending'`、
  `created_by`／`user_id` = 自分、`is_primary=false`）をそのまま送る
- 写真はブラウザの Canvas で**長辺 1600px（JPEG q0.85）と 320px（q0.8）**の 2 枚にして
  `livery-photos/{uid}/{uuid}.jpg` と `{uid}/{uuid}_thumb.jpg` に上げる。EXIF の向きは
  `createImageBitmap(file, {imageOrientation:'from-image'})` で反映し、再圧縮で EXIF は落ちる。
  `_thumb.jpg` という命名はクライアント側の規約（DB では `thumb_path` 列に入るだけ）
- `photos` の行は**両方の upload が成功してから** insert する。insert が失敗した場合は上げた画像を消すが、
  ネットワークが切れた場合などは孤児ファイルが残りうる。これは `/admin.html` の
  「孤児ファイルの掃除」（`POST /api/admin/sweep`）で回収する（フェーズ C で実装）
- `credit_name` は**投稿時点の表示名で固定**する。あとでマイページで改名しても過去の写真のクレジットは変わらない
  （`/me.html` と `/terms.html` にその旨を明記している）
- 登録記号を入れて欄から離れると、`/api/liveries?q=` で既存の承認済み塗装を照会し（あれば
  「この塗装に写真を追加」へ誘導）、`https://api.adsbdb.com/v0/aircraft/{reg}` をブラウザから直接引いて
  航空会社・機種を自動入力する（`access-control-allow-origin: *` を確認済みのためプロキシは不要）

### 管理のしくみ（フェーズ C）

`/admin.html` は **admin だけ**が開ける（`profiles.role = 'admin'`。昇格は `supabase/README.md` の SQL 1 行）。
一般ユーザーが開くと「権限がありません」と出る。ヘッダの「管理」リンクと承認待ちバッジも admin にだけ出る。

| エンドポイント | メソッド | 役割 |
|---|---|---|
| `/api/admin/pending` | GET | 承認待ちの塗装・写真（サムネイル付き）・未解決の通報・件数 |
| `/api/admin/approve` | POST | `{type:'livery'\|'photo', id, action:'approve'\|'reject', reason?}`。却下は理由必須 |
| `/api/admin/primary` | GET / POST | 登録記号で承認済み写真を一覧 / `{photoId}` を代表写真にする |
| `/api/admin/reports` | GET / POST | 通報の一覧 / `{id}` を解決済みにする |
| `/api/admin/hex-fill` | POST | hex が空の塗装を adsbdb `/v0/aircraft/{reg}` の `mode_s` で補完（1 回 30 件まで） |
| `/api/admin/sweep` | POST | Storage の孤児ファイル掃除（`{dryRun:true}` で一覧だけ。モックは何もしない） |
| `/api/admin/credit-backfill` | POST | `{userId}` のクレジットを今の表示名に付け替える（改名の反映依頼用） |
| `/api/admin/users` | GET | 管理者の一覧（`admins`）と `?q=` でのユーザー検索（表示名の部分一致・メールの完全一致） |
| `/api/admin/role` | POST | `{userId, role:'admin'\|'user'}`。自分自身の降格と、管理者が 0 人になる降格は断る |
| `/api/admin/settings` | GET / POST | アプリ設定（`app_settings`）の取得 / `{key, value}` の保存 |
| `/api/report` | POST | ログイン済みの誰でも。`{targetType, targetId, reason}` |
| `/api/photos` | POST | ログイン済みの誰でも。`{op:'finalize', photoId}`（自分の写真だけ。下の「写真の自動承認」） |

- **認証**: ブラウザは `Authorization: Bearer <Supabase の access_token>` を付ける。`lib/auth.js` が
  `${SUPABASE_URL}/auth/v1/user`（anon キー）にトークンを検証させ、service role キーで `profiles.role` を読む。
  モックでは `Bearer mock:<userId>`（`public/js/mockdb.js` の `mock-<id>` も受ける）
- **service role キーは RLS を素通りする**ので、入力は `lib/db.js` で必ず絞る
  （id は 1 以上の整数、`type`/`action`/`targetType` は列挙、理由は 500 字以内、登録記号と hex は正規表現）
- **代表写真**: 写真を承認すると `decide_primary()` が走り、その塗装に代表写真が無ければその写真が代表になる
  （= 最初に承認された投稿者がサムネイル権を得る）。管理者は「代表写真の差し替え」で `set_primary_photo()` を呼べる
- **通報**: 同じ写真に未解決の通報が 3 件たまると自動で `status='pending'`（非表示）に戻し、代表写真を繰り上げる。
  管理者は `/admin.html` の「通報」で再判断して、却下するか「解決にする」
- **孤児掃除**: `photos.storage_path` / `thumb_path` と突き合わせて参照の無いファイルを消す。
  投稿中のファイルを巻き込まないよう、作成から 1 時間未満のファイルは対象外
- 承認待ちの行は RLS では読めないため、管理 API だけは service role キーで読み書きする

#### 管理者を増やす／外す

`/admin.html` の「管理者」で、表示名（部分一致）かメールアドレス（完全一致）でユーザーを探して
`profiles.role` を切り替える。**最初の 1 人だけ** `supabase/README.md` の SQL 1 行で昇格させる。

- メールアドレスは `profiles` に持っていないので、`${SUPABASE_URL}/auth/v1/admin/users?email=` を
  service role キーで引いてユーザー id を得る。メールは管理 API の応答にしか出さない
- `profiles.role` の更新も service role キー。`0001_init.sql` の `profiles_guard_role` トリガーは
  `auth.uid()` が NULL（= service role / SQL Editor）のときだけ role の変更を通す
- **自分自身は外せない**（権限を失って戻せなくなる事故を防ぐ）。**管理者が 0 人になる降格も断る**

#### 写真の自動承認（設定）

`/admin.html` の「設定」の **「写真を自動で承認する」**（`app_settings.auto_approve_photos`・**既定 ON**）。
塗装の登録は設定に関わらず常に承認待ち（＝手で確認する）で、自動承認されるのは**写真だけ**。

- クライアントの insert は RLS（`photos_insert`）の都合で必ず `status='pending'` なので、
  `public/js/upload.js` は insert の直後に `POST /api/photos`（`{op:'finalize', photoId}`）を呼ぶ。
  サーバーは**投稿者本人の pending の写真**であることを確かめ、設定が ON なら管理者の承認と同じ道
  （`adminUpdateStatus` → `decide_primary`）で承認する。承認者は「システム」なので `approved_by` は NULL
- 投稿完了画面は結果に応じて **「公開されました」／「承認待ちです」** を出し分ける
- 承認待ちの塗装に付いた写真は先に承認されうるが、一覧・共有ページの問い合わせは
  いずれも `liveries.status = 'approved'` で絞っているので、**塗装が承認されるまで表示されない**
- 設定が読めなかったときは承認しない（承認待ちのまま管理者に回る）
- 通報の 3 件ルールは自動承認された写真にもそのまま効く（未解決 3 件で承認待ちに戻る）
- モックモードでは `/api/config` の `autoApprovePhotos` を `public/js/mockdb.js` が同じように解釈する

### 共有ページ（フェーズ D）

`/livery/:reg` は塗装 1 件ぶんの共有ページ。SNS のクローラは JS を実行しないので、
`<head>` の `og:*` と本文は **`api/livery-page.js` がサーバー側で描く**。
ブラウザ側の JS は「今どこ？」のポーリング・タブ切り替え・共有ボタン・通報だけを担当する。

| 部品 | 内容 |
|---|---|
| og:title | `{塗装名}（{登録記号}）\| 空港ウォッチ` |
| og:description | `{航空会社} {機種}・{期間}・写真: {撮影者名}`（写真が無ければ「写真募集中」） |
| og:image | `{絶対URL}/api/og?reg=`（`twitter:card` は `summary_large_image`） |
| 本文 | 大きな代表写真（撮影者名・SNS リンク）／塗装情報・出典／今どこ？／ギャラリー（2 枚以上のとき）／共有・投稿・通報 |
| 未登録の登録記号 | **404** を返し「この機体の塗装を登録する」（`/submit.html?reg=`）へ誘導 |
| 複数の塗装 | 同じ登録記号に複数あればタブ表示（運航中 → 新しい順） |

**今どこ？**（`GET /api/livery?reg=` の `position`。`lib/position.js`）

| state | 表示 |
|---|---|
| `ground` | 「{空港名}（{IATA}）に駐機中」。タップで `/#{ICAO}` へ。3nm より遠いときは空港名を出さず距離だけ |
| `airborne` | 「{便名} {出発地}→{目的地} あと約 n 分」（目的地が国内 45 空港のときだけ残り時間を出す） |
| `unseen` | 「現在は受信できません」 |
| `unknown` | 「現在地を取得できませんでした」（adsb.lol の障害・タイムアウト・429） |

経路照会は `lib/status.js` の `lookupRoute()` を `/api/status` と共用する（adsbdb・6 時間キャッシュ）。
X の投稿文は `✈ {塗装名}（{登録記号}）は今 {現在地}！ {URL} #空港ウォッチ #特別塗装機`。
現在地が分からないときは「は今 〜！」を落とす。

**OG 画像（`/api/og`）**

- `@vercel/og`（satori + resvg の wasm）を使う **Edge Function**。Node 専用の API を持つモジュール
  （`lib/status.js` など）は読み込まない。`lib/db.js` は fetch だけなので Edge でも動く
- JSX が使えない（ビルド無しの構成）ので、要素は `lib/og-render.js` の `h()` で
  プレーンオブジェクトとして組む（satori は `{type, props}` をそのまま受け付ける）
- **日本語**: `@vercel/og` の既定フォントはラテン文字だけなので、そのままでは豆腐（□）になる。
  Google Fonts の CSS API に `text=`（描く文字だけ）を付けて TTF サブセットを取得し、
  モジュールスコープに載せる。取得に失敗しても画像自体は出る（日本語は豆腐になる）
- **ローカルでは描画できない**: `test/dev-server.js` に Edge Runtime は無く、
  `@vercel/og` は素の Node の ESM から読み込めない（バンドル内で `fs` を動的 require し、
  `.wasm` を import する）。そのため dev server は `runtime: 'edge'` を宣言したファイルを実行せず、
  **プレースホルダの SVG** を返す。実物を見るには `npx vercel dev` か Vercel へのデプロイが必要

**トップ画面との関係**: 特別塗装機のカードは DB の代表写真（`special.thumbUrl`）を優先し、
その枠は Planespotters の照会枠（1 更新 8 件）を消費しない。写真がまだ無い特別塗装機は
これまでどおり Planespotters にフォールバックする。カードの写真と塗装名は `/livery/{登録記号}` に飛ぶ。

### モックモードのログイン

`npm run dev`（`MOCK_DB=1`）では Supabase が無いので、`/login.html` に
「モック: 一般ユーザーでログイン」「モック: 管理者でログイン」の 2 ボタンが出る。
ログイン状態と投稿内容は `public/js/mockdb.js` が **localStorage**（`awMockUser` / `awMockDb` / `awMockThumbs`）に保存し、
`/submit.html` → `/me.html`（承認待ちバッジ・サムネイル・削除）まで一通り触れる。サムネイルは data URL で残り、
写真の本体はメモリのみなので再読み込みすると本体のリンクは消える。

**注意**: 投稿の保存先はブラウザの localStorage（`public/js/mockdb.js`）、管理 API が読むのは
サーバープロセスのメモリ（`lib/db.js`）で、モックではこの 2 つがつながっていない。
そのため `/admin.html` には `npm run dev`（`MOCK_SEED_PENDING=1`）が入れるダミーの承認待ちが出る。
本番（Supabase）では同じ Postgres を見るので一続きになる。

## 経緯
元は Google Apps Script の Web アプリとして作成したものを Vercel に移植した（判定ロジックは同一）。
