/**
 * /submit.html の処理（塗装の登録・写真の投稿）
 *
 * <script type="module" src="/js/upload.js"></script> で読み込む（common.js は先に classic で読む）。
 *
 * やること
 *  1. 2 モードの切り替え（(a) 新しい塗装を登録 / (b) 既存の塗装に写真を追加）
 *  2. 登録記号の検証・既存塗装の照会（/api/liveries?q=）・adsbdb での機種/航空会社の自動入力
 *  3. 写真を Canvas で長辺 1600px（q0.85）と 320px（q0.8）に縮小し、2 枚 upload
 *  4. 両方の upload が成功してから photos を insert（途中で失敗したら upload 済みを消す）
 *
 * モックモード（Supabase 未接続）では public/js/mockdb.js に同じ流れで書き込む。
 * 環境の分岐は `AW.config.mock` の 1 箇所だけに寄せている。
 */
import {
  validateLiveryForm, validatePhotoForm, normalizeReg, isValidReg, storagePaths, MAX_NOTE,
} from './validate.js';

const BUCKET = 'livery-photos';
const MAIN_EDGE = 1600;
const MAIN_Q = 0.85;
const THUMB_EDGE = 320;
const THUMB_Q = 0.8;
const MAX_BYTES = 3 * 1024 * 1024;      // 0002_storage.sql の file_size_limit と同じ
const ADSBDB = 'https://api.adsbdb.com/v0/aircraft/';

/** adsbdb の icao_type → 画面の機種表記（lib/liveries.js の表記に寄せる） */
const TYPE_LABEL = {
  B788: 'B787-8', B789: 'B787-9', B78X: 'B787-10', B738: 'B737-800', B37M: 'B737-8',
  B763: 'B767-300', B772: 'B777-200', B773: 'B777-300', B77W: 'B777-300ER', B748: 'B747-8',
  A318: 'A318', A319: 'A319', A320: 'A320', A20N: 'A320neo', A321: 'A321', A21N: 'A321neo',
  A332: 'A330-200', A333: 'A330-300', A359: 'A350-900', A35K: 'A350-1000',
  E170: 'E170', E190: 'E190', E75L: 'E175', CRJ7: 'CRJ700', DH8D: 'Q400', AT76: 'ATR72',
};

const $ = (id) => document.getElementById(id);
const qs = (el, sel) => el.querySelector(sel);

let session = null;
let isMock = true;
let mockdb = null;
let airports = [];
let selectedLivery = null;   // モード (b) で選んだ塗装 {id, reg, name}
const files = { n: null, p: null };   // 選択中の File（プレフィックスごと）

// ---------------------------------------------------------------------------
// 画像処理
// ---------------------------------------------------------------------------

/**
 * File を描画できるもの（ImageBitmap か HTMLImageElement）にする。
 * EXIF の向きを尊重する（createImageBitmap の imageOrientation。古い環境は <img> にフォールバック）。
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 次を試す */ }
    try { return await createImageBitmap(file); } catch { /* 次を試す */ }
  }
  // <img> は多くのブラウザで EXIF の向きを自動適用する（image-orientation: from-image が既定）
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

function sizeOf(src) {
  return { w: src.width || src.naturalWidth, h: src.height || src.naturalHeight };
}

/** 長辺 maxEdge に収まる JPEG の Blob を作る（3MB を超えたら品質を落として作り直す） */
async function toJpeg(src, maxEdge, quality) {
  const { w: w0, h: h0 } = sizeOf(src);
  if (!w0 || !h0) throw new Error('画像のサイズが取得できませんでした');
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';            // JPEG は透明を扱えないので黒で埋める
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);

  let q = quality;
  for (let i = 0; i < 4; i++) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (!blob) throw new Error('画像の変換に失敗しました');
    if (blob.size <= MAX_BYTES) return blob;
    q = Math.max(0.5, q - 0.12);
  }
  throw new Error('画像が大きすぎます（3MB 以下に収まりませんでした）');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    fr.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// 保存（本物 / モック）
