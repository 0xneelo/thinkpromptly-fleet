// fleetdeck-train.js on its own: the train window, the four routes and the gates around them.
// Every case runs a throwaway broker on its own port against a fake `op` and a fake GitHub, so
// no test unlocks the operator's 1Password, reaches api.github.com or touches the live broker.
//
// The load-bearing case is the JWT one. The point of the whole design is that the App PEM lives
// in the broker's memory and nowhere else, so it is not enough to assert a token came back: the
// test verifies the RS256 signature the fake GitHub received against the fake vault's public
// key, which can only be true if the broker signed in-process with the PEM `op` printed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tmpdir } = require('./helpers');
const { startBroker } = require('./http');
const { startFakeGitHub } = require('./fake-github');

const APP_ID = '123456';
const INSTALL_ID = '7654321';
const KEY_REF = 'op://Private/fleetdeck GitHub App key/private-key.pem';
const NO_TRAIN = 'no active GitHub train — ask the operator to start one on the keys page';

// Three directories, kept apart on purpose: the broker is only ever pointed at `fixture`, so
// the "nothing is written to disk" case can snapshot it, and the fake vault's key cache in
// `vault` cannot be mistaken for something the broker wrote.
function fixtures() {
  const dir = tmpdir('train');
  for (const sub of ['fixture', 'vault', 'cwd']) fs.mkdirSync(path.join(dir, sub));
  const env = path.join(dir, 'fixture', 'github-app.env');
  fs.writeFileSync(
    env,
    'export GH_APP_ID=' + APP_ID + '\n' +
      'export GH_APP_INSTALLATION_ID=' + INSTALL_ID + '\n' +
      'export GH_APP_KEY_OP="' + KEY_REF + '"\n'
  );
  return { dir, env, key: path.join(dir, 'vault', 'app-key.pem'), cwd: path.join(dir, 'cwd') };
}

async function broker(t, extra = {}) {
  const f = fixtures();
  const gh = await startFakeGitHub();
  t.after(() => gh.close());
  const b = await startBroker(
    {
      FLEET_GH_ENV: f.env,
      FLEET_OP_BIN: path.join(__dirname, 'fake-op.js'),
      FLEET_FAKE_OP_KEY: f.key,
      FLEET_FAKE_OP_MODE: 'ok',
      FLEET_GH_API: gh.url,
      ...extra,
    },
    { cwd: f.cwd }
  );
  t.after(() => b.stop());
  b.gh = gh;
  b.fx = f;
  return b;
}

test('with no train, GET /api/ghtoken is the 503 that names the keys page', async (t) => {
  const b = await broker(t);
  const r = await b.get('/api/ghtoken');
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { ok: false, error: NO_TRAIN });
});

test('GET /api/ghtrain reports no window', async (t) => {
  const b = await broker(t);
  const r = await b.get('/api/ghtrain');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { active: false, expiresAt: null });
});

test('POST /api/ghtrain opens a window of the ttl asked for', async (t) => {
  const b = await broker(t);
  const before = Date.now();
  const r = await b.post('/api/ghtrain', { ttl: '1h' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.expiresAt >= before + 3600e3, 'window must run a full hour');
  assert.ok(r.body.expiresAt <= Date.now() + 3600e3, 'and no longer than one');
  const g = await b.get('/api/ghtrain');
  assert.equal(g.body.active, true);
  assert.equal(g.body.expiresAt, r.body.expiresAt);
});

test('a token is minted with a real RS256 JWT signed by the PEM op printed', async (t) => {
  const b = await broker(t);
  const started = await b.post('/api/ghtrain', { ttl: '1h' });
  const r = await b.get('/api/ghtoken');
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^ghs_/);
  assert.ok(r.body.expires_at, 'GitHub-s own expiry is passed through');
  assert.equal(r.body.train_expires_at, started.body.expiresAt);

  assert.equal(b.gh.calls.length, 1);
  const call = b.gh.calls[0];
  assert.equal(call.installation, INSTALL_ID);
  const m = call.authorization.match(/^Bearer (\S+\.\S+\.\S+)$/);
  assert.ok(m, 'the Authorization header must carry a three-part JWT: ' + call.authorization);
  const [h64, p64, sig] = m[1].split('.');
  assert.equal(JSON.parse(Buffer.from(h64, 'base64url')).alg, 'RS256');
  const claims = JSON.parse(Buffer.from(p64, 'base64url'));
  assert.equal(claims.iss, APP_ID);

  // The proof: only a holder of the vault's private key could have produced this signature.
  const pub = crypto.createPublicKey(fs.readFileSync(b.fx.key, 'utf8'));
  const v = crypto.createVerify('RSA-SHA256');
  v.update(h64 + '.' + p64);
  assert.ok(v.verify(pub, sig, 'base64url'), 'the JWT must verify against the App key');
});

test('every GET /api/ghtoken mints a new token — nothing is cached', async (t) => {
  const b = await broker(t);
  await b.post('/api/ghtrain', { ttl: '1h' });
  const one = await b.get('/api/ghtoken');
  const two = await b.get('/api/ghtoken');
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.notEqual(one.body.token, two.body.token);
  assert.equal(b.gh.calls.length, 2);
});

test('POST /api/ghtrain/end closes the window and the token route locks again', async (t) => {
  const b = await broker(t);
  await b.post('/api/ghtrain', { ttl: '1h' });
  const e = await b.post('/api/ghtrain/end', {});
  assert.equal(e.status, 200);
  assert.deepEqual(e.body, { ok: true });
  const tok = await b.get('/api/ghtoken');
  assert.equal(tok.status, 503);
  assert.equal(tok.body.error, NO_TRAIN);
  assert.deepEqual((await b.get('/api/ghtrain')).body, { active: false, expiresAt: null });
});

