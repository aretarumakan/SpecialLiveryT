# 【誰かの役に立てばシリーズ】特別塗装機を追いかけるWebアプリ「スペマウォッチ」を Vercel で公開するまで

飛行機好きなら一度は思う「あのピカチュウジェット、今どこにいるんだろう」。それをスマホで確認できるアプリを、無料のサービスだけで作って公開しました。この記事では、Google Apps Script（GAS）で始めたものを Vercel に引っ越し、GitHub と連携して運用に乗せるまでの流れを、つまずいた点を中心に書きます。

完成したもの: https://special-livery-t.vercel.app
コード: https://github.com/aretarumakan/SpecialLiveryT

開発は Claude Code（Anthropic の CLI）に設計と実装を任せ、私は方針決定と各サービスの設定を担当しました。以下の「ハマりどころ」は、実際にデプロイが失敗したログから拾ったものです。

---

## 1. 何を作ったか

- 日本の主要45空港から1つ選ぶと、「空港にいる機体」「到着予定」「出発」が30秒ごとに更新される
- 特別塗装機（スペマ）は金色の枠で目立たせ、塗装名と説明を表示
- 各機体の右側に写真
- 特別塗装機のデータベースは利用者が登録・写真投稿できる。投稿者の写真がサムネイルになり、撮影者名が表示される
- 塗装ごとの共有ページを X や LINE に投稿できる（OG 画像付き）

データはすべて無料・API キー不要のものです。

| 用途 | サービス |
|---|---|
| 機体の位置・登録記号・機種 | adsb.lol（ADS-B の受信網。ライセンスは ODbL） |
| 便名から出発地・目的地 | adsbdb.com |
| 機体写真（一般機） | Planespotters.net の公開 API |
| 塗装DB・ログイン・投稿写真 | Supabase（無料枠） |
| ホスティング | Vercel（Hobby プラン） |

---

## 2. 最初は GAS だった

最初の版は GAS の Web アプリでした。`doGet` で HTML を返し、30秒ごとに `google.script.run` でサーバー関数を呼ぶ構成です。半日で動くものができ、スマホからも見られました。

ただ、GAS には次の限界があります。

- 外部 API 呼び出し（UrlFetch）が1日2万回まで。30秒更新は1空港あたり1日2,880回なので、数人が使うと危うい
- ログイン、画像アップロード、共有ページの OG 画像といった「Web サービスらしい機能」が作りにくい
- 公開 URL が `script.google.com/macros/s/...` で、共有しづらい

「誰かに使ってもらう」段階で Vercel に移すことにしました。

---

## 3. Vercel への引っ越し

### 構成

Vercel はフレームワーク無しでも動きます。今回はビルド工程を一切持たない、素の構成にしました。

```
public/index.html      画面（静的）。/api/status を fetch する
api/status.js          Serverless Function。GET /api/status?icao=RJTT
lib/status.js          取得と判定のロジック（GAS の Code.gs をほぼそのまま ESM 化）
vercel.json            rewrite とヘッダ
package.json           "type": "module"
```

`api/` に置いた JS ファイルが自動的に `/api/ファイル名` になります。GAS からの移植は、`google.script.run` を `fetch('/api/status?icao=...')` に置き換え、`UrlFetchApp.fetch` を `fetch` に置き換えるだけでした。判定ロジックは1行も変えていません。

### 利用者が増えてもコストが増えない仕組み

Serverless Function のレスポンスに次のヘッダを付けています。

```js
res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=10');
```

`s-maxage=20` を付けると、Vercel のエッジが同じ URL のレスポンスを20秒間共有します。100人が同時に羽田を見ていても、外部 API への問い合わせは20秒に1回です。コストが「利用者数」ではなく「空港数 × 更新頻度」で決まるので、無料枠で運用できます。

### GitHub 連携

1. GitHub に空のリポジトリを作る
2. コードを `main` に push
3. https://vercel.com/new で「Import Git Repository」からそのリポジトリを選ぶ
4. Framework Preset は「Other」、Build Command と Output Directory は空欄のまま Deploy

以後は `main` に push するたびに自動でデプロイされます。ここまでは10分で終わります。

---

## 4. ハマりどころ（ここが本題）

### 4-1. デプロイが「Deploying outputs...」で止まって失敗する

ビルドは成功しているのに、最後の段階で失敗する。ログの末尾を見落としがちなのですが、原因はこれでした。

> Hobby プランは1デプロイあたり Serverless Function が12個まで

管理者向けの API を1機能1ファイルで作っていたら14個になっていました。対処は、管理系の7個を1つの関数にまとめ、URL は `vercel.json` の rewrite で振り分けることです。

```json
{
  "rewrites": [
    { "source": "/api/admin/:op", "destination": "/api/admin?op=:op" }
  ]
}
```

`api/admin.js` が `req.query.op` を見て内部で処理を分岐します。呼び出し側の URL は変わらないので、画面の修正は不要でした。ファイルは `lib/` 配下に移せば関数として数えられません。

