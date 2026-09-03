// The notify layer: seat aliases fail closed unless openChat opts into the desktop collapse;
// worker/address resolution, ACK storage, and loopback/tailnet auth are also covered here.
//
// The load-bearing case is "exact beats label": a session whose label reads "waiting on Ivy"
// must never stand in for, or ambiguate with, the worker actually named Ivy. Before the
// resolver split that label was ORed into the same lookup and a notify to Ivy 409'd.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
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
  // Pinned to a private dir: a run on the operator's Mac must resolve seats against fixtures,
  // never against the desktop sessions actually open beside the test.
  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  const s = await startServer(
    {
      FLEETDECK_BUS_TOKEN: TOKEN,
      CLAUDE_BRIDGE: NO_BRIDGE,
      CLAUDE_SESSIONS_DIR: sessions,
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: state,
    },
    { dir }
  );
  t.after(() => s.stop());
  return s;
}

// A fake Claude Desktop session: the registry files a real one publishes (a live pid — this
// process or its parent — a socket, and the 0600 key file named by the socket's sha256), plus a
// listener that records the frames a sender writes. Socket paths must stay under the 104-byte
// unix limit, so they live in the OS tmpdir, not the test dir.
async function desktopSession(s, name, pid = process.pid) {
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-'));
  const sock = path.join(sockDir, 'p.sock');
  const frames = [];
  const server = net.createServer((c) => c.on('data', (d) => frames.push(d.toString())));
  await new Promise((r) => server.listen(sock, r));
  const dir = path.join(s.dir, 'sessions');
  fs.writeFileSync(path.join(dir, pid + '.json'), JSON.stringify({ pid, name, messagingSocketPath: sock }));
  fs.writeFileSync(
    path.join(dir, pid + '.' + crypto.createHash('sha256').update(sock).digest('hex') + '.key'),
    JSON.stringify({ peerToken: 'peer-token-' + pid })
  );
  return {
    frames,
    close: () =>
      new Promise((r) => {
        server.close(r);
        fs.rmSync(sockDir, { recursive: true, force: true });
      }),
  };
}

const send = (s, to, extra) =>
  s.post('/api/notify', { to, from: 'FD-test', text: 'ping', ...extra });
const seatSend = (s, to = 'global', extra = {}) => send(s, to, { openChat: true, ...extra });

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

test('a seat alias is refused without openChat and creates no notify', async (t) => {
  const s = await deck(t);
  const db = s.open();
  db.prepare(
    'INSERT INTO seats (seat, owner_host, owner_name, epoch) VALUES (?, ?, ?, ?)'
  ).run('orchestrator', 'mac', 'O36-lowcap-orchestrator-15', 7);
  db.close();
  for (const [to, seat] of [
    ['orchestrator lowcapconnector', '🎛 ORCHESTRATOR · lowcapconnector'],
    ['global', '🌐 GLOBAL'],
    ['researcher 3', '🔬 RESEARCHER 3'],
    ['design 2', '🎨 DESIGN 2'],
  ]) {
    const r = await send(s, to);
    assert.equal(r.status, 409, to + ' -> ' + r.text);
    assert.equal(r.body.error, 'seat_unaddressable', to);
    assert.equal(r.body.seat, seat, to);
    assert.match(r.body.hint, /--open-chat/, to);
    if (to.startsWith('orchestrator')) {
      assert.deepEqual(r.body.owner, { host: 'mac', name: 'O36-lowcap-orchestrator-15', fenced: true });
      assert.doesNotMatch(r.text, /epoch/);
    }
    if (to === 'global') assert.equal(r.body.owner, null);
    assert.deepEqual((await s.get('/api/notify?limit=5')).body.notifies, [], to);
  }
  // The seats read is loopback-only, so the refusal must not hand a tailnet peer the owner.
  const remote = await s.tailPost(
    '/api/notify',
    { to: 'orchestrator lowcapconnector', from: 'FD-test', text: 'ping' },
    { authorization: 'Bearer ' + TOKEN }
  );
  assert.equal(remote.status, 409, remote.text);
  assert.equal(remote.body.error, 'seat_unaddressable');
  assert.equal(remote.body.owner, null);
  assert.doesNotMatch(remote.text, /O36-lowcap-orchestrator-15|"mac"/);
});

test('openChat true spellings opt a seat alias into the desktop collapse', async (t) => {
  const s = await deck(t);
  for (const openChat of [true, 1, 'true']) {
    const r = await send(s, 'global', { openChat });
    assert.equal(r.status, 200, String(openChat) + ' -> ' + r.text);
    assert.equal(r.body.resolvedTarget, 'claude-desktop:current');
    assert.equal(r.body.resolvedVia, 'seat');
  }
});

