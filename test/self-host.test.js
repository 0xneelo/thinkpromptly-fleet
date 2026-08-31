// XYZ-1890 M5, seam 5 — 'mac' was never a hostname, it was this deck's word for *itself*.
// Fifteen sites in server.js spelled it as a literal and every one but the boot line meant
// "reach this one locally, never ssh to it". That was true only while home ran on the
// operator's Mac; hosts.json already lists german-box, so a home deck there would have ssh'd
// into itself on every poll loop.
//
// The first test is the one that matters most: with no FLEET_SELF_HOST set, a `mac` row still
// behaves exactly as it does today — and it proves that against real reaper behaviour, not by
// reading the constant back. Everything after it is opt-in, the same shape M1 gave FLEET_ROLE.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./http');
const { tmpdir, hostsFile, boot, load, unload } = require('./helpers');

const FAKE_SSH = path.join(__dirname, 'fake-ssh.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DARWIN = process.platform === 'darwin';

// test/http.js hands out ports from 20000 up and test/reaper.test.js owns 3900+; `node --test`
// runs the files in parallel, so this one takes a band of its own. A shared port is an uncaught
// EADDRINUSE on the loopback listener, not a failed assertion.
let port = 4100 + Math.floor(Math.random() * 300);

// An in-process deck whose reaper ticks are steps, not races — the reaper.test.js shape, minus
// the killHard wrapper (nothing here needs a kill to fail the way an unreachable host does).
function instance(opts = {}) {
  const dir = tmpdir('selfhost');
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify(opts.state || { hosts: { 'german-box': { sessions: {} } }, calls: [] }));
  const PORT = port++;
  const m = load(
    {
      PORT,
      FLEET_DB: path.join(dir, 'fleet.db'),
      FLEET_HOSTS_FILE: hostsFile(dir, opts.hosts),
      FLEET_SSH_BIN: FAKE_SSH,
      FLEET_FAKE_SSH_STATE: state,
      FLEET_TTL_S: '1',
      FLEET_SUSPECT_WINDOW_S: '1',
      FLEET_SELF_HOST: opts.self || '',
    },
    { listen: true }
  );
  const base = 'http://127.0.0.1:' + PORT;
  const post = (u, b) =>
    fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
      .then(async (r) => ({ status: r.status, body: await r.json() }));
  return {
    m, post, dir, state,
    db: m.db,
    get: (u) => fetch(base + u).then(async (r) => ({ status: r.status, body: await r.json() })),
    row: (host, name) => m.db.prepare('SELECT * FROM sessions WHERE host=? AND name=?').get(host, name),
    names: () => m.db.prepare('SELECT host, name FROM sessions').all().map((r) => r.host + '/' + r.name),
    // Every ssh the deck opened, host and command: the seam's whole point is what is NOT here.
    calls: () => JSON.parse(fs.readFileSync(state, 'utf8')).calls,
    setState: (f) => {
      const st = JSON.parse(fs.readFileSync(state, 'utf8'));
      f(st);
      fs.writeFileSync(state, JSON.stringify(st));
    },
    sshHosts: () => [...new Set(JSON.parse(fs.readFileSync(state, 'utf8')).calls.map((c) => c.host))],
    alerts: () => m.REAPER.alerts,
    tick: () => m.reaperTick(),
    stop: () => unload(m),
  };
}

// Claim, then wait out the boot grace and the TTL together, so the next tick is the first
// sweep that may move anything.
async function armed(i, host, name) {
  const res = await i.post('/api/lease/claim', { host, name });
  assert.equal(res.status, 200, 'claim ' + host + '/' + name + ': ' + JSON.stringify(res.body));
  return res.body.epoch;
}

// suspect+warn, then reap: two ticks with the window between them.
async function sweepToReap(i) {
  await sleep(1100);
  await i.tick();
  await sleep(1100);
  await i.tick();
}

const oldReaped = (i, host, name) =>
  i.db
    .prepare(
      `INSERT INTO sessions (host, name, created_at, updated_at, lease_state, epoch, expires_at, reaped_at, killed_at)
       VALUES (?, ?, '', '', 'reaped', 1, 0, 1, NULL)`
    )
    .run(host, name);

