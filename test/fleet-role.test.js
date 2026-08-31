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

test('XYZ-1890 M6 seam 3 — a home with no Name-close script says the pool will leak', async (t) => {
  // The pool is fleet state and only the home reaps, so this is the one deployment where
  // nameClose() can never release a Name. Unconfigured, it skips — correctly, since it would
  // rather leak a claim than close one it cannot see — and the leak's only trace is a
  // `name-skip` line that reads like routine housekeeping. The boot line is what names it.
  const forgotten = await deck(t, { FLEET_ROLE: 'home', FLEET_NAME_CLOSE_SCRIPT: '' });
  assert.match(forgotten.log(), /WARNING: FLEET_NAME_CLOSE_SCRIPT is unset on the fleet home/);
  assert.match(forgotten.log(), /leaks one claim per reap/);

  // Configured, there is nothing to warn about. Without this half the test would pass against
  // a deck that printed the line unconditionally.
  const armed = await deck(t, {
    FLEET_ROLE: 'home',
    FLEET_NAME_CLOSE_SCRIPT: path.join(__dirname, 'name.py'),
  });
  assert.doesNotMatch(armed.log(), /WARNING: FLEET_NAME_CLOSE_SCRIPT/);

  // A satellite never reaps, so it has no Name to close and nothing to say about one.
  const sat = await deck(t, { FLEET_ROLE: 'satellite', FLEET_NAME_CLOSE_SCRIPT: '' });
  assert.doesNotMatch(sat.log(), /WARNING: FLEET_NAME_CLOSE_SCRIPT/);
});

// XYZ-1890 M6. The tailnet bind is the one listener whose failure the deck survives, which is
// what makes it dangerous: the process stays up, loopback answers everything, and the fleet
// finds the deck's tailnet routes simply gone. startServer() cannot be used here — it waits for
// the `tailnet broker` line that this deck will never print — so the child is driven by hand.
function bindFail(t, bind) {
  const dir = tmpdir('tailnet-bind');
  return new Promise((resolve, reject) => {
    const probe = require('net').createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => {
        const child = require('child_process').spawn(
          process.execPath,
          [path.join(__dirname, '..', 'server.js')],
          {
            env: {
              ...process.env,
              PORT: String(port),
              FLEET_DB: path.join(dir, 'fleet.db'),
              FLEET_HOSTS_FILE: path.join(dir, 'hosts.json'),
              FLEET_TAILNET_BIND: bind,
              FLEET_NO_REAPER: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        fs.writeFileSync(path.join(dir, 'hosts.json'), JSON.stringify([HOST]));
        t.after(() => child.kill('SIGKILL'));
        let out = '';
        const done = setTimeout(() => reject(new Error('no verdict:\n' + out)), 15000);
        for (const s of [child.stdout, child.stderr])
          s.on('data', (c) => {
            out += c;
            // Both lines, so the test proves the deck kept serving loopback as well as warned.
            if (/tailnet listener unavailable/.test(out) && /fleetdeck http:\/\//.test(out)) {
              clearTimeout(done);
              resolve(out);
            }
          });
        child.on('exit', (code) => {
          clearTimeout(done);
          reject(new Error('the deck exited ' + code + ' — a failed tailnet bind must not be fatal:\n' + out));
        });
      });
    });
  });
}

test('XYZ-1890 M6 — a failed tailnet bind names its consequence, not just its errno', async (t) => {
  // 192.0.2.1 is TEST-NET-1: routable-looking, never assigned to this host. It stands in for the
  // real trap — a box deck inheriting TAILNET_IP's default, which is the Mac's address.
  const out = await bindFail(t, '192.0.2.1');

  // The errno alone was the old line, and it is what let this failure read as noise.
  assert.match(out, /WARNING: tailnet listener unavailable \(\w+\) binding 192\.0\.2\.1:\d+/);
  assert.match(out, /serving LOOPBACK ONLY/);
  assert.match(out, /registry, leases, bus, coordinator/);
  assert.match(out, /TAILNET_IP \(or FLEET_TAILNET_BIND\) names an address this host does not have/);

  // The half that makes the warning necessary: the deck is alive and loopback is fine, so
  // nothing else in the smoke would have caught it. bindFail() already required both lines.
  assert.match(out, /fleetdeck http:\/\/localhost:\d+/);
});
