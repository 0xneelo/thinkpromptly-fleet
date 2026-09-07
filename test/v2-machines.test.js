// L9 acceptance: the v2 Machines screen must say exactly what the shipped screen says.
// Every user-visible string asserted below is copied from public/machines.js — the file
// BEHAVIOUR.md was extracted from — with only the tone rename the mock imposes (ok -> good,
// '' -> neutral). The integration cases run against the live capture from 2026-09-07
// (docs/design/fleetdeck-v2/fixtures/api/machines.json), not a hand-written payload.
//
// The clock is injected everywhere: not one assertion may depend on when the suite runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// public/v2/screens/machines.js calls FD.data.toMachines for the card names, and
// public/v2/index.html does not load data.js — so the test loads it first, exactly as the
// screen's own ensureData() would in the browser. Both files publish onto globalThis.FD.
require(path.join(ROOT, 'public/v2/data.js'));
const screen = require(path.join(ROOT, 'public/v2/screens/machines.js'));
const _ = screen._;

const payload = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api/machines.json'), 'utf8')
);
const machine = (id) => payload.machines.find((m) => m.id === id);

// Fixed clock. SEC is the same instant in epoch seconds, which is what every timestamp
// field in the API carries.
const NOW = Date.parse('2026-09-07T00:00:00Z');
const SEC = NOW / 1000;
const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

// ---------------------------------------------------------------------------
// Time helpers (machines.js:41-66).
// ---------------------------------------------------------------------------

test('ago reads both directions and switches unit at 60 min and 1440 min', () => {
  assert.strictEqual(_.ago(SEC, NOW), 'just now');
  assert.strictEqual(_.ago(SEC - 59, NOW), 'just now', 'under a minute is still just now');
  assert.strictEqual(_.ago(SEC - MIN, NOW), '1 min ago');
  assert.strictEqual(_.ago(SEC - 33 * MIN, NOW), '33 min ago');
  assert.strictEqual(_.ago(SEC - 59 * MIN, NOW), '59 min ago', 'last minute before the hour form');
  assert.strictEqual(_.ago(SEC - 60 * MIN, NOW), '1 h ago', 'exactly 60 min is hours');
  assert.strictEqual(_.ago(SEC - 23 * HOUR, NOW), '23 h ago');
  assert.strictEqual(_.ago(SEC - 1439 * MIN, NOW), '23 h ago', 'last minute before the day form');
  assert.strictEqual(_.ago(SEC - 1440 * MIN, NOW), '1 d ago', 'exactly 1440 min is days');
  assert.strictEqual(_.ago(SEC - 102 * DAY, NOW), '102 d ago');
});

test('ago writes a future timestamp as "in X"', () => {
  // A Claude token expires ahead of now, and the cell has to say so (machines.js:45).
  assert.strictEqual(_.ago(SEC + 5 * MIN, NOW), 'in 5 min');
  assert.strictEqual(_.ago(SEC + 2 * HOUR, NOW), 'in 2 h');
  assert.strictEqual(_.ago(SEC + 3 * DAY, NOW), 'in 3 d');
  // 'just now' is the past branch only; a few seconds ahead still reads as a future gap.
  assert.strictEqual(_.ago(SEC + 30, NOW), 'in 0 min');
});

test('sampleAge uses the compact suffix and never looks forward', () => {
  // machines.js:52-59 — no space before the unit, unlike ago().
  assert.strictEqual(_.sampleAge(SEC, NOW), 'just now');
  assert.strictEqual(_.sampleAge(SEC - 5 * MIN, NOW), '5m ago');
  assert.strictEqual(_.sampleAge(SEC - 59 * MIN, NOW), '59m ago');
  assert.strictEqual(_.sampleAge(SEC - 60 * MIN, NOW), '1h ago');
  assert.strictEqual(_.sampleAge(SEC - 5 * HOUR, NOW), '5h ago');
  assert.strictEqual(_.sampleAge(SEC - 1440 * MIN, NOW), '1d ago');
  assert.strictEqual(_.sampleAge(SEC - 3 * DAY, NOW), '3d ago');
});

test('until says nothing without an epoch and "resets now" once it has passed', () => {
  // machines.js:61-66.
  assert.strictEqual(_.until(0, NOW), '');
  assert.strictEqual(_.until(null, NOW), '');
  assert.strictEqual(_.until(undefined, NOW), '');
  assert.strictEqual(_.until(SEC, NOW), 'resets now');
  assert.strictEqual(_.until(SEC - HOUR, NOW), 'resets now');
  assert.strictEqual(_.until(SEC + 45 * MIN, NOW), 'resets in 45m');
  assert.strictEqual(_.until(SEC + 59 * MIN, NOW), 'resets in 59m');
  assert.strictEqual(_.until(SEC + 200 * MIN, NOW), 'resets in 3h 20m');
  assert.strictEqual(_.until(SEC + 60 * MIN, NOW), 'resets in 1h 0m');
});

