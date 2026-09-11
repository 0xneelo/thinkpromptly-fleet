'use strict';
// fd-v2 L2 — the shell's pure halves. The browser side is proved by
// docs/design/fleetdeck-v2/verify/l2/live.mjs; these are the rules that can be
// stated without a DOM: normalisation, grouping, the health branch table and
// the accounts pct rule.
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const SHELL = join(__dirname, '..', 'public', 'v2', 'screens', 'shell.js');
const HOLDER_TIP =
  'Open Windows App → RDP to the box as Vibe → run: wsl -e sleep infinity → close (disconnect, never sign out)';

// The shell is a classic browser script. Loading it under a stub window whose
// storage reports fixture mode stops it before it touches the network or the
// document, and leaves FD.shell.__pure behind.
const SOURCE = readFileSync(SHELL, 'utf8');

function load({ store = {}, search = '' } = {}) {
  // The shell reports a failed start through console.error, which is the only
  // observable a live boot leaves now that the shell no longer injects a script.
  const errors = [];
  const sandbox = { console: { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
  sandbox.window = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  sandbox.location = { search };
  // Enough of a document that a boot attempt gets as far as appending the tag.
  const appended = [];
  sandbox.document = {
    head: { appendChild: (el) => appended.push(el) },
    createElement: () => ({}),
    addEventListener: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'shell.js' });
  assert.ok(sandbox.FD && sandbox.FD.shell, 'shell.js publishes FD.shell');
  return { shell: sandbox.FD.shell, FD: sandbox.FD, appended, errors };
}


/* A live boot, driven to completion inside the sandbox. The shell appends
 * <script src="/v2/data.js"> and waits; this stands the data layer up, fires the
 * script's onload, and lets the boot chain settle — which is the only way to
 * watch `ready` flip. */
function bootable({ search = '', doc = {} } = {}) {
  const store = { 'fd-landing-dark': '1' };
  // console.error is kept, not printed, so a test can assert what the shell reported.
  const errors = [];
  const sandbox = { console: { ...console, error: (...a) => errors.push(a.map(String).join(' ')) }, URLSearchParams, Promise };
  sandbox.window = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  sandbox.location = { search };
  sandbox.addEventListener = () => {};

  const node = () => {
    const n = {
      style: {}, dataset: {}, children: [],
      setAttribute() {}, removeAttribute() {},
      appendChild(c) { this.children.push(c); return c; },
      append(...c) { this.children.push(...c); },
      replaceChildren(...c) { this.children = c; },
      querySelector: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      isConnected: true, offsetHeight: 0, offsetParent: null,
    };
    return n;
  };
  const appended = [];
  sandbox.document = {
    documentElement: node(),
    body: node(),
    head: { appendChild: (el) => { appended.push(el); return el; } },
    createElement: node,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    ...doc,
  };

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'shell.js' });

  const FD = sandbox.FD;
  // runtime.js supplies these in the browser.
  FD.fixture = FD.fixture || {};
  FD.setData = (k, v) => { FD.fixture[k] = v; };

  return {
    FD,
    shell: FD.shell,
    errors,
    // Make the data layer arrive late. The shell no longer injects data.js -- the page
    // loads it before the screens (DECK-84) -- so arrival is simply FD.data becoming
    // present, which the shell picks up on one of its re-check turns.
    async arrive() {
      assert.strictEqual(appended.length, 0, 'the shell injects nothing of its own');
      FD.data = {
        isFixture: () => false,
        theme: () => true,
        ago: () => 'just now',
        sessions: async () => ({ sessions: [], errors: [] }),
        health: async () => ({ hosts: [] }),
        credits: async () => ({ rows: [] }),
      };
      // Let the re-check, the boot chain and the loads it starts settle.
      for (let i = 0; i < 12; i++) await Promise.resolve();
    },
  };
}

const { shell } = load({ store: { 'fd-fixture': '1' } });
const pure = shell.__pure;

