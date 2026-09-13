/**
 * 依存なしの簡易開発サーバー（`vercel dev` の代わり）。
 *
 *   npm run dev            # MOCK_DB=1 で http://localhost:3000
 *   node test/dev-server.js --port 3100
 *
 *  - `public/` を静的配信（/ → public/index.html）
 *  - `api/*.js` の default export を `/api/<ファイル名>` にマウント（Vercel 互換の最小 shim）
 *  - `/livery/:reg` は api/livery-page.js があればそれに回す（フェーズ D）
 *  - Edge Function（`export const config = { runtime: 'edge' }`）があれば実行せず
 *    `/api/og` はプレースホルダの SVG を返す（フェーズ D）
 *
 * `node --test` からは import されるだけでサーバーは起動しない（下の isMain 判定）。
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const API_DIR = path.join(ROOT, 'api');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Vercel の res に寄せた最小限の shim を生やす */
function shimRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    const text = JSON.stringify(body);
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(text);
    return res;
  };
  res.send = (body) => {
    if (body == null) { res.end(); return res; }
    if (typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
    return res;
  };
  return res;
}

/** req.query（Vercel は配列ではなく最後の値を入れる）と req.body を用意する */
async function shimReq(req, url) {
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  req.query = query;
  req.cookies = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    req.rawBody = raw;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
  }
  return req;
}

/**
 * api/ 配下の .js を {ルート名: importPath} で列挙する。
 * サブディレクトリも辿るので `api/admin/approve.js` は `admin/approve`
 * （= `/api/admin/approve`）になる。Vercel のファイル配置と同じ規則。
 */
export async function listApiRoutes(dir = API_DIR, prefix = '') {
  const out = new Map();
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      for (const [k, v] of await listApiRoutes(path.join(dir, e.name), `${prefix}${e.name}/`)) out.set(k, v);
      continue;
    }
    if (!e.isFile() || !e.name.endsWith('.js')) continue;
    out.set(prefix + e.name.replace(/\.js$/, ''), path.join(dir, e.name));
  }
  return out;
}

/**
 * Edge Function かどうかをソースから判定する（import はしない）。
 * `api/og.js` は `@vercel/og`（satori + resvg の wasm）を読み込み、Edge Runtime でしか動かないので、
 * この簡易サーバーでは実行せずプレースホルダの SVG を返す。
 */
async function isEdgeFunction(file) {
  try {
    const src = await fsp.readFile(file, 'utf8');
    return /runtime:\s*['"]edge['"]/.test(src);
  } catch { return false; }
}

/** Edge Function の代わりに返す画像。何が起きているかを画像自体に書いておく */
function edgePlaceholderSvg(route, query) {
  const label = `/api/${route}${query ? '?' + query : ''}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <rect width="1200" height="10" fill="#fbbf24"/>
  <text x="64" y="300" font-size="64" font-family="sans-serif" fill="#f8fafc">OG image placeholder</text>
  <text x="64" y="370" font-size="32" font-family="monospace" fill="#94a3b8">${esc(label)}</text>
  <text x="64" y="440" font-size="28" font-family="sans-serif" fill="#94a3b8">Edge Runtime is not available in test/dev-server.js</text>
  <text x="64" y="486" font-size="28" font-family="sans-serif" fill="#94a3b8">Use \`npx vercel dev\` or a deployment to render the real image.</text>
</svg>`;
}

async function loadHandler(file) {
  // キャッシュバスターは付けない（毎回 import すると ESM キャッシュに溜まるため）
  const mod = await import(pathToFileURL(file).href);
  const fn = mod.default;
  if (typeof fn !== 'function') throw new Error(`${path.basename(file)} に default export の関数がありません`);
  return fn;
}

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const rel = decoded.replace(/^\/+/, '');
  const full = path.resolve(PUBLIC_DIR, rel === '' ? 'index.html' : rel);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) return null; // ../ 脱出を防ぐ
  return full;
}

async function serveStatic(req, res, pathname) {
  let file = safeStaticPath(pathname);
  if (!file) { res.statusCode = 403; res.end('Forbidden'); return; }
  let st = null;
  try { st = await fsp.stat(file); } catch { st = null; }
  if (st && st.isDirectory()) {
    file = path.join(file, 'index.html');
    try { st = await fsp.stat(file); } catch { st = null; }
  }
  if (!st || !st.isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h1>404</h1><p>見つかりません: ' + pathname.replace(/[<>&]/g, '') + '</p>');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
}

export async function createServer() {
  const routes = await listApiRoutes();
  const liveryPage = routes.has('livery-page') ? routes.get('livery-page') : null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    shimRes(res);
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // /livery/:reg → api/livery-page.js（フェーズ D。無ければ案内を出す）
      const liveryMatch = pathname.match(/^\/livery\/([^/]+)\/?$/);
      if (liveryMatch) {
        if (!liveryPage) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('<h1>準備中</h1><p>共有ページ（/livery/:reg）はフェーズ D で実装します。</p><p><a href="/liveries.html">一覧に戻る</a></p>');
          return;
        }
        await shimReq(req, url);
        req.query.reg = decodeURIComponent(liveryMatch[1]);
        const fn = await loadHandler(liveryPage);
        await fn(req, res);
        return;
      }

      const apiMatch = pathname.match(/^\/api\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/?$/);
      if (apiMatch) {
        let file = routes.get(apiMatch[1]);
        let adminOp = null;
        // vercel.json の rewrite（/api/admin/:op → /api/admin?op=:op）を再現する
        const adminMatch = !file && apiMatch[1].match(/^admin\/([A-Za-z0-9_-]+)$/);
        if (adminMatch && routes.has('admin')) { file = routes.get('admin'); adminOp = adminMatch[1]; }
        if (!file) { res.status(404).json({ error: `/api/${apiMatch[1]} はありません` }); return; }
        if (await isEdgeFunction(file)) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/svg+xml');
          res.setHeader('Cache-Control', 'no-store');
          res.end(edgePlaceholderSvg(apiMatch[1], url.searchParams.toString()));
          return;
        }
        await shimReq(req, url);
        if (adminOp) req.query.op = adminOp;
        const fn = await loadHandler(file);
        await fn(req, res);
        if (!res.writableEnded) res.end();
        return;
      }

      if (pathname.startsWith('/api/')) { res.status(404).json({ error: 'not found' }); return; }

      await serveStatic(req, res, pathname);
    } catch (e) {
      console.error('[dev-server]', e);
      if (!res.headersSent) res.statusCode = 500;
      if (!res.writableEnded) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String((e && e.stack) || e) }));
      }
    }
  });

  server.routes = routes;
  return server;
}

function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]);
  return Number(process.env.PORT) || 3000;
}

// NODE_TEST_CONTEXT … `node --test` の子プロセスでは起動しない（テストが終わらなくなる）
const isMain = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = parsePort(process.argv);
  const server = await createServer();
  server.listen(port, () => {
    const mode = (process.env.MOCK_DB === '1' || !process.env.SUPABASE_URL) ? 'モック（lib/liveries.js の 11 件）' : 'Supabase';
    console.log(`空港ウォッチ dev server  http://localhost:${port}`);
    console.log(`  DB: ${mode}`);
    console.log(`  API: ${[...server.routes.keys()].map((n) => '/api/' + n).join('  ')}`);
  });
}
