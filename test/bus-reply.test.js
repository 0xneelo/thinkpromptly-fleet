// The way back into the Bus panel. Every bus target used to be a place the deck TYPES into
// (a desktop chat, a tmux pane), so a session with no such place of its own — a desktop seat
// answering the panel — had nothing to address, and its answer never landed. `fleetdeck-ui`
// is the deck itself: the stored row is the delivery, and the panel keys it into the
// sender's thread by its source address (public/v2/data.js isSessionSource). The address is
// self-asserted, like every bus source, so it is held to the rule of the matching target: a
// live desktop session, or a configured host and a safe session name.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { startServer } = require('./http');
const { tmpdir } = require('./helpers');

const SEAT = '🎛 ORCHESTRATOR 28 = O45';
const CLI = '4b7c2d1e-8f9a-4c3b-9d2e-1f0a2b3c4d5e';

// A deck with one live desktop session: this test's own pid, so process.kill(pid, 0) is
// true, and a socket path that merely exists, which is all desktopSessions() checks.
async function deck(t) {
  const dir = tmpdir('bus-reply');
  const registry = path.join(dir, 'registry');
  fs.mkdirSync(registry);
  const socket = path.join(dir, 'seat.sock');
  fs.writeFileSync(socket, '');
  fs.writeFileSync(
    path.join(registry, process.pid + '.json'),
    JSON.stringify({ pid: process.pid, name: SEAT, sessionId: CLI, messagingSocketPath: socket })
  );
  const s = await startServer(
    { CLAUDE_SESSIONS_DIR: registry, CLAUDE_BRIDGE: '/nonexistent/fleetdeck-claude-bridge' },
    { dir }
  );
  t.after(async () => { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return s;
}

const reply = (s, source, text = 'ACK BUS', extra = {}) =>
  s.post('/api/messages', { source, target: { type: 'fleetdeck-ui' }, text, ...extra });

test('a live desktop seat replies into the panel by its ListAgents name, emoji and all', async (t) => {
  const s = await deck(t);
  const r = await reply(s, 'claude-desktop:' + SEAT, 'ACK BUS', { id: 'seat-reply-001' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'delivered');
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.target, { type: 'fleetdeck-ui', session: 'bus' });
  assert.equal(r.body.source, 'claude-desktop:' + SEAT);

  const list = await s.get('/api/messages?limit=5');
  assert.equal(list.status, 200);
  const row = list.body.messages.find((m) => m.id === 'seat-reply-001');
  assert.ok(row, 'the reply is in the history the panel polls');
  assert.equal(row.status, 'delivered');
  assert.ok(row.delivered_at, 'stored is delivered');
});

test('a seat may also reply under its stable CLI id, the address the sessions page uses', async (t) => {
  const s = await deck(t);
  const r = await reply(s, 'claude-desktop:id:' + CLI);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'delivered');
});

test('a tmux worker on a configured host replies with its host:session address', async (t) => {
  const s = await deck(t);
  const r = await reply(s, 'german-box:FD-v2-l6', 'FINAL l6 abc123', { target: { type: 'fleetdeck-ui', session: 'anything-the-client-sent' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'delivered');
  assert.equal(r.body.target.session, 'bus', 'the target session is normalised; the thread is keyed by source');
});

test('a reply that names no live seat or configured host is refused: it would thread nowhere, or as someone else', async (t) => {
  const s = await deck(t);
  const refused = [
    'claude-desktop',            // no address at all
    'cli',
    'design-35',
    'trailing:',
    'claude-desktop:',           // empty name
    'claude-desktop:current',    // the chat alias is not a session name
    'claude-desktop:nobody-here',
    'claude-desktop:id:00000000-0000-4000-8000-000000000000',
    'nowhere:FD-1',              // host not in hosts.json
    'german-box:../etc',         // unsafe session name
  ];
  for (const source of refused) {
    const r = await reply(s, source);
    assert.equal(r.status, 400, source + ': ' + r.text);
    assert.match(r.body.error, /fleetdeck-ui reply must come from|source must be/, source);
  }
});

test('the desktop source keeps the cross-session tag safe: quotes and angle brackets are out', async (t) => {
  const s = await deck(t);
  for (const source of ['claude-desktop:say "hi"', 'claude-desktop:<b>', 'claude-desktop:a\nb']) {
    const r = await reply(s, source);
    assert.equal(r.status, 400, JSON.stringify(source));
  }
});

test('an unknown target type still names every kind the bus takes', async (t) => {
  const s = await deck(t);
  const r = await s.post('/api/messages', { source: 'cli', target: { type: 'pigeon' }, text: 'coo' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /tmux, claude-desktop or fleetdeck-ui/);
});

test('the real bin/fleet-message.js sends --to fleetdeck-ui', async (t) => {
  const s = await deck(t);
  const out = await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'fleet-message.js'), '--to', 'fleetdeck-ui', '--from', 'claude-desktop:' + SEAT, 'ACK from the CLI'],
      { env: { ...process.env, FLEETDECK_URL: 'http://127.0.0.1:' + s.port, FLEETDECK_BUS_TOKEN: '' } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout))
    );
  });
  const result = JSON.parse(out.trim());
  assert.equal(result.status, 'delivered');
  assert.deepEqual(result.target, { type: 'fleetdeck-ui', session: 'bus' });
});
