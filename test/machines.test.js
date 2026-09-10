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
// One server, three paths — the collector asks the profile first and only then for usage, so
// `usage` is [status, body] and defaults to a failure the identity assertions ignore. `token`
// is [status, body] for POST /token, and once it has minted one the profile answers only that
// bearer: a refreshed token proves itself like any other. Every request is recorded.
async function fakeProfile(status, body, usage, token) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: raw });
      let [s, b, h] = req.url.startsWith('/usage') ? usage || [500, {}] : [status, body];
      if (req.url.startsWith('/token')) [s, b] = token || [404, {}];
      else if (token && token[0] === 200 && req.headers.authorization !== 'Bearer ' + token[1].access_token)
        [s, b] = [401, { error: 'unauthorized' }];
      res.writeHead(s, { 'content-type': 'application/json', ...(h || {}) });
      res.end(JSON.stringify(b));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  return { url: base + '/profile', usage: base + '/usage', token: base + '/token', calls, close: () => new Promise((r) => srv.close(r)) };
}

// Async on purpose: execFileSync would block this process's event loop, and the fake
// profile server the script is calling lives in it. All three URLs are always overridden, or
// a test would reach the real api.anthropic.com with the dummy token — and spend the dummy
// refresh token at the real token endpoint.
const collect = async (home, url, usageUrl, tokenUrl = url.replace(/\/profile$/, '/token'), env = {}) =>
  (await promisify(execFile)('sh', [SCRIPT], {
    env: { ...process.env, HOME: home, FLEET_PROFILE_URL: url, FLEET_USAGE_URL: usageUrl, FLEET_TOKEN_URL: tokenUrl, ...env },
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
  const out = await collect(home, p.url, p.usage);
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
  const out = await collect(home, p.url, p.usage);
  const claude = pick(JSON.parse(out), 'claude_cli');

  assert.equal(claude.state, 'token_expired');
  assert.equal(claude.signed_in, false);
  assert.equal(claude.proof, 'config');
  assert.equal(claude.email, 'lafayette@infinite-holdings.llc');
  assert.ok(!out.includes(TOKEN), 'access token leaked into the reported line');
});

const creds = (home) => JSON.parse(fs.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf8'));
const CLI_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REFRESHED = { access_token: 'NEW-TOKEN', refresh_token: 'REFRESH-TOKEN-2', expires_in: 28800, refresh_token_expires_in: 2592000 };
const IDENTITY = { account: { email: 'aylianator@gmail.com' }, organization: { uuid: ORG } };

test('fleet-logins.sh — a refused token is refreshed the way the CLI does it, and stored', async (t) => {
  const home = fakeHome();
  // The store holds more than the oauth block, and the rest must ride along untouched.
  const before = creds(home);
  fs.writeFileSync(
    path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({ ...before, mcpOAuth: { keep: 1 }, claudeAiOauth: { ...before.claudeAiOauth, scopes: ['user:inference', 'user:profile'] } })
  );
  const p = await fakeProfile(200, IDENTITY, [200, USAGE_BODY], [200, REFRESHED]);
  t.after(() => p.close());
  const out = await collect(home, p.url, p.usage, p.token);
  const claude = pick(JSON.parse(out), 'claude_cli');

  assert.equal(claude.state, 'ok');
  assert.equal(claude.proof, 'profile');
  assert.equal(claude.note, 'token refreshed');
  assert.equal(claude.usage_state, 'ok');
  const now = Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(claude.expires_at - (now + 28800)) < 60, "expires_at is the refreshed token's");

  // The request is the CLI's own: its client id, the stored scopes, the stored refresh token.
  const post = p.calls.find((c) => c.method === 'POST' && c.url === '/token');
  assert.deepStrictEqual(JSON.parse(post.body), {
    grant_type: 'refresh_token', refresh_token: 'r', client_id: CLI_CLIENT_ID, scope: 'user:inference user:profile',
  });
  // Refused, refreshed, then proved and spent — in that order, on the new bearer.
  const seq = p.calls.map((c) => c.method + ' ' + c.url + (c.auth ? ' ' + c.auth.slice(7) : ''));
  assert.deepStrictEqual(seq, ['GET /profile ' + TOKEN, 'POST /token', 'GET /profile NEW-TOKEN', 'GET /usage NEW-TOKEN']);

  const after = creds(home);
  assert.deepStrictEqual(after.mcpOAuth, { keep: 1 });
  assert.equal(after.claudeAiOauth.accessToken, 'NEW-TOKEN');
  assert.equal(after.claudeAiOauth.refreshToken, 'REFRESH-TOKEN-2');
  assert.deepStrictEqual(after.claudeAiOauth.scopes, ['user:inference', 'user:profile']);
  assert.ok(Math.abs(after.claudeAiOauth.expiresAt / 1000 - (now + 28800)) < 60);
  assert.ok(Math.abs(after.claudeAiOauth.refreshTokenExpiresAt / 1000 - (now + 2592000)) < 60);
  assert.equal(fs.statSync(path.join(home, '.claude', '.credentials.json')).mode & 0o777, 0o600);
  // Locks released, secrets kept off the wire.
  assert.ok(!fs.existsSync(path.join(home, '.claude', '.oauth_refresh.lock')));
  assert.ok(!fs.existsSync(path.join(home, '.claude.lock')));
  for (const secret of [TOKEN, 'NEW-TOKEN', 'REFRESH-TOKEN-2'])
    assert.ok(!out.includes(secret), secret + ' leaked into the reported line');
});

test("fleet-logins.sh — a live session's refresh lock is respected, a stale one is not", async (t) => {
  const home = fakeHome();
  const lock = path.join(home, '.claude', '.oauth_refresh.lock');
  fs.mkdirSync(lock);
  const p = await fakeProfile(200, IDENTITY, [200, USAGE_BODY], [200, REFRESHED]);
  t.after(() => p.close());
  let claude = pick(JSON.parse(await collect(home, p.url, p.usage, p.token)), 'claude_cli');
  assert.equal(claude.state, 'token_expired');
  assert.equal(claude.note, 'not refreshed: another refresh holds the lock');
  assert.ok(!p.calls.some((c) => c.method === 'POST'), "the token endpoint was called under someone else's lock");
  assert.equal(creds(home).claudeAiOauth.accessToken, TOKEN);
  assert.ok(fs.existsSync(lock), "someone else's fresh lock was removed");

  // proper-lockfile keeps a held lock's mtime fresh, so one two minutes old was abandoned.
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lock, old, old);
  claude = pick(JSON.parse(await collect(home, p.url, p.usage, p.token)), 'claude_cli');
  assert.equal(claude.state, 'ok');
  assert.equal(claude.note, 'token refreshed');
  assert.equal(creds(home).claudeAiOauth.accessToken, 'NEW-TOKEN');
  assert.ok(!fs.existsSync(lock));
});

