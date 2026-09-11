// DECK-108: an unblock answer is certified. Every operator write needs the Origin AND a signed-in
// session, and every fresh click is HMAC-signed over sheet, question, choice, time and operator,
// so a row edited in fleet.db or copied from another sheet reads sigValid false at once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('./helpers');
const auth = require('../operator-auth');

test('a password hash verifies the password and nothing else', async () => {
  const stored = await auth.hashPassword('correct horse battery');
  assert.match(stored, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
  assert.equal(await auth.verifyPassword('correct horse battery', stored), true);
  assert.equal(await auth.verifyPassword('correct horse batterY', stored), false);
  assert.notEqual(await auth.hashPassword('correct horse battery'), stored, 'every hash has its own salt');
  for (const bad of ['', 'scrypt$32768$8$1$x', stored.replace('scrypt', 'bcrypt'), stored.slice(0, -2), null])
    assert.equal(await auth.verifyPassword('correct horse battery', bad), false);
  assert.equal(await auth.verifyPassword(undefined, stored), false);
});

// A dev secret for every deck in this file: throwaway values, hashed once (scrypt is slow on purpose).
const PASSWORD = 'throwaway operator pass';
const KEY = crypto.randomBytes(32).toString('hex');
const HASH = auth.hashPassword(PASSWORD);
const secretText = async (over = {}) =>
  JSON.stringify({
    version: 1,
    hmacKey: KEY,
    operatorId: 'neelo@test',
    identity: { kind: 'password', hash: await HASH },
    ...over,
  });

test('loadDeckSecret takes exactly the documented shape and never echoes secret material', async () => {
  const hash = await HASH;
  const ok = auth.loadDeckSecret(await secretText());
  assert.ok(Buffer.isBuffer(ok.hmacKey) && ok.hmacKey.length === 32);
  assert.equal(ok.hmacKey.toString('hex'), KEY);
  assert.equal(ok.operatorId, 'neelo@test');
  assert.deepEqual(ok.identity, { kind: 'password', hash });

  const bad = [
    'not json ' + KEY,
    '{"hmacKey":"' + KEY + '", "identity": "' + hash + '"',
    JSON.stringify([KEY]),
    await secretText({ version: 2 }),
    await secretText({ hmacKey: KEY.slice(1) }),
    await secretText({ hmacKey: KEY.slice(0, 63) + 'g' }),
    await secretText({ hmacKey: 42 }),
    await secretText({ operatorId: '' }),
    await secretText({ operatorId: 'has space' }),
    await secretText({ operatorId: 'x'.repeat(65) }),
    await secretText({ identity: null }),
    await secretText({ identity: { kind: 'passkey', hash } }),
    await secretText({ identity: { kind: 'password', hash: hash.replace('scrypt', 'md5') } }),
    await secretText({ identity: { kind: 'password' } }),
  ];
  for (const text of bad) {
    assert.throws(() => auth.loadDeckSecret(text), (e) => {
      assert.ok(!e.message.includes(KEY) && !e.message.includes(hash.split('$')[5]), 'no secret in: ' + e.message);
      assert.ok(!e.message.includes(KEY.slice(0, 16)), 'not even a slice of the key');
      return true;
    }, text.slice(0, 60));
  }
});

// --- the deck harness, mirrored from unblock-api.test.js: one deck per test, own port, own db.
const { hostsFile, load, unload } = require('./helpers');
let port = 37000 + Math.floor(Math.random() * 15000);
const opt = (key, label) => ({ key, label });
const question = (id, ...keys) => ({
  id, topic: 't', decision: 'decide ' + id, why: 'w', explain: 'e',
  options: keys.map((k) => opt(k, 'label ' + k)),
});
const SHEET = { title: 'the signing lane', questions: [question('q1', 'sqlite', 'pg'), question('q2', 'flag', 'straight')] };

// `secret: false` is an unconfigured deck. The env is always set whole (load() says why), so the
// unconfigured case unsets FLEET_DECK_SECRET_FILE rather than inheriting one.
async function deck(t, { secret = true } = {}) {
  const dir = tmpdir('signing');
  const PORT = port++;
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: {}, calls: [] }));
  const secretFile = path.join(dir, 'deck-secret.json');
  if (secret) fs.writeFileSync(secretFile, await secretText(), { mode: 0o600 });
  const db = path.join(dir, 'fleet.db');
  const m = load(
    {
      PORT,
      FLEET_DB: db,
      FLEET_HOSTS_FILE: hostsFile(dir),
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: state,
      CLAUDE_SESSIONS_DIR: path.join(dir, 'no-desktop-sessions'),
      FLEETDECK_BUS_TOKEN: 'test-token',
      FLEET_DECK_SECRET_FILE: secret ? secretFile : '',
    },
    { listen: true }
  );
  t.after(() => unload(m));
  const base = 'http://127.0.0.1:' + PORT;
  const origin = base;
  let cookie = null;
  const raw = (method, p, b, headers) =>
    fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }),
    });
  const read = async (r) => ({
    status: r.status,
    headers: Object.fromEntries(r.headers),
    setCookie: r.headers.getSetCookie(),
    body: await r.json().catch(() => null),
  });
  // Operator calls carry the browser's Origin and the session cookie unless a test says otherwise.
  const op = (method, p, b, headers) =>
    raw(method, p, b, headers || { origin, ...(cookie ? { cookie } : {}) }).then(read);
  const d = {
    m, base, origin, db, dir,
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    op,
    get: (p = '') => op('GET', '/api/unblock' + p, undefined, {}),
    put: (p, b, headers) => op('PUT', '/api/unblock' + p, b, headers),
    act: (p, b = {}, headers) => op('POST', '/api/unblock' + p, b, headers),
    session: () => op('GET', '/api/operator/session', undefined, { ...(cookie ? { cookie } : {}) }),
    signin: async (password = PASSWORD, headers) => {
      const r = await op('POST', '/api/operator/signin', { password }, headers);
      const set = r.setCookie.find((c) => c.startsWith('fleetdeck_operator='));
      if (r.status === 200 && set) cookie = set.split(';')[0];
      return r;
    },
    signout: (headers) => op('POST', '/api/operator/signout', {}, headers),
    create: async (extra = {}) => {
      const r = await raw('POST', '/api/unblock', { ...SHEET, ...extra }, {}).then(read);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.id;
    },
  };
  return d;
}

