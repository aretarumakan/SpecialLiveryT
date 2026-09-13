/**
 * 塗装データベースのアクセス層。
 *
 * 2 つのバックエンドを同じシグネチャで提供する。
 *  - 本物  : Supabase（PostgREST に素の fetch。node_modules もビルドも不要）
 *  - モック : メモリ内ストア（lib/liveries.js の 11 件で初期化）
 *
 * 切り替えは環境変数だけ。`SUPABASE_URL` が無い、または `MOCK_DB=1` ならモック。
 * 呼び出し側（api/*.js, lib/status.js）はどちらかを意識しない。
 *
 * 公開関数: isMock, getApprovedLiveries, getLiveryByReg, listLiveries,
 *           getPendingCounts, adminUpdateStatus, listPending, setPrimaryPhoto,
 *           listApprovedPhotosByReg, addReport, listReports, resolveReport,
 *           listMissingHex, setLiveryHex, listAllPhotoPaths, backfillCreditNames,
 *           getProfileById, getLiveryPageData
 *
 * 管理系（service role キーを使う書き込み）は RLS を素通りするため、
 * 入力の検証をこの層で必ず行う（parsePositiveId / cleanReason / parseUserId）。
 */
import { SPECIAL_LIVERIES } from './liveries.js';

export const LIVERY_CACHE_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const BUCKET = 'livery-photos';

// ---------------------------------------------------------------------------
// 環境
// ---------------------------------------------------------------------------

function env(key) {
  return (typeof process !== 'undefined' && process.env && process.env[key]) || '';
}

/**
 * HTTP の状態コードを持たせた例外。api/*.js の sendError がそのまま使う
 * （入力の不備 400 / 見つからない 404 を、メッセージの正規表現に頼らず判定するため）。
 * @param {number} status
 * @param {string} message
 */
export function dbError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** @returns {boolean} メモリ内モックで動いているか */
export function isMock() {
  if (env('MOCK_DB') === '1') return true;
  return !env('SUPABASE_URL');
}

function supabaseUrl() {
  return env('SUPABASE_URL').replace(/\/+$/, '');
}

/** フロントに配ってよい公開設定（api/config.js が返す） */
export function publicConfig() {
  const mock = isMock();
  return {
    supabaseUrl: mock ? null : supabaseUrl(),
    supabaseAnonKey: mock ? null : env('SUPABASE_ANON_KEY') || null,
    mock,
  };
}

