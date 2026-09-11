// L10 acceptance: the pure logic behind the Desktop sessions screen.
//
// public/v2/screens/desktop.js is a browser IIFE and every function in it is
// closure-local — nothing is exported but FD.screens.desktop.{slice, openBus,
// rowAction}. It is therefore NOT restructured for testability. It is loaded the way
// it is actually loadable: read as text, evaluated in a node:vm context whose global
// carries a minimal fake window (a stub FD.data with isFixture() === false, a spy
// FD.setData, a small fake document, a fake navigator.clipboard). Everything under
// test is then observed through the two surfaces that exist:
//
//   * FD.setData('dsData', …) — the adapter output: fallbacks, age() strings, the
//     sort comparators, the archived rows and the filter predicate;
//   * FD.screens.desktop.rowAction('copy', row, null) — sessionContext(), which
//     lands in the fake clipboard. The `null` element is deliberate: labelPill()
//     returns early without one, so no DOM is needed to reach the text.
//
// The four filter selects are the real <select>s the screen enhances, so setting a
// value and firing 'change' runs the screen's own listener and its own predicate.
// No fixture file is required here: public/v2/fixture.js is browser-only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/v2/screens/desktop.js'), 'utf8');
// L1's adapter, called by the screen's build(). The real one, so "archived rows
// survive" and "no second Live now group" are asserted against what actually ships.
const data = require(path.join(ROOT, 'public/v2/data.js'));

const DOT = ' · '; // U+00B7 MIDDLE DOT, the separator sessionContext() uses

// ---------------------------------------------------------------------------
// The smallest DOM the screen's apply() needs: a screen root holding the filter
// bar, and the bar holding the four selects it binds. Everything else it looks for
// (the search input, the Reset button, the count span) is absent, which is a case
// the screen already guards with early returns.
// ---------------------------------------------------------------------------

function node(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    attrs: { ...attrs },
    listeners: {},
    style: { cssText: '' },
    parentNode: null,
    value: '',
    _text: '',
    hasAttribute: (k) => k in el.attrs,
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    setAttribute: (k, v) => { el.attrs[k] = String(v); },
    addEventListener: (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    fire: (type) => (el.listeners[type] || []).forEach((fn) => fn({ target: el, currentTarget: el })),
    appendChild: (child) => { child.parentNode = el; el.children.push(child); return child; },
    removeChild: (child) => { el.children = el.children.filter((c) => c !== child); child.parentNode = null; return child; },
    insertBefore: (child, ref) => {
      child.parentNode = el;
      const pos = ref ? el.children.indexOf(ref) : -1;
      if (pos < 0) el.children.push(child); else el.children.splice(pos, 0, child);
      return child;
    },
    // Tag names and single attribute selectors, one level deep — the only shapes
    // the screen asks this fake for.
    find: (sel) => {
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
      return el.children.filter((c) => (attr
        ? (attr[2] === undefined ? c.hasAttribute(attr[1]) : c.getAttribute(attr[1]) === attr[2])
        : c.tagName === sel.toUpperCase()));
    },
    querySelector: (sel) => el.find(sel)[0] || null,
    querySelectorAll: (sel) => el.find(sel),
    get firstChild() { return el.children[0] || null; },
    get lastChild() { return el.children[el.children.length - 1] || null; },
    get nextSibling() {
      const parent = el.parentNode;
      return parent ? parent.children[parent.children.indexOf(el) + 1] || null : null;
    },
    get previousElementSibling() {
      const parent = el.parentNode;
      return parent ? parent.children[parent.children.indexOf(el) - 1] || null : null;
    },
  };
  Object.defineProperty(el, 'textContent', {
    get: () => (el.children.length ? el.children.map((c) => c.textContent).join('') : el._text),
    set: (v) => { el.children = []; el._text = String(v); },
  });
  return el;
}

const SELECTS = ['account', 'machine', 'live', 'archived'];

