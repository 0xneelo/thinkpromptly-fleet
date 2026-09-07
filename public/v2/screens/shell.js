// fd-v2 L2 shell: owned by that slice
/* App shell — sidebar, page header, right rail. Ledger rows D03, D04, D05.
 * Spec: docs/goals/fd-v2-l2/BEHAVIOUR.md. Worker: Renate.
 *
 * Three rules shape every line below.
 *
 * 1. Fixture mode is inert. `?fixture=1` returns before anything is loaded or
 *    fetched, so the pixel gate sees the mock byte for byte.
 * 2. Data enters through FD.setData only. The shell's three lists — sidebar
 *    groups, right-rail accounts, right-rail boxes — are fed as `l2Groups`,
 *    `l2Accounts`, `l2Boxes`; logic.js renders them with the mock's own helpers.
 * 3. Everything the mock has no slot for is applied after each render, addressed
 *    by `data-dc-tpl` (the compiler's stable node ids) — never by class, never
 *    by hand-written markup grafted into the port. Each such gap is an entry in
 *    docs/design/fleetdeck-v2/improvised.md.
 */
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.screens = FD.screens || {};
  FD.shell = FD.shell || {};

  /* Compiler node ids for the shell's markup (public/v2/app.js). One table, so a
   * recompile that renumbers the template is a single edit here. */
  var TPL = {
    connectAll: '217',      // sidebar "Connect all" button
    sessionList: '221',     // sidebar sessions scroller
    sessionRow: '227',      // session row button
    themeBtn: '132',        // sidebar header theme toggle
    livePill: '239',        // page-header "Live API" pill
    refresh: '241',         // page-header "Refresh" button
    windows: '247',         // Windows screen container
    tile: '250',            // one terminal tile (L3's data, read only to count)
    accountRow: '749',      // right-rail account row
    boxRow: '762',          // right-rail box row
  };

  /* ---- hooks L2 PROVIDES -------------------------------------------------- */

  /* L6 reports the message-bus unread count; it lands on the sidebar nav badge. */
  FD.shell.setBadge = function (n) {
    if (!ready) return;
    FD.setData('l2Badge', typeof n === 'number' && n >= 0 ? n : 0);
  };

  /* L5 reports the org-chart source badge; ruling O4 folds it into the page
   * header "Live API" pill instead of giving it a badge of its own. */
  FD.shell.setLiveApi = function (text) {
    liveApiText = text == null || text === '' ? DEFAULT_LIVE_API : String(text);
    paint();
  };

  /* The page-header Refresh button: sessions + health + credits, today's three
   * loads and no others (BEHAVIOUR §1, app.js:1175-1179). */
  FD.shell.refresh = function () {
    if (!ready) return Promise.resolve();
    return Promise.all([loadSessions(), loadHealth(), loadAccounts()]);
  };

  /* A sidebar session row was picked. While a session is full screen the row
   * switches it; otherwise it adds a tile (BEHAVIOUR §1, app.js:861-864). */
  FD.shell.selectSession = function (host, name) {
    var w = windows();
    if (!w) return;
    if (isFullScreen()) call(w, 'openMax', host, name);
    else call(w, 'openTile', host, name);
  };

  /* The pure halves of the slice, reachable from test/v2-shell.test.js. The
   * shell is a classic browser script, so this is the only seam a Node test has;
   * nothing in the page reads it. */
  FD.shell.__pure = {
    norm: function (s) { return norm(s); },
    groupSessions: function (a, b, c) { return groupSessions(a, b, c); },
    healthRow: function (h) { return healthRow(h); },
    accountPct: function (r) { return accountPct(r); },
    accountBar: function (r) { return accountBar(r); },
    accountMeta: function (r) { return accountMetaFor(r); },
  };

  /* ---- fixture mode: do nothing at all ----------------------------------- */

  /* Mirrors FD.data.isFixture() (data.js:563). Duplicated because data.js is not
   * in the shell's <script> list, and loading it just to ask this question would
   * put a request on the page the pixel gate captures (I-L2-01). */
  function isFixtureMode() {
    try {
      if (global.localStorage.getItem('fd-fixture') === '1') return true;
    } catch (e) { /* storage disabled */ }
    var search = global.location && global.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  var DEFAULT_LIVE_API = 'Live API';
  var HOLDER_TIP = 'Open Windows App → RDP to the box as Vibe → run: wsl -e sleep infinity → close (disconnect, never sign out)';

  var ready = false;              // data.js loaded and live mode confirmed
  var liveApiText = DEFAULT_LIVE_API;
  var sessions = [];              // normalised /api/sessions rows
  var sessionErrors = [];
  var rowIndex = [];              // flat list of shown rows, in render order
  var hiddenCount = 0;
  var showHidden = false;
  var boxTips = [];               // right-rail box row tooltips, in render order
  var accountMeta = [];           // right-rail account tooltips + capped flags
  var tokenCache = null;

  if (isFixtureMode()) return;

  /* ---- boot -------------------------------------------------------------- */

  loadDataLayer()
    .then(function () {
      if (!FD.data || FD.data.isFixture()) return;
      ready = true;
      applyTheme();
      hookRenders();
      delegate();
      FD.shell.refresh();
      paint();
    })
    .catch(function (e) { console.error('[l2] shell could not start', e); });

  /* public/v2/index.html is generated from the mock's <helmet> and lists the
   * runtime, the logic, the compiled render and the nine screen files — not
   * data.js, which arrived a slice later. The shell loads it once, on the shared
   * promise, so any other screen can await the same load (I-L2-01). */
  function loadDataLayer() {
    if (FD.data) return Promise.resolve();
    if (FD.__dataLoading) return FD.__dataLoading;
    FD.__dataLoading = new Promise(function (done, fail) {
      var s = document.createElement('script');
      s.src = '/v2/data.js';
      s.onload = function () { FD.data ? done() : fail(new Error('data.js loaded but FD.data is absent')); };
      s.onerror = function () { fail(new Error('data.js failed to load')); };
      document.head.appendChild(s);
    });
    return FD.__dataLoading;
  }

  /* ---- theme (BEHAVIOUR §5, ledger D06) ---------------------------------- */

  function applyTheme() {
    var url = new URLSearchParams(global.location.search).get('theme');
    if (url === 'light' || url === 'dark') write('fd-landing-dark', url === 'dark' ? '1' : '0');
    else if (read('fd-landing-dark') === null && read('fleetTheme') === null) {
      // Neither key set: today's app asks the OS (app.js:11-20); FD.data.theme()
      // would default to dark without asking.
      var light = global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches;
      write('fd-landing-dark', light ? '0' : '1');
    }
    var dark = FD.data.theme();   // runs the fleetTheme -> fd-landing-dark migration
    syncThemeAttrs(dark);
  }

  function syncThemeAttrs(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }

  function isDark() {
    return read('fd-landing-dark') !== '0';
  }

  function read(key) { try { return global.localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { global.localStorage.setItem(key, value); } catch (e) { /* ignore */ } }

  /* ---- §1 sessions list --------------------------------------------------- */

  /* app.js:182 — only host+name are ever required; everything else falls back. */
  function norm(s) {
    return Object.assign({ label: '', role: '', worker: '', note: '', group: '', task: '', status: 'active', live: true }, s);
  }

  function loadSessions() {
    return FD.data.sessions().then(function (d) {
      sessions = (d && d.sessions ? d.sessions : []).map(norm);
      sessionErrors = (d && d.errors) || [];
      renderSessions();
    }, function (e) {
      sessions = [];
      sessionErrors = [{ host: 'deck', message: String((e && e.message) || e) }];
      renderSessions();
    });
  }

  function renderSessions() {
    var out = groupSessions(sessions, showHidden, openKeys());
    hiddenCount = out.hiddenCount;
    rowIndex = out.rowIndex;
    FD.setData('l2Groups', out.groups);
    paint();
  }

  /* Pure: rows in, the sidebar's group list out. The sidebar attaches terminals,
   * so only live rows belong in it (app.js:839); hosts keep their API order and
   * the list is never re-sorted (app.js:842-848). */
  function groupSessions(all, withHidden, open) {
    var liveRows = all.filter(function (s) { return s.live; });
    var hidden = liveRows.filter(function (s) { return s.status === 'hidden'; }).length;
    var shown = withHidden ? liveRows : liveRows.filter(function (s) { return s.status !== 'hidden'; });

    var order = [], byHost = {};
    shown.forEach(function (s) {
      if (!byHost[s.host]) { byHost[s.host] = []; order.push(s.host); }
      byHost[s.host].push(s);
    });
    // The rail renders box by box, so the flat index the paint pass walks has to
    // follow that order, not the order the API returned.
    var flat = [];
    order.forEach(function (host) { byHost[host].forEach(function (s) { flat.push(s); }); });

    return {
      hiddenCount: hidden,
      rowIndex: flat,
      groups: order.map(function (host) {
        return {
          box: host,
          n: byHost[host].length,
          items: byHost[host].map(function (s) {
            return { n: s.name, tone: s.status === 'kill-requested' ? 'warn' : open[key(s.host, s.name)] ? 'good' : 'muted' };
          }),
        };
      }),
    };
  }

  /* One key per session, matching today's key(host, name) (app.js:89). NUL is the
   * separator because a tmux session name can hold anything else. */
  function key(host, name) { return host + '\u0000' + name; }

  /* L3 owns the terminal engine; until it publishes which tiles are open every
   * dot is idle. Guarded read, dependency recorded in REPORT.md. */
  function openKeys() {
    var w = windows(), out = {};
    var list = w && typeof w.openKeys === 'function' ? w.openKeys() : null;
    if (!list) return out;
    list.forEach(function (k) {
      if (k && typeof k === 'object') out[key(k.host, k.name)] = true;
      else out[String(k)] = true;
    });
    return out;
  }

  function windows() { return (FD.screens && FD.screens.windows) || null; }
  function call(obj, method) {
    if (!obj || typeof obj[method] !== 'function') return undefined;
    return obj[method].apply(obj, Array.prototype.slice.call(arguments, 2));
  }

  /* body.has-max became the mock's full-screen overlay (D10, L3's screen). */
  function isFullScreen() {
    var w = windows();
    if (w && typeof w.isFullScreen === 'function') return !!w.isFullScreen();
    var el = document.querySelector('[data-screen-label="Session full screen"]');
    return !!(el && el.offsetParent !== null);
  }

  /* ---- §2 health ---------------------------------------------------------- */

  function loadHealth() {
    return FD.data.health().then(function (data) {
      var hosts = Array.isArray(data) ? data : (data && data.hosts) || [];
      var rows = hosts.map(healthRow);
      boxTips = rows.map(function (r) { return r.tip; });
      FD.setData('l2Boxes', rows.map(function (r) { return { name: r.name, st: r.st, tone: r.tone }; }));
      paint();
    }, function () {
      boxTips = [''];
      FD.setData('l2Boxes', [{ name: 'health unreachable', st: '', tone: 'bad' }]);
      paint();
    });
  }

  /* The old pill read "<host> · <state>" as one string (app.js:112-129); the rail
   * splits it into the mock's name and status columns. Same words, same order. */
  function healthRow(h) {
    if (h.agentLocked) return { name: h.host, st: '1Password locked', tone: 'warn', tip: 'Unlock 1Password on this Mac, then Refresh' };
    if (h.kind === 'linux') {
      return h.reachable
        ? { name: h.host, st: 'reachable', tone: 'good', tip: 'ssh + tmux answered on this Linux host' }
        : { name: h.host, st: 'unreachable', tone: 'bad', tip: 'ssh to this Linux host failed — network or key' };
    }
    if (h.holderOk === null || h.wslAlive === null) {
      return { name: h.host, st: 'unreachable', tone: 'warn', tip: 'ssh to the box failed — network or 1Password' };
    }
    return h.holderOk && h.wslAlive
      ? { name: h.host, st: 'holder OK', tone: 'good', tip: HOLDER_TIP }
      : { name: h.host, st: 'HOLDER DOWN', tone: 'bad', tip: HOLDER_TIP };
  }

  /* ---- §3 accounts mini --------------------------------------------------- */

  function loadAccounts() {
    return FD.data.credits().then(function (d) {
      var rows = (d && d.rows) || [];
      accountMeta = rows.map(accountMetaFor);
      FD.setData('l2Accounts', rows.map(accountBar));
      paint();
    }, function () {
      accountMeta = [{ tip: '', capped: false }];
      FD.setData('l2Accounts', [{ prov: '', name: 'accounts unavailable', pct: null, txt: '' }]);
      paint();
    });
  }

  /* Whichever window is furthest along is the one that will stop the account
   * (app.js:136-141). */
  function accountPct(r) {
    var w = r.windows || {};
    var pcts = (r.kind === 'codex' ? [w.weekly, r.weekly, r.secondary] : [w.five_hour, w.seven_day])
      .filter(function (x) { return x && typeof x.pct === 'number'; })
      .map(function (x) { return x.pct; });
    return pcts.length ? Math.max.apply(Math, pcts) : null;
  }

  function accountBar(r) {
    var pct = accountPct(r);
    var full = r.label || r.email || r.id;
    return {
      prov: r.kind === 'codex' ? 'gpt' : 'claude',
      // One rail column wide: a first name fits where a full label does not, and
      // the Codex account needs the suffix (app.js:159-160).
      name: String(full).split(' ')[0] + (r.kind === 'codex' ? ' ·gpt' : ''),
      pct: pct,
      txt: pct === null ? '—' : pct + '%',
    };
  }

  function accountMetaFor(r) {
    var pct = accountPct(r);
    var c = r.credit;
    var spent = c && typeof c.used === 'number' && typeof c.limit === 'number';
    var decimals = c && c.decimals != null ? c.decimals : 2;
    return {
      tip: [
        (r.label || r.id) + (r.email ? ' · ' + r.email : ''),
        pct === null ? 'no usage reported' : 'highest window ' + pct + '%',
        spent ? 'credits ' + c.used.toFixed(decimals) + ' / ' + c.limit.toFixed(decimals) + ' ' + (c.currency || '') : null,
        r.source ? 'source: ' + r.source : 'no data yet',
      ].filter(Boolean).join('\n'),
      capped: !!(c && c.capped),
    };
  }

  /* ---- render hook -------------------------------------------------------- */

  /* The compiled runtime rewrites every text node it owns on each flush and
   * drops foreign children whenever a managed child list changes, so everything
   * the mock has no slot for is re-applied straight after each render — in the
   * same task, before paint. AppLogic's own lifecycle methods are the hook;
   * wrapping them from here keeps logic.js free of shell plumbing. */
  function hookRenders() {
    if (typeof AppLogic === 'undefined') return;
    var proto = AppLogic.prototype;
    ['componentDidMount', 'componentDidUpdate'].forEach(function (name) {
      var inner = proto[name];
      proto[name] = function () {
        var out = inner ? inner.apply(this, arguments) : undefined;
        logic = this;
        try { paint(); } catch (e) { console.error('[l2] paint failed', e); }
        return out;
      };
    });
  }

  var logic = null;

  /* renderVals() rebuilds the theme table `t` on every call and returns it
   * spread; it is the only way to reach the mock's tokens from outside the
   * logic, since `t` is a local. Cached per theme (I-L2-02). */
  function tokens() {
    var dark = isDark();
    if (tokenCache && tokenCache.dark === dark) return tokenCache;
    var v = {};
    try { v = (logic && logic.renderVals()) || {}; } catch (e) { v = {}; }
    tokenCache = {
      dark: dark,
      ink: v.ink || (dark ? '#ffffff' : '#111111'),
      ink45: v.ink45 || (dark ? 'rgba(255,255,255,0.45)' : 'rgba(17,17,17,0.47)'),
      ink35: v.ink35 || (dark ? 'rgba(255,255,255,0.35)' : 'rgba(17,17,17,0.38)'),
      ink60: v.ink60 || (dark ? 'rgba(255,255,255,0.6)' : 'rgba(17,17,17,0.62)'),
      bad: v.bad || (dark ? 'oklch(0.73 0.17 25)' : 'oklch(0.53 0.18 25)'),
      lineSoft: v.lineSoft || (dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'),
    };
    return tokenCache;
  }

  function paint() {
    if (!ready) return;
    var t = tokens();
    syncThemeAttrs(t.dark);
    paintLiveApi();
    paintThemeButton();
    paintSessionRows(t);
    paintSessionExtras(t);
    paintBoxRows();
    paintAccountRows(t);
    paintEmptyState(t);
  }

  function tpl(id, root) { return (root || document).querySelector('[data-dc-tpl="' + id + '"]'); }
  function tplAll(id, root) { return Array.prototype.slice.call((root || document).querySelectorAll('[data-dc-tpl="' + id + '"]')); }

  /* Ruling O4: the page-header pill carries the source badge text. */
  function paintLiveApi() {
    var pill = tpl(TPL.livePill);
    if (!pill) return;
    for (var n = pill.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.data !== liveApiText) { n.data = liveApiText; return; }
    }
  }

  /* BEHAVIOUR §5 keeps the toggle's title and pressed state; the mock's control
   * is an icon button, so the old "☀ Light" / "☾ Dark" label has no slot. */
  function paintThemeButton() {
    var btn = tpl(TPL.themeBtn);
    if (!btn || btn.tagName !== 'BUTTON') return;
    var dark = isDark();
    btn.setAttribute('aria-pressed', String(!dark));
    btn.title = 'Switch to ' + (dark ? 'light' : 'dark') + ' theme';
  }

  function paintSessionRows(t) {
    var rows = tplAll(TPL.sessionRow);
    rows.forEach(function (row, i) {
      var s = rowIndex[i];
      if (!s) return;
      row.setAttribute('data-fd-host', s.host);
      row.setAttribute('data-fd-name', s.name);
      // app.js:850 — "<name> [· <label>] · active <ago>".
      row.title = s.name + (s.label ? ' · ' + s.label : '') + ' · active ' + FD.data.ago(s.active_at);
      // app.js:849 — a hidden row still shows, dimmed.
      row.style.opacity = s.status === 'hidden' ? '0.45' : '';
      addRowMax(row, t);
    });
  }

  /* The mock's sidebar row is dot + name; today's row also carries a ghost ⤢
   * that opens the session full screen (app.js:851-857). Improvised in the
   * mock's own idiom: no colour of its own, revealed on hover (I-L2-04). */
  function addRowMax(row, t) {
    if (row.querySelector('[data-fd-rowmax]')) return;
    var b = document.createElement('button');
    b.setAttribute('data-fd-rowmax', '1');
    b.setAttribute('aria-label', 'Open fullscreen');
    b.title = 'Open fullscreen';
    b.textContent = '⤢';
    b.style.cssText = 'margin-left:auto;flex-shrink:0;border:none;background:transparent;color:inherit;opacity:0;padding:0 2px;font-size:12px;line-height:1;cursor:pointer;transition:opacity .15s;';
    row.appendChild(b);
    row.addEventListener('mouseenter', function () { b.style.opacity = '0.6'; });
    row.addEventListener('mouseleave', function () { b.style.opacity = '0'; });
    b.addEventListener('focus', function () { b.style.opacity = '0.6'; });
    b.addEventListener('blur', function () { b.style.opacity = '0'; });
  }

  /* The hidden-rows toggle, the per-host error rows and "no sessions" have no
   * counterpart in the mock. They go at the foot of the sidebar scroller, in the
   * mock's own type scale (I-L2-05, I-L2-06). */
  function paintSessionExtras(t) {
    var list = tpl(TPL.sessionList);
    if (!list) return;
    var box = list.querySelector('[data-fd-extra]');
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('data-fd-extra', '1');
      box.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:6px 8px 2px 8px;';
    }
    if (box.parentNode !== list) list.appendChild(box);

    var parts = [];
    if (hiddenCount) {
      parts.push({
        kind: 'toggle',
        text: showHidden ? 'hide hidden' : 'show ' + hiddenCount + ' hidden',
        style: 'text-align:left;border:none;background:transparent;padding:4px 0;font:inherit;font-size:11px;color:' + t.ink45 + ';cursor:pointer;',
      });
    }
    sessionErrors.forEach(function (e) {
      parts.push({ kind: 'err', text: e.host + ': ' + e.message, style: 'font-size:11px;line-height:1.5;color:' + t.bad + ';padding:2px 0;' });
    });
    if (!sessions.filter(function (s) { return s.live; }).length && !sessionErrors.length) {
      parts.push({ kind: 'err', text: 'no sessions', style: 'font-size:11px;line-height:1.5;color:' + t.bad + ';padding:2px 0;' });
    }

    box.replaceChildren.apply(box, parts.map(function (p) {
      var el = document.createElement(p.kind === 'toggle' ? 'button' : 'div');
      el.textContent = p.text;
      el.style.cssText = p.style;
      if (p.kind === 'toggle') el.setAttribute('data-fd-hidden-toggle', '1');
      return el;
    }));
  }

  function paintBoxRows() {
    tplAll(TPL.boxRow).forEach(function (row, i) {
      var tip = boxTips[i];
      if (tip) row.title = tip; else row.removeAttribute('title');
    });
  }

  /* The row tooltip and the `€` capped flag (app.js:145-163) have no slot in the
   * mock's three-column rail row (I-L2-07). */
  function paintAccountRows(t) {
    tplAll(TPL.accountRow).forEach(function (row, i) {
      var meta = accountMeta[i];
      if (meta && meta.tip) row.title = meta.tip; else row.removeAttribute('title');
      var flag = row.querySelector('[data-fd-capped]');
      if (meta && meta.capped) {
        if (!flag) {
          flag = document.createElement('span');
          flag.setAttribute('data-fd-capped', '1');
          flag.title = 'credit pool spent';
          flag.textContent = '€';
          flag.style.cssText = 'grid-column:1 / -1;justify-self:end;font-size:11px;line-height:1;color:#f0836b;';
          row.appendChild(flag);
        }
      } else if (flag) {
        flag.remove();
      }
    });
  }

  /* Operator ruling: today's "No terminals open — pick a session, Connect all,
   * or open the Registry" is replaced by one sentence, and the mock has no empty
   * state at all (O1, I-L2-08). L3 owns `tiles`; this reacts to it. */
  function paintEmptyState(t) {
    var screen = tpl(TPL.windows);
    if (!screen) return;
    var empty = screen.querySelector('[data-fd-empty]');
    // Counted off the DOM rather than off a fixture key, so the empty state
    // answers to whatever L3 ends up feeding the tile grid.
    var show = tplAll(TPL.tile, screen).length === 0;
    if (!show) { if (empty) empty.remove(); return; }
    if (!empty) {
      empty = document.createElement('p');
      empty.setAttribute('data-fd-empty', '1');
      empty.textContent = 'There are no sessions yet, open a new session via an orchestrator first.';
      screen.appendChild(empty);
    }
    empty.style.cssText = 'margin:0;padding:48px 0;text-align:center;font-size:12.5px;line-height:1.5;color:' + t.ink45 + ';';
  }

  /* ---- clicks ------------------------------------------------------------- */

  /* The mock's Connect all and Refresh buttons carry no handler, and the session
   * row's only handler is "go to Windows". One delegated listener adds the
   * behaviour without touching the compiled markup (I-L2-03). */
  function delegate() {
    document.addEventListener('click', function (e) {
      var el = e.target;
      if (!el || !el.closest) return;

      if (el.closest('[data-fd-rowmax]')) {
        e.stopPropagation();
        var maxRow = el.closest('[data-dc-tpl="' + TPL.sessionRow + '"]');
        if (maxRow) call(windows(), 'openMax', maxRow.getAttribute('data-fd-host'), maxRow.getAttribute('data-fd-name'));
        return;
      }
      if (el.closest('[data-fd-hidden-toggle]')) {
        showHidden = !showHidden;
        write('showHidden', showHidden ? '1' : '0');
        loadSessions();
        return;
      }
      var row = el.closest('[data-dc-tpl="' + TPL.sessionRow + '"]');
      if (row && row.hasAttribute('data-fd-host')) {
        FD.shell.selectSession(row.getAttribute('data-fd-host'), row.getAttribute('data-fd-name'));
        return;
      }
      if (el.closest('[data-dc-tpl="' + TPL.refresh + '"]')) { FD.shell.refresh(); return; }
      if (el.closest('[data-dc-tpl="' + TPL.connectAll + '"]')) { call(windows(), 'connectAll'); return; }
    }, true);
  }

  // Read once so the first render already reflects the stored choice (app.js:43).
  showHidden = read('showHidden') === '1';
})(window);
