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

  /* L6 reports the message-bus unread count; it lands on the sidebar nav badge.
   *
   * The count is remembered rather than dropped. The bus screen can set it
   * during its own synchronous mount, which races the shell's asynchronous
   * data.js load, so a count set before `ready` used to be lost until L6
   * happened to call again — and with a quiet bus that could be never. */
  FD.shell.setBadge = function (n) {
    badge = typeof n === 'number' && n >= 0 ? n : 0;
    if (ready) FD.setData('l2Badge', badge);
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
    // For the boot-race test: what the shell is holding, and whether it is live yet.
    badge: function () { return badge; },
    ready: function () { return ready; },
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
  var EMPTY_COPY = 'There are no sessions yet, open a new session via an orchestrator first.';
  var HOLDER_TIP = 'Open Windows App → RDP to the box as Vibe → run: wsl -e sleep infinity → close (disconnect, never sign out)';

  var ready = false;              // data.js loaded and live mode confirmed
  var liveApiText = DEFAULT_LIVE_API;
  var badge = null;               // last count L6 reported, kept across the boot race
  var sessions = [];              // normalised /api/sessions rows
  var sessionErrors = [];
  var rowIndex = [];              // flat list of shown rows, in render order
  var hiddenCount = 0;
  var liveCount = 0;             // live rows that survived validation, not raw rows
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
      // Anything reported while the data layer was still loading applies now.
      if (badge !== null) FD.setData('l2Badge', badge);
      applyTheme();
      hookRenders();
      delegate();
      FD.shell.refresh();
      paint();
    })
    .catch(function (e) { console.error('[l2] shell could not start', e); });

  /* public/v2/index.html now lists data.js, router.js and orgchart.js alongside the
   * runtime, the logic, the compiled render and the nine screen files (DECK-84), so
   * there is nothing left to load here. Kept as a promise because start() chains on
   * it, and it still rejects when FD.data is absent rather than failing later and
   * further away (was I-L2-01). */
  function loadDataLayer() {
    return FD.data
      ? Promise.resolve()
      : Promise.reject(new Error('data.js is not loaded'));
  }

  /* ---- theme (BEHAVIOUR §5, ledger D06) ---------------------------------- */

  var urlDark = null;   // ?theme=, for this visit only — never written to storage

  function applyTheme() {
    var url = new URLSearchParams(global.location.search).get('theme');
    if (url === 'light' || url === 'dark') urlDark = url === 'dark';
    else if (read('fd-landing-dark') === null && read('fleetTheme') === null) {
      // Neither key set: today's app asks the OS (app.js:11-20); FD.data.theme()
      // would default to dark without asking. Seeding the key here is the D06
      // migration doing its job — the mock reads no other source.
      var light = global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches;
      write('fd-landing-dark', light ? '0' : '1');
    }
    FD.data.theme();   // runs the fleetTheme -> fd-landing-dark migration
    syncThemeAttrs(isDark());
  }

  function syncThemeAttrs(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }

  /* `?theme=` wins for this visit and is never persisted — today's app holds it
   * in a variable and only the toggle writes storage (app.js:11-20 vs 60-63).
   * The mock's own isDark() reads state.dark first, so the override is handed to
   * AppLogic once, on mount, and the next toggle simply replaces it. */
  function isDark() {
    if (logic && logic.state && logic.state.dark != null) return logic.state.dark;
    if (urlDark != null) return urlDark;
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
    var rows = sessions.filter(usable);
    liveCount = rows.filter(function (s) { return s.live; }).length;
    var out = groupSessions(rows, showHidden, openKeys());
    hiddenCount = out.hiddenCount;
    rowIndex = out.rowIndex;
    FD.setData('l2Groups', out.groups);
    repaint();
  }

  /* A row with no host or no name cannot be attached to and cannot be keyed, so
   * it never reaches FD.setData (audit ruling 2: validate before setData). */
  function usable(s) {
    return !!s && typeof s.host === 'string' && s.host !== '' && typeof s.name === 'string' && s.name !== '';
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
      var rows = hosts.filter(function (h) { return !!h && typeof h === 'object'; }).map(healthRow);
      boxTips = rows.map(function (r) { return r.tip; });
      FD.setData('l2Boxes', rows.map(function (r) { return { name: r.name, st: r.st, tone: r.tone }; }));
      repaint();
    }, function () {
      boxTips = [''];
      FD.setData('l2Boxes', [{ name: 'health unreachable', st: '', tone: 'bad' }]);
      repaint();
    });
  }

  /* The old pill read "<host> · <state>" as one string (app.js:112-129); the rail
   * splits it into the mock's name and status columns. Same words, same order. */
  function healthRow(h) {
    var host = h.host == null ? '' : String(h.host);
    if (h.agentLocked) return { name: host, st: '1Password locked', tone: 'warn', tip: 'Unlock 1Password on this Mac, then Refresh' };
    if (h.kind === 'linux') {
      return h.reachable
        ? { name: host, st: 'reachable', tone: 'good', tip: 'ssh + tmux answered on this Linux host' }
        : { name: host, st: 'unreachable', tone: 'bad', tip: 'ssh to this Linux host failed — network or key' };
    }
    if (h.holderOk === null || h.wslAlive === null) {
      return { name: host, st: 'unreachable', tone: 'warn', tip: 'ssh to the box failed — network or 1Password' };
    }
    return h.holderOk && h.wslAlive
      ? { name: host, st: 'holder OK', tone: 'good', tip: HOLDER_TIP }
      : { name: host, st: 'HOLDER DOWN', tone: 'bad', tip: HOLDER_TIP };
  }

  /* ---- §3 accounts mini --------------------------------------------------- */

  function loadAccounts() {
    return FD.data.credits().then(function (d) {
      var rows = ((d && d.rows) || []).filter(function (r) { return !!r && typeof r === 'object'; });
      accountMeta = rows.map(accountMetaFor);
      FD.setData('l2Accounts', rows.map(accountBar));
      repaint();
    }, function () {
      accountMeta = [{ tip: '', capped: false }];
      FD.setData('l2Accounts', [{ prov: '', name: 'accounts unavailable', pct: null, txt: '' }]);
      repaint();
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
    var full = r.label || r.email || r.id || '';
    var capped = !!(r.credit && r.credit.capped);
    return {
      prov: r.kind === 'codex' ? 'gpt' : 'claude',
      // One rail column wide: a first name fits where a full label does not, and
      // the Codex account needs the suffix (app.js:159-160).
      name: String(full).split(' ')[0] + (r.kind === 'codex' ? ' ·gpt' : ''),
      pct: pct,
      // A spent pool never shows up in the windows above, so it needs its own
      // mark (app.js:163). The mock's rail has no fourth cell, so it prefixes
      // the value rather than becoming a node of its own (I-L2-07).
      txt: (capped ? '€' : '') + (pct === null ? '—' : pct + '%'),
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
        // Once, and only while the user has not chosen for themselves: the
        // audit's ruling 3 forbids an unconditional setState in a lifecycle hook.
        if (urlDark != null && !urlApplied && this.state && this.state.dark == null) {
          urlApplied = true;
          this.setState({ dark: urlDark });
        }
        try { paint(); } catch (e) { console.error('[l2] paint failed', e); }
        return out;
      };
    });
  }

  var logic = null, urlApplied = false;

  /* renderVals() rebuilds the theme table `t` on every call and returns it
   * spread; it is the only way to reach the mock's tokens from outside the
   * logic, since `t` is a local. Cached per theme (I-L2-02). */
  function tokens() {
    var dark = isDark();
    if (tokenCache && tokenCache.dark === dark && tokenCache.fromLogic) return tokenCache;
    var v = {};
    try { v = (logic && logic.renderVals()) || {}; } catch (e) { v = {}; }
    tokenCache = {
      // Before the app view mounts there is no logic to ask, so that answer is
      // the quoted fallback and must not be cached as if it were the real table.
      fromLogic: !!v.ink,
      dark: dark,
      ink: v.ink || (dark ? '#ffffff' : '#111111'),
      ink45: v.ink45 || (dark ? 'rgba(255,255,255,0.45)' : 'rgba(17,17,17,0.47)'),
      ink35: v.ink35 || (dark ? 'rgba(255,255,255,0.35)' : 'rgba(17,17,17,0.38)'),
      ink60: v.ink60 || (dark ? 'rgba(255,255,255,0.6)' : 'rgba(17,17,17,0.62)'),
      bad: v.bad || (dark ? 'oklch(0.73 0.17 25)' : 'oklch(0.53 0.18 25)'),
      lineSoft: v.lineSoft || (dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'),
      // The rail's own tone is translucent over a blurred video; the strip sits
      // above that blur, so it needs the page's solid ground behind it.
      sideSolid: v.bgAll || (dark ? '#0a0a0a' : '#f2f1ee'),
    };
    return tokenCache;
  }

  /* FD.setData schedules its re-render on a microtask (runtime.js), so painting
   * straight away would read the previous render's DOM against the new data.
   * Queued after it instead — and it still covers the case where the app view is
   * not mounted, so no componentDidUpdate arrives to drive the paint. */
  function repaint() {
    Promise.resolve().then(function () {
      try { paint(); } catch (e) { console.error('[l2] paint failed', e); }
    });
  }

  function paint() {
    if (!ready) return;
    var t = tokens();
    syncThemeAttrs(t.dark);
    paintLiveApi();
    paintThemeButton();
    paintSessionRows();
    paintBoxRows();
    paintAccountRows();
    paintLayer(t);
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

  function paintSessionRows() {
    tplAll(TPL.sessionRow).forEach(function (row, i) {
      var s = rowIndex[i];
      if (!s) return;
      /* Attributes only, re-derived from rowIndex on every paint — the audit's
       * ruling 1 forbids per-row DOM *state*, and these are a projection of the
       * list that was just rendered, rewritten in the same task. */
      row.setAttribute('data-fd-host', s.host);
      row.setAttribute('data-fd-name', s.name);
      // app.js:850 — "<name> [· <label>] · active <ago>".
      row.title = s.name + (s.label ? ' · ' + s.label : '') + ' · active ' + FD.data.ago(s.active_at);
      // app.js:849 — a hidden row still shows, dimmed.
      row.style.opacity = s.status === 'hidden' ? '0.45' : '';
    });
  }

  function paintBoxRows() {
    tplAll(TPL.boxRow).forEach(function (row, i) {
      var tip = boxTips[i];
      if (tip) row.title = tip; else row.removeAttribute('title');
    });
  }

  function paintAccountRows() {
    tplAll(TPL.accountRow).forEach(function (row, i) {
      var meta = accountMeta[i];
      if (meta && meta.tip) row.title = meta.tip; else row.removeAttribute('title');
    });
  }

  /* ---- the improvised layer ----------------------------------------------- */

  /* Binding ruling 1 (oracle audit, 2026-09-08): never mount foreign DOM inside
   * a compiled node. Everything the mock has no slot for lives in one layer this
   * slice owns, outside #dc-root, positioned over the node it belongs to. Three
   * elements, all reused — no per-row nodes, so a reordered sc-for cannot strand
   * one of them (F1), and no child-list change can delete one (F3). */
  var layer = null, ui = null;

  function layerUi() {
    if (ui && layer && layer.isConnected) return ui;
    layer = document.createElement('div');
    layer.id = 'fd-l2-layer';
    layer.style.cssText = 'position:fixed;inset:0;z-index:6;pointer-events:none;';

    var rowMax = document.createElement('button');
    rowMax.id = 'fd-l2-rowmax';
    rowMax.setAttribute('aria-label', 'Open fullscreen');
    rowMax.title = 'Open fullscreen';
    rowMax.textContent = '⤢';
    rowMax.style.cssText = 'position:absolute;display:none;pointer-events:auto;border:none;background:transparent;padding:0 4px;font-size:12px;line-height:1;cursor:pointer;';

    var foot = document.createElement('div');
    foot.id = 'fd-l2-listfoot';
    foot.style.cssText = 'position:absolute;display:none;flex-direction:column;gap:2px;pointer-events:auto;box-sizing:border-box;padding:6px 16px 8px 16px;';

    var empty = document.createElement('p');
    empty.id = 'fd-l2-empty';
    empty.textContent = EMPTY_COPY;
    empty.style.cssText = 'position:absolute;display:none;margin:0;text-align:center;font-size:12.5px;line-height:1.5;';

    layer.append(rowMax, foot, empty);
    document.body.appendChild(layer);
    ui = { rowMax: rowMax, foot: foot, empty: empty };
    return ui;
  }

  var hoveredRow = null, footSig = null;

  function paintLayer(t) {
    var u = layerUi();
    var app = document.querySelector('[data-screen-label="Fleetdeck app"]');
    var shown = !!(app && app.offsetParent !== null);
    layer.style.display = shown ? '' : 'none';
    if (!shown) return;
    paintRowMax(u, t);
    paintListFoot(u, t);
    paintEmpty(u);
  }

  /* The mock's sidebar row is dot + name; today's row also carries a ghost ⤢
   * that opens the session full screen (app.js:851-857). One button follows the
   * hovered row instead of eighty-five living in the list (I-L2-04). */
  function paintRowMax(u, t) {
    var row = hoveredRow && hoveredRow.isConnected ? hoveredRow : null;
    var list = tpl(TPL.sessionList);
    if (!row || !list) { u.rowMax.style.display = 'none'; return; }
    var r = row.getBoundingClientRect(), clip = list.getBoundingClientRect();
    // A row scrolled out of its scroller must not leave the button behind.
    if (r.bottom <= clip.top + 1 || r.top >= clip.bottom - 1) { u.rowMax.style.display = 'none'; return; }
    u.rowMax.style.display = 'block';
    u.rowMax.style.color = t.ink60;
    u.rowMax.style.left = Math.round(r.right - 22) + 'px';
    u.rowMax.style.top = Math.round(r.top + (r.height - 14) / 2) + 'px';
    u.rowMax.style.height = '14px';
  }

  /* The hidden-rows toggle, the per-host error rows and "no sessions" have no
   * counterpart in the mock. They sit at the foot of the sidebar scroller, over
   * it rather than in it, in the mock's own type scale (I-L2-05, I-L2-06). */
  function paintListFoot(u, t) {
    var list = tpl(TPL.sessionList);
    var parts = footParts();
    if (!list || !parts.length) { u.foot.style.display = 'none'; footSig = null; return; }
    var r = list.getBoundingClientRect();
    u.foot.style.display = 'flex';
    u.foot.style.left = Math.round(r.left) + 'px';
    u.foot.style.width = Math.round(r.width) + 'px';
    u.foot.style.background = t.sideSolid;
    u.foot.style.borderTop = '1px solid ' + t.lineSoft;
    /* Scrolling the sidebar repositions this strip on every event; rebuilding
     * its children each time would be pure churn. */
    var sig = t.dark + '|' + parts.map(function (p) { return (p.toggle ? 'T' : 'E') + p.text; }).join('\u0000');
    if (sig !== footSig) { footSig = sig; u.foot.replaceChildren.apply(u.foot, parts.map(function (p) {
      var el = document.createElement(p.toggle ? 'button' : 'div');
      el.textContent = p.text;
      el.style.cssText = p.toggle
        ? 'text-align:left;border:none;background:transparent;padding:3px 0;font:inherit;font-size:11px;color:' + t.ink45 + ';cursor:pointer;'
        : 'font-size:11px;line-height:1.5;padding:2px 0;color:' + t.bad + ';';
      if (p.toggle) el.setAttribute('data-fd-hidden-toggle', '1');
      return el;
    })); }
    // Measured after the children are in, so the strip hugs its own content.
    u.foot.style.top = Math.round(r.bottom - u.foot.offsetHeight) + 'px';
  }

  function footParts() {
    var parts = [];
    if (hiddenCount) parts.push({ toggle: true, text: showHidden ? 'hide hidden' : 'show ' + hiddenCount + ' hidden' });
    sessionErrors.forEach(function (e) { parts.push({ text: e.host + ': ' + e.message }); });
    if (!liveCount && !sessionErrors.length) parts.push({ text: 'no sessions' });
    return parts;
  }

  /* The Windows empty state moved to L3 in the weave.
   *
   * L2 built it first (the operator's copy, ruling O1) because L3 had not landed
   * and the old `#empty` lived in the shell. L3 now renders the same sentence
   * from `windows.js`, keyed to the tile model it owns rather than to a DOM
   * count — which is the better home for it — so the two were drawn on top of
   * each other. This slice yields: the empty state belongs to whoever owns the
   * tiles. I-L2-08 records the handover; `EMPTY_COPY` stays here only so the
   * unit test can assert the two files still agree word for word. */
  function paintEmpty(u) {
    if (u.empty.style.display !== 'none') u.empty.style.display = 'none';
  }

  /* ---- clicks and hover --------------------------------------------------- */

  /* The mock's Connect all and Refresh buttons carry no handler, and a session
   * row's only handler is "go to Windows". One delegated listener adds the
   * behaviour without touching the compiled markup (I-L2-03). */
  function delegate() {
    document.addEventListener('click', function (e) {
      var el = e.target;
      if (!el || !el.closest) return;

      if (ui && el === ui.rowMax) {
        var s = rowFor(hoveredRow);
        if (s) call(windows(), 'openMax', s.host, s.name);
        return;
      }
      if (el.closest('[data-fd-hidden-toggle]')) {
        showHidden = !showHidden;
        write('showHidden', showHidden ? '1' : '0');
        loadSessions();
        return;
      }
      var row = el.closest('[data-dc-tpl="' + TPL.sessionRow + '"]');
      if (row) {
        var picked = rowFor(row);
        // The mock's own handler still runs and switches to the Windows screen.
        if (picked) FD.shell.selectSession(picked.host, picked.name);
        return;
      }
      if (el.closest('[data-dc-tpl="' + TPL.refresh + '"]')) { FD.shell.refresh(); return; }
      if (el.closest('[data-dc-tpl="' + TPL.connectAll + '"]')) { call(windows(), 'connectAll'); }
    }, true);

    /* Rows are positional (audit F1), so a row is resolved by its position among
     * the rows rendered right now — never by state parked on the node. */
    document.addEventListener('mouseover', function (e) {
      var el = e.target;
      if (!el || !el.closest) return;
      // The ⤢ floats over the row it belongs to but is not a child of it, so
      // moving onto the button must not read as leaving the row.
      if (el.closest('#fd-l2-layer')) return;
      var row = el.closest('[data-dc-tpl="' + TPL.sessionRow + '"]');
      if (row === hoveredRow) return;
      hoveredRow = row;
      if (ready) paintLayer(tokens());
    }, true);

    // The pointer can leave the window without crossing another element, which
    // would strand the ⤢ over the last row it saw.
    var clearHover = function () { if (!hoveredRow) return; hoveredRow = null; if (ready) paintLayer(tokens()); };
    document.addEventListener('mouseleave', clearHover);
    window.addEventListener('blur', clearHover);

    var reflow = function () { if (ready) paintLayer(tokens()); };
    window.addEventListener('resize', reflow);
    // Scroll anywhere (the sidebar scroller included) moves what the layer covers.
    window.addEventListener('scroll', reflow, true);
  }

  function rowFor(row) {
    if (!row) return null;
    var all = tplAll(TPL.sessionRow);
    var i = all.indexOf(row);
    return i < 0 ? null : rowIndex[i] || null;
  }

  // Read once so the first render already reflects the stored choice (app.js:43).
  showHidden = read('showHidden') === '1';
})(window);
