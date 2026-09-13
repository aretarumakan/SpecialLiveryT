# 空港ウォッチ（SpecialLiveryT）

日本の空港を選ぶと「空港にいる機体」「到着予定」「出発直後」を 30 秒ごとに更新して表示するスマホ向け Web アプリ。
特別塗装機（`lib/liveries.js` の `SPECIAL_LIVERIES`）は金色枠と説明付きでハイライトし、各機体の写真を右側に表示する。

- ホスティング: Vercel（GitHub 連携で `main` への push が自動デプロイ）
- 空港を URL で指定: `/#RJFF`（福岡）のようにハッシュで ICAO コードを付ける

特別塗装機のリストは利用者の投稿で育てる（Supabase）。写真を投稿した人の名前が代表写真のクレジットに出る。
詳細設計は `docs/design-crowd-livery.md`（現在フェーズ A まで実装済み）。

## 構成

| パス | 役割 |
|---|---|
| `public/index.html` | 空港ウォッチの画面（静的）。`/api/status` を 30 秒ごとに fetch。機体写真は Planespotters API をブラウザから直接取得 |
| `public/liveries.html` | 承認済み特別塗装の一覧（検索・航空会社チップ・「運航中のみ」） |
| `public/css/app.css` | 共通のデザイントークン（CSS 変数）と土台・ナビ・トーストのスタイル |
| `public/js/common.js` | 共通ヘッダ／ナビ、`/api/config` 取得、supabase-js の遅延読み込み、`window.AW` |
| `api/status.js` | `GET /api/status?icao=RJTT`。`s-maxage=20` でエッジ共有 |
| `api/config.js` | `GET /api/config` → `{ supabaseUrl, supabaseAnonKey, mock }`（`no-store`） |
| `api/liveries.js` | `GET /api/liveries?airline=&q=&active=1` → 承認済み一覧（`s-maxage=60`） |
| `lib/status.js` | 取得・判定ロジック（adsb.lol → adsb.fi フォールバック、adsbdb 経路、駐機/到着/出発の判定） |
| `lib/db.js` | 塗装 DB のアクセス層。Supabase（PostgREST に素の fetch）とメモリ内モックを同じ関数で提供 |
| `lib/airports.js` | 日本の主要 45 空港（ICAO/IATA/座標/空港とみなす半径） |
| `lib/liveries.js` | 特別塗装機の初期データ・航空会社名・機種名の辞書 |
| `supabase/migrations/` | Postgres スキーマ・RLS・Storage ポリシー・初期データ |
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
| 機体写真 | [Planespotters.net](https://www.planespotters.net) 公開 API | ブラウザから直接取得。撮影者クレジット表示が利用条件。30 秒あたり新規 8 件に制限（緩めるとブロックされる） |

※ いずれも個人・非商用での利用を前提にした条件。有料化する場合は `docs/research-data-sources.md` を参照。

## 判定ロジック
- 空港にいる: `alt_baro == ground` かつ空港中心から `radiusNm` 以内。上空 1500ft 未満は「着陸中/離陸中」。
- 到着予定: adsbdb の目的地が当該空港（確定）。経路不明時は「空港へ向かって降下中・距離に対して妥当な高度」で推定（「推定」バッジ）。
- 出発: 出発地が当該空港で 60nm 以内、または空港から離れる方向に上昇中。

## 開発

```
npm run dev               # モックDBで http://localhost:3000（依存なしの test/dev-server.js）
npm test                  # 単体テスト = node --test test/（ネットワーク不要）
node test/run.js RJTT     # API ロジックを実データで確認（外部 API を叩く）
npm run dev:supabase      # 環境変数の Supabase に接続して起動
npx vercel dev            # Vercel 相当（vercel CLI が必要）
```

`npm run dev` はモックモードなので Supabase が無くても全画面が開ける。
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

コードパスの分岐は `lib/db.js` と `public/js/common.js` の 2 箇所だけ。環境変数が揃えば同じコードで本番になる。

### Supabase のセットアップ

`supabase/README.md` を参照（SQL の実行順、OAuth、admin 昇格の 1 行 SQL、Vercel の環境変数）。

## 特別塗装機の追加
- 利用者: `/liveries.html` → 「あなたの写真を載せませんか」／`/submit.html`（フェーズ B で実装）から投稿し、管理者が承認する
- 初期データ: `lib/liveries.js` の `SPECIAL_LIVERIES`（`supabase/migrations/0001_init.sql` の seed と Supabase が無いときのフォールバックを兼ねる）

## 経緯
元は Google Apps Script の Web アプリとして作成したものを Vercel に移植した（判定ロジックは同一）。
