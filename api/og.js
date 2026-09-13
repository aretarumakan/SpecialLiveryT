/**
 * GET /api/og?reg=JA819A — SNS カードの画像（1200×630 PNG）。
 *
 * Edge Function。`@vercel/og`（satori + resvg の wasm）は Edge Runtime 前提なので
 * ここでは **Node の API を使うモジュールを読み込まない**（lib/status.js は不可）。
 * lib/db.js は fetch だけで Supabase を読むので Edge でも動く。
 *
 * ローカルの test/dev-server.js は Edge Runtime を持たないため、このファイルは実行されず
 * 代わりにプレースホルダの SVG が返る（README「OG 画像」参照）。
 */
import { ImageResponse } from '@vercel/og';
import { getLiveryPageData } from '../lib/db.js';
import { buildOgElement, loadJpFonts, OG_WIDTH, OG_HEIGHT } from '../lib/og-render.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const reg = (new URL(req.url).searchParams.get('reg') || '').trim().toUpperCase();

  let data = null;
  try {
    if (reg) data = await getLiveryPageData(reg);
  } catch (e) {
    data = null; // 登録記号の形式不正・DB 障害。下の既定の絵で返す
  }

  const livery = data && data.liveries.length ? data.liveries[0] : null;
  const photo = data && data.photos.length ? data.photos[0] : null;
  const { element, text } = buildOgElement({
    name: livery ? livery.name : '特別塗装機',
    reg: reg || '',
    airline: livery ? livery.airline : '',
    type: livery ? livery.type : '',
    credit: photo ? photo.credit : (livery && livery.credit) || '',
    photoUrl: photo ? photo.url : (livery && livery.photoUrl) || null,
    color: livery ? livery.color : null,
  });

  const fonts = await loadJpFonts(text);
  return new ImageResponse(element, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts.length ? fonts : undefined,
    headers: {
      // 画像は塗装が承認・差し替えられるまで変わらない。エッジで 1 時間持たせる
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
