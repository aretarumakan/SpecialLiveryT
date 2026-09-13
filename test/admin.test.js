/**
 * フェーズ C（管理画面）のテスト: node --test test/
 *
 *  - lib/auth.js のモック経路（Bearer mock:<id>）と 401 / 403
 *  - /api/admin/approve の承認・却下（代表写真の自動決定・理由必須）
 *  - /api/report の 3 件ルール
 *  - /api/admin/pending, primary, reports, hex-fill, sweep, credit-backfill
 *  - hex 補完の応答の解釈（fetch を差し替えて外に出さない）
 *  - /api/admin/users・/api/admin/role（管理者の増減）
 *  - /api/admin/settings と /api/photos の finalize（写真の自動承認）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_DB = '1';
delete process.env.MOCK_SEED_PENDING;

const db = await import('../lib/db.js');
const auth = await import('../lib/auth.js');
const adminLib = await import('../lib/admin.js');

const pending = (await import('../lib/admin-api/pending.js')).default;
const approve = (await import('../lib/admin-api/approve.js')).default;
const primary = (await import('../lib/admin-api/primary.js')).default;
const reports = (await import('../lib/admin-api/reports.js')).default;
const hexFill = (await import('../lib/admin-api/hex-fill.js')).default;
const sweep = (await import('../lib/admin-api/sweep.js')).default;
const creditBackfill = (await import('../lib/admin-api/credit-backfill.js')).default;
const users = (await import('../lib/admin-api/users.js')).default;
const role = (await import('../lib/admin-api/role.js')).default;
const settings = (await import('../lib/admin-api/settings.js')).default;
const report = (await import('../api/report.js')).default;
const photos = (await import('../api/photos.js')).default;
const adminOps = (await import('../api/admin.js')).default;
const config = (await import('../api/config.js')).default;

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function res() {
  const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

/** @param {{as?:string, method?:string, body?:Object, query?:Object}} o */
function req(o = {}) {
  const headers = {};
  if (o.as) headers.authorization = `Bearer ${o.as}`;
  if (o.rawAuth) headers.authorization = o.rawAuth;
  return { method: o.method || 'GET', headers, query: o.query || {}, body: o.body };
}

async function call(handler, o) {
  const r = res();
  await handler(req(o), r);
  return r;
}

test.beforeEach(() => { db.mock.reset(); });

// ---------------------------------------------------------------------------
// lib/auth.js
// ---------------------------------------------------------------------------

test('getCallerProfile: モックは Bearer mock:<id> と mock-<id> を受ける', async () => {
  assert.equal(await auth.getCallerProfile(req()), null);
  assert.equal(await auth.getCallerProfile(req({ rawAuth: 'Basic zzz' })), null);
  assert.equal(await auth.getCallerProfile(req({ as: 'nonsense-token' })), null);

  const admin = await auth.getCallerProfile(req({ as: 'mock:admin' }));
  assert.deepEqual(admin, { id: 'admin', displayName: 'モック管理者', role: 'admin' });

  // public/js/mockdb.js の accessToken はハイフン区切り
  const user = await auth.getCallerProfile(req({ as: 'mock-user1' }));
  assert.deepEqual(user, { id: 'user1', displayName: 'モック一般ユーザー', role: 'user' });

  // 知らない id は一般ユーザーとして作られる（モックだけの寛容さ）
  const other = await auth.getCallerProfile(req({ as: 'mock:someone' }));
  assert.equal(other.role, 'user');
});

test('bearerToken: 形式が違うものは拾わない', () => {
  assert.equal(auth.bearerToken({ headers: {} }), null);
  assert.equal(auth.bearerToken({ headers: { authorization: 'Bearer' } }), null);
  assert.equal(auth.bearerToken({ headers: { authorization: 'bearer  abc ' } }), 'abc');
});

