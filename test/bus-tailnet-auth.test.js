// The box->deck half of the message bus (XYZ-1844). Delivery in the other direction has
// always worked, so the asymmetry is easy to miss: a worker POSTing a reply over the
// tailnet is rejected unless it carries the deck's own bus token. test/message-bus.test.js
// covers the MessageBus class; nothing covered the HTTP gate in front of it until now.
//
// This proves the mechanism without the operator's deck: its own port, its own db, its own
// token. What it cannot prove is that the box actually HOLDS that token — that is the
// provisioning step (mac/provision-fleet-secrets.sh) and it needs the Mac.
const assert = require('node:assert/strict');
const test = require('node:test');
const { startServer } = require('./http');

const TOKEN = 'test-bus-token-not-a-real-secret';

// A target the bus validator accepts structurally. Delivery itself is expected to fail in a
// test process with no Claude Desktop bridge — the gate under test runs strictly before
// that, so an auth pass shows up as "anything but 401".
const MSG = {
  id: 'zita-bus-probe-1',
  source: 'FD-zita',
  target: { type: 'claude-desktop', session: 'current' },
  text: 'box to deck round trip',
};

async function deck(t, env = {}) {
  const s = await startServer({ FLEETDECK_BUS_TOKEN: TOKEN, ...env });
  t.after(() => s.stop());
  return s;
}

test('a tailnet bus POST with no token is 401 — this is the XYZ-1844 failure', async (t) => {
  const s = await deck(t);
  const r = await s.tailPost('/api/messages', MSG);
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'invalid message bus token');
});

test('a tailnet bus POST with the wrong token is 401 and reads the same', async (t) => {
  const s = await deck(t);
  const r = await s.tailPost('/api/messages', MSG, { authorization: 'Bearer wrong-' + TOKEN });
  assert.equal(r.status, 401);
  // Same length as a near-miss would be, so the comparison is the timing-safe one in
  // busAuthorized() rather than a short-circuiting string compare.
  const near = await s.tailPost('/api/messages', MSG, {
    authorization: 'Bearer ' + TOKEN.slice(0, -1) + 'X',
  });
  assert.equal(near.status, 401);
});

test('a malformed authorization header is 401, not a crash', async (t) => {
  const s = await deck(t);
  for (const authorization of ['', 'Bearer', 'Basic ' + TOKEN, TOKEN, 'bearer ' + TOKEN])
    assert.equal((await s.tailPost('/api/messages', MSG, { authorization })).status, 401, authorization);
});

test('the same POST with the deck token passes the gate — the round trip is unblocked', async (t) => {
  const s = await deck(t);
  const r = await s.tailPost('/api/messages', MSG, { authorization: 'Bearer ' + TOKEN });
  // Past the gate the bus takes over; a headless test box has no Claude Desktop bridge, so
  // the message is accepted and its delivery fails. Either outcome proves the gate opened.
  assert.notEqual(r.status, 401, 'the token was rejected: ' + r.text);
  assert.ok(r.status < 500 || r.body, 'expected a bus answer, got: ' + r.text);
});

test('the tailnet S3 key and the bus token are separate gates, in that order', async (t) => {
  // With FLEET_TAILNET_KEY armed, the shared key is asked for FIRST, before the bus token —
  // so a box that has the bus token but not the tailnet key still gets 401, and the fix is
  // both values, not either. mac/provision-fleet-secrets.sh therefore ships both.
  const s = await deck(t, { FLEET_TAILNET_KEY: 'shhh' });
  const busOnly = await s.tailPost('/api/messages', MSG, { authorization: 'Bearer ' + TOKEN });
  assert.equal(busOnly.status, 401);
  assert.equal(busOnly.text.trim(), 'unauthorized', 'the S3 gate answers in text, the bus gate in JSON');
});

test('loopback needs no bus token at all — which is the whole shape of XYZ-1844', async (t) => {
  // The bus token gate lives ONLY on the tailnet listener (server.js: the loopback route at
  // /api/messages goes straight to messageRoute, which has its own Origin check and the
  // listener-wide Host allowlist in front of it). So the Mac's own Bus panel and any Mac
  // CLI post fine with no token, while a box worker over the tailnet does not — the exact
  // asymmetry reported: orchestrator->worker delivers, worker->orchestrator 401s.
  const s = await deck(t, { FLEET_TAILNET_KEY: 'shhh' });
  const loopback = await s.post('/api/messages', MSG);
  assert.notEqual(loopback.status, 401, 'loopback must not be asked for the bus token');
  const tailnet = await s.tailPost('/api/messages', { ...MSG, id: 'zita-bus-probe-2' });
  assert.equal(tailnet.status, 401, 'the same post over the tailnet is refused');
});
