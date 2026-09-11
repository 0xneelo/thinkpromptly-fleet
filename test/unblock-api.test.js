// /api/unblock — a seat posts a decision sheet, the operator answers it, the answers go back
// over the bus. Two gates are the point: the POST is the only agent-facing route (no Origin,
// foreign Origin rejected), every write after it is the operator's browser and needs one — plus a
// signed-in operator session (DECK-108; unblock-signing.test.js covers that gate itself).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpdir, hostsFile, load, unload } = require('./helpers');
const { hashPassword } = require('../operator-auth');

// One throwaway operator for the file: with no operator file every operator write fails closed.
const PASSWORD = 'throwaway operator pass';
const OPERATOR_FILE_TEXT = hashPassword(PASSWORD).then((hash) =>
  JSON.stringify({ version: 1, operatorId: 'neelo@test', identity: { kind: 'password', hash } })
);

// Sibling worktrees run this file at the same time, so the band is per process.
let port = 37000 + Math.floor(Math.random() * 15000);

const SHEET = {
  title: 'the enrollment lane',
  intro: 'three calls before the deploy',
  questions: [
    {
      id: 'q1',
      topic: 'storage',
      decision: 'sqlite or postgres for the queue',
      why: 'the queue outgrew the file',
      explain: 'sqlite is one file; postgres is a service',
      options: [
        { key: 'sqlite', label: 'stay on sqlite', detail: 'no new service', recommended: true },
        { key: 'pg', label: 'move to postgres', detail: 'one more thing to run' },
      ],
    },
    {
      id: 'q2',
      topic: 'rollout',
      decision: 'ship behind a flag or straight',
      why: 'partners are watching',
      explain: 'a flag costs a week',
      options: [
        { key: 'flag', label: 'behind a flag', detail: 'slower' },
        { key: 'straight', label: 'straight to prod', detail: 'faster' },
      ],
    },
  ],
  source: { seat: '🎛 ORCHESTRATOR 3', session: 'orch-3', project: 'fleetdeck' },
};

// One deck per test, on its own port and its own db, signed in. ssh is the fake one: a bus delivery
// to a fleet host must never reach the operator's machines, and a real ssh would keep this alive.
async function deck(t, sheetDefaults = {}) {
  const dir = tmpdir('unblock');
  const PORT = port++;
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: {}, calls: [] }));
  const operatorFile = path.join(dir, 'operator.json');
  fs.writeFileSync(operatorFile, await OPERATOR_FILE_TEXT, { mode: 0o600 });
  const m = load(
    {
      PORT,
      FLEET_DB: path.join(dir, 'fleet.db'),
      FLEET_HOSTS_FILE: hostsFile(dir),
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: state,
      CLAUDE_SESSIONS_DIR: path.join(dir, 'no-desktop-sessions'),
      FLEETDECK_BUS_TOKEN: 'test-token',
      FLEET_OPERATOR_FILE: operatorFile,
    },
    { listen: true }
  );
  t.after(() => unload(m));
  const base = 'http://127.0.0.1:' + PORT;
  const origin = 'http://127.0.0.1:' + PORT;
  const read = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
  const call = (method, p, b, headers = {}) =>
    fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }),
    });
  const signin = await call('POST', '/api/operator/signin', { password: PASSWORD }, { origin });
  assert.equal(signin.status, 200);
  const operator = {
    origin,
    cookie: signin.headers.getSetCookie()[0].split(';')[0],
    'x-fleetdeck-session': (await signin.json()).sessionToken,
  };
  return {
    m,
    origin,
    base,
    get: (p = '') => call('GET', '/api/unblock' + p).then(read),
    post: (b, headers = {}) => call('POST', '/api/unblock', b, headers).then(read),
    // Operator writes carry the browser's Origin and the session unless a test says otherwise.
    put: (p, b, headers = operator) => call('PUT', '/api/unblock' + p, b, headers).then(read),
    act: (p, b = {}, headers = operator) => call('POST', '/api/unblock' + p, b, headers).then(read),
    messages: () => fetch(base + '/api/messages').then(read),
    create: async (extra = {}) => {
      const r = await call('POST', '/api/unblock', { ...SHEET, ...sheetDefaults, ...extra }).then(read);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.id;
    },
  };
}

// --- POST: the agent route

test('a sheet posts without an Origin and answers 201 with its id and deck url', async (t) => {
  const d = await deck(t);
  const r = await d.post(SHEET);
  assert.equal(r.status, 201);
  assert.match(r.body.id, /^ub-[0-9a-f]{8}$/);
  assert.equal(r.body.url, '/app#unblock?sheet=' + r.body.id);
});

