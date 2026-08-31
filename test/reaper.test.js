// Milestone B — the reaper: M3 (every transition is a CAS), M4 (fence commits before the kill),
// M5 (second liveness sample), M6 (cascade guard), M7 (clock jumps and boot), M14 (a stopped
// reaper is visible), M15 (the warn is durable), S5 (retention, and no history rows).
//
// Every test drives reaperTick() by hand, in-process: a sweep is a step, not a race with a
// timer, so "what the tick did" is assertable instead of eventually-consistent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpdir, hostsFile, load, unload } = require('./helpers');

const FAKE_SSH = path.join(__dirname, 'fake-ssh.js');
const HOST = 'german-box';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// test/http.js hands out 3400-3810 from a sibling process and `node --test` runs the files in
// parallel, so this file stays well clear of that band: a shared port is an uncaught
// EADDRINUSE on the loopback listener, not a failed assertion.
let port = 3900;

// The Name pool script the reaper shells out to. It appends its argv so a test can assert
// both that a Name was released and, more importantly, that it was NOT.
const NAME_PY =
  'import sys, pathlib\n' +
  "with pathlib.Path(__file__).with_name('name.log').open('a') as f:\n" +
  "    f.write(' '.join(sys.argv[1:]) + '\\n')\n";

// FLEET_SSH_BIN for every instance here: a lock-taking shim in front of fake-ssh.js.
//   1. fake-ssh read-modify-writes one JSON state file per invocation and the reaper polls
//      its hosts in parallel, so without the lock an invocation reads a half-written file,
//      dies, and the tick reports a host down that is not.
//   2. state.killHard fails a kill-session the way an unreachable host does. fake-ssh's own
//      killFail answers "cant find session", which server.js correctly reads as already-gone,
//      so it can never exercise the retry path.
const wrapSrc = (fake) => `#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
const a = process.argv.slice(2);
const cmd = a[a.length - 1];
const host = a[a.length - 2];
const S = process.env.FLEET_FAKE_SSH_STATE;
const lock = S + '.lock';
const spin = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 10000;
for (;;) {
  try { fs.mkdirSync(lock); break; } catch (e) {
    if (Date.now() > deadline) { try { fs.rmdirSync(lock); } catch (e2) {} continue; }
    Atomics.wait(spin, 0, 0, 3);
  }
}
let code = 0;
try {
  const s = JSON.parse(fs.readFileSync(S, 'utf8'));
  if (s.killHard && /kill-session/.test(cmd)) {
    (s.calls = s.calls || []).push({ host, cmd, at: Date.now() });
    fs.writeFileSync(S, JSON.stringify(s, null, 2));
    fs.writeSync(2, 'ssh: connect to host ' + host + ' port 22: Connection timed out\\n');
    code = 255;
  } else {
    const r = spawnSync(process.execPath, [${JSON.stringify(fake)}, ...a], { stdio: 'inherit' });
    code = r.status === null ? 1 : r.status;
  }
} finally {
  try { fs.rmdirSync(lock); } catch (e) {}
}
process.exitCode = code;
`;

