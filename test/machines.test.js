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

// A stub collector: the deck's side is under test here, not the login scan.
function fixture(dir, line) {
  const stub = path.join(dir, 'stub-logins.sh');
  fs.writeFileSync(stub, "#!/bin/sh\nprintf '%s\\n' '" + JSON.stringify(line) + "'\n");
  const cfg = path.join(dir, 'machines.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      machines: [
        { id: 'macbook', label: 'MacBook Pro', os: 'macos', route: 'local' },
        { id: 'rog-strix', label: 'ROG Strix', os: 'windows', route: 'push' },
      ],
    })
  );
  return { FLEET_LOGINS_SH: stub, FLEET_MACHINES_FILE: cfg };
}

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
