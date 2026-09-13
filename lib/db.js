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
 *           getPendingCounts, adminUpdateStatus
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
  if (/^https?:\/\//.test(path)) return path;
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

function store() {
  if (!mockStore) {
    mockStore = { liveries: seedRows(), photos: [], reports: [], nextLivery: 0, nextPhoto: 0 };
    mockStore.nextLivery = mockStore.liveries.length;
  }
  return mockStore;
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

// ---------------------------------------------------------------------------
// Supabase（PostgREST）バックエンド
// ---------------------------------------------------------------------------

const LIVERY_SELECT = [
  'id', 'reg', 'hex', 'name', 'name_en', 'airline', 'aircraft_type', 'note', 'color',
  'since', 'until_date', 'source_url', 'status', 'reject_reason', 'created_at',
  'photos(id,storage_path,thumb_path,credit_name,is_primary,status,created_at)',
].join(',');

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
  if (type !== 'livery' && type !== 'photo') throw new Error(`type が不正です: ${type}`);
  if (action !== 'approve' && action !== 'reject') throw new Error(`action が不正です: ${action}`);
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) throw new Error(`id が不正です: ${id}`);
  const trimmedReason = String(reason || '').trim();
  if (action === 'reject' && !trimmedReason) throw new Error('却下には理由が必要です');

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
    if (!row) throw new Error(`${type} が見つかりません: ${numId}`);
    Object.assign(row, patch);
    if (type === 'photo') primaryPhotoId = mockDecidePrimary(row.livery_id);
  } else {
    const table = type === 'livery' ? 'liveries' : 'photos';
    const { data } = await rest(`${table}?id=eq.${enc(numId)}&select=id,livery_id`, {
      method: 'PATCH', body: patch, prefer: 'return=representation', admin: true,
    });
    const row = (data || [])[0];
    if (!row) throw new Error(`${type} が見つかりません: ${numId}`);
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
