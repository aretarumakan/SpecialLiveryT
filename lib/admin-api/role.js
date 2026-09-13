/**
 * POST /api/admin/role（admin 限定）— 管理者を増やす／外す
 * body: { userId, role: 'admin' | 'user' }
 *
 * 守り:
 *  - 自分自身は降格できない（権限を失って戻せなくなる事故を防ぐ）
 *  - 管理者が 0 人になる降格はできない（lib/db.js の setProfileRole が見る）
 *
 * profiles.role の更新は service role キーで行う。0001_init.sql の profiles_guard_role
 * トリガーは auth.uid() が NULL（= service role / SQL Editor）のときだけ role の変更を通す。
 */
import { requireAdmin, readBody, rejectNonPost, sendError } from '../auth.js';
import { setProfileRole, listAdmins } from '../db.js';

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

  const role = String(body.role == null ? '' : body.role).trim();
  if (String(body.userId || '').trim() === admin.id && role !== 'admin') {
    return res.status(400).json({ error: '自分自身を管理者から外すことはできません（別の管理者に頼んでください）' });
  }

  try {
    const result = await setProfileRole(body.userId, role);
    return res.status(200).json({ ...result, admins: await listAdmins() });
  } catch (e) {
    return sendError(res, e, '権限の変更に失敗しました');
  }
}
