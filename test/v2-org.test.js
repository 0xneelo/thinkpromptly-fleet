// L5 acceptance: the pure logic of the v2 org screen. Every format is asserted
// against docs/goals/fd-v2-l5/BEHAVIOUR.md §2-§4, and every tree is built by the
// real FleetOrgChart.buildTree — nothing here is stubbed except the browser
// globals org.js reads. The clock is always passed in, never read.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// org.js is a browser IIFE, not a CommonJS module: it hangs its surface off
// FD.screens.org on the global. public/v2/orgchart.js prefers module.exports
// under Node, so its API has to be put on the global for org.js to find it.
global.window = global;
global.FD = {
  fixture: {},
  screens: {},
  shell: {},
  setData(name, value) {
    this.fixture[name] = value;
  },
};
global.FleetOrgChart = require(path.join(ROOT, 'public/v2/orgchart.js'));
require(path.join(ROOT, 'public/v2/screens/org.js'));

const org = global.FD.screens.org;
const chart = global.FleetOrgChart;

// No document and no location: start() and patchStats() are inert, and both
// fixture-mode readers fall back to an empty query string.
const NOW = Date.parse('2026-09-07T00:00:00Z');
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const norm = (row) => org.norm(row);
const data = (over) => Object.assign({ sessions: [], seats: [], errors: [], fixture: false }, over);

test.afterEach(() => {
  delete global.location;
  delete global.FD.screens.bus;
  delete global.FD.shell.setLiveApi;
  delete global.FD.data;
});

// ---------------------------------------------------------------------------
// Formats — BEHAVIOUR.md §4, verbatim from today's app.
// ---------------------------------------------------------------------------

test('shortDuration writes the four bands and their boundaries', () => {
  const cases = [
    [0, '0s'],
    [1 * SEC, '1s'],
    [59 * SEC, '59s'],
    [60 * SEC, '1m'],
    [90 * SEC, '1m'],
    [59 * MIN + 59 * SEC, '59m'],
    [60 * MIN, '1h 0m'],
    [2 * HOUR + 5 * MIN, '2h 5m'],
    [23 * HOUR + 59 * MIN + 59 * SEC, '23h 59m'],
    [24 * HOUR, '1d 0h'],
    [3 * DAY + 4 * HOUR + 59 * MIN, '3d 4h'],
  ];
  for (const [ms, text] of cases) assert.strictEqual(org.shortDuration(ms), text, ms + 'ms');
});

test('shortDuration clamps a negative span to 0s', () => {
  assert.strictEqual(org.shortDuration(-1), '0s');
  assert.strictEqual(org.shortDuration(-5 * DAY), '0s');
});

test('expiryText counts down and counts up', () => {
  assert.strictEqual(org.expiryText(NOW + 90 * MIN, NOW), '1h 30m left');
  assert.strictEqual(org.expiryText(NOW - 2 * DAY, NOW), 'expired 2d 0h ago');
  // An expiry exactly now is not in the future, so it reads as just expired.
  assert.strictEqual(org.expiryText(NOW, NOW), 'expired 0s ago');
});

test('expiryText reads a missing or unparseable expiry as none', () => {
  // I-L5-05: a deliberate divergence from today's app. There `Number(null)` is 0,
  // which is finite, so a row with no expires_at rendered "expired 20703d 0h ago"
  // (4 of the 114 captured rows). BEHAVIOUR.md §4 states the contract as
  // 'none' | '<d> left' | 'expired <d> ago', so an absent expiry is 'none' here.
  assert.strictEqual(org.expiryText(null, NOW), 'none');
  assert.strictEqual(org.expiryText(undefined, NOW), 'none');
  assert.strictEqual(org.expiryText('', NOW), 'none');
  assert.strictEqual(org.expiryText('soon', NOW), 'none');
  assert.strictEqual(org.expiryText(NaN, NOW), 'none');
});

