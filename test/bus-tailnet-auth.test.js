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
// Deliberately a different length and value from TOKEN: the whole bug was two secrets
// arriving in one header, so no test here may pass by the two happening to match.
const KEY = 'test-tailnet-key-shhh';

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
  // The bridge is pinned to a path that cannot exist: this is a gate test, and a run in the
  // deck checkout (where the bridge is built) must never type its probe into a real chat.
  const s = await startServer({ FLEETDECK_BUS_TOKEN: TOKEN, CLAUDE_BRIDGE: '/nonexistent/fleetdeck-claude-bridge', ...env });
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


test('loopback needs no bus token at all — which is the whole shape of XYZ-1844', async (t) => {
  // The bus token gate lives ONLY on the tailnet listener (server.js: the loopback route at
  // /api/messages goes straight to messageRoute, which has its own Origin check and the
  // listener-wide Host allowlist in front of it). So the Mac's own Bus panel and any Mac
  // CLI post fine with no token, while a box worker over the tailnet does not — the exact
  // asymmetry reported: orchestrator->worker delivers, worker->orchestrator 401s.
  const s = await deck(t, { FLEET_TAILNET_KEY: KEY });
  const loopback = await s.post('/api/messages', MSG);
  assert.notEqual(loopback.status, 401, 'loopback must not be asked for the bus token');
  const tailnet = await s.tailPost('/api/messages', { ...MSG, id: 'zita-bus-probe-2' });
  assert.equal(tailnet.status, 401, 'the same post over the tailnet is refused');
  // Post-XYZ-1888 the refusal comes from the bus gate, not the S3 one: the tailnet key no
  // longer stands in front of this route, so a tokenless worker is turned away by the gate
  // that actually owns the bus.
  assert.equal(tailnet.body.error, 'invalid message bus token');
});

// --- XYZ-1888: the composition of the two gates ---------------------------------------
//
// XYZ-1854 armed each gate in isolation and both passed. Nothing armed BOTH at once, which
// is the only configuration the live deck actually runs — and in it the two gates read the
// same `authorization: Bearer ...` header. One header cannot hold two secrets, so the
// worker->deck half of the bus was structurally dead for as long as the key was armed. The
// fix exempts the bus routes from the S3 key; busAuthorized() still gates them alone.

const path = require('path');
const { execFile } = require('child_process');
const { TAILNET_BIND } = require('./http');

const both = (t) => deck(t, { FLEET_TAILNET_KEY: KEY });

test('XYZ-1888 — both keys armed: the stock bus header shape is 200, never 401', async (t) => {
  const s = await both(t);
  // Exactly what bin/fleet-message.js sends: content-type plus the bus token, and nothing
  // else. This assertion failing again means the double gate is back.
  const r = await s.tailPost('/api/messages', MSG, { authorization: 'Bearer ' + TOKEN });
  assert.notEqual(r.status, 401, 'the bus is gated shut again: ' + r.text);
  assert.equal(r.status, 200, r.text);
  // No Claude Desktop bridge in a test process, so the accepted message fails to deliver.
  // Acceptance is the gate's answer; delivery is the bus's.
  assert.equal(r.body.ok, false);
  assert.equal(r.body.id, MSG.id, 'the bus, not a gate, wrote this reply');
});

test('XYZ-1888 — both keys armed: a bad payload is 400, so the gate ran and the bus judged', async (t) => {
  const s = await both(t);
  const r = await s.tailPost('/api/messages', { source: 'FD-traudl' }, {
    authorization: 'Bearer ' + TOKEN,
  });
  assert.equal(r.status, 400, r.text);
  assert.notEqual(r.text.trim(), 'unauthorized');
});

test('XYZ-1888 — the exemption frees the header, not the authority', async (t) => {
  const s = await both(t);
  // The bus token is still mandatory and still the only key that works here. In particular
  // the tailnet key does NOT open the bus route: exempting it from gate 1 must not turn
  // gate 2 into a second door for the other secret.
  for (const [label, authorization] of [
    ['no header', undefined],
    ['the tailnet key', 'Bearer ' + KEY],
    ['a near-miss bus token', 'Bearer ' + TOKEN.slice(0, -1) + 'X'],
  ]) {
    const r = await s.tailPost('/api/messages', MSG, authorization ? { authorization } : {});
    assert.equal(r.status, 401, label + ' -> ' + r.text);
    assert.equal(r.body.error, 'invalid message bus token', label);
  }
});

