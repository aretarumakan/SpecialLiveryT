/**
 * 管理者向けのバッチ処理（外部 API と Storage を触るもの）。
 * 行の読み書きは lib/db.js に任せ、ここは「外と話す」部分だけを持つ。
 *
 *  - fillMissingHex : hex が空の塗装機を adsbdb `/v0/aircraft/{reg}` の mode_s で補完
 *  - sweepOrphans   : Storage の livery-photos にあって photos から参照されていない
 *                     ファイルを消す（モックでは何もしない）
 *
 * fetch は引数で差し替えられる（テストで実際に外へ出さないため）。
 */
import { isMock, listMissingHex, setLiveryHex, listAllPhotoPaths, parseHex } from './db.js';

export const ADSBDB_AIRCRAFT = 'https://api.adsbdb.com/v0/aircraft/';
export const HEX_FILL_LIMIT = 30;          // 1 回で処理する上限（設計書 §3）
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000; // これより新しいファイルは触らない（投稿中の取りこぼし防止）
const BUCKET = 'livery-photos';
const FETCH_TIMEOUT_MS = 8000;

function env(key) {
  return (typeof process !== 'undefined' && process.env && process.env[key]) || '';
}

/**
 * adsbdb の応答から hex（小文字 6 桁）を取り出す。該当が無ければ null。
 * @param {any} body `{ response: { aircraft: { mode_s, ... } } }`
 */
export function parseModeS(body) {
  const a = body && body.response && body.response.aircraft;
  if (!a) return null;
  const raw = String(a.mode_s == null ? '' : a.mode_s).trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(raw) ? raw : null;
}

async function fetchJson(url, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    return { ok: true, status: res.status, body: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * hex が空の塗装機を adsbdb で補完する。
 * @param {{limit?:number, fetchImpl?:Function}} opt
 * @returns {Promise<{checked:number, filled:number, items:Array, errors:Array}>}
 */
export async function fillMissingHex(opt = {}) {
  const limit = Math.min(Math.max(Number(opt.limit) || HEX_FILL_LIMIT, 1), HEX_FILL_LIMIT);
  const fetchImpl = opt.fetchImpl || fetch;
  const targets = await listMissingHex(limit);

  const items = [];
  const errors = [];
  for (const t of targets) {
    try {
      const { ok, status, body } = await fetchJson(ADSBDB_AIRCRAFT + encodeURIComponent(t.reg), fetchImpl);
      if (!ok) {
        // 404 = adsbdb に無い機体（エラーではなく「該当なし」として扱う）
        if (status === 404) items.push({ id: t.id, reg: t.reg, hex: null, note: 'adsbdb に該当なし' });
        else errors.push({ reg: t.reg, error: `HTTP ${status}` });
        continue;
      }
      const hex = parseModeS(body);
      if (!hex) {
        items.push({ id: t.id, reg: t.reg, hex: null, note: 'mode_s が空' });
        continue;
      }
      await setLiveryHex(t.id, parseHex(hex));
      items.push({ id: t.id, reg: t.reg, hex });
    } catch (e) {
      errors.push({ reg: t.reg, error: e && e.message ? e.message : String(e) });
    }
  }

  return { checked: targets.length, filled: items.filter((i) => i.hex).length, items, errors };
}

// ---------------------------------------------------------------------------
// Storage の孤児掃除
// ---------------------------------------------------------------------------

async function storageFetch(path, { method = 'POST', body, fetchImpl } = {}) {
  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!base) throw new Error('SUPABASE_URL が設定されていません');
  if (!service) throw new Error('孤児掃除には SUPABASE_SERVICE_ROLE_KEY が必要です');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await (fetchImpl || fetch)(`${base}/storage/v1/${path}`, {
      method,
      headers: {
        apikey: service, Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Storage ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

/** 1 階層ぶんの一覧（フォルダは id === null で返ってくる） */
async function listFolder(prefix, fetchImpl) {
  const out = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = await storageFetch(`object/list/${BUCKET}`, {
      fetchImpl,
      body: { prefix, limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } },
    });
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    if (offset > 10000) break; // 安全弁
  }
  return out;
}

/**
 * photos から参照されていない Storage のファイルを消す。
 * `{uid}/{uuid}.jpg` の 2 階層だけを見る（それが upload.js の規約）。
 * @param {{fetchImpl?:Function, dryRun?:boolean, minAgeMs?:number}} opt
 * @returns {Promise<{skipped?:true, scanned:number, referenced:number, orphans:Array<string>, deleted:number, dryRun:boolean}>}
 */
export async function sweepOrphans(opt = {}) {
  if (isMock()) return { skipped: true, scanned: 0, referenced: 0, orphans: [], deleted: 0, dryRun: true };

  const fetchImpl = opt.fetchImpl || fetch;
  const dryRun = opt.dryRun === true;
  const minAgeMs = opt.minAgeMs === undefined ? SWEEP_MIN_AGE_MS : Math.max(Number(opt.minAgeMs) || 0, 0);
  const referenced = new Set((await listAllPhotoPaths()).map((p) => String(p).replace(/^\/+/, '')));

  const files = [];
  for (const top of await listFolder('', fetchImpl)) {
    if (top.id) {                       // バケット直下のファイル（規約外だが拾う）
      files.push({ name: top.name, createdAt: top.created_at || top.updated_at || null });
      continue;
    }
    for (const f of await listFolder(top.name, fetchImpl)) {
      if (!f.id) continue;              // 3 階層目は作らない規約なので無視
      files.push({ name: `${top.name}/${f.name}`, createdAt: f.created_at || f.updated_at || null });
    }
  }

  const now = Date.now();
  const orphans = files
    .filter((f) => !referenced.has(f.name))
    .filter((f) => {
      if (!minAgeMs) return true;
      const t = f.createdAt ? Date.parse(f.createdAt) : NaN;
      return Number.isNaN(t) ? true : now - t >= minAgeMs; // 作成直後のファイルは残す
    })
    .map((f) => f.name);

  let deleted = 0;
  if (!dryRun && orphans.length) {
    for (let i = 0; i < orphans.length; i += 100) {
      const chunk = orphans.slice(i, i + 100);
      await storageFetch(`object/${BUCKET}`, { method: 'DELETE', fetchImpl, body: { prefixes: chunk } });
      deleted += chunk.length;
    }
  }

  return { scanned: files.length, referenced: referenced.size, orphans, deleted, dryRun };
}