// ---------------------------------------------------------------------------
// freshness (machines.js:110-119): the one line that says what goes stale first.
// ---------------------------------------------------------------------------

test('freshness reads a Claude CLI token on both sides of now', () => {
  const c = { client: 'claude_cli', expires_at: SEC + 2 * HOUR };
  assert.strictEqual(_.freshness(c, NOW), 'token valid in 2 h');
  assert.strictEqual(_.freshness({ client: 'claude_cli', expires_at: SEC - 3 * HOUR }, NOW), 'token expired 3 h ago');
});

test('freshness reports a codex refresh from a parseable ISO stamp', () => {
  const c = { client: 'codex_cli', last_refresh: new Date(NOW - 5 * MIN * 1000).toISOString() };
  assert.strictEqual(_.freshness(c, NOW), 'refreshed 5 min ago');
  // codex_desktop matches the same prefix test (machines.js:113).
  assert.strictEqual(
    _.freshness({ client: 'codex_desktop', last_refresh: new Date(NOW - DAY * 1000).toISOString() }, NOW),
    'refreshed 1 d ago'
  );
});

test('an unparseable last_refresh falls through to the next branch', () => {
  const withActive = { client: 'codex_cli', last_refresh: 'not a date', last_active: SEC - 10 * MIN };
  assert.strictEqual(_.freshness(withActive, NOW), 'last active 10 min ago');
  assert.strictEqual(_.freshness({ client: 'codex_cli', last_refresh: 'not a date' }, NOW), '');
});

test('freshness falls back to last active, then to nothing at all', () => {
  assert.strictEqual(_.freshness({ client: 'claude_desktop', last_active: SEC - 34 * MIN }, NOW), 'last active 34 min ago');
  // A Claude CLI with no token still reaches the last_active branch.
  assert.strictEqual(_.freshness({ client: 'claude_cli', expires_at: null, last_active: SEC - HOUR }, NOW), 'last active 1 h ago');
  assert.strictEqual(_.freshness({ client: 'claude_cli' }, NOW), '');
  assert.strictEqual(_.freshness({ client: 'codex_desktop', last_refresh: null, last_active: null }, NOW), '');
});

// ---------------------------------------------------------------------------
// windowNames — usageNodes()'s sort (machines.js:94-97): it orders, it does not filter
// by name. Only a non-object window is dropped.
// ---------------------------------------------------------------------------

const win = (pct) => ({ pct: pct, resets_at: null });

test('windowNames returns WIN_ORDER windows in WIN_ORDER whatever the key order', () => {
  const u = { windows: {} };
  for (const n of ['secondary', 'weekly', 'extra', 'seven_day', 'five_hour']) u.windows[n] = win(1);
  assert.deepStrictEqual(_.windowNames(u), ['five_hour', 'seven_day', 'extra', 'weekly', 'secondary']);
});

test('an unknown window sorts after every known one', () => {
  const u = { windows: { seven_day_fable: win(0), five_hour: win(1), seven_day: win(2) } };
  assert.deepStrictEqual(_.windowNames(u), ['five_hour', 'seven_day', 'seven_day_fable']);
});

test('two unknown windows sort between themselves by localeCompare', () => {
  const u = { windows: { zulu: win(1), alpha: win(2), five_hour: win(3) } };
  assert.deepStrictEqual(_.windowNames(u), ['five_hour', 'alpha', 'zulu']);
});

test('a window that is not an object is dropped', () => {
  // machines.js:95-97: one bad row costs one bar, not the whole page.
  const u = { windows: { five_hour: 7, seven_day: win(1), weekly: null, extra: 'nope' } };
  assert.deepStrictEqual(_.windowNames(u), ['seven_day']);
});

test('no usage and no windows both give an empty list', () => {
  assert.deepStrictEqual(_.windowNames(null), []);
  assert.deepStrictEqual(_.windowNames(undefined), []);
  assert.deepStrictEqual(_.windowNames({}), []);
  assert.deepStrictEqual(_.windowNames({ windows: {} }), []);
});

// ---------------------------------------------------------------------------
// section — one client entry becomes one section of the card.
// ---------------------------------------------------------------------------

