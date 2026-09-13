/**
 * モックモード専用のクライアント側ストア。
 *
 * Supabase が無い環境（`npm run dev`）でも /login.html → /submit.html → /me.html の
 * 流れを最後まで触れるようにするための置き換え層。本物の supabase-js を使う経路とは
 * 呼び出し側（upload.js / 各ページ）で if 分岐する。環境の分岐は lib/db.js と
 * public/js/common.js（+ このファイルを呼ぶページ）に閉じている。
 *
 * 保存先: localStorage（`awMockDb` / `awMockUser` / `awMockThumbs`）。
 * localStorage が使えない環境（Node のテスト）ではメモリに落ちる。
 * 写真の本体（長辺 1600px）はメモリだけに置く（localStorage の容量を食わないため）。
 * サムネイルは data URL のまま localStorage に残すので、再読み込みしても表示できる。
 */

const KEY_DB = 'awMockDb';
const KEY_USER = 'awMockUser';
const KEY_THUMBS = 'awMockThumbs';

/** モックのログインユーザー（/login.html の 2 つのボタン） */
export const MOCK_USERS = {
  user1: { id: 'user1', email: 'user1@example.com', display_name: 'モック一般ユーザー', role: 'user', sns_url: null },
  admin: { id: 'admin', email: 'admin@example.com', display_name: 'モック管理者', role: 'admin', sns_url: null },
};

// ---------------------------------------------------------------------------
// 保存先（localStorage か、使えなければメモリ）
// ---------------------------------------------------------------------------

const memory = new Map();

function backing() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem('awMockProbe', '1');
      localStorage.removeItem('awMockProbe');
      return localStorage;
    }
  } catch { /* プライベートブラウズなどではメモリに落とす */ }
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
  };
}