test('fleet-logins.sh — a refresh the endpoint refuses leaves the store as it was', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(401, { error: 'unauthorized' }, undefined, [400, { error: 'invalid_grant' }]);
  t.after(() => p.close());
  let out = await collect(home, p.url, p.usage, p.token);
  let claude = pick(JSON.parse(out), 'claude_cli');
  assert.equal(claude.state, 'token_expired');
  assert.equal(claude.proof, 'config');
  assert.equal(claude.note, 'not refreshed: token endpoint answered 400');
  assert.deepStrictEqual(creds(home).claudeAiOauth, { accessToken: TOKEN, refreshToken: 'r', expiresAt: 4102444800000 });
  assert.ok(!out.includes(TOKEN));

  // A refresh token past its own expiry is not spent at all.
  const dead = { ...creds(home).claudeAiOauth, refreshTokenExpiresAt: 1000 };
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: dead }));
  p.calls.length = 0;
  out = await collect(home, p.url, p.usage, p.token);
  claude = pick(JSON.parse(out), 'claude_cli');
  assert.equal(claude.note, 'not refreshed: refresh token expired, sign in again');
  assert.ok(!p.calls.some((c) => c.method === 'POST'));
  assert.deepStrictEqual(creds(home).claudeAiOauth, dead);
});

test('fleet-logins.sh — a refreshed token that still will not prove itself is not called a success', async (t) => {
  const home = fakeHome();
  // The profile refuses every bearer, so the refresh happens but the new token is refused too.
  const p = await fakeProfile(401, { error: 'unauthorized' }, undefined, [200, REFRESHED]);
  t.after(() => p.close());
  const out = await collect(home, p.url, p.usage, p.token);
  const claude = pick(JSON.parse(out), 'claude_cli');

  assert.equal(claude.state, 'token_expired');
  assert.equal(claude.signed_in, false);
  assert.equal(claude.note, 'refreshed but still refused (401)');
  // The newly issued token still reached disk — the rotated refresh token is never stranded.
  assert.equal(creds(home).claudeAiOauth.accessToken, 'NEW-TOKEN');
  assert.equal(creds(home).claudeAiOauth.refreshToken, 'REFRESH-TOKEN-2');
  for (const secret of [TOKEN, 'NEW-TOKEN', 'REFRESH-TOKEN-2'])
    assert.ok(!out.includes(secret), secret + ' leaked into the reported line');
});

test('fleet-logins.sh — a 403 on the usage call, after a proved profile, pauses like a 429', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(200, IDENTITY, [403, { error: { type: 'permission_error' } }]);
  t.after(() => p.close());
  const claude = pick(JSON.parse(await collect(home, p.url, p.usage)), 'claude_cli');
  assert.equal(claude.proof, 'profile');
  assert.equal(claude.usage_state, 'rate_limited');
  // A 403 carries no Retry-After and comes back every time, so it starts an hour up.
  assert.equal(claude.note, 'usage call refused with HTTP 403, pausing 3600s');
  assert.ok(fs.existsSync(path.join(home, '.claude', '.fleet-usage-backoff')));
});

test('fleet-logins.sh — a refused usage call is remembered, and not repeated until its pause has passed', async (t) => {
  const home = fakeHome();
  const stamp = path.join(home, '.claude', '.fleet-usage-backoff');
  const p = await fakeProfile(200, IDENTITY, [429, { error: { type: 'rate_limit_error' } }, { 'retry-after': '216' }]);
  t.after(() => p.close());

  // Run 1: the endpoint refuses and names a 216s window. The pause is never shorter than
  // ten minutes — the header says when the window ends, not how sparse calls must be.
  let claude = pick(JSON.parse(await collect(home, p.url, p.usage)), 'claude_cli');
  assert.equal(claude.state, 'ok');
  assert.equal(claude.usage_state, 'rate_limited');
  assert.equal(claude.note, 'usage call refused with HTTP 429, pausing 600s');
  const deadline = Number(fs.readFileSync(stamp, 'utf8').split(' ')[0]);
  assert.ok(Math.abs(deadline - (Math.floor(Date.now() / 1000) + 600)) <= 5, 'the stamp is a ten-minute deadline');
  assert.equal(p.calls.filter((c) => c.url === '/usage').length, 1);

  // Run 2: the profile is proved again, the usage call is not made at all.
  claude = pick(JSON.parse(await collect(home, p.url, p.usage)), 'claude_cli');
  assert.equal(claude.proof, 'profile');
  assert.equal(claude.usage_state, 'rate_limited');
  assert.match(claude.note, /^usage call skipped, endpoint asked for a \d+s pause$/);
  assert.equal(p.calls.filter((c) => c.url === '/usage').length, 1, 'a second usage call re-armed the throttle');

  // Run 3: the deadline has passed; the call is made, and this time it answers.
  fs.writeFileSync(stamp, String(Math.floor(Date.now() / 1000) - 1));
  const ok = await fakeProfile(200, IDENTITY, [200, USAGE_BODY]);
  t.after(() => ok.close());
  claude = pick(JSON.parse(await collect(home, ok.url, ok.usage)), 'claude_cli');
  assert.equal(claude.usage_state, 'ok');
  assert.equal(claude.note, undefined);
  assert.equal(claude.usage.seven_day.utilization, 7.5);
  assert.ok(!fs.existsSync(stamp), 'a read that answered left the run standing');
});

test('fleet-logins.sh — each refusal in a row doubles the pause, up to four hours', async (t) => {
  const home = fakeHome();
  const stamp = path.join(home, '.claude', '.fleet-usage-backoff');
  const p = await fakeProfile(200, IDENTITY, [429, { error: { type: 'rate_limit_error' } }]);
  t.after(() => p.close());

  let claude = pick(JSON.parse(await collect(home, p.url, p.usage)), 'claude_cli');
  assert.equal(claude.note, 'usage call refused with HTTP 429, pausing 600s');
  assert.equal(fs.readFileSync(stamp, 'utf8').split(' ')[1], '1');

  // The first pause has passed and the endpoint refuses again: the run is remembered, so the
  // second pause is twice the first.
  fs.writeFileSync(stamp, Math.floor(Date.now() / 1000) - 1 + ' 1');
  claude = pick(JSON.parse(await collect(home, p.url, p.usage)), 'claude_cli');
  assert.equal(claude.note, 'usage call refused with HTTP 429, pausing 1200s (2nd refusal)');
  const [deadline, streak] = fs.readFileSync(stamp, 'utf8').split(' ').map(Number);
  assert.equal(streak, 2);
  assert.ok(Math.abs(deadline - (Math.floor(Date.now() / 1000) + 1200)) <= 5, 'the stamp is a twenty-minute deadline');

  // A long run is capped: 600 * 2**9 is far past four hours.
  fs.writeFileSync(stamp, Math.floor(Date.now() / 1000) - 1 + ' 9');
  claude = pick(JSON.parse(await collect(home, p.url, p.usage)), 'claude_cli');
  assert.equal(claude.note, 'usage call refused with HTTP 429, pausing 14400s (10th refusal)');
});

test('fleet-logins.sh — a stamp written before the streak existed is still honoured', async (t) => {
  const home = fakeHome();
  const stamp = path.join(home, '.claude', '.fleet-usage-backoff');
  fs.writeFileSync(stamp, String(Math.floor(Date.now() / 1000) + 300));
  const p = await fakeProfile(200, IDENTITY, [200, USAGE_BODY]);
  t.after(() => p.close());

  const claude = pick(JSON.parse(await collect(home, p.url, p.usage)), 'claude_cli');
  assert.match(claude.note, /^usage call skipped, endpoint asked for a \d+s pause$/);
  assert.equal(p.calls.filter((c) => c.url === '/usage').length, 0);

  // Expired, it counts as no run at all: the refusal that follows pauses the floor.
  fs.writeFileSync(stamp, String(Math.floor(Date.now() / 1000) - 1));
  const no = await fakeProfile(200, IDENTITY, [429, { error: { type: 'rate_limit_error' } }]);
  t.after(() => no.close());
  const again = pick(JSON.parse(await collect(home, no.url, no.usage)), 'claude_cli');
  assert.equal(again.note, 'usage call refused with HTTP 429, pausing 600s');
});

