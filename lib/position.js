/**
 * 「この機体は今どこにいる？」を 1 機だけ調べる（共有ページ `/livery/:reg` 用）。
 *
 * データ源は `/api/status` と同じ adsb.lol。空港ごとの範囲検索ではなく
 * 登録記号の直接検索 `https://api.adsb.lol/v2/reg/{reg}` を使うので、
 * その機体が日本にいなくても（受信さえされていれば）現在地が分かる。
 *
 * 状態は 4 つ:
 *   ground   … 地上にいる（最寄り空港つき）
 *   airborne … 飛行中（便名・高度・対地速度・経路・目的地までの残り時間）
 *   unseen   … adsb.lol に該当機がいない（受信されていない／駐機中でトランスポンダ停止）
 *   unknown  … 取得に失敗した（外部 API の障害・タイムアウト）
 *
 * 純粋な部分（最寄り空港・表示文言）は関数として切り出し、fetch は差し替えられる。
 */
import { AIRPORTS, findAirport } from './airports.js';
import { haversineNm, lookupRoute } from './status.js';

export const POSITION_CACHE_MS = 20 * 1000;   // 登録記号ごとのプロセス内キャッシュ
export const GROUND_NEAR_NM = 3;              // これ以内なら「その空港にいる」とみなす
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'AirportWatch/1.0 (+https://github.com/aretarumakan/SpecialLiveryT)';
const ADSB_REG_URL = (reg) => `https://api.adsb.lol/v2/reg/${encodeURIComponent(reg)}`;

const positionCache = new Map(); // REG -> { at, value }

/** キャッシュを捨てる（テスト用） */
export function clearPositionCache() {
  positionCache.clear();
}

// ---------------------------------------------------------------------------
// 純関数
// ---------------------------------------------------------------------------

/**
 * AIRPORTS の中で一番近い空港。
 * @returns {{icao:string, iata:string, name:string, distNm:number}|null}
 */
export function nearestAirport(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  let best = null;
  for (const a of AIRPORTS) {
    const distNm = haversineNm(lat, lon, a.lat, a.lon);
    if (!best || distNm < best.distNm) best = { icao: a.icao, iata: a.iata, name: a.name, distNm };
  }
  return best;
}

/**
 * 共有ページに出す最寄り空港。GROUND_NEAR_NM 以内なら空港名を出し、
 * 遠いときは name を null にして距離だけ返す（「羽田に駐機中」と誤解させないため）。
 * @returns {{icao:string, iata:string, name:(string|null), distKm:number, near:boolean}|null}
 */
export function nearestAirportView(lat, lon, maxNm = GROUND_NEAR_NM) {
  const n = nearestAirport(lat, lon);
  if (!n) return null;
  const near = n.distNm <= maxNm;
  return {
    icao: n.icao,
    iata: n.iata,
    name: near ? n.name : null,
    distKm: Math.round(n.distNm * 1.852 * 10) / 10,
    near,
  };
}

/**
 * 現在地の日本語表示。画面（共有ページ）と X の投稿文の両方で使うので
 * サーバー側で作って `/api/livery` の応答に載せる（クライアントに同じ判定を書かない）。
 * @param {Object} p getCurrentPosition の戻り値
 * @returns {{label:string, short:string}} label=画面用の 1 行 / short=投稿文に埋める短い語
 */
export function positionLabel(p) {
  if (!p || p.state === 'unknown') return { label: '現在地を取得できませんでした', short: '現在地不明' };
  if (p.state === 'unseen') return { label: '現在は受信できません', short: '受信なし' };

  const ap = p.airport;
  if (p.state === 'ground') {
    if (ap && ap.name) {
      const label = `${ap.name}（${ap.iata}）に駐機中`;
      return { label, short: `${ap.name}（${ap.iata}）に駐機中` };
    }
    if (ap) {
      const label = `${ap.icao} から約 ${ap.distKm} km の地上にいます`;
      return { label, short: `${ap.icao} 付近の地上` };
    }
    return { label: '地上にいます', short: '地上' };
  }

  // 飛行中
  const flight = p.callsign || '';
  const from = routeName(p.route && p.route.origin);
  const to = routeName(p.route && p.route.dest);
  const eta = p.etaMin == null ? '' : ` あと約 ${p.etaMin} 分`;
  if (from && to) {
    const body = `${from}→${to}`;
    return {
      label: `${flight ? flight + ' ' : ''}${body}${eta}`.trim(),
      short: `${body}を飛行中`,
    };
  }
  const alt = p.altFt == null ? '' : `${Math.round(p.altFt / 100) * 100} ft`;
  const label = `${flight ? flight + ' ' : ''}飛行中${alt ? '（' + alt + '）' : ''}`;
  return { label, short: '飛行中' };
}

