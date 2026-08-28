// Milestone B — M1 (lease start + epoch fencing), M2 (only the current epoch renews),
// M12 (the parent edge is validated at claim and written nowhere else), S1, S7.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./http');

const HOST = 'german-box';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reading the row back is the point of most of these tests: the HTTP body is the claim,
// the row is the evidence.
function row(s, host, name) {
  const db = s.open();
  try {
    return db.prepare('SELECT * FROM sessions WHERE host = ? AND name = ?').get(host, name) || null;
  } finally {
    db.close();
  }
}

// There is no reap endpoint — the reaper tick owns that transition — so M2's tombstone
// cases write the terminal state the reaper would have written: every marker it sets on the
// way down, not just the last one.
function markReaped(s, host, name, at, reason) {
  const db = s.open();
  try {
    db.prepare(
      `UPDATE sessions SET lease_state = 'reaped', reaped_at = ?, reap_reason = ?,
         suspect_at = ?, warned_at = ?, killed_at = ?, pinger_dead = 1
       WHERE host = ? AND name = ?`
    ).run(at, reason, at, at, at, host, name);
  } finally {
    db.close();
  }
}

const claim = (s, b) => s.post('/api/lease/claim', { host: HOST, ...b });
const beat = (s, b) => s.post('/api/heartbeat', { host: HOST, ...b });

test('M1 — a reaped (host,name) re-claims, and the old epoch is fenced out', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-1';

  const first = await claim(s, { name });
  assert.equal(first.status, 200, s.log());
  assert.equal(first.body.epoch, 1, 'a first claim starts at epoch 1');
  const claimedExpiry = row(s, HOST, name).expires_at;

  markReaped(s, HOST, name, Date.now(), 'test');

  // tmux names come back and the orchestrator number pool reuses N, so the re-claim must
  // succeed and wipe every terminal marker — a half-reaped row would never be reaped again.
  const again = await claim(s, { name });
  assert.equal(again.status, 200, s.log());
  assert.equal(again.body.epoch, 2, 'the re-claim increments the epoch rather than resuming it');

  const r = row(s, HOST, name);
  assert.equal(r.epoch, 2);
  assert.equal(r.lease_state, 'active');
  assert.deepStrictEqual(
    [r.reaped_at, r.reap_reason, r.suspect_at, r.warned_at, r.killed_at, r.pinger_dead],
    [null, null, null, null, null, null],
    'every terminal marker is cleared by the re-claim'
  );
  assert.ok(r.expires_at >= claimedExpiry, 'the re-claim set a fresh lease');

  const stale = await beat(s, { name, epoch: 1 });
  assert.equal(stale.status, 409, 'the prior incarnation is fenced out: ' + stale.text);
  assert.equal(stale.body.ok, false);

  const fresh = await beat(s, { name, epoch: 2 });
  assert.equal(fresh.status, 200, 'the new incarnation renews: ' + fresh.text);
  assert.equal(fresh.body.ok, true);
});

test('M1 — every claim on the same session increments the epoch', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-2';

  const epochs = [];
  for (let i = 0; i < 3; i++) {
    const res = await claim(s, { name });
    assert.equal(res.status, 200, s.log());
    epochs.push(res.body.epoch);
  }
  assert.deepStrictEqual(epochs, [1, 2, 3]);
  assert.equal(row(s, HOST, name).epoch, 3, 'the db carries the latest epoch, not a stale one');
});

test('M2 — of two pingers, only the current epoch moves expires_at', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-3';

  await claim(s, { name }); // epoch 1 — the pinger that will be left behind
  const two = await claim(s, { name });
  assert.equal(two.body.epoch, 2);
  const before = row(s, HOST, name).expires_at;

  const stale = await beat(s, { name, epoch: 1 });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(row(s, HOST, name).expires_at, before, 'the stale pinger renewed nothing');

  await sleep(5); // the ms clock must tick, or a real renewal is indistinguishable from none
  const fresh = await beat(s, { name, epoch: 2 });
  assert.equal(fresh.status, 200, fresh.text);
  const after = row(s, HOST, name).expires_at;
  assert.ok(after > before, `expires_at moved forward (${before} -> ${after})`);
  assert.equal(fresh.body.expires_at, after, 'the body reports the value that was stored');
});

