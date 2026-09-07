'use strict';
// fd-v2 L4 — the Registry's pure rules. The browser side is proved by
// docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs; these are the rules
// that can be stated without a DOM: the filter predicate, the sort comparator,
// the age window and the age tone. Every expectation here is BEHAVIOUR.md §2,
// §3 and §6 read against public/app.js:656-716, which is what they reproduce.
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const SCREEN = join(__dirname, '..', 'public', 'v2', 'screens', 'registry.js');
const SOURCE = readFileSync(SCREEN, 'utf8');

// The screen is a classic browser script. Loading it under a stub window whose
// storage reports fixture mode stops it before it touches the network or the
// document, and leaves FD.screens.registry.__pure behind.
function load() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (k === 'fd-fixture' ? '1' : null),
    setItem: () => {},
    removeItem: () => {},
  };
  sandbox.location = { search: '' };
  sandbox.document = {
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    getElementById: () => null,
  };
  sandbox.requestAnimationFrame = () => {};
  sandbox.MutationObserver = function () { this.observe = () => {}; };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'registry.js' });
  assert.ok(sandbox.FD && sandbox.FD.screens && sandbox.FD.screens.registry,
    'registry.js publishes FD.screens.registry');
  return sandbox.FD.screens.registry;
}

const registry = load();
const pure = registry.__pure;
const { filterSessions, sortSessions, olderThan, ageTone, AGE, FILTER0 } = pure;

// Loading it must not have started the screen: fixture mode is the pixel gate's
// guarantee, and a listener or a fetch here would mean one in the browser too.
test('loading the screen in fixture mode starts nothing', () => {
  assert.equal(registry._state.started, false);
  assert.deepEqual(registry._state.sessions, []);
});

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// A row carries only the fields the filter and the sort accessors read.
const row = (over) => Object.assign({
  host: 'german-box', name: 'FD-one', label: '', role: '', worker: '', group: '', task: '',
  note: '', status: 'active', live: true,
  active_at: ago(5 * MIN), msg_at: ago(5 * MIN), last_seen_at: ago(MIN),
}, over);

const filter = (over) => Object.assign({}, FILTER0, over);
const names = (list) => list.map((s) => s.name);

// ---------------------------------------------------------------- olderThan
test('olderThan: no window matches everything, including a row with no stamp', () => {
  assert.equal(olderThan(ago(MIN), 0), true, 'a zero window is "any"');
  assert.equal(olderThan(null, DAY), true, 'a row that never spoke is the stalest');
  assert.equal(olderThan('', DAY), true);
  assert.equal(olderThan(undefined, DAY), true);
});

test('olderThan: a stamp inside the window does not match, one outside does', () => {
  assert.equal(olderThan(ago(30 * MIN), HOUR), false);
  assert.equal(olderThan(ago(2 * HOUR), HOUR), true);
  assert.equal(olderThan(ago(2 * DAY), DAY), true);
  assert.equal(olderThan(ago(2 * HOUR), DAY), false);
});

test('AGE is BEHAVIOUR §2 verbatim', () => {
  assert.deepEqual(AGE, { '': 0, '1h': 36e5, '6h': 216e5, '1d': 864e5, '3d': 2592e5, '7d': 6048e5 });
});

// ------------------------------------------------------------ filterSessions
test('the search is a lowercase substring over all eight text fields', () => {
  const fields = ['name', 'host', 'label', 'group', 'task', 'note', 'role', 'worker'];
  for (const field of fields) {
    // The needle goes into the field under test, which for `name` and `host`
    // means the row's own identity — so the match is asserted by identity, not
    // by name, and the second row must not come with it.
    const list = [row({ [field]: 'NEEDLE-' + field }), row({ name: 'FD-two', host: 'mac' })];
    const hit = filterSessions(list, filter({ q: 'needle' }));
    assert.equal(hit.length, 1, `q must match exactly one row on ${field}`);
    assert.equal(hit[0], list[0], `q must match on ${field}`);
  }
});