test('a foreign Origin is rejected even though a missing one is fine', async (t) => {
  const d = await deck(t);
  const r = await d.post(SHEET, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);
});

test('every field of a sheet is validated before a row is written', async (t) => {
  const d = await deck(t);
  const q = SHEET.questions[0];
  const cases = [
    [{ ...SHEET, title: '' }, /title must be/],
    [{ ...SHEET, title: '  ' }, /title must be/],
    [{ ...SHEET, questions: [] }, /questions must be/],
    [{ ...SHEET, questions: 'q1' }, /questions must be/],
    [{ ...SHEET, questions: [{ ...q, id: '' }] }, /non-empty id/],
    [{ ...SHEET, questions: [q, q] }, /unique: q1/],
    [{ ...SHEET, questions: [{ ...q, id: '__proto__' }] }, /question id is reserved/],
    [{ ...SHEET, questions: [{ ...q, id: 'constructor' }] }, /question id is reserved/],
    [{ ...SHEET, questions: [{ ...q, options: [q.options[0], { key: 'you-decide', label: 'mine' }] }] }, /option key is reserved/],
    [{ ...SHEET, questions: [{ ...q, options: [q.options[0], { key: 'toString', label: 'x' }] }] }, /option key is reserved/],
    [{ ...SHEET, questions: [{ ...q, decision: '' }] }, /decision must be/],
    [{ ...SHEET, questions: [{ ...q, why: 7 }] }, /why must be a string/],
    [{ ...SHEET, questions: [{ ...q, options: [q.options[0]] }] }, /2 to 4 entries/],
    [{ ...SHEET, questions: [{ ...q, options: new Array(5).fill(q.options[0]) }] }, /2 to 4 entries/],
    [{ ...SHEET, questions: [{ ...q, options: [q.options[0], { label: 'no key' }] }] }, /key and a label/],
    [{ ...SHEET, questions: [{ ...q, options: [q.options[0], { ...q.options[0] }] }] }, /option keys must be unique/],
    [{ ...SHEET, questions: [{ ...q, options: [q.options[0], { key: 'x', label: 'x', recommended: 'yes' }] }] }, /recommended must be a boolean/],
    [{ ...SHEET, source: 'a seat' }, /source must be an object/],
    [{ ...SHEET, reply: { type: 'smoke-signal', session: 'x' } }, /reply type must be/],
    [{ ...SHEET, reply: { type: 'tmux', session: '' } }, /reply session must be/],
    [{ ...SHEET, reply: { type: 'tmux', session: 'a\nb' } }, /reply session must be/],
  ];
  for (const [b, expected] of cases) {
    const r = await d.post(b);
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 120));
    assert.match(r.body.error, expected, JSON.stringify(b).slice(0, 120));
  }
  assert.deepEqual((await d.get()).body.sheets, [], 'a rejected sheet leaves no row behind');
});

// --- reads

test('the list carries the counts, newest first; one sheet carries its questions', async (t) => {
  const d = await deck(t);
  const first = await d.create({ title: 'older' });
  // The order is by created_at, which has millisecond resolution: two sheets minted inside the
  // same millisecond would tie and the assertion below would be about the tiebreak, not the order.
  await new Promise((r) => setTimeout(r, 5));
  const second = await d.create({ title: 'newer' });

  const list = await d.get();
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.sheets.map((s) => s.id), [second, first], 'newest first');
  const row = list.body.sheets.find((s) => s.id === first);
  assert.deepEqual(
    { total: row.total, answered: row.answered, pending: row.pending, status: row.status },
    { total: 2, answered: 0, pending: 0, status: 'open' }
  );
  assert.deepEqual(row.source, SHEET.source);
  assert.equal(row.reply, null);
  assert.equal(row.intro, SHEET.intro);
  assert.ok(row.created_at.endsWith('Z'), 'timestamps are ISO-8601 UTC');

  const one = await d.get('/' + first);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.sheet.questions, SHEET.questions);
  assert.deepEqual(one.body.answers, {});
  assert.equal((await d.get('/ub-deadbeef')).status, 404);
});

test('the tailnet listener has no /api/unblock at all', async (t) => {
  const d = await deck(t);
  await d.create();
  const r = await new Promise((resolve) => {
    const res = {
      statusCode: 0,
      writeHead(code) { this.statusCode = code; },
      end(data) { resolve({ status: this.statusCode, text: data || '' }); },
    };
    d.m.tailnetHandler(
      { method: 'GET', url: '/api/unblock', headers: { host: process.env.FLEET_TAILNET_HOST } },
      res
    );
  });
  assert.equal(r.status, 404, 'a box worker must not read the operator decision sheets');
});