test('the headline — with no FLEET_SELF_HOST, a mac row behaves exactly as it does today', async (t) => {
  const i = instance(); // hosts.json: german-box only. Nothing names 'mac' but the default.
  t.after(() => i.stop());

  // 1. Still leasable, though it is in no hosts.json.
  await armed(i, 'mac', 'ORCH-17');
  await sweepToReap(i);

  const r = i.row('mac', 'ORCH-17');
  // 2. Still warned without a tmux to warn into — the 410 body is its appeal path.
  assert.ok(r.warned_at, 'the self row was never warned, so it could never be tombstoned');
  // 3. Still reaped, and still never ssh-killed.
  assert.equal(r.lease_state, 'reaped');
  assert.equal(r.killed_at, null, 'self was ssh-killed');
  // 4. Still exempt from the cascade guard's ssh-poll trip: self has no ssh sample to fail, so
  //    a lone self candidate reaps instead of stalling the whole tick behind an alert.
  assert.deepEqual(i.alerts().filter((a) => /cascade guard/.test(a.message)), []);
  // 5. And no ssh was ever opened to it, by any phase.
  assert.ok(!i.sshHosts().includes('mac'), 'ssh targeted self: ' + JSON.stringify(i.calls()));

  // 6. Still prunes on age alone, where a remote row with an unconfirmed kill is kept. The
  //    kill has to keep failing for that row to stay unconfirmed — otherwise the tick's own
  //    retry pass lands it and the contrast disappears.
  i.setState((st) => { st.killHard = true; });
  oldReaped(i, 'german-box', 'EDITH-T-UNKILLED');
  i.db.prepare("UPDATE sessions SET reaped_at = 1 WHERE host = 'mac'").run();
  await i.tick();
  const names = i.names();
  assert.ok(!names.includes('mac/ORCH-17'), 'a self row past the window prunes on age alone');
  assert.ok(names.includes('german-box/EDITH-T-UNKILLED'), 'a remote row still owed a kill is kept');
});

test('FLEET_SELF_HOST=german-box: the deck never ssh-es to itself, listed or not', async (t) => {
  // hosts.json lists this machine — the live shape, and the one that used to ssh-loop into
  // itself. The other host in the file still gets probed, so this is not "ssh stopped working".
  const i = instance({
    self: 'german-box',
    hosts: ['german-box', 'onboarding-box'],
    state: { hosts: { 'onboarding-box': { sessions: { 'EDITH-T-OB': { activity: 'now' } } } }, calls: [] },
  });
  t.after(() => i.stop());

  assert.equal((await i.get('/api/sessions')).status, 200);
  assert.equal((await i.get('/api/health')).status, 200);
  await i.tick();

  assert.ok(i.calls().length, 'no ssh ran at all — the fan-outs never happened');
  assert.deepEqual(i.sshHosts(), ['onboarding-box'], 'a probe reached self: ' + JSON.stringify(i.calls()));

  // The other side of the same coin: self is gone from the polled set, not from the fleet.
  const health = await i.get('/api/health');
  assert.deepEqual(health.body.hosts.map((h) => h.host), ['onboarding-box']);
});

test('the self exemptions follow the constant, not the literal', async (t) => {
  // Self is german-box; `mac` is now an ordinary remote fleet host and must be treated as one.
  const i = instance({
    self: 'german-box',
    hosts: ['mac', 'german-box'],
    state: { hosts: { mac: { sessions: {} } }, calls: [] },
  });
  t.after(() => i.stop());

  await armed(i, 'german-box', 'BOX-LANE-1'); // self, and listed too — the exemptions below are the point
  await armed(i, 'mac', 'EDITH-T-M1');
  await sweepToReap(i);

  const self = i.row('german-box', 'BOX-LANE-1');
  assert.equal(self.lease_state, 'reaped');
  assert.ok(self.warned_at, 'the self row was not warned');
  assert.equal(self.killed_at, null, 'self was ssh-killed');

  const remote = i.row('mac', 'EDITH-T-M1');
  assert.equal(remote.lease_state, 'reaped');
  assert.ok(remote.killed_at, 'an ordinary remote row was not ssh-killed: ' + JSON.stringify(i.calls()));

  const cmds = i.calls().filter((c) => c.host === 'mac').map((c) => c.cmd);
  assert.ok(cmds.some((c) => /tmux ls /.test(c)), 'the remote host was never ssh-polled');
  assert.ok(cmds.some((c) => /kill-session -t EDITH-T-M1/.test(c)), 'the kill never went over ssh');
  assert.ok(!i.sshHosts().includes('german-box'), 'ssh targeted self: ' + JSON.stringify(i.calls()));

  // Retention swaps sides with the constant too.
  i.setState((st) => { st.killHard = true; }); // as above: keep the remote kill unconfirmed
  oldReaped(i, 'mac', 'MAC-UNKILLED');
  i.db.prepare("UPDATE sessions SET reaped_at = 1 WHERE host = 'german-box'").run();
  await i.tick();
  const names = i.names();
  assert.ok(!names.includes('german-box/BOX-LANE-1'), 'the self row did not prune on age alone');
  assert.ok(names.includes('mac/MAC-UNKILLED'), 'a remote row still owed a kill was pruned');
});

