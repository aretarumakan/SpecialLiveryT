// 実データで API ハンドラを実行する簡易テスト: node test/run.js [ICAO]
// `node --test test/` からは import されるだけで実行されない（ネットワークを使うため）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/status.js';

function mockRes() {
  const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

export async function main(icao = 'RJTT') {
  const t0 = Date.now();
  const res = mockRes();
  await handler({ query: { icao } }, res);
  console.log(`HTTP ${res.code}  ${Date.now() - t0} ms  cache=${res.headers['Cache-Control']}`);
  const d = res.body;
  if (d.error) { console.error('ERROR', d.error); process.exitCode = 1; return; }
  console.log(`${d.airport.name} total=${d.total} source=${d.source} onGround=${d.onGround.length} arriving=${d.arriving.length} departing=${d.departing.length} nearbySpecial=${d.nearbySpecial.length}`);
  const show = (label, arr) => { console.log(`\n== ${label}`); arr.slice(0, 8).forEach((a) => console.log(
    [a.reg, a.typeName, a.airline || a.airlineCode, a.callsign, a.phase || '', a.confidence || '', a.altFt, a.distKm + 'km', a.etaMin != null ? a.etaMin + 'min' : '',
     a.route ? `${a.route.origin && a.route.origin.iata}->${a.route.dest && a.route.dest.iata}` : '(no route)',
     a.special ? `★${a.special.name} id=${a.special.liveryId} photo=${a.special.thumbUrl || '-'} credit=${a.special.credit || '-'}` : ''].join(' | '))); };
  show('onGround', d.onGround); show('arriving', d.arriving); show('departing', d.departing); show('nearbySpecial', d.nearbySpecial);
  // 2 回目はキャッシュで即応答するはず
  const t1 = Date.now(); const res2 = mockRes(); await handler({ query: { icao } }, res2);
  console.log(`\n2nd call ${Date.now() - t1} ms (cache expected)`);
  const res3 = mockRes(); await handler({ query: {} }, res3); console.log('airport list', res3.body.airports.length);
  const res4 = mockRes(); await handler({ query: { icao: 'XXXX' } }, res4); console.log('bad icao ->', res4.code, res4.body.error);
}

// NODE_TEST_CONTEXT … `node --test` の子プロセスでは実行しない（外部 API を叩くため）
const isMain = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) await main(process.argv[2] || 'RJTT');
