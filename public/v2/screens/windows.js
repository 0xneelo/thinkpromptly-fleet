// fd-v2 L3 windows: owned by that slice
//
// Windows tiles + Session full screen (xterm engine). Ledger rows D09, D10.
// Spec: docs/goals/fd-v2-l3/BEHAVIOUR.md, ported from public/app.js:1007-1250.
//
// Two modes, one screen:
//   fixture (?fixture=1) — this file does nothing at all. The compiled logic
//     renders FD.fixture as-is and the pixel gate runs there (DESIGN-35).
//   live — this file owns the tiles: it loads /api/sessions through FD.data,
//     feeds the mock's `tiles` identifier through FD.setData, and mounts one
//     xterm per tile into the body box the template already drew.
//
// Data enters the template only through FD.setData. Everything this file adds
// to the DOM is either an xterm mount point or an improvised node the mock
// leaves out (stall line, dead overlay, empty state) — all painted from the
// mock's own tokens, which logic.js publishes on FD.l3.tokens every render.
// See docs/design/fleetdeck-v2/improvised.md, entries I-L3-01..I-L3-08.
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

  // --- token access ---------------------------------------------------------
  // logic.js republishes the mock's palette on every render, so improvised
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

  // ==========================================================================
  // Tile model. `model` is the ordered source of truth; the template renders a
  // projection of it and this file owns the terminals hanging off each entry.
  // ==========================================================================
  var model = [];
  var byKey = Object.create(null);
  var booted = false;
  var sessionRows = [];

  function projection() {
    return model.map(function (r) {
      // Live tile bodies are xterm mounts, so the template gets no seed lines.
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
    var titles = FD.fixture.titles || {};
    var entry = titles.windows || ['Windows', ''];
    var hosts = [];
    model.forEach(function (r) { if (hosts.indexOf(r.host) < 0) hosts.push(r.host); });
    var sub = model.length
      ? model.length + (model.length === 1 ? ' tile attached · ' : ' tiles attached · ') + hosts.join(' · ')
      : 'No tiles attached';
    if (entry[1] === sub) return;
    var next = Object.assign({}, titles);
    next.windows = [entry[0], sub];
    FD.setData('titles', next);
  }

  // --- footer text (BEHAVIOUR §7: "footer = registry label/role/task") ------
  // The mock's footer is "what is running · where" on the left and a short
  // state on the right. The registry's equivalent of that pair is role+label
  // (who this session is) and task (what it is on). Recorded as I-L3-05.
  function footFor(row) {
    if (!row) return { foot1: '', foot2: '' };
    var left = [row.role, row.label].filter(Boolean).join(' · ');
    return { foot1: left, foot2: row.task || '—' };
  }

  function rowFor(host, name) {
    for (var i = 0; i < sessionRows.length; i++) {
      if (sessionRows[i].host === host && sessionRows[i].name === name) return sessionRows[i];
    }
    return null;
  }

  // ==========================================================================
  // xterm assets. index.html belongs to the shell slice, so this file cannot
  // add the vendor <script> tags there; it injects them once, on demand, from
  // the same /vendor/* routes server.js already serves (server.js:2367-2370).
  // Recorded as I-L3-01.
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

  // data.js is not in the shell's script list either — same reason, same fix.
  var dataPromise = null;

  function ensureData() {
    if (FD.data) return Promise.resolve();
    if (!dataPromise) dataPromise = loadScript('/v2/data.js');
    return dataPromise;
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
  // One record per open tile: its terminal, socket and overlay state.
  // ==========================================================================
  function makeRecord(host, name) {
    var foot = footFor(rowFor(host, name));
    return {
      host: host,
      name: name,
      foot1: foot.foot1,
      foot2: foot.foot2,
      key: key(host, name),
      term: null,
      fit: null,
      ws: null,
      ro: null,
      tail: '',
      stallTimer: null,
      mount: null, // the div xterm was opened on; it moves between tile and overlay
      tileEl: null,
      dead: false,
      disposed: false,
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
    var host = rec.mount && rec.mount.parentNode;
    var s = host && host.querySelector('[data-l3-stall]');
    if (s) s.remove();
  }

  function stallNode() {
    var t = tk();
    var n = el('div', {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      padding: '7px 12px',
      fontFamily: t.mono || 'ui-monospace,monospace',
      fontSize: '10.5px',
      lineHeight: '1.5',
      color: t.warn || '#c90',
      background: t.panelHead || 'rgba(0,0,0,0.2)',
      borderTop: '1px solid ' + (t.lineSoft || 'rgba(128,128,128,0.2)'),
    }, STALL_TEXT);
    n.setAttribute('data-l3-stall', '1');
    return n;
  }

  function armStall(rec) {
    rec.stallTimer = setTimeout(function () {
      rec.stallTimer = null;
      var host = rec.mount && rec.mount.parentNode;
      if (!host || host.querySelector('[data-l3-overlay]')) return;
      host.appendChild(stallNode());
    }, STALL_MS);
  }

  // The mock draws no disconnected state, so this is improvised in its tokens
  // and mirrors the old card exactly: title, optional 1Password note, button.
  // I-L3-03.
  function deadOverlay(rec) {
    var t = tk();
    var ov = el('div', {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '3',
      background: t.termBg || 'rgba(10,10,10,0.55)',
      backdropFilter: 'blur(28px) saturate(150%)',
      WebkitBackdropFilter: 'blur(28px) saturate(150%)',
    });
    ov.setAttribute('data-l3-overlay', '1');
    var card = el('div', {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px',
      padding: '18px 22px',
      borderRadius: '12px',
      border: '1px solid ' + (t.line || 'rgba(128,128,128,0.3)'),
      background: t.panel || 'rgba(255,255,255,0.08)',
      textAlign: 'center',
    });
    card.appendChild(el('div', { fontSize: '14px', fontWeight: '500', color: t.ink }, DEAD_TITLE));
    if (rec.tail.indexOf(AGENT_LOCKED) >= 0 || rec.tail.indexOf(AGENT_REFUSED) >= 0) {
      card.appendChild(el('div', { fontSize: '12px', color: t.ink60 }, LOCKED_NOTE));
    }
    var btn = el('button', {
      borderRadius: '9999px',
      border: '1px solid ' + (t.line || 'transparent'),
      background: t.ctaBg || '#fff',
      color: t.ctaFg || '#0a0a0a',
      fontSize: '12px',
      padding: '6px 14px',
      cursor: 'pointer',
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
    var host = rec.mount && rec.mount.parentNode;
    if (!host || host.querySelector('[data-l3-overlay]')) return; // already dead
    rec.dead = true;
    if (rec.mount) rec.mount.style.opacity = '0.35';
    if (rec.mount) rec.mount.style.filter = 'grayscale(1)';
    host.appendChild(deadOverlay(rec));
  }

  function sendResize(rec) {
    if (!rec.fit || !rec.term) return;
    try { rec.fit.fit(); } catch (e) {}
    if (rec.ws && rec.ws.readyState === 1) {
      rec.ws.send(JSON.stringify({ type: 'resize', cols: rec.term.cols, rows: rec.term.rows }));
    }
  }

  function connect(rec) {
    if (rec.disposed) return;
    try { rec.fit.fit(); } catch (e) {}
    rec.dead = false;
    if (rec.mount) {
      rec.mount.style.opacity = '';
      rec.mount.style.filter = '';
      var host = rec.mount.parentNode;
      var ov = host && host.querySelector('[data-l3-overlay]');
      if (ov) ov.remove();
    }
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

    rec.mount = el('div', { flex: '1', minHeight: '0', width: '100%' });
    rec.mount.setAttribute('data-l3-term', rec.key);

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

    rec.ro = new ResizeObserver(function () { sendResize(rec); });
  }

  // ==========================================================================
  // DOM sync. The template owns the tile markup; this walks the rendered tiles
  // in model order, stamps a data-* hook on each and parks the right terminal
  // in the right box — the tile body normally, the full-screen body when the
  // session is maximized. Moving the mount node moves the live terminal with
  // it, so one Terminal survives maximize/restore (BEHAVIOUR §1). I-L3-04.
  // ==========================================================================
  var syncQueued = false;

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    // Two microtasks: one for FD.setData's flush, one to land after it.
    Promise.resolve().then(function () {
      Promise.resolve().then(function () {
        syncQueued = false;
        try { sync(); } catch (e) { console.error(e); }
      });
    });
  }

  function tileBodies() {
    var root = document.querySelector(SCREEN_SEL);
    if (!root) return [];
    var grid = root.firstElementChild;
    if (!grid) return [];
    return Array.prototype.slice.call(grid.children);
  }

  function emptyNode() {
    var t = tk();
    var n = el('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '220px',
      padding: '28px',
      borderRadius: '12px',
      border: '1px dashed ' + (t.line || 'rgba(128,128,128,0.3)'),
      background: t.panel || 'rgba(255,255,255,0.05)',
      boxShadow: t.panelShadow || 'none',
      color: t.ink45 || 'rgba(255,255,255,0.45)',
      fontSize: '13.5px',
      textAlign: 'center',
    }, EMPTY_TEXT);
    n.setAttribute('data-l3-empty', '1');
    return n;
  }

  function syncEmpty(root) {
    var existing = root.querySelector('[data-l3-empty]');
    if (model.length) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.textContent = EMPTY_TEXT; // keep the tokens fresh across themes
      return;
    }
    root.appendChild(emptyNode());
  }

  function sync() {
    var root = document.querySelector(SCREEN_SEL);
    if (!root) return;
    syncEmpty(root);

    var els = tileBodies();
    var full = document.querySelector(FULL_SEL);
    var fullBody = FD.l3.termBody || null;

    for (var i = 0; i < model.length && i < els.length; i++) {
      var rec = model[i];
      var tileEl = els[i];
      rec.tileEl = tileEl;
      tileEl.setAttribute('data-l3-key', rec.key);
      if (!rec.term) continue;

      // children are [header, body, footer] — the body is the mono log box.
      var body = tileEl.children[1];
      if (!body) continue;
      if (body.style.position !== 'relative') body.style.position = 'relative';
      if (body.style.padding !== '0px') body.style.padding = '0px';

      var wantHost = isMax(rec) && full && fullBody ? fullBody : body;
      if (rec.mount.parentNode !== wantHost) {
        if (wantHost === fullBody && wantHost.style.position !== 'relative') {
          wantHost.style.position = 'relative';
        }
        wantHost.appendChild(rec.mount);
        if (!rec.opened) {
          rec.term.open(rec.mount);
          rec.opened = true;
          rec.ro.observe(tileEl);
          connect(rec);
        }
        // A fixed-position move does not trip the observer, so refit here.
        sendResize(rec);
        if (isMax(rec)) rec.term.focus();
      }
    }
  }

  // The mock's tile ✕ carries no handler (mock L235), and the compiled template
  // belongs to S2, so the click is bound by delegation instead. I-L3-06.
  function bindTileChrome() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('button[title="Close tile (session keeps running)"]');
      if (!btn) return;
      var tileEl = btn.closest('[data-l3-key]');
      if (!tileEl) return;
      var k = tileEl.getAttribute('data-l3-key');
      var rec = byKey[k];
      if (rec) closeTile(rec.host, rec.name);
    });
  }

  // ==========================================================================
  // Public hooks
  // ==========================================================================
  function openTile(host, name) {
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
    openTile(host, name);
    if (FD.l3.openTerm) FD.l3.openTerm(name, host, null);
    scheduleSync();
  }

  function closeTile(host, name) {
    var k = key(host, name);
    var rec = byKey[k];
    if (!rec) return;
    rec.disposed = true;
    clearStall(rec);
    if (rec.ro) rec.ro.disconnect();
    if (rec.ws) {
      rec.ws.onclose = null; // closing a tile is not a death
      try { rec.ws.close(); } catch (e) {}
    }
    if (rec.term) rec.term.dispose();
    if (rec.mount && rec.mount.parentNode) rec.mount.parentNode.removeChild(rec.mount);
    delete byKey[k];
    model = model.filter(function (r) { return r !== rec; });
    // Nothing is sent to the server: the remote tmux session keeps running.
    if (isMax(rec) && FD.l3.closeTerm) FD.l3.closeTerm();
    publish();
  }

  function connectAll() {
    return ensureData().then(function () {
      return FD.data.sessions();
    }).then(function (res) {
      var rows = (res && res.sessions) || res || [];
      return rows.reduce(function (chain, s) {
        // hidden workers stay closed, and a dead row has nothing to attach to
        if (!s.live || s.status === 'hidden') return chain;
        return chain.then(function () {
          openTile(s.host, s.name);
          // concurrent ssh handshakes race the 1Password agent; one gets refused
          return new Promise(function (r) { setTimeout(r, STAGGER_MS); });
        });
      }, Promise.resolve());
    }).catch(function (err) { console.error(err); });
  }

  // Full-screen header ≡ menu and Message button both route through here.
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
  };

  FD.screens.windows = windows;

  // ==========================================================================
  // Boot
  // ==========================================================================
  function refreshSessions() {
    return FD.data.sessions().then(function (res) {
      sessionRows = (res && res.sessions) || res || [];
      // The ≡ switcher lists live sessions — the old sidebar drawer, in menu form.
      FD.setData('l3TermSessions', sessionRows.filter(function (s) {
        return s.live && s.status !== 'hidden';
      }).map(function (s) {
        return { id: s.name, name: s.name, host: s.host, live: true };
      }));
      // Footers can only be filled once the registry rows are known.
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
      return row ? [row.role, row.label, row.task].filter(Boolean).join(' · ') : '';
    };
    bindTileChrome();
    // Re-park terminals whenever the shell re-renders the Windows screen.
    var mo = new MutationObserver(function () { scheduleSync(); });
    mo.observe(document.body, { childList: true, subtree: true });
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