// Everything the shell returns is built inside the vm realm, so its prototypes
// are not this realm's. Compare values, not identities.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the four hooks L2 promises exist and are safe to call before the slice is live', () => {
  ['setBadge', 'setLiveApi', 'refresh', 'selectSession'].forEach((name) => {
    assert.strictEqual(typeof shell[name], 'function', name + ' is defined');
  });
  assert.doesNotThrow(() => shell.setBadge(4));
  assert.doesNotThrow(() => shell.setLiveApi('anything'));
  assert.doesNotThrow(() => shell.selectSession('german-box', 'ops'));
  assert.doesNotThrow(() => shell.refresh());
});

test('fixture mode stops the slice before it loads or fetches anything', () => {
  // Both routes into fixture mode: the stored flag and the query parameter.
  for (const opts of [{ store: { 'fd-fixture': '1' } }, { search: '?fixture=1' }, { search: '?a=1&fixture=1' }]) {
    const { FD, appended } = load(opts);
    assert.strictEqual(FD.__dataLoading, undefined, 'no data layer requested: ' + JSON.stringify(opts));
    assert.strictEqual(appended.length, 0, 'no script appended: ' + JSON.stringify(opts));
  }
});

// The shell stopped injecting data.js when the page began loading it itself
// (DECK-84), so "a script was appended" is no longer an observable. The rule under
// test has not changed -- fixture mode must not start the slice and a live boot must
// -- only its evidence: a live boot now reaches the start path, which reports the
// absent data layer. The rejection settles in a microtask, hence the flush.
const started = async (opts) => {
  const { errors } = load(opts);
  await new Promise((done) => setImmediate(done));
  return errors.some((e) => e.includes('shell could not start'));
};

test('and the same check lets a live boot through — so it is not simply always true', async () => {
  assert.ok(await started({ store: {}, search: '' }), 'a live boot starts the slice');
});

test('a fixture-shaped query that is not the flag does not count as fixture mode', async () => {
  assert.ok(await started({ search: '?fixture=0' }), '?fixture=0 is a live boot');
});

test('fixture mode really does stop before the start path, not just before the network', async () => {
  for (const opts of [{ store: { 'fd-fixture': '1' } }, { search: '?fixture=1' }]) {
    assert.strictEqual(await started(opts), false, 'no start attempt: ' + JSON.stringify(opts));
  }
});

test('the empty-state copy still matches L3 word for word', () => {
  // L3 owns the empty state in the weave; L2 kept the string so a reword on
  // either side is caught here rather than on screen.
  const l3 = readFileSync(join(__dirname, '..', 'public', 'v2', 'screens', 'windows.js'), 'utf8');
  const copy = 'There are no sessions yet, open a new session via an orchestrator first.';
  assert.ok(SOURCE.includes(copy), 'L2 still quotes the operator\'s copy');
  assert.ok(l3.includes(copy), 'L3 renders the same sentence');
});

test('a badge set before the data layer arrives is applied, not dropped', async () => {
  const boot = bootable();
  assert.strictEqual(boot.shell.__pure.ready(), false, 'not ready yet');

  // L6 mounts synchronously and reports while data.js is still in flight.
  boot.shell.setBadge(3);
  assert.strictEqual(boot.FD.fixture.l2Badge, undefined, 'nothing is published before ready');
  assert.strictEqual(boot.shell.__pure.badge(), 3, 'but the count is remembered');

  await boot.arrive();
  assert.strictEqual(boot.shell.__pure.ready(), true, 'ready flipped');
  assert.strictEqual(boot.FD.fixture.l2Badge, 3, 'the remembered count reached the nav badge');
});

test('the last count wins, and a later one still goes straight through', async () => {
  const boot = bootable();
  boot.shell.setBadge(3);
  boot.shell.setBadge(7);
  await boot.arrive();
  assert.strictEqual(boot.FD.fixture.l2Badge, 7, 'the last pre-ready count is the one applied');

  boot.shell.setBadge(0);
  assert.strictEqual(boot.FD.fixture.l2Badge, 0, 'and a post-ready call publishes immediately');
});

