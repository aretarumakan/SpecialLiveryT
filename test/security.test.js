// セキュリティ強化（docs/design-security-hardening.md §6）の単体テスト: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.MOCK_DB = '1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await import('../lib/db.js');
const photosApi = (await import('../api/photos.js')).default;
const { allowedPhotoUrl } = await import('../api/og.js');

const UID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function res() {
  const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function photoRow(over = {}) {
  return {
    user_id: UID,
    storage_path: `${UID}/${UUID}.jpg`,
    thumb_path: `${UID}/${UUID}_thumb.jpg`,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §1 写真パスの検証
// ---------------------------------------------------------------------------

test('assertPhotoPaths: 規約どおりの {uid}/{uuid}.jpg は通る', () => {
  assert.equal(db.assertPhotoPaths(photoRow()), true);
  // camelCase のキー（getPhotoForFinalize の戻り）でも同じ
  assert.equal(db.assertPhotoPaths({
    userId: UID, storagePath: `${UID}/${UUID}.jpg`, thumbPath: `${UID}/${UUID}_thumb.jpg`,
  }), true);
});

test('assertPhotoPaths: 他人のフォルダ・拡張子違い・サムネイル不一致・外部 URL は 400', () => {
  const bad = [
    photoRow({ storage_path: `${OTHER}/${UUID}.jpg`, thumb_path: `${OTHER}/${UUID}_thumb.jpg` }),
    photoRow({ storage_path: `${UID}/${UUID}.png`, thumb_path: `${UID}/${UUID}_thumb.png` }),
    photoRow({ storage_path: `${UID}/not-a-uuid.jpg`, thumb_path: `${UID}/not-a-uuid_thumb.jpg` }),
    photoRow({ thumb_path: `${UID}/${UUID}.jpg` }),
    photoRow({ storage_path: `https://evil.example.com/${UUID}.jpg` }),
    photoRow({ storage_path: `../${UID}/${UUID}.jpg` }),
    photoRow({ user_id: '' }),
  ];
  for (const row of bad) {
    let thrown = null;
    try { db.assertPhotoPaths(row); } catch (e) { thrown = e; }
    assert.ok(thrown, `通ってはいけない: ${JSON.stringify(row)}`);
    assert.equal(thrown.status, 400);
  }
});

test('assertPhotoPaths: モックの種データ（data: の SVG）だけは通す', () => {
  assert.equal(db.isMock(), true);
  assert.equal(db.assertPhotoPaths({
    user_id: 'user1', storage_path: 'data:image/svg+xml,%3Csvg/%3E', thumb_path: 'data:image/svg+xml,%3Csvg/%3E',
  }), true);
});

test('publicPhotoUrl: 本番では http(s) と data: を null にする（モックでは通す）', () => {
  db.mock.reset();
  // モード: モック（MOCK_DB=1）
  assert.equal(db.publicPhotoUrl('https://evil.example.com/x.jpg'), 'https://evil.example.com/x.jpg');
  assert.equal(db.publicPhotoUrl('data:image/svg+xml,x'), 'data:image/svg+xml,x');

  // モード: 本番（SUPABASE_URL あり・MOCK_DB なし）
  delete process.env.MOCK_DB;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  try {
    assert.equal(db.isMock(), false);
    assert.equal(db.publicPhotoUrl('https://evil.example.com/x.jpg'), null);
    assert.equal(db.publicPhotoUrl('http://evil.example.com/x.jpg'), null);
    assert.equal(db.publicPhotoUrl('data:image/svg+xml,x'), null);
    assert.equal(db.publicPhotoUrl(`${UID}/${UUID}.jpg`),
      `https://example.supabase.co/storage/v1/object/public/livery-photos/${UID}/${UUID}.jpg`);
  } finally {
    process.env.MOCK_DB = '1';
    delete process.env.SUPABASE_URL;
  }
});

test('api/og.js allowedPhotoUrl: Storage の公開 URL 以外は捨てる', () => {
  // モック: data: を通す
  assert.equal(allowedPhotoUrl('data:image/svg+xml,x'), 'data:image/svg+xml,x');
  assert.equal(allowedPhotoUrl(null), null);

  delete process.env.MOCK_DB;
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  try {
    const ok = `https://example.supabase.co/storage/v1/object/public/livery-photos/${UID}/${UUID}.jpg`;
    assert.equal(allowedPhotoUrl(ok), ok);
    assert.equal(allowedPhotoUrl('https://evil.example.com/x.jpg'), null);
    assert.equal(allowedPhotoUrl('https://example.supabase.co/storage/v1/object/sign/x.jpg'), null);
    assert.equal(allowedPhotoUrl('data:image/svg+xml,x'), null);
  } finally {
    process.env.MOCK_DB = '1';
    delete process.env.SUPABASE_URL;
  }
});

test('finalize: 保存先が不正な写真は 400 で承認されない', async () => {
  db.mock.reset();
  const livery = db.mock.addLivery({ reg: 'JA700S', name: '検証用', airline: 'ANA', status: 'approved' });

  // 他人のフォルダを指した行（RLS をすり抜けても、ここで止まる）
  const bad = db.mock.addPhoto({
    livery_id: livery.id, user_id: 'mock-user1',
    storage_path: `${OTHER}/${UUID}.jpg`, thumb_path: `${OTHER}/${UUID}_thumb.jpg`,
  });
  let r = res();
  await photosApi({ method: 'POST', headers: { authorization: 'Bearer mock:mock-user1' }, body: { op: 'finalize', photoId: bad.id } }, r);
  assert.equal(r.code, 400);
  assert.match(r.body.error, /保存先が不正/);
  assert.equal(db.mock.store().photos.find((p) => p.id === bad.id).status, 'pending');

  // 正しいパスなら承認される（自動承認は既定 ON）
  const good = db.mock.addPhoto({ livery_id: livery.id, user_id: 'mock-user1' });
  r = res();
  await photosApi({ method: 'POST', headers: { authorization: 'Bearer mock:mock-user1' }, body: { op: 'finalize', photoId: good.id } }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.status, 'approved');
});

test('adminUpdateStatus: 保存先が不正な写真は承認できない（却下はできる）', async () => {
  db.mock.reset();
  const livery = db.mock.addLivery({ reg: 'JA701S', name: '検証用2', airline: 'ANA', status: 'approved' });
  const bad = db.mock.addPhoto({
    livery_id: livery.id, user_id: UID,
    storage_path: `${OTHER}/${UUID}.jpg`, thumb_path: `${OTHER}/${UUID}_thumb.jpg`,
  });
  await assert.rejects(
    () => db.adminUpdateStatus({ type: 'photo', id: bad.id, action: 'approve', adminId: 'admin' }),
    /保存先が不正/,
  );
  const rejected = await db.adminUpdateStatus({ type: 'photo', id: bad.id, action: 'reject', reason: '保存先が不正' });
  assert.equal(rejected.status, 'rejected');
});

// ---------------------------------------------------------------------------
// §2 通報の重複防止・人数での非表示・1 日の上限
// ---------------------------------------------------------------------------

async function approvedPhoto(reg = 'JA702S') {
  const livery = db.mock.addLivery({ reg, name: '通報の検証', airline: 'ANA', status: 'approved' });
  const photo = db.mock.addPhoto({ livery_id: livery.id, user_id: UID, status: 'approved' });
  return photo;
}

test('addReport: 同じ人の 2 回目は 409', async () => {
  db.mock.reset();
  const photo = await approvedPhoto();
  const first = await db.addReport({ targetType: 'photo', targetId: photo.id, reason: '転載です', reporterId: 'user1' });
  assert.equal(first.count, 1);
  assert.equal(first.hidden, false);

  let thrown = null;
  try {
    await db.addReport({ targetType: 'photo', targetId: photo.id, reason: 'もう一度', reporterId: 'user1' });
  } catch (e) { thrown = e; }
  assert.ok(thrown);
  assert.equal(thrown.status, 409);
  assert.match(thrown.message, /既に通報済み/);
});

test('addReport: 1 人が何度出しても非表示にならない（人数で数える）', async () => {
  db.mock.reset();
  const photo = await approvedPhoto('JA703S');
  await db.addReport({ targetType: 'photo', targetId: photo.id, reason: '1 回目', reporterId: 'user1' });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(
      () => db.addReport({ targetType: 'photo', targetId: photo.id, reason: '重ねて通報', reporterId: 'user1' }),
      (e) => e.status === 409,
    );
  }
  // 直接 3 件ぶんの行を作っても、通報者が 1 人なら非表示にならない
  db.mock.addReport({ target_type: 'photo', target_id: photo.id, reason: 'x', reporter_id: 'user1' });
  db.mock.addReport({ target_type: 'photo', target_id: photo.id, reason: 'y', reporter_id: 'user1' });
  const again = await db.addReport({ targetType: 'photo', targetId: photo.id, reason: '別人', reporterId: 'user2' });
  assert.equal(again.count, 2, '通報者は user1 と user2 の 2 人');
  assert.equal(again.hidden, false);
  assert.equal(db.mock.store().photos.find((p) => p.id === photo.id).status, 'approved');
});

test('addReport: 3 人ぶん集まったら写真を非表示にする', async () => {
  db.mock.reset();
  const photo = await approvedPhoto('JA704S');
  await db.addReport({ targetType: 'photo', targetId: photo.id, reason: 'a', reporterId: 'user1' });
  await db.addReport({ targetType: 'photo', targetId: photo.id, reason: 'b', reporterId: 'user2' });
  const third = await db.addReport({ targetType: 'photo', targetId: photo.id, reason: 'c', reporterId: 'user3' });
  assert.equal(third.count, 3);
  assert.equal(third.hidden, true);
  assert.equal(db.mock.store().photos.find((p) => p.id === photo.id).status, 'pending');
});

test('addReport: 1 日 20 件を超えたら 429', async () => {
  db.mock.reset();
  const livery = db.mock.addLivery({ reg: 'JA705S', name: '上限の検証', airline: 'ANA', status: 'approved' });
  // 20 件ぶん、それぞれ別の対象に通報する
  const photos = [];
  for (let i = 0; i < db.DAILY_LIMITS.reports; i++) {
    photos.push(db.mock.addPhoto({ livery_id: livery.id, user_id: UID, status: 'approved' }));
  }
  for (const p of photos) {
    await db.addReport({ targetType: 'photo', targetId: p.id, reason: '理由', reporterId: 'user1' });
  }
  const extra = db.mock.addPhoto({ livery_id: livery.id, user_id: UID, status: 'approved' });
  let thrown = null;
  try {
    await db.addReport({ targetType: 'photo', targetId: extra.id, reason: '21 件目', reporterId: 'user1' });
  } catch (e) { thrown = e; }
  assert.ok(thrown);
  assert.equal(thrown.status, 429);
  assert.match(thrown.message, /1 日 20 件/);

  // 別の人は通せる
  const other = await db.addReport({ targetType: 'photo', targetId: extra.id, reason: '別人', reporterId: 'user2' });
  assert.equal(other.ok, true);
});

test('DAILY_LIMITS: 0004_hardening.sql と同じ値', async () => {
  assert.deepEqual({ ...db.DAILY_LIMITS }, { photos: 30, liveries: 20, reports: 20 });
  const sql = await fs.readFile(path.join(ROOT, 'supabase/migrations/0004_hardening.sql'), 'utf8');
  assert.match(sql, /under_daily_limit\('photos', 30\)/);
  assert.match(sql, /under_daily_limit\('liveries', 20\)/);
  assert.match(sql, /reports_one_open_per_reporter/);
  assert.match(sql, /photos_storage_path_chk/);
  assert.match(sql, /drop policy if exists "livery-photos public read" on storage\.objects/);
});

// ---------------------------------------------------------------------------
// §5-2 セキュリティヘッダ / §5-3 role を返さない
// ---------------------------------------------------------------------------

test('vercel.json: 全パスにセキュリティヘッダ、/api の CORS はそのまま', async () => {
  const conf = JSON.parse(await fs.readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
  const all = conf.headers.find((h) => h.source === '/(.*)');
  assert.ok(all, '"/(.*)" のエントリが無い');
  const got = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
  assert.equal(got['X-Content-Type-Options'], 'nosniff');
  assert.equal(got['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(got['X-Frame-Options'], 'DENY');
  assert.equal(got['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');

  const api = conf.headers.find((h) => h.source === '/api/(.*)');
  assert.ok(api, '/api の CORS エントリが消えている');
  assert.equal(api.headers[0].key, 'Access-Control-Allow-Origin');
});

test('dev-server: vercel.json のヘッダ規則をそのまま当てる', async () => {
  const { loadHeaderRules } = await import('./dev-server.js');
  const rules = await loadHeaderRules();
  const hit = (p) => rules.filter((r) => r.re.test(p)).flatMap((r) => r.headers.map((h) => h.key));
  assert.ok(hit('/').includes('X-Frame-Options'));
  assert.ok(hit('/livery/JA819A').includes('X-Content-Type-Options'));
  assert.ok(hit('/api/config').includes('Access-Control-Allow-Origin'));
  assert.ok(hit('/api/config').includes('Referrer-Policy'));
});

test('/api/livery と /api/liveries の撮影者情報に role を含めない', async () => {
  db.mock.reset();
  const livery = db.mock.addLivery({ reg: 'JA706S', name: 'role の検証', airline: 'ANA', status: 'approved' });
  db.mock.addPhoto({ livery_id: livery.id, user_id: 'user1', status: 'approved', credit_name: 'モック一般ユーザー' });
  db.invalidateCache();

  const page = await db.getLiveryPageData('JA706S');
  assert.equal(page.photos.length, 1);
  for (const p of page.photos) assert.ok(!('role' in p), 'photos に role が漏れている');
  for (const l of page.liveries) assert.ok(!('role' in l), 'liveries に role が漏れている');
  assert.equal(JSON.stringify(page).includes('"role"'), false);

  const list = await db.listLiveries();
  assert.equal(JSON.stringify(list).includes('"role"'), false);
});
