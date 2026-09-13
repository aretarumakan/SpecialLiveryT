/**
 * GET /api/admin/pending（admin 限定）
 *
 * 管理画面の本体データ: 承認待ちの塗装・写真（サムネイル付き）・未解決の通報・件数。
 * 承認待ちの行は RLS では読めないので、service role キーで読む（lib/db.js）。
 */
import { requireAdmin, rejectNonGet } from '../auth.js';
import { listPending, isMock } from '../db.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  res.setHeader('Cache-Control', 'no-store');
  try {
    const data = await listPending();
    return res.status(200).json({ mock: isMock(), ...data });
  } catch (e) {
    return res.status(502).json({ error: `承認待ちの取得に失敗しました: ${e.message}` });
  }
}