// Returns the loaded server module plus the seams a reaper test needs: its db, its fake-ssh
// state file, and tick() — one sweep, awaited.
function instance(opts = {}) {
  const dir = tmpdir('reaper');
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify(opts.state || { hosts: { 'german-box': { sessions: {} } }, calls: [] }));
  const namePy = path.join(dir, 'name.py');
  if (opts.nameScript) fs.writeFileSync(namePy, NAME_PY);
  const sshBin = path.join(dir, 'ssh-wrap.js');
  fs.writeFileSync(sshBin, wrapSrc(FAKE_SSH), { mode: 0o755 });
  const PORT = port++;
  const m = load({
    PORT,
    FLEET_DB: path.join(dir, 'fleet.db'),
    FLEET_HOSTS_FILE: hostsFile(dir, opts.hosts),
    FLEET_SSH_BIN: sshBin,
    FLEET_FAKE_SSH_STATE: state,
    FLEET_TTL_S: opts.ttl || '1',
    FLEET_SUSPECT_WINDOW_S: opts.suspect || '1',
    FLEET_NAME_CLOSE_SCRIPT: opts.nameScript ? namePy : '',
    ...(opts.env || {}),
  }, { listen: true });
  const base = 'http://127.0.0.1:' + PORT;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (u) => fetch(base + u).then(async (r) => ({ status: r.status, body: await r.json() }));
  return {
    m, post, get, dir, state,
    db: m.db,
    claim: (b) => post('/api/lease/claim', { host: HOST, ...b }),
    beat: (b) => post('/api/heartbeat', { host: HOST, ...b }),
    row: (host, name) => m.db.prepare('SELECT * FROM sessions WHERE host=? AND name=?').get(host, name),
    rows: () => m.db.prepare('SELECT * FROM sessions').all(),
    ssh: () => JSON.parse(fs.readFileSync(state, 'utf8')).calls.map((c) => c.cmd),
    setState: (f) => { const s = JSON.parse(fs.readFileSync(state, 'utf8')); f(s); fs.writeFileSync(state, JSON.stringify(s)); },
    nameLog: () => (fs.existsSync(path.join(dir, 'name.log'))
      ? fs.readFileSync(path.join(dir, 'name.log'), 'utf8').split('\n').filter(Boolean)
      : []),
    alerts: () => m.REAPER.alerts,
    tick: () => m.reaperTick(),
    stop: () => unload(m),
  };
}

// Claim, then wait out both the boot grace and the TTL, so the next tick is the first sweep
// that may move anything. With ttl=suspect=1s that is one sleep, not two.
async function armed(i, name, extra = {}) {
  const res = await i.claim({ name, ...extra });
  assert.equal(res.status, 200, 'claim: ' + JSON.stringify(res.body));
  return res.body.epoch;
}

test('M3 — a heartbeat racing a tick never leaves a row suspect with a future expiry', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  const names = ['EDITH-T-R1', 'EDITH-T-R2', 'EDITH-T-R3'];
  const epoch = {};
  for (const n of names) epoch[n] = await armed(i, n);

  await sleep(1100); // past the boot grace and past the 1s TTL: every row is now sweepable
  let renewed = 0;
  for (let round = 0; round < 3; round++) {
    // The beats are in flight before the tick's one await (pollHosts), which is exactly the
    // window M3 is about: read the row, yield, write. The CAS is what makes that safe.
    const beats = names.map((n) => i.beat({ name: n, epoch: epoch[n] }));
    const [, ...res] = await Promise.all([i.tick(), ...beats]);

    const bad = i.db
      .prepare("SELECT host, name, lease_state, expires_at FROM sessions WHERE lease_state IN ('suspect','reaped') AND expires_at > ?")
      .all(Date.now());
    assert.deepEqual(bad, [], 'round ' + round + ': a renewed row was left non-active');

    res.forEach((r, k) => {
      const row = i.row(HOST, names[k]);
      if (r.status === 200) {
        renewed += 1;
        assert.equal(row.lease_state, 'active', names[k] + ' beat 200 but the row is ' + row.lease_state);
        assert.ok(row.expires_at > Date.now() - 50, names[k] + ' beat 200 but the lease was not extended');
      } else {
        assert.equal(r.status, 410, names[k] + ' unexpected beat status ' + r.status);
        assert.equal(row.lease_state, 'reaped');
      }
    });
    await sleep(1100);
  }
  assert.ok(renewed > 0, 'no heartbeat ever landed — the race was never actually run');
});

test('M3 — the suspect CAS refuses a row whose lease is not actually expired', async (t) => {
  const i = instance({ ttl: '5', suspect: '1' }); // TTL outlives the 1s boot grace
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-S1');

  await sleep(1100); // grace is over, the lease is not
  await i.tick();

  const r = i.row(HOST, 'EDITH-T-S1');
  assert.equal(r.lease_state, 'active', 'a live lease was marked suspect');
  assert.equal(r.suspect_at, null);
  assert.equal(r.warned_at, null, 'a live lease must not be warned');
});

