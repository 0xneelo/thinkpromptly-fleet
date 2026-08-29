// Milestone C — M13 (seats and the fence they hand out), M17 (the fenced write set),
// S3 (the tailnet bearer key), M11 (the read contract Lane 3 renders from), M14 (tick age).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, startBroker } = require('./http');
const { tmpdir } = require('./helpers');

const HOST = 'german-box';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);

// The HTTP body is the claim; the row is the evidence. Every seat/fence clause is about
// stored state, so each test reads it back rather than trusting the response.
function q(s, sql, ...args) {
  const db = s.open();
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}
const seatRow = (s, seat) => q(s, 'SELECT * FROM seats WHERE seat = ?', seat)[0] || null;
const sessRow = (s, host, name) =>
  q(s, 'SELECT * FROM sessions WHERE host = ? AND name = ?', host, name)[0] || null;

// A fleet the poller can actually answer for: /api/sessions, /api/health and /api/kill all
// reach for ssh, and a real one would hang for ConnectTimeout on every test in this file.
async function withSsh(names = ['EDITH-T-1'], env = {}, opts = {}) {
  const dir = tmpdir('seats');
  const state = path.join(dir, 'ssh.json');
  const sessions = {};
  for (const n of names) sessions[n] = { activity: nowS(), created: nowS() - 60 };
  fs.writeFileSync(state, JSON.stringify({ hosts: { [HOST]: { sessions } }, calls: [] }));
  const s = await startServer(
    { FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'), FLEET_FAKE_SSH_STATE: state, ...env },
    { dir, ...opts }
  );
  s.ssh = () => JSON.parse(fs.readFileSync(state, 'utf8'));
  return s;
}

const claimSeat = (s, seat, owner_name, owner_host = 'mac') =>
  s.post('/api/seats/claim', { seat, owner_host, owner_name });
const deckOrigin = (s) => ({ origin: 'http://127.0.0.1:' + s.port });

// --- M13: seats

test('M13 — a seat claim fences the prior holder', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const first = await claimSeat(s, 'orchestrator', 'O17');
  assert.equal(first.status, 200, s.log());
  assert.deepStrictEqual(
    [first.body.ok, first.body.seat, first.body.epoch],
    [true, 'orchestrator', 1],
    'a first seat claim starts at epoch 1'
  );
  assert.ok(first.body.expires_at > Date.now(), 'the claim carries a live expiry');
  assert.equal(first.body.ttl_s, 90);

  const second = await claimSeat(s, 'orchestrator', 'O18');
  assert.equal(second.status, 200, s.log());
  assert.equal(second.body.epoch, 2, 'the re-claim increments rather than resuming');

  // One row, rewritten: the old orchestrator's number is now stale and its writes fence out.
  const r = seatRow(s, 'orchestrator');
  assert.deepStrictEqual(
    [r.owner_host, r.owner_name, r.epoch, r.suspect_at],
    ['mac', 'O18', 2, null],
    'the seat row carries the new owner, the new epoch, and no suspicion'
  );
  assert.equal(q(s, 'SELECT * FROM seats').length, 1, 'a re-claim rewrites, never appends');
});

test('M13 — seat epochs are one counter across both seats', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const epochs = [];
  for (const seat of ['orchestrator', 'coordinator', 'orchestrator']) {
    const res = await claimSeat(s, seat, 'O20');
    assert.equal(res.status, 200, s.log());
    epochs.push(res.body.epoch);
    // Per-seat counters would collide, and the fence matches on the number alone: a
    // coordinator epoch equal to the live orchestrator's would pass a fence it never earned.
    const all = q(s, 'SELECT epoch FROM seats').map((x) => x.epoch);
    assert.equal(new Set(all).size, all.length, 'no two seats share an epoch: ' + all);
  }
  assert.deepStrictEqual(epochs, [1, 2, 3]);
  assert.equal(seatRow(s, 'coordinator').epoch, 2);
  assert.equal(seatRow(s, 'orchestrator').epoch, 3);
});

test('M13 — a tailnet POST to /api/seats/claim gets 404', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  // Not 403: the routes are simply not mounted there. A tailnet peer that could seize the
  // orchestrator seat would fence the real orchestrator out of its own fleet.
  const claim = await s.tailPost('/api/seats/claim', {
    seat: 'orchestrator', owner_host: 'mac', owner_name: 'INTRUDER',
  });
  assert.equal(claim.status, 404, claim.text);
  const list = await s.tailGet('/api/seats');
  assert.equal(list.status, 404, list.text);
  assert.equal(q(s, 'SELECT * FROM seats').length, 0, 'the tailnet claim wrote no seat');

  assert.equal((await claimSeat(s, 'orchestrator', 'O21')).status, 200, s.log());
  const local = await s.get('/api/seats');
  assert.equal(local.status, 200);
  assert.equal(local.body.seats.length, 1, 'the same routes work on loopback');
});