test('leaseAge is shortDuration since last_seen_at', () => {
  assert.strictEqual(org.leaseAge({ last_seen_at: iso(NOW - 45 * SEC) }, NOW), '45s');
  assert.strictEqual(org.leaseAge({ last_seen_at: iso(NOW - 3 * HOUR) }, NOW), '3h 0m');
});

test('leaseAge is unknown without a parseable last_seen_at', () => {
  assert.strictEqual(org.leaseAge({}, NOW), 'unknown');
  assert.strictEqual(org.leaseAge({ last_seen_at: null }, NOW), 'unknown');
  assert.strictEqual(org.leaseAge({ last_seen_at: 'not a date' }, NOW), 'unknown');
  assert.strictEqual(org.leaseAge(null, NOW), 'unknown');
});

test('workText pairs the group with a Linear-shaped task only', () => {
  assert.strictEqual(org.workText({ group: 'fleetdeck', task: 'XYZ-2137' }), 'fleetdeck / XYZ-2137');
  assert.strictEqual(org.workText({ group: '', task: 'XYZ-2137' }), 'no group / XYZ-2137');
  assert.strictEqual(org.workText({ group: 'fleetdeck', task: '' }), 'fleetdeck / no task');
  // app.js:112's TASK_RE — uppercase key, at least two leading chars, then -digits.
  assert.strictEqual(org.workText({ group: 'g', task: 'xyz-1' }), 'g / no task');
  assert.strictEqual(org.workText({ group: 'g', task: 'not a key' }), 'g / no task');
  assert.strictEqual(org.workText({ group: 'g', task: 'X-1' }), 'g / no task');
  assert.strictEqual(org.workText({ group: 'g', task: 'AB1-42' }), 'g / AB1-42');
});

test('norm fills only the fields a row is missing', () => {
  assert.deepStrictEqual(org.norm({ host: 'h', name: 'n' }), {
    label: '',
    role: '',
    worker: '',
    note: '',
    group: '',
    task: '',
    status: 'active',
    live: true,
    host: 'h',
    name: 'n',
  });
  const kept = org.norm({ host: 'h', name: 'n', label: 'L', role: 'r', worker: 'w', note: 'x', group: 'g', task: 't', status: 'gone', live: false });
  assert.strictEqual(kept.status, 'gone');
  assert.strictEqual(kept.live, false, 'live:false is a value, not a gap');
  assert.strictEqual(kept.group, 'g');
});

// ---------------------------------------------------------------------------
// Badges — one slot, precedence tombstone > pinger > idle (BEHAVIOUR.md §3).
// ---------------------------------------------------------------------------

const TOMBSTONE = {
  text: '🪦 close me',
  tone: 'dim',
  title: 'Close this stale Mac desktop session; fleetdeck never kills Mac rows',
};
const PINGER = {
  text: 'pinger',
  tone: 'info',
  title: 'Session is live; its detached heartbeat pinger failed',
};
const IDLE = { text: 'idle 15m+', tone: 'warn', title: '' };

test('badgeFor reads each of the three conditions on its own', () => {
  assert.deepStrictEqual(org.badgeFor({ host: 'mac' }, 'tombstone', NOW), TOMBSTONE);
  assert.deepStrictEqual(org.badgeFor({ pinger_dead: true }, 'active', NOW), PINGER);
  assert.deepStrictEqual(org.badgeFor({ active_at: iso(NOW - 15 * MIN) }, 'active', NOW), IDLE);
  assert.deepStrictEqual(org.badgeFor({ last_seen_at: iso(NOW - 30 * MIN) }, 'offline', NOW), IDLE);
});

test('badgeFor holds its precedence on a row that meets all three', () => {
  const row = { host: 'mac', name: 'stale', lease_state: 'reaped', pinger_dead: true, active_at: iso(NOW - 40 * MIN) };
  assert.strictEqual(chart.stateOf(row), 'tombstone');
  assert.strictEqual(chart.needsAttention(row, NOW), true);
  assert.deepStrictEqual(org.badgeFor(row, chart.stateOf(row), NOW), TOMBSTONE, 'tombstone wins');
  assert.deepStrictEqual(org.badgeFor(row, 'offline', NOW), PINGER, 'pinger wins over idle');
  assert.deepStrictEqual(org.badgeFor(Object.assign({}, row, { pinger_dead: false }), 'offline', NOW), IDLE);
});