test('M3 — the reap CAS refuses a suspect whose warn is younger than the appeal window', async (t) => {
  const i = instance({ ttl: '1', suspect: '3' });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-S2');

  await sleep(3100); // boot grace is one suspect window
  await i.tick(); // suspect + warned, both in this tick
  const warned = i.row(HOST, 'EDITH-T-S2').warned_at;
  assert.ok(warned, 'the suspect was not warned');

  await i.tick(); // the appeal window has barely opened
  const r = i.row(HOST, 'EDITH-T-S2');
  assert.equal(r.lease_state, 'suspect', 'reaped before the appeal window closed');
  assert.equal(r.reaped_at, null);
  assert.equal(r.warned_at, warned, 'the warn was re-sent to an already-warned row');
});

test('M4 — the reaped CAS commits before tmux kill-session', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-K1');

  await sleep(1100);
  await i.tick(); // suspect + warned
  const before = i.ssh().length;
  await sleep(1100);
  await i.tick(); // reap + kill

  const calls = i.ssh().slice(before);
  const kill = calls.findIndex((c) => /tmux kill-session -t EDITH-T-K1$/.test(c));
  assert.ok(kill >= 0, 'no kill-session was sent: ' + JSON.stringify(calls));
  assert.ok(calls.slice(0, kill).some((c) => /tmux ls /.test(c)), 'the kill ran before this tick polled the host');

  const r = i.row(HOST, 'EDITH-T-K1');
  assert.equal(r.lease_state, 'reaped');
  assert.ok(r.reaped_at, 'the fence never committed');
  assert.ok(r.killed_at, 'the kill never landed');
  assert.ok(r.reaped_at <= r.killed_at, 'killed_at ' + r.killed_at + ' precedes reaped_at ' + r.reaped_at);
  assert.equal(r.status, 'killed', 'the registry row was not moved to killed');
});

test('M4 — a failed kill leaves the row reaped and retries on the next tick', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-K2');

  await sleep(1100);
  await i.tick(); // suspect + warned
  i.setState((s) => { s.killHard = true; }); // the host goes unreachable for kills only
  await sleep(1100);
  await i.tick(); // reap commits, kill fails

  const r1 = i.row(HOST, 'EDITH-T-K2');
  assert.equal(r1.lease_state, 'reaped', 'a failed kill must not roll the fence back');
  assert.ok(r1.reaped_at, 'reaped_at is unset even though the fence committed first');
  assert.equal(r1.killed_at, null, 'killed_at was written for a kill that failed');
  const listed = (await i.get('/api/sessions')).body.sessions.find((s) => s.name === 'EDITH-T-K2');
  assert.ok(listed, 'the row vanished from /api/sessions');
  assert.equal(listed.lease_state, 'reaped');

  i.setState((s) => { s.killHard = false; });
  await i.tick(); // the retry

  const r2 = i.row(HOST, 'EDITH-T-K2');
  assert.ok(r2.killed_at, 'the next tick did not retry the kill');
  assert.equal(r2.reaped_at, r1.reaped_at, 'the retry re-wrote reaped_at instead of only killing');
  assert.equal(r2.lease_state, 'reaped');
});

test('M4 — a Name is released only after the kill is confirmed', async (t) => {
  const i = instance({ nameScript: true });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-N1', { worker: 'Edith' });

  await sleep(1100);
  await i.tick();
  i.setState((s) => { s.killHard = true; });
  await sleep(1100);
  await i.tick(); // reaped, kill failed — the session may still be alive

  assert.deepEqual(i.nameLog(), [], 'a Name was released while the session was still provably alive');

  i.setState((s) => { s.killHard = false; });
  await i.tick();
  assert.deepEqual(i.nameLog(), ['close Edith'], 'the Name was not released exactly once after the kill');

  await i.tick(); // killed_at is set, so nothing here is idempotent-unsafe
  assert.deepEqual(i.nameLog(), ['close Edith'], 'the Name was released twice');
});