test('管理 API は未ログインで 401、一般ユーザーで 403', async () => {
  const handlers = [
    ['pending', pending, {}],
    ['approve', approve, { method: 'POST', body: { type: 'livery', id: 1, action: 'approve' } }],
    ['primary', primary, { query: { reg: 'JA819A' } }],
    ['reports', reports, {}],
    ['hex-fill', hexFill, { method: 'POST', body: {} }],
    ['sweep', sweep, { method: 'POST', body: {} }],
    ['credit-backfill', creditBackfill, { method: 'POST', body: { userId: 'user1' } }],
    ['users', users, {}],
    ['role', role, { method: 'POST', body: { userId: 'user1', role: 'admin' } }],
    ['settings', settings, {}],
  ];
  for (const [name, handler, opt] of handlers) {
    const anon = await call(handler, opt);
    assert.equal(anon.code, 401, `${name} は未ログインで 401`);
    assert.match(anon.body.error, /ログインが必要/);
    assert.equal(anon.headers['Cache-Control'], 'no-store');

    const user = await call(handler, { ...opt, as: 'mock:user1' });
    assert.equal(user.code, 403, `${name} は一般ユーザーで 403`);
    assert.match(user.body.error, /権限がありません/);
  }
});

test('管理 API はメソッド違いを 405 で弾く', async () => {
  const r = await call(approve, { as: 'mock:admin', method: 'GET' });
  assert.equal(r.code, 405);
  assert.equal(r.headers.Allow, 'POST');

  const g = await call(pending, { as: 'mock:admin', method: 'POST' });
  assert.equal(g.code, 405);
});

// ---------------------------------------------------------------------------
// /api/admin/pending
// ---------------------------------------------------------------------------

test('GET /api/admin/pending: 承認待ちと通報と件数を返す', async () => {
  const l = db.mock.addLivery({ reg: 'JA801A', name: 'テスト塗装機', airline: 'ANA', created_by: 'user1', source_url: 'https://example.com/a' });
  const p = db.mock.addPhoto({ livery_id: 7, user_id: 'user1', credit_name: '撮影者A' });
  db.mock.addReport({ target_type: 'livery', target_id: l.id, reason: '出典が怪しい', reporter_id: 'user1' });

  const r = await call(pending, { as: 'mock:admin' });
  assert.equal(r.code, 200);
  assert.equal(r.body.mock, true);
  assert.deepEqual(r.body.counts, { liveries: 1, photos: 1, reports: 1, total: 2 });

  assert.equal(r.body.liveries.length, 1);
  assert.equal(r.body.liveries[0].name, 'テスト塗装機');
  assert.equal(r.body.liveries[0].createdByName, 'モック一般ユーザー');
  assert.equal(r.body.liveries[0].sourceUrl, 'https://example.com/a');

  assert.equal(r.body.photos.length, 1);
  assert.equal(r.body.photos[0].id, p.id);
  assert.equal(r.body.photos[0].liveryReg, 'JA819A');   // 7 番目の seed
  assert.equal(r.body.photos[0].credit, '撮影者A');
  assert.equal(r.body.photos[0].userName, 'モック一般ユーザー');

  assert.equal(r.body.reports.length, 1);
  assert.equal(r.body.reports[0].reason, '出典が怪しい');
  assert.match(r.body.reports[0].target.label, /テスト塗装機（JA801A）/);
  assert.equal(r.body.reports[0].reporterName, 'モック一般ユーザー');
});

// ---------------------------------------------------------------------------
// /api/admin/approve
// ---------------------------------------------------------------------------

test('POST /api/admin/approve: 塗装機の承認で一覧に出る', async () => {
  const l = db.mock.addLivery({ reg: 'JA802A', name: '承認テスト', airline: 'JAL', created_by: 'user1' });
  const r = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'livery', id: l.id, action: 'approve' } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, type: 'livery', id: l.id, status: 'approved', primaryPhotoId: null });

  const row = db.mock.store().liveries.find((x) => x.id === l.id);
  assert.equal(row.status, 'approved');
  assert.equal(row.approved_by, 'admin');
  const map = await db.getApprovedLiveries();
  assert.ok(map.JA802A);
});

