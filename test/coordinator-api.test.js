// /api/coordinator/* — the portal's read view over coordinator/ plus its one write, the inbox
// drop. Every case here runs against a fixture state dir (FLEET_COORDINATOR_DIR) on a throwaway
// server, so no test can read or move the operator's real board.
//
// The load-bearing test is the stale-snapshot pair. `board["exceptions"]` is a snapshot a past run
// wrote for audit; serving it would let a lane that went overdue since that run report as healthy —
// silence reading as health, the exact failure the coordinator exists to prevent. So the fixture
// plants a snapshot that is wrong in both directions (it invents an exception and omits a real one)
// and the tests assert the API agrees with neither half of it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('./helpers');
const { startServer } = require('./http');

const GHOST = 'EX-overdue-lane-GHOST'; // in the snapshot, true of nothing
const LIVE = 'EX-overdue-lane-L1'; // true of the board, absent from the snapshot

function board() {
  return {
    schema_version: 2,
    note: 'fixture',
    northstar: {
      text: 'Fixture northstar: the deck serves coordinator state over HTTP.',
      ruling_id: 'R-FIXTURE',
      confirmed_at: '2026-08-01T00:00:00Z',
    },
    lane_cap: 6,
    policy: { default_cadence_hours: 24, unattested_done_days: 3, queue_item_days: 3 },
    lanes: [
      {
        id: 'L1',
        goal: 'fixture lane that is overdue, so there is a live exception to find.',
        done_milestone: 'ships: the fixture asserts.',
        owner: 'Kendra (backend-developer, agent-kendra)',
        state: 'active',
        blockers: ['none'],
        next_decision: 'operator: nothing',
        reported_at: '2026-08-01T00:00:00Z',
        verified_at: null,
        evidence: ['git:df6de67'],
        next_report_due: '2026-08-02T00:00:00Z', // long past — L1 is overdue
      },
      {
        id: 'L4',
        goal: 'fixture lane that is closed, so it owes nothing.',
        done_milestone: 'ships: closed lanes raise no exception.',
        owner: 'nobody',
        state: 'closed',
        blockers: [],
        next_decision: 'none',
        reported_at: '2026-08-01T00:00:00Z',
        verified_at: '2026-08-01T00:00:00Z',
        evidence: [],
        next_report_due: null,
      },
    ],
    operator_queue: [],
    effective_decisions_ref: 'coordinator/decisions-effective.md',
    // The lie under test: invents GHOST, and does not know about L1.
    exceptions: [
      {
        id: GHOST,
        kind: 'overdue-lane',
        subject: 'GHOST',
        since: '2026-08-01T00:00:00Z',
        age_seconds: 1,
        age: '1s',
        detail: 'lane GHOST is a stale snapshot entry that must never be served',
      },
    ],
  };
}

const NORTHSTAR = '# Northstar\n\nFixture northstar body.\n';
const DECISIONS = '# Effective decisions\n\n| id | decision |\n| D-1 | fixture decision |\n';

// A fixture state dir: the three bundle files plus an inbox holding one pending sitrep and the
// two subdirectories a listing must skip.
function stateDir(mutate) {
  const dir = path.join(tmpdir('coordinator'), 'state');
  fs.mkdirSync(path.join(dir, 'inbox', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'inbox', 'rejected'), { recursive: true });
  const b = board();
  if (mutate) mutate(b);
  fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify(b, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'northstar.md'), NORTHSTAR);
  fs.writeFileSync(path.join(dir, 'decisions-effective.md'), DECISIONS);
  fs.writeFileSync(
    path.join(dir, 'inbox', 'README.md'),
    'not a sitrep — the listing must skip it\n'
  );
  fs.writeFileSync(
    path.join(dir, 'inbox', '2026-08-28T18:40:00Z-o31-L1.md'),
    'seat:        o31 (orchestrator)\nlane:        L1\nevent:       lane opened\n'
  );
  fs.writeFileSync(path.join(dir, 'inbox', 'archive', 'old.md'), 'archived\n');
  fs.writeFileSync(path.join(dir, 'inbox', 'rejected', 'bad.md'), 'rejected\n');
  return dir;
}