test('M4 — a mac row is never killed and never name-closed', async (t) => {
  const i = instance({ nameScript: true });
  t.after(() => i.stop());
  const res = await i.post('/api/lease/claim', { host: 'mac', name: 'ORCH-17', worker: 'Edith' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  await sleep(1100);
  await i.tick(); // suspect + warned (no channel, so warned without an ssh)
  await sleep(1100);
  await i.tick(); // reaped

  const r = i.row('mac', 'ORCH-17');
  assert.equal(r.lease_state, 'reaped', 'the mac row was not tombstoned');
  assert.equal(r.killed_at, null, 'a mac row must never be killed');
  assert.ok(!i.ssh().some((c) => /ORCH-17/.test(c)), 'ssh reached for a mac row: ' + JSON.stringify(i.ssh()));
  assert.deepEqual(i.nameLog(), [], 'a desktop lane Name was released — the session may still be alive');
});

test('M5 — a session with a killed pinger but an active tmux survives the sweep, flagged', async (t) => {
  const i = instance({ ttl: '1', suspect: '2' });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-P1');

  await sleep(2100); // boot grace is one suspect window
  await i.tick(); // suspect + warned
  await sleep(2100);
  // The terminal is alive; only the pinger died. Set the second source right before the tick
  // that would otherwise reap it — tmux reports activity in whole seconds.
  i.setState((s) => { s.hosts[HOST].sessions['EDITH-T-P1'] = { activity: Math.floor(Date.now() / 1000), created: 1 }; });
  const before = i.alerts().length;
  await i.tick();

  const r = i.row(HOST, 'EDITH-T-P1');
  assert.equal(r.pinger_dead, 1, 'a live tmux session was not flagged as a broken pinger');
  assert.equal(r.lease_state, 'suspect', 'a live tmux session was reaped');
  assert.equal(r.reaped_at, null);
  assert.ok(!i.ssh().some((c) => /kill-session/.test(c)), 'a live tmux session was killed');
  const raised = i.alerts().slice(before);
  assert.ok(raised.some((a) => /EDITH-T-P1/.test(a.message)), 'no alert named the saved session: ' + JSON.stringify(raised));
});

test('M5 — stale tmux activity does not save a session', async (t) => {
  const i = instance({ ttl: '1', suspect: '1' });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-P2');

  await sleep(1100);
  await i.tick();
  await sleep(1100);
  // Present in `tmux ls`, but last touched ten appeal windows ago: a corpse, not a session.
  i.setState((s) => { s.hosts[HOST].sessions['EDITH-T-P2'] = { activity: Math.floor(Date.now() / 1000) - 10, created: 1 }; });
  await i.tick();

  const r = i.row(HOST, 'EDITH-T-P2');
  assert.equal(r.lease_state, 'reaped', 'stale tmux activity saved a dead session');
  assert.equal(r.pinger_dead, null);
  assert.ok(r.killed_at, 'the reaped session was not killed');
  assert.ok(i.ssh().some((c) => /kill-session -t EDITH-T-P2$/.test(c)));
});

test('M6 — a simulated partition reaps nothing and raises one alert', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-C1');
  await armed(i, 'EDITH-T-C2');

  await sleep(1100);
  await i.tick(); // both suspect + warned, while the host is still reachable
  await sleep(1100);
  // "Unreachable" must never read as "all dead": the poll is the only evidence that would
  // have said these sessions are gone.
  i.setState((s) => { s.hosts[HOST].pollFail = true; });
  const before = i.alerts().length;
  const killsBefore = i.ssh().filter((c) => /kill-session/.test(c)).length;
  await i.tick();

  for (const n of ['EDITH-T-C1', 'EDITH-T-C2']) {
    const r = i.row(HOST, n);
    assert.equal(r.lease_state, 'suspect', n + ' was reaped through a partition');
    assert.equal(r.reaped_at, null);
  }
  assert.equal(i.ssh().filter((c) => /kill-session/.test(c)).length, killsBefore, 'a kill was sent through a partition');
  const raised = i.alerts().slice(before);
  assert.ok(raised.length >= 1 && raised.some((a) => a.host === HOST), 'the guard tripped silently: ' + JSON.stringify(raised));
  assert.ok(raised.every((a) => /cascade guard/.test(a.message)));
});

test('M6 — more than K sessions crossing in one tick is refused', async (t) => {
  const i = instance({ env: { FLEET_CASCADE_K: '1' } });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-C3');
  await armed(i, 'EDITH-T-C4');
  const live = await armed(i, 'EDITH-T-C5'); // keeps the host from tripping the whole-host rule

  await sleep(1100);
  await i.beat({ name: 'EDITH-T-C5', epoch: live });
  await i.tick(); // C3/C4 suspect + warned, C5 still active
  await sleep(1100);
  await i.beat({ name: 'EDITH-T-C5', epoch: live });
  const before = i.alerts().length;
  await i.tick();

  for (const n of ['EDITH-T-C3', 'EDITH-T-C4'])
    assert.equal(i.row(HOST, n).lease_state, 'suspect', n + ' was reaped past K=1');
  assert.ok(!i.ssh().some((c) => /kill-session/.test(c)));
  const raised = i.alerts().slice(before);
  assert.equal(raised.length, 1, 'expected exactly the K trip: ' + JSON.stringify(raised));
  assert.match(raised[0].message, /2 sessions would be reaped in one tick \(K=1\)/);
});

test('M6 — a whole host crossing at once is refused even under K', async (t) => {
  const i = instance({ env: { FLEET_CASCADE_K: '5' } });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-C6');
  await armed(i, 'EDITH-T-C7');

  await sleep(1100);
  await i.tick();
  await sleep(1100);
  const before = i.alerts().length;
  await i.tick(); // 2 candidates, K=5 — only the whole-host rule can save them

  for (const n of ['EDITH-T-C6', 'EDITH-T-C7'])
    assert.equal(i.row(HOST, n).lease_state, 'suspect', n + ' was reaped with its whole host');
  assert.ok(!i.ssh().some((c) => /kill-session/.test(c)));
  const raised = i.alerts().slice(before);
  assert.equal(raised.length, 1, 'expected exactly the whole-host trip: ' + JSON.stringify(raised));
  assert.match(raised[0].message, /every session on this host/);
  assert.equal(raised[0].host, HOST);
});

test('M6 — under the guard\'s limits the reap proceeds', async (t) => {
  const hosts = ['box-a', 'box-b', 'box-c'];
  const state = { hosts: {}, calls: [] };
  for (const h of hosts) state.hosts[h] = { sessions: { ['LIVE-' + h]: { activity: Math.floor(Date.now() / 1000), created: 1 } } };
  const i = instance({ hosts, state, env: { FLEET_CASCADE_K: '3' } });
  t.after(() => i.stop());

  const epochs = {};
  for (const h of hosts) {
    await i.post('/api/lease/claim', { host: h, name: 'DEAD-' + h });
    epochs[h] = (await i.post('/api/lease/claim', { host: h, name: 'LIVE-' + h })).body.epoch;
  }
  const beatLive = () => Promise.all(hosts.map((h) => i.post('/api/heartbeat', { host: h, name: 'LIVE-' + h, epoch: epochs[h] })));

  await sleep(1100);
  await beatLive();
  await i.tick(); // the three DEAD rows go suspect + warned
  await sleep(1100);
  await beatLive();
  const before = i.alerts().length;
  await i.tick();

  assert.deepEqual(i.alerts().slice(before), [], 'the guard tripped when nothing was wrong');
  for (const h of hosts) {
    const dead = i.row(h, 'DEAD-' + h);
    assert.equal(dead.lease_state, 'reaped', 'DEAD-' + h + ' survived a clean sweep');
    assert.ok(dead.killed_at, 'DEAD-' + h + ' was fenced but never killed');
    assert.equal(i.row(h, 'LIVE-' + h).lease_state, 'active', 'LIVE-' + h + ' was swept with its host');
  }
});

test('M7 — a 2xTTL wall-clock jump reaps nothing for a full window', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-J1');

  await sleep(1100);
  await i.tick(); // suspect + warned
  await sleep(1100); // the appeal window is open: the next tick would reap
  assert.equal((await i.get('/api/health')).body.reaper_grace, null, 'still in the boot grace');

  // The check compares elapsed wall against elapsed monotonic, so a stale lastWall is exactly
  // what a sleeping Mac or an NTP step looks like from inside the tick.
  const before = i.alerts().length;
  i.m.REAPER.lastWall = Date.now() - 5 * 1000;
  await i.tick();

  const raised = i.alerts().slice(before);
  assert.ok(raised.some((a) => /wall clock jumped/.test(a.message)), 'no clock-jump alert: ' + JSON.stringify(raised));
  assert.equal((await i.get('/api/health')).body.reaper_grace, 'clock-jump');
  assert.equal(i.row(HOST, 'EDITH-T-J1').lease_state, 'suspect', 'reaped on the tick that saw the jump');

  await i.tick();
  assert.equal(i.row(HOST, 'EDITH-T-J1').lease_state, 'suspect', 'reaped inside the re-armed window');

  await sleep(1100);
  await i.tick();
  assert.equal(i.row(HOST, 'EDITH-T-J1').lease_state, 'reaped', 'the sweep never resumed after the window');
});