// A signed-in Claude CLI with nothing interesting on it; each test overrides what it needs.
const client = (over) => Object.assign({
  client: 'claude_cli', where: 'local', installed: true, state: 'ok',
  label: null, email: null, config_email: null, org: null,
  plan: null, tier: null, proof: null, expires_at: null, last_refresh: null,
  last_active: null, shares: null, note: null, usage: null,
}, over);

test('a not_installed client is the em dash that empties the cell', () => {
  // machines.js:126-129, and mCard drops a section whose primary is '—'.
  const out = _.section(client({ installed: false, state: 'not_installed' }), false, [], false, NOW);
  assert.deepStrictEqual(out, { env: '', name: '—', email: '', chips: [], bars: [], note: '' });
  // The environment tag survives, because today's cell prints the tag before the dash.
  assert.strictEqual(_.section(client({ installed: false, state: 'not_installed' }), true, [], false, NOW).env, 'WSL');
  assert.strictEqual(
    _.section(client({ where: 'windows', installed: false, state: 'not_installed' }), false, [], false, NOW).env,
    'Windows'
  );
});

test('the plan chip is dropped only for business', () => {
  // machines.js:135-136.
  assert.deepStrictEqual(_.section(client({ plan: 'pro' }), false, [], false, NOW).chips, [['pro', 'neutral']]);
  assert.deepStrictEqual(_.section(client({ plan: 'claude_max' }), false, [], false, NOW).chips, [['claude_max', 'neutral']]);
  assert.deepStrictEqual(_.section(client({ plan: 'business' }), false, [], false, NOW).chips, []);
});

test('the tier chip goes through TIER and passes an unknown tier through raw', () => {
  // machines.js:20 and :137.
  assert.deepStrictEqual(_.section(client({ tier: 'default_claude_max_20x' }), false, [], false, NOW).chips, [['Max 20×', 'neutral']]);
  assert.deepStrictEqual(_.section(client({ tier: 'claude_max' }), false, [], false, NOW).chips, [['Max', 'neutral']]);
  assert.deepStrictEqual(_.section(client({ tier: 'team_of_one' }), false, [], false, NOW).chips, [['team_of_one', 'neutral']]);
});

test('the proof chip is PROOF, with the mock tone names', () => {
  // machines.js:11.
  const chipsFor = (proof) => _.section(client({ proof: proof }), false, [], false, NOW).chips;
  assert.deepStrictEqual(chipsFor('profile'), [['token-proved', 'good']]);
  assert.deepStrictEqual(chipsFor('jwt'), [['token-proved', 'good']]);
  assert.deepStrictEqual(chipsFor('config'), [['config only', 'warn']]);
  assert.deepStrictEqual(chipsFor('history'), [['last active', 'neutral']]);
  assert.deepStrictEqual(chipsFor('hearsay'), [], 'an unmapped proof makes no chip');
});

test('the state chip is STATE, and an unmapped state makes no chip', () => {
  // machines.js:12-19.
  const chipsFor = (state) => _.section(client({ state: state }), false, [], false, NOW).chips;
  assert.deepStrictEqual(chipsFor('token_expired'), [['token expired', 'bad']]);
  assert.deepStrictEqual(chipsFor('rate_limited'), [['busy (429)', 'warn']]);
  assert.deepStrictEqual(chipsFor('signed_out'), [['signed out', 'warn']]);
  assert.deepStrictEqual(chipsFor('api_key'), [['api key', 'neutral']]);
  assert.deepStrictEqual(chipsFor('no_samples'), [['never used', 'neutral']]);
  assert.deepStrictEqual(chipsFor('error'), [['read failed', 'bad']]);
  // 'ok' and 'config_only' are both real API states with no chip today — german-box's
  // Windows Claude CLI is config_only, and today's page shows only its proof chip.
  assert.deepStrictEqual(chipsFor('ok'), []);
  assert.deepStrictEqual(chipsFor('config_only'), []);
  assert.deepStrictEqual(chipsFor('unknown_source'), []);
});

test('the chips keep plan, tier, proof, state order', () => {
  const out = _.section(client({ plan: 'claude_max', tier: 'default_claude_max_20x', proof: 'config', state: 'token_expired' }), false, [], false, NOW);
  assert.deepStrictEqual(out.chips, [
    ['claude_max', 'neutral'], ['Max 20×', 'neutral'], ['config only', 'warn'], ['token expired', 'bad'],
  ]);
});