test('POST /api/admin/approve: 最初に承認した写真が代表写真になる', async () => {
  const l = db.mock.addLivery({ reg: 'JA803A', name: '代表テスト', status: 'approved' });
  const p1 = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '一番目', created_at: '2026-01-01T00:00:00.000Z' });
  const p2 = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '二番目', created_at: '2026-02-01T00:00:00.000Z' });

  // 後から投稿された p2 を先に承認 → p2 が代表（「最初に承認した人」がサムネイル権を得る）
  const a = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'photo', id: p2.id, action: 'approve' } });
  assert.equal(a.code, 200);
  assert.equal(a.body.primaryPhotoId, p2.id);

  // 続けて p1 を承認しても代表は変わらない
  const b = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'photo', id: p1.id, action: 'approve' } });
  assert.equal(b.body.primaryPhotoId, p2.id);

  const view = await db.getLiveryByReg('JA803A');
  assert.equal(view.credit, '二番目');
  assert.ok(view.thumbUrl === null || typeof view.thumbUrl === 'string'); // モックは URL を作れない
});

test('POST /api/admin/approve: 却下は理由必須・500 字まで', async () => {
  const l = db.mock.addLivery({ reg: 'JA804A', name: '却下テスト', created_by: 'user1' });

  const noReason = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'livery', id: l.id, action: 'reject' } });
  assert.equal(noReason.code, 400);
  assert.match(noReason.body.error, /理由が必要/);
  assert.equal(db.mock.store().liveries.find((x) => x.id === l.id).status, 'pending');

  const tooLong = await call(approve, {
    as: 'mock:admin', method: 'POST',
    body: { type: 'livery', id: l.id, action: 'reject', reason: 'あ'.repeat(501) },
  });
  assert.equal(tooLong.code, 400);
  assert.match(tooLong.body.error, /500 字以内/);

  const ok = await call(approve, {
    as: 'mock:admin', method: 'POST',
    body: { type: 'livery', id: l.id, action: 'reject', reason: '出典が公式発表ではありません' },
  });
  assert.equal(ok.code, 200);
  const row = db.mock.store().liveries.find((x) => x.id === l.id);
  assert.equal(row.status, 'rejected');
  assert.equal(row.reject_reason, '出典が公式発表ではありません');
});

test('POST /api/admin/approve: 不正な入力は 400、無い id は 404', async () => {
  const bad = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'user', id: 1, action: 'approve' } });
  assert.equal(bad.code, 400);
  const badId = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'livery', id: '1; drop table', action: 'approve' } });
  assert.equal(badId.code, 400);
  const badAction = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'livery', id: 1, action: 'delete' } });
  assert.equal(badAction.code, 400);
  const missing = await call(approve, { as: 'mock:admin', method: 'POST', body: { type: 'livery', id: 99999, action: 'approve' } });
  assert.equal(missing.code, 404);
});

// ---------------------------------------------------------------------------
// /api/admin/primary
// ---------------------------------------------------------------------------

test('/api/admin/primary: 承認済み写真の一覧と差し替え', async () => {
  const l = db.mock.addLivery({ reg: 'JA805A', name: '差し替えテスト', status: 'approved' });
  const p1 = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '一番目', status: 'approved', created_at: '2026-01-01T00:00:00.000Z' });
  const p2 = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '二番目', status: 'approved', created_at: '2026-02-01T00:00:00.000Z' });
  const pendingPhoto = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '承認待ち' });

  const list = await call(primary, { as: 'mock:admin', query: { reg: 'ja805a' } });
  assert.equal(list.code, 200);
  assert.equal(list.body.count, 1);
  assert.deepEqual(list.body.items[0].photos.map((p) => p.id), [p1.id, p2.id]); // 承認待ちは出ない
  assert.equal(list.body.items[0].photos[0].isPrimary, true);                   // 最古が代表

  const set = await call(primary, { as: 'mock:admin', method: 'POST', body: { photoId: p2.id } });
  assert.equal(set.code, 200);
  assert.equal(set.body.liveryId, l.id);
  assert.equal((await db.getLiveryByReg('JA805A')).credit, '二番目');

  const notApproved = await call(primary, { as: 'mock:admin', method: 'POST', body: { photoId: pendingPhoto.id } });
  assert.equal(notApproved.code, 400);
  assert.match(notApproved.body.error, /承認済みの写真だけ/);

  const badReg = await call(primary, { as: 'mock:admin', query: { reg: 'JA805A%27' } });
  assert.equal(badReg.code, 400);
});

// ---------------------------------------------------------------------------
// /api/report と 3 件ルール
// ---------------------------------------------------------------------------

