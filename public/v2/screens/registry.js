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
// them is attached here by progressive enhancement, under three rules the oracle
// audit of the shim made binding (DESIGN-35, 2026-09-08):
//
//   1. Never mount foreign DOM inside a compiled node. syncChildren() owns those
//      children and drops anything it did not render. So every improvised control
//      — the extra filters, the bulk Forget, the ⋯ menu, the details panel, the
//      cell editor, the toasts — lives in #fd-l4-layer, our own element outside
//      #dc-root, anchored to a compiled node's rectangle. What a compiled node
//      gets from us is an attribute, a property or a listener: never a child.
//      Text the mock cannot show (the sort arrow, the bulk counts) is painted by
//      a ::after rule in our own stylesheet, off a data-l4-* attribute.
//   2. Validate before FD.setData, and never let this screen throw inside
//      renderVals — one throw there blanks every screen, so rows are checked here
//      and the seam in logic.js keeps the last good values.
//   3. sc-for rows are positional, never stable identities. No per-row state is
//      kept in the DOM: a click resolves its row by the row element's index among
//      its siblings, recomputed at click time, and the selection is keyed by
//      host\0name in this module.
//
// In fixture mode not one of these listeners is installed and not one node is
// created.
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

  function filterSessions(list, filter) {
    var f = filter || state.filter;
    var q = String(f.q || '').trim().toLowerCase();
    return list.filter(function (s) {
      var text = [s.name, s.host, s.label, s.group, s.task, s.note, s.role, s.worker];
      return (!q || text.some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; })) &&
        (!f.live || (f.live === 'live') === Boolean(s.live)) &&
        (!f.status || s.status === f.status) &&
        olderThan(s.msg_at, AGE[f.msg]) &&
        olderThan(s.active_at, AGE[f.active]);
    });
  }

  function sortSessions(list, order) {
    var sort = order === undefined ? state.sort : order;
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
      // The adapter renames these to g/tk and em-dashes an empty one, so the raw
      // values are carried too: an editor opened on the em-dash must start empty,
      // and one opened on a real group must start with that group — without this
      // a blur with no typing would POST '' and wipe it.
      row.group = s.group || '';
      row.task = s.task || '';
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
  // Audit rule 2: the renderer must never meet a row that is missing a field it
  // binds. A row that cannot be made safe is dropped rather than rendered, and the
  // drop is counted so REPORT.md can say so.
  var STRINGS = ['id', 's', 'g', 'tk', 'st', 'active', 'msg', 'seen', 'host', 'name'];
  function validate(rows) {
    var kept = [];
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      for (var i = 0; i < STRINGS.length; i++) {
        var k = STRINGS[i];
        if (row[k] === null || row[k] === undefined) row[k] = '';
        else if (typeof row[k] !== 'string') row[k] = String(row[k]);
      }
      if (!row.id) return;                       // nothing can address it
      row.gone = !row.live;
      row.sel = !!row.sel;
      kept.push(row);
    });
    state.dropped = rows.length - kept.length;
    return kept;
  }

  function publish() {
    recompute();
    state.view = validate(state.view);
    var live = 0, gone = 0;
    state.view.forEach(function (r) { if (r.sel) { if (r.live) live++; else gone++; } });
    // The rows go into regData, the key the compiled logic already reads and the
    // key S2's standing seam check drives (tools/v2-setdata-check.mjs). Only what
    // a row cannot carry — the counts, the raw search text, the selection totals —
    // needs a key of its own, which is what DESIGN-35 allows. Both are set before
    // the render flushes, so this is one re-render, not two.
    FD.setData('l4', {
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
    FD.setData('regData', state.view);
    // Decoration is normally driven by the render's DOM mutations, but a publish
    // that changes only what WE paint — a busy flag, a bulk count, the sort
    // marker — leaves the compiled tree byte-identical, so the observer never
    // fires and those attributes would never reach the DOM.
    scheduleDecorate();
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
    // Only this row's own flight blocks it. A bulk run marks the rows IT owns busy
    // (see bulk()), so an unrelated row stays live — today's app disables the bulk
    // bar's buttons, never the rest of the table (public/app.js:787).
    if (state.busy[row.id]) return Promise.resolve();
    closeEditor();
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
    closeEditor();
    state.bulkBusy = true;
    // Every row in the batch is busy for the whole batch: without this its own ⋯
    // menu stays live and a click there fires a second, concurrent POST for the
    // same session while the sequence is still working through it.
    list.forEach(function (r) { state.busy[r.id] = true; });
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
      list.forEach(function (r) { delete state.busy[r.id]; });
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


  // ------------------------------------------------------------ overlay layer
  // Audit rule 1: everything this screen draws lives in #fd-l4-layer, outside
  // #dc-root, anchored to the rectangle of the compiled node it belongs to.
  // Compiled nodes only ever receive an attribute, a property or a listener.
  var layerEl = null;
  var styleEl = null;
  var anchored = [];   // [{ el, get: () => Element|null, place: (el, box) => void }]

  function layer() {
    if (layerEl && layerEl.isConnected) return layerEl;
    layerEl = doc.createElement('div');
    layerEl.id = 'fd-l4-layer';
    layerEl.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:60;';
    doc.body.appendChild(layerEl);
    return layerEl;
  }

  // The mock has no slot for a sort arrow or a count inside a bulk button, and we
  // may not add a text node to a compiled element — so both are drawn by a ::after
  // rule off an attribute. The sheet follows the theme because the tokens do.
  function stylesheet() {
    var t = state.t || {};
    if (!styleEl || !styleEl.isConnected) {
      styleEl = doc.createElement('style');
      styleEl.id = 'fd-l4-style';
      doc.head.appendChild(styleEl);
    }
    var css = [
      '[data-l4-sort]{cursor:pointer}',
      '[data-l4-dir="asc"]::after{content:" \\0025B2"}',
      '[data-l4-dir="desc"]::after{content:" \\0025BC"}',
      '[data-l4-count]::after{content:" " attr(data-l4-count)}',
      '[data-l4-off="1"]{opacity:0.45;pointer-events:none}',
      '[data-l4-editing="1"]{color:transparent!important}',
      '[data-l4-hidden="1"]{visibility:hidden!important}',
      '[data-l4-age="amber"]{color:' + (t.warn || 'inherit') + '!important}',
      '[data-l4-age="red"]{color:' + (t.bad || 'inherit') + '!important}'
    ].join('\n');
    if (styleEl.textContent !== css) styleEl.textContent = css;
  }

  function anchor(el, get, place, drop) {
    anchored.push({ el: el, get: get, place: place, drop: drop || null });
    position();
  }

  // An overlay whose anchor has left the table takes itself down with it: rows are
  // positional, so a filter or a reload can dissolve the thing it was pointing at.
  function position() {
    anchored = anchored.filter(function (a) {
      if (!a.el.isConnected) return false;
      var target = a.get();
      if (!target) {
        // Whatever this pointed at has left the table. The owner tidies first:
        // an editor MUST disarm before its node leaves the DOM, because removing
        // a focused input fires blur, and an armed blur handler would save — on a
        // row that was just forgotten, that re-upserts the row it deleted.
        if (a.drop) a.drop();
        if (a.el.isConnected) a.el.remove();
        return false;
      }
      a.place(a.el, target.getBoundingClientRect());
      return true;
    });
  }

  var over = function (el, box) {
    el.style.left = box.left + 'px';
    el.style.top = box.top + 'px';
    el.style.width = box.width + 'px';
    el.style.height = box.height + 'px';
  };

  // ------------------------------------------------------- compiled-node lookup
  var container = function () { return doc.querySelector('[data-screen-label="Registry"]'); };

  function tableInner() {
    var root = container();
    var panel = root && root.lastElementChild;
    return (panel && panel.firstElementChild) || null;
  }

  // Audit rule 3: a row is found by its position, recomputed now — never by a
  // stamp left in the DOM by an earlier render.
  function rowIndex(id) {
    for (var i = 0; i < state.view.length; i++) if (state.view[i].id === id) return i;
    return -1;
  }

  function rowEl(id) {
    var inner = tableInner();
    var i = rowIndex(id);
    return inner && i >= 0 ? inner.children[i + 1] || null : null;   // child 0 is the header
  }

  function cellEl(id, index) {
    var el = rowEl(id);
    return el ? el.children[index] || null : null;
  }

  function rowById(id) {
    var i = rowIndex(id);
    return i < 0 ? null : state.view[i];
  }

  function rowAt(el) {
    var inner = tableInner();
    if (!inner || !el) return null;
    var i = Array.prototype.indexOf.call(inner.children, el) - 1;
    return i >= 0 ? state.view[i] || null : null;
  }

  // -------------------------------------------------------------------- toasts
  // BEHAVIOUR §7: pending never auto-dismisses, ok goes at 3 s, err at 6 s, a
  // click dismisses. Styled from the mock's own reply toast (template.dc.html:769).
  var toastHost = null;

  function toastLayer() {
    if (toastHost && toastHost.isConnected) return toastHost;
    toastHost = doc.createElement('div');
    toastHost.setAttribute('data-l4-toasts', '1');
    toastHost.style.cssText = 'position:fixed;right:24px;bottom:24px;width:340px;' +
      'display:flex;flex-direction:column-reverse;gap:8px;';
    layer().appendChild(toastHost);
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
    text.style.cssText = 'font-size:12.5px;line-height:1.5;color:' + (t.ink || '#fff') + ';overflow-wrap:anywhere;';
    el.onclick = function () { el.remove(); };   // an error toast can be cleared before its 6 s are up
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

  // -------------------------------------------------------------------- edits
  // BEHAVIOUR §1: click a cell → an input with the current value; blur or Enter
  // saves, Escape discards without a POST, and either way the list reloads.
  // The input is ours and sits in the layer, over the compiled cell, whose own
  // text is hidden by the [data-l4-editing] rule for as long as it is open.
  var editorEl = null;

  function closeEditor() {
    if (editorEl) { editorEl.remove(); editorEl = null; }
    var marked = doc.querySelector('[data-l4-editing="1"]');
    if (marked) marked.removeAttribute('data-l4-editing');
    state.editing = null;
  }

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

  function editorInput(value) {
    var t = state.t || {};
    var input = doc.createElement('input');
    input.value = value;
    input.style.cssText = 'position:fixed;box-sizing:border-box;border-radius:6px;border:1px solid ' +
      (t.ink45 || 'rgba(255,255,255,0.45)') + ';background:' + (t.inputBg || 'rgba(20,20,20,0.95)') +
      ';color:' + (t.ink || '#fff') + ';padding:2px 7px;font-size:12.5px;pointer-events:auto;';
    return input;
  }

  // `commit` receives the typed value; `discard` restores whatever was on screen.
  function wireEditor(input, commit, discard) {
    var done = false;   // Enter blurs, so without this the save would fire twice
    input.addEventListener('blur', function () {
      // No state.editing means this editor was already taken down — by an action,
      // a reload, or its row leaving the table — and this blur is the teardown's
      // own echo, not the user leaving the field.
      if (done || !state.editing) return;
      done = true;
      var value = input.value;
      closeEditor();
      commit(value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { input.blur(); e.stopPropagation(); return; }
      if (e.key === 'Escape') {
        done = true;
        closeEditor();
        discard();
      }
      e.stopPropagation();
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  // Group and Task are columns of the mock's own table; label and note only exist
  // in the improvised details panel (ruling O3), which draws its own editor.
  var COLUMN_OF = { group: 2, task: 3 };

  function openEditor(row, field) {
    closeEditor();
    var index = COLUMN_OF[field];
    if (index === undefined) { editDetail(row, field); return; }
    var cell = cellEl(row.id, index);
    if (!cell) return;
    var input = editorInput(row[field] || '');
    cell.setAttribute('data-l4-editing', '1');
    state.editing = { id: row.id, field: field };
    editorEl = input;
    layer().appendChild(input);
    anchor(input, function () { return cellEl(row.id, index); }, function (el, box) {
      el.style.left = box.left + 'px';
      el.style.top = (box.top - 2) + 'px';
      el.style.width = box.width + 'px';
    }, closeEditor);
    input.focus();
    input.select();
    wireEditor(input, function (value) { saveEdit(row, field, value); }, function () { loadSessions(); });
  }

  // ------------------------------------------------------------------ the menu
  // Improvised (I-L4-04): the mock's row actions are "Show · Message · ⋯" and its
  // ⋯ carries the title "Kill · Tag kill · Hide". Everything the old app showed as
  // a row button lives in this menu, plus the four inline edits (ruling O3).
  var menuEl = null;

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  function panelStyle(t) {
    return 'position:fixed;border-radius:12px;border:1px solid ' + (t.line || 'rgba(255,255,255,0.13)') +
      ';background:' + (t.panel || 'rgba(20,20,20,0.95)') + ';backdrop-filter:blur(28px) saturate(150%);' +
      '-webkit-backdrop-filter:blur(28px) saturate(150%);box-shadow:0 12px 40px rgba(0,0,0,0.3);pointer-events:auto;';
  }

  function menuButton(t, item, busy) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.textContent = item.label;
    b.setAttribute('data-l4-menu', item.id);
    if (item.title) b.title = item.title;
    if (busy) b.setAttribute('data-l4-off', '1');
    b.style.cssText = 'text-align:left;border:none;background:transparent;color:' +
      (t.ink75 || 'rgba(255,255,255,0.75)') + ';padding:6px 10px;font-size:12.5px;border-radius:8px;' +
      'cursor:pointer;white-space:nowrap;width:100%;';
    b.addEventListener('mouseenter', function () { b.style.background = t.hoverBg || 'rgba(255,255,255,0.07)'; });
    b.addEventListener('mouseleave', function () { b.style.background = 'transparent'; });
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      closeMenu();
      item.run();
    });
    return b;
  }

  function openMenu(row) {
    closeMenu();
    var t = state.t || {};
    var menu = doc.createElement('div');
    menu.setAttribute('data-l4-extra', 'menu');
    menu.setAttribute('role', 'menu');
    menu.style.cssText = panelStyle(t) + 'min-width:186px;padding:6px;display:flex;flex-direction:column;gap:2px;';

    var items = [
      { id: 'details', label: state.expanded[row.id] ? 'Hide details' : 'Details', run: function () { toggleDetails(row); } },
      { sep: true },
      { id: 'edit-label', label: 'Edit label', run: function () { openEditor(row, 'label'); } },
      { id: 'edit-group', label: 'Edit group', run: function () { openEditor(row, 'group'); } },
      { id: 'edit-task', label: 'Edit task', run: function () { openEditor(row, 'task'); } },
      { id: 'edit-note', label: 'Edit note', run: function () { openEditor(row, 'note'); } },
      { sep: true },
      { id: 'kill', label: 'Kill', run: function () { actions.kill(row); } },
      { id: 'tag', label: row.status === 'kill-requested' ? 'Untag' : 'Tag kill',
        title: row.status === 'kill-requested' ? 'Cancel the kill request' : 'Mark kill-requested — nothing is killed',
        run: function () { actions.tag(row); } },
      { id: 'hide', label: row.status === 'hidden' ? 'Unhide' : 'Hide', run: function () { actions.hide(row); } }
    ];
    // BEHAVIOUR §5: Forget is a gone-row action only.
    if (!row.live) items.push({ id: 'forget', label: 'Forget', title: 'Drop the registry row', run: function () { actions.forget(row); } });

    items.forEach(function (item) {
      if (item.sep) {
        var hr = doc.createElement('div');
        hr.style.cssText = 'height:1px;margin:4px 2px;background:' + (t.lineSoft || 'rgba(255,255,255,0.07)') + ';';
        menu.appendChild(hr);
        return;
      }
      menu.appendChild(menuButton(t, item, row.busy));
    });

    menuEl = menu;
    layer().appendChild(menu);
    anchor(menu, function () { return cellEl(row.id, 8); }, function (el, box) {
      var height = el.offsetHeight;
      var top = box.bottom + 6;
      if (top + height > global.innerHeight - 8) top = box.top - height - 6;
      // Clamp into the viewport as well as flip: a row can sit below the fold,
      // and a menu drawn at its rectangle would open off screen entirely.
      top = Math.max(8, Math.min(top, global.innerHeight - height - 8));
      el.style.top = top + 'px';
      el.style.left = Math.max(8, Math.min(box.right - el.offsetWidth, global.innerWidth - el.offsetWidth - 8)) + 'px';
    });
  }

  // ---------------------------------------------------------- details panel
  // Improvised (I-L4-05): ruling O3 puts the old Details tab's fields in an
  // expandable row. It is drawn in the layer, anchored under its row, in the
  // panel's own idiom, and carries the two editable fields that lost their column
  // plus the read-only host and role/worker.
  var detailEls = {};   // row id -> element

  function closeDetails(id) {
    if (id === undefined) {
      Object.keys(detailEls).forEach(function (k) { detailEls[k].remove(); });
      detailEls = {};
      state.expanded = {};
      return;
    }
    if (detailEls[id]) { detailEls[id].remove(); delete detailEls[id]; }
    delete state.expanded[id];
  }

  function toggleDetails(row) {
    if (state.expanded[row.id]) closeDetails(row.id);
    else { state.expanded[row.id] = true; drawDetails(row); }
  }

  function drawDetails(row) {
    if (detailEls[row.id]) detailEls[row.id].remove();
    var t = state.t || {};
    var panel = doc.createElement('div');
    panel.setAttribute('data-l4-extra', 'details');
    panel.setAttribute('data-l4-details', row.id);
    panel.style.cssText = panelStyle(t) + 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;' +
      'padding:12px 16px;box-sizing:border-box;';
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
        ';overflow-wrap:anywhere;min-height:19px;' + (field[2] ? 'cursor:text;' : '');
      if (field[2]) {
        v.setAttribute('data-l4-field', field[2]);
        v.addEventListener('click', function (e) { e.stopPropagation(); editDetail(row, field[2]); });
      }
      cell.appendChild(k);
      cell.appendChild(v);
      panel.appendChild(cell);
    });
    detailEls[row.id] = panel;
    layer().appendChild(panel);
    anchor(panel, function () { return rowEl(row.id); }, function (el, box) {
      el.style.left = box.left + 'px';
      el.style.top = box.bottom + 'px';
      el.style.width = box.width + 'px';
    }, function () {
      // Drop the bookkeeping with the node, or the row keeps an "expanded" flag
      // pointing at a detached panel and its ⋯ menu offers "Hide details" for a
      // panel that is not there.
      delete detailEls[row.id];
      delete state.expanded[row.id];
    });
  }

  // Label and note are drawn by us, so their editor replaces our own node.
  function editDetail(row, field) {
    if (!detailEls[row.id]) { state.expanded[row.id] = true; drawDetails(row); }
    var cell = detailEls[row.id] && detailEls[row.id].querySelector('[data-l4-field="' + field + '"]');
    if (!cell || cell.querySelector('input')) return;   // already editing this field
    closeEditor();
    var input = editorInput(row[field] || '');
    input.style.position = 'static';
    input.style.width = '100%';
    var previous = row[field] || '—';   // not cell.textContent: a second call would read the open input
    cell.replaceChildren(input);
    state.editing = { id: row.id, field: field };
    input.focus();
    input.select();
    wireEditor(input, function (value) {
      cell.textContent = value || '—';
      saveEdit(row, field, value);
    }, function () {
      cell.textContent = previous;
      loadSessions();
    });
  }

  // --------------------------------------------------------------- decoration
  // Runs after every render. Idempotent, live mode only: it gives compiled nodes
  // attributes, properties and listeners, and draws the rest in the layer.
  function decorate() {
    var root = container();
    if (!root || !FD.fixture.l4) {
      // Left the screen: prune first, or every anchored overlay would hang over
      // whichever screen the user moved to. position() drops the ones whose
      // anchor is gone, which is all of them once the table has unmounted.
      closeMenu();
      closeEditor();
      position();
      return;
    }
    stylesheet();
    decorateFilters(root);
    decorateBulk(root);
    decorateTable(root);
    position();
  }

  // The mock's status menu stops at three of the five states the server accepts
  // and its age menu at two of the six the old filter had (I-L4-01). Options are
  // children of a compiled <select>, so the short menus are covered by our own,
  // built from the full lists and drawn in the layer over their rectangles.
  var OPTIONS = {
    live: [['', 'live + gone'], ['live', 'live only'], ['gone', 'gone only']],
    status: [['', 'any status']].concat(STATUSES.map(function (s) { return [s, s]; })),
    msg: AGE_KEYS.map(function (k) { return [k, k ? 'older than ' + k : 'last msg: any']; }),
    active: AGE_KEYS.map(function (k) { return [k, k ? 'older than ' + k : 'active: any']; })
  };

  function decorateFilters(root) {
    var filterRow = root.firstElementChild;
    var selects = filterRow ? filterRow.querySelectorAll('select') : [];
    if (selects.length < 3) return;

    // live + gone is the one menu the mock has in full, so it is wired in place:
    // an <option>'s value is a property, not a child.
    var liveSelect = selects[0];
    if (liveSelect.getAttribute('data-l4-filter') !== 'live') {
      liveSelect.setAttribute('data-l4-filter', 'live');
      liveSelect.addEventListener('change', function () { registry.setFilter('live', liveSelect.value); });
    }
    for (var i = 0; i < OPTIONS.live.length && i < liveSelect.options.length; i++) {
      liveSelect.options[i].value = OPTIONS.live[i][0];
    }
    if (liveSelect.value !== state.filter.live) liveSelect.value = state.filter.live;

    cover(selects[1], 'status');
    cover(selects[2], 'msg');
    // I-L4-02: the mock's filter row has no active-age select at all, so ours is
    // drawn just after the last-msg one, in the same style and the same size.
    beside(selects[2], 'active');
  }

  var overlaySelects = {};

  function makeSelect(name, model) {
    var el = doc.createElement('select');
    el.setAttribute('data-l4-filter', name);
    el.setAttribute('data-l4-extra', 'filter');
    OPTIONS[name].forEach(function (pair) {
      var o = doc.createElement('option');
      o.value = pair[0];
      o.textContent = pair[1];
      el.appendChild(o);
    });
    el.addEventListener('change', function () { registry.setFilter(name, el.value); });
    el.style.cssText = model.style.cssText + ';position:fixed;box-sizing:border-box;pointer-events:auto;margin:0;';
    layer().appendChild(el);
    overlaySelects[name] = el;
    return el;
  }

  function syncSelect(el, name, model) {
    if (el.style.cssText.indexOf(model.style.cssText) !== 0) {
      el.style.cssText = model.style.cssText + ';position:fixed;box-sizing:border-box;pointer-events:auto;margin:0;';
    }
    if (el.value !== state.filter[name]) el.value = state.filter[name];
  }

  function cover(model, name) {
    // visibility, not display: the compiled select keeps its box, so the row's
    // layout — and therefore ours — is exactly the mock's.
    model.setAttribute('data-l4-hidden', '1');
    var el = overlaySelects[name];
    if (!el || !el.isConnected) el = makeSelect(name, model);
    syncSelect(el, name, model);
    if (!el.__anchored) {
      el.__anchored = true;
      anchor(el, function () { return model.isConnected ? model : liveModel(name); }, over);
    }
  }

  function beside(model, name) {
    var el = overlaySelects[name];
    if (!el || !el.isConnected) el = makeSelect(name, model);
    syncSelect(el, name, model);
    if (!el.__anchored) {
      el.__anchored = true;
      anchor(el, function () { return model.isConnected ? model : liveModel('msg'); }, function (node, box) {
        node.style.left = (box.right + 10) + 'px';
        node.style.top = box.top + 'px';
        node.style.width = box.width + 'px';
        node.style.height = box.height + 'px';
      });
    }
  }

  // A render can replace the <select> we anchored to; find the current one.
  function liveModel(name) {
    var root = container();
    var selects = root && root.firstElementChild ? root.firstElementChild.querySelectorAll('select') : [];
    var index = name === 'status' ? 1 : 2;
    return selects[index] || null;
  }

  function bulkBar(root) {
    var found = null;
    Array.prototype.forEach.call(root.children, function (child) {
      var first = child.firstElementChild;
      if (first && first.tagName === 'SPAN' && /\bselected$/.test(first.textContent || '')) found = child;
    });
    return found;
  }

  var forgetEl = null;

  function decorateBulk(root) {
    var bar = bulkBar(root);
    if (!bar) {
      if (forgetEl) { forgetEl.remove(); forgetEl = null; }
      return;
    }
    var buttons = bar.querySelectorAll('button');
    var names = ['kill', 'tag', 'hide'];
    for (var i = 0; i < names.length && i < buttons.length; i++) buttons[i].setAttribute('data-l4-bulk', names[i]);

    var payload = FD.fixture.l4 || {};
    // BEHAVIOUR §4: "Kill <live> live", disabled at 0. The mock's button says only
    // "Kill", and its text is a compiled child, so the count is a ::after.
    if (buttons[0]) {
      buttons[0].setAttribute('data-l4-count', payload.selLive + ' live');
      flag(buttons[0], !payload.selLive || state.bulkBusy);
    }
    for (var j = 1; j < names.length && j < buttons.length; j++) flag(buttons[j], state.bulkBusy);

    // BEHAVIOUR §4: Forget applies to the gone rows, and the mock's bar has no
    // button for it — so ours appears beside Hide only while gone rows are ticked
    // (I-L4-03).
    if (payload.selGone && buttons[2]) {
      if (!forgetEl || !forgetEl.isConnected) {
        forgetEl = doc.createElement('button');
        forgetEl.type = 'button';
        forgetEl.setAttribute('data-l4-bulk', 'forget');
        forgetEl.setAttribute('data-l4-extra', 'bulk');
        layer().appendChild(forgetEl);
        anchor(forgetEl, function () {
          var bar2 = bulkBar(container());
          return bar2 ? bar2.querySelectorAll('button')[2] || null : null;
        }, function (node, box) {
          node.style.left = (box.right + 10) + 'px';
          node.style.top = box.top + 'px';
          node.style.height = box.height + 'px';
        });
      }
      forgetEl.textContent = 'Forget ' + payload.selGone + ' gone';
      forgetEl.style.cssText = buttons[2].style.cssText + ';position:fixed;pointer-events:auto;margin:0;';
      flag(forgetEl, state.bulkBusy);
    } else if (forgetEl) {
      forgetEl.remove();
      forgetEl = null;
    }
  }

  // disabled is a property and data-l4-off is an attribute: neither is a child.
  function flag(button, off) {
    button.disabled = !!off;
    if (off) button.setAttribute('data-l4-off', '1');
    else button.removeAttribute('data-l4-off');
  }

  function decorateTable(root) {
    var inner = tableInner();
    var head = inner && inner.firstElementChild;
    if (!head) return;

    // BEHAVIOUR §3: the ▲/▼ marker. The header labels are compiled text, so the
    // arrow is a ::after off data-l4-dir.
    var labels = head.querySelectorAll('span');
    HEAD_KEYS.forEach(function (k, i) {
      var span = labels[i];
      if (!span) return;
      if (span.getAttribute('data-l4-sort') !== k) {
        span.setAttribute('data-l4-sort', k);
        span.title = 'Sort by ' + span.textContent;
      }
      var dir = state.sort && state.sort.key === k ? state.sort.dir : null;
      if (dir) span.setAttribute('data-l4-dir', dir);
      else span.removeAttribute('data-l4-dir');
    });

    for (var i = 1; i < inner.children.length; i++) {
      var el = inner.children[i];
      var row = state.view[i - 1];
      if (!row) break;
      el.setAttribute('data-l4-row', row.id);
      var acts = el.lastElementChild;
      var buttons = acts ? acts.querySelectorAll('button') : [];
      var names = ['show', 'message', 'menu'];
      for (var b = 0; b < names.length && b < buttons.length; b++) {
        buttons[b].setAttribute('data-l4-act', names[b]);
        // BEHAVIOUR §5: a row's buttons stay disabled until its re-fetch lands.
        flag(buttons[b], row.busy);
      }
      // Pane activity ages into amber past an hour and red past a day. One shared
      // cellStyle is bound to four columns, so the tone is an attribute + a rule.
      age(el.children[5], row.activeTone);
      age(el.children[6], row.msgTone);
    }
  }

  function age(cell, kind) {
    if (!cell) return;
    if (kind) cell.setAttribute('data-l4-age', kind);
    else cell.removeAttribute('data-l4-age');
  }

  // ------------------------------------------------------------- interactions
  // One delegated listener for the whole screen: rows come and go with every
  // render, and delegation is the only wiring that survives that for free.
  function onClick(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var inLayer = layerEl && layerEl.contains(target);
    if (!inLayer || !target.closest('[data-l4-extra="menu"]')) closeMenu();

    var bulkEl = target.closest('[data-l4-bulk]');
    if (bulkEl) {
      if (bulkEl.disabled) return;
      var which = bulkEl.getAttribute('data-l4-bulk');
      if (bulkActions[which]) bulkActions[which]();
      return;
    }

    var root = container();
    if (!root || !root.contains(target)) return;

    var sortEl = target.closest('[data-l4-sort]');
    if (sortEl) { registry.sortBy(sortEl.getAttribute('data-l4-sort')); return; }

    var rowNode = target.closest('[data-l4-row]');
    if (!rowNode) return;
    // Audit rule 3: the row is whatever now sits at this element's position.
    var row = rowAt(rowNode);
    if (!row) return;

    var actEl = target.closest('[data-l4-act]');
    if (actEl) {
      if (actEl.disabled) return;
      var act = actEl.getAttribute('data-l4-act');
      if (act === 'show') actions.show(row);
      else if (act === 'message') actions.message(row);
      else openMenu(row);
      return;
    }

    // Click-to-edit on the two editable columns the mock kept (BEHAVIOUR §1).
    var cell = target.closest('[data-l4-row] > *');
    if (!cell) return;
    var index = Array.prototype.indexOf.call(rowNode.children, cell);
    if (index === 2) { openEditor(row, 'group'); return; }
    if (index === 3) {
      // I-L4-06: the template has no anchor to bind, so a task that matches
      // TASK_RE opens its Linear issue in a new tab and only a blank one opens
      // the editor. Editing a real task stays on the ⋯ menu.
      if (TASK_RE.test(row.task || '')) global.open(LINEAR_ISSUE + row.task, '_blank', 'noopener');
      else openEditor(row, 'task');
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeMenu();
  }

  var queued = false;
  function scheduleDecorate() {
    if (queued) return;
    queued = true;
    global.requestAnimationFrame(function () { queued = false; decorate(); });
  }

  function observe() {
    var root = doc.getElementById('dc-root') || doc.body;
    if (!root || typeof global.MutationObserver !== 'function') return;
    new global.MutationObserver(scheduleDecorate).observe(root, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------- hooks
  registry.setFilter = function (name, value) {
    if (!state.filter || !(name in FILTER0)) return;
    // Audit rule 3: the raw text the user typed is what is stored and what the
    // search box is fed back; normalising happens only inside filterSessions.
    state.filter[name] = value;
    writeStore(K_FILTER, JSON.stringify(state.filter));
    closeEditor();
    publish();
    scheduleDecorate();
  };

  registry.reset = function () {
    state.filter = {};
    for (var k in FILTER0) state.filter[k] = FILTER0[k];
    dropStore(K_FILTER);
    closeEditor();
    closeMenu();
    publish();
    scheduleDecorate();
  };

  registry.sortBy = function (key) {
    if (!SORTS[key]) return;
    var same = state.sort && state.sort.key === key;
    state.sort = { key: key, dir: same && state.sort.dir === 'asc' ? 'desc' : 'asc' };
    saveSort();
    closeEditor();
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
    global.addEventListener('resize', position);
    doc.addEventListener('scroll', position, true);
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

  // Exposed for the live gate (docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs).
  registry._state = state;

  // The rules that can be stated without a DOM, for test/v2-registry.test.js.
  // filterSessions and sortSessions take their filter and order explicitly here;
  // olderThan and ageTone were already pure.
  registry.__pure = {
    filterSessions: filterSessions,
    sortSessions: sortSessions,
    olderThan: olderThan,
    ageTone: ageTone,
    AGE: AGE,
    FILTER0: FILTER0,
    SORTS: SORTS
  };
})(window);
