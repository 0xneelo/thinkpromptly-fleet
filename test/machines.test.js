// Machines page — box/fleet-logins.sh reports identities only, and the deck lists one row
// per configured machine. The secrets assertion is the point of the first two tests: the
// access token and the Codex id_token are used and never emitted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { tmpdir, ROOT } = require('./helpers');
const { startServer } = require('./http');

const SCRIPT = path.join(ROOT, 'box', 'fleet-logins.sh');
const TOKEN = 'DUMMYTOKEN123';
const ORG = 'd24c4827-df47-40e3-af74-574418a03a4b'; // Aylin Yeter in credits-accounts.json
const CONFIG_ORG = 'b14f597c-43a1-4b18-ab9d-a5ab74128546'; // Lafayette Tabor
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ID_TOKEN =
  b64({ alg: 'RS256', typ: 'JWT' }) +
  '.' +
  b64({
    email: 'admin@deus.finance',
    exp: 2000000000,
    'https://api.openai.com/auth': { chatgpt_plan_type: 'pro', chatgpt_account_id: 'acct-777' },
  }) +
  '.sig';

// A HOME with both credential files, so the collector never reaches for this Mac's keychain
// and never touches the operator's real logins.
function fakeHome() {
  const home = tmpdir('logins');
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'lafayette@infinite-holdings.llc', organizationUuid: CONFIG_ORG } })
  );
  fs.writeFileSync(
    path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: 'r', expiresAt: 4102444800000 } })
  );
  fs.writeFileSync(
    path.join(home, '.codex', 'auth.json'),
    JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: ID_TOKEN, access_token: 'a', account_id: 'acct-777' }, last_refresh: '2026-09-01T10:00:00Z' })
  );
  return home;
}

// Stands in for api.anthropic.com: whatever it answers is what the token's identity is.
async function fakeProfile(status, body) {
  const srv = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + srv.address().port + '/profile', close: () => new Promise((r) => srv.close(r)) };
}

// Async on purpose: execFileSync would block this process's event loop, and the fake
// profile server the script is calling lives in it.
const collect = async (home, url) =>
  (await promisify(execFile)('sh', [SCRIPT], {
    env: { ...process.env, HOME: home, FLEET_PROFILE_URL: url },
    encoding: 'utf8',
    timeout: 30000,
  })).stdout.trim();

const pick = (d, client) => d.clients.find((c) => c.client === client && c.where === 'local');

test('fleet-logins.sh — the token names the account, the config is only a fallback', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(200, {
    account: { email: 'aylianator@gmail.com' },
    organization: { uuid: ORG, rate_limit_tier: 'default_claude_max_20x' },
  });
  t.after(() => p.close());
  const out = await collect(home, p.url);
  const d = JSON.parse(out);

  const claude = pick(d, 'claude_cli');
  // The config names Lafayette; the token in use is Aylin's, and the token wins.
  assert.equal(claude.email, 'aylianator@gmail.com');
  assert.equal(claude.org, ORG);
  assert.equal(claude.proof, 'profile');
  assert.equal(claude.state, 'ok');
  assert.equal(claude.signed_in, true);
  assert.equal(claude.tier, 'default_claude_max_20x');
  assert.equal(claude.config_email, 'lafayette@infinite-holdings.llc');
  assert.equal(claude.config_org, CONFIG_ORG);

  const codex = pick(d, 'codex_cli');
  assert.equal(codex.email, 'admin@deus.finance');
  assert.equal(codex.plan, 'pro');
  assert.equal(codex.account_id, 'acct-777');
  assert.equal(codex.proof, 'jwt');
  assert.equal(codex.expires_at, 2000000000);

  // The whole point of the collector: identities travel, credentials do not.
  assert.ok(!out.includes(TOKEN), 'access token leaked into the reported line');
  assert.ok(!out.includes(ID_TOKEN), 'id_token leaked into the reported line');
});