test('the search trims and lowercases what was typed, and an empty one keeps every row', () => {
  const list = [row({ name: 'FD-Alpha' }), row({ name: 'FD-beta' })];
  assert.deepEqual(names(filterSessions(list, filter({ q: '  ALPHA  ' }))), ['FD-Alpha']);
  assert.deepEqual(names(filterSessions(list, filter({ q: '' }))), ['FD-Alpha', 'FD-beta']);
  assert.deepEqual(names(filterSessions(list, filter({ q: '   ' }))), ['FD-Alpha', 'FD-beta']);
});

test('a field that is null or missing never throws and never matches', () => {
  const list = [row({ name: 'FD-one', label: null, note: undefined, group: 0 })];
  assert.deepEqual(names(filterSessions(list, filter({ q: 'nothing' }))), []);
  assert.deepEqual(names(filterSessions(list, filter({ q: 'fd-one' }))), ['FD-one']);
});

test('live and gone are a boolean equality, not a truthiness test', () => {
  const list = [row({ name: 'up', live: true }), row({ name: 'down', live: false }),
    row({ name: 'undef', live: undefined })];
  assert.deepEqual(names(filterSessions(list, filter({ live: 'live' }))), ['up']);
  assert.deepEqual(names(filterSessions(list, filter({ live: 'gone' }))), ['down', 'undef']);
  assert.deepEqual(names(filterSessions(list, filter({ live: '' }))), ['up', 'down', 'undef']);
});

test('status matches exactly, over all five states', () => {
  const list = ['active', 'done', 'kill-requested', 'killed', 'hidden'].map((s) => row({ name: s, status: s }));
  for (const status of ['active', 'done', 'kill-requested', 'killed', 'hidden']) {
    assert.deepEqual(names(filterSessions(list, filter({ status }))), [status]);
  }
  assert.equal(filterSessions(list, filter({ status: '' })).length, 5);
});

test('status is an equality, so a prefix matches nothing', () => {
  const list = ['active', 'kill-requested', 'killed'].map((s) => row({ name: s, status: s }));
  // 'kill' is not one of the five states; a prefix or substring match here would
  // silently fold kill-requested and killed into one filter.
  assert.deepEqual(names(filterSessions(list, filter({ status: 'kill' }))), []);
  assert.deepEqual(names(filterSessions(list, filter({ status: 'killed' }))), ['killed']);
  assert.deepEqual(names(filterSessions(list, filter({ status: 'kill-requested' }))), ['kill-requested']);
});

test('the two age filters read their own column', () => {
  const list = [
    row({ name: 'stale-msg', msg_at: ago(2 * DAY), active_at: ago(MIN) }),
    row({ name: 'stale-active', msg_at: ago(MIN), active_at: ago(2 * DAY) }),
    row({ name: 'fresh', msg_at: ago(MIN), active_at: ago(MIN) }),
  ];
  assert.deepEqual(names(filterSessions(list, filter({ msg: '1d' }))), ['stale-msg']);
  assert.deepEqual(names(filterSessions(list, filter({ active: '1d' }))), ['stale-active']);
});

test('an age key the menu does not have filters nothing away', () => {
  const list = [row({ name: 'one' }), row({ name: 'two' })];
  assert.deepEqual(names(filterSessions(list, filter({ msg: '30d' }))), ['one', 'two']);
});

test('the filters compose', () => {
  const list = [
    row({ name: 'wanted', group: 'fd-v2', status: 'active', live: true, msg_at: ago(2 * DAY) }),
    row({ name: 'wrong-status', group: 'fd-v2', status: 'done', live: true, msg_at: ago(2 * DAY) }),
    row({ name: 'wrong-group', group: 'other', status: 'active', live: true, msg_at: ago(2 * DAY) }),
    row({ name: 'too-fresh', group: 'fd-v2', status: 'active', live: true, msg_at: ago(MIN) }),
    row({ name: 'gone', group: 'fd-v2', status: 'active', live: false, msg_at: ago(2 * DAY) }),
  ];
  assert.deepEqual(names(filterSessions(list, filter({ q: 'fd-v2', status: 'active', live: 'live', msg: '1d' }))),
    ['wanted']);
});

