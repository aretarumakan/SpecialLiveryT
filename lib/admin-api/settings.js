/**
 * /api/admin/settings（admin 限定）— アプリ設定（app_settings）
 *
 *  GET             → `{ settings: { auto_approve_photos: true }, defaults: {...} }`
 *  POST { key, value } または { settings: { key: value, ... } } → 保存して今の値を返す
 *
 * 書けるキーは lib/db.js の DEFAULT_SETTINGS にあるものだけ（service role キーは
 * RLS を素通りするので、キーと型の検証は lib/db.js が行う）。
 */
import { requireAdmin, readBody, sendError } from '../auth.js';
import { getSettings, setSetting, DEFAULT_SETTINGS } from '../db.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');

  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    try {
      return res.status(200).json({ settings: await getSettings(), defaults: { ...DEFAULT_SETTINGS } });
    } catch (e) {
      return sendError(res, e, '設定の取得に失敗しました');
    }
  }

  if (method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET か POST で呼んでください' });
  }

  try {
    const body = readBody(req);
    const patch = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
      ? body.settings
      : (body.key ? { [String(body.key)]: body.value } : {});
    const keys = Object.keys(patch);
    if (!keys.length) throw Object.assign(new Error('key が必要です'), { status: 400 });
    for (const key of keys) await setSetting(key, patch[key]);
    return res.status(200).json({ ok: true, settings: await getSettings() });
  } catch (e) {
    return sendError(res, e, '設定の保存に失敗しました');
  }
}
