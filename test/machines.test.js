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
const { tmpdir, hostsFile, load, unload, ROOT } = require('./helpers');
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
  // test/ssh-shim.sh writes one record per write(): arguments each closed by a NUL, the
  // record itself closed by a second NUL. Splitting on the pair is what keeps two racing
  // shims from reading back as one call.
  fs.readFileSync(f, 'utf8').split('\0\0').filter(Boolean).map((r) => r.split('\0'));

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

// --- The two joins behind the Machines page. machinesUsage() and machinesSessions() are pure
// seams off machinesView(), so they are driven straight here: no collect, no ssh, and the
// clock passed in rather than read, which is what makes the ageing assertions repeatable.
// The instance exists only to export them; its db is a throwaway and is never written.
function seams(t) {
  const dir = tmpdir('machines-seams');
  const m = load({ FLEET_DB: path.join(dir, 'fleet.db'), FLEET_HOSTS_FILE: hostsFile(dir) });
  // load() binds nothing by setting FLEET_NO_LISTEN on this process, and startServer inherits
  // the whole env: left standing, it makes the child below exit at boot instead of listening.
  t.after(async () => {
    await unload(m);
    delete process.env.FLEET_NO_LISTEN;
  });
  return m;
}

const NOW = 1757000000;

test('machinesUsage — Claude keys by org, Codex by lowercased email, and only four fields travel', (t) => {
  const { machinesUsage } = seams(t);
  const u = machinesUsage(
    [
      {
        kind: 'claude', id: 'aylianator@gmail.com', email: 'aylianator@gmail.com', org: ORG,
        state: 'ok', source: 'desktop', sample_ts: NOW - 60, label: 'Aylin Yeter',
        windows: { five_hour: { pct: 42 }, seven_day: { pct: 7 } },
      },
      // Shouted on purpose: the lookup side only ever has a lowercased email to ask with.
      {
        kind: 'codex', id: 'ADMIN@Deus.Finance', email: 'ADMIN@Deus.Finance', state: 'ok',
        updated_at: NOW - 60, weekly: { pct: 55 }, secondary: { pct: 3 },
      },
    ],
    NOW
  );

  assert.deepEqual([...u.claude.keys()], [ORG]);
  const claude = u.claude.get(ORG);
  assert.deepEqual(Object.keys(claude).sort(), ['sample_ts', 'stale_windows', 'state', 'windows']);
  assert.equal(claude.windows.five_hour.pct, 42);
  assert.equal(claude.state, 'ok');
  assert.equal(claude.sample_ts, NOW - 60);
  assert.equal(claude.stale_windows, false);

  assert.deepEqual([...u.codex.keys()], ['admin@deus.finance']);
  const codex = u.codex.get('admin@deus.finance');
  assert.deepEqual(Object.keys(codex).sort(), ['sample_ts', 'stale_windows', 'state', 'windows']);
  // The two Codex siblings become one windows object, so the front end sees one shape.
  assert.deepEqual(Object.keys(codex.windows).sort(), ['secondary', 'weekly']);
  assert.equal(codex.windows.weekly.pct, 55);
  assert.equal(codex.windows.secondary.pct, 3);
  assert.equal(codex.sample_ts, NOW - 60);
  assert.equal(codex.stale_windows, false);
});

test('machinesUsage — an account with no credits row gets no entry, and a row naming nobody is dropped', (t) => {
  const { machinesUsage } = seams(t);
  const u = machinesUsage(
    [
      { kind: 'claude', id: 'aylianator@gmail.com', org: ORG, state: 'ok', sample_ts: NOW, windows: {} },
      // No org and no email: keying these on undefined or '' would invent an account that
      // some client with an equally blank org would then match.
      { kind: 'claude', id: 'nameless', sample_ts: NOW, windows: { five_hour: { pct: 99 } } },
      { kind: 'codex', updated_at: NOW, weekly: { pct: 99 } },
      { kind: 'seats', id: 'x', org: CONFIG_ORG, windows: { five_hour: { pct: 99 } } },
      null,
    ],
    NOW
  );

  assert.deepEqual([...u.claude.keys()], [ORG]);
  // Lafayette's org is real and configured, but nothing reported it here, so there is no
  // entry at all — machinesView turns that miss into usage: null (see the route test below).
  assert.equal(u.claude.get(CONFIG_ORG), undefined);
  assert.equal(u.claude.has(undefined), false);
  assert.equal(u.codex.size, 0);
});

