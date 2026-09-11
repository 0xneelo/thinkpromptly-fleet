// fd-v2 L9 machines: owned by that slice.
//
// The Machines screen on live data. Everything user-visible here — every chip label, every
// text, every timer — is BEHAVIOUR.md, which is public/machines.js as it ships today; the
// mock (docs/design/fleetdeck-v2/mock, L617-668) is the look. Where the two disagree the
// mock wins on shape and today's app wins on words.
//
// Hooks PROVIDED to other slices: none (README.md §Cross-slice contract).
// Hooks USED: FD.screens.registry.open (L4) — called guarded from this screen's
// openRegistry method in logic.js, never from here.
//
// Data enters the template through FD.setData('machinesLive', cards). S2 could not
// byte-safely substitute the mock's `machines` literal, so this slice reads its own key
// rather than `machines` (DESIGN-35 broadcast, 2026-09-07; REPORT.md §Data seam).
(function (root) {
  'use strict';

  var FD = root.FD = root.FD || {};
  FD.screens = FD.screens || {};

  // --- verbatim from public/machines.js (BEHAVIOUR.md §2) ---------------------
  // Tones are renamed to the mock's chipTone() vocabulary: ok -> good, '' -> neutral.
  var CLIENTS = [
    ['claude_cli', 'Claude CLI'],
    ['codex_cli', 'Codex CLI'],
    ['claude_desktop', 'Claude desktop'],
    ['codex_desktop', 'Codex desktop'],
  ];
  var PROOF = {
    profile: ['token-proved', 'good'],
    jwt: ['token-proved', 'good'],
    config: ['config only', 'warn'],
    history: ['last active', 'neutral'],
  };
  var STATE = {
    token_expired: ['token expired', 'bad'],
    rate_limited: ['busy (429)', 'warn'],
    signed_out: ['signed out', 'warn'],
    api_key: ['api key', 'neutral'],
    no_samples: ['never used', 'neutral'],
    error: ['read failed', 'bad'],
  };
  var TIER = { default_claude_max_20x: 'Max 20×', claude_max: 'Max' };
  var WIN_LABEL = { five_hour: '5 hour', seven_day: '7 day', extra: 'extra usage', weekly: 'weekly', secondary: 'session' };
  var WIN_ORDER = ['five_hour', 'seven_day', 'extra', 'weekly', 'secondary'];

  var POLL_MS = 60000;
  var FETCH_ERROR = 'cannot reach fleetdeck';

  // --- time helpers, verbatim (machines.js:41-66), with an injectable clock ----
  function nowMs(now) { return now === undefined || now === null ? Date.now() : now; }

  // Both directions: a token expires ahead, a refresh happened behind.
  function ago(epoch, now) {
    var ms = nowMs(now) - epoch * 1000;
    var m = Math.floor(Math.abs(ms) / 60000);
    var t = m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h' : Math.floor(m / 1440) + ' d';
    return ms >= 0 ? (m < 1 ? 'just now' : t + ' ago') : 'in ' + t;
  }

  // Kept apart from ago(): this one never reads a timestamp in the future.
  function sampleAge(epoch, now) {
    var ms = nowMs(now) - epoch * 1000;
    var m = Math.floor(ms / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago';
  }

  function until(epoch, now) {
    if (!epoch) return '';
    var m = Math.round((epoch * 1000 - nowMs(now)) / 60000);
    if (m <= 0) return 'resets now';
    var h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 60) return 'resets in ' + m + 'm';
    return 'resets in ' + (d ? d + 'd ' + (h % 24) : h) + 'h ' + (m % 60) + 'm';
  }

  // The line under the badges: what would go stale first for this client.
  function freshness(c, now) {
    if (c.client === 'claude_cli' && c.expires_at)
      return (c.expires_at * 1000 > nowMs(now) ? 'token valid ' : 'token expired ') + ago(c.expires_at, now);
    if (c.client.indexOf('codex') === 0 && c.last_refresh) {
      var t = Date.parse(c.last_refresh);
      if (!isNaN(t)) return 'refreshed ' + ago(t / 1000, now);
    }
    if (c.last_active) return 'last active ' + ago(c.last_active, now);
    return '';
  }

  // --- payload -> the mock's card model ---------------------------------------

  // usageNodes() (machines.js:91-107) sorts by WIN_ORDER and keeps anything else after it,
  // by name — it orders the windows, it does not filter them.
  function windowNames(u) {
    return Object.keys((u && u.windows) || {})
      .sort(function (a, b) {
        return ((WIN_ORDER.indexOf(a) + 1 || 99) - (WIN_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b);
      })
      .filter(function (n) { return u.windows[n] && typeof u.windows[n] === 'object'; });
  }

  // One client entry -> one section of the mock's card. The mock's row renders chips, bars
  // and a single note, so the four lines today's cell stacks (freshness, shares, note,
  // sampled age, session attribution) join with ' · ' — the separator the mock's own seed
  // uses (improvised.md I-L9-05).
  function section(c, wsl, sessions, runsSessions, now) {
    var env = c.where === 'windows' ? 'Windows' : (wsl ? 'WSL' : '');
    if (!c.installed && c.state === 'not_installed') {
      // mCard drops a section whose primary is '—', which is how the mock leaves the cell
      // empty; today's table prints the same em dash.
      return { env: env, name: '—', email: '', chips: [], bars: [], note: '' };
    }
    var email = c.email || c.config_email || '';
    var name = c.label || (email ? '' : (c.org ? c.org.slice(0, 8) + ' · unmapped org' : 'signed in, account unknown'));

    var chips = [];
    var plan = c.plan && c.plan !== 'business' ? c.plan : null;
    if (plan) chips.push([plan, 'neutral']);
    if (c.tier) chips.push([TIER[c.tier] || c.tier, 'neutral']);
    var proof = PROOF[c.proof];
    if (proof) chips.push([proof[0], proof[1]]);
    var st = STATE[c.state];
    if (st) chips.push([st[0], st[1]]);

    var u = c.usage;
    var names = windowNames(u);
    var bars = names.map(function (n) {
      var w = u.windows[n];
      var pct = typeof w.pct === 'number' ? w.pct : null;
      return [WIN_LABEL[n] || n.replace(/_/g, ' '), pct, !!w.stale, until(w.resets_at, now)];
    });

    var note = [];
    var f = freshness(c, now);
    if (f) note.push(f);
    if (c.shares) note.push('same login as CLI');
    if (c.note) note.push(c.note);
    if (!u) note.push('no usage data');
    else if (!names.length) note.push('no usage windows reported');
    // The mock's bar row has no tail slot, so a window's reset time rides in the note,
    // named so three windows cannot be confused for one (improvised.md I-L9-05).
    bars.forEach(function (b) { if (b[3]) note.push(b[0] + ' ' + b[3]); });
    if (u && u.sample_ts) {
      note.push('sampled ' + sampleAge(u.sample_ts, now) +
        (u.stale_windows ? ' — older than the window it measured, so these have reset since' : ''));
    }
    var n = (sessions || []).length;
    var login = c.label || c.email;
    if (runsSessions && n && login) note.push(n + (n === 1 ? ' session runs as ' : ' sessions run as ') + login);

    return { env: env, name: name, email: email, chips: chips, bars: bars, note: note.join(' · ') };
  }

  function colsOf(m, now) {
    var clients = m.clients || [];
    // A WSL box reports its Linux side as `local`; on that machine that side is the WSL one.
    var wsl = (m.os || '').indexOf('wsl') !== -1;
    // The sessions come from tmux on the side the deck reaches over ssh — the `local` one —
    // so only that Claude CLI row may name them, and only when it is the single local one.
    var local = clients.filter(function (c) { return c.client === 'claude_cli' && c.where === 'local'; });
    var runner = local.length === 1 ? local[0] : null;
    return CLIENTS.map(function (pair) {
      var entries = clients.filter(function (c) { return c.client === pair[0]; });
      if (!entries.length) return { client: pair[1], sections: [{ env: '', name: '—', email: '', chips: [], bars: [], note: '' }] };
      return {
        client: pair[1],
        sections: entries.map(function (c) {
          return section(c, wsl && c.where !== 'windows', m.sessions, c === runner, now);
        }),
      };
    });
  }

  // machineCell()'s error / no-report branches (machines.js:181-186). The mock's card has no
  // slot for them, so they become the card's leading status cell (improvised.md I-L9-04).
  function statusOf(m, pushUrl) {
    if (m.error) return { label: 'Status', text: m.error, copy: '', tone: 'bad' };
    if (m.state === 'no_report' && m.route === 'push') {
      return {
        label: 'Status',
        text: 'no report yet — cron this on that machine:',
        copy: 'sh fleet-logins.sh push ' + pushUrl + ' ' + m.id,
        tone: '',
      };
    }
    if (m.state === 'no_report') return { label: 'Status', text: 'no report yet', copy: '', tone: '' };
    return null;
  }

  function kindOf(m) {
    return [m.os, m.route === 'ssh' ? 'ssh ' + m.ssh : m.route].filter(Boolean).join(' · ');
  }

  function sessionChip(m) {
    var n = (m.sessions || []).length;
    return n ? n + (n === 1 ? ' session' : ' sessions') : '';
  }

  // FD.data.toMachines supplies the card list and its names; the fields below it does not
  // carry to BEHAVIOUR.md's wording (kind's ssh alias, the singular session chip, the state
  // chips, WIN_ORDER, freshness, the session attribution) are recomputed here, where the
  // screen's presentation layer belongs (improvised.md I-L1-01). REPORT.md §Adapter gap.
  function toCards(payload, now) {
    var machines = (payload && payload.machines) || [];
    var base = [];
    // FD.data.ago() takes milliseconds (data.js:186-194), the same clock this file uses.
    try { base = FD.data.toMachines(machines, nowMs(now)) || []; } catch (e) { base = []; }
    var pushUrl = (payload && payload.push_url) || '';
    return machines.map(function (m, i) {
      return {
        name: (base[i] && base[i].name) || m.label,
        kind: kindOf(m),
        sessions: sessionChip(m),
        reported: m.reported_at ? 'reported ' + ago(m.reported_at, now) : '',
        host: m.host || '',
        status: statusOf(m, pushUrl),
        cols: colsOf(m, now),
      };
    });
  }

  // load()'s catch (machines.js:223-224) replaces the whole list with the message; a card
  // with only a title is this screen's empty state (improvised.md I-L9-06).
  function errorCard() {
    return { name: FETCH_ERROR, kind: '', sessions: '', reported: '', host: '', status: null, cols: [] };
  }

  // --- fixture mode ------------------------------------------------------------
  // Mirrors FD.data.isFixture() so this file can still decide when FD.data is absent.
  function isFixture() {
    if (FD.data && typeof FD.data.isFixture === 'function') return FD.data.isFixture();
    try { if (root.localStorage.getItem('fd-fixture') === '1') return true; } catch (e) { /* no storage */ }
    var search = root.location && root.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // public/v2/index.html loads /v2/data.js before the screens, so FD.data is already
  // there. This stays a promise so its callers below are unchanged, and it still
  // rejects when FD.data is missing: the load path turns that into the screen's
  // 'cannot reach fleetdeck' card rather than throwing mid-render.
  function ensureData() {
    return FD.data ? Promise.resolve(FD.data) : Promise.reject(new Error('FD.data is not loaded'));
  }

  // --- state, loading and the 60 s poll ----------------------------------------
  var state = { cards: [], loading: false, poll: null, started: false, seq: 0, done: 0 };

  // DESIGN-35 binding instruction 2 (S2 shim audit F2): nothing leaves this file
  // unvalidated. Every field the template will touch is coerced to the type its binding
  // expects, so a shape change on /api/machines cannot throw inside renderVals and blank
  // all nine screens. A card that cannot be coerced is dropped, not rendered half-built.
  var str = function (v) { return typeof v === 'string' ? v : v == null ? '' : String(v); };

  function validate(cards) {
    if (!Array.isArray(cards)) return [];
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c || typeof c !== 'object') continue;
      out.push({
        name: str(c.name), kind: str(c.kind), sessions: str(c.sessions),
        reported: str(c.reported), host: str(c.host),
        status: c.status && typeof c.status === 'object'
          ? { label: str(c.status.label), text: str(c.status.text), copy: str(c.status.copy), tone: str(c.status.tone) }
          : null,
        cols: (Array.isArray(c.cols) ? c.cols : []).filter(Boolean).map(function (col) {
          return {
            client: str(col.client),
            sections: (Array.isArray(col.sections) ? col.sections : []).filter(Boolean).map(function (sc) {
              return {
                env: str(sc.env), name: str(sc.name), email: str(sc.email), note: str(sc.note),
                chips: (Array.isArray(sc.chips) ? sc.chips : []).filter(Array.isArray),
                bars: (Array.isArray(sc.bars) ? sc.bars : []).filter(Array.isArray),
              };
            }),
          };
        }),
      });
    }
    return out;
  }

  function publish() {
    state.cards = validate(state.cards);
    FD.setData('machinesLive', state.cards);
  }

  function setBusy(on) {
    state.loading = on;
    var btn = refreshButton();
    if (btn) btn.disabled = on;
  }

  // #refresh -> load(true); the poll never forces (BEHAVIOUR.md §3).
  function load(force) {
    if (isFixture()) return Promise.resolve();
    // The 60 s poll and a forced Refresh can be in flight together. Today's screen lets
    // whichever settles last win and re-enables its button either way; sequencing keeps
    // the newest answer and the button honest without changing anything else.
    var mine = ++state.seq;
    setBusy(true);
    return ensureData()
      .then(function (data) { return data.machines(force ? { refresh: true } : {}); })
      .then(function (payload) { if (mine > state.done) { state.done = mine; state.cards = toCards(payload, Date.now()); } })
      .catch(function () { if (mine > state.done) { state.done = mine; state.cards = [errorCard()]; } })
      .then(function () {
        if (mine === state.seq) setBusy(false);
        publish();
      });
  }

  // Entering the screen loads at once and starts the poll; leaving stops it. That is the
  // SPA's equivalent of today's page, where load() runs on script load and the interval
  // dies with the page (BEHAVIOUR.md §3). logic.js passes the flag.
  function sync(active) {
    if (isFixture()) return;
    if (active) start(); else stop();
  }

  function start() {
    if (state.started || isFixture()) return Promise.resolve();
    state.started = true;
    var first = load(false);
    // The poll never forces a collect: the deck's own TTL decides when the ssh fan-out reruns.
    ensureData().then(function (data) {
      if (!state.poll) state.poll = data.poll(function () { load(false); }, POLL_MS);
    }, function () { /* the first load already showed the error */ });
    return first;
  }

  function stop() {
    if (state.poll) { state.poll.stop(); state.poll = null; }
    // Cleared so re-entering the screen loads fresh rather than showing the age the rows
    // had when it was last left.
    state.started = false;
  }

  // --- after-render: the two things the compiled template cannot bind -----------
  // Called from AppLogic's componentDidMount/componentDidUpdate (logic.js). Anchors are the
  // compiled template's own data-dc-tpl ids — never a class grafted onto mock markup.
  var TPL = { card: '609', kindChip: '614', reported: '618', row: '623', note: '647', refresh: '241' };

  function screenEl() {
    return root.document && root.document.querySelector('[data-screen-label="Machines"]');
  }

  function refreshButton() {
    return root.document && root.document.querySelector('[data-dc-tpl="' + TPL.refresh + '"]');
  }

  // The header Refresh button carries no onClick in the compiled template, so the runtime
  // never touches this listener and the node survives re-renders by key. It stays inert on
  // every other screen because the Machines block is then not in the DOM (I-L9-02).
  function bindRefresh() {
    var btn = refreshButton();
    if (!btn || btn.__fdL9) return;
    btn.__fdL9 = true;
    btn.addEventListener('click', function () {
      if (!screenEl() || state.loading) return;
      load(true);
    });
  }

  // Nodes are reused by key, so this both sets AND clears: when a no-report machine
  // finally reports, its status row goes and the runtime hands that same node to the
  // first real client row. Leaving the tooltip and the listener behind would keep
  // copying a stale cron command from an unrelated row until a full reload.
  function syncCopy(el, text) {
    if (!el) return;
    if (!el.__fdCopyBound) {
      if (!text) return;
      el.__fdCopyBound = true;
      el.addEventListener('click', function () {
        if (el.__fdCopy && root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(el.__fdCopy);
      });
    }
    el.__fdCopy = text || '';
    if (text) { el.title = 'click to copy'; el.style.cursor = 'pointer'; }
    else { el.removeAttribute('title'); el.style.cursor = ''; }
  }

  function afterRender() {
    if (isFixture()) return;
    bindRefresh();
    var scope = screenEl();
    if (!scope) return;
    var cards = scope.querySelectorAll(':scope > [data-dc-tpl="' + TPL.card + '"]');
    for (var i = 0; i < cards.length; i++) {
      // sc-for rows are positional (audit F1), so every value below is rewritten from
      // the model on EVERY render rather than accumulated. A DOM card with no model left
      // must not keep the mock's literal, so it is cleared rather than skipped.
      var model = state.cards[i] || { reported: '', kind: '', status: null };
      // I-L9-01: the template hard-codes "reported just now"; live mode writes the real value
      // into that same span. The runtime rewrites the text node on every flush, so this runs
      // after every render, in the same synchronous pass — the mock's string never paints.
      var rep = cards[i].querySelector('[data-dc-tpl="' + TPL.reported + '"]');
      if (rep && rep.textContent !== model.reported) rep.textContent = model.reported;
      // I-L9-06: the error card has no kind, and an empty chip is still a chip.
      var chip = cards[i].querySelector('[data-dc-tpl="' + TPL.kindChip + '"]');
      if (chip) chip.style.display = model.kind ? '' : 'none';
      // I-L9-04: the push command is copyable, as it is today (machines.js:165-170).
      // Run unconditionally so a card that stops having a status row is cleaned up.
      var row = cards[i].querySelector('[data-dc-tpl="' + TPL.row + '"]');
      var note = row && row.querySelector('[data-dc-tpl="' + TPL.note + '"]');
      syncCopy(note, model.status && model.status.copy ? model.status.copy : '');
    }
  }

  FD.screens.machines = {
    // Internal wiring, not a cross-slice hook: this slice publishes none.
    afterRender: afterRender,
    sync: sync,
    load: load,
    start: start,
    stop: stop,
    // Pure functions, exposed for test/v2-machines.test.js.
    _: { ago: ago, sampleAge: sampleAge, until: until, freshness: freshness, section: section,
      colsOf: colsOf, statusOf: statusOf, kindOf: kindOf, sessionChip: sessionChip,
      toCards: toCards, errorCard: errorCard, windowNames: windowNames, validate: validate,
      state: state,
      CLIENTS: CLIENTS, PROOF: PROOF, STATE: STATE, TIER: TIER, WIN_LABEL: WIN_LABEL,
      WIN_ORDER: WIN_ORDER, POLL_MS: POLL_MS, FETCH_ERROR: FETCH_ERROR },
  };

  // Claim the data seam at load, before any render: logic.js falls back to the mock's seed
  // while `machinesLive` is absent, so without this a live page paints fabricated machines
  // and logins ('Reiner Garrecht', 'neelo@vibe.trading') on the first frame the screen is
  // shown. Publishing an empty list costs no request — the poll still waits for sync(true).
  if (root.document && !isFixture()) publish();
  if (typeof module === 'object' && module.exports) module.exports = FD.screens.machines;
})(typeof globalThis === 'object' ? globalThis : this);
