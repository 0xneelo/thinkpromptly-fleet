// XYZ-1898 M2 — this checkout is the coordinator VENDOR, not a coordinator instance. Before this
// milestone the API defaulted to `coordinator/` in the checkout, so a deck with nothing configured
// served the vendor's own frozen dev fixture to any caller as if it were a real board. The load-
// bearing test here is the first one: an unconfigured deck answers 503 and the fixture's own bytes
// never appear in any response.
//
// The rest pins the registry the default was replaced with: named instances selected per request by
// query parameter, so every route stays the exact string it already was. The instance name is
// untrusted input and is only ever a key into that map — never a path — which is what the traversal
// cases assert.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('./helpers');
const { startServer } = require('./http');

// The vendor fixture that must never be served, and a string only it contains.
const VENDOR_DIR = path.join(__dirname, '..', 'coordinator');
const VENDOR_MARK = 'Written only by a coordinator run';

// Empty rather than absent: startServer passes the whole ambient environment to the child, so a
// deck is only unconfigured if these are explicitly cleared.
const NONE = { FLEET_COORDINATOR_DIR: '', FLEET_COORDINATOR_INSTANCES: '' };

const BOARD_ROUTES = ['board', 'northstar', 'decisions', 'inbox', 'bundle', 'exceptions', 'gate'];

// A board root whose every file names its instance, so a response can only have come from one of
// them. Same schema as the coordinator-api fixture: the Python reads these too.
function instanceDir(mark) {
  const dir = path.join(tmpdir('instance-' + mark), 'state');
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'board.json'),
    JSON.stringify(
      {
        schema_version: 2,
        note: 'fixture-' + mark,
        northstar: {
          text: 'northstar-' + mark,
          ruling_id: 'R-' + mark,
          confirmed_at: '2026-08-01T00:00:00Z',
        },
        lane_cap: 6,
        policy: { default_cadence_hours: 24, unattested_done_days: 3, queue_item_days: 3 },
        lanes: [
          {
            id: 'L-' + mark,
            goal: 'the lane of instance ' + mark + '.',
            done_milestone: 'ships: instance ' + mark + ' is served.',
            owner: 'nobody',
            state: 'active',
            blockers: ['none'],
            next_decision: 'operator: nothing',
            reported_at: '2026-08-01T00:00:00Z',
            verified_at: null,
            evidence: [],
            next_report_due: '2026-09-30T00:00:00Z',
          },
        ],
        operator_queue: [],
        effective_decisions_ref: 'coordinator/decisions-effective.md',
        exceptions: [],
      },
      null,
      2
    ) + '\n'
  );
  fs.writeFileSync(path.join(dir, 'northstar.md'), '# Northstar\n\nnorthstar-' + mark + '\n');
  fs.writeFileSync(path.join(dir, 'decisions-effective.md'), '# Decisions\n\ndecisions-' + mark + '\n');
  fs.writeFileSync(path.join(dir, 'inbox', 'README.md'), 'not a sitrep\n');
  fs.writeFileSync(
    path.join(dir, 'inbox', '2026-08-28T18:40:00Z-o31-L-' + mark + '.md'),
    'seat:        o31 (orchestrator)\nlane:        L-' + mark + '\nevent:       opened\n'
  );
  return dir;
}

const pending = (dir) =>
  fs.readdirSync(path.join(dir, 'inbox')).filter((f) => f.endsWith('.md') && f !== 'README.md');

const VALID = {
  seat: 'o31 (orchestrator)',
  lane: 'L1',
  event: 'blocker cleared',
  event_time: '2026-08-29T12:00:00Z',
  state: 'active',
  blockers: [],
  next_report: '2026-08-30T12:00:00Z',
};

// --- 1. the regression this milestone exists to prevent --------------------