test('machinesUsage — a Codex sample past its window ages out, a fresh one keeps its number', (t) => {
  const { machinesUsage } = seams(t);
  const u = machinesUsage(
    [
      // Codex rows carry no sample_ts: updated_at is the only date they have, and a weekly
      // bar eight days old must not draw as a current figure.
      {
        kind: 'codex', id: 'old@example.invalid', email: 'old@example.invalid', state: 'ok',
        updated_at: NOW - 8 * 86400, weekly: { pct: 91 }, secondary: { pct: 12 },
      },
      {
        kind: 'codex', id: 'new@example.invalid', email: 'new@example.invalid', state: 'ok',
        updated_at: NOW - 300, weekly: { pct: 44 },
      },
    ],
    NOW
  );

  const old = u.codex.get('old@example.invalid');
  assert.equal(old.stale_windows, true);
  assert.deepEqual(old.windows.weekly, { pct: null, stale: true });
  assert.equal(old.sample_ts, NOW - 8 * 86400, 'updated_at dates a row that has no sample_ts');

  const fresh = u.codex.get('new@example.invalid');
  assert.equal(fresh.stale_windows, false);
  assert.equal(fresh.windows.weekly.pct, 44);
  assert.equal(fresh.sample_ts, NOW - 300);
});

test('machinesUsage — an oauth Claude row ages on updated_at, a stamped one is not aged twice', (t) => {
  const { machinesUsage } = seams(t);
  const u = machinesUsage(
    [
      // Known only through a CLI login: no sample_ts, so agedOut() left it alone and the
      // five-hour bar of a box that went quiet eight days ago is this page's to age.
      {
        kind: 'claude', id: 'oauth@example.invalid', email: 'oauth@example.invalid', org: ORG,
        state: 'ok', source: 'oauth', updated_at: NOW - 8 * 86400,
        windows: { five_hour: { pct: 88 }, seven_day: { pct: 61 } },
      },
      // Desktop-sourced and stamped inside the five-hour limit: agedOut() has already had
      // its say, and re-ageing on the older updated_at would blank a number that is current.
      {
        kind: 'claude', id: 'desktop@example.invalid', email: 'desktop@example.invalid', org: CONFIG_ORG,
        state: 'ok', source: 'desktop', sample_ts: NOW - 600, updated_at: NOW - 8 * 86400,
        windows: { five_hour: { pct: 33 } },
      },
    ],
    NOW
  );

  const oauth = u.claude.get(ORG);
  assert.equal(oauth.stale_windows, true);
  assert.deepEqual(oauth.windows.five_hour, { pct: null, stale: true });
  assert.deepEqual(oauth.windows.seven_day, { pct: null, stale: true });
  assert.equal(oauth.sample_ts, NOW - 8 * 86400, 'updated_at dates a row that has no sample_ts');

  const desktop = u.claude.get(CONFIG_ORG);
  assert.equal(desktop.stale_windows, false);
  assert.equal(desktop.windows.five_hour.pct, 33);
  assert.equal(desktop.sample_ts, NOW - 600);
});

test('machinesUsage — a fresh oauth Claude row keeps its number', (t) => {
  const { machinesUsage } = seams(t);
  const u = machinesUsage(
    [
      {
        kind: 'claude', id: 'oauth@example.invalid', email: 'oauth@example.invalid', org: ORG,
        state: 'ok', source: 'oauth', updated_at: NOW - 300,
        windows: { five_hour: { pct: 88 } },
      },
    ],
    NOW
  );

  const fresh = u.claude.get(ORG);
  assert.equal(fresh.stale_windows, false);
  assert.equal(fresh.windows.five_hour.pct, 88);
  assert.equal(fresh.sample_ts, NOW - 300);
});

