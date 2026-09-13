/**
 * 入力検証（ブラウザと Node のテストで共用する純関数）
 *
 * ブラウザ:  import { normalizeReg } from '/js/validate.js';   // <script type="module">
 * Node:      import { normalizeReg } from '../public/js/validate.js';
 *
 * DOM にも fetch にも依存しない。ここに入れた規則は test/validate.test.js が検証する。
 * 登録記号の正規表現は supabase/migrations/0001_init.sql の liveries_reg_format と同じ。
 */

/** 登録記号の形（大文字・数字 1〜2 + 任意のハイフン + 2〜5） */
export const REG_RE = /^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$/;

/** 一言説明・キャプションの上限（DB の liveries_note_len と同じ） */
export const MAX_NOTE = 140;

/** アクセント色 #rrggbb */
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * 入力された登録記号を DB に入れる形に正す。
 * 大文字化し、全角英数と全角ハイフンを半角に直し、空白を捨てる。
 * @param {string} input
 * @returns {string}
 */
export function normalizeReg(input) {
  return String(input == null ? '' : input)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―ー−]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * 登録記号として使えるか（正規化してから判定する）。
 * @param {string} input
 * @returns {boolean}
 */
export function isValidReg(input) {
  return REG_RE.test(normalizeReg(input));
}

/**
 * http(s) の URL か。
 * @param {string} input
 * @returns {boolean}
 */