async function deck(t, mutate) {
  const dir = stateDir(mutate);
  const s = await startServer({ FLEET_COORDINATOR_DIR: dir });
  t.after(() => s.stop());
  s.state = dir;
  s.inbox = () =>
    fs.readdirSync(path.join(dir, 'inbox')).filter((f) => f.endsWith('.md') && f !== 'README.md');
  s.boardBytes = () => fs.readFileSync(path.join(dir, 'board.json'), 'utf8');
  return s;
}

// A sitrep the strict parser accepts: every required key, valid state, ISO times.
const VALID = {
  seat: 'o31 (orchestrator)',
  lane: 'L1',
  event: 'blocker cleared',
  event_time: '2026-08-29T12:00:00Z',
  state: 'active',
  delta: 'the gate suite went green.',
  blockers: [],
  next_report: '2026-08-30T12:00:00Z',
};

test('GET /board serves the stored board verbatim', async (t) => {
  const s = await deck(t);
  const r = await s.get('/api/coordinator/board');
  assert.equal(r.status, 200);
  assert.equal(r.body.schema_version, 2);
  assert.deepEqual(
    r.body.lanes.map((l) => l.id),
    ['L1', 'L4']
  );
});

test('GET /exceptions is computed live — the snapshot is served in neither direction', async (t) => {
  const s = await deck(t);
  const r = await s.get('/api/coordinator/exceptions');
  assert.equal(r.status, 200);
  const ids = r.body.map((e) => e.id);
  assert.ok(ids.includes(LIVE), 'a real overdue lane the snapshot omits must still surface');
  assert.ok(!ids.includes(GHOST), 'a stale snapshot entry must never be resurrected');
});

test('GET /exceptions leaves the board alone — it never runs --apply', async (t) => {
  const s = await deck(t);
  const before = s.boardBytes();
  await s.get('/api/coordinator/exceptions');
  assert.equal(s.boardBytes(), before, 'a read must not write the snapshot back');
});

test('GET /bundle renders live exceptions, not the snapshot', async (t) => {
  const s = await deck(t);
  const r = await s.get('/api/coordinator/bundle');
  assert.equal(r.status, 200);
  assert.match(r.text, /Fixture northstar/);
  assert.ok(r.text.includes(LIVE), 'the live exception must render');
  assert.ok(!r.text.includes(GHOST), 'the snapshot entry must not render');
});

test('GET /gate measures the bundle it actually served', async (t) => {
  const s = await deck(t);
  const bundle = await s.get('/api/coordinator/bundle');
  const g = await s.get('/api/coordinator/gate');
  assert.equal(g.status, 200);
  assert.equal(g.body.size, Buffer.byteLength(bundle.text));
  assert.equal(typeof g.body.headroom, 'number');
  assert.equal(typeof g.body.pct, 'number');
});

test('GET /northstar and /decisions serve the raw markdown', async (t) => {
  const s = await deck(t);
  assert.equal((await s.get('/api/coordinator/northstar')).text, NORTHSTAR);
  assert.equal((await s.get('/api/coordinator/decisions')).text, DECISIONS);
});

test('GET /inbox lists pending sitreps and skips README, archive and rejected', async (t) => {
  const s = await deck(t);
  const r = await s.get('/api/coordinator/inbox');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.pending.map((e) => e.name),
    ['2026-08-28T18:40:00Z-o31-L1.md']
  );
  const [only] = r.body.pending;
  assert.equal(only.lane, 'L1');
  assert.equal(only.event, 'lane opened');
  assert.match(only.seat, /^o31/);
});

test('an unknown coordinator path is 404, not a silent 200', async (t) => {
  const s = await deck(t);
  assert.equal((await s.get('/api/coordinator/nope')).status, 404);
});

