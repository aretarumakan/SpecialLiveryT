// 特別塗装の DB 連携（lib/status.js）の単体テスト: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_DB = '1';

const { getAirportStatus, classifyAircraft, finalizeStatus, specialView, loadLiveryMap } = await import('../lib/status.js');
const { AIRPORTS } = await import('../lib/airports.js');
const { SPECIAL_LIVERIES } = await import('../lib/liveries.js');
const db = await import('../lib/db.js');

const RJTT = AIRPORTS[0];

/** DB から返ってくる形の塗装 1 件 */
function dbLivery(over = {}) {
  return {
    id: 42, reg: 'JA819A', hex: null, name: 'ピカチュウジェット NH', name_en: null,
    airline: 'ANA', type: 'B787-8', note: 'ポケモン特別塗装', color: '#f4c20d',
    since: '2021-11-01', until: null, sourceUrl: 'https://example.com/press',
    photoUrl: 'https://db.example/storage/v1/object/public/livery-photos/u1/a.jpg',
    thumbUrl: 'https://db.example/storage/v1/object/public/livery-photos/u1/a_thumb.jpg',
    credit: '撮影者X', status: 'approved', ...over,
  };
}

/** adsb.lol 風の応答を返す偽 fetch */
function fakeFetch(aircraft) {
  return async (url) => {
    if (url.includes('api.adsb.lol')) {
      return { status: 200, ok: true, text: async () => JSON.stringify({ now: Date.now(), ac: aircraft }) };
    }
    // 経路照会（adsbdb）は「未登録」にしておく
    return { status: 404, ok: false, text: async () => '{}' };
  };
}

const parkedSpecial = {
  hex: 'abc123', r: 'JA819A', flight: 'ANA123', t: 'B788',
  alt_baro: 'ground', lat: RJTT.lat + 0.002, lon: RJTT.lon + 0.002, gs: 0,
};
const parkedPlain = {
  hex: 'def456', r: 'JA801A', flight: 'ANA456', t: 'B788',
  alt_baro: 'ground', lat: RJTT.lat + 0.003, lon: RJTT.lon + 0.003, gs: 0,
};

test('specialView: 既存項目を保ったまま DB の写真情報を足す', () => {
  assert.equal(specialView(null), null);

  const fromDb = specialView(dbLivery());
  assert.deepEqual(fromDb, {
    airline: 'ANA', type: 'B787-8', name: 'ピカチュウジェット NH', note: 'ポケモン特別塗装', color: '#f4c20d',
    liveryId: 42,
    photoUrl: 'https://db.example/storage/v1/object/public/livery-photos/u1/a.jpg',
    thumbUrl: 'https://db.example/storage/v1/object/public/livery-photos/u1/a_thumb.jpg',
    credit: '撮影者X',
  });

  // 静的辞書（id なし）でも同じ形になる
  const fromStatic = specialView(SPECIAL_LIVERIES.JA819A);
  assert.equal(fromStatic.name, 'ピカチュウジェット NH');
  assert.equal(fromStatic.airline, 'ANA');
  assert.equal(fromStatic.type, 'B787-8');
  assert.equal(fromStatic.liveryId, null);
  assert.equal(fromStatic.photoUrl, null);
  assert.equal(fromStatic.credit, null);
});

test('getAirportStatus: 注入した塗装 DB の写真・liveryId が special に乗る', async () => {
  const res = await getAirportStatus('RJTT', {
    fetch: fakeFetch([parkedSpecial, parkedPlain]),
    getLiveries: async () => ({ JA819A: dbLivery() }),
  });
  assert.ok(!res.error, res.error);
  assert.equal(res.onGround.length, 2);

  const special = res.onGround.find((a) => a.reg === 'JA819A');
  assert.ok(special.special, '特別塗装として判定されていない');
  assert.equal(special.special.liveryId, 42);
  assert.equal(special.special.credit, '撮影者X');
  assert.ok(special.special.thumbUrl.endsWith('a_thumb.jpg'));
  assert.equal(special.special.name, 'ピカチュウジェット NH');
  assert.equal(special.special.note, 'ポケモン特別塗装');
  assert.equal(special.special.color, '#f4c20d');

  // 特別塗装が先頭に来る（既存の並び順）
  assert.equal(res.onGround[0].reg, 'JA819A');
  assert.equal(res.onGround.find((a) => a.reg === 'JA801A').special, null);
});

test('getAirportStatus: DB が落ちていても静的辞書で動く', async () => {
  const res = await getAirportStatus('RJTT', {
    fetch: fakeFetch([parkedSpecial]),
    getLiveries: async () => { throw new Error('DB ダウン'); },
  });
  assert.ok(!res.error);
  const special = res.onGround[0].special;
  assert.equal(special.name, 'ピカチュウジェット NH');
  assert.equal(special.liveryId, null);   // 静的辞書なので DB の id は無い
  assert.equal(special.thumbUrl, null);
});

test('getAirportStatus: DB が空なら静的辞書にフォールバックする', async () => {
  const map = await loadLiveryMap({ getLiveries: async () => ({}) });
  assert.equal(map, SPECIAL_LIVERIES);
});

test('loadLiveryMap: 既定ではモック DB（11 件）を返す', async () => {
  db.mock.reset();   // 同一プロセスで走る他のテストの追加データを捨てる
  const map = await loadLiveryMap();
  assert.equal(Object.keys(map).length, Object.keys(SPECIAL_LIVERIES).length);
  assert.equal(map.JA819A.name, 'ピカチュウジェット NH');
  assert.ok(typeof map.JA819A.id === 'number', 'モック DB 由来なので id がある');
});

test('classifyAircraft: 塗装辞書を渡さなければ静的辞書を使う', () => {
  const c = classifyAircraft(RJTT, [parkedSpecial]);
  assert.equal(c.onGround.length, 1);
  assert.equal(c.onGround[0].special.name, 'ピカチュウジェット NH');
  const out = finalizeStatus(RJTT, c);
  assert.equal(out.onGround[0].special.liveryId, null);
});

test('getAirportStatus: 不明な空港コード', async () => {
  const res = await getAirportStatus('XXXX', { fetch: fakeFetch([]), getLiveries: async () => ({}) });
  assert.match(res.error, /不明な空港コード/);
});