test('POST /api/report: ログインすれば誰でも通報できる', async () => {
  const anon = await call(report, { method: 'POST', body: { targetType: 'livery', targetId: 1, reason: 'だめ' } });
  assert.equal(anon.code, 401);

  const ok = await call(report, { as: 'mock:user1', method: 'POST', body: { targetType: 'livery', targetId: 1, reason: '情報が古い' } });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.count, 1);
  assert.equal(ok.body.hidden, false);
  assert.equal(db.mock.store().reports[0].reporter_id, 'user1');

  const noReason = await call(report, { as: 'mock:user1', method: 'POST', body: { targetType: 'livery', targetId: 1, reason: '  ' } });
  assert.equal(noReason.code, 400);

  const badType = await call(report, { as: 'mock:user1', method: 'POST', body: { targetType: 'profile', targetId: 1, reason: 'x' } });
  assert.equal(badType.code, 400);

  const missing = await call(report, { as: 'mock:user1', method: 'POST', body: { targetType: 'photo', targetId: 9999, reason: 'x' } });
  assert.equal(missing.code, 404);
});

test('通報が 3 件たまった写真は承認待ちに戻り、代表写真も入れ替わる', async () => {
  const l = db.mock.addLivery({ reg: 'JA806A', name: '通報テスト', status: 'approved' });
  const p1 = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '通報される人', status: 'approved', created_at: '2026-01-01T00:00:00.000Z' });
  const p2 = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '次の人', status: 'approved', created_at: '2026-02-01T00:00:00.000Z' });
  assert.equal(db.mock.store().photos.find((p) => p.id === p1.id).is_primary, true);

  // 非表示の判定は「通報した人数」。同じ人が重ねて出しても増えない（0004_hardening.sql）
  const reporters = ['mock:user1', 'mock:user2'];
  for (let i = 1; i <= 2; i += 1) {
    const r = await call(report, { as: reporters[i - 1], method: 'POST', body: { targetType: 'photo', targetId: p1.id, reason: `通報 ${i}` } });
    assert.equal(r.body.count, i);
    assert.equal(r.body.hidden, false);
  }
  const dup = await call(report, { as: 'mock:user1', method: 'POST', body: { targetType: 'photo', targetId: p1.id, reason: '同じ人の 2 回目' } });
  assert.equal(dup.code, 409);
  assert.equal(db.mock.store().photos.find((p) => p.id === p1.id).status, 'approved');

  const third = await call(report, { as: 'mock:admin', method: 'POST', body: { targetType: 'photo', targetId: p1.id, reason: '通報 3' } });
  assert.equal(third.body.count, 3);
  assert.equal(third.body.hidden, true);

  const hidden = db.mock.store().photos.find((p) => p.id === p1.id);
  assert.equal(hidden.status, 'pending');
  assert.equal(hidden.is_primary, false);
  assert.equal(db.mock.store().photos.find((p) => p.id === p2.id).is_primary, true);
  assert.equal((await db.getLiveryByReg('JA806A')).credit, '次の人');

  // 解決済みの通報は数えない（解決してから 3 件目を入れても非表示にならない）
  const list = await call(reports, { as: 'mock:admin' });
  assert.equal(list.body.count, 3);
  assert.equal(list.body.items[0].targetType, 'photo');
});

test('/api/admin/reports: 解決にすると一覧から消える', async () => {
  const rep = db.mock.addReport({ target_type: 'livery', target_id: 1, reason: '重複登録', reporter_id: 'user1' });
  const before = await call(reports, { as: 'mock:admin' });
  assert.equal(before.body.count, 1);

  const done = await call(reports, { as: 'mock:admin', method: 'POST', body: { id: rep.id } });
  assert.equal(done.code, 200);
  assert.equal(done.body.resolved, true);

  const after = await call(reports, { as: 'mock:admin' });
  assert.equal(after.body.count, 0);
  const all = await call(reports, { as: 'mock:admin', query: { all: '1' } });
  assert.equal(all.body.count, 1);

  const missing = await call(reports, { as: 'mock:admin', method: 'POST', body: { id: 999 } });
  assert.equal(missing.code, 404);
});

// ---------------------------------------------------------------------------
// hex 補完
// ---------------------------------------------------------------------------

