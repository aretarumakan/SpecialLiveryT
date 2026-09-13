/**
 * 呼び出し元の本人確認（管理系 API 専用）。
 *
 * 本物（Supabase）:
 *   `Authorization: Bearer <user JWT>` を受け取り、`${SUPABASE_URL}/auth/v1/user`
 *   に anon キーを添えて問い合わせてユーザー id を得る（JWT の検証は Supabase に任せる）。
 *   続けて service role キーで `profiles` を読み、role を判定する。
 *
 * モック（`MOCK_DB=1` / `SUPABASE_URL` 無し）:
 *   `Bearer mock:<userId>` を受け取る。`public/js/mockdb.js` の accessToken は
 *   `mock-<userId>` という形なので、区切りは `:` と `-` の両方を許す。
 *   role は lib/db.js のモックストア（`admin` → admin）から引く。
 *
 * 公開関数: bearerToken, getCallerProfile, requireAdmin, requireUser, readBody
 */
import { isMock, getProfileById } from './db.js';

const FETCH_TIMEOUT_MS = 8000;

function env(key) {
  return (typeof process !== 'undefined' && process.env && process.env[key]) || '';
}

/** `Authorization: Bearer xxx` の xxx を取り出す（無ければ null） */
export function bearerToken(req) {
  const h = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer[ \t]+(.+)$/i.exec(String(h).trim());
  if (!m) return null;
  const token = m[1].trim();
  return token || null;
}

/** Supabase Auth にトークンを検証させ、ユーザー id を返す（失敗は null） */
async function verifyToken(token) {
  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  const anon = env('SUPABASE_ANON_KEY');
  if (!base || !anon) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY が設定されていません');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;                       // 401 = 期限切れ・偽造
    const body = await res.json().catch(() => null);
    const id = body && (body.id || (body.user && body.user.id));
    return id ? String(id) : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 呼び出し元のプロフィール。トークンが無い・無効なら null。
 * @param {Object} req
 * @returns {Promise<{id:string, displayName:string, role:string}|null>}
 */
export async function getCallerProfile(req) {
  const token = bearerToken(req);
  if (!token) return null;

  if (isMock()) {
    const m = /^mock[:-](.+)$/.exec(token);
    if (!m) return null;
    const p = await getProfileById(m[1].trim());
    return p ? { id: p.id, displayName: p.displayName, role: p.role } : null;
  }

  const id = await verifyToken(token);
  if (!id) return null;
  const p = await getProfileById(id);
  // profiles が無いユーザー（トリガー導入前）は一般ユーザー扱いにする
  return p ? { id: p.id, displayName: p.displayName, role: p.role } : { id, displayName: '', role: 'user' };
}

function deny(res, code, message) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json({ error: message });
  return null;
}

/**
 * ログイン必須。未ログインなら 401 を返して null。
 * @returns {Promise<{id:string, displayName:string, role:string}|null>}
 */
export async function requireUser(req, res) {
  let caller = null;
  try {
    caller = await getCallerProfile(req);
  } catch (e) {
    return deny(res, 502, `本人確認に失敗しました: ${e.message}`);
  }
  if (!caller) return deny(res, 401, 'ログインが必要です');
  return caller;
}

/**
 * 管理者必須。未ログインは 401、一般ユーザーは 403 を返して null。
 * @returns {Promise<{id:string, displayName:string, role:string}|null>}
 */
export async function requireAdmin(req, res) {
  const caller = await requireUser(req, res);
  if (!caller) return null;
  if (caller.role !== 'admin') return deny(res, 403, '権限がありません');
  return caller;
}

/** POST の本文（dev-server と Vercel はパース済み、文字列で来た場合も拾う） */
export function readBody(req) {
  const b = req && req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { throw new Error('JSON として読めない本文です'); }
  }
  if (typeof b !== 'object' || Array.isArray(b)) throw new Error('本文はオブジェクトで送ってください');
  return b;
}

/** POST 以外を弾く。弾いたら true を返す */
export function rejectNonPost(req, res) {
  if ((req.method || 'GET').toUpperCase() === 'POST') return false;
  res.setHeader('Allow', 'POST');
  deny(res, 405, 'POST で呼んでください');
  return true;
}

/**
 * 例外を素直な HTTP にする。入力の不備は 400、見つからないは 404、それ以外は 502。
 * （lib/db.js が投げるメッセージは日本語なのでそのまま返す）
 */
export function sendError(res, e, fallback = '処理に失敗しました') {
  const msg = e && e.message ? e.message : String(e);
  res.setHeader('Cache-Control', 'no-store');
  // lib/db.js の dbError（e.status）を優先し、無い場合だけ本文から推測する
  const status = e && Number.isInteger(e.status) ? e.status : null;
  if (status === 404 || (!status && /見つかりません/.test(msg))) return res.status(404).json({ error: msg });
  if (status === 400 || (!status && /が不正|が必要/.test(msg))) return res.status(400).json({ error: msg });
  // 409（重複）・429（上限）など、呼び出し側にそのまま伝えたい 4xx は文言も加工しない
  if (status && status >= 400 && status < 500) return res.status(status).json({ error: msg });
  return res.status(status && status >= 500 ? status : 502).json({ error: `${fallback}: ${msg}` });
}

/** GET 以外を弾く。弾いたら true を返す */
export function rejectNonGet(req, res) {
  const m = (req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return false;
  res.setHeader('Allow', 'GET');
  deny(res, 405, 'GET で呼んでください');
  return true;
}
