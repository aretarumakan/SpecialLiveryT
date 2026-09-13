// lib/position.js（共有ページの「今どこ？」）の単体テスト: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_DB = '1';

const {
  getCurrentPosition, clearPositionCache, nearestAirport, nearestAirportView, positionLabel, POSITION_CACHE_MS,
} = await import('../lib/position.js');
const { AIRPORTS } = await import('../lib/airports.js');

const RJTT = AIRPORTS[0];
const RJOO = AIRPORTS.find((a) => a.icao === 'RJOO');

/** adsb.lol /v2/reg/{reg} 風の応答を返す偽 fetch。経路照会は別で差し替える */
function fakeFetch(ac, { status = 200, body } = {}) {
  return async () => ({
    status,
    ok: status === 200,
    text: async () => (body !== undefined ? body : JSON.stringify({ ac, msg: 'No error', now: 1700000000000, total: ac.length })),
  });
}

const noRoute = async () => null;

test('nearestAirport / nearestAirportView: 3nm 以内は空港名、遠いと name=null + 距離', () => {
  const near = nearestAirport(RJTT.lat + 0.002, RJTT.lon + 0.002);
  assert.equal(near.icao, 'RJTT');
  assert.ok(near.distNm < 1);

  const view = nearestAirportView(RJTT.lat + 0.002, RJTT.lon + 0.002);
  assert.equal(view.name, '東京国際（羽田）');
  assert.equal(view.iata, 'HND');
  assert.equal(view.near, true);

  // 羽田から約 0.5 度南（≒ 30nm）は「羽田にいる」とは言わせない
  const far = nearestAirportView(RJTT.lat - 0.5, RJTT.lon);
  assert.equal(far.name, null);
  assert.equal(far.near, false);
  assert.ok(far.distKm > 40);
});

test('地上: 羽田に駐機中（state=ground・空港名つきの label）', async () => {
  clearPositionCache();
  const p = await getCurrentPosition('JA819A', {
    fetch: fakeFetch([{ hex: 'abc123', r: 'JA819A', flight: 'ANA123 ', t: 'B788', alt_baro: 'ground', gs: 0, lat: RJTT.lat + 0.002, lon: RJTT.lon + 0.002, seen: 0.2 }]),
    lookupRoute: noRoute,
  });
  assert.equal(p.state, 'ground');
  assert.equal(p.reg, 'JA819A');
  assert.equal(p.callsign, 'ANA123');
  assert.equal(p.altFt, 0);
  assert.equal(p.airport.icao, 'RJTT');
  assert.equal(p.airport.iata, 'HND');
  assert.equal(p.label, '東京国際（羽田）（HND）に駐機中');
  assert.equal(p.etaMin, null);
});

test('地上: 空港から遠いと空港名を出さない', async () => {
  clearPositionCache();
  const p = await getCurrentPosition('JA819A', {
    fetch: fakeFetch([{ hex: 'abc123', r: 'JA819A', flight: '', alt_baro: 'ground', gs: 0, lat: RJTT.lat - 0.5, lon: RJTT.lon }]),
    lookupRoute: noRoute,
  });
  assert.equal(p.state, 'ground');
  assert.equal(p.airport.name, null);
  assert.match(p.label, /^RJTT から約 [\d.]+ km の地上にいます$/);
});

test('飛行中: 経路と目的地までの残り時間（目的地が AIRPORTS にあるとき）', async () => {
  clearPositionCache();
  // 伊丹の真東 約 1 度（≒ 49nm）を 480kt で飛んでいる想定
  const lat = RJOO.lat, lon = RJOO.lon + 1.0;
  const route = {
    origin: { icao: 'RJTT', iata: 'HND', name: 'Tokyo' },
    dest: { icao: 'RJOO', iata: 'ITM', name: 'Osaka' },
    airline: 'All Nippon Airways',
  };
  const p = await getCurrentPosition('JA819A', {
    fetch: fakeFetch([{ hex: 'abc123', r: 'JA819A', flight: 'ANA31  ', alt_baro: 24000, gs: 480, baro_rate: -1200, track: 270, lat, lon }]),
    lookupRoute: async (cs) => { assert.equal(cs, 'ANA31'); return route; },
  });
  assert.equal(p.state, 'airborne');
  assert.equal(p.callsign, 'ANA31');
  assert.equal(p.altFt, 24000);
  assert.equal(p.gsKt, 480);
  assert.equal(p.route.dest.icao, 'RJOO');
  assert.ok(p.etaMin > 3 && p.etaMin < 12, `etaMin=${p.etaMin}`);
  assert.match(p.label, /^ANA31 Tokyo（HND）→Osaka（ITM） あと約 \d+ 分$/);
  assert.equal(p.short, 'Tokyo（HND）→Osaka（ITM）を飛行中');
});