// The live reply's shape, plus a `spend` block that must not travel and an extra_usage the
// deck reads amounts out of.
const USAGE_BODY = {
  five_hour: { utilization: 42.0, resets_at: '2026-09-06T20:00:00Z' },
  seven_day: { utilization: 7.5, resets_at: null },
  spend: { secret: 'NO' },
  limits: [{ kind: 'weekly_scoped', percent: 3, scope: { model: { display_name: 'Fable' } } }],
  extra_usage: {
    utilization: 1, used_credits: 100, monthly_limit: 4000, decimal_places: 2,
    currency: 'EUR', is_enabled: true, spend_limit_reached: false,
  },
};

test('fleet-logins.sh — a proved token also reports its usage, trimmed to what the deck reads', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(
    200,
    { account: { email: 'aylianator@gmail.com' }, organization: { uuid: ORG } },
    [200, USAGE_BODY]
  );
  t.after(() => p.close());
  const out = await collect(home, p.url, p.usage);
  const claude = pick(JSON.parse(out), 'claude_cli');

  assert.equal(claude.usage_state, 'ok');
  assert.equal(claude.usage.five_hour.utilization, 42);
  assert.equal(claude.usage.seven_day.utilization, 7.5);
  // Only the windows, the scoped limits and the credit pool travel; `spend` is none of them
  // and an unknown key added tomorrow leaves the box the same way.
  assert.equal(claude.usage.spend, undefined);
  assert.equal(claude.usage.limits[0].scope.model.display_name, 'Fable');
  assert.equal(claude.usage.extra_usage.currency, 'EUR');
  assert.ok(!out.includes(TOKEN), 'access token leaked into the reported line');
});

test('fleet-logins.sh — a rate-limited usage call is a state, not a lost identity', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(
    200,
    { account: { email: 'aylianator@gmail.com' }, organization: { uuid: ORG } },
    [429, { error: 'rate_limited' }]
  );
  t.after(() => p.close());
  const out = await collect(home, p.url, p.usage);
  const claude = pick(JSON.parse(out), 'claude_cli');

  assert.equal(claude.usage_state, 'rate_limited');
  assert.equal(claude.usage, undefined);
  // The profile answered, so the identity it proved stands whatever the second call did.
  assert.equal(claude.state, 'ok');
  assert.equal(claude.proof, 'profile');
  assert.equal(claude.email, 'aylianator@gmail.com');
  assert.equal(claude.org, ORG);
  assert.ok(!out.includes(TOKEN), 'access token leaked into the reported line');
});

test('fleet-logins.sh — windows nested under rate_limits are unwrapped, not dropped', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(
    200,
    { account: { email: 'aylianator@gmail.com' }, organization: { uuid: ORG } },
    [200, { rate_limits: { five_hour: { utilization: 5.0, resets_at: null } } }]
  );
  t.after(() => p.close());
  const out = await collect(home, p.url, p.usage);
  const claude = pick(JSON.parse(out), 'claude_cli');

  // Trimming the outer object of this shape used to keep nothing, so the deck saw a proved
  // login reporting no windows at all.
  assert.equal(claude.usage_state, 'ok');
  assert.equal(claude.usage.five_hour.utilization, 5);
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
// The sweep's own connect timeout, not the session polls' 8s: a box waking from standby
// (rog-strix) takes longer than that to answer TCP at all.
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=25'];
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

  // One progress row per POLLED machine, in file order. The push machine is not polled, so
  // a Refresh must not sit waiting on a row that nothing is fetching.
  const sweep = r.body.sweep;
  assert.deepStrictEqual(sweep.machines.map((m) => m.id), ['german-box', 'vps', 'macbook']);
  assert.deepStrictEqual(sweep.machines.map((m) => m.status), ['ok', 'ok', 'ok']);
  assert.deepStrictEqual(sweep.machines.map((m) => m.label), ['German Box', 'VPS', 'MacBook Pro']);
  for (const m of sweep.machines) {
    assert.equal(typeof m.ms, 'number', m.id + ' has no elapsed time');
    assert.equal(m.error, null);
  }
  assert.equal(sweep.collecting, false);
  assert.equal(sweep.credits_collecting, false);
});

// The Accounts page's Refresh calls this endpoint, and the live per-account usage is what the
// logins sweep carries — a Refresh that ran only fleet-credits.sh asked the old question.
test('/api/credits?refresh=1 — the logins sweep runs first, then the credits collect', async (t) => {
  const dir = tmpdir('credits-refresh');
  const log = path.join(dir, 'argv.log');
  // A stub for the deck's own machine, so the collect never reads this Mac's credentials.
  const creditsSh = path.join(dir, 'stub-credits.sh');
  fs.writeFileSync(creditsSh, "#!/bin/sh\nprintf '%s\\n' '{\"ts\":1757000000,\"host\":\"mac\"}'\n");
  const env = {
    ...fixture(dir, LINE, [
      { id: 'german-box', label: 'German Box', os: 'windows', route: 'ssh', ssh: 'gb-deploy', wsl: true },
      { id: 'rog-strix', label: 'ROG Strix', os: 'windows', route: 'push' },
    ]),
    FLEET_CREDITS_SH: creditsSh,
    FLEET_SSH_BIN: SHIM,
    FLEET_SHIM_ARGV_LOG: log,
    FLEET_SHIM_MAP_WSL: '1',
  };
  // No hosts: the only ssh call in the log is then the sweep's own, not the credits fan-out's.
  const s = await startServer(env, { dir, hosts: [] });
  t.after(() => s.stop());

  const r = await s.get('/api/credits?refresh=1');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.rows));
  // The sweep is piped as `[wsl] sh -s`; fleet-credits.sh is never sent that way.
  const swept = argvLog(log).filter((c) => c[c.length - 1] === 'wsl sh -s' || c[c.length - 1] === 'sh -s');
  assert.equal(swept.length, 1, 'the sweep did not run: ' + JSON.stringify(argvLog(log)));
  assert.deepStrictEqual(swept[0], [...SSH_OPTS, 'gb-deploy', 'wsl sh -s']);

  // That sweep's own progress is readable afterwards, and this GET does not start another
  // one: the TTL was claimed when the sweep began.
  const after = await s.get('/api/machines');
  assert.deepStrictEqual(after.body.sweep.machines.map((m) => [m.id, m.status]), [['german-box', 'ok']]);
  assert.equal(argvLog(log).length, 1, 'the plain GET started a second sweep');
});