// opts.present lets a test take the screen root away and hand it back, the way a
// screen switch does in the browser; opts.poll swaps the FD.data.poll stub.
function boot(body, opts = {}) {
  const present = opts.present || (() => true);
  const screen = node('div', { 'data-screen-label': 'Desktop sessions' });
  const bar = screen.appendChild(node('div', { 'data-dc-tpl': '650' }));
  const selects = SELECTS.map(() => bar.appendChild(node('select')));
  const pushed = [];
  const clipboard = [];
  const errors = [];
  const sandbox = {
    console: { error: (...args) => errors.push(args.map(String).join(' ')), log: () => {} },
    setTimeout,
    clearTimeout,
    document: {
      querySelector: (sel) => (sel === '[data-screen-label="Desktop sessions"]' && present() ? screen : null),
      createElement: (tag) => node(tag),
      getElementById: () => null,
      hidden: false,
    },
    localStorage: opts.localStorage,
    navigator: { clipboard: { writeText: (text) => { clipboard.push(text); return Promise.resolve(); } } },
    FD: {
      data: {
        isFixture: () => false,
        toDesktop: data.toDesktop,
        desktopSessions: () => Promise.resolve(body),
        transcript: () => Promise.resolve('TRANSCRIPT'),
        // Without a poll handle the screen would reload on every apply().
        poll: opts.poll || (() => ({ stop: () => {} })),
      },
      setData: (name, value) => pushed.push([name, value]),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'public/v2/screens/desktop.js' });
  const select = (kind, value) => {
    const el = selects[SELECTS.indexOf(kind)];
    el.value = value;
    el.fire('change');
    return pushed[pushed.length - 1][1];
  };
  return { sandbox, screen, pushed, clipboard, errors, selects, select };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

async function until(condition, what) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await turn();
  }
  throw new Error('timed out waiting for ' + what);
}

// Boots, waits for the first load to reach FD.setData, and hands back the pushed
// groups plus the handles a test may want.
async function loaded(body, opts) {
  const ctx = boot(body, opts);
  await until(() => ctx.pushed.length, 'the first FD.setData(\'dsData\', …)');
  assert.deepEqual(ctx.errors, [], 'the screen logged an error while loading');
  assert.equal(ctx.pushed[0][0], 'dsData');
  ctx.groups = ctx.pushed[0][1];
  return ctx;
}

// ---------------------------------------------------------------------------
// Fixture builders. Only the fields the screen reads.
// ---------------------------------------------------------------------------

const stamp = (minutes) => new Date(Date.now() - minutes * 60000 - 500).toISOString();
// A fixed clock for the fixtures whose ordering is under test. `at(0)` is the most
// recent, so a fixture listed newest-first also renders newest-first.
const BASE = Date.parse('2026-09-06T10:00:00.000Z');
const at = (minutes) => new Date(BASE - minutes * 60000).toISOString();

const session = (over) => ({
  id: 'local_x',
  title: 'A session',
  cwd: '/w',
  worktree: null,
  branch: 'br',
  model: 'mo',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: at(0),
  isArchived: false,
  completedTurns: 1,
  cliSessionId: 'cli-x',
  live: false,
  liveState: 'offline',
  liveName: null,
  messageTarget: null,
  stale: false,
  ...over,
});

const group = (over) => ({
  accountUuid: 'acc-1',
  orgUuid: 'org-1',
  machine: 'm1',
  label: 'Aylin Yeter',
  email: 'aylin@example.com',
  sessions: [],
  ...over,
});

const payload = (groups, machines) => ({
  groups,
  machines: machines || [{ id: 'm1', label: 'MacBook Pro', state: 'ok', stale: false }],
  collected_at: Date.now(),
  collecting: false,
  ttl_ms: 300000,
});

const allRows = (groups) => groups.reduce((out, g) => out.concat(g.rows), []);
const byId = (groups, id) => allRows(groups).filter((r) => r.id === id)[0];
const ids = (groups) => groups.map((g) => g.rows.map((r) => r.id));

// ---------------------------------------------------------------------------
// age() — BEHAVIOUR.md §3. Read off row.when, the only place it surfaces.
// ---------------------------------------------------------------------------