// --- b. sign-in

test('sign-in: wrong 401, right 200 with a strict HttpOnly cookie, signout ends the session', async (t) => {
  const d = await deck(t);
  assert.deepEqual((await d.session()).body, { configured: true, signedIn: false, operatorId: null, expiresAt: null });

  const wrong = await d.signin('not the password');
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, { error: 'wrong password' });
  assert.equal(wrong.setCookie.length, 0);
  assert.equal((await d.signin(PASSWORD, {})).status, 403, 'sign-in needs the browser Origin');
  assert.equal((await d.signin(PASSWORD, { origin: 'http://evil.example' })).status, 403);

  const right = await d.signin();
  assert.equal(right.status, 200);
  assert.equal(right.body.signedIn, true);
  assert.equal(right.body.operatorId, 'neelo@test');
  const expires = Date.parse(right.body.expiresAt);
  assert.ok(Math.abs(expires - Date.now() - 12 * 3600e3) < 60e3, 'a session lives twelve hours');
  const set = right.setCookie.find((c) => c.startsWith('fleetdeck_operator='));
  assert.match(set, /^fleetdeck_operator=[A-Za-z0-9_-]{43}; /);
  for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=43200'])
    assert.ok(set.split('; ').includes(attr), attr + ' in ' + set);

  const session = await d.session();
  assert.deepEqual(session.body, { configured: true, signedIn: true, operatorId: 'neelo@test', expiresAt: right.body.expiresAt });

  const id = await d.create();
  assert.equal((await d.put('/' + id + '/answers/q1', { choice: 'sqlite' })).status, 200);

  assert.equal((await d.signout({ cookie: d.cookie })).status, 403, 'signout needs the browser Origin');
  const out = await d.signout();
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { signedIn: false });
  assert.ok(out.setCookie.some((c) => /^fleetdeck_operator=; /.test(c) && c.includes('Max-Age=0')));
  assert.equal((await d.session()).body.signedIn, false, 'the old token is gone server-side');
  assert.equal((await d.put('/' + id + '/answers/q1', { choice: 'pg' })).status, 401);
});