test('parseModeS: mode_s を小文字 6 桁だけ通す', () => {
  assert.equal(adminLib.parseModeS({ response: { aircraft: { mode_s: '86D310' } } }), '86d310');
  assert.equal(adminLib.parseModeS({ response: { aircraft: { mode_s: ' 86d310 ' } } }), '86d310');
  assert.equal(adminLib.parseModeS({ response: { aircraft: { mode_s: '' } } }), null);
  assert.equal(adminLib.parseModeS({ response: { aircraft: { mode_s: 'ZZZZZZ' } } }), null);
  assert.equal(adminLib.parseModeS({ response: { aircraft: {} } }), null);
  assert.equal(adminLib.parseModeS({ response: 'unknown aircraft' }), null);
  assert.equal(adminLib.parseModeS(null), null);
});

test('fillMissingHex: adsbdb の応答で hex を埋める（fetch は差し替え）', async () => {
  db.mock.addLivery({ reg: 'JA807A', name: 'hex テスト', status: 'approved' });
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const reg = decodeURIComponent(String(url).split('/').pop());
    if (reg === 'JA819A') return { ok: true, status: 200, json: async () => ({ response: { aircraft: { mode_s: '86D310' } } }) };
    if (reg === 'JA807A') return { ok: false, status: 404 };
    if (reg === 'JA01XJ') return { ok: false, status: 500 };
    return { ok: true, status: 200, json: async () => ({ response: { aircraft: { mode_s: null } } }) };
  };

  const out = await adminLib.fillMissingHex({ limit: 3, fetchImpl: fakeFetch });
  assert.equal(out.checked, 3);
  assert.equal(calls.length, 3);
  assert.equal(out.filled, 0);                          // 先頭 3 件に JA819A は入らない
  assert.equal(out.errors.length, 1);                   // JA01XJ の HTTP 500
  assert.deepEqual(out.errors[0], { reg: 'JA01XJ', error: 'HTTP 500' });

  // 登録記号を絞って JA819A を確実に対象にする（hex が空の最初の 30 件が対象）
  db.mock.reset();
  const only = db.mock.addLivery({ reg: 'JA819A', name: '単体', status: 'approved' });
  db.mock.store().liveries = db.mock.store().liveries.filter((r) => r.id === only.id);
  const out2 = await adminLib.fillMissingHex({ fetchImpl: fakeFetch });
  assert.equal(out2.filled, 1);
  assert.deepEqual(out2.items[0], { id: only.id, reg: 'JA819A', hex: '86d310' });
  assert.equal(db.mock.store().liveries[0].hex, '86d310');
});

test('POST /api/admin/hex-fill: 管理者なら動き、limit を検証する', async () => {
  db.mock.reset();
  const only = db.mock.addLivery({ reg: 'JA819A', name: '単体', status: 'approved' });
  db.mock.store().liveries = db.mock.store().liveries.filter((r) => r.id === only.id);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ response: { aircraft: { mode_s: '86d310' } } }) });
  try {
    const r = await call(hexFill, { as: 'mock:admin', method: 'POST', body: {} });
    assert.equal(r.code, 200);
    assert.equal(r.body.filled, 1);

    const bad = await call(hexFill, { as: 'mock:admin', method: 'POST', body: { limit: -1 } });
    assert.equal(bad.code, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// 掃除・クレジット再反映
// ---------------------------------------------------------------------------

test('POST /api/admin/sweep: モックでは何もしない', async () => {
  const r = await call(sweep, { as: 'mock:admin', method: 'POST', body: {} });
  assert.equal(r.code, 200);
  assert.equal(r.body.skipped, true);
  assert.equal(r.body.deleted, 0);
});

test('POST /api/admin/credit-backfill: 今の表示名を過去の写真に反映する', async () => {
  const l = db.mock.addLivery({ reg: 'JA808A', name: 'クレジットテスト', status: 'approved' });
  db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '旧すぎる名前', status: 'approved' });
  db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '旧すぎる名前', status: 'pending' });
  db.mock.addPhoto({ livery_id: l.id, user_id: 'admin', credit_name: '他人', status: 'approved' });
  db.mock.setProfile('user1', { display_name: '新しい名前' });

  const r = await call(creditBackfill, { as: 'mock:admin', method: 'POST', body: { userId: 'user1' } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, userId: 'user1', creditName: '新しい名前', updated: 2 });
  assert.equal(db.mock.store().photos[2].credit_name, '他人');
  assert.equal((await db.getLiveryByReg('JA808A')).credit, '新しい名前');

  const bad = await call(creditBackfill, { as: 'mock:admin', method: 'POST', body: { userId: 'ab/../cd' } });
  assert.equal(bad.code, 400);
  const empty = await call(creditBackfill, { as: 'mock:admin', method: 'POST', body: {} });
  assert.equal(empty.code, 400);
});