test('POST /sitrep writes exactly one file the strict schema accepts', async (t) => {
  const s = await deck(t);
  const before = s.inbox();
  const r = await s.post('/api/coordinator/sitrep', VALID);
  assert.equal(r.status, 201);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.file, '2026-08-29T12:00:00Z-o31-L1.md');

  const after = s.inbox();
  assert.equal(after.length, before.length + 1, 'exactly one file');

  const text = fs.readFileSync(path.join(s.state, 'inbox', r.body.file), 'utf8');
  for (const key of ['seat', 'lane', 'event', 'event_time', 'state', 'blockers', 'next_report'])
    assert.match(text, new RegExp('^' + key + ':\\s', 'm'), 'required key ' + key + ' is written');
  assert.match(text, /^blockers:\s+none$/m, 'an empty blocker list still renders a full line');
  assert.ok(text.endsWith('\n'));
});

test('POST /sitrep never touches board.json', async (t) => {
  const s = await deck(t);
  const before = s.boardBytes();
  await s.post('/api/coordinator/sitrep', VALID);
  assert.equal(s.boardBytes(), before, 'the board moves only by a coordinator run commit');
});

test('POST /sitrep refuses to overwrite an existing sitrep', async (t) => {
  const s = await deck(t);
  assert.equal((await s.post('/api/coordinator/sitrep', VALID)).status, 201);
  const again = await s.post('/api/coordinator/sitrep', VALID);
  assert.equal(again.status, 409);
  assert.equal(again.body.ok, false);
});

// Reject, never best-effort parse (DESIGN §3): every one of these must land nothing on disk.
const INVALID = [
  ['missing a required key', (p) => delete p.lane],
  ['a blank required key', (p) => (p.event = '   ')],
  ['an unknown key', (p) => (p.priority = 'urgent')],
  ['a state outside the enum', (p) => (p.state = 'done')],
  ['a non-ISO event_time', (p) => (p.event_time = 'yesterday')],
  ['a non-ISO next_report', (p) => (p.next_report = 'soon')],
  ['done-claimed with no evidence', (p) => (p.state = 'done-claimed')],
  ['blockers of the wrong type', (p) => (p.blockers = { a: 1 })],
  ['a lane that would escape the inbox', (p) => (p.lane = '../../L1')],
  ['a seat id that would escape the inbox', (p) => (p.seat = '../../o31')],
];

for (const [label, corrupt] of INVALID) {
  test('POST /sitrep rejects ' + label + ' and writes nothing', async (t) => {
    const s = await deck(t);
    const before = s.inbox();
    const payload = JSON.parse(JSON.stringify(VALID));
    corrupt(payload);
    const r = await s.post('/api/coordinator/sitrep', payload);
    assert.equal(r.status, 400, label + ' must be a 400');
    assert.equal(r.body.ok, false);
    assert.equal(typeof r.body.error, 'string');
    assert.ok(r.body.error.length > 0 && !r.body.error.includes('\n'), 'one line of reason');
    assert.deepEqual(s.inbox(), before, 'nothing written');
  });
}