test('machinesUsage — the collision tie-break: windows beat none, then the newer sample, whichever order they arrive in', (t) => {
  const { machinesUsage } = seams(t);
  // Order-independence is the whole point: a first-writer-wins or last-writer-wins bug shows
  // in exactly one of the two orderings, so every pair is fed both ways round.
  const both = (a, b) => [machinesUsage([a, b], NOW).claude.get(ORG), machinesUsage([b, a], NOW).claude.get(ORG)];

  // The configured-but-unreported blank: a legitimate row that knows an account exists and
  // nothing about its usage. It must never displace the row that has the numbers.
  const blank = { kind: 'claude', id: 'blank', org: ORG, state: 'absent', windows: {} };
  const reported = {
    kind: 'claude', id: 'desktop@example.invalid', email: 'desktop@example.invalid', org: ORG,
    state: 'ok', source: 'desktop', sample_ts: NOW - 600, windows: { five_hour: { pct: 33 } },
  };
  for (const v of both(blank, reported)) {
    assert.equal(v.state, 'ok');
    assert.equal(v.windows.five_hour.pct, 33);
    assert.equal(v.sample_ts, NOW - 600);
  }

  // Both report windows, so the tie-break falls through to the date and the newer sample wins.
  const older = {
    kind: 'claude', id: 'old@example.invalid', org: ORG, state: 'ok', source: 'desktop',
    sample_ts: NOW - 3600, windows: { five_hour: { pct: 11 } },
  };
  const newer = {
    kind: 'claude', id: 'new@example.invalid', org: ORG, state: 'ok', source: 'desktop',
    sample_ts: NOW - 60, windows: { five_hour: { pct: 77 } },
  };
  for (const v of both(older, newer)) {
    assert.equal(v.windows.five_hour.pct, 77);
    assert.equal(v.sample_ts, NOW - 60);
  }

  // The subtle one: eight days unstamped, so ageUnstamped blanks every pct and the row has
  // nothing left to show — but it still has window keys, and window keys are what the
  // tie-break asks about. Reading pct instead would hand the account to the blank row, whose
  // updated_at is newer here so it would win the date leg too.
  const aged = {
    kind: 'claude', id: 'oauth@example.invalid', org: ORG, state: 'ok', source: 'oauth',
    updated_at: NOW - 8 * 86400, windows: { five_hour: { pct: 88 }, seven_day: { pct: 61 } },
  };
  const freshBlank = { ...blank, updated_at: NOW };
  for (const v of both(freshBlank, aged)) {
    assert.equal(v.stale_windows, true);
    assert.deepEqual(Object.keys(v.windows).sort(), ['five_hour', 'seven_day']);
    assert.deepEqual(v.windows.five_hour, { pct: null, stale: true });
    assert.equal(v.sample_ts, NOW - 8 * 86400, 'the aged row lost to the blank one');
  }
});

test('machinesUsage — a stamped row already aged by agedOut() keeps its flag and is not aged again', (t) => {
  const { machinesUsage } = seams(t);
  const u = machinesUsage(
    [
      // What agedOut() hands over: stamped, five_hour past its two hours and already blanked,
      // the flag already set. updated_at is eight days back on purpose — re-ageing on it would
      // blank seven_day too, and dropping the flag would draw the blanked bar as a real zero.
      {
        kind: 'claude', id: 'desktop@example.invalid', email: 'desktop@example.invalid', org: ORG,
        state: 'ok', source: 'desktop', sample_ts: NOW - 3 * 3600, updated_at: NOW - 8 * 86400,
        stale_windows: true,
        windows: { five_hour: { pct: null, stale: true }, seven_day: { pct: 61 } },
      },
    ],
    NOW
  );

  const v = u.claude.get(ORG);
  assert.equal(v.stale_windows, true);
  assert.deepEqual(v.windows.five_hour, { pct: null, stale: true });
  assert.deepEqual(v.windows.seven_day, { pct: 61 }, 'a stamped row was aged a second time');
  assert.equal(v.sample_ts, NOW - 3 * 3600);
});

test('machinesUsage — a window whose reset time has passed is stale whatever its length', (t) => {
  const { machinesUsage } = seams(t);
  const u = machinesUsage(
    [
      // Sampled an hour ago, so the age rule fires on neither window: WINDOW_AGE has no entry
      // for the Codex names and both fall to the seven-day default. The reset stamp is the
      // only evidence that `secondary` has rolled over since it was read.
      {
        kind: 'codex', id: 'reset@example.invalid', email: 'reset@example.invalid', state: 'ok',
        updated_at: NOW - 3600,
        secondary: { pct: 95, resets_at: NOW - 60 },
        weekly: { pct: 44, resets_at: NOW + 3600 },
      },
    ],
    NOW
  );

  const v = u.codex.get('reset@example.invalid');
  assert.equal(v.stale_windows, true);
  assert.deepEqual(v.windows.secondary, { pct: null, resets_at: NOW - 60, stale: true });
  assert.deepEqual(v.windows.weekly, { pct: 44, resets_at: NOW + 3600 }, 'a window still open lost its number');
});

