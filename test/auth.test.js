/**
 * Google ログイン（GIS + signInWithIdToken）まわりのテスト。
 *  - /api/config が googleClientId を配る（未設定なら null）
 *  - public/js/nonce.js の生 nonce / SHA-256 hex
 *  - public/login.html の inline script が構文として正しい（node --check）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

process.env.MOCK_DB = '1';
// ブラウザと同じ Web Crypto を nonce.js に使わせる（node 20 では globalThis.crypto がある想定だが保険）
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const config = (await import('../api/config.js')).default;
const { randomNonce, hashNonce, createNoncePair, base64url } = await import('../public/js/nonce.js');

function res() {
  const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

test('GET /api/config: GOOGLE_CLIENT_ID が未設定なら googleClientId は null', async () => {
  const before = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    const r = res();
    await config({ query: {} }, r);
    assert.equal(r.body.googleClientId, null);
  } finally {
    if (before !== undefined) process.env.GOOGLE_CLIENT_ID = before;
  }
});

test('GET /api/config: GOOGLE_CLIENT_ID を設定するとそのまま配る（モックでも）', async () => {
  const before = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = '123-abc.apps.googleusercontent.com';
  try {
    const r = res();
    await config({ query: {} }, r);
    assert.equal(r.body.googleClientId, '123-abc.apps.googleusercontent.com');
    assert.equal(r.body.mock, true);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = before;
  }
});

test('nonce.js: 生 nonce は base64url 43 文字で毎回変わる', () => {
  const a = randomNonce();
  const b = randomNonce();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(base64url(new Uint8Array([251, 255, 190])), '-_--');
});

test('nonce.js: ハッシュは SHA-256 の 16 進小文字（Supabase が比較する形）', async () => {
  const raw = 'test-nonce';
  const hashed = await hashNonce(raw);
  assert.match(hashed, /^[0-9a-f]{64}$/);
  assert.equal(hashed, createHash('sha256').update(raw).digest('hex'));

  const pair = await createNoncePair();
  assert.equal(pair.hashed, createHash('sha256').update(pair.raw).digest('hex'));
});

test('login.html: inline script が構文エラーなし（node --check）', async () => {
  const html = await fs.readFile(path.join(ROOT, 'public', 'login.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 2, 'inline script が 2 つ以上あるはず（GIS の待受 + 本体 module）');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-login-'));
  try {
    for (const [i, m] of blocks.entries()) {
      const isModule = /type\s*=\s*["']module["']/.test(m[1]);
      const file = path.join(dir, `block${i}.${isModule ? 'mjs' : 'cjs'}`);
      await fs.writeFile(file, m[2]);
      await execFileAsync(process.execPath, ['--check', file]);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('login.html: GIS を読み込み signInWithIdToken を呼ぶ（signInWithOAuth は legacy だけ）', async () => {
  const html = await fs.readFile(path.join(ROOT, 'public', 'login.html'), 'utf8');
  assert.match(html, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(html, /google\.accounts\.id\.initialize/);
  assert.match(html, /google\.accounts\.id\.renderButton/);
  assert.match(html, /signInWithIdToken/);
  assert.match(html, /GOOGLE_CLIENT_ID/);
  assert.equal((html.match(/signInWithOAuth/g) || []).length, 1); // ?legacy=1 の逃げ道のみ
});