test('fleet-logins.sh — a rejected token falls back to the config, labelled as one', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(401, { error: 'unauthorized' });
  t.after(() => p.close());
  const out = await collect(home, p.url);
  const claude = pick(JSON.parse(out), 'claude_cli');

  assert.equal(claude.state, 'token_expired');
  assert.equal(claude.signed_in, false);
  assert.equal(claude.proof, 'config');
  assert.equal(claude.email, 'lafayette@infinite-holdings.llc');
  assert.ok(!out.includes(TOKEN), 'access token leaked into the reported line');
});

// A stub collector: the deck's side is under test here, not the login scan. The stub is both
// run directly (route local) and piped over the ssh shim's stdin (route ssh), so one script
// covers both paths.
function fixture(dir, line, machines) {
  const stub = path.join(dir, 'stub-logins.sh');
  fs.writeFileSync(stub, "#!/bin/sh\nprintf '%s\\n' '" + JSON.stringify(line) + "'\n");
  const cfg = path.join(dir, 'machines.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      machines: machines || [
        { id: 'macbook', label: 'MacBook Pro', os: 'macos', route: 'local' },
        { id: 'rog-strix', label: 'ROG Strix', os: 'windows', route: 'push' },
      ],
    })
  );
  return { FLEET_LOGINS_SH: stub, FLEET_MACHINES_FILE: cfg };
}

// test/ssh-shim.sh stands in for ssh: it drops the option pairs and the host and runs the
// remote command here, so the deck's real fan-out, stdin piping and error handling run.
const SHIM = path.join(__dirname, 'ssh-shim.sh');
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
const LINE = {
  v: 1,
  host: 'DESKTOP-XYZ',
  os: 'linux',
  ts: 1757000000,
  clients: [{ client: 'claude_cli', where: 'local', installed: true, signed_in: true, state: 'ok', proof: 'profile', email: 'aylianator@gmail.com', org: ORG }],
};

// One record per ssh call: every argv element NUL-terminated, then a newline.
const argvLog = (f) =>
  fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => r.split('\0').slice(0, -1));

test('/api/machines — the ssh argv per route, and no ssh at all for local or push', async (t) => {
  const dir = tmpdir('machines-ssh');
  const log = path.join(dir, 'argv.log');
  const env = {
    ...fixture(dir, LINE, [
      { id: 'german-box', label: 'German Box', os: 'windows', route: 'ssh', ssh: 'gb-deploy', wsl: true, host: 'german-box' },
      { id: 'vps', label: 'VPS', os: 'linux', route: 'ssh', ssh: 'vps-deploy', host: 'vps' },
      { id: 'macbook', label: 'MacBook Pro', os: 'macos', route: 'local' },
      { id: 'rog-strix', label: 'ROG Strix', os: 'windows', route: 'push' },
    ]),
    FLEET_SSH_BIN: SHIM,
    FLEET_SHIM_ARGV_LOG: log,
    FLEET_SHIM_MAP_WSL: '1', // `wsl` resolves only as wsl.exe inside WSL, so run the payload plainly
  };
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  const r = await s.get('/api/machines?refresh=1');
  assert.equal(r.status, 200);
  const rows = new Map(r.body.machines.map((m) => [m.id, m]));

  // Both boxes are polled at once, so the log order is whichever shim wrote first: find the
  // record by its host rather than assuming one.
  const calls = argvLog(log);
  const call = (host) => calls.find((c) => c[4] === host);
  // A Windows box is reached through WSL; a Linux one is not, and the deck must not send
  // `wsl` to a machine that has no such command.
  assert.deepStrictEqual(call('gb-deploy'), [...SSH_OPTS, 'gb-deploy', 'wsl sh -s']);
  assert.deepStrictEqual(call('vps-deploy'), [...SSH_OPTS, 'vps-deploy', 'sh -s']);
  // The local machine runs the script itself and the push machine calls us: neither is ssh'd.
  assert.equal(calls.length, 2, 'unexpected ssh calls: ' + JSON.stringify(calls));

  assert.equal(rows.get('german-box').state, 'ok');
  assert.equal(rows.get('vps').state, 'ok');
  // Not merely skipped: the local path ran and reported.
  assert.equal(rows.get('macbook').state, 'ok');
  assert.equal(rows.get('macbook').error, null);
  assert.equal(rows.get('rog-strix').state, 'no_report');

  // The sweep is over by the time the GET answers, so the page must not be told otherwise.
  assert.equal(r.body.collecting, false);
  assert.equal(r.body.collect_started_at, null);
});

