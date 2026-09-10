// fd-v2 goals: the 🥅 Goals screen.
//
// The red thread and the goal list the goalkeeper seat keeps in its git jail. The mock has no
// counterpart for this screen, so the template carries only the mount node (#fd-goals-root)
// and everything below draws into it in plain DOM — createElement and textContent only, never
// an HTML string, so a direction the operator dictated can never be parsed as markup.
//
// Reads GET /api/goals. Writes go to POST /api/goals, which spawns goalkeeper.py --by operator
// inside the jail: the seat's own CLI is the only writer, and the route takes the operator's
// browser Origin as its authority. Nothing here polls — the deck asks when the screen is
// entered and when Refresh is clicked, because the goalkeeper commits on its own rhythm.
//
// Data enters the UI ONLY through FD.setData('goalsLive', view) — this slice's own key, the
// same seam convention as accountsLive / machinesLive. The screen paints from `state.view`;
// setData is what a peer slice (or a future template binding) would read.
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

  // thread.md is append-only and the newest direction is the one that still matters, so the
  // screen reads bottom-up while the file stays in its own order.
  function threadOrder(thread) {
    return (Array.isArray(thread) ? thread.slice() : []).reverse();
  }

  var STATUS_RANK = { open: 0, parked: 1, done: 2, dropped: 3 };
  var FOLDED_STATUS = { done: true, dropped: true };
  var statusRank = function (s) {
    return STATUS_RANK[s] === undefined ? 9 : STATUS_RANK[s];
  };

  // `all` first, then the projects in projects.json order, then anything a goal names that
  // projects.json no longer does — a dropped alias must not take its goals off the screen.
  // Within a group: open, then parked; done and dropped fold away behind one toggle.
  function groupGoals(goals, projects) {
    var list = Array.isArray(goals) ? goals : [];
    var order = ['all'].concat(Array.isArray(projects) ? projects : []);
    var seen = {};
    var names = [];
    order.concat(list.map(function (g) { return safeText(g && g.project); })).forEach(function (n) {
      if (n && !seen[n]) { seen[n] = true; names.push(n); }
    });
    return names
      .map(function (name) {
        var mine = list.filter(function (g) { return g && g.project === name; });
        return {
          project: name,
          open: mine
            .filter(function (g) { return !FOLDED_STATUS[g.status]; })
            .sort(function (a, b) { return statusRank(a.status) - statusRank(b.status); }),
          folded: mine.filter(function (g) { return FOLDED_STATUS[g.status]; }),
        };
      })
      .filter(function (g) { return g.open.length || g.folded.length; });
  }

  // One key per field, so a half-typed direction survives a reload, a screen change and a
  // failed POST. Written on input, cleared only when the CLI has actually taken it.
  function draftKey(form, field) {
    return 'fd-goals-draft:' + form + ':' + field;
  }

  // The lines the operator forwards by hand. The goalkeeper never messages a seat itself.
  function relayText(audit) {
    return ((audit && audit.verdicts) || []).map(safeText).join('\n');
  }

  function rel(iso, now) {
    var at = Date.parse(iso || '');
    if (isNaN(at)) return '';
    var m = Math.floor((((now === undefined ? Date.now() : now) - at) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (m < 1440) return Math.floor(m / 60) + 'h ago';
    return Math.floor(m / 1440) + 'd ago';
  }

  // The sample the pixel gate renders: two directions, three goals over two projects with one
  // done, and one audit. Deterministic — no clock, no fetch, no POST.
  var FIXTURE_VIEW = {
    ok: true,
    home: '/Users/operator/goalkeeper',
    updated: '2026-09-10T06:00:00Z',
    projects: ['lowcapsxyz', 'remote-system'],
    thread: [
      { id: 'T-2026-09-09-1', date: 'Wed 2026-09-09', horizon: 'week', project: 'lowcapsxyz',
        text: 'the enrollment is still buggy, partners keep telling us' },
      { id: 'T-2026-09-10-1', date: 'Thu 2026-09-10', horizon: 'day', project: 'remote-system',
        text: 'when can we finally have the live usage ?! :D' },
    ],
    goals: [
      { id: 'GK-1', text: 'find and fix the enrollment bugs partners report', project: 'lowcapsxyz',
        horizon: 'week', status: 'open', thread: 'T-2026-09-09-1', refs: ['XYZ-1858'],
        state: 'two repro paths found, neither fixed yet', by: 'goalkeeper',
        created: '2026-09-09T08:00:00Z', updated: '2026-09-10T05:00:00Z', notes: [] },
      { id: 'GK-2', text: 'keep the websocket up across a restart', project: 'lowcapsxyz',
        horizon: 'week', status: 'parked', thread: 'T-2026-09-09-1', refs: [],
        state: 'parked until the enrollment work lands', by: 'operator',
        created: '2026-09-09T08:05:00Z', updated: '2026-09-09T09:00:00Z',
        notes: [{ at: '2026-09-09T09:00:00Z', by: 'operator', text: 'after enrollment' }] },
      { id: 'GK-3', text: 'live usage on the accounts row', project: 'remote-system',
        horizon: 'day', status: 'done', thread: 'T-2026-09-10-1', refs: ['G19'],
        state: 'shipped, the row reads live now', by: 'goalkeeper',
        created: '2026-09-10T04:00:00Z', updated: '2026-09-10T06:00:00Z', notes: [] },
    ],
    audit: {
      date: '2026-09-10',
      file: 'audits/2026-09-10.md',
      head: ['Two lanes moved, one is stalled on the enrollment repro.'],
      verdicts: ['**Verdict:** the enrollment lane needs a second pair of eyes'],
    },
    git: { sha: 'a1b2c3d', at: '2026-09-10T06:00:00Z', author: 'goalkeeper@local', subject: 'audit 2026-09-10' },
    warnings: [],
  };

  var pure = {
    safeText: safeText, threadOrder: threadOrder, groupGoals: groupGoals, statusRank: statusRank,
    draftKey: draftKey, relayText: relayText, rel: rel,
    STATUS_RANK: STATUS_RANK, FOLDED_STATUS: FOLDED_STATUS, FIXTURE_VIEW: FIXTURE_VIEW,
  };

  FD.screens.goals = Object.assign(FD.screens.goals || {}, { _: pure });
  if (typeof module === 'object' && module.exports) module.exports = FD.screens.goals;

  // In Node (the unit tests) there is no document and nothing below this point runs.
  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------------------------
  // Live mode.
  // ---------------------------------------------------------------------------

  var MOUNT = 'fd-goals-root';
  var STATUS_TONE = { open: 'ink', parked: 'warn', done: 'good', dropped: 'ink35' };

  // Mirrors FD.data.isFixture() so this file can still decide when FD.data is absent.
  function isFixture() {
    if (FD.data && typeof FD.data.isFixture === 'function') return FD.data.isFixture();
    try { if (root.localStorage.getItem('fd-fixture') === '1') return true; } catch (e) { /* no storage */ }
    var search = root.location && root.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // Published by logic.js on every render, so the screen follows the theme toggle.
  function tok() {
    return FD.screens.goals.tokens || {
      ink: '#111', ink75: '#333', ink60: '#666', ink45: '#888', ink35: '#aaa',
      warn: '#b26a00', bad: '#c0392b', good: '#2e7d32', line: 'rgba(128,128,128,.28)',
      panel: 'transparent', panelShadow: 'none', hoverBg: 'rgba(128,128,128,.12)',
      cardPad: '18px 20px',
    };
  }

  var state = {
    view: null, missing: '', error: '', loading: false,
    folds: {}, notes: {}, arm: {}, noteDraft: {}, auditOpen: false, restored: false,
  };

  // --- storage, always guarded: a locked-down browser must not break the screen -----
  function readDraft(form, field) {
    try { return root.localStorage.getItem(draftKey(form, field)) || ''; } catch (e) { return ''; }
  }
  function writeDraft(form, field, value) {
    try {
      if (value) root.localStorage.setItem(draftKey(form, field), value);
      else root.localStorage.removeItem(draftKey(form, field));
    } catch (e) { /* no storage */ }
  }
  function clearDrafts(form, fields) {
    fields.forEach(function (f) { writeDraft(form, f, ''); });
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
    return el(
      'span',
      'border-radius:9999px;border:1px solid ' + t.line + ';padding:2px 9px;font-size:11px;color:' + colour + ';white-space:nowrap;',
      text
    );
  }

  function button(text, onclick, opts) {
    var t = tok();
    var b = el(
      'button',
      'border-radius:9999px;border:1px solid ' + ((opts && opts.border) || t.line) + ';background:transparent;color:' +
        ((opts && opts.colour) || t.ink75) + ';padding:4px 12px;font-size:12px;cursor:pointer;white-space:nowrap;' +
        ((opts && opts.tail) || ''),
      text
    );
    b.onclick = onclick;
    return b;
  }

  function card() {
    var t = tok();
    return el(
      'div',
      'border-radius:12px;border:1px solid ' + t.line + ';background:' + t.panel + ';box-shadow:' + t.panelShadow +
        ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);padding:' +
        (t.cardPad || '18px 20px') + ';display:flex;flex-direction:column;gap:12px;'
    );
  }

  var MONO = "font-family:ui-monospace,'SF Mono',Menlo,monospace;";
  var ROW = 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;';

  function sectionTitle(text) {
    return el('span', 'font-size:13px;font-weight:600;color:' + tok().ink + ';', text);
  }

  function field(tag, placeholder, form, name, value) {
    var t = tok();
    var n = el(tag, 'border-radius:' + (tag === 'textarea' ? '10px' : '9999px') + ';border:1px solid ' + t.line +
      ';background:transparent;color:' + t.ink + ';padding:8px 12px;font-size:12.5px;' +
      (tag === 'textarea' ? 'min-height:64px;resize:vertical;width:100%;box-sizing:border-box;' : 'flex:1;min-width:180px;'));
    n.placeholder = placeholder;
    // A value passed in is live state, not a restored draft: only storage sets the hint.
    var stored = value === undefined ? readDraft(form, name) : '';
    var saved = value === undefined ? stored : value;
    if (saved) n.value = saved;
    if (stored) state.restored = true;
    n.addEventListener('input', function () { writeDraft(form, name, n.value); });
    return n;
  }

  function select(form, name, options, initial) {
    var t = tok();
    var s = el('select', 'border-radius:9999px;border:1px solid ' + t.line + ';background:transparent;color:' +
      t.ink + ';padding:6px 10px;font-size:12.5px;');
    options.forEach(function (o) {
      var opt = el('option', '', o.label);
      opt.value = o.value;
      s.appendChild(opt);
    });
    var saved = readDraft(form, name);
    var wanted = saved || initial;
    if (wanted && options.some(function (o) { return o.value === wanted; })) {
      s.value = wanted;
      if (saved) state.restored = true;
    }
    s.addEventListener('change', function () { writeDraft(form, name, s.value); });
    return s;
  }

  // day | week, as two pills rather than a select: it is a two-value choice and the default
  // (week) has to be visible without opening anything.
  function horizonToggle(form, name) {
    var t = tok();
    var wrap = el('span', 'display:inline-flex;gap:4px;');
    var value = readDraft(form, name) || 'week';
    if (readDraft(form, name)) state.restored = true;
    ['day', 'week'].forEach(function (h) {
      var b = button(h, function () {
        value = h;
        writeDraft(form, name, h);
        paint();
      });
      if (value === h) b.setAttribute('style', b.getAttribute('style').replace('background:transparent', 'background:' + t.hoverBg) + 'color:' + t.ink + ';');
      wrap.appendChild(b);
    });
    wrap.value = function () { return value; };
    return wrap;
  }

  // --- network -----------------------------------------------------------------

  function load() {
    if (isFixture()) return Promise.resolve();
    state.loading = true;
    paint();
    return fetch('/api/goals')
      .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (r) {
        if (r.status === 503) { state.missing = safeText(r.body && r.body.home); state.view = null; return; }
        if (!r.body || r.body.ok !== true) throw new Error(safeText((r.body && r.body.error) || 'cannot reach fleetdeck'));
        state.missing = '';
        state.error = '';
        publish(r.body);
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'cannot reach fleetdeck'; })
      .then(function () { state.loading = false; paint(); });
  }

  // Success replaces the whole view from the response, which the route builds by re-reading
  // the jail after the CLI committed — so the screen shows what is on disk, never a guess.
  function post(body, form, fields) {
    if (isFixture()) return Promise.resolve();
    state.loading = true;
    paint();
    return fetch('/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (r) {
        if (!r.body || r.body.ok !== true) throw new Error(safeText((r.body && r.body.error) || 'the write failed'));
        state.error = '';
        if (form) clearDrafts(form, fields || []);
        publish(r.body);
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'the write failed'; })
      .then(function () { state.loading = false; paint(); });
  }

  // The ONLY data entry point.
  function publish(view) {
    state.view = view;
    if (typeof FD.setData === 'function') FD.setData('goalsLive', view);
  }

  // --- render ------------------------------------------------------------------

  function mount() {
    return document.getElementById(MOUNT);
  }

  function banner(box) {
    if (!state.error) return;
    var t = tok();
    var b = el('div', 'border-radius:10px;border:1px solid ' + t.bad + ';color:' + t.bad +
      ';padding:9px 14px;font-size:12.5px;' + ROW);
    b.appendChild(el('span', 'flex:1;', state.error));
    b.appendChild(button('Dismiss', function () { state.error = ''; paint(); }, { colour: t.bad, border: t.bad }));
    box.appendChild(b);
  }

  function header(box, view) {
    var t = tok();
    var c = card();
    var top = el('div', ROW);
    top.appendChild(el('span', 'font-size:15px;font-weight:600;color:' + t.ink + ';', '🥅 Goals'));
    top.appendChild(el('span', 'font-size:12.5px;color:' + t.ink60 + ';',
      'the red thread, managed by the goalkeeper and the operator'));
    var right = el('span', 'margin-left:auto;' + ROW);
    if (view.updated) right.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';', 'updated ' + rel(view.updated)));
    var refresh = button(state.loading ? 'Refreshing…' : 'Refresh', function () { load(); });
    refresh.disabled = !!state.loading || isFixture();
    right.appendChild(refresh);
    top.appendChild(right);
    c.appendChild(top);
    if (view.git)
      c.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';' + MONO,
        'last commit ' + safeText(view.git.author) + ' · ' + rel(view.git.at) + ' · ' + safeText(view.git.subject)));
    (view.warnings || []).forEach(function (w) {
      c.appendChild(el('p', 'margin:0;font-size:12px;color:' + t.warn + ';', safeText(w)));
    });
    box.appendChild(c);
  }

  function projectOptions(view) {
    return [{ value: 'all', label: 'all' }].concat(
      (view.projects || []).map(function (p) { return { value: safeText(p), label: safeText(p) }; })
    );
  }

  function threadSection(box, view) {
    var t = tok();
    var c = card();
    var entries = threadOrder(view.thread);
    var head = el('div', ROW);
    head.appendChild(sectionTitle('Red thread'));
    head.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';',
      entries.length + (entries.length === 1 ? ' direction' : ' directions') + ', newest first'));
    c.appendChild(head);

    entries.forEach(function (e) {
      var wrap = el('div', 'display:flex;flex-direction:column;gap:5px;padding:9px 0;border-top:1px solid ' + t.line + ';');
      wrap.id = 'fd-goals-thread-' + safeText(e.id);
      var line = el('div', ROW);
      line.appendChild(el('span', MONO + 'font-size:12px;color:' + t.ink + ';', safeText(e.id)));
      line.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';', safeText(e.date)));
      line.appendChild(chip(safeText(e.horizon), t.ink60));
      line.appendChild(chip(safeText(e.project), t.ink60));
      wrap.appendChild(line);
      // The value of thread.md is that every line is the operator's own words, so the text is
      // rendered exactly as it was dictated — wrapped, never reflowed, never trimmed.
      wrap.appendChild(el('p', 'margin:0;font-size:12.5px;line-height:1.6;white-space:pre-wrap;color:' + t.ink75 + ';', safeText(e.text)));
      c.appendChild(wrap);
    });

    var form = el('div', 'display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid ' + t.line + ';');
    var text = field('textarea', 'your words, verbatim', 'thread', 'text');
    var project = select('thread', 'project', projectOptions(view), 'all');
    var horizon = horizonToggle('thread', 'horizon');
    var controls = el('div', ROW);
    controls.appendChild(project);
    controls.appendChild(horizon);
    controls.appendChild(button('Add to thread', function () {
      if (!text.value.trim()) { state.error = 'a direction needs words'; return paint(); }
      post({ op: 'thread.add', text: text.value, project: project.value, horizon: horizon.value() },
        'thread', ['text', 'project', 'horizon']);
    }));
    form.appendChild(text);
    form.appendChild(controls);
    c.appendChild(form);
    box.appendChild(c);
  }

  function goalRow(c, g) {
    var t = tok();
    var wrap = el('div', 'display:flex;flex-direction:column;gap:6px;padding:9px 0;border-top:1px solid ' + t.line + ';');
    var line = el('div', ROW);
    line.appendChild(el('span', MONO + 'font-size:12px;color:' + t.ink + ';', safeText(g.id)));
    line.appendChild(chip(safeText(g.status), t[STATUS_TONE[g.status] || 'ink60'] || t.ink60));
    line.appendChild(chip(safeText(g.horizon), t.ink60));
    line.appendChild(el('span', 'font-size:12.5px;color:' + t.ink + ';flex:1;min-width:200px;', safeText(g.text)));
    if (g.thread)
      line.appendChild(button(safeText(g.thread), function () {
        var target = document.getElementById('fd-goals-thread-' + safeText(g.thread));
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, { colour: t.ink60 }));
    (Array.isArray(g.refs) ? g.refs : []).forEach(function (r) { line.appendChild(chip(safeText(r), t.ink45)); });
    wrap.appendChild(line);

    if (g.state)
      wrap.appendChild(el('p', 'margin:0;font-size:12px;color:' + t.ink45 + ';white-space:pre-wrap;', safeText(g.state)));

    var acts = el('div', ROW);
    var notes = Array.isArray(g.notes) ? g.notes : [];
    if (notes.length)
      acts.appendChild(button(notes.length + (notes.length === 1 ? ' note' : ' notes'), function () {
        state.notes[g.id] = !state.notes[g.id];
        paint();
      }, { colour: t.ink60 }));
    if (g.status === 'open') {
      acts.appendChild(button('Done', function () { post({ op: 'goal.set', id: g.id, status: 'done' }); }));
      acts.appendChild(button('Park', function () { post({ op: 'goal.set', id: g.id, status: 'parked' }); }));
    } else {
      acts.appendChild(button('Reopen', function () { post({ op: 'goal.set', id: g.id, status: 'open' }); }));
    }
    // Two clicks, three seconds apart at most: dropping a goal is the one action here that
    // throws the operator's own direction away.
    if (state.arm[g.id])
      acts.appendChild(button('Sure? Drop', function () {
        state.arm[g.id] = false;
        post({ op: 'goal.set', id: g.id, status: 'dropped' });
      }, { colour: t.bad, border: t.bad }));
    else
      acts.appendChild(button('Drop', function () {
        state.arm[g.id] = true;
        paint();
        root.setTimeout(function () {
          if (!state.arm[g.id]) return;
          state.arm[g.id] = false;
          paint();
        }, 3000);
      }, { colour: t.ink60 }));
    // undefined until it is typed, so field() can still restore the draft localStorage kept.
    var noteInput = field('input', 'a note', 'note', g.id, state.noteDraft[g.id]);
    noteInput.addEventListener('input', function () { state.noteDraft[g.id] = noteInput.value; });
    var sendNote = function () {
      if (!noteInput.value.trim()) return;
      state.noteDraft[g.id] = '';
      post({ op: 'goal.note', id: g.id, text: noteInput.value }, 'note', [g.id]);
    };
    // Enter sends the note: one field, one line, no reason to reach for the button.
    noteInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendNote(); } });
    acts.appendChild(noteInput);
    acts.appendChild(button('Note', sendNote));
    wrap.appendChild(acts);

    if (state.notes[g.id])
      notes.forEach(function (n) {
        var l = el('div', ROW + 'padding-left:12px;');
        l.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';', rel(n && n.at) + ' · ' + safeText(n && n.by)));
        l.appendChild(el('span', 'font-size:12px;color:' + t.ink75 + ';white-space:pre-wrap;', safeText(n && n.text)));
        wrap.appendChild(l);
      });

    c.appendChild(wrap);
  }

  function goalsSection(box, view) {
    var t = tok();
    var c = card();
    c.appendChild(sectionTitle('Goals'));
    var groups = groupGoals(view.goals, view.projects);
    if (!groups.length)
      c.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink45 + ';', 'no goals yet — the goalkeeper reads the thread and proposes them.'));

    groups.forEach(function (group) {
      var head = el('div', ROW + 'padding-top:8px;');
      head.appendChild(el('span', 'font-size:12.5px;font-weight:500;color:' + t.ink + ';', group.project));
      head.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';', group.open.length + ' open'));
      c.appendChild(head);
      group.open.forEach(function (g) { goalRow(c, g); });
      if (!group.folded.length) return;
      var open = !!state.folds[group.project];
      c.appendChild(button((open ? 'hide ' : 'show ') + group.folded.length + ' done/dropped', function () {
        state.folds[group.project] = !open;
        paint();
      }, { colour: t.ink45, tail: 'align-self:flex-start;' }));
      if (open) group.folded.forEach(function (g) { goalRow(c, g); });
    });

    var form = el('div', 'display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid ' + t.line + ';');
    var text = field('textarea', 'the goal, in one sentence', 'goal', 'text');
    var project = select('goal', 'project', projectOptions(view), 'all');
    var horizon = horizonToggle('goal', 'horizon');
    var thread = select('goal', 'thread',
      [{ value: '', label: 'no thread' }].concat(threadOrder(view.thread).map(function (e) {
        return { value: safeText(e.id), label: safeText(e.id) + ' · ' + safeText(e.project) };
      })), '');
    var refs = field('input', 'refs, comma separated', 'goal', 'refs');
    var controls = el('div', ROW);
    controls.appendChild(project);
    controls.appendChild(horizon);
    controls.appendChild(thread);
    controls.appendChild(refs);
    controls.appendChild(button('Add goal', function () {
      if (!text.value.trim()) { state.error = 'a goal needs words'; return paint(); }
      var list = refs.value.split(',').map(function (r) { return r.trim(); }).filter(Boolean);
      var body = { op: 'goal.add', text: text.value, project: project.value, horizon: horizon.value(), refs: list };
      if (thread.value) body.thread = thread.value;
      post(body, 'goal', ['text', 'project', 'horizon', 'thread', 'refs']);
    }));
    form.appendChild(text);
    form.appendChild(controls);
    c.appendChild(form);
    box.appendChild(c);
  }

  function auditSection(box, view) {
    if (!view.audit) return;
    var t = tok();
    var c = card();
    var head = el('div', ROW);
    head.appendChild(button('Audit ' + safeText(view.audit.date) + (state.auditOpen ? ' ▾' : ' ▸'), function () {
      state.auditOpen = !state.auditOpen;
      paint();
    }, { colour: t.ink }));
    head.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';' + MONO, safeText(view.audit.file)));
    c.appendChild(head);
    if (state.auditOpen) {
      (view.audit.verdicts || []).forEach(function (l) {
        c.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink + ';white-space:pre-wrap;', safeText(l)));
      });
      (view.audit.head || []).forEach(function (l) {
        c.appendChild(el('p', 'margin:0;font-size:12px;color:' + t.ink60 + ';white-space:pre-wrap;', safeText(l)));
      });
      // Copied, not sent: the goalkeeper never messages a seat, so a relay is the operator's
      // own paste into whichever session should hear it.
      c.appendChild(button('Copy relay lines', function () {
        var text = relayText(view.audit);
        if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(text);
      }, { colour: tok().ink60, tail: 'align-self:flex-start;' }));
    }
    box.appendChild(c);
  }

  function missingCard(box) {
    var t = tok();
    var c = card();
    c.appendChild(sectionTitle('🥅 Goals'));
    c.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink60 + ';',
      'goalkeeper home not found at ' + state.missing));
    c.appendChild(el('p', 'margin:0;font-size:12px;color:' + t.ink45 + ';',
      'the goalkeeper seat keeps its jail there. Nothing on this screen can create it — the seat does, with its own CLI.'));
    box.appendChild(c);
  }

  var painting = false;
  function paint() {
    var box = mount();
    if (!box) return;
    painting = true;
    state.restored = false;
    box.replaceChildren();
    var view = isFixture() ? FIXTURE_VIEW : state.view;
    banner(box);
    if (state.missing && !view) missingCard(box);
    else if (view) {
      header(box, view);
      threadSection(box, view);
      goalsSection(box, view);
      auditSection(box, view);
    } else if (!state.error) {
      box.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + tok().ink45 + ';', 'reading the goalkeeper jail…'));
    }
    // The hint is discovered while the fields are built, which is after the header was
    // appended; one cheap second pass rather than a two-phase render.
    if (state.restored && !box.querySelector('[data-fd-goals-draft]')) {
      var hint = el('span', 'font-size:11.5px;color:' + tok().ink45 + ';', '💾 draft restored');
      hint.setAttribute('data-fd-goals-draft', '1');
      box.insertBefore(hint, box.firstChild);
    }
    if (observer) observer.takeRecords();
    painting = false;
  }

  // --- activation ---------------------------------------------------------------
  // No poll: the jail changes when the goalkeeper commits, and the operator asks for that
  // with Refresh. The screen loads once when it is entered.

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
    return !FD.router || FD.router.route().screen === 'goals';
  }

  function enter() {
    if (!active()) return;
    if (isFixture()) return paint();
    if (!state.view && !state.missing && !state.loading) load();
    else paint();
  }

  function start() {
    sig = JSON.stringify(tok());
    watch();
    if (FD.router && typeof FD.router.onChange === 'function') FD.router.onChange(function () { enter(); });
    enter();
  }

  FD.screens.goals = Object.assign(FD.screens.goals || {}, {
    start: start, load: load, paint: paint, enter: enter, state: state, _: pure,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else Promise.resolve().then(start);
})(typeof globalThis === 'object' ? globalThis : this);
