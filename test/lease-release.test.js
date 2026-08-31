// XYZ-1890 — the dead-lease drain. The cascade guard's whole-host rule counts a host's reap
// candidates against its non-reaped rows, so a host whose leases are ALL dead trips it on every
// tick forever: the guard is right (a partition looks exactly like this) and the rows are
// livelocked all the same. POST /api/lease/release is the human-authorised way out, and it is
// fenced twice — once on the operator's seat, and once on the lease's own epoch, because the
// seat fence cannot tell one incarnation of a (host,name) from the next.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./http');
const { tmpdir, hostsFile, load, unload } = require('./helpers');

const FAKE_SSH = path.join(__dirname, 'fake-ssh.js');
const HOST = 'german-box';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// test/http.js hands out 20000-40000 and reaper.test.js sits at 3900, so this file takes its
// own band: a shared port is an EADDRINUSE on the loopback listener, not a failed assertion.
let port = 4200;

// In-process, so a sweep is a step: the livelock proof below has to assert what one tick did
// and what the next one did after a release, which a timer-driven reaper cannot show.
function instance(opts = {}) {
  const dir = tmpdir('release');
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: { [HOST]: { sessions: {} } }, calls: [] }));
  const PORT = port++;
  const env = {
    PORT,
    FLEET_DB: path.join(dir, 'fleet.db'),
    FLEET_HOSTS_FILE: hostsFile(dir),
    FLEET_SSH_BIN: FAKE_SSH,
    FLEET_FAKE_SSH_STATE: state,
    FLEET_TTL_S: '1',
    FLEET_SUSPECT_WINDOW_S: '1',
    ...(opts.env || {}),
  };
  const m = load(env, { listen: true });
  const base = 'http://127.0.0.1:' + PORT;
  const call = (method, u, b) =>
    fetch(base + u, {
      method,
      ...(b === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  return {
    m,
    post: (u, b) => call('POST', u, b),
    get: (u) => call('GET', u),
    ttlMs: Number(env.FLEET_TTL_S) * 1000,
    windowMs: Number(env.FLEET_SUSPECT_WINDOW_S) * 1000,
    row: (n) => m.db.prepare('SELECT * FROM sessions WHERE host = ? AND name = ?').get(HOST, n),
    ssh: () => JSON.parse(fs.readFileSync(state, 'utf8')).calls.map((c) => c.cmd),
    alerts: () => m.REAPER.alerts,
    tick: () => m.reaperTick(),
    stop: () => unload(m),
  };
}

// The HTTP body is the claim; the row is the evidence. Every clause here is about stored
// state, so each test reads the row back rather than trusting the response.
function q(s, sql, ...args) {
  const db = s.open();
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}
const sessRow = (s, name) =>
  q(s, 'SELECT * FROM sessions WHERE host = ? AND name = ?', HOST, name)[0] || null;
// A lease in a given state, built the way the reaper would have left it. Going through
// /api/lease/claim first is what makes the epoch real rather than invented.
async function leaseIn(s, name, lease_state, extra = {}) {
  const c = await s.post('/api/lease/claim', { host: HOST, name });
  assert.equal(c.status, 200, s.log());
  const db = s.open();
  try {
    db.prepare(
      `UPDATE sessions SET lease_state = ?, suspect_at = ?, warned_at = ?, reaped_at = ?,
         reap_reason = ?, killed_at = ? WHERE host = ? AND name = ?`
    ).run(
      lease_state,
      extra.suspect_at === undefined ? Date.now() - 5000 : extra.suspect_at,
      extra.warned_at === undefined ? Date.now() - 4000 : extra.warned_at,
      lease_state === 'reaped' ? Date.now() - 3000 : null,
      lease_state === 'reaped' ? 'lease expired' : null,
      extra.killed_at === undefined ? null : extra.killed_at,
      HOST,
      name
    );
  } finally {
    db.close();
  }
  return c.body.epoch;
}

const release = (s, b) => s.post('/api/lease/release', b);

// --- the livelock, and the drain

test('XYZ-1890 — an all-dead host livelocks the reaper, and a release drains it', async (t) => {
  const i = instance();
  t.after(() => i.stop());

  // Two sessions on one host, neither of them in `tmux ls` and neither beating: the shape of
  // a box that went away. No seat is claimed here, so the bootstrap fence stands open — the
  // seat gate itself is proved below, on a deck whose TTL is long enough to assert against.
  for (const n of ['DEAD-1', 'DEAD-2'])
    assert.equal((await i.post('/api/lease/claim', { host: HOST, name: n })).status, 200);

  await sleep(Math.max(i.ttlMs, i.windowMs) + 100); // past the boot grace and the TTL
  await i.tick(); // both suspect, both warned
  await sleep(i.windowMs + 100); // past the appeal window: both are now reap candidates

  const before = i.alerts().length;
  await i.tick();

  // Step 1: the problem is real. Every non-reaped row on this host is a candidate, so the
  // whole-host rule trips on its own count and nothing moves — this tick, or any later one.
  for (const n of ['DEAD-1', 'DEAD-2']) {
    const r = i.row(n);
    assert.equal(r.lease_state, 'suspect', n + ' moved, so the guard did not trip');
    assert.equal(r.reaped_at, null, n);
  }
  const tripped = i.alerts().slice(before);
  assert.ok(
    tripped.some((a) => a.host === HOST && /every session on this host/.test(a.message)),
    'the whole-host rule is what refused: ' + JSON.stringify(tripped)
  );
  assert.ok(!i.ssh().some((c) => /kill-session/.test(c)), 'the guard let a kill through');
  // And it is not K: the fleet-wide check is a separate trip, and no K reaches this one.
  assert.ok(!tripped.some((a) => /K=/.test(a.message)), JSON.stringify(tripped));

  // Step 2: the operator drains one named lease. This is not a reap — nothing is killed and
  // nothing is warned; the row simply stops holding a lease.
  const epoch = i.row('DEAD-1').epoch;
  const res = await release(i, { host: HOST, name: 'DEAD-1', epoch });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(
    [res.body.ok, res.body.released_from, res.body.epoch],
    [true, 'suspect', epoch]
  );
  const drained = i.row('DEAD-1');
  assert.equal(drained.lease_state, null, 'the released row still holds a lease');
  assert.equal(drained.epoch, epoch, 'a release is not a claim: the epoch moved');
  assert.ok(!i.ssh().some((c) => /kill-session/.test(c)), 'a release killed something');

  // Step 3: with the drained row out of both counts, the host no longer looks like a fleet
  // that died at once, and the reaper does its job on what is left.
  const mid = i.alerts().length;
  await i.tick();

  assert.deepEqual(i.alerts().slice(mid), [], 'the guard tripped on a host it should not have');
  const swept = i.row('DEAD-2');
  assert.equal(swept.lease_state, 'reaped', 'the drain did not unblock the sweep');
  assert.ok(swept.killed_at, 'DEAD-2 was fenced but never killed');
  assert.ok(i.ssh().some((c) => /kill-session -t DEAD-2/.test(c)), i.ssh().join('\n'));
  assert.equal(i.row('DEAD-1').lease_state, null, 'the released row was swept anyway');
});

test('XYZ-1890 — a released row leaves the reaper alone and can be claimed again', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  const c = await i.post('/api/lease/claim', { host: HOST, name: 'DEAD-3' });
  assert.equal(c.status, 200);

  await sleep(Math.max(i.ttlMs, i.windowMs) + 100);
  await i.tick(); // suspect + warned
  assert.equal((await release(i, { host: HOST, name: 'DEAD-3', epoch: c.body.epoch })).status, 200);

  await sleep(i.windowMs + 100);
  await i.tick();
  const r = i.row('DEAD-3');
  assert.equal(r.lease_state, null, 'a released row was picked back up by a later tick');
  assert.equal(r.reaped_at, null);
  assert.ok(!i.ssh().some((c2) => /kill-session/.test(c2)), 'a released row was killed anyway');

  // The row is still there — a vanished worker must not silently disappear — and the epoch it
  // kept is the fence the next claim increments.
  const again = await i.post('/api/lease/claim', { host: HOST, name: 'DEAD-3' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.epoch, c.body.epoch + 1, 'the release cost the fence a number');
  assert.equal(i.row('DEAD-3').lease_state, 'active');
});

// --- the hazard: (host,name) names two incarnations, and only the epoch tells them apart

test('XYZ-1890 — a re-claimed lease cannot be released with the old epoch', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-THEFT';

  // The exact field shape: reaped, its kill never confirmed, and then re-claimed under the
  // same name. A route that gated on lease_state alone would read "obviously dead" here and
  // release a lease that belongs to a live new holder.
  const old = await leaseIn(s, name, 'reaped');
  const fresh = await s.post('/api/lease/claim', { host: HOST, name });
  assert.equal(fresh.status, 200, s.log());
  assert.equal(fresh.body.epoch, old + 1, 'the re-claim minted a new epoch');
  const held = sessRow(s, name);

  const stolen = await release(s, { host: HOST, name, epoch: old });
  assert.equal(stolen.status, 409, JSON.stringify(stolen.body));
  assert.equal(stolen.body.ok, false);
  assert.match(stolen.body.error, /stale epoch/);
  assert.equal(stolen.body.current_epoch, fresh.body.epoch, 'the operator is told what it raced');

  const after = sessRow(s, name);
  assert.deepStrictEqual(
    [after.lease_state, after.epoch, after.expires_at],
    ['active', held.epoch, held.expires_at],
    'the new holder lost its lease to its predecessor\'s epoch'
  );
  const beat = await s.post('/api/heartbeat', { host: HOST, name, epoch: fresh.body.epoch });
  assert.equal(beat.status, 200, 'the new holder can still beat: ' + beat.text);

  // The row was releasable in principle — only the epoch refused it, which is the whole point.
  const owned = await release(s, { host: HOST, name, epoch: fresh.body.epoch, force: true });
  assert.equal(owned.status, 200, JSON.stringify(owned.body));
  assert.equal(sessRow(s, name).lease_state, null);
});

// --- the three ways a CAS matches nothing

test('XYZ-1890 — every refused release says which precondition failed', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const unknown = await release(s, { host: HOST, name: 'EDITH-T-NOBODY', epoch: 1 });
  assert.equal(unknown.status, 404, unknown.text);
  assert.match(unknown.body.error, /no such session row/);

  // A registry row with no lease: the session is known, the lease is not.
  assert.equal((await s.post('/api/registry', { host: HOST, name: 'EDITH-T-REG', label: 'x' })).status, 200);
  const unleased = await release(s, { host: HOST, name: 'EDITH-T-REG', epoch: 1 });
  assert.equal(unleased.status, 404, unleased.text);
  assert.match(unleased.body.error, /holds no lease/);

  const epoch = await leaseIn(s, 'EDITH-T-SUSPECT', 'suspect');
  const stale = await release(s, { host: HOST, name: 'EDITH-T-SUSPECT', epoch: epoch + 7 });
  assert.equal(stale.status, 409, stale.text);
  assert.match(stale.body.error, /stale epoch/);
  assert.equal(stale.body.current_epoch, epoch);
  assert.equal(sessRow(s, 'EDITH-T-SUSPECT').lease_state, 'suspect', 'the refused release wrote');

  // An epoch is not optional even with a live seat: it is the fence, not a hint.
  const bare = await release(s, { host: HOST, name: 'EDITH-T-SUSPECT' });
  assert.equal(bare.status, 400, bare.text);
  assert.match(bare.body.error, /epoch required/);

  // A live lease is not drainable by default — it is inside its TTL and may still be beating.
  const live = await s.post('/api/lease/claim', { host: HOST, name: 'EDITH-T-LIVE' });
  assert.equal(live.status, 200, s.log());
  const refused = await release(s, { host: HOST, name: 'EDITH-T-LIVE', epoch: live.body.epoch });
  assert.equal(refused.status, 409, refused.text);
  assert.match(refused.body.error, /not drainable/);
  assert.equal(refused.body.lease_state, 'active');
  assert.equal(sessRow(s, 'EDITH-T-LIVE').lease_state, 'active');

  const forced = await release(s, { host: HOST, name: 'EDITH-T-LIVE', epoch: live.body.epoch, force: true });
  assert.equal(forced.status, 200, forced.text);
  assert.equal(sessRow(s, 'EDITH-T-LIVE').lease_state, null);
  // The holder is told to re-claim rather than tombstoned: a release is not a reap.
  const beat = await s.post('/api/heartbeat', { host: HOST, name: 'EDITH-T-LIVE', epoch: live.body.epoch });
  assert.equal(beat.status, 409, beat.text);
  assert.match(beat.body.error, /claim first/);

  const badForce = await release(s, { host: HOST, name: 'EDITH-T-SUSPECT', epoch, force: 'yes' });
  assert.equal(badForce.status, 400, badForce.text);
  assert.match(badForce.body.error, /force must be/);
  assert.equal(sessRow(s, 'EDITH-T-SUSPECT').lease_state, 'suspect');
});