test('badgeFor is null for a quiet row', () => {
  assert.strictEqual(org.badgeFor({ active_at: iso(NOW - 14 * MIN) }, 'active', NOW), null);
  assert.strictEqual(org.badgeFor({}, 'active', NOW), null, 'no timestamp is not attention');
});

test('subtreeCount counts the node and every descendant', () => {
  const leaf = () => ({ children: [] });
  assert.strictEqual(org.subtreeCount(leaf()), 1);
  assert.strictEqual(org.subtreeCount({ children: [leaf(), leaf()] }), 3);
  assert.strictEqual(
    org.subtreeCount({ children: [{ children: [{ children: [leaf()] }] }, leaf()] }),
    5
  );
});

// ---------------------------------------------------------------------------
// build() — buildTree output adapted into the mock's slots.
// ---------------------------------------------------------------------------

// A four-row fleet: two seat owners, one child of the coordinator, and one row
// whose parent pointer dangles. Seats are handed over out of order on purpose.
const COORD = norm({ host: 'box', name: 'coord', worker: 'Ada', role: 'coordinator', group: 'deck', epoch: 7, lease_state: 'active', expires_at: NOW + 2 * HOUR, last_seen_at: iso(NOW - 20 * SEC) });
const ORCH = norm({ host: 'box', name: 'orch', worker: 'Brix', role: 'orchestrator', group: 'deck', epoch: 8, lease_state: 'active', expires_at: NOW + 30 * MIN, last_seen_at: iso(NOW - 40 * SEC) });
const KID = norm({ host: 'box', name: 'kid', worker: 'Cleo', role: 'builder', group: 'proj', epoch: 9, parent_host: 'box', parent_name: 'coord', last_seen_at: iso(NOW - 60 * SEC) });
const LOST = norm({ host: 'mac', name: 'lost', worker: 'Dora', group: 'stray', parent_host: 'ghost', parent_name: 'gone', last_seen_at: iso(NOW - 5 * MIN) });
const FLEET = () =>
  data({
    sessions: [COORD, ORCH, KID, LOST],
    seats: [
      { seat: 'orchestrator', owner_host: 'box', owner_name: 'orch', expires_at: NOW + 30 * MIN },
      { seat: 'coordinator', owner_host: 'box', owner_name: 'coord', expires_at: NOW + 2 * HOUR },
    ],
  });

test('build counts sessions, seats and the unattached subtree', () => {
  const out = FLEET();
  const payload = org.build(out, NOW);
  assert.strictEqual(payload.mode, 'ok');
  assert.deepStrictEqual(payload.stats, { sessions: 4, seats: 2, attached: 3, unattached: 1 });
  assert.strictEqual(payload.stats.attached, out.sessions.length - payload.stats.unattached);
});

test('unattached counts the whole subtree an unattached row keeps', () => {
  // app.js:355-357: the strip shows the node's own children too, so both rows count.
  const parent = norm({ host: 'mac', name: 'a', worker: 'Ann', parent_host: 'ghost', parent_name: 'gone' });
  const child = norm({ host: 'mac', name: 'b', worker: 'Bob', parent_host: 'mac', parent_name: 'a' });
  const payload = org.build(data({ sessions: [parent, child] }), NOW);
  assert.deepStrictEqual(payload.stats, { sessions: 2, seats: 0, attached: 0, unattached: 2 });
  assert.deepStrictEqual(payload.cards.map((c) => c.name), ['Ann', 'Bob']);
});

