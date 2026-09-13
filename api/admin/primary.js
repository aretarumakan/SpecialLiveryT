/**
 * /api/admin/primary（admin 限定）— 代表写真の差し替え
 *
 *  GET  ?reg=JA819A → その登録記号の承認済み塗装と、承認済み写真の一覧
 *  POST { photoId } → set_primary_photo（承認済みの写真だけを代表にできる）
 */
import { requireAdmin, readBody, sendError } from '../../lib/auth.js';
import { listApprovedPhotosByReg, setPrimaryPhoto } from '../../lib/db.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');

  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    try {
      const items = await listApprovedPhotosByReg((req.query || {}).reg);
      return res.status(200).json({ count: items.length, items });
    } catch (e) {
      return sendError(res, e, '塗装の取得に失敗しました');
    }
  }

  if (method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET か POST で呼んでください' });
  }

  try {
    const body = readBody(req);
    const result = await setPrimaryPhoto(body.photoId);
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, '代表写真の変更に失敗しました');
  }
}
