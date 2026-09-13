/**
 * Google Identity Services（GIS）用の nonce ヘルパー。
 *
 * GIS には **SHA-256 でハッシュした** nonce を渡し、Supabase の
 * `signInWithIdToken({ nonce })` には **生の** nonce を渡す。
 * Supabase（GoTrue）は受け取った生 nonce を SHA-256 して 16 進小文字にしたものを
 * ID トークンの `nonce` クレームと比較するので、ハッシュの表現は
 * 「SHA-256 → hex（小文字・64 文字）」でなければならない。
 *
 * ブラウザでも node（node:crypto の webcrypto）でも同じ結果になるように、
 * Web Crypto API（globalThis.crypto）だけを使う。
 */

/** @returns {Crypto} Web Crypto。無ければ例外（古いブラウザ / http:// での配信） */
function webCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || !c.getRandomValues) {
    throw new Error('この環境では Web Crypto が使えません（https:// または localhost で開いてください）');
  }
  return c;
}

/** バイト列を base64url（= と + / を含まない）にする */
export function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 生 nonce を作る。32 バイトの乱数を base64url にしたもの（43 文字）。
 * @returns {string}
 */
export function randomNonce() {
  const bytes = new Uint8Array(32);
  webCrypto().getRandomValues(bytes);
  return base64url(bytes);
}

/**
 * 生 nonce → GIS に渡すハッシュ（SHA-256 の 16 進小文字・64 文字）。
 * @param {string} raw
 * @returns {Promise<string>}
 */
export async function hashNonce(raw) {
  const buf = await webCrypto().subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 生とハッシュのペアを作る。
 * @returns {Promise<{raw: string, hashed: string}>}
 */
export async function createNoncePair() {
  const raw = randomNonce();
  return { raw, hashed: await hashNonce(raw) };
}