test('identity: label wins, then the org, then the account-unknown line', () => {
  // machines.js:131-133.
  assert.strictEqual(_.section(client({ label: 'Lafayette Tabor' }), false, [], false, NOW).name, 'Lafayette Tabor');
  const orgOnly = _.section(client({ org: 'c578669c-cdac-42d7-b451-13f3a3554d75' }), false, [], false, NOW);
  assert.strictEqual(orgOnly.name, 'c578669c · unmapped org');
  assert.strictEqual(orgOnly.email, '');
  assert.strictEqual(_.section(client({}), false, [], false, NOW).name, 'signed in, account unknown');
});

test('an email with no label leaves the name empty and carries the address', () => {
  // Today the address is its own .addr line; the name line is simply not rendered.
  const out = _.section(client({ email: 'admin@deus.finance', org: 'c578669c-cdac' }), false, [], false, NOW);
  assert.strictEqual(out.name, '');
  assert.strictEqual(out.email, 'admin@deus.finance');
});

test('email falls back to config_email', () => {
  // machines.js:130.
  assert.strictEqual(_.section(client({ config_email: 'neelo@vibe.trading' }), false, [], false, NOW).email, 'neelo@vibe.trading');
  assert.strictEqual(
    _.section(client({ email: 'live@x.test', config_email: 'stale@x.test' }), false, [], false, NOW).email,
    'live@x.test'
  );
  assert.strictEqual(_.section(client({}), false, [], false, NOW).email, '');
});

test('env is Windows for the windows side, WSL when told, otherwise empty', () => {
  assert.strictEqual(_.section(client({ where: 'windows' }), false, [], false, NOW).env, 'Windows');
  // The windows side wins even if the caller also passes the wsl flag.
  assert.strictEqual(_.section(client({ where: 'windows' }), true, [], false, NOW).env, 'Windows');
  assert.strictEqual(_.section(client({ where: 'local' }), true, [], false, NOW).env, 'WSL');
  assert.strictEqual(_.section(client({ where: 'local' }), false, [], false, NOW).env, '');
});

test('the note joins every line today stacks, in that order, with " · "', () => {
  const c = client({
    label: 'Lafayette Tabor', email: 'lafayette@infinite-holdings.llc',
    expires_at: SEC + HOUR, shares: true, note: 'collector could not read the keychain',
    usage: {
      windows: { five_hour: { pct: 29, resets_at: SEC + 45 * MIN }, seven_day: { pct: 62, resets_at: SEC + 200 * MIN } },
      sample_ts: SEC - HOUR, stale_windows: true,
    },
  });
  const out = _.section(c, false, [{}, {}], true, NOW);
  assert.strictEqual(out.note, [
    'token valid in 1 h',
    'same login as CLI',
    'collector could not read the keychain',
    '5 hour resets in 45m',
    '7 day resets in 3h 20m',
    'sampled 1h ago — older than the window it measured, so these have reset since',
    '2 sessions run as Lafayette Tabor',
  ].join(' · '));
});

test('a fresh sample carries no stale-window tail', () => {
  const out = _.section(client({ usage: { windows: { weekly: win(96) }, sample_ts: SEC - 33 * MIN, stale_windows: false } }), false, [], false, NOW);
  assert.strictEqual(out.note, 'sampled 33m ago');
});

test('no usage at all and no windows reported are two different lines', () => {
  // machines.js:92 and :98.
  assert.strictEqual(_.section(client({ usage: null }), false, [], false, NOW).note, 'no usage data');
  assert.strictEqual(_.section(client({ usage: { windows: {} } }), false, [], false, NOW).note, 'no usage windows reported');
  // A usage object whose only window is unusable still reports none.
  assert.strictEqual(_.section(client({ usage: { windows: { five_hour: 7 } } }), false, [], false, NOW).note, 'no usage windows reported');
});

test('a window with no reset time contributes no note entry', () => {
  const out = _.section(client({ usage: { windows: { five_hour: { pct: 10, resets_at: null }, seven_day: { pct: 20, resets_at: SEC + 45 * MIN } } } }), false, [], false, NOW);
  assert.strictEqual(out.note, '7 day resets in 45m');
});

test('the bars are [label, pct, stale, until] with the WIN_LABEL names', () => {
  // machines.js:25 for the labels, :78 for the underscore fallback.
  const out = _.section(client({ usage: { windows: {
    five_hour: { pct: null, resets_at: SEC + 20 * MIN, stale: true },
    seven_day_fable: { pct: 0, resets_at: null },
  } } }), false, [], false, NOW);
  assert.deepStrictEqual(out.bars, [
    ['5 hour', null, true, 'resets in 20m'],
    ['seven day fable', 0, false, ''],
  ]);
});

// A client whose usage reports one window with no reset time and no sample: it adds no
// note entry of its own, so the attribution line stands alone and can be asserted whole.
const quiet = (over) => client(Object.assign({ usage: { windows: { weekly: { pct: 5, resets_at: null } } } }, over));