test('M13 — GET /api/seats withholds the epoch', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  assert.equal((await claimSeat(s, 'coordinator', 'C1')).status, 200, s.log());

  const res = await s.get('/api/seats');
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.ok, true);
  const row = res.body.seats.find((x) => x.seat === 'coordinator');
  assert.ok(row, 'the claimed seat is listed: ' + res.text);
  assert.deepStrictEqual(
    [row.owner_host, row.owner_name, row.fenced, row.suspect_at],
    ['mac', 'C1', true, null]
  );
  assert.ok(row.expires_at > Date.now());
  // The epoch is the credential fenceCheck trusts and this route has no auth of its own,
  // so it is withheld here and learned only from the holder's own claim response.
  assert.equal('epoch' in row, false, 'the listing leaks no epoch: ' + JSON.stringify(row));
  assert.equal(seatRow(s, 'coordinator').epoch, 1, 'the db still carries it');
});

test('M13 — an unrenewed seat is suspect after its TTL, and is never deleted', async (t) => {
  const s = await startServer({ FLEET_TTL_S: '1' });
  t.after(() => s.stop());

  const claim = await claimSeat(s, 'orchestrator', 'O22');
  assert.equal(claim.status, 200, s.log());
  assert.equal(claim.body.ttl_s, 1);

  await sleep(1200);
  const r = seatRow(s, 'orchestrator');
  assert.ok(r, 'an expired seat stays in the table — evidence, not a gap');
  assert.ok(r.expires_at < Date.now(), 'the seat is past its TTL: ' + r.expires_at);
  assert.deepStrictEqual([r.owner_host, r.owner_name, r.epoch], ['mac', 'O22', 1]);
  const listed = (await s.get('/api/seats')).body.seats;
  assert.equal(listed.length, 1, 'the expired seat is still listed');

  // Expiry is what the fence reads, tick or no tick: the epoch no longer proves a live seat.
  const fenced = await s.post('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done', seat_epoch: 1 });
  assert.equal(fenced.status, 409, fenced.text);
  assert.match(fenced.body.error, /stale seat_epoch/);
});

test('M13 — the holder\'s heartbeat renews its seat', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const lease = await s.post('/api/lease/claim', { host: 'mac', name: 'O17' });
  assert.equal(lease.status, 200, s.log());
  assert.equal((await claimSeat(s, 'orchestrator', 'O17')).status, 200, s.log());
  const before = seatRow(s, 'orchestrator').expires_at;

  // A seat that goes suspect is reinstated by its holder still beating — the reaper never
  // deletes it, so the only way back is the beat.
  const db = s.open();
  db.prepare('UPDATE seats SET suspect_at = ? WHERE seat = ?').run(Date.now(), 'orchestrator');
  db.close();

  await sleep(15);
  const beat = await s.post('/api/heartbeat', { host: 'mac', name: 'O17', epoch: lease.body.epoch });
  assert.equal(beat.status, 200, beat.text);

  const renewed = seatRow(s, 'orchestrator');
  assert.ok(renewed.expires_at > before, 'the holder\'s beat pushed the seat forward');
  assert.equal(renewed.suspect_at, null, 'and cleared the suspicion');
  assert.equal(renewed.epoch, 1, 'a renewal is not a re-claim');

  await sleep(15);
  const stale = await s.post('/api/heartbeat', { host: 'mac', name: 'O17', epoch: 99 });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(
    seatRow(s, 'orchestrator').expires_at,
    renewed.expires_at,
    'a rejected beat renews nothing — a zombie must not hold a seat alive'
  );
});

test('M13 — a heartbeat from a session that holds no seat renews no seat', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  assert.equal((await claimSeat(s, 'orchestrator', 'O17')).status, 200, s.log());
  const before = seatRow(s, 'orchestrator').expires_at;

  const other = await s.post('/api/lease/claim', { host: 'mac', name: 'O99' });
  assert.equal(other.status, 200, s.log());
  await sleep(15);
  const beat = await s.post('/api/heartbeat', { host: 'mac', name: 'O99', epoch: other.body.epoch });
  assert.equal(beat.status, 200, beat.text);

  assert.equal(
    seatRow(s, 'orchestrator').expires_at,
    before,
    'the seat clock is its own holder\'s beat, not any beat'
  );
});

// --- M17: the fenced write set

