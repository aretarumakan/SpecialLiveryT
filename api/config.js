/**
 * GET /api/config
 * フロントに渡す公開設定。anon キーを HTML に埋め込まず、ここから配る。
 * mock=true のときは Supabase 無しで動いている（ログイン・投稿は無効）。
 *
 * `autoApprovePhotos` は app_settings（0003_settings.sql）の値。
 * モックモードのクライアント（public/js/mockdb.js）がサーバーと同じ挙動をするために配る。
 * 設定は秘密ではない（RLS も select は全員に許している）。
 */
import { publicConfig, getSetting } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let autoApprovePhotos = true;
  try {
    autoApprovePhotos = (await getSetting('auto_approve_photos', true)) === true;
  } catch (e) {
    // 設定が読めなくても画面は開けるようにする（既定 ON のまま）
    console.warn('[config] app_settings を読めませんでした:', e.message);
  }
  return res.status(200).json({ ...publicConfig(), autoApprovePhotos });
}
