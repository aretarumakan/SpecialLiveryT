// lib/db.js のモックバックエンドの単体テスト: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_DB = '1';
delete process.env.GOOGLE_CLIENT_ID; // publicConfig の googleClientId は未設定で null

const db = await import('../lib/db.js');
const { SPECIAL_LIVERIES } = await import('../lib/liveries.js');

function freshStore() {
  db.mock.reset();
  db.invalidateCache();
}

test('isMock: MOCK_DB=1 ならモック', () => {
  assert.equal(db.isMock(), true);
  assert.deepEqual(db.publicConfig(), { supabaseUrl: null, supabaseAnonKey: null, googleClientId: null, mock: true });
});

test('getApprovedLiveries: lib/liveries.js の 11 件が登録記号キーで返る', async () => {
  freshStore();
  const map = await db.getApprovedLiveries();
  const regs = Object.keys(map);
  assert.equal(regs.length, Object.keys(SPECIAL_LIVERIES).length);
  assert.ok(regs.includes('JA819A'));
  const v = map.JA819A;
  assert.equal(v.reg, 'JA819A');
  assert.equal(v.name, 'ピカチュウジェット NH');
  assert.equal(v.airline, 'ANA');
  assert.equal(v.type, 'B787-8');            // aircraft_type → type
  assert.equal(v.color, '#f4c20d');
  assert.equal(v.until, null);               // 運航中
  assert.equal(v.photoUrl, null);            // 写真はまだ無い
  assert.equal(v.thumbUrl, null);
  assert.equal(v.credit, null);
  assert.ok(typeof v.id === 'number');
  for (const key of ['id', 'reg', 'hex', 'name', 'name_en', 'airline', 'type', 'note', 'color',
    'since', 'until', 'sourceUrl', 'photoUrl', 'thumbUrl', 'credit']) {
    assert.ok(key in v, `${key} が無い`);
  }
});

test('getApprovedLiveries: 60 秒キャッシュが効き、invalidateCache で捨てられる', async () => {
  freshStore();
  const a = await db.getApprovedLiveries();
  db.mock.addLivery({ reg: 'JA000X', name: 'キャッシュ確認', airline: 'ANA', status: 'approved' });
  // addLivery はキャッシュを落とすので、落とさない経路を確かめるため再取得 → 同一参照
  const b = await db.getApprovedLiveries();
  const c = await db.getApprovedLiveries();
  assert.equal(b, c, '同じオブジェクトが返る（キャッシュ）');
  assert.notEqual(a, b);
  db.invalidateCache();
  const d = await db.getApprovedLiveries();
  assert.notEqual(b, d);
});

test('getLiveryByReg: 小文字でも引ける / 未知は null', async () => {
  freshStore();
  const v = await db.getLiveryByReg('ja819a');
  assert.equal(v.reg, 'JA819A');
  assert.equal(await db.getLiveryByReg('ZZZZZZ'), null);
  assert.equal(await db.getLiveryByReg(''), null);
  assert.equal(await db.getLiveryByReg(null), null);
});