test('age() covers every boundary of Just now / Nm / Nh / Nd / Unknown', async () => {
  const cases = [
    ['no-stamp', null, 'Unknown'],
    ['unparseable', 'whenever', 'Unknown'],
    ['under-a-minute', stamp(0), 'Just now'],
    ['fifty-nine-minutes', stamp(59), '59m ago'],
    ['sixty-minutes', stamp(60), '1h ago'],
    ['1439-minutes', stamp(1439), '23h ago'],
    ['1440-minutes', stamp(1440), '1d ago'],
    // Math.max(0, …): a clock skew that puts the stamp in the future must not
    // produce a negative age.
    ['future', new Date(Date.now() + 5 * 60000).toISOString(), 'Just now'],
  ];
  const { groups } = await loaded(payload([
    group({ sessions: cases.map(([id, when]) => session({ id, lastActivityAt: when })) }),
  ]));
  assert.deepEqual(
    cases.map(([id]) => [id, byId(groups, id).when]),
    cases.map(([id, , want]) => [id, want])
  );
});

// ---------------------------------------------------------------------------
// sessionContext() — BEHAVIOUR.md §3, reached through rowAction('copy', row, null).
// ---------------------------------------------------------------------------

test('sessionContext() writes the spec\'s Label: value lines, in order, with a trailing newline', async () => {
  const ctx = await loaded(payload([
    group({
      sessions: [session({
        id: 'local_full',
        title: 'Full session',
        cwd: '/home/vibe/projects/remote-system',
        worktree: '/home/vibe/wt',
        branch: 'claude/full',
        model: 'claude-opus-5',
        createdAt: '2026-09-01T10:00:00.000Z',
        lastActivityAt: '2026-09-06T10:00:00.000Z',
        completedTurns: 0, // a 0 is a real turn count and must survive the filter
        cliSessionId: 'cli-full',
        liveState: 'live',
        live: true,
        messageTarget: { type: 'claude-desktop', session: 'id:cli-full' },
      })],
    }),
  ]));
  ctx.sandbox.FD.screens.desktop.rowAction('copy', byId(ctx.groups, 'local_full'), null);
  await until(() => ctx.clipboard.length, 'the clipboard write');
  assert.equal(ctx.clipboard[0], [
    'Title: Full session',
    'Account: Aylin Yeter' + DOT + 'aylin@example.com' + DOT + 'acc-1',
    'Machine: MacBook Pro',
    'Directory: /home/vibe/projects/remote-system',
    'Worktree: /home/vibe/wt',
    'Branch: claude/full',
    'Model: claude-opus-5',
    'Created: 2026-09-01T10:00:00.000Z',
    'Last activity: 2026-09-06T10:00:00.000Z',
    'Turns: 0',
    'Status: live',
    'CLI session: cli-full',
    'Session: local_full',
  ].join('\n') + '\n');
});

test('sessionContext() skips null, undefined and empty values and marks an archived row', async () => {
  const ctx = await loaded(payload([
    group({
      email: '', // an empty account part drops out of the joined Account line
      sessions: [session({
        id: 'local_bare',
        title: null,
        worktree: null,
        branch: null,
        model: undefined,
        createdAt: null,
        cliSessionId: null,
        completedTurns: null,
        isArchived: true,
        liveState: 'offline',
        lastActivityAt: '2026-09-06T10:00:00.000Z',
      })],
    }),
  ]));
  ctx.sandbox.FD.screens.desktop.rowAction('copy', byId(ctx.groups, 'local_bare'), null);
  await until(() => ctx.clipboard.length, 'the clipboard write');
  assert.equal(ctx.clipboard[0], [
    // Title falls back before it is copied; Worktree, Branch, Model, Created,
    // Turns and CLI session are absent, so their lines are not written at all.
    'Title: Untitled session',
    'Account: Aylin Yeter' + DOT + 'acc-1',
    'Machine: MacBook Pro',
    'Directory: /w',
    'Last activity: 2026-09-06T10:00:00.000Z',
    'Status: offline, archived',
    'Session: local_bare',
  ].join('\n') + '\n');
});

// ---------------------------------------------------------------------------
// The adapter: what build() adds on top of FD.data.toDesktop.
// ---------------------------------------------------------------------------