test('the session attribution is singular for one session and plural for more', () => {
  // machines.js:153-156 — the count and the account, never "N Claude sessions".
  const c = quiet({ label: 'Lafayette Tabor' });
  assert.strictEqual(_.section(c, false, [{}], true, NOW).note, '1 session runs as Lafayette Tabor');
  assert.strictEqual(_.section(c, false, [{}, {}, {}], true, NOW).note, '3 sessions run as Lafayette Tabor');
  // An email-only login is named by its address.
  assert.strictEqual(
    _.section(quiet({ email: 'admin@deus.finance' }), false, [{}], true, NOW).note,
    '1 session runs as admin@deus.finance'
  );
});

test('the attribution needs both the runner flag and a login', () => {
  assert.strictEqual(_.section(quiet({ label: 'Lafayette Tabor' }), false, [{}], false, NOW).note, '', 'not the runner');
  assert.strictEqual(_.section(quiet({ label: 'Lafayette Tabor' }), false, [], true, NOW).note, '', 'no sessions');
  // No label and no email: the org line is not a login, so nothing is credited.
  assert.strictEqual(_.section(quiet({ org: 'c578669c-cdac' }), false, [{}], true, NOW).note, '');
});

// ---------------------------------------------------------------------------
// colsOf — always the four client columns, whatever the machine reports.
// ---------------------------------------------------------------------------

const CLIENT_LABELS = ['Claude CLI', 'Codex CLI', 'Claude desktop', 'Codex desktop'];

test('colsOf is always the four CLIENTS columns in CLIENTS order', () => {
  // machines.js:3-8, :195.
  for (const m of payload.machines) {
    const cols = _.colsOf(m, NOW);
    assert.strictEqual(cols.length, 4, m.id + ' column count');
    assert.deepStrictEqual(cols.map((c) => c.client), CLIENT_LABELS, m.id + ' column labels');
  }
});

test('a client reported on two sides gives one column with two sections', () => {
  // german-box runs a WSL and a Windows side; a 1:1 map would double the columns.
  const cols = _.colsOf(machine('german-box'), NOW);
  assert.strictEqual(cols.length, 4);
  assert.deepStrictEqual(cols.map((c) => c.sections.length), [2, 2, 2, 2]);
  assert.deepStrictEqual(cols[0].sections.map((s) => s.env), ['WSL', 'Windows']);
  assert.deepStrictEqual(cols[0].sections.map((s) => s.name), ['Lafayette Tabor', 'Daniel Tabor']);
  // The WSL tag is only for the machine's own Linux side; a single-environment machine
  // leaves it empty.
  const mac = _.colsOf(machine('macbook'), NOW);
  assert.ok(mac.every((c) => c.sections.every((s) => s.env === '')));
});

test('a client with no entries at all gets one em-dash section', () => {
  // machines.js:210 prints the same dash for an empty cell.
  const cols = _.colsOf({ os: 'linux', route: 'push', clients: [], sessions: [] }, NOW);
  assert.deepStrictEqual(cols.map((c) => c.sections.length), [1, 1, 1, 1]);
  for (const col of cols) {
    assert.deepStrictEqual(col.sections[0], { env: '', name: '—', email: '', chips: [], bars: [], note: '' });
  }
});

test('sessions are credited to the single local Claude CLI entry only', () => {
  // machines.js:204-206: more than one local Claude CLI and the page says nothing rather
  // than crediting the same sessions to two different people.
  const two = {
    os: 'linux', route: 'ssh', sessions: [{}, {}],
    clients: [
      quiet({ label: 'Lafayette Tabor', where: 'local' }),
      quiet({ label: 'Daniel Tabor', where: 'local' }),
    ],
  };
  const notes = _.colsOf(two, NOW).flatMap((c) => c.sections).map((s) => s.note);
  assert.deepStrictEqual(notes.filter((n) => /run(s)? as /.test(n)), [], 'two runners means no attribution');
  // One local entry and the note appears on exactly that section.
  const one = Object.assign({}, two, { clients: [two.clients[0]] });
  const oneNotes = _.colsOf(one, NOW).flatMap((c) => c.sections).map((s) => s.note);
  assert.deepStrictEqual(oneNotes.filter(Boolean), ['2 sessions run as Lafayette Tabor']);
});

