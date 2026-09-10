// /api/goals — the deck's window onto the 🥅 goalkeeper's git jail.
//
// Two rules are the point of this file. The route is loopback only: the goalkeeper seat is
// isolated by design, so no box worker or coordinator on the tailnet may read or write it.
// And every write goes through goalkeeper.py --by operator, never through a file write here,
// because the jail is a git working tree the seat commits into.
//
// The write cases run only when the CLI has its goals command (it lands in a parallel slice);
// until then they skip with that reason rather than stubbing a fake CLI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { tmpdir, hostsFile, load, unload, ROOT } = require('./helpers');

const CLI = path.join(ROOT, 'mac', 'claude-home', 'skills', 'goalkeeper', 'goalkeeper.py');
const HAS_CLI = fs.existsSync(CLI) && /def cmd_goals/.test(fs.readFileSync(CLI, 'utf8'));
const NO_CLI = HAS_CLI ? false : 'goalkeeper.py has no goals command yet';

// Sibling worktrees run this file at the same time, so the band is per process.
let port = 22000 + Math.floor(Math.random() * 15000);

const THREAD = `# The red thread

Preamble above the first header is not a direction and must never be parsed as one.

### T-2026-09-10-1 · Thu 2026-09-10 · week · alpha

the enrollment is still buggy, partners keep telling us
`;

// A jail with the shape goalkeeper.py leaves behind: a git repo, projects.json, thread.md.
// No goals.json — that is the normal state before the first goal, not an error.
function seedHome(tag = 'gk') {
  const home = tmpdir(tag);
  fs.writeFileSync(
    path.join(home, 'projects.json'),
    JSON.stringify({ projects: [{ alias: 'alpha', path: '/tmp/alpha' }, { alias: 'beta', path: '/tmp/beta' }] })
  );
  fs.writeFileSync(path.join(home, 'thread.md'), THREAD);
  const git = (...args) => execFileSync('git', ['-C', home, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'goalkeeper@local');
  git('config', 'user.name', 'goalkeeper');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed the jail');
  return home;
}

// One deck per test, on its own port and its own db, pointed at the seeded jail. ssh is the
// fake one: this route never uses it, but a real ssh out to the fleet would both reach the
// operator's machines and keep the test process alive.
function deck(t, home, py = CLI) {
  const dir = tmpdir('goals');
  const PORT = port++;
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: {}, calls: [] }));
  const m = load(
    {
      PORT,
      FLEET_DB: path.join(dir, 'fleet.db'),
      FLEET_HOSTS_FILE: hostsFile(dir),
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: state,
      GOALKEEPER_HOME: home,
      GOALKEEPER_PY: py,
    },
    { listen: true }
  );
  t.after(() => unload(m));
  const base = 'http://127.0.0.1:' + PORT;
  const read = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
  return {
    m,
    origin: 'http://127.0.0.1:' + PORT,
    get: () => fetch(base + '/api/goals').then(read),
    post: (b, headers = {}) =>
      fetch(base + '/api/goals', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(b),
      }).then(read),
  };
}

// The tailnet listener binds a second loopback address that only the operator's machine has
// as an lo0 alias, so it is driven as a handler here: what is under test is the routing
// table, not the socket.
function tailnetGet(m, p) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      writeHead(code) { this.statusCode = code; },
      end(data) { resolve({ status: this.statusCode, text: data || '' }); },
    };
    m.tailnetHandler({ method: 'GET', url: p, headers: { host: process.env.FLEET_TAILNET_HOST } }, res);
  });
}

// --- read

test('GET returns the thread, the projects and the jail commit; no goals.json is no goals', async (t) => {
  const d = deck(t, seedHome());
  const { status, body } = await d.get();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.projects, ['alpha', 'beta']);
  assert.equal(body.thread.length, 1, 'the preamble is not a thread entry');
  assert.deepEqual(body.thread[0], {
    id: 'T-2026-09-10-1',
    date: 'Thu 2026-09-10',
    horizon: 'week',
    project: 'alpha',
    text: 'the enrollment is still buggy, partners keep telling us',
  });
  assert.deepEqual(body.goals, []);
  assert.equal(body.updated, null);
  assert.equal(body.audit, null, 'no audits/ directory yet');
  assert.deepEqual(body.warnings, [], 'a missing goals.json is normal, not a warning');
  assert.ok(body.git && body.git.sha, 'the jail commit is the freshness proof');
  assert.equal(body.git.author, 'goalkeeper@local');
  assert.equal(body.git.subject, 'seed the jail');
});

test('GET reads the newest audit: the head above the first --- and the relay lines', async (t) => {
  const home = seedHome();
  fs.mkdirSync(path.join(home, 'audits'));
  fs.writeFileSync(path.join(home, 'audits', '2026-09-08.md'), 'older\n');
  fs.writeFileSync(
    path.join(home, 'audits', '2026-09-09.md'),
    'summary line\n**Verdict:** the enrollment lane is stalled\nrelay this to the lowcapsxyz orchestrator\n---\nbody below the rule\n'
  );
  const { body } = await deck(t, home).get();
  assert.equal(body.audit.date, '2026-09-09', 'the newest audit, not the first');
  assert.equal(body.audit.file, 'audits/2026-09-09.md');
  assert.deepEqual(body.audit.head, ['summary line', '**Verdict:** the enrollment lane is stalled', 'relay this to the lowcapsxyz orchestrator']);
  assert.deepEqual(body.audit.verdicts, [
    '**Verdict:** the enrollment lane is stalled',
    'relay this to the lowcapsxyz orchestrator',
  ]);
});

