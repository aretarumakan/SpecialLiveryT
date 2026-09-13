/**
 * 共通部品（ヘッダ / ナビ / 設定取得 / Supabase クライアント / トースト）
 *
 * 使い方:
 *   <link rel="stylesheet" href="/css/app.css">
 *   <script src="/js/common.js" data-title="特別塗装機" data-nav="/liveries.html"></script>
 *   <script> AW.ready.then(function () { ... }); </script>
 *
 * 公開するもの: window.AW = { config, ready, getSupabase(), toast(msg), esc(s), signedIn() }
 * Supabase が無い環境（モック）では getSupabase() は null を返す。
 * 環境による分岐はこのファイルと lib/db.js の 2 箇所だけに閉じている。
 */
(function () {
  'use strict';

  var SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  var NAV = [
    { href: '/', label: '空港ウォッチ' },
    { href: '/liveries.html', label: '特別塗装' },
    { href: '/submit.html', label: '投稿' },
    { href: '/me.html', label: 'マイページ' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------------------
  // ヘッダ挿入
  // ---------------------------------------------------------------------------

  /** 今のパスに当たるナビ項目を見つける */
  function currentHref() {
    var path = location.pathname.replace(/index\.html$/, '') || '/';
    var best = '/';
    for (var i = 0; i < NAV.length; i++) {
      if (NAV[i].href !== '/' && path.indexOf(NAV[i].href) === 0) best = NAV[i].href;
    }
    return best;
  }

  function buildHeader(title) {
    var on = currentHref();
    var links = NAV.map(function (n) {
      return '<a href="' + n.href + '"' + (n.href === on ? ' class="on"' : '') + '>' + esc(n.label) + '</a>';
    }).join('');
    var el = document.createElement('div');
    el.className = 'aw-head';
    el.innerHTML =
      '<div class="aw-top"><h1 class="aw-title"><a href="/">✈ ' + esc(title || '空港ウォッチ') + '</a></h1>' +
      '<span class="aw-user" id="awUser"></span></div>' +
      '<nav class="aw-nav">' + links + '</nav>';
    return el;
  }

  function mountHeader(title) {
    var slot = document.getElementById('aw-header');
    var el = buildHeader(title);
    if (slot) slot.replaceWith(el);
    else document.body.insertBefore(el, document.body.firstChild);
  }

  // ---------------------------------------------------------------------------
  // トースト
  // ---------------------------------------------------------------------------

  var toastBox = null;
  function toast(msg, ms) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'aw-toast';
      document.body.appendChild(toastBox);
    }
    var item = document.createElement('div');
    item.textContent = String(msg == null ? '' : msg);
    toastBox.appendChild(item);
    setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, ms || 3000);
  }

  // ---------------------------------------------------------------------------
  // 設定と Supabase クライアント
  // ---------------------------------------------------------------------------

  var config = { supabaseUrl: null, supabaseAnonKey: null, mock: true };
  var supabasePromise = null;

  /**
   * Supabase クライアント（遅延読み込み）。モック環境や取得失敗時は null。
   * @returns {Promise<Object|null>}
   */
  function getSupabase() {
    if (config.mock || !config.supabaseUrl || !config.supabaseAnonKey) return Promise.resolve(null);
    if (!supabasePromise) {
      supabasePromise = import(SUPABASE_ESM)
        .then(function (mod) {
          return mod.createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
          });
        })
        .catch(function (e) {
          console.error('supabase-js の読み込みに失敗しました', e);
          return null;
        });
    }
    return supabasePromise;
  }

  /** ログイン中のユーザー（未ログイン・モックなら null） */
  function signedIn() {
    return getSupabase().then(function (sb) {
      if (!sb) return null;
      return sb.auth.getUser().then(function (r) { return (r && r.data && r.data.user) || null; }, function () { return null; });
    });
  }

  function showUser() {
    var slot = document.getElementById('awUser');
    if (!slot) return;
    if (config.mock) { slot.textContent = 'モード: モック'; return; }
    signedIn().then(function (user) {
      if (!user) { slot.innerHTML = '<a href="/login.html?next=' + encodeURIComponent(location.pathname) + '">ログイン</a>'; return; }
      var meta = user.user_metadata || {};
      slot.textContent = meta.full_name || meta.name || (user.email || '').split('@')[0] || 'ログイン中';
    });
  }

  // ---------------------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------------------

  var script = document.currentScript;
  var title = (script && script.dataset && script.dataset.title) || '空港ウォッチ';

  var ready = fetch('/api/config', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (c) { config = { supabaseUrl: c.supabaseUrl || null, supabaseAnonKey: c.supabaseAnonKey || null, mock: c.mock !== false }; })
    .catch(function (e) { console.warn('/api/config の取得に失敗しました', e); })
    .then(function () {
      window.AW.config = config;
      showUser();
      return config;
    });

  function start() {
    mountHeader(title);
    showUser();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.AW = { config: config, ready: ready, getSupabase: getSupabase, signedIn: signedIn, toast: toast, esc: esc };
})();