test('a badge nobody ever set publishes nothing, so the bus count stays the bus\'s', async () => {
  const boot = bootable();
  await boot.arrive();
  assert.strictEqual(boot.FD.fixture.l2Badge, undefined, 'no l2Badge key, so busVals still wins');
});

test('a nonsense count becomes 0 rather than reaching the template', async () => {
  const boot = bootable();
  boot.shell.setBadge(-4);
  await boot.arrive();
  assert.strictEqual(boot.FD.fixture.l2Badge, 0);
  boot.shell.setBadge('lots');
  assert.strictEqual(boot.FD.fixture.l2Badge, 0);
});

test('norm supplies exactly the defaults today\'s app supplies (app.js:182)', () => {
  assert.deepStrictEqual(plain(pure.norm({ host: 'german-box', name: 'ops' })), {
    label: '', role: '', worker: '', note: '', group: '', task: '',
    status: 'active', live: true, host: 'german-box', name: 'ops',
  });
  // A row that carries its own values keeps them.
  assert.strictEqual(pure.norm({ status: 'hidden' }).status, 'hidden');
  assert.strictEqual(pure.norm({ live: false }).live, false);
});

const rows = [
  { host: 'onboarding-box', name: 'ops', status: 'active', live: true },
  { host: 'german-box', name: 'a', status: 'active', live: true },
  { host: 'onboarding-box', name: 'late', status: 'active', live: true },
  { host: 'german-box', name: 'b', status: 'hidden', live: true },
  { host: 'german-box', name: 'c', status: 'kill-requested', live: true },
  { host: 'german-box', name: 'gone', status: 'active', live: false },
];

test('grouping keeps API host order, counts only what it shows, and drops dead rows', () => {
  const out = pure.groupSessions(rows, false, {});
  assert.deepStrictEqual(plain(out.groups).map((g) => g.box), ['onboarding-box', 'german-box']);
  assert.deepStrictEqual(plain(out.groups).map((g) => g.n), [2, 2]);
  assert.deepStrictEqual(plain(out.groups[1].items).map((i) => i.n), ['a', 'c']);
  assert.strictEqual(out.hiddenCount, 1);
});

test('the flat row index follows the rendered order, not the API order', () => {
  const out = pure.groupSessions(rows, false, {});
  assert.deepStrictEqual(plain(out.rowIndex).map((s) => s.name), ['ops', 'late', 'a', 'c']);
});

test('showHidden adds the hidden rows back without changing anything else', () => {
  const out = pure.groupSessions(rows, true, {});
  assert.deepStrictEqual(plain(out.groups[1].items).map((i) => i.n), ['a', 'b', 'c']);
  assert.strictEqual(out.hiddenCount, 1);
});

test('dot tone: kill-requested beats open, open beats idle', () => {
  // The open map is keyed host + NUL + name, the same key today's sidebar uses.
  const k = (h, n) => h + '\u0000' + n;
  const out = pure.groupSessions(rows, false, { [k('german-box', 'a')]: true, [k('german-box', 'c')]: true });
  assert.deepStrictEqual(plain(out.groups[1].items).map((i) => i.tone), ['good', 'warn']);
  assert.deepStrictEqual(plain(out.groups[0].items).map((i) => i.tone), ['muted', 'muted']);
});

