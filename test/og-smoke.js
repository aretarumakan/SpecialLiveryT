// 実際に @vercel/og で PNG を描く確認（ネットワーク要）: node test/og-smoke.js JA819A out.png
import { writeFile } from 'node:fs/promises';
import handler from '../api/og.js';
const reg = process.argv[2] || 'JA819A';
const out = process.argv[3] || 'og.png';
const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
const t0 = Date.now();
await handler({ query: { reg } }, res);
await writeFile(out, res.body);
console.log(`HTTP ${res.code} ${res.headers['Content-Type']} ${res.body.length} bytes ${Date.now() - t0} ms -> ${out}`);
