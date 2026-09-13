/**
 * モックモードの投稿フローを Node で通す（ブラウザ無しの受け入れ確認）。
 *
 * public/js/upload.js と public/js/me.html が行う呼び出しと同じ順番で
 * validate.js → mockdb.js を叩き、/submit.html → /me.html の流れを検証する。
 * 画像処理（Canvas）だけはブラウザでしか動かないので、生成済みの data URL を渡す。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// mockdb.js は localStorage があればそれを使う。ブラウザ相当の経路を試すため偽物を入れる。
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, val) => { mem.set(k, String(val)); },
  removeItem: (k) => { mem.delete(k); },
};

const { validateLiveryForm, validatePhotoForm, storagePaths } = await import('../public/js/validate.js');
const db = await import('../public/js/mockdb.js');

const THUMB_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';   // 実際は Canvas が作る
const MAIN_URL = 'blob:mock/main';

function submitNewLivery(session, form) {
  const live = validateLiveryForm(form);
  assert.equal(live.ok, true, JSON.stringify(live.errors));
  return db.insertLivery(live.row, session.user.id);
}

/** upload.js の insertPhoto（モック分岐）と同じ手順 */
function submitPhoto(session, livery, form, uuid) {
  const photo = validatePhotoForm(form, { requirePhoto: true, hasFile: true });
  assert.equal(photo.ok, true, JSON.stringify(photo.errors));
  const { path, thumbPath } = storagePaths(session.user.id, uuid);
  db.putImage(path, MAIN_URL);
  db.putImage(thumbPath, THUMB_DATA_URL, { thumb: true });
  return db.insertPhoto({ ...photo.row, storage_path: path, thumb_path: thumbPath }, {
    userId: session.user.id,
    creditName: session.user.displayName,
    livery,
  });
}

test.beforeEach(() => { db.reset(); });

test('未ログインでは getSession が null', () => {
  assert.equal(db.getSession(), null);
  assert.equal(db.getMockUserId(), null);
});

test('モックログイン: 一般ユーザーと管理者で role が変わる', () => {
  const s = db.signIn('user1');
  assert.equal(s.user.id, 'user1');
  assert.equal(s.user.role, 'user');
  assert.equal(s.user.displayName, 'モック一般ユーザー');
  assert.ok(s.accessToken);

  const a = db.signIn('admin');
  assert.equal(a.user.role, 'admin');
  assert.throws(() => db.signIn('nobody'), /モックユーザーがありません/);

  db.signOut();
  assert.equal(db.getSession(), null);
});

test('新しい塗装を登録すると pending でマイページに出る', () => {
  const session = db.signIn('user1');
  const row = submitNewLivery(session, {
    reg: 'ja820a', name: 'テスト塗装', airline: 'ANA', aircraft_type: 'B787-8',
    source_url: 'https://example.com/pr', note: 'テスト', since: '2026-04-01',
  });
  assert.equal(row.status, 'pending');          // 投稿直後は必ず承認待ち
  assert.equal(row.created_by, 'user1');
  assert.equal(row.reg, 'JA820A');
  assert.ok(row.id >= 1000);                    // サーバー側モックの 1..11 と衝突しない

  const mine = db.listMyLiveries('user1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, 'テスト塗装');
  assert.equal(db.listMyLiveries('admin').length, 0);   // 他人の投稿は見えない
});

test('同じ機体・同じ塗装名の二重投稿を弾く（liveries_reg_name_uniq と同じ）', () => {
  const session = db.signIn('user1');
  const form = { reg: 'JA820A', name: 'テスト塗装', source_url: 'https://example.com/pr' };
  submitNewLivery(session, form);
  assert.throws(() => submitNewLivery(session, form), /すでに/);
});

test('既存の塗装に写真を追加 → サムネイルが出る → 削除できる', () => {
  const session = db.signIn('user1');
  const livery = { id: 7, reg: 'JA819A', name: 'ピカチュウジェット NH', status: 'approved' };
  const photo = submitPhoto(session, livery, {
    agree: true, taken_on: '2026-08-01', airport_icao: 'RJTT', caption: '羽田にて',
  }, 'uuid-1');

  assert.equal(photo.status, 'pending');
  assert.equal(photo.is_primary, false);        // 代表写真は承認後に管理者側で決まる
  assert.equal(photo.user_id, 'user1');
  assert.equal(photo.credit_name, 'モック一般ユーザー');
  assert.equal(photo.storage_path, 'user1/uuid-1.jpg');
  assert.equal(photo.thumb_path, 'user1/uuid-1_thumb.jpg');

  const list = db.listMyPhotos('user1');
  assert.equal(list.length, 1);
  assert.equal(list[0].thumbUrl, THUMB_DATA_URL);
  assert.equal(list[0].url, MAIN_URL);
  assert.equal(list[0].livery.reg, 'JA819A');

  assert.throws(() => db.deletePhoto('admin', photo.id), /見つかりません/);   // 他人の写真は消せない
  db.deletePhoto('user1', photo.id);
  assert.equal(db.listMyPhotos('user1').length, 0);
  assert.equal(db.imageUrl('user1/uuid-1_thumb.jpg'), null);                  // 画像も消える
});

test('新規登録と写真を同時に投稿する（/submit.html モード a）', () => {
  const session = db.signIn('user1');
  const livery = submitNewLivery(session, {
    reg: 'JA821A', name: '同時投稿テスト', source_url: 'https://example.com/pr',
  });
  const photo = submitPhoto(session, livery, { agree: true }, 'uuid-2');
  assert.equal(photo.livery_id, livery.id);
  assert.equal(db.listMyPhotos('user1')[0].livery.name, '同時投稿テスト');
  assert.equal(db.listMyLiveries('user1')[0].status, 'pending');
});

test('表示名を変えても既存写真のクレジットは固定される', () => {
  const session = db.signIn('user1');
  const photo = submitPhoto(session, { id: 7, reg: 'JA819A', name: 'x' }, { agree: true }, 'uuid-3');
  db.updateProfile('user1', { display_name: '新しい名前', sns_url: 'https://x.com/me' });

  const after = db.getSession();
  assert.equal(after.user.displayName, '新しい名前');
  assert.equal(after.user.snsUrl, 'https://x.com/me');
  assert.equal(db.listMyPhotos('user1')[0].credit_name, photo.credit_name);
  assert.equal(db.listMyPhotos('user1')[0].credit_name, 'モック一般ユーザー');
});

test('localStorage に残るので再読み込み後も投稿が見える', () => {
  const session = db.signIn('user1');
  submitNewLivery(session, { reg: 'JA822A', name: '保存テスト', source_url: 'https://example.com/pr' });
  submitPhoto(session, { id: 7, reg: 'JA819A', name: 'x' }, { agree: true }, 'uuid-4');

  // localStorage の生データだけから読み直す（= ページを開き直した状態）
  const raw = JSON.parse(mem.get('awMockDb'));
  assert.equal(raw.liveries.length, 1);
  assert.equal(raw.photos.length, 1);
  assert.equal(mem.get('awMockUser'), 'user1');
  assert.equal(JSON.parse(mem.get('awMockThumbs'))['user1/uuid-4_thumb.jpg'], THUMB_DATA_URL);
  assert.deepEqual(db.dump().liveries[0].reg, 'JA822A');
});

test('ログインしていない状態では insert できない', () => {
  assert.throws(() => db.insertLivery({ reg: 'JA823A', name: 'x' }, null), /ログインが必要です/);
  assert.throws(() => db.insertPhoto({ storage_path: 'a/b.jpg', thumb_path: 'a/b_thumb.jpg' }, {}), /ログインが必要です/);
});
