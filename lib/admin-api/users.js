/**
 * GET /api/admin/users（admin 限定）— 管理者の一覧とユーザー検索
 *
 *  GET            → 今の管理者一覧 `{ admins: [...] }`
 *  GET ?q=キーワード → 表示名の部分一致。q がメールアドレスの形なら Auth の管理 API も引く
 *                     `{ admins: [...], items: [{id, displayName, role, email?}] }`
 *
 * メールアドレスは profiles に無い（0001_init.sql）ので、`${SUPABASE_URL}/auth/v1/admin/users`
 * を service role キーで引く。結果は管理者にしか返さない。
 */
import { requireAdmin, rejectNonGet, sendError } from '../auth.js';
import { listAdmins, searchProfiles } from '../db.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');

  const q = String(((req.query || {}).q) || '').trim();
  try {
    const admins = await listAdmins();
    const items = q ? await searchProfiles(q) : [];
    return res.status(200).json({ admins, count: items.length, items, q });
  } catch (e) {
    return sendError(res, e, 'ユーザーの取得に失敗しました');
  }
}