test('M7 — the boot grace blocks reaps for one full suspect window', async (t) => {
  const i = instance({ ttl: '1', suspect: '3' });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-B1');

  await sleep(1500); // past the 1s TTL, inside the 3s grace
  await i.tick();

  const r = i.row(HOST, 'EDITH-T-B1');
  assert.equal(r.lease_state, 'active', 'the boot grace let a row go suspect');
  assert.equal(r.suspect_at, null);
  assert.equal(r.reaped_at, null);
  assert.equal((await i.get('/api/health')).body.reaper_grace, 'boot');

  await sleep(2000); // grace over
  await i.tick();
  const after = i.row(HOST, 'EDITH-T-B1');
  assert.equal(after.lease_state, 'suspect', 'the sweep never resumed after the boot grace');
  assert.ok(after.suspect_at);
  assert.equal((await i.get('/api/health')).body.reaper_grace, null);
});

test('M14 — a stopped reaper is visible within two ticks', async (t) => {
  const i = instance({ env: { FLEET_REAPER_TICK_S: '7' } });
  t.after(() => i.stop());

  const h0 = (await i.get('/api/health')).body;
  assert.equal(h0.reaper_last_tick_at, null, 'a reaper that has never ticked must read as never ticked');
  assert.equal(h0.reaper_ticks, 0);
  assert.equal(h0.reaper_tick_s, 7, 'health does not report the configured tick period');

  await i.tick();
  const h1 = (await i.get('/api/health')).body;
  assert.equal(h1.reaper_ticks, 1);
  assert.ok(Number.isInteger(h1.reaper_last_tick_at) && h1.reaper_last_tick_at > 0);

  await sleep(10);
  await i.tick();
  const h2 = (await i.get('/api/health')).body;
  assert.equal(h2.reaper_ticks, 2);
  assert.ok(h2.reaper_last_tick_at > h1.reaper_last_tick_at, 'the tick age did not advance');
});

