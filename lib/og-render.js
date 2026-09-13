/**
 * OG 画像（`/api/og`）の組み立て。Edge Function から使うので **fetch しか使わない**
 * （node の API も lib/status.js も読み込まない）。
 *
 * `@vercel/og` はここでは import しない。import するのは api/og.js だけにして、
 * このモジュールは素の Node（`node --test`）でも読めるようにしてある。
 *
 * 日本語について: `@vercel/og` の既定フォントはラテン文字だけなので、そのままでは
 * 日本語が豆腐（□）になる。Google Fonts の CSS API に `text=` を付けて
 * **描画する文字だけの TTF サブセット**（10〜20KB）を取り、リクエストごとに読み込む。
 * 取得したフォントはモジュールスコープにキャッシュするので、暖まった
 * インスタンスでは 2 回目以降は取りに行かない。
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const FONT_FAMILY = 'NotoSansJP';
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&text=';
const FONT_CACHE_MAX = 32;

const fontCache = new Map(); // サブセットの文字列 -> フォント配列

/** satori に渡す要素（JSX を使えないのでプレーンオブジェクトで組む） */
export function h(type, props, ...children) {
  const kids = children.length === 0 ? props && props.children : (children.length === 1 ? children[0] : children);
  return { type, props: { ...props, children: kids } };
}

/**
 * CSS API の応答から TTF の URL を取り出す。
 * 既定の User-Agent では `format('truetype')` が返る（woff2 は satori が読めない）。
 * @param {string} css
 * @returns {string[]} @font-face の並び順（wght@400;700 なので 400, 700 の順）
 */
export function parseFontUrls(css) {
  return [...String(css || '').matchAll(/src:\s*url\((https:[^)]+)\)/g)].map((m) => m[1]);
}

/** 画像に描く文字だけを集める（サブセットの指定に使う。重複は落とす） */
export function subsetText(parts) {
  const chars = new Set();
  for (const s of parts) for (const c of String(s == null ? '' : s)) chars.add(c);
  return [...chars].join('');
}

/**
 * 日本語フォント（描画する文字だけのサブセット）を読み込む。
 * 取得に失敗したら空配列を返す（`@vercel/og` の既定フォントで描画され、
 * 日本語は豆腐になるが画像自体は出る）。
 * @param {string} text 画像に描くすべての文字
 * @param {Function} [fetchImpl]
 * @returns {Promise<Array<{name:string, data:ArrayBuffer, weight:number, style:string}>>}
 */
export async function loadJpFonts(text, fetchImpl = fetch) {
  const key = subsetText([text]);
  if (!key) return [];
  const hit = fontCache.get(key);
  if (hit) return hit;

  try {
    const res = await fetchImpl(FONT_CSS_URL + encodeURIComponent(key));
    if (!res.ok) return [];
    const urls = parseFontUrls(await res.text());
    if (!urls.length) return [];
    const weights = [400, 700];
    const fonts = [];
    for (let i = 0; i < urls.length; i++) {
      const r = await fetchImpl(urls[i]);
      if (!r.ok) continue;
      fonts.push({ name: FONT_FAMILY, data: await r.arrayBuffer(), weight: weights[i] || 400, style: 'normal' });
    }
    if (!fonts.length) return [];
    if (fontCache.size >= FONT_CACHE_MAX) fontCache.clear();
    fontCache.set(key, fonts);
    return fonts;
  } catch (e) {
    return [];
  }
}

/** テストと api/og.js で共有するキャッシュ操作 */
export function clearFontCache() {
  fontCache.clear();
}

/**
 * 1200×630 の要素ツリーと、そこに現れる文字を返す。
 * @param {{name:string, reg:string, airline?:string, type?:string, credit?:string,
 *          photoUrl?:string|null, color?:string|null}} d
 * @returns {{element:Object, text:string}}
 */
export function buildOgElement(d = {}) {
  const name = String(d.name || '特別塗装機');
  const reg = String(d.reg || '');
  const meta = [d.airline, d.type].filter(Boolean).join('　');
  const credit = d.credit ? `📷 ${d.credit}` : '';
  const footer = '空港ウォッチ';
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(d.color || '')) ? d.color : '#fbbf24';
  const photoUrl = typeof d.photoUrl === 'string' && /^https?:\/\//.test(d.photoUrl) ? d.photoUrl : null;

  const layers = [];
  if (photoUrl) {
    layers.push(h('img', {
      src: photoUrl,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      style: { position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px', objectFit: 'cover' },
    }));
    // 文字を読ませるための暗幕（下ほど濃い）
    layers.push(h('div', {
      style: {
        position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px', display: 'flex',
        backgroundImage: 'linear-gradient(180deg, rgba(15,23,42,0.25) 0%, rgba(15,23,42,0.55) 45%, rgba(15,23,42,0.92) 100%)',
      },
    }));
  } else {
    layers.push(h('div', {
      style: {
        position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundImage: 'linear-gradient(135deg, #1e293b 0%, #0f172a 70%)',
        fontSize: 260, color: 'rgba(148,163,184,0.35)',
      },
      children: '✈',
    }));
  }

  const lines = [
    h('div', { style: { display: 'flex', fontSize: 34, fontWeight: 700, color: accent, letterSpacing: '2px' }, children: reg }),
    h('div', { style: { display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.25, color: '#f8fafc' }, children: name }),
  ];
  if (meta) lines.push(h('div', { style: { display: 'flex', fontSize: 34, color: '#cbd5e1', marginTop: '6px' }, children: meta }));

  const bottom = [h('div', { style: { display: 'flex', fontSize: 28, color: '#e2e8f0', fontWeight: 700 }, children: footer })];
  if (credit) bottom.push(h('div', { style: { display: 'flex', fontSize: 26, color: '#cbd5e1' }, children: credit }));

  layers.push(h('div', {
    style: {
      position: 'absolute', left: 0, bottom: 0, width: '1200px',
      display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 64px 48px',
    },
    children: [
      ...lines,
      h('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', width: '1072px', marginTop: '26px' },
        children: bottom,
      }),
    ],
  }));

  // 上辺のアクセント線（塗装の色）
  layers.push(h('div', {
    style: { position: 'absolute', top: 0, left: 0, width: '1200px', height: '10px', display: 'flex', background: accent },
  }));

  const element = h('div', {
    style: {
      position: 'relative', display: 'flex', width: '1200px', height: '630px',
      background: '#0f172a', fontFamily: FONT_FAMILY,
    },
    children: layers,
  });

  return { element, text: subsetText([name, reg, meta, credit, footer, '✈']) };
}

export { FONT_FAMILY };