// --- roles. /api/health is ungated by M1, and it is the one route a satellite is monitored on.
async function deck(t, env = {}, opts = {}) {
  const dir = tmpdir('selfhost-http');
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: { 'german-box': { sessions: {} } }, calls: [] }));
  // node:test shares one process per file and load() above writes FLEET_* into it, which
  // startServer then spreads into the child. Every knob this file sets is neutralised here, so
  // an HTTP deck's defaults are the shipped defaults and not the previous test's leftovers.
  const s = await startServer(
    {
      FLEET_SSH_BIN: FAKE_SSH,
      FLEET_FAKE_SSH_STATE: state,
      FLEET_SELF_HOST: '',
      FLEET_ROLE: '',
      FLEET_TTL_S: '',
      FLEET_SUSPECT_WINDOW_S: '',
      ...env,
    },
    { dir, ...opts }
  );
  t.after(() => s.stop());
  s.sshCalls = () => JSON.parse(fs.readFileSync(state, 'utf8')).calls;
  return s;
}

// The reaper fields /api/health carries; a satellite must answer with all of them, not with a
// truncated body that a monitor would read as a broken deck.
const HEALTH_KEYS = [
  'hosts', 'reaper_last_tick_at', 'reaper_ticks', 'reaper_tick_s', 'reaper_grace',
  'fence_mode', 'ttl_s', 'alerts',
];

test('a satellite probes nothing, and /api/health still answers 200 on every role', async (t) => {
  const sat = await deck(t, { FLEET_ROLE: 'satellite' });
  const r = await sat.get('/api/health');
  assert.equal(r.status, 200, r.text); // M1: ungated on every role
  for (const k of HEALTH_KEYS) assert.ok(k in r.body, 'satellite health is missing ' + k);
  assert.deepEqual(r.body.hosts, [], 'a satellite ssh-polled the fleet: ' + JSON.stringify(r.body.hosts));
  assert.deepEqual(sat.sshCalls(), [], 'a satellite opened an ssh');

  // The contrast: the same call on the home role does fan out, so the empty list above is the
  // role, not a broken fixture.
  const home = await deck(t);
  const h = await home.get('/api/health');
  assert.equal(h.status, 200, h.text);
  for (const k of HEALTH_KEYS) assert.ok(k in h.body, 'home health is missing ' + k);
  assert.deepEqual(h.body.hosts.map((x) => x.host), ['german-box']);
});

test('LEASE_HOSTS, message targets and the registry all accept the configured self host', async (t) => {
  // A self name in no hosts.json at all, so nothing here can pass by membership.
  const SELF = 'my-laptop';
  const dir = tmpdir('selfhost-tgt');
  // deliverTmux's local branch runs the real `tmux`; a shim on PATH keeps the suite off this
  // machine's tmux server and records that the LOCAL branch, not the ssh one, was taken.
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'tmux.log');
  fs.writeFileSync(
    path.join(bin, 'tmux'),
    '#!/usr/bin/env node\n' +
      'require("fs").appendFileSync(' + JSON.stringify(log) + ', process.argv.slice(2).join(" ") + "\\n");\n' +
      'process.stdin.resume();\nprocess.stdin.on("end", () => process.exit(0));\n' +
      'setTimeout(() => process.exit(0), 50);\n',
    { mode: 0o755 }
  );
  const s = await deck(t, { FLEET_SELF_HOST: SELF, PATH: bin + ':' + process.env.PATH }, { dir });

  const claim = await s.post('/api/lease/claim', { host: SELF, name: 'ORCH-99' });
  assert.equal(claim.status, 200, 'LEASE_HOSTS rejected the self host: ' + claim.text);

  const reg = await s.post('/api/registry', { host: SELF, name: 'ORCH-99', label: 'the deck itself' });
  assert.equal(reg.status, 200, 'registryRoute rejected the self host: ' + reg.text);

  const msg = await s.post('/api/messages', {
    id: 'self-host-probe-1',
    source: 'FD-test',
    target: { type: 'tmux', host: SELF, session: 'EDITH-T-SELF' },
    text: 'to the deck itself',
  });
  assert.doesNotMatch(msg.text, /must name a configured host/, 'validateMessageTarget rejected self');
  assert.match(fs.readFileSync(log, 'utf8'), /load-buffer/, 'delivery to self did not take the local branch');
  assert.deepEqual(s.sshCalls(), [], 'delivery to self went over ssh');

  // The control: a name that is neither self nor a fleet host is still refused everywhere.
  const bad = 'not-a-fleet-host';
  assert.equal((await s.post('/api/lease/claim', { host: bad, name: 'ORCH-98' })).status, 400);
  assert.equal((await s.post('/api/registry', { host: bad, name: 'ORCH-98' })).status, 400);
  const badMsg = await s.post('/api/messages', {
    id: 'self-host-probe-2',
    source: 'FD-test',
    target: { type: 'tmux', host: bad, session: 'EDITH-T-SELF' },
    text: 'nowhere',
  });
  assert.match(badMsg.text, /must name a configured host/, badMsg.text);
});