test('listLiveries: 既定は承認済みのみ', async () => {
  freshStore();
  db.mock.addLivery({ reg: 'JA001P', name: '承認待ちの塗装', airline: 'ANA' });
  const approved = await db.listLiveries();
  assert.equal(approved.length, 11);
  assert.ok(!approved.some((i) => i.reg === 'JA001P'));

  const pending = await db.listLiveries({ status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reg, 'JA001P');

  const all = await db.listLiveries({ status: 'all' });
  assert.equal(all.length, 12);
});

test('listLiveries: airline / q で絞り込める', async () => {
  freshStore();
  const ana = await db.listLiveries({ airline: 'ANA' });
  assert.equal(ana.length, 3);
  assert.ok(ana.every((i) => i.airline === 'ANA'));

  assert.equal((await db.listLiveries({ airline: '存在しない' })).length, 0);

  const pika = await db.listLiveries({ q: 'ピカチュウ' });
  assert.equal(pika.length, 3);           // ANA 1 + Skymark 2

  const byReg = await db.listLiveries({ q: 'ja819' });   // 大文字小文字を無視
  assert.equal(byReg.length, 1);
  assert.equal(byReg[0].reg, 'JA819A');

  const byType = await db.listLiveries({ q: 'A350-900' });
  assert.equal(byType.length, 4);

  // 登録記号の昇順
  const regs = (await db.listLiveries()).map((i) => i.reg);
  assert.deepEqual(regs, regs.slice().sort());
});

test('listLiveries: activeOnly は運航終了を除く', async () => {
  freshStore();
  db.mock.addLivery({ reg: 'JA002R', name: '退役した塗装', airline: 'JAL', status: 'approved', until_date: '2020-01-31' });
  const all = await db.listLiveries();
  assert.equal(all.length, 12);
  const retired = all.find((i) => i.reg === 'JA002R');
  assert.equal(retired.until, '2020-01-31');
  assert.equal(retired.active, false);

  const active = await db.listLiveries({ activeOnly: true });
  assert.equal(active.length, 11);
  assert.ok(active.every((i) => i.active === true && !i.until));
});

test('代表写真: 最初に承認された写真が代表になり、URL が一覧に出る', async () => {
  freshStore();
  const ja819 = (await db.listLiveries()).find((i) => i.reg === 'JA819A');
  const p1 = db.mock.addPhoto({ livery_id: ja819.id, credit_name: '撮影者A', created_at: '2026-01-01T00:00:00.000Z' });
  const p2 = db.mock.addPhoto({ livery_id: ja819.id, credit_name: '撮影者B', created_at: '2026-02-01T00:00:00.000Z' });

  // 承認待ちのうちは代表にならない
  let v = await db.getLiveryByReg('JA819A');
  assert.equal(v.thumbUrl, null);
  assert.equal(v.credit, null);

  // 後から投稿された p2 を先に承認 → p2 が代表
  const r2 = await db.adminUpdateStatus({ type: 'photo', id: p2.id, action: 'approve', adminId: 'admin-1' });
  assert.equal(r2.status, 'approved');
  assert.equal(r2.primaryPhotoId, p2.id);
  v = await db.getLiveryByReg('JA819A');
  assert.equal(v.credit, '撮影者B');
  // モック（SUPABASE_URL 無し）では公開 URL を作れないのでパスは出せない
  assert.equal(v.thumbUrl, null);

  // p1 を承認しても代表は変わらない（最初に承認した人がサムネイル権を持つ）
  const r1 = await db.adminUpdateStatus({ type: 'photo', id: p1.id, action: 'approve' });
  assert.equal(r1.primaryPhotoId, p2.id);
  assert.equal((await db.getLiveryByReg('JA819A')).credit, '撮影者B');

  // 代表写真が却下されたら、次に古い承認済み写真（p1）が代表になる
  const r3 = await db.adminUpdateStatus({ type: 'photo', id: p2.id, action: 'reject', reason: '権利が不明' });
  assert.equal(r3.primaryPhotoId, p1.id);
  assert.equal((await db.getLiveryByReg('JA819A')).credit, '撮影者A');

  // 代表写真が削除されたら代表不在になる
  db.mock.deletePhoto(p1.id);
  db.invalidateCache();
  assert.equal((await db.getLiveryByReg('JA819A')).credit, null);
});

test('publicPhotoUrl: SUPABASE_URL があれば Storage の公開 URL を作る', async () => {
  freshStore();
  assert.equal(db.publicPhotoUrl(null), null);
  assert.equal(db.publicPhotoUrl('u/1.jpg'), null);         // URL 未設定
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  try {
    assert.equal(db.publicPhotoUrl('u/1.jpg'),
      'https://example.supabase.co/storage/v1/object/public/livery-photos/u/1.jpg');
    assert.equal(db.publicPhotoUrl('/u/1.jpg'),
      'https://example.supabase.co/storage/v1/object/public/livery-photos/u/1.jpg');
    assert.equal(db.publicPhotoUrl('https://cdn/x.jpg'), 'https://cdn/x.jpg');
    assert.equal(db.isMock(), true, 'MOCK_DB=1 が優先される');
  } finally {
    delete process.env.SUPABASE_URL;
  }
});

test('getPendingCounts: 承認待ちと未解決の通報を数える', async () => {
  freshStore();
  assert.deepEqual(await db.getPendingCounts(), { liveries: 0, photos: 0, reports: 0, total: 0 });

  const l = db.mock.addLivery({ reg: 'JA003P', name: '承認待ち', airline: 'ANA' });
  db.mock.addPhoto({ livery_id: l.id });
  db.mock.addPhoto({ livery_id: l.id });
  db.mock.addReport({ target_type: 'photo', target_id: 1, reason: '転載' });
  db.mock.addReport({ target_type: 'photo', target_id: 2, reason: '済み', resolved: true });

  assert.deepEqual(await db.getPendingCounts(), { liveries: 1, photos: 2, reports: 1, total: 3 });

  await db.adminUpdateStatus({ type: 'livery', id: l.id, action: 'approve', adminId: 'admin-1' });
  const after = await db.getPendingCounts();
  assert.equal(after.liveries, 0);
});

test('adminUpdateStatus: 塗装の承認・却下', async () => {
  freshStore();
  const l = db.mock.addLivery({ reg: 'JA004P', name: '新しい塗装', airline: 'ANA', created_by: 'user-1' });
  assert.equal((await db.getLiveryByReg('JA004P')), null);

  const ok = await db.adminUpdateStatus({ type: 'livery', id: l.id, action: 'approve', adminId: 'admin-1' });
  assert.deepEqual(ok, { ok: true, type: 'livery', id: l.id, status: 'approved', primaryPhotoId: null });
  assert.equal(l.approved_by, 'admin-1');
  assert.ok(l.approved_at);
  assert.equal((await db.getLiveryByReg('JA004P')).name, '新しい塗装');

  await db.adminUpdateStatus({ type: 'livery', id: l.id, action: 'reject', reason: '出典が無い' });
  assert.equal(l.status, 'rejected');
  assert.equal(l.reject_reason, '出典が無い');
  assert.equal(l.approved_by, null);
  assert.equal(await db.getLiveryByReg('JA004P'), null);
  const rejected = await db.listLiveries({ status: 'rejected' });
  assert.equal(rejected[0].rejectReason, '出典が無い');
});

test('adminUpdateStatus: 引数の検証', async () => {
  freshStore();
  await assert.rejects(() => db.adminUpdateStatus({ type: 'user', id: 1, action: 'approve' }), /type が不正/);
  await assert.rejects(() => db.adminUpdateStatus({ type: 'livery', id: 1, action: 'delete' }), /action が不正/);
  await assert.rejects(() => db.adminUpdateStatus({ type: 'livery', id: 'x', action: 'approve' }), /id が不正/);
  await assert.rejects(() => db.adminUpdateStatus({ type: 'livery', id: 1, action: 'reject' }), /理由が必要/);
  await assert.rejects(() => db.adminUpdateStatus({ type: 'livery', id: 9999, action: 'approve' }), /見つかりません/);
  await assert.rejects(() => db.adminUpdateStatus({ type: 'photo', id: 9999, action: 'approve' }), /見つかりません/);
});