// ---------------------------------------------------------------------------
// 入力検証（service role キーは RLS を素通りするので、ここが最後の砦）
// ---------------------------------------------------------------------------

test('parsePositiveId / cleanReason / parseUserId / parseReg / parseHex', () => {
  assert.equal(db.parsePositiveId('42'), 42);
  assert.equal(db.parsePositiveId(' 7 '), 7);
  for (const bad of ['', null, undefined, 0, -1, 1.5, 'abc', '1 or 1=1', 1e30, NaN]) {
    assert.throws(() => db.parsePositiveId(bad), /が不正です/, `${bad} は弾く`);
  }

  assert.equal(db.cleanReason('  理由  '), '理由');
  assert.equal(db.cleanReason(''), null);
  assert.throws(() => db.cleanReason('', { required: true, label: '却下の理由' }), /却下の理由が必要です/);
  assert.throws(() => db.cleanReason('x'.repeat(501)), /500 字以内/);
  assert.equal(db.cleanReason('x'.repeat(500)).length, 500);

  assert.equal(db.parseUserId('user1'), 'user1');
  assert.throws(() => db.parseUserId('a b'), /が不正です/);
  assert.throws(() => db.parseUserId(''), /が必要です/);

  assert.equal(db.parseReg(' ja819a '), 'JA819A');
  assert.throws(() => db.parseReg('JA819A;'), /が不正です/);
  assert.throws(() => db.parseReg('%'), /が不正です/);

  assert.equal(db.parseHex('86D310'), '86d310');
  assert.throws(() => db.parseHex('86d31'), /が不正です/);
});

// ---------------------------------------------------------------------------
// 管理者を増やす／外す（/api/admin/users, /api/admin/role）
// ---------------------------------------------------------------------------

test('GET /api/admin/users: 管理者一覧・表示名の部分一致・メールの完全一致', async () => {
  const empty = await call(users, { as: 'mock:admin' });
  assert.equal(empty.code, 200);
  assert.deepEqual(empty.body.admins.map((u) => u.id), ['admin']);
  assert.equal(empty.body.admins[0].displayName, 'モック管理者');
  assert.deepEqual(empty.body.items, []);                       // q が無ければ検索しない

  const byName = await call(users, { as: 'mock:admin', query: { q: '一般' } });
  assert.equal(byName.body.count, 1);
  assert.equal(byName.body.items[0].id, 'user1');
  assert.equal(byName.body.items[0].role, 'user');
  assert.equal(byName.body.items[0].email, undefined);          // 表示名検索ではメールを出さない

  const byMail = await call(users, { as: 'mock:admin', query: { q: 'USER1@example.com' } });
  assert.equal(byMail.body.count, 1);
  assert.equal(byMail.body.items[0].id, 'user1');
  assert.equal(byMail.body.items[0].email, 'user1@example.com');

  const none = await call(users, { as: 'mock:admin', query: { q: 'だれもいない' } });
  assert.equal(none.body.count, 0);

  const post = await call(users, { as: 'mock:admin', method: 'POST', body: {} });
  assert.equal(post.code, 405);
});