test('an unconfigured deck serves no board at all — 503, never the vendor fixture', async (t) => {
  const s = await startServer({ ...NONE });
  t.after(() => s.stop());

  // The fixture is really there, so "not returned" below is a fact about the deck, not about a
  // missing file.
  assert.match(fs.readFileSync(path.join(VENDOR_DIR, 'board.json'), 'utf8'), /Written only by/);

  for (const route of BOARD_ROUTES) {
    const r = await s.get('/api/coordinator/' + route);
    assert.equal(r.status, 503, route + ': ' + r.text);
    assert.equal(r.body.ok, false, route);
    assert.equal(r.body.error, 'no coordinator instance configured', route);
    assert.ok(!r.text.includes(VENDOR_MARK), route + ' served the vendor fixture: ' + r.text);
  }
  // The write surface fails closed the same way: nothing is dropped into the vendor's inbox.
  const post = await s.post('/api/coordinator/sitrep', VALID);
  assert.equal(post.status, 503, post.text);
  const dropped = '2026-08-29T12:00:00Z-o31-L1.md'; // what VALID would have been named
  assert.ok(!fs.existsSync(path.join(VENDOR_DIR, 'inbox', dropped)), 'wrote into the vendor inbox');

  // And the deck itself is up: an unservable board is not a dead process.
  assert.equal((await s.get('/api/health')).status, 200);
  assert.equal((await s.get('/api/coordinator/instances')).status, 200);
});

// --- 2. selection ----------------------------------------------------------

test('two instances: ?instance picks which board is served, on every route', async (t) => {
  const a = instanceDir('a');
  const b = instanceDir('b');
  const s = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ alpha: a, bravo: b }),
  });
  t.after(() => s.stop());

  for (const [name, mark] of [['alpha', 'a'], ['bravo', 'b']]) {
    const q = '?instance=' + name;
    const board = await s.get('/api/coordinator/board' + q);
    assert.equal(board.status, 200, board.text);
    assert.equal(board.body.note, 'fixture-' + mark);

    const north = await s.get('/api/coordinator/northstar' + q);
    assert.match(north.text, new RegExp('northstar-' + mark));

    const dec = await s.get('/api/coordinator/decisions' + q);
    assert.match(dec.text, new RegExp('decisions-' + mark));

    const inbox = await s.get('/api/coordinator/inbox' + q);
    assert.deepEqual(inbox.body.pending.map((e) => e.lane), ['L-' + mark]);

    // The Python is handed the selected board too — the argument travels, the scripts do not.
    const bundle = await s.get('/api/coordinator/bundle' + q);
    assert.equal(bundle.status, 200, bundle.text);
    assert.match(bundle.text, new RegExp('northstar-' + mark));
    assert.ok(!bundle.text.includes('northstar-' + (mark === 'a' ? 'b' : 'a')), 'crossed boards');
  }

  // A write lands in the selected instance's inbox and nowhere else.
  const post = await s.post('/api/coordinator/sitrep?instance=bravo', VALID);
  assert.equal(post.status, 201, post.text);
  assert.equal(pending(b).length, 2);
  assert.equal(pending(a).length, 1);
});

test('the registry may be a file path instead of the JSON itself', async (t) => {
  const a = instanceDir('file-a');
  const file = path.join(tmpdir('registry'), 'instances.json');
  fs.writeFileSync(file, JSON.stringify({ alpha: a }, null, 2) + '\n');
  const s = await startServer({ ...NONE, FLEET_COORDINATOR_INSTANCES: file });
  t.after(() => s.stop());

  const r = await s.get('/api/coordinator/board?instance=alpha');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.note, 'fixture-file-a');
});

test('one configured instance needs no name; two need one', async (t) => {
  const a = instanceDir('sole');
  const sole = await startServer({ ...NONE, FLEET_COORDINATOR_INSTANCES: JSON.stringify({ only: a }) });
  t.after(() => sole.stop());
  const bare = await sole.get('/api/coordinator/board');
  assert.equal(bare.status, 200, bare.text);
  assert.equal(bare.body.note, 'fixture-sole');

  const two = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ only: a, other: instanceDir('other') }),
  });
  t.after(() => two.stop());
  const ambiguous = await two.get('/api/coordinator/board');
  assert.equal(ambiguous.status, 503, ambiguous.text);
  assert.match(ambiguous.body.error, /pass \?instance=/);

  // FLEET_COORDINATOR_DEFAULT_INSTANCE settles it.
  const defaulted = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ only: a, other: instanceDir('other') }),
    FLEET_COORDINATOR_DEFAULT_INSTANCE: 'other',
  });
  t.after(() => defaulted.stop());
  const picked = await defaulted.get('/api/coordinator/board');
  assert.equal(picked.status, 200, picked.text);
  assert.equal(picked.body.note, 'fixture-other');
});

