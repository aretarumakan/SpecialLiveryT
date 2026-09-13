/**
 * GET /livery/:reg — 塗装ごとの共有ページ（HTML を返す Function）。
 *
 * vercel.json の rewrite で `/livery/:reg` → `/api/livery-page?reg=:reg`。
 * ローカルの test/dev-server.js も同じ経路で呼ぶ。
 *
 * SNS のクローラは JavaScript を実行しないので、`<head>` の og:* は **サーバー側で** 埋める
 * （設計書 §4）。本文も DB の内容をサーバーで描いてしまい、ブラウザ側の JS は
 *   - 「今どこ？」の 30 秒ポーリング（/api/livery）
 *   - 塗装が複数あるときのタブ切り替え
 *   - 共有ボタンの URL 組み立て・リンクのコピー・通報
 * だけを担当する。
 *
 * 登録記号は URL から来るため、埋め込む値はすべて escapeHtml / JSON で逃がす。
 */
import { getLiveryPageData } from '../lib/db.js';
import { findAirport } from '../lib/airports.js';

const REG_RE = /^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$/;
const SITE_NAME = '空港ウォッチ';

export default async function handler(req, res) {
  const raw = String((req.query && req.query.reg) || '').trim();
  const reg = raw.toUpperCase();
  const origin = originOf(req);

  if (!reg || !REG_RE.test(reg)) return sendNotFound(res, reg || raw, origin, '登録記号の形式が正しくありません');

  let data;
  try {
    data = await getLiveryPageData(reg);
  } catch (e) {
    if (e && e.status === 400) return sendNotFound(res, reg, origin, '登録記号の形式が正しくありません');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(502).send(errorPage(`塗装データの取得に失敗しました: ${escapeHtml(e.message)}`));
  }
  if (!data.liveries.length) return sendNotFound(res, reg, origin, 'まだ登録されていません');

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(sharePage(data, origin));
}

// ---------------------------------------------------------------------------
// 表示用の小物（純関数）
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** <script> の中に JSON を置くときの逃がし方（`</script>` と U+2028/9 を潰す） */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** 運航期間の表示。設計書 §4 の og:description にも本文にも使う */
export function periodText(lv) {
  if (!lv.since && !lv.until) return '運航中';
  const s = lv.since ? String(lv.since).replace(/-/g, '/') : '?';
  if (!lv.until) return `${s} 〜 運航中`;
  return `${s} 〜 ${String(lv.until).replace(/-/g, '/')}（運航終了）`;
}

/** og:title / og:description（設計書 §4） */
export function metaFor(lv, photo) {
  const title = `${lv.name}（${lv.reg}）| ${SITE_NAME}`;
  const who = [lv.airline, lv.type].filter(Boolean).join(' ');
  const credit = photo && photo.credit ? `写真: ${photo.credit}` : '写真募集中';
  const description = [who, periodText(lv), credit].filter(Boolean).join('・');
  return { title, description };
}

