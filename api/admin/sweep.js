/**
 * POST /api/admin/sweep（admin 限定）— Storage の孤児ファイル掃除
 *
 * バケット livery-photos を service role キーで列挙し、`photos` のどの行からも
 * 参照されていないファイルを消す（投稿中の取りこぼしを避けるため、作成から
 * 1 時間未満のファイルは対象外）。モックでは `{ skipped: true }` を返すだけ。
 *
 * body は任意: { dryRun?:boolean }（dryRun なら消さずに一覧だけ返す）
 */
import { requireAdmin, readBody, rejectNonPost, sendError } from '../../lib/auth.js';
import { sweepOrphans } from '../../lib/admin.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');

  try {
    const body = readBody(req);
    const result = await sweepOrphans({ dryRun: body.dryRun === true });
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, '孤児ファイルの掃除に失敗しました');
  }
}