test('M17 — a fenced-out old orchestrator gets 409 and the deck UI still kills', async (t) => {
  const s = await withSsh(['EDITH-T-1', 'EDITH-T-2']);
  t.after(() => s.stop());

  assert.equal((await claimSeat(s, 'orchestrator', 'O17')).body.epoch, 1, s.log());
  assert.equal((await claimSeat(s, 'orchestrator', 'O18')).body.epoch, 2, s.log());

  const zombie = await s.post('/api/kill', { host: HOST, name: 'EDITH-T-1', seat_epoch: 1 });
  assert.equal(zombie.status, 409, zombie.text);
  assert.match(zombie.body.error, /stale seat_epoch/);
  assert.ok('EDITH-T-1' in s.ssh().hosts[HOST].sessions, 'the fenced kill never reached ssh');

  // The current holder is not fenced. The kill itself may still fail at ssh, so only the
  // absence of the 409 is asserted here.
  const holder = await s.post('/api/kill', { host: HOST, name: 'EDITH-T-1', seat_epoch: 2 });
  assert.equal(holder.status, 200, holder.text);
  assert.equal('ok' in holder.body, true, 'the write proceeded: ' + holder.text);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1').status, 'killed');

  // The deck UI IS the seat, so an allowed Origin carries no seat_epoch and is still exempt.
  const deck = await s.post('/api/kill', { host: HOST, name: 'EDITH-T-2' }, deckOrigin(s));
  assert.equal(deck.status, 200, deck.text);
  assert.equal('ok' in deck.body, true, deck.text);
  assert.equal('EDITH-T-2' in s.ssh().hosts[HOST].sessions, false, 'the browser kill landed');
});

test('M17 — an agent call with no seat_epoch is fenced once a seat exists', async (t) => {
  const s = await withSsh();
  t.after(() => s.stop());

  // Seeded while the fence is still open, so the rows below exist to be assert-ed as unchanged.
  await s.post('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'active', task: 'XYZ-1' });
  await s.post('/api/registry', { host: HOST, name: 'EDITH-T-5', label: 'keeper' });
  assert.equal((await claimSeat(s, 'orchestrator', 'O17')).status, 200, s.log());

  const calls = [
    ['/api/kill', { host: HOST, name: 'EDITH-T-1' }],
    ['/api/registry/delete', { host: HOST, name: 'EDITH-T-5' }],
    ['/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done' }],
    ['/api/registry', { host: HOST, name: 'EDITH-T-1', task: 'XYZ-2' }],
  ];
  for (const [p, b] of calls) {
    const res = await s.post(p, b);
    assert.equal(res.status, 409, p + ' → ' + res.text);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /seat_epoch required/, p);
  }
  // A non-integer is no better than a missing one — "1" must not pass as epoch 1.
  const strung = await s.post('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done', seat_epoch: '1' });
  assert.equal(strung.status, 409, strung.text);
  assert.match(strung.body.error, /seat_epoch required/);

  const r = sessRow(s, HOST, 'EDITH-T-1');
  assert.equal(r.status, 'active', 'the fenced status write did not land');
  assert.equal(r.task, 'XYZ-1', 'the fenced task write did not land');
  assert.ok(sessRow(s, HOST, 'EDITH-T-5'), 'the fenced delete did not land');
  assert.ok('EDITH-T-1' in s.ssh().hosts[HOST].sessions, 'the fenced kill did not land');
});

test('M17 — classification writes are not fenced', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  assert.equal((await claimSeat(s, 'orchestrator', 'O17')).status, 200, s.log());

  // A label or a note is classification, not authority: fencing it would stop a worker
  // describing itself the moment the operator claimed a seat.
  const res = await s.post('/api/registry', {
    host: HOST, name: 'EDITH-T-7', label: 'lane 3', role: 'builder', note: 'wiring', group: 'orgchart',
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.ok, true);
  const r = sessRow(s, HOST, 'EDITH-T-7');
  assert.deepStrictEqual(
    [r.label, r.role, r.note, r.grp],
    ['lane 3', 'builder', 'wiring', 'orgchart']
  );
});

test('M17 — bootstrap mode leaves the fence open until the first seat exists', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  // Fencing against a seat that cannot yet exist would lock out every worker on day one.
  const write = await s.post('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done' });
  assert.equal(write.status, 200, write.text);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1').status, 'done');

  const del = await s.post('/api/registry/delete', { host: HOST, name: 'EDITH-T-1' });
  assert.equal(del.status, 200, del.text);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1'), null, 'the unfenced delete landed');

  assert.equal((await claimSeat(s, 'orchestrator', 'O17')).status, 200, s.log());
  const armed = await s.post('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done' });
  assert.equal(armed.status, 409, armed.text);
  assert.match(armed.body.error, /seat_epoch required/);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1'), null, 'and wrote nothing');
});