test('M2 — a heartbeat with no epoch renews nothing', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-4';

  await claim(s, { name });
  const before = row(s, HOST, name).expires_at;

  const res = await beat(s, { name });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.ok, false);
  // The 409 never hands back the current number: that would give a stale caller the fence.
  assert.equal(res.body.current_epoch_hint, false);
  assert.equal(row(s, HOST, name).expires_at, before);
});

test('M2 — a non-integer epoch renews nothing', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-5';

  const first = await claim(s, { name });
  const two = await claim(s, { name });
  assert.equal(two.body.epoch, 2, s.log());
  const before = row(s, HOST, name).expires_at;

  for (const epoch of ['2', 2.5]) {
    const res = await beat(s, { name, epoch });
    assert.equal(res.status, 409, `epoch ${JSON.stringify(epoch)} is not the integer 2: ` + res.text);
    assert.equal(res.body.current_epoch_hint, false);
    assert.equal(row(s, HOST, name).expires_at, before, 'nothing renewed');
  }
  assert.equal(first.body.epoch, 1);
});

test('M2 — a reaped row answers 410 to every epoch and never resurrects', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-6';

  await claim(s, { name });
  const before = row(s, HOST, name).expires_at;
  const reapedAt = Date.now() - 1234;
  markReaped(s, HOST, name, reapedAt, 'lease expired');

  // The tombstone is the reaper's verdict; a beat that arrives after it is evidence the
  // session is a zombie, so it is told it is gone rather than quietly re-armed.
  const current = await beat(s, { name, epoch: 1 });
  assert.equal(current.status, 410, current.text);
  assert.equal(current.body.reason, 'lease expired');
  assert.equal(current.body.reaped_at, reapedAt);

  let r = row(s, HOST, name);
  assert.equal(r.lease_state, 'reaped', 'the current epoch did not resurrect the row');
  assert.equal(r.expires_at, before);

  const wrong = await beat(s, { name, epoch: 99 });
  assert.equal(wrong.status, 410, 'gone beats fenced: ' + wrong.text);
  assert.equal(wrong.body.reason, 'lease expired');

  r = row(s, HOST, name);
  assert.equal(r.lease_state, 'reaped');
  assert.equal(r.expires_at, before);
});

test('M2 — a heartbeat for an unknown session is 404, not a silent create', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-T-7';

  const res = await beat(s, { name, epoch: 1 });
  assert.equal(res.status, 404, res.text);
  assert.equal(res.body.ok, false);
  assert.equal(row(s, HOST, name), null, 'a beat never creates the row it failed to find');
});

test('M12 — the parent edge is validated at claim', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const rejected = [
    ['EDITH-P-1', { parent_host: 'mac' }, 'parent_host alone is half an edge'],
    ['EDITH-P-2', { parent_name: 'ORCH-17' }, 'parent_name alone is half an edge'],
    ['EDITH-P-3', { parent_host: 'nope', parent_name: 'X' }, 'an unknown parent_host is tree corruption'],
    ['EDITH-P-4', { parent_host: HOST, parent_name: 'EDITH-P-4' }, 'a session cannot be its own parent'],
  ];
  for (const [name, body, why] of rejected) {
    const res = await claim(s, { name, ...body });
    assert.equal(res.status, 400, why + ': ' + res.text);
    assert.equal(res.body.ok, false);
    assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0, 'the rejection says why');
    const r = row(s, HOST, name);
    assert.ok(r === null || r.parent_host === null, why + ' — no edge was stored');
  }

  const ok = await claim(s, { name: 'EDITH-P-5', parent_host: 'mac', parent_name: 'ORCH-17' });
  assert.equal(ok.status, 200, ok.text);
  const r = row(s, HOST, 'EDITH-P-5');
  assert.deepStrictEqual([r.parent_host, r.parent_name], ['mac', 'ORCH-17']);
});

test('M12 — a registry POST carrying parent_* changes no edge', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-P-6';

  await claim(s, { name, parent_host: 'mac', parent_name: 'ORCH-17' });

  const res = await s.post('/api/registry', {
    host: HOST, name, parent_host: HOST, parent_name: 'EVIL', label: 'x',
  });
  assert.equal(res.status, 200, res.text);

  const r = row(s, HOST, name);
  assert.equal(r.label, 'x', 'the registry write really ran');
  assert.deepStrictEqual(
    [r.parent_host, r.parent_name],
    ['mac', 'ORCH-17'],
    'the edge is written at claim and nowhere else'
  );
});