/** プロキシ越しでも絶対 URL を作れるようにする（og:image / og:url は絶対 URL が必須） */
export function originOf(req) {
  const h = (req && req.headers) || {};
  const host = String(h['x-forwarded-host'] || h.host || 'localhost:3000');
  const proto = String(h['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host}`;
}

function airportLabel(icao) {
  if (!icao) return '';
  const a = findAirport(String(icao).toUpperCase());
  return a ? `${a.name}（${a.iata}）` : String(icao).toUpperCase();
}

// ---------------------------------------------------------------------------
// ページ
// ---------------------------------------------------------------------------

function head({ title, description, url, image, extra = '' }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f172a">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="stylesheet" href="/css/app.css">
${extra}</head>`;
}

function errorPage(message) {
  return `${head({ title: `エラー | ${SITE_NAME}`, description: message, url: '', image: '' })}
<body>
<div id="aw-header"></div>
<script src="/js/common.js" data-title="特別塗装機"></script>
<main class="wrap"><div class="err">${message}</div>
<p><a class="aw-btn" href="/liveries.html">特別塗装機の一覧へ</a></p></main>
</body></html>`;
}

/** 未登録の登録記号。404 を返しつつ「登録する」導線を出す（設計書 §4 の重複抑止と同じ発想） */
function sendNotFound(res, reg, origin, why) {
  const safeReg = escapeHtml(reg);
  const title = `${reg || '登録記号なし'} の塗装は未登録 | ${SITE_NAME}`;
  const description = `${reg || 'この機体'} の特別塗装はまだ登録されていません。あなたの投稿で登録できます。`;
  const submit = `/submit.html?reg=${encodeURIComponent(reg)}`;
  const html = `${head({ title, description, url: `${origin}/livery/${encodeURIComponent(reg)}`, image: `${origin}/api/og?reg=${encodeURIComponent(reg)}` })}
<body>
<div id="aw-header"></div>
<script src="/js/common.js" data-title="特別塗装機"></script>
<main class="wrap">
  <div class="card">
    <h3>${safeReg || '登録記号が指定されていません'}</h3>
    <p class="lead">この機体の特別塗装は見つかりませんでした（${escapeHtml(why)}）。<br>
      承認済みの塗装だけを載せています。ご存じの塗装があれば登録してください。</p>
    <div class="actions">
      <a class="aw-btn gold" href="${escapeHtml(submit)}">この機体の塗装を登録する</a>
      <a class="aw-btn" href="/liveries.html">特別塗装機の一覧</a>
    </div>
  </div>
</main>
<footer>
  位置データ: <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a>（ODbL）／
  <a href="/terms.html">利用規約</a>
</footer>
</body></html>`;
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(404).send(html);
}

function heroHtml(lv, photo) {
  if (!photo) {
    return `<div class="hero none">
      <span class="ph">✈</span>
      <div class="cap">この塗装の写真はまだありません。<br>
        <a class="aw-btn gold" href="/submit.html?reg=${encodeURIComponent(lv.reg)}">あなたの写真を載せませんか</a></div>
    </div>`;
  }
  const credit = photo.snsUrl
    ? `<a href="${escapeHtml(photo.snsUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(photo.credit)}</a>`
    : escapeHtml(photo.credit);
  const where = [photo.takenOn ? String(photo.takenOn).replace(/-/g, '/') : '', airportLabel(photo.airport)].filter(Boolean).join('・');
  return `<div class="hero">
    <a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(lv.name)}（${escapeHtml(lv.reg)}）" loading="eager">
    </a>
    <div class="cred">📷 ${credit}${where ? `　<span class="s">${escapeHtml(where)}</span>` : ''}</div>
    ${photo.caption ? `<div class="cap">${escapeHtml(photo.caption)}</div>` : ''}
  </div>`;
}

function infoHtml(lv) {
  const rows = [
    ['航空会社', lv.airline],
    ['機種', lv.type],
    ['運航期間', periodText(lv)],
    ['登録記号', lv.reg],
  ].filter(([, v]) => v);
  const source = lv.sourceUrl
    ? `<div class="src"><a href="${escapeHtml(lv.sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">出典（公式発表など）を見る</a></div>`
    : '';
  return `<div class="info">
    ${lv.note ? `<div class="note">${lv.color ? `<i style="background:${escapeHtml(lv.color)}"></i>` : ''}${escapeHtml(lv.note)}</div>` : ''}
    <dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    ${source}
  </div>`;
}

function galleryHtml(lv, photos) {
  if (photos.length < 2) return '';
  return `<div class="gal">
    <h2>この塗装の写真（${photos.length} 枚）</h2>
    <div class="grid">${photos.map((p) => `
      <a class="gi" href="${escapeHtml(p.url)}" target="_blank" rel="noopener" title="${escapeHtml(p.caption || lv.name)}">
        <img src="${escapeHtml(p.thumbUrl || p.url)}" alt="${escapeHtml(p.caption || lv.name)}" loading="lazy">
        <span class="by">📷 ${escapeHtml(p.credit)}</span>
      </a>`).join('')}</div>
  </div>`;
}

function sharePage(data, origin) {
  const liveries = data.liveries;
  const main = liveries[0];
  const photosOf = (lv) => data.photos.filter((p) => p.liveryId === lv.id);
  const primaryOf = (lv) => photosOf(lv)[0] || null;
  const { title, description } = metaFor(main, primaryOf(main));
  const url = `${origin}/livery/${encodeURIComponent(data.reg)}`;
  const image = `${origin}/api/og?reg=${encodeURIComponent(data.reg)}`;

  const tabs = liveries.length > 1
    ? `<div class="tabs lvtabs">${liveries.map((lv, i) => `<button type="button" data-i="${i}"${i === 0 ? ' class="on"' : ''}>${escapeHtml(lv.name)}${lv.until ? '（終了）' : ''}</button>`).join('')}</div>`
    : '';

  const sections = liveries.map((lv, i) => `<section class="lv" data-i="${i}"${i === 0 ? '' : ' hidden'}>
    ${heroHtml(lv, primaryOf(lv))}
    <h1 class="lvname">${lv.color ? `<i style="background:${escapeHtml(lv.color)}"></i>` : ''}${escapeHtml(lv.name)}${lv.until ? '<span class="badge">運航終了</span>' : ''}</h1>
    ${lv.name_en ? `<div class="en">${escapeHtml(lv.name_en)}</div>` : ''}
    ${infoHtml(lv)}
    ${galleryHtml(lv, photosOf(lv))}
  </section>`).join('');

  // クライアントに渡すのは描画に必要な最小限（写真の URL は本文に既に入っている）
  const boot = {
    reg: data.reg,
    url,
    liveries: liveries.map((lv) => ({ id: lv.id, name: lv.name, reg: lv.reg })),
  };

  return `${head({ title, description, url, image, extra: STYLE })}
<body>
<div id="aw-header"></div>
<script src="/js/common.js" data-title="特別塗装機"></script>

<main class="wrap">
  ${tabs}
  ${sections}

  <div class="card now" id="nowCard">
    <h3>今どこ？</h3>
    <div class="nowline" id="nowLine">現在地を確認しています…</div>
    <div class="s" id="nowSub">位置データ: adsb.lol（ODbL）・30 秒ごとに更新</div>
  </div>

  <div class="card">
    <h3>シェアする</h3>
    <div class="actions">
      <a class="aw-btn primary" id="btnX" href="#" target="_blank" rel="noopener">Xに投稿</a>
      <a class="aw-btn" id="btnLine" href="#" target="_blank" rel="noopener">LINEで送る</a>
      <button type="button" class="aw-btn" id="btnCopy">リンクをコピー</button>
    </div>
  </div>

  <div class="card">
    <h3>この塗装について</h3>
    <div class="actions">
      <a class="aw-btn gold" href="/submit.html?reg=${escapeHtml(encodeURIComponent(data.reg))}">写真を投稿</a>
      <a class="aw-btn ghost" href="/submit.html?reg=${escapeHtml(encodeURIComponent(data.reg))}&amp;mode=fix">情報の修正を提案</a>
      <button type="button" class="aw-btn ghost" id="btnReport">通報</button>
    </div>
    <div class="s">写真の著作権は撮影者にあります。掲載の停止や修正の依頼は <a href="/terms.html">利用規約</a> の窓口へ。</div>
  </div>
</main>

<footer>
  <a href="/liveries.html">★ 特別塗装機の一覧</a>　<a href="/">空港ウォッチ</a><br>
  位置データ: <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a>（ODbL）／
  経路: <a href="https://www.adsbdb.com" target="_blank" rel="noopener">adsbdb</a>／
  <a href="/terms.html">利用規約</a>
</footer>

<script id="awLiveryBoot" type="application/json">${jsonForScript(boot)}</script>
<script>
${clientScript()}
</script>
</body></html>`;
}

const STYLE = `<style>
  main.wrap { max-width: 680px; }
  .lvtabs { overflow-x: auto; }
  .lvtabs button { flex: 0 0 auto; white-space: nowrap; }
  .hero { margin-bottom: 10px; }
  .hero img { width: 100%; display: block; border-radius: 14px; border: 1px solid var(--gold); background: #0b1220; }
  .hero.none { display: grid; justify-items: center; gap: 10px; padding: 28px 12px; border-radius: 14px;
    border: 1px dashed var(--gold); background: linear-gradient(135deg, #2b2a1e 0%, var(--panel) 60%); }
  .hero.none .ph { font-size: 56px; color: #64748b; }
  .hero .cred { font-size: 12px; color: var(--muted); padding: 6px 2px 0; }
  .hero .cred a { color: var(--accent); }
  .hero .cap { font-size: 13px; color: var(--text); padding: 4px 2px 0; }
  .hero.none .cap { text-align: center; }
  .lvname { font-size: 20px; font-weight: 700; margin: 6px 2px 2px; line-height: 1.35; }
  .lvname i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 7px;
    vertical-align: middle; border: 1px solid rgba(255,255,255,.4); }
  .en { font-size: 12px; color: var(--muted); margin: 0 2px 8px; }
  .info { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; margin-bottom: 10px; }
  .info .note { font-size: 13px; padding: 7px 9px; border-radius: 8px; background: rgba(251,191,36,.12); color: #fde68a; margin-bottom: 8px; }
  .info .note i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; border: 1px solid rgba(255,255,255,.4); }
  .info dl { display: grid; grid-template-columns: 84px 1fr; gap: 4px 10px; margin: 0; font-size: 13px; }
  .info dt { color: var(--muted); } .info dd { margin: 0; overflow-wrap: anywhere; }
  .info .src { margin-top: 8px; font-size: 12px; }
  .gal .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
  .gi { position: relative; display: block; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); background: #0b1220; }
  .gi img { width: 100%; height: 78px; object-fit: cover; display: block; }
  .gi .by { position: absolute; left: 0; right: 0; bottom: 0; font-size: 9px; line-height: 1.4; padding: 1px 4px;
    background: rgba(0,0,0,.55); color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .now .nowline { font-size: 16px; font-weight: 700; line-height: 1.5; }
  .now .nowline a { color: var(--accent); }
  .now .s, .card .s { font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.6; }
</style>
`;

/**
 * ブラウザ側。ES5 の書き方（既存ページと同じ）で、DOM は本文に描かれたものを
 * 出し入れするだけにしている。
 */
function clientScript() {
  return `(function () {
  'use strict';
  var BOOT = JSON.parse(document.getElementById('awLiveryBoot').textContent);
  var HASH = ' #空港ウォッチ #特別塗装機';
  var current = 0;
  var place = '';

  function esc(s) { return window.AW ? AW.esc(s) : String(s == null ? '' : s); }
  function lv() { return BOOT.liveries[current] || BOOT.liveries[0]; }

  // --- 塗装タブ（同じ登録記号に複数の塗装があるとき） ----------------------
  var tabs = document.querySelectorAll('.lvtabs button');
  Array.prototype.forEach.call(tabs, function (b) {
    b.addEventListener('click', function () {
      current = Number(b.dataset.i) || 0;
      Array.prototype.forEach.call(tabs, function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      Array.prototype.forEach.call(document.querySelectorAll('section.lv'), function (s) {
        s.hidden = Number(s.dataset.i) !== current;
      });
      buildShare();
    });
  });

  // --- 共有ボタン（設計書 §4 の既定文面） ---------------------------------
  // 設計書 §4 の既定文面。現在地が分からないときは「今 〜！」を丸ごと落とす
  function shareText() {
    var head = '✈ ' + lv().name + '（' + BOOT.reg + '）';
    return head + (place ? 'は今 ' + place + '！' : '') + ' ' + BOOT.url + HASH;
  }
  function buildShare() {
    var text = shareText();
    document.getElementById('btnX').href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
    document.getElementById('btnLine').href = 'https://social-plugins.line.me/lineit/share?url='
      + encodeURIComponent(BOOT.url) + '&text=' + encodeURIComponent(text);
  }
  document.getElementById('btnCopy').addEventListener('click', function () {
    var done = function () { if (window.AW) AW.toast('リンクをコピーしました'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(BOOT.url).then(done, function () { window.prompt('このリンクをコピーしてください', BOOT.url); });
    } else {
      window.prompt('このリンクをコピーしてください', BOOT.url);
    }
  });
  document.getElementById('btnReport').addEventListener('click', function () {
    if (window.AW) AW.report('livery', lv().id);
  });

  // --- 今どこ？（/api/livery を 30 秒ごと） -------------------------------
  function renderNow(pos) {
    var line = document.getElementById('nowLine');
    if (!pos) { line.textContent = '現在地を取得できませんでした'; place = ''; buildShare(); return; }
    // 位置が分かったときだけ投稿文に現在地を入れる（unseen / unknown では入れない）
    place = (pos.state === 'ground' || pos.state === 'airborne') ? (pos.short || '') : '';
    if (pos.state === 'ground' && pos.airport && pos.airport.name) {
      line.innerHTML = '<a href="/#' + esc(pos.airport.icao) + '">' + esc(pos.label) + '</a>';
    } else {
      line.textContent = pos.label || '現在は受信できません';
    }
    buildShare();
  }

  function poll() {
    fetch('/api/livery?reg=' + encodeURIComponent(BOOT.reg), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) { renderNow(b && b.position); })
      .catch(function () { renderNow(null); });
  }

  buildShare();
  poll();
  setInterval(function () { if (!document.hidden) poll(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();`;
}