test('a default naming an instance that is not configured fails closed', async (t) => {
  const s = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ only: instanceDir('closed') }),
    FLEET_COORDINATOR_DEFAULT_INSTANCE: 'typo',
  });
  t.after(() => s.stop());
  const r = await s.get('/api/coordinator/board');
  assert.equal(r.status, 503, r.text);
  assert.match(r.body.error, /default coordinator instance is not configured/);
});

// --- 3 & 4. the name is a key, never a path --------------------------------

test('an unknown instance is a 404, and a traversal is just an unknown key', async (t) => {
  const a = instanceDir('guarded');
  const s = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ alpha: a }),
  });
  t.after(() => s.stop());

  const names = [
    'nope',
    '../../etc',
    '..',
    '../alpha',
    'alpha/../../etc',
    '..%2f..%2fetc',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/etc/passwd',
    a, // the real path of a configured instance is still not its name
    path.join(VENDOR_DIR, 'board.json'),
    'alpha ',
  ];
  for (const name of names) {
    for (const route of BOARD_ROUTES) {
      const r = await s.get('/api/coordinator/' + route + '?instance=' + encodeURIComponent(name));
      assert.equal(r.status, 404, route + ' ?instance=' + name + ' -> ' + r.status + ' ' + r.text);
      assert.equal(r.body.error, 'unknown coordinator instance', name);
      // No filesystem probe happened, so nothing about this box can have leaked.
      assert.ok(!/\/(home|tmp|etc)\//.test(r.text), name + ' leaked a path: ' + r.text);
      assert.ok(!/\n\s+at /.test(r.text), name + ' leaked a stack');
    }
  }
  // The one real name still works, so the refusals above are not a broken registry.
  assert.equal((await s.get('/api/coordinator/board?instance=alpha')).status, 200);
});

// --- 5. back-compatibility -------------------------------------------------

test('FLEET_COORDINATOR_DIR alone still serves that board, and names no instance', async (t) => {
  const a = instanceDir('legacy');
  const s = await startServer({ FLEET_COORDINATOR_INSTANCES: '', FLEET_COORDINATOR_DIR: a });
  t.after(() => s.stop());

  const board = await s.get('/api/coordinator/board');
  assert.equal(board.status, 200, board.text);
  assert.equal(board.body.note, 'fixture-legacy');
  assert.equal((await s.post('/api/coordinator/sitrep', VALID)).status, 201);
  assert.equal(pending(a).length, 2);

  // It is the unnamed single-instance form: it resolves, but there is no name to ask for.
  const list = await s.get('/api/coordinator/instances');
  assert.deepEqual(list.body, { ok: true, instances: [], default: null });
  assert.equal((await s.get('/api/coordinator/board?instance=legacy')).status, 404);
});

test('FLEET_COORDINATOR_DIR wins over the registry default, and ?instance still wins over it', async (t) => {
  const legacy = instanceDir('legacy-first');
  const named = instanceDir('named');
  const s = await startServer({
    FLEET_COORDINATOR_DIR: legacy,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ alpha: named }),
  });
  t.after(() => s.stop());

  assert.equal((await s.get('/api/coordinator/board')).body.note, 'fixture-legacy-first');
  assert.equal((await s.get('/api/coordinator/board?instance=alpha')).body.note, 'fixture-named');
});

// --- 6. the vendor fixture is refused even when it is asked for by name ----