test('M12 — mac may parent a box session and a box session may parent mac, but neither itself', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const down = await s.post('/api/lease/claim', {
    host: HOST, name: 'EDITH-P-7', parent_host: 'mac', parent_name: 'ORCH-17',
  });
  assert.equal(down.status, 200, down.text);
  assert.deepStrictEqual(
    [row(s, HOST, 'EDITH-P-7').parent_host, row(s, HOST, 'EDITH-P-7').parent_name],
    ['mac', 'ORCH-17']
  );

  const up = await s.post('/api/lease/claim', {
    host: 'mac', name: 'ORCH-18', parent_host: HOST, parent_name: 'EDITH-P-7',
  });
  assert.equal(up.status, 200, 'mac is a leasable host, so it can hang under a box lane: ' + up.text);
  const r = row(s, 'mac', 'ORCH-18');
  assert.deepStrictEqual([r.parent_host, r.parent_name], [HOST, 'EDITH-P-7']);

  const self = await s.post('/api/lease/claim', {
    host: 'mac', name: 'ORCH-19', parent_host: 'mac', parent_name: 'ORCH-19',
  });
  assert.equal(self.status, 400, 'a self-edge is a cycle of one: ' + self.text);
  assert.equal(row(s, 'mac', 'ORCH-19'), null);
});

test('S1 — the heartbeat 200 body carries the TTL a pinger derives its cadence from', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-S1';

  const c = await claim(s, { name });
  assert.equal(c.status, 200, c.text);
  const h = await beat(s, { name, epoch: c.body.epoch });
  assert.equal(h.status, 200, h.text);
  assert.ok(Number.isInteger(h.body.expires_at), 'expires_at is unix-ms, not an ISO string');
  assert.equal(h.body.ttl_s, 90);
  assert.equal(h.body.lease_state, 'active');
  assert.equal(h.body.ttl_s / 3, 30, 'the documented renew cadence is TTL/3');
});

test('S1 — a pinger follows a server-side TTL change instead of hardcoding one', async (t) => {
  const s = await startServer({ FLEET_TTL_S: '30' });
  t.after(() => s.stop());
  const name = 'EDITH-S1b';

  const c = await claim(s, { name });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.ttl_s, 30, 'the claim body reports the server TTL');

  const h = await beat(s, { name, epoch: c.body.epoch });
  assert.equal(h.status, 200, h.text);
  assert.equal(h.body.ttl_s, 30);
  const left = h.body.expires_at - Date.now();
  assert.ok(left > 0 && left <= 31000, `the lease really runs on the shorter TTL (${left}ms left)`);
});

test('S7 — a heartbeat is liveness-only and cannot store a status', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-S7';

  const c = await claim(s, { name });
  // Defect 1 was a distress status arriving on the liveness path; the field has nowhere
  // to land, so distress must go through /api/registry instead.
  const h = await beat(s, { name, epoch: c.body.epoch, status: 'error', note: 'boom' });
  assert.equal(h.status, 200, h.text);

  const r = row(s, HOST, name);
  assert.equal(r.status, 'active', 'the heartbeat did not store a status');
  assert.equal(r.note, '', 'the heartbeat did not store a note');
});

test('M2 — leases are reachable over the tailnet, because a box pinger has no other route', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const name = 'EDITH-TAIL';

  const c = await s.tailPost('/api/lease/claim', { host: HOST, name });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.epoch, 1);

  const h = await s.tailPost('/api/heartbeat', { host: HOST, name, epoch: 1 });
  assert.equal(h.status, 200, h.text);
  assert.equal(h.body.lease_state, 'active');
  assert.equal(row(s, HOST, name).lease_state, 'active');
});

test('M2 — the lease routes gate method and body', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());

  const g = await s.get('/api/lease/claim');
  assert.equal(g.status, 405, 'a claim is a POST: ' + g.text);

  const empty = await s.post('/api/lease/claim', {});
  assert.equal(empty.status, 400, empty.text);
  assert.equal(empty.body.ok, false);
});