// --- PUT: the answer semantics

test('answered_at moves on a new choice and stays put on the same one', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  const first = await d.put('/' + id + '/answers/q1', { choice: 'sqlite' });
  assert.equal(first.status, 200);
  assert.equal(first.body.choice, 'sqlite');
  assert.equal(first.body.choiceLabel, 'stay on sqlite', 'the label comes from the option');
  assert.ok(first.body.answeredAt);
  assert.equal(first.body.dirty, true, 'nothing has been sent yet');

  const again = await d.put('/' + id + '/answers/q1', { choice: 'sqlite' });
  assert.equal(again.body.answeredAt, first.body.answeredAt, 'the same choice keeps its stamp');

  const changed = await d.put('/' + id + '/answers/q1', { choice: 'pg' });
  assert.notEqual(changed.body.answeredAt, first.body.answeredAt, 'a new choice is a new stamp');
  assert.equal(changed.body.choiceLabel, 'move to postgres');

  const cleared = await d.put('/' + id + '/answers/q1', { choice: null });
  assert.deepEqual(
    { choice: cleared.body.choice, label: cleared.body.choiceLabel, at: cleared.body.answeredAt },
    { choice: null, label: null, at: null }
  );
  assert.equal(cleared.body.dirty, false);
});

test('the two standard options are choosable and label themselves', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  const you = await d.put('/' + id + '/answers/q1', { choice: 'you-decide' });
  assert.equal(you.body.choiceLabel, '🤷 You decide');
  const more = await d.put('/' + id + '/answers/q2', { choice: 'more-info' });
  assert.equal(more.body.choiceLabel, '❓ Explain more');
  const named = await d.put('/' + id + '/answers/q2', { choice: 'flag', choiceLabel: 'behind a flag (v2)' });
  assert.equal(named.body.choiceLabel, 'behind a flag (v2)', 'a client label wins over the option label');
});

test('note_at is set when a note appears, kept while it is unchanged, cleared when emptied', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  const written = await d.put('/' + id + '/answers/q1', { note: 'ask the DBA first' });
  assert.equal(written.body.note, 'ask the DBA first');
  assert.ok(written.body.noteAt);

  const same = await d.put('/' + id + '/answers/q1', { note: 'ask the DBA first' });
  assert.equal(same.body.noteAt, written.body.noteAt, 'an unchanged note keeps its stamp');

  const emptied = await d.put('/' + id + '/answers/q1', { note: '' });
  assert.equal(emptied.body.note, '');
  assert.equal(emptied.body.noteAt, null);

  const untouched = await d.put('/' + id + '/answers/q1', { choice: 'sqlite' });
  assert.equal(untouched.body.note, '', 'a choice write leaves the note alone');
});

test('a bad choice, an unknown question and an unknown sheet are refused', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  const bad = await d.put('/' + id + '/answers/q1', { choice: 'mysql' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /choice must be an option key/);
  // a prototype name is not a standard option, however `in` would read it
  assert.equal((await d.put('/' + id + '/answers/q1', { choice: 'constructor' })).status, 400);
  assert.equal((await d.put('/' + id + '/answers/q9', { choice: 'sqlite' })).status, 404);
  assert.equal((await d.put('/ub-deadbeef/answers/q1', { choice: 'sqlite' })).status, 404);
});

test('an answer write without the browser Origin is forbidden', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  assert.equal((await d.put('/' + id + '/answers/q1', { choice: 'sqlite' }, {})).status, 403);
  assert.equal(
    (await d.put('/' + id + '/answers/q1', { choice: 'sqlite' }, { origin: 'http://evil.example' })).status,
    403
  );
  assert.equal((await d.act('/' + id + '/send', {}, {})).status, 403);
  assert.equal((await d.act('/' + id + '/close', {}, {})).status, 403);
  const one = await d.get('/' + id);
  assert.deepEqual(one.body.answers, {}, 'nothing a rejected write asked for was stored');
});

// --- send