test('health branches, in the order app.js:112-129 tests them', () => {
  const row = (h) => plain(pure.healthRow(h));
  assert.deepStrictEqual(row({ host: 'mac', agentLocked: true, holderOk: true, wslAlive: true }),
    { name: 'mac', st: '1Password locked', tone: 'warn', tip: 'Unlock 1Password on this Mac, then Refresh' });
  assert.deepStrictEqual(row({ host: 'lab', kind: 'linux', reachable: true }),
    { name: 'lab', st: 'reachable', tone: 'good', tip: 'ssh + tmux answered on this Linux host' });
  assert.deepStrictEqual(row({ host: 'lab', kind: 'linux', reachable: false }),
    { name: 'lab', st: 'unreachable', tone: 'bad', tip: 'ssh to this Linux host failed — network or key' });
  assert.deepStrictEqual(row({ host: 'box', holderOk: null, wslAlive: true }),
    { name: 'box', st: 'unreachable', tone: 'warn', tip: 'ssh to the box failed — network or 1Password' });
  assert.deepStrictEqual(row({ host: 'box', holderOk: true, wslAlive: null }),
    { name: 'box', st: 'unreachable', tone: 'warn', tip: 'ssh to the box failed — network or 1Password' });
  assert.deepStrictEqual(row({ host: 'box', holderOk: true, wslAlive: true }),
    { name: 'box', st: 'holder OK', tone: 'good', tip: HOLDER_TIP });
  assert.deepStrictEqual(row({ host: 'box', holderOk: false, wslAlive: true }),
    { name: 'box', st: 'HOLDER DOWN', tone: 'bad', tip: HOLDER_TIP });
});

test('agentLocked wins over every other field, exactly as today', () => {
  const row = pure.healthRow({ host: 'mac', agentLocked: true, kind: 'linux', reachable: false });
  assert.strictEqual(row.st, '1Password locked');
});

test('pct is the highest window, and codex reads its own three fields', () => {
  assert.strictEqual(pure.accountPct({ kind: 'claude', windows: { five_hour: { pct: 28 }, seven_day: { pct: 61 } } }), 61);
  assert.strictEqual(pure.accountPct({ kind: 'codex', windows: { weekly: { pct: 12 } }, weekly: { pct: 80 }, secondary: { pct: 3 } }), 80);
  // seven_day_fable is not one of the two windows today's app reads.
  assert.strictEqual(pure.accountPct({ kind: 'claude', windows: { five_hour: { pct: 4 }, seven_day_fable: { pct: 99 } } }), 4);
  assert.strictEqual(pure.accountPct({ kind: 'claude', windows: {} }), null);
  assert.strictEqual(pure.accountPct({ kind: 'claude' }), null);
  // A window with no numeric pct is not a window.
  assert.strictEqual(pure.accountPct({ kind: 'claude', windows: { five_hour: { pct: null } } }), null);
});

test('the rail label is the first word, plus the codex suffix', () => {
  assert.strictEqual(pure.accountBar({ kind: 'claude', label: 'Reiner Garrecht', windows: {} }).name, 'Reiner');
  assert.strictEqual(pure.accountBar({ kind: 'codex', label: 'Daniel Tabor (personal · ChatGPT)', windows: {} }).name, 'Daniel ·gpt');
  // label, then email, then id (app.js:159).
  assert.strictEqual(pure.accountBar({ kind: 'claude', email: 'a@b.c', windows: {} }).name, 'a@b.c');
  assert.strictEqual(pure.accountBar({ kind: 'claude', id: 'uuid-1', windows: {} }).name, 'uuid-1');
});

test('a missing window prints an em dash, a present one prints the percentage', () => {
  assert.strictEqual(pure.accountBar({ kind: 'claude', id: 'x', windows: {} }).txt, '—');
  assert.strictEqual(pure.accountBar({ kind: 'claude', id: 'x', windows: { five_hour: { pct: 0 } } }).txt, '0%');
  assert.strictEqual(pure.accountBar({ kind: 'claude', id: 'x', windows: { five_hour: { pct: 95 } } }).txt, '95%');
});