// ---------------------------------------------------------------------------

async function sb() {
  const client = await AW.getSupabase();
  if (!client) throw new Error('Supabase に接続できません（環境変数が未設定です）');
  return client;
}

/** liveries に 1 行入れる。RLS が通る形（created_by = 自分・status = pending）で送る */
async function insertLivery(row) {
  if (isMock) return mockdb.insertLivery(row, session.user.id);
  const client = await sb();
  const { data, error } = await client
    .from('liveries')
    .insert({ ...row, status: 'pending', created_by: session.user.id })
    .select('id,reg,name,status')
    .single();
  if (error) {
    if (String(error.code) === '23505') throw new Error('同じ機体に同じ塗装名が既に登録されています。写真の追加をお使いください。');
    throw new Error(error.message || '塗装の登録に失敗しました');
  }
  return data;
}

/**
 * 写真 2 枚を upload してから photos を insert する。
 * @param {Object} photoRow validatePhotoForm が作った行
 * @param {Object} livery {id, reg, name}
 * @param {{main:Blob, thumb:Blob, thumbDataUrl:string}} images
 */
async function insertPhoto(photoRow, livery, images) {
  const uuid = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  const { path, thumbPath } = storagePaths(session.user.id, uuid);
  const row = { ...photoRow, storage_path: path, thumb_path: thumbPath };

  if (isMock) {
    // モックの「アップロード」: 本体はメモリ、サムネイルは localStorage に data URL で置く
    mockdb.putImage(path, URL.createObjectURL(images.main));
    mockdb.putImage(thumbPath, images.thumbDataUrl, { thumb: true });
    return mockdb.insertPhoto(row, {
      userId: session.user.id,
      creditName: session.user.displayName,
      livery,
    });
  }

  const client = await sb();
  const store = client.storage.from(BUCKET);
  const opts = { contentType: 'image/jpeg', upsert: false };

  const up1 = await store.upload(path, images.main, opts);
  if (up1.error) throw new Error('写真のアップロードに失敗しました: ' + up1.error.message);
  const up2 = await store.upload(thumbPath, images.thumb, opts);
  if (up2.error) {
    await store.remove([path]).catch(() => {});
    throw new Error('サムネイルのアップロードに失敗しました: ' + up2.error.message);
  }

  const { data, error } = await client
    .from('photos')
    .insert({
      ...row,
      livery_id: livery.id,
      user_id: session.user.id,
      credit_name: session.user.displayName,   // 投稿時点の表示名で固定する
      status: 'pending',
      is_primary: false,
    })
    .select('id,livery_id,status,storage_path,thumb_path')
    .single();
  if (error) {
    // 行が作れなかった画像は残さない（失敗時の後始末。定期清掃は管理者タスク）
    await store.remove([path, thumbPath]).catch(() => {});
    throw new Error('写真の登録に失敗しました: ' + error.message);
  }
  return data;
}

/**
 * insert した写真を公開処理に回す（設定 `auto_approve_photos` が ON なら承認される）。
 *
 * クライアントの insert は RLS の都合で必ず `status='pending'` なので、
 * 自動承認はサーバー（`POST /api/photos` の finalize）だけが行える。
 * ここが失敗しても投稿自体は成立している（承認待ちとして管理者に見える）ので、
 * 例外にはせず 'pending' を返す。
 *
 * @param {Object} photo insertPhoto の戻り（id を持つ）
 * @returns {Promise<'approved'|'pending'>}
 */