function routeName(place) {
  if (!place) return '';
  const name = place.name || place.iata || place.icao || '';
  const code = place.iata || place.icao || '';
  if (!name) return '';
  return code && code !== name ? `${name}（${code}）` : name;
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

/**
 * 登録記号 1 機の現在地。20 秒はプロセス内にキャッシュする
 * （共有ページが 30 秒ごとに叩くので、閲覧者が増えても adsb.lol への負荷は増えない）。
 *
 * @param {string} reg 登録記号
 * @param {{fetch?:Function, lookupRoute?:Function, now?:Function}} [deps]
 * @returns {Promise<Object>} state を持つ現在地オブジェクト（失敗しても例外は投げない）
 */
export async function getCurrentPosition(reg, deps = {}) {
  const key = String(reg || '').trim().toUpperCase();
  if (!key) return withLabel({ state: 'unknown', reg: '', error: '登録記号がありません' });

  const now = deps.now ? deps.now() : Date.now();
  const hit = positionCache.get(key);
  if (hit && now - hit.at < POSITION_CACHE_MS) return hit.value;

  const value = await fetchPosition(key, deps, now);
  // 失敗（unknown）も同じ時間だけキャッシュする。障害中に毎回叩きに行かないため。
  positionCache.set(key, { at: now, value });
  return value;
}

async function fetchPosition(reg, deps, now) {
  const fetchImpl = deps.fetch || fetch;
  const routeLookup = deps.lookupRoute || lookupRoute;

  let body;
  try {
    const res = await fetchJson(ADSB_REG_URL(reg), fetchImpl);
    if (res.status !== 200) return withLabel({ state: 'unknown', reg, error: `adsb.lol: HTTP ${res.status}` });
    body = JSON.parse(res.body);
  } catch (e) {
    const why = e && e.name === 'AbortError' ? 'タイムアウト' : (e && e.message) || String(e);
    return withLabel({ state: 'unknown', reg, error: `adsb.lol: ${why}` });
  }

  const list = Array.isArray(body && body.ac) ? body.ac : null;
  if (!list) return withLabel({ state: 'unknown', reg, error: 'adsb.lol: 予期しない応答' });

  const ac = list.find((a) => a && typeof a.lat === 'number' && typeof a.lon === 'number');
  const updatedAt = body.now ? (body.now < 1e11 ? body.now * 1000 : body.now) : now;
  if (!ac) return withLabel({ state: 'unseen', reg, updatedAt: Math.round(updatedAt) });

  const callsign = String(ac.flight || '').trim();
  const onGround = ac.alt_baro === 'ground';
  const altFt = onGround ? 0
    : (typeof ac.alt_baro === 'number' ? ac.alt_baro : (typeof ac.alt_geom === 'number' ? ac.alt_geom : null));
  const base = {
    reg,
    hex: ac.hex || null,
    callsign: callsign || null,
    lat: ac.lat,
    lon: ac.lon,
    altFt,
    gsKt: typeof ac.gs === 'number' ? ac.gs : null,
    seen: typeof ac.seen === 'number' ? ac.seen : null,
    updatedAt: Math.round(updatedAt),
    airport: nearestAirportView(ac.lat, ac.lon),
  };

  if (onGround) return withLabel({ ...base, state: 'ground', route: null, etaMin: null });

  const route = callsign ? await routeLookup(callsign, fetchImpl) : null;
  return withLabel({
    ...base,
    state: 'airborne',
    vsFpm: typeof ac.baro_rate === 'number' ? ac.baro_rate : (typeof ac.geom_rate === 'number' ? ac.geom_rate : null),
    track: typeof ac.track === 'number' ? ac.track : null,
    route: route || null,
    etaMin: etaToDest(base, route),
  });
}

/** 目的地が AIRPORTS にある国内線だけ、現在地からの直線距離と対地速度で残り時間を出す */
function etaToDest(base, route) {
  if (!route || !route.dest || !route.dest.icao) return null;
  if (!base.gsKt || base.gsKt <= 60) return null;
  const dest = findAirport(route.dest.icao);
  if (!dest) return null;
  const distNm = haversineNm(base.lat, base.lon, dest.lat, dest.lon);
  return Math.round(distNm / base.gsKt * 60);
}

function withLabel(p) {
  const { label, short } = positionLabel(p);
  return { ...p, label, short };
}