test('an unlisted ttl is refused before op is ever asked', async (t) => {
  const b = await broker(t);
  const r = await b.post('/api/ghtrain', { ttl: '2h' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { ok: false, error: 'ttl must be 1h, 4h or 8h' });
  assert.equal((await b.get('/api/ghtrain')).body.active, false);
});

test('a foreign Host authority is refused — the DNS-rebinding guard', async (t) => {
  const b = await broker(t);
  const r = await b.get('/api/ghtrain', { host: 'train.evil.example:' + b.port });
  assert.equal(r.status, 403);
  assert.equal(r.text, 'forbidden');
});

test('unknown paths are 404 and a wrong method is 405', async (t) => {
  const b = await broker(t);
  const nf = await b.get('/api/nothing');
  assert.equal(nf.status, 404);
  assert.equal(nf.text, 'not found');
  const bad = await b.post('/api/ghtoken', {});
  assert.equal(bad.status, 405);
  assert.equal(bad.text, 'method not allowed');
});

test('a locked vault answers with 1Password-s own text, not ours', async (t) => {
  const b = await broker(t, { FLEET_FAKE_OP_MODE: 'locked' });
  const r = await b.post('/api/ghtrain', { ttl: '1h' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /could not connect to 1Password/);
  assert.equal((await b.get('/api/ghtrain')).body.active, false);
});

test('a document that is not a key never becomes a train', async (t) => {
  const b = await broker(t, { FLEET_FAKE_OP_MODE: 'notpem' });
  const r = await b.post('/api/ghtrain', { ttl: '1h' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /is not a PEM private key/);
  assert.equal((await b.get('/api/ghtrain')).body.active, false);
});

test('a missing github-app.env is a JSON 500, and the broker keeps serving', async (t) => {
  const f = fixtures();
  const b = await broker(t, { FLEET_GH_ENV: path.join(f.dir, 'fixture', 'gone.env') });
  const r = await b.post('/api/ghtrain', { ttl: '1h' });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, {
    ok: false,
    error: 'deploy-keys/github-app.env unreadable — the GitHub App config is missing',
  });
  // Alive afterwards: an unreadable config must not take the broker down with it.
  assert.deepEqual((await b.get('/api/ghtrain')).body, { active: false, expiresAt: null });
});

// Snapshot of every file under a dir, by relative path and content hash.
function snapshot(dir) {
  const seen = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else seen[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return seen;
}

test('an open train writes nothing to disk — the PEM lives in memory only', async (t) => {
  const b = await broker(t);
  const before = snapshot(b.fx.dir + '/fixture');
  await b.post('/api/ghtrain', { ttl: '1h' });
  await b.get('/api/ghtoken');
  assert.deepEqual(snapshot(b.fx.dir + '/fixture'), before, 'the broker must write no state file');
  assert.deepEqual(snapshot(b.fx.cwd), {}, 'and nothing in its working directory');
  for (const [rel] of Object.entries(before)) {
    const body = fs.readFileSync(path.join(b.fx.dir, 'fixture', rel), 'utf8');
    assert.ok(!body.includes('PRIVATE KEY'), rel + ' must not hold a key');
  }
});

test('SIGTERM ends the broker cleanly, so launchd stop wipes the window', async (t) => {
  const b = await broker(t);
  await b.post('/api/ghtrain', { ttl: '1h' });
  assert.equal(await b.signal('SIGTERM'), 0);
});

// FLEET_TRAIN_BIND exists so a test can pick a second loopback address, not so the broker can
// be moved onto a real interface. The Host allowlist is derived from BIND, so a routable BIND
// would put the PEM-holding process on the network while the rebinding guard agreed with it —
// the guard would still "pass" and the invariant would be silently gone. It refuses instead.
test('a bind that is not loopback is refused at startup, not served', async () => {
  const { spawn } = require('child_process');
  for (const bind of ['0.0.0.0', '10.0.0.5', '100.125.231.25', '::']) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'fleetdeck-train.js')], {
      env: { ...process.env, FLEET_TRAIN_BIND: bind, FLEET_TRAIN_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (c) => (err += c));
    const code = await new Promise((r) => child.on('exit', r));
    assert.equal(code, 2, bind + ' should be refused');
    assert.match(err, /is not a loopback address/, bind);
    assert.match(err, /must never listen on a routable interface/, bind);
  }
});

test('the loopback addresses a test legitimately needs are still accepted', async () => {
  // 127.0.0.2 is the second loopback address test/http.js gives the tailnet listener; the
  // guard must not be so tight that the harness cannot bind one. Spawned directly rather
  // than through startBroker, whose client always connects to 127.0.0.1. The port is fixed
  // and deliberately BELOW test/http.js's 20000-40000 random band: 127.0.0.2 is also the
  // tailnet bind every deck in the suite uses, so a port inside that band would sometimes
  // collide with a sibling test's listener and fail a lifecycle test far from here.
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'fleetdeck-train.js')], {
    env: { ...process.env, FLEET_TRAIN_BIND: '127.0.0.2', FLEET_TRAIN_PORT: '18311' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  const started = await Promise.race([
    new Promise((r) => child.on('exit', (code) => r('exited ' + code))),
    new Promise((r) => setTimeout(() => r('running'), 1500)),
  ]);
  child.kill('SIGKILL');
  assert.equal(started, 'running', 'the broker refused a legitimate loopback bind: ' + out);
  assert.match(out, /fleetdeck-train http:\/\/127\.0\.0\.2:18311/);
});