test('M14 — every transition is logged with its epoch and a reason', async (t) => {
  const i = instance();
  const real = console.log;
  t.after(() => { console.log = real; return i.stop(); });
  await armed(i, 'EDITH-T-L1');

  await sleep(1100);
  const seen = [];
  console.log = (...a) => seen.push(a.join(' '));
  await i.tick(); // suspect + warned
  await sleep(1100);
  await i.tick(); // reaped + killed
  console.log = real;

  const lines = seen.filter((l) => /^\[lifecycle\]/.test(l) && /EDITH-T-L1/.test(l));
  for (const re of [/suspect .*epoch=1/, /warned .*epoch=1/, /reaped .*epoch=1/, /killed .*epoch=1/])
    assert.ok(lines.some((l) => re.test(l)), 'no lifecycle line matching ' + re + ':\n' + lines.join('\n'));
  // A transition logged without a reason is a log that cannot be read after the fact.
  assert.ok(lines.every((l) => /epoch=1 \S/.test(l)), 'a lifecycle line carries no reason:\n' + lines.join('\n'));
});

test('M15 — a restart re-warns an unwarned suspect before any reap', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-W1');

  // An unreachable host fails every ssh, the warn included. fake-ssh's pollFail only covers
  // `tmux ls`, so the host is removed outright — that is what an ssh failure looks like.
  const park = () => i.setState((s) => { s.parked = s.hosts[HOST]; delete s.hosts[HOST]; });
  const unpark = () => i.setState((s) => { s.hosts[HOST] = s.parked; delete s.parked; });

  await sleep(1100);
  park();
  await i.tick(); // suspect, warn undelivered
  assert.equal(i.row(HOST, 'EDITH-T-W1').lease_state, 'suspect');
  assert.equal(i.row(HOST, 'EDITH-T-W1').warned_at, null, 'warned_at was set for a warn that never arrived');

  await sleep(1100);
  await i.tick(); // the appeal window would be over — if the warn had ever been delivered
  assert.equal(i.row(HOST, 'EDITH-T-W1').warned_at, null);
  assert.equal(i.row(HOST, 'EDITH-T-W1').lease_state, 'suspect', 'reaped without ever being warned');
  assert.ok(!i.ssh().some((c) => /kill-session/.test(c)));

  unpark();
  await i.tick(); // the warn is re-sent, and only now does the appeal window open
  const warned = i.row(HOST, 'EDITH-T-W1').warned_at;
  assert.ok(warned, 'the warn was never re-sent');
  assert.equal(i.row(HOST, 'EDITH-T-W1').lease_state, 'suspect', 'reaped in the same tick as its first warn');

  await sleep(1100);
  await i.tick();
  const r = i.row(HOST, 'EDITH-T-W1');
  assert.equal(r.lease_state, 'reaped');
  assert.ok(r.reaped_at - warned >= 1000, 'reaped ' + (r.reaped_at - warned) + 'ms after the warn, inside the appeal window');
});

