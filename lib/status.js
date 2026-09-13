/**
 * 空港ウォッチ — サーバー側ロジック（Vercel Serverless Function から呼ばれる）
 *
 * データソース（無料・キー不要）
 *  - adsb.lol  : 機体位置（ADS-B）  https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{nm}
 *  - adsb.fi   : adsb.lol 障害時のフォールバック
 *  - adsbdb    : 便名 → 出発地/目的地  https://api.adsbdb.com/v0/callsign/{callsign}
 */
import { findAirport } from './airports.js';
import { SPECIAL_LIVERIES, AIRLINES, AIRCRAFT_TYPES } from './liveries.js';
import { getApprovedLiveries } from './db.js';

export const SEARCH_RADIUS_NM = 120;          // 空港周辺の取得半径（海里）
export const ADSB_CACHE_MS = 20 * 1000;       // 同じ空港の位置データを共有する時間（インスタンス内）
export const ROUTE_CACHE_MS = 6 * 3600 * 1000; // 便名→経路のキャッシュ
export const ROUTE_LOOKUPS_PER_REFRESH = 25;  // 1 回の更新で新規に経路照会する便数の上限
export const ARRIVAL_MAX_MINUTES = 90;        // 到着予定として表示する最大所要時間
const USER_AGENT = 'AirportWatch/1.0 (+https://github.com/aretarumakan/SpecialLiveryT)';
const FETCH_TIMEOUT_MS = 8000;

const ADSB_SOURCES = [
  { name: 'adsb.lol', url: (a) => `https://api.adsb.lol/v2/lat/${a.lat}/lon/${a.lon}/dist/${SEARCH_RADIUS_NM}`, list: 'ac' },
  { name: 'adsb.fi',  url: (a) => `https://opendata.adsb.fi/api/v2/lat/${a.lat}/lon/${a.lon}/dist/${SEARCH_RADIUS_NM}`, list: 'aircraft' },
];

// インスタンス内キャッシュ（Vercel の関数は同一インスタンスが暖かい間は使い回される）
const adsbCache = new Map();   // icao -> { at, payload }
const routeCache = new Map();  // callsign -> { at, route|null }

/**
 * 特別塗装の辞書を取得する。DB（Supabase またはモック）が使えないときは
 * lib/liveries.js の静的な辞書にフォールバックするので、空港ウォッチは壊れない。
 * @returns {Promise<Object<string, Object>>} 登録記号（大文字）→ 塗装
 */
export async function loadLiveryMap(deps = {}) {
  const loader = deps.getLiveries || getApprovedLiveries;
  try {
    const map = await loader();
    if (map && Object.keys(map).length) return map;
  } catch (e) {
    // DB 障害時は静的辞書で動かす（ログだけ残す）
    console.warn('[status] 塗装DBの取得に失敗したため静的辞書を使います:', e && e.message ? e.message : e);
  }
  return SPECIAL_LIVERIES;
}

/**
 * @param {string} icao 空港 ICAO コード（例 RJTT）
 * @returns {Promise<Object>} { airport, updatedAt, total, source, onGround[], arriving[], departing[], nearbySpecial[] } または { error }
 */
export async function getAirportStatus(icao, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const airport = findAirport(icao);
  if (!airport) return { error: `不明な空港コードです: ${icao}` };

  const [fetched, liveryMap] = await Promise.all([
    fetchAircraftNear(airport, fetchImpl),
    loadLiveryMap(deps),
  ]);
  if (fetched.error) return { error: fetched.error, updatedAt: Date.now() };

  const classified = classifyAircraft(airport, fetched.ac, liveryMap);
  await attachRoutes(classified.needRoute, fetchImpl);
  const result = finalizeStatus(airport, classified);
  result.updatedAt = fetched.fetchedAt;
  result.total = fetched.ac.length;
  result.source = fetched.source;
  return result;
}

// ---------------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------------

async function fetchJson(url, fetchImpl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, body: text };
  } finally {
    clearTimeout(t);
  }
}

async function fetchAircraftNear(airport, fetchImpl) {
  const hit = adsbCache.get(airport.icao);
  if (hit && Date.now() - hit.at < ADSB_CACHE_MS) return hit.payload;

  const errors = [];
  for (const src of ADSB_SOURCES) {
    try {
      const res = await fetchJson(src.url(airport), fetchImpl);
      if (res.status !== 200) { errors.push(`${src.name}: HTTP ${res.status}`); continue; }
      const body = JSON.parse(res.body);
      const list = body[src.list];
      if (!list) { errors.push(`${src.name}: 予期しない応答`); continue; }
      const now = body.now ? (body.now < 1e11 ? body.now * 1000 : body.now) : Date.now();
      const payload = { ac: list, fetchedAt: Math.round(now), source: src.name };
      adsbCache.set(airport.icao, { at: Date.now(), payload });
      return payload;
    } catch (e) {
      errors.push(`${src.name}: ${e.name === 'AbortError' ? 'タイムアウト' : e.message}`);
    }
  }
  return { error: `位置情報の取得に失敗しました（${errors.join(' / ')}）` };
}