test('M17 — FLEET_FENCE=strict arms the fence with no seats at all', async (t) => {
  const s = await withSsh([], { FLEET_FENCE: 'strict' }); // /api/health below reaches for ssh
  t.after(() => s.stop());
  assert.equal(q(s, 'SELECT * FROM seats').length, 0);

  const res = await s.post('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done' });
  assert.equal(res.status, 409, res.text);
  assert.match(res.body.error, /seat_epoch required/);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1'), null, 'strict refuses the write outright');
  assert.equal((await s.get('/api/health')).body.fence_mode, 'strict');
});

test('M17 — the fence does not apply to the tailnet listener', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  assert.equal((await claimSeat(s, 'orchestrator', 'O17')).status, 200, s.log());
  assert.equal(
    (await s.post('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done' })).status,
    409,
    'the fence is armed on loopback'
  );

  // Seats are loopback-only (M13), so a box worker has no route by which it could ever
  // obtain a seat_epoch; the tailnet's credential is the S3 bearer key (operator:gate XYZ-1822).
  const res = await s.tailPost('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.ok, true);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1').status, 'done', 'the box worker\'s write landed');
});

// --- S3: the tailnet bearer key

test('S3 — an armed tailnet key rejects a write without it', async (t) => {
  // The train window moved to fleetdeck-train.js, so reading it needs a broker behind the deck.
  // The clause under test is unchanged: the tailnet key gates writes, never this read.
  const brk = await startBroker();
  t.after(() => brk.stop());
  const s = await startServer({ FLEET_TAILNET_KEY: 'hunter2', FLEET_TRAIN_PORT: String(brk.port) });
  t.after(() => s.stop());
  const b = { host: HOST, name: 'EDITH-T-1', status: 'done' };

  // The Host-header check alone is spoofable by any peer on the tailnet.
  for (const [label, h] of [
    ['no header', {}],
    ['wrong key', { authorization: 'Bearer wrong' }],
    ['malformed', { authorization: 'hunter2' }],
  ]) {
    const res = await s.tailPost('/api/registry', b, h);
    assert.equal(res.status, 401, label + ' → ' + res.text);
    assert.equal(res.text, 'unauthorized', label);
  }
  assert.equal(sessRow(s, HOST, 'EDITH-T-1'), null, 'no rejected write touched the db');

  const ok = await s.tailPost('/api/registry', b, { authorization: 'Bearer hunter2' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1').status, 'done');

  // Loopback is exempt: reaching it means being on this Mac already.
  const local = await s.post('/api/registry', { host: HOST, name: 'EDITH-T-2', status: 'done' });
  assert.equal(local.status, 200, local.text);
  assert.equal(sessRow(s, HOST, 'EDITH-T-2').status, 'done');

  // Reads keep their own gates rather than the key's.
  const train = await s.tailGet('/api/ghtrain');
  assert.equal(train.status, 200, train.text);
  assert.equal(train.body.active, false);
});

test('S3 — unset, the key gates nothing', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  // The default keeps today's box workers working; the key is armed by configuring it.
  const res = await s.tailPost('/api/registry', { host: HOST, name: 'EDITH-T-1', status: 'done' });
  assert.equal(res.status, 200, res.text);
  assert.equal(sessRow(s, HOST, 'EDITH-T-1').status, 'done');
});

// --- M11: the read contract

test('M11 — a mac desktop row with a fresh lease renders live', async (t) => {
  const s = await withSsh();
  t.after(() => s.stop());

  const lease = await s.post('/api/lease/claim', { host: 'mac', name: 'ORCH-17' });
  assert.equal(lease.status, 200, s.log());

  const res = await s.get('/api/sessions');
  assert.equal(res.status, 200, res.text);
  assert.deepStrictEqual(res.body.errors, [], s.log());
  const row = res.body.sessions.find((r) => r.host === 'mac' && r.name === 'ORCH-17');
  assert.ok(row, 'the mac lane is listed: ' + res.text);
  // A mac lane never appears in `tmux ls`, so the held lease is the only thing that can
  // ever make it read as alive.
  assert.deepStrictEqual(
    [row.live, row.tmux_live, row.lease_state],
    [true, false, 'active']
  );
  assert.equal(row.epoch, lease.body.epoch);
  assert.ok(row.expires_at > Date.now(), 'the lease expiry reaches the row: ' + row.expires_at);
});

test('M11 — every lifecycle column reaches the row whitelist', async (t) => {
  const s = await withSsh();
  t.after(() => s.stop());

  const lease = await s.post('/api/lease/claim', {
    host: 'mac', name: 'ORCH-18', pid: 4242, worker: 'Edith', role: 'backend-developer',
    parent_host: HOST, parent_name: 'EDITH-T-1',
  });
  assert.equal(lease.status, 200, s.log());

  const res = await s.get('/api/sessions');
  const row = res.body.sessions.find((r) => r.host === 'mac' && r.name === 'ORCH-18');
  assert.ok(row, res.text);

  // This whitelist is what Lane 3 builds the org chart from: a missing key hard-blocks it.
  const KEYS = [
    'host', 'name', 'label', 'role', 'worker', 'status', 'note', 'group', 'task',
    'last_seen_at', 'active_at', 'msg_at', 'pid', 'parent_host', 'parent_name', 'epoch',
    'lease_state', 'expires_at', 'suspect_at', 'warned_at', 'reaped_at', 'pinger_dead',
    'tmux_live', 'live',
  ];
  assert.deepStrictEqual(
    KEYS.filter((k) => !(k in row)),
    [],
    'the row is missing lifecycle columns: ' + JSON.stringify(row)
  );
  assert.deepStrictEqual(
    [row.pid, row.worker, row.role, row.parent_host, row.parent_name],
    [4242, 'Edith', 'backend-developer', HOST, 'EDITH-T-1']
  );
  assert.deepStrictEqual(
    [row.lease_state, row.epoch, row.suspect_at, row.warned_at, row.reaped_at, row.pinger_dead],
    ['active', lease.body.epoch, null, null, null, null]
  );
  assert.equal(row.expires_at, lease.body.expires_at);
});

test('M11 — a tmux-live session with no lease still reads live', async (t) => {
  const s = await withSsh();
  t.after(() => s.stop());

  const res = await s.get('/api/sessions');
  assert.deepStrictEqual(res.body.errors, [], s.log());
  const row = res.body.sessions.find((r) => r.host === HOST && r.name === 'EDITH-T-1');
  assert.ok(row, 'the polled session is listed: ' + res.text);
  // The poller is the second, independent liveness source: a session nobody leased is
  // still running, and must not render dead.
  assert.deepStrictEqual([row.live, row.tmux_live, row.lease_state], [true, true, null]);
});

test('M11 — a row that is neither tmux-live nor leased reads dead', async (t) => {
  const s = await withSsh();
  t.after(() => s.stop());

  const w = await s.post('/api/registry', { host: HOST, name: 'EDITH-T-GONE', label: 'vanished' });
  assert.equal(w.status, 200, w.text);

  const res = await s.get('/api/sessions');
  const row = res.body.sessions.find((r) => r.name === 'EDITH-T-GONE');
  assert.ok(row, 'a killed or vanished worker stays in the list: ' + res.text);
  assert.deepStrictEqual([row.live, row.tmux_live, row.lease_state], [false, false, null]);
});

test('M11 — the fleet read stays off the tailnet', async (t) => {
  const s = await withSsh();
  t.after(() => s.stop());

  for (const p of ['/api/sessions', '/api/health']) {
    const tail = await s.tailGet(p);
    assert.equal(tail.status, 404, p + ' over tailnet → ' + tail.text);
    const local = await s.get(p);
    assert.equal(local.status, 200, p + ' on loopback → ' + local.text);
  }
});

test('M14 — /api/health carries the reaper\'s tick age', async (t) => {
  const s = await withSsh();
  t.after(() => s.stop());

  const res = await s.get('/api/health');
  assert.equal(res.status, 200, res.text);
  const h = res.body;
  // NOTE for Lane 3: this is an object now, not the bare host array it used to be.
  assert.equal(Array.isArray(h.hosts), true, 'hosts moved under `hosts`: ' + res.text);
  assert.deepStrictEqual(h.hosts.map((x) => x.host), [HOST]);
  assert.deepStrictEqual(
    [h.hosts[0].holderOk, h.hosts[0].wslAlive, h.hosts[0].agentLocked],
    [true, true, false]
  );
  // The tick age is the only way a stopped reaper is visible before the leak it allows.
  assert.equal(h.reaper_last_tick_at, null, 'this instance runs with the reaper off');
  assert.equal(h.reaper_ticks, 0);
  assert.equal(h.reaper_tick_s, 30);
  assert.equal(h.reaper_grace, 'boot', 'nothing is reaped for one suspect window after boot');
  assert.equal(h.fence_mode, 'bootstrap');
  assert.equal(h.ttl_s, 90);
  assert.deepStrictEqual(h.alerts, []);
});
