// XYZ-1890 M1 — one codebase, two decks. A route exists only where the host can honor it,
// and that is two independent facts: the ROLE grants the fleet.db routes (home is the sole
// writer), the PLATFORM grants the Mac key routes (they need this Mac's 1Password agent).
// Neither implies the other, which is why both are tested separately here.
//
// The property that matters most is the first test: with no FLEET_ROLE set, the deck answers
// exactly as it did before the split. Everything else is opt-in.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startServer } = require('./http');
const { tmpdir } = require('./helpers');

const HOST = 'german-box';
const DARWIN = process.platform === 'darwin';
// A deck child that believes it is a Mac, so the platform half of the gate is testable from
// either side on any CI box. It changes nothing in server.js — the fake is a --require preload.
const AS_MAC = { NODE_OPTIONS: '--require ' + path.join(__dirname, 'fake-darwin.js') };

// A raw upgrade handshake — enough to see whether the deck accepts or rejects /term, with no
// WebSocket client. 'upgraded' means the deck took the socket (the 101 came back); 'rejected'
// means it destroyed it without answering. An unknown host keeps this well clear of pty.spawn:
// the deck answers 101 first and only then closes the ws, so nothing here spawns an ssh.
function termUpgrade(s) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: s.port,
      path: '/term?host=not-a-fleet-host&session=EDITH-T-1',
      headers: {
        host: '127.0.0.1:' + s.port,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': Buffer.from('fleetdeck-role-t').toString('base64'),
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve('upgraded');
    });
    req.on('response', (res) => resolve('http ' + res.statusCode));
    req.on('error', () => resolve('rejected'));
    req.on('close', () => resolve('rejected'));
    req.end();
  });
}

// /api/health reaches for ssh, and a real one would hang on ConnectTimeout for every host in
// the fixture, so each deck gets the fake poller the other suites use.
async function deck(t, env = {}) {
  const dir = tmpdir('role');
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: { [HOST]: { sessions: {} } }, calls: [] }));
  const s = await startServer(
    { FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'), FLEET_FAKE_SSH_STATE: state, ...env },
    { dir }
  );
  t.after(() => s.stop());
  return s;
}

test('no FLEET_ROLE: the fleet routes answer exactly as they do today', async (t) => {
  const s = await deck(t);

  const claim = await s.post('/api/lease/claim', { host: HOST, name: 'EDITH-T-ROLE' });
  assert.equal(claim.status, 200, s.log());
  assert.equal(claim.body.epoch, 1);

  const beat = await s.post('/api/heartbeat', { host: HOST, name: 'EDITH-T-ROLE', epoch: 1 });
  assert.equal(beat.status, 200, beat.text);

  const seats = await s.get('/api/seats');
  assert.equal(seats.status, 200, seats.text);
  assert.equal(seats.body.ok, true);

  assert.equal((await s.get('/api/health')).status, 200);
  assert.equal((await s.get('/')).status, 200, 'the UI is still served');

  // The one line an operator reads to know what a deck is.
  assert.match(s.log(), /role: home platform=\w+ serves=/);
});

test('the default role is home, so a fleet route is unaffected by the platform', async (t) => {
  const s = await deck(t);
  // Whatever this box is, the fleet routes are the role's, not the hardware's.
  assert.notEqual((await s.get('/api/seats')).status, 404);
});

test(
  'a Mac-only route is absent on a non-Mac even in role home — capability, not role',
  { skip: DARWIN && 'this test asserts the behaviour of a host that cannot mint certs' },
  async (t) => {
    const s = await deck(t); // no FLEET_ROLE: this deck IS the home
    const r = await s.get('/api/sshkeys');
    assert.equal(r.status, 404, r.text);
    assert.match(r.text, /not served on platform '\w+'/);
    // The mint POST is gone with it: a 403 here would mean the route still exists.
    const mint = await s.post('/api/sshkeys/mint', { ttl: '1h', principals: 'root' });
    assert.equal(mint.status, 404, mint.text);
  }
);

test('on a Mac the same routes are served — the other side of the platform gate', async (t) => {
  const s = await deck(t, AS_MAC);
  assert.match(s.log(), /role: home platform=darwin serves=fleet\+mac\+common/);

  // The gate letting the route through is the whole property: the handler behind it may still
  // fail on a box with no 1Password agent, and that is not what this test is about. Only the
  // platform-404 is disqualifying.
  const r = await s.get('/api/sshkeys');
  assert.doesNotMatch(r.text, /not served on platform/, 'the gate passed it to the handler');
  const mint = await s.post('/api/sshkeys/mint', { ttl: '1h', principals: 'root' });
  assert.doesNotMatch(mint.text, /not served on platform/);
  // The role half is untouched by the fake: a Mac deck defaulting to home still has its fleet.
  assert.notEqual((await s.get('/api/seats')).status, 404);
});