test('a spent credit pool marks the value itself — the mock has no fourth cell', () => {
  const capped = { kind: 'claude', id: 'x', windows: { five_hour: { pct: 71 } }, credit: { capped: true } };
  assert.strictEqual(pure.accountBar(capped).txt, '€71%');
  capped.windows = {};
  assert.strictEqual(pure.accountBar(capped).txt, '€—');
  assert.strictEqual(pure.accountBar({ kind: 'claude', id: 'x', windows: {}, credit: { capped: false } }).txt, '—');
});

test('a row the API cannot key is dropped before it reaches FD.setData (audit ruling 2)', () => {
  const out = pure.groupSessions([
    { host: 'german-box', name: 'ok', live: true, status: 'active' },
    { host: 'german-box', live: true, status: 'active' },
    { name: 'no-host', live: true, status: 'active' },
    null,
  ].filter(Boolean).filter((s) => s && typeof s.host === 'string' && s.host && typeof s.name === 'string' && s.name), false, {});
  assert.deepStrictEqual(plain(out.groups).map((g) => g.box), ['german-box']);
  assert.deepStrictEqual(plain(out.groups[0].items).map((i) => i.n), ['ok']);
});

test('the provider decides the logo, not the label', () => {
  assert.strictEqual(pure.accountBar({ kind: 'codex', id: 'x', windows: {} }).prov, 'gpt');
  assert.strictEqual(pure.accountBar({ kind: 'claude', id: 'x', windows: {} }).prov, 'claude');
});

test('the row tooltip carries identity, window, credits and source (app.js:145-152)', () => {
  const meta = pure.accountMeta({
    kind: 'claude', id: 'a1', label: 'Reiner Garrecht', email: 'neelo@vibe.trading', source: 'oauth',
    windows: { five_hour: { pct: 28 } },
    credit: { used: 12.5, limit: 20, decimals: 2, currency: 'EUR', capped: true },
  });
  assert.strictEqual(meta.tip, [
    'Reiner Garrecht · neelo@vibe.trading',
    'highest window 28%',
    'credits 12.50 / 20.00 EUR',
    'source: oauth',
  ].join('\n'));
  assert.strictEqual(meta.capped, true);
});

test('a row with no usage and no source still gets a legible tooltip', () => {
  const meta = pure.accountMeta({ kind: 'claude', id: 'a3', windows: {} });
  assert.strictEqual(meta.tip, 'a3\nno usage reported\nno data yet');
  assert.strictEqual(meta.capped, false);
});

/* The Collapse all / Expand all toggle is the one thing the shell writes into a
 * compiled node, so these tests stand up the header's action row (Live API,
 * Refresh, the right-panel button) and one screen container whose label names
 * the active screen. It is just enough DOM for the shell's own queries, which
 * are all [attr="value"]. */
function el(tag, attrs = {}) {
  return {
    tagName: tag.toUpperCase(), attrs: { ...attrs }, children: [], parentNode: null, listeners: [],
    style: { cssText: '' }, className: '', textContent: '', isConnected: true,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    appendChild(c) { return this.insertBefore(c, null); },
    append(...c) { c.forEach((x) => this.appendChild(x)); },
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      const i = ref ? this.children.indexOf(ref) : -1;
      this.children.splice(i < 0 ? this.children.length : i, 0, c);
      c.parentNode = this;
      return c;
    },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; },
    get nextSibling() { const p = this.parentNode; return (p && p.children[p.children.indexOf(this) + 1]) || null; },
    click() { this.listeners.filter((l) => l.type === 'click').forEach((l) => l.fn({ target: this })); },
  };
}

function find(root, sel) {
  const m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel), out = [];
  if (!m) return out;
  (function walk(n) {
    n.children.forEach((c) => { if (c.getAttribute(m[1]) === m[2]) out.push(c); walk(c); });
  })(root);
  return out;
}

