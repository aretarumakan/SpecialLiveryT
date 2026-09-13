/**
 * /api/admin/:op（admin 限定）をまとめて 1 つの Serverless Function で受ける。
 * Vercel Hobby プランは 1 デプロイあたり 12 関数までなので、管理系を lib/admin-api/ に置き、
 * vercel.json の rewrite（/api/admin/:op → /api/admin?op=:op）でここに集約している。
 */
import approve from '../lib/admin-api/approve.js';
import creditBackfill from '../lib/admin-api/credit-backfill.js';
import hexFill from '../lib/admin-api/hex-fill.js';
import pending from '../lib/admin-api/pending.js';
import primary from '../lib/admin-api/primary.js';
import reports from '../lib/admin-api/reports.js';
import role from '../lib/admin-api/role.js';
import settings from '../lib/admin-api/settings.js';
import sweep from '../lib/admin-api/sweep.js';
import users from '../lib/admin-api/users.js';

const OPS = {
  approve, 'credit-backfill': creditBackfill, 'hex-fill': hexFill, pending, primary, reports,
  role, settings, sweep, users,
};

export default async function handler(req, res) {
  const op = String((req.query && req.query.op) || '');
  const fn = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;
  if (!fn) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: `不明な管理操作です: ${op || '(なし)'}` });
  }
  return fn(req, res);
}
