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
  // BEHAVIOUR section 7: 15 s while the bus screen is open, 60 s on the app shell.
  var POLL_OPEN_MS = 15000;
  var POLL_SHELL_MS = 60000;
  // D08: the reply toast auto-dismisses after 7 s (mock L769-780).
  var TOAST_MS = 7000;
  // BEHAVIOUR section 1: GET /api/messages?limit=50.
  var LIMIT = 50;

  var DESKTOP = 'claude-desktop';
  var TMUX = 'tmux';

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
  var booted = false;      // has one poll ever landed
  var provisional = {};    // targets opened by hook before the server knows them
  var errs = {};           // message key -> receipt error string we own
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
    var list = readJson(PINNED_KEY, []);
    pinned = {};
    if (Array.isArray(list)) list.forEach(function (id) { pinned[id] = true; });
  }
  function savePinned() {
    writeStore(PINNED_KEY, JSON.stringify(Object.keys(pinned).filter(function (id) { return pinned[id]; })));
  }

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

  // The mock's rail label. BEHAVIOUR section 2 quotes the old <option> labels
  // verbatim: "Claude Desktop <dot> <label||'current chat'>" and
  // "<host> <dot> <session>". The rail prints name and host in separate slots,
  // so the tmux label is just the session name and `host` fills the meta slot
  // (I-L6-02).
  function labelFor(id, kind) {
    return kind === DESKTOP ? 'Claude Desktop · ' + (id === 'current' ? 'current chat' : id) : id;
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
    live.forEach(function (s) {
      if (!s || !s.name || !s.live) return;
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
        live: kind === DESKTOP ? !!offered[id] : !!liveSet[hostName + ' ' + id],
      };
      // The mock's rows carry `pinned` and isPinned() falls back to it, so the
      // stored pin set needs no logic.js branch at all.
      if (pinned[id]) row.pinned = true;
      // Extra key, absent from every fixture row, so the branches that read it
      // are provably inert in fixture mode.
      row.kind = kind;
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
    if (busOpen()) { refresh(); return; }
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

  bus.attach = function (h) {
    host = h;
    if (!bus.live) return;
    if (pendingOpen) { var p = pendingOpen; pendingOpen = null; bus.open(p); }
    start();
  };

  bus.detach = function (h) {
    if (host === h) host = null;
    stop();
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
  // The hook this slice PROVIDES. BEHAVIOUR section 5 / ruling O8:
  // setBusTarget() becomes a deep link that selects (or creates) the thread for
  // {type, host?, session} and navigates to the bus screen.
  // ---------------------------------------------------------------------------
  bus.open = function (target) {
    var id = target && (typeof target === 'string' ? target : target.session);
    if (!id) return false;
    if (!host) { pendingOpen = target; return false; }

    if (bus.live && typeof target === 'object' && !targets[id]) {
      // Today's setBusTarget stores the value and selects it on the next
      // loadBus() when the option does not exist yet; the v2 equivalent is a
      // provisional row that the next poll confirms or replaces (I-L6-08).
      var kind = target.type || TMUX;
      targets[id] = target;
      kinds[id] = kind;
      provisional[id] = target;
      rows = rows.concat([{
        id: id,
        name: labelFor(id, kind),
        host: kind === DESKTOP ? '' : (target.host || ''),
        live: false,
        kind: kind,
      }]);
      FD.setData('busSessions', validRows(rows));
      if (!threads[id]) {
        threads = Object.assign({}, threads);
        threads[id] = [];
        FD.setData('seedThreads', validThreads(threads));
      }
    }

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
  // Boot. Fixture mode stops here, before the first FD.setData.
  // ---------------------------------------------------------------------------
  bus.refresh = refresh;
  bus._state = function () {
    return { targets: targets, rows: rows, threads: threads, seen: seen, pinned: pinned, errs: errs };
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
    refresh();
    // attach() also starts the timer, but it runs before the data layer has
    // loaded, so whichever of the two happens second does the work.
    if (host) {
      if (pendingOpen) { var p = pendingOpen; pendingOpen = null; bus.open(p); }
      start();
    }
  }

  boot();
})(window);