test('five wrong passwords lock sign-in for a minute, even for the right one', async (t) => {
  const d = await deck(t);
  for (let i = 0; i < 4; i++) assert.equal((await d.signin('wrong ' + i)).status, 401);
  assert.equal((await d.signin()).status, 200, 'four wrong then right: the counter resets');
  for (let i = 0; i < 5; i++) assert.equal((await d.signin('wrong ' + i)).status, 401);
  const locked = await d.signin();
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, 'too many attempts');
  assert.ok(locked.body.retryAfter > 0 && locked.body.retryAfter <= 60, String(locked.body.retryAfter));
});

test('parallel guesses cannot all start under the limit', async (t) => {
  const d = await deck(t);
  const codes = (await Promise.all(Array.from({ length: 12 }, (_, i) => d.signin('parallel ' + i)))).map((r) => r.status);
  assert.ok(codes.filter((c) => c === 401).length <= 5, codes.join(','));
  assert.equal((await d.signin()).status, 429, 'and the lock holds afterwards');
});

// --- a. the write gate: Origin first, then the session

test('every operator write needs the Origin and a live session; neither stands in for the other', async (t) => {
  const d = await deck(t);
  const id = await d.create({ reply: { type: 'tmux', host: 'german-box', session: 'FD-ivy' } });
  const writes = [
    ['PUT', '/api/unblock/' + id + '/answers/q1', { choice: 'sqlite' }],
    ['POST', '/api/unblock/' + id + '/close', {}],
    ['POST', '/api/unblock/' + id + '/reopen', {}],
    ['POST', '/api/unblock/' + id + '/send', {}],
  ];
  const garbage = 'fleetdeck_operator=' + crypto.randomBytes(32).toString('base64url');
  for (const [method, p, b] of writes) {
    const forged = await d.op(method, p, b, { origin: 'http://evil.example' });
    assert.equal(forged.status, 403, method + ' ' + p + ' forged Origin, no session');
    const bare = await d.op(method, p, b, { origin: d.origin });
    assert.equal(bare.status, 401, method + ' ' + p + ' Origin, no session');
    assert.deepEqual(bare.body, { error: 'sign in required' });
    assert.equal((await d.op(method, p, b, { origin: d.origin, cookie: garbage })).status, 401, p + ' garbage cookie');
  }
  assert.deepEqual((await d.get('/' + id)).body.answers, {}, 'nothing a refused write asked for was stored');

  await d.signin();
  for (const [method, p, b] of writes) {
    assert.equal((await d.op(method, p, b, { origin: 'http://evil.example', cookie: d.cookie })).status, 403, p + ' bad Origin, valid cookie');
    assert.equal((await d.op(method, p, b, { cookie: d.cookie })).status, 403, p + ' no Origin, valid cookie');
  }
  assert.equal((await d.put('/' + id + '/answers/q1', { choice: 'sqlite' })).status, 200, 'both together pass');
  assert.equal((await d.act('/' + id + '/close')).status, 200);
});

test('the sheet POST stays agent-facing: no Origin, no session', async (t) => {
  const d = await deck(t);
  await d.create();
});

// --- c. a signed answer, and the CLI a seat runs to check one