test('a malformed goals.json still answers 200, with the warning that says so', async (t) => {
  const home = seedHome();
  fs.writeFileSync(path.join(home, 'goals.json'), '{ this is not json');
  const { status, body } = await deck(t, home).get();
  assert.equal(status, 200);
  assert.deepEqual(body.goals, []);
  assert.deepEqual(body.warnings, ['goals.json malformed']);
});

test('a missing goalkeeper home is 503, and it names the path it looked in', async (t) => {
  const home = path.join(tmpdir('goals-gone'), 'not-there');
  const { status, body } = await deck(t, home).get();
  assert.equal(status, 503);
  assert.deepEqual(body, { ok: false, error: 'goalkeeper home not found', home });
});

test('the tailnet listener has no /api/goals at all', async (t) => {
  const d = deck(t, seedHome());
  assert.equal((await d.get()).status, 200, 'the same deck answers on loopback');
  const r = await tailnetGet(d.m, '/api/goals');
  assert.equal(r.status, 404, 'a box worker on the tailnet must not reach the goalkeeper jail');
});

// --- the browser-only write gate

test('POST without an Origin is forbidden', async (t) => {
  const d = deck(t, seedHome());
  const r = await d.post({ op: 'thread.add', text: 'x', horizon: 'week', project: 'alpha' });
  assert.equal(r.status, 403, 'a curl or a seat carries no Origin and must be rejected');
});

test('POST from a foreign Origin is forbidden', async (t) => {
  const d = deck(t, seedHome());
  const r = await d.post(
    { op: 'thread.add', text: 'x', horizon: 'week', project: 'alpha' },
    { origin: 'http://evil.example' }
  );
  assert.equal(r.status, 403);
});

// --- validation, before anything is spawned

