/**
 * POST /api/admin/approve（admin 限定）
 * body: { type:'livery'|'photo', id, action:'approve'|'reject', reason? }
 *
 * 設計書 §3 / §5。写真を承認したときは代表写真ルール（decide_primary）を適用するので、
 * その塗装機にまだ代表写真が無ければ最初に承認された写真が代表になる。
 * 却下は理由必須（投稿者は /me.html で理由を読んで再投稿できる）。
 */
import { requireAdmin, readBody, rejectNonPost, sendError } from '../auth.js';
import { adminUpdateStatus } from '../db.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  res.setHeader('Cache-Control', 'no-store');
  let body;
  try {
    body = readBody(req);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const result = await adminUpdateStatus({
      type: body.type, id: body.id, action: body.action, reason: body.reason, adminId: admin.id,
    });
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, '更新に失敗しました');
  }
}
