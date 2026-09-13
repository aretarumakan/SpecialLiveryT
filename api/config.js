/**
 * GET /api/config
 * フロントに渡す公開設定。anon キーを HTML に埋め込まず、ここから配る。
 * mock=true のときは Supabase 無しで動いている（ログイン・投稿は無効）。
 */
import { publicConfig } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(publicConfig());
}