// -------------------------------------------------------------- sortSessions
test('no order, or an unknown key, keeps the API order', () => {
  const list = [row({ name: 'b' }), row({ name: 'a' })];
  assert.deepEqual(names(sortSessions(list, null)), ['b', 'a']);
  assert.deepEqual(names(sortSessions(list, { key: 'nope', dir: 'asc' })), ['b', 'a']);
});

test('strings sort case-insensitively, both directions', () => {
  const list = [row({ name: 'beta' }), row({ name: 'Alpha' }), row({ name: 'gamma' })];
  assert.deepEqual(names(sortSessions(list, { key: 'name', dir: 'asc' })), ['Alpha', 'beta', 'gamma']);
  assert.deepEqual(names(sortSessions(list, { key: 'name', dir: 'desc' })), ['gamma', 'beta', 'Alpha']);
});

test('sorting does not mutate the list it was given', () => {
  const list = [row({ name: 'b' }), row({ name: 'a' })];
  sortSessions(list, { key: 'name', dir: 'asc' });
  assert.deepEqual(names(list), ['b', 'a']);
});

test('unset values sink to the bottom in BOTH directions', () => {
  const list = [row({ name: 'none', group: '' }), row({ name: 'beta', group: 'b' }), row({ name: 'alpha', group: 'a' })];
  assert.deepEqual(names(sortSessions(list, { key: 'group', dir: 'asc' })), ['alpha', 'beta', 'none']);
  assert.deepEqual(names(sortSessions(list, { key: 'group', dir: 'desc' })), ['beta', 'alpha', 'none']);
});

test('time columns compare the stamp, not the text the cell shows', () => {
  const list = [
    row({ name: 'oldest', active_at: ago(3 * DAY) }),
    row({ name: 'newest', active_at: ago(MIN) }),
    row({ name: 'middle', active_at: ago(2 * HOUR) }),
  ];
  assert.deepEqual(names(sortSessions(list, { key: 'active_at', dir: 'asc' })), ['oldest', 'middle', 'newest']);
  assert.deepEqual(names(sortSessions(list, { key: 'active_at', dir: 'desc' })), ['newest', 'middle', 'oldest']);
});

test('a row with no stamp sinks under a time sort too', () => {
  const list = [row({ name: 'never', msg_at: null }), row({ name: 'spoke', msg_at: ago(HOUR) })];
  assert.deepEqual(names(sortSessions(list, { key: 'msg_at', dir: 'asc' })), ['spoke', 'never']);
  assert.deepEqual(names(sortSessions(list, { key: 'msg_at', dir: 'desc' })), ['spoke', 'never']);
});

test('role sorts on role and worker together, as the old column did', () => {
  const list = [
    row({ name: 'second', role: 'frontend-developer', worker: 'Zoe' }),
    row({ name: 'first', role: 'frontend-developer', worker: 'Ada' }),
    row({ name: 'unset', role: '', worker: '' }),
  ];
  assert.deepEqual(names(sortSessions(list, { key: 'role', dir: 'asc' })), ['first', 'second', 'unset']);
});

test('every sortable column the header offers has an accessor', () => {
  for (const key of ['name', 'group', 'task', 'status', 'active_at', 'msg_at', 'last_seen_at']) {
    assert.ok(pure.SORTS[key], `${key} is sortable`);
  }
  // Host, label, role and note lost their column but keep their accessor, so an
  // older persisted fleetSort naming one is still honoured.
  for (const key of ['host', 'label', 'role', 'note']) assert.ok(pure.SORTS[key], `${key} still sorts`);
});

// ------------------------------------------------------------------ ageTone
test('ageTone: amber past an hour, red past a day, nothing before or without a stamp', () => {
  assert.equal(ageTone(''), '');
  assert.equal(ageTone(null), '');
  assert.equal(ageTone(ago(30 * MIN)), '');
  assert.equal(ageTone(ago(2 * HOUR)), 'amber');
  assert.equal(ageTone(ago(23 * HOUR)), 'amber');
  assert.equal(ageTone(ago(2 * DAY)), 'red');
});

test('FILTER0 is the default BEHAVIOUR §2 states', () => {
  assert.deepEqual(FILTER0, { q: '', live: '', status: '', msg: '', active: '' });
});
