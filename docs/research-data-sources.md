# 空港ウォッチ — データソース調査レポート

- 調査日: 2026-09-13
- 調査対象: 特別塗装機（スペマ）情報 / ADS-B 位置情報 / 便名→経路 / 機体写真
- **最重要前提: 本アプリは将来的に有料販売（買い切り or サブスク）を想定。したがって各ソースの「商用利用可否」「料金」を技術的実現性と同等に重視する。**
- 表記ルール: 実際の規約/価格ページを読めたものは引用＋URLを付す。確認できなかったものは **未確認** と明示する。
- 免責: 本書の法令に関する記述は一般情報であり、法的助言ではない。販売前に弁護士の確認を推奨。

---

## A. 特別塗装機（special livery）の情報源

### A-1. FlyTeam（フライチーム） — 最も欲しいデータだが、規約上もっとも使えない

運営: クロゴ株式会社。

#### データ内容（実地調査済み）
一覧ページ `https://flyteam.jp/aircrafts/liveries/list` を取得して構造を確認した。

- **総登録件数 1,399 件**（ページ本文に「飛行機・航空機の特別塗装データベースです。全 1,399 件の特別塗装機(デカール機、デザイン機)が登録されています。」）
- 1件あたりに含まれる項目（一覧ページ時点で既に全部入っている）:
  - 塗装名（英語表記）例: `STAR ALLIANCE`
  - 塗装名（日本語表記）例: `スターアライアンス(ブラック)`
  - **期間**: 開始日〜終了日 ＋ ステータス（`運航中` / `終了` / `予定` / `不明`）。開始日は日単位まで入るものと年月のみのものが混在
  - **レジ（登録記号）** 例: `EI-HXI`, `JA07RJ`, `HS-TEK`
  - 航空会社名（日本語）
  - 説明文（100文字程度の抜粋、詳細ページに全文）
- 絞り込み: 運航状況（すべて/運航中/終了/予定/不明）、航空会社、キーワード、開始日/終了日の期間指定
- 並び順: `?sort=startdate`（開始/終了日 新しい順）/ `?sort=updatetime`（情報更新 新しい順）/ `?sort=name`（塗装名順）
- ページング: 20件/ページ、`?sort=updatetime&pageid=N` → 全件で約70ページ
- 個別ページ: `https://flyteam.jp/registration/{レジ}/livery/{liveryId}` 例 `/registration/JA07RJ/livery/1336`
- 航空会社別: `https://flyteam.jp/airline/{slug}/livery` 例 `/airline/ana/livery`, `/airline/jal/livery`, `/airline/skymark/livery`, `/airline/hokkaido-international-airlines/livery`, `/airline/ibex-airlines/livery`
- 日本カバレッジ: 極めて良い。JAL/ANA/スカイマーク/AIR DO/IBEX など国内社はもちろん、日本飛来の外国社スペマ（ITA, NZ, TG, STARLUX 等）も網羅。
- スペマ関連ニュース: `https://flyteam.jp/news/special-liveries`（「特別塗装機 ニュース・話題」）

→ **技術的には理想的**。`?sort=updatetime` で差分取得でき、運航中フィルタだけ取れば現役スペマが丸ごと手に入る。HTML は素直で正規表現レベルでパースできる（JS レンダリング不要）。

#### 取得方法の候補と規約

- **公開 API / RSS: 見つからなかった（＝実質なし）。**
  - `https://flyteam.jp/robots.txt` には `Disallow: /api/` があり内部 API の存在は示唆されるが、クローラには明示的に閉じられている。
  - `/rss`, `/feed`, `/rss.xml`, `/news/rss` はいずれも **404**。スペマ一覧ページにも `<link rel="alternate" type="application/rss+xml">` は存在しない。
  - データライセンス / パートナープログラムの案内ページは発見できず（**未確認**＝公開されていない可能性が高い）。
  - なお `robots.txt` は `/aircrafts/liveries` および `/airline/*/livery` を **Disallow していない**。ただし robots.txt の許可は利用規約の許可とは別物であり、規約が優先する。