const { spawn } = require('child_process');
const CLI = path.join(__dirname, '..', 'bin', 'fleetdeck-verify-answer.js');
function verify(d, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, FLEETDECK_URL: d.base },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('a signed-in click is signed, and the CLI certifies it', async (t) => {
  const d = await deck(t);
  const id = await d.create({ reply: { type: 'tmux', host: 'german-box', session: 'FD-ivy' } });
  await d.signin();
  const put = await d.put('/' + id + '/answers/q1', { choice: 'sqlite' });
  assert.equal(put.status, 200);
  assert.equal(put.body.operatorId, 'neelo@test');
  assert.match(put.body.sig, /^[0-9a-f]{64}$/);
  assert.equal(put.body.sigValid, true);

  const a = (await d.get('/' + id)).body.answers.q1;
  assert.deepEqual({ op: a.operatorId, sig: a.sig, valid: a.sigValid }, { op: 'neelo@test', sig: put.body.sig, valid: true });

  const text = await verify(d, id, 'q1');
  assert.equal(text.code, 0, text.out + text.err);
  assert.match(text.out, new RegExp('^sheet: ' + id + ' · the signing lane$', 'm'));
  assert.match(text.out, /^posted: \S+ · reply: tmux:FD-ivy$/m);
  assert.match(text.out, /^question: q1 · decide q1$/m);
  assert.match(text.out, /^choice: sqlite \(label sqlite\)$/m);
  assert.match(text.out, new RegExp('^answeredAt: ' + a.answeredAt + '$', 'm'));
  assert.match(text.out, /^operator_id: neelo@test$/m);
  assert.match(text.out, /^sig_valid: true$/m);
  assert.doesNotMatch(text.out, /^reason:/m);

  const js = await verify(d, id, 'q1', '--json');
  assert.equal(js.code, 0);
  const o = JSON.parse(js.out);
  assert.deepEqual(
    { sheet: o.sheet, title: o.title, qid: o.qid, decision: o.decision, choice: o.choice, label: o.choice_label, at: o.answered_at, op: o.operator_id, valid: o.sig_valid, reason: o.reason },
    { sheet: id, title: 'the signing lane', qid: 'q1', decision: 'decide q1', choice: 'sqlite', label: 'label sqlite', at: a.answeredAt, op: 'neelo@test', valid: true, reason: null }
  );

  // Unanswered, unknown question, unknown sheet, usage.
  const open = await verify(d, id, 'q2');
  assert.equal(open.code, 1);
  assert.match(open.out, /^sig_valid: false$/m);
  assert.match(open.out, /^reason: unanswered$/m);
  assert.equal((await verify(d, id, 'q9')).code, 2);
  assert.equal((await verify(d, 'ub-deadbeef', 'q1')).code, 2);
  assert.equal((await verify(d, id)).code, 2);
  assert.equal((await verify(d, id, 'q1', '--bogus')).code, 2);
  assert.equal((await verify({ base: 'http://127.0.0.1:1' }, id, 'q1')).code, 2, 'deck unreachable');
});

// --- d, e, f. fleet.db is writable by every agent on this Mac; the signature is what it cannot forge.

const { DatabaseSync } = require('node:sqlite');
function dbRun(d, sql, ...args) {
  const db = new DatabaseSync(d.db);
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}

test('a choice rewritten in fleet.db reads sigValid false, and the CLI refuses it', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  await d.signin();
  assert.equal((await d.put('/' + id + '/answers/q1', { choice: 'sqlite' })).body.sigValid, true);
  const r = dbRun(d, "UPDATE unblock_answers SET choice = 'pg', choice_label = 'label pg' WHERE sheet_id = ? AND qid = 'q1'", id);
  assert.equal(r.changes, 1);

  const a = (await d.get('/' + id)).body.answers.q1;
  assert.equal(a.choice, 'pg');
  assert.equal(a.sigValid, false);
  const cli = await verify(d, id, 'q1');
  assert.equal(cli.code, 1, cli.out + cli.err);
  assert.match(cli.out, /^sig_valid: false$/m);
  assert.match(cli.out, /^reason: invalid$/m);
});