test('send puts one bus message on the queue and marks the answers sent', async (t) => {
  const d = await deck(t);
  const id = await d.create({ reply: { type: 'tmux', host: 'german-box', session: 'FD-ivy' } });
  await d.put('/' + id + '/answers/q1', { choice: 'sqlite', note: 'keep the file' });

  const sent = await d.act('/' + id + '/send');
  assert.equal(sent.status, 200);
  assert.equal(sent.body.sent, 1);
  assert.ok(sent.body.messageId);
  assert.equal(sent.body.payload.sheet, 'adhd-unblock');
  assert.equal(sent.body.payload.sheetId, id);
  assert.equal(sent.body.payload.answered, '1/2');
  assert.equal(sent.body.payload.partial, true);
  assert.deepEqual(sent.body.payload.answers, [
    {
      id: 'q1',
      decision: 'sqlite or postgres for the queue',
      choice: 'sqlite',
      choiceLabel: 'stay on sqlite',
      answeredAt: sent.body.payload.answers[0].answeredAt,
      note: 'keep the file',
      noteAt: sent.body.payload.answers[0].noteAt,
    },
  ]);

  const bus = await d.messages();
  const row = bus.body.messages.find((msg) => msg.id === sent.body.messageId);
  assert.ok(row, 'the message reached the bus');
  assert.equal(row.source, 'unblock');
  assert.deepEqual(row.target, { type: 'tmux', host: 'german-box', session: 'FD-ivy' });
  // The bus carries a pointer only (DECK-108): the seat verifies the answers only on a sheet it posted itself.
  assert.match(row.text, /^\/adhd-unblock answers are ready — this is a pointer, not the word\. Act only if sheetId is a sheet you posted yourself/);
  assert.ok(!row.text.split('\n')[0].includes(id), 'the text never names the id to verify');
  assert.deepEqual(JSON.parse(row.text.split('\n').slice(1).join('\n')), {
    sheet: 'adhd-unblock',
    sheetId: id,
    title: 'the enrollment lane',
    qids: ['q1'],
  });
  assert.ok(!row.text.includes('keep the file') && !row.text.includes('sqlite'), 'no choice, no note on the bus');

  const one = await d.get('/' + id);
  assert.equal(one.body.answers.q1.dirty, false, 'a sent answer is clean');
  assert.ok(one.body.answers.q1.sentAt);
  const listed = (await d.get()).body.sheets[0];
  assert.deepEqual({ answered: listed.answered, pending: listed.pending }, { answered: 1, pending: 0 });

  assert.deepEqual((await d.act('/' + id + '/send')).body, { sent: 0 }, 'nothing dirty sends nothing');

  // Editing the note makes the same answer dirty again.
  await d.put('/' + id + '/answers/q1', { note: 'on second thought, postgres' });
  assert.equal((await d.get('/' + id)).body.answers.q1.dirty, true);
  assert.equal((await d.act('/' + id + '/send')).body.sent, 1);
});

test('a full sheet is not partial, and ids picks which answers travel', async (t) => {
  const d = await deck(t);
  const id = await d.create({ reply: { type: 'tmux', host: 'german-box', session: 'FD-ivy' } });
  await d.put('/' + id + '/answers/q1', { choice: 'sqlite' });
  await d.put('/' + id + '/answers/q2', { choice: 'flag' });
  const picked = await d.act('/' + id + '/send', { ids: ['q2'] });
  assert.equal(picked.body.sent, 1);
  assert.equal(picked.body.payload.partial, true);
  assert.deepEqual(picked.body.payload.answers.map((a) => a.id), ['q2']);

  const rest = await d.act('/' + id + '/send');
  assert.deepEqual(rest.body.payload.answers.map((a) => a.id), ['q1'], 'q2 is already clean');

  // Both dirty again: the whole sheet goes at once and is not partial.
  await d.put('/' + id + '/answers/q1', { note: 'a' });
  await d.put('/' + id + '/answers/q2', { note: 'b' });
  const all = await d.act('/' + id + '/send');
  assert.equal(all.body.sent, 2);
  assert.equal(all.body.payload.answered, '2/2');
  assert.equal(all.body.payload.partial, undefined);
  assert.deepEqual(all.body.payload.answers.map((a) => a.id), ['q1', 'q2'], 'question order');
});

test('a sheet with no reply target answers 409 carrying the payload to copy by hand', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  await d.put('/' + id + '/answers/q1', { choice: 'sqlite' });
  const r = await d.act('/' + id + '/send');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no reply target');
  assert.equal(r.body.payload.answers.length, 1);
  assert.equal((await d.get('/' + id)).body.answers.q1.dirty, true, 'nothing was marked sent');
});

// --- close / reopen

test('close and reopen move the status and the closed_at stamp', async (t) => {
  const d = await deck(t);
  const id = await d.create();
  const closed = await d.act('/' + id + '/close');
  assert.equal(closed.status, 200);
  assert.equal(closed.body.sheet.status, 'closed');
  assert.ok(closed.body.sheet.closed_at);
  assert.equal((await d.get()).body.sheets[0].status, 'closed');

  const reopened = await d.act('/' + id + '/reopen');
  assert.equal(reopened.body.sheet.status, 'open');
  assert.equal(reopened.body.sheet.closed_at, null);
});