// The file is a flat `key: value` block, so a line break inside a single-line value would write a
// second line at column 0 that a per-line parser reads as a field the seat never sent.
test('POST /sitrep refuses a forged header line hidden in a value', async (t) => {
  const s = await deck(t);
  const before = s.inbox();
  const r = await s.post('/api/coordinator/sitrep', {
    ...VALID,
    blockers: 'ok\nstate: closed\nnext_report: 1999-01-01T00:00:00Z',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /line break/);
  assert.deepEqual(s.inbox(), before, 'nothing written');
});

test('POST /sitrep refuses a line break in a blockers entry', async (t) => {
  const s = await deck(t);
  const r = await s.post('/api/coordinator/sitrep', {
    ...VALID,
    blockers: ['fine', 'ok\nstate: closed'],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /line break/);
});

// Second line of defence: even if a multi-line value is legitimate, no continuation may begin a
// line at column 0, or it would read as a header.
test('a multi-line delta indents every continuation past the key column', async (t) => {
  const s = await deck(t);
  const r = await s.post('/api/coordinator/sitrep', {
    ...VALID,
    delta: 'first line\nstate: closed',
  });
  assert.equal(r.status, 201);
  const text = fs.readFileSync(path.join(s.state, 'inbox', r.body.file), 'utf8');
  assert.ok(!/^state: closed$/m.test(text), 'a continuation must not sit at column 0');
  assert.match(text, /^ {13}state: closed$/m);
  assert.equal(text.match(/^state:/m)[0], 'state:', 'the real state line is still the only one');
});

// The event_time leads the filename and the drain reads that order as chronological order, which
// an offset stamp breaks silently: 23:00+05:00 happened before 20:00Z but sorts after it.
test('POST /sitrep refuses a non-UTC event_time', async (t) => {
  const s = await deck(t);
  for (const event_time of ['2026-08-29T23:00:00+05:00', '2026-08-29T12:00:00']) {
    const r = await s.post('/api/coordinator/sitrep', { ...VALID, event_time });
    assert.equal(r.status, 400, event_time);
    assert.match(r.body.error, /event_time must be UTC ISO-8601/);
  }
});

// The filename sort is a plain string compare, so every accepted stamp must be the same width:
// '...T12:00Z' and '...T12:00:01Z' are one second apart and sort the wrong way round.
test('POST /sitrep takes one timestamp form and no other', async (t) => {
  const s = await deck(t);
  for (const event_time of ['2026-08-29T12:00Z', '2026-08-29T12:00:00.500Z', '2026-08-29T12:00:00'])
    assert.equal(
      (await s.post('/api/coordinator/sitrep', { ...VALID, event_time })).status,
      400,
      event_time
    );
  assert.equal((await s.post('/api/coordinator/sitrep', VALID)).status, 201);
});

test('a rejection reason stays one line even when it quotes the caller', async (t) => {
  const s = await deck(t);
  const r = await s.post('/api/coordinator/sitrep', { ...VALID, 'x\ny': 'z' });
  assert.equal(r.status, 400);
  assert.ok(!r.body.error.includes('\n'), 'reason was: ' + JSON.stringify(r.body.error));
});

test('POST /sitrep refuses a field that is not prose or a list of prose', async (t) => {
  const s = await deck(t);
  for (const payload of [
    { ...VALID, evidence: { link: 'git:abc' } },
    { ...VALID, ruled_out: [['nested']] },
    { ...VALID, event: 42 },
  ]) {
    const r = await s.post('/api/coordinator/sitrep', payload);
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  }
});

test('POST /sitrep accepts done-claimed once evidence is there', async (t) => {
  const s = await deck(t);
  const r = await s.post('/api/coordinator/sitrep', {
    ...VALID,
    state: 'done-claimed',
    evidence: ['git:df6de67'],
  });
  assert.equal(r.status, 201);
  const text = fs.readFileSync(path.join(s.state, 'inbox', r.body.file), 'utf8');
  assert.match(text, /^evidence:\s+git:df6de67$/m);
});

test('a sitrep from a foreign origin is forbidden, and GET stays open', async (t) => {
  const s = await deck(t);
  const r = await s.post('/api/coordinator/sitrep', VALID, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  assert.deepEqual(s.inbox().length, 1, 'only the fixture sitrep');
  assert.equal((await s.get('/api/coordinator/board')).status, 200);
});

test('the read routes refuse to be written to', async (t) => {
  const s = await deck(t);
  for (const p of ['board', 'bundle', 'exceptions', 'northstar', 'decisions', 'gate', 'inbox'])
    assert.equal((await s.post('/api/coordinator/' + p, {})).status, 405, p + ' is read-only');
});

// The whole reason for the API is a portal session that has neither the repo nor the Mac, so the
// routes have to answer on the tailnet listener too — with that listener's own posture, which
// already gates every POST on the shared key.
test('the coordinator routes answer on the tailnet listener as well', async (t) => {
  const s = await deck(t);
  const board = await s.tailGet('/api/coordinator/board');
  assert.equal(board.status, 200);
  assert.equal(board.body.schema_version, 2);

  const ex = await s.tailGet('/api/coordinator/exceptions');
  assert.equal(ex.status, 200);
  assert.ok(ex.body.map((e) => e.id).includes(LIVE));

  const post = await s.tailPost('/api/coordinator/sitrep', VALID);
  assert.equal(post.status, 201);
});

test('a tailnet sitrep needs the shared key once it is armed', async (t) => {
  const dir = stateDir();
  const s = await startServer({ FLEET_COORDINATOR_DIR: dir, FLEET_TAILNET_KEY: 'shhh' });
  t.after(() => s.stop());
  const pending = () =>
    fs.readdirSync(path.join(dir, 'inbox')).filter((f) => f.endsWith('.md') && f !== 'README.md');

  assert.equal((await s.tailPost('/api/coordinator/sitrep', VALID)).status, 401);
  assert.equal(pending().length, 1, 'an unauthorised drop writes nothing');
  const ok = await s.tailPost('/api/coordinator/sitrep', VALID, { authorization: 'Bearer shhh' });
  assert.equal(ok.status, 201);
});

test('an ISO stamp with a space is refused — the event_time becomes the filename', async (t) => {
  const s = await deck(t);
  const r = await s.post('/api/coordinator/sitrep', {
    ...VALID,
    event_time: '2026-08-29 12:00:00Z',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /event_time must be UTC ISO-8601/);
});

// A GET is unauthenticated on both listeners, so a board Python refuses must not hand the caller a
// traceback or this box's layout. The coordinator scripts guard a malformed board well enough that
// only a wrong top-level type reaches their FAIL path, which is the case exercised here.
test('a board Python refuses is a 500 that names no path of ours', async (t) => {
  const dir = stateDir();
  fs.writeFileSync(path.join(dir, 'board.json'), '[1, 2, 3]\n');
  const s = await startServer({ FLEET_COORDINATOR_DIR: dir });
  t.after(() => s.stop());

  for (const route of ['exceptions', 'bundle', 'gate']) {
    const r = await s.get('/api/coordinator/' + route);
    assert.equal(r.status, 500, route);
    assert.match(r.body.error, /must be a JSON object/, route + ' still says what was wrong');
    assert.ok(!/Traceback/.test(r.text), route + ' leaked a traceback');
    assert.ok(!/\/(home|tmp)\//.test(r.text), route + ' leaked an absolute path: ' + r.text);
  }
  // /board parses in JS, so it has its own answer for the same board.
  const b = await s.get('/api/coordinator/board');
  assert.equal(b.status, 200, 'a JSON array is still valid JSON');
});

// The other half of the same guarantee: when the script never manages a FAIL: line of its own —
// it timed out, it is missing, something threw — the fallback must not fall back to execFile's
// err.message, which is "Command failed: <the whole argv>" followed by raw stderr.
test('a python that dies without a FAIL: line still leaks nothing', async (t) => {
  const dir = stateDir();
  const fake = path.join(dir, 'fake-python');
  fs.writeFileSync(
    fake,
    '#!/bin/sh\necho "Traceback (most recent call last):" >&2\n' +
      'echo "  File \\"/home/vibe/secret/path.py\\", line 42, in main" >&2\nexit 3\n'
  );
  fs.chmodSync(fake, 0o755);
  const s = await startServer({ FLEET_COORDINATOR_DIR: dir, FLEET_PYTHON_BIN: fake });
  t.after(() => s.stop());

  for (const route of ['exceptions', 'bundle', 'gate']) {
    const r = await s.get('/api/coordinator/' + route);
    assert.equal(r.status, 500, route);
    assert.ok(!/Traceback/.test(r.text), route + ' leaked a traceback: ' + r.text);
    assert.ok(!/\/home\//.test(r.text), route + ' leaked an absolute path: ' + r.text);
    assert.ok(!/Command failed/.test(r.text), route + ' leaked the argv: ' + r.text);
    assert.match(r.body.error, /exited 3/, route + ' still says what happened');
  }
});

test('a missing state dir is a 404, not a 500 or a stack', async (t) => {
  const s = await startServer({ FLEET_COORDINATOR_DIR: path.join(tmpdir('coordinator'), 'gone') });
  t.after(() => s.stop());
  const r = await s.get('/api/coordinator/board');
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
  assert.ok(!/\n\s+at /.test(r.text), 'no stack leaks to the caller');
});
