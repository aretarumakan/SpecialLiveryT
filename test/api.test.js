// api/config.js と api/liveries.js のハンドラ単体テスト: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_DB = '1';

const config = (await import('../api/config.js')).default;
const liveries = (await import('../api/liveries.js')).default;
const db = await import('../lib/db.js');

function res() {
  const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

test('GET /api/config: モックでは鍵を返さず no-store', async () => {
  const r = res();
  await config({ query: {} }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { supabaseUrl: null, supabaseAnonKey: null, mock: true });
  assert.equal(r.headers['Cache-Control'], 'no-store');
});

test('GET /api/liveries: 承認済み 11 件と航空会社チップ用の一覧', async () => {
  db.mock.reset();
  const r = res();
  await liveries({ query: {} }, r);
  assert.equal(r.code, 200);
  assert.equal(r.headers['Cache-Control'], 'public, s-maxage=60, stale-while-revalidate=30');
  assert.equal(r.body.count, 11);
  assert.equal(r.body.items.length, 11);
  assert.deepEqual(r.body.airlines, ['ANA', 'J-AIR', 'JAL', 'Skymark']);
  assert.equal(r.body.mock, true);
  const it = r.body.items.find((x) => x.reg === 'JA819A');
  assert.equal(it.name, 'ピカチュウジェット NH');
  assert.equal(it.active, true);
  assert.equal(it.thumbUrl, null);
});

test('GET /api/liveries: airline / q / active=1 が効く', async () => {
  db.mock.reset();
  db.mock.addLivery({ reg: 'JA900X', name: '退役塗装', airline: 'ANA', status: 'approved', until_date: '2019-03-31' });

  let r = res();
  await liveries({ query: { airline: 'ANA' } }, r);
  assert.equal(r.body.count, 4);

  r = res();
  await liveries({ query: { airline: 'ANA', active: '1' } }, r);
  assert.equal(r.body.count, 3);
  assert.equal(r.body.filter.activeOnly, true);

  r = res();
  await liveries({ query: { q: 'oneworld' } }, r);
  assert.equal(r.body.count, 1);
  assert.equal(r.body.items[0].reg, 'JA15XJ');
});

test('GET /api/liveries: 承認済み以外は 403（この段階では認証が無い）', async () => {
  const r = res();
  await liveries({ query: { status: 'pending' } }, r);
  assert.equal(r.code, 403);
  assert.match(r.body.error, /承認済み以外/);
  assert.equal(r.headers['Cache-Control'], 'no-store');
});