function readJson(key, fallback) {
  try {
    const raw = backing().getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

function writeJson(key, value) {
  try { backing().setItem(key, JSON.stringify(value)); } catch { /* 容量オーバーは黙って諦める */ }
}

// 塗装の id はサーバー側モック（lib/db.js の 11 件 = 1..11）と衝突しないよう 1000 から振る
function emptyDb() {
  return { profiles: {}, liveries: [], photos: [], nextLivery: 1000, nextPhoto: 0 };
}

function db() {
  const d = readJson(KEY_DB, null);
  if (!d || typeof d !== 'object') return emptyDb();
  return { ...emptyDb(), ...d };
}

function save(d) {
  writeJson(KEY_DB, d);
  return d;
}

/** テスト・やり直し用。すべて消す */
export function reset() {
  const b = backing();
  b.removeItem(KEY_DB);
  b.removeItem(KEY_USER);
  b.removeItem(KEY_THUMBS);
  fullImages.clear();
  return emptyDb();
}

/** デバッグ用に中身をそのまま返す */
export function dump() {
  return db();
}

// ---------------------------------------------------------------------------
// ログイン
// ---------------------------------------------------------------------------

/** 現在のモックユーザー id（未ログインなら null） */
export function getMockUserId() {
  const id = backing().getItem(KEY_USER);
  return id && MOCK_USERS[id] ? id : null;
}

/** モックでログインする。profiles の行も作る */
export function signIn(id) {
  if (!MOCK_USERS[id]) throw new Error(`モックユーザーがありません: ${id}`);
  backing().setItem(KEY_USER, id);
  ensureProfile(id);
  return getSession();
}

export function signOut() {
  backing().removeItem(KEY_USER);
}

/** profiles 行が無ければ MOCK_USERS の既定で作る */
export function ensureProfile(id) {
  const d = db();
  if (!d.profiles[id]) {
    const base = MOCK_USERS[id] || { id, display_name: id, role: 'user', sns_url: null, email: null };
    d.profiles[id] = { id, display_name: base.display_name, sns_url: base.sns_url || null, role: base.role || 'user' };
    save(d);
  }
  return db().profiles[id];
}

/** @returns {{user:{id,email,displayName,snsUrl,role}, accessToken:string}|null} */
export function getSession() {
  const id = getMockUserId();
  if (!id) return null;
  const p = ensureProfile(id);
  return {
    user: {
      id,
      email: (MOCK_USERS[id] && MOCK_USERS[id].email) || null,
      displayName: p.display_name,
      snsUrl: p.sns_url || null,
      role: p.role || 'user',
    },
    accessToken: `mock-${id}`,
    mock: true,
  };
}

/** profiles の更新（display_name / sns_url のみ。role は触らない） */
export function updateProfile(id, patch = {}) {
  const d = db();
  const p = d.profiles[id] || { id, display_name: id, sns_url: null, role: 'user' };
  if (patch.display_name !== undefined) p.display_name = patch.display_name;
  if (patch.sns_url !== undefined) p.sns_url = patch.sns_url;
  d.profiles[id] = p;
  save(d);
  return p;
}

export function getProfile(id) {
  return db().profiles[id] || null;
}

// ---------------------------------------------------------------------------
// 画像（アップロードの代わり）
// ---------------------------------------------------------------------------

const fullImages = new Map(); // storage_path → object URL / data URL（メモリのみ）

/**
 * 「アップロード」。サムネイルだけ localStorage に残す。
 * @param {string} path
 * @param {string} url data URL か object URL
 * @param {{thumb?:boolean}} opts
 */
export function putImage(path, url, opts = {}) {
  if (opts.thumb) {
    const thumbs = readJson(KEY_THUMBS, {});
    thumbs[path] = url;
    writeJson(KEY_THUMBS, thumbs);
  }
  fullImages.set(path, url);
  return path;
}

/** 画像の表示 URL（無ければ null） */
export function imageUrl(path) {
  if (!path) return null;
  if (fullImages.has(path)) return fullImages.get(path);
  const thumbs = readJson(KEY_THUMBS, {});
  return thumbs[path] || null;
}

function removeImage(path) {
  if (!path) return;
  fullImages.delete(path);
  const thumbs = readJson(KEY_THUMBS, {});
  if (thumbs[path]) { delete thumbs[path]; writeJson(KEY_THUMBS, thumbs); }
}

// ---------------------------------------------------------------------------
// liveries / photos
// ---------------------------------------------------------------------------

/**
 * 塗装の登録（RLS と同じく status は pending・created_by は本人に固定する）。
 * @param {Object} row validate.js の validateLiveryForm が作った行
 * @param {string} userId
 */
export function insertLivery(row, userId) {
  if (!userId) throw new Error('ログインが必要です');
  const d = db();
  const dup = d.liveries.find(
    (r) => r.created_by === userId && r.reg === row.reg && r.name === row.name && r.status !== 'rejected'
  );
  if (dup) throw new Error('同じ機体に同じ塗装名の投稿がすでにあります');
  d.nextLivery += 1;
  const saved = {
    ...row,
    id: d.nextLivery,
    status: 'pending',
    reject_reason: null,
    created_by: userId,
    created_at: new Date().toISOString(),
  };
  d.liveries.push(saved);
  save(d);
  return saved;
}

/**
 * 写真の登録。livery は表示用のスナップショット `{id, reg, name, status}`。
 * @param {Object} row validatePhotoForm の行 + storage_path / thumb_path
 * @param {{userId:string, creditName:string, livery:Object}} ctx
 */
export function insertPhoto(row, ctx = {}) {
  if (!ctx.userId) throw new Error('ログインが必要です');
  if (!ctx.livery || !ctx.livery.id) throw new Error('塗装が選ばれていません');
  if (!row.storage_path || !row.thumb_path) throw new Error('storage のパスがありません');
  const d = db();
  d.nextPhoto += 1;
  const saved = {
    ...row,
    id: d.nextPhoto,
    livery_id: Number(ctx.livery.id),
    user_id: ctx.userId,
    credit_name: ctx.creditName || ctx.userId,
    status: 'pending',
    is_primary: false,
    reject_reason: null,
    created_at: new Date().toISOString(),
    livery: {
      id: Number(ctx.livery.id),
      reg: ctx.livery.reg || '',
      name: ctx.livery.name || '',
      status: ctx.livery.status || 'approved',
    },
  };
  d.photos.push(saved);
  save(d);
  return saved;
}

/**
 * 投稿直後の写真を公開する（サーバーの `POST /api/photos` の finalize に相当）。
 * モックではサーバーの app_settings を `/api/config` の `autoApprovePhotos` として受け取り、
 * 同じ判断をここで再現する。代表写真は自分の投稿の範囲でしか分からないので、
 * このストアに承認済みの代表写真が無ければ代表にする（本物は decide_primary が決める）。
 *
 * @param {number|string} id
 * @param {boolean} autoApprove `/api/config` の autoApprovePhotos
 * @returns {'approved'|'pending'|string} 反映後の status
 */
export function finalizePhoto(id, autoApprove) {
  const d = db();
  const p = d.photos.find((x) => x.id === Number(id));
  if (!p) throw new Error('写真が見つかりません');
  if (p.status !== 'pending' || autoApprove !== true) return p.status;
  p.status = 'approved';
  const hasPrimary = d.photos.some((x) => x.livery_id === p.livery_id && x.is_primary && x.status === 'approved');
  if (!hasPrimary) p.is_primary = true;
  save(d);
  return 'approved';
}

/** 自分が登録した塗装（新しい順） */
export function listMyLiveries(userId) {
  return db().liveries
    .filter((r) => r.created_by === userId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/** 自分が投稿した写真（新しい順）。表示用に url / thumbUrl を足す */
export function listMyPhotos(userId) {
  return db().photos
    .filter((r) => r.user_id === userId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((r) => ({ ...r, url: imageUrl(r.storage_path), thumbUrl: imageUrl(r.thumb_path) }));
}

/** 自分の写真を削除（RLS と同じく他人の写真は消せない） */
export function deletePhoto(userId, id) {
  const d = db();
  const i = d.photos.findIndex((p) => p.id === Number(id) && p.user_id === userId);
  if (i < 0) throw new Error('写真が見つかりません');
  const [row] = d.photos.splice(i, 1);
  save(d);
  removeImage(row.storage_path);
  removeImage(row.thumb_path);
  return row;
}