// Two Refreshes can overlap — the Accounts screen's runs the sweep through /api/credits, the
// Machines screen's runs its own — so progress is kept per sweep. A later sweep resetting a
// shared map would blank the rows the earlier one is still filling, and settle into whatever
// row then held that id.
test('/api/machines — two overlapping forced sweeps keep whole progress rows', async (t) => {
  const dir = tmpdir('machines-overlap');
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
    FLEET_SHIM_MAP_WSL: '1',
  };
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  const both = await Promise.all([s.get('/api/machines?refresh=1'), s.get('/api/machines?refresh=1')]);
  for (const r of both) assert.equal(r.status, 200);

  // The newest sweep's rows, whole: one per POLLED machine, every one settled and timed.
  const sweep = (await s.get('/api/machines')).body.sweep;
  assert.deepStrictEqual(sweep.machines.map((m) => m.id), ['german-box', 'vps', 'macbook']);
  assert.deepStrictEqual(sweep.machines.map((m) => m.status), ['ok', 'ok', 'ok']);
  for (const m of sweep.machines) assert.equal(typeof m.ms, 'number', m.id + ' has no elapsed time');
  assert.equal(sweep.collecting, false);
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

  const body = (await s.get('/api/machines?refresh=1')).body;
  const rows = new Map(body.machines.map((m) => [m.id, m]));
  const down = rows.get('german-box');
  // ssh's own words, so the row says why rather than blaming the collector.
  assert.ok(down.error && down.error.includes('Connection timed out'), JSON.stringify(down.error));
  assert.notEqual(down.state, 'ok');
  assert.equal(rows.get('vps').state, 'ok');
  assert.equal(rows.get('vps').error, null);

  // The Refresh popup reads the same failure from the sweep's own progress: the box that
  // could not be reached is marked, and the one beside it still settled ok.
  const sweep = new Map(body.sweep.machines.map((m) => [m.id, m]));
  assert.equal(sweep.get('german-box').status, 'error');
  assert.ok(sweep.get('german-box').error.includes('Connection timed out'), JSON.stringify(sweep.get('german-box').error));
  assert.equal(sweep.get('vps').status, 'ok');
  assert.equal(sweep.get('vps').error, null);
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

// --- A proved Claude login carries usage, and usage is a Credits fact: it lands on the
// credits row, never a second time on the machines row.
test('/api/machines — a collected usage reply lands on the credits row, not on the machines one', async (t) => {
  const dir = tmpdir('machines-credits');
  const now = Math.floor(Date.now() / 1000);
  const env = hostFixture(dir, {
    v: 1,
    id: 'macbook',
    host: 'rfc1918-internal',
    os: 'darwin',
    ts: now,
    clients: [
      {
        client: 'claude_cli', where: 'local', installed: true, signed_in: true, state: 'ok',
        proof: 'profile', email: 'aylianator@gmail.com', org: ORG, access_token: SECRET,
        usage_state: 'ok',
        usage: { five_hour: { utilization: 42, resets_at: null }, seven_day: { utilization: 7, resets_at: null } },
      },
    ],
  });
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  const r = await s.get('/api/machines?refresh=1');
  assert.equal(r.status, 200);
  const mac = r.body.machines.find((m) => m.id === 'macbook');
  const claude = mac.clients.find((c) => c.client === 'claude_cli' && c.where === 'local');
  assert.equal(claude.usage.windows.five_hour.pct, 42);
  assert.equal(claude.usage.windows.seven_day.pct, 7);
  assert.equal(claude.usage.stale_windows, false);

  const db = s.open();
  t.after(() => db.close());
  const row = db.prepare('SELECT payload FROM credits WHERE kind = ? AND id = ?').get('claude', 'aylianator@gmail.com');
  assert.ok(row, 'the machines collect wrote no credits row');
  const credits = JSON.parse(row.payload);
  // A live token read, so the row is sourced as one and reads like any other oauth row.
  assert.equal(credits.source, 'oauth');
  assert.equal(credits.state, 'ok');
  assert.equal(credits.windows.five_hour.pct, 42);
  // clientRow's whitelist is what keeps the numbers in one place: the machines row is
  // identity, and storing usage there too would let the two disagree.
  const stored = JSON.parse(db.prepare('SELECT payload FROM machines WHERE id = ?').get('macbook').payload);
  assert.ok(!JSON.stringify(stored).includes('usage'), 'usage was stored on the machines row too');

  // The same walk as the join test: a usage reply must not smuggle a credential through.
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

// --- creditsWrite's borrow, and beats(). Exported seams: the write goes to the throwaway db
// of the seams() instance, so the stored payload is the assertion.
const zeroOauth = (now) => ({
  kind: 'claude', id: 'borrow@example.invalid', email: 'borrow@example.invalid', org: ORG,
  host: 'mac', source: 'oauth', state: 'ok', updated_at: now,
  windows: { five_hour: { pct: 0, resets_at: null }, seven_day: { pct: 0, resets_at: null } },
});
const desktopAt = (now, age) => ({
  kind: 'claude', id: 'borrow@example.invalid', email: 'borrow@example.invalid', org: ORG,
  host: 'mac', source: 'desktop', state: 'ok', updated_at: now - age, sample_ts: now - age,
  windows: { five_hour: { pct: 61, resets_at: null } },
});
const storedRow = (m, id) =>
  JSON.parse(m.db.prepare('SELECT payload FROM credits WHERE kind = ? AND id = ?').get('claude', id).payload);

test('creditsWrite — a stale alternate cannot lend its windows to a signal-free reply', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  m.creditsWrite([zeroOauth(now), desktopAt(now, 8 * 86400)]);

  // The desktop sample is eight days old: its five-hour window has reset many times over, so
  // it vouches for nothing. A profile-proved 0% with nothing fresher to contradict it IS 0%.
  const r = storedRow(m, 'borrow@example.invalid');
  assert.equal(r.source, 'oauth');
  assert.equal(r.windows.five_hour.pct, 0);
  assert.equal(r.windows_from, undefined);
});

test('creditsWrite — a fresh alternate does lend its windows', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  m.creditsWrite([zeroOauth(now), desktopAt(now, 600)]);

  const r = storedRow(m, 'borrow@example.invalid');
  assert.equal(r.source, 'oauth');
  assert.equal(r.windows_from, 'desktop');
  assert.equal(r.windows.five_hour.pct, 61);
});

test('beats — on equal rank the newer rollout snapshot wins, not the reply that landed last', (t) => {
  const { beats } = seams(t);
  // Both Codex rows, so both rank 2: whichever ssh reply finished last used to win, and the
  // row flipped between a current 74% and a month-old 0% on every page load.
  const a = { source: 'codex', state: 'ok', updated_at: NOW - 100, snapshot_ts: NOW };
  const b = { source: 'codex', state: 'ok', updated_at: NOW, snapshot_ts: NOW - 10 * 86400 };
  assert.equal(beats(a, b), true);
  assert.equal(beats(b, a), false);

  // With no snapshot to compare, the read date is still the only date there is.
  const a2 = { ...a, snapshot_ts: null };
  const b2 = { ...b, snapshot_ts: null };
  assert.equal(beats(a2, b2), false);
  assert.equal(beats(b2, a2), true);
});

test('beats — on equal rank the newer desktop sample wins, not the ssh reply that landed last', (t) => {
  const { beats } = seams(t);
  // The lafayette row: both desktop, both rank 1, and updated_at is only when each machine was
  // asked — so a box's nine-day-old sample outlasted the mac's twelve-minute-old one.
  const a = { source: 'desktop', state: 'ok', updated_at: NOW - 1, sample_ts: NOW - 720 };
  const b = { source: 'desktop', state: 'ok', updated_at: NOW, sample_ts: NOW - 9 * 86400 };
  assert.equal(beats(a, b), true);
  assert.equal(beats(b, a), false);
});

test('beats — a failed read neither pins a row nor erases a good one, at any rank', (t) => {
  const { beats } = seams(t);
  // The aylianator row: a six-hour-old oauth error (rank 3) held the row against fresh desktop
  // samples (rank 1), so the page read "could not read usage" over a borrowed 14-day-old number.
  const stale = { source: 'oauth', state: 'error', updated_at: NOW - 6 * 3600 };
  const fresh = { source: 'desktop', state: 'ok', updated_at: NOW, sample_ts: NOW - 3 * 3600 };
  assert.equal(beats(fresh, stale), true);

  // And the other way: a rate-limited oauth call must not replace a minute-old desktop sample
  // with a banner just because it outranks it.
  const failed = { source: 'oauth', state: 'rate_limited', updated_at: NOW };
  const good = { source: 'desktop', state: 'ok', updated_at: NOW - 60, sample_ts: NOW - 60 };
  assert.equal(beats(failed, good), false);
});

test('creditsWrite — a live reading ages out too, on its own read time', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  // An oauth row carries no sample stamp — a live read has nothing but the moment it was
  // taken. agedOut() used to skip exactly those rows, so a token read hours ago kept
  // printing a five-hour window as a current figure. Observed on the deck 2026-09-08:
  // aylianator's row was 3.6 h old and shown with no staleness marker at all.
  m.creditsWrite([
    {
      kind: 'claude', id: 'aged@example.invalid', email: 'aged@example.invalid', org: ORG,
      host: 'mac', source: 'oauth', state: 'ok', updated_at: now - 3 * 3600,
      windows: { five_hour: { pct: 42, resets_at: 'x' }, seven_day: { pct: 7, resets_at: 'x' } },
    },
  ]);
  const row = m.creditsRows().find((r) => r.email === 'aged@example.invalid');
  // Three hours is past the five-hour window's own bound and well inside the weekly's.
  assert.equal(row.windows.five_hour.pct, null);
  assert.equal(row.windows.five_hour.stale, true);
  assert.equal(row.windows.seven_day.pct, 7);
  assert.equal(row.stale_windows, true);
});