test('飛行中: 経路が引けないときは高度だけ出し、ETA は null', async () => {
  clearPositionCache();
  const p = await getCurrentPosition('JA819A', {
    fetch: fakeFetch([{ hex: 'abc123', r: 'JA819A', flight: 'ANA31', alt_baro: 24040, gs: 480, lat: 35.0, lon: 138.0 }]),
    lookupRoute: noRoute,
  });
  assert.equal(p.state, 'airborne');
  assert.equal(p.route, null);
  assert.equal(p.etaMin, null);
  assert.equal(p.label, 'ANA31 飛行中（24000 ft）');
});

test('飛行中: 目的地が国内 45 空港に無ければ ETA は出さない', async () => {
  clearPositionCache();
  const p = await getCurrentPosition('JA819A', {
    fetch: fakeFetch([{ hex: 'abc123', r: 'JA819A', flight: 'ANA11', alt_baro: 35000, gs: 500, lat: 35.0, lon: 140.0 }]),
    lookupRoute: async () => ({ origin: { icao: 'RJAA', iata: 'NRT', name: 'Tokyo' }, dest: { icao: 'KLAX', iata: 'LAX', name: 'Los Angeles' }, airline: 'ANA' }),
  });
  assert.equal(p.etaMin, null);
  assert.match(p.label, /Tokyo（NRT）→Los Angeles（LAX）$/);
});

test('受信なし: ac が空なら unseen', async () => {
  clearPositionCache();
  const p = await getCurrentPosition('JA819A', { fetch: fakeFetch([]), lookupRoute: noRoute });
  assert.equal(p.state, 'unseen');
  assert.equal(p.label, '現在は受信できません');
  assert.equal(p.short, '受信なし');
});

test('障害: HTTP エラー・壊れた応答・例外はすべて unknown（例外は投げない）', async () => {
  clearPositionCache();
  const bad = await getCurrentPosition('JA819A', { fetch: fakeFetch([], { status: 503, body: 'oops' }), lookupRoute: noRoute });
  assert.equal(bad.state, 'unknown');
  assert.match(bad.error, /HTTP 503/);
  assert.equal(bad.label, '現在地を取得できませんでした');

  clearPositionCache();
  const broken = await getCurrentPosition('JA819A', { fetch: fakeFetch([], { body: 'not json' }), lookupRoute: noRoute });
  assert.equal(broken.state, 'unknown');

  clearPositionCache();
  const thrown = await getCurrentPosition('JA819A', {
    fetch: async () => { throw new Error('network down'); }, lookupRoute: noRoute,
  });
  assert.equal(thrown.state, 'unknown');
  assert.match(thrown.error, /network down/);
});

test('20 秒キャッシュ: 同じ登録記号は 1 回しか取りに行かない', async () => {
  clearPositionCache();
  let calls = 0;
  const deps = {
    fetch: async () => { calls += 1; return { status: 200, ok: true, text: async () => JSON.stringify({ ac: [], now: 1 }) }; },
    lookupRoute: noRoute,
  };
  await getCurrentPosition('JA819A', deps);
  await getCurrentPosition('ja819a', deps); // 大文字小文字は同じキー
  assert.equal(calls, 1);

  // キャッシュ期限を過ぎたら取り直す
  await getCurrentPosition('JA819A', { ...deps, now: () => Date.now() + POSITION_CACHE_MS + 1 });
  assert.equal(calls, 2);
});

test('positionLabel: 状態ごとの文言（純関数として単独で使える）', () => {
  assert.deepEqual(positionLabel({ state: 'unseen' }), { label: '現在は受信できません', short: '受信なし' });
  assert.deepEqual(positionLabel(null), { label: '現在地を取得できませんでした', short: '現在地不明' });
  assert.equal(positionLabel({ state: 'ground', airport: { icao: 'RJFF', iata: 'FUK', name: '福岡', distKm: 0.4, near: true } }).label, '福岡（FUK）に駐機中');
});