test('status joins its notes with a middle dot', () => {
  assert.strictEqual(org.build(FLEET(), NOW).status, '4 sessions · 2 seats · 1 unattached');
  // No unattached row and no host error: just the two counts.
  const tidy = data({ sessions: [COORD], seats: [{ seat: 'coordinator', owner_host: 'box', owner_name: 'coord' }] });
  assert.strictEqual(org.build(tidy, NOW).status, '1 sessions · 1 seats');
  assert.strictEqual(org.build(data({}), NOW).status, '0 sessions · 0 seats');
});

test('status appends host errors, and hasError follows them', () => {
  const withErrors = Object.assign(FLEET(), { errors: [{ host: 'mac' }, { host: 'box' }] });
  const payload = org.build(withErrors, NOW);
  assert.strictEqual(payload.status, '4 sessions · 2 seats · 1 unattached · 2 host errors');
  assert.strictEqual(payload.hasError, true);
  assert.strictEqual(org.build(FLEET(), NOW).hasError, false);
});

test('source names the fixture or the live API', () => {
  assert.deepStrictEqual(org.build(data({ fixture: true }), NOW).source, { text: 'M11 fixture', tone: 'warn' });
  assert.deepStrictEqual(org.build(data({ fixture: false }), NOW).source, { text: 'live API', tone: 'good' });
});

test('empty speaks only for a fleet with no roots and no unattached', () => {
  assert.strictEqual(org.build(data({}), NOW).empty, 'No seats or sessions to map.');
  assert.strictEqual(org.build(FLEET(), NOW).empty, '');
  // A vacant seat is still a root, so the chart is not empty.
  const vacant = data({ seats: [{ seat: 'coordinator', owner_host: 'box', owner_name: 'nobody' }] });
  assert.strictEqual(org.build(vacant, NOW).empty, '');
});

test('a seat with an owner session becomes a messageable spine entry', () => {
  const spine = org.build(FLEET(), NOW).spine;
  assert.strictEqual(spine.length, 2);
  assert.deepStrictEqual(spine[0], {
    name: 'Ada',
    tag: 'coordinator',
    sub: 'coordinator · coordinator seat',
    path: 'box / coord',
    lease: 'active',
    exp: '2h 0m left',
    expTone: 'good',
    dotTone: 'good',
    canMsg: true,
    target: { type: 'tmux', host: 'box', session: 'coord' },
    ariaLabel: 'Ada, active',
    hasSeat: true,
  });
});

test('coordinator sorts before orchestrator however the seats arrive', () => {
  assert.deepStrictEqual(org.build(FLEET(), NOW).spine.map((s) => s.name), ['Ada', 'Brix']);
});

test('a seat with no owner row is a vacant spine entry', () => {
  const payload = org.build(
    data({ seats: [{ seat: 'coordinator', owner_host: 'box', owner_name: 'nobody', expires_at: NOW - 5 * MIN }] }),
    NOW
  );
  assert.deepStrictEqual(payload.spine, [
    {
      name: 'coordinator',
      tag: 'seat', // a live /api/seats row withholds the epoch (BEHAVIOUR.md §1)
      sub: 'No current owner row',
      path: 'C · box / nobody',
      lease: 'vacant',
      exp: 'expired 5m ago',
      expTone: 'bad',
      dotTone: 'hollow',
      canMsg: false,
    },
  ]);
});

test('a second seat naming one owner is shown as a conflict', () => {
  const payload = org.build(
    data({
      sessions: [COORD],
      seats: [
        { seat: 'coordinator', owner_host: 'box', owner_name: 'coord' },
        { seat: 'orchestrator', owner_host: 'box', owner_name: 'coord', epoch: 4 },
      ],
    }),
    NOW
  );
  assert.strictEqual(payload.spine.length, 2, 'the conflicting seat is shown, not dropped');
  assert.strictEqual(payload.spine[0].name, 'Ada');
  assert.strictEqual(payload.spine[1].sub, 'Owner row already holds another seat');
  assert.strictEqual(payload.spine[1].canMsg, false);
  assert.strictEqual(payload.spine[1].path, 'O · box / coord');
  assert.strictEqual(payload.spine[1].tag, '#4', 'the fixture carries an epoch, the wire does not');
});

