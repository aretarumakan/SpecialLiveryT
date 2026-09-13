/**
 * POST /api/admin/credit-backfill（admin 限定）
 * body: { userId }
 *
 * そのユーザーの写真の credit_name を今の表示名に付け替える。
 * 通常クレジットは投稿時点の表示名で固定（/terms.html に明記）だが、
 * 本人から改名の反映依頼があったときに管理者が手で実行する。
 */
import { requireAdmin, readBody, rejectNonPost, sendError } from '../../lib/auth.js';
import { backfillCreditNames } from '../../lib/db.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');

  try {
    const body = readBody(req);
    const result = await backfillCreditNames(body.userId);
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, 'クレジットの再反映に失敗しました');
  }
}