test('/term is upgraded on a home deck and refused on a satellite', async (t) => {
  const home = await deck(t);
  assert.equal(await termUpgrade(home), 'upgraded', 'home still brokers tiles: ' + home.log());

  const sat = await deck(t, { FLEET_ROLE: 'satellite' });
  assert.equal(await termUpgrade(sat), 'rejected', 'a satellite brokers no tmux: ' + sat.log());
});

test('FLEET_ROLE=satellite: the fleet routes are gone, the common ones stay', async (t) => {
  const s = await deck(t, { FLEET_ROLE: 'satellite' });

  for (const [method, p] of [
    ['GET', '/api/seats'],
    ['POST', '/api/lease/claim'],
    ['POST', '/api/heartbeat'],
    ['GET', '/api/registry'],
    ['POST', '/api/kill'],
    ['GET', '/api/messages'],
    ['GET', '/api/coordinator/board'],
  ]) {
    const r = method === 'GET' ? await s.get(p) : await s.post(p, { host: HOST, name: 'X' });
    assert.equal(r.status, 404, method + ' ' + p + ': ' + r.text);
    assert.equal(r.text, "not served in role 'satellite'", p);
  }

  // Ungated on every role: health is how a satellite is monitored at all, and the UI is
  // static files no role can fail to serve.
  assert.equal((await s.get('/api/health')).status, 200);
  assert.equal((await s.get('/')).status, 200);
  assert.match(s.log(), /role: satellite platform=/);
});

test('the lease and bus groups are gated by derivation, not by a second copy', async (t) => {
  // The dispatch chain defines those two groups once, in LEASE_ROUTES and BUS_ROUTES, and the
  // gate reads them. This test is the proof that a route added to either is gated for free —
  // it walks the sets themselves, so a new member cannot be gated by one list and dispatched
  // by the other.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const members = (name) =>
    JSON.parse('[' + src.match(new RegExp(name + " = new Set\\(\\[([^\\]]*)\\]"))[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  const routes = [...members('LEASE_ROUTES'), ...members('BUS_ROUTES')];
  assert.ok(routes.length >= 4, 'the sets were found and parsed: ' + routes);

  const s = await deck(t, { FLEET_ROLE: 'satellite' });
  for (const p of routes) {
    const r = await s.post(p, { host: HOST, name: 'X' });
    assert.equal(r.status, 404, p + ' is gated without being named twice: ' + r.text);
  }
});

test('a satellite runs no reaper, whatever FLEET_NO_REAPER says', async (t) => {
  const s = await deck(t, { FLEET_ROLE: 'satellite', FLEET_NO_REAPER: '0' });
  assert.doesNotMatch(s.log(), /^reaper: /m, 'the sole fleet.db sweeper is the home deck');

  // The same env on the home role does start it — otherwise this proves nothing.
  const home = await deck(t, { FLEET_NO_REAPER: '0' });
  assert.match(home.log(), /^reaper: /m);
});

test('the gate applies on the tailnet listener too, not just loopback', async (t) => {
  const key = 'test-tailnet-key-shhh';
  const s = await deck(t, { FLEET_ROLE: 'satellite', FLEET_TAILNET_KEY: key });

  // 404, not the S3 401: the route does not exist here, so it is never even asked for the key.
  const claim = await s.tailPost('/api/lease/claim', { host: HOST, name: 'EDITH-T-TAIL' });
  assert.equal(claim.status, 404, claim.text);
  // This gate runs pre-auth, so the body says nothing an unauthenticated caller could not
  // already guess: no role, no platform, the same 'not found' any unknown path gets here.
  assert.equal(claim.text, 'not found');
  assert.doesNotMatch(claim.text, /satellite|linux|darwin/);

  const coord = await s.tailGet('/api/coordinator/board');
  assert.equal(coord.status, 404, coord.text);
  assert.equal(coord.text, 'not found');

  // Contrast: the same tailnet call on a default deck reaches the real handler.
  const home = await deck(t);
  const ok = await home.tailPost('/api/lease/claim', { host: HOST, name: 'EDITH-T-TAIL' });
  assert.equal(ok.status, 200, ok.text);
});

test('an unrecognised FLEET_ROLE refuses to boot and names the bad value', async () => {
  // Same spirit as the M9 pragma gate: a typo must not silently degrade into a deck that
  // serves half its routes, because the missing half looks like a caller bug for weeks.
  await assert.rejects(
    () => startServer({ FLEET_ROLE: 'hom' }),
    (e) => /FLEET_ROLE is 'hom', expected one of: home, satellite/.test(e.message),
    'the boot error names the bad value and both valid ones'
  );
  // Whitespace is trimmed, not treated as a third role.
  const s = await startServer({ FLEET_ROLE: ' satellite ' });
  assert.equal((await s.get('/api/seats')).status, 404);
  await s.stop();
});
