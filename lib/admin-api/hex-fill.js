/**
 * POST /api/admin/hex-fill（admin 限定）
 *
 * hex が空の塗装を adsbdb `/v0/aircraft/{reg}` の `mode_s`（小文字 6 桁）で補完する。
 * 1 回あたり 30 件まで（設計書 §3 / docs/design-special-livery-mode.md）。
 * body は任意: { limit?:number }
 */
import { requireAdmin, readBody, rejectNonPost, sendError } from '../auth.js';
import { fillMissingHex, HEX_FILL_LIMIT } from '../admin.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');

  try {
    const body = readBody(req);
    const limit = body.limit === undefined ? HEX_FILL_LIMIT : Number(body.limit);
    if (!Number.isFinite(limit) || limit <= 0) return res.status(400).json({ error: 'limit が不正です' });
    const result = await fillMissingHex({ limit });
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, 'hex の補完に失敗しました');
  }
}