test('archived rows survive, where L1\'s toDesktop drops them', async () => {
  const body = payload([
    group({ sessions: [session({ id: 'local_live', lastActivityAt: at(0) }), session({ id: 'local_archived', isArchived: true, lastActivityAt: at(1) })] }),
  ]);
  assert.deepEqual(
    data.toDesktop(body).slice(1).map((g) => g.rows.map((r) => r.sid)),
    [['local_live']],
    'toDesktop is expected to drop archived rows — if it stopped, build() needs revisiting'
  );
  const { groups } = await loaded(body);
  assert.deepEqual(ids(groups), [['local_live', 'local_archived']]);
  assert.equal(byId(groups, 'local_archived').isArchived, true);
});

test('the pushed array carries no "Live now" group, so logic.js builds exactly one', async () => {
  const body = payload([group({ sessions: [session({ id: 'local_live', live: true, liveState: 'live' })] })]);
  assert.equal(data.toDesktop(body)[0].name, 'Live now', 'toDesktop still prepends its own head group');
  const { groups } = await loaded(body);
  assert.deepEqual(groups.map((g) => g.name), ['Aylin Yeter']);
  assert.equal(allRows(groups).filter((r) => r.live).length, 1);
});

test('a null completedTurns reads "Turns unknown", not "0 turns"', async () => {
  const body = payload([group({ sessions: [
    session({ id: 'local_null', completedTurns: null }),
    session({ id: 'local_zero', completedTurns: 0 }),
  ] })]);
  // L1.2 fixed this at the source, so the adapter now agrees with the screen. Kept as a
  // canary: if it ever regresses, the screen's own fallback is the only thing left.
  assert.equal(data.toDesktop(body)[1].rows[0].turns, 'Turns unknown', 'toDesktop renders a null as Turns unknown (L1.2)');
  const { groups } = await loaded(body);
  assert.equal(byId(groups, 'local_null').turns, 'Turns unknown');
  assert.equal(byId(groups, 'local_zero').turns, '0 turns');
});

test('sessions sort by lastActivityAt desc, then id asc', async () => {
  const same = '2026-09-06T10:00:00.000Z';
  const { groups } = await loaded(payload([group({ sessions: [
    session({ id: 'local_b', lastActivityAt: same }),
    session({ id: 'local_a', lastActivityAt: same }),
    session({ id: 'local_c', lastActivityAt: '2026-09-06T10:01:00.000Z' }),
    session({ id: 'local_d', lastActivityAt: '2026-09-05T10:00:00.000Z' }),
  ] })]));
  assert.deepEqual(ids(groups), [['local_c', 'local_a', 'local_b', 'local_d']]);
});

test('groups sort by label, then accountUuid, then machine, then orgUuid', async () => {
  const one = (over) => group({ ...over, sessions: [session({ id: 'local_' + over.label + over.accountUuid + over.machine })] });
  const { groups } = await loaded(payload([
    one({ label: 'Bravo', accountUuid: 'a', machine: 'a', orgUuid: 'o' }),
    one({ label: 'Alpha', accountUuid: 'b', machine: 'a', orgUuid: 'o' }),
    one({ label: 'Alpha', accountUuid: 'a', machine: 'z', orgUuid: 'o' }),
    one({ label: 'Alpha', accountUuid: 'a', machine: 'a', orgUuid: 'o' }),
  ], [{ id: 'a', label: 'A', state: 'ok', stale: false }, { id: 'z', label: 'Z', state: 'ok', stale: false }]));
  assert.deepEqual(
    groups.map((g) => [g.label, g.accountUuid, g.machine]),
    [['Alpha', 'a', 'a'], ['Alpha', 'a', 'z'], ['Alpha', 'b', 'a'], ['Bravo', 'a', 'a']]
  );
});

// ---------------------------------------------------------------------------
// The filter predicate — BEHAVIOUR.md §2. Driven through the real <select>s.
// ---------------------------------------------------------------------------

