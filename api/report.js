/**
 * POST /api/report（ログイン済みの誰でも）
 * body: { targetType:'livery'|'photo', targetId, reason }
 *
 * 設計書 §5-4: 未解決の通報が 3 件以上ついた写真は自動で非表示（status を pending に戻す）
 * にして、管理者が /admin.html で再判断する。判定は lib/db.js の addReport が行う。
 *
 * 通報は reports テーブルの RLS では select できない（管理者のみ）ため、
 * 応答では件数だけを返す。reporter_id は本人確認したトークンから入れる。
 */
import { requireUser, readBody, rejectNonPost, sendError } from '../lib/auth.js';
import { addReport } from '../lib/db.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  const caller = await requireUser(req, res);
  if (!caller) return;
  res.setHeader('Cache-Control', 'no-store');

  try {
    const body = readBody(req);
    const result = await addReport({
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reason,
      reporterId: caller.id,
    });
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, '通報の登録に失敗しました');
  }
}