test('the Windows Claude CLI never takes the credit on a WSL box', () => {
  const gb = _.colsOf(machine('german-box'), NOW);
  const attributed = gb.flatMap((c) => c.sections).filter((s) => /run(s)? as /.test(s.note));
  assert.strictEqual(attributed.length, 1);
  assert.strictEqual(attributed[0].env, 'WSL');
  assert.ok(
    attributed[0].note.endsWith('77 sessions run as Lafayette Tabor'),
    'the attribution is the last note entry'
  );
});

// ---------------------------------------------------------------------------
// statusOf, kindOf, sessionChip — the card header (machines.js:172-190).
// ---------------------------------------------------------------------------

test('a healthy machine has no status cell', () => {
  assert.strictEqual(_.statusOf(machine('macbook'), payload.push_url), null);
  assert.strictEqual(_.statusOf(machine('german-box'), payload.push_url), null);
});

test('an error wins over no_report and carries the bad tone', () => {
  // machines.js:181 tests m.error before the no_report branches.
  const m = { id: 'x', error: 'ssh: connect to host x port 22: Connection refused', state: 'no_report', route: 'push' };
  assert.deepStrictEqual(_.statusOf(m, payload.push_url), {
    label: 'Status', text: 'ssh: connect to host x port 22: Connection refused', copy: '', tone: 'bad',
  });
});

test('a push machine with no report gets the cron line and the exact command', () => {
  const rog = machine('rog-strix');
  assert.deepStrictEqual(_.statusOf(rog, payload.push_url), {
    label: 'Status',
    text: 'no report yet — cron this on that machine:',
    copy: 'sh fleet-logins.sh push http://100.125.231.25:3131/api/machines rog-strix',
    tone: '',
  });
  // The command is built from the payload's own push_url and the machine id (machines.js:185).
  assert.strictEqual(_.statusOf(rog, payload.push_url).copy, 'sh fleet-logins.sh push ' + payload.push_url + ' ' + rog.id);
});

test('a non-push machine with no report just says so, with nothing to copy', () => {
  assert.deepStrictEqual(_.statusOf({ id: 'x', state: 'no_report', route: 'ssh', ssh: 'x-deploy' }, payload.push_url), {
    label: 'Status', text: 'no report yet', copy: '', tone: '',
  });
});

test('kindOf names the ssh alias, and the bare route otherwise', () => {
  // machines.js:176-177.
  assert.strictEqual(_.kindOf(machine('macbook')), 'macos · local');
  assert.strictEqual(_.kindOf(machine('rog-strix')), 'windows · push');
  assert.strictEqual(_.kindOf(machine('german-box')), 'windows+wsl · ssh gb-deploy');
  assert.strictEqual(_.kindOf(machine('onboarding-vps')), 'linux · ssh ob-deploy');
});

test('sessionChip counts, and says nothing at zero', () => {
  // machines.js:179.
  assert.strictEqual(_.sessionChip({ sessions: [] }), '');
  assert.strictEqual(_.sessionChip({}), '');
  assert.strictEqual(_.sessionChip({ sessions: [{}] }), '1 session');
  assert.strictEqual(_.sessionChip({ sessions: [{}, {}] }), '2 sessions');
  assert.strictEqual(_.sessionChip(machine('german-box')), '77 sessions');
});

// ---------------------------------------------------------------------------
// toCards on the whole capture.
// ---------------------------------------------------------------------------

test('toCards turns the capture into one card per machine, in payload order', () => {
  const cards = _.toCards(payload, NOW);
  assert.strictEqual(cards.length, 6);
  assert.deepStrictEqual(cards.map((c) => c.name), [
    'MacBook Pro', 'german-box', 'onboarding-vps', 'thinkpromptly-vps', 'ivy-vps', 'ROG Strix',
  ]);
  for (const card of cards) {
    assert.deepStrictEqual(Object.keys(card), ['name', 'kind', 'sessions', 'reported', 'host', 'status', 'cols']);
    assert.strictEqual(card.cols.length, 4, card.name + ' always has four columns');
    assert.deepStrictEqual(card.cols.map((c) => c.client), CLIENT_LABELS);
  }
});

test('toCards fills the header fields from the machine row', () => {
  const cards = _.toCards(payload, NOW);
  const gb = cards[1];
  assert.strictEqual(gb.name, 'german-box');
  assert.strictEqual(gb.kind, 'windows+wsl · ssh gb-deploy');
  assert.strictEqual(gb.sessions, '77 sessions');
  assert.strictEqual(gb.host, 'german-box');
  assert.strictEqual(gb.status, null);
  assert.ok(gb.reported.startsWith('reported '), 'the reported line is prefixed');
  assert.strictEqual(gb.reported, 'reported ' + _.ago(machine('german-box').reported_at, NOW));
  assert.deepStrictEqual(gb.cols.map((c) => c.sections.length), [2, 2, 2, 2]);
});