/** Storage の公開 URL。モードに関わらずパスが無ければ null */
export function publicPhotoUrl(path) {
  if (!path) return null;
  // http(s) はそのまま。data: はモックの種データ（画面が実際に絵を出せるようにするため）
  if (/^(https?:\/\/|data:)/.test(path)) return path;
  const base = supabaseUrl();
  if (!base) return null;
  return `${base}/storage/v1/object/public/${BUCKET}/${String(path).replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// 行 → API 表現
// ---------------------------------------------------------------------------

/** 承認済みの代表写真（無ければ承認済みで最古）を選ぶ */
function pickPrimaryPhoto(photos) {
  const ok = (photos || []).filter((p) => p && p.status === 'approved');
  if (!ok.length) return null;
  const primary = ok.find((p) => p.is_primary);
  if (primary) return primary;
  return ok.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id)[0];
}

/**
 * liveries の 1 行（photos を同梱）を公開表現に変換する。
 * 画面・API・`/api/status` の `special` で共通に使う形。
 */
export function toLiveryView(row, photos) {
  const photo = pickPrimaryPhoto(photos !== undefined ? photos : row.photos);
  return {
    id: row.id,
    reg: String(row.reg || '').toUpperCase(),
    hex: row.hex || null,
    name: row.name || '',
    name_en: row.name_en || null,
    airline: row.airline || '',
    type: row.aircraft_type || '',
    note: row.note || '',
    color: row.color || null,
    since: row.since || null,
    until: row.until_date || null,
    sourceUrl: row.source_url || null,
    photoUrl: photo ? publicPhotoUrl(photo.storage_path) : null,
    thumbUrl: photo ? publicPhotoUrl(photo.thumb_path) : null,
    credit: photo ? photo.credit_name || null : null,
    status: row.status,
  };
}

/** 一覧 API 用（status を含め、内部 id 以外は toLiveryView と同じ） */
function toListItem(row, photos) {
  const v = toLiveryView(row, photos);
  return {
    ...v,
    active: !v.until,
    createdAt: row.created_at || null,
    rejectReason: row.reject_reason || null,
  };
}

function matchesFilter(row, view, { airline, q, activeOnly }) {
  if (airline && String(row.airline || '') !== String(airline)) return false;
  if (activeOnly && row.until_date) return false;
  if (q) {
    const needle = String(q).trim().toLowerCase();
    if (needle) {
      const hay = [row.reg, row.name, row.name_en, row.airline, row.aircraft_type, row.note]
        .map((s) => String(s || '').toLowerCase()).join(' ');
      if (!hay.includes(needle)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// モックバックエンド
// ---------------------------------------------------------------------------

let mockStore = null;

function seedRows() {
  const rows = [];
  let id = 0;
  for (const [reg, v] of Object.entries(SPECIAL_LIVERIES)) {
    id += 1;
    rows.push({
      id,
      reg,
      hex: null,
      name: v.name,
      name_en: null,
      airline: v.airline,
      aircraft_type: v.type,
      note: v.note,
      color: v.color,
      since: null,
      until_date: null,
      source_url: null,
      status: 'approved',
      reject_reason: null,
      created_by: null,
      approved_by: null,
      approved_at: new Date(0).toISOString(),
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    });
  }
  return rows;
}

/** モックの profiles（public/js/mockdb.js の MOCK_USERS と同じ 2 人） */
const MOCK_PROFILES = {
  user1: { id: 'user1', display_name: 'モック一般ユーザー', sns_url: 'https://x.com/mock_user1', role: 'user' },
  admin: { id: 'admin', display_name: 'モック管理者', sns_url: null, role: 'admin' },
};

/**
 * モック用のダミー画像（data: URL の SVG）。
 * Storage が無い開発環境でも共有ページ `/livery/:reg` とカードが実際に絵を出せるようにする。
 * publicPhotoUrl が data: をそのまま返すので storage_path にこの文字列を入れておく。
 */
function mockPhotoDataUrl(w, h, fontSize) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#f4c20d"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>'
    + '<rect width="' + w + '" height="' + h + '" fill="url(#g)"/>'
    + '<text x="50%" y="56%" font-size="' + fontSize + '" text-anchor="middle" fill="#0f172a">&#9992;</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function store() {
  if (!mockStore) {
    mockStore = {
      liveries: seedRows(), photos: [], reports: [],
      profiles: Object.fromEntries(Object.entries(MOCK_PROFILES).map(([k, v]) => [k, { ...v }])),
      nextLivery: 0, nextPhoto: 0,
    };
    mockStore.nextLivery = mockStore.liveries.length;
    // `npm run dev` は MOCK_SEED_PENDING=1 を付けるので、管理画面と共有ページに触れる材料が入る。
    // 既定（テスト）では写真 0 枚のまっさらな 11 件のままにしておく。
    if (env('MOCK_SEED_PENDING') === '1') { seedApprovedPhoto(); seedPendingDemo(); }
  }
  return mockStore;
}

/**
 * 承認済みの代表写真を 1 枚だけ種として入れる（JA819A）。
 * これが無いと共有ページ・一覧・トップのカードが「写真なし」の見た目しか確認できない。
 */
function seedApprovedPhoto() {
  const pika = mockStore.liveries.find((r) => r.reg === 'JA819A');
  if (!pika) return;
  mock.addPhoto({
    livery_id: pika.id,
    user_id: 'user1',
    credit_name: 'モック一般ユーザー',
    storage_path: mockPhotoDataUrl(320, 200, 96),
    thumb_path: mockPhotoDataUrl(96, 60, 30),
    taken_on: '2026-07-20',
    airport_icao: 'RJTT',
    caption: 'モックの種データ（第1ターミナル展望デッキ）',
    status: 'approved',
    created_at: new Date(0).toISOString(),
  });
}

/** 管理画面を手で触るためのダミーの承認待ち（MOCK_SEED_PENDING=1 のときだけ） */
function seedPendingDemo() {
  const livery = mock.addLivery({
    reg: 'JA03RJ', name: '検証用 特別塗装（承認待ち）', airline: 'ANA', aircraft_type: 'B737-800',
    note: '管理画面の動作確認に使うダミーです。', color: '#38bdf8',
    since: '2026-04-01', source_url: 'https://example.com/press-release',
    created_by: 'user1', status: 'pending',
  });
  mock.addLivery({
    reg: 'JA999Z', name: '検証用 却下テスト塗装', airline: 'JAL', aircraft_type: 'B767-300',
    note: '出典が無い例。却下の動作確認に使います。',
    created_by: 'user1', status: 'pending',
  });
  // 承認待ちの写真: 既存の承認済み塗装（JA819A）と上のダミー塗装に 1 枚ずつ
  const pika = store().liveries.find((r) => r.reg === 'JA819A');
  if (pika) mock.addPhoto({ livery_id: pika.id, user_id: 'user1', credit_name: 'モック一般ユーザー', taken_on: '2026-08-01', airport_icao: 'RJTT', caption: '第2ターミナルから', status: 'pending' });
  mock.addPhoto({ livery_id: livery.id, user_id: 'user1', credit_name: 'モック一般ユーザー', taken_on: '2026-09-01', airport_icao: 'RJOO', caption: 'ダミー塗装の写真', status: 'pending' });
  mock.addReport({ target_type: 'livery', target_id: livery.id, reason: '出典のリンクが切れています。', reporter_id: 'user1' });
}

/**
 * モック専用のテスト用ヘルパー。本番コードからは呼ばない。
 * `reset()` で 11 件の初期状態に戻す。
 */
export const mock = {
  reset() {
    mockStore = null;
    cache = null;
    return store();
  },
  store,
  addLivery(data = {}) {
    const s = store();
    s.nextLivery += 1;
    const row = {
      id: s.nextLivery,
      reg: String(data.reg || '').toUpperCase(),
      hex: data.hex || null,
      name: data.name || '',
      name_en: data.name_en || null,
      airline: data.airline || null,
      aircraft_type: data.aircraft_type || data.type || null,
      note: data.note || null,
      color: data.color || null,
      since: data.since || null,
      until_date: data.until_date || data.until || null,
      source_url: data.source_url || data.sourceUrl || null,
      status: data.status || 'pending',
      reject_reason: null,
      created_by: data.created_by || null,
      approved_by: null,
      approved_at: data.status === 'approved' ? new Date().toISOString() : null,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    s.liveries.push(row);
    cache = null;
    return row;
  },
  addPhoto(data = {}) {
    const s = store();
    s.nextPhoto += 1;
    const row = {
      id: s.nextPhoto,
      livery_id: Number(data.livery_id),
      user_id: data.user_id || 'mock-user',
      storage_path: data.storage_path || `mock-user/${s.nextPhoto}.jpg`,
      thumb_path: data.thumb_path || `mock-user/${s.nextPhoto}_thumb.jpg`,
      credit_name: data.credit_name || 'テスト撮影者',
      taken_on: data.taken_on || null,
      airport_icao: data.airport_icao || null,
      caption: data.caption || null,
      status: data.status || 'pending',
      reject_reason: null,
      is_primary: false,
      created_at: data.created_at || new Date().toISOString(),
    };
    s.photos.push(row);
    if (row.status === 'approved') mockDecidePrimary(row.livery_id);
    cache = null;
    return row;
  },
  addReport(data = {}) {
    const s = store();
    s.reports.push({
      id: s.reports.length + 1,
      target_type: data.target_type || 'photo',
      target_id: Number(data.target_id) || 0,
      reason: data.reason || '',
      reporter_id: data.reporter_id || null,
      created_at: new Date().toISOString(),
      resolved: data.resolved === true,
    });
    return s.reports[s.reports.length - 1];
  },
  /** profiles の追加・更新（テストと credit 再反映の検証で使う） */
  setProfile(id, patch = {}) {
    const s = store();
    const cur = s.profiles[id] || { id, display_name: String(id), sns_url: null, role: 'user' };
    s.profiles[id] = { ...cur, ...patch, id };
    return s.profiles[id];
  },
  deletePhoto(id) {
    const s = store();
    const i = s.photos.findIndex((p) => p.id === Number(id));
    if (i < 0) return null;
    const [row] = s.photos.splice(i, 1);
    mockDecidePrimary(row.livery_id);
    cache = null;
    return row;
  },
};

/** SQL の decide_primary() と同じ規則をモックで再現する */
function mockDecidePrimary(liveryId) {
  const s = store();
  const mine = s.photos.filter((p) => p.livery_id === Number(liveryId));
  for (const p of mine) if (p.is_primary && p.status !== 'approved') p.is_primary = false;
  if (mine.some((p) => p.is_primary)) return mine.find((p) => p.is_primary).id;
  const next = mine.filter((p) => p.status === 'approved')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id)[0];
  if (next) { next.is_primary = true; return next.id; }
  return null;
}

function mockPhotosOf(liveryId) {
  return store().photos.filter((p) => p.livery_id === Number(liveryId));
}

/** SQL の set_primary_photo() と同じ規則（承認済みの写真だけを代表にできる） */
function mockSetPrimary(photoId) {
  const s = store();
  const row = s.photos.find((p) => p.id === Number(photoId));
  if (!row) throw dbError(404, `写真が見つかりません: ${photoId}`);
  if (row.status !== 'approved') throw dbError(400, `承認済みの写真だけを代表にできます: ${photoId}`);
  for (const p of s.photos) if (p.livery_id === row.livery_id) p.is_primary = p.id === row.id;
  return row;
}

/** モックの profiles を引く（無ければ作る。id が 'admin' なら admin 扱い） */
function mockProfile(id) {
  const key = String(id == null ? '' : id);
  if (!key) return null;
  const s = store();
  if (!s.profiles[key]) {
    s.profiles[key] = {
      id: key,
      display_name: (MOCK_PROFILES[key] && MOCK_PROFILES[key].display_name) || key,
      sns_url: null,
      role: key === 'admin' ? 'admin' : 'user',
    };
  }
  return s.profiles[key];
}

// ---------------------------------------------------------------------------
// Supabase（PostgREST）バックエンド
// ---------------------------------------------------------------------------

const LIVERY_SELECT = [
  'id', 'reg', 'hex', 'name', 'name_en', 'airline', 'aircraft_type', 'note', 'color',
  'since', 'until_date', 'source_url', 'status', 'reject_reason', 'created_at',
  'photos(id,storage_path,thumb_path,credit_name,is_primary,status,created_at)',
].join(',');

/** 共有ページ用。写真に投稿者・撮影情報まで含める（getLiveryPageData） */
const PAGE_LIVERY_SELECT = LIVERY_SELECT.replace(
  'photos(id,storage_path,thumb_path,credit_name,is_primary,status,created_at)',
  'photos(id,user_id,storage_path,thumb_path,credit_name,taken_on,airport_icao,caption,is_primary,status,created_at)',
);

async function rest(path, { method = 'GET', body, prefer, admin = false } = {}) {
  const base = supabaseUrl();
  if (!base) throw new Error('SUPABASE_URL が設定されていません');
  const anon = env('SUPABASE_ANON_KEY');
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  const key = admin ? (service || anon) : anon;
  if (!key) throw new Error(admin ? 'SUPABASE_SERVICE_ROLE_KEY が設定されていません' : 'SUPABASE_ANON_KEY が設定されていません');
  if (admin && !service) throw new Error('管理操作には SUPABASE_SERVICE_ROLE_KEY が必要です');

  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method, headers, signal: ctrl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return { data: text ? JSON.parse(text) : null, contentRange: res.headers.get('content-range') };
  } finally {
    clearTimeout(timer);
  }
}

function enc(v) {
  return encodeURIComponent(String(v));
}

async function restCount(table, query) {
  const { contentRange } = await rest(`${table}?select=id&${query}&limit=1`, { prefer: 'count=exact' });
  const total = contentRange && contentRange.includes('/') ? contentRange.split('/')[1] : '0';
  return total === '*' ? 0 : Number(total) || 0;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

let cache = null; // { at, mode, map }

/**
 * 承認済みの塗装を登録記号（大文字）をキーにしたオブジェクトで返す。60 秒キャッシュ。
 * `/api/status` が 1 リクエストごとに DB を叩かないための層。
 * @returns {Promise<Object<string, Object>>}
 */
export async function getApprovedLiveries() {
  const mode = isMock() ? 'mock' : 'supabase';
  if (cache && cache.mode === mode && Date.now() - cache.at < LIVERY_CACHE_MS) return cache.map;

  const rows = await fetchApprovedRows();
  const map = Object.create(null);
  for (const { row, photos } of rows) {
    const view = toLiveryView(row, photos);
    const key = view.reg;
    // 同じ登録記号に複数の塗装があるときは運航中（until が無い）を優先する
    const prev = map[key];
    if (!prev || (prev.until && !view.until) || (!prev.photoUrl && view.photoUrl && !!prev.until === !!view.until)) {
      map[key] = view;
    }
  }
  cache = { at: Date.now(), mode, map };
  return map;
}

async function fetchApprovedRows() {
  if (isMock()) {
    return store().liveries
      .filter((r) => r.status === 'approved')
      .map((row) => ({ row, photos: mockPhotosOf(row.id) }));
  }
  const { data } = await rest(`liveries?select=${LIVERY_SELECT}&status=eq.approved&order=reg.asc`);
  return (data || []).map((row) => ({ row, photos: row.photos || [] }));
}

/** キャッシュを捨てる（承認直後やテストで使う） */
export function invalidateCache() {
  cache = null;
}

/**
 * 登録記号で承認済みの塗装を 1 件返す（無ければ null）。
 * @param {string} reg
 */
export async function getLiveryByReg(reg) {
  const key = String(reg || '').trim().toUpperCase();
  if (!key) return null;
  const map = await getApprovedLiveries();
  return map[key] || null;
}

/**
 * 一覧。
 * @param {{status?:string, airline?:string, q?:string, activeOnly?:boolean}} filter
 * @returns {Promise<Array<Object>>}
 */
export async function listLiveries(filter = {}) {
  const status = filter.status === undefined || filter.status === '' ? 'approved' : filter.status;
  const opts = { airline: filter.airline || '', q: filter.q || '', activeOnly: filter.activeOnly === true };

  let rows;
  if (isMock()) {
    rows = store().liveries
      .filter((r) => status === 'all' || r.status === status)
      .map((row) => ({ row, photos: mockPhotosOf(row.id) }));
  } else {
    const parts = [`select=${LIVERY_SELECT}`, 'order=reg.asc'];
    if (status !== 'all') parts.push(`status=eq.${enc(status)}`);
    if (opts.airline) parts.push(`airline=eq.${enc(opts.airline)}`);
    if (opts.activeOnly) parts.push('until_date=is.null');
    const { data } = await rest(`liveries?${parts.join('&')}`);
    rows = (data || []).map((row) => ({ row, photos: row.photos || [] }));
  }

  return rows
    .map(({ row, photos }) => ({ row, item: toListItem(row, photos) }))
    .filter(({ row, item }) => matchesFilter(row, item, opts))
    .map(({ item }) => item)
    .sort((a, b) => a.reg.localeCompare(b.reg) || a.name.localeCompare(b.name));
}

/**
 * 管理画面のバッジ用の承認待ち件数。
 * @returns {Promise<{liveries:number, photos:number, reports:number, total:number}>}
 */
export async function getPendingCounts() {
  let liveries, photos, reports;
  if (isMock()) {
    const s = store();
    liveries = s.liveries.filter((r) => r.status === 'pending').length;
    photos = s.photos.filter((r) => r.status === 'pending').length;
    reports = s.reports.filter((r) => !r.resolved).length;
  } else {
    [liveries, photos, reports] = await Promise.all([
      restCount('liveries', 'status=eq.pending'),
      restCount('photos', 'status=eq.pending'),
      restCount('reports', 'resolved=is.false'),
    ]);
  }
  return { liveries, photos, reports, total: liveries + photos };
}

/**
 * 管理者による承認 / 却下。写真の承認後は代表写真ルールを適用する。
 * @param {{type:'livery'|'photo', id:number|string, action:'approve'|'reject', reason?:string, adminId?:string}} p
 * @returns {Promise<{ok:true, type:string, id:number, status:string, primaryPhotoId:(number|null)}>}
 */
export async function adminUpdateStatus({ type, id, action, reason, adminId } = {}) {
  if (type !== 'livery' && type !== 'photo') throw dbError(400, `type が不正です: ${type}`);
  if (action !== 'approve' && action !== 'reject') throw dbError(400, `action が不正です: ${action}`);
  const numId = parsePositiveId(id);
  const trimmedReason = cleanReason(reason, { required: action === 'reject', label: '却下の理由' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  const patch = { status, reject_reason: action === 'reject' ? trimmedReason : null };
  if (type === 'livery') {
    patch.approved_by = action === 'approve' ? (adminId || null) : null;
    patch.approved_at = action === 'approve' ? new Date().toISOString() : null;
  }

  let primaryPhotoId = null;

  if (isMock()) {
    const s = store();
    const list = type === 'livery' ? s.liveries : s.photos;
    const row = list.find((r) => r.id === numId);
    if (!row) throw dbError(404, `${type} が見つかりません: ${numId}`);
    Object.assign(row, patch);
    if (type === 'photo') primaryPhotoId = mockDecidePrimary(row.livery_id);
  } else {
    const table = type === 'livery' ? 'liveries' : 'photos';
    const { data } = await rest(`${table}?id=eq.${enc(numId)}&select=id,livery_id`, {
      method: 'PATCH', body: patch, prefer: 'return=representation', admin: true,
    });
    const row = (data || [])[0];
    if (!row) throw dbError(404, `${type} が見つかりません: ${numId}`);
    if (type === 'photo') {
      const res = await rest('rpc/decide_primary', {
        method: 'POST', body: { p_livery_id: row.livery_id }, admin: true,
      });
      primaryPhotoId = res.data == null ? null : Number(res.data);
    }
  }

  invalidateCache();
  return { ok: true, type, id: numId, status, primaryPhotoId };
}

// ---------------------------------------------------------------------------
// 入力の検証（service role キーは RLS を素通りするので、ここで必ず絞る）
// ---------------------------------------------------------------------------

export const MAX_REASON_LEN = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{6}$/;
const REG_SAFE_RE = /^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$/;

/** 1 以上の整数 id だけを通す（'1; drop' や 1e30 を弾く） */
export function parsePositiveId(id, label = 'id') {
  const n = typeof id === 'number' ? id : Number(String(id == null ? '' : id).trim());
  if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) throw dbError(400, `${label} が不正です: ${id}`);
  return n;
}

/** 理由・キャプションなどの自由入力。空は null、500 字超はエラー */
export function cleanReason(text, { required = false, label = '理由' } = {}) {
  const s = String(text == null ? '' : text).trim();
  if (!s) {
    if (required) throw dbError(400, `${label}が必要です`);
    return null;
  }
  if (s.length > MAX_REASON_LEN) throw dbError(400, `${label}は ${MAX_REASON_LEN} 字以内にしてください`);
  return s;
}

/** profiles.id。本物では UUID のみ、モックでは短い id も許す */
export function parseUserId(id) {
  const s = String(id == null ? '' : id).trim();
  if (!s) throw dbError(400, 'userId が必要です');
  if (isMock()) {
    if (!/^[0-9A-Za-z_:.-]{1,64}$/.test(s)) throw dbError(400, `userId が不正です: ${s}`);
    return s;
  }
  if (!UUID_RE.test(s)) throw dbError(400, `userId が不正です: ${s}`);
  return s.toLowerCase();
}

/** 登録記号（検索に使うので記号を弾く） */
export function parseReg(reg) {
  const s = String(reg == null ? '' : reg).trim().toUpperCase();
  if (!REG_SAFE_RE.test(s)) throw dbError(400, `登録記号が不正です: ${reg}`);
  return s;
}

/** ICAO 24bit hex（小文字 6 桁） */
export function parseHex(hex) {
  const s = String(hex == null ? '' : hex).trim().toLowerCase();
  if (!HEX_RE.test(s)) throw dbError(400, `hex が不正です: ${hex}`);
  return s;
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

/**
 * profiles を 1 件引く（無ければ null）。lib/auth.js が role 判定に使う。
 * @param {string} id
 * @returns {Promise<{id:string, displayName:string, snsUrl:(string|null), role:string}|null>}
 */
export async function getProfileById(id) {
  const key = String(id == null ? '' : id).trim();
  if (!key) return null;
  if (isMock()) {
    const p = mockProfile(key);
    return p ? { id: p.id, displayName: p.display_name, snsUrl: p.sns_url || null, role: p.role || 'user' } : null;
  }
  if (!UUID_RE.test(key)) return null;
  const { data } = await rest(`profiles?id=eq.${enc(key)}&select=id,display_name,sns_url,role&limit=1`, { admin: true });
  const row = (data || [])[0];
  if (!row) return null;
  return { id: row.id, displayName: row.display_name || '', snsUrl: row.sns_url || null, role: row.role || 'user' };
}

/** id の配列 → { id: 表示名 }（モック・本物の両方） */
async function displayNames(ids) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  const out = Object.create(null);
  if (!list.length) return out;
  if (isMock()) {
    for (const id of list) {
      const p = mockProfile(id);
      if (p) out[id] = p.display_name;
    }
    return out;
  }
  const valid = list.filter((id) => UUID_RE.test(id));
  if (!valid.length) return out;
  const { data } = await rest(`profiles?id=in.(${valid.map(enc).join(',')})&select=id,display_name`, { admin: true });
  for (const row of data || []) out[row.id] = row.display_name || '';
  return out;
}

// ---------------------------------------------------------------------------
// 管理画面: 承認待ちの一覧
// ---------------------------------------------------------------------------

function pendingLiveryView(row, name) {
  return {
    id: row.id,
    reg: String(row.reg || '').toUpperCase(),
    hex: row.hex || null,
    name: row.name || '',
    nameEn: row.name_en || null,
    airline: row.airline || '',
    type: row.aircraft_type || '',
    note: row.note || '',
    color: row.color || null,
    since: row.since || null,
    until: row.until_date || null,
    sourceUrl: row.source_url || null,
    status: row.status,
    createdBy: row.created_by || null,
    createdByName: name || null,
    createdAt: row.created_at || null,
  };
}

function pendingPhotoView(row, livery, name) {
  return {
    id: row.id,
    liveryId: row.livery_id,
    liveryReg: livery ? String(livery.reg || '').toUpperCase() : null,
    liveryName: livery ? livery.name || '' : null,
    liveryStatus: livery ? livery.status : null,
    credit: row.credit_name || '',
    takenOn: row.taken_on || null,
    airport: row.airport_icao || null,
    caption: row.caption || '',
    status: row.status,
    isPrimary: row.is_primary === true,
    url: publicPhotoUrl(row.storage_path),
    thumbUrl: publicPhotoUrl(row.thumb_path),
    storagePath: row.storage_path,
    userId: row.user_id || null,
    userName: name || null,
    createdAt: row.created_at || null,
  };
}

function reportView(row, name, target) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason || '',
    reporterId: row.reporter_id || null,
    reporterName: name || null,
    resolved: row.resolved === true,
    createdAt: row.created_at || null,
    target: target || null,
  };
}

/**
 * 管理画面の本体データ。承認待ちの塗装・写真と未解決の通報。
 * @returns {Promise<{liveries:Array, photos:Array, reports:Array, counts:Object}>}
 */
export async function listPending() {
  if (isMock()) {
    const s = store();
    const names = await displayNames([
      ...s.liveries.map((r) => r.created_by),
      ...s.photos.map((r) => r.user_id),
      ...s.reports.map((r) => r.reporter_id),
    ]);
    const liveries = s.liveries.filter((r) => r.status === 'pending')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((r) => pendingLiveryView(r, names[r.created_by]));
    const photos = s.photos.filter((r) => r.status === 'pending')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((r) => pendingPhotoView(r, s.liveries.find((l) => l.id === r.livery_id), names[r.user_id]));
    const reports = s.reports.filter((r) => !r.resolved)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((r) => reportView(r, names[r.reporter_id], mockReportTarget(r)));
    return { liveries, photos, reports, counts: await getPendingCounts() };
  }

  const [lq, pq, rq] = await Promise.all([
    rest('liveries?status=eq.pending&select=id,reg,hex,name,name_en,airline,aircraft_type,note,color,since,until_date,source_url,status,created_by,created_at&order=created_at.asc&limit=200', { admin: true }),
    rest('photos?status=eq.pending&select=id,livery_id,user_id,storage_path,thumb_path,credit_name,taken_on,airport_icao,caption,status,is_primary,created_at,liveries(reg,name,status)&order=created_at.asc&limit=200', { admin: true }),
    rest('reports?resolved=is.false&select=id,target_type,target_id,reason,reporter_id,resolved,created_at&order=created_at.desc&limit=200', { admin: true }),
  ]);
  const lRows = lq.data || [];
  const pRows = pq.data || [];
  const rRows = rq.data || [];
  const names = await displayNames([
    ...lRows.map((r) => r.created_by), ...pRows.map((r) => r.user_id), ...rRows.map((r) => r.reporter_id),
  ]);
  const targets = await reportTargets(rRows);
  return {
    liveries: lRows.map((r) => pendingLiveryView(r, names[r.created_by])),
    photos: pRows.map((r) => pendingPhotoView(r, r.liveries || null, names[r.user_id])),
    reports: rRows.map((r) => reportView(r, names[r.reporter_id], targets[`${r.target_type}:${r.target_id}`])),
    counts: await getPendingCounts(),
  };
}

function mockReportTarget(row) {
  const s = store();
  if (row.target_type === 'livery') {
    const l = s.liveries.find((r) => r.id === Number(row.target_id));
    return l ? { label: `${l.name}（${String(l.reg).toUpperCase()}）`, status: l.status, thumbUrl: null } : null;
  }
  const p = s.photos.find((r) => r.id === Number(row.target_id));
  if (!p) return null;
  const l = s.liveries.find((r) => r.id === p.livery_id);
  return {
    label: `写真 #${p.id}（${l ? l.name : '塗装 #' + p.livery_id}・撮影 ${p.credit_name}）`,
    status: p.status,
    thumbUrl: publicPhotoUrl(p.thumb_path),
  };
}

