/**
 * GET /api/og?reg=JA819A — SNS カードの画像（1200×630 PNG）。
 *
 * Node.js Serverless Function。`@vercel/og` 1.x は Node ランタイム用のビルド（dist/index.node.js）を持ち、
 * Edge ビルドは `module` を import していて Vercel の Edge Runtime にデプロイできない（2026-09 時点）ため
 * Node で動かす。ローカルの test/dev-server.js でもそのまま実行できる。
 */
import { ImageResponse } from '@vercel/og';
import { getLiveryPageData } from '../lib/db.js';
import { buildOgElement, loadJpFonts, OG_WIDTH, OG_HEIGHT } from '../lib/og-render.js';

export default async function handler(req, res) {
  const reg = String((req.query && req.query.reg) || '').trim().toUpperCase();

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
  const image = new ImageResponse(element, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts.length ? fonts : undefined,
  });
  const png = Buffer.from(await image.arrayBuffer());
  res.setHeader('Content-Type', 'image/png');
  // 画像は塗装が承認・差し替えられるまで変わらない。エッジで 1 時間持たせる
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(png);
}