test('XYZ-1888 — /api/messages/retry composes the same way', async (t) => {
  const s = await both(t);
  const keyOnly = await s.tailPost('/api/messages/retry', { id: MSG.id }, {
    authorization: 'Bearer ' + KEY,
  });
  assert.equal(keyOnly.status, 401);
  assert.equal(keyOnly.body.error, 'invalid message bus token');
  const withToken = await s.tailPost('/api/messages/retry', { id: 'no-such-message' }, {
    authorization: 'Bearer ' + TOKEN,
  });
  assert.notEqual(withToken.status, 401, withToken.text);
  assert.match(withToken.body.error, /message/, 'past the gate, into the bus: ' + withToken.text);
});

test('XYZ-1888 — the real bin/fleet-message.js gets through with both keys armed', async (t) => {
  // The header shape under test is the shipped client's, not this file's idea of it, so the
  // proof runs the actual binary against a deck with both keys armed. FLEETDECK_URL points
  // at the tailnet address, which is the path a box worker takes.
  const s = await both(t);
  const run = (env) =>
    new Promise((resolve) =>
      execFile(
        process.execPath,
        [path.join(__dirname, '..', 'bin', 'fleet-message.js'),
         '--to', 'claude-desktop:current', '--from', 'FD-traudl', '--id', 'traudl-compose-1',
         'box to deck, both gates armed'],
        {
          env: {
            ...process.env,
            FLEETDECK_URL: 'http://' + TAILNET_BIND + ':' + s.port,
            ...env,
          },
        },
        (error, stdout, stderr) => resolve({ code: error ? error.code || 1 : 0, stdout, stderr })
      )
    );

  const sent = await run({ FLEETDECK_BUS_TOKEN: TOKEN });
  assert.doesNotMatch(sent.stdout, /HTTP 401|invalid message bus token|unauthorized/,
    'the stock client is still locked out: ' + sent.stdout + sent.stderr);
  const reply = JSON.parse(sent.stdout);
  assert.equal(reply.id, 'traudl-compose-1', 'the bus answered: ' + sent.stdout);

  // And the client without the token is refused, so the test above is not passing on an
  // open door.
  const bare = await run({ FLEETDECK_BUS_TOKEN: '' });
  assert.match(bare.stdout, /invalid message bus token/, bare.stdout + bare.stderr);
});

test('XYZ-1888 — no other tailnet POST changed: the S3 key still gates them, the bus token does not', async (t) => {
  // The exemption is a list of two paths. This is the other half of that claim: everything
  // else on the tailnet listener still answers the plain-text S3 refusal without the key,
  // and holding the bus token buys nothing outside the bus.
  const { tmpdir } = require('./helpers');
  const s = await deck(t, { FLEET_TAILNET_KEY: KEY, FLEET_COORDINATOR_DIR: tmpdir('coord') });
  // Every POST route the tailnet listener answers, so the exemption is pinned as a list of
  // exactly two and a later edit cannot quietly widen it.
  const others = [
    ['/api/registry', { host: 'german-box', name: 'FD-traudl', status: 'done' }],
    ['/api/registry/delete', { host: 'german-box', name: 'FD-traudl' }],
    ['/api/coordinator/sitrep', { seat: 'FD-traudl' }],
    ['/api/lease/claim', { host: 'german-box', name: 'FD-traudl' }],
    ['/api/heartbeat', { host: 'german-box', name: 'FD-traudl' }],
    ['/api/credits', {}],
  ];
  for (const [p, b] of others) {
    for (const [label, headers] of [
      ['no header', {}],
      ['the bus token', { authorization: 'Bearer ' + TOKEN }],
    ]) {
      const r = await s.tailPost(p, b, headers);
      assert.equal(r.status, 401, p + ' / ' + label + ' -> ' + r.text);
      assert.equal(r.text.trim(), 'unauthorized', p + ' / ' + label + ' answered the wrong gate');
    }
    // And the key still opens them, so the 401s above are the gate and not a broken route.
    const ok = await s.tailPost(p, b, { authorization: 'Bearer ' + KEY });
    assert.notEqual(ok.status, 401, p + ' rejects its own key: ' + ok.text);
  }
});
