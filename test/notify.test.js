// The notify layer: alias -> target resolution, the ACK the sender blocks on, and the
// loopback/tailnet auth split in front of both. Delivery itself is deliberately out of scope —
// a test process has no Claude Desktop bridge and no fleet host — so every assertion here is
// about resolution, storage and gating, never about `status: 'delivered'`.
//
// The load-bearing case is "exact beats label": a session whose label reads "waiting on Ivy"
// must never stand in for, or ambiguate with, the worker actually named Ivy. Before the
// resolver split that label was ORed into the same lookup and a notify to Ivy 409'd.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { tmpdir, legacyDb } = require('./helpers');
const { startServer } = require('./http');

const TOKEN = 'test-notify-token-not-a-real-secret';
// Pinned at a path that cannot exist: a run on the operator's own Mac must never paste a
// fixture notify into a real Claude Desktop chat. Delivery fails at the bridge check instead.
const NO_BRIDGE = '/nonexistent/fleetdeck-claude-bridge';

// Sessions are seeded straight into the db this instance opens: the registry route would work
// too, but the fixture is the fleet shape under test, not a sequence of writes to it.
async function deck(t, rows = []) {
  const dir = tmpdir('notify');
  legacyDb(dir, rows.map((r) => ({ status: 'active', ...r })));
  // An empty host map makes every ssh answer "could not resolve hostname" at once, so a tmux
  // notify fails its delivery in milliseconds rather than against a 15s real ssh timeout.
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: {} }));
  const s = await startServer(
    {
      FLEETDECK_BUS_TOKEN: TOKEN,
      CLAUDE_BRIDGE: NO_BRIDGE,
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: state,
    },
    { dir }
  );
  t.after(() => s.stop());
  return s;
}

const send = (s, to, extra) =>
  s.post('/api/notify', { to, from: 'FD-test', text: 'ping', ...extra });

const IVY = { host: 'german-box', name: 'agent-ivy', worker: 'Ivy' };
const RUNE = { host: 'german-box', name: 'agent-rune', worker: 'Rune' };

// The harness only sends JSON.stringify-able bodies, so the malformed-body branch needs raw bytes.
function raw(s, p, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: s.port,
        path: p,
        method: 'POST',
        headers: {
          host: '127.0.0.1:' + s.port,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, text: d }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

test('a seat alias resolves to the desktop, and the seat name is what the receiver reads', async (t) => {
  const s = await deck(t);
  // Claude Desktop has no registry row — delivery always lands in whichever chat is open — so
  // all four seats collapse to the same target and only resolvedVia says how they got there.
  for (const to of ['orchestrator lowcapconnector', 'global', 'researcher 3', 'design 2']) {
    const r = await send(s, to);
    assert.equal(r.status, 200, to + ' -> ' + r.text);
    assert.equal(r.body.resolvedTarget, 'claude-desktop:current', to);
    assert.equal(r.body.resolvedVia, 'seat', to);
  }
});

test('an explicit host:session is passed through untouched', async (t) => {
  const s = await deck(t);
  const r = await send(s, 'german-box:agent-zed');
  // No registry row for agent-zed on purpose: an address is an address, not a lookup.
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resolvedTarget, 'german-box:agent-zed');
  assert.equal(r.body.resolvedVia, 'address');
});

test('a worker is addressed by the name the operator knows it by, in any casing', async (t) => {
  const s = await deck(t, [IVY]);
  // worker=Ivy, name=agent-ivy and the `worker <name>` prefix are three spellings of one row.
  for (const to of ['Ivy', 'ivy', 'worker Ivy']) {
    const r = await send(s, to);
    assert.equal(r.status, 200, to + ' -> ' + r.text);
    assert.equal(r.body.resolvedTarget, 'german-box:agent-ivy', to);
    assert.equal(r.body.resolvedVia, 'name', to);
  }
});

test('a worker named Ivy beats a session merely talking about Ivy', async (t) => {
  // The regression: with the label ORed into one lookup this pair returned two rows and a 409,
  // so the one worker actually called Ivy became unreachable the moment a peer mentioned her.
  const s = await deck(t, [IVY, { ...RUNE, label: 'waiting on Ivy for the migration' }]);
  const r = await send(s, 'Ivy');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resolvedTarget, 'german-box:agent-ivy');
  assert.equal(r.body.resolvedVia, 'name');
});

test('with no worker of that name, a label mention is the fallback — as a whole word', async (t) => {
  const s = await deck(t, [{ ...RUNE, label: 'waiting on Ivy' }]);
  const r = await send(s, 'Ivy');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resolvedTarget, 'german-box:agent-rune');
  assert.equal(r.body.resolvedVia, 'label');
});

test('a label that merely contains the letters is not a match', async (t) => {
  // "ivyleague" is a substring, not a mention. LIKE alone would deliver a notify for Ivy into
  // an unrelated dashboard session, so the word-boundary filter has to reject it.
  const s = await deck(t, [{ ...RUNE, label: 'ivyleague dashboard' }]);
  const r = await send(s, 'Ivy');
  assert.equal(r.status, 404, r.text);
  assert.ok(Array.isArray(r.body.candidates), r.text);
  assert.equal(r.body.candidates.length, 1);
  assert.equal(r.body.candidates[0].name, 'agent-rune');
});

test('two workers of the same name are a 409 naming both, never a coin flip', async (t) => {
  const s = await deck(t, [IVY, { host: 'german-box', name: 'agent-ivy-2', worker: 'Ivy' }]);
  const r = await send(s, 'Ivy');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'ambiguous');
  assert.deepEqual(r.body.candidates.map((c) => c.name).sort(), ['agent-ivy', 'agent-ivy-2']);
});