test('a child of a seat owner lands in kids, not cards', () => {
  const payload = org.build(FLEET(), NOW);
  assert.deepStrictEqual(payload.kids.map((k) => k.name), ['Cleo']);
  assert.deepStrictEqual(payload.kids[0], {
    name: 'Cleo',
    role: 'builder',
    path: 'box / kid',
    epoch: '#9',
    lease: 'tmux live',
    exp: 'none',
    expTone: 'good',
    dotTone: 'good',
    target: { type: 'tmux', host: 'box', session: 'kid' },
    ariaLabel: 'Cleo, active',
    mach: 'box',
    proj: 'proj',
  });
});

test('a dangling parent pointer lands in cards', () => {
  const payload = org.build(FLEET(), NOW);
  assert.deepStrictEqual(payload.cards.map((c) => c.name), ['Dora']);
  assert.strictEqual(payload.cards[0].path, 'mac / lost');
  assert.strictEqual(payload.cards[0].grp, 'stray / no task');
});

test('every kid and card carries mach and proj for the scope filter', () => {
  const payload = org.build(FLEET(), NOW);
  for (const row of payload.kids.concat(payload.cards)) {
    assert.strictEqual(typeof row.mach, 'string', row.name + ' mach');
    assert.strictEqual(typeof row.proj, 'string', row.name + ' proj');
  }
  assert.deepStrictEqual(payload.cards.map((c) => [c.mach, c.proj]), [['mac', 'stray']]);
});

test('a card carries exactly the four meta facts, in order', () => {
  const card = org.build(FLEET(), NOW).cards[0];
  assert.deepStrictEqual(card.meta.map((m) => m.k), ['epoch', 'lease', 'age', 'expires']);
  assert.deepStrictEqual(card.meta, [
    { k: 'epoch', v: 'legacy', tone: 'ink75', mono: true },
    { k: 'lease', v: 'tmux live', tone: 'ink75' },
    { k: 'age', v: '5m', tone: 'ink75' },
    { k: 'expires', v: 'none', tone: 'good' },
  ]);
});

test('meta epoch and lease follow the row', () => {
  const row = norm({ host: 'mac', name: 'x', worker: 'Eve', epoch: 12, lease_state: 'suspect', last_seen_at: iso(NOW - 90 * SEC), expires_at: NOW + 10 * MIN });
  const card = org.build(data({ sessions: [row] }), NOW).cards[0];
  assert.deepStrictEqual(card.meta, [
    { k: 'epoch', v: '#12', tone: 'ink75', mono: true },
    { k: 'lease', v: 'suspect', tone: 'ink75' },
    { k: 'age', v: '1m', tone: 'ink75' },
    { k: 'expires', v: '10m left', tone: 'bad' }, // suspect is not active
  ]);
  // An offline row with no lease_state reads 'unleased'.
  const dark = norm({ host: 'mac', name: 'y', worker: 'Fay', live: false });
  assert.strictEqual(org.build(data({ sessions: [dark] }), NOW).cards[0].meta[1].v, 'unleased');
});

test('a card carries its badge flattened into the mock slot', () => {
  const row = norm({ host: 'mac', name: 'z', worker: 'Gus', lease_state: 'reaped' });
  const card = org.build(data({ sessions: [row] }), NOW).cards[0];
  assert.strictEqual(card.badge, TOMBSTONE.text);
  assert.strictEqual(card.badgeTone, TOMBSTONE.tone);
  assert.strictEqual(card.badgeTitle, TOMBSTONE.title);
  assert.strictEqual(card.ariaLabel, 'Gus, tombstone');
  const quiet = org.build(FLEET(), NOW).cards[0];
  assert.strictEqual(quiet.badge, '');
  assert.strictEqual(quiet.badgeTone, 'warn');
  assert.strictEqual(quiet.badgeTitle, '');
});

// ---------------------------------------------------------------------------
// The loading and error payloads (BEHAVIOUR.md §5).
// ---------------------------------------------------------------------------

