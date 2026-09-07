/* fleetdeck v2 — L5 · Org chart on live seats + sessions (Dietlind, agent-v2-l5).
 *
 * Owns: this file and the org methods in logic.js. Nothing else.
 *
 * HOOKS PROVIDED: none. L5 exposes no cross-slice hook; other slices need
 *   nothing from the org screen. FD.screens.org below is this screen's OWN
 *   surface (logic.js reads it, the verify script drives it) — not a contract
 *   any other slice may call.
 *
 * HOOKS USED (both guarded — the owning slice may not have landed yet):
 *   FD.shell.setLiveApi(text, tone)      L2 — folds the source badge into the
 *                                        header "Live API" pill (ruling O4).
 *   FD.screens.bus.open({type,host,session})
 *                                        L6 — "Send a message" deep-links into
 *                                        the bus thread (ruling O8 pattern).
 *
 * DATA SEAM: FD.setData only, and never in fixture mode (DESIGN-35 point 2).
 *   'orgScopeData' — the mock identifier, from FD.data.toOrg().scope.
 *   'orgLive'      — a NEW key (DESIGN-35 point 4) carrying everything the mock
 *                    left unbound. When it is absent the org methods in logic.js
 *                    fall back to the mock's literals, so fixture mode is
 *                    byte-for-byte the mock. See REPORT.md.
 */
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.fixture = FD.fixture || {};
  FD.screens = FD.screens || {};
  FD.shell = FD.shell || {};

  /* ---- guarded hooks into other slices ---------------------------------- */

  // L2 owns the header pill. Until it lands this is a no-op, by design.
  function setLiveApi(text, tone) {
    try {
      if (FD.shell && typeof FD.shell.setLiveApi === 'function') FD.shell.setLiveApi(text, tone);
    } catch (e) {
      console.error('[org] setLiveApi hook failed', e);
    }
  }

  // L6 owns the bus. Until it lands "Send a message" is inert, by design.
  function openBus(target) {
    try {
      if (FD.screens && FD.screens.bus && typeof FD.screens.bus.open === 'function') {
        FD.screens.bus.open(target);
        return true;
      }
    } catch (e) {
      console.error('[org] bus.open hook failed', e);
    }
    return false;
  }

  /* ---- formats, verbatim from today's app (BEHAVIOUR.md §4) -------------- */

  var MIN15 = 15 * 60 * 1000;
  // app.js:112 — the Linear key shape a task string must have to become a link.
  var TASK_RE = /^[A-Z][A-Z0-9]+-\d+$/;

  // app.js:216-224.
  function shortDuration(ms) {
    var seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return seconds + 's';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ' + (minutes % 60) + 'm';
    return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  }

  // app.js:230-235. One deliberate divergence: today's `Number(null)` is 0, which
  // is finite, so a row with no expires_at renders "expired 20703d 0h ago" (it hits
  // 4 of the 114 captured rows). BEHAVIOUR.md §4 states the contract as
  // 'none' | '<d> left' | 'expired <d> ago', so an absent expiry is 'none' here.
  // Recorded as I-L5-05 in improvised.md.
  function expiryText(epoch, now) {
    if (epoch === null || epoch === undefined || epoch === '') return 'none';
    var stamp = Number(epoch);
    if (!Number.isFinite(stamp)) return 'none';
    var delta = stamp - now;
    return delta > 0 ? shortDuration(delta) + ' left' : 'expired ' + shortDuration(-delta) + ' ago';
  }

  // app.js:246-249.
  function leaseAge(row, now) {
    var stamp = Date.parse((row && row.last_seen_at) || '');
    return Number.isFinite(stamp) ? shortDuration(now - stamp) : 'unknown';
  }

  // app.js:183 — only host+name are ever required; everything else falls back.
  function norm(s) {
    return Object.assign(
      { label: '', role: '', worker: '', note: '', group: '', task: '', status: 'active', live: true },
      s
    );
  }

  function orgChart() {
    var found = global.FleetOrgChart;
    if (!found) throw new Error('FleetOrgChart is not loaded');
    return found;
  }

  /* ---- dependencies the shell does not load ------------------------------
   * public/v2/index.html (S2) lists runtime.js, fixture.js, logic.js, app.js and
   * the screens; it does NOT list L1's public/v2/data.js or public/v2/orgchart.js,
   * so FD.data and FleetOrgChart are absent at load. index.html is the shell's
   * file and not ours to edit, so this screen loads what it needs itself, once,
   * and shares it with whoever else needs it. Recorded as I-L5-01 and filed for
   * the shell owner. */
  var deps = null;

  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var doc = global.document;
      var existing = doc.querySelector('script[data-fd-dep="' + src + '"]');
      if (existing) {
        if (existing.getAttribute('data-fd-loaded') === '1') return ok();
        existing.addEventListener('load', function () { ok(); });
        existing.addEventListener('error', function () { fail(new Error('failed to load ' + src)); });
        return;
      }
      var el = doc.createElement('script');
      el.src = src;
      el.async = false; // keep execution order: orgchart.js before data.js
      el.setAttribute('data-fd-dep', src);
      el.addEventListener('load', function () { el.setAttribute('data-fd-loaded', '1'); ok(); });
      el.addEventListener('error', function () { fail(new Error('failed to load ' + src)); });
      doc.head.appendChild(el);
    });
  }

  function ensureDeps() {
    if (deps) return deps;
    var need = [];
    if (!global.FleetOrgChart) need.push('/v2/orgchart.js');
    if (!(FD.data && typeof FD.data.toOrg === 'function')) need.push('/v2/data.js');
    deps = need.reduce(function (chain, src) {
      return chain.then(function () { return loadScript(src); });
    }, Promise.resolve());
    return deps;
  }

  /* ---- state ------------------------------------------------------------ */

  var loadId = 0;
  var last = null; // the raw {sessions, seats, errors, fixture} of the last good load
  var tickTimer = null;
  var pollTimer = null;

  // app.js:12 — ?orgFixture=1 previews the committed M11 contract fixture.
  function orgFixtureMode() {
    var search = (global.location && global.location.search) || '';
    return /[?&]orgFixture=1(&|$)/.test(search);
  }

  // The pixel-gate mode. In it this screen does nothing at all: no fetch, no
  // FD.setData, no DOM write — so the mock renders byte-for-byte (DESIGN-35 §2).
  function pixelFixtureMode() {
    try {
      if (FD.data && typeof FD.data.isFixture === 'function') return FD.data.isFixture();
    } catch (e) {}
    var search = (global.location && global.location.search) || '';
    return /[?&]fixture=1(&|$)/.test(search);
  }

  // `orgOpen` in v2: the shell's sc-if only renders the screen when it is current.
  function orgOpen() {
    return !!(global.document && global.document.querySelector('[data-screen-label="Org chart"]'));
  }

  /* ---- fetch (BEHAVIOUR.md §1) ------------------------------------------ */

  function fetchOrgData() {
    if (orgFixtureMode()) {
      return global
        .fetch('/orgchart-m11.fixture.json')
        .then(function (response) {
          if (!response.ok) throw new Error('fixture HTTP ' + response.status);
          return response.json();
        })
        .then(function (raw) {
          var fixture = orgChart().rebaseFixture(raw);
          return {
            sessions: (fixture.sessions || []).map(norm),
            seats: fixture.seats || [],
            errors: fixture.errors || [],
            fixture: true,
          };
        });
    }
    // Today's error text names the endpoint, so each leg is labelled separately.
    var sessions = FD.data.sessions();
    var seats = FD.data.seats().catch(function (error) {
      throw new Error('/api/seats HTTP ' + (error && error.status != null ? error.status : 0));
    });
    return Promise.all([sessions, seats]).then(function (pair) {
      var sessionData = pair[0] || {};
      var seatData = pair[1];
      return {
        sessions: (sessionData.sessions || []).map(norm),
        seats: Array.isArray(seatData) ? seatData : (seatData && seatData.seats) || [],
        errors: sessionData.errors || [],
        fixture: false,
      };
    });
  }

  /* ---- adapt: buildTree output -> the mock's slots ----------------------- */

  // An unattached node keeps its own children, so the strip counts every session
  // it shows, not just its entries (app.js:355-357).
  function subtreeCount(node) {
    return node.children.reduce(function (total, child) {
      return total + subtreeCount(child);
    }, 1);
  }

  function flatten(node, out) {
    out.push(node);
    node.children.forEach(function (child) {
      flatten(child, out);
    });
    return out;
  }

  // BEHAVIOUR.md §3 states -> the mock's theme tokens. logic.js resolves the name.
  var STATE_TONE = {
    active: 'good',
    suspect: 'warn',
    reaped: 'dim',
    tombstone: 'dim',
    offline: 'dim',
  };

  function seatMark(seat) {
    return seat === 'coordinator' ? 'C' : 'O';
  }

  function epochText(epoch) {
    return epoch == null ? 'legacy' : '#' + epoch;
  }

  // The work row: `group || 'no group'` / task-or-'no task' (app.js:305-307).
  function workText(row) {
    var task = TASK_RE.test(row.task || '') ? row.task : 'no task';
    return (row.group || 'no group') + ' / ' + task;
  }

  function badgeFor(row, state, now) {
    // The mock's card has exactly one badge slot; today's app can show three at
    // once. Precedence tombstone > pinger > idle, title carries the full text.
    if (state === 'tombstone') {
      return {
        text: '🪦 close me',
        tone: 'dim',
        title: 'Close this stale Mac desktop session; fleetdeck never kills Mac rows',
      };
    }
    if (row.pinger_dead) {
      return {
        text: 'pinger',
        tone: 'info',
        title: 'Session is live; its detached heartbeat pinger failed',
      };
    }
    if (orgChart().needsAttention(row, now)) return { text: 'idle 15m+', tone: 'warn', title: '' };
    return null;
  }

  function busTarget(row) {
    return { type: 'tmux', host: row.host, session: row.name };
  }

  // A seat root or vacant seat, rendered in a spine card.
  function spineFromRoot(node, now) {
    var chart = orgChart();
    if (node.type === 'seat-vacant') {
      var seat = node.seat;
      return {
        name: seat.seat,
        // A live /api/seats row carries no epoch; only the fixture does.
        tag: seat.epoch != null ? '#' + seat.epoch : 'seat',
        sub: node.conflict ? 'Owner row already holds another seat' : 'No current owner row',
        path: seatMark(seat.seat) + ' · ' + seat.owner_host + ' / ' + seat.owner_name,
        lease: 'vacant',
        exp: expiryText(seat.expires_at, now),
        expTone: 'bad',
        dotTone: 'hollow',
        canMsg: false,
      };
    }
    var row = node.row;
    var state = chart.stateOf(row);
    return {
      name: row.worker || row.name,
      tag: node.seat && node.seat.epoch != null ? '#' + node.seat.epoch : node.seat ? node.seat.seat : 'seat',
      sub: (row.role || 'unassigned role') + ' · ' + (node.seat ? node.seat.seat + ' seat' : 'seat'),
      path: row.host + ' / ' + row.name,
      lease: row.lease_state || (row.live ? 'tmux live' : 'unleased'),
      exp: expiryText(node.seat ? node.seat.expires_at : row.expires_at, now),
      expTone: state === 'active' ? 'good' : state === 'suspect' ? 'warn' : 'bad',
      dotTone: STATE_TONE[state] || 'dim',
      canMsg: true,
      target: busTarget(row),
      ariaLabel: (row.worker || row.name) + ', ' + state,
      hasSeat: !!node.seat,
    };
  }

  function kidFromNode(node, now) {
    var chart = orgChart();
    var row = node.row;
    var state = chart.stateOf(row);
    return {
      name: row.worker || row.name,
      role: row.role || 'unassigned role',
      path: row.host + ' / ' + row.name,
      epoch: epochText(row.epoch),
      lease: row.lease_state || (row.live ? 'tmux live' : 'unleased'),
      exp: expiryText(row.expires_at, now),
      expTone: state === 'active' ? 'good' : state === 'suspect' ? 'warn' : 'bad',
      dotTone: STATE_TONE[state] || 'dim',
      target: busTarget(row),
      ariaLabel: (row.worker || row.name) + ', ' + state,
      mach: row.host,
      proj: row.group,
    };
  }

  function cardFromNode(node, now) {
    var chart = orgChart();
    var row = node.row;
    var state = chart.stateOf(row);
    var badge = badgeFor(row, state, now);
    return {
      name: row.worker || row.name,
      role: row.role || 'unassigned role',
      path: row.host + ' / ' + row.name,
      grp: workText(row),
      badge: badge ? badge.text : '',
      badgeTone: badge ? badge.tone : 'warn',
      badgeTitle: badge ? badge.title : '',
      dotTone: STATE_TONE[state] || 'dim',
      ariaLabel: (row.worker || row.name) + ', ' + state,
      // dl.org-facts, four rows, formats verbatim (BEHAVIOUR.md §4).
      meta: [
        { k: 'epoch', v: epochText(row.epoch), tone: 'ink75', mono: true },
        { k: 'lease', v: row.lease_state || (row.live ? 'tmux live' : 'unleased'), tone: 'ink75' },
        { k: 'age', v: leaseAge(row, now), tone: 'ink75' },
        { k: 'expires', v: expiryText(row.expires_at, now), tone: state === 'active' ? 'good' : 'bad' },
      ],
      mach: row.host,
      proj: row.group,
    };
  }

  /* ---- the payload logic.js reads --------------------------------------- */

  function build(data, now) {
    var chart = orgChart();
    var tree = chart.buildTree(data.sessions, data.seats);

    // The mock's kids grid is one level deep; a deeper subtree is flattened into
    // it in childSort order rather than dropped (I-L5-02).
    var attachedKids = [];
    tree.roots.forEach(function (root) {
      root.children.forEach(function (child) {
        flatten(child, attachedKids);
      });
    });

    var unattachedNodes = [];
    tree.unattached.forEach(function (node) {
      flatten(node, unattachedNodes);
    });

    var unattachedCount = tree.unattached.reduce(function (total, node) {
      return total + subtreeCount(node);
    }, 0);

    var notes = [data.sessions.length + ' sessions', data.seats.length + ' seats'];
    if (unattachedCount) notes.push(unattachedCount + ' unattached');
    if (data.errors.length) notes.push(data.errors.length + ' host errors');

    return {
      mode: 'ok',
      // Fleet-wide: seats are the tree's roots and never belong to one scope.
      spine: tree.roots.map(function (root) {
        return spineFromRoot(root, now);
      }),
      kids: attachedKids.map(function (node) {
        return kidFromNode(node, now);
      }),
      cards: unattachedNodes.map(function (node) {
        return cardFromNode(node, now);
      }),
      stats: {
        sessions: data.sessions.length,
        seats: data.seats.length,
        attached: data.sessions.length - unattachedCount,
        unattached: unattachedCount,
      },
      status: notes.join(' \u00b7 '),
      hasError: data.errors.length > 0,
      source: data.fixture ? { text: 'M11 fixture', tone: 'warn' } : { text: 'live API', tone: 'good' },
      empty: !tree.roots.length && !tree.unattached.length ? 'No seats or sessions to map.' : '',
    };
  }

  function loadingPayload() {
    var fixture = orgFixtureMode();
    return {
      mode: 'loading',
      spine: [
        {
          name: fixture ? 'Loading M11 fixture…' : 'Loading live seats and sessions…',
          tag: '',
          sub: '',
          dotTone: 'hollow',
          canMsg: false,
        },
      ],
      kids: [],
      cards: [],
      stats: { sessions: 0, seats: 0, attached: 0, unattached: 0 },
      status: fixture ? 'Loading M11 fixture…' : 'Loading live seats and sessions…',
      hasError: false,
      source: fixture ? { text: 'M11 fixture', tone: 'warn' } : { text: 'live API', tone: 'good' },
      empty: '',
    };
  }

  function errorPayload(error) {
    var message = (error && error.message) || String(error);
    return {
      mode: 'error',
      // BEHAVIOUR.md §5's error-path empty state, in the mock's spine card.
      spine: [
        {
          name: 'The frozen seat endpoint is not available on this branch.',
          tag: 'integration pending',
          sub: 'Use the committed contract fixture to review this UI.',
          path: '/?orgFixture=1',
          lease: 'Org chart unavailable: ' + message,
          exp: 'integration pending',
          expTone: 'bad',
          dotTone: 'bad',
          canMsg: false,
        },
      ],
      kids: [],
      cards: [],
      stats: { sessions: 0, seats: 0, attached: 0, unattached: 0 },
      status: 'Org chart unavailable: ' + message,
      hasError: true,
      source: { text: 'integration pending', tone: 'bad' },
      empty: '',
    };
  }

  /* ---- publish ---------------------------------------------------------- */

  function publish(payload) {
    FD.setData('orgLive', payload);
    setLiveApi(payload.source.text, payload.source.tone);
    patchStats(payload.stats);
  }

  function render(now) {
    if (!last) return;
    // The mock identifier: the scope select and its option list read this.
    FD.setData('orgScopeData', FD.data.toOrg({ sessions: last.sessions }, { seats: last.seats }, now).scope);
    publish(build(last, now));
  }

  function load() {
    var id = ++loadId;
    if (!last) publish(loadingPayload());
    return ensureDeps().then(fetchOrgData).then(
      function (data) {
        if (id !== loadId) return;
        last = data;
        render(Date.now());
      },
      function (error) {
        if (id !== loadId) return;
        last = null;
        publish(errorPayload(error));
      }
    );
  }

  /* ---- the stats row: four literals the mock never bound ----------------- */

  // The mock bakes "102 sessions · 2 seats · 4 attached · 96 unattached" into the
  // compiled template as plain text nodes (app.js:|561,|566,|571,|576) — there is
  // no A_ identifier to feed and app.js is not ours to edit. Writing the text
  // survives a re-render by the runtime's own documented rule: syncChildren()
  // returns early when the child *set* is unchanged, which is why the deck's
  // imperative splitWords() edits survive too (runtime.js syncChildren comment).
  // Never called in pixel-fixture mode, so the gate still sees the mock's numbers.
  function patchStats(stats) {
    var doc = global.document;
    if (!doc) return;
    var screen = doc.querySelector('[data-screen-label="Org chart"]');
    if (!screen) return;
    var row = screen.firstElementChild;
    if (!row) return;
    var values = [stats.sessions, stats.seats, stats.attached, stats.unattached];
    for (var i = 0; i < values.length; i++) {
      var slot = row.children[i];
      if (!slot) continue;
      var number = slot.firstElementChild;
      if (!number) continue;
      var text = String(values[i]);
      if (number.textContent !== text) number.textContent = text;
    }
  }

  /* ---- lifecycle (BEHAVIOUR.md §6) -------------------------------------- */

  function start() {
    if (pixelFixtureMode()) return; // the gate's mode: touch nothing.
    if (tickTimer) return;
    // setInterval(tickOrgTimes, 1000) always (app.js:1255).
    tickTimer = setInterval(function () {
      if (last) render(Date.now());
      else patchStats((FD.fixture.orgLive || { stats: {} }).stats || {});
    }, 1000);
    // setInterval(() => { if (orgOpen) loadOrg(); }, 30000) (app.js:1257-1259).
    pollTimer = setInterval(function () {
      if (orgOpen()) load();
    }, 30000);
    // The shell renders on a microtask, so the screen may not exist yet.
    var wait = setInterval(function () {
      if (!orgOpen()) return;
      clearInterval(wait);
      load();
    }, 50);
    setTimeout(function () {
      clearInterval(wait);
    }, 10000);
  }

  function stop() {
    clearInterval(tickTimer);
    clearInterval(pollTimer);
    tickTimer = pollTimer = null;
  }

  FD.screens.org = {
    setLiveApi: setLiveApi,
    openBus: openBus,
    // Exposed for the org methods in logic.js and for verify/l5.
    start: start,
    stop: stop,
    load: load,
    render: render,
    build: build,
    shortDuration: shortDuration,
    expiryText: expiryText,
    leaseAge: leaseAge,
    workText: workText,
    badgeFor: badgeFor,
    norm: norm,
    subtreeCount: subtreeCount,
    loadingPayload: loadingPayload,
    errorPayload: errorPayload,
    patchStats: patchStats,
    orgFixtureMode: orgFixtureMode,
    pixelFixtureMode: pixelFixtureMode,
    // Sort and scope are resolved in logic.js, which holds the component state
    // and the select's value; org.js publishes every row and never filters.
    _reset: function () {
      last = null;
      loadId = 0;
    },
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})(typeof globalThis === 'object' ? globalThis : this);
