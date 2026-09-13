# 空港ウォッチ（SpecialLiveryT）

日本の空港を選ぶと「空港にいる機体」「到着予定」「出発直後」を 30 秒ごとに更新して表示するスマホ向け Web アプリ。
特別塗装機（`lib/liveries.js` の `SPECIAL_LIVERIES`）は金色枠と説明付きでハイライトし、各機体の写真を右側に表示する。

- ホスティング: Vercel（GitHub 連携で `main` への push が自動デプロイ）
- 空港を URL で指定: `/#RJFF`（福岡）のようにハッシュで ICAO コードを付ける

## 構成

| パス | 役割 |
|---|---|
| `public/index.html` | 画面（静的）。`/api/status` を 30 秒ごとに fetch。機体写真は Planespotters API をブラウザから直接取得 |
| `api/status.js` | Vercel Serverless Function。`GET /api/status?icao=RJTT`。`s-maxage=20` でエッジ共有 |
| `lib/status.js` | 取得・判定ロジック（adsb.lol → adsb.fi フォールバック、adsbdb 経路、駐機/到着/出発の判定） |
| `lib/airports.js` | 日本の主要 45 空港（ICAO/IATA/座標/空港とみなす半径） |
| `lib/liveries.js` | 特別塗装機・航空会社名・機種名の辞書 |
| `test/run.js` | 実データでハンドラを実行する簡易テスト（`node test/run.js RJTT`） |
| `docs/` | 特別塗装機モードの改造設計、データソース調査 |

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
node test/run.js RJTT     # API ロジックを実データで確認
npx vercel dev            # ローカルで http://localhost:3000
```

## 特別塗装機の追加
`lib/liveries.js` の `SPECIAL_LIVERIES` に登録記号をキーにして追記し、`main` に push する。

## 経緯
元は Google Apps Script の Web アプリとして作成したものを Vercel に移植した（判定ロジックは同一）。
