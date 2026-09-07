// fd-v2 L6 bus: owned by that slice.
//
// Message bus threads + reply toast (ledger D13, D08). This file is the live
// controller for the Message bus screen: it fetches, adapts and pushes data in
// through FD.setData, and it owns every side effect the mock only simulates --
// send, retry, the inbound poll, unread, pins and the nav badge.
//
// In fixture mode it does NOTHING: `live` stays false, FD.setData is never
// called and no timer starts, so the compiled logic renders FD.fixture as-is
// and the pixel gate is untouched (DESIGN-35 broadcast, 2026-09-07).
//
// Hooks PROVIDED: FD.screens.bus.open(target)
// Hooks USED (always guarded): FD.shell.setBadge (L2), FD.screens.windows.openMax (L3)
//
// Behaviour spec: docs/goals/fd-v2-l6/BEHAVIOUR.md. Improvisations are recorded
// in docs/design/fleetdeck-v2/improvised.md as I-L6-01 .. I-L6-12.
(function (global) {
  'use strict';

  var FD = global.FD = global.FD || {};
  FD.screens = FD.screens || {};
  var bus = FD.screens.bus = FD.screens.bus || {};

  // BEHAVIOUR section 7. Both keys are new in v2 -- today's bus stores nothing.
  var SEEN_KEY = 'fd-bus-seen';
  var PINNED_KEY = 'fd-bus-pinned';
  // L12: the rail's filter/group/sort preferences (improvised.md I-L12-01, I-L12-04).
  var FILTERS_KEY = 'fd-bus-filters';
  // L12: which rail group headers the user has collapsed (improvised.md I-L12-07).
  var COLLAPSED_KEY = 'fd-bus-collapsed';
  // BEHAVIOUR section 7: 15 s while the bus screen is open, 60 s on the app shell.
  var POLL_OPEN_MS = 15000;
  var POLL_SHELL_MS = 60000;
  // D08: the reply toast auto-dismisses after 7 s (mock L769-780).
  var TOAST_MS = 7000;
  // BEHAVIOUR section 1: GET /api/messages?limit=50.
  var LIMIT = 50;
  // The full Claude conversation of a desktop seat. Rendering it walks a .jsonl on the
  // owning machine, so it refreshes no faster than this however often the bus polls.
  var TRANSCRIPT_MS = 10000;
  // Only the tail is merged into the thread; the rest is announced as a count.
  var MAX_TURNS = 300;

  var DESKTOP = 'claude-desktop';
  var TMUX = 'tmux';
  var ID_PREFIX = 'id:';

  // ---------------------------------------------------------------------------
  // State. `host` is the AppLogic instance logic.js hands us on mount.
  // ---------------------------------------------------------------------------
  var host = null;
  var timer = null;
  var toastTimer = null;
  var lastFetch = 0;
  var inFlight = false;
  var pendingOpen = null;

  var targets = {};        // thread id -> {type, host?, session} for the POST body
  var kinds = {};          // thread id -> 'tmux' | 'claude-desktop'
  var rows = [];           // busSessions rows currently pushed to FD.fixture
  var threads = {};        // thread id -> adapted messages, oldest first
  var known = {};          // thread id -> { messageId: true }, for new-inbound detection
  var seen = {};           // fd-bus-seen
  var pinned = {};         // fd-bus-pinned, as a set
  var collapsed = {};      // fd-bus-collapsed: '<grouping>|<label>' -> true
  var booted = false;      // has one poll ever landed
  var provisional = {};    // targets opened by hook before the server knows them
  var desktopTitles = null;// cliSessionId / session id -> human title
  var desktopProjects = null;// cliSessionId / session id -> project (I-L12-06)
  var desktopLive = null;  // cliSessionId / session id -> live
  var titlesPromise = null;
  var errs = {};           // message key -> receipt error string we own
  var transcripts = {};    // thread id -> {state, turns, omitted, at}
  var wantId = null;       // the one thread whose transcript is being shown
  var transcriptAt = 0;
  var transcriptFor = null; // the id whose fetch is in flight, so another id is not starved
  var sentIds = {};        // client send key -> [server message id], for pruning

  // ---------------------------------------------------------------------------
  // Storage. Never throws: private mode and Node both leave the defaults.
  // ---------------------------------------------------------------------------
  function readStore(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { global.localStorage.setItem(key, value); } catch (e) { /* nothing to write to */ }
  }
  function readJson(key, fallback) {
    var raw = readStore(key);
    if (raw === null) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return parsed === null || typeof parsed !== 'object' ? fallback : parsed;
    } catch (e) { return fallback; }
  }
  function loadPrefs() {
    seen = readJson(SEEN_KEY, {});
    filters = sanitiseFilters(readJson(FILTERS_KEY, null));
    collapsed = sanitiseCollapsed(readJson(COLLAPSED_KEY, null));
    var list = readJson(PINNED_KEY, []);
    pinned = {};
    if (Array.isArray(list)) list.forEach(function (id) { pinned[id] = true; });
  }
  function savePinned() {
    writeStore(PINNED_KEY, JSON.stringify(Object.keys(pinned).filter(function (id) { return pinned[id]; })));
  }

  // ---------------------------------------------------------------------------
  // L12 filters. One stored object, sanitised on every read: an unknown value
  // becomes the default rather than a grouping the rail has no bucket for.
  // ---------------------------------------------------------------------------
  var FILTER_DEFAULTS = { status: 'all', env: 'all', group: 'recent', sort: 'activity', empty: false };
  var FILTER_VALUES = {
    status: ['all', 'live', 'offline'],
    env: ['all', 'desktop', 'box'],
    group: ['recent', 'host', 'project', 'env', 'status', 'grp', 'none'],
    sort: ['activity', 'name', 'status'],
  };

  function sanitiseFilters(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    Object.keys(FILTER_VALUES).forEach(function (k) {
      out[k] = FILTER_VALUES[k].indexOf(src[k]) >= 0 ? src[k] : FILTER_DEFAULTS[k];
    });
    out.empty = !!src.empty;
    return out;
  }

  var filters = sanitiseFilters(null);

  // A hand-edited or half-written store must not put a non-string key or a
  // falsy value into the map every render then reads.
  function sanitiseCollapsed(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    Object.keys(src).forEach(function (k) { if (k && src[k]) out[k] = true; });
    return out;
  }
  function collapseKey(grouping, label) { return grouping + '|' + label; }

  // ---------------------------------------------------------------------------
  // Thread identity. L1's toThreads keys a thread by the OTHER party: the target
  // session for a message we sent, the source session for a message we received
  // (data.js:297-316). We key the same way so the adapter's `threads` object and
  // ours agree -- see I-L6-01.
  // ---------------------------------------------------------------------------
  var isSessionSource = function (s) { return typeof s === 'string' && s.indexOf(':') > 0; };
  var sourceSession = function (s) { return s.slice(s.indexOf(':') + 1); };
  var sourceHost = function (s) { return s.slice(0, s.indexOf(':')); };

  function threadIdOf(msg) {
    var t = msg && msg.target ? msg.target : {};
    return isSessionSource(msg.source) ? sourceSession(msg.source) : t.session;
  }
  function inboundOf(msg) { return isSessionSource(msg.source); }

  // ---------------------------------------------------------------------------
  // L12 "Group by - Project". A box session names its project in its own session
  // name prefix; this fleet's convention, one entry per repo (I-L12-06). Add a
  // prefix here and every LC-/FD-style row picks it up.
  // ---------------------------------------------------------------------------
  var PROJECT_PREFIXES = { LC: 'lowcap-connector', FD: 'remote-system' };
  // Display names for repos whose directory is not what the fleet calls them.
  // Applied last, to both row kinds at once, so a rename stays one line here
  // and the derivation above keeps naming the real directory (operator, 2026-09-07).
  var PROJECT_ALIAS = { 'remote-system': 'fleetdeck' };

  function aliasProject(p) { return p ? (PROJECT_ALIAS[p] || p) : ''; }

  function projectOfName(name) {
    if (typeof name !== 'string') return '';
    var i = name.indexOf('-');
    if (i <= 0) return '';
    return aliasProject(PROJECT_PREFIXES[name.slice(0, i).toUpperCase()] || '');
  }

  // A desktop seat names its project in its cwd. Worktrees live under
  // <repo>/.claude/worktrees/<slug>, so the repo root is everything before
  // '/.claude/' and the project is that directory's own name.
  function projectOfCwd(cwd) {
    if (typeof cwd !== 'string' || !cwd) return '';
    var root = cwd.split('/.claude/')[0].replace(/\/+$/, '');
    return aliasProject(root.slice(root.lastIndexOf('/') + 1));
  }

  function desktopProject(id) {
    if (!desktopProjects) return '';
    var key = id.indexOf(ID_PREFIX) === 0 ? id.slice(ID_PREFIX.length) : id;
    return desktopProjects[key] || '';
  }

  // The mock's rail label. BEHAVIOUR section 2 quotes the old <option> labels
  // verbatim: "Claude Desktop <dot> <label||'current chat'>" and
  // "<host> <dot> <session>". The rail prints name and host in separate slots,
  // so the tmux label is just the session name and `host` fills the meta slot
  // (I-L6-02).
  function labelFor(id, kind) {
    if (kind !== DESKTOP) return id;
    if (id === 'current') return 'Claude Desktop · current chat';
    // 'id:<cliSessionId>' is the API's messageTarget form, resolved at delivery
    // (server.js). It is a uuid, so show the session's own title when we know
    // it and fall back to the raw form when we do not (I-L6-13).
    if (id.indexOf(ID_PREFIX) === 0) {
      var title = desktopTitles && desktopTitles[id.slice(ID_PREFIX.length)];
      return 'Claude Desktop · ' + (title || id);
    }
    return 'Claude Desktop · ' + id;
  }

  // Fetched once, on first sight of an 'id:<uuid>' target. /api/desktop-sessions
  // is the only place the title lives; a failure just leaves the raw id showing.
  function ensureDesktopTitles() {
    if (titlesPromise) return titlesPromise;
    if (!bus.live || !FD.data || typeof FD.data.desktopSessions !== 'function') return null;
    titlesPromise = FD.data.desktopSessions().then(function (res) {
      var map = {};
      var alive = {};
      var proj = {};
      ((res && res.groups) || []).forEach(function (g) {
        ((g && g.sessions) || []).forEach(function (x) {
          if (!x) return;
          var p = projectOfCwd(x.cwd);
          if (x.cliSessionId) { if (x.title) map[x.cliSessionId] = x.title; if (x.live) alive[x.cliSessionId] = true; if (p) proj[x.cliSessionId] = p; }
          if (x.id) { if (x.title) map[x.id] = x.title; if (x.live) alive[x.id] = true; if (p) proj[x.id] = p; }
        });
      });
      desktopTitles = map;
      desktopLive = alive;
      desktopProjects = proj;
      restampRows();
    }).catch(function () { desktopTitles = desktopTitles || {}; desktopLive = desktopLive || {}; desktopProjects = desktopProjects || {}; });
    return titlesPromise;
  }

  function desktopIsLive(id) {
    if (!desktopLive || id.indexOf(ID_PREFIX) !== 0) return false;
    return !!desktopLive[id.slice(ID_PREFIX.length)];
  }

  function restampRows() {
    if (!rows.length) return;
    var changed = false;
    var next = rows.map(function (r) {
      var kind = r.kind || TMUX;
      var name = labelFor(r.id, kind);
      var live = kind === DESKTOP && desktopIsLive(r.id) ? true : r.live;
      var project = kind === DESKTOP ? (desktopProject(r.id) || r.project) : r.project;
      if (name === r.name && live === r.live && project === r.project) return r;
      changed = true;
      var copy = Object.assign({}, r, { name: name, live: live });
      if (project) copy.project = project; else delete copy.project;
      return copy;
    });
    if (!changed) return;
    rows = next;
    FD.setData('busSessions', validRows(rows));
  }

  // ---------------------------------------------------------------------------
  // Building the rail from /api/messages + /api/sessions.
  // ---------------------------------------------------------------------------
  function noteTarget(id, target, kind) {
    if (!id) return;
    if (!targets[id]) targets[id] = target;
    if (!kinds[id]) kinds[id] = kind;
  }

  function build(messagesRes, sessionsRes, now) {
    var list = (messagesRes && messagesRes.messages) || [];
    var declared = (messagesRes && messagesRes.targets) || [];
    var live = (sessionsRes && sessionsRes.sessions) || [];

    targets = {};
    kinds = {};

    // 1. Targets the server offers (server.js:2333-2340). A desktop session only
    //    appears here while it is live, which is the only liveness signal the
    //    desktop side has (I-L6-03).
    var offered = {};
    declared.forEach(function (t) {
      if (!t || !t.session) return;
      noteTarget(t.session, t, t.type || DESKTOP);
      offered[t.session] = true;
    });

    // 2. Targets and sources the message history knows about. This runs before
    //    the live-session merge so an existing conversation keeps the host it
    //    actually happened on: L1 keys a thread by session name alone, so a
    //    same-named session on another box must not capture the thread, nor
    //    make it look live (I-L6-11).
    list.forEach(function (m) {
      var id = threadIdOf(m);
      if (!id) return;
      if (inboundOf(m)) noteTarget(id, { type: TMUX, host: sourceHost(m.source), session: id }, TMUX);
      else noteTarget(id, m.target, (m.target && m.target.type) || TMUX);
    });

    // 3. Every live fleet tmux session, merged client-side exactly as today's
    //    app.js:920-925 does. Liveness is keyed by host AND name.
    var liveSet = {};
    var groupOf = {};
    live.forEach(function (s) {
      if (!s || !s.name) return;
      // The registry's own lane name, keyed like liveness, for "Group by · Group"
      // (I-L12-03). Recorded for dead sessions too: the rail still shows them.
      if (typeof s.group === 'string' && s.group) groupOf[s.host + ' ' + s.name] = s.group;
      if (!s.live) return;
      liveSet[s.host + ' ' + s.name] = true;
      noteTarget(s.name, { type: TMUX, host: s.host, session: s.name }, TMUX);
    });

    // 3b. Targets opened through FD.screens.bus.open() that the server does not
    //     know yet. today's setBusTarget() keeps its stored value until a
    //     matching option appears, so the provisional row survives the poll that
    //     would otherwise drop it (I-L6-08).
    Object.keys(provisional).forEach(function (id) {
      noteTarget(id, provisional[id], provisional[id].type || TMUX);
    });

    // 4. The adapter owns the per-message shape (L1, data.js:317-334). Its thread
    //    arrays come out newest-first because /api/messages is created_at DESC,
    //    while the mock's seedThreads are oldest-first and the thread body
    //    scrolls to the bottom -- so each array is reversed (I-L6-04).
    var adapted = FD.data.toThreads(messagesRes, now);
    threads = {};
    Object.keys(adapted.threads).forEach(function (id) {
      threads[id] = adapted.threads[id].slice().reverse();
    });

    // 5. The rail: one row per thread id we know of, from any of the four sources.
    var ids = {};
    Object.keys(targets).forEach(function (id) { ids[id] = true; });
    Object.keys(threads).forEach(function (id) { ids[id] = true; });
    adapted.busSessions.forEach(function (s) { ids[s.id] = true; });

    rows = Object.keys(ids).map(function (id) {
      var kind = kinds[id] || TMUX;
      var target = targets[id] || { type: kind, session: id };
      var hostName = kind === DESKTOP ? '' : (target.host || '');
      var row = {
        id: id,
        name: labelFor(id, kind),
        host: hostName,
        // targets[] is the liveness signal for a named desktop session; the
        // id:<uuid> form never appears there, so /api/desktop-sessions answers
        // for it (I-L6-13).
        live: kind === DESKTOP ? (!!offered[id] || desktopIsLive(id)) : !!liveSet[hostName + ' ' + id],
      };
      // The mock's rows carry `pinned` and isPinned() falls back to it, so the
      // stored pin set needs no logic.js branch at all.
      if (pinned[id]) row.pinned = true;
      // Extra key, absent from every fixture row, so the branches that read it
      // are provably inert in fixture mode.
      row.kind = kind;
      var grp = groupOf[hostName + ' ' + id];
      if (grp) row.group = grp;
      // Same whitelist rule as `group`: set only when it is a non-empty string.
      var project = kind === DESKTOP ? desktopProject(id) : projectOfName(id);
      if (project) row.project = project;
      return row;
    });

    // 6. Unread, from the raw rows: inbound messages newer than fd-bus-seen
    //    (BEHAVIOUR section 7). Computed off created_at, not the humanised `at`.
    var unread = {};
    var fresh = {};
    list.forEach(function (m) {
      var id = threadIdOf(m);
      if (!id) return;
      if (!fresh[id]) fresh[id] = {};
      fresh[id][m.id] = true;
      if (!inboundOf(m)) return;
      var mark = seen[id];
      if (mark && !(Date.parse(m.created_at) > Date.parse(mark))) return;
      unread[id] = (unread[id] || 0) + 1;
    });

    return { rows: rows, threads: threads, unread: unread, fresh: fresh, list: list };
  }

  // ---------------------------------------------------------------------------
  // Validation. DESIGN-35 (binding, 2026-09-08): validate BEFORE FD.setData,
  // because one throw inside any slice's renderVals blanks every screen. Nothing
  // reaches FD.fixture until it has exactly the types the compiled logic reads:
  // a row is four strings-and-a-boolean, a message is the adapter's key set with
  // `at` a string and `m` a finite number. A row that cannot be coerced is
  // dropped rather than rendered half-formed (I-L6-10).
  // ---------------------------------------------------------------------------
  var str = function (v) { return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)); };

  function validRow(r) {
    if (!r || typeof r !== 'object' || !r.id) return null;
    var out = { id: str(r.id), name: str(r.name) || str(r.id), host: str(r.host), live: !!r.live };
    if (r.pinned) out.pinned = true;
    if (r.kind) out.kind = str(r.kind);
    if (typeof r.group === 'string' && r.group) out.group = r.group;
    if (typeof r.project === 'string' && r.project) out.project = r.project;
    return out.id ? out : null;
  }

  function validMessage(m) {
    if (!m || typeof m !== 'object' || typeof m.text !== 'string') return null;
    var out = {
      k: str(m.k),
      dir: m.dir === 'in' ? 'in' : 'out',
      from: str(m.from),
      at: str(m.at),
      m: Number.isFinite(m.m) ? m.m : 0,
    };
    if (!out.k) return null;
    if (out.dir === 'out') {
      if (m.per && typeof m.per === 'object') out.per = m.per;
      else {
        out.status = str(m.status) || 'queued';
        if (m.err !== undefined && m.err !== null) out.err = str(m.err);
      }
    }
    out.text = m.text;
    return out;
  }

  var TRANSCRIPT_STATES = { loading: 1, ok: 1, not_found: 1, unavailable: 1 };

  function validTurn(t) {
    if (!t || typeof t !== 'object' || typeof t.text !== 'string') return null;
    if (t.role !== 'user' && t.role !== 'assistant') return null;
    return { role: t.role, ts: str(t.ts), text: t.text };
  }

  function validTranscript(v) {
    var turns = [];
    (Array.isArray(v && v.turns) ? v.turns : []).forEach(function (t) { var x = validTurn(t); if (x) turns.push(x); });
    var omitted = Math.max(0, turns.length - MAX_TURNS);
    return {
      state: TRANSCRIPT_STATES[v && v.state] ? v.state : 'unavailable',
      turns: turns.slice(omitted),
      omitted: omitted,
      at: Number.isFinite(v && v.at) ? v.at : 0,
    };
  }

  function validTranscripts(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (id) { out[id] = validTranscript(map[id]); });
    return out;
  }

  function validRows(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (r) { var v = validRow(r); if (v) out.push(v); });
    return out;
  }

  function validThreads(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (id) {
      var arr = [];
      (Array.isArray(map[id]) ? map[id] : []).forEach(function (m) { var v = validMessage(m); if (v) arr.push(v); });
      out[id] = arr;
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Pushing into the render. Data enters ONLY through FD.setData, validated.
  // ---------------------------------------------------------------------------
  function push(built) {
    FD.setData('busSessions', validRows(built.rows));
    FD.setData('seedThreads', validThreads(built.threads));
    // The API has no group concept (L1, data.js:311), so the mock's hard-coded
    // train-84 group is replaced by an empty list; ad-hoc broadcast groups stay
    // client-side in AppLogic.state.adhoc (I-L6-05).
    FD.setData('busGroups', []);
    FD.setData('busUnreadDefault', built.unread);
    if (!FD.fixture.busActiveDefault && built.rows.length) {
      FD.setData('busActiveDefault', built.rows[0].id);
    }
  }

  // ---------------------------------------------------------------------------
  // The full Claude conversation behind a thread -- a Claude Desktop seat, or a
  // fleet tmux worker -- merged into the thread by logic.js. Only the wanted
  // thread is ever fetched, and only while it is wanted.
  // ---------------------------------------------------------------------------

  // A tmux session name means nothing on its own: the same name can run on two
  // boxes, so the machine rides along and the route resolves the pair. A desktop
  // seat's thread id is already unique, and sends no host at all.
  function transcriptHost(id) {
    var target = targets[id];
    return kinds[id] === TMUX && target && target.host ? target.host : '';
  }

  function canTranscribe(id) {
    if (!id) return false;
    if (kinds[id] === DESKTOP) return true;
    return kinds[id] === TMUX && !!transcriptHost(id);
  }

  function setTranscript(id, value) {
    transcripts = Object.assign({}, transcripts);
    transcripts[id] = Object.assign({ at: Date.now() }, value);
    FD.setData('busTranscripts', validTranscripts(transcripts));
  }

  function fetchTranscript(force) {
    var id = wantId;
    if (!id || transcriptFor === id || !canTranscribe(id)) return;
    if (!force && Date.now() - transcriptAt < TRANSCRIPT_MS) return;
    // The thread id is the seat's handle either way -- 'id:<uuid>' from the Desktop screen,
    // otherwise its display name -- and the server resolves both (server.js desktopSeat).
    transcriptFor = id;
    transcriptAt = Date.now();
    FD.data.transcript(id, transcriptHost(id)).then(function (res) {
      if (wantId !== id) return;
      var state = TRANSCRIPT_STATES[res && res.state] && res.state !== 'loading' ? res.state : 'unavailable';
      setTranscript(id, { state: state, turns: state === 'ok' ? res.turns : [] });
    }).catch(function () {
      if (wantId === id) setTranscript(id, { state: 'unavailable', turns: [] });
    }).then(function () { if (transcriptFor === id) transcriptFor = null; });
  }

  function totalUnread(unread) {
    return Object.keys(unread).reduce(function (a, k) { return a + (unread[k] || 0); }, 0);
  }

  // ---------------------------------------------------------------------------
  // Fetch + apply.
  // ---------------------------------------------------------------------------
  function activeId() {
    if (!host) return null;
    return host.state.busActive || FD.fixture.busActiveDefault || null;
  }

  // The thread the user can actually SEE arriving. A selected thread is only
  // visible while the bus screen itself is on-screen -- once they navigate to
  // Accounts, a reply on that same thread still needs the toast. Reading
  // busActive alone suppressed exactly the case D08 exists for. This mirrors
  // the mock's own rule in arrive(): viewing = screen is bus AND busActive is
  // this session (logic.js).
  function visibleThread() {
    return busOpen() ? activeId() : null;
  }

  function busOpen() {
    if (!host) return false;
    var root = host.host;
    var view = root && root.state ? root.state.view : 'app';
    if (view !== 'app') return false;
    var screen = host.state.screen != null ? host.state.screen
      : (host.props && host.props.screen != null ? host.props.screen : 'bus');
    return screen === 'bus';
  }

  function refresh() {
    if (!bus.live || inFlight) return Promise.resolve();
    inFlight = true;
    lastFetch = Date.now();
    return Promise.all([
      FD.data.messages({ limit: LIMIT }),
      // Liveness only. A failure here must not blank the rail, so it degrades
      // to "no live sessions known" rather than rejecting the whole poll.
      FD.data.sessions().catch(function () { return { sessions: [] }; }),
    ]).then(function (res) {
      apply(res[0], res[1]);
    }).catch(function (e) {
      // A dead /api/messages leaves the last good rail on screen; the next tick
      // retries. Nothing is written to the console -- the live gate asserts zero
      // console errors.
      bus.lastError = e;
      bus.polls++;
    }).then(function () { inFlight = false; });
  }

  function apply(messagesRes, sessionsRes) {
    bus.polls++;
    var now = Date.now();
    var previous = known;
    var built = build(messagesRes, sessionsRes, now);
    var visible = visibleThread();

    // A new inbound row raises the reply toast (D08) unless the user is looking
    // straight at that thread. Only rows the previous poll had not seen count,
    // so the first poll after a reload never fires one.
    var toast = null;
    if (booted) {
      for (var i = built.list.length - 1; i >= 0; i--) {
        var m = built.list[i];
        var id = threadIdOf(m);
        if (!id || !inboundOf(m)) continue;
        if (previous[id] && previous[id][m.id]) continue;
        if (id === visible) continue;
        var row = matchRow(built.rows, id);
        toast = { sid: id, from: row ? row.name : id, text: m.text };
      }
    }
    known = built.fresh;
    booted = true;

    push(built);
    bus.setBadge(totalUnread(built.unread));

    if (!host) return;
    host.setState(function (s) {
      var next = { unread: built.unread };
      // Drop the optimistic copy of a message the server has now confirmed,
      // correlated by source + text (BEHAVIOUR section 7, broadcast rule).
      var ex = s.extraMsgs || {};
      var pruned = {};
      var changed = false;
      var confirmed = {};
      Object.keys(ex).forEach(function (tid) {
        var server = built.threads[tid] || [];
        pruned[tid] = ex[tid].filter(function (msg) {
          // Prefer the id POST /api/messages handed back for this send; fall
          // back to source + text, which is the only correlation available for
          // a message whose POST has not answered yet.
          var dup = (msg.srvIds || []).some(function (id) { return serverKnows(built.fresh, id); })
            || server.some(function (sm) { return sm.dir === 'out' && sm.text === msg.text && sm.from === msg.from; });
          if (dup) { changed = true; confirmed[msg.k] = true; }
          return !dup;
        });
      });
      if (changed) next.extraMsgs = pruned;
      // A status the server now reports wins over our optimistic override. The
      // override is keyed by the CLIENT key ('x<ts>', or 'x<ts>:<target>' for a
      // broadcast leg), which never equals a server id -- so an override is
      // dropped when the send it belongs to has been confirmed, and only a key
      // that IS a server id (a retry) is matched against the response directly.
      // Without this, state.stOv grew for the life of the session.
      var stOv = s.stOv || {};
      var keptSt = {};
      var stChanged = false;
      Object.keys(stOv).forEach(function (k) {
        var mid = k.split(':')[0];
        if (confirmed[mid] || serverKnows(built.fresh, mid)) { stChanged = true; delete errs[k]; delete sentIds[mid]; return; }
        keptSt[k] = stOv[k];
      });
      if (stChanged) next.stOv = keptSt;
      if (toast) next.toast = toast;
      return next;
    });
    if (toast) armToast(toast);
  }

  function matchRow(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function serverKnows(fresh, id) {
    var keys = Object.keys(fresh);
    for (var i = 0; i < keys.length; i++) if (fresh[keys[i]][id]) return true;
    return false;
  }

  function armToast(toast) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (!host) return;
      host.setState(function (s) { return s.toast && s.toast.sid === toast.sid ? { toast: null } : {}; });
    }, TOAST_MS);
  }

  // ---------------------------------------------------------------------------
  // The poll. One timer: it fires every 15 s and only actually fetches on the
  // shell once a minute has passed, which is the two cadences BEHAVIOUR section 7
  // asks for without a second interval to keep in step (I-L6-06).
  // ---------------------------------------------------------------------------
  function tick() {
    if (!bus.live) return;
    if (busOpen()) {
      refresh();
      // busActive also moves through a toast and a broadcast send, neither of which passes
      // through the rail's own off-toggle. Left alone the poll would outlive the thread it
      // belongs to, so it disarms itself once that thread is no longer the open one.
      if (wantId && wantId !== activeId()) wantId = null;
      fetchTranscript(false);
      return;
    }
    if (Date.now() - lastFetch >= POLL_SHELL_MS) refresh();
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, POLL_OPEN_MS);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Receipts. The mock has no toast slot for the four send/retry strings
  // BEHAVIOUR sections 2 and 3 quote, so they land verbatim in the message's own
  // receipt line instead -- receipt() already renders `status . error` (I-L6-07).
  // ---------------------------------------------------------------------------
  function setReceipt(sid, key, status, err) {
    if (err === undefined) err = null;
    if (err === null) delete errs[key]; else errs[key] = err;
    if (host) {
      host.setState(function (s) {
        var stOv = Object.assign({}, s.stOv || {});
        stOv[key] = status;
        var ex = s.extraMsgs || {};
        var next = {};
        var changed = false;
        Object.keys(ex).forEach(function (tid) {
          next[tid] = ex[tid].map(function (m) {
            if (m.k !== key) return m;
            changed = true;
            var copy = Object.assign({}, m);
            if (err === null) delete copy.err; else copy.err = err;
            return copy;
          });
        });
        var out = { stOv: stOv };
        if (changed) out.extraMsgs = next;
        return out;
      });
    }
    // A server-side message lives in seedThreads, which only FD.setData reaches.
    if (threads[sid]) {
      var patched = threads[sid].map(function (m) {
        if (m.k !== key) return m;
        var copy = Object.assign({}, m);
        if (err === null) delete copy.err; else copy.err = err;
        return copy;
      });
      threads = Object.assign({}, threads);
      threads[sid] = patched;
      FD.setData('seedThreads', validThreads(threads));
    }
  }

  // Record the id POST /api/messages returned for one send, on the optimistic
  // message it belongs to. A broadcast is N POSTs behind ONE optimistic message
  // whose leg keys are '<key>:<target>', so the ids accumulate on that message.
  function noteServerId(key, id) {
    var base = String(key).split(':')[0];
    sentIds[base] = (sentIds[base] || []).concat([id]);
    if (!host) return;
    host.setState(function (s) {
      var ex = s.extraMsgs || {};
      var next = {};
      var changed = false;
      Object.keys(ex).forEach(function (tid) {
        next[tid] = ex[tid].map(function (m) {
          if (m.k !== base) return m;
          var ids = (m.srvIds || []);
          if (ids.indexOf(id) >= 0) return m;
          changed = true;
          return Object.assign({}, m, { srvIds: ids.concat([id]) });
        });
      });
      return changed ? { extraMsgs: next } : {};
    });
  }

  // {ok:false,error} bodies are displayed verbatim (BEHAVIOUR section 6).
  function errText(e) {
    if (!e) return 'unknown error';
    var body = e.body;
    if (body && typeof body === 'object' && body.error) return String(body.error);
    if (typeof body === 'string' && body) return body;
    return e.message || 'unknown error';
  }

  // ---------------------------------------------------------------------------
  // The seam logic.js calls. Each returns true when it took the action, so the
  // fixture path falls through to the mock's own simulation.
  // ---------------------------------------------------------------------------
  bus.live = false;
  // Polls that have completed, successfully or not. The live gate waits on it
  // so an empty API is not indistinguishable from a poll that never returned.
  bus.polls = 0;

  // Idempotent: logic.js calls this from componentDidMount AND every
  // componentDidUpdate, and bus.js calls it itself on load if the app mounted
  // first. Whoever gets there first wins; the rest are no-ops.
  bus.attach = function (h) {
    if (!h || host === h) { if (host && bus.live) start(); return; }
    host = h;
    if (!bus.live) return;
    drainPendingOpen();
    start();
    startFilterUi();
  };

  function drainPendingOpen() {
    if (!pendingOpen) return;
    var p = pendingOpen;
    pendingOpen = null;
    bus.open(p);
  }

  bus.detach = function (h) {
    // A stale instance's unmount must not kill the live host's poll timer and
    // filter UI. A detach with no host named is still an unconditional teardown.
    if (h != null && host != null && host !== h) return;
    host = null;
    stop();
    stopFilterUi();
  };

  // BEHAVIOUR section 2: POST /api/messages {source, target, text}; ok ->
  // delivered, else "Delivery failed: <error||'unknown error'>".
  bus.deliver = function (req) {
    if (!bus.live) return false;
    var target = targets[req.sid];
    if (!target) {
      setReceipt(req.sid, req.key, 'failed', 'Delivery failed: unknown target');
      // Refresh like every other exit from deliver(): the rail may simply be
      // stale, and the next poll is what learns the target.
      refresh();
      return true;
    }
    FD.data.sendMessage({ source: req.source, target: target, text: req.text })
      .then(function (res) {
        // Record the id the server gave this send so the optimistic copy and
        // its status override can be pruned by identity, not by text.
        if (res && res.id) noteServerId(req.key, res.id);
        if (res && res.ok) setReceipt(req.sid, req.key, 'delivered', null);
        else setReceipt(req.sid, req.key, 'failed', 'Delivery failed: ' + ((res && res.error) || 'unknown error'));
      })
      .catch(function (e) {
        setReceipt(req.sid, req.key, 'failed', 'Delivery failed: ' + errText(e));
      })
      .then(function () { return refresh(); });
    return true;
  };

  // BEHAVIOUR section 3: POST /api/messages/retry {id}; "Retry failed: <error>".
  bus.retry = function (req) {
    if (!bus.live) return false;
    FD.data.retryMessage(req.key)
      .then(function (res) {
        if (res && res.ok) setReceipt(req.sid, req.key, 'delivered', null);
        else setReceipt(req.sid, req.key, 'failed', 'Retry failed: ' + ((res && res.error) || 'unknown error'));
      })
      .catch(function (e) {
        setReceipt(req.sid, req.key, 'failed', 'Retry failed: ' + errText(e));
      })
      .then(function () { return refresh(); });
    return true;
  };

  // logic.js's 'Full conversation' toggle. Off stops the refetch; on restarts from
  // 'loading', so the thread carries a note from the first frame rather than nothing.
  bus.wantTranscript = function (id, on) {
    if (!bus.live) return false;
    if (!on) { if (wantId === id) wantId = null; scheduleApply(); return true; }
    if (!canTranscribe(id)) return false;
    wantId = id;
    // 'loading' before the request, so the thread shows a note instead of nothing while a
    // fetch is in flight -- and so every path out of fetchTranscript ends in some state.
    setTranscript(id, { state: 'loading', turns: [] });
    fetchTranscript(true);
    return true;
  };

  bus.markSeen = function (id) {
    if (!bus.live || !id) return false;
    seen = Object.assign({}, seen);
    seen[id] = new Date().toISOString();
    writeStore(SEEN_KEY, JSON.stringify(seen));
    var unread = Object.assign({}, FD.fixture.busUnreadDefault || {});
    delete unread[id];
    FD.setData('busUnreadDefault', unread);
    bus.setBadge(totalUnread(unread));
    return true;
  };

  bus.setPinned = function (id, on) {
    if (!bus.live || !id) return false;
    if (on) pinned[id] = true; else delete pinned[id];
    savePinned();
    // Re-stamp the rows so isPinned()'s fallback to row.pinned agrees with the
    // stored set even after the next poll replaces them.
    rows = rows.map(function (r) {
      if (r.id !== id) return r;
      var copy = Object.assign({}, r);
      if (on) copy.pinned = true; else delete copy.pinned;
      return copy;
    });
    FD.setData('busSessions', validRows(rows));
    return true;
  };

  // ---------------------------------------------------------------------------
  // L12 shaping. Pure: logic.js hands in the rail objects it is about to render
  // plus the two things only it knows (the pin overrides and each thread's age),
  // and gets back the label/items buckets the compiled template already draws.
  // Filters apply to sessions only -- a broadcast group is a thing the user made
  // and is never filtered away.
  // ---------------------------------------------------------------------------
  var LAST_LABEL = { 'No group': true, 'No project': true };
  // The last shape() result, label -> {key, count, collapsed}. The DOM pass
  // decorates headers the runtime drew, not ones it computed, so it reads this.
  var lastShape = {};

  function passesFilters(x, f) {
    if (f.status === 'live' && !x.live) return false;
    if (f.status === 'offline' && x.live) return false;
    if (f.env === 'desktop' && x.kind !== DESKTOP) return false;
    if (f.env === 'box' && x.kind === DESKTOP) return false;
    return true;
  }

  function comparatorFor(sort, lastM) {
    // `m` is minutes-ago, so ascending is most-recent-first and a row with no
    // thread at all sorts last.
    var age = function (x) { var m = lastM(x.id); return m === null || m === undefined ? Infinity : m; };
    var byAge = function (a, b) { var va = age(a), vb = age(b); return va === vb ? 0 : (va < vb ? -1 : 1); };
    if (sort === 'name') return function (a, b) { return str(a.name).localeCompare(str(b.name)); };
    if (sort === 'status') return function (a, b) { return (b.live ? 1 : 0) - (a.live ? 1 : 0) || byAge(a, b); };
    return byAge;
  }

  bus.filters = function () { return Object.assign({}, filters); };

  bus.isFilterDirty = function () {
    return Object.keys(FILTER_DEFAULTS).some(function (k) { return filters[k] !== FILTER_DEFAULTS[k]; });
  };

  bus.setFilters = function (patch) {
    // Live-only, like markSeen/setPinned/deliver/retry. attach() stores the host
    // before its own live check, so without this a fixture-mode call would write
    // storage and force a re-render on the page the pixel gate captures.
    if (!bus.live) return bus.filters();
    filters = sanitiseFilters(Object.assign({}, filters, patch || {}));
    writeStore(FILTERS_KEY, JSON.stringify(filters));
    // L6.2 publishes the host on FD.screens.busHost, so a menu drawn before the
    // attach landed can still adopt it.
    if (!host && FD.screens && FD.screens.busHost) bus.attach(FD.screens.busHost);
    if (host) {
      if (typeof host.forceUpdate === 'function') host.forceUpdate();
      else host.setState({});
    } else {
      // No host at all: re-pushing the rows is the only re-render we can ask
      // for, and it is the data the rail shapes.
      FD.setData('busSessions', validRows(rows));
    }
    applyFilterUi();
    return bus.filters();
  };

  bus.collapsed = function () { return Object.assign({}, collapsed); };

  // Live-only and re-rendered exactly like setFilters: the rail is redrawn from
  // shape(), which reads `collapsed` on its way out.
  bus.toggleCollapsed = function (label) {
    if (!bus.live || !label) return;
    var key = collapseKey(filters.group, label);
    if (collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
    writeStore(COLLAPSED_KEY, JSON.stringify(collapsed));
    if (!host && FD.screens && FD.screens.busHost) bus.attach(FD.screens.busHost);
    if (host) {
      if (typeof host.forceUpdate === 'function') host.forceUpdate();
      else host.setState({});
    } else {
      FD.setData('busSessions', validRows(rows));
    }
    applyFilterUi();
  };

  bus.shape = function (items, ctx) {
    ctx = ctx || {};
    var f = sanitiseFilters(ctx.filters || filters);
    var isPinned = typeof ctx.isPinned === 'function' ? ctx.isPinned : function (x) { return !!x.pinned; };
    var lastM = typeof ctx.lastM === 'function' ? ctx.lastM : function () { return null; };
    var notPinned = function (x) { return !isPinned(x); };
    var cmp = comparatorFor(f.sort, lastM);
    // Collapsing empties a bucket's items but never removes the bucket: the
    // header is the only way back, so `count` is taken BEFORE the emptying and
    // the empty-bucket rule below runs on the expanded list (I-L12-07).
    var decorate = function (out) {
      var map = {};
      var list = out.map(function (g) {
        var key = collapseKey(f.group, g.label);
        var shut = !!collapsed[key];
        map[g.label] = { key: key, count: g.items.length, collapsed: shut };
        return { label: g.label, items: shut ? [] : g.items, count: g.items.length, collapsed: shut };
      });
      lastShape = map;
      return list;
    };
    var list = (Array.isArray(items) ? items : []).filter(function (x) { return x && (x.members || passesFilters(x, f)); });
    // Every bucket but the recent grouping's own Pinned/Recent split floats its
    // pins to the top; Array#sort is stable, so equal rows keep their order.
    var bucket = function (arr) { return arr.filter(isPinned).sort(cmp).concat(arr.filter(notPinned).sort(cmp)); };
    // An empty bucket is only worth keeping where the labels are a fixed set --
    // "Live / Offline" reads as a scale, "german-box" with nothing under it does not.
    var keep = function (out, fixed) {
      return f.empty && fixed ? out : out.filter(function (g) { return g.items.length; });
    };

    if (f.group === 'recent') {
      return decorate(keep([
        { label: 'Pinned', items: list.filter(isPinned).sort(cmp) },
        { label: 'Recent', items: list.filter(notPinned).sort(cmp) },
      ], true));
    }

    var groups = list.filter(function (x) { return x.members; });
    var sessions = list.filter(function (x) { return !x.members; });
    var out = groups.length ? [{ label: 'Broadcasts', items: bucket(groups) }] : [];
    if (f.group === 'none') return decorate(out.concat(keep([{ label: 'Sessions', items: bucket(sessions) }], false)));

    var order = null;
    var labelOf;
    if (f.group === 'host') labelOf = function (x) { return x.kind === DESKTOP ? 'Claude Desktop' : (x.host || 'Unknown host'); };
    else if (f.group === 'project') labelOf = function (x) { return x.project || 'No project'; };
    else if (f.group === 'env') { labelOf = function (x) { return x.kind === DESKTOP ? 'Claude Desktop' : 'Box sessions'; }; order = ['Claude Desktop', 'Box sessions']; }
    else if (f.group === 'status') { labelOf = function (x) { return x.live ? 'Live' : 'Offline'; }; order = ['Live', 'Offline']; }
    else labelOf = function (x) { return x.group || 'No group'; };

    var by = {};
    sessions.forEach(function (x) {
      var l = labelOf(x);
      if (!by[l]) by[l] = [];
      by[l].push(x);
    });
    var labels = order || Object.keys(by).sort(function (a, b) {
      // 'No group' / 'No project' collect the unassigned, so they sit after the
      // named lanes rather than wherever the alphabet would put them.
      if (LAST_LABEL[a]) return 1;
      if (LAST_LABEL[b]) return -1;
      return a.localeCompare(b);
    });
    return decorate(out.concat(keep(labels.map(function (l) { return { label: l, items: bucket(by[l] || []) }; }), !!order)));
  };

  // ---------------------------------------------------------------------------
  // The hook this slice PROVIDES. BEHAVIOUR section 5 / ruling O8:
  // setBusTarget() becomes a deep link that selects (or creates) the thread for
  // {type, host?, session} and navigates to the bus screen.
  // ---------------------------------------------------------------------------
  // Accepts every target the server accepts: a tmux host+session, a
  // claude-desktop session by name, the 'id:<cliSessionId>' form the API hands
  // back as messageTarget, and 'current'. A bare string is taken as a thread id.
  // Returns false ONLY for a malformed target.
  function normalizeTarget(target) {
    if (typeof target === 'string') {
      if (!target) return null;
      // No type given: 'current' and 'id:<uuid>' can only be desktop; anything
      // else is a tmux session name, whose host the rail supplies if it knows it.
      var known = targets[target];
      if (known) return known;
      var guess = (target === 'current' || target.indexOf(ID_PREFIX) === 0) ? DESKTOP : TMUX;
      return guess === DESKTOP ? { type: DESKTOP, session: target } : { type: TMUX, session: target };
    }
    if (!target || typeof target !== 'object') return null;
    if (typeof target.session !== 'string' || !target.session) return null;
    var type = target.type === DESKTOP ? DESKTOP : target.type === TMUX ? TMUX
      : (target.host ? TMUX : DESKTOP);
    var out = { type: type, session: target.session };
    if (type === TMUX && target.host) out.host = target.host;
    return out;
  }

  bus.open = function (target) {
    var t = normalizeTarget(target);
    if (!t) return false;
    var id = t.session;

    // The app may not have mounted yet, or this file may have loaded before the
    // shell published its host. Hold the request rather than dropping it; both
    // attach() and start2() drain it. The caller is told the link was accepted.
    if (!host) { pendingOpen = t; return true; }

    if (bus.live && !targets[id]) {
      // Today's setBusTarget stores the value and selects it on the next
      // loadBus() when the option does not exist yet; the v2 equivalent is a
      // provisional row that the next poll confirms or replaces (I-L6-08).
      var kind = t.type;
      targets[id] = t;
      kinds[id] = kind;
      provisional[id] = t;
      rows = rows.concat([{
        id: id,
        name: labelFor(id, kind),
        host: kind === DESKTOP ? '' : (t.host || ''),
        live: kind === DESKTOP && desktopIsLive(id),
        kind: kind,
      }]);
      FD.setData('busSessions', validRows(rows));
      if (!threads[id]) {
        threads = Object.assign({}, threads);
        threads[id] = [];
        FD.setData('seedThreads', validThreads(threads));
      }
    }
    if (t.type === DESKTOP && id.indexOf(ID_PREFIX) === 0) ensureDesktopTitles();

    var root = host.host;
    if (root && root.setState && root.state && root.state.view !== 'app') root.setState({ view: 'app' });
    host.setState(function (s) {
      var un = Object.assign({}, s.unread || {});
      delete un[id];
      return { screen: 'bus', busActive: id, unread: un, toast: null };
    });
    bus.markSeen(id);
    if (FD.router && typeof FD.router.navigate === 'function') {
      try { FD.router.navigate('bus'); } catch (e) { /* the hash is a nicety, not the navigation */ }
    }
    if (bus.live) refresh();
    return true;
  };

  // ---------------------------------------------------------------------------
  // Hooks this slice USES, wrapped once so every call site is guarded.
  // ---------------------------------------------------------------------------
  bus.setBadge = function (n) {
    var shell = FD.shell;
    if (shell && typeof shell.setBadge === 'function') { try { shell.setBadge(n); } catch (e) {} }
  };

  // A tmux row opens the live terminal through L3. Until L3 lands this returns
  // false and the caller falls back to the mock's own full-screen terminal.
  bus.openMax = function (hostName, session) {
    var w = FD.screens && FD.screens.windows;
    if (w && typeof w.openMax === 'function') {
      try { w.openMax(hostName, session); return true; } catch (e) {}
    }
    return false;
  };

  // ---------------------------------------------------------------------------
  // The 'Full conversation' toggle, injected into the thread header.
  //
  // The compiled template renders one frozen glyph per action flag, so a new header
  // button cannot come from logic.js at all -- it is a find-or-create DOM patch, the
  // same improvisation screens/desktop.js makes for UI the mock cannot express, with
  // that file's safety rig against audit F5: the tgObserver is disconnected around our
  // own writes AND honours an `tgApplying` flag, and applies are counted per macrotask
  // so a write/observe loop halts instead of spinning the tab.
  //
  // No state lives in the node: the button is re-derived from `wantId` and the open
  // thread on every apply, so a reconciler sweep that drops it self-heals on the next
  // render. Live mode only -- startToggle() is called from start2().
  // ---------------------------------------------------------------------------
  var BTN_ATTR = 'data-fd-l6';
  // A document with lines: visibly neither the eye beside it nor the clipboard after it.
  var BTN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>'
    + '<path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path></svg>';
  // The active-button look, which is what logic.js's onBtn is (logic.js:454, :467, :976).
  var ACTIVE = {
    dark: 'background:rgba(255,255,255,0.11);border-color:rgba(255,255,255,0.22);color:#ffffff',
    light: 'background:rgba(0,0,0,0.07);border-color:rgba(0,0,0,0.18);color:#111111',
  };
  var MAX_APPLIES_PER_TASK = 50;
  var tgObserver = null;
  var tgApplying = false;
  var applyQueued = false;
  var applyCount = 0;
  var applyHalted = false;

  // The eye is the anchor: the new button goes immediately after it, which is before
  // the clipboard, and its inline style is the sibling style to copy. The eye wears
  // logic.js's offBtn on a row with no terminal, so the two keys offBtn adds are
  // overridden back -- what is left is iconBtn either way.
  function eyeButton() {
    if (typeof document === 'undefined') return null;
    var screen = document.querySelector('[data-screen-label="Message bus"]');
    return screen ? screen.querySelector('button[aria-label="Show session"]') : null;
  }

  function toggleTranscript() {
    var id = activeId();
    if (!id) return;
    var on = wantId !== id;
    if (!bus.wantTranscript(id, on)) return;
    if (host) host.setState({ busTranscript: on ? id : null });
  }

  function applyToggle() {
    var eye = eyeButton();
    var slot = eye && eye.parentNode;   // the tooltip wrapper the template puts round it
    var row = slot && slot.parentNode;  // the header's action row
    var id = activeId();
    var btn = row ? row.querySelector('button[' + BTN_ATTR + ']') : null;
    if (!row || !canTranscribe(id)) {
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.setAttribute(BTN_ATTR, 'transcript');
      btn.innerHTML = BTN_SVG;
      btn.addEventListener('click', toggleTranscript);
    }
    if (btn.previousSibling !== slot) row.insertBefore(btn, slot.nextSibling);
    var on = wantId === id;
    // Re-read every apply: a light/dark flip rewrites the sibling's inline style, and a
    // button that copied it once at creation would stay on the old theme.
    var css = eye.style.cssText + ';opacity:1;cursor:pointer' + (on ? ';' + ACTIVE[host && host.isDark && host.isDark() ? 'dark' : 'light'] : '');
    if (btn.__fdSrc !== css || btn.style.cssText !== btn.__fdOut) {
      btn.style.cssText = css;
      btn.__fdSrc = css;
      btn.__fdOut = btn.style.cssText;
    }
    var label = on ? 'Bus only' : 'Full conversation';
    if (btn.getAttribute('title') !== label) {
      btn.setAttribute('title', label);
      btn.setAttribute('aria-label', label);
    }
  }

  function scheduleApply() {
    if (tgApplying || applyHalted || applyQueued) return;
    applyQueued = true;
    // A microtask, so it lands after the runtime's own flush (queued first by setData).
    Promise.resolve().then(function () { applyQueued = false; safeApply(); });
  }

  function safeApply() {
    if (tgApplying || applyHalted) return;
    if (applyCount === 0) {
      // The budget refills on the next macrotask; 50 applies inside one task is a loop.
      setTimeout(function () { applyCount = 0; applyHalted = false; }, 0);
    }
    if (++applyCount > MAX_APPLIES_PER_TASK) {
      applyHalted = true;
      if (global.console) {
        global.console.error('[fd-v2 l6] apply() ran ' + MAX_APPLIES_PER_TASK
          + ' times in one task; stopping until the next task (audit F5)');
      }
      return;
    }
    tgApplying = true;
    if (tgObserver) tgObserver.disconnect(); // our own writes must not re-trigger us
    try {
      applyToggle();
    } catch (err) {
      if (global.console) global.console.error('[fd-v2 l6] the Full conversation button failed', err);
    }
    tgApplying = false;
    if (tgObserver) observe();
  }

  function observe() {
    var el = document.getElementById('dc-root') || document.body;
    if (el && tgObserver) tgObserver.observe(el, { childList: true, subtree: true });
  }

  function startToggle() {
    if (tgObserver || typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
    // The callback ignores records raised by our own writes; disconnect() already empties
    // the queue, this is the belt to that pair of braces.
    tgObserver = new MutationObserver(function () { if (!tgApplying) scheduleApply(); });
    observe();
    scheduleApply();
  }

  // ---------------------------------------------------------------------------
  // L12 filter menu. Live only, and injected rather than templated: the compiled
  // template is frozen, so the button is built next to Select and re-applied from
  // a MutationObserver every time the runtime re-renders the rail (I-L12-02).
  // Every node is found before it is made, and the observer is disconnected while
  // we write so our own DOM never re-triggers us.
  // ---------------------------------------------------------------------------
  var observer = null;
  var applying = false;
  var menuOpen = false;
  var menuSection = null;   // which accordion section is expanded, or null
  var menuSig = null;       // the state the menu's children were built from
  var winBound = false;

  var SECTIONS = [
    { key: 'status', title: 'Status', opts: [['all', 'All'], ['live', 'Live'], ['offline', 'Offline']] },
    { key: 'env', title: 'Environment', opts: [['all', 'All'], ['desktop', 'Claude Desktop'], ['box', 'Box']] },
    null,
    { key: 'group', title: 'Group by', opts: [['recent', 'Pinned & recent'], ['host', 'Host'], ['project', 'Project'], ['env', 'Environment'], ['status', 'Status'], ['grp', 'Group'], ['none', 'None']] },
    { key: 'sort', title: 'Sort by', opts: [['activity', 'Last activity'], ['name', 'Name'], ['status', 'Live first']] },
  ];

  var ROW_CSS = 'display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border-radius:7px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;text-align:left;';
  var CHEVRON_SVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
    + '<polyline points="9 6 15 12 9 18"></polyline></svg>';
  var SLIDERS_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
    + '<path d="M4 7h16"></path><path d="M4 17h16"></path>'
    + '<circle cx="9" cy="7" r="2"></circle><circle cx="15" cy="17" r="2"></circle></svg>';

  // Mirrors screens/desktop.js restyle(): the theme toggle rewrites the source's
  // inline style, so it is re-read on every apply rather than copied once.
  function restyle(node, css, extra) {
    if (css === null || css === undefined) return;
    var want = css + extra;
    if (node.__fdBusSrc === want && node.style.cssText === node.__fdBusOut) return;
    node.style.cssText = want;
    node.__fdBusSrc = want;
    node.__fdBusOut = node.style.cssText;
  }

  function railBar() {
    var input = document.querySelector('input[placeholder="Find a session"]');
    return input && input.parentNode ? input : null;
  }

  function isDarkNow(input) {
    if (host && typeof host.isDark === 'function') { try { return !!host.isDark(); } catch (e) {} }
    // Fallback: light ink means a dark surface behind it.
    var m = /(\d+)\D+(\d+)\D+(\d+)/.exec(global.getComputedStyle(input).color || '');
    return m ? (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) > 140 : true;
  }

  function menuRow(menu, label, right, opts) {
    var b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = ROW_CSS + (opts.indent ? 'padding-left:22px;' : '');
    var name = document.createElement('span');
    name.style.cssText = 'flex:1;min-width:0;';
    name.textContent = label;
    b.appendChild(name);
    if (right) {
      var v = document.createElement('span');
      v.style.cssText = 'opacity:.55;';
      v.textContent = right;
      b.appendChild(v);
    }
    if (opts.chev) {
      var c = document.createElement('span');
      c.style.cssText = 'opacity:.55;';
      c.textContent = '›';
      b.appendChild(c);
    }
    b.addEventListener('click', opts.onClick);
    menu.appendChild(b);
  }

  function divider(menu, line) {
    var d = document.createElement('div');
    d.style.cssText = 'height:1px;margin:4px 2px;background:' + line + ';';
    menu.appendChild(d);
  }

  function labelOfValue(section) {
    var value = filters[section.key];
    for (var i = 0; i < section.opts.length; i++) if (section.opts[i][0] === value) return section.opts[i][1];
    return '';
  }

  function buildMenu(menu, line) {
    menu.textContent = '';
    SECTIONS.forEach(function (sec) {
      if (!sec) { divider(menu, line); return; }
      menuRow(menu, sec.title, labelOfValue(sec), {
        chev: true,
        onClick: function (e) {
          e.stopPropagation();
          menuSection = menuSection === sec.key ? null : sec.key;
          applyFilterUi();
        },
      });
      if (menuSection !== sec.key) return;
      sec.opts.forEach(function (o) {
        menuRow(menu, o[1], filters[sec.key] === o[0] ? '✓' : '', {
          indent: true,
          onClick: function (e) {
            e.stopPropagation();
            var patch = {};
            patch[sec.key] = o[0];
            bus.setFilters(patch);
          },
        });
      });
    });
    divider(menu, line);
    menuRow(menu, 'Show empty groups', filters.empty ? '✓' : '', {
      onClick: function (e) { e.stopPropagation(); bus.setFilters({ empty: !filters.empty }); },
    });
    divider(menu, line);
    // The menu stays open: clearing is something the user watches happen.
    menuRow(menu, 'Clear filters', '', {
      onClick: function (e) { e.stopPropagation(); bus.setFilters(FILTER_DEFAULTS); },
    });
  }

  function drawFilterUi() {
    var input = railBar();
    // The bus screen is conditionally rendered, so leaving it removes the rail
    // bar and our nodes with it. Forget the open state now: otherwise coming
    // back re-draws the menu open, expanded, with nothing having been clicked.
    if (!input) { menuOpen = false; menuSection = null; menuSig = null; return; }
    var bar = input.parentNode;
    var select = bar.querySelector('button[title="Pick several sessions for a broadcast"]');

    var wrap = bar.querySelector('span[data-fd-bus="filter-wrap"]');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.setAttribute('data-fd-bus', 'filter-wrap');
    }
    wrap.style.cssText = 'position:relative;display:inline-flex;flex-shrink:0;';
    if (bar.lastChild !== wrap) bar.appendChild(wrap);

    var btn = wrap.querySelector('button[data-fd-bus="filter"]');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-fd-bus', 'filter');
      btn.title = 'Filter sessions';
      btn.setAttribute('aria-label', 'Filter sessions');
      btn.innerHTML = SLIDERS_SVG;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        menuOpen = !menuOpen;
        applyFilterUi();
      });
      wrap.appendChild(btn);
    }
    restyle(btn, select ? select.style.cssText : null, 'padding:6px 8px;position:relative;');
    btn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');

    var dot = btn.querySelector('span[data-fd-bus="filter-dot"]');
    if (bus.isFilterDirty()) {
      if (!dot) {
        dot = document.createElement('span');
        dot.setAttribute('data-fd-bus', 'filter-dot');
        dot.style.cssText = 'position:absolute;top:4px;right:4px;width:5px;height:5px;border-radius:50%;background:currentColor;';
        btn.appendChild(dot);
      }
    } else if (dot) btn.removeChild(dot);

    if (!document.querySelector('style[data-fd-bus="filter-style"]')) {
      var st = document.createElement('style');
      st.setAttribute('data-fd-bus', 'filter-style');
      st.textContent = '[data-fd-bus="filter-menu"] button:hover{background:rgba(128,128,128,0.16)}';
      document.head.appendChild(st);
    }

    var menu = wrap.querySelector('div[data-fd-bus="filter-menu"]');
    if (!menuOpen) {
      if (menu) wrap.removeChild(menu);
      menuSig = null;
      return;
    }
    // Theme colours are read from the search input on EVERY apply: the light/dark
    // toggle rewrites its inline style, and a menu that cached them goes invisible.
    var cs = global.getComputedStyle(input);
    var line = cs.borderColor;
    var dark = isDarkNow(input);
    if (!menu) {
      menu = document.createElement('div');
      menu.setAttribute('data-fd-bus', 'filter-menu');
      wrap.appendChild(menu);
      menuSig = null;
    }
    var css = 'position:absolute;top:calc(100% + 8px);right:0;z-index:5;width:240px;border-radius:10px;border:1px solid ' + line
      + ';background:' + (dark ? 'rgba(18,18,18,0.94)' : 'rgba(255,255,255,0.96)')
      + ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);'
      + 'padding:6px;display:flex;flex-direction:column;gap:1px;box-shadow:0 10px 30px rgba(0,0,0,0.3);font-size:12px;color:' + cs.color + ';';
    if (menu.style.cssText !== css) menu.style.cssText = css;
    var sig = JSON.stringify([filters, menuOpen, menuSection, dark]);
    if (sig === menuSig) return;
    menuSig = sig;
    buildMenu(menu, line);
  }

  // ---------------------------------------------------------------------------
  // Collapsible group headers (I-L12-07). The rail's headers are compiled markup,
  // so they are decorated in place rather than templated: a chevron in front, the
  // bucket's count behind, and one click handler. The label is read back off the
  // header itself -- everything the runtime put there (a text node, or the
  // span.sc-interp it wraps an interpolation in) and nothing we injected -- so a
  // header the runtime re-used for another bucket still reports the right one.
  // ---------------------------------------------------------------------------
  function headerLabel(node) {
    var out = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1 && !c.getAttribute('data-fd-bus')) out += c.textContent;
    }
    return out.trim();
  }

  function decorateHeader(el) {
    var info = lastShape[headerLabel(el)];
    // Not a bucket we shaped: leave it exactly as the template drew it.
    if (!info) return;
    // Merged onto the template's own inline style, re-set on every apply so the
    // theme toggle's rewrite takes ours with it.
    el.style.cursor = 'pointer';
    el.style.userSelect = 'none';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '6px';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.setAttribute('aria-expanded', info.collapsed ? 'false' : 'true');

    var chev = el.querySelector('span[data-fd-bus="group-chevron"]');
    if (!chev) {
      chev = document.createElement('span');
      chev.setAttribute('data-fd-bus', 'group-chevron');
      chev.innerHTML = CHEVRON_SVG;
      el.insertBefore(chev, el.firstChild);
    }
    var chevCss = 'display:inline-flex;flex-shrink:0;transition:transform .15s;transform:rotate(' + (info.collapsed ? 0 : 90) + 'deg);';
    if (chev.style.cssText !== chevCss) chev.style.cssText = chevCss;

    var count = el.querySelector('span[data-fd-bus="group-count"]');
    if (!count) {
      count = document.createElement('span');
      count.setAttribute('data-fd-bus', 'group-count');
      count.style.cssText = 'margin-left:auto;opacity:.55;';
      el.appendChild(count);
    }
    var n = String(info.count);
    if (count.textContent !== n) count.textContent = n;

    if (el.__fdBusHeader) return;
    el.__fdBusHeader = true;
    el.addEventListener('click', function () { bus.toggleCollapsed(headerLabel(el)); });
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      bus.toggleCollapsed(headerLabel(el));
    });
  }

  function drawGroupHeaders() {
    var input = railBar();
    if (!input || !input.parentNode) return;
    // The scroll container is the sibling after the search bar, and the rail's
    // group headers are its direct <span> children -- the rows are <div>s.
    var scroll = input.parentNode.nextElementSibling;
    if (!scroll) return;
    var kids = scroll.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === 'SPAN') decorateHeader(kids[i]);
    }
  }

  function applyFilterUi() {
    if (!bus.live || typeof document === 'undefined' || applying) return;
    applying = true;
    if (observer) observer.disconnect();
    // The rail matters more than its menu, and the live gate asserts a clean
    // console: a throw here is swallowed rather than logged or rethrown.
    try { drawFilterUi(); } catch (e) { /* nothing to draw */ }
    try { drawGroupHeaders(); } catch (e) { /* nothing to draw */ }
    applying = false;
    observeHost();
  }

  function observeHost() {
    if (!observer) return;
    // dc-root is the runtime's mount point (runtime.js mount()). Watching the
    // document instead would re-run this on every mutation in the app.
    var root = (host && host.rootEl) || document.getElementById('dc-root') || document;
    observer.observe(root, { childList: true, subtree: true });
  }

  function bindWindow() {
    if (winBound) return;
    winBound = true;
    global.addEventListener('keydown', function (e) {
      if (!menuOpen || e.key !== 'Escape') return;
      menuOpen = false;
      applyFilterUi();
    });
    global.addEventListener('mousedown', function (e) {
      if (!menuOpen) return;
      var wrap = document.querySelector('span[data-fd-bus="filter-wrap"]');
      if (wrap && wrap.contains(e.target)) return;
      menuOpen = false;
      applyFilterUi();
    });
  }

  function startFilterUi() {
    if (!bus.live || typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
    bindWindow();
    if (!observer) observer = new MutationObserver(function () { if (!applying) applyFilterUi(); });
    observeHost();
    applyFilterUi();
  }

  function stopFilterUi() {
    if (observer) observer.disconnect();
    observer = null;
    menuOpen = false;
    menuSection = null;
    menuSig = null;
  }

  // ---------------------------------------------------------------------------
  // Boot. Fixture mode stops here, before the first FD.setData.
  // ---------------------------------------------------------------------------
  bus.refresh = refresh;
  bus._state = function () {
    return { targets: targets, rows: rows, threads: threads, seen: seen, pinned: pinned, errs: errs, transcripts: transcripts, wantId: wantId };
  };

  // S2's shell (public/v2/index.html) loads runtime, fixture, logic, app and the
  // nine screen files, but never L1's public/v2/data.js -- nothing in the browser
  // does. The shell is not ours to edit, so the screen that needs the data layer
  // fetches it, once, and any other slice that does the same reuses this tag
  // (I-L6-09). Filed for the shell owner as DECK-71.
  var DATA_SRC = '/v2/data.js';
  function withDataLayer(cb) {
    if (FD.data) { cb(); return; }
    if (typeof document === 'undefined') return;
    var el = document.querySelector('script[data-fd-dep="data"]');
    if (!el) {
      el = document.createElement('script');
      el.setAttribute('data-fd-dep', 'data');
      el.src = DATA_SRC;
      document.head.appendChild(el);
    }
    var done = false;
    var fire = function () { if (done) return; done = true; if (FD.data) cb(); };
    el.addEventListener('load', fire);
    // A missing data layer means live mode is impossible. Stay inert rather than
    // throw: the live gate asserts zero console errors.
    el.addEventListener('error', function () { done = true; });
    if (FD.data) fire();
  }

  // Mirrors FD.data.isFixture() (data.js:isFixture) so the fixture page never
  // pays for a data.js request it will not use -- the pixel gate runs there and
  // an extra round trip is an extra way for it to differ.
  function fixtureMode() {
    try { if (global.localStorage.getItem('fd-fixture') === '1') return true; } catch (e) {}
    var search = global.location && global.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  function boot() {
    // Whether or not we go live, pick up an app that mounted before this file
    // loaded — the shell mounts inside app.js, ahead of every screen file.
    if (!host && FD.screens && FD.screens.busHost) bus.attach(FD.screens.busHost);
    if (fixtureMode()) return;
    withDataLayer(start2);
  }

  function start2() {
    if (!FD.data || FD.data.isFixture()) return;
    bus.live = true;
    loadPrefs();
    // Clear the mock's seed before the first paint so live mode never flashes
    // fixture threads; FD.setData schedules a re-render on the microtask queue.
    FD.setData('busSessions', []);
    FD.setData('seedThreads', {});
    FD.setData('busGroups', []);
    FD.setData('busUnreadDefault', {});
    FD.setData('busTranscripts', {});
    startToggle();
    refresh();
    // attach() also starts the timer, but it runs before the data layer has
    // loaded, so whichever of the two happens second does the work.
    if (!host && FD.screens && FD.screens.busHost) bus.attach(FD.screens.busHost);
    if (host) {
      drainPendingOpen();
      start();
    }
    // Outside the host branch on purpose: the menu must appear even if the
    // attach has not landed yet. The observer picks the rail up whenever the
    // runtime draws it.
    startFilterUi();
  }

  boot();
})(window);