test('the vendor fixture is refused however it is configured, unless the hatch is open', async (t) => {
  const link = path.join(tmpdir('vendor-link'), 'board-root');
  fs.symlinkSync(VENDOR_DIR, link);

  for (const [label, dir] of [
    ['the fixture itself', VENDOR_DIR],
    ['a subdirectory of it', path.join(VENDOR_DIR, 'inbox')],
    ['a symlink to it', link],
  ]) {
    const s = await startServer({ FLEET_COORDINATOR_INSTANCES: '', FLEET_COORDINATOR_DIR: dir });
    t.after(() => s.stop());
    const r = await s.get('/api/coordinator/board');
    assert.equal(r.status, 503, label + ': ' + r.text);
    assert.match(r.body.error, /vendor fixture/, label);
    assert.ok(!r.text.includes(VENDOR_MARK), label + ' served the fixture anyway');
    assert.doesNotMatch(s.log(), /vendor_fixture=allowed/, label);
  }

  // Through the registry too — a name buys no exemption.
  const named = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ vendor: VENDOR_DIR }),
  });
  t.after(() => named.stop());
  const r = await named.get('/api/coordinator/board?instance=vendor');
  assert.equal(r.status, 503, r.text);
  assert.match(r.body.error, /vendor fixture/);

  // The escape hatch, for developing against this checkout, and nothing else re-enables it.
  const dev = await startServer({
    FLEET_COORDINATOR_INSTANCES: '',
    FLEET_COORDINATOR_DIR: VENDOR_DIR,
    FLEET_COORDINATOR_ALLOW_VENDOR_FIXTURE: '1',
  });
  t.after(() => dev.stop());
  const open = await dev.get('/api/coordinator/board');
  assert.equal(open.status, 200, open.text);
  assert.match(open.text, new RegExp(VENDOR_MARK));
  assert.match(dev.log(), /vendor_fixture=allowed/);
});

// --- 7. discovery ----------------------------------------------------------

test('GET /instances lists names only — never a path, and never 503', async (t) => {
  const a = instanceDir('list-a');
  const b = instanceDir('list-b');
  const s = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ zulu: b, alpha: a }),
    FLEET_COORDINATOR_DEFAULT_INSTANCE: 'zulu',
  });
  t.after(() => s.stop());

  const r = await s.get('/api/coordinator/instances');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, instances: ['alpha', 'zulu'], default: 'zulu' });
  // The whole point: the host's directory layout stays on the host.
  assert.ok(!r.text.includes(a), 'leaked a board path: ' + r.text);
  assert.ok(!r.text.includes(b), 'leaked a board path: ' + r.text);
  assert.ok(!/\/(home|tmp|var)\//.test(r.text), 'leaked a path: ' + r.text);

  // Answerable on an unconfigured deck, where every board route is 503.
  const bare = await startServer({ ...NONE });
  t.after(() => bare.stop());
  const empty = await bare.get('/api/coordinator/instances');
  assert.equal(empty.status, 200, empty.text);
  assert.deepEqual(empty.body, { ok: true, instances: [], default: null });

  // Read-only, like the other views.
  assert.equal((await s.post('/api/coordinator/instances', {})).status, 405);
  // And an unknown path under the prefix is still a plain 404, not a 503.
  const unknown = await bare.get('/api/coordinator/nope');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.text, 'not found');
});

test('the boot line states what this deck serves', async (t) => {
  const s = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ alpha: instanceDir('boot-a'), bravo: instanceDir('boot-b') }),
    FLEET_COORDINATOR_DEFAULT_INSTANCE: 'bravo',
  });
  t.after(() => s.stop());
  assert.match(s.log(), /^coordinator: instances=2 \(alpha, bravo\) default=bravo$/m, s.log());

  // A registry that will not parse leaves the deck serving nothing — and saying so, rather than
  // refusing to boot and taking every terminal down with it.
  const broken = await startServer({ ...NONE, FLEET_COORDINATOR_INSTANCES: '{not json' });
  t.after(() => broken.stop());
  assert.match(broken.log(), /^coordinator: instances=0 default=none registry_error=/m, broken.log());
  assert.equal((await broken.get('/api/coordinator/board')).status, 503);
});

// --- 8. both listeners -----------------------------------------------------

test('instance selection works on the tailnet listener too', async (t) => {
  const a = instanceDir('tail-a');
  const b = instanceDir('tail-b');
  const s = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({ alpha: a, bravo: b }),
  });
  t.after(() => s.stop());

  assert.equal((await s.tailGet('/api/coordinator/board?instance=alpha')).body.note, 'fixture-tail-a');
  assert.equal((await s.tailGet('/api/coordinator/board?instance=bravo')).body.note, 'fixture-tail-b');
  assert.equal((await s.tailGet('/api/coordinator/board?instance=nope')).status, 404);
  assert.deepEqual((await s.tailGet('/api/coordinator/instances')).body.instances, ['alpha', 'bravo']);

  const post = await s.tailPost('/api/coordinator/sitrep?instance=alpha', VALID);
  assert.equal(post.status, 201, post.text);
  assert.equal(pending(a).length, 2);
  assert.equal(pending(b).length, 1);

  // And the tailnet listener fails closed the same way a loopback one does.
  const bare = await startServer({ ...NONE });
  t.after(() => bare.stop());
  const closed = await bare.tailGet('/api/coordinator/board');
  assert.equal(closed.status, 503, closed.text);
  assert.ok(!closed.text.includes(VENDOR_MARK));
});