test('a notify view exposes resolution, delivered, and ACK booleans', async (t) => {
  const s = await deck(t);
  for (const [sent, resolvedVia] of [
    [await seatSend(s), 'seat'],
    [await send(s, 'german-box:agent-zed'), 'address'],
  ]) {
    const before = await s.get('/api/notify/' + sent.body.id);
    assert.equal(before.body.resolved_via, resolvedVia);
    assert.equal(before.body.delivered, false);
    assert.equal(typeof before.body.delivered, 'boolean');
    assert.equal(before.body.acked, false);
    assert.equal((await s.post('/api/notify/' + sent.body.id + '/ack', { from: 'Ivy' })).body.ok, true);
    assert.equal((await s.get('/api/notify/' + sent.body.id)).body.acked, true);
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
  const sent = await seatSend(s);
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
  const sent = await seatSend(s);
  const unsigned = await s.post('/api/notify/' + sent.body.id + '/ack', { response: 'handled' });
  assert.equal(unsigned.status, 400, unsigned.text);
});

test('expectAck reads "false" and 0 the way a hand-rolled caller means them', async (t) => {
  const s = await deck(t);
  for (const expectAck of ['false', 0, false]) {
    const sent = await seatSend(s, 'global', { expectAck });
    assert.equal((await s.get('/api/notify/' + sent.body.id)).body.expect_ack, false, String(expectAck));
  }
  // Omitted still means yes: the ACK is the point of the layer.
  const stock = await seatSend(s);
  assert.equal((await s.get('/api/notify/' + stock.body.id)).body.expect_ack, true);
});

test('over the tailnet the bus token opens one notify, and the audit list not at all', async (t) => {
  const s = await deck(t);
  const id = (await seatSend(s)).body.id;
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

test('a seat alias delivers to the live desktop session titled for it, over its peer socket', async (t) => {
  const s = await deck(t);
  const seat = await desktopSession(s, '🔬 RESEARCHER 3 · no_quorum residuals');
  t.after(seat.close);
  const r = await send(s, 'researcher 3');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resolvedTarget, 'claude-desktop:🔬 RESEARCHER 3 · no_quorum residuals');
  assert.equal(r.body.resolvedVia, 'seat');
  assert.equal(r.body.status, 'delivered');
  // Two JSON lines, as a Claude session writes them: the receiver's own token, then the turn.
  const [auth, turn, rest] = seat.frames.join('').split('\n');
  assert.deepEqual(JSON.parse(auth), { type: 'auth', token: 'peer-token-' + process.pid });
  const m = JSON.parse(turn);
  assert.equal(m.msgV, 1);
  assert.equal(m.type, 'user');
  assert.equal(m.from, 'fleetdeck:FD-test');
  assert.match(m.message.content, /^<cross-session-message from="fleetdeck:FD-test" from-name="FD-test"/);
  assert.match(m.message.content, new RegExp('\\[notify ' + r.body.id + '\\] from FD-test\\nping'));
  assert.match(m.message.content, /\/api\/notify\/n-[0-9a-f]+\/ack/);
  assert.equal(rest, '');
});

test('orchestrator <project> matches the seat title with spelling drift, else the lease owner', async (t) => {
  const s = await deck(t);
  const titled = await desktopSession(s, '🎛 ORCHESTRATOR 13 · lowcapconnector · notify');
  t.after(titled.close);
  const r = await send(s, 'orchestrator lowcap-connector');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resolvedTarget, 'claude-desktop:🎛 ORCHESTRATOR 13 · lowcapconnector · notify');
  // A never-renamed orchestrator is found through its fenced lease row instead.
  const other = await send(s, 'orchestrator symm-treasury');
  assert.equal(other.status, 409, other.text);
  assert.equal(other.body.error, 'seat_unaddressable');
  const lease = await desktopSession(s, 'O38-symm-orchestrator-4', process.ppid);
  t.after(lease.close);
  const db = s.open();
  db.prepare('INSERT INTO seats (seat, owner_host, owner_name, epoch, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run('orchestrator', 'mac', 'O38-symm-orchestrator-4', 1, Date.now() + 60000);
  db.close();
  const viaLease = await send(s, 'orchestrator symm-treasury');
  assert.equal(viaLease.status, 200, viaLease.text);
  assert.equal(viaLease.body.resolvedTarget, 'claude-desktop:O38-symm-orchestrator-4');
});

test('two live sessions titled for one seat is a 409 naming both, and a dead pid is not live', async (t) => {
  const s = await deck(t);
  const a = await desktopSession(s, '🎨 DESIGN 2 · header');
  const b = await desktopSession(s, '🎨 DESIGN 2 · footer', process.ppid);
  t.after(a.close);
  t.after(b.close);
  const r = await send(s, 'design 2');
  assert.equal(r.status, 409, r.text);
  assert.deepEqual(r.body.candidates.map((c) => c.name).sort(), ['🎨 DESIGN 2 · footer', '🎨 DESIGN 2 · header']);
  // DESIGN 21 must not match DESIGN 2.
  assert.equal((await send(s, 'design 21')).status, 409);
  fs.writeFileSync(
    path.join(s.dir, 'sessions', '999999.json'),
    JSON.stringify({ pid: 999999, name: '🌐 GLOBAL 1', messagingSocketPath: '/nonexistent.sock' })
  );
  const dead = await send(s, 'global');
  assert.equal(dead.status, 409, dead.text);
  assert.equal(dead.body.error, 'seat_unaddressable');
});