test('a blank FLEET_SELF_HOST refuses to boot rather than ssh into itself', () => {
  // The realistic way this goes wrong is a launch line whose variable never expanded, so the
  // value arrives as whitespace and trims to ''. That matches no host, every exemption above
  // stops exempting at once, and the deck ssh-polls and ssh-kills its own lanes — silently.
  // Refusing to serve is the same choice FLEET_ROLE makes for a typo'd role.
  const dir = tmpdir('selfhost-boot');
  for (const value of ['  ', '\t', ' \n ']) {
    assert.throws(
      () => boot({ FLEET_DB: path.join(dir, 'fleet.db'), FLEET_HOSTS_FILE: hostsFile(dir), FLEET_SELF_HOST: value }),
      (e) => /FLEET_SELF_HOST is ".*", expected a non-empty host name/.test(String(e.stderr)),
      'a blank self host booted, on value ' + JSON.stringify(value)
    );
  }
  // A literally empty variable is NOT this bug: `||` reads it as unset and the default applies,
  // exactly as FLEET_ROLE='' still means home. Only a value that survives `||` and then trims
  // away — whitespace — could reach the fifteen comparisons and match nothing.
  assert.match(
    boot({ FLEET_DB: path.join(dir, 'empty.db'), FLEET_HOSTS_FILE: hostsFile(dir), FLEET_SELF_HOST: '' }),
    /self=mac/
  );
  // The control: a real name boots, so the guard rejects blankness and nothing else. It is not
  // in hosts.json on purpose — self is leasable without ever being a probe target.
  const out = boot({ FLEET_DB: path.join(dir, 'ok.db'), FLEET_HOSTS_FILE: hostsFile(dir), FLEET_SELF_HOST: 'german-box' });
  assert.match(out, /self=german-box/);
});

test('the boot line says which host this deck considers itself', async (t) => {
  // A knob that changes fifteen behaviours has to be readable from the startup log, the same
  // way role and platform are: a deck ssh-ing into itself must be diagnosable from one line.
  const dflt = await deck(t);
  assert.match(dflt.log(), /role: home platform=\w+ serves=[\w+]+ self=mac/);

  const box = await deck(t, { FLEET_SELF_HOST: 'german-box', FLEET_ROLE: 'satellite' });
  assert.match(box.log(), /role: satellite platform=\w+ serves=[\w+]+ self=german-box/);
});

test(
  'a non-darwin deck warns when the self host is still the Mac default',
  { skip: DARWIN && "on a Mac the default IS right, which is the whole reason it is the default" },
  async (t) => {
    // The residual the boot throw cannot reach: FLEET_SELF_HOST forgotten rather than mistyped.
    // Unset, it defaults to 'mac', and a Linux box called 'mac' is a contradiction — so the deck
    // says so instead of quietly ssh-polling and ssh-killing its own lanes.
    const forgotten = await deck(t, { FLEET_ROLE: 'home' });
    assert.match(forgotten.log(), /WARNING: FLEET_SELF_HOST is 'mac' on platform \w+/);
    assert.match(forgotten.log(), /may ssh-poll and ssh-kill itself/);

    // Set explicitly, there is nothing to warn about and the line is gone. Without this half the
    // test would pass on a deck that warned unconditionally.
    const named = await deck(t, { FLEET_SELF_HOST: 'german-box' });
    assert.doesNotMatch(named.log(), /WARNING: FLEET_SELF_HOST/);

    // Naming it 'mac' on a Linux box is the same contradiction, however it got there.
    const insisted = await deck(t, { FLEET_SELF_HOST: 'mac' });
    assert.match(insisted.log(), /WARNING: FLEET_SELF_HOST is 'mac'/);
  }
);
