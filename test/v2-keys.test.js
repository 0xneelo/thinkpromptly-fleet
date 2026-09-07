// L7 acceptance: the pure half of the v2 SSH-keys screen must behave exactly as
// today's public/keys.js does, and must carry BEHAVIOUR.md's contractual strings
// verbatim. The DOM half is out of scope here — requiring the module in Node hits
// its `typeof document === 'undefined'` guard, so nothing renders and no timer
// starts. Covered: the countdown format (keys.js:37-44), the ssh paste line
// (keys.js:5-6), the post() error semantics FD.data's throwing contract would
// otherwise lose (keys.js:178-186), the load() body/transport split (keys.js:170)
// and the constants BEHAVIOUR.md §2-§4 pin word for word.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const keys = require(path.join(ROOT, 'public/v2/screens/keys.js'));

// The function reads the real clock, so every epoch is built from Date.now() at
// assertion time with a half-second of slack — enough that a slow machine cannot
// tip a boundary down into the second below.
const inMs = (ms) => Date.now() + ms + 500;

// ---------------------------------------------------------------------------
// left() — the countdown.
// ---------------------------------------------------------------------------

test('left formats under an hour as zero-padded mm:ss', () => {
  assert.strictEqual(keys.left(inMs(3000)), '00:03');
  assert.strictEqual(keys.left(inMs(45000)), '00:45');
  assert.strictEqual(keys.left(inMs(5 * 60000)), '05:00');
  assert.strictEqual(keys.left(inMs(59 * 60000 + 59000)), '59:59');
});

test('left switches to h:mm at exactly one hour', () => {
  assert.strictEqual(keys.left(inMs(3600000)), '1:00');
  assert.strictEqual(keys.left(inMs(3600000 + 5 * 60000)), '1:05');
  assert.strictEqual(keys.left(inMs(10 * 3600000)), '10:00');
  // The hour is not padded; only the minutes field is.
  assert.strictEqual(keys.left(inMs(2 * 3600000 + 60000)), '2:01');
});

test('left returns null at or past zero', () => {
  assert.strictEqual(keys.left(Date.now()), null);
  assert.strictEqual(keys.left(Date.now() - 1000), null);
  assert.strictEqual(keys.left(Date.now() - 86400000), null);
});

test('pad zero-fills to two digits and leaves wider numbers alone', () => {
  assert.strictEqual(keys.pad(0), '00');
  assert.strictEqual(keys.pad(7), '07');
  assert.strictEqual(keys.pad(59), '59');
  assert.strictEqual(keys.pad(120), '120');
});

// ---------------------------------------------------------------------------
// sshOpts() — the line the operator pastes. The flags are the point.
// ---------------------------------------------------------------------------

test('sshOpts is the current app\'s paste line, flag for flag', () => {
  assert.strictEqual(
    keys.sshOpts('/x'),
    '-o IdentitiesOnly=yes -o IdentityAgent=none -i /x/deployer -o CertificateFile=/x/deployer-cert.pub'
  );
});

test('sshOpts puts the cert dir in both paths', () => {
  const dir = '/Users/vibe/.fleetdeck/certs/20260907-101500';
  assert.strictEqual(
    keys.sshOpts(dir),
    '-o IdentitiesOnly=yes -o IdentityAgent=none -i ' + dir +
      '/deployer -o CertificateFile=' + dir + '/deployer-cert.pub'
  );
});

// ---------------------------------------------------------------------------
// unwrapError() — today's post() semantics on top of a throwing FD.data.
// ---------------------------------------------------------------------------

test('unwrapError hands back the server\'s own JSON body unchanged', () => {
  const body = { ok: false, error: 'ttl must be 1h, 4h or 8h; principals must be names like root or root,vibe' };
  assert.deepStrictEqual(keys.unwrapError({ status: 400, body: body }), body);
  // The server's message must survive as the same object, not a copy of it.
  assert.strictEqual(keys.unwrapError({ status: 400, body: body }), body);
});