test('XYZ-1890 — a release drops a standing kill obligation loudly', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  // The 12 field rows: reaped, on a host that never answered, so the kill was never confirmed.
  // Releasing one ends a retry contract, which is the one irreversible thing this route does.
  const epoch = await leaseIn(s, 'EDITH-T-OWED', 'reaped');
  assert.equal((await release(s, { host: HOST, name: 'EDITH-T-OWED', epoch })).status, 200, s.log());
  assert.match(s.log(), /\[lifecycle\] .* released german-box\/EDITH-T-OWED epoch=1 /);
  assert.match(s.log(), /kill-obligation-dropped german-box\/EDITH-T-OWED epoch=1/);
  assert.match(s.log(), /\[lifecycle-alert\].*a kill for epoch 1 was still owed/);
  const alerts = (await s.get('/api/health')).body.alerts;
  assert.ok(
    alerts.some((a) => /still owed/.test(a.message)),
    'the override left no trace on the deck: ' + JSON.stringify(alerts)
  );
});

// --- the seat fence, exactly as its sibling routes wear it

test('XYZ-1890 — release is fenced to the current seat like every other privileged write', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-FENCED';
  const epoch = await leaseIn(s, name, 'suspect');

  assert.equal((await s.post('/api/seats/claim', { seat: 'orchestrator', owner_host: 'mac', owner_name: 'O17' })).body.epoch, 1, s.log());
  assert.equal((await s.post('/api/seats/claim', { seat: 'orchestrator', owner_host: 'mac', owner_name: 'O18' })).body.epoch, 2, s.log());

  const bare = await release(s, { host: HOST, name, epoch });
  assert.equal(bare.status, 409, bare.text);
  assert.match(bare.body.error, /seat_epoch required/);

  const zombie = await release(s, { host: HOST, name, epoch, seat_epoch: 1 });
  assert.equal(zombie.status, 409, zombie.text);
  assert.match(zombie.body.error, /stale seat_epoch/);

  // A string is no better than a missing one — "2" must not pass as epoch 2.
  const strung = await release(s, { host: HOST, name, epoch, seat_epoch: '2' });
  assert.equal(strung.status, 409, strung.text);
  assert.match(strung.body.error, /seat_epoch required/);

  assert.equal(sessRow(s, name).lease_state, 'suspect', 'a fenced-out release still wrote');

  const holder = await release(s, { host: HOST, name, epoch, seat_epoch: 2 });
  assert.equal(holder.status, 200, holder.text);
  assert.equal(sessRow(s, name).lease_state, null);
  assert.match(s.log(), /released german-box\/EDITH-T-FENCED epoch=1 .*by seat_epoch=2/);
});