// The true case of the sweep signal: a GET that lands inside the TTL while a sweep is still
// running early-returns and renders the *stored* rows, so `collecting` is the only sign they
// are stale. The stub blocks on a release file, which makes the overlap a fact rather than a
// race: the second GET is issued once the collector has provably started, and the sweep
// cannot finish until this test releases it.
test('/api/machines — a GET during an in-flight sweep is told so, in seconds', async (t) => {
  const dir = tmpdir('machines-inflight');
  const started = path.join(dir, 'sweep-started');
  const release = path.join(dir, 'sweep-release');
  const stub = path.join(dir, 'slow-logins.sh');
  // Bounded on purpose: a wait nobody releases still ends, so a failure cannot hang the suite.
  fs.writeFileSync(
    stub,
    '#!/bin/sh\n' +
      ": > '" + started + "'\n" +
      'i=0\n' +
      "while [ ! -f '" + release + "' ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done\n" +
      "printf '%s\\n' '" + JSON.stringify(LINE) + "'\n"
  );
  const cfg = path.join(dir, 'machines.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({ machines: [{ id: 'macbook', label: 'MacBook Pro', os: 'macos', route: 'local' }] })
  );
  const s = await startServer({ FLEET_LOGINS_SH: stub, FLEET_MACHINES_FILE: cfg }, { dir });
  // Released here too, so an assertion that throws early still lets the stub exit at once.
  t.after(() => {
    fs.writeFileSync(release, '');
    return s.stop();
  });

  const inFlight = s.get('/api/machines?refresh=1'); // held open by the stub; deliberately not awaited
  for (let i = 0; !fs.existsSync(started); i++) {
    assert.ok(i < 1000, 'the collector never started');
    await new Promise((r) => setTimeout(r, 10));
  }

  // No refresh=1: this is the request that early-returns on the TTL and renders stale rows.
  const during = await s.get('/api/machines');
  assert.equal(during.status, 200);
  assert.equal(during.body.collecting, true);
  const at = during.body.collect_started_at;
  const now = Math.floor(Date.now() / 1000);
  assert.equal(typeof at, 'number', 'collect_started_at: ' + JSON.stringify(at));
  // Seconds, not milliseconds: the page renders an age from this, and a ms value would read
  // as a sweep that started tens of thousands of years from now.
  assert.ok(at < 1e11, 'collect_started_at looks like milliseconds: ' + at);
  assert.ok(Math.abs(now - at) <= 5, 'collect_started_at ' + at + ' is not near ' + now);

  fs.writeFileSync(release, '');
  const done = await inFlight;
  assert.equal(done.status, 200);
  assert.equal(done.body.machines[0].state, 'ok'); // the held sweep really collected
  // The counter came back down: the next page load is told the rows are settled.
  assert.equal(done.body.collecting, false);
  const after = await s.get('/api/machines');
  assert.equal(after.body.collecting, false);
  assert.equal(after.body.collect_started_at, null);
});

test('/api/machines — an unreachable box carries its own error and does not poison the fan-out', async (t) => {
  const dir = tmpdir('machines-unreach');
  const env = {
    ...fixture(dir, LINE, [
      { id: 'german-box', label: 'German Box', os: 'windows', route: 'ssh', ssh: 'gb-deploy', wsl: true },
      { id: 'vps', label: 'VPS', os: 'linux', route: 'ssh', ssh: 'vps-deploy' },
    ]),
    FLEET_SSH_BIN: SHIM,
    FLEET_SHIM_UNREACH: 'gb-deploy',
    FLEET_SHIM_MAP_WSL: '1',
  };
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  const rows = new Map((await s.get('/api/machines?refresh=1')).body.machines.map((m) => [m.id, m]));
  const down = rows.get('german-box');
  // ssh's own words, so the row says why rather than blaming the collector.
  assert.ok(down.error && down.error.includes('Connection timed out'), JSON.stringify(down.error));
  assert.notEqual(down.state, 'ok');
  assert.equal(rows.get('vps').state, 'ok');
  assert.equal(rows.get('vps').error, null);
});