/** 通報の対象の見出し（本物）。塗装・写真をまとめて 1 回ずつ引く */
async function reportTargets(rows) {
  const out = Object.create(null);
  const liveryIds = rows.filter((r) => r.target_type === 'livery').map((r) => Number(r.target_id));
  const photoIds = rows.filter((r) => r.target_type === 'photo').map((r) => Number(r.target_id));
  if (liveryIds.length) {
    const { data } = await rest(`liveries?id=in.(${[...new Set(liveryIds)].join(',')})&select=id,reg,name,status`, { admin: true });
    for (const l of data || []) out[`livery:${l.id}`] = { label: `${l.name}（${String(l.reg).toUpperCase()}）`, status: l.status, thumbUrl: null };
  }
  if (photoIds.length) {
    const { data } = await rest(`photos?id=in.(${[...new Set(photoIds)].join(',')})&select=id,livery_id,thumb_path,credit_name,status,liveries(name)`, { admin: true });
    for (const p of data || []) {
      out[`photo:${p.id}`] = {
        label: `写真 #${p.id}（${(p.liveries && p.liveries.name) || '塗装 #' + p.livery_id}・撮影 ${p.credit_name}）`,
        status: p.status,
        thumbUrl: publicPhotoUrl(p.thumb_path),
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 管理画面: 代表写真
// ---------------------------------------------------------------------------

/**
 * 管理者が代表写真を手で差し替える（承認済みの写真だけ）。
 * @param {number|string} photoId
 */
export async function setPrimaryPhoto(photoId) {
  const id = parsePositiveId(photoId, 'photoId');
  if (isMock()) {
    const row = mockSetPrimary(id);
    invalidateCache();
    return { ok: true, photoId: id, liveryId: row.livery_id };
  }
  const { data } = await rest('rpc/set_primary_photo', { method: 'POST', body: { p_photo_id: id }, admin: true });
  const { data: rows } = await rest(`photos?id=eq.${enc(id)}&select=livery_id`, { admin: true });
  invalidateCache();
  return { ok: true, photoId: data == null ? id : Number(data), liveryId: (rows || [])[0] ? (rows || [])[0].livery_id : null };
}

/**
 * 登録記号で承認済みの塗装とその承認済み写真を返す（代表写真の差し替え画面用）。
 * @param {string} reg
 */
export async function listApprovedPhotosByReg(reg) {
  const key = parseReg(reg);
  let rows;
  if (isMock()) {
    rows = store().liveries
      .filter((r) => r.status === 'approved' && String(r.reg).toUpperCase() === key)
      .map((row) => ({ row, photos: mockPhotosOf(row.id) }));
  } else {
    const { data } = await rest(`liveries?reg=eq.${enc(key)}&status=eq.approved&select=id,reg,name,airline,status,photos(id,storage_path,thumb_path,credit_name,is_primary,status,taken_on,created_at)&order=id.asc`);
    rows = (data || []).map((row) => ({ row, photos: row.photos || [] }));
  }
  return rows.map(({ row, photos }) => ({
    id: row.id,
    reg: String(row.reg).toUpperCase(),
    name: row.name,
    airline: row.airline || '',
    photos: photos.filter((p) => p.status === 'approved')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id)
      .map((p) => ({
        id: p.id,
        credit: p.credit_name || '',
        takenOn: p.taken_on || null,
        isPrimary: p.is_primary === true,
        url: publicPhotoUrl(p.storage_path),
        thumbUrl: publicPhotoUrl(p.thumb_path),
      })),
  }));
}

// ---------------------------------------------------------------------------
// 共有ページ `/livery/:reg`
// ---------------------------------------------------------------------------

/** id の配列 → { id: SNS URL }。撮影者名の隣に本人のリンクを出すために使う（公開情報） */
async function snsUrls(ids) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  const out = Object.create(null);
  if (!list.length) return out;
  if (isMock()) {
    for (const id of list) {
      const p = mockProfile(id);
      if (p && p.sns_url) out[id] = p.sns_url;
    }
    return out;
  }
  const valid = list.filter((id) => UUID_RE.test(id));
  if (!valid.length) return out;
  // profiles は RLS で誰でも読めるので anon キーで足りる（service キーは要らない）
  const { data } = await rest(`profiles?id=in.(${valid.map(enc).join(',')})&select=id,sns_url`);
  for (const row of data || []) if (row.sns_url) out[row.id] = row.sns_url;
  return out;
}

/** 運航中（until が無い）を先に、次に新しい順。同じ登録記号に複数の塗装があるときのタブ順 */
function byActiveThenNewest(a, b) {
  const aActive = a.row.until_date ? 1 : 0;
  const bActive = b.row.until_date ? 1 : 0;
  if (aActive !== bActive) return aActive - bActive;
  return String(b.row.since || '').localeCompare(String(a.row.since || '')) || a.row.id - b.row.id;
}

/**
 * 共有ページ `/livery/:reg` に必要なものを一度に返す。
 * 塗装は運航中を先頭にした承認済みの全件（タブ表示）、写真は承認済みを代表写真から順に並べる。
 *
 * @param {string} reg 登録記号
 * @returns {Promise<{reg:string, liveries:Array<Object>, photos:Array<Object>}>}
 */
export async function getLiveryPageData(reg) {
  const key = parseReg(reg);
  let rows;
  if (isMock()) {
    rows = store().liveries
      .filter((r) => r.status === 'approved' && String(r.reg).toUpperCase() === key)
      .map((row) => ({ row, photos: mockPhotosOf(row.id) }));
  } else {
    const { data } = await rest(`liveries?reg=eq.${enc(key)}&status=eq.approved&select=${PAGE_LIVERY_SELECT}`);
    rows = (data || []).map((row) => ({ row, photos: row.photos || [] }));
  }
  rows.sort(byActiveThenNewest);

  const approved = [];
  rows.forEach(({ row, photos }, order) => {
    for (const p of photos) {
      if (p.status === 'approved') approved.push({ p, liveryId: row.id, order });
    }
  });
  const sns = await snsUrls(approved.map(({ p }) => p.user_id));

  // 塗装の並び順 → 代表写真 → 撮影が古い順
  approved.sort((a, b) => a.order - b.order
    || (a.p.is_primary === true ? 0 : 1) - (b.p.is_primary === true ? 0 : 1)
    || String(a.p.created_at).localeCompare(String(b.p.created_at))
    || a.p.id - b.p.id);

  return {
    reg: key,
    liveries: rows.map(({ row, photos }) => ({
      ...toLiveryView(row, photos),
      photoCount: photos.filter((p) => p.status === 'approved').length,
    })),
    photos: approved.map(({ p, liveryId }) => ({
      id: p.id,
      liveryId,
      url: publicPhotoUrl(p.storage_path),
      thumbUrl: publicPhotoUrl(p.thumb_path),
      credit: p.credit_name || '',
      snsUrl: sns[p.user_id] || null,
      takenOn: p.taken_on || null,
      airport: p.airport_icao || null,
      caption: p.caption || '',
      isPrimary: p.is_primary === true,
    })),
  };
}

// ---------------------------------------------------------------------------
// 通報
// ---------------------------------------------------------------------------

export const REPORTS_TO_HIDE = 3;

/**
 * 通報を 1 件入れる。写真に未解決の通報が 3 件以上ついたら
 * 写真を承認待ちに戻して非表示にする（設計書 §5-4）。
 * @param {{targetType:'livery'|'photo', targetId:number|string, reason:string, reporterId:string}} p
 * @returns {Promise<{ok:true, id:number, count:number, hidden:boolean}>}
 */
export async function addReport({ targetType, targetId, reason, reporterId } = {}) {
  if (targetType !== 'livery' && targetType !== 'photo') throw dbError(400, `targetType が不正です: ${targetType}`);
  const id = parsePositiveId(targetId, 'targetId');
  const text = cleanReason(reason, { required: true, label: '通報の理由' });
  const uid = reporterId ? parseUserId(reporterId) : null;

  let inserted;
  let hidden = false;
  let count = 0;

  if (isMock()) {
    const s = store();
    const target = targetType === 'livery'
      ? s.liveries.find((r) => r.id === id)
      : s.photos.find((r) => r.id === id);
    if (!target) throw dbError(404, `${targetType} が見つかりません: ${id}`);
    inserted = mock.addReport({ target_type: targetType, target_id: id, reason: text, reporter_id: uid });
    count = s.reports.filter((r) => !r.resolved && r.target_type === targetType && r.target_id === id).length;
    if (targetType === 'photo' && count >= REPORTS_TO_HIDE && target.status === 'approved') {
      target.status = 'pending';
      mockDecidePrimary(target.livery_id);
      hidden = true;
    }
  } else {
    const table = targetType === 'livery' ? 'liveries' : 'photos';
    const { data: found } = await rest(`${table}?id=eq.${enc(id)}&select=id,status${targetType === 'photo' ? ',livery_id' : ''}&limit=1`, { admin: true });
    const target = (found || [])[0];
    if (!target) throw dbError(404, `${targetType} が見つかりません: ${id}`);
    const { data } = await rest('reports', {
      method: 'POST', admin: true, prefer: 'return=representation',
      body: { target_type: targetType, target_id: id, reason: text, reporter_id: uid },
    });
    inserted = (data || [])[0] || { id: 0 };
    count = await restCount('reports', `resolved=is.false&target_type=eq.${enc(targetType)}&target_id=eq.${enc(id)}`);
    if (targetType === 'photo' && count >= REPORTS_TO_HIDE && target.status === 'approved') {
      await rest(`photos?id=eq.${enc(id)}`, { method: 'PATCH', body: { status: 'pending' }, admin: true });
      await rest('rpc/decide_primary', { method: 'POST', body: { p_livery_id: target.livery_id }, admin: true });
      hidden = true;
    }
  }

  if (hidden) invalidateCache();
  return { ok: true, id: inserted.id, count, hidden };
}

/**
 * 通報の一覧（既定は未解決のみ）。
 * @param {{includeResolved?:boolean, limit?:number}} opt
 */
export async function listReports(opt = {}) {
  const limit = Math.min(Math.max(Number(opt.limit) || 100, 1), 200);
  let rows;
  if (isMock()) {
    rows = store().reports
      .filter((r) => opt.includeResolved === true || !r.resolved)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
    const names = await displayNames(rows.map((r) => r.reporter_id));
    return rows.map((r) => reportView(r, names[r.reporter_id], mockReportTarget(r)));
  }
  const filter = opt.includeResolved === true ? '' : 'resolved=is.false&';
  const { data } = await rest(`reports?${filter}select=id,target_type,target_id,reason,reporter_id,resolved,created_at&order=created_at.desc&limit=${limit}`, { admin: true });
  rows = data || [];
  const names = await displayNames(rows.map((r) => r.reporter_id));
  const targets = await reportTargets(rows);
  return rows.map((r) => reportView(r, names[r.reporter_id], targets[`${r.target_type}:${r.target_id}`]));
}

/** 通報を解決済みにする（取り下げではなく「見た」印） */
export async function resolveReport(reportId, resolved = true) {
  const id = parsePositiveId(reportId, 'reportId');
  const flag = resolved !== false;
  if (isMock()) {
    const row = store().reports.find((r) => r.id === id);
    if (!row) throw dbError(404, `通報が見つかりません: ${id}`);
    row.resolved = flag;
    return { ok: true, id, resolved: flag };
  }
  const { data } = await rest(`reports?id=eq.${enc(id)}&select=id,resolved`, {
    method: 'PATCH', body: { resolved: flag }, prefer: 'return=representation', admin: true,
  });
  if (!(data || [])[0]) throw dbError(404, `通報が見つかりません: ${id}`);
  return { ok: true, id, resolved: flag };
}

// ---------------------------------------------------------------------------
// 管理ツール（hex 補完・孤児掃除・クレジット再反映）
// ---------------------------------------------------------------------------

/** hex が空の塗装（却下済みは除く）を古い順に limit 件 */
export async function listMissingHex(limit = 30) {
  const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
  let rows;
  if (isMock()) {
    rows = store().liveries.filter((r) => r.status !== 'rejected');
  } else {
    const { data } = await rest('liveries?status=neq.rejected&select=id,reg,hex&order=id.asc&limit=500', { admin: true });
    rows = data || [];
  }
  return rows
    .filter((r) => !String(r.hex || '').trim())
    .slice(0, n)
    .map((r) => ({ id: r.id, reg: String(r.reg || '').toUpperCase() }));
}

/** 塗装の hex を入れる（小文字 6 桁のみ） */
export async function setLiveryHex(liveryId, hex) {
  const id = parsePositiveId(liveryId, 'liveryId');
  const value = parseHex(hex);
  if (isMock()) {
    const row = store().liveries.find((r) => r.id === id);
    if (!row) throw dbError(404, `livery が見つかりません: ${id}`);
    row.hex = value;
  } else {
    const { data } = await rest(`liveries?id=eq.${enc(id)}&select=id`, {
      method: 'PATCH', body: { hex: value }, prefer: 'return=representation', admin: true,
    });
    if (!(data || [])[0]) throw dbError(404, `livery が見つかりません: ${id}`);
  }
  invalidateCache();
  return { ok: true, id, hex: value };
}

/** photos が参照している Storage のパス全部（孤児掃除の突き合わせ用） */
export async function listAllPhotoPaths() {
  if (isMock()) {
    return store().photos.flatMap((p) => [p.storage_path, p.thumb_path]).filter(Boolean);
  }
  const { data } = await rest('photos?select=storage_path,thumb_path&limit=10000', { admin: true });
  return (data || []).flatMap((p) => [p.storage_path, p.thumb_path]).filter(Boolean);
}

/**
 * そのユーザーの写真のクレジットを今の表示名に付け替える（改名の反映依頼に応える）。
 * @param {string} userId
 */
export async function backfillCreditNames(userId) {
  const uid = parseUserId(userId);
  const profile = await getProfileById(uid);
  if (!profile) throw dbError(404, `ユーザーが見つかりません: ${uid}`);
  const creditName = String(profile.displayName || '').trim();
  if (!creditName) throw dbError(400, '表示名が空のため反映できません');

  let updated = 0;
  if (isMock()) {
    for (const p of store().photos) {
      if (p.user_id === uid && p.credit_name !== creditName) { p.credit_name = creditName; updated += 1; }
    }
  } else {
    const { data } = await rest(`photos?user_id=eq.${enc(uid)}&select=id`, {
      method: 'PATCH', body: { credit_name: creditName }, prefer: 'return=representation', admin: true,
    });
    updated = (data || []).length;
  }
  invalidateCache();
  return { ok: true, userId: uid, creditName, updated };
}
