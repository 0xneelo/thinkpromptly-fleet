// The goalkeeper is write-only to the fleet: it reads the fleet's files and no session may
// address it back. One choke point in deliverDesktopSession refuses every caller, so these tests
// drive all three of them over real HTTP — loopback POST /api/messages (which is also the
// sessions page's send path), POST /api/notify, and ID routing — and each must answer 403 with
// the same sentence. The 🎛 case is the control: an ordinary seat still delivers.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { tmpdir } = require('./helpers');
const { startServer } = require('./http');

const REFUSAL = 'goalkeeper accepts no messages';
// The server resolves the goalkeeper dir against its own HOME, which the child inherits.
const GOALKEEPER_DIR = path.join(os.homedir(), '.claude', 'goalkeeper');
const CLI = '33333333-3333-4333-8333-333333333333';

// Pinned to a private sessions dir: a run on the operator's own machine must resolve rows
// against fixtures, never against the desktop sessions actually open beside the test.
async function deck(t) {
  const dir = tmpdir('goalkeeper');
  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  const s = await startServer({ CLAUDE_SESSIONS_DIR: sessions }, { dir, hosts: [] });
  t.after(() => s.stop());
  return s;
}

// A fake Claude Desktop session, as the registry files a real one: a live pid, a socket, and the
// 0600 key named by the socket's sha256. Socket paths must stay under the 104-byte unix limit,
// so they live in the OS tmpdir, not the test dir.
async function desktopSession(s, name, extra = {}, pid = process.pid) {
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-gk-'));
  const sock = path.join(sockDir, 'p.sock');
  const frames = [];
  const server = net.createServer((c) => c.on('data', (d) => frames.push(d.toString())));
  await new Promise((r) => server.listen(sock, r));
  const dir = path.join(s.dir, 'sessions');
  fs.writeFileSync(
    path.join(dir, pid + '.json'),
    JSON.stringify({ pid, name, messagingSocketPath: sock, ...extra })
  );
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

const sendTo = (s, session, id) =>
  s.post('/api/messages', { id, source: 'FD-test', target: { type: 'claude-desktop', session }, text: 'ping' });

test('POST /api/messages to a 🥅 session is refused with 403', async (t) => {
  const s = await deck(t);
  const gk = await desktopSession(s, '🥅 GOALKEEPER 1');
  t.after(gk.close);
  const r = await sendTo(s, '🥅 GOALKEEPER 1', 'gk-messages-1');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, REFUSAL);
  // Nothing reached the seat's socket, and the attempt is on the record as a failure.
  assert.deepEqual(gk.frames, []);
  const list = await s.get('/api/messages');
  const row = list.body.messages.find((m) => m.id === 'gk-messages-1');
  assert.equal(row.status, 'failed');
  assert.equal(row.error, REFUSAL);
});

test('POST /api/notify addressed to a 🥅 session inherits the 403', async (t) => {
  const s = await deck(t);
  const gk = await desktopSession(s, '🥅 GOALKEEPER 1');
  t.after(gk.close);
  // No seat alias spells a 🥅 title, so notify reaches it the way it reaches any named desktop
  // session: the claude-desktop:<name> address form.
  const r = await s.post('/api/notify', {
    to: 'claude-desktop:🥅 GOALKEEPER 1',
    from: 'FD-test',
    text: 'ping',
  });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, REFUSAL);
});

test('a plainly named session running in the goalkeeper dir is refused', async (t) => {
  const s = await deck(t);
  const gk = await desktopSession(s, 'plain worker', { cwd: GOALKEEPER_DIR });
  t.after(gk.close);
  const r = await sendTo(s, 'plain worker', 'gk-by-cwd-1');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.error, REFUSAL);
});

test('an ordinary 🎛 seat is not refused and still delivers', async (t) => {
  const s = await deck(t);
  const seat = await desktopSession(s, '🎛 ORCHESTRATOR 34');
  t.after(seat.close);
  const r = await sendTo(s, '🎛 ORCHESTRATOR 34', 'gk-control-1');
  assert.notEqual(r.status, 403, r.text);
  assert.notEqual(r.body.error, REFUSAL);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'delivered');
  assert.match(seat.frames.join(''), /"type":"auth"/);
});

test('ID routing to a 🥅 session is refused too', async (t) => {
  const s = await deck(t);
  const gk = await desktopSession(s, '🥅 GOALKEEPER 1', { sessionId: CLI });
  t.after(gk.close);
  const r = await sendTo(s, 'id:' + CLI, 'gk-by-id-1');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.error, REFUSAL);
});

// A zero-width space before the badge still reads as 🥅 to a human, so it must still refuse.
// The cwd is deliberately outside the goalkeeper dir: only the name rule can be what catches this.
test('a zero-width prefix does not walk the 🥅 badge past the choke point', async (t) => {
  const s = await deck(t);
  const name = '​🥅 GOALKEEPER 1';
  const gk = await desktopSession(s, name, { cwd: os.tmpdir() });
  t.after(gk.close);
  const r = await sendTo(s, name, 'gk-zwsp-1');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, REFUSAL);
  assert.deepEqual(gk.frames, []);
});

// The deck also runs on the Mac, where the same directory has many spellings, so the cwd
// compare is case-folded. The directory need not exist: this is a pure string compare.
test('a case-variant spelling of the goalkeeper dir is still refused', async (t) => {
  const s = await deck(t);
  const gk = await desktopSession(s, 'plain worker', {
    cwd: path.join(os.homedir(), '.claude', 'GoalKeeper'),
  });
  t.after(gk.close);
  const r = await sendTo(s, 'plain worker', 'gk-cwd-case-1');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, REFUSAL);
  assert.deepEqual(gk.frames, []);
});

// Pins the AX-bridge carve-out named at server.js's choke-point comment and as P11 in
// docs/goals/goalkeeper/LINEAR-PENDING.md: `current` goes to the bridge, which resolves no
// session row, so the choke point never sees it. If this ever fails because `current` started
// answering the refusal, the control has widened for the better and P11 can be closed.
test('the `current` target is a known gap: it never reaches the goalkeeper refusal', async (t) => {
  const s = await deck(t);
  const r = await sendTo(s, 'current', 'gk-current-1');
  assert.ok(!(r.status === 403 && r.body.error === REFUSAL), 'current was refused: ' + r.text);
  assert.notEqual(r.body.error, REFUSAL);
  // What it does instead: the bus accepts the row, delivery throws, and the failure is recorded.
  // Nothing 403s, so the HTTP answer is a 200 carrying a failed message.
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'failed');
  if (process.platform !== 'darwin')
    assert.equal(r.body.error, 'Claude Desktop delivery requires macOS');
});