test('POST /api/admin/role: 管理者にする／外す', async () => {
  const up = await call(role, { as: 'mock:admin', method: 'POST', body: { userId: 'user1', role: 'admin' } });
  assert.equal(up.code, 200);
  assert.equal(up.body.role, 'admin');
  assert.equal(up.body.changed, true);
  assert.deepEqual(up.body.admins.map((u) => u.id).sort(), ['admin', 'user1']);
  assert.equal((await db.getProfileById('user1')).role, 'admin');

  // 同じ role をもう一度送っても壊れない
  const again = await call(role, { as: 'mock:admin', method: 'POST', body: { userId: 'user1', role: 'admin' } });
  assert.equal(again.body.changed, false);

  // user1（管理者になった）から admin を外せる（管理者は 2 人いるので通る）
  const down = await call(role, { as: 'mock:user1', method: 'POST', body: { userId: 'admin', role: 'user' } });
  assert.equal(down.code, 200);
  assert.deepEqual(down.body.admins.map((u) => u.id), ['user1']);
});

test('POST /api/admin/role: 自分自身の降格と最後の管理者は断る', async () => {
  const self = await call(role, { as: 'mock:admin', method: 'POST', body: { userId: 'admin', role: 'user' } });
  assert.equal(self.code, 400);
  assert.match(self.body.error, /自分自身/);
  assert.equal((await db.getProfileById('admin')).role, 'admin');

  // 管理者が 1 人のときの降格（API では自分自身の判定に先に当たるので lib を直接叩く）
  await assert.rejects(() => db.setProfileRole('admin', 'user'), /0 人になる/);
  assert.equal((await db.getProfileById('admin')).role, 'admin');

  const badRole = await call(role, { as: 'mock:admin', method: 'POST', body: { userId: 'user1', role: 'owner' } });
  assert.equal(badRole.code, 400);
  assert.match(badRole.body.error, /role が不正/);

  const badUser = await call(role, { as: 'mock:admin', method: 'POST', body: { userId: 'a b', role: 'admin' } });
  assert.equal(badUser.code, 400);

  const get = await call(role, { as: 'mock:admin' });
  assert.equal(get.code, 405);
});

// ---------------------------------------------------------------------------
// 設定（/api/admin/settings）と写真の自動承認（/api/photos）
// ---------------------------------------------------------------------------

test('/api/admin/settings: 既定は自動承認 ON。保存して読み直せる', async () => {
  const before = await call(settings, { as: 'mock:admin' });
  assert.equal(before.code, 200);
  assert.equal(before.body.settings.auto_approve_photos, true);
  assert.equal(before.body.defaults.auto_approve_photos, true);

  const off = await call(settings, { as: 'mock:admin', method: 'POST', body: { key: 'auto_approve_photos', value: false } });
  assert.equal(off.code, 200);
  assert.equal(off.body.settings.auto_approve_photos, false);
  assert.equal(await db.getSetting('auto_approve_photos', true), false);

  const after = await call(settings, { as: 'mock:admin' });
  assert.equal(after.body.settings.auto_approve_photos, false);

  // まとめて送る形も受ける
  const on = await call(settings, { as: 'mock:admin', method: 'POST', body: { settings: { auto_approve_photos: 'true' } } });
  assert.equal(on.body.settings.auto_approve_photos, true);

  const badKey = await call(settings, { as: 'mock:admin', method: 'POST', body: { key: 'drop_table', value: true } });
  assert.equal(badKey.code, 400);
  assert.match(badKey.body.error, /設定キーが不正/);

  const badValue = await call(settings, { as: 'mock:admin', method: 'POST', body: { key: 'auto_approve_photos', value: 'maybe' } });
  assert.equal(badValue.code, 400);

  const empty = await call(settings, { as: 'mock:admin', method: 'POST', body: {} });
  assert.equal(empty.code, 400);

  const put = await call(settings, { as: 'mock:admin', method: 'PUT', body: {} });
  assert.equal(put.code, 405);
});

test('GET /api/config: autoApprovePhotos を配る（モックのクライアントが同じ判断をするため）', async () => {
  const on = await call(config, {});
  assert.equal(on.body.mock, true);
  assert.equal(on.body.autoApprovePhotos, true);

  await db.setSetting('auto_approve_photos', false);
  const off = await call(config, {});
  assert.equal(off.body.autoApprovePhotos, false);
});