test('a signature copied onto another sheet with the same questions reads sigValid false', async (t) => {
  const d = await deck(t);
  const a = await d.create({ title: 'sheet A' });
  const b = await d.create({ title: 'sheet B' });
  await d.signin();
  assert.equal((await d.put('/' + a + '/answers/q1', { choice: 'pg' })).body.sigValid, true);
  // The attacker's copy: every signed field of A's row, planted as B's answer.
  dbRun(
    d,
    `INSERT INTO unblock_answers (sheet_id, qid, choice, choice_label, answered_at, note, operator_id, answer_sig)
     SELECT ?, qid, choice, choice_label, answered_at, '', operator_id, answer_sig
     FROM unblock_answers WHERE sheet_id = ? AND qid = 'q1'`,
    b, a
  );
  const copied = (await d.get('/' + b)).body.answers.q1;
  assert.equal(copied.choice, 'pg');
  assert.equal(copied.sig, (await d.get('/' + a)).body.answers.q1.sig, 'the very same signature');
  assert.equal(copied.sigValid, false);
  const cli = await verify(d, b, 'q1');
  assert.equal(cli.code, 1);
  assert.match(cli.out, /^reason: invalid$/m);
  assert.equal((await d.get('/' + a)).body.answers.q1.sigValid, true, 'the original is untouched');
  assert.equal((await verify(d, a, 'q1')).code, 0);
});

test('the signed string is injective: a | inside a qid or key cannot shift a field boundary', async (t) => {
  // Naive join: 'q|x' + 'y' and 'q' + 'x|y' both read 'q|x|y'. The two sheets below are built so a
  // bare `sheetId|qid|choice|...` join would give their rows the same MAC.
  const d = await deck(t);
  const id = await d.create({
    questions: [question('q|x', 'y', 'z'), question('q', 'x|y', 'z')],
  });
  await d.signin();
  const put = await d.put('/' + id + '/answers/' + encodeURIComponent('q|x'), { choice: 'y' });
  assert.equal(put.body.sigValid, true);
  // Move the signed fields onto the other split: same concatenation, different meaning.
  dbRun(
    d,
    `INSERT INTO unblock_answers (sheet_id, qid, choice, choice_label, answered_at, note, operator_id, answer_sig)
     SELECT sheet_id, 'q', 'x|y', 'label x|y', answered_at, '', operator_id, answer_sig
     FROM unblock_answers WHERE sheet_id = ? AND qid = 'q|x'`,
    id
  );
  const answers = (await d.get('/' + id)).body.answers;
  assert.equal(answers['q|x'].sigValid, true);
  assert.equal(answers.q.sig, answers['q|x'].sig);
  assert.equal(answers.q.sigValid, false);

  // And directly: the MAC function itself tells the two splits apart.
  const s = auth.createOperatorAuth({ secret: auth.loadDeckSecret(await secretText()), allowedOrigins: new Set() });
  const f = { sheetId: 'ub-1', choice: 'c', answeredAt: 'now', operatorId: 'op' };
  const sig = s.signAnswer({ ...f, qid: 'q|x' });
  assert.equal(s.answerSigValid({ ...f, qid: 'q|x', sig }), true);
  assert.equal(s.answerSigValid({ ...f, sheetId: 'ub-1|q', qid: 'x', sig }), false);
  for (const bad of [null, undefined, 42, sig.toUpperCase(), sig.slice(1), sig + '0'])
    assert.equal(s.answerSigValid({ ...f, qid: 'q|x', sig: bad }), false, String(bad));
  assert.equal(s.answerSigValid({ ...f, qid: 'q|x', operatorId: null, sig }), false);
});

// --- g. unconfigured: today's Origin gate, and every answer honestly unsigned

