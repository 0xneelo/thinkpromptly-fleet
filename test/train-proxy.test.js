// The acceptance harness for the split: a real deck and a real broker, on their own ports,
// wired together the way the LaunchAgent wires them. Every URL a consumer knows is still the
// deck's, so these cases drive the deck and assert against the broker behind it.
//
// The two headline cases are 8 and 9. 8 kills the deck and starts a new one on the same port:
// the train survives, which is the whole reason the broker was split out. 9 kills the broker
// instead and asserts the deck says something different — "unreachable" is not "no train", and
// an operator who cannot tell them apart restarts the wrong process.
//
// The tests run in declaration order and share one broker: the sequence (open a train, use it,
// restart around it, close it) is the behaviour under test, not a set of independent cases.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('./helpers');
const { startServer, startBroker } = require('./http');
const { startFakeGitHub } = require('./fake-github');

const APP_ID = '123456';
const INSTALL_ID = '7654321';
const HOST = 'german-box';
const NO_TRAIN = 'no active GitHub train — ask the operator to start one on the keys page';

let gh, brk, deck, fx, deckPort, trainPort;
const running = []; // every deck ever started here, so `after` stops the ones a test replaced

function fixtures() {
  const dir = tmpdir('trainproxy');
  fs.mkdirSync(path.join(dir, 'vault'));
  const env = path.join(dir, 'github-app.env');
  fs.writeFileSync(
    env,
    'export GH_APP_ID=' + APP_ID + '\n' +
      'export GH_APP_INSTALLATION_ID=' + INSTALL_ID + '\n' +
      'export GH_APP_KEY_OP="op://Private/fleetdeck GitHub App key/private-key.pem"\n'
  );
  // /api/sessions reaches for ssh; a real one would hang on ConnectTimeout in every case here.
  const ssh = path.join(dir, 'ssh.json');
  fs.writeFileSync(ssh, JSON.stringify({ hosts: { [HOST]: { sessions: {} } }, calls: [] }));
  return { dir, env, ssh, key: path.join(dir, 'vault', 'app-key.pem') };
}

async function startBrokerOnPort() {
  brk = await startBroker({
    ...(trainPort ? { FLEET_TRAIN_PORT: String(trainPort) } : {}),
    FLEET_GH_ENV: fx.env,
    FLEET_OP_BIN: path.join(__dirname, 'fake-op.js'),
    FLEET_FAKE_OP_KEY: fx.key,
    FLEET_FAKE_OP_MODE: 'ok',
    FLEET_GH_API: gh.url,
  });
  trainPort = brk.port;
  return brk;
}

// A deck pointed at the broker's port. Called more than once on purpose: case 8 replaces the
// deck without touching the broker.
async function startDeck() {
  const d = await startServer(
    {
      ...(deckPort ? { PORT: String(deckPort) } : {}),
      FLEET_TRAIN_PORT: String(trainPort),
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: fx.ssh,
    },
    { dir: fx.dir, hosts: [HOST] }
  );
  deckPort = d.port;
  running.push(d);
  deck = d;
  return d;
}

const deckOrigin = () => ({ origin: 'http://localhost:' + deckPort });

before(async () => {
  fx = fixtures();
  gh = await startFakeGitHub();
  trainPort = null; // startBroker picks one from its own band on the first call
  await startBrokerOnPort();
  await startDeck();
});

after(async () => {
  for (const d of running) await d.stop();
  if (brk) await brk.stop();
  if (gh) await gh.close();
});

test('1 — with no train the deck relays the broker-s 503 verbatim', async () => {
  const r = await deck.get('/api/ghtoken');
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { ok: false, error: NO_TRAIN });
});

test('2 — a start POST with no Origin dies on the deck and never reaches the broker', async () => {
  const r = await deck.post('/api/ghtrain', { ttl: '1h' });
  assert.equal(r.status, 403);
  assert.equal(r.text, 'forbidden');
  assert.equal((await brk.get('/api/ghtrain')).body.active, false, 'the broker saw nothing');
});

test('3 — the keys page flow: a start POST from the deck-s own origin opens the train', async () => {
  const r = await deck.post('/api/ghtrain', { ttl: '1h' }, deckOrigin());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const b = await brk.get('/api/ghtrain');
  assert.equal(b.body.active, true);
  assert.equal(b.body.expiresAt, r.body.expiresAt);
});

test('4 — a loopback worker gets a token through the deck', async () => {
  const r = await deck.get('/api/ghtoken');
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^ghs_/);
});

test('5 — a box worker gets one over tailnet, with no bearer key: reads stay open', async () => {
  const r = await deck.tailGet('/api/ghtoken');
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^ghs_/);
});

test('6 — the tailnet listener reports the window', async () => {
  const r = await deck.tailGet('/api/ghtrain');
  assert.equal(r.status, 200);
  assert.equal(r.body.active, true);
});