test('POST /api/photos finalize: 自動承認 ON なら公開され、代表写真になる', async () => {
  const l = db.mock.addLivery({ reg: 'JA809A', name: '自動承認テスト', status: 'approved' });
  const p = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '投稿者' });
  assert.equal(p.status, 'pending');

  const r = await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'finalize', photoId: p.id } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { status: 'approved', autoApprove: true, primaryPhotoId: p.id });

  const row = db.mock.store().photos.find((x) => x.id === p.id);
  assert.equal(row.status, 'approved');
  assert.equal(row.is_primary, true);
  assert.equal((await db.getLiveryByReg('JA809A')).credit, '投稿者');

  // もう一度呼んでも承認済みのまま（再送に耐える）
  const again = await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'finalize', photoId: p.id } });
  assert.equal(again.body.status, 'approved');
  assert.equal(again.body.autoApprove, false);
});

test('POST /api/photos finalize: 自動承認 OFF なら承認待ちのまま', async () => {
  await db.setSetting('auto_approve_photos', false);
  const l = db.mock.addLivery({ reg: 'JA810A', name: '手動承認テスト', status: 'approved' });
  const p = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '投稿者' });

  const r = await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'finalize', photoId: p.id } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { status: 'pending', autoApprove: false });
  assert.equal(db.mock.store().photos.find((x) => x.id === p.id).status, 'pending');
  assert.equal(db.mock.store().photos.find((x) => x.id === p.id).is_primary, false);
});

test('POST /api/photos finalize: 他人の写真・未ログイン・不正な op は通さない', async () => {
  const l = db.mock.addLivery({ reg: 'JA811A', name: '他人テスト', status: 'approved' });
  const mine = db.mock.addPhoto({ livery_id: l.id, user_id: 'admin', credit_name: '管理者の写真' });

  const anon = await call(photos, { method: 'POST', body: { op: 'finalize', photoId: mine.id } });
  assert.equal(anon.code, 401);

  const other = await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'finalize', photoId: mine.id } });
  assert.equal(other.code, 404);
  assert.equal(db.mock.store().photos.find((x) => x.id === mine.id).status, 'pending');

  const missing = await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'finalize', photoId: 99999 } });
  assert.equal(missing.code, 404);

  const badId = await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'finalize', photoId: '1; drop' } });
  assert.equal(badId.code, 400);

  const badOp = await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'delete', photoId: mine.id } });
  assert.equal(badOp.code, 400);

  const get = await call(photos, { as: 'mock:user1' });
  assert.equal(get.code, 405);
});

test('自動承認された写真も通報 3 件で承認待ちに戻る', async () => {
  const l = db.mock.addLivery({ reg: 'JA812A', name: '通報と自動承認', status: 'approved' });
  const p = db.mock.addPhoto({ livery_id: l.id, user_id: 'user1', credit_name: '自動承認された人' });
  await call(photos, { as: 'mock:user1', method: 'POST', body: { op: 'finalize', photoId: p.id } });
  assert.equal(db.mock.store().photos.find((x) => x.id === p.id).status, 'approved');

  // 別々の 3 人から通報されたときだけ非表示になる
  for (const who of ['mock:user1', 'mock:user2', 'mock:admin']) {
    await call(report, { as: who, method: 'POST', body: { targetType: 'photo', targetId: p.id, reason: `通報 ${who}` } });
  }
  const row = db.mock.store().photos.find((x) => x.id === p.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.is_primary, false);
});

test('/api/admin/:op の振り分けに users / role / settings が入っている', async () => {
  const r = await call(adminOps, { as: 'mock:admin', query: { op: 'users' } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.admins.map((u) => u.id), ['admin']);

  const s = await call(adminOps, { as: 'mock:admin', query: { op: 'settings' } });
  assert.equal(s.body.settings.auto_approve_photos, true);

  const unknown = await call(adminOps, { as: 'mock:admin', query: { op: 'nope' } });
  assert.equal(unknown.code, 404);
});

test('MOCK_SEED_PENDING=1 で管理画面用のダミーが入る', async () => {
  process.env.MOCK_SEED_PENDING = '1';
  try {
    db.mock.reset();
    const r = await call(pending, { as: 'mock:admin' });
    assert.equal(r.body.counts.liveries, 2);
    assert.equal(r.body.counts.photos, 2);
    assert.equal(r.body.counts.reports, 1);
  } finally {
    delete process.env.MOCK_SEED_PENDING;
    db.mock.reset();
  }
});