// --- role gating, by derivation

test('XYZ-1890 — both drain routes are gone on a satellite and off the tailnet', async (t) => {
  const sat = await startServer({ FLEET_ROLE: 'satellite' });
  t.after(() => sat.stop());

  // Nothing was added to HOME_ROUTES for this: isHomeRoute() reads LEASE_ROUTES, so a route
  // added to the dispatch set is gated the same day it is dispatched.
  const rel = await sat.post('/api/lease/release', { host: HOST, name: 'X', epoch: 1 });
  assert.equal(rel.status, 404, rel.text);
  assert.equal(rel.text, "not served in role 'satellite'");
  const list = await sat.get('/api/lease/drainable');
  assert.equal(list.status, 404, list.text);
  assert.equal(list.text, "not served in role 'satellite'");

  const home = await startServer();
  t.after(() => home.stop());
  assert.equal((await home.get('/api/lease/drainable')).status, 200, home.log());

  // Unlike claim and heartbeat, the drain routes are loopback-only: the seat that authorises
  // them is loopback-only by M13, and the listing hands out lease epochs.
  assert.equal((await home.tailGet('/api/lease/drainable')).status, 404);
  assert.equal((await home.tailPost('/api/lease/release', { host: HOST, name: 'X', epoch: 1 })).status, 404);
  assert.equal((await home.tailPost('/api/lease/claim', { host: HOST, name: 'EDITH-T-TAIL' })).status, 200, home.log());
});

