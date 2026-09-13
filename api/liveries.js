/**
 * GET /api/liveries?status=approved&airline=ANA&q=ピカチュウ&active=1
 *
 * 承認済みの特別塗装機の一覧。写真は代表写真の URL を含む。
 * このフェーズでは認証を扱わないため、status は approved のみ許可する
 * （pending / rejected の閲覧はフェーズ C の管理画面で Authorization 付きで行う）。
 */
import { listLiveries, isMock } from '../lib/db.js';

export default async function handler(req, res) {
  const q = req.query || {};
  const status = String(q.status || 'approved');
  if (status !== 'approved') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: '承認済み以外の一覧は取得できません' });
  }

  const filter = {
    status: 'approved',
    airline: String(q.airline || '').trim(),
    q: String(q.q || '').trim(),
    activeOnly: q.active === '1' || q.active === 'true',
  };

  try {
    const items = await listLiveries(filter);
    const airlines = [];
    for (const it of items) {
      if (it.airline && !airlines.includes(it.airline)) airlines.push(it.airline);
    }
    airlines.sort((a, b) => a.localeCompare(b));
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({
      mock: isMock(),
      count: items.length,
      airlines,
      filter: { airline: filter.airline || null, q: filter.q || null, activeOnly: filter.activeOnly },
      items,
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: `塗装機データの取得に失敗しました: ${e.message}` });
  }
}