export function isValidHttpUrl(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return false;
  let u;
  try { u = new URL(s); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && u.hostname.includes('.');
}

/** #rrggbb か */
export function isValidHexColor(input) {
  return COLOR_RE.test(String(input == null ? '' : input).trim());
}

/** YYYY-MM-DD として妥当か（空は true 扱いしないので呼ぶ側で分岐する） */
export function isValidDate(input) {
  const s = String(input == null ? '' : input).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

function trimOrNull(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
}

/**
 * 新しい塗装機の入力を検証して、liveries に insert する行を作る。
 * @param {Object} input フォームの生の値
 * @returns {{ok:boolean, errors:Object<string,string>, row:Object|null}}
 */
export function validateLiveryForm(input = {}) {
  const errors = {};
  const reg = normalizeReg(input.reg);
  if (!reg) errors.reg = '登録記号を入れてください';
  else if (!REG_RE.test(reg)) errors.reg = '登録記号の形が違います（例: JA819A / N12345）';

  const name = String(input.name == null ? '' : input.name).trim();
  if (!name) errors.name = '塗装機名を入れてください';
  else if (name.length > 80) errors.name = '塗装機名は 80 字以内にしてください';

  const sourceUrl = String(input.source_url == null ? '' : input.source_url).trim();
  if (!sourceUrl) errors.source_url = '出典 URL を入れてください（公式発表を推奨）';
  else if (!isValidHttpUrl(sourceUrl)) errors.source_url = 'http:// または https:// から始まる URL を入れてください';

  const note = trimOrNull(input.note);
  if (note && note.length > MAX_NOTE) errors.note = `一言説明は ${MAX_NOTE} 字以内にしてください`;

  const color = trimOrNull(input.color);
  if (color && !isValidHexColor(color)) errors.color = '色は #rrggbb の形で指定してください';

  const since = trimOrNull(input.since);
  if (since && !isValidDate(since)) errors.since = '運航開始日の形が違います';
  const until = trimOrNull(input.until_date);
  if (until && !isValidDate(until)) errors.until_date = '運航終了日の形が違います';
  if (since && until && !errors.since && !errors.until_date && until < since) {
    errors.until_date = '運航終了日は運航開始日より後にしてください';
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    row: ok ? {
      reg,
      name,
      name_en: trimOrNull(input.name_en),
      airline: trimOrNull(input.airline),
      aircraft_type: trimOrNull(input.aircraft_type),
      since,
      until_date: until,
      source_url: sourceUrl,
      note,
      color: color ? color.toLowerCase() : null,
      status: 'pending',
    } : null,
  };
}

/**
 * 写真の入力を検証して、photos に insert する行の一部を作る。
 * storage_path / thumb_path / user_id / credit_name / livery_id はアップロード後に足す。
 * @param {Object} input
 * @param {{requirePhoto?:boolean, hasFile?:boolean}} opts
 */
export function validatePhotoForm(input = {}, opts = {}) {
  const errors = {};
  if (opts.requirePhoto && !opts.hasFile) errors.file = '写真を選んでください';

  const caption = trimOrNull(input.caption);
  if (caption && caption.length > MAX_NOTE) errors.caption = `キャプションは ${MAX_NOTE} 字以内にしてください`;

  const takenOn = trimOrNull(input.taken_on);
  if (takenOn && !isValidDate(takenOn)) errors.taken_on = '撮影日の形が違います';
  if (takenOn && !errors.taken_on && takenOn > new Date().toISOString().slice(0, 10)) {
    errors.taken_on = '撮影日が未来になっています';
  }

  const icao = String(input.airport_icao == null ? '' : input.airport_icao).trim().toUpperCase();
  if (icao && !/^[A-Z]{4}$/.test(icao)) errors.airport_icao = '空港の選択が不正です';

  if (opts.hasFile && input.agree !== true) {
    errors.agree = '自分で撮影した写真であることの確認にチェックしてください';
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    row: ok ? {
      taken_on: takenOn,
      airport_icao: icao || null,
      caption,
      status: 'pending',
      is_primary: false,
    } : null,
  };
}

/**
 * 表示名が自動生成されたもの（= 初回に本人へ確認したい）か。
 * 0001_init.sql の handle_new_user() が作る形に合わせる:
 *   メールのローカル部 / 'ユーザー' + uuid 断片
 * @param {string} displayName
 * @param {string} [email]
 */
export function isAutoGeneratedName(displayName, email) {
  const name = String(displayName == null ? '' : displayName).trim();
  if (!name) return true;
  if (/^ユーザー[0-9a-f]{4,}$/.test(name)) return true;
  const local = String(email == null ? '' : email).split('@')[0];
  if (local && name === local) return true;
  return false;
}

/** storage のパス規約（{uid}/{uuid}.jpg と {uid}/{uuid}_thumb.jpg） */
export function storagePaths(uid, uuid) {
  const dir = String(uid == null ? '' : uid).replace(/[^0-9a-zA-Z_-]/g, '');
  const id = String(uuid == null ? '' : uuid).replace(/[^0-9a-zA-Z-]/g, '');
  if (!dir || !id) throw new Error('storagePaths: uid と uuid が必要です');
  return { path: `${dir}/${id}.jpg`, thumbPath: `${dir}/${id}_thumb.jpg` };
}

/**
 * 写真の保存先の形（1 か所に定義する）。
 * ここの規則は 0004_hardening.sql の photos_storage_path_chk / photos_thumb_path_chk と
 * 同じもので、サーバー側は lib/db.js の assertPhotoPaths() がこれを使って再検証する。
 */
export const PHOTO_UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function escapeRe(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** そのユーザーの storage_path として使える形か（`{uid}/{uuid}.jpg` のみ） */
export function isValidStoragePath(uid, path) {
  const dir = String(uid == null ? '' : uid).trim();
  const p = String(path == null ? '' : path);
  if (!dir || !p) return false;
  return new RegExp(`^${escapeRe(dir)}/${PHOTO_UUID_SRC}\\.jpg$`).test(p);
}

/** storage_path に対応するサムネイルのパス（`.jpg` → `_thumb.jpg`） */
export function thumbPathFor(path) {
  const p = String(path == null ? '' : path);
  return /\.jpg$/.test(p) ? p.replace(/\.jpg$/, '_thumb.jpg') : '';
}

/** 表示名（クレジット）として許せるか */
export function validateDisplayName(input) {
  const name = String(input == null ? '' : input).trim();
  if (!name) return { ok: false, error: '表示名を入れてください', value: '' };
  if (name.length > 40) return { ok: false, error: '表示名は 40 字以内にしてください', value: name };
  if (/[<>]/.test(name)) return { ok: false, error: '表示名に < > は使えません', value: name };
  return { ok: true, error: null, value: name };
}

/** SNS URL（任意。空なら null） */
export function validateSnsUrl(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return { ok: true, error: null, value: null };
  if (!isValidHttpUrl(s)) return { ok: false, error: 'SNS の URL は http(s) で入れてください', value: s };
  return { ok: true, error: null, value: s };
}
