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
const SCREEN = path.join(ROOT, 'public/v2/screens/keys.js');

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

test('the TTL and box chip sets are the current app\'s', () => {
  assert.deepStrictEqual(keys.TTLS, ['1h', '4h', '8h']);
  // 2026-09-08: the chips became boxes rather than unix logins. rog-strix had been
  // unreachable since 2026-09-06 because this screen only knew root and vibe, and a
  // principal that does not match a box's login username does not open it.
  assert.deepStrictEqual(keys.BOX_IDS, ['rog-strix', 'vibes-asus', 'german', 'onboarding', 'promptly', 'ivy']);
  // keys.js finds each chip by its label, so a box id must never read as a TTL or as Mint.
  assert.deepStrictEqual(keys.BOX_IDS.filter((id) => keys.TTLS.includes(id) || id === 'Mint'), []);
});

test('the chip labels logic.js renders are BOX_IDS, in order', () => {
  // keys.js joins its titles to the chips by label, and logic.js owns the labels
  // (prinChips) and the default selection (prin). A box in one list and not the
  // other mislabelled every chip on 2026-09-10 — the old join was positional.
  // logic.js is hand-maintained beside the template, so both are pinned.
  const fs = require('fs');
  for (const rel of ['public/v2/template.dc.html', 'public/v2/logic.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const chips = src.match(/prinChips: (\[[^\]]*\])/);
    assert.ok(chips, 'prinChips list in ' + rel);
    assert.deepStrictEqual(JSON.parse(chips[1].replace(/'/g, '"')), keys.BOX_IDS, rel + ' prinChips');
    const def = src.match(/ttl: '1h', prin: \{([^}]*)\}/);
    assert.ok(def, 'prin default in ' + rel);
    const ids = def[1].split(',').map((kv) => kv.split(':')[0].trim().replace(/'/g, ''));
    assert.deepStrictEqual(ids, keys.BOX_IDS, rel + ' prin default');
  }
});

test('every box chip carries the login that actually opens it', () => {
  assert.deepStrictEqual(
    keys.BOXES.map((b) => b.user),
    ['misterisley', 'tabor', 'vibe', 'root', 'root', 'root']
  );
  assert.ok(keys.BOXES.every((b) => b.title && b.title.length), 'a title per box');
});

test('principalsFor: Daily default cannot inherit Admin box choices', () => {
  assert.deepStrictEqual(keys.principalsFor({ ivy: true }), ['deploy']);
  assert.deepStrictEqual(keys.principalsFor({ ivy: true, promptly: true }, 'daily'), ['deploy']);
  assert.deepStrictEqual(keys.principalsFor({}, 'admin'), ['admin']);
});

test('Admin principals are role plus validated box tags; unknown sixth host grants nothing', () => {
  assert.deepStrictEqual(keys.principalsFor({ 'rog-strix': true, german: true, ivy: true, 'vibes-asus': true }, 'admin'), [
    'admin', 'rog-only', 'german-only', 'ivy-only',
  ]);
  assert.strictEqual(keys.BOXES.find(b => b.id === 'vibes-asus').tag, null);
  assert.match(keys.BOXES.find(b => b.id === 'vibes-asus').title, /trust unknown/);
});

test('mint requests couple each profile to its fixed duration', () => {
  assert.deepStrictEqual(keys.mintRequest(), { profile: 'daily', ttl: '8h', extraTags: [] });
  assert.deepStrictEqual(keys.mintRequest('daily', { ivy: true }), { profile: 'daily', ttl: '8h', extraTags: [] });
  assert.deepStrictEqual(keys.mintRequest('admin', { ivy: true }), { profile: 'admin', ttl: '1h', extraTags: ['ivy-only'] });
  assert.deepStrictEqual(keys.PROFILES, { daily: { label: 'Daily cert', ttl: '8h' }, admin: { label: 'Admin cert', ttl: '1h' } });
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

test('requiring the screen in Node exports the pure half and starts no timer', () => {
  // L7.1 changed this contract deliberately. The module used to return at a
  // `typeof document === 'undefined'` guard, which also made its lifecycle
  // untestable. It now loads under Node the way org.js does — so the require
  // below DOES register FD.screens.keys — but it must still start nothing: a
  // live setInterval here would hang the run, and a fetch would mean the app
  // polls before any screen is entered.
  assert.strictEqual(typeof document, 'undefined');
  assert.deepStrictEqual(Object.keys(keys).sort(), [
    'COPIED_MS', 'KILL_CONFIRM', 'BOXES', 'BOX_IDS', 'principalsFor', 'mintRequest', 'PROFILES', 'POLL_MS', 'TICK_MS', 'TTLS',
    'httpBody', 'left', 'pad', 'sshOpts', 'unwrapError',
  ].sort());
  // The registered surface is inert until a screen is entered. (The L7.1 test
  // below installs its own FD; here the module was required with none, so the
  // registration is whatever that produced — the timers are the claim.)
  const live = globalThis.FD && globalThis.FD.screens && globalThis.FD.screens.keys;
  if (live && live._debug) {
    assert.deepStrictEqual(live._debug.timers, { tick: false, poll: false, onScreen: false });
  }
});

// ---------------------------------------------------------------------------
// L7.1 — the poll and the tick belong to the screen, not to the app.
//
// Today's keys.js is a page that only exists while you are on it. In the SPA
// that means the 30 s /api/sshkeys poll and the 1 s countdown tick must start
// when the screen is entered and stop when it is left; before this fix they
// began at module load and ran from every other screen for the whole session.
//
// keys.js is a browser IIFE, so it is loaded the way test/v2-org.test.js loads
// org.js: window aliased to the global, FD stubbed, then required. With no
// document its DOM half is inert, which is exactly what makes the lifecycle
// observable on its own.
test('L7.1 the sshkeys poll and the countdown tick follow the screen', async (t) => {
  const realWindow = global.window;
  const realFD = global.FD;
  global.window = global;

  const fetched = [];
  let pollFn = null;
  let pollStopped = 0;

  global.FD = {
    fixture: {},
    screens: {},
    shell: {},
    setData(name, value) { this.fixture[name] = value; },
    data: {
      isFixture: () => false,
      sshkeys: () => { fetched.push('/api/sshkeys'); return Promise.resolve({ certs: [], keys: [] }); },
      ghtrain: () => { fetched.push('/api/ghtrain'); return Promise.resolve({ active: false, expiresAt: null }); },
      toKeys: () => ({ keyRows: [], certs: [], train: null }),
      // Mirrors data.js:595-601 — a real interval behind a stop handle, so the
      // mocked clock below drives it exactly as the browser would.
      poll(fn, ms) {
        pollFn = fn;
        const id = setInterval(fn, ms);
        return { stop() { clearInterval(id); pollStopped += 1; pollFn = null; } };
      },
    },
  };

  delete require.cache[require.resolve(SCREEN)];
  require(SCREEN);
  const keys = global.FD.screens.keys;

  t.after(() => {
    keys.stop();
    delete require.cache[require.resolve(SCREEN)];
    global.window = realWindow;
    global.FD = realFD;
  });

  const sync = (isKeys) => keys.sync({ t: {}, dark: true, isKeys, pills: {}, chipBtn: {}, chipBtnSel: {} });
  const settle = () => new Promise((r) => setImmediate(r));
  // Real intervals, mocked clock: ticking advances the module's own timers.
  t.mock.timers.enable({ apis: ['setInterval'] });

  // Loading the module must not start anything: no screen has been entered.
  assert.deepEqual(keys._debug.timers, { tick: false, poll: false, onScreen: false });
  assert.deepEqual(fetched, [], 'module load must not fetch');

  // Entering the screen starts both timers and does the first load.
  sync(true);
  assert.equal(keys._debug.timers.tick, true, 'the 1 s tick runs on the keys screen');
  assert.equal(keys._debug.timers.poll, true, 'the 30 s poll runs on the keys screen');
  await settle();
  assert.deepEqual(fetched.slice().sort(), ['/api/ghtrain', '/api/sshkeys'], 'entering loads once');

  // Advancing past the 30 s poll while the screen is up DOES fetch — otherwise
  // the negative assertion below would pass for the wrong reason.
  fetched.length = 0;
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(fetched.length, 2, 'the poll fetches while the screen is up');

  // Leaving stops both timers and releases the poll handle.
  sync(false);
  assert.deepEqual(keys._debug.timers, { tick: false, poll: false, onScreen: false }, 'both timers stop on leave');
  assert.equal(pollStopped, 1, 'the poll handle is released, not just dropped');
  assert.equal(pollFn, null);

  // The core claim: advance well past several poll and tick periods after
  // leaving, and nothing is fetched.
  fetched.length = 0;
  t.mock.timers.tick(5 * 60_000);
  await settle();
  assert.deepEqual(fetched, [], 'no fetch after leaving the screen');

  // Re-entering starts a fresh pair rather than leaking a second set.
  sync(true);
  assert.equal(keys._debug.timers.tick, true, 're-entering restarts the tick');
  assert.equal(keys._debug.timers.poll, true, 're-entering restarts the poll');
  const before = keys._debug.timers;
  sync(true);                                    // a second render on the same screen
  assert.deepEqual(keys._debug.timers, before, 'a repeat render does not stack timers');

  // And a repeat render really did not stack a second poll: one tick, one pair.
  fetched.length = 0;
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(fetched.length, 2, 'exactly one poll is running after a repeat render');
});
