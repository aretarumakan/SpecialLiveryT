/**
 * POST /api/photos（ログイン済みの誰でも）
 * body: { op: 'finalize', photoId }
 *
 * 写真の投稿はブラウザから supabase-js で直接 insert する。RLS（0001_init.sql の
 * photos_insert）は `status='pending'` しか許さないので、自動承認はクライアントでは行えない。
 * そこで insert の直後にこの API を呼び、設定 `auto_approve_photos` が true なら
 * 管理者の承認と同じ道（adminUpdateStatus → decide_primary）で承認する。
 * 承認者は「システム」なので `approved_by` は NULL のまま（写真は approved_by を持たない）。
 *
 * 返り値: `{ status: 'approved' | 'pending', primaryPhotoId? }`
 *  - 自分の写真でなければ 404（他人の写真の存在を教えない）
 *  - 既に承認済みならそのまま approved を返す（再送に耐える）
 *  - 設定が読めなかったときは承認しない（pending のまま＝管理者が見る）
 */
import { requireUser, readBody, rejectNonPost, sendError } from '../lib/auth.js';
import { adminUpdateStatus, assertPhotoPaths, getPhotoForFinalize, getSetting } from '../lib/db.js';

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  const caller = await requireUser(req, res);
  if (!caller) return;
  res.setHeader('Cache-Control', 'no-store');

  let body;
  try {
    body = readBody(req);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const op = String(body.op || 'finalize');
  if (op !== 'finalize') return res.status(400).json({ error: `op が不正です: ${op}` });

  try {
    const photo = await getPhotoForFinalize(body.photoId);
    // 他人の写真・存在しない写真はどちらも 404（存在を教えない）
    if (!photo || String(photo.userId) !== String(caller.id)) {
      return res.status(404).json({ error: '写真が見つかりません' });
    }
    if (photo.status !== 'pending') {
      return res.status(200).json({ status: photo.status, autoApprove: false });
    }
    // 保存先の再検証（他人のフォルダ・外部 URL を公開しない。設計 §1）。
    // 形式が違えば 400 で承認しない（行自体は残るので管理者が見て消せる）
    assertPhotoPaths({ user_id: photo.userId, storage_path: photo.storagePath, thumb_path: photo.thumbPath });

    let auto = false;
    try {
      auto = (await getSetting('auto_approve_photos', true)) === true;
    } catch (e) {
      // 設定が読めないときは承認しない（安全側）。管理画面の承認待ちに残る
      console.warn('[photos] 設定を読めませんでした（自動承認しません）:', e.message);
    }
    if (!auto) return res.status(200).json({ status: 'pending', autoApprove: false });

    const result = await adminUpdateStatus({ type: 'photo', id: photo.id, action: 'approve', adminId: null });
    return res.status(200).json({ status: 'approved', autoApprove: true, primaryPhotoId: result.primaryPhotoId });
  } catch (e) {
    return sendError(res, e, '写真の公開処理に失敗しました');
  }
}
