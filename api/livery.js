/**
 * GET /api/livery?reg=JA819A
 *
 * 共有ページ `/livery/:reg` のためのデータ。
 *   liveries … その登録記号の承認済み塗装機（運航中が先頭。複数あればタブになる）
 *   photos   … 承認済み写真（代表写真が先頭。撮影者名・SNS・撮影日・空港・説明つき）
 *   position … 現在地（lib/position.js が adsb.lol に 1 機だけ問い合わせる。20 秒キャッシュ）
 *
 * 共有ページは 30 秒ごとにこれを叩くので、`s-maxage=20` でエッジにも共有させる。
 */
import { getLiveryPageData } from '../lib/db.js';
import { getCurrentPosition } from '../lib/position.js';
import { findAirport } from '../lib/airports.js';

export default async function handler(req, res) {
  const reg = String((req.query && req.query.reg) || '').trim().toUpperCase();
  if (!reg) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: '登録記号（reg）を指定してください' });
  }

  let data;
  try {
    data = await getLiveryPageData(reg);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(e.status === 400 ? 400 : 502).json({ error: e.message });
  }
  if (!data.liveries.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: `承認済みの塗装機が見つかりません: ${reg}` });
  }

  // 現在地の取得に失敗しても塗装機の情報は返す（position.state = 'unknown'）
  const position = await getCurrentPosition(reg);

  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=10');
  return res.status(200).json({
    reg: data.reg,
    liveries: data.liveries,
    photos: data.photos.map((p) => ({ ...p, airportName: airportName(p.airport) })),
    position,
  });
}

/** 撮影空港の ICAO → 表示名（AIRPORTS に無ければ null） */
function airportName(icao) {
  if (!icao) return null;
  const a = findAirport(String(icao).toUpperCase());
  return a ? a.name : null;
}