// --- the listing an operator drives the drain from

test('XYZ-1890 — GET /api/lease/drainable lists exactly what release accepts', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const suspect = await leaseIn(s, 'EDITH-T-D1', 'suspect');
  const reaped = await leaseIn(s, 'EDITH-T-D2', 'reaped');
  const live = await s.post('/api/lease/claim', { host: HOST, name: 'EDITH-T-D3' });
  assert.equal(live.status, 200, s.log());
  assert.equal((await s.post('/api/registry', { host: HOST, name: 'EDITH-T-D4', label: 'no lease' })).status, 200);

  const res = await s.get('/api/lease/drainable');
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.ok, true);
  assert.deepStrictEqual(
    res.body.leases.map((l) => [l.name, l.lease_state, l.epoch]),
    [['EDITH-T-D1', 'suspect', suspect], ['EDITH-T-D2', 'reaped', reaped]],
    'the listing is the drainable set, with each row\'s current epoch: ' + res.text
  );
  assert.equal(res.body.leases[0].host, HOST);

  // The listing is the input: an operator draining twelve leases must never guess an epoch.
  for (const l of res.body.leases) {
    const done = await release(s, { host: l.host, name: l.name, epoch: l.epoch });
    assert.equal(done.status, 200, l.name + ': ' + done.text);
  }
  assert.deepStrictEqual((await s.get('/api/lease/drainable')).body.leases, [], 'the drain is done');
  assert.equal(sessRow(s, 'EDITH-T-D3').lease_state, 'active', 'a live lease was drained');

  const g = await s.post('/api/lease/drainable', {});
  assert.equal(g.status, 405, 'the listing is a GET: ' + g.text);
});

test('XYZ-1890 — release never moves the epoch', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  for (const [name, state] of [['EDITH-T-E1', 'suspect'], ['EDITH-T-E2', 'reaped']]) {
    const epoch = await leaseIn(s, name, state);
    const res = await release(s, { host: HOST, name, epoch });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.epoch, epoch, name);
    const r = sessRow(s, name);
    // The stored number is the fence the next claim increments; a release that moved it would
    // hand the next incarnation an epoch a zombie could still be holding.
    assert.deepStrictEqual(
      [r.epoch, r.lease_state, r.expires_at, r.suspect_at, r.warned_at],
      [epoch, null, null, null, null],
      name + ': ' + JSON.stringify(r)
    );
  }
});
