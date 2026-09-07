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
function load() {
  const store = { 'fd-fixture': '1' };
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  sandbox.location = { search: '' };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(SHELL, 'utf8'), sandbox, { filename: 'shell.js' });
  assert.ok(sandbox.FD && sandbox.FD.shell, 'shell.js publishes FD.shell');
  return sandbox.FD.shell;
}

const shell = load();
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

test('fixture mode leaves the page alone — no data layer, no listeners', () => {
  // load() ran with fd-fixture = 1; a live boot would have created FD.__dataLoading.
  assert.ok(!shell.__pure.__loaded, 'no boot side effects');
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