test('loadingPayload names the live load and shows nothing else', () => {
  const payload = org.loadingPayload();
  assert.strictEqual(payload.mode, 'loading');
  assert.strictEqual(payload.status, 'Loading live seats and sessions…');
  assert.strictEqual(payload.spine[0].name, 'Loading live seats and sessions…');
  assert.strictEqual(payload.spine[0].canMsg, false);
  assert.deepStrictEqual(payload.kids, []);
  assert.deepStrictEqual(payload.cards, []);
  assert.deepStrictEqual(payload.stats, { sessions: 0, seats: 0, attached: 0, unattached: 0 });
  assert.deepStrictEqual(payload.source, { text: 'live API', tone: 'good' });
  assert.strictEqual(payload.hasError, false);
  assert.strictEqual(payload.empty, '');
});

test('errorPayload carries the message and the integration-pending source', () => {
  const payload = org.errorPayload(new Error('/api/seats HTTP 502'));
  assert.strictEqual(payload.mode, 'error');
  assert.strictEqual(payload.status, 'Org chart unavailable: /api/seats HTTP 502');
  assert.strictEqual(payload.spine[0].lease, 'Org chart unavailable: /api/seats HTTP 502');
  assert.strictEqual(payload.spine[0].name, 'The frozen seat endpoint is not available on this branch.');
  assert.strictEqual(payload.spine[0].path, '/?orgFixture=1');
  assert.strictEqual(payload.source.text, 'integration pending');
  assert.strictEqual(payload.hasError, true);
  assert.deepStrictEqual(payload.kids, []);
  assert.deepStrictEqual(payload.cards, []);
  assert.deepStrictEqual(payload.stats, { sessions: 0, seats: 0, attached: 0, unattached: 0 });
});

test('errorPayload stringifies a non-Error rejection', () => {
  assert.strictEqual(org.errorPayload('boom').status, 'Org chart unavailable: boom');
});

test('?orgFixture=1 switches the loading text and the source badge', () => {
  global.location = { search: '?orgFixture=1' };
  assert.strictEqual(org.orgFixtureMode(), true);
  const payload = org.loadingPayload();
  assert.strictEqual(payload.status, 'Loading M11 fixture…');
  assert.deepStrictEqual(payload.source, { text: 'M11 fixture', tone: 'warn' });
  // The pixel gate is a different flag and is off here.
  assert.strictEqual(org.pixelFixtureMode(), false);
  global.location = { search: '?fixture=1' };
  assert.strictEqual(org.pixelFixtureMode(), true);
  assert.strictEqual(org.orgFixtureMode(), false);
});

// ---------------------------------------------------------------------------
// The two guarded cross-slice hooks. Neither owner slice has landed.
// ---------------------------------------------------------------------------

test('openBus is inert until L6 lands', () => {
  assert.strictEqual(global.FD.screens.bus, undefined);
  assert.strictEqual(org.openBus({ type: 'tmux', host: 'box', session: 'coord' }), false);
  global.FD.screens.bus = {};
  assert.strictEqual(org.openBus({ type: 'tmux' }), false, 'a bus with no open() is still inert');
});

test('openBus forwards the target once L6 provides open()', () => {
  const seen = [];
  global.FD.screens.bus = { open: (target) => seen.push(target) };
  const target = { type: 'tmux', host: 'box', session: 'coord' };
  assert.strictEqual(org.openBus(target), true);
  assert.deepStrictEqual(seen, [target]);
});

test('setLiveApi is inert until L2 lands, and forwards once it has', () => {
  assert.strictEqual(global.FD.shell.setLiveApi, undefined);
  assert.doesNotThrow(() => org.setLiveApi('live API', 'good'));
  const seen = [];
  global.FD.shell.setLiveApi = (text, tone) => seen.push([text, tone]);
  org.setLiveApi('M11 fixture', 'warn');
  assert.deepStrictEqual(seen, [['M11 fixture', 'warn']]);
});