- **利用規約の該当条項**（出典: https://flyteam.jp/docs/terms ／ 2023年02月16日改定）

  第一条（適用範囲）:
  > 本規約は、クロゴ株式会社が運営するインターネットサイト「FlyTeam(フライチーム)」[URL: https://flyteam.jp]（以下「当サイト」といいます）に関して定めており、当サイトを閲覧・利用する全てのお客様（**会員登録の有無を問いません**。以下、「ユーザー」といいます）に対して適用されます。

  > ユーザーは当サイトの**閲覧・利用によって、本規約に同意したものと見なします**。

  第四条（禁止行為）— 本件に直撃する2号:
  > 当サイトの事前の同意なく、物品・サービスの広告宣伝など**営利目的の行為**をすること

  > 当サイトが提供する情報・サービスを当サイトの**承諾なくして複製・編集・頒布・転売などすること**

  同条2項（制裁）:
  > 前項に該当する行為を行った場合には、当サイトの利用停止・投稿内容の削除・**損害賠償請求**など必要な措置を取ることとなります。

  第七条（準拠法と管轄）:
  > 本規約は、日本法に準拠し…紛争が生じたときは、**東京地方裁判所**を第一審の専属的合意管轄裁判所とします。

#### 判定

| 用途 | 判定 |
|---|---|
| 無断スクレイピング → 無料アプリ | 規約違反（第四条「複製・編集・頒布」） |
| 無断スクレイピング → **有料アプリ** | **明確にアウト**。第四条の「複製・編集・頒布・転売」と「営利目的の行為」の両方に該当。加えて 1,399件の一覧は選択・配列に編集方針（「ステッカーが機体の間近でしか確認できないものは、除外する場合があります」と自ら編集基準を明記）があるため **編集著作物／データベースの著作物（著作権法12条・12条の2）として保護される可能性が高い**。利用規約違反（契約違反）と著作権侵害の二重のリスク。 |
| 許諾を取って利用 | **これが唯一の正攻法。** 第四条は「当サイトの事前の同意なく」「承諾なくして」と書かれており、**承諾があれば可**という構造。つまり交渉の余地は規約上明示されている。 |

#### 許諾交渉のルート（調査で見つかった唯一の窓口）
専用の法務/提携窓口ページは見つからなかった（**未確認**）。現実的な連絡先は以下2つ。

1. スペマ一覧ページに貼られている **FlyTeam「ご指摘・ご要望」のご連絡窓口**（Google フォーム）
   `https://docs.google.com/forms/d/e/1FAIpQLSftDhP4px5eWeCBJNggbCcKvfxu5XUOPajPrbVNfLH3c5JCKA/viewform`
   （スペマ一覧ページ自身が「現在、特別塗装機に関する情報を整備中です！もし、一覧にないものがあれば、以下のフォームよりご連絡いただければ、順次確認・登録します！」と案内している窓口。＝ むしろ「情報提供は歓迎」というスタンスが読める）
2. 運営会社 クロゴ株式会社（同社は鉄道サイト「レイルラボ」も運営）への直接問い合わせ。

交渉で提示すべき条件案:
- 有償ライセンス（月額固定）/ レベニューシェア
- アプリ内に「特別塗装機データ提供: FlyTeam」のクレジット＋各機体の FlyTeam 詳細ページへの送客リンク（＝相手にトラフィック還元）
- 取得頻度の上限（例: 1日1回、運航中フィルタのみ）を約束
- 自アプリのユーザー投稿（飛来情報）を FlyTeam 側に還流する相互提供

#### 結論（A-1）
**FlyTeam は「許諾が取れたら最強・取れなければ使用不可」。有料化前提なら無断利用は選択肢にならない。**
ただし実装上は「データ供給元を差し替え可能な内部スキーマ」を先に作っておき、FlyTeam は交渉成立時に差し込むアダプタとして設計するのが正解。

---

### A-2. 航空会社公式（JAL / ANA / SKY / AIR DO / Solaseed / StarFlyer / Peach / Jetstar Japan / J-AIR・JAC・JTA）

#### 重要な確認事項: 公式プレスリリースはレジ（機体番号）を載せる
実例（検索で実在を確認）:
- JAL「東京ディズニーシー® 25周年をテーマにした特別塗装機『JAL Jubilee Express』が6月4日（木）より国内線に就航」
  https://press.jal.co.jp/ja/release/202604/009482.html
  → ボーイング737-800型機、**機体番号 JA339J**、運航期間 2026年6月4日〜2027年4月頃（予定）を明記。
- JAL「JAL×ユニバーサル・スタジオ・ジャパン ジェット2」 https://press.jal.co.jp/ja/release/202411/008441.html

つまり **「レジ＋塗装名＋期間」という欲しい3点は一次情報（公式プレス）に載っている**。FlyTeam はそれを収集・整理しているだけで、元ネタは公開事実である。これは後述の「自前DB」戦略の法的な足場になる。

#### 各社の発信手段（調査結果）
| 社 | 公式プレス/お知らせ | レジ掲載 | RSS | 備考 |
|---|---|---|---|---|
| JAL | https://press.jal.co.jp/ja/ （カテゴリ別: /service/ /schedule/） | **あり**（上記実例） | `press.jal.co.jp/ja/rss.xml` は **403**。RSS の有無は **未確認** | サイト全体が Akamai で bot を 403。サーバ間取得には UA 偽装が必要で、規約面でもグレー |
| ANA / ANAHD | https://www.ana.co.jp/group/pr/ , https://www.anahd.co.jp/group/pr/ | 機種は常時、**レジは案件次第**（ポケモンジェットは機種中心の告知が多い）。**個別に要確認** | `https://www.anahd.co.jp/rss` は存在するが HTML を返し、XML 実体の URL は **未確認** | ana.co.jp は curl からタイムアウト（bot 対策） |
| スカイマーク | https://www.skymark.co.jp/ja/company/news/ | **未確認** | **未確認** | `company/fleet/` は 200 で取得できたがレジの列挙なし |
| AIR DO | https://www.airdo.jp/ | **未確認** | **未確認** | 旧 URL は 404。ロコンジェット等は FlyTeam 側に登録あり |
| ソラシドエア | https://www.solaseedair.jp/ | **未確認** | **未確認** | |
| スターフライヤー | https://www.starflyer.jp/ | **未確認** | **未確認** | 全機が黒基調の統一塗装で「特別塗装」の概念が薄い |
| Peach | https://www.flypeach.com/ | **未確認** | **未確認** | curl 接続エラー |
| ジェットスター・ジャパン | https://www.jetstar.com/jp/ja/ | **未確認** | **未確認** | |
| J-AIR / JAC / JTA / RAC | JAL グループとして press.jal.co.jp に集約 | JAL に準ずる | 同上 | JTA「さくらジンベエ」等は JAL プレスに出る |

補助ルート: **PR TIMES**（例: オリエンタルランド発のお披露目リリース https://prtimes.jp/main/html/rd/p/000000155.000119340.html ）。PR TIMES には RSS があり、コラボ側企業からの発表を拾える。

#### 商用利用の可否
- **事実（レジ・塗装名・運航期間・機種）それ自体に著作権はない**（著作権法2条1項1号「思想又は感情を創作的に表現したもの」に当たらない）。プレスリリースから**事実だけを読み取って自分のDBに入力する行為は、著作権法上は問題になりにくい**。有料アプリでも同じ。
- 一方、**プレスリリースの文章・写真をコピーして表示するのは複製・公衆送信**にあたり別途許諾が必要。
- 各社サイトの利用規約（サイトポリシー）には「当社の許可なく複製・転載を禁じる」類の条項が通例あり、**本調査では各社の規約原文を取得できなかった（Akamai 403 / タイムアウト）ため 未確認**。実装前に各社サイトポリシーの確認が必要。
- ロゴ・キャラクター（ポケモン、ディズニー、USJ 等）の画像利用は**商標・著作権の別問題**で、有料アプリでの使用は極めてリスクが高い。**塗装名のテキスト表示は記述的使用として許容範囲と考えられるが、キャラクター画像は絶対に自前で持たない**こと。

#### 取得方法の現実解
RSS が確実に使えないため、**「公式サイトの特定URLを1日1回取得して新着タイトルを差分検出し、『特別塗装』『スペマ』『ジェット』等のキーワードでヒットしたものだけ人間（owner）が確認してDBに登録」** という半自動運用が最も堅い。完全自動化は精度と規約の両面で無理がある。

#### 判定
| 観点 | 評価 |
|---|---|
| カバレッジ | 国内大手は良いが、**外国社の日本飛来スペマは拾えない**。FlyTeam の強みはここ |
| 更新頻度 | 発表ベース（月数件）。運航終了は告知されないことが多く、**期間の終了日が埋まらない** のが最大の弱点 |
| 商用可否 | **事実の抽出はOK。文章・画像の転載はNG** |
| 料金 | 無料 |
| 手間 | 半自動（人間の確認が前提） |
| 総合 | **「自前DBの一次情報源」として採用すべき。これが有料化の本命ルート。** |

---

### A-3. Wikipedia / Wikidata

#### Wikidata（実測済み・結論: 使えない）
実際に Wikidata Query Service で検証した。

```sparql
# 日本籍（JAで始まるレジ）の機体アイテム数
SELECT (COUNT(?ac) AS ?n) WHERE { ?ac wdt:P426 ?reg . FILTER(STRSTARTS(?reg,"JA")) }
```
→ **52件**。全機体アイテム（P426 = aircraft registration を持つもの）でも **3,345件** のみ。

取得できたサンプル（レジ / ラベル）:
```
JA01AM, JA51AN, JA614A, JA708J, JA741A, JA752J, JA771J, JA8980, JA899A,
JA8091(20-1101), JA8092(20-1102), JA81AM, JA82RC, JA83RC,
JA6011(日本航空雲仙号不時着事故)
```
中身を見るとわかるとおり **大半が「航空事故の当該機」としてアイテム化されたもの**で、現役のスペマとは無関係。

- **特別塗装（livery）を表すプロパティは存在しない**（`aircraft registration` は P426、P2167 ではない点も要注意）。塗装名・塗装期間をモデル化する語彙がそもそも無い。
- → **スペマDBとしては完全に無価値。** 現役機のレジ↔機種の辞書としても網羅性が無く（3,345件は世界全体。JA機は52件）使えない。

#### ライセンス（良いニュース）
- Wikidata の構造化データ: **CC0（パブリックドメイン、表示義務なし）**
  > "All structured data in the main, property and lexeme namespaces is made available under the Creative Commons CC0 License"
  出典: https://www.wikidata.org/wiki/Wikidata:Licensing
- Wikidata のそれ以外の名前空間のテキスト、および Wikipedia 本文: **CC BY-SA 4.0**
  > "Text in other namespaces is made available under the Creative Commons Attribution-ShareAlike 4.0 License."

#### CC BY-SA の商用利用インプリケーション（Wikipedia 本文を使う場合）
- 商用利用自体は **CC BY-SA で明示的に許可されている**（有料アプリでもOK）。
- ただし **ShareAlike（継承）** が効く。Wikipedia の記述を**そのまま/翻案して**自分のDBに入れて配信すると、その派生部分を CC BY-SA で提供する義務が生じ得る。**有料クローズドなアプリとは相性が悪い。**
- 回避策: **「事実」だけを取る**。レジ・塗装名・期間は事実であり著作権の対象外なので、Wikipedia を**検証の参照先**として人間が読み、自分の言葉・自分の構造で入力すれば ShareAlike は及ばない（＝「アイデア/事実と表現の二分法」）。記事の文章表現や一覧表のレイアウトを丸写しするとアウト。
- 実務的には **出典として「Wikipedia を参照した」旨と記事リンクを載せておく**のが安全側。

#### 日本語版 Wikipedia の該当記事
「特別塗装機」「ポケモンジェット」等の記事は存在するが、本調査では Wikipedia API がレート制限（`You are making too many requests to the API`）に当たり各記事のレジ掲載状況を定量確認できなかった → **記事ごとのレジ網羅性は未確認**。一般に「ポケモンジェット」記事は歴代機のレジを表で列挙しているが、**現役機の期間管理は追随していない**（更新が遅い）ため、リアルタイム判定用のマスタには不向き。

#### 判定
| 観点 | 評価 |
|---|---|
| データ | Wikidata: スペマ情報なし。Wikipedia: 歴史的記述はあるが現役管理なし |
| 取得方法 | Wikidata SPARQL（`https://query.wikidata.org/sparql`）/ MediaWiki API。どちらも無料・キー不要。UA に連絡先必須、レート制限あり |
| 商用可否 | **可**（Wikidata CC0 / Wikipedia CC BY-SA。ただし SA の継承に注意） |
| 料金 | 無料 |
| 判定 | **主データ源としては不採用。** 補助（機種名の日本語表記、塗装の背景説明の裏取り）に留める |

---

### A-4. Planespotters.net

**★ 本調査で最も重要な発見がここにある。現在アプリが使っている写真APIは、有料アプリと規約上両立しない。**

#### 写真API（現在利用中）
- エンドポイント（実測で動作確認済み）:
  - `https://api.planespotters.net/pub/photos/reg/{レジ}` 例: `/pub/photos/reg/JA339J`
  - `https://api.planespotters.net/pub/photos/hex/{ICAO24}` 例: `/pub/photos/hex/86E77E`
- 実レスポンス例（`reg/JA339J`、JAL Jubilee Express）:
```json
{"photos":[{"id":"1971432",
 "thumbnail":{"src":"https://t.plnspttrs.net/36336/1971432_8147fd3072_t.jpg","size":{"width":200,"height":112}},
 "thumbnail_large":{"src":"https://t.plnspttrs.net/36336/1971432_8147fd3072_280.jpg","size":{"width":497,"height":280}},
 "link":"https://www.planespotters.net/photo/1971432/ja339j-japan-airlines-boeing-737-846-wl?utm_source=api",
 "photographer":"Demo Borstell"}]}
```
- **APIキー不要・無料**。ただしアクセス要件が厳格で、満たさないと 403。実際に素の curl では次の JSON が返った:
  > `{"error":"Server User-Agent strings must include a contact URL or email so we can reach you, e.g. MyFlightTracker/1.2 (+https://example.com/contact). See https://www.planespotters.net/photo/api"}`
- 仕様上の制約: **1機につき写真1枚のみ**、カスタムパラメータ不可。
  > "The photo API is free to use and does not require an access key. It can be queried by aircraft registration or hex code but only returns one photo and does not allow for custom parameters."

#### 写真API 利用規約（出典: https://www.planespotters.net/photo/api#terms）

**【致命的な条項】有料・プレミアム・会員限定機能にしてはならない:**
> "The use of photos in your website or application **cannot be an exclusive paid, premium or member-only feature**. Each area that includes photos must be publicly and freely available to all users. Thumbnail sizes used must be the same across all access levels."

その他の主な条項:
> "Each photo must **credit the photographer in text visible next to the image**, and the thumbnail must **lead back to the photo's page at Planespotters.net using the `link` URL** from the API response… In a browser this means a plain anchor on the thumbnail, **without `rel="nofollow"`** or equivalent"

> "Browser clients must request the API from a webpage that sets a valid `Origin` or `Referer` header. Direct address-bar requests and requests from contexts that strip these headers will be rejected."

> "Every non-browser client … must send a unique, descriptive `User-Agent` header that identifies the application or device and **includes a contact URL or email** … Bare library defaults such as `curl/8.0` or `python-requests/2.31` are rejected."

> "**API JSON responses may be cached for up to 24 hours.** Image binaries must be fetched straight from the `thumbnail` / `thumbnail_large` URLs we return, by the same browser or device that displays them. … what is **not permitted is writing it to storage, keeping it after it stops being displayed, re-hosting it**, or passing it on to any other client."

> "All URLs returned by the API … **must be used unchanged. Proxying, rewriting, or hot-link-protection bypassing is not permitted.**"

> "Photos and metadata returned by the API **must not be used to train, fine-tune, evaluate, or otherwise build datasets for machine-learning or AI models.**"

> "**Re-exposing the API or its data through your own API, feed, bulk export, or dataset is prohibited.**"

> "Use must stay within reasonable limits. Sustained or bursty traffic may be throttled or blocked at our discretion. If your project needs higher volume or guarantees, contact us."

> "We may revoke access at any time, with or without notice, if these terms are not followed."

#### サイト全体の利用規約（出典: https://www.planespotters.net/legal ／ As of: December 22nd, 2012）
> "using Planespotters.net's thumbnails on other websites **without providing sufficient attribution to the author** (in the format: "Copyright © display name/author's name" or "© display name/author's name") is strictly prohibited. It is furthermore **not allowed to copy, send, multiply or publish any aircraft photos from Planespotters.net without prior permission of the author**."

第8条（投稿者→Planespotters へのライセンス）に重要な一文:
> "Planespotters.net **does not grant any rights or licenses exceeding those specified in the Terms of Use to any third party**."

第9条（投稿者→ゲスト/会員へのライセンス）:
> "The author grants all guests and members the right to **link thumbnails** of published aircraft photos to the original photo on Planespotters.net through the options provided by Planespotters.net. When linking thumbnails, the proper attribution of the author … **must not be removed**."
> "Any usage or licensing rights exceeding these Terms of Use **can only be granted by the author of the respective aircraft photo**."（＝権利は各撮影者に残っており、サイト運営者が一括で商用許諾を出すことはできない）

#### 「特別塗装フラグ」「フリートAPI」はあるか
- Planespotters.net の機体ページ／フリート一覧には塗装に関する注記（"special livery" 的な表記）が付くことがあるが、**公開API は写真1枚を返す `pub/photos/*` の2本だけ**で、フリート情報・塗装フラグを返すAPIは公開されていない。
- データAPI・料金表は公開されておらず（**未確認**）、唯一の案内は:
  > "For advanced use, please contact us with details about your project and working implementation of our public API."（窓口: https://www.planespotters.net/help/contact ）
- 有料プラン／価格表は発見できなかった → **価格は未確認（個別見積り）**。

#### 判定（これが設計を左右する）
| 用途 | 判定 |
|---|---|
| **無料アプリで写真を表示** | **OK**。ただし (1) 撮影者名を画像の隣にテキスト表示、(2) サムネイルを `link` URL へのリンクにする（nofollow不可）、(3) 画像は端末が直接 `t.plnspttrs.net` から取得（サーバでキャッシュ・再ホスト禁止）、(4) JSONのキャッシュは24h以内、(5) サーバ側取得時は連絡先入りUA。 |
| **有料アプリ／サブスクで写真を表示** | **規約違反。** 「写真を含むエリアは全ユーザーに無料・公開でなければならない」という明文がある。**写真をペイウォールの内側に置くことはできない。** |
| 有料アプリだが**写真部分だけ無料開放** | **理屈上は可**。「写真を含む領域は誰でも無料で見られる」必要があるため、写真一覧を非課金ユーザーにも同条件（同じサムネイルサイズ）で開放すれば条項は満たせる。ただし「有料アプリのダウンロード自体が課金」だと "publicly and freely available to all users" の解釈が争点になるため、**商用版を出す前に必ず help/contact で書面確認を取るべき**。 |
| 写真をサーバにキャッシュ／自前CDN | **明確に禁止**（"writing it to storage … re-hosting it"）。GAS でサーバ経由のプロキシを噛ませる実装も "Proxying, rewriting" に該当し禁止。**クライアントから直接 `t.plnspttrs.net` を参照する `<img src>` 実装が必須。** |
| 自アプリのAPI/エクスポートとして再公開 | **禁止** |
| AI学習用データ | **禁止** |

→ **結論: 現状の無料GASアプリでは Planespotters を使い続けて問題ない（要: 撮影者クレジット＋リンクの実装確認）。有料化する瞬間に写真ソースの再設計が必要になる。** 代替は後述 D 章（Wikimedia Commons / Flickr CC / 自前投稿）。

---

### A-5. Flightradar24 / JetPhotos

#### Flightradar24 API（FR24 API）
出典: https://fr24api.flightradar24.com/ , https://fr24api.flightradar24.com/subscriptions-and-credits , https://fr24api.flightradar24.com/docs/credit-overview

商用利用について公式に明記:
> "Whether for **Private or Commercial use** our terms and conditions allow for a wide range of end use cases."（出典: https://fr24api.flightradar24.com/ 、詳細は https://www.flightradar24.com/terms-of-service ）

料金プラン（2026-09 時点。キャンペーンで「2026/12/31 までの申込はクレジット2倍」実施中）:

| プラン | 月額 | 月間クレジット | 1レスポンス最大件数 | レート制限 | 履歴 |
|---|---|---|---|---|---|
| Explorer | **$9/月** | 30,000（キャンペーン時 60,000） | 20 | 10 req/min | 30日 |
| Essential | **$90/月** | 333,000（同 666,000） | 300 | 30 req/min | 2年 |
| Advanced | **$900/月** | 4,050,000（同 8,100,000） | 無制限 | 90〜200 req/min | 全期間 |

**クレジット消費は「返ってきた便の数」に比例する**（ここが本アプリにとって致命的）:

| エンドポイント | 課金単位 | クレジット | $換算（$0.0003/credit） |
|---|---|---|---|
| Live flight positions - **full**（origin/destination/**callsign/registration/aircraft type** 込み） | 返却1便あたり | **8** | $0.0024 |
| Live flight positions - light（緯度経度・速度・高度のみ） | 返却1便あたり | **6** | $0.0018 |
| Flight summary - light | 返却1便あたり | 1 | $0.0003 |
| Airports light | 1クエリ | 1 | $0.0003 |
| Flight tracks | 返却1便あたり | 40 | $0.012 |

> "If your request returns no results (an empty response), the call is charged a flat 1 credit for processing."

**本アプリのユースケースでのコスト試算（30秒ポーリング）**
- 30秒間隔 = 2,880 回/日 = 約86,400 回/月
- 1空港の周辺に常時 40機 が映るとすると、`Live flight positions - full` で 40×8 = **320 credits/回**
- 1日: 320 × 2,880 = **921,600 credits/日** → $276/日
- **1空港だけで月額 約 $8,300（約125万円）。** レジと機種が必要なので light（6クレジット）にも逃げられず、それでも月 $6,200。
- Advanced プラン（$900 で 4,050,000 credits）でも **1空港を4.4日** で使い切る。

→ **判定: FR24 API は「30秒ポーリングで空港周辺の全機を表示する」という本アプリの要件と価格モデルが根本的に合わない。** 常時ポーリング型のトラッカーではなく、単発照会型（便名を指定して1便の情報を取る等）の用途向けの価格設計。
→ ポーリング間隔を 5分に落とし、1空港のみ、表示20機に絞れば 20×8×288 = 46,080 credits/日 = 1,382,400/月 → Advanced($900) で収まる程度。**それでも月$900。**

**塗装（livery）情報について**: FR24 API のエンドポイント一覧（静的: airports light/full, airlines light／ライブ: flight positions light/full／履歴／サマリ／トラック）に **塗装・写真を返すものは存在しない**。registration と aircraft type までで、スペマ判定には使えない。写真は姉妹サイト JetPhotos 側の資産で、API 公開はされていない（`https://www.jetphotos.com/api` は 403 / nginx）。

#### JetPhotos（FR24 傘下）
出典: https://www.jetphotos.com/terms.php

**商用利用は明確に禁止:**
> "…is granted for your **personal, non-commercial use only**. If you do not agree to these Terms, you do not have a right to use the Website."

- 公開 API は存在しない（`/api` は 403）。
- 投稿写真の権利は撮影者に残り、JetPhotos は自社・FR24 サービス内での利用ライセンスを得ているだけ:
  > "The ownership of the Photos you upload belongs to you… you grant us a non-exclusive, royalty-free, worldwide, sub-licensable and transferable license to host, publicly display, publicly perform, distribute, use, modify… **on the Website, on the Flightradar Services** as well as on any related social media accounts owned or otherwise controlled by us."
  → 第三者アプリへの再許諾の根拠にはならない。

→ **判定: JetPhotos は有料アプリでも無料アプリでも使用不可（personal, non-commercial only）。スクレイピングは論外。**

#### まとめ
| ソース | データ | 取得方法 | 商用可否 | 料金 | 根拠URL |
|---|---|---|---|---|---|
| FR24 API | 位置・レジ・機種・便名・経路。**塗装/写真なし** | REST（要アカウント・キー） | **可（明文）** | $9/$90/$900/月＋従量（返却便数課金） | https://fr24api.flightradar24.com/docs/credit-overview |
| JetPhotos | 写真 | API なし | **不可** | — | https://www.jetphotos.com/terms.php |

---

### A-6. その他のデータベース

| ソース | スペマ情報 | 取得方法 | 商用可否 | 料金 | 備考・根拠 |
|---|---|---|---|---|---|
| **airfleets.net** | 機体履歴・フリートは充実。塗装は注記レベル | **API なし**。HTML のみ。Cloudflare のボット対策で自動取得不可（本調査でも `https://www.airfleets.net/home/cgu.htm` が CAPTCHA 壁に阻まれ規約原文を取得できず → **規約未確認**） | **未確認**（一般に転載禁止） | 無料閲覧 | 自動取得は技術的にも規約的にも困難 |
| **rzjets.net** | 機体履歴（退役機に強い）。塗装情報は弱い | API なし。`https://rzjets.net/aircraft/` も同じく CAPTCHA 壁 → **規約未確認** | **未確認** | 無料閲覧 | 同上 |
| **planelogger.com** | 個人の機体ログ共有。スペマの体系的DBではない | 公開 API は **未確認** | **未確認** | 無料 | 網羅性なし。不採用 |
| **airframes.org** | レジ↔機種↔ICAO24 の対応表として有用。塗装情報なし | 一部データセットが公開されている（**詳細・ライセンスは未確認**） | **未確認** | 無料 | レジ→機種の補完には使えるかも |
| **ch-aviation** | 商用の機体・フリートDB。**塗装（livery）は商品ラインに無い**（Operators / Lessors / Aircraft / Schedules / Capacity / Contacts / Commercial IT） | Web UI ＋ Data Store（API/エクスポート） | **可（有償契約）** | **未確認（要見積り。一般に年額数千〜数万ドル規模）** | https://www.ch-aviation.com/data-store , https://www.ch-aviation.com/products/aircraft-data |
| **Cirium**（旧 Flightglobal / Innovata / Diio） | 業界標準のフライト＆フリートデータ。**塗装情報は扱わない** | エンタープライズ API | **可（有償契約）** | **未確認（要見積り。エンタープライズ価格帯）** | 個人開発の有料アプリでは費用的に現実的でない |
| **AeroTransport Data Bank (ATDB)** | 機体の生涯履歴に強い。スペマDBではない | 購読制（ログイン必須） | **未確認** | **未確認**（購読制。`info@aerotransport.org`） | https://www.aerotransport.org/ 。情報ページが 404 で仕様確認不可 |
| **スポッター系 X / Instagram アカウント** | 最新のスペマ就航情報は最速。レジも載る | X API は現在 **Basic $200/月・Pro $5,000/月**（2026年時点の公表価格は **未確認**、要確認）。Instagram Graph API は自アカウント以外の投稿取得が実質不可 | 投稿の著作権は投稿者。**テキスト/画像の転載は不可** | 高額 | **「人間が情報源として見る」用途に限定すべき。自動取り込みは権利・コスト両面で非現実的** |

**重要な共通所見**: 調査した商用航空データベース（ch-aviation, Cirium, ATDB, airfleets, rzjets）のいずれも **「特別塗装機」を構造化データとして持っていない**。これは業界データが「機材・運航・座席・リース」を対象とし、塗装はスポッター文化の関心事だからである。
→ **つまり FlyTeam（および世界的には Planespotters/JetPhotos のコミュニティ）が事実上の唯一のスペマDBであり、金を払って買えるスペマDBは市場に存在しない。** この構造が「自前DBを作る」しかない理由になる。

---

### A-7. 自前クラウドソースDB（本命案）

#### 設計
1. **シード（初期投入）**: 公式プレスリリース・各社お知らせから「レジ＋塗装名＋開始日＋（判明すれば）終了予定」を**人間が事実として入力**。現役スペマは国内社で 30〜60機程度、日本に来る外国社を含めて 100機程度が現実的な初期規模（FlyTeam の「運航中」フィルタで件数感を掴める）。
2. **ユーザー投稿**: アプリ内に「この機体はスペマでした」報告ボタン。レジ・撮影日・塗装名（自由記述）・任意で写真。
3. **検証フロー**: 2件以上の独立報告 or owner 承認で本採用。`status: pending / confirmed / retired`。
4. **自動失効**: 運航終了は告知されないことが多いため、「直近90日間に誰も報告していない＋公式に終了告知あり」で `retired` 候補に落とすヒューリスティクス。

#### 法的な足場（ここが重要）
- **シードを「公開事実」から作る限り、編集著作物の侵害にはならない。** 著作権法12条の「編集著作物」は**素材の選択・配列の創作性**を保護するが、保護されるのは選択・配列であって個々の事実ではない。
- 逆に言えば、**FlyTeam の一覧をそのままの粒度・配列でコピーすると「選択・配列」を複製したことになり 12条／12条の2 の侵害になりうる**。FlyTeam は自ら編集方針（「ステッカーが機体の間近でしか確認できないものは、除外する場合があります」）を公言しており、選択に創作性があると主張しやすい立場にある。
- したがって **「FlyTeam を見ながら自分のDBを埋める」のは、たとえ事実だけを取っていても、一覧全体を移すなら実質的に配列の複製と評価されるリスクがある**。安全なのは**一次情報（プレスリリース）から独自に積み上げる**こと。FlyTeam は**裏取りの参照**に留め、網羅性は自分のユーザーに作ってもらう。

#### メリット / デメリット
| | 内容 |
|---|---|
| ◎ メリット | **自分の資産になる**（有料化・他社ライセンス・差別化の源泉）／外部ToSに縛られない／日本特化で FlyTeam にない粒度（「今日 HND で見た」等）を持てる／ユーザー参加がそのままリテンションになる |
| × デメリット | **立ち上がりが遅い**（ユーザー数が少ないうちは網羅性が出ない＝有料の価値が出ない鶏卵問題）／モデレーション工数が常時かかる／誤報対策（いたずら・誤認）／**投稿写真の権利処理**（投稿規約で非独占ライセンスを取る条項が必須） |

#### 鶏卵問題への現実的な解
**「スペマ網羅性」を有料の売りにしない。** 有料の価値は「空港別のリアルタイム表示・通知・履歴・お気に入り機体の追跡」に置き、スペマ強調はおまけにする。スペマDBはユーザーが増えるにつれ自然に厚くなる。
加えて **owner 自身が公式プレスを追う運用**（月に数件の手作業）で国内主要社は十分カバーできる。これは現在の「手作業11機」の延長であり、**既にできていることの継続＋ユーザー投稿での補強**という無理のない道。

---

### A-8. 日本法に関するメモ（一般情報であり法的助言ではありません）

1. **著作権法47条の5（電子計算機による情報処理及びその結果の提供に付随する軽微利用）**
   所在検索サービス（検索エンジン）や情報解析サービスを行う者が、**「軽微な利用」**の範囲で著作物を利用することを認める規定。同条は「**公衆への提供等が行われた著作物**」であることや、**政令で定める基準に従った適正な実施**（47条の5第1項柱書・同条2項）を要件とする。
   - 本件への当てはめ: スペマ情報の**事実部分**はそもそも著作物でないので47条の5を持ち出す必要がない。一方 **FlyTeam の一覧を丸ごと取り込むのは「軽微な利用」とは言えない**（データベースの本質的部分の利用）。**47条の5は本件のスクレイピングを正当化しない。**
   - なお 47条の5 は**著作権の制限**規定にすぎず、**利用規約（契約）違反を治癒しない**。これが最重要のポイント。

2. **編集著作物（12条）／データベースの著作物（12条の2）**
   - 12条の2第1項: データベースでその**情報の選択又は体系的な構成によって創作性を有するもの**は著作物として保護される。
   - 1,399件のスペマ一覧は、収録基準（何をスペマと呼ぶか）と項目設計（塗装名EN/JP・期間・ステータス・レジ）に選択・構成の創作性が認められる可能性が高い。**丸ごとの複製は侵害リスク大。**
   - ただし**個々の事実（JA339J が JAL Jubilee Express で 2026/6/4 就航）は自由に使える。**

3. **日本に「データベース権（sui generis database right）」は存在しない**
   - EU の Database Directive 96/9/EC が定める**創作性を要しない独自のデータベース権は、日本法には無い**。
   - したがって日本では「創作性のないただの事実の集合」は著作権で保護されない。
   - 代わりに使われる法理が **不法行為（民法709条）** と **不正競争防止法**、そして **利用規約（契約）**。
   - 参考となる裁判例の傾向（一般論）:
     - **「自動車整備業データベース事件」（東京地判 平成13年5月25日）**: 創作性が否定されたデータベースでも、**他人の多大な労力・費用の成果にフリーライドする行為は民法709条の不法行為になり得る**と判断した例として知られる。→ **「著作権がないから自由」ではない**ことの根拠。
     - **「翼システム事件」** として言及されることもある同事件を含め、日本では「創作性なし→それでも不法行為で救済」という筋が現実に使われている。
   - **未確認**: 各判決の詳細な事実認定・その後の判例の発展については本調査では原典を参照していないため、引用は一般的傾向の紹介に留める。

4. **利用規約は契約**
   - FlyTeam 規約第一条は「**会員登録の有無を問わず**」「**閲覧・利用によって本規約に同意したものと見なします**」と定める。いわゆるブラウズラップ契約の有効性には議論があるが、**日本の実務では「サイトを使うなら規約に従う」という扱いが一般的**で、違反は債務不履行／不法行為として損害賠償請求の根拠になり得る（同規約第四条2項が損害賠償請求を明記）。
   - 管轄は東京地裁（第七条）。**日本国内の開発者にとって現実的に訴えられ得る距離にある**点は軽視できない。

5. **その他の留意点（有料販売特有）**
   - **商標・キャラクター**: ポケモン・ディズニー・USJ 等のキャラクター塗装は、**塗装名のテキスト言及（記述的使用）は通常問題にならない**が、キャラクター画像・ロゴの表示は商標権／著作権の侵害リスクが高い。有料アプリでは特に**キャラクター画像を自前で持たない／生成しない**。
   - **景品表示法／特商法**: サブスク販売時は特定商取引法の表示義務、App Store / Google Play の自動更新サブスク規約に従う。
   - **データの正確性の免責**: 「運航情報は参考値であり、実際の運航を保証しない」旨の免責を利用規約に明記（有料だと期待値が上がり、クレームリスクが上がる）。

---

## B. 機体位置（ADS-B）データの商用利用

### B-1. adsb.lol（現在利用中）— 商用可。ただしライセンスは ODbL

出典: https://api.adsb.lol/docs （API docs ページの "Terms of Service" / "License" セクション）

> **Terms of Service**
> "You can use the API **for free**.
> In the future, you will require an API key which you can get by feeding to adsb.lol.
> If you want to use the API for **production purposes, please contact me** so I do not break your application by accident."

> **License**
> "The license for the API as well as all data ADSB.lol makes public is **[ODbL](https://opendatacommons.org/licenses/odbl/summary/)**.
> This is the same license [OpenStreetMap](https://www.openstreetmap.org/copyright) uses."

**これは本アプリにとって最良の条件。**
- **非商用限定の文言が一切ない。** ODbL（Open Database License v1.0）は **商用利用を明示的に許可**するオープンライセンス。
- レート制限:
  > "Rate limits are dynamic based on the environment load. If you get 4xx errors, you are doing something wrong."（出典: https://github.com/adsblol/api ）

**ODbL の3つの義務（有料アプリで必ず守る必要がある）**
1. **Attribution（表示）**: データが adsb.lol 由来であることを明示。ODbL 4.2/4.3。OSM 同様「© adsb.lol contributors, ODbL」のような表記をアプリ内（About / データ出典欄）に置く。
2. **Share-Alike（継承）**: **派生データベース（Derivative Database）を公に提供する場合**、ODbL で公開する義務。
   - **重要な区別**: ODbL は「**Produced Work**（データベースから生成された成果物＝地図画像、アプリの画面、レポート等）」と「**Derivative Database**（データベース自体の改変版）」を分けている。**アプリの画面に表示する行為は Produced Work にあたり、Share-Alike は及ばない**（表示義務のみ）。
   - 一方、**adsb.lol のデータを自前DBに蓄積・加工して「データそのもの」を配布・公開 API として提供すると Derivative Database となり、ODbL での公開義務が生じる。**
   - → **本アプリの設計（表示のみ、データの再配布はしない）なら Share-Alike は実質問題にならない。** これは非常に都合が良い。
3. **No DRM（技術的制限の禁止）**: ODbL 4.7。データベースそのものに DRM をかけて配布してはならない。アプリに課金すること自体は禁止されていない（Produced Work の販売は自由）。

**エンドポイント（実測で全件確認済み、`https://api.adsb.lol/api/openapi.json` より）**
```
/v2/lat/{lat}/lon/{lon}/dist/{radius}   ← 半径検索（本アプリの主力）
/v2/point/{lat}/{lon}/{radius}
/v2/closest/{lat}/{lon}/{radius}
/v2/hex/{icao_hex}  /v2/icao/{icao_hex}   ← カンマ区切りで複数hex指定可
/v2/reg/{registration}  /v2/registration/{registration}
/v2/callsign/{callsign}
/v2/type/{aircraft_type}
/v2/sqk/{squawk}  /v2/squawk/{squawk}
/v2/mil  /v2/pia  /v2/ladd
/api/0/airport/{icao}     ← 空港情報
/api/0/routeset           ← ★便名→経路（C章参照）
/0/me  /0/my
```

**実測: 羽田（RJTT）10NM の生レスポンス**
```
GET https://api.adsb.lol/v2/lat/35.5533/lon/139.7811/dist/10
→ HTTP 200, 12,523 bytes, ac: 27機
レスポンスのトップレベル: ac, msg, now, total, ctime, ptime
1機あたりのフィールド（全43項目）:
  hex, r(レジ), t(機種ICAO), flight(コールサイン), lat, lon,
  alt_baro, alt_geom, gs, ias, tas, mach, track, true_heading, mag_heading,
  baro_rate, geom_rate, squawk, category, dir, dst, seen, seen_pos,
  rssi, messages, mlat, tisb, nav_altitude_mcp, nav_qnh,
  nac_p, nac_v, nic, rc, sil, sil_type, spi, alert, roll, track_rate, version, type
サンプル: {"hex":"868041","r":"JA737X","t":"B738","flight":"SKY016","lat":35.638066,"lon":139.713544,"alt_baro":1875,"gs":156.1}
```
→ **レジ（`r`）と機種（`t`）が同一レスポンスに含まれる。** スペマ判定（レジ突き合わせ）が1リクエストで完結する。日本カバレッジも実証済み（羽田周辺10NMで27機）。

**注意点**
- 「本番利用なら連絡してほしい」と明記されている → **有料版を出す前に必ず運営者に連絡すること。** これは規約義務ではなく運営者の要請だが、無視するとある日突然アクセスを切られる。連絡して「feeder を立てる」と伝えればほぼ確実に良好な関係が作れる（将来的に API キーが feeder 限定になる予告もある）。
- 将来の API キー化: "In the future, you will require an API key which you can get by feeding to adsb.lol." → **受信機（Raspberry Pi + SDR、初期費用 1〜2万円）を1台立てて feeder になっておくのが保険。**

### B-2. adsb.fi — **商用不可（明文）**

出典: https://github.com/adsbfi/opendata

> **Terms**
> "adsb.fi open data is for **personal, non-commercial use only**. You may not license, sell, rent, or lease any part of the data or the service. The data and the service are provided as-is, without any warranty. **You must cite adsb.fi and include a link to our home page.** We reserve the right to suspend or terminate the service or access to it."

> "Please **contact us if you have commercial** or higher request rate requirements."

- レート制限: 公開エンドポイントは **1 req/秒**、feeder 専用 snapshot は 1 req/30秒。
  > "The public endpoints are rate limited to **1 request per second**, and the feeder endpoint to 1 request every 30 seconds."
  > "Making excessive invalid HTTP requests results in a temporary IP address restriction. Requests returning a 400, 401, 403, 404, or 429 status code count toward the limit."
- エンドポイント（ADSBexchange v2 API 互換）:
  `/v2/hex/[hex]`（カンマ区切りで複数可）, `/v2/icao/[hex]`, `/v2/callsign/[callsign]`, `/v2/registration/[reg]`, `/v2/sqk/[squawk]`, `/v2/mil`, **`/v3/lat/[lat]/lon/[lon]/dist/[dist]`（最大250NM）**
  - 注: `/v2/lat/lon/dist` は deprecated、**新規実装は v3 を使うべき**。
- ベースURL: `https://opendata.adsb.fi/api/`

→ **判定: 有料アプリでは使用不可。** 無料版のフォールバックとしてのみ（その場合も adsb.fi へのリンク付きクレジット表示が義務）。商用が必要なら GitHub 経由で要相談。

### B-3. airplanes.live — 規約原文が読めず **未確認**

- API ドキュメント: https://airplanes.live/api-docs/ （ベースURL `https://api.airplanes.live`、v2.0.0、Stoplight 製）
- エンドポイント（docs より確認）:
  - `/v2/point/{lat}/{lon}/{radius}` ← 半径検索
  - `/v2/reg/{reg}`, `/v2/hex/{hex}`, `/v2/hex/{hex}/live`, `/v2/hex/{hex}/last`, `/v2/callsign/{callsign}`, `/v2/squawk/{squawk}`, `/v2/mil`
  - リファレンス系: `/rest/v1/ref/airports`, `/airlines`, `/countries`, `/cities`, `/timezones` ← **空港・航空会社マスタが無料で取れるのは便利**
  - `/feed-status`
- API 仕様書のライセンス表記は **Apache-2.0**（ただしこれは OpenAPI 仕様書自体のライセンスであり、**データのライセンスではない**点に注意）。
- **利用規約（https://airplanes.live/terms-of-use/ ）は iframe 埋め込み（外部ドキュメント）で本文が取得できず、商用可否を確認できなかった → 未確認。** 有料化前に必ずブラウザで直接読むこと。Discord（https://discord.gg/adsb ）で運営に直接聞くのが最速。
- 日本カバレッジ: 全世界のボランティア受信網ベース。**未実測**。

### B-4. ADS-B Exchange — 商用可（RapidAPI 経由、実質的に従量）

出典: https://rapidapi.com/adsbx/api/adsbexchange-com1/pricing

| プラン | 月額 | 含まれるリクエスト | 超過 | レート制限 | 帯域 |
|---|---|---|---|---|---|
| Basic | **$10.00/月** | 10,000 req/月 | **+$0.0015/req** | **No Limit** | 10,240MB/月、超過 +$0.001/1MB |

**本アプリでのコスト試算（30秒ポーリング）**
- 1空港 2,880 req/日 = 86,400 req/月 → 10,000 含み＋76,400×$0.0015 = **$10 + $114.6 = 約$125/月（1空港）**
- 帯域も重要: 1レスポンス約12KB（実測値、adsb.lol の HND 10NM が 12.5KB）× 86,400 = **約1,040MB/月** → 10,240MB 以内なので帯域超過はしない。
- **3空港なら約$355/月、10空港なら約$1,180/月。** ポーリング間隔を 60秒にすれば半額。
- エンタープライズ向けの直接契約（https://www.adsbexchange.com/data/ ）もあり、"Live positions"（250ms 更新）/"Live operations"/"Daily positions"/"Daily operations" の4商品。**価格は非公開 → 未確認（要見積り）**。

→ **判定: 商用可で価格も現実的。adsb.lol が使えなくなった場合の最有力バックアップ。** ただし adsb.lol が無料なので第一選択にはならない。

### B-5. OpenSky Network — **商用は書面ライセンス必須。しかも「本番投入」自体が要ライセンス**

出典: https://opensky-network.org/about/terms-of-use （"Terms of Use & Data License Agreement"）

**冒頭の Tl;dr がそのまま結論:**
> "**Tl;dr: License required in the following cases:**
> **Commercial or for-profit entities:** Any use by a for-profit or commercial entity — including government and military contractors — **requires a written license** from OpenSky Network, regardless of purpose.
> **Operational REST API use:** Use of the REST API **in any operational capacity — including integration into a live product, service, or automated system (even if only internal) — requires a previous written agreement**, even for non-profit or governmental entities.
> To obtain a license, contact contact[at]opensky-network.org."

第1条 LICENSE:
> "OpenSky Network's authorization to access the data grants You a limited, non-exclusive, non-transferable, non-assignable, and terminable license to copy, modify, and use the data in accordance with this AGREEMENT **solely for the purpose of non-profit research and non-profit education**. … **No license is granted for any other purpose** and there are no implied licenses in this AGREEMENT."
> "**Any use by a for-profit or commercial entity requires written permission and a license** granted by the OpenSky Network."

準拠法: スイス法（"This AGREEMENT is legally binding under the laws of the Swiss Confederation."）。

**技術面（参考）** 出典: https://openskynetwork.github.io/opensky-api/rest.html
- `GET /states/all` にバウンディングボックス指定（`lamin/lomin/lamax/lomax`）。**半径指定はない。**
- **state vector に registration も aircraft type も含まれない。** フィールドは `icao24, callsign, origin_country, time_position, ...`。→ **本アプリには機種・レジが必須なので、別途 hex→レジ変換のマスタが必要になり、それだけで不利。**
- クレジット制（3バケット独立: `/states/*`, `/tracks/*`, `/flights/*`）:

| Tier | Credits | Refill |
|---|---|---|
| Anonymous | 400 | Daily |
| Standard user | 4,000 | Daily |
| Active feeder (≥30% uptime/month) | 8,000 | Daily |
| Licensed user | 14,400 | **Hourly** |

- `/states/all` のコスト: バウンディングボックス面積 ≤25 sq° なら **1 credit**、25–100 sq° で 2、100–400 sq° で 3、それ超/グローバルで 4。
- 30秒ポーリング = 2,880 credits/日。**Standard user（4,000/日）で1空港がギリギリ収まる。2空港で破綻。** Active feeder（8,000/日）なら2空港。
- 時間解像度: 匿名ユーザー 10秒、認証ユーザー 5秒。

→ **判定: 無料版であっても「live product への組み込み」が書面合意を要するため、本アプリでは使うべきでない。** 有料化なら完全に不可（要ライセンス交渉・価格は **未確認**）。技術的にもレジ/機種がないので不利。

### B-6. 商用フライトデータ API 各社

#### FlightAware AeroAPI
- 商用向け製品として提供（https://www.flightaware.com/commercial/aeroapi/ ）。ラインナップは AeroAPI（オンデマンド REST）/ Firehose（ストリーミング）/ Foresight（予測）/ Integrated Maps。
- **価格: 本調査では取得できなかった（未確認）。** `https://www.flightaware.com/aeroapi/portal/pricing` は JavaScript レンダリングで数値が取れず、`/commercial/aeroapi/pricing` は 404。
  - 一般に Personal / Standard / Premium の3層＋クエリ単価の従量課金という構造だが、**具体的な金額は公式ページで直接確認が必要**。
- 本アプリ向けの難点: AeroAPI は「便（flight）」指向の API で、**「ある空港の周囲N NMにいる機体を全部返す」という ADS-B レーダー的な使い方はコストモデルに合わない**（FR24 と同じ問題）。空港の到着/出発スケジュール取得には向く。
- 利用規約: https://www.flightaware.com/about/terms-of-use/ （**本文未読 → 未確認**）

#### aviationstack
出典: https://aviationstack.com/product

| プラン | 月額 | リクエスト | 超過単価 | 商用 |
|---|---|---|---|---|
| Free（Personal use） | **$0** | 100 req/月 | — | **Non-Commercial Use（明記）** |
| Basic | **$49.99/月**（年払 $44.99） | 10,000 | +$0.019996/req | **Commercial Use** |
| Professional | **$149.99/月**（年払 $131.99） | 50,000 | +$0.0119992/req | **Commercial Use** |
| Business | **$499.99/月**（年払 $424.99） | 250,000 | +$0.00799984/req | **Commercial Use** |
| Custom | 要見積り | Volume | — | Commercial Use |

- 機能: Real-Time Flights, Historical Flights, **Airline Routes**, Flight Schedules, Future Flight, Autocomplete。
- **本アプリでの試算: 30秒ポーリング1空港 = 86,400 req/月 → Business($499.99, 250k) 内に収まる。** ただし $500/月は個人有料アプリには重い。Professional(50k) では足りず超過単価 $0.012 × 36,400 = $437 追加で意味がない。
- **決定的な難点: aviationstack は ADS-B の生位置ではなくスケジュール/フライトステータス系のデータソース。** 「空港にいる機体を地図に出す」用途には向かない。レジの収録も限定的（"19,000+ Airplanes"）。

#### AirLabs
- **価格ページが 404（`https://airlabs.co/pricing`, `/pricing/`, `/prices` すべて 404）→ 料金・商用条件ともに未確認。** サイト構成が変わった可能性。要ブラウザ確認。

#### Aviation Edge
出典: https://aviation-edge.com/premium-api/

| プラン | 初月 | **通常月額** | コール数 |
|---|---|---|---|
| Developer | $7 | **$299/月** | 30,000/月 |
| Business | $15 | **$599/月** | 100,000/月 |
| Business Gold | $39 | **$1,499/月** | 500,000/月 |
| Unlimited Data | 要相談 | 要見積り | 無制限 |

> "The discounted price is for the initial month… The subscriptions are automatically renewed each month at the **regular rate of 299$ for the Developer, 599$ for the Business, and 1499$ for the Business Gold** package after the initial (test) month ends."

- **初月$7 → 翌月$299 という価格構造はダークパターン気味。** 30秒ポーリング1空港（86,400コール/月）だと Business($599/月)が必要。
- 商用可否の明文は **未確認**（https://aviation-edge.com/api-terms-of-service/ 要確認）。
- **判定: 価格対効果が悪く不採用。**

#### AirNav RadarBox
- 本調査では価格・商用条件を取得できず **未確認**。一般に API は商用契約ベース。

### B 章サマリ表

| ソース | データ（レジ/機種） | 取得方法 | 商用可否 | 料金 | 日本カバレッジ | 根拠URL |
|---|---|---|---|---|---|---|
| **adsb.lol** | **レジ `r`・機種 `t` 込み（実測）** | REST、キー不要。半径 / 複数hex / reg / callsign / type | **可（ODbL）**。表示義務あり。本番利用は要連絡 | **無料** | **実測OK**（HND 10NM で27機） | https://api.adsb.lol/docs |
| adsb.fi | 同（ADSBX v2互換） | REST、キー不要。**v3** 半径（最大250NM） | **不可（personal, non-commercial only）** | 無料 | 未実測 | https://github.com/adsbfi/opendata |
| airplanes.live | 同（＋空港/航空会社マスタAPI） | REST `api.airplanes.live`、`/v2/point/` | **未確認**（ToS が iframe で読めず） | 無料 | 未実測 | https://airplanes.live/api-docs/ |
| ADS-B Exchange | 同（ADSBX v2） | RapidAPI | **可** | $10/月 + $0.0015/req → **1空港 約$125/月** | 良好 | https://rapidapi.com/adsbx/api/adsbexchange-com1/pricing |
| OpenSky | **レジ・機種なし** | REST bbox のみ | **不可（商用は書面ライセンス必須。live product 組込自体が要合意）** | 無料枠 4,000 cr/日、商用価格 未確認 | 良好 | https://opensky-network.org/about/terms-of-use |
| FR24 API | レジ・機種・経路込み | REST | **可（明文）** | $9/$90/$900＋返却便数課金 → **30秒ポーリングは月$6,000超** | 最良 | https://fr24api.flightradar24.com/docs/credit-overview |
| FlightAware AeroAPI | 便指向 | REST | 商用製品 | **未確認** | 良好 | https://www.flightaware.com/commercial/aeroapi/ |
| aviationstack | スケジュール中心 | REST | **可（Basic 以上）** | $49.99〜$499.99/月 | 普通 | https://aviationstack.com/product |
| AirLabs | — | REST | **未確認** | **未確認（価格ページ404）** | — | https://airlabs.co/ |
| Aviation Edge | スケジュール中心 | REST | **未確認** | 初月$7→**$299〜$1,499/月** | 普通 | https://aviation-edge.com/premium-api/ |
| AirNav RadarBox | — | REST | **未確認** | **未確認** | 良好 | — |

**B 章の結論: adsb.lol（ODbL・商用可・無料・レジと機種込み・半径検索あり）が他を圧倒している。** 有料化しても位置データのコストはゼロに保てる。やるべきことは (1) ODbL クレジット表示の実装、(2) 運営者への本番利用連絡、(3) feeder 化による保険、(4) バックアップとして ADS-B Exchange RapidAPI（$10/月から）を差し替え可能にしておくこと。

---

## C. 便名（コールサイン）→ 経路

### C-1. adsbdb.com（現在利用中）— **経路データに明確な再利用制限がある。要注意**

出典: https://github.com/mrjackwills/adsbdb （README の "With thanks to" セクション）

**実測（動作確認済み）**
```
GET https://api.adsbdb.com/v0/callsign/SKY016
→ {"response":{"flightroute":{
     "callsign":"SKY16","callsign_icao":"SKY16","callsign_iata":"BC16",
     "airline":{"name":"Skymark Airlines","icao":"SKY","iata":"BC","country":"Japan","callsign":"SKYMARK"},
     "origin":{"iata_code":"FUK","icao_code":"RJFF","name":"Fukuoka Airport","municipality":"Fukuoka","latitude":33.5859,"longitude":130.4510,"elevation":32,...},
     "destination":{"iata_code":"HND","icao_code":"RJTT","name":"Tokyo Haneda International Airport","municipality":"Tokyo",...}}}}

GET https://api.adsbdb.com/v0/aircraft/JA737X
→ {"response":{"aircraft":{
     "type":"737NG 8AL/W","icao_type":"B738","manufacturer":"Boeing","mode_s":"868041",
     "registration":"JA737X","registered_owner":"Skymark Airlines","registered_owner_operator_flag_code":"SKY",
     "url_photo":"https://image.airport-data.com/aircraft/001526442.jpg",
     "url_photo_thumbnail":"https://airport-data.com/images/aircraft/thumbnails/001/526/001526442.jpg"}}}
```
日本の便もきちんと解決する（SKY016 → FUK-HND、レジ→機種→所有者も取得可）。一部路線には `midpoint` も付く。

**ライセンス構造が3層に分かれていて、ここが罠**
1. **ソフトウェア（adsbdb 本体）**: **MIT License**（GitHub API で確認: `{"key":"mit","spdx_id":"MIT"}`）。ただしこれは**サーバ実装のライセンスであって、データのライセンスではない。**
2. **機体データ**: PlaneBase 由来。
   > "[PlaneBase](http://planebase.biz/) for the aircraft data."
   → PlaneBase 側のライセンス条件は **未確認**。
3. **★ 経路データ（flightroute）には明示的な制限がある**:
   > "The flight route data is the work of **David Taylor, Edinburgh and Jim Mason, Glasgow**, and **may not be copied, published, or incorporated into other databases without the explicit permission of David J Taylor, Edinburgh**."

   （これは Virtual Radar Server のコミュニティで長年使われている standing-data の条件。）

**本アプリへの当てはめ**
| やり方 | 判定 |
|---|---|
| API を都度叩いて、取得した経路を画面に表示する（キャッシュしない） | **制限条項の文面には触れない**（"copied, published, or incorporated into other databases" のいずれにも該当しにくい）。ただし商用可否の明文がないため **未確認**。 |
| 取得した経路を**自前DB/スプレッドシートにキャッシュして蓄積する** | **「incorporated into other databases」に該当する。明示的許可が必要。** GAS のキャッシュ（CacheService の短期キャッシュ）は微妙だが、スプレッドシートへの恒久保存は明確にアウト寄り。 |
| 有料アプリで使う | **商用可否の明記がないため 未確認。** 経路データの権利者（David J Taylor）への確認が必要。リスクを避けるなら別ソースに切り替えるべき。 |

- レート制限・商用条件の明文は README に見つからなかった → **未確認**。
- **推奨: 有料化するなら adsbdb の経路データは外す（または許可を取る）。代替として後述の adsb.lol routeset / ODPT を使う。**

### C-2. adsb.lol `/api/0/routeset` — ODbL で商用可、だが要検証

- エンドポイントは存在する（`https://api.adsb.lol/api/openapi.json` で確認）。
- 本調査で `POST /api/0/routeset` に `{"planes":[{"callsign":"SKY016","lat":35.6,"lng":139.7}]}` を投げたが **空レスポンス**が返り、正しいリクエスト形式を特定できなかった → **動作形式は未確認。** `https://api.adsb.lol/docs` の Swagger UI でスキーマを確認する必要がある。
- **ただしライセンスは adsb.lol 全体と同じ ODbL なので、商用利用可・表示義務のみ**。
  > "The license for the API as well as all data ADSB.lol makes public is ODbL."（https://api.adsb.lol/docs ）
- 注意: adsb.lol の routeset も上流は同じ VRS standing-data 系である可能性があり、その場合 C-1 と同じ制限が実質的に及ぶ。**adsb.lol 運営者に「routeset データの出自とライセンス」を直接確認すべき。**
- **これが確認できれば最も安い解（無料・商用可・同一ベンダーで完結）。優先して確認する価値が高い。**

### C-3. ODPT 公共交通オープンデータセンター — **★ 本調査最大の朗報。航空データがあり、商用利用が明文で許可されている**

#### 航空データは「ある」
`https://ckan.odpt.org/dataset?q=FlightInformation` を検索して、以下のデータセットの存在を確認した（タグ「航空-airline」）:

| データセット ID | 内容 | 提供者 | ライセンス |
|---|---|---|---|
| `a_flight_departure_info-jal` | **日本航空 リアルタイム出発情報**（国内線＋国際線） | 日本航空 | 公共交通オープンデータ基本ライセンス |
| `a_flight_arrival_info-jal` | **日本航空 リアルタイム到着情報**（国内線＋国際線） | 日本航空 | 同 |
| `a_flight_departure_info-ana` | **全日空 リアルタイム出発情報**（国内線＋国際線） | 全日空 | 同 |
| `a_flight_arrival_info-ana` | **全日空 リアルタイム到着情報**（国内線＋国際線） | 全日空 | 同 |
| `a_flightschedule-jal` | 日本航空 フライト時刻表（国内線） | 日本航空 | 同 |
| `a_flightschedule-ana` | 全日空 フライト時刻表 | 全日空 | 同 |
| `a_flight_departure_info-tiat` / `a_flight_arrival_info-tiat` / `a_flightschedule-tiat` | **東京国際空港ターミナル（羽田 国際線）リアルタイム到着/出発情報** | 東京国際空港ターミナル | **【チャレンジ2026限定】** ＝ Challenge Limited License |

形式はすべて **JSON**。API ベース: `https://api.odpt.org/api/v4/`（例: `odpt:FlightInformationArrival`）。
**`acl:consumerKey`（無料の開発者登録で取得）が必須**（キーなしで叩くと `403 Invalid acl:consumerKey.` を実測）。

JAL/ANA のデータは「公共交通オープンデータ基本ライセンス」であり、**チャレンジ限定ではない＝恒久的に使える。** 一方 **羽田国際線ターミナル（TIAT）のデータは「チャレンジ2026限定」なので、有料アプリには使えない。**

#### 公共交通オープンデータ基本ライセンスは商用OK（明文）
出典: https://developer.odpt.org/terms/data_basic_license.html

**第4条7項:**
> "Data Users may use these Basic License Data **for-profit** or nonprofit by following the Basic License and the Guideline."

（＝**営利目的での利用が明示的に許可されている。**）

第4条1項:
> "Data User may, by agreeing to the terms in the following items, create **Deliverables** using the Basic License Data non-exclusively, and **let General Users use them after releasing the Deliverables to the public**."

"Deliverable" の定義（第1条8号）:
> "'Deliverable' collectively means **applications (including but not limited to web applications, mobile applications, and IoT gadgets)**, data and documents created by Data User using or referring to the Public Transportation Data."

第2条1項（同意）:
> "A Data User who has obtained Basic License Data and Others from the Center shall be deemed to have agreed to the License."

**守らなければならない義務（第4条2項）** — 有料アプリで特に注意すべき点:
> "(2) **not to disassemble or modify** the Basic License Data in a manner that may damage the original meaning;"
> "(3) **not to display all or part of the Basic License Data anywhere other than in the Deliverable**;"（＝自分のアプリの外に出してはいけない。別のAPIとして再公開するのは不可）
> "(4) if all or part of the Basic License Data is updated, **to update the Deliverable(s) immediately** in accordance with the Guideline;"（＝古いデータを出し続けてはいけない。キャッシュ期間の設計に影響）
> "(6) **not to make any representation to the effect that the Center, the Association, or any Public Transportation Data Provider will give any guarantee or assume any responsibility** concerning the Deliverable."（＝「JAL公式データだから正確」的な表示をしてはいけない）

第4条4項（他データとの組み合わせ）:
> "Data Users may **combine the Basic License Data with other data** on condition that they will not infringe any Intellectual Property Rights of a third party."
（＝ adsb.lol の位置データと組み合わせてよい。）

第4条6項: 協議会の商標を使ってよい。
**第5条**: 提供者が独自の「特定利用条件（Specific Terms of Use）」を付けている場合はそれが優先する → **JAL/ANA の各データセットに Specific Terms of Use が付いているかを開発者サイトで必ず確認すること（本調査では各データセットの Specific Terms of Use 本文までは未確認）。**

#### 判定
**ODPT は「日本の航空ダイヤ／到着・出発情報」を商用利用できる、事実上唯一の公式・無料ソース。** 本アプリの「到着/出発便リスト」は、ADS-B（adsb.lol）＋ ODPT（JAL/ANA の定刻・実績・遅延情報）の組み合わせで作るのが最も筋が良い。
弱点: **JAL と ANA（および傘下）だけ。** スカイマーク・AIR DO・ソラシド・StarFlyer・Peach・Jetstar・外国社はカバーされない。→ そこは ADS-B の実測と adsb.lol routeset で補う。

### C-4. その他

| ソース | データ | 商用可否 | 料金 | 根拠URL |
|---|---|---|---|---|
| FlightAware AeroAPI | 便→経路・実績・予測。最も正確 | 商用製品 | **未確認**（価格ページが JS レンダリングで取得不可） | https://www.flightaware.com/commercial/aeroapi/ |
| FR24 API | `Live flight positions - full` に origin/destination 込み | **可（明文）** | 返却1便あたり 8 credits = $0.0024。**単発照会なら安い**（1便$0.0024）。ポーリングだと破綻 | https://fr24api.flightradar24.com/docs/credit-overview |
| aviationstack | **Airline Routes** API を全有料プランに含む | **可（Basic $49.99/月 以上）。Free は Non-Commercial 明記** | $49.99〜 | https://aviationstack.com/product |
| **OpenFlights**（静的） | routes.dat（航空会社×出発空港×到着空港）、airports.dat | データは **ODbL**（OpenFlights のデータページに記載。本調査では原文未取得 → **未確認**）。商用可の見込みは高い | 無料 | https://openflights.org/data.html |
| | **ただし OpenFlights の routes.dat は 2014年頃のスナップショットで更新が止まっており、現在のダイヤには使えない。** 空港マスタ（airports.dat）としてのみ有用 | | | |

**C 章の結論（優先順）**
1. **ODPT（JAL/ANA）** — 商用明文OK・無料・国内線の定刻/実績まで取れる。**最優先で開発者登録する。**
2. **adsb.lol `/api/0/routeset`** — ODbL で商用OK。リクエスト形式と上流ライセンスを運営に確認。
3. **adsbdb** — 現状維持は無料版のみ。**有料化時は経路データの扱いを見直す（キャッシュしない / 許可を取る / 外す）。**
4. aviationstack Basic（$49.99/月）— 上記で足りない外国社・LCC の経路を埋める最後の手段。

---

## D. 機体写真の商用利用

### D-1. Planespotters.net Photo API（現在利用中）
→ 詳細は **A-4** に記載。結論のみ再掲:
- **「写真を含むエリアは有料・プレミアム・会員限定にできない」**という明文があるため、**有料アプリのペイウォール内で写真を出すことはできない。**
  > "The use of photos in your website or application cannot be an exclusive paid, premium or member-only feature."（https://www.planespotters.net/photo/api#terms ）
- サーバキャッシュ・再ホスト・プロキシ禁止、撮影者クレジット＋`link` への非 nofollow リンク必須、JSON キャッシュ24hまで。
- **無料版: 使える（条件遵守が前提）。有料版: 設計変更が必要。**

### D-2. JetPhotos
→ **A-5** 参照。
> "…is granted for your **personal, non-commercial use only**."（https://www.jetphotos.com/terms.php ）
→ **商用利用 完全に不可。API も非公開。**

### D-3. airport-data.com（adsbdb が `url_photo` で返している先）

**公式 API がある**（出典: http://www.airport-data.com/api/doc ）
```
GET https://airport-data.com/api/ac_thumb.json?m={mode_s}&n={count}[&r={registration}]
→ {"status":200,"count":2,"data":[
     {"image":"https://airport-data.com/images/aircraft/thumbnails/000/582/582407.jpg",
      "link":"https://airport-data.com/aircraft/photo/000582407",
      "photographer":"Jan Ittensammer"}, ...]}

GET https://airport-data.com/api/ac_info.json?m={mode_s}   → reg, model, cn, country, mode_s_code, link
GET https://airport-data.com/api/ap_info.json?icao={icao}   → 空港情報
```
- **Planespotters と違って複数枚（`n`）返せる**のは利点。レート制限あり（429 を返す）が具体値は **未確認**。
- 注: `https://www.airport-data.com/` は **TLS 証明書のコモンネームが不正**（`ERR_CERT_COMMON_NAME_INVALID`）。`https://airport-data.com/`（www なし）で使うこと。

**利用規約**（出典: http://www.airport-data.com/terms ）— 全文が短く、これが全て:
> "**Usage of Website**
> This system is made available by Airport-Data.com, **intended only for viewing and retrieving information**.
> Airport-Data.com does not guarantee the accuracy, timeliness, or completeness of any information on this site.
> By accessing this website, you expressly agree that use of the service is at your sole risk."

> "**Trademarks & External Links**
> Any trademarks or service marks mentioned are the **property of their respective owners**."

> "**User Conduct**
> You agree not to use the website for any purpose that is unlawful or prohibited.
> You may not use the website in any manner that could damage, disable, or impair the service."

**判定**
- **商用利用を禁じる文言も、許可する文言も無い → 未確認。** "intended only for viewing and retrieving information" はかなり限定的な書き方で、「アプリに組み込んで再配信する」ことを想定していない可能性がある。
- さらに根本的な問題: **写真の著作権は各撮影者にあり、サイトの ToS は撮影者から第三者への商用ライセンスを与えていない。** Planespotters が第8条で「第三者に規約を超える権利は与えない」と明記していたのと同じ構造が、ここでは**明文化されていないだけ**で、権利関係は同じ。
- → **有料アプリでの利用はリスクが高い。** 使うなら運営に直接照会すること（`/about` にコンタクト情報）。

### D-4. Wikimedia Commons / Wikidata P18 — **商用利用の本命**

**ライセンス**
- Commons のファイルは原則 **自由ライセンス**（CC0 / CC BY / CC BY-SA / PD）。**CC 系はすべて商用利用を許可**している。
- Wikidata の構造化データは **CC0**（https://www.wikidata.org/wiki/Wikidata:Licensing ）。`P18`（image）で機体アイテムから画像を引ける。
- **ただし A-3 で実測したとおり、Wikidata 上の日本籍機アイテムは52件しかない。P18 経由のカバレッジは絶望的。**

**Commons を直接検索するほうが現実的**。実測:
```
GET https://commons.wikimedia.org/w/api.php?action=query&list=search
      &srsearch=JA339J&srnamespace=6&srlimit=5&format=json&formatversion=2
→ totalhits: 4
  File:JA339J (aircraft) Ukishima-cho Park.jpg   (Author: Japanbird, Own work)
  File:JAL Express B737-800(JA339J).jpg          (Author: Kentaro IEMOTO, Flickr 由来)
  ...
```
→ **レジで検索すれば当たる機体はある。** ただし:
- カバレッジは薄い（JA339J で4件。人気機材・スペマは比較的ある一方、地味な機体はゼロ）
- **ファイル名の命名規則が統一されていない**ため、レジ検索で漏れる／誤ヒットする
- **撮影年が古いものが混じる**（塗装が現在と違う写真を出してしまうリスク）
- `incategory:"Aircraft of Japan"` での検索は totalhits 0（カテゴリ名が違う）→ **カテゴリ経由の網羅的収集にはカテゴリツリー探索が必要**

**実装上の義務（CC BY / CC BY-SA）**
- **表示**: 著作者名、ライセンス名＋リンク、変更の有無。Commons のファイルページへのリンクを併記するのが実務的。
- **CC BY-SA の場合、画像そのものを改変して配布すると SA が及ぶ**が、**そのまま表示するだけなら SA は発生しない**（画像を埋め込んだアプリ全体が SA になるわけではない）。
- **CC BY-NC / CC BY-ND のファイルは Commons には原則存在しない**（Commons の方針で自由ライセンスのみ受け入れ）ので、商用利用の観点では安心度が高い。ただし**個別ファイルのライセンスは必ず API（`prop=imageinfo&iiprop=extmetadata`）で確認してから表示する**設計にすべき。
- **画像の自前キャッシュ・リサイズも許される**（Planespotters と違い禁止条項がない）→ **サーバ側でサムネイルを持てるので表示が速く、コストもコントロールできる。**
- Wikimedia API は UA に連絡先を要求し、レート制限が厳しい（本調査でも `You are making too many requests to the API` を実測）→ **自前DBに写真URLをキャッシュする設計が必須。**

**判定: 有料アプリで使える唯一の「大規模・無償・明確に商用可」な写真ソース。カバレッジの薄さをユーザー投稿で補う構成が現実的。**

### D-5. Flickr API（CC フィルタ）

出典: https://www.flickr.com/services/api/tos/

**写真の商用利用についての明文:**
> "Flickr user photos are owned by the users (the photographers) and not by SmugMug."
> "**If you use Flickr photos for a commercial purpose, the photos must be marked with a Creative Commons license that allows for such use**, and also comply with the requirements for each license, unless otherwise agreed upon between you and the owner."

**API 自体の商用利用には「商用 API キー」が必要:**
> "Sell, lease, or sublicense Flickr APIs or access thereto or **derive revenues from the use or provision of Flickr APIs**, whether for direct commercial or monetary gain or otherwise, **except as set forth below**."

> "**2. Commercial Use** … If the **primary purpose of your application is to derive revenue, it is considered a commercial application**. … here are a few common examples of commercial use …
> * **Users are charged a fee for your product or service** which includes some sort of integration using the Flickr APIs.
> * Your site is a 'destination' site that uses Flickr photos to drive traffic and generate ad revenue."

> "**Application for a Commercial API Key** — If you want to apply for a commercial API key, go to the following form: https://flickr.com/services/api/keys/apply/ . **You can't be too specific about your intended use** of the Flickr Commercial API!"

プライバシー設定の追随義務:
> "if a user marks a photo as 'private' after using your service, your application must reflect those changes as soon as reasonably possible. If your application has any cached copies of photos that have become 'private,' you must r[emove them]…"

**判定**
- **有料アプリ＝商用アプリに該当するので、商用 API キーの申請が必須。** 申請は無料だが審査がある（期間・可否は **未確認**）。
- さらに**各写真が商用可の CC ライセンス（CC0 / CC BY / CC BY-SA / PD）でマークされているものに限定**してフィルタする実装が必要（`license` パラメータで絞れる）。
- キャッシュした写真の private 化追随義務があり、**定期的な再検証バッチが必要**＝運用コストがかかる。
- → **Wikimedia Commons のほうが圧倒的に扱いやすい。Flickr は補完として検討する程度。**

### D-6. 航空会社プレスキット / 公式素材
- JAL/ANA 等はプレスリリースに写真を添付しているが、**報道目的の利用を前提としており、第三者の商用アプリでの利用は別途許諾が必要**（各社の「画像・映像の利用について」に従う）。**本調査では各社の素材利用規定の原文を取得できず 未確認**（Akamai で 403）。
- キャラクター塗装の写真は**キャラクター著作権者（ポケモン社・ディズニー等）の権利も重なる**ため、有料アプリでの使用は避けるべき。
- 実務上は **「広報素材の個別利用許諾を取る」のはコストが高く、個人開発の有料アプリでは非現実的。**

### D-7. 自前のユーザー投稿写真 — **有料化の本命**
- ユーザーが自分で撮った写真を投稿 → **投稿規約で「当社に対し、無償・非独占・サブライセンス可能な利用許諾を与える」条項を置く**（Planespotters 第8条、JetPhotos 第4条が良い手本）。
- メリット: **ライセンス問題が消える**／スペマの「今の姿」が写る（Commons の古い写真問題を解決）／投稿者名表示がコミュニティの動機になる。
- デメリット: 立ち上がりが遅い、モデレーション必須（他人の写真の無断投稿を防ぐ規約＋通報フローが必要）、ストレージコスト。
- **スペマDB（A-7）と同じ「ユーザー投稿」基盤に乗るので、一緒に作れば実装コストは共有できる。**

### D 章サマリ表

| ソース | データ | 取得方法 | 商用可否 | 料金 | 根拠URL |
|---|---|---|---|---|---|
| **Planespotters** | 1機1枚、サムネ2サイズ、撮影者名、詳細リンク | `api.planespotters.net/pub/photos/reg|hex/...`（キー不要、UA に連絡先必須） | **有料機能としては不可**（"cannot be an exclusive paid, premium or member-only feature"） | 無料 | https://www.planespotters.net/photo/api#terms |
| JetPhotos | 写真 | API なし | **不可**（personal, non-commercial only） | — | https://www.jetphotos.com/terms.php |
| airport-data.com | 複数枚可、撮影者名、リンク。機体情報・空港情報も | `airport-data.com/api/ac_thumb.json?m={hex}&n={n}` | **未確認**（"intended only for viewing and retrieving information"。写真の権利は撮影者） | 無料 | http://www.airport-data.com/terms , /api/doc |
| **Wikimedia Commons** | 自由ライセンス写真。レジ検索で当たるものあり（JA339J=4件） | MediaWiki API（`list=search&srnamespace=6`＋`prop=imageinfo&iiprop=extmetadata` でライセンス確認） | **可（CC 系は商用OK）。要: 著作者・ライセンス表示** | 無料 | https://www.wikidata.org/wiki/Wikidata:Licensing |
| Wikidata P18 | 機体アイテムの代表画像 | SPARQL | **可（CC0）** | 無料 | 同上 |
| Flickr | 大量。CC フィルタ可 | Flickr API（**商用キーの申請が必須**） | **条件付き可**（商用キー＋商用可CCライセンスの写真のみ） | 無料（審査あり） | https://www.flickr.com/services/api/tos/ |
| 航空会社プレスキット | 高品質公式写真 | 手動 | **要個別許諾。未確認** | — | — |
| **自前ユーザー投稿** | 最新の姿 | 自前 | **可（投稿規約でライセンス取得）** | ストレージ費のみ | — |

**D 章の結論: 有料アプリの写真は「Wikimedia Commons（主）＋ ユーザー投稿（従）」で組む。** Planespotters は無料版に限定し、有料版に移行する際はコードパスを切り替える（または Planespotters に商用条件を照会する）。

---

## E. 販売を見据えた構成の提案

### E-0. 前提: コストは「空港数 × ポーリング回数」で決まる（ユーザー数ではない）

サーバ側で **空港ごとに1本のキャッシュ**を持ち、全ユーザーがそれを読む設計にすれば、外部 API 呼び出し回数は **ユーザー数に依存しない**。

```
1空港あたりの外部API呼び出し回数
  30秒間隔 = 2,880 回/日 = 86,400 回/月
  60秒間隔 = 1,440 回/日 = 43,200 回/月
   5分間隔 =   288 回/日 =  8,640 回/月
```
→ **100 DAU と 1,000 DAU で外部データ費は変わらない。** 変わるのは (a) 自分のサーバの帯域/実行回数、(b) 写真の取得回数（クライアント直参照なら自分のコストはゼロ）。

**これが本アプリの経済性の核心。**「ユーザーが増えるとコストが増える」型ではないので、**サブスクのユニットエコノミクスは極めて良い。**

#### 参考: 1リクエストの実測サイズ
adsb.lol の HND 10NM = **12,523 bytes / 27機**。1空港30秒ポーリングで **約1.04 GB/月** の受信。

### E-1. プラットフォームの制約

#### Google Apps Script（現行）
出典: https://developers.google.com/apps-script/guides/services/quotas

| 項目 | 一般（consumer / gmail.com） | Google Workspace |
|---|---|---|
| **URL Fetch calls** | **20,000 / day** | **100,000 / day** |
| URL Fetch response size | 50 MB / call | 50 MB / call |
| スクリプト実行時間 | 6 min / execution | 6 min / execution |
| **トリガーの合計実行時間** | **90 min / day** | **6 hr / day** |
| 同時実行数 | 30 / user | 30 / user |

**致命的な計算**
- 30秒ポーリング = 2,880 UrlFetch/日/空港（ADS-B のみ）。
  - consumer 20,000/日 → **ADS-B だけなら最大6空港**。実際には経路照会・写真照会も UrlFetch を消費するので **実質2〜3空港が限界**。
  - Workspace 100,000/日 → 30空港程度。
- **より厳しいのはトリガー実行時間**: 30秒間隔の定期実行を自前でやるなら、GAS の時間主導トリガーは**最短1分間隔**。30秒を実現するには「1分トリガー内で30秒 sleep して2回叩く」などの回避策が必要で、**1回2秒かかると 2,880×2秒 = 96分/日 → consumer の 90 min/day を超える。**
- **結論: GAS（consumer）で「30秒ポーリング × 複数空港」は量的に破綻する。** 有料販売するなら移行が前提。
- ただし **「ユーザーのアクセス時にオンデマンドで取得し、CacheService に30秒キャッシュする」** 設計なら、呼び出し回数は**実際のアクセス数に比例**するので、DAU が小さいうちは GAS でも成立する（100 DAU × 1セッション10回閲覧 = 1,000 UrlFetch/日程度）。**今の無料アプリがこれで動いているのはこの理由。**

#### Cloudflare Workers（推奨の移行先）
- Cron Triggers で定期実行、KV / Durable Objects でキャッシュ共有。
- Free プラン: 100,000 req/day、Cron は最短1分。Paid は **$5/月**から（10M req 込み）。
- **Workers のアウトバウンド fetch に回数制限がないのが決定的な利点**（GAS の UrlFetch 上限問題が消える）。
- 静的配信は Cloudflare Pages で無料。
- **ADS-B ポーリング（30秒 × N空港）を Cron + Durable Objects Alarm で回し、KV に最新スナップショットを置く構成が、コスト・制約両面で最適。**
- 注: 具体的な現行価格・制限値は **本調査では未検証（未確認）** → 実装前に https://developers.cloudflare.com/workers/platform/pricing/ で確認。

#### Firebase（代替）
- Cloud Functions / Cloud Scheduler + Firestore。
- 従量課金で、Firestore の読み取り課金が **ユーザー数に比例して増える**点が Workers KV より不利。
- 認証（課金ユーザー管理）とDB（スペマDB・投稿）を一気に揃えたいなら有力。

#### 販売形態: アプリストア vs PWA
| | アプリストア（iOS/Android） | PWA ＋ 独自決済（Stripe 等） |
|---|---|---|
| 手数料 | **15〜30%**（小規模事業者プログラムで15%） | Stripe 3.6%＋¥0〜 程度 |
| 年間費用 | Apple Developer **$99/年**、Google Play $25（一度） | 不要 |
| 審査 | あり（リジェクトリスク。特に「他サイトのデータを使うアプリ」は権利確認を問われることがある） | なし |
| 課金UX | ネイティブで最良。信頼感が高い | 決済導線を自分で作る必要 |
| 発見性 | ストア検索で見つかる | 自力集客が必要 |
| 通知 | プッシュ通知が強い | iOS の Web Push は制約あり（ホーム画面追加が必要） |

**推奨: まず PWA ＋ Stripe で有料化を検証し、売れる確信が持てたらストアに出す。** 理由:
1. 手数料30%は、月額500円のサブスクでは致命的（150円が取られる）
2. ストア審査で「FlyTeam のデータを使っていないか」「写真の権利処理」を問われた場合、即座に答えられる体制が先に必要
3. PWA なら即日リリース・即日修正ができる

### E-2. 構成案①：無料・個人利用のまま（現状維持）

| 項目 | 内容 |
|---|---|
| 位置 | **adsb.lol**（無料・ODbL）※ クレジット表示を追加 |
| 経路 | **adsbdb**（無料・キャッシュしない） |
| 写真 | **Planespotters**（無料・撮影者クレジット＋リンク必須） |
| スペマ | 手動メンテの11機テーブル（現状）＋ 公式プレスで少しずつ増やす |
| 基盤 | GAS（オンデマンド取得＋CacheService 30秒） |
| **月額コスト** | **¥0** |

**100 DAU**: ¥0（GAS 無料枠内）
**1,000 DAU**: GAS の UrlFetch 20,000/日に当たる可能性あり（1,000 DAU × 20 回閲覧 = 20,000）→ **サーバ側空港別キャッシュの導入が必須**。導入すれば ¥0 のまま。

**ライセンスリスク**: 低。ただし今すぐ直すべき点が2つ:
1. **adsb.lol の ODbL クレジット表示**（「データ: © adsb.lol contributors / ODbL」）
2. **Planespotters の撮影者名表示＋`link` への非 nofollow リンク**、および**画像をサーバでキャッシュしていないことの確認**

**やること**: 上記2点の実装のみ。

### E-3. 構成案②：低コスト有料（★推奨）

| 項目 | 内容 | 月額 |
|---|---|---|
| 位置 | **adsb.lol**（ODbL・商用可・無料）＋ 運営者へ本番利用連絡＋feeder 1台設置 | ¥0（受信機の初期費用 1〜2万円） |
| 経路 | **ODPT（JAL/ANA リアルタイム到着/出発＋時刻表。for-profit 明文OK）** ＋ adsb.lol routeset（ライセンス確認後） | ¥0 |
| 写真 | **Wikimedia Commons（CC、商用OK）＋ ユーザー投稿** | ¥0（ストレージのみ） |
| スペマ | **自前DB**（公式プレスからシード＋ユーザー投稿で拡充） | ¥0（自分の工数） |
| 基盤 | **Cloudflare Workers（Paid $5）＋ KV ＋ Pages**、または Firebase | 約$5（¥800） |
| 決済 | Stripe（PWA） | 売上の3.6% |
| バックアップ | ADS-B Exchange RapidAPI Basic（$10）を差し替え可能に（通常は未契約） | ¥0（待機） |

**月額コスト試算（3空港・30秒ポーリング想定）**

| | 100 DAU | 1,000 DAU |
|---|---|---|
| 外部データ API | **$0** | **$0** |
| Cloudflare Workers Paid | $5 | $5 |
| 画像ストレージ（R2、投稿写真 10GB） | 約$0.15 | 約$1.5 |
| 帯域 | $0（Cloudflare は egress 無料） | $0 |
| Stripe 手数料 | 売上の3.6% | 売上の3.6% |
| **合計（手数料除く）** | **約$5（¥800）/月** | **約$7（¥1,100）/月** |

→ **月額500円 × 100人 = 5万円の売上に対して原価800円。粗利98%。** これが成立するのは「外部データ費がゼロ」かつ「コストが空港数にしか比例しない」から。

**ライセンスリスク**: 低〜中
- adsb.lol: ODbL のクレジット表示を守れば商用OK。**リスクは「運営者の気分で止まる」こと** → feeder 化＋連絡で軽減、ADS-B Exchange へのフォールバックを用意。
- ODPT: 商用明文OK。ただし **各データセットの Specific Terms of Use を確認**（第5条でそれが優先する）。
- Commons: CC の表示義務を守れば商用OK。**ファイルごとにライセンスを API で取得して表示する実装が必須。**
- 自前スペマDB: **FlyTeam を見ながら作らない**（A-7 参照）。公式プレス一次情報から積む。

**作らなければならないもの**
1. サーバ側 空港別キャッシュ（30秒 TTL）＋ Cron ポーリング
2. **スペマDB のスキーマ**（`registration, livery_name_ja, livery_name_en, airline, start_date, end_date, status, source_url, confidence`）＋ 管理UI
3. **ユーザー投稿フロー**（スペマ報告・写真）＋ モデレーション画面 ＋ **投稿規約（ライセンス付与条項・他人の写真の投稿禁止・通報フロー）**
4. Commons 写真の取得＋ライセンスメタデータ表示＋自前キャッシュ
5. ODPT 開発者登録、`acl:consumerKey` 管理、JAL/ANA 便情報のマッピング
6. 課金（Stripe Checkout ＋ サブスク状態の検証）
7. **データ出典表示画面**（adsb.lol/ODbL、ODPT、Commons 各写真の著作者）
8. 利用規約・プライバシーポリシー（免責: 運航情報は参考値）

### E-4. 構成案③：本格商用（FR24 / FlightAware ＋ 有償写真ライセンス）

| 項目 | 内容 | 月額 |
|---|---|---|
| 位置 | **FR24 API Advanced**（$900）＋ 従量 | **$900〜$6,000+** |
| 経路 | FR24 に含まれる（`Live flight positions - full`） | 同上 |
| 写真 | Planespotters に商用条件を照会 / ストックフォト契約 / 自前撮影 | **未確認（要見積り）** |
| スペマ | FlyTeam と有償ライセンス契約 | **未確認（要交渉）** |
| 基盤 | Cloudflare / GCP | $20〜 |

**月額コスト試算**

| | 100 DAU | 1,000 DAU |
|---|---|---|
| FR24（1空港30秒ポーリング） | **約$6,200〜$8,300** | 同じ（ユーザー数に非依存） |
| FR24（1空港5分ポーリング、20機まで） | 約$900（Advanced 枠内） | 同じ |
| 基盤 | $20 | $20 |
| **合計** | **約$920〜$8,320/月（約14万〜125万円）** | 同じ |

→ **月額500円のサブスクなら、5分ポーリング版でも損益分岐が 約270人。30秒ポーリング版だと約2,500人必要。**

**判定: ③は「個人開発の有料アプリ」として成立しない。** FR24 の価格モデル（返却便数課金）が常時ポーリング型トラッカーと根本的に噛み合わない。**②で得られるデータ品質は、日本の空港ウォッチ用途ではほぼ同等**（adsb.lol でレジ・機種・位置が取れている実測済み）ため、③に投資する理由がない。

③が意味を持つのは:
- B2B（空港・航空会社・メディアに売る）に舵を切る場合
- 履歴データ分析（過去2年のフライト履歴）を売りにする場合
- グローバル展開して DAU が数万規模になった場合

### E-5. 段階移行ロードマップ（推奨）

| フェーズ | 期間目安 | やること | コスト |
|---|---|---|---|
| **Phase 0: 法務衛生** | 即時 | adsb.lol の ODbL クレジット表示、Planespotters の撮影者クレジット＋リンク・サーバキャッシュしていないことの確認 | ¥0 |
| **Phase 1: データ主権の確立** | 1〜2ヶ月 | スペマDB のスキーマ化（11機 → 公式プレスから50〜100機へ）、データ供給元を差し替え可能なアダプタ層、ODPT 開発者登録 | ¥0 |
| **Phase 2: 基盤移行** | 1ヶ月 | GAS → Cloudflare Workers（Cron + KV の空港別キャッシュ）。**この時点で複数空港・30秒が量的に成立するようになる** | $5/月 |
| **Phase 3: コミュニティ化** | 2〜3ヶ月 | ユーザー投稿（スペマ報告＋写真）、モデレーション、投稿規約。写真を Commons + 投稿へ移行（= Planespotters 依存を外す） | $5〜7/月 |
| **Phase 4: 有料化** | 1ヶ月 | PWA ＋ Stripe サブスク。**Phase 3 で写真が自前になっているので、Planespotters の「有料機能にできない」条項に抵触しない** | 同上 |
| **Phase 5（任意）: FlyTeam 提携** | — | FlyTeam に有償ライセンス／相互提供を打診（自アプリの投稿データを還流する材料が Phase 3 で揃っている） | 要交渉 |
| **Phase 6（任意）: ストア展開** | — | iOS/Android（手数料15〜30%を払う価値が出てから） | $99/年 |

**Phase 3 を Phase 4 より前に置くのが最重要。** 写真ソースを自前化してから課金しないと、Planespotters の規約に正面から違反する。

---

## 最終推奨

### 結論3行
1. **位置データは adsb.lol で何も変えなくてよい。ODbL は商用利用を許可しており、しかも無料でレジと機種が取れる。** 表示クレジットを追加し、運営者に本番利用を連絡し、feeder を1台立てて関係を作ること。
2. **有料化の最大の障害はスペマDBではなく「写真」である。** Planespotters の API 規約は「写真を有料・会員限定機能にしてはならない」と明文で禁じている。**課金する前に写真ソースを Wikimedia Commons ＋ ユーザー投稿へ移すこと。**
3. **FlyTeam のスクレイピングは有料化すると明確に規約違反（第四条の「複製・編集・頒布・転売」＋「営利目的の行為」）。かつ 1,399件の一覧は編集著作物として保護される可能性が高い。** 代わりに **公式プレスリリース（JAL は機体番号を明記している実例を確認）を一次情報とする自前DB** を作り、ユーザー投稿で厚くする。FlyTeam は「許諾が取れたら最強」なので、Phase 5 で提携を打診する。

### 採用すべき構成（構成案②）

| レイヤ | 採用 | 商用可否の根拠 | 月額 |
|---|---|---|---|
| 機体位置 | **adsb.lol** | ODbL（商用可・表示義務） https://api.adsb.lol/docs | ¥0 |
| 便→経路 | **ODPT（JAL/ANA）** ＋ adsb.lol routeset | 基本ライセンス第4条7項 "may use these Basic License Data **for-profit**" https://developer.odpt.org/terms/data_basic_license.html | ¥0 |
| 写真 | **Wikimedia Commons ＋ ユーザー投稿** | CC 系は商用可 / Wikidata は CC0 https://www.wikidata.org/wiki/Wikidata:Licensing | ¥0 |
| スペマ | **自前DB（公式プレス＋ユーザー投稿）** | 事実に著作権なし。一次情報から構築 | ¥0 |
| 基盤 | **Cloudflare Workers + KV + Pages** | — | 約$5 |
| 決済 | **Stripe（PWA 先行、ストアは後）** | 手数料 3.6% vs 30% | — |
| 予備 | ADS-B Exchange RapidAPI（$10/月＋$0.0015/req） | https://rapidapi.com/adsbx/api/adsbexchange-com1/pricing | 待機 |

**→ 100 DAU でも 1,000 DAU でも月額 約¥800〜1,100。外部データ費ゼロ。**

### 今すぐやめるべきこと
- ❌ FlyTeam のスクレイピング（無料アプリでも規約違反。有料なら二重に違反）
- ❌ Planespotters の画像をサーバ側でキャッシュ／プロキシすること（明文で禁止）
- ❌ adsb.fi を商用で使うこと（"personal, non-commercial use only"）
- ❌ OpenSky を live product に組み込むこと（書面合意が必要と明文）
- ❌ JetPhotos の利用（personal, non-commercial only）
- ❌ adsbdb の経路データを自前DBに蓄積すること（"may not be … incorporated into other databases"）

### 要確認事項（本調査で未確認のまま残ったもの）
| 項目 | 確認先 |
|---|---|
| airplanes.live の利用規約（商用可否） | https://airplanes.live/terms-of-use/ をブラウザで直接、または Discord https://discord.gg/adsb |
| adsb.lol `/api/0/routeset` のリクエスト形式と上流データのライセンス | https://api.adsb.lol/docs の Swagger UI ／ 運営者に直接 |
| ODPT 各データセットの Specific Terms of Use（基本ライセンスより優先する） | https://developer.odpt.org/ にログインして各データセット詳細 |
| Planespotters の商用条件（有料アプリで写真を使う道はあるか） | https://www.planespotters.net/help/contact |
| FlightAware AeroAPI の具体的価格 | https://www.flightaware.com/aeroapi/portal/pricing （JS レンダリングのためブラウザ必須） |
| AirLabs の価格・商用条件 | https://airlabs.co/ （価格ページが 404） |
| Aviation Edge の商用可否 | https://aviation-edge.com/api-terms-of-service/ |
| 各航空会社サイトのサイトポリシー（プレスリリース転載条件） | 各社サイト（Akamai で bot 403 のため要ブラウザ） |
| JAL プレスリリースの RSS 有無 | https://press.jal.co.jp/ja/ （要ブラウザ） |
| ANA の RSS の実体 XML URL | https://www.anahd.co.jp/rss （HTML を返す） |
| airport-data.com の商用可否・レート制限 | サイトの `/about` から運営に照会 |
| Cloudflare Workers の現行価格・制限 | https://developers.cloudflare.com/workers/platform/pricing/ |
| PlaneBase（adsbdb の機体データ元）のライセンス | http://planebase.biz/ |
| Flickr 商用 API キーの審査期間・可否 | https://flickr.com/services/api/keys/apply/ |

### 連絡すべき相手（優先順）
1. **adsb.lol 運営者** — 本番/商用利用の連絡（規約に "please contact me" と明記）。同時に feeder 設置を申し出る。
2. **ODPT** — 開発者登録（無料）。航空データの利用開始。
3. **Planespotters**（https://www.planespotters.net/help/contact ）— 「有料アプリで写真を使う道はあるか」を照会。ダメなら Phase 3 で切り替える判断材料になる。
4. **FlyTeam / クロゴ株式会社** — Phase 5 で提携打診。窓口は「ご指摘・ご要望」フォーム https://docs.google.com/forms/d/e/1FAIpQLSftDhP4px5eWeCBJNggbCcKvfxu5XUOPajPrbVNfLH3c5JCKA/viewform

---

*本レポートは 2026-09-13 時点の公開情報に基づく。価格・規約は変更される。法令に関する記述は一般情報であり法的助言ではない。有料販売の開始前に、上記「要確認事項」の解消と弁護士によるレビューを推奨する。*
