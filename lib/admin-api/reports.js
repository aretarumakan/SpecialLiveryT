/**
 * /api/admin/reports（admin 限定）— 通報の一覧と解決
 *
 *  GET  ?all=1        → 通報の一覧（既定は未解決のみ）
 *  POST { id }        → その通報を解決済みにする（`resolved:false` で戻せる）
 */
import { requireAdmin, readBody, sendError } from '../auth.js';
import { listReports, resolveReport } from '../db.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');

  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    const q = req.query || {};
    try {
      const items = await listReports({
        includeResolved: q.all === '1' || q.all === 'true',
        limit: q.limit,
      });
      return res.status(200).json({ count: items.length, items });
    } catch (e) {
      return sendError(res, e, '通報の取得に失敗しました');
    }
  }

  if (method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET か POST で呼んでください' });
  }

  try {
    const body = readBody(req);
    const result = await resolveReport(body.id, body.resolved === undefined ? true : body.resolved !== false);
    return res.status(200).json(result);
  } catch (e) {
    return sendError(res, e, '通報の更新に失敗しました');
  }
}
