// fd-v2 L4 registry: owned by that slice.
//
// The Registry screen (ledger row D12) on live rows. The spec is
// docs/goals/fd-v2-l4/BEHAVIOUR.md, extracted from public/app.js L440-830; every
// string, confirm, localStorage key and timer below is quoted from it, which is
// why they are written out in full instead of composed.
//
// Two modes, and the split is the whole design:
//
//   fixture mode (?fixture=1) — this file does nothing at all. The compiled
//     logic renders FD.fixture.regData exactly as the mock does, FD.setData is
//     never called, and the pixel gate passes unchanged (DESIGN-35, 2026-09-07).
//
//   live mode — this file owns the registry's state (rows, filter, sort,
//     selection, edits) and publishes one payload with FD.setData('l4', …).
//     logic.js reads FD.fixture.l4 and renders it through the mock's bindings.
//
// The compiled template binds only six registry handlers (A_setQ, A_resetFilters,
// A_clearSel, A_toggleAll, A_goBus and per-row r.toggle). The filter selects, the
// bulk Kill/Tag kill/Hide buttons, row "Show" and the row "⋯" button compile with
// no onClick at all, and template.dc.html is not ours to edit. Everything behind
// those controls is therefore attached here by progressive enhancement: one
// delegated listener on the document, plus a decoration pass that stamps its own
// data-l4-* hooks onto the mock's elements and re-applies itself after a render.
// No markup is hand-typed into the template, and in fixture mode not one of these
// listeners is installed.
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.screens = FD.screens || {};
  var registry = (FD.screens.registry = FD.screens.registry || {});

  var doc = global.document;

  // --------------------------------------------------------------- constants
  // BEHAVIOUR §2: the age menu, verbatim, and the filter defaults.
  var AGE = { '': 0, '1h': 36e5, '6h': 216e5, '1d': 864e5, '3d': 2592e5, '7d': 6048e5 };
  var AGE_KEYS = ['', '1h', '6h', '1d', '3d', '7d'];
  var FILTER0 = { q: '', live: '', status: '', msg: '', active: '' };
  // BEHAVIOUR §8: the five states the server accepts for a status write.
  var STATUSES = ['active', 'done', 'kill-requested', 'killed', 'hidden'];
  // BEHAVIOUR §1: re-tested here so no stored value can become an arbitrary href.
  var TASK_RE = /^[A-Z][A-Z0-9]*-\d+$/;
  var LINEAR_ISSUE = 'https://linear.app/synchronicity/issue/';
  // BEHAVIOUR §8: the keys stay exactly the ones today's app reads and writes.
  var K_FILTER = 'fleetFilter';
  var K_SORT = 'fleetSort';
  var K_TAB = 'fleetTab';
  // One table now, so the persisted per-tab sort keeps using the overview slot.
  var SORT_SLOT = 'overview';
  var EDITABLE = ['label', 'group', 'task', 'note'];

  // Sort accessors, mirroring COL.get in public/app.js:613-644. Only the seven
  // columns the mock's header actually shows are reachable by click; host, label,
  // role and note moved into the details row (ruling O3) and sort with them.
  var SORTS = {
    name: { get: function (s) { return s.name; } },
    host: { get: function (s) { return s.host; } },
    label: { get: function (s) { return s.label; } },
    role: { get: function (s) { return (s.role || s.worker) && s.role + '\t' + s.worker; } },
    group: { get: function (s) { return s.group; } },
    task: { get: function (s) { return s.task; } },
    note: { get: function (s) { return s.note; } },
    status: { get: function (s) { return s.status; } },
    active_at: { get: function (s) { return s.active_at; }, time: true },
    msg_at: { get: function (s) { return s.msg_at; }, time: true },
    last_seen_at: { get: function (s) { return s.last_seen_at; }, time: true }
  };
  // Header cell order in the mock, after the select-all button: template.dc.html:370.
  var HEAD_KEYS = ['name', 'group', 'task', 'status', 'active_at', 'msg_at', 'last_seen_at'];

  // ------------------------------------------------------------------- state
  var state = {
    started: false,
    sessions: [],       // last fetch, so a filter or sort change re-renders without a round trip
    view: [],           // filtered + sorted + adapted, exactly what the table shows
    filter: null,
    sort: null,         // { key, dir } or null = API order
    selected: {},       // host\0name -> true
    expanded: {},       // row id -> true, the improvised details row
    editing: null,      // { id, field } while a cell holds an input
    busy: {},           // row id -> true while one of its actions is in flight
    bulkBusy: false,
    t: null,            // theme tokens, handed over by logic.js on every render
    loading: false
  };

  var key = function (host, name) { return host + '\0' + name; };

  // Storage can be absent or disabled; a hand-mangled key must not take the
  // table down (public/app.js:653, :674 do the same).
  function readStore(k) {
    try { return global.localStorage.getItem(k); } catch (e) { return null; }
  }
  function writeStore(k, v) {
    try { global.localStorage.setItem(k, v); } catch (e) { /* nothing to write to */ }
  }
  function dropStore(k) {
    try { global.localStorage.removeItem(k); } catch (e) { /* nothing to write to */ }
  }

  function loadFilter() {
    var f = {}, k;
    for (k in FILTER0) f[k] = FILTER0[k];
    try {
      var saved = JSON.parse(readStore(K_FILTER));
      if (saved && typeof saved === 'object') for (k in FILTER0) if (typeof saved[k] === 'string') f[k] = saved[k];
    } catch (e) { /* swallowed, as today */ }
    return f;
  }

  function loadSort() {
    try {
      var saved = JSON.parse(readStore(K_SORT));
      // Also swallows the pre-tab { key, dir } shape: its tab entries are simply absent.
      if (saved && typeof saved === 'object' && saved[SORT_SLOT] && saved[SORT_SLOT].key) return saved[SORT_SLOT];
    } catch (e) { /* swallowed, as today */ }
    return null;
  }

  function saveSort() {
    var all = {};
    try {
      var saved = JSON.parse(readStore(K_SORT));
      if (saved && typeof saved === 'object') all = saved;   // keep the details slot the old app wrote
    } catch (e) { /* start from empty */ }
    if (state.sort) all[SORT_SLOT] = state.sort; else delete all[SORT_SLOT];
    writeStore(K_SORT, JSON.stringify(all));
  }

  // ------------------------------------------------------------ filter + sort
  var olderThan = function (iso, age) { return !age || !iso || Date.now() - Date.parse(iso) > age; };

  function filterSessions(list) {
    var f = state.filter;
    var q = f.q.trim().toLowerCase();
    return list.filter(function (s) {
      var text = [s.name, s.host, s.label, s.group, s.task, s.note, s.role, s.worker];
      return (!q || text.some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; })) &&
        (!f.live || (f.live === 'live') === Boolean(s.live)) &&
        (!f.status || s.status === f.status) &&
        olderThan(s.msg_at, AGE[f.msg]) &&
        olderThan(s.active_at, AGE[f.active]);
    });
  }

  function sortSessions(list) {
    var sort = state.sort;
    var col = sort && SORTS[sort.key];
    if (!col) return list;
    var sign = sort.dir === 'desc' ? -1 : 1;
    return list.slice().sort(function (a, b) {
      var x = col.get(a), y = col.get(b);
      // Unset values sink to the bottom in both directions — an unlabelled row is not "first".
      if (!x || !y) return x ? -1 : y ? 1 : 0;
      if (col.time) return sign * (Date.parse(x) - Date.parse(y));
      var l = String(x).toLowerCase(), r = String(y).toLowerCase();
      return sign * (l < r ? -1 : l > r ? 1 : 0);
    });
  }

  // The adapter is FD.data's (L1) and stays untouched; the fields it does not
  // carry — identity, the editable text, and the "gone · last seen" prefix
  // BEHAVIOUR §1 asks for — are merged on afterwards.
  function viewRows(list) {
    var adapted = FD.data.toRegistryRows({ sessions: list });
    return adapted.map(function (row, i) {
      var s = list[i];
      row.seen = (s.live ? '' : 'gone · last seen ') + FD.data.ago(s.last_seen_at);
      row.host = s.host;
      row.name = s.name;
      row.live = !!s.live;
      row.label = s.label || '';
      row.role = s.role || '';
      row.worker = s.worker || '';
      row.note = s.note || '';
      row.status = s.status;
      row.sel = !!state.selected[key(s.host, s.name)];
      row.busy = !!state.busy[row.id];
      row.expanded = !!state.expanded[row.id];
      // Pane activity ages into amber past an hour and red past a day
      // (public/app.js:452-461). The template binds ONE shared cellStyle to
      // Group/Active/Last msg/Last seen, so the tone is painted on in decorate().
      row.activeTone = ageTone(s.active_at);
      row.msgTone = ageTone(s.msg_at);
      return row;
    });
  }

  function ageTone(iso) {
    if (!iso) return '';
    var ms = Date.now() - Date.parse(iso);
    return ms > 864e5 ? 'red' : ms > 36e5 ? 'amber' : '';
  }

  function recompute() {
    // start() publishes before /v2/data.js has finished loading, so the first
    // payload is an empty table rather than a thrown adapter call.
    if (!FD.data || typeof FD.data.toRegistryRows !== 'function') {
      state.view = [];
      return state.view;
    }
    var filtered = sortSessions(filterSessions(state.sessions));
    // A row that left the registry — or that the filter now hides — must not stay
    // silently ticked for the next bulk run: what you see is exactly what a bulk
    // button acts on (public/app.js:714-716).
    var keys = {};
    filtered.forEach(function (s) { keys[key(s.host, s.name)] = true; });
    Object.keys(state.selected).forEach(function (k) { if (!keys[k]) delete state.selected[k]; });
    state.view = viewRows(filtered);
    return state.view;
  }

  // Hands the whole registry payload to the renderer. logic.js reads
  // FD.fixture.l4 fresh inside renderVals(), so the seam stays live.
  function publish() {
    recompute();
    var live = 0, gone = 0;
    state.view.forEach(function (r) { if (r.sel) { if (r.live) live++; else gone++; } });
    FD.setData('l4', {
      rows: state.view,
      total: state.sessions.length,
      q: state.filter.q,
      count: state.view.length === state.sessions.length
        ? String(state.sessions.length)
        : state.view.length + ' of ' + state.sessions.length,
      selLive: live,
      selGone: gone,
      sort: state.sort,
      loading: state.loading
    });
  }

  // ------------------------------------------------------------------- toasts
  // BEHAVIOUR §7: pending never auto-dismisses, ok goes at 3 s, err at 6 s, a
  // click dismisses. Styled from the mock's own reply toast (template.dc.html:769).
  var toastHost = null;

  function toastLayer() {
    if (toastHost && toastHost.isConnected) return toastHost;
    toastHost = doc.createElement('div');
    toastHost.id = 'fd-l4-toasts';
    toastHost.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:60;width:340px;' +
      'display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;';
    doc.body.appendChild(toastHost);
    return toastHost;
  }

  function toast(msg, kind) {
    var t = state.t || {};
    var el = doc.createElement('div');
    var dot = doc.createElement('span');
    var text = doc.createElement('span');
    var timer;
    el.appendChild(dot);
    el.appendChild(text);
    el.style.cssText = 'border-radius:12px;border:1px solid ' + (t.line || 'rgba(255,255,255,0.13)') + ';' +
      'background:' + (t.panel || 'rgba(20,20,20,0.92)') + ';backdrop-filter:blur(28px) saturate(150%);' +
      '-webkit-backdrop-filter:blur(28px) saturate(150%);box-shadow:0 12px 40px rgba(0,0,0,0.3);' +
      'padding:12px 14px;display:flex;align-items:center;gap:8px;cursor:pointer;pointer-events:auto;';
    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;flex-shrink:0;';
    text.style.cssText = 'font-size:12.5px;line-height:1.5;color:' + (t.ink || '#fff') + ';' +
      'overflow-wrap:anywhere;';
    el.onclick = function () { el.remove(); };  // an error toast can be cleared before its 6 s are up
    toastLayer().appendChild(el);
    var set = function (message, k) {
      text.textContent = message;
      dot.style.background = k === 'err' ? (t.bad || '#e5484d') : k === 'ok' ? (t.good || '#30a46c') : (t.warn || '#f5a623');
      clearTimeout(timer);
      if (k !== 'pending') timer = setTimeout(function () { el.remove(); }, k === 'err' ? 6000 : 3000);
    };
    set(msg, kind);
    return set;
  }

  // ------------------------------------------------------------------ loading
  // data.js is not in the shell's script list, so the screen brings it in itself
  // the first time it needs live rows. Flagged for L2 in REPORT.md.
  function ensureData() {
    if (FD.data) return Promise.resolve(FD.data);
    if (ensureData._p) return ensureData._p;
    ensureData._p = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = '/v2/data.js';
      s.onload = function () { FD.data ? resolve(FD.data) : reject(new Error('FD.data did not load')); };
      s.onerror = function () { reject(new Error('cannot load /v2/data.js')); };
      doc.head.appendChild(s);
    });
    return ensureData._p;
  }

  // BEHAVIOUR §7: reload after every edit save/escape, every row action (ok or
  // fail) and after each bulk batch. Filter and sort changes never refetch, and
  // nothing polls (data.js:591-594 — the registry is manual).
  function loadSessions() {
    state.loading = true;
    return ensureData()
      .then(function () { return FD.data.sessions(); })
      .then(function (res) {
        state.sessions = (res && res.sessions) || [];
        state.loading = false;
        publish();
      })
      .catch(function (err) {
        state.loading = false;
        publish();
        toast('sessions not loaded: ' + (err && err.message ? err.message : 'unknown error'), 'err');
      });
  }

  registry.reload = loadSessions;

  // ------------------------------------------------------------------ actions
  function post(fn, row) {
    return ensureData().then(function () { return fn(row); }).then(function (r) {
      return r && typeof r === 'object' ? r : { ok: true };
    }).catch(function (err) {
      var body = err && err.body;
      return { ok: false, error: (body && body.error) || (err && err.message) || 'unknown error' };
    });
  }

  // Every action is an ssh round trip of seconds. The row's buttons stay disabled
  // until the re-fetch lands, so a second click cannot fire a duplicate kill.
  function run(row, pending, ok, fail, req) {
    if (state.busy[row.id]) return Promise.resolve();
    var done = toast(pending, 'pending');
    state.busy[row.id] = true;
    publish();
    return req().then(function (r) {
      done(r.ok ? ok : fail + (r.stderr || r.error || 'unknown error'), r.ok ? 'ok' : 'err');
      return loadSessions();
    }).then(function () {
      delete state.busy[row.id];
      publish();
    });
  }

  function setStatus(row, status, pending, ok) {
    return run(row, pending, ok, 'status not saved: ', function () {
      return post(FD.data.registryUpsert, { host: row.host, name: row.name, status: status });
    });
  }

  var actions = {
    show: function (row) {
      // BEHAVIOUR §5: no POST, no toast. L3 owns the maximised view; until it
      // lands the guard makes this a silent no-op rather than a thrown error.
      registry.openMax(row.host, row.name);
    },
    message: function (row) {
      // Ruling O8: deep-link into the bus thread. L6 owns the bus.
      registry.openBus({ type: 'tmux', host: row.host, session: row.name });
    },
    kill: function (row) {
      if (!global.confirm('Kill tmux session ' + row.name + ' on ' + row.host +
        '?\n\nIrreversible — everything running in it dies.')) return;
      run(row, 'Killing ' + row.name + '…', 'Killed ' + row.name, 'kill failed: ', function () {
        return post(FD.data.kill, { host: row.host, name: row.name });
      });
    },
    tag: function (row) {
      return row.status === 'kill-requested'
        ? setStatus(row, 'active', 'Untagging ' + row.name + '…', 'Untagged ' + row.name)
        : setStatus(row, 'kill-requested', 'Tagging ' + row.name + '…', 'Tagged ' + row.name + ' for kill');
    },
    hide: function (row) {
      var hidden = row.status === 'hidden';
      return setStatus(row, hidden ? 'active' : 'hidden',
        (hidden ? 'Unhiding ' : 'Hiding ') + row.name + '…',
        (hidden ? 'Unhidden ' : 'Hidden ') + row.name);
    },
    forget: function (row) {
      // BEHAVIOUR §5: no confirm at row level.
      run(row, 'Forgetting ' + row.name + '…', 'Forgot ' + row.name, 'forget failed: ', function () {
        return post(FD.data.registryDelete, { host: row.host, name: row.name });
      });
    }
  };

  // Sequential on purpose: each kill is its own ssh process on the deck, so a
  // parallel fan-out over thirty rows would open thirty connections at once.
  function bulk(verb, ing, ed, list, req) {
    if (state.bulkBusy) return Promise.resolve();
    state.bulkBusy = true;
    publish();
    var done = toast(ing + ' 0/' + list.length + '…', 'pending');
    var failed = [];
    var step = function (i) {
      if (i >= list.length) return Promise.resolve();
      var row = list[i];
      done(ing + ' ' + (i + 1) + '/' + list.length + ' · ' + row.name, 'pending');
      return req(row).then(function (r) {
        if (r.ok) delete state.selected[key(row.host, row.name)];
        else failed.push(row.name + ': ' + (r.stderr || r.error || 'unknown error'));
        return step(i + 1);
      });
    };
    return step(0).then(function () {
      done(failed.length ? verb + ' failed for ' + failed.length + ' — ' + failed.join('; ') : ed + ' ' + list.length,
        failed.length ? 'err' : 'ok');
      return loadSessions();
    }).then(function () {
      state.bulkBusy = false;
      publish();
    });
  }

  var picked = function (live) {
    return state.view.filter(function (r) { return r.sel && r.live === live; });
  };

  var bulkActions = {
    kill: function () {
      var list = picked(true);
      if (!list.length) return;
      if (!global.confirm('Kill ' + list.length + ' tmux session(s)?\n\n' +
        list.map(function (r) { return r.host + ':' + r.name; }).join('\n') +
        '\n\nIrreversible — everything running in them dies.')) return;
      bulk('Kill', 'Killing', 'Killed', list, function (r) {
        return post(FD.data.kill, { host: r.host, name: r.name });
      });
    },
    forget: function () {
      var list = picked(false);
      if (!list.length) return;
      if (!global.confirm('Forget ' + list.length + ' registry row(s)?')) return;
      bulk('Forget', 'Forgetting', 'Forgot', list, function (r) {
        return post(FD.data.registryDelete, { host: r.host, name: r.name });
      });
    },
    // Improvised (I-L4-03): the mock's bulk bar carries Tag kill and Hide, which
    // the old app only had per row. Same sequential pattern, same toast shape.
    // No confirm: BEHAVIOUR §5 gives the per-row Tag kill and Hide none, and no
    // confirm string for a bulk one exists to quote.
    tag: function () {
      var list = picked(true).concat(picked(false));
      if (!list.length) return;
      bulk('Tag', 'Tagging', 'Tagged', list, function (r) {
        return post(FD.data.registryUpsert, { host: r.host, name: r.name, status: 'kill-requested' });
      });
    },
    hide: function () {
      var list = picked(true).concat(picked(false));
      if (!list.length) return;
      bulk('Hide', 'Hiding', 'Hidden', list, function (r) {
        return post(FD.data.registryUpsert, { host: r.host, name: r.name, status: 'hidden' });
      });
    }
  };

  // -------------------------------------------------------------------- edits
  // BEHAVIOUR §1: click a cell → an input with the current value; blur or Enter
  // saves, Escape discards without a POST, and either way the list reloads.
  function saveEdit(row, field, value) {
    var body = { host: row.host, name: row.name };
    body[field] = value;
    return post(FD.data.registryUpsert, body).then(function (r) {
      // Without this the cell would silently snap back to the old value on a rejected write.
      if (r.ok) toast('Saved ' + field, 'ok');
      else toast(field + ' not saved: ' + (r.error || 'unknown error'), 'err');
      return loadSessions();
    });
  }

  function openEditor(cell, row, field) {
    if (!cell || cell.querySelector('input')) return;
    var t = state.t || {};
    var original = Array.prototype.slice.call(cell.childNodes);
    var input = doc.createElement('input');
    input.value = row[field] === '—' ? '' : (row[field] || '');
    input.setAttribute('data-l4-edit', field);
    input.style.cssText = 'width:100%;box-sizing:border-box;border-radius:6px;border:1px solid ' +
      (t.line || 'rgba(255,255,255,0.13)') + ';background:' + (t.inputBg || 'rgba(255,255,255,0.05)') +
      ';color:' + (t.ink || '#fff') + ';padding:3px 7px;font-size:12.5px;';
    state.editing = { id: row.id, field: field };
    cell.replaceChildren(input);
    input.focus();
    input.select();

    var done = false;   // Enter blurs, so without this the save would fire twice
    var restore = function () {
      if (input.isConnected) cell.replaceChildren.apply(cell, original);
      state.editing = null;
    };
    input.addEventListener('blur', function () {
      if (done) return;
      done = true;
      var value = input.value;
      restore();
      saveEdit(row, field, value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { input.blur(); return; }
      if (e.key === 'Escape') {
        done = true;
        restore();
        loadSessions();
      }
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  // Finds the cell an editable field lives in: group and task are columns, label
  // and note only exist in the improvised details row (ruling O3), so editing
  // one of those opens the details row first.
  function editField(row, field) {
    var rowEl = doc.querySelector('[data-l4-row="' + cssEscape(row.id) + '"]');
    if (!rowEl) return;
    if (field === 'group' || field === 'task') {
      openEditor(rowEl.children[field === 'group' ? 2 : 3], row, field);
      return;
    }
    state.expanded[row.id] = true;
    publish();
    // The details row is written by the next decoration pass.
    global.requestAnimationFrame(function () {
      decorate();
      var panel = doc.querySelector('[data-l4-details="' + cssEscape(row.id) + '"]');
      var cell = panel && panel.querySelector('[data-l4-field="' + field + '"]');
      if (cell) openEditor(cell, row, field);
    });
  }

  function cssEscape(v) { return String(v).replace(/["\\]/g, '\\$&'); }

  // ------------------------------------------------------------------ the menu
  // Improvised (I-L4-04): the mock's row actions are "Show · Message · ⋯" and its
  // ⋯ carries the title "Kill · Tag kill · Hide". Everything the old app showed as
  // a row button lives in this menu, plus the four inline edits (ruling O3).
  function closeMenu() {
    var open = doc.querySelector('[data-l4-extra="menu"]');
    if (open) open.remove();
  }

  function openMenu(button, row) {
    closeMenu();
    var t = state.t || {};
    var menu = doc.createElement('div');
    menu.setAttribute('data-l4-extra', 'menu');
    menu.setAttribute('role', 'menu');
    menu.style.cssText = 'position:fixed;z-index:70;min-width:186px;border-radius:12px;border:1px solid ' +
      (t.line || 'rgba(255,255,255,0.13)') + ';background:' + (t.panel || 'rgba(20,20,20,0.92)') +
      ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.3);padding:6px;display:flex;flex-direction:column;gap:2px;';

    var items = [
      { label: row.expanded ? 'Hide details' : 'Details', run: function () { toggleExpanded(row); } },
      { sep: true },
      { label: 'Edit label', run: function () { editField(row, 'label'); } },
      { label: 'Edit group', run: function () { editField(row, 'group'); } },
      { label: 'Edit task', run: function () { editField(row, 'task'); } },
      { label: 'Edit note', run: function () { editField(row, 'note'); } },
      { sep: true },
      { label: 'Kill', run: function () { actions.kill(row); } },
      { label: row.status === 'kill-requested' ? 'Untag' : 'Tag kill',
        title: row.status === 'kill-requested' ? 'Cancel the kill request' : 'Mark kill-requested — nothing is killed',
        run: function () { actions.tag(row); } },
      { label: row.status === 'hidden' ? 'Unhide' : 'Hide', run: function () { actions.hide(row); } }
    ];
    // BEHAVIOUR §5: Forget is a gone-row action only.
    if (!row.live) items.push({ label: 'Forget', title: 'Drop the registry row', run: function () { actions.forget(row); } });

    items.forEach(function (item) {
      if (item.sep) {
        var hr = doc.createElement('div');
        hr.style.cssText = 'height:1px;margin:4px 2px;background:' + (t.lineSoft || 'rgba(255,255,255,0.07)') + ';';
        menu.appendChild(hr);
        return;
      }
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      if (item.title) b.title = item.title;
      b.disabled = !!row.busy;
      b.style.cssText = 'text-align:left;border:none;background:transparent;color:' + (t.ink75 || 'rgba(255,255,255,0.75)') +
        ';padding:6px 10px;font-size:12.5px;border-radius:8px;cursor:pointer;white-space:nowrap;';
      b.addEventListener('mouseenter', function () { b.style.background = t.hoverBg || 'rgba(255,255,255,0.07)'; });
      b.addEventListener('mouseleave', function () { b.style.background = 'transparent'; });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        closeMenu();
        item.run();
      });
      menu.appendChild(b);
    });

    doc.body.appendChild(menu);
    var box = button.getBoundingClientRect();
    var height = menu.offsetHeight;
    var top = box.bottom + 6;
    if (top + height > global.innerHeight - 8) top = Math.max(8, box.top - height - 6);
    menu.style.top = top + 'px';
    menu.style.left = Math.max(8, Math.min(box.right - menu.offsetWidth, global.innerWidth - menu.offsetWidth - 8)) + 'px';
  }

  function toggleExpanded(row) {
    if (state.expanded[row.id]) delete state.expanded[row.id];
    else state.expanded[row.id] = true;
    publish();
    global.requestAnimationFrame(decorate);
  }

  // --------------------------------------------------------------- decoration
  // Everything below only ever runs in live mode. It stamps data-l4-* hooks onto
  // the mock's own elements, adds the controls the mock has no slot for, and is
  // idempotent so it can run again after every render.
  var container = function () { return doc.querySelector('[data-screen-label="Registry"]'); };

  function decorate() {
    var root = container();
    if (!root || !FD.fixture.l4) { closeMenu(); return; }
    var t = state.t || {};
    var filterRow = root.firstElementChild;
    if (filterRow) decorateFilters(filterRow, t);
    decorateBulk(root, t);
    decorateTable(root, t);
  }

  function decorateFilters(filterRow, t) {
    var selects = filterRow.querySelectorAll('select');
    if (selects.length < 3) return;
    var order = ['live', 'status', 'msg'];
    // Improvised (I-L4-01): the mock's status menu stops at three of the five
    // states the server accepts, and its age menu at two of the six the old
    // filter had. The missing options are appended in the mock's own <option>
    // style so no state becomes unreachable.
    var OPTIONS = {
      live: [['', 'live + gone'], ['live', 'live only'], ['gone', 'gone only']],
      status: [['', 'any status']].concat(STATUSES.map(function (s) { return [s, s]; })),
      msg: AGE_KEYS.map(function (k) { return [k, k ? 'older than ' + k : 'last msg: any']; }),
      active: AGE_KEYS.map(function (k) { return [k, k ? 'older than ' + k : 'active: any']; })
    };

    order.forEach(function (name, i) { fillSelect(selects[i], name, OPTIONS[name]); });

    // Improvised (I-L4-02): the mock's filter row has no active-age select, so
    // one is added after the last-msg select, cloning its style verbatim.
    var extra = filterRow.querySelector('[data-l4-filter="active"]');
    if (!extra) {
      extra = doc.createElement('select');
      extra.setAttribute('data-l4-extra', 'filter');
      extra.style.cssText = selects[2].style.cssText;
      selects[2].parentNode.insertBefore(extra, selects[2].nextSibling);
      fillSelect(extra, 'active', OPTIONS.active);
    } else if (extra.style.cssText !== selects[2].style.cssText) {
      extra.style.cssText = selects[2].style.cssText;   // follow the theme
    }
    extra.value = state.filter.active;
  }

  function fillSelect(select, name, options) {
    if (!select) return;
    if (select.getAttribute('data-l4-filter') !== name) {
      select.setAttribute('data-l4-filter', name);
      select.addEventListener('change', function () { registry.setFilter(name, select.value); });
    }
    if (select.options.length !== options.length) {
      select.replaceChildren();
      options.forEach(function (pair) {
        var o = doc.createElement('option');
        o.value = pair[0];
        o.textContent = pair[1];
        select.appendChild(o);
      });
    } else {
      // The renderer rewrites option text on a theme flip; keep the values glued on.
      for (var i = 0; i < options.length; i++) select.options[i].value = options[i][0];
    }
    if (select.value !== state.filter[name]) select.value = state.filter[name];
  }

  function decorateBulk(root, t) {
    var bar = null;
    Array.prototype.forEach.call(root.children, function (child) {
      var first = child.firstElementChild;
      if (first && first.tagName === 'SPAN' && /\bselected$/.test(first.textContent || '')) bar = child;
    });
    if (!bar) return;
    var buttons = bar.querySelectorAll('button');
    var names = ['kill', 'tag', 'hide'];
    for (var i = 0; i < names.length && i < buttons.length; i++) buttons[i].setAttribute('data-l4-bulk', names[i]);

    var payload = FD.fixture.l4 || {};
    // BEHAVIOUR §4: Kill applies to live ticked rows, Forget to gone ones. The
    // mock's bar has no Forget, so it appears only while gone rows are ticked
    // (improvised, I-L4-03).
    var forget = bar.querySelector('[data-l4-bulk="forget"]');
    if (payload.selGone) {
      if (!forget) {
        forget = doc.createElement('button');
        forget.setAttribute('data-l4-bulk', 'forget');
        forget.setAttribute('data-l4-extra', 'bulk');
        forget.type = 'button';
        forget.style.cssText = buttons[0] ? buttons[0].style.cssText : '';
        buttons[names.length - 1].parentNode.insertBefore(forget, buttons[names.length - 1].nextSibling);
      }
      forget.textContent = 'Forget ' + payload.selGone + ' gone';
      if (buttons[0] && forget.style.cssText !== buttons[0].style.cssText) forget.style.cssText = buttons[0].style.cssText;
    } else if (forget) {
      forget.remove();
    }
    // BEHAVIOUR §4: Kill is disabled at 0 live, and its label counts the rows.
    if (buttons[0]) {
      buttons[0].textContent = 'Kill ' + payload.selLive + ' live';
      buttons[0].disabled = !payload.selLive || state.bulkBusy;
      buttons[0].style.opacity = buttons[0].disabled ? '0.45' : '';
    }
    for (var j = 1; j < names.length && j < buttons.length; j++) {
      buttons[j].disabled = state.bulkBusy;
      buttons[j].style.opacity = state.bulkBusy ? '0.45' : '';
    }
    void t;
  }

  function decorateTable(root, t) {
    var panel = root.lastElementChild;
    var inner = panel && panel.firstElementChild;
    var head = inner && inner.firstElementChild;
    if (!head) return;

    // Header: the seven sortable columns, plus the ▲/▼ suffix BEHAVIOUR §3 asks
    // for. The template's labels are static text, so the marker is appended here.
    var labels = head.querySelectorAll('span');
    HEAD_KEYS.forEach(function (k, i) {
      var span = labels[i];
      if (!span) return;
      if (span.getAttribute('data-l4-sort') !== k) {
        span.setAttribute('data-l4-sort', k);
        span.style.cursor = 'pointer';
        span.title = 'Sort by ' + span.textContent.replace(/ [▲▼]$/, '');
      }
      var base = span.textContent.replace(/ [▲▼]$/, '');
      var want = base + (state.sort && state.sort.key === k ? (state.sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
      if (span.textContent !== want) span.textContent = want;
    });

    // Rows: the mock's own row divs, in the order the payload published them.
    var rowEls = Array.prototype.filter.call(inner.children, function (el, i) {
      return i > 0 && !el.hasAttribute('data-l4-extra');
    });
    rowEls.forEach(function (el, i) {
      var row = state.view[i];
      if (!row) return;
      el.setAttribute('data-l4-row', row.id);
      var acts = el.lastElementChild;
      var buttons = acts ? acts.querySelectorAll('button') : [];
      var names = ['show', 'message', 'menu'];
      for (var b = 0; b < names.length && b < buttons.length; b++) {
        buttons[b].setAttribute('data-l4-act', names[b]);
        // BEHAVIOUR §5: the row's buttons stay disabled until the re-fetch lands.
        buttons[b].disabled = !!row.busy;
        buttons[b].style.opacity = row.busy ? '0.45' : '';
      }
      // Pane activity ages into amber past an hour and red past a day. One shared
      // cellStyle is bound to four columns, so the tone is painted per cell here.
      tone(el.children[5], row.activeTone, t);
      tone(el.children[6], row.msgTone, t);
      // Group and Task keep today's click-to-edit (BEHAVIOUR §1).
      if (el.children[2]) el.children[2].style.cursor = 'text';
      if (el.children[3] && row.tk === '—') el.children[3].style.cursor = 'text';
      details(inner, el, row, t);
    });
    // Drop details panels whose row has left the table.
    Array.prototype.slice.call(inner.querySelectorAll('[data-l4-details]')).forEach(function (panelEl) {
      if (!state.expanded[panelEl.getAttribute('data-l4-details')]) panelEl.remove();
    });
  }

  function tone(cell, kind, t) {
    if (!cell) return;
    if (!kind) { cell.style.removeProperty('color'); return; }
    cell.style.color = kind === 'red' ? (t.bad || '#e5484d') : (t.warn || '#f5a623');
  }

  // Improvised (I-L4-05): ruling O3 puts the Details-tab fields in an expandable
  // row. It is inserted directly under its row, in the panel's own idiom, and
  // carries the two fields that have no column of their own plus the read-only
  // host and role/worker.
  function details(inner, rowEl, row, t) {
    var existing = rowEl.nextElementSibling;
    if (existing && existing.getAttribute('data-l4-details') !== row.id) existing = null;
    if (!row.expanded) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var panel = doc.createElement('div');
    panel.setAttribute('data-l4-extra', 'details');
    panel.setAttribute('data-l4-details', row.id);
    panel.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:10px 16px 14px 64px;' +
      'border-bottom:1px solid ' + (t.lineSoft || 'rgba(255,255,255,0.07)') + ';background:' +
      (t.panelHead || 'rgba(255,255,255,0.05)') + ';';
    [
      ['Host', row.host, null],
      ['Label', row.label || '—', 'label'],
      ['Role/Worker', [row.role, row.worker].filter(Boolean).join(' · ') || '—', null],
      ['Note', row.note || '—', 'note']
    ].forEach(function (field) {
      var cell = doc.createElement('div');
      var k = doc.createElement('div');
      var v = doc.createElement('div');
      k.textContent = field[0];
      k.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.13em;color:' +
        (t.ink45 || 'rgba(255,255,255,0.45)') + ';margin-bottom:4px;';
      v.textContent = field[1];
      v.style.cssText = 'font-size:12.5px;color:' + (t.ink75 || 'rgba(255,255,255,0.75)') +
        ';overflow-wrap:anywhere;' + (field[2] ? 'cursor:text;' : '');
      if (field[2]) v.setAttribute('data-l4-field', field[2]);
      cell.appendChild(k);
      cell.appendChild(v);
      panel.appendChild(cell);
    });
    inner.insertBefore(panel, rowEl.nextSibling);
  }

  // ------------------------------------------------------------- interactions
  // One delegated listener for the whole screen: rows come and go with every
  // render, and delegation is the only wiring that survives that for free.
  function onClick(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    if (!target.closest('[data-l4-extra="menu"]')) closeMenu();
    var root = container();
    if (!root || !root.contains(target)) return;

    var sortEl = target.closest('[data-l4-sort]');
    if (sortEl) { registry.sortBy(sortEl.getAttribute('data-l4-sort')); return; }

    var bulkEl = target.closest('[data-l4-bulk]');
    if (bulkEl) {
      if (bulkEl.disabled) return;
      var which = bulkEl.getAttribute('data-l4-bulk');
      if (bulkActions[which]) bulkActions[which]();
      return;
    }

    var fieldEl = target.closest('[data-l4-field]');
    if (fieldEl) {
      var owner = fieldEl.closest('[data-l4-details]');
      var detailRow = owner && rowById(owner.getAttribute('data-l4-details'));
      if (detailRow) openEditor(fieldEl, detailRow, fieldEl.getAttribute('data-l4-field'));
      return;
    }

    var rowEl = target.closest('[data-l4-row]');
    if (!rowEl) return;
    var row = rowById(rowEl.getAttribute('data-l4-row'));
    if (!row) return;

    var actEl = target.closest('[data-l4-act]');
    if (actEl) {
      if (actEl.disabled) return;
      var act = actEl.getAttribute('data-l4-act');
      if (act === 'show') actions.show(row);
      else if (act === 'message') actions.message(row);
      else openMenu(actEl, row);
      return;
    }

    // Click-to-edit on the two editable columns the mock kept (BEHAVIOUR §1).
    var cell = target.closest('[data-l4-row] > *');
    if (!cell || cell.querySelector('input')) return;
    var index = Array.prototype.indexOf.call(rowEl.children, cell);
    if (index === 2) { openEditor(cell, row, 'group'); return; }
    if (index === 3) {
      // Improvised (I-L4-06): the template has no anchor to bind, so a task that
      // matches TASK_RE opens its Linear issue in a new tab and only a blank one
      // opens the editor. Editing a real task stays on the ⋯ menu.
      if (TASK_RE.test(row.tk || '')) global.open(LINEAR_ISSUE + row.tk, '_blank', 'noopener');
      else openEditor(cell, row, 'task');
    }
  }

  function rowById(id) {
    for (var i = 0; i < state.view.length; i++) if (state.view[i].id === id) return state.view[i];
    return null;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeMenu();
  }

  var pending = false;
  function scheduleDecorate() {
    if (pending) return;
    pending = true;
    global.requestAnimationFrame(function () { pending = false; decorate(); });
  }

  function observe() {
    var root = doc.getElementById('dc-root') || doc.body;
    if (!root || typeof global.MutationObserver !== 'function') return;
    new global.MutationObserver(scheduleDecorate).observe(root, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------- hooks
  registry.setFilter = function (name, value) {
    if (!state.filter || !(name in FILTER0)) return;
    state.filter[name] = value;
    writeStore(K_FILTER, JSON.stringify(state.filter));
    publish();
    scheduleDecorate();
  };

  registry.reset = function () {
    state.filter = {};
    for (var k in FILTER0) state.filter[k] = FILTER0[k];
    dropStore(K_FILTER);
    publish();
    scheduleDecorate();
  };

  registry.sortBy = function (key) {
    if (!SORTS[key]) return;
    var same = state.sort && state.sort.key === key;
    state.sort = { key: key, dir: same && state.sort.dir === 'asc' ? 'desc' : 'asc' };
    saveSort();
    publish();
    scheduleDecorate();
  };

  registry.toggleRow = function (id) {
    var row = rowById(id);
    if (!row) return;
    var k = key(row.host, row.name);
    if (state.selected[k]) delete state.selected[k]; else state.selected[k] = true;
    publish();
    scheduleDecorate();
  };

  registry.toggleAll = function () {
    var all = state.view.length > 0 && state.view.every(function (r) { return r.sel; });
    state.selected = {};
    if (!all) state.view.forEach(function (r) { state.selected[key(r.host, r.name)] = true; });
    publish();
    scheduleDecorate();
  };

  registry.clearSel = function () {
    state.selected = {};
    publish();
    scheduleDecorate();
  };

  // Called by logic.js on every render: the theme tokens are rebuilt per render
  // from state.dark, so the improvised chrome follows a theme flip.
  registry.setTokens = function (tokens, logic) {
    state.t = tokens;
    if (logic) registry.logic = logic;
  };

  // The screen only wakes up when it is on screen; nothing polls (BEHAVIOUR §7).
  registry.start = function () {
    if (state.started || isFixtureMode()) return;
    state.started = true;
    state.filter = loadFilter();
    state.sort = loadSort();
    readStore(K_TAB);   // still read, harmless with one table (BEHAVIOUR §8)
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKeyDown);
    global.addEventListener('resize', closeMenu);
    observe();
    publish();
    loadSessions();
  };

  function isFixtureMode() {
    if (FD.data && typeof FD.data.isFixture === 'function') return FD.data.isFixture();
    if (readStore('fd-fixture') === '1') return true;
    var search = global.location && global.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // --- hooks this screen PROVIDES ------------------------------------------
  // Other slices deep-link into the Registry: the sidebar (L2) and the machines
  // card "Open in Registry" (L9) both want a screen switch with a pre-filled search.
  registry.open = function (opts) {
    opts = opts || {};
    registry.start();
    if (state.filter) {
      var q = typeof opts.q === 'string' ? opts.q : typeof opts.host === 'string' ? opts.host : null;
      if (q !== null) {
        state.filter.q = q;
        writeStore(K_FILTER, JSON.stringify(state.filter));
      }
    }
    if (registry.logic && typeof registry.logic.setState === 'function') registry.logic.setState({ screen: 'registry' });
    publish();
    scheduleDecorate();
  };

  // --- hooks this screen CONSUMES, always guarded ---------------------------
  // L3 owns the maximised session view; until it lands, "Show" must not throw.
  registry.openMax = function (host, name) {
    var windows = FD.screens.windows;
    if (windows && typeof windows.openMax === 'function') {
      windows.openMax(host, name);
      return true;
    }
    return false;
  };

  // L6 owns the bus; ruling O8 says "Message" deep-links into the thread for
  // this session. Until L6 lands the screen falls back to plain navigation.
  registry.openBus = function (target) {
    var bus = FD.screens.bus;
    if (bus && typeof bus.open === 'function') {
      bus.open(target);
      return true;
    }
    if (registry.logic && typeof registry.logic.setState === 'function') registry.logic.setState({ screen: 'bus' });
    return false;
  };

  // Exposed for the live gate (tools/v2-live-check.mjs) and for tests.
  registry._state = state;
})(window);