const liveRead = (now, age) => ({
  kind: 'claude', id: 'fresh@example.invalid', email: 'fresh@example.invalid', org: ORG,
  host: 'thinkpromptly-vps', source: 'oauth', state: 'ok', updated_at: now - age,
  windows: {
    five_hour: { pct: 57, resets_at: now + 5000 }, seven_day: { pct: 31, resets_at: now + 500000 },
    seven_day_fable: { pct: 48, resets_at: now + 500000 },
  },
});
const sampleAt = (m, t, fh, sd) =>
  m.db.prepare('INSERT OR IGNORE INTO credits_history (org, t, fh, sd, xu) VALUES (?, ?, ?, ?, NULL)').run(ORG, t, fh, sd);

test('creditsRows — a desktop sample newer than the live read supplies the windows it covers', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  // The usage call is hourly at most; the desktop app sampled this account seven minutes ago.
  // Observed on the deck 2026-09-10: the bar said 31% over a trend line ending at 30%.
  m.creditsWrite([liveRead(now, 3600)]);
  sampleAt(m, now - 7200, 10, 20);
  sampleAt(m, now - 420, 51, 30);
  const row = m.creditsRows().find((r) => r.email === 'fresh@example.invalid');
  assert.equal(row.windows.five_hour.pct, 51);
  assert.equal(row.windows.seven_day.pct, 30);
  // What the sample cannot supply is still the live read's.
  assert.equal(row.windows.five_hour.resets_at, now + 5000);
  assert.equal(row.windows.seven_day_fable.pct, 48);
  assert.deepEqual(row.fresh, { t: now - 420, windows: ['five_hour', 'seven_day'] });
  // The row is still the live read's, dated by it: nothing pretends the sample read everything.
  assert.equal(row.windows_from, undefined);
  assert.equal(row.sample_ts, undefined);
  assert.equal(row.source, 'oauth');
});

test('creditsRows — a refreshed window ages by its sample, an untouched one by the read', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  // A thirty-hour-old read, and a sample three minutes ago that knows nothing about Fable.
  m.creditsWrite([liveRead(now, 30 * 3600)]);
  sampleAt(m, now - 180, 51, 30);
  const row = m.creditsRows().find((r) => r.email === 'fresh@example.invalid');
  assert.equal(row.windows.five_hour.pct, 51);
  assert.equal(row.windows.seven_day.pct, 30);
  assert.equal(row.windows.seven_day_fable.pct, null);
  assert.equal(row.windows.seven_day_fable.last, 48);
  assert.equal(row.windows.seven_day_fable.stale, true);
  assert.equal(row.stale_windows, true);
});

test('creditsRows — a desktop sample older than the live read changes nothing', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  m.creditsWrite([liveRead(now, 420)]);
  sampleAt(m, now - 3600, 51, 30);
  const row = m.creditsRows().find((r) => r.email === 'fresh@example.invalid');
  assert.equal(row.windows.five_hour.pct, 57);
  assert.equal(row.windows.seven_day.pct, 31);
  assert.equal(row.fresh, undefined);
  assert.equal(row.sample_ts, undefined);
});

test('beats — a weaker source read just now takes over a half-day-old live row only with newer numbers', (t) => {
  const { beats } = seams(t);
  // This morning's live reading, twelve hours old. The mac reads its desktop history now,
  // but that history's newest sample is three days old — older than the live numbers.
  const live = { source: 'oauth', state: 'ok', updated_at: NOW - 13 * 3600 };
  const staleSample = { source: 'desktop', state: 'ok', updated_at: NOW, sample_ts: NOW - 3 * 86400 };
  assert.equal(beats(staleSample, live, NOW), false, 'older numbers displaced a live reading');
  // A sample newer than the live read is the fresher truth, and the rank-stale rule stands.
  const freshSample = { source: 'desktop', state: 'ok', updated_at: NOW, sample_ts: NOW - 600 };
  assert.equal(beats(freshSample, live, NOW), true);
  // Under twelve hours the better source is simply still reporting: no takeover either way.
  const recentLive = { source: 'oauth', state: 'ok', updated_at: NOW - 3600 };
  assert.equal(beats(freshSample, recentLive, NOW), false);
});

test('beats — a sample past every window it carries cannot displace a failed read', (t) => {
  const { beats } = seams(t);
  // Rule 2 ("a reading that worked beats a failure") used to fire on state alone. So a desktop
  // sample weeks past its own five-hour window won the batch against a failed oauth call and
  // then overwrote the last row that still held real numbers — with a figure agedOut() only
  // greys back out. A failed read asserts nothing; neither does this, so it must not win.
  const spent = {
    source: 'desktop', state: 'ok', updated_at: NOW, sample_ts: NOW - 20 * 86400,
    windows: { five_hour: { pct: 15, resets_at: null } },
  };
  const failed = { source: 'oauth', state: 'rate_limited', updated_at: NOW };
  assert.equal(beats(spent, failed, NOW), false);

  // A sample still inside its window keeps the behaviour the rule was added for: the stale
  // failure of a better source does not get to pin the row against numbers that are real.
  assert.equal(beats({ ...spent, sample_ts: NOW - 600 }, failed, NOW), true);
});