// --- F1: no configuration is ever discarded in silence ---------------------

test('a __proto__ instance key round-trips instead of vanishing into the prototype', async (t) => {
  // On a plain `{}` registry map this assignment hits Object.prototype's __proto__ accessor and is
  // silently dropped — unreachable and unreported. The map is null-prototype so it cannot be.
  const weird = instanceDir('proto');
  const ok = instanceDir('ordinary');
  const s = await startServer({
    ...NONE,
    // Hand-built, not JSON.stringify of a literal: `{ __proto__: x }` in source is the prototype
    // setter and never becomes an own property, so the fixture would not contain the key at all.
    // JSON.parse, by contrast, does define it as an ordinary own property — which is exactly the
    // input the deck has to survive.
    FLEET_COORDINATOR_INSTANCES:
      '{"__proto__":' + JSON.stringify(weird) + ',"alpha":' + JSON.stringify(ok) + '}',
  });
  t.after(() => s.stop());

  const list = await s.get('/api/coordinator/instances');
  assert.deepEqual(list.body.instances, ['__proto__', 'alpha'], list.text);
  assert.match(s.log(), /^coordinator: instances=2 \(__proto__, alpha\)/m, s.log());

  const board = await s.get('/api/coordinator/board?instance=' + encodeURIComponent('__proto__'));
  assert.equal(board.status, 200, board.text);
  assert.equal(board.body.note, 'fixture-proto');
  assert.equal((await s.get('/api/coordinator/board?instance=alpha')).body.note, 'fixture-ordinary');

  // Still an own-property lookup and nothing more: an inherited name is not an instance.
  for (const name of ['constructor', 'hasOwnProperty', 'toString', 'valueOf'])
    assert.equal((await s.get('/api/coordinator/board?instance=' + name)).status, 404, name);
});

test('an entry dropped for a legitimate reason is named, never dropped quietly', async (t) => {
  const good = instanceDir('kept');
  const s = await startServer({
    ...NONE,
    FLEET_COORDINATOR_INSTANCES: JSON.stringify({
      kept: good,
      relative: 'coordinator', // resolves against whatever cwd the deck started in
      typed: 42,
      blank: '',
    }),
  });
  t.after(() => s.stop());

  assert.match(
    s.log(),
    /^coordinator: instances=1 \(kept\) default=kept registry_error=skipped-non-absolute:relative,typed,blank$/m,
    s.log()
  );
  for (const name of ['relative', 'typed', 'blank'])
    assert.equal((await s.get('/api/coordinator/board?instance=' + name)).status, 404, name);
  assert.equal((await s.get('/api/coordinator/board?instance=kept')).body.note, 'fixture-kept');
});

// --- F2: the route group fails closed as one unit, method check and all ----

test('an unresolvable deck answers 503 to a wrong-method call; a configured one still answers 405', async (t) => {
  // Deliberate ordering, pinned: "this deck serves no board" is the actionable fact, and the whole
  // group failing closed together is the property. The contrast below proves the method check is
  // still alive rather than dead code behind the resolution.
  const bare = await startServer({ ...NONE });
  t.after(() => bare.stop());
  for (const route of ['board', 'northstar', 'inbox', 'gate']) {
    const r = await bare.post('/api/coordinator/' + route, {});
    assert.equal(r.status, 503, route + ': ' + r.text);
    assert.equal(r.body.error, 'no coordinator instance configured', route);
  }

  const s = await startServer({ ...NONE, FLEET_COORDINATOR_INSTANCES: JSON.stringify({ alpha: instanceDir('method') }) });
  t.after(() => s.stop());
  for (const route of ['board', 'northstar', 'inbox', 'gate']) {
    const r = await s.post('/api/coordinator/' + route, {});
    assert.equal(r.status, 405, route + ': ' + r.text);
    assert.equal(r.text, 'method not allowed', route);
  }
});