test('an unconfigured deck keeps the Origin gate, signs nothing and says so', async (t) => {
  const d = await deck(t, { secret: false });
  assert.deepEqual((await d.session()).body, { configured: false, signedIn: false, operatorId: null, expiresAt: null });
  const signin = await d.signin();
  assert.equal(signin.status, 409);
  assert.deepEqual(signin.body, { error: 'sign-in not configured' });
  assert.equal(signin.setCookie.length, 0);

  const id = await d.create();
  const put = await d.put('/' + id + '/answers/q1', { choice: 'sqlite' });
  assert.equal(put.status, 200);
  assert.deepEqual({ op: put.body.operatorId, sig: put.body.sig, valid: put.body.sigValid }, { op: null, sig: null, valid: false });
  assert.equal((await d.act('/' + id + '/close')).status, 200);
  assert.equal((await d.act('/' + id + '/reopen')).status, 200);
  assert.equal((await d.put('/' + id + '/answers/q1', { choice: 'pg' }, { origin: 'http://evil.example' })).status, 403);

  const cli = await verify(d, id, 'q1');
  assert.equal(cli.code, 1);
  assert.match(cli.out, /^operator_id: -$/m);
  assert.match(cli.out, /^reason: unsigned$/m);
});

test('an old fleet.db gains the two signing columns', async (t) => {
  const dir = tmpdir('signing-legacy');
  const file = path.join(dir, 'fleet.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE unblock_answers (sheet_id TEXT, qid TEXT, choice TEXT, choice_label TEXT, answered_at TEXT,
    note TEXT NOT NULL DEFAULT '', note_at TEXT, sent_sig TEXT, sent_at TEXT, PRIMARY KEY (sheet_id, qid))`);
  old.close();
  const m = load({ FLEET_DB: file, FLEET_HOSTS_FILE: hostsFile(dir), FLEET_DECK_SECRET_FILE: '' });
  t.after(() => unload(m));
  const cols = m.db.prepare('PRAGMA table_info(unblock_answers)').all().map((c) => c.name);
  assert.ok(cols.includes('operator_id') && cols.includes('answer_sig'), cols.join(','));
});

// --- h. a secret that is set but unusable stops the deck; it never comes up quietly unsigned

// server.js as a child that binds nothing: it exits by itself once loaded, or on the secret check.
// Bounded by a kill timer (macOS has no `timeout`), and fd 3 optionally carries the secret the way
// up.sh hands it over.
function bootChild(env, fd3) {
  const dir = tmpdir('signing-boot');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: {
        ...process.env,
        FLEET_NO_LISTEN: '1',
        FLEET_NO_REAPER: '1',
        FLEET_DB: path.join(dir, 'fleet.db'),
        FLEET_HOSTS_FILE: hostsFile(dir),
        CLAUDE_SESSIONS_DIR: path.join(dir, 'no-desktop-sessions'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe', ...(fd3 === undefined ? [] : ['pipe'])],
    });
    if (fd3 !== undefined) child.stdio[3].end(fd3);
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out });
    });
  });
}

test('a set-but-broken FLEET_DECK_SECRET_FILE stops the deck with a secret-free line', async () => {
  const dir = tmpdir('signing-broken');
  const garbage = path.join(dir, 'garbage.json');
  // Broken JSON that still carries the key: JSON.parse would quote it back in its message.
  fs.writeFileSync(garbage, '{"version":1,"hmacKey":"' + KEY + '",', { mode: 0o600 });
  const wrongShape = path.join(dir, 'wrong-shape.json');
  fs.writeFileSync(wrongShape, await secretText({ operatorId: 'has space' }), { mode: 0o600 });
  for (const file of [garbage, wrongShape, path.join(dir, 'missing.json')]) {
    const r = await bootChild({ FLEET_DECK_SECRET_FILE: file });
    assert.equal(r.signal, null, 'exited by itself, not by the kill timer');
    assert.notEqual(r.code, 0, path.basename(file));
    assert.match(r.out, /deck: FLEET_DECK_SECRET_FILE unusable .* refusing to start/);
    assert.ok(!r.out.includes(KEY.slice(0, 16)) && !r.out.includes((await HASH).split('$')[5]), r.out);
  }
});

test('the secret arrives on /dev/fd/3 the way up.sh hands it over, and an unset one says OFF', async () => {
  const on = await bootChild({ FLEET_DECK_SECRET_FILE: '/dev/fd/3' }, await secretText());
  assert.equal(on.code, 0, on.out);
  assert.match(on.out, /deck: operator sign-in ON for neelo@test/);
  assert.ok(!on.out.includes(KEY.slice(0, 16)));

  const empty = await bootChild({ FLEET_DECK_SECRET_FILE: '/dev/fd/3' }, '');
  assert.notEqual(empty.code, 0, 'an empty fd 3 (sudo refused mid-launch) is a broken secret');

  const off = await bootChild({ FLEET_DECK_SECRET_FILE: '' });
  assert.equal(off.code, 0, off.out);
  assert.match(off.out, /deck: operator sign-in OFF \(FLEET_DECK_SECRET_FILE unset\) — unblock answers are unsigned/);
});

// --- i. nothing the deck answers carries the key or the hash

test('no response body or header carries the hmacKey or the password hash', async (t) => {
  const d = await deck(t);
  const hash = await HASH;
  const needles = [KEY, KEY.toUpperCase(), Buffer.from(KEY, 'hex').toString('base64'), hash, ...hash.split('$').slice(4)];
  const id = await d.create();
  const seen = [
    await d.session(),
    await d.signin('wrong password here'),
    await d.signin(),
    await d.session(),
    await d.put('/' + id + '/answers/q1', { choice: 'sqlite', note: 'n' }),
    await d.get('/' + id),
    await d.get(),
    await d.signout(),
  ];
  for (const r of seen) {
    const text = JSON.stringify([r.headers, r.setCookie, r.body]);
    for (const n of needles) assert.ok(!text.includes(n), 'leak in ' + text.slice(0, 200));
  }
});

test('the tailnet listener has no /api/operator and no unblock writes', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  // Real HTTP to the second listener, Host set to what that listener accepts.
  const tail = (method, p, b) =>
    fetch('http://' + process.env.FLEET_TAILNET_HOST + p, {
      method,
      headers: { 'content-type': 'application/json', origin: d.origin },
      ...(b ? { body: JSON.stringify(b) } : {}),
    }).then((r) => r.status);
  assert.equal(await tail('GET', '/api/operator/session'), 404);
  assert.equal(await tail('POST', '/api/operator/signin', { password: PASSWORD }), 404);
  assert.equal(await tail('PUT', '/api/unblock/' + id + '/answers/q1', { choice: 'sqlite' }), 404);
  assert.equal(await tail('GET', '/api/unblock/' + id), 404);
});

// --- the PUT rules behind the signature

test('only a fresh click signs; note and label edits keep the signature; clearing drops it', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  await d.signin();
  const put = (b) => d.put('/' + id + '/answers/q1', b).then((r) => r.body);
  const first = await put({ choice: 'sqlite' });
  assert.equal(first.sigValid, true);

  const noted = await put({ note: 'ask the DBA' });
  const labelled = await put({ choiceLabel: 'sqlite (v2)' });
  const same = await put({ choice: 'sqlite' });
  for (const r of [noted, labelled, same])
    assert.deepEqual({ sig: r.sig, op: r.operatorId, at: r.answeredAt, valid: r.sigValid }, { sig: first.sig, op: first.operatorId, at: first.answeredAt, valid: true });

  // A row answered before sign-in existed: the same choice clicked again now gets signed.
  dbRun(d, "UPDATE unblock_answers SET operator_id = NULL, answer_sig = NULL WHERE sheet_id = ? AND qid = 'q1'", id);
  assert.equal((await d.get('/' + id)).body.answers.q1.sigValid, false);
  const resigned = await put({ choice: 'sqlite' });
  assert.equal(resigned.sigValid, true);
  assert.equal(resigned.operatorId, 'neelo@test');

  const cleared = await put({ choice: null });
  assert.deepEqual(
    [cleared.choice, cleared.choiceLabel, cleared.answeredAt, cleared.operatorId, cleared.sig, cleared.sigValid],
    [null, null, null, null, null, false]
  );
  assert.equal(cleared.note, 'ask the DBA', 'clearing the choice leaves the note');
});