test('creditsWrite — a spent sample does not overwrite the last real reading', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  // Yesterday's live reading, already past RANK_STALE so nothing shields it by age alone.
  m.creditsWrite([
    { ...zeroOauth(now - 13 * 3600), updated_at: now - 13 * 3600,
      windows: { five_hour: { pct: 42, resets_at: 'x' }, seven_day: { pct: 7, resets_at: 'x' } } },
  ]);
  assert.equal(storedRow(m, 'borrow@example.invalid').windows.five_hour.pct, 42);

  // This sweep: the token read fails, and the only other candidate is three weeks stale.
  m.creditsWrite([
    { ...zeroOauth(now), state: 'rate_limited', windows: {} },
    // Read this sweep (updated_at = now) but describing a sample three weeks old — the shape
    // a desktop history file actually has once that account stopped using the app.
    { ...desktopAt(now, 20 * 86400), updated_at: now, windows: { five_hour: { pct: 15, resets_at: null } } },
  ]);
  // Whatever the row now says, it must not be the stale number: 42 stands or the failure is
  // reported, but 15% was never true of this account at any point the deck can vouch for.
  assert.notEqual(storedRow(m, 'borrow@example.invalid').windows.five_hour?.pct, 15);
});

// --- The hold a failed read leaves behind. beats() still refuses to let it displace good
// numbers; without a mark on the row nothing on the page said the live call was not made.
const throttled = (ts, note) => ({
  v: 1, id: 'rog-strix', host: 'ROG Strix', ts,
  clients: [{
    client: 'claude_cli', proof: 'profile', email: 'borrow@example.invalid', org: ORG,
    usage_state: 'rate_limited', usage: null, note,
  }],
});

test('machinesCredits — a refused usage call is still a candidate, with the collector\'s words', (t) => {
  const { machinesCredits, creditsWrite } = seams(t);
  const now = Math.floor(Date.now() / 1000);
  const out = machinesCredits(throttled(now, 'usage call refused with HTTP 429, pausing 3600s'), 'ROG Strix', new Map(), false);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'rate_limited');
  assert.equal(out[0].email, 'borrow@example.invalid');
  assert.deepEqual(out[0].windows, {});
  assert.equal(out[0].note, 'usage call refused with HTTP 429, pausing 3600s');
  // A clean read with no windows at all is still nothing to report.
  assert.deepEqual(machinesCredits(
    { v: 1, id: 'rog-strix', ts: now, clients: [{ client: 'claude_cli', proof: 'profile', email: 'x@example.invalid', org: ORG, usage_state: 'ok', usage: null }] },
    'ROG Strix', new Map(), false
  ), []);
  assert.equal(typeof creditsWrite, 'function');
});

test('creditsWrite — a losing throttled read marks the row it could not displace', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  // Yesterday's desktop sample is what the page is showing. The mac's live read this sweep
  // was refused: it carries no numbers, so it must not win — but it must be visible.
  m.creditsWrite([desktopAt(now, 600)]);
  m.creditsWrite(m.machinesCredits(throttled(now, 'usage call refused with HTTP 429, pausing 3600s'), 'ROG Strix', new Map(), false));

  const r = storedRow(m, 'borrow@example.invalid');
  assert.equal(r.source, 'desktop');
  assert.equal(r.windows.five_hour.pct, 61, 'the last good numbers were lost');
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.hold, {
    state: 'rate_limited', host: 'ROG Strix',
    note: 'usage call refused with HTTP 429, pausing 3600s', at: now, until: now + 3600,
  });
  // The other note the collector writes states the pause the same way round.
  const m2 = seams(t);
  m2.creditsWrite([desktopAt(now, 600)]);
  m2.creditsWrite(m2.machinesCredits(throttled(now, 'usage call skipped, endpoint asked for a 3147s pause'), 'ROG Strix', new Map(), false));
  assert.equal(storedRow(m2, 'borrow@example.invalid').hold.until, now + 3147);
  // One sweep carries both: the mac's sample and the box's refusal land in the same write,
  // where the refusal loses the candidate round before it ever meets the stored row.
  const m3 = seams(t);
  m3.creditsWrite([
    desktopAt(now, 600),
    ...m3.machinesCredits(throttled(now, 'usage call refused with HTTP 429, pausing 3600s'), 'ROG Strix', new Map(), false),
  ]);
  const r3 = storedRow(m3, 'borrow@example.invalid');
  assert.equal(r3.windows.five_hour.pct, 61);
  assert.equal(r3.hold.until, now + 3600);
});

test('creditsWrite — a read that works clears the hold, and a stale one is dropped on the way out', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  m.creditsWrite([desktopAt(now, 600)]);
  m.creditsWrite(m.machinesCredits(throttled(now, 'usage call refused with HTTP 429, pausing 3600s'), 'ROG Strix', new Map(), false));
  assert.ok(storedRow(m, 'borrow@example.invalid').hold);

  // The mac re-reports the same desktop sample a minute later: not a live read, so the
  // hold rides along with the rewritten row.
  m.creditsWrite([desktopAt(now + 60, 600)]);
  assert.ok(storedRow(m, 'borrow@example.invalid').hold, 'a re-sample wiped the hold');
  // The next sweep reads live: the winning row is the fresh payload, which carries no hold.
  m.creditsWrite([{ ...zeroOauth(now), windows: { five_hour: { pct: 12, resets_at: null } } }]);
  assert.equal(storedRow(m, 'borrow@example.invalid').hold, undefined);

  // And a hold nobody has re-reported for half a day is no longer news.
  const old = seams(t);
  old.creditsWrite([desktopAt(now - 13 * 3600, 600)]);
  old.creditsWrite(old.machinesCredits(throttled(now - 13 * 3600, 'usage call refused with HTTP 429, pausing 3600s'), 'ROG Strix', new Map(), false));
  assert.ok(storedRow(old, 'borrow@example.invalid').hold);
  assert.equal(old.creditsRows().find((r) => r.email === 'borrow@example.invalid').hold, undefined);
});

test('creditsRows — an aged-out window keeps the number it last held', (t) => {
  const m = seams(t);
  const now = Math.floor(Date.now() / 1000);
  m.creditsWrite([
    {
      kind: 'claude', id: 'aged@example.invalid', email: 'aged@example.invalid', org: ORG,
      host: 'mac', source: 'oauth', state: 'ok', updated_at: now - 8 * 86400,
      windows: { five_hour: { pct: 42, resets_at: 'x' }, seven_day: { pct: null, resets_at: null } },
    },
  ]);
  const row = m.creditsRows().find((r) => r.email === 'aged@example.invalid');
  assert.equal(row.windows.seven_day.stale, true);
  // "—" tells a reader nothing; the last figure, greyed, tells them what it was.
  assert.equal(row.windows.five_hour.pct, null);
  assert.equal(row.windows.five_hour.last, 42);
  // Nothing to keep means nothing invented.
  assert.equal('last' in row.windows.seven_day, false);
});