async function header(screen = 'Accounts') {
  const root = el('div');
  const row = el('div', { 'data-dc-tpl': '256' });
  const refresh = el('button', { 'data-dc-tpl': '259' });
  refresh.style.cssText = 'border-radius: 9999px; color: rgba(255, 255, 255, 0.75);';
  refresh.className = 'scp6';
  row.append(el('span', { 'data-dc-tpl': '257' }), refresh, el('button', { 'data-dc-tpl': '260' }));
  const view = el('div', { 'data-screen-label': screen });
  root.append(row, view);
  const boot = bootable({ doc: {
    querySelector: (sel) => find(root, sel)[0] || null,
    querySelectorAll: (sel) => find(root, sel),
    createElement: (tag) => el(tag),
  } });
  await boot.arrive();
  return {
    ...boot, row, refresh,
    buttons: () => find(root, '[data-fd-l2="fold-all"]'),
    show: (label) => view.setAttribute('data-screen-label', label),
  };
}

// What a screen publishes as FD.screens.<id>.fold, recording every setAll call.
const fold = (count, anyOpen) => {
  const f = { count, anyOpen, calls: [], setAll(open) { f.calls.push(open); } };
  return f;
};

test('the fold toggle sits straight before Refresh, worded by the active screen\'s fold', async () => {
  const h = await header();
  assert.strictEqual(h.buttons().length, 0, 'no fold published yet, so no button');

  h.FD.screens.accounts = { fold: fold(3, true) };
  h.shell.syncFold();
  const [b] = h.buttons();
  assert.ok(b, 'the button appears');
  assert.strictEqual(b.parentNode, h.row, 'in the header action row');
  assert.strictEqual(b.nextSibling, h.refresh, 'immediately before Refresh');
  assert.strictEqual(b.tagName, 'BUTTON');
  assert.strictEqual(b.getAttribute('type'), 'button');
  assert.strictEqual(b.textContent, 'Collapse all');
  assert.strictEqual(b.getAttribute('aria-label'), 'Collapse all');
  assert.strictEqual(b.style.cssText, h.refresh.style.cssText, 'Refresh\'s own inline style');
  assert.strictEqual(b.className, h.refresh.className, 'and its hover class');

  h.FD.screens.accounts.fold = fold(3, false);
  h.shell.syncFold();
  assert.strictEqual(b.textContent, 'Expand all');
  assert.strictEqual(b.getAttribute('aria-label'), 'Expand all');
});

test('a click flips the fold of the screen on show at click time, not the one it was drawn for', async () => {
  const h = await header();
  h.FD.screens.accounts = { fold: fold(2, true) };
  h.shell.syncFold();
  const [b] = h.buttons();
  b.click();
  assert.deepStrictEqual(h.FD.screens.accounts.fold.calls, [false], 'something open, so collapse');

  // Republished since the last sync: the click reads the new object.
  const stale = h.FD.screens.accounts.fold;
  h.FD.screens.accounts.fold = fold(2, false);
  b.click();
  assert.deepStrictEqual(h.FD.screens.accounts.fold.calls, [true], 'nothing open, so expand');
  assert.deepStrictEqual(stale.calls, [false], 'the old fold is left alone');

  h.FD.screens.machines = { fold: fold(1, true) };
  h.show('Machines');
  b.click();
  assert.deepStrictEqual(h.FD.screens.machines.fold.calls, [false], 'Machines');

  h.FD.screens.desktop = { fold: fold(4, false) };
  h.show('Desktop sessions');
  h.shell.syncFold();
  assert.strictEqual(b.textContent, 'Expand all');
  b.click();
  assert.deepStrictEqual(h.FD.screens.desktop.fold.calls, [true], 'Desktop sessions');
  assert.deepStrictEqual(h.FD.screens.accounts.fold.calls, [true], 'Accounts untouched since');
});

test('a fold whose setAll throws is reported, not thrown into the click dispatch', async () => {
  const h = await header();
  h.FD.screens.accounts = { fold: { count: 1, anyOpen: true, setAll() { throw new Error('boom'); } } };
  h.shell.syncFold();
  assert.doesNotThrow(() => h.buttons()[0].click());
  assert.ok(h.errors.some((e) => e.includes('fold toggle failed')), h.errors.join('\n'));
});

