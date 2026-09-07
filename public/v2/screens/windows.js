// fd-v2 L3 windows: owned by that slice
//
// Windows tiles + Session full screen (xterm engine). Ledger rows D09, D10.
// Spec: docs/goals/fd-v2-l3/BEHAVIOUR.md, ported from public/app.js:1007-1250.
//
// Two modes, one screen:
//   fixture (?fixture=1) — this file does nothing at all. The compiled logic
//     renders FD.fixture as-is and the pixel gate runs there (DESIGN-35).
//   live — this file owns the terminals: it loads /api/sessions through FD.data,
//     feeds the mock's `tiles` identifier through FD.setData, and paints one
//     xterm per session in a layer of its own, aligned to the box the template
//     drew for it.
//
// Nothing this file creates is ever mounted inside a compiled node, and no
// per-tile state is stored on one. The compiled tiles are positional sc-for
// rows — not stable identities — so they are read for their geometry only, and
// the model in this file is the sole source of truth (DESIGN-35 binding,
// oracle audit s2-shim-oracle-2026-09-08.md items 1 and 2).
// See docs/design/fleetdeck-v2/improvised.md, entries I-L3-01..I-L3-10.
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.screens = FD.screens || {};
  FD.l3 = FD.l3 || {};

  // Texts, timers and keys are verbatim from BEHAVIOUR.md — never reworded.
  var AGENT_LOCKED = 'communication with agent failed';
  var AGENT_REFUSED = 'agent refused operation';
  var STALL_MS = 15000;
  var STALL_TEXT = 'no output — 1Password on this Mac may be locked or waiting for approval';
  var DEAD_TITLE = 'Disconnected';
  var LOCKED_NOTE = '1Password locked — unlock it, then Reconnect';
  var RECONNECT = 'Reconnect';
  var EMPTY_TEXT = 'There are no sessions yet, open a new session via an orchestrator first.';
  var STAGGER_MS = 500;
  var TAIL_MAX = 2000;

  var SCREEN_SEL = '[data-screen-label="Windows"]';
  var FULL_SEL = '[data-screen-label="Session full screen"]';
  // Under the mock's full-screen overlay (z-index 55) when tiled, over it when
  // maximized — the overlay paints the chrome, this layer paints the terminal.
  var Z_TILED = 54;
  var Z_MAX = 56;

  // app.js:67 — the dedupe key. A NUL keeps host and session unambiguous.
  function key(host, name) {
    return host + '\0' + name;
  }

  // --- hooks this slice USES (guarded; their owners may not have landed) ----
  function busOpen(target) {
    return FD.screens && FD.screens.bus && FD.screens.bus.open
      ? FD.screens.bus.open(target)
      : undefined;
  }

  function shellSelectSession(host, name) {
    return FD.shell && FD.shell.selectSession
      ? FD.shell.selectSession(host, name)
      : undefined;
  }

  // --- mode -----------------------------------------------------------------
  // Same rule as data.js:563-567, restated because this runs before data.js loads.
  function isFixture() {
    try {
      if (global.localStorage && localStorage.getItem('fd-fixture') === '1') return true;
    } catch (e) {}
    return /[?&]fixture=1(?:&|$)/.test(location.search);
  }

  // logic.js republishes the mock's palette on every render, so the improvised
  // nodes track the theme without this file knowing a single colour literal.
  function tk() {
    return FD.l3.tokens || {};
  }

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) Object.assign(n.style, style);
    if (text != null) n.textContent = text;
    return n;
  }

  // --- validation -----------------------------------------------------------
  // Everything crossing into FD.setData is validated first: one bad row used to
  // be able to throw inside renderVals, and a throw there blanks every screen,
  // not just this one (oracle audit item 2).
  function str(v) {
    return typeof v === 'string' ? v : v == null ? '' : String(v);
  }

  function validRow(s) {
    return !!s && typeof s === 'object' && str(s.host) !== '' && str(s.name) !== '';
  }

  // ==========================================================================
  // Tile model. `model` is the ordered source of truth; the template renders a
  // projection of it and this file owns the terminals aligned to it.
  // ==========================================================================
  var model = [];
  var byKey = Object.create(null);
  var booted = false;
  var sessionRows = [];
  var layer = null;
  var emptyBox = null;
  var ro = null;

  function projection() {
    return model.map(function (r) {
      // Live tile bodies are painted by the terminal layer, so no seed lines.
      return { name: r.name, box: r.host, foot1: r.foot1, foot2: r.foot2, lines: [] };
    });
  }

  function publish() {
    FD.setData('l3Tiles', projection());
    publishTitle();
    scheduleSync();
  }

  // The mock's Windows subtitle is a seed sentence ("4 tiles attached · …").
  // Live it has to say what is actually attached; the whole `titles` map is
  // copied so a sibling slice's entry is never dropped. I-L3-07.
  function publishTitle() {
    var titles = FD.fixture.titles;
    if (!titles || typeof titles !== 'object') return;
    var entry = titles.windows || ['Windows', ''];
    var hosts = [];
    model.forEach(function (r) { if (hosts.indexOf(r.host) < 0) hosts.push(r.host); });
    var sub = model.length
      ? model.length + (model.length === 1 ? ' tile attached · ' : ' tiles attached · ') + hosts.join(' · ')
      : 'No tiles attached';
    if (entry[1] === sub) return;
    var next = Object.assign({}, titles);
    next.windows = [str(entry[0]) || 'Windows', sub];
    FD.setData('titles', next);
  }

  // --- footer text (BEHAVIOUR §7: "footer = registry label/role/task") ------
  // The mock's footer is "what is running · where" on the left and a short
  // state on the right. The registry's equivalent of that pair is role+label
  // (who this session is) and task (what it is on). Recorded as I-L3-05.
  function footFor(row) {
    if (!row) return { foot1: '', foot2: '' };
    var left = [str(row.role), str(row.label)].filter(Boolean).join(' · ');
    return { foot1: left, foot2: str(row.task) || '—' };
  }

  function rowFor(host, name) {
    for (var i = 0; i < sessionRows.length; i++) {
      if (sessionRows[i].host === host && sessionRows[i].name === name) return sessionRows[i];
    }
    return null;
  }

  // ==========================================================================
  // Assets. index.html belongs to the shell slice, so this file cannot add the
  // vendor tags there; it injects them once, on demand, from the /vendor/*
  // routes server.js already serves (server.js:2367-2370). I-L3-01.
  // ==========================================================================
  var assetsPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureXterm() {
    if (assetsPromise) return assetsPromise;
    if (global.Terminal && global.FitAddon && global.WebLinksAddon) {
      assetsPromise = Promise.resolve();
      return assetsPromise;
    }
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/xterm.css';
    document.head.appendChild(css);
    // The addons read the xterm global, so they load strictly after it.
    assetsPromise = loadScript('/vendor/xterm.js').then(function () {
      return Promise.all([
        loadScript('/vendor/addon-fit.js'),
        loadScript('/vendor/addon-web-links.js'),
      ]);
    });
    return assetsPromise;
  }

  // The shell loads data.js (index.html); loadScript stays for the xterm assets above,
  // which really are fetched on demand.
  function ensureData() {
    return FD.data
      ? Promise.resolve()
      : Promise.reject(new Error('FD.data is not loaded'));
  }

  // xterm theme, derived from the mock's terminal tokens rather than the old
  // app's hard-coded palette (BEHAVIOUR §2 asks for exactly this). I-L3-02.
  function xtermTheme() {
    var t = tk();
    return {
      background: 'rgba(0,0,0,0)',
      foreground: t.ink || '#ffffff',
      cursor: t.good || '#d97757',
      selectionBackground: t.hoverBg || 'rgba(255,255,255,0.07)',
    };
  }

  // ==========================================================================
  // The terminal layer — this file's own DOM, a sibling of #dc-root, never a
  // child of a compiled node. Each session gets a box in it, positioned over
  // whichever compiled box currently represents that session. I-L3-04.
  // ==========================================================================
  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = el('div', {
      position: 'fixed', left: '0', top: '0', width: '0', height: '0',
      pointerEvents: 'none', zIndex: String(Z_TILED),
    });
    layer.setAttribute('data-l3-layer', '1');
    document.body.appendChild(layer);
    return layer;
  }

  function place(box, rect, z) {
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    box.style.zIndex = String(z);
    box.style.visibility = 'visible';
  }

  function hide(box) {
    box.style.visibility = 'hidden';
  }

  // The rect a terminal should occupy inside a compiled box: its content area,
  // read only — the compiled node is never written to.
  function contentRect(node) {
    var r = node.getBoundingClientRect();
    var cs = getComputedStyle(node);
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var pt = parseFloat(cs.paddingTop) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    return {
      left: r.left + pl, top: r.top + pt,
      width: Math.max(0, r.width - pl - pr), height: Math.max(0, r.height - pt - pb),
    };
  }

  // On screen at all — no ancestor is display:none. Deliberately does NOT
  // require a box: with no tiles the compiled Windows div has no children and
  // collapses to zero height, and that is exactly when the empty state is due.
  function displayed(node) {
    if (!node || !node.isConnected) return false;
    for (var n = node; n; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  // On screen and big enough to park a terminal in.
  function visible(node) {
    if (!displayed(node)) return false;
    var r = node.getBoundingClientRect();
    return !!(r.width && r.height);
  }

  // ==========================================================================
  // Per-session record
  // ==========================================================================
  function makeRecord(host, name) {
    var foot = footFor(rowFor(host, name));
    return {
      host: host, name: name, key: key(host, name),
      foot1: foot.foot1, foot2: foot.foot2,
      term: null, fit: null, ws: null, tail: '', stallTimer: null,
      box: null, mount: null, opened: false, dead: false, disposed: false,
      rect: null,
    };
  }

  function isMax(rec) {
    var term = FD.l3.term;
    return !!term && term.name === rec.name && term.host === rec.host;
  }

  function clearStall(rec) {
    if (rec.stallTimer) {
      clearTimeout(rec.stallTimer);
      rec.stallTimer = null;
    }
    var s = rec.box && rec.box.querySelector('[data-l3-stall]');
    if (s) s.remove();
  }

  function armStall(rec) {
    rec.stallTimer = setTimeout(function () {
      // The handle is deliberately NOT cleared here (app.js:1081-1086): the
      // next message tests it to decide whether a stall line is on screen and
      // has to be taken down. Nulling it strands the line forever.
      if (!rec.box || rec.box.querySelector('[data-l3-overlay]')) return;
      var t = tk();
      var n = el('div', {
        position: 'absolute', left: '0', right: '0', bottom: '0',
        padding: '7px 12px', fontFamily: t.mono || 'ui-monospace,monospace',
        fontSize: '10.5px', lineHeight: '1.5', color: t.warn || '#c90',
        background: t.panelHead || 'rgba(0,0,0,0.2)',
        borderTop: '1px solid ' + (t.lineSoft || 'rgba(128,128,128,0.2)'),
      }, STALL_TEXT);
      n.setAttribute('data-l3-stall', '1');
      rec.box.appendChild(n);
    }, STALL_MS);
  }

  // The mock draws no disconnected state, so this is improvised in its tokens
  // and mirrors the old card exactly: title, optional note, button. I-L3-03.
  function deadOverlay(rec) {
    var t = tk();
    var ov = el('div', {
      position: 'absolute', inset: '0', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: '3',
      background: t.termBg || 'rgba(10,10,10,0.55)',
      backdropFilter: 'blur(28px) saturate(150%)',
      WebkitBackdropFilter: 'blur(28px) saturate(150%)',
    });
    ov.setAttribute('data-l3-overlay', '1');
    var card = el('div', {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
      padding: '18px 22px', borderRadius: '12px',
      border: '1px solid ' + (t.line || 'rgba(128,128,128,0.3)'),
      background: t.panel || 'rgba(255,255,255,0.08)', textAlign: 'center',
    });
    card.appendChild(el('div', { fontSize: '14px', fontWeight: '500', color: t.ink }, DEAD_TITLE));
    if (rec.tail.indexOf(AGENT_LOCKED) >= 0 || rec.tail.indexOf(AGENT_REFUSED) >= 0) {
      card.appendChild(el('div', { fontSize: '12px', color: t.ink60 }, LOCKED_NOTE));
    }
    var btn = el('button', {
      borderRadius: '9999px', border: '1px solid ' + (t.line || 'transparent'),
      background: t.ctaBg || '#fff', color: t.ctaFg || '#0a0a0a',
      fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
    }, RECONNECT);
    btn.setAttribute('data-l3-reconnect', '1');
    btn.onclick = function () {
      if (rec.term) rec.term.reset();
      connect(rec);
    };
    card.appendChild(btn);
    ov.appendChild(card);
    return ov;
  }

  function die(rec) {
    clearStall(rec);
    if (!rec.box || rec.box.querySelector('[data-l3-overlay]')) return; // already dead
    rec.dead = true;
    rec.mount.style.opacity = '0.35';
    rec.mount.style.filter = 'grayscale(1)';
    rec.box.appendChild(deadOverlay(rec));
  }

  function sendResize(rec) {
    if (!rec.fit || !rec.term || !rec.opened) return;
    try { rec.fit.fit(); } catch (e) { return; }
    if (rec.ws && rec.ws.readyState === 1) {
      rec.ws.send(JSON.stringify({ type: 'resize', cols: rec.term.cols, rows: rec.term.rows }));
    }
  }

  function connect(rec) {
    if (rec.disposed) return;
    try { rec.fit.fit(); } catch (e) {}
    rec.dead = false;
    rec.mount.style.opacity = '';
    rec.mount.style.filter = '';
    var ov = rec.box.querySelector('[data-l3-overlay]');
    if (ov) ov.remove();
    rec.tail = '';
    clearStall(rec);
    armStall(rec);

    var url =
      'ws://' + location.host + '/term?host=' + encodeURIComponent(rec.host) +
      '&session=' + encodeURIComponent(rec.name) +
      '&cols=' + rec.term.cols + '&rows=' + rec.term.rows;
    var ws = new WebSocket(url);
    rec.ws = ws;
    // A resize sent during the ssh handshake is dropped, so it is replayed here.
    ws.onopen = function () { sendResize(rec); };
    ws.onmessage = function (e) {
      if (rec.stallTimer) clearStall(rec);
      if (typeof e.data === 'string' && e.data.indexOf('{"type":"exit"') === 0) return;
      rec.term.write(e.data);
      rec.tail = (rec.tail + e.data).slice(-TAIL_MAX);
    };
    ws.onclose = function () { die(rec); };
  }

  function buildTerminal(rec) {
    var t = tk();
    rec.box = el('div', {
      position: 'absolute', overflow: 'hidden', pointerEvents: 'auto',
      display: 'flex', flexDirection: 'column', visibility: 'hidden',
    });
    rec.mount = el('div', { flex: '1', minHeight: '0', width: '100%' });
    rec.mount.setAttribute('data-l3-term', '1');
    rec.box.appendChild(rec.mount);
    ensureLayer().appendChild(rec.box);

    rec.term = new global.Terminal({
      scrollback: 5000,
      fontSize: 12,
      fontFamily: t.mono || "ui-monospace,'SF Mono',Menlo,monospace",
      theme: xtermTheme(),
      // tmux mouse tracking swallows drag-selection; option+drag overrides it.
      macOptionClickForcesSelection: true,
    });
    rec.fit = new global.FitAddon.FitAddon();
    rec.term.loadAddon(rec.fit);
    rec.term.loadAddon(new global.WebLinksAddon.WebLinksAddon());

    rec.term.onData(function (d) {
      if (rec.ws && rec.ws.readyState === 1) {
        rec.ws.send(JSON.stringify({ type: 'input', data: d }));
      }
    });

    // tmux-style copy-on-select, straight to the clipboard.
    rec.term.onSelectionChange(function () {
      var s = rec.term.getSelection();
      if (s && navigator.clipboard) navigator.clipboard.writeText(s).catch(function () {});
    });

    // Plain Esc must reach tmux/vim; only shift+Esc leaves full screen.
    rec.term.attachCustomKeyEventHandler(function (e) {
      if (e.type === 'keydown' && e.key === 'Escape' && e.shiftKey && isMax(rec)) {
        if (FD.l3.closeTerm) FD.l3.closeTerm();
        return false;
      }
      return true;
    });
  }

  // ==========================================================================
  // Geometry sync. Reads the compiled tiles for their rects only — they are
  // positional sc-for rows, so index is the only relationship that holds, and
  // nothing is written to them or stored on them.
  // ==========================================================================
  var syncQueued = false;

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    Promise.resolve().then(function () {
      Promise.resolve().then(function () {
        syncQueued = false;
        try { sync(); } catch (e) { console.error(e); }
      });
    });
  }

  function tileEls() {
    var root = document.querySelector(SCREEN_SEL);
    if (!root) return [];
    var grid = root.firstElementChild;
    return grid ? Array.prototype.slice.call(grid.children) : [];
  }

  function syncEmpty(root, shown) {
    if (!shown || model.length) {
      if (emptyBox) hide(emptyBox);
      return;
    }
    if (!emptyBox) {
      var t = tk();
      emptyBox = el('div', {
        position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', boxSizing: 'border-box',
        padding: '28px', borderRadius: '12px',
        border: '1px dashed ' + (t.line || 'rgba(128,128,128,0.3)'),
        background: t.panel || 'rgba(255,255,255,0.05)',
        color: t.ink45 || 'rgba(255,255,255,0.45)',
        fontSize: '13.5px', textAlign: 'center',
      }, EMPTY_TEXT);
      emptyBox.setAttribute('data-l3-empty', '1');
      ensureLayer().appendChild(emptyBox);
    }
    var t2 = tk();
    emptyBox.style.borderColor = t2.line || 'rgba(128,128,128,0.3)';
    emptyBox.style.background = t2.panel || 'rgba(255,255,255,0.05)';
    emptyBox.style.color = t2.ink45 || 'rgba(255,255,255,0.45)';
    // With no tiles the compiled Windows box has no children and collapses to
    // zero height, so it cannot be the anchor — the nearest ancestor that still
    // has a content area is. Read-only, as everywhere else here.
    var anchor = root;
    var r = anchor.getBoundingClientRect();
    while (anchor.parentElement && r.height < 60) {
      anchor = anchor.parentElement;
      r = anchor.getBoundingClientRect();
    }
    if (!r.width || !r.height) { hide(emptyBox); return; }
    place(emptyBox, { left: r.left, top: r.top, width: r.width, height: Math.min(r.height, 240) }, Z_TILED);
  }

  function sameRect(a, b) {
    return !!a && !!b && a.left === b.left && a.top === b.top &&
      a.width === b.width && a.height === b.height;
  }

  function sync() {
    if (!booted) return;
    var root = document.querySelector(SCREEN_SEL);
    var shown = displayed(root);
    syncEmpty(root, shown);

    var els = tileEls();
    var fullBody = FD.l3.termBody;
    var fullShown = visible(document.querySelector(FULL_SEL)) && visible(fullBody);
    var menuOpen = !!FD.l3.termMenu;

    for (var i = 0; i < model.length; i++) {
      var rec = model[i];
      if (!rec.box) continue;

      var maxed = isMax(rec);
      var target = maxed && fullShown ? fullBody : (i < els.length ? els[i].children[1] : null);
      // While the ≡ menu is open it would overlap the terminal, and the menu
      // lives inside the overlay's stacking context where this layer cannot
      // reach. The terminal steps aside for it. I-L3-10.
      var wanted = target && (maxed ? fullShown && !menuOpen : shown) ? target : null;

      if (!wanted) { hide(rec.box); rec.rect = null; continue; }

      var rect = contentRect(wanted);
      if (!rect.width || !rect.height) { hide(rec.box); rec.rect = null; continue; }
      place(rec.box, rect, maxed ? Z_MAX : Z_TILED);

      if (!rec.opened) {
        rec.term.open(rec.mount);
        rec.opened = true;
        rec.rect = rect;
        if (ro) ro.observe(wanted);
        connect(rec);
        if (maxed) rec.term.focus();
        continue;
      }
      if (ro) ro.observe(wanted);
      if (!sameRect(rect, rec.rect)) {
        rec.rect = rect;
        sendResize(rec);
      }
      if (maxed && document.activeElement !== rec.mount) rec.term.focus();
    }
  }

  // The mock's tile ✕ carries no handler (mock L235), and the compiled template
  // belongs to S2, so the click is bound by delegation. The tile is identified
  // by its position among its siblings, computed at click time — a compiled row
  // has no stable identity to store on it. I-L3-06.
  function bindTileChrome() {
    /* The sidebar's Connect all button is drawn with no handler either
     * (template.dc.html:182) and it drives this slice's hook, so it is bound
     * the same way. Matched on its exact label because the mock gives it no id
     * or title. I-L3-06. */
    document.addEventListener('click', function (e) {
      var go = e.target && e.target.closest && e.target.closest('button');
      if (go && go.textContent.trim() === 'Connect all' && go.closest('aside')) {
        connectAll();
      }
    });
    /* app.js:1038-1040 — double-clicking the tile bar, but not a button on it,
     * toggles maximize. The mock draws no handler for it either, so it is the
     * same delegation: on a tile header it maximizes, on the full-screen header
     * it restores, which is what "toggle" means once maximize is an overlay. */
    document.addEventListener('dblclick', function (e) {
      if (!e.target || !e.target.closest || e.target.closest('button')) return;
      var full = e.target.closest(FULL_SEL);
      if (full) {
        if (e.target.closest(FULL_SEL + ' > div') === full.firstElementChild) {
          if (FD.l3.closeTerm) FD.l3.closeTerm();
        }
        return;
      }
      var els = tileEls();
      for (var i = 0; i < els.length; i++) {
        if (els[i].children[0] && els[i].children[0].contains(e.target)) {
          var r = model[i];
          if (r) openMax(r.host, r.name);
          return;
        }
      }
    });
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest &&
        e.target.closest('button[title="Close tile (session keeps running)"]');
      if (!btn) return;
      var els = tileEls();
      for (var i = 0; i < els.length; i++) {
        if (els[i].contains(btn)) {
          var rec = model[i];
          if (rec) closeTile(rec.host, rec.name);
          return;
        }
      }
    });
  }

  // ==========================================================================
  // Public hooks
  // ==========================================================================
  function openTile(host, name) {
    // Fixture mode is byte-identical by construction: no entry point may write
    // to FD.fixture there, not even one a future slice calls by mistake.
    if (isFixture()) return;
    host = str(host); name = str(name);
    if (!host || !name) return;
    var k = key(host, name);
    if (byKey[k]) return; // app.js:1022 — an open tile is never reconnected
    var rec = makeRecord(host, name);
    byKey[k] = rec;
    model.push(rec);
    publish();
    shellSelectSession(host, name);
    ensureXterm().then(function () {
      if (rec.disposed) return;
      buildTerminal(rec);
      scheduleSync();
    }).catch(function (err) { console.error(err); });
  }

  function openMax(host, name) {
    if (isFixture()) return;
    openTile(host, name);
    if (FD.l3.openTerm) FD.l3.openTerm(str(name), str(host), null);
    scheduleSync();
  }

  function closeTile(host, name) {
    if (isFixture()) return;
    var k = key(str(host), str(name));
    var rec = byKey[k];
    if (!rec) return;
    rec.disposed = true;
    clearStall(rec);
    if (rec.ws) {
      rec.ws.onclose = null; // closing a tile is not a death
      try { rec.ws.close(); } catch (e) {}
      rec.ws = null;
    }
    if (rec.term) rec.term.dispose();
    if (rec.box && rec.box.parentNode) rec.box.parentNode.removeChild(rec.box);
    rec.term = null; rec.fit = null; rec.box = null; rec.mount = null;
    delete byKey[k];
    model = model.filter(function (r) { return r !== rec; });
    // Nothing is sent to the server: the remote tmux session keeps running.
    if (isMax(rec) && FD.l3.closeTerm) FD.l3.closeTerm();
    publish();
  }

  function connectAll() {
    if (isFixture()) return Promise.resolve();
    return ensureData().then(function () {
      return FD.data.sessions();
    }).then(function (res) {
      var rows = (res && res.sessions) || res || [];
      if (!Array.isArray(rows)) return;
      return rows.reduce(function (chain, s) {
        // hidden workers stay closed, and a dead row has nothing to attach to
        if (!validRow(s) || !s.live || s.status === 'hidden') return chain;
        return chain.then(function () {
          openTile(s.host, s.name);
          // concurrent ssh handshakes race the 1Password agent; one gets refused
          return new Promise(function (r) { setTimeout(r, STAGGER_MS); });
        });
      }, Promise.resolve());
    }).catch(function (err) { console.error(err); });
  }

  function messageCurrent() {
    var term = FD.l3.term;
    if (!term) return;
    busOpen({ type: 'tmux', host: term.host, session: term.name });
  }

  var windows = {
    openTile: openTile,
    openMax: openMax,
    connectAll: connectAll,
    closeTile: closeTile,
    // internals the logic slice calls back into
    _message: messageCurrent,
    _sync: scheduleSync,
    _model: function () { return model.slice(); },
    _isFixture: isFixture,
    _footFor: footFor,
    _key: key,
    _validRow: validRow,
  };

  FD.screens.windows = windows;

  // ==========================================================================
  // Boot
  // ==========================================================================
  function refreshSessions() {
    return FD.data.sessions().then(function (res) {
      var rows = (res && res.sessions) || res || [];
      sessionRows = Array.isArray(rows) ? rows.filter(validRow) : [];
      // The ≡ switcher lists live sessions — the old sidebar drawer, in menu form.
      FD.setData('l3TermSessions', sessionRows.filter(function (s) {
        return s.live && s.status !== 'hidden';
      }).map(function (s) {
        return { id: str(s.name), name: str(s.name), host: str(s.host), live: true };
      }));
      model.forEach(function (rec) {
        var foot = footFor(rowFor(rec.host, rec.name));
        rec.foot1 = foot.foot1;
        rec.foot2 = foot.foot2;
      });
      publish();
    });
  }

  function boot() {
    if (booted) return;
    booted = true;
    FD.setData('l3Live', true);
    FD.setData('l3Tiles', []);
    // The full-screen footer is the same registry triple as the tile footer,
    // read at render time because logic.js has no access to the session rows.
    FD.l3.footFull = function (host, name) {
      var row = rowFor(host, name);
      return row ? [str(row.role), str(row.label), str(row.task)].filter(Boolean).join(' · ') : '';
    };
    ensureLayer();
    bindTileChrome();
    /* Re-align after every render, and whenever the boxes can have moved on
     * their own. A DOM observer is not used for this: a live terminal rewrites
     * its own rows constantly, so watching the subtree would re-enter sync on
     * every byte of pty output. */
    FD.l3.onRender = scheduleSync;
    if (global.ResizeObserver) ro = new ResizeObserver(function () { scheduleSync(); });
    addEventListener('resize', scheduleSync);
    addEventListener('scroll', scheduleSync, true); // scroll does not bubble
    ensureData()
      .then(refreshSessions)
      .then(function () { scheduleSync(); })
      .catch(function (err) { console.error(err); });
  }

  if (!isFixture()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(window);