test('creditsWrite — the newer desktop sample is stored, whichever machine reported last', (t) => {
  const now = Math.floor(Date.now() / 1000);
  const mac = {
    kind: 'claude', id: 'lafayette@example.invalid', email: 'lafayette@example.invalid', org: ORG,
    host: 'mac', source: 'desktop', state: 'ok', updated_at: now - 2, sample_ts: now - 720,
    windows: { five_hour: { pct: 59, resets_at: null }, seven_day: { pct: 52, resets_at: null } },
  };
  const box = {
    kind: 'claude', id: 'lafayette@example.invalid', email: 'lafayette@example.invalid', org: ORG,
    host: 'box', source: 'desktop', state: 'ok', updated_at: now, sample_ts: now - 9 * 86400,
    windows: { five_hour: { pct: 0, resets_at: null }, seven_day: { pct: 30, resets_at: null } },
  };
  // Either arrival order: the sample's own age decides, not which ssh reply finished last.
  for (const rows of [[mac, box], [box, mac]]) {
    const m = seams(t);
    m.creditsWrite(rows);
    const r = storedRow(m, 'lafayette@example.invalid');
    assert.equal(r.windows.seven_day.pct, 52);
    assert.equal(r.sample_ts, now - 720);
  }
});

// One stub for two local machines: FLEET_LOGINS_SH is a single path, so the two replies are
// claimed with mkdir — atomic, so each of the concurrent calls takes exactly one of them. The
// second answers late on purpose: b landing last is the order the per-machine write got wrong.
function pairFixture(dir, a, b) {
  const stub = path.join(dir, 'stub-logins.sh');
  fs.writeFileSync(
    stub,
    '#!/bin/sh\nif mkdir ' + JSON.stringify(path.join(dir, 'claimed')) + " 2>/dev/null; then\n" +
      "printf '%s\\n' '" + JSON.stringify(a) + "'\nelse\nsleep 0.2\nprintf '%s\\n' '" + JSON.stringify(b) + "'\nfi\n"
  );
  const cfg = path.join(dir, 'machines.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      machines: [
        { id: 'macbook', host: 'mac', label: 'MacBook Pro', os: 'macos', route: 'local' },
        { id: 'german-box', host: 'german-box', label: 'German Box', os: 'linux', route: 'local' },
      ],
    })
  );
  return { FLEET_LOGINS_SH: stub, FLEET_MACHINES_FILE: cfg };
}

const usageLine = (host, now, windows) => ({
  v: 1, host, os: 'linux', ts: now,
  clients: [
    {
      client: 'claude_cli', where: 'local', installed: true, signed_in: true, state: 'ok',
      proof: 'profile', email: 'aylianator@gmail.com', org: ORG, usage_state: 'ok', usage: windows,
    },
  ],
});

test('/api/machines — one account on two machines: the real reading survives the empty reply', async (t) => {
  const dir = tmpdir('machines-pair');
  const now = Math.floor(Date.now() / 1000);
  const env = pairFixture(
    dir,
    usageLine('mac', now, { five_hour: { utilization: 63, resets_at: null }, seven_day: { utilization: 20, resets_at: null } }),
    // The unpopulated reply the endpoint gives for some accounts: every window zero, every
    // reset null. Written per machine it clobbered the real reading whenever it landed last.
    usageLine('german-box', now, { five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 0, resets_at: null } })
  );
  const s = await startServer(env, { dir });
  t.after(() => s.stop());

  assert.equal((await s.get('/api/machines?refresh=1')).status, 200);
  const db = s.open();
  t.after(() => db.close());
  const row = JSON.parse(
    db.prepare('SELECT payload FROM credits WHERE kind = ? AND id = ?').get('claude', 'aylianator@gmail.com').payload
  );
  // Whichever machine finished last: 63 is the only reading either of them actually holds.
  assert.equal(row.windows.five_hour.pct, 63);
  assert.ok(row.windows_from === undefined || row.windows_from === 'oauth', 'borrowed from ' + row.windows_from);
});

test('/api/credits — a future snapshot stamp is clamped, so it cannot pin the row for good', async (t) => {
  const dir = tmpdir('credits-snapshot');
  const s = await startServer({}, { dir });
  t.after(() => s.stop());
  const now = Math.floor(Date.now() / 1000);
  const push = (updated_at, snapshot_ts, percent) =>
    s.post('/api/credits', {
      kind: 'codex', email: 'admin@deus.finance', host: 'rog-strix', state: 'ok',
      updated_at, snapshot_ts, rate_limits: { primary: { used_percent: percent } },
    });
  const db = s.open();
  t.after(() => db.close());
  const row = () =>
    JSON.parse(db.prepare('SELECT payload FROM credits WHERE kind = ? AND id = ?').get('codex', 'admin@deus.finance').payload);

  // Two hours ago, claiming a snapshot from thirty years hence: no genuine reading could
  // ever carry a larger one, so unclamped it would win the same-rank tie for good.
  assert.equal((await push(now - 7200, now + 999999999, 74)).status, 200);
  assert.ok(row().snapshot_ts <= now, 'a future snapshot stamp was stored as claimed');

  // A real read two hours later, its snapshot the rollout it just saw.
  assert.equal((await push(now, now, 30)).status, 200);
  assert.equal(row().weekly.pct, 30);
  assert.equal(row().snapshot_ts, now);
});

// --- The usage endpoint's hourly schedule (operator ruling 2026-09-10): read once an hour at
// most, and only inside the deck's local window. A Refresh click always reads.
const schedule = (t, env = {}) => {
  const dir = tmpdir('usage-schedule');
  const m = load({ FLEET_DB: path.join(dir, 'fleet.db'), FLEET_HOSTS_FILE: hostsFile(dir), ...env });
  t.after(async () => {
    await unload(m);
    delete process.env.FLEET_NO_LISTEN;
    delete process.env.FLEET_USAGE_HOURS;
    delete process.env.FLEET_USAGE_EVERY_SECS;
  });
  return m;
};
const at = (h, min = 0) => new Date(2026, 8, 10, h, min, 0);

test('usageHoursOpen — 11-3 wraps midnight, and a plain range does not', (t) => {
  const { usageHoursOpen } = schedule(t);
  for (const d of [at(11), at(23), at(2, 59)]) assert.equal(usageHoursOpen(d), true, d.toString());
  for (const d of [at(3), at(10, 59)]) assert.equal(usageHoursOpen(d), false, d.toString());
});

test('usageHoursOpen — a non-wrapping window is the plain half-open range', (t) => {
  const { usageHoursOpen } = schedule(t, { FLEET_USAGE_HOURS: '9-17' });
  assert.equal(usageHoursOpen(at(9)), true);
  assert.equal(usageHoursOpen(at(16, 59)), true);
  assert.equal(usageHoursOpen(at(17)), false);
  assert.equal(usageHoursOpen(at(8, 59)), false);
});

test('usageDue — one read an hour inside the window, and a Refresh whenever it is asked', (t) => {
  const { usageDue } = schedule(t);
  const open = at(12).getTime();
  const shut = at(6).getTime();

  // Inside the hours: the first sweep reads, the ones behind it in the same hour do not.
  assert.equal(usageDue(false, open), true);
  assert.equal(usageDue(false, open + 60000), false);
  assert.equal(usageDue(false, open + 3599999), false);
  assert.equal(usageDue(false, open + 3600000), true);

  // Outside them nothing reads on its own — but a Refresh does, and it claims that hour.
  assert.equal(usageDue(false, shut), false);
  assert.equal(usageDue(true, shut), true);
  assert.equal(usageDue(false, shut + 60000), false);
});

