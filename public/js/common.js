/**
 * 共通部品（ヘッダ / ナビ / 設定取得 / Supabase クライアント / トースト）
 *
 * 使い方:
 *   <link rel="stylesheet" href="/css/app.css">
 *   <script src="/js/common.js" data-title="特別塗装機" data-nav="/liveries.html"></script>
 *   <script> AW.ready.then(function () { ... }); </script>
 *
 * 公開するもの: window.AW = { config, ready, getSupabase(), toast(msg), esc(s), signedIn(),
 *                             getSession(), requireLogin(), signOut(), authHeaders(), report() }
 * Supabase が無い環境（モック）では getSupabase() は null を返す。
 * 環境による分岐はこのファイルと lib/db.js の 2 箇所だけに閉じている。
 */
(function () {
  'use strict';

  var SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  var NAV = [
    { href: '/', label: '空港' },
    { href: '/liveries.html', label: '特別塗装機' },
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
    // 共有ページ /livery/:reg は一覧（特別塗装機）の下位ページとして扱う
    if (path.indexOf('/livery/') === 0) return '/liveries.html';
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
      '<div class="aw-top"><h1 class="aw-title"><a href="/">✈ ' + esc(title || 'スペマウォッチ') + '</a></h1>' +
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

  var config = { supabaseUrl: null, supabaseAnonKey: null, googleClientId: null, mock: true, autoApprovePhotos: true };
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

  /** ログイン中のユーザー（未ログイン・モックなら null）。supabase の生の user を返す */
  function signedIn() {
    return getSupabase().then(function (sb) {
      if (!sb) return null;
      return sb.auth.getUser().then(function (r) { return (r && r.data && r.data.user) || null; }, function () { return null; });
    });
  }

  // ---------------------------------------------------------------------------
  // セッション（モックと本物で同じ形）
  // ---------------------------------------------------------------------------

  /** モックストア（モックモードのときだけ読み込む） */
  function getMockDb() {
    if (!mockDbPromise) mockDbPromise = import('/js/mockdb.js');
    return mockDbPromise;
  }
  var mockDbPromise = null;

  /**
   * profiles の行を取り、無ければ作る。
   * 0001_init.sql の handle_new_user() が通常は作るが、
   * トリガー導入前のユーザーのために保険を入れている（RLS: id = auth.uid() で insert 可）。
   */
  function ensureProfile(sb, user) {
    return sb.from('profiles').select('id,display_name,sns_url,role').eq('id', user.id).maybeSingle()
      .then(function (r) {
        if (r.error) throw r.error;
        if (r.data) return r.data;
        var meta = user.user_metadata || {};
        var name = meta.full_name || meta.name || (user.email || '').split('@')[0] || 'ユーザー';
        return sb.from('profiles').insert({ id: user.id, display_name: name })
          .select('id,display_name,sns_url,role').single()
          .then(function (ins) {
            if (ins.error) throw ins.error;
            return ins.data;
          });
      });
  }

  /**
   * 画面が使うセッション。モックでも本物でも同じ形を返す。
   * @returns {Promise<{user:{id,email,displayName,snsUrl,role}, accessToken:string, mock:boolean}|null>}
   */
  function getSession() {
    return ready.then(function () {
      if (config.mock) {
        return getMockDb().then(function (m) { return m.getSession(); });
      }
      return getSupabase().then(function (sb) {
        if (!sb) return null;
        return sb.auth.getSession().then(function (r) {
          var s = r && r.data && r.data.session;
          if (!s || !s.user) return null;
          return ensureProfile(sb, s.user).then(function (p) {
            return {
              user: {
                id: s.user.id,
                email: s.user.email || null,
                displayName: (p && p.display_name) || '',
                snsUrl: (p && p.sns_url) || null,
                role: (p && p.role) || 'user'
              },
              accessToken: s.access_token,
              mock: false
            };
          });
        });
      }).catch(function (e) {
        console.warn('セッションの取得に失敗しました', e);
        return null;
      });
    });
  }

  /**
   * ログインを要求する。未ログインなら /login.html?next=... に飛ばして null を返す。
   * @param {string} [next] 戻り先（既定: 今のパス + クエリ）
   */
  function requireLogin(next) {
    return getSession().then(function (session) {
      if (session) return session;
      var back = next || (location.pathname + location.search);
      location.replace('/login.html?next=' + encodeURIComponent(back));
      return null;
    });
  }

  /** ログアウト（モックは localStorage のユーザーを消すだけ） */
  function signOut() {
    return ready.then(function () {
      if (config.mock) return getMockDb().then(function (m) { m.signOut(); });
      return getSupabase().then(function (sb) { return sb ? sb.auth.signOut() : null; });
    });
  }

  // ---------------------------------------------------------------------------
  // 管理者向け（ナビの「管理」リンクと承認待ちバッジ）
  // ---------------------------------------------------------------------------

  /**
   * API に添える Authorization ヘッダ。
   * モックのトークンは `mock-<id>` で、lib/auth.js が `mock:` と `mock-` の両方を受ける。
   */
  function authHeaders(session) {
    if (!session || !session.accessToken) return {};
    return { Authorization: 'Bearer ' + session.accessToken };
  }

  /** admin だけに「管理」リンクを出し、承認待ち件数をバッジで添える */
  function showAdminNav(session) {
    if (!session || session.user.role !== 'admin') return;
    var nav = document.querySelector('.aw-nav');
    if (!nav || document.getElementById('awAdminLink')) return;
    var a = document.createElement('a');
    a.id = 'awAdminLink';
    a.href = '/admin.html';
    a.innerHTML = '管理<span class="badge" id="awAdminBadge" hidden>0</span>';
    if (location.pathname.indexOf('/admin.html') === 0) a.className = 'on';
    nav.appendChild(a);

    fetch('/api/admin/pending', { headers: authHeaders(session), cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        var c = body && body.counts;
        if (!c) return;
        var n = (c.total || 0) + (c.reports || 0);
        var badge = document.getElementById('awAdminBadge');
        if (!badge) return;
        badge.textContent = String(n);
        badge.hidden = n === 0;
        if (n > 0) badge.className = 'badge gold';
      })
      .catch(function () { /* バッジは出なくても困らない */ });
  }

  /**
   * 通報（設計書 §5-4。写真は未解決 3 件で自動的に承認待ちへ戻る）。
   * @param {'livery'|'photo'} type
   * @param {number|string} id
   * @returns {Promise<Object|null>} 送れたら API の応答、やめたら null
   */
  function report(type, id) {
    return getSession().then(function (session) {
      if (!session) {
        location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
        return null;
      }
      var reason = window.prompt('通報の理由を書いてください（500 字以内）。\n内容は管理者だけが読みます。');
      if (reason === null) return null;
      reason = String(reason).trim();
      if (!reason) { toast('理由を入れてください'); return null; }
      var headers = authHeaders(session);
      headers['Content-Type'] = 'application/json';
      return fetch('/api/report', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ targetType: type, targetId: id, reason: reason })
      }).then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, body: body }; });
      }).then(function (r) {
        if (!r.ok) throw new Error((r.body && r.body.error) || '通報に失敗しました');
        toast(r.body.hidden ? '通報しました（通報が重なったため非表示にしました）' : '通報しました。ありがとうございます');
        return r.body;
      }).catch(function (e) {
        toast('通報に失敗しました: ' + (e && e.message ? e.message : e));
        return null;
      });
    });
  }

  function showUser() {
    var slot = document.getElementById('awUser');
    if (!slot) return;
    getSession().then(function (session) {
      var tag = config.mock ? 'モック' : '';
      showAdminNav(session);
      if (!session) {
        slot.innerHTML = (tag ? '<span class="aw-mode">' + tag + '</span> ' : '')
          + '<a href="/login.html?next=' + encodeURIComponent(location.pathname + location.search) + '">ログイン</a>';
        return;
      }
      slot.innerHTML = (tag ? '<span class="aw-mode">' + tag + '</span> ' : '')
        + '<a href="/me.html">' + esc(session.user.displayName || 'マイページ') + '</a>'
        + ' <a href="#" id="awLogout">ログアウト</a>';
      var out = document.getElementById('awLogout');
      if (out) {
        out.addEventListener('click', function (ev) {
          ev.preventDefault();
          signOut().then(function () { location.href = '/'; });
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------------------

  var script = document.currentScript;
  var title = (script && script.dataset && script.dataset.title) || 'スペマウォッチ';

  var ready = fetch('/api/config', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (c) {
      config = {
        supabaseUrl: c.supabaseUrl || null,
        supabaseAnonKey: c.supabaseAnonKey || null,
        googleClientId: c.googleClientId || null,
        mock: c.mock !== false,
        autoApprovePhotos: c.autoApprovePhotos !== false
      };
    })
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

  window.AW = {
    config: config, ready: ready, getSupabase: getSupabase, signedIn: signedIn,
    getSession: getSession, requireLogin: requireLogin, signOut: signOut,
    refreshUser: showUser, toast: toast, esc: esc,
    authHeaders: authHeaders, report: report
  };
})();
