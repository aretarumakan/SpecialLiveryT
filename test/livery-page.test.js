// 共有ページ（api/livery-page.js・api/livery.js・lib/og-render.js）の単体テスト: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.MOCK_DB = '1';

const page = await import('../api/livery-page.js');
const liveryApi = (await import('../api/livery.js')).default;
const og = await import('../lib/og-render.js');
const db = await import('../lib/db.js');
const position = await import('../lib/position.js');

const handler = page.default;

/** Vercel の res に寄せた記録用 shim（api.test.js と同じ形 + send） */
function res() {
  const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

function req(reg, headers = { host: 'example.test', 'x-forwarded-proto': 'https' }) {
  return { query: { reg }, headers };
}

/** 承認済みの写真を 1 枚足す（代表写真になる） */
function seedPhoto(over = {}) {
  const lv = db.mock.store().liveries.find((r) => r.reg === 'JA819A');
  return db.mock.addPhoto({
    livery_id: lv.id, user_id: 'user1', credit_name: '撮影者X', status: 'approved',
    taken_on: '2026-08-01', airport_icao: 'RJTT', caption: '第2ターミナルから', ...over,
  });
}

// ---------------------------------------------------------------------------
// 純関数
// ---------------------------------------------------------------------------

test('escapeHtml / jsonForScript: 埋め込みを壊す文字を逃がす', () => {
  assert.equal(page.escapeHtml('<img src=x onerror="a">&\'"'), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;&quot;');
  assert.equal(page.jsonForScript({ a: '</script>' }), '{"a":"\\u003c/script>"}');
  assert.equal(page.jsonForScript({ a: '\u2028\u2029' }), '{"a":"\\u2028\\u2029"}');
});

test('periodText / metaFor: og:title と og:description（設計書 §4）', () => {
  const lv = { reg: 'JA819A', name: 'ピカチュウジェット NH', airline: 'ANA', type: 'B787-8', since: '2021-11-01', until: null };
  assert.equal(page.periodText(lv), '2021/11/01 〜 運航中');
  assert.equal(page.periodText({ ...lv, until: '2024-03-31' }), '2021/11/01 〜 2024/03/31（運航終了）');
  assert.equal(page.periodText({ ...lv, since: null }), '運航中');

  const withPhoto = page.metaFor(lv, { credit: '撮影者X' });
  assert.equal(withPhoto.title, 'ピカチュウジェット NH（JA819A）| スペマウォッチ');
  assert.equal(withPhoto.description, 'ANA B787-8・2021/11/01 〜 運航中・写真: 撮影者X');
  assert.match(page.metaFor(lv, null).description, /写真募集中$/);
});

test('originOf: プロキシのヘッダから絶対 URL の元を作る', () => {
  assert.equal(page.originOf({ headers: { host: 'example.test', 'x-forwarded-proto': 'https' } }), 'https://example.test');
  assert.equal(page.originOf({ headers: { host: 'localhost:3000' } }), 'http://localhost:3000');
  assert.equal(page.originOf({ headers: { 'x-forwarded-host': 'a.test', 'x-forwarded-proto': 'https,http' } }), 'https://a.test');
});

// ---------------------------------------------------------------------------
// GET /livery/:reg
// ---------------------------------------------------------------------------

test('GET /livery/JA819A: 200 で og:* が入り、値はエスケープされる', async () => {
  db.mock.reset();
  seedPhoto();
  const r = res();
  await handler(req('ja819a'), r);

  assert.equal(r.code, 200);
  assert.equal(r.headers['Content-Type'], 'text/html; charset=utf-8');
  const html = r.body;
  assert.match(html, /<meta property="og:title" content="ピカチュウジェット NH（JA819A）\| スペマウォッチ">/);
  assert.match(html, /<meta property="og:description" content="ANA B787-8・[^"]*写真: 撮影者X">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/example\.test\/api\/og\?reg=JA819A">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/example\.test\/livery\/JA819A">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  // 本文（サーバー描画）と共有ボタン
  assert.match(html, /第2ターミナルから/);
  assert.match(html, /東京国際（羽田）（HND）/);
  assert.match(html, /id="btnX"/);
  assert.match(html, /id="btnLine"/);
  assert.match(html, /id="btnCopy"/);
  assert.match(html, /\/submit\.html\?reg=JA819A&amp;mode=fix/);
  assert.match(html, /id="btnReport"/);
  assert.match(html, /adsb\.lol/);
});

test('GET /livery/:reg: 塗装機名の危険な文字は HTML に生で出ない', async () => {
  db.mock.reset();
  db.mock.addLivery({ reg: 'JA999X', name: '<script>alert(1)</script>', airline: 'ANA"x', status: 'approved' });
  const r = res();
  await handler(req('JA999X'), r);
  assert.equal(r.code, 200);
  assert.ok(!r.body.includes('<script>alert(1)</script>'));
  assert.match(r.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('GET /livery/ZZ999: 承認済みが無ければ 404 と「登録する」導線', async () => {
  db.mock.reset();
  const r = res();
  await handler(req('ZZ999'), r);
  assert.equal(r.code, 404);
  assert.match(r.body, /この機体の塗装機を登録する/);
  assert.match(r.body, /\/submit\.html\?reg=ZZ999/);
  assert.match(r.body, /<meta name="twitter:card" content="summary_large_image">/);
});

test('GET /livery/:reg: 形式が不正な登録記号も 404（例外にしない）', async () => {
  db.mock.reset();
  for (const bad of ['', '../../etc/passwd', '<script>']) {
    const r = res();
    await handler(req(bad), r);
    assert.equal(r.code, 404, bad);
    assert.ok(!r.body.includes('<script>'), bad);
  }
});

test('GET /livery/:reg: 同じ登録記号に複数の塗装機があるとタブが出て運航中が先頭', async () => {
  db.mock.reset();
  db.mock.addLivery({ reg: 'JA819A', name: '旧塗装機（終了）', airline: 'ANA', status: 'approved', since: '2015-01-01', until_date: '2020-03-31' });
  const r = res();
  await handler(req('JA819A'), r);
  assert.equal(r.code, 200);
  assert.match(r.body, /class="tabs lvtabs"/);
  const first = r.body.indexOf('ピカチュウジェット NH');
  const second = r.body.indexOf('旧塗装機（終了）');
  assert.ok(first > 0 && first < second, '運航中の塗装機が先に来る');
});

// ---------------------------------------------------------------------------
// GET /api/livery
// ---------------------------------------------------------------------------

test('GET /api/livery: 塗装機・写真・現在地を返す（現在地の取得失敗は unknown）', async () => {
  db.mock.reset();
  position.clearPositionCache();
  seedPhoto();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const r = res();
    await liveryApi({ query: { reg: 'JA819A' } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.headers['Cache-Control'], 'public, s-maxage=20, stale-while-revalidate=10');
    assert.equal(r.body.reg, 'JA819A');
    assert.equal(r.body.liveries[0].name, 'ピカチュウジェット NH');
    assert.equal(r.body.photos.length, 1);
    assert.equal(r.body.photos[0].credit, '撮影者X');
    assert.equal(r.body.photos[0].isPrimary, true);
    assert.equal(r.body.photos[0].snsUrl, 'https://x.com/mock_user1');
    assert.equal(r.body.photos[0].airportName, '東京国際（羽田）');
    assert.equal(r.body.position.state, 'unknown');
  } finally {
    globalThis.fetch = realFetch;
    position.clearPositionCache();
  }
});

test('GET /api/livery: reg 無しは 400、未登録は 404', async () => {
  db.mock.reset();
  let r = res();
  await liveryApi({ query: {} }, r);
  assert.equal(r.code, 400);

  r = res();
  await liveryApi({ query: { reg: 'ZZ999' } }, r);
  assert.equal(r.code, 404);
});

// ---------------------------------------------------------------------------
// lib/db.js の getLiveryPageData
// ---------------------------------------------------------------------------

test('getLiveryPageData: 承認済み写真だけを代表写真から順に返す', async () => {
  db.mock.reset();
  const older = seedPhoto({ credit_name: '撮影者A', created_at: '2020-01-01T00:00:00.000Z' });
  seedPhoto({ credit_name: '撮影者B', created_at: '2021-01-01T00:00:00.000Z' });
  seedPhoto({ credit_name: '却下された人', status: 'rejected' });
  const data = await db.getLiveryPageData('ja819a');
  assert.equal(data.reg, 'JA819A');
  assert.equal(data.liveries.length, 1);
  assert.equal(data.liveries[0].photoCount, 2);
  assert.deepEqual(data.photos.map((p) => p.credit), ['撮影者A', '撮影者B']);
  assert.equal(data.photos[0].id, older.id);
  assert.equal(data.photos[0].isPrimary, true);
});

// ---------------------------------------------------------------------------
// OG 画像
// ---------------------------------------------------------------------------

test('lib/og-render.js: 要素ツリーとサブセット文字（@vercel/og 抜きで検証できる）', () => {
  const { element, text } = og.buildOgElement({
    name: 'ピカチュウジェット NH', reg: 'JA819A', airline: 'ANA', type: 'B787-8',
    credit: '撮影者X', photoUrl: 'https://db.example/a.jpg', color: '#f4c20d',
  });
  assert.equal(element.type, 'div');
  const json = JSON.stringify(element);
  assert.match(json, /ピカチュウジェット NH/);
  assert.match(json, /JA819A/);
  assert.match(json, /https:\/\/db\.example\/a\.jpg/);
  // 描く文字はすべてサブセットに入っている（入っていないと豆腐になる）
  for (const c of 'ピカチュウジェット NHJA819AANAB787-8撮影者Xスペマウォッチ📷') {
    assert.ok(text.includes(c), `サブセットに ${c} が無い`);
  }
  // data: URL や javascript: は背景に使わない
  assert.ok(!JSON.stringify(og.buildOgElement({ name: 'x', reg: 'Y', photoUrl: 'javascript:alert(1)' }).element).includes('javascript:'));
});

test('lib/og-render.js: parseFontUrls は Google Fonts の TTF を拾う', () => {
  const css = "@font-face { font-family: 'Noto Sans JP'; src: url(https://fonts.gstatic.com/l/font?kit=abc) format('truetype'); }";
  assert.deepEqual(og.parseFontUrls(css), ['https://fonts.gstatic.com/l/font?kit=abc']);
  assert.deepEqual(og.parseFontUrls(''), []);
});

test('lib/og-render.js: フォント取得に失敗しても空配列（画像は出す）', async () => {
  og.clearFontCache();
  assert.deepEqual(await og.loadJpFonts('あ', async () => { throw new Error('offline'); }), []);
  og.clearFontCache();
  assert.deepEqual(await og.loadJpFonts('あ', async () => ({ ok: false, status: 500 })), []);
});

/**
 * api/og.js は Node ランタイムで動かす（@vercel/og 1.x の Edge ビルドは Vercel の Edge Runtime に載らない）。
 * ここでは取り決めだけを確かめる。実物の描画は test/og-render.smoke.js（ネットワーク要）で確認する。
 */
test('api/og.js: Node ランタイムで、lib/status.js を読み込んでいないこと', async () => {
  const src = await readFile(new URL('../api/og.js', import.meta.url), 'utf8');
  assert.ok(!/runtime:\s*['"]edge['"]/.test(src));
  assert.match(src, /from '@vercel\/og'/);
  assert.ok(!/from '\.\.\/lib\/status\.js'/.test(src));
});