test('fleet-logins.sh — a sweep outside the hour proves the identity and asks for no usage', async (t) => {
  const home = fakeHome();
  const p = await fakeProfile(200, IDENTITY, [200, USAGE_BODY]);
  t.after(() => p.close());
  const claude = pick(JSON.parse(await collect(home, p.url, p.usage, undefined, { FLEET_READ_USAGE: '0' })), 'claude_cli');

  assert.equal(claude.proof, 'profile');
  assert.equal(claude.state, 'ok');
  assert.equal(claude.email, 'aylianator@gmail.com');
  assert.equal(p.calls.filter((c) => c.url === '/usage').length, 0, 'the usage endpoint was asked anyway');
  // No numbers is not a failed read: the row claims no usage state, so machinesCredits()
  // emits no candidate for it and the stored row keeps whatever it holds.
  assert.equal(claude.usage_state, undefined);
  assert.equal(claude.usage, undefined);
  assert.equal(claude.note, 'usage read skipped this sweep (hourly schedule)');
  assert.ok(!fs.existsSync(path.join(home, '.claude', '.fleet-usage-backoff')), 'a skipped read armed the throttle');
});

test('fleet-credits.sh — it reads no token and reports no live Claude row, and samples anyway', async (t) => {
  // The script named the account from ~/.claude.json but read the token from the credential
  // store, and on the Mac the two disagreed: one person's numbers under another's name. It
  // now reads no token and calls no endpoint at all — the logins sweep is the live source.
  const home = fakeHome();
  const appDir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'plan-usage-history.json'),
    JSON.stringify({ samples: [{ org: CONFIG_ORG, t: 1757000000000, u: { fh: 12, sd: 34, xu: 5 } }] })
  );
  const out = (
    await promisify(execFile)('sh', [path.join(ROOT, 'box', 'fleet-credits.sh')], {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 30000,
    })
  ).stdout.trim();
  const d = JSON.parse(out.split('\n').pop());

  // The same shape as a machine with no CLI login: no state to mistake for a failed read.
  assert.equal(d.claude, null);
  assert.equal(d.desktop.length, 1);
  assert.equal(d.desktop[0].org, CONFIG_ORG);
  assert.equal(d.history.length, 1);
  assert.equal(d.accounts[0].email, 'lafayette@infinite-holdings.llc');
  assert.ok(!out.includes(TOKEN), 'access token leaked into the reported line');
});

// The same disagreement seen from the deck's side: an installed copy of fleet-credits.sh that
// still reads a token would report a live Claude row, and the collect must drop it.
test('creditsCollect — a credits reply\'s live Claude row is dropped, not stored', async (t) => {
  const dir = tmpdir('credits-drop');
  const ghost = {
    host: 'fake',
    ts: Math.floor(Date.now() / 1000),
    claude: {
      email: 'ghost@example.invalid',
      org: '11111111-1111-4111-8111-111111111111',
      state: 'ok',
      usage: { five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 20, resets_at: null } },
    },
    desktop: [],
    history: [],
    accounts: [],
    codex: null,
  };
  const sh = path.join(dir, 'ghost-credits.sh');
  fs.writeFileSync(sh, "#!/bin/sh\ncat <<'EOF'\n" + JSON.stringify(ghost) + '\nEOF\n');
  // No hosts: the collect's fan-out has nothing to ssh to, so the stub is the only reply.
  const m = load({
    FLEET_DB: path.join(dir, 'fleet.db'),
    FLEET_HOSTS_FILE: hostsFile(dir, []),
    FLEET_CREDITS_SH: sh,
  });
  t.after(async () => {
    await unload(m);
    delete process.env.FLEET_NO_LISTEN;
  });

  await m.creditsCollect(true);
  const stored = m.creditsRows().filter((r) => r.id === 'ghost@example.invalid');
  assert.deepEqual(stored, [], 'the reply\'s live Claude row was stored: ' + JSON.stringify(stored));

  // Control: the normalizer still yields that row. The drop is creditsCollect's doing, so
  // the logins sweep — which feeds creditsCandidates itself — keeps its live source.
  const cand = m.creditsCandidates(ghost, 'fake', new Map(), false);
  const oauth = cand.filter((c) => c.kind === 'claude' && c.source === 'oauth');
  assert.equal(oauth.length, 1);
  assert.equal(oauth[0].id, 'ghost@example.invalid');
  assert.equal(oauth[0].windows.five_hour.pct, 10);
});

// The usage-call log: one stored line per call the fleet made, so a refusal survives the
// sweep that overwrote the client row's note.
test('usage_log — a refused call and a read that answered are both kept, a schedule skip is not', (t) => {
  const { usageLogWrite, db } = seams(t);
  const now = Math.floor(Date.now() / 1000);
  usageLogWrite({ v: 1, id: 'rog-strix', ts: now, clients: [
    {
      client: 'claude_cli', proof: 'profile', email: 'borrow@example.invalid', org: ORG,
      usage_state: 'rate_limited',
      note: 'usage call refused with HTTP 429, pausing 600s',
      usage_call: { at: now, code: 429, retry_after: 216, pause: 600, skipped: null, ok: false },
    },
    {
      client: 'claude_cli', proof: 'profile', email: 'read@example.invalid', org: ORG,
      usage_state: 'ok', note: null,
      usage_call: { at: now - 1, code: 200, retry_after: null, pause: null, skipped: null, ok: true },
      usage: {
        five_hour: { utilization: 12 },
        seven_day: { utilization: 57 },
        limits: [{ kind: 'weekly_scoped', percent: 100, scope: { model: { display_name: 'Fable' } } }],
      },
    },
    // Off the hour the deck asks nobody: a line per account every five minutes saying so
    // would bury the calls that were actually made.
    {
      client: 'claude_cli', proof: 'profile', email: 'quiet@example.invalid', org: ORG,
      note: 'usage read skipped this sweep (hourly schedule)',
      usage_call: { at: now, code: null, retry_after: null, pause: null, skipped: 'schedule', ok: false },
    },
    // Nothing proved this one, so there was no usage call to log.
    { client: 'claude_cli', proof: 'config', email: 'cfg@example.invalid' },
  ] }, 'ROG Strix');

  const rows = db.prepare('SELECT * FROM usage_log ORDER BY t DESC').all();
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, {
    t: now, host: 'ROG Strix', email: 'borrow@example.invalid', org: ORG, code: 429,
    retry_after: 216, pause: 600, skipped: null, state: 'rate_limited',
    note: 'usage call refused with HTTP 429, pausing 600s', fh: null, sd: null, sf: null,
  });
  assert.deepEqual({ ...rows[1] }, {
    t: now - 1, host: 'ROG Strix', email: 'read@example.invalid', org: ORG, code: 200,
    retry_after: null, pause: null, skipped: null, state: 'ok', note: null,
    fh: 12, sd: 57, sf: 100,
  });
});

test('usage_log — retention keeps the newest 2000 lines', (t) => {
  const { usageLogPrune, db } = seams(t);
  const now = Math.floor(Date.now() / 1000);
  const ins = db.prepare('INSERT INTO usage_log (t, host, code, state) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < 2100; i++) ins.run(now - i, 'ROG Strix', 200, 'ok');
  db.exec('COMMIT');
  usageLogPrune.run();
  assert.equal(db.prepare('SELECT count(*) c FROM usage_log').get().c, 2000);
  const span = db.prepare('SELECT max(t) hi, min(t) lo FROM usage_log').get();
  assert.equal(span.hi, now, 'the newest line was pruned');
  assert.equal(span.lo, now - 1999, 'the oldest lines were kept');
});