test('7 — starting a train is still loopback-only: tailnet does not route the POST', async () => {
  const before = (await brk.get('/api/ghtrain')).body.expiresAt;
  const r = await deck.tailPost('/api/ghtrain', { ttl: '8h' }, deckOrigin());
  assert.notEqual(r.status, 200);
  assert.ok([401, 404].includes(r.status), 'expected the S3 gate or a 404, got ' + r.status);
  assert.equal((await brk.get('/api/ghtrain')).body.expiresAt, before, 'the window is untouched');
});

test('8 — the train survives a deck restart: same port, same broker, same window', async () => {
  const before = (await deck.get('/api/ghtoken')).body.train_expires_at;
  await deck.stop();
  await startDeck(); // same PORT, still pointed at the untouched broker
  const r = await deck.get('/api/ghtoken');
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^ghs_/);
  assert.equal(r.body.train_expires_at, before, 'the window did not restart with the deck');
});

test('9 — a broker that is down reads differently from a train that is not running', async () => {
  await brk.stop();
  const r = await deck.get('/api/ghtoken');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /train broker unreachable at 127\.0\.0\.1:/);
  assert.match(r.body.error, /com\.fleetdeck\.train launch agent/);
  assert.notEqual(r.body.error, NO_TRAIN, 'the two 503s must be tellable apart');

  // Documented cost of the split: the window lives in the broker-s memory, so its restart
  // loses it and the operator starts a new train from the keys page.
  await startBrokerOnPort();
  assert.deepEqual((await deck.get('/api/ghtrain')).body, { active: false, expiresAt: null });
});

test('10 — an end POST from the deck-s own origin closes the window on the broker', async () => {
  await deck.post('/api/ghtrain', { ttl: '1h' }, deckOrigin());
  assert.equal((await brk.get('/api/ghtrain')).body.active, true);
  const r = await deck.post('/api/ghtrain/end', {}, deckOrigin());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal((await brk.get('/api/ghtrain')).body.active, false);
});

test('11 — a broker that is down takes nothing else with it', async () => {
  await brk.stop();
  const r = await deck.get('/api/sessions');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.sessions));
});

// Finding from review: the deck buffered the broker's reply with no cap. The broker itself only
// ever sends a small JSON object, but the deck is the control plane for the whole fleet, and
// anything that reached 127.0.0.1:TRAIN_PORT before the real broker did — a crashed broker
// replaced by another process, a bug — could have grown the deck's memory without bound. The
// deck now stops reading and answers 502 instead. Proved against a deliberately hostile stand-in
// for the broker, which is the only way to exercise a path the real broker never takes.
test('12 — an oversized broker reply is cut off, not buffered without bound', async (t) => {
  const http = require('http');
  const rogue = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    // Well past the 64KB cap, written in chunks so the deck has to stop mid-stream. The
    // socket is torn down from the other end, so writing more than this only slows the suite.
    const chunk = 'x'.repeat(64 * 1024);
    for (let i = 0; i < 8; i++) res.write(chunk);
    res.end();
  });
  await new Promise((r) => rogue.listen(0, '127.0.0.1', r));
  const port = rogue.address().port;
  // The deck tears its end down mid-stream, so close() would otherwise sit waiting on a
  // half-open socket for the server's full idle timeout.
  t.after(() => new Promise((r) => { rogue.closeAllConnections(); rogue.close(r); }));

  const s = await startServer({ FLEET_TRAIN_PORT: String(port) });
  t.after(() => s.stop());

  const r = await s.get('/api/ghtoken');
  assert.equal(r.status, 502);
  assert.match(r.body.error, /oversized/);
  // 4MB was offered; nothing like it may come back out of the deck.
  assert.ok(r.text.length < 4096, 'the deck relayed the oversized body: ' + r.text.length + ' bytes');

  // And the deck is still healthy afterwards — a rogue broker must not wedge it. A static
  // file is the cheapest proof: /api/sessions would ssh out to the fleet and stall this
  // suite for the poll timeout, which has nothing to do with what is under test here.
  assert.equal((await s.get('/keys.html')).status, 200);
});

test('13 — a broker reply that is not JSON becomes an error, never a raw relay', async (t) => {
  const http = require('http');
  const rogue = http.createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'text/html' });
    res.end('<html>an upstream proxy error page</html>');
  });
  await new Promise((r) => rogue.listen(0, '127.0.0.1', r));
  // The deck tears its end down mid-stream, so close() would otherwise sit waiting on a
  // half-open socket for the server's full idle timeout.
  t.after(() => new Promise((r) => { rogue.closeAllConnections(); rogue.close(r); }));
  const s = await startServer({ FLEET_TRAIN_PORT: String(rogue.address().port) });
  t.after(() => s.stop());

  const r = await s.get('/api/ghtoken');
  assert.equal(r.status, 500);
  assert.equal(r.body.ok, false, 'a caller must always get the {ok,error} shape it expects');
  assert.ok(typeof r.body.error === 'string');
});