test('an unknown alias is a 404 that lists who is actually live', async (t) => {
  const s = await deck(t, [IVY, RUNE]);
  const r = await send(s, 'Nobody');
  assert.equal(r.status, 404, r.text);
  assert.equal(r.body.error, 'unknown target');
  // The list is capped server-side so a typo cannot dump the whole fleet into one reply.
  assert.ok(Array.isArray(r.body.candidates), r.text);
  assert.deepEqual(r.body.candidates.map((c) => c.worker).sort(), ['Ivy', 'Rune']);
});

test('% and _ in an alias are letters, not LIKE wildcards', async (t) => {
  const s = await deck(t, [{ ...RUNE, label: 'a_b' }]);
  const literal = await send(s, 'a_b');
  assert.equal(literal.status, 200, literal.text);
  assert.equal(literal.body.resolvedTarget, 'german-box:agent-rune');
  // Unescaped, `a%b` would match the label a_b through LIKE and deliver to the wrong session.
  const wildcard = await send(s, 'a%b');
  assert.equal(wildcard.status, 404, wildcard.text);
});

test('the first ACK wins and is what the blocked sender reads back', async (t) => {
  const s = await deck(t);
  const sent = await send(s, 'global');
  const id = sent.body.id;
  assert.equal((await s.post('/api/notify/' + id + '/ack', { from: 'Ivy', response: 'handled' })).body.ok, true);
  const view = await s.get('/api/notify/' + id);
  assert.equal(view.body.ack_from, 'Ivy');
  assert.equal(view.body.ack_response, 'handled');
  // A second ACK is not an error — a retrying receiver must not be punished — but it cannot
  // overwrite the answer the sender may already have acted on.
  const again = await s.post('/api/notify/' + id + '/ack', { from: 'Rune', response: 'me too' });
  assert.deepEqual(again.body, { ok: true, already: true, ackFrom: 'Ivy', ackResponse: 'handled' });
  assert.equal((await s.get('/api/notify/' + id)).body.ack_response, 'handled');
});

test('an ACK for an unknown id is a 404, and an unsigned one a 400', async (t) => {
  const s = await deck(t);
  const missing = await s.post('/api/notify/n-deadbeefdeadbeef/ack', { from: 'Ivy' });
  assert.equal(missing.status, 404, missing.text);
  assert.equal(missing.body.error, 'unknown notify id');
  const sent = await send(s, 'global');
  const unsigned = await s.post('/api/notify/' + sent.body.id + '/ack', { response: 'handled' });
  assert.equal(unsigned.status, 400, unsigned.text);
});

test('expectAck reads "false" and 0 the way a hand-rolled caller means them', async (t) => {
  const s = await deck(t);
  for (const expectAck of ['false', 0, false]) {
    const sent = await send(s, 'global', { expectAck });
    assert.equal((await s.get('/api/notify/' + sent.body.id)).body.expect_ack, false, String(expectAck));
  }
  // Omitted still means yes: the ACK is the point of the layer.
  const stock = await send(s, 'global');
  assert.equal((await s.get('/api/notify/' + stock.body.id)).body.expect_ack, true);
});

test('over the tailnet the bus token opens one notify, and the audit list not at all', async (t) => {
  const s = await deck(t);
  const id = (await send(s, 'global')).body.id;
  const bearer = { authorization: 'Bearer ' + TOKEN };

  // A remote receiver polls its own notify and ACKs it, so both are carried — behind the token.
  assert.equal((await s.tailGet('/api/notify/' + id)).status, 401);
  assert.equal((await s.tailGet('/api/notify/' + id)).body.error, 'invalid message bus token');
  assert.equal((await s.tailGet('/api/notify/' + id, bearer)).status, 200);
  assert.equal((await s.tailPost('/api/notify/' + id + '/ack', { from: 'Ivy' })).status, 401);
  const acked = await s.tailPost('/api/notify/' + id + '/ack', { from: 'Ivy' }, bearer);
  assert.equal(acked.status, 200, acked.text);
  assert.equal(acked.body.ok, true);

  // The whole-fleet audit read is loopback-only: over the tailnet it is not a route at all,
  // so holding the token buys nothing here.
  assert.equal((await s.tailGet('/api/notify')).status, 404);
  assert.equal((await s.tailGet('/api/notify', bearer)).status, 404);

  // And the Mac's own deck is never asked for the token, on either route.
  assert.equal((await s.get('/api/notify')).status, 200);
  assert.equal((await s.get('/api/notify/' + id)).status, 200);
});

test('a send missing any of its three required fields is a 400', async (t) => {
  const s = await deck(t);
  for (const [label, b] of [
    ['no from', { to: 'global', text: 'ping' }],
    ['blank from', { to: 'global', from: '   ', text: 'ping' }],
    ['no text', { to: 'global', from: 'FD-test' }],
    ['blank text', { to: 'global', from: 'FD-test', text: '  ' }],
    ['empty to', { to: '', from: 'FD-test', text: 'ping' }],
    ['no to', { from: 'FD-test', text: 'ping' }],
  ]) {
    const r = await s.post('/api/notify', b);
    assert.equal(r.status, 400, label + ' -> ' + r.text);
    assert.equal(r.body.ok, false, label);
  }
  const bad = await raw(s, '/api/notify', '{not json');
  assert.equal(bad.status, 400, bad.text);
  assert.match(bad.text, /bad request body/);
});