test('a machine that never reported has no reported line and carries the push status', () => {
  const rog = _.toCards(payload, NOW)[5];
  assert.strictEqual(rog.reported, '', 'no reported_at means no line at all');
  assert.strictEqual(rog.host, '', 'a machine outside hosts.json has no deck join key');
  assert.strictEqual(rog.status.copy, 'sh fleet-logins.sh push http://100.125.231.25:3131/api/machines rog-strix');
  assert.strictEqual(rog.status.text, 'no report yet — cron this on that machine:');
});

test('toCards is deterministic and does not mutate the payload', () => {
  const before = JSON.stringify(payload);
  const a = _.toCards(payload, NOW);
  const b = _.toCards(payload, NOW);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(JSON.stringify(payload), before);
});

test('toCards survives an empty or missing payload', () => {
  assert.deepStrictEqual(_.toCards(null, NOW), []);
  assert.deepStrictEqual(_.toCards({}, NOW), []);
  assert.deepStrictEqual(_.toCards({ machines: [] }, NOW), []);
});

// ---------------------------------------------------------------------------
// The error card and the constants.
// ---------------------------------------------------------------------------

test('the error card is the fetch failure and nothing else', () => {
  // machines.js:223-224 replaces the whole list with this one message.
  assert.strictEqual(_.FETCH_ERROR, 'cannot reach fleetdeck');
  assert.deepStrictEqual(_.errorCard(), {
    name: 'cannot reach fleetdeck', kind: '', sessions: '', reported: '', host: '', status: null, cols: [],
  });
});

test('the poll interval is the 60 s the current page uses', () => {
  // machines.js:232.
  assert.strictEqual(_.POLL_MS, 60000);
});

test('the constant maps are today\'s maps, with only the tone rename', () => {
  // Copied from public/machines.js:3-28. Tones: ok -> good, '' -> neutral (the mock's
  // chipTone vocabulary); nothing else may drift.
  assert.deepStrictEqual(_.CLIENTS, [
    ['claude_cli', 'Claude CLI'],
    ['codex_cli', 'Codex CLI'],
    ['claude_desktop', 'Claude desktop'],
    ['codex_desktop', 'Codex desktop'],
  ]);
  assert.deepStrictEqual(_.PROOF, {
    profile: ['token-proved', 'good'],
    jwt: ['token-proved', 'good'],
    config: ['config only', 'warn'],
    history: ['last active', 'neutral'],
  });
  assert.deepStrictEqual(_.STATE, {
    token_expired: ['token expired', 'bad'],
    rate_limited: ['busy (429)', 'warn'],
    signed_out: ['signed out', 'warn'],
    api_key: ['api key', 'neutral'],
    no_samples: ['never used', 'neutral'],
    error: ['read failed', 'bad'],
  });
  assert.deepStrictEqual(_.TIER, { default_claude_max_20x: 'Max 20×', claude_max: 'Max' });
  assert.deepStrictEqual(_.WIN_LABEL, {
    five_hour: '5 hour', seven_day: '7 day', extra: 'extra usage', weekly: 'weekly', secondary: 'session',
  });
  assert.deepStrictEqual(_.WIN_ORDER, ['five_hour', 'seven_day', 'extra', 'weekly', 'secondary']);
});

// validate() is the guard the S2 shim audit's binding instruction 2 asks for: nothing
// leaves this file unvalidated, so a shape change on /api/machines cannot throw inside
// renderVals and blank all nine screens. No reachable API shape produces these, which is
// the point — they are the branches that fire when the endpoint changes under us.
test('validate coerces every field the template binds to a string', () => {
  const [card] = _.validate([{ name: 424242, kind: null, sessions: undefined, reported: 7, host: 99, status: null, cols: [] }]);
  assert.strictEqual(card.name, '424242');
  assert.strictEqual(card.kind, '');
  assert.strictEqual(card.sessions, '');
  assert.strictEqual(card.reported, '7');
  assert.strictEqual(card.host, '99');
});

test('validate drops a card that is not an object, and a non-array of cards', () => {
  assert.deepStrictEqual(_.validate(null), []);
  assert.deepStrictEqual(_.validate('nope'), []);
  assert.deepStrictEqual(_.validate(undefined), []);
  assert.strictEqual(_.validate([null, 'x', 0, { name: 'keep', cols: [] }]).length, 1);
  assert.strictEqual(_.validate([null, 'x', 0, { name: 'keep', cols: [] }])[0].name, 'keep');
});

