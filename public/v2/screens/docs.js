// fd-v2 docs: the Docs screen.
//
// Every document the sessions generate — artifacts, ELI5s, unblock sheets, session digests,
// reports, loose HTML and markdown — listed newest first. The mock has no counterpart, so the
// template carries only the mount node (#fd-docs-root) and everything below draws into it in
// plain DOM: createElement and textContent only, never an HTML string, because a title comes
// from a file a session wrote and must never be parsed as markup.
//
// Reads GET /api/docs. The server does the filtering, so every filter change is one fetch and
// the day and kind counts stay counts over the whole index. The filters live on the hash
// ('#docs?session=…&day=…'), which makes a filtered screen a link the operator can copy and is
// how the Desktop sessions row icon arrives here.
//
// Data enters the UI ONLY through FD.setData('docsLive', view) — the same seam convention as
// goalsLive / accountsLive.
(function (root) {
  'use strict';

  var FD = (root.FD = root.FD || {});
  FD.screens = FD.screens || {};

  // --- pure helpers ------------------------------------------------------------

  // Every value that becomes a text node goes through this, so a shape change on the API
  // cannot throw mid-render and blank the screen.
  function safeText(v) {
    return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  }

  // A session id is a uuid the operator only ever recognises by its head.
  function shortId(id) {
    var s = safeText(id);
    return s.length > 8 ? s.slice(0, 8) + '…' : s;
  }

  // The index may date a row with an ISO string or with epoch millis; seconds are accepted
  // too, because a sweep that read mtime in seconds would otherwise render 1970.
  function at(ts) {
    if (typeof ts === 'number') return new Date(ts < 1e11 ? ts * 1000 : ts);
    var d = new Date(safeText(ts));
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtTime(ts) {
    var d = at(ts);
    if (!d) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // The API caps the list; the count must say so or 500 reads as the whole index.
  function countText(view) {
    var shown = (view.docs || []).length;
    var total = typeof view.total === 'number' ? view.total : shown;
    return (total > shown ? shown + ' of ' + total : String(total)) + ' docs';
  }

  function fmtAge(ms) {
    if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '';
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.floor(m / 60) + ' h ago';
    return Math.floor(m / 1440) + ' d ago';
  }

  var FILTERS = ['session', 'day', 'kind', 'source', 'project', 'q'];

  // Only the filters this screen owns, and only the ones that are set: an empty value has
  // to leave the hash entirely, or clearing a filter would still name it in the link.
  function paramsOf(route) {
    var from = (route && route.params) || {};
    var out = {};
    FILTERS.forEach(function (k) {
      var v = safeText(from[k]).trim();
      if (v) out[k] = v;
    });
    return out;
  }

  // An artifact already lives at a URL the operator can open; every other row is a file on
  // this machine, which the deck serves by id only — never by path.
  function openHref(doc) {
    if (doc && doc.kind === 'artifact') return safeText(doc.path);
    return '/api/docs/open?id=' + encodeURIComponent(safeText(doc && doc.id));
  }

  // The sample the pixel gate renders: six docs over three days, two sessions, six kinds.
  // Deterministic — no clock, no fetch.
  var S1 = '6f2b3c1e-6b0e-4a41-9d2e-2f0c8a1b7d55';
  var S2 = 'b8d41a07-3c22-4f6a-8e91-71a5cd0e2b34';
  var FIXTURE_VIEW = {
    ok: true,
    docs: [
      { id: 'd1', path: 'https://claude.ai/public/artifacts/1f0c8a1b', title: 'Fleet map, one page',
        kind: 'artifact', day: '2026-09-10', ts: '2026-09-10T09:41:00Z', session: S1,
        cwd: '/Users/operator/remote-system', project: 'remote-system', source: 'exports', size: 18422 },
      { id: 'd2', path: '/Users/operator/remote-system/docs/eli5/gittrain-broker.md', title: 'ELI5 — the gittrain broker',
        kind: 'eli5', day: '2026-09-10', ts: '2026-09-10T08:12:00Z', session: S1,
        cwd: '/Users/operator/remote-system', project: 'remote-system', source: 'scratchpad', size: 6120 },
      { id: 'd3', path: '/Users/operator/remote-system/docs/unblock/2026-09-10.md', title: 'Unblock — the reaper cascade hold',
        kind: 'unblock', day: '2026-09-10', ts: '2026-09-10T07:05:00Z', session: S2,
        cwd: '/Users/operator/lowcapsxyz', project: 'lowcapsxyz', source: 'scratchpad', size: 3480 },
      { id: 'd4', path: '/Users/operator/remote-system/docs/sessions/2026-09-09-deck.md', title: 'Session digest — deck restart',
        kind: 'session', day: '2026-09-09', ts: '2026-09-09T21:30:00Z', session: S2,
        cwd: '/Users/operator/lowcapsxyz', project: 'lowcapsxyz', source: 'exports', size: 9905 },
      { id: 'd5', path: '/Users/operator/remote-system/docs/research/t3code.md', title: 'Report — T3 Code evaluation',
        kind: 'report', day: '2026-09-09', ts: '2026-09-09T14:02:00Z', session: S1,
        cwd: '/Users/operator/remote-system', project: 'remote-system', source: 'repo', size: 24310 },
      { id: 'd6', path: '/Users/operator/remote-system/docs/design/notes.md', title: 'Design notes — the docs screen',
        kind: 'md', day: '2026-09-08', ts: '2026-09-08T11:47:00Z', session: S2,
        cwd: '/Users/operator/remote-system', project: 'remote-system', source: 'hook', size: 1580 },
    ],
    days: [{ day: '2026-09-10', n: 3 }, { day: '2026-09-09', n: 2 }, { day: '2026-09-08', n: 1 }],
    kinds: [{ kind: 'artifact', n: 1 }, { kind: 'eli5', n: 1 }, { kind: 'md', n: 1 },
      { kind: 'report', n: 1 }, { kind: 'session', n: 1 }, { kind: 'unblock', n: 1 }],
    sources: [{ source: 'exports', n: 2 }, { source: 'hook', n: 1 }, { source: 'repo', n: 1 },
      { source: 'scratchpad', n: 2 }],
    projects: [{ project: 'remote-system', n: 4 }, { project: 'lowcapsxyz', n: 2 }],
    total: 6,
    swept_at: '2026-09-10T09:45:00Z',
    sweeping: false,
  };

  var pure = {
    safeText: safeText, shortId: shortId, fmtTime: fmtTime, fmtAge: fmtAge, countText: countText,
    paramsOf: paramsOf, openHref: openHref, FILTERS: FILTERS, FIXTURE_VIEW: FIXTURE_VIEW,
  };

  FD.screens.docs = Object.assign(FD.screens.docs || {}, { _: pure });
  if (typeof module === 'object' && module.exports) module.exports = FD.screens.docs;

  // In Node (the unit tests) there is no document and nothing below this point runs.
  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------------------------
  // Live mode.
  // ---------------------------------------------------------------------------

  var MOUNT = 'fd-docs-root';
  var DAY_CHIPS = 21; // three weeks of chips; older days stay reachable through the date input
  var EMPTY = { docs: [], days: [], kinds: [], sources: [], projects: [] };

  // Mirrors FD.data.isFixture() so this file can still decide when FD.data is absent.
  function isFixture() {
    if (FD.data && typeof FD.data.isFixture === 'function') return FD.data.isFixture();
    try { if (root.localStorage.getItem('fd-fixture') === '1') return true; } catch (e) { /* no storage */ }
    var search = root.location && root.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // The source choice is the one filter that outlives a reload. The hash stays the single
  // truth: a stored choice is applied by navigating once (enter()), never by filtering behind
  // the link the operator copies. Guarded: a locked-down browser must not break the screen.
  var SOURCE_KEY = 'fd-docs-source';

  function storedSource() {
    try { return root.localStorage.getItem(SOURCE_KEY) || ''; } catch (e) { return ''; }
  }

  function storeSource(v) {
    try {
      if (v) root.localStorage.setItem(SOURCE_KEY, v);
      else root.localStorage.removeItem(SOURCE_KEY);
    } catch (e) { /* no storage */ }
  }

  // Published by logic.js on every render, so the screen follows the theme toggle.
  function tok() {
    return FD.screens.docs.tokens || {
      ink: '#111', ink75: '#333', ink60: '#666', ink45: '#888', ink35: '#aaa',
      warn: '#b26a00', bad: '#c0392b', good: '#2e7d32', line: 'rgba(128,128,128,.28)',
      panel: 'transparent', panelShadow: 'none', hoverBg: 'rgba(128,128,128,.12)',
      cardPad: '18px 20px',
    };
  }

  var state = { view: null, error: '', loading: false, key: null, q: '', focus: false };

  function filters() {
    return paramsOf(FD.router ? FD.router.route() : null);
  }

  var query = function (f) { return new URLSearchParams(f).toString(); };

  // The hash is the only place a filter is stored, so this is also what makes the screen's
  // state shareable — and what the Desktop sessions icon writes to arrive here filtered.
  function setFilters(next) {
    var f = {};
    FILTERS.forEach(function (k) {
      var v = safeText(next[k]).trim();
      if (v) f[k] = v;
    });
    if (query(f) === query(filters())) return;
    if (FD.router) FD.router.navigate('docs', f);
    else enter();
  }

  function setFilter(k, v) {
    var f = filters();
    f[k] = v;
    setFilters(f);
  }

  // --- DOM helpers -------------------------------------------------------------
  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (text !== undefined) n.textContent = safeText(text);
    return n;
  }

  function chip(text, colour) {
    var t = tok();
    return el('span', 'border-radius:9999px;border:1px solid ' + t.line + ';padding:2px 9px;font-size:11px;color:' +
      colour + ';white-space:nowrap;', text);
  }

  function button(text, onclick, opts) {
    var t = tok();
    var b = el('button', 'border-radius:9999px;border:1px solid ' + ((opts && opts.border) || t.line) +
      ';background:' + ((opts && opts.bg) || 'transparent') + ';color:' + ((opts && opts.colour) || t.ink75) +
      ';padding:4px 12px;font-size:12px;cursor:pointer;white-space:nowrap;' + ((opts && opts.tail) || ''), text);
    b.onclick = onclick;
    return b;
  }

  // kind, source and project are the same control three times: one option list, one filter write.
  function picker(options, value, onchange) {
    var t = tok();
    var s = el('select', 'border-radius:9999px;border:1px solid ' + t.line + ';background:transparent;color:' +
      t.ink + ';padding:6px 10px;font-size:12.5px;');
    options.forEach(function (o) {
      var opt = el('option', '', o.label);
      opt.value = o.value;
      s.appendChild(opt);
    });
    s.value = value;
    s.addEventListener('change', function () { onchange(s.value); });
    return s;
  }

  function card() {
    var t = tok();
    return el('div', 'border-radius:12px;border:1px solid ' + t.line + ';background:' + t.panel + ';box-shadow:' +
      t.panelShadow + ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);padding:' +
      (t.cardPad || '18px 20px') + ';display:flex;flex-direction:column;gap:12px;');
  }

  var MONO = "font-family:ui-monospace,'SF Mono',Menlo,monospace;";
  var ROW = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
  var GRID = 'display:grid;grid-template-columns:76px minmax(0,1fr) auto 110px;gap:10px;align-items:start;';

  // --- network -----------------------------------------------------------------

  function load(refresh) {
    if (isFixture()) return Promise.resolve();
    var f = filters();
    state.key = query(f);
    state.q = f.q || '';
    var qs = new URLSearchParams(f);
    if (refresh) qs.set('refresh', '1');
    state.loading = true;
    paint();
    return fetch('/api/docs?' + qs.toString())
      .then(function (r) { return r.json().then(function (b) { return b; }, function () { return null; }); })
      .then(function (body) {
        if (!body || body.ok !== true) throw new Error(safeText(body && body.error) || 'the docs index is not answering');
        state.error = '';
        publish(body);
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'cannot reach fleetdeck'; })
      .then(function () { state.loading = false; paint(); });
  }

  // The ONLY data entry point.
  function publish(view) {
    state.view = view;
    if (typeof FD.setData === 'function') FD.setData('docsLive', view);
  }

  // --- render ------------------------------------------------------------------

  function mount() {
    return document.getElementById(MOUNT);
  }

  function banner(box) {
    if (!state.error) return;
    var t = tok();
    var b = el('div', 'border-radius:10px;border:1px solid ' + t.bad + ';color:' + t.bad + ';padding:9px 14px;font-size:12.5px;' + ROW);
    b.appendChild(el('span', 'flex:1;', state.error));
    b.appendChild(button('Dismiss', function () { state.error = ''; paint(); }, { colour: t.bad, border: t.bad }));
    box.appendChild(b);
  }

  var debounce = null;

  function toolbar(box, view, f) {
    var t = tok();
    var c = card();
    var line = el('div', ROW);

    var search = el('input', 'border-radius:9999px;border:1px solid ' + t.line + ';background:transparent;color:' +
      t.ink + ';padding:7px 12px;font-size:12.5px;flex:1;min-width:200px;');
    search.placeholder = 'Title, project, session…';
    search.value = state.q;
    search.addEventListener('focus', function () { state.focus = true; });
    search.addEventListener('blur', function () { state.focus = false; });
    // Debounced: every keystroke would otherwise be one hash entry and one fetch.
    search.addEventListener('input', function () {
      state.q = search.value;
      if (debounce) root.clearTimeout(debounce);
      debounce = root.setTimeout(function () { setFilter('q', state.q); }, 250);
    });
    line.appendChild(search);

    var date = el('input', 'border-radius:9999px;border:1px solid ' + t.line + ';background:transparent;color:' +
      t.ink + ';padding:6px 10px;font-size:12.5px;');
    date.type = 'date';
    date.value = f.day || '';
    date.addEventListener('change', function () { setFilter('day', date.value); });
    line.appendChild(date);

    line.appendChild(picker([{ value: '', label: 'All kinds' }].concat((view.kinds || []).map(function (k) {
      return { value: safeText(k.kind), label: safeText(k.kind) + ' · ' + safeText(k.n) };
    })), f.kind || '', function (v) { setFilter('kind', v); }));

    // 'No scratchpads' is the choice the operator actually wants: the scratchpads are the noisy
    // half of the index. It is remembered, so it does not have to be made on every load.
    line.appendChild(picker([{ value: '', label: 'All sources' }, { value: '-scratchpad', label: 'No scratchpads' }]
      .concat((view.sources || []).map(function (x) {
        return { value: safeText(x.source), label: safeText(x.source) + ' · ' + safeText(x.n) };
      })), f.source || '', function (v) { storeSource(v); setFilter('source', v); }));

    // Not sticky: which repo the operator is looking at changes with the work, unlike the
    // scratchpad choice, which is a standing preference.
    line.appendChild(picker([{ value: '', label: 'All projects' }].concat((view.projects || []).map(function (x) {
      return { value: safeText(x.project), label: safeText(x.project) + ' · ' + safeText(x.n) };
    })), f.project || '', function (v) { setFilter('project', v); }));

    if (f.session) {
      var s = el('span', 'border-radius:9999px;border:1px solid ' + t.line + ';background:' + t.hoverBg +
        ';padding:2px 4px 2px 10px;font-size:11.5px;color:' + t.ink + ';' + ROW + 'gap:4px;');
      s.appendChild(el('span', MONO, 'Session ' + shortId(f.session)));
      s.appendChild(button('×', function () { setFilter('session', ''); },
        { colour: t.ink60, border: 'transparent', tail: 'padding:0 6px;' }));
      line.appendChild(s);
    }

    var refresh = button(state.loading ? 'Refreshing…' : 'Refresh', function () { load(true); });
    refresh.disabled = !!state.loading || isFixture();
    line.appendChild(refresh);

    // The gate screenshots the fixture, so its sweep age must not come off the clock; the index
    // dates the sweep in millis, which Date.parse would read as 1970.
    var when = at(view.swept_at);
    var age = isFixture() ? '2 min ago' : when ? fmtAge(Date.now() - when.getTime()) : '';
    var swept = view.sweeping ? 'sweeping…' : view.sweep_error ? 'sweep failed' : age ? 'swept ' + age : '';
    var meta = el('span', 'margin-left:auto;font-size:11.5px;color:' + t.ink45 + ';',
      countText(view) + (swept ? ' · ' + swept : ''));
    if (view.sweep_error) meta.title = String(view.sweep_error);
    line.appendChild(meta);
    c.appendChild(line);
    c.appendChild(dayChips(view, f));
    box.appendChild(c);
  }

  function dayChips(view, f) {
    var t = tok();
    var wrap = el('div', ROW + 'gap:6px;');
    var active = function (b, on) {
      if (!on) return b;
      b.setAttribute('style', b.getAttribute('style').replace('background:transparent', 'background:' + t.hoverBg));
      return b;
    };
    wrap.appendChild(active(button('All', function () { setFilter('day', ''); }, { colour: f.day ? t.ink60 : t.ink }), !f.day));
    (view.days || []).slice(0, DAY_CHIPS).forEach(function (d) {
      var day = safeText(d.day);
      var on = day === f.day;
      var b = active(button(day.slice(5), function () { setFilter('day', day); }, { colour: on ? t.ink : t.ink60 }), on);
      b.appendChild(el('span', 'color:' + t.ink45 + ';padding-left:5px;', safeText(d.n)));
      wrap.appendChild(b);
    });
    return wrap;
  }

  function table(box, view, f) {
    var t = tok();
    var c = card();
    var head = el('div', GRID + 'font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:' + t.ink45 + ';');
    ['Time', 'Title', 'Kind', 'Session'].forEach(function (h) { head.appendChild(el('span', '', h)); });
    c.appendChild(head);

    var docs = view.docs || [];
    if (!docs.length) {
      c.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink45 + ';',
        state.loading ? 'reading the docs index…' : 'No docs for this filter.'));
      box.appendChild(c);
      return;
    }

    docs.forEach(function (d) {
      var wrap = el('div', GRID + 'padding:9px 0;border-top:1px solid ' + t.line + ';');
      var when = el('span', 'display:flex;flex-direction:column;gap:2px;');
      when.appendChild(el('span', MONO + 'font-size:12px;color:' + t.ink75 + ';', fmtTime(d.ts)));
      // The day is only worth a line when the list spans more than one.
      if (!f.day) when.appendChild(el('span', MONO + 'font-size:11px;color:' + t.ink45 + ';', safeText(d.day).slice(5)));
      wrap.appendChild(when);

      var title = el('span', 'display:flex;flex-direction:column;gap:2px;min-width:0;');
      // rel=noopener: an artifact link leaves the deck for claude.ai and must not keep a
      // handle on the window it came from.
      var a = el('a', 'font-size:12.5px;color:' + t.ink + ';text-decoration:none;word-break:break-word;', safeText(d.title));
      a.href = openHref(d);
      a.target = '_blank';
      a.rel = 'noopener';
      title.appendChild(a);
      title.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';',
        [safeText(d.project), safeText(d.source)].filter(Boolean).join(' · ')));
      wrap.appendChild(title);

      wrap.appendChild(chip(safeText(d.kind), t.ink60));
      var session = safeText(d.session);
      wrap.appendChild(session
        ? button(shortId(session), function () { setFilter('session', session); },
          { colour: t.ink60, tail: MONO + 'font-size:11.5px;' })
        : el('span', ''));
      c.appendChild(wrap);
    });
    box.appendChild(c);
  }

  var painting = false;
  function paint() {
    var box = mount();
    if (!box) return;
    painting = true;
    box.replaceChildren();
    var fixture = isFixture();
    var view = fixture ? FIXTURE_VIEW : state.view || EMPTY;
    var f = fixture ? {} : filters();
    banner(box);
    toolbar(box, view, f);
    table(box, view, f);
    // replaceChildren dropped the input the operator was typing into; the caret goes back to
    // the end of it, which is where a debounced repaint always leaves it.
    if (state.focus) {
      var search = box.querySelector('input[placeholder]');
      if (search) { search.focus(); search.setSelectionRange(state.q.length, state.q.length); }
    }
    if (observer) observer.takeRecords();
    painting = false;
  }

  // --- activation ---------------------------------------------------------------
  // No poll: the index changes when a session writes a file, and the sweep runs behind
  // Refresh. The screen loads when it is entered and when a filter changes.

  var observer = null;
  var sig = '';

  // The theme toggle rewrites every bound colour in the compiled tree; this screen's nodes are
  // its own, so it repaints when the tokens actually changed — never on its own writes.
  function watch() {
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(function () {
      if (painting) return;
      var next = JSON.stringify(tok());
      if (next === sig && mount() && mount().childElementCount) return;
      sig = next;
      paint();
    });
    observer.observe(document.getElementById('dc-root') || document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['style'],
    });
  }

  function active() {
    return !FD.router || FD.router.route().screen === 'docs';
  }

  function enter() {
    if (!active()) return;
    if (isFixture()) return paint();
    var f = filters();
    // Only the router can put it on the hash; without one there is no hash to fix.
    if (FD.router && !f.source && storedSource()) return setFilter('source', storedSource());
    if (state.key !== query(f) || (!state.view && !state.loading)) load();
    else paint();
  }

  function start() {
    sig = JSON.stringify(tok());
    watch();
    if (FD.router && typeof FD.router.onChange === 'function') FD.router.onChange(function () { enter(); });
    enter();
  }

  FD.screens.docs = Object.assign(FD.screens.docs || {}, {
    start: start, load: load, paint: paint, enter: enter, state: state, _: pure,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else Promise.resolve().then(start);
})(typeof globalThis === 'object' ? globalThis : this);