// --- clientUsage(): which credits row a client's cell quotes. Exported as a seam alongside
// the two joins, for the same reason — pure, and the wrong answer here is a number under
// someone else's name rather than a missing one.
test('clientUsage — a config org that disagrees with the proved one is never quoted', (t) => {
  const { clientUsage } = seams(t);
  const usage = { claude: new Map([[CONFIG_ORG, { windows: { five_hour: { pct: 88 } } }]]), codex: new Map() };

  // The token proved ORG and ~/.claude.json names CONFIG_ORG: two different accounts. ORG has
  // no credits row, and CONFIG_ORG's bars under ORG's name and email would be a lie.
  assert.equal(clientUsage({ client: 'claude_cli', org: ORG, config_org: CONFIG_ORG }, usage), null);

  // The fallback's actual case: the token could not be asked, so the config org is all there
  // is and nothing contradicts it.
  const fell = clientUsage({ client: 'claude_cli', org: null, config_org: CONFIG_ORG }, usage);
  assert.equal(fell.windows.five_hour.pct, 88);

  // A proved org with a row of its own is unaffected by any of this.
  const proved = { claude: new Map([[ORG, { windows: { five_hour: { pct: 7 } } }]]), codex: new Map() };
  assert.equal(clientUsage({ client: 'claude_cli', org: ORG, config_org: CONFIG_ORG }, proved).windows.five_hour.pct, 7);
});

test('machinesSessions — live rows only, keyed by host, blanks nulled and sorted by name', (t) => {
  const { machinesSessions } = seams(t);
  const by = machinesSessions([
    { host: 'mac', name: 'Valentin', worker: 'agent-valentin', role: 'backend-developer', label: 'machines usage', status: 'active', note: 'private', lease_state: 'active' },
    { host: 'mac', name: 'Alba', worker: '', role: '', label: '', status: '', lease_state: 'active' },
    { host: 'mac', name: 'Ghost', worker: 'agent-ghost', role: '', label: '', status: 'active', lease_state: 'reaped' },
    { host: 'german-box', name: 'Rhoda', worker: '', role: '', label: '', status: 'active', lease_state: 'suspect' },
    { host: 'nowhere-box', name: 'Nomad', worker: '', role: '', label: '', status: 'active', lease_state: 'active' },
    { host: '', name: 'Hostless', status: 'active', lease_state: 'active' },
  ]);

  // Reaped and suspect are both gone for this question, and a row with no host has no
  // machine to sit under: german-box and the hostless row leave no key behind.
  assert.deepEqual([...by.keys()].sort(), ['mac', 'nowhere-box']);
  assert.deepEqual(by.get('mac').map((x) => x.name), ['Alba', 'Valentin']);

  const v = by.get('mac')[1];
  assert.deepEqual(Object.keys(v).sort(), ['label', 'live', 'name', 'role', 'status', 'worker']);
  assert.equal(v.worker, 'agent-valentin');
  assert.equal(v.live, true);
  // Empty string is the registry's default for these columns; null is what lets the front
  // end skip the field instead of rendering a gap.
  assert.deepEqual(by.get('mac')[0], { name: 'Alba', worker: null, role: null, label: null, status: null, live: true });

  // A host no machine maps to still gets its own key — nothing ever asks for it, which is
  // what the route test asserts from the other side.
  assert.deepEqual(by.get('nowhere-box').map((x) => x.name), ['Nomad']);
});

// The same stub collector as fixture(), plus the deck-side `host` key the sessions join
// reads — and one machine deliberately without it.
function hostFixture(dir, line) {
  const stub = path.join(dir, 'stub-logins.sh');
  fs.writeFileSync(stub, "#!/bin/sh\nprintf '%s\\n' '" + JSON.stringify(line) + "'\n");
  const cfg = path.join(dir, 'machines.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      machines: [
        { id: 'macbook', host: 'mac', label: 'MacBook Pro', os: 'macos', route: 'local' },
        { id: 'rog-strix', label: 'ROG Strix', os: 'windows', route: 'push' },
      ],
    })
  );
  return { FLEET_LOGINS_SH: stub, FLEET_MACHINES_FILE: cfg };
}

const SECRET = 'sk-SHOULD-NEVER-APPEAR';
const SECRET_SESSION = SECRET + '-SESSION';