test('M15 — the warn text obeys the zero-quote rule', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-W2');

  await sleep(1100);
  await i.tick();

  const warn = i.ssh().filter((c) => /display-message/.test(c));
  assert.equal(warn.length, 1, 'expected exactly one warn: ' + JSON.stringify(warn));
  // A quote anywhere makes fake-ssh exit 99, so this is also asserted by warned_at below:
  // a warn that did not survive ssh -> CMD -> wsl -> bash leaves the row unwarned.
  assert.ok(!/['"`]/.test(warn[0]), 'the warn carries a quote: ' + warn[0]);
  assert.match(warn[0], /^wsl tmux display-message -d 10000 -t EDITH-T-W2 \S+$/);
  assert.ok(i.row(HOST, 'EDITH-T-W2').warned_at, 'the warn was rejected before delivery');
});

test('M15 — a mac suspect is marked warned without an ssh', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  const res = await i.post('/api/lease/claim', { host: 'mac', name: 'ORCH-18' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  await sleep(1100);
  await i.tick();

  const r = i.row('mac', 'ORCH-18');
  assert.equal(r.lease_state, 'suspect');
  assert.ok(r.warned_at, 'a mac suspect was never marked warned, so it could never be tombstoned');
  assert.ok(!i.ssh().some((c) => /display-message/.test(c) && /ORCH-18/.test(c)), 'ssh warned a row with no channel');
});

test('S5 — reaped rows are pruned after the retention window and nothing else is', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-OLD');

  await sleep(1100);
  await i.tick();
  await sleep(1100);
  await i.tick(); // EDITH-T-OLD is reaped and killed
  assert.equal(i.row(HOST, 'EDITH-T-OLD').lease_state, 'reaped');

  const day = 86400 * 1000;
  i.db.prepare('UPDATE sessions SET reaped_at = ? WHERE host = ? AND name = ?').run(Date.now() - 15 * day, HOST, 'EDITH-T-OLD');
  const ins = i.db.prepare(
    'INSERT INTO sessions (host, name, epoch, lease_state, expires_at, reaped_at, reap_reason, killed_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  ins.run(HOST, 'EDITH-T-RECENT', 1, 'reaped', Date.now() - 5000, Date.now() - day, 'lease expired', Date.now() - day);
  ins.run(HOST, 'EDITH-T-LIVE', 1, 'active', Date.now() + 600000, null, null, null);

  await i.tick();

  const names = i.rows().map((r) => r.name).sort();
  assert.deepEqual(names, ['EDITH-T-LIVE', 'EDITH-T-RECENT'], 'retention pruned the wrong rows');
  assert.equal(i.row(HOST, 'EDITH-T-LIVE').lease_state, 'active');
});

test('S5 — a heartbeat updates in place and writes no history row', async (t) => {
  const i = instance({ ttl: '5' });
  t.after(() => i.stop());
  const epoch = await armed(i, 'EDITH-T-H1');

  let last = i.row(HOST, 'EDITH-T-H1').expires_at;
  for (let n = 0; n < 5; n++) {
    await sleep(5); // the ms clock must tick, or a real renewal looks like none
    const res = await i.beat({ name: 'EDITH-T-H1', epoch });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = i.row(HOST, 'EDITH-T-H1');
    assert.ok(r.expires_at > last, 'beat ' + n + ' renewed nothing');
    last = r.expires_at;
  }

  assert.equal(i.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1, 'a heartbeat wrote a history row');
  assert.equal(i.row(HOST, 'EDITH-T-H1').epoch, epoch, 'a heartbeat moved the epoch');
});

// XYZ-1904 — the guard fired 4618 times against a box that was answering fine. Both causes
// were in tmuxSample(), the one place the tick's liveness sample and the per-session re-check
// share; both made a REACHABLE host read as unreachable, which stops every reap on that host.
test('M6 — the tick prefixes a WSL host and does not prefix a linux one', async (t) => {
  const LINUX = 'onboarding-box';
  const i = instance({
    hosts: [HOST, { name: LINUX, kind: 'linux' }],
    state: { hosts: { [HOST]: { sessions: {} }, [LINUX]: { sessions: {} } }, calls: [] },
  });
  t.after(() => i.stop());

  await i.tick();

  // `ssh german-box tmux ls` lands in Windows CMD, which says `'tmux' is not recognized` — an
  // error with no idle wording in it, so the host reads as down on every tick forever. The
  // fixture answers either shape, so only the argv itself can catch this.
  const calls = JSON.parse(fs.readFileSync(i.state, 'utf8')).calls.filter((c) => /tmux ls /.test(c.cmd));
  const forHost = (h) => calls.filter((c) => c.host === h).map((c) => c.cmd);

  assert.ok(forHost(HOST).length, 'the tick never sampled the WSL host: ' + JSON.stringify(calls));
  for (const c of forHost(HOST)) assert.match(c, /^wsl tmux ls /, 'a WSL host needs the prefix: ' + c);

  // The other half of remote(): a linux host runs tmux directly and `wsl` is not a command there.
  assert.ok(forHost(LINUX).length, 'the tick never sampled the linux host: ' + JSON.stringify(calls));
  for (const c of forHost(LINUX)) assert.match(c, /^tmux ls /, 'a linux host takes no prefix: ' + c);
});

test('M6 — an idle tmux socket is reachable, not a failing poll', async (t) => {
  const i = instance({ state: { hosts: { [HOST]: { idleAsSocketError: true, sessions: {} } }, calls: [] } });
  t.after(() => i.stop());
  await armed(i, 'EDITH-T-W1');
  const live = await armed(i, 'EDITH-T-W2');

  await sleep(1100);
  await i.tick(); // both suspect + warned
  // One candidate only: with two, the whole-host rule trips and would mask what is under test.
  assert.equal((await i.beat({ name: 'EDITH-T-W2', epoch: live })).status, 200);
  // A row is only a candidate once its warn has aged past the suspect window. Without this
  // sleep the candidate list is empty, the guard is never reached, and this test passes on
  // a deck that gets the answer wrong — which is what it did before the sleep was added.
  await sleep(1100);

  const before = i.alerts().length;
  await i.tick();

  // tmux 3.4 and 3.6 both report a socket that was never created as `error connecting to
  // <path> (No such file or directory)`. Read as an ssh failure, that pins the whole host.
  const raised = i.alerts().slice(before);
  assert.deepEqual(
    raised.filter((a) => /ssh poll is failing/.test(a.message)),
    [],
    'an idle host was called unreachable: ' + JSON.stringify(raised)
  );
  // And say so positively, so the test cannot pass by never reaching the guard at all: the
  // absence of an alert is only meaningful if this row really was a candidate this tick.
  assert.equal(
    i.row(HOST, 'EDITH-T-W1').lease_state,
    'reaped',
    'the row never became a candidate, so the guard was never asked: ' + JSON.stringify(i.row(HOST, 'EDITH-T-W1'))
  );
});