test('unwrapError turns an unparseable body into HTTP <status>', () => {
  // keys.js:180 — the Origin gate answers 403 with plain text.
  assert.deepStrictEqual(keys.unwrapError({ status: 403, body: 'forbidden' }), { ok: false, error: 'HTTP 403' });
  assert.deepStrictEqual(keys.unwrapError({ status: 405, body: 'method not allowed' }), { ok: false, error: 'HTTP 405' });
  assert.deepStrictEqual(keys.unwrapError({ status: 502, body: '' }), { ok: false, error: 'HTTP 502' });
});

test('unwrapError leaves error unset when the request never landed', () => {
  // No status means the caller's own `r.error || '<default>'` text applies.
  const out = keys.unwrapError(new Error('fetch failed'));
  assert.deepStrictEqual(out, { ok: false });
  assert.ok(!('error' in out), 'no error key, so the default wins');
  assert.deepStrictEqual(keys.unwrapError(undefined), { ok: false });
});

// ---------------------------------------------------------------------------
// httpBody() — a status is data; no status is 'cannot reach fleetdeck'.
// ---------------------------------------------------------------------------

test('httpBody returns the body of any answered request', () => {
  const body = { ok: false, error: 'the broker said no' };
  assert.strictEqual(keys.httpBody({ status: 503, body: body }), body);
  assert.strictEqual(keys.httpBody({ status: 500, body: 'boom' }), 'boom');
});

test('httpBody rethrows the same error when nothing landed', () => {
  const err = new Error('fetch failed');
  assert.throws(() => keys.httpBody(err), (thrown) => thrown === err);
  assert.throws(() => keys.httpBody(undefined));
});

test('a 503 from a dead broker reaches the UI as the broker\'s own message', () => {
  // server.js:2136-2138 — this exact sentence is what the panel shows, and it
  // must not be flattened into 'cannot reach fleetdeck'.
  const message = 'train broker unreachable at 127.0.0.1:3132 — is the com.fleetdeck.train launch agent loaded?';
  const body = keys.httpBody({ status: 503, body: { ok: false, error: message } });
  assert.deepStrictEqual(body, { ok: false, error: message });
  assert.strictEqual(body.error, message);
  // The same 503 taken through the action path keeps the message too.
  assert.strictEqual(keys.unwrapError({ status: 503, body: body }).error, message);
});

// ---------------------------------------------------------------------------
// Constants — BEHAVIOUR.md §2-§4 pins these strings word for word.
// ---------------------------------------------------------------------------

test('the TTL and principal chip sets are the current app\'s', () => {
  assert.deepStrictEqual(keys.TTLS, ['1h', '4h', '8h']);
  assert.deepStrictEqual(keys.PRINCIPALS, ['root', 'vibe']);
});

test('the principal titles are verbatim, middle dots and all', () => {
  assert.strictEqual(keys.PRINCIPAL_TITLE.root, 'VPS boxes: think · onboarding · ivy');
  assert.strictEqual(keys.PRINCIPAL_TITLE.vibe, 'german-box');
  assert.deepStrictEqual(Object.keys(keys.PRINCIPAL_TITLE), keys.PRINCIPALS, 'a title per principal');
});

test('the kill confirmation is verbatim', () => {
  assert.strictEqual(keys.KILL_CONFIRM, 'Kill this cert now? Agents using it lose access immediately.');
});

test('the timers are the current app\'s 30 s poll, 1 s tick and 1.5 s copy revert', () => {
  assert.strictEqual(keys.POLL_MS, 30000);
  assert.strictEqual(keys.TICK_MS, 1000);
  assert.strictEqual(keys.COPIED_MS, 1500);
});

// ---------------------------------------------------------------------------
// Requiring the module in Node must stay inert.
// ---------------------------------------------------------------------------

test('requiring the screen in Node registers nothing and starts no timer', () => {
  // The DOM half returns at the document guard, so the test process exits on its
  // own: a live setInterval here would hang the run.
  assert.strictEqual(typeof document, 'undefined');
  assert.strictEqual(globalThis.FD && globalThis.FD.screens && globalThis.FD.screens.keys, undefined);
  assert.deepStrictEqual(Object.keys(keys).sort(), [
    'COPIED_MS', 'KILL_CONFIRM', 'PRINCIPALS', 'PRINCIPAL_TITLE', 'POLL_MS', 'TICK_MS', 'TTLS',
    'httpBody', 'left', 'pad', 'sshOpts', 'unwrapError',
  ].sort());
});
