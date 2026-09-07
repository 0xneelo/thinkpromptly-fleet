'use strict';
// fd-v2 L3 (DECK-42) — the server half of the /term WebSocket, for real.
//
// test/v2-windows.test.js covers the client half against a scriptable double; nothing covered
// the deck's own upgrade handler, so verify/l3/live.json's "server half covered by
// test/v2-windows.test.js" was a claim about code nobody ran. This file boots a real fleetdeck
// child on a scratch port and drives an actual `ws` client through it.
//
// The seam is PATH, not FLEET_SSH_BIN: server.js:2903 hands the literal string 'ssh' to
// pty.spawn, so the only way to keep a tile off the operator's real fleet is to put a fake
// executable named `ssh` first on the child's PATH. FLEET_SSH_BIN is pointed at the existing
// fake-ssh.js as well, so nothing else in the deck can reach a real host either.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { tmpdir } = require('./helpers');
const { startServer } = require('./http');

const HOST = 'term-box';
const SESSION = 'FD-term-probe';
const EXIT_CODE = 42; // distinctive, so the exit frame's code proves it came from the pty

// The deck itself requires node-pty, so if it is missing here it is missing there too.
const PTY_OK = (() => {
  try { require('node-pty'); return true; } catch (e) { return false; }
})();

// The fake ssh. Raw mode is deliberate: it turns the pty's own line-discipline echo off, so an
// `ECHO ` line can only mean the byte travelled client -> ws -> term.write() -> pty. The shebang
// is this run's exact interpreter rather than `env node`, because the child's PATH is rewritten.
const FAKE_SSH = [
  '#!' + process.execPath,
  "const argv = process.argv.slice(2);",
  "process.stdout.write('READY ' + argv[argv.length - 2] + ' | ' + argv[argv.length - 1] + '\\r\\n');",
  "const size = () => process.stdout.write('SIZE ' + process.stdout.columns + 'x' + process.stdout.rows + '\\r\\n');",
  'size();',
  "process.stdout.on('resize', size);", // SIGWINCH is how term.resize() becomes observable
  'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
  "process.stdin.on('data', (b) => {",
  '  const s = b.toString();',
  "  if (s.includes('q')) { process.stdout.write('BYE\\r\\n'); process.exit(" + EXIT_CODE + '); }',
  "  process.stdout.write('ECHO ' + s + '\\r\\n');",
  '});',
  '',
].join('\n');

let SRV = null;
let DIR = null;

test.before(async () => {
  if (!PTY_OK) return;
  DIR = tmpdir('term-ws');
  const bin = path.join(DIR, 'ssh');
  fs.writeFileSync(bin, FAKE_SSH);
  fs.chmodSync(bin, 0o755);
  const state = path.join(DIR, 'ssh-state.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: { [HOST]: { sessions: {} } } }));
  SRV = await startServer(
    {
      PATH: DIR + path.delimiter + process.env.PATH,
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: state,
    },
    { dir: DIR, hosts: [{ name: HOST, kind: 'linux' }] } // linux kind: no `wsl ` prefix to read past
  );
});

test.after(async () => {
  if (SRV) await SRV.stop();
  if (DIR) fs.rmSync(DIR, { recursive: true, force: true });
});

// Every socket records what it saw; assertions wait on that record rather than on a clock.
function client(t, urlPath) {
  const ws = new WebSocket('ws://127.0.0.1:' + SRV.port + urlPath);
  const seen = { text: '', frames: [], open: false, closed: null, error: null };
  ws.on('open', () => (seen.open = true));
  ws.on('message', (d) => {
    const s = d.toString();
    seen.frames.push(s);
    seen.text += s;
  });
  ws.on('close', (code) => (seen.closed = code));
  ws.on('error', (e) => (seen.error = e));
  t.after(() => ws.terminate()); // hard close: reap() must fire even if the test bailed early
  return { ws, seen };
}

function waitFor(seen, pred, what, ms = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (pred(seen)) return resolve();
      if (Date.now() - started > ms)
        return reject(
          new Error(
            'timed out waiting for ' + what + ' — closed=' + seen.closed +
              ' err=' + (seen.error && seen.error.message) +
              ' saw=' + JSON.stringify(seen.text.slice(-400))
          )
        );
      setTimeout(tick, 20);
    };
    tick();
  });
}