async function finalizePhoto(photo) {
  const id = photo && photo.id;
  if (!id) return 'pending';
  try {
    if (isMock) return mockdb.finalizePhoto(id, AW.config.autoApprovePhotos === true);
    const headers = AW.authHeaders(session);
    headers['Content-Type'] = 'application/json';
    const res = await fetch('/api/photos', {
      method: 'POST', headers, cache: 'no-store',
      body: JSON.stringify({ op: 'finalize', photoId: id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body.status === 'approved' ? 'approved' : 'pending';
  } catch (e) {
    console.warn('写真の公開処理に失敗しました（承認待ちとして残ります）', e);
    return 'pending';
  }
}

// ---------------------------------------------------------------------------
// 既存塗装の照会と adsbdb
// ---------------------------------------------------------------------------

/** /api/liveries?q= で承認済みを探し、登録記号が一致するものだけ返す */
async function findApproved(reg) {
  const key = normalizeReg(reg);
  if (!key) return [];
  const res = await fetch('/api/liveries?q=' + encodeURIComponent(key), { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || ('HTTP ' + res.status));
  return (body.items || []).filter((it) => normalizeReg(it.reg) === key);
}

/** adsbdb で機体を引く（見つからなければ null。失敗しても投稿は続行できる） */
async function lookupAircraft(reg) {
  const key = normalizeReg(reg);
  if (!isValidReg(key)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(ADSBDB + encodeURIComponent(key), { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const a = body && body.response && body.response.aircraft;
    if (!a) return null;
    const icaoType = String(a.icao_type || '').toUpperCase();
    return {
      hex: a.mode_s ? String(a.mode_s).toLowerCase() : null,
      airline: a.registered_owner_operator_flag_code || a.registered_owner || null,
      type: TYPE_LABEL[icaoType] || icaoType || [a.manufacturer, a.type].filter(Boolean).join(' ') || null,
      owner: a.registered_owner || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

function showErrors(section, errors) {
  for (const el of section.querySelectorAll('[data-e]')) {
    const key = el.dataset.e;
    const msg = errors[key];
    el.hidden = !msg;
    el.textContent = msg || '';
    const input = section.querySelector('[name="' + key + '"]');
    if (input) input.classList.toggle('bad', !!msg);
  }
}

function fatal(section, msg) {
  const box = qs(section, '.err');
  if (!box) { AW.toast(msg); return; }
  box.textContent = msg;
  box.hidden = false;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function clearFatal(section) {
  const box = qs(section, '.err');
  if (box) box.hidden = true;
}

function setMode(mode) {
  $('secNew').hidden = mode !== 'new';
  $('secPhoto').hidden = mode !== 'photo';
  $('tabNew').classList.toggle('on', mode === 'new');
  $('tabPhoto').classList.toggle('on', mode === 'photo');
  history.replaceState(null, '', location.pathname + location.search);
}

function fillAirportSelects() {
  const opts = ['<option value="">（選択しない）</option>'].concat(
    airports.map((a) => '<option value="' + AW.esc(a.icao) + '">'
      + AW.esc(a.name + '（' + a.iata + '）') + '</option>')
  ).join('');
  for (const sel of document.querySelectorAll('select[name="airport_icao"]')) sel.innerHTML = opts;
}

async function loadAirports() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const body = await res.json();
    airports = body.airports || [];
  } catch {
    airports = [];
  }
  fillAirportSelects();
}

/** 写真の選択 → プレビュー（プレフィックス n = 新規登録に同時投稿 / p = 既存に追加） */
function wireFileInput(prefix) {
  const input = document.querySelector('#sec' + (prefix === 'n' ? 'New' : 'Photo') + ' input[type=file]');
  const prev = $(prefix + 'Preview');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    files[prefix] = file || null;
    prev.innerHTML = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      prev.innerHTML = '<span class="bad">画像ファイルを選んでください</span>';
      files[prefix] = null;
      return;
    }
    prev.innerHTML = '<span class="s">縮小中…</span>';
    try {
      const src = await decodeImage(file);
      const thumb = await toJpeg(src, THUMB_EDGE, THUMB_Q);
      const url = URL.createObjectURL(thumb);
      const { w, h } = sizeOf(src);
      prev.innerHTML = '<img src="' + url + '" alt="プレビュー">'
        + '<span class="s">' + w + '×' + h + ' → 長辺 ' + MAIN_EDGE + 'px に縮小して投稿します</span>';
    } catch (e) {
      prev.innerHTML = '<span class="bad">' + AW.esc(e.message) + '</span>';
    }
  });
}

/** 登録記号の blur: 既存塗装の照会と adsbdb の自動入力 */
function wireRegLookup() {
  const input = document.querySelector('#secNew input[name="reg"]');
  const info = $('regInfo');
  let last = '';

  const run = async () => {
    const reg = normalizeReg(input.value);
    input.value = reg;
    if (!reg || reg === last) return;
    last = reg;
    info.innerHTML = '';
    if (!isValidReg(reg)) return;

    info.innerHTML = '<div class="s">照会中…</div>';
    const [existing, ac] = await Promise.all([
      findApproved(reg).catch(() => []),
      lookupAircraft(reg),
    ]);

    let html = '';
    if (existing.length) {
      html += '<div class="note">この機体には既に '
        + existing.map((it) => '「' + AW.esc(it.name) + '」').join('、')
        + ' が登録されています。同じ塗装なら写真の追加をお使いください。</div>'
        + '<div class="actions">' + existing.map((it) =>
          '<button type="button" class="aw-btn gold" data-pick="' + it.id + '">'
          + 'この塗装に写真を追加: ' + AW.esc(it.name) + '</button>').join('') + '</div>';
    }
    if (ac) {
      html += '<div class="s">adsbdb: ' + AW.esc([ac.owner, ac.type].filter(Boolean).join(' / ') || '情報なし') + '</div>';
      const airlineEl = document.querySelector('#secNew input[name="airline"]');
      const typeEl = document.querySelector('#secNew input[name="aircraft_type"]');
      if (ac.airline && !airlineEl.value) airlineEl.value = ac.airline;
      if (ac.type && !typeEl.value) typeEl.value = ac.type;
    } else {
      html += '<div class="s">adsbdb に該当がありませんでした（登録記号の確認をおすすめします）。そのまま投稿できます。</div>';
    }
    info.innerHTML = html;

    for (const btn of info.querySelectorAll('[data-pick]')) {
      btn.addEventListener('click', () => {
        const it = existing.find((x) => String(x.id) === btn.dataset.pick);
        if (it) choosePhotoTarget(it);
      });
    }
  };

  input.addEventListener('blur', run);
  input.addEventListener('change', run);
}

// ---------------------------------------------------------------------------
// モード (b) 既存の塗装に写真を追加
// ---------------------------------------------------------------------------

function renderSearchResults(items) {
  const box = $('pResults');
  if (!items.length) {
    box.innerHTML = '<div class="s">該当する承認済みの塗装がありません。'
      + '<a href="#" id="toNew">新しい塗装として登録する</a></div>';
    const a = $('toNew');
    if (a) a.addEventListener('click', (e) => { e.preventDefault(); setMode('new'); });
    return;
  }
  box.innerHTML = '<div class="plist">' + items.map((it) =>
    '<div class="prow">'
    + (it.thumbUrl ? '<img src="' + AW.esc(it.thumbUrl) + '" alt="">' : '<div class="ph">✈</div>')
    + '<div class="t">' + AW.esc(it.name) + '</div>'
    + '<div class="s">' + AW.esc(it.reg) + '　' + AW.esc([it.airline, it.type].filter(Boolean).join('・')) + '</div>'
    + '<div class="act"><button type="button" class="aw-btn primary" data-id="' + it.id + '">この塗装を選ぶ</button></div>'
    + '</div>').join('') + '</div>';
  for (const btn of box.querySelectorAll('[data-id]')) {
    btn.addEventListener('click', () => {
      const it = items.find((x) => String(x.id) === btn.dataset.id);
      if (it) choosePhotoTarget(it);
    });
  }
}

function choosePhotoTarget(item) {
  selectedLivery = { id: item.id, reg: normalizeReg(item.reg), name: item.name, status: 'approved' };
  $('pSelected').innerHTML = '<div class="note">写真を追加する塗装: <b>' + AW.esc(item.name) + '</b>（'
    + AW.esc(selectedLivery.reg) + '）</div>';
  $('pResults').innerHTML = '';
  $('pSearch').value = selectedLivery.reg;
  setMode('photo');
  $('pSelected').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function runSearch() {
  const box = $('pResults');
  const q = $('pSearch').value.trim();
  if (!q) { box.innerHTML = '<div class="s">登録記号か塗装名を入れてください。</div>'; return; }
  box.innerHTML = '<div class="s">検索中…</div>';
  try {
    const res = await fetch('/api/liveries?q=' + encodeURIComponent(q), { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || ('HTTP ' + res.status));
    renderSearchResults(body.items || []);
  } catch (e) {
    box.innerHTML = '<div class="bad">検索に失敗しました: ' + AW.esc(e.message) + '</div>';
  }
}

// ---------------------------------------------------------------------------
// 送信
// ---------------------------------------------------------------------------

function readFields(section) {
  const out = {};
  for (const el of section.querySelectorAll('[name]')) {
    if (el.type === 'file') continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

/** 選択済みの File から 2 枚の JPEG を作る */
async function buildImages(file) {
  const src = await decodeImage(file);
  const main = await toJpeg(src, MAIN_EDGE, MAIN_Q);
  const thumb = await toJpeg(src, THUMB_EDGE, THUMB_Q);
  const thumbDataUrl = isMock ? await blobToDataUrl(thumb) : '';
  return { main, thumb, thumbDataUrl };
}

function done(message, extra) {
  $('secNew').hidden = true;
  $('secPhoto').hidden = true;
  $('tabs').hidden = true;
  $('doneMsg').textContent = message;
  $('doneExtra').textContent = extra || '';
  $('secDone').hidden = false;
  window.scrollTo(0, 0);
}

async function submitNew() {
  const section = $('secNew');
  clearFatal(section);
  const raw = readFields(section);
  const useColor = raw.color_use === true;
  const live = validateLiveryForm({ ...raw, color: useColor ? raw.color : '' });
  const hasFile = !!files.n;
  const photo = validatePhotoForm(raw, { requirePhoto: false, hasFile });
  showErrors(section, { ...live.errors, ...photo.errors });
  if (!live.ok || !photo.ok) { fatal(section, '入力を確認してください。'); return; }

  const btn = $('btnNewSubmit');
  btn.disabled = true;
  btn.textContent = '送信中…';
  try {
    let images = null;
    if (hasFile) images = await buildImages(files.n);   // 画像の失敗で行を作らないよう先に作る
    const livery = await insertLivery(live.row);
    let photoOk = true;
    let photoStatus = null;
    if (images) {
      try {
        const saved = await insertPhoto(photo.row, { id: livery.id, reg: live.row.reg, name: live.row.name }, images);
        photoStatus = await finalizePhoto(saved);
      } catch (e) {
        photoOk = false;
        AW.toast('塗装は登録できましたが写真の投稿に失敗しました: ' + e.message);
      }
    }
    // 塗装そのものは必ず管理者の承認待ち（自動承認は写真だけ）
    done('承認待ちです', photoOk
      ? '「' + live.row.name + '」（' + live.row.reg + '）を受け付けました。管理者の承認後に一覧とスペマウォッチに出ます。'
        + (photoStatus === 'approved' ? '写真は公開済みで、塗装が承認されると一緒に表示されます。' : '')
      : '塗装の登録だけ受け付けました。写真はマイページから投稿し直してください。');
  } catch (e) {
    fatal(section, e.message || String(e));
    btn.disabled = false;
    btn.textContent = 'この内容で投稿する';
  }
}

async function submitPhoto() {
  const section = $('secPhoto');
  clearFatal(section);
  if (!selectedLivery) { fatal(section, '写真を追加する塗装を選んでください。'); return; }
  const raw = readFields(section);
  const hasFile = !!files.p;
  const photo = validatePhotoForm(raw, { requirePhoto: true, hasFile });
  showErrors(section, photo.errors);
  if (!photo.ok) { fatal(section, '入力を確認してください。'); return; }

  const btn = $('btnPhotoSubmit');
  btn.disabled = true;
  btn.textContent = '送信中…';
  try {
    const images = await buildImages(files.p);
    const saved = await insertPhoto(photo.row, selectedLivery, images);
    const status = await finalizePhoto(saved);
    if (status === 'approved') {
      done('公開されました', '「' + selectedLivery.name + '」（' + selectedLivery.reg
        + '）への写真を公開しました。その塗装にまだ代表写真が無ければ、この写真が代表写真になります。'
        + '（不適切な写真は通報で取り下げられます）');
    } else {
      done('承認待ちです', '「' + selectedLivery.name + '」（' + selectedLivery.reg
        + '）への写真を受け付けました。承認されると代表写真に選ばれることがあります。');
    }
  } catch (e) {
    fatal(section, e.message || String(e));
    btn.disabled = false;
    btn.textContent = 'この写真を投稿する';
  }
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

async function start() {
  await AW.ready;
  isMock = AW.config.mock === true;
  if (isMock) mockdb = await import('./mockdb.js');

  session = await AW.requireLogin('/submit.html' + location.search);
  if (!session) return;            // /login.html に飛んだ

  $('gate').hidden = true;
  $('app').hidden = false;
  $('credit').textContent = session.user.displayName;

  for (const el of document.querySelectorAll('[data-maxlen]')) el.maxLength = MAX_NOTE;

  $('tabNew').addEventListener('click', () => setMode('new'));
  $('tabPhoto').addEventListener('click', () => setMode('photo'));
  $('btnPSearch').addEventListener('click', runSearch);
  $('pSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  $('btnNewSubmit').addEventListener('click', submitNew);
  $('btnPhotoSubmit').addEventListener('click', submitPhoto);
  wireFileInput('n');
  wireFileInput('p');
  wireRegLookup();

  // アクセント色はチェックを入れたときだけ送る
  const colorUse = document.querySelector('#secNew input[name="color_use"]');
  const colorInput = document.querySelector('#secNew input[name="color"]');
  const syncColor = () => { colorInput.disabled = !colorUse.checked; };
  colorUse.addEventListener('change', syncColor);
  syncColor();

  await loadAirports();

  // ?reg=XXXX … 承認済みの塗装があればモード (b)、無ければモード (a) に前入力
  const params = new URLSearchParams(location.search);
  const reg = normalizeReg(params.get('reg') || '');
  // ?mode=fix … 共有ページの「情報の修正を提案」からの導線。案内だけ出して登録モードにする
  const fixMode = params.get('mode') === 'fix';
  if (fixMode) {
    const note = $('fixNote');
    if (note) note.hidden = false;
  }
  if (fixMode && reg) {
    document.querySelector('#secNew input[name="reg"]').value = reg;
    $('pSearch').value = reg;
    setMode('new');
  } else if (reg) {
    document.querySelector('#secNew input[name="reg"]').value = reg;
    $('pSearch').value = reg;
    const found = await findApproved(reg).catch(() => []);
    if (found.length === 1) choosePhotoTarget(found[0]);
    else if (found.length > 1) { setMode('photo'); renderSearchResults(found); }
    else setMode('new');
  } else {
    setMode('new');
  }
}

start().catch((e) => {
  const box = $('bootErr');
  if (box) { box.textContent = '初期化に失敗しました: ' + (e && e.message ? e.message : e); box.hidden = false; }
});