test('/api/machines — usage and sessions join onto the row, and no credential rides along', async (t) => {
  const dir = tmpdir('machines-join');
  const now = Math.floor(Date.now() / 1000);
  const env = hostFixture(dir, {
    v: 1,
    id: 'macbook',
    host: 'rfc1918-internal',
    os: 'darwin',
    ts: now,
    clients: [
      // access_token is a decoy: clientRow's whitelist is what has to drop it.
      { client: 'claude_cli', where: 'local', installed: true, signed_in: true, state: 'ok', proof: 'profile', email: 'aylianator@gmail.com', org: ORG, access_token: SECRET },
      { client: 'codex_cli', where: 'local', installed: true, signed_in: true, state: 'ok', proof: 'jwt', email: 'nobody@example.invalid' },
    ],
  });
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  const db = s.open();
  t.after(() => db.close());
  // Seeded straight into the tables the join reads, so the route has real data to find and
  // the decoys are genuinely stored rather than filtered before they were ever written.
  db.prepare('INSERT INTO credits (kind, id, email, org, host, payload, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    'claude', 'aylianator@gmail.com', 'aylianator@gmail.com', ORG, 'mac',
    JSON.stringify({
      kind: 'claude', id: 'aylianator@gmail.com', email: 'aylianator@gmail.com', org: ORG,
      host: 'mac', state: 'ok', source: 'desktop', updated_at: now - 120, sample_ts: now - 120,
      windows: { five_hour: { pct: 42 }, seven_day: { pct: 7 } },
      access_token: SECRET,
    }),
    now - 120
  );
  const ins = db.prepare(
    'INSERT INTO sessions (host, name, label, role, worker, status, note, lease_state) VALUES (?,?,?,?,?,?,?,?)'
  );
  ins.run('mac', 'Valentin', 'machines usage', 'backend-developer', 'agent-valentin', 'active', SECRET_SESSION, 'active');
  ins.run('nowhere-box', 'Nomad', '', '', '', 'active', SECRET_SESSION, 'active');
  ins.run('mac', 'Ghost', '', '', '', 'active', SECRET_SESSION, 'reaped');
  assert.match(db.prepare('SELECT payload FROM credits WHERE kind = ? AND id = ?').get('claude', 'aylianator@gmail.com').payload, /SHOULD-NEVER-APPEAR/);
  assert.equal(db.prepare('SELECT note FROM sessions WHERE host = ? AND name = ?').get('mac', 'Valentin').note, SECRET_SESSION);

  const r = await s.get('/api/machines');
  assert.equal(r.status, 200);
  const mac = r.body.machines.find((m) => m.id === 'macbook');
  const rog = r.body.machines.find((m) => m.id === 'rog-strix');

  // machines.json's `host` is the join key: mac has one, ROG has none.
  assert.deepEqual(mac.sessions.map((x) => x.name), ['Valentin']);
  assert.equal(mac.sessions[0].worker, 'agent-valentin');
  assert.equal(mac.sessions[0].live, true);
  assert.deepEqual(rog.sessions, []);
  // Nomad is live, but nowhere-box is nobody's machine, so it reaches no row.
  assert.ok(!r.body.machines.some((m) => m.sessions.some((x) => x.name === 'Nomad')), 'a session on an unmapped host reached a machine');

  const claude = mac.clients.find((c) => c.client === 'claude_cli' && c.where === 'local');
  assert.equal(claude.usage.windows.five_hour.pct, 42);
  assert.equal(claude.usage.windows.seven_day.pct, 7);
  assert.equal(claude.usage.stale_windows, false);
  // No credits row names this email, so the client shows an identity and no numbers.
  assert.equal(mac.clients.find((c) => c.client === 'codex_cli' && c.where === 'local').usage, null);

  // The whole payload, at every depth: a credential-shaped key or a seeded secret anywhere
  // in it is the failure, not just one at the top level.
  const BANNED = new Set(['token', 'access_token', 'refresh_token', 'cookie', 'authorization']);
  const SECRETS = new Set([SECRET, SECRET_SESSION]);
  const bad = [];
  (function walk(v, at) {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, at + '[' + i + ']'));
    if (v && typeof v === 'object')
      return Object.entries(v).forEach(([k, x]) => {
        if (BANNED.has(k.toLowerCase())) bad.push('key ' + at + '.' + k);
        walk(x, at + '.' + k);
      });
    if (typeof v === 'string' && SECRETS.has(v)) bad.push('value ' + at + ' = ' + v);
  })(r.body, '$');
  assert.deepEqual(bad, [], 'credential-shaped keys or seeded secrets reached /api/machines');
  assert.ok(!r.text.includes(SECRET), 'a seeded secret appeared in the raw response body');
});
