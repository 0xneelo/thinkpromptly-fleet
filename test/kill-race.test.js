// The kill path's races. These are the failures that cost a live worker: a kill dispatched at a
// name whose owner has changed, a Name released for a session that is still running, a row
// deleted before anyone confirmed the thing it describes is dead.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpdir, hostsFile, load, unload } = require('./helpers');

const FAKE_SSH = path.join(__dirname, 'fake-ssh.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port = 24000 + Math.floor(Math.random() * 4000);

function instance(opts = {}) {
  const dir = opts.dir || tmpdir('killrace');
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(
    state,
    JSON.stringify({ hosts: { 'german-box': { sessions: {} } }, calls: [], ...(opts.state || {}) })
  );
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
  const post = (u, b) =>
    fetch(base + u, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  return {
    m, post, dir, state,
    // The lifecycle waits below are derived from this instance's own clock settings rather
    // than hardcoded, so a test can widen a window without every sleep going stale.
    ttlMs: Number(env.FLEET_TTL_S) * 1000,
    windowMs: Number(env.FLEET_SUSPECT_WINDOW_S) * 1000,
    row: (n) => m.db.prepare('SELECT * FROM sessions WHERE host = ? AND name = ?').get('german-box', n),
    ssh: () => JSON.parse(fs.readFileSync(state, 'utf8')).calls.map((c) => c.cmd),
    patch: (f) => {
      const s = JSON.parse(fs.readFileSync(state, 'utf8'));
      f(s);
      fs.writeFileSync(state, JSON.stringify(s));
    },
    tick: () => m.reaperTick(),
    stop: () => unload(m),
  };
}

// Drives one session from claim to the tick that is about to reap it. Every wait here is a
// lower bound — sleeping longer than asked only makes the next step more certain — so a loaded
// box cannot break them. The deadlines that a loaded box CAN break are the ones below, and
// those wait for the evidence instead of guessing at a duration.
async function toReapEdge(i, name, extra = {}) {
  const c = await i.post('/api/lease/claim', { host: 'german-box', name, worker: 'Edith', ...extra });
  await sleep(Math.max(i.ttlMs, i.windowMs) + 100); // clear the boot grace and expire the lease
  await i.tick(); // suspect + warn
  await sleep(i.windowMs + 100); // clear the appeal window
  return c.body.epoch;
}

// Polls for something the fixture has recorded, up to a bound, and says what it was waiting for
// when it gives up. `await sleep(250)` in place of this is a deadline: it assumes the deck gets
// somewhere within 250ms, and under load it does not — the reap for M4 below landed after the
// row had already been deleted, which read as the alert never being raised.
async function until(what, cond, ms = 20000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timed out after ' + ms + 'ms waiting for ' + what);
    await sleep(5);
  }
}

// fake-ssh records a call before it starts stalling on killDelayMs, so a recorded kill-session
// means the kill is dispatched and the window is open for as long as that stall lasts.
const killInFlight = (i) => () => i.ssh().some((c) => /kill-session/.test(c));

test('M4 — a claim is refused while its predecessor\'s kill is still in flight', async (t) => {
  // `tmux kill-session` names only the session, so a claim that lands mid-kill would hand the
  // new incarnation a name the reaper is at that moment destroying.
  const i = instance({ state: { killDelayMs: 3000, hosts: { 'german-box': { sessions: { 'EDITH-T-1': { activity: 1 } } } } } });
  t.after(() => i.stop());
  await toReapEdge(i, 'EDITH-T-1');

  const ticking = i.tick();
  await until('the kill to reach the fake ssh', killInFlight(i)); // it is now blocked in there
  const during = await i.post('/api/lease/claim', { host: 'german-box', name: 'EDITH-T-1' });
  assert.equal(during.status, 409);
  assert.match(during.body.error, /kill is in flight/);
  assert.equal(i.row('EDITH-T-1').epoch, 1, 'the refused claim moved no epoch');

  await ticking;
  const after = await i.post('/api/lease/claim', { host: 'german-box', name: 'EDITH-T-1' });
  assert.equal(after.status, 200, 'M1 still holds: the re-claim succeeds once the kill has landed');
  assert.equal(after.body.epoch, 2);
});

test('M4 — a kill whose row vanished mid-flight stamps nothing and raises an alert', async (t) => {
  // The CAS on killed_at is the last line of defence: if the row is not the one that was fenced,
  // the reaper must not mark it killed, must not release its Name, and must say what happened.
  // The script path is read once at module load, so it has to be in place before the server is.
  const dir = tmpdir('killrace-orphan');
  const nameLog = path.join(dir, 'name.log');
  const script = path.join(dir, 'name.py');
  fs.writeFileSync(script, 'import sys\nopen(r"' + nameLog + '","a").write(" ".join(sys.argv[1:])+"\\n")\n');
  const i = instance({
    dir,
    env: { FLEET_NAME_CLOSE_SCRIPT: script },
    state: { killDelayMs: 3000, hosts: { 'german-box': { sessions: { 'EDITH-T-1': { activity: 1 } } } } },
  });
  t.after(() => i.stop());

  await toReapEdge(i, 'EDITH-T-1');
  const ticking = i.tick();
  await until('the kill to reach the fake ssh', killInFlight(i));
  // Delete the row out from under the in-flight kill — the one write path that can still do it.
  i.m.db.prepare('DELETE FROM sessions WHERE host = ? AND name = ?').run('german-box', 'EDITH-T-1');
  await ticking;

  assert.equal(i.row('EDITH-T-1'), undefined, 'the row really is gone');
  assert.ok(!fs.existsSync(nameLog), 'no Name was released for a row the reaper could not confirm');
  const alerts = i.m.REAPER.alerts.map((a) => a.message).join('\n');
  assert.match(alerts, /changed incarnation while its predecessor was being killed/);

  // Control: the same instance DOES release a Name when the kill is confirmed against a row that
  // is still the one that was fenced — otherwise the assertion above proves only that the
  // name-close wiring is dead.
  i.patch((s) => { s.killDelayMs = 0; s.hosts['german-box'].sessions['EDITH-T-2'] = { activity: 1 }; });
  await i.post('/api/lease/claim', { host: 'german-box', name: 'EDITH-T-2', worker: 'Edith' });
  await sleep(Math.max(i.ttlMs, i.windowMs) + 100);
  await i.tick();
  await sleep(i.windowMs + 100);
  await i.tick();
  assert.equal(i.row('EDITH-T-2').lease_state, 'reaped');
  assert.match(fs.readFileSync(nameLog, 'utf8'), /^close Edith$/m, 'the Name is released on a clean reap');
});

test('M5 — a session that reappears between the tick poll and the reap decision is not killed', async (t) => {
  // The opening poll is one sample of the whole fleet; the decision is taken per session, later.
  // `appearAfterLs: 1` makes the session invisible to the first sample and visible to the second.
  // The window is widened to 3s for this test alone. The claim under test is "tmux says this
  // session was active inside the suspect window, so it is a broken pinger, not a corpse", and
  // the deck measures that against `Math.floor(activity_seconds) * 1000`. At a 1s window a
  // literal `Math.floor(Date.now()/1000)` spent a uniform 0-999ms of the budget on truncation
  // alone before the tick's own ssh round trips were charged to it — measured 252ms to 949ms of
  // the 1000ms, so roughly one run in four reaped instead. 'now' below removes the truncation
  // and the wider window removes the rest of the deadline; neither touches what is asserted.
  const i = instance({
    env: { FLEET_SUSPECT_WINDOW_S: '3' },
    state: {
      hosts: {
        'german-box': {
          // Two `tmux ls` calls precede the decision — the previous tick's poll and this one's —
          // so the session is visible only to the third, which is the per-candidate sample.
          sessions: { 'EDITH-T-1': { activity: 1, appearAfterLs: 2 } },
        },
      },
    },
  });
  t.after(() => i.stop());
  await toReapEdge(i, 'EDITH-T-1');
  i.patch((s) => { s.hosts['german-box'].sessions['EDITH-T-1'].activity = 'now'; });
  await i.tick();

  const r = i.row('EDITH-T-1');
  assert.equal(r.lease_state, 'suspect', 'the fence never closed on a session that came back');
  assert.equal(r.pinger_dead, 1, 'it is flagged as a broken pinger instead');
  assert.equal(r.reaped_at, null);
  assert.ok(!i.ssh().some((c) => /kill-session/.test(c)), 'and nothing was killed');
});

test('M5 — a host that stops answering mid-tick defers the reap instead of taking it on trust', async (t) => {
  const i = instance();
  t.after(() => i.stop());
  await toReapEdge(i, 'EDITH-T-1');
  i.patch((s) => { s.hosts['german-box'].pollFail = true; });
  await i.tick();

  const r = i.row('EDITH-T-1');
  assert.equal(r.lease_state, 'suspect', 'no evidence, no reap');
  assert.equal(r.reaped_at, null);
});

test('S5 — retention keeps a reaped row whose kill was never confirmed', async (t) => {
  // Deleting it would end the retry contract for a session nobody ever saw die, and the next
  // poll would re-create it as a bare sighting with no lifecycle history at all.
  // killHard keeps the unconfirmed row unconfirmed: without it the same tick would kill it,
  // stamp killed_at, and prune it, which is the behaviour under test.
  const i = instance({ state: { killHard: true } });
  t.after(() => i.stop());
  const old = Date.now() - 20 * 86400 * 1000;
  const put = (name, killedAt) =>
    i.m.db
      .prepare(
        `INSERT INTO sessions (host, name, created_at, updated_at, lease_state, epoch, expires_at, reaped_at, killed_at)
         VALUES ('german-box', ?, '', '', 'reaped', 1, 0, ?, ?)`
      )
      .run(name, old, killedAt);
  put('EDITH-T-KILLED', old);
  put('EDITH-T-UNKILLED', null);
  i.m.db
    .prepare(
      `INSERT INTO sessions (host, name, created_at, updated_at, lease_state, epoch, expires_at, reaped_at, killed_at)
       VALUES ('mac', 'ORCH-OLD', '', '', 'reaped', 1, 0, ?, NULL)`
    )
    .run(old);

  await sleep(Math.max(i.ttlMs, i.windowMs) + 100);
  await i.tick();

  const names = i.m.db.prepare('SELECT host, name FROM sessions').all().map((r) => r.host + '/' + r.name);
  assert.ok(!names.includes('german-box/EDITH-T-KILLED'), 'a confirmed-dead row past the window is pruned');
  assert.ok(!names.includes('mac/ORCH-OLD'), 'a mac row is never killed, so it prunes on age alone');
  assert.ok(
    names.includes('german-box/EDITH-T-UNKILLED'),
    'a box row whose kill never landed is kept as evidence'
  );
});

test('M4 — re-claiming over an unconfirmed kill succeeds, but never quietly', async (t) => {
  // M1 requires the re-claim to succeed, and tmux names are unique so a new session under this
  // name means the old one is already gone. But it drops a standing kill obligation, and the row
  // is the only record of it — losing that silently is how a leak becomes invisible.
  const i = instance({ state: { killHard: true } });
  t.after(() => i.stop());
  await toReapEdge(i, 'EDITH-T-1');
  await i.tick();

  const reaped = i.row('EDITH-T-1');
  assert.equal(reaped.lease_state, 'reaped');
  assert.equal(reaped.killed_at, null, 'the kill genuinely failed');

  const again = await i.post('/api/lease/claim', { host: 'german-box', name: 'EDITH-T-1' });
  assert.equal(again.status, 200, 'M1 holds — the re-claim is not blocked');
  assert.equal(again.body.epoch, 2);
  assert.equal(i.row('EDITH-T-1').lease_state, 'active');

  const alerts = i.m.REAPER.alerts.map((a) => a.message).join('\n');
  assert.match(alerts, /re-claimed while a kill for epoch 1 was still owed/);
});

test('M4 — the retry pass skips a host this tick could not reach', async (t) => {
  // One permanently dead host with N stuck rows would otherwise cost N full ssh timeouts every
  // tick, stalling the sweep for every other host behind it.
  const i = instance({ state: { killHard: true } });
  t.after(() => i.stop());
  await toReapEdge(i, 'EDITH-T-1');
  await i.tick();
  assert.equal(i.row('EDITH-T-1').killed_at, null);

  const before = i.ssh().filter((c) => /kill-session/.test(c)).length;
  assert.ok(before >= 1, 'the first attempt did happen');
  i.patch((s) => { s.hosts['german-box'].pollFail = true; });
  await i.tick();
  assert.equal(
    i.ssh().filter((c) => /kill-session/.test(c)).length,
    before,
    'no kill was attempted against a host that did not answer its poll'
  );

  i.patch((s) => { s.hosts['german-box'].pollFail = false; s.killHard = false; });
  await i.tick();
  assert.ok(i.row('EDITH-T-1').killed_at !== null, 'and the retry lands once the host is back');
});