test('the four filters AND together, and "" means no filter', async () => {
  const machines = [
    { id: 'm1', label: 'MacBook Pro', state: 'ok', stale: false },
    { id: 'm2', label: 'german-box', state: 'ok', stale: false },
  ];
  const ctx = await loaded(payload([
    group({
      accountUuid: 'acc-1', orgUuid: 'org-1', machine: 'm1', label: 'Aylin Yeter',
      sessions: [
        session({ id: 'a-live', live: true, liveState: 'live', lastActivityAt: at(0) }),
        session({ id: 'a-unknown', liveState: 'unknown', lastActivityAt: at(1) }),
        session({ id: 'a-archived', liveState: 'offline', isArchived: true, lastActivityAt: at(2) }),
      ],
    }),
    group({
      accountUuid: 'acc-2', orgUuid: 'org-2', machine: 'm2', label: 'Daniel Tabor',
      sessions: [session({ id: 'd-offline', liveState: 'offline' })],
    }),
  ], machines));

  // Defaults: everything through.
  assert.deepEqual(ids(ctx.groups), [['a-live', 'a-unknown', 'a-archived'], ['d-offline']]);

  assert.deepEqual(ids(ctx.select('account', 'acc-1:org-1')), [['a-live', 'a-unknown', 'a-archived']]);
  assert.deepEqual(ids(ctx.select('account', '')), [['a-live', 'a-unknown', 'a-archived'], ['d-offline']]);

  assert.deepEqual(ids(ctx.select('machine', 'm2')), [['d-offline']]);
  assert.deepEqual(ids(ctx.select('machine', '')), [['a-live', 'a-unknown', 'a-archived'], ['d-offline']]);

  assert.deepEqual(ids(ctx.select('live', 'live')), [['a-live']]);
  assert.deepEqual(ids(ctx.select('live', 'unknown')), [['a-unknown']]);
  assert.deepEqual(ids(ctx.select('live', 'offline')), [['a-archived'], ['d-offline']]);
  assert.deepEqual(ids(ctx.select('live', '')), [['a-live', 'a-unknown', 'a-archived'], ['d-offline']]);

  assert.deepEqual(ids(ctx.select('archived', 'archived')), [['a-archived']]);
  assert.deepEqual(ids(ctx.select('archived', 'active')), [['a-live', 'a-unknown'], ['d-offline']]);

  // AND, not OR: 'active' still applies while a second filter narrows further.
  assert.deepEqual(ids(ctx.select('live', 'offline')), [['d-offline']]);
  assert.deepEqual(ids(ctx.select('account', 'acc-1:org-1')), [], 'an emptied group is dropped, not kept empty');

  ctx.select('account', '');
  ctx.select('live', '');
  assert.deepEqual(ids(ctx.select('archived', '')), [['a-live', 'a-unknown', 'a-archived'], ['d-offline']]);
  assert.deepEqual(ctx.errors, []);
});

// ---------------------------------------------------------------------------
// The 30 s poll is gated on the SCREEN, not only on document.hidden. The screen root
// exists solely while Desktop sessions is the active screen (desktop.js:429), apply()
// hands that presence to polling() (desktop.js:436), and polling() starts or stops the
// handle (desktop.js:917). Here the fake document is made to stop returning the root,
// which is a screen switch as far as the file can tell, and a select 'change' — the
// same push() → scheduleApply() path the filter tests use — makes apply() run. There
// is no MutationObserver in this vm context, so that listener is the trigger; in the
// browser the observer on #dc-root does the same job.
// ---------------------------------------------------------------------------

test('the poll stops when the Desktop screen is left and restarts when it comes back', async () => {
  const handles = [];
  let onScreen = true;
  const ctx = await loaded(payload([group({ sessions: [session({ id: 'local_poll' })] })]), {
    present: () => onScreen,
    poll: (fn, ms, options) => {
      const handle = { ms, options, stopped: false, stop: () => { handle.stopped = true; } };
      handles.push(handle);
      return handle;
    },
  });
  const render = async () => { ctx.selects[0].fire('change'); await turn(); };

  assert.equal(handles.length, 1, 'the screen did not start a poll while its root was present');
  assert.equal(handles[0].ms, 30000, 'the poll cadence is 30 s (BEHAVIOUR.md §1)');
  // The two gates are separate and must stay so: whileVisible is document.hidden,
  // the screen root is the screen. Collapsing them would let one cover for the other.
  assert.deepEqual(handles[0].options, { whileVisible: true });

  await render();
  assert.equal(handles.length, 1, 'a re-render on the same screen started a SECOND poll');
  assert.equal(handles[0].stopped, false);

  onScreen = false; // the screen root goes away, as it does on a screen switch
  await render();
  assert.equal(handles[0].stopped, true, 'REGRESSION desktop.js polling(): leaving the screen did not stop the poll');
  assert.equal(handles.length, 1);

  await render();
  assert.equal(handles.length, 1, 'the screen started a poll while its root was absent');

  onScreen = true; // back on the screen
  await render();
  // A second handle can only exist if pollHandle was nulled on the way out — that is
  // how "the handle was released", not merely stopped, is observable from here.
  assert.equal(handles.length, 2, 'REGRESSION desktop.js polling(): the poll did not resume on returning to the screen');
  assert.equal(handles[1].ms, 30000);
  assert.deepEqual(handles[1].options, { whileVisible: true });
  assert.equal(handles[1].stopped, false, 'the restarted poll was stopped again');
  assert.deepEqual(ctx.errors, []);
});