### 4-2. `@vercel/og` の最新版が動かない

SNS 共有用の OG 画像を `@vercel/og` で描いていたのですが、デプロイ時にこう言われました。

> The Edge Function "api/og" is referencing unsupported modules: @vercel: module

Vercel 自身のライブラリが Vercel の Edge Runtime に載らない、という状態です。当時の最新版 1.0.2 の問題で、Node 用のビルドも起動時に落ちました。対処は2つです。

- バージョンを 0.6 系に固定する（`"@vercel/og": "^0.6.8"`）
- Edge Function ではなく通常の Node の関数として動かす（`export const config = { runtime: 'edge' }` を外し、`ImageResponse` の結果を `Buffer` にして `res.send`）

Node で動かせば手元でも同じコードで PNG を描けるので、日本語フォントの確認も楽になりました。「公式ライブラリだから最新でいいだろう」は禁物です。

### 4-3. 「Redeploy」は古いコミットを再実行する

修正を push したあと、Vercel の失敗したデプロイの画面で「Redeploy」を押すと、そのデプロイのコミット（つまり修正前）が再実行されます。ログの3行目 `Commit: xxxxxxx` を見れば分かるのですが、最初は「直したのに同じエラーが出る」と混乱しました。

新しいコミットのデプロイは Deployments 一覧の一番上に別途できています。手動で走らせたいときは「Create Deployment」から `main` を選びます。

### 4-4. Supabase 連携の「Custom Prefix」

Vercel のマーケットプレイスから Supabase を連携すると、環境変数が自動で入ります。このとき「Custom Prefix」という欄があり、ここに入れた文字列が変数名の頭に付きます。

コードが `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` を読む前提なら、Prefix は `SUPABASE` にします。連携後に Settings → Environment Variables で名前を確認してください。

Next.js 向けに `NEXT_PUBLIC_` という Prefix の設定もありますが、今回のようにビルドを使わない構成では関係ありません。フロントには `/api/config` 経由で公開キーだけを渡しています。

### 4-5. engines の警告は無視してよい

ログに何十行も出る次の警告は、`package.json` の `"engines": { "node": ">=20" }` に対するもので、失敗の原因ではありません。

> Warning: Detected "engines": { "node": ">=20" } ... will automatically upgrade when a new major Node.js Version is released

気になるなら `"node": "22.x"` のように固定します。

### 4-6. Hobby プランは商用利用不可

途中で「いつか有料アプリにできないか」を調べました。結論から言うと、今回の構成のままでは無理でした。

- Vercel Hobby プランは商用利用が禁止（Pro は月20ドル）
- Planespotters の写真 API は「写真を有料・会員限定の機能にしてはならない」と規約に明記
- adsb.fi や OpenSky は非商用限定

一方で adsb.lol は ODbL で商用も可、Supabase は無料枠でも商用可です。趣味の範囲で公開する分には問題ありませんが、収益化を考えるなら最初にデータソースの規約を読むことを勧めます。

---

## 5. Supabase 側の設定で必要だったこと

Vercel の連携でプロジェクトは作られますが、次はダッシュボードで手作業です。

1. SQL Editor でテーブル・RLS・Storage ポリシーの SQL を実行（リポジトリの `supabase/migrations/` に入れてあります）
2. Authentication → Providers で Google を有効化。これには Google Cloud Console で OAuth クライアントを作り、Client ID と Secret を貼る必要があります
3. 一度サイトからログインしてから、SQL で自分を管理者に昇格（最初の1人だけ。2人目以降は管理画面から）

RLS（行レベルセキュリティ）を使うと、フロントから直接データベースに書き込んでも「自分の投稿しか触れない」「承認済みしか読めない」を DB 側で保証できます。サーバー側の API は公開読み取りと管理操作だけに絞れました。

---

## 6. 無料枠での注意点

- Supabase の無料プロジェクトは1週間アクセスが無いと一時停止する。公開直後は気にかけておく
- Planespotters の API は短時間に多く叩くと数分ブロックされる。30秒あたり8件までに絞り、端末側に7日キャッシュしている
- adsb.lol は User-Agent が汎用的だと拒否する（`node` などは弾かれた）。説明的な User-Agent を付ける

---

## 7. まとめ

- GAS は試作に最適だが、公開するなら Vercel の方が楽。移植はロジックをそのまま持ち込める
- `s-maxage` のエッジキャッシュで、無料枠のまま複数人が使える
- Hobby プランの「関数12個まで」と、`@vercel/og` のバージョンには注意
- 失敗ログは末尾まで読む。「Redeploy」は古いコミットを再実行する

次回は、利用者が特別塗装機を登録して写真を投稿できる仕組み（Supabase の RLS と Storage、承認フロー、代表写真のルール）について書く予定です。

---

この記事が誰かの役に立てば幸いです。