test('no toggle on another screen, with nothing to fold, with a malformed fold, or without a header', async () => {
  const h = await header();
  const shown = () => h.buttons().length === 1;
  h.FD.screens.accounts = { fold: fold(3, true) };
  h.shell.syncFold();
  assert.ok(shown(), 'Accounts with three cards');

  h.show('Goals');
  h.shell.syncFold();
  assert.ok(!shown(), 'another screen');

  h.show('Accounts');
  h.FD.screens.accounts.fold = fold(0, false);
  h.shell.syncFold();
  assert.ok(!shown(), 'count 0');

  for (const bad of [null, 'yes', {}, { count: 2, anyOpen: true }, { count: '2', anyOpen: true, setAll() {} }]) {
    h.FD.screens.accounts.fold = bad;
    h.shell.syncFold();
    assert.ok(!shown(), 'malformed: ' + JSON.stringify(bad));
  }
  delete h.FD.screens.accounts;
  h.shell.syncFold();
  assert.ok(!shown(), 'screen never published');

  h.FD.screens.accounts = { fold: fold(3, true) };
  h.shell.syncFold();
  assert.ok(shown(), 'back again');
  h.row.removeChild(h.refresh);
  assert.doesNotThrow(() => h.shell.syncFold());
  assert.ok(!shown(), 'no Refresh node, no button');
  assert.deepStrictEqual(h.errors, [], 'a missing node is silent');
});

test('re-syncing writes nothing, and a swept button comes back as the same element', async () => {
  const h = await header();
  h.FD.screens.accounts = { fold: fold(2, true) };
  h.shell.syncFold();
  const [b] = h.buttons();

  // Count every DOM write the shell could make from here on.
  let writes = 0;
  const spy = (obj, name) => { const f = obj[name]; obj[name] = function (...a) { writes++; return f.apply(this, a); }; };
  const watch = (obj, prop) => {
    let v = obj[prop];
    Object.defineProperty(obj, prop, { get: () => v, set: (x) => { writes++; v = x; } });
  };
  spy(b, 'setAttribute'); spy(b, 'addEventListener'); spy(h.row, 'insertBefore'); spy(h.row, 'removeChild');
  watch(b, 'textContent'); watch(b, 'className'); watch(b.style, 'cssText');

  for (let i = 0; i < 5; i++) h.shell.syncFold();
  assert.strictEqual(writes, 0, 'an unchanged sync writes nothing, so it cannot loop an observer');
  assert.strictEqual(h.buttons().length, 1, 'one button');
  assert.strictEqual(b.listeners.length, 1, 'one listener');

  // The runtime drops foreign children when the row's child list changes.
  h.row.removeChild(b);
  h.shell.syncFold();
  assert.strictEqual(h.buttons()[0], b, 'the same element, put back');
  assert.strictEqual(b.nextSibling, h.refresh, 'before Refresh again');
  assert.strictEqual(b.listeners.length, 1, 'still one listener');

  // A theme toggle rewrites Refresh's inline style; the button follows.
  h.refresh.style.cssText = 'border-radius: 9999px; color: rgba(17, 17, 17, 0.75);';
  h.shell.syncFold();
  assert.strictEqual(b.style.cssText, h.refresh.style.cssText);

  b.click();
  assert.deepStrictEqual(h.FD.screens.accounts.fold.calls, [false], 'one click, one setAll');
});

test('fixture mode leaves the header alone: syncFold exists and does nothing', () => {
  // load()'s document has no querySelector, so a sync that ran would log an error.
  const { shell: s, errors } = load({ store: { 'fd-fixture': '1' } });
  assert.strictEqual(typeof s.syncFold, 'function');
  assert.doesNotThrow(() => s.syncFold());
  assert.deepStrictEqual(errors, []);
});