test('/api/machines — the row is keyed by the configured host, the machine reports its own', async (t) => {
  const dir = tmpdir('machines-host');
  const env = fixture(dir, LINE, [
    { id: 'german-box', label: 'German Box', os: 'linux', route: 'local', host: 'german-box' },
  ]);
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  const row = (await s.get('/api/machines?refresh=1')).body.machines[0];
  assert.equal(row.state, 'ok');
  // `host` joins the row to that host's sessions and leases, so it stays the configured key
  // even when the machine answers with a name the deck knows nothing about.
  assert.equal(row.host, 'german-box');
  assert.equal(row.reported_host, 'DESKTOP-XYZ');
});

test('/api/machines — every configured machine listed, pushes accepted only for known ids', async (t) => {
  const dir = tmpdir('machines');
  const env = fixture(dir, {
    v: 1,
    id: 'macbook',
    host: 'rfc1918-internal',
    os: 'darwin',
    ts: 1757000000,
    clients: [
      { client: 'claude_cli', where: 'local', installed: true, signed_in: true, state: 'ok', proof: 'profile', email: 'aylianator@gmail.com', org: ORG },
    ],
  });
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  const first = await s.get('/api/machines');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.machines.map((m) => m.id), ['macbook', 'rog-strix']);
  const mac = first.body.machines[0];
  assert.equal(mac.state, 'ok');
  assert.equal(mac.error, null);
  // The label comes from credits-accounts.json, applied on the way out.
  const claude = mac.clients.find((c) => c.client === 'claude_cli');
  assert.equal(claude.label, 'Aylin Yeter');
  // The three clients the machine did not name are still on the row, as absent.
  assert.equal(mac.clients.length, 4);
  assert.equal(mac.clients.find((c) => c.client === 'codex_desktop').state, 'not_installed');

  const push = first.body.machines[1];
  assert.equal(push.state, 'no_report');
  assert.deepEqual(push.clients, []);
  assert.ok(first.body.push_url.endsWith('/api/machines'), first.body.push_url);

  const bad = await s.post('/api/machines', { v: 1, id: 'not-a-machine', clients: [] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'unknown_machine');
  // A machine the deck polls itself cannot be rewritten from the tailnet.
  const polled = await s.post('/api/machines', { v: 1, id: 'macbook', clients: [] });
  assert.equal(polled.status, 400);
  assert.equal(polled.body.error, 'not_a_push_machine');
  assert.equal((await s.get('/api/machines')).body.machines[0].state, 'ok');

  const ok = await s.post('/api/machines', {
    v: 1,
    id: 'rog-strix',
    host: 'ROG',
    os: 'windows',
    ts: 1757000001,
    clients: [
      { client: 'codex_cli', where: 'local', installed: true, signed_in: true, state: 'ok', proof: 'jwt', email: 'admin@deus.finance', plan: 'pro' },
      { client: 'claude_desktop', where: 'local', installed: true, signed_in: true, state: 'ok', proof: 'history', org: CONFIG_ORG, last_active: 1757000000 },
    ],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.id, 'rog-strix');

  const after = (await s.get('/api/machines')).body.machines[1];
  assert.equal(after.state, 'ok');
  assert.ok(after.reported_at > 0);
  assert.equal(after.clients.find((c) => c.client === 'codex_cli').label, 'Daniel Tabor (personal · ChatGPT)');
  assert.equal(after.clients.find((c) => c.client === 'claude_desktop').label, 'Lafayette Tabor');
  assert.equal(after.clients.length, 4);

  // The wrapper's fallback line (no python3, collector crashed) is a failed read, not a
  // machine with nothing installed: its note is the row's error and no client is shown.
  const failed = await s.post('/api/machines', {
    v: 1, id: 'rog-strix', host: 'ROG', os: 'unknown', ts: 1757000002, clients: [], note: 'no python3 or collector failed',
  });
  assert.equal(failed.status, 200);
  const broken = (await s.get('/api/machines')).body.machines[1];
  assert.equal(broken.state, 'no_report');
  assert.equal(broken.error, 'no python3 or collector failed');
  assert.deepEqual(broken.clients, []);
});
