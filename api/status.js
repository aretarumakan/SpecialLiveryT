/**
 * GET /api/status?icao=RJTT
 * 指定空港の「空港にいる / 到着予定 / 出発 / 周辺の特別塗装機」を返す。
 * s-maxage=20 で Vercel のエッジがレスポンスを共有するため、利用者が増えても外部 API の呼び出しは空港ごとに 20 秒に 1 回程度に収まる。
 */
import { getAirportStatus } from '../lib/status.js';
import { AIRPORTS } from '../lib/airports.js';

export default async function handler(req, res) {
  const icao = String(req.query.icao || '').toUpperCase();
  if (!icao) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(200).json({ airports: AIRPORTS.map((a) => ({ icao: a.icao, iata: a.iata, name: a.name })) });
  }
  const result = await getAirportStatus(icao);
  if (result.error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(result.airport ? 502 : 400).json(result);
  }
  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=10');
  return res.status(200).json(result);
}