// ---------------------------------------------------------------------------
// I-L10-10: every group card collapses from its header. The cards are built the
// way the runtime draws them — card > [header, scroller > table > [column head]] —
// and apply() runs off the same select 'change' the poll test uses.
// ---------------------------------------------------------------------------

function groupCard(screen) {
  const card = screen.appendChild(node('div', { 'data-dc-tpl': '703' }));
  const head = card.appendChild(node('div'));
  const body = card.appendChild(node('div'));
  body.appendChild(node('div')).appendChild(node('div'));
  return { head, body };
}

test('a group header collapses its card, and the collapsed set is stored', async () => {
  const store = { 'fd-desktop-collapsed': JSON.stringify({ live: true }) };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const live = session({ id: 'local_live', live: true, liveState: 'live' });
  const ctx = await loaded(payload([group({ sessions: [live] })]), { localStorage });
  const liveNow = groupCard(ctx.screen);
  const aylin = groupCard(ctx.screen);
  const render = async () => { ctx.selects[0].fire('change'); await turn(); };
  await render();

  // "Live now" was stored shut; the person group was not.
  assert.equal(liveNow.body.style.display, 'none', 'the stored collapse was not read at boot');
  assert.equal(liveNow.head.getAttribute('aria-expanded'), 'false');
  assert.equal(aylin.body.style.display, '');
  assert.equal(aylin.head.getAttribute('aria-expanded'), 'true');
  assert.equal(aylin.head.getAttribute('role'), 'button');
  assert.equal(aylin.head.firstChild.getAttribute('data-fd-l10'), 'group-chevron');

  liveNow.head.fire('click');
  await turn();
  assert.equal(liveNow.body.style.display, '', 'a click did not open the card');
  aylin.head.fire('click');
  await turn();
  assert.equal(aylin.body.style.display, 'none', 'a click did not collapse the card');
  assert.deepEqual(JSON.parse(store['fd-desktop-collapsed']), { 'acc-1:org-1|m1': true });

  // Re-applying adds no second chevron and no second listener.
  await render();
  assert.equal(aylin.head.find('[data-fd-l10="group-chevron"]').length, 1);
  assert.equal(aylin.head.listeners.click.length, 1);
  assert.deepEqual(ctx.errors, []);
});

// I-L10-11: the page header's Collapse all / Expand all reads and drives this fold.
test('the published fold counts the cards on screen and collapses or expands them all', async () => {
  const live = session({ id: 'local_live', live: true, liveState: 'live' });
  const ctx = await loaded(payload([group({ sessions: [live] })]));
  const liveNow = groupCard(ctx.screen);
  const aylin = groupCard(ctx.screen);
  let synced = 0;
  ctx.sandbox.FD.shell = { syncFold: () => { synced++; } };
  ctx.selects[0].fire('change');
  await turn();
  const fold = () => ctx.sandbox.FD.screens.desktop.fold;

  assert.equal(fold().count, 2);
  assert.equal(fold().anyOpen, true);
  assert.ok(synced > 0, 'apply() did not ask the shell to re-read the fold');

  fold().setAll(false);
  await turn();
  assert.equal(liveNow.body.style.display, 'none');
  assert.equal(aylin.body.style.display, 'none');
  assert.equal(fold().anyOpen, false, 'the label would still say Collapse all');

  fold().setAll(true);
  await turn();
  assert.equal(liveNow.body.style.display, '');
  assert.equal(aylin.body.style.display, '');
  assert.equal(fold().anyOpen, true);
  assert.deepEqual(ctx.errors, []);
});