test('validate replaces a non-array cols, sections, chips or bars with an empty one', () => {
  const [card] = _.validate([{ name: 'm', cols: 'not an array' }]);
  assert.deepStrictEqual(card.cols, []);

  const [card2] = _.validate([{ name: 'm', cols: [{ client: 'Claude CLI', sections: 'nope' }] }]);
  assert.deepStrictEqual(card2.cols[0].sections, []);

  const [card3] = _.validate([{ name: 'm', cols: [{ client: 'Claude CLI', sections: [{ chips: 'nope', bars: 3 }] }] }]);
  assert.deepStrictEqual(card3.cols[0].sections[0].chips, []);
  assert.deepStrictEqual(card3.cols[0].sections[0].bars, []);
});

test('validate keeps only tuple chips and bars, and drops falsy cols and sections', () => {
  const [card] = _.validate([{ name: 'm', cols: [null, { client: 'Codex CLI', sections: [null, { chips: [['pro', 'neutral'], 'junk', null], bars: [['5 hour', 12], 42] }] }] }]);
  assert.strictEqual(card.cols.length, 1);
  assert.strictEqual(card.cols[0].sections.length, 1);
  assert.deepStrictEqual(card.cols[0].sections[0].chips, [['pro', 'neutral']]);
  assert.deepStrictEqual(card.cols[0].sections[0].bars, [['5 hour', 12]]);
});

test('validate nulls a status that is not an object and coerces one that is', () => {
  assert.strictEqual(_.validate([{ name: 'm', status: 'broken', cols: [] }])[0].status, null);
  const st = _.validate([{ name: 'm', status: { label: 1, text: null, copy: undefined, tone: 'bad' }, cols: [] }])[0].status;
  assert.deepStrictEqual(st, { label: '1', text: '', copy: '', tone: 'bad' });
});

test('validate output survives a full round trip through toCards', () => {
  const cards = _.toCards(payload, NOW);
  assert.deepStrictEqual(_.validate(cards), cards, 'a well-formed card must pass through unchanged');
});

// ---------------------------------------------------------------------------
// The 60 s poll is gated on the active screen. logic.js passes the flag from
// AppLogic's lifecycle (`screen === 'machines'`); nothing here sniffs the DOM.
// Today's page has no equivalent — it IS the screen, so its interval dies with the
// page. Entering is that page load; leaving is that unload.
// ---------------------------------------------------------------------------

// load() ends in publish(), which needs the runtime's FD.setData; the browser has it,
// Node does not.
const withStubbedSeam = async (fn) => {
  const realSetData = global.FD.setData;
  global.FD.setData = () => {};
  global.FD.data._fetch = async () => ({
    ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload),
  });
  try {
    return await fn();
  } finally {
    if (_.state.poll) _.state.poll.stop();
    _.state.poll = null;
    _.state.started = false;
    global.FD.setData = realSetData;
    delete global.FD.data._fetch;
  }
};

test('sync(false) starts no poll and issues no request', async () => {
  await withStubbedSeam(async () => {
    let calls = 0;
    global.FD.data._fetch = async () => { calls++; throw new Error('no request expected'); };
    screen.sync(false);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(_.state.poll, null, 'no interval while the screen is off');
    assert.strictEqual(_.state.started, false);
    assert.strictEqual(calls, 0, 'an inactive screen must not poll the API');
  });
});

test('sync(true) starts the poll, and sync(false) stops it', async () => {
  await withStubbedSeam(async () => {
    screen.sync(true);
    await new Promise((r) => setImmediate(r));
    assert.ok(_.state.poll, 'entering the screen starts the interval');
    assert.strictEqual(_.state.started, true);

    screen.sync(false);
    assert.strictEqual(_.state.poll, null, 'leaving the screen stops the interval');
    assert.strictEqual(_.state.started, false, 're-entering must load fresh');
  });
});

test('sync(true) while already active does not stack a second poll', async () => {
  await withStubbedSeam(async () => {
    screen.sync(true);
    await new Promise((r) => setImmediate(r));
    const first = _.state.poll;
    screen.sync(true);
    screen.sync(true);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(_.state.poll, first, 'the interval is created once, not per render');
  });
});

test('sync is inert in fixture mode', async () => {
  const realLocation = global.location;
  global.location = { search: '?fixture=1' };
  try {
    await withStubbedSeam(async () => {
      screen.sync(true);
      await new Promise((r) => setImmediate(r));
      assert.strictEqual(_.state.poll, null, 'fixture mode never polls');
      assert.strictEqual(_.state.started, false);
    });
  } finally {
    if (realLocation === undefined) delete global.location; else global.location = realLocation;
  }
});