/**
 * 便名 → 経路（出発地・目的地・航空会社）。adsbdb に 1 件だけ問い合わせる。
 * 結果は ROUTE_CACHE_MS だけプロセス内にキャッシュする。
 * 404（未登録の便名）もキャッシュするが、5xx やタイムアウトはキャッシュしない（次回再試行する）。
 *
 * `/api/status`（attachRoutes）と `/api/livery`（lib/position.js）の両方から使う。
 * @param {string} callsign 便名（例 ANA123）
 * @param {Function} [fetchImpl] 差し替え可能な fetch（テスト用）
 * @returns {Promise<{origin:Object|null, dest:Object|null, airline:(string|null)}|null>}
 */
export async function lookupRoute(callsign, fetchImpl = fetch) {
  const key = String(callsign || '').trim();
  if (!key) return null;
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_MS) return hit.route;

  let route = null, status = 0;
  try {
    const res = await fetchJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`, fetchImpl);
    status = res.status;
    if (status === 200) {
      const fr = JSON.parse(res.body).response.flightroute;
      route = {
        origin: fr.origin ? { icao: fr.origin.icao_code, iata: fr.origin.iata_code, name: fr.origin.municipality || fr.origin.name } : null,
        dest: fr.destination ? { icao: fr.destination.icao_code, iata: fr.destination.iata_code, name: fr.destination.municipality || fr.destination.name } : null,
        airline: fr.airline ? fr.airline.name : null,
      };
    }
  } catch (e) { route = null; }
  if (status === 200 || status === 404) routeCache.set(key, { at: Date.now(), route });
  return route;
}

/** 経路キャッシュを捨てる（テスト用） */
export function clearRouteCache() {
  routeCache.clear();
}

async function attachRoutes(items, fetchImpl) {
  if (!items.length) return;
  const missing = [];
  for (const it of items) {
    const hit = routeCache.get(it.callsign);
    if (hit && Date.now() - hit.at < ROUTE_CACHE_MS) it.route = hit.route;
    else missing.push(it);
  }
  // 1 回の更新で新規に照会する便数には上限がある（あふれた分は次の更新で拾う）
  const batch = missing.slice(0, ROUTE_LOOKUPS_PER_REFRESH);
  await Promise.all(batch.map(async (it) => { it.route = await lookupRoute(it.callsign, fetchImpl); }));
}

// ---------------------------------------------------------------------------
// 判定（純関数）
// ---------------------------------------------------------------------------

export function classifyAircraft(airport, acList, liveryMap = SPECIAL_LIVERIES) {
  const onGround = [], airborne = [], needRoute = [];
  for (const raw of acList) {
    if (raw.lat == null || raw.lon == null) continue;
    const it = normalizeAircraft(raw, airport, liveryMap);
    if (it.onGround) {
      if (it.distNm <= airport.radiusNm) onGround.push(it);
      continue;
    }
    // 空港直上の低高度は着陸直前/離陸直後として空港内に含める
    if (it.distNm <= airport.radiusNm && it.altFt != null && it.altFt < 1500) {
      it.phase = it.vsFpm != null && it.vsFpm > 200 ? 'takeoff' : 'landing';
      onGround.push(it);
      continue;
    }
    airborne.push(it);
    if (it.callsign && it.distNm <= SEARCH_RADIUS_NM) needRoute.push(it);
  }
  // 経路照会は 1 回あたり件数上限があるので、空港に向かって降下中の近い機体を優先する
  needRoute.sort((a, b) => routePriority(a) - routePriority(b));
  return { onGround, airborne, needRoute };
}

function routePriority(it) {
  const towards = it.headingOffset != null && it.headingOffset <= 60;
  const descending = it.vsFpm != null && it.vsFpm < -200;
  let p = it.distNm;
  if (towards) p -= 40;
  if (descending) p -= 40;
  if (it.special) p -= 200;
  return p;
}

/**
 * 塗装レコード → 機体カードに載せる `special`。
 * 既存の表示項目（airline / type / name / note / color）は必ず残し、
 * DB 由来のときは代表写真とクレジットを足す。
 */
export function specialView(entry) {
  if (!entry) return null;
  return {
    airline: entry.airline || '',
    type: entry.type || '',
    name: entry.name || '',
    note: entry.note || '',
    color: entry.color || null,
    liveryId: entry.id == null ? null : entry.id,
    photoUrl: entry.photoUrl || null,
    thumbUrl: entry.thumbUrl || null,
    credit: entry.credit || null,
  };
}

function normalizeAircraft(raw, airport, liveryMap = SPECIAL_LIVERIES) {
  const reg = (raw.r || '').trim();
  const callsign = (raw.flight || '').trim();
  const alt = raw.alt_baro;
  const onGround = alt === 'ground';
  const altFt = onGround ? 0 : (typeof alt === 'number' ? alt : (typeof raw.alt_geom === 'number' ? raw.alt_geom : null));
  const distNm = typeof raw.dst === 'number' ? raw.dst : haversineNm(airport.lat, airport.lon, raw.lat, raw.lon);
  const bearingToAirport = bearingDeg(raw.lat, raw.lon, airport.lat, airport.lon);
  const track = typeof raw.track === 'number' ? raw.track : (typeof raw.true_heading === 'number' ? raw.true_heading : null);
  const prefix = callsign.match(/^[A-Z]{3}/);
  return {
    hex: raw.hex,
    reg,
    callsign,
    airlineCode: prefix ? prefix[0] : '',
    airline: prefix && AIRLINES[prefix[0]] ? AIRLINES[prefix[0]] : '',
    typeCode: raw.t || '',
    typeName: AIRCRAFT_TYPES[raw.t] || raw.t || '',
    onGround,
    altFt,
    gsKt: typeof raw.gs === 'number' ? raw.gs : null,
    vsFpm: typeof raw.baro_rate === 'number' ? raw.baro_rate : (typeof raw.geom_rate === 'number' ? raw.geom_rate : null),
    track,
    distNm,
    headingOffset: track == null ? null : angleDiff(track, bearingToAirport),
    lat: raw.lat,
    lon: raw.lon,
    seen: raw.seen,
    special: specialView(liveryMap[reg.toUpperCase()] || null),
    phase: null,
    route: undefined,
  };
}

/** 距離(海里)に対して着陸進入としてあり得る高度か（約 3° の降下 + 余裕） */
function plausibleApproachAlt(it) {
  if (it.altFt == null) return true;
  return it.altFt <= it.distNm * 350 + 3000;
}

export function finalizeStatus(airport, c) {
  const arriving = [], departing = [], nearbySpecial = [];
  for (const it of c.airborne) {
    const etaMin = (it.gsKt && it.gsKt > 60) ? Math.round(it.distNm / it.gsKt * 60) : null;
    it.etaMin = etaMin;
    const destHere = it.route && it.route.dest && it.route.dest.icao === airport.icao;
    const originHere = it.route && it.route.origin && it.route.origin.icao === airport.icao;
    const towards = it.headingOffset != null && it.headingOffset <= 60;
    const descending = it.vsFpm != null && it.vsFpm < -200;

    if (destHere) {
      it.phase = 'arriving';
      it.confidence = 'route';
    } else if (!it.route && towards && (descending || it.distNm <= 25) && it.distNm <= 80 && plausibleApproachAlt(it)) {
      it.phase = 'arriving';
      it.confidence = 'heuristic';
    } else if (originHere && it.distNm <= 60) {
      it.phase = 'departing';
    } else if (!it.route && it.headingOffset != null && it.headingOffset >= 120 && it.distNm <= 20 && it.vsFpm != null && it.vsFpm > 300) {
      it.phase = 'departing';
    }

    if (it.phase === 'arriving' && (etaMin == null || etaMin <= ARRIVAL_MAX_MINUTES)) arriving.push(it);
    else if (it.phase === 'departing') departing.push(it);
    else if (it.special) nearbySpecial.push(it);
  }

  const byDist = (a, b) => a.distNm - b.distNm;
  arriving.sort(byDist); departing.sort(byDist); nearbySpecial.sort(byDist);
  c.onGround.sort((a, b) => {
    // 特別塗装 → 着陸/離陸中 → 動いている機体 → 登録記号
    if (!!a.special !== !!b.special) return a.special ? -1 : 1;
    if (!!a.phase !== !!b.phase) return a.phase ? -1 : 1;
    const am = (a.gsKt || 0) > 5, bm = (b.gsKt || 0) > 5;
    if (am !== bm) return am ? -1 : 1;
    return (a.reg || 'zzz').localeCompare(b.reg || 'zzz');
  });

  return {
    airport: { icao: airport.icao, iata: airport.iata, name: airport.name },
    onGround: c.onGround.map(publicView),
    arriving: arriving.map(publicView),
    departing: departing.map(publicView),
    nearbySpecial: nearbySpecial.map(publicView),
  };
}

function publicView(it) {
  return {
    hex: it.hex, reg: it.reg, callsign: it.callsign, airline: it.airline, airlineCode: it.airlineCode,
    typeCode: it.typeCode, typeName: it.typeName, altFt: it.altFt == null ? null : Math.max(0, it.altFt),
    gsKt: it.gsKt, vsFpm: it.vsFpm,
    distNm: Math.round(it.distNm * 10) / 10, distKm: Math.round(it.distNm * 1.852), etaMin: it.etaMin == null ? null : it.etaMin,
    phase: it.phase, confidence: it.confidence || null, special: it.special,
    route: it.route || null, lat: it.lat, lon: it.lon,
  };
}

// ---------------------------------------------------------------------------
// 幾何
// ---------------------------------------------------------------------------

export function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // 海里
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