test('every write field is validated before goalkeeper.py is ever run', async (t) => {
  const home = seedHome();
  const d = deck(t, home);
  const bad = (b) => d.post(b, { origin: d.origin });
  const cases = [
    [{ op: 'nope' }, 'unknown op'],
    [{ op: 'thread.add', text: '', horizon: 'week', project: 'alpha' }, /text must be/],
    [{ op: 'thread.add', text: 'x'.repeat(4001), horizon: 'week', project: 'alpha' }, /text must be/],
    [{ op: 'thread.add', text: 'x', horizon: 'month', project: 'alpha' }, /horizon must be/],
    [{ op: 'thread.add', text: 'x', horizon: 'week', project: 'gamma' }, /project must be/],
    [{ op: 'goal.add', text: 'x', horizon: 'day', project: 'alpha', thread: 'T-nope' }, /thread must be/],
    [{ op: 'goal.add', text: 'x', horizon: 'day', project: 'alpha', refs: ['ok', 'not ok'] }, /refs must be/],
    // A ref that starts with `-` would reach argparse as a flag: it is a 400 here, not a 502 there.
    [{ op: 'goal.add', text: 'x', horizon: 'day', project: 'alpha', refs: ['-oops'] }, /refs must be/],
    [{ op: 'goal.set', id: 'GK-1', refs: ['-oops'] }, /refs must be/],
    [{ op: 'goal.add', text: 'x', horizon: 'day', project: 'alpha', refs: new Array(21).fill('a') }, /refs must be/],
    [{ op: 'goal.set', id: 'nope', status: 'done' }, /id must look like/],
    [{ op: 'goal.set', id: 'GK-1' }, /at least one of/],
    [{ op: 'goal.set', id: 'GK-1', status: 'finished' }, /status must be/],
    [{ op: 'goal.set', id: 'GK-1', state: 'x'.repeat(2001) }, /state must be/],
    [{ op: 'goal.note', id: 'GK-1', text: '' }, /text must be/],
  ];
  for (const [b, expected] of cases) {
    const r = await bad(b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(r.body.ok, false);
    if (typeof expected === 'string') assert.equal(r.body.error, expected);
    else assert.match(r.body.error, expected, JSON.stringify(b));
  }
  // Nothing ran: a rejected body never reaches the CLI, so the jail is byte-for-byte untouched.
  assert.equal(execFileSync('git', ['-C', home, 'status', '--porcelain'], { encoding: 'utf8' }), '');
});

// --- the writes themselves, through the CLI

test('thread.add appends a direction and commits it as the operator', { skip: NO_CLI }, async (t) => {
  const home = seedHome();
  const d = deck(t, home);
  const r = await d.post(
    { op: 'thread.add', text: 'the websocket has to survive a restart', horizon: 'week', project: 'beta' },
    { origin: d.origin }
  );
  assert.equal(r.status, 200);
  assert.match(r.body.id, /^T-\d{4}-\d{2}-\d{2}-\d{1,3}$/);
  assert.equal(r.body.thread.length, 2, 'the response is the fresh view, not just the id');
  assert.equal(r.body.thread[1].text, 'the websocket has to survive a restart');
  const author = execFileSync('git', ['-C', home, 'log', '-1', '--format=%ae'], { encoding: 'utf8' }).trim();
  assert.equal(author, 'operator@local', 'the deck writes as the operator, never as the goalkeeper');
});

test('goal.add, goal.set and goal.note walk one goal through its life', { skip: NO_CLI }, async (t) => {
  const d = deck(t, seedHome());
  const o = { origin: d.origin };
  const added = await d.post(
    { op: 'goal.add', text: 'fix the enrollment bugs', project: 'alpha', horizon: 'week', thread: 'T-2026-09-10-1', refs: ['G19'] },
    o
  );
  assert.equal(added.status, 200);
  assert.equal(added.body.id, 'GK-1');
  assert.equal(added.body.goals.length, 1);
  assert.equal(added.body.goals[0].status, 'open');
  assert.equal(added.body.goals[0].thread, 'T-2026-09-10-1');
  assert.deepEqual(added.body.goals[0].refs, ['G19']);

  const set = await d.post({ op: 'goal.set', id: 'GK-1', status: 'done', state: 'partners stopped reporting it' }, o);
  assert.equal(set.status, 200);
  assert.equal(set.body.goals[0].status, 'done');
  assert.equal(set.body.goals[0].state, 'partners stopped reporting it');

  const noted = await d.post({ op: 'goal.note', id: 'GK-1', text: 'verified on staging' }, o);
  assert.equal(noted.status, 200);
  assert.equal(noted.body.goals[0].notes.length, 1);
  assert.equal(noted.body.goals[0].notes[0].by, 'operator');
});

// Every option goes to goalkeeper.py as --opt=value, so a value that starts with `-` is a
// value and never a flag; `--thread=` with nothing after it is how the deck clears the link.
test('option values are passed as --opt=value, and an empty thread clears it', async (t) => {
  const dir = tmpdir('goals-argv');
  const seen = path.join(dir, 'argv.json');
  const py = path.join(dir, 'fake.py');
  fs.writeFileSync(py, 'import json, sys\njson.dump(sys.argv[1:], open(%s, "w"))\n'.replace('%s', JSON.stringify(seen)));
  const d = deck(t, seedHome(), py);
  const argv = async (b) => {
    assert.equal((await d.post(b, { origin: d.origin })).status, 200);
    return JSON.parse(fs.readFileSync(seen, 'utf8'));
  };
  assert.deepEqual(await argv({ op: 'goal.set', id: 'GK-1', thread: '' }),
    ['goals', 'set', 'GK-1', '--thread=', '--by=operator']);
  assert.deepEqual(await argv({ op: 'goal.set', id: 'GK-1', thread: null }),
    ['goals', 'set', 'GK-1', '--thread=', '--by=operator']);
  assert.deepEqual(await argv({ op: 'goal.set', id: 'GK-1', status: 'done', state: '-fixed', refs: [] }),
    ['goals', 'set', 'GK-1', '--status=done', '--state=-fixed', '--refs=', '--by=operator']);
  assert.deepEqual(await argv({ op: 'goal.add', text: '-a goal', project: 'alpha', horizon: 'day', thread: 'T-2026-09-10-1', refs: ['G19'] }),
    ['goals', 'add', '--project=alpha', '--horizon=day', '--thread=T-2026-09-10-1', '--refs=G19', '--by=operator', '--', '-a goal']);
  assert.deepEqual(await argv({ op: 'thread.add', text: '-a direction', horizon: 'week', project: 'beta' }),
    ['thread', 'add', '--horizon=week', '--project=beta', '--by=operator', '--', '-a direction']);
  assert.deepEqual(await argv({ op: 'goal.note', id: 'GK-1', text: '-a note' }),
    ['goals', 'note', 'GK-1', '--by=operator', '--', '-a note']);
});

test('a state that starts with a dash reaches the goal, not argparse', { skip: NO_CLI }, async (t) => {
  const d = deck(t, seedHome());
  const o = { origin: d.origin };
  await d.post({ op: 'goal.add', text: 'a goal', project: 'alpha', horizon: 'day' }, o);
  const r = await d.post({ op: 'goal.set', id: 'GK-1', state: '-fixed', refs: ['-oops'] }, o);
  assert.equal(r.status, 400, 'the ref is rejected before anything is spawned');
  const ok = await d.post({ op: 'goal.set', id: 'GK-1', state: '-fixed' }, o);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.goals[0].state, '-fixed');
});

test('a CLI failure is a 502 carrying its stderr, not a 500', { skip: NO_CLI }, async (t) => {
  const d = deck(t, seedHome());
  const r = await d.post({ op: 'goal.note', id: 'GK-999', text: 'no such goal' }, { origin: d.origin });
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.ok(r.body.error.length > 0 && r.body.error.length <= 300);
});