const termUrl = (session = SESSION, host = HOST, dims = 'cols=&rows=') =>
  '/term?host=' + encodeURIComponent(host) + '&session=' + encodeURIComponent(session) + '&' + dims;

test('a /term socket attaches a pty and streams its raw bytes', async (t) => {
  if (!PTY_OK) return t.skip('node-pty unavailable');
  const c = client(t, termUrl());
  // The banner and the size line are two writes and can land in two frames, so wait for the
  // later one rather than assuming a single frame carries both.
  await waitFor(c.seen, (s) => s.text.includes('SIZE '), 'the pty banner');
  // The deck dials SSH_HOST(host) and runs the tmux attach for the requested session.
  assert.match(c.seen.text, /READY term-box \| tmux attach -t FD-term-probe/);
  // Empty cols/rows fall back through dim() to 80x24 (server.js:588, 2886-2887).
  assert.ok(c.seen.text.includes('SIZE 80x24'), 'expected the 80x24 fallback, saw ' + c.seen.text);
});

test('an input frame reaches the pty', async (t) => {
  if (!PTY_OK) return t.skip('node-pty unavailable');
  const c = client(t, termUrl());
  await waitFor(c.seen, (s) => s.text.includes('READY'), 'the pty banner');
  c.ws.send(JSON.stringify({ type: 'input', data: 'hello' }));
  await waitFor(c.seen, (s) => s.text.includes('ECHO hello'), 'the pty echo');
});

test('a resize frame is applied to the pty', async (t) => {
  if (!PTY_OK) return t.skip('node-pty unavailable');
  const c = client(t, termUrl());
  await waitFor(c.seen, (s) => s.text.includes('SIZE 80x24'), 'the initial size');
  c.ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
  await waitFor(c.seen, (s) => s.text.includes('SIZE 120x40'), 'the resized pty');
  // Out-of-range dims are dropped by dim(), and the socket must survive that rather than throw.
  c.ws.send(JSON.stringify({ type: 'resize', cols: 99999, rows: 0 }));
  c.ws.send(JSON.stringify({ type: 'input', data: 'still-there' }));
  await waitFor(c.seen, (s) => s.text.includes('ECHO still-there'), 'the stream after a bad resize');
  assert.equal(c.seen.closed, null);
});

test('pty exit sends exactly one exit control frame, then closes', async (t) => {
  if (!PTY_OK) return t.skip('node-pty unavailable');
  const c = client(t, termUrl());
  await waitFor(c.seen, (s) => s.text.includes('READY'), 'the pty banner');
  c.ws.send(JSON.stringify({ type: 'input', data: 'q' })); // the fake exits EXIT_CODE on 'q'
  await waitFor(c.seen, (s) => s.closed !== null, 'the socket to close');

  const control = c.seen.frames.filter((f) => f.startsWith('{"type":"exit"'));
  assert.equal(control.length, 1, 'expected one exit frame, got ' + JSON.stringify(control));
  assert.deepEqual(JSON.parse(control[0]), { type: 'exit', code: EXIT_CODE });
  assert.equal(c.seen.frames[c.seen.frames.length - 1], control[0], 'exit must be the last frame');
});

test('a session name that fails SAFE_NAME is closed 4400', async (t) => {
  if (!PTY_OK) return t.skip('node-pty unavailable');
  const c = client(t, termUrl('bad name;rm'));
  await waitFor(c.seen, (s) => s.closed !== null, 'the 4400 close');
  assert.equal(c.seen.closed, 4400);
  assert.equal(c.seen.text, '', 'a rejected session must never see pty bytes');
});

test('a host outside HOSTS() is closed 4400', async (t) => {
  if (!PTY_OK) return t.skip('node-pty unavailable');
  const c = client(t, termUrl(SESSION, 'not-in-the-fleet'));
  await waitFor(c.seen, (s) => s.closed !== null, 'the 4400 close');
  assert.equal(c.seen.closed, 4400);
  assert.equal(c.seen.text, '');
});

test('any path other than /term is destroyed, never upgraded', async (t) => {
  if (!PTY_OK) return t.skip('node-pty unavailable');
  const c = client(t, '/term-ish?host=' + HOST + '&session=' + SESSION);
  await waitFor(c.seen, (s) => s.error !== null || s.closed !== null, 'the destroyed socket');
  assert.equal(c.seen.open, false, 'the handshake must never complete');
  assert.ok(c.seen.error, 'expected a transport error, got close=' + c.seen.closed);
});
