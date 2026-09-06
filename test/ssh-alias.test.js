// XYZ-1904 — a host's fleet NAME and its ssh DESTINATION are two different things.
//
// `Host german-box` in the operator's ~/.ssh/config authenticates through the 1Password SSH
// agent, so every ~20s poll after a 1Password relock fired an authorization popup at them.
// The deck now dials the box through the `gb-deploy` alias instead: the same host and user,
// reached with a short-lived deploy cert and `IdentityAgent none`. Nothing else may move —
// the name in the DB, the API and the UI is still `german-box`.
//
// This file is the guard on that split. Without it a refactor could quietly put the fleet
// name back in the argv and the popup would return with every test still green.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./http');
const { tmpdir } = require('./helpers');

const FAKE_SSH = path.join(__dirname, 'fake-ssh.js');

// The fixture keys its fleet by the destination it was invoked with, so a state file that
// only knows `gb-deploy` answers nothing at all if the deck dials `german-box`.
async function deck(t, hosts, fleet) {
  const dir = tmpdir('ssh-alias');
  const state = path.join(dir, 'ssh-state.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: fleet, calls: [] }, null, 2));
  const s = await startServer(
    { FLEET_SSH_BIN: FAKE_SSH, FLEET_FAKE_SSH_STATE: state },
    { dir, hosts }
  );
  t.after(() => s.stop());
  s.state = () => JSON.parse(fs.readFileSync(state, 'utf8'));
  s.patch = (fn) => {
    const v = s.state();
    fn(v);
    fs.writeFileSync(state, JSON.stringify(v, null, 2));
  };
  return s;
}

const dialled = (s) => [...new Set(s.state().calls.map((c) => c.host))].sort();

test('an aliased entry is dialled by its alias and still reported by its fleet name', async (t) => {
  const s = await deck(
    t,
    [{ name: 'german-box', ssh: 'gb-deploy' }],
    { 'gb-deploy': { sessions: { 'EDITH-T-alias': { activity: 'now', created: 'now' } } } }
  );

  const r = await s.get('/api/sessions');
  assert.equal(r.status, 200, s.log());
  assert.deepEqual(r.body.errors, [], 'the alias answered, so nothing is unreachable: ' + s.log());

  // The whole point: the argv carries the alias, never the fleet name.
  assert.deepEqual(dialled(s), ['gb-deploy'], 'the deck must never dial the 1Password route');

  const row = r.body.sessions.find((x) => x.name === 'EDITH-T-alias');
  assert.ok(row, 'the session came back: ' + s.log());
  assert.equal(row.host, 'german-box', 'the fleet name is what the DB, the API and the UI see');
});

test('a plain string entry is still dialled by its own name', async (t) => {
  const s = await deck(
    t,
    ['german-box'],
    { 'german-box': { sessions: { 'EDITH-T-plain': { activity: 'now', created: 'now' } } } }
  );

  const r = await s.get('/api/sessions');
  assert.equal(r.status, 200, s.log());
  assert.deepEqual(dialled(s), ['german-box'], 'no alias configured means no rewrite');
  assert.ok(r.body.sessions.some((x) => x.name === 'EDITH-T-plain'), s.log());
});

test('a rejected deploy cert logs the mint fix once, not once per poll', async (t) => {
  const s = await deck(t, [{ name: 'german-box', ssh: 'gb-deploy' }], {
    'gb-deploy': { authFail: true, sessions: {} },
  });

  for (let i = 0; i < 4; i++) assert.equal((await s.get('/api/sessions')).status, 200, s.log());

  const hits = (s.log().match(/mint-deploy-cert\.sh/g) || []).length;
  assert.equal(hits, 1, 'four polls, one line — a 20s poll must not flood deck.log:\n' + s.log());
  assert.match(s.log(), /german-box via gb-deploy/, 'the line names both the host and the route');
  assert.match(s.log(), /no 1Password fallback/, 'and says the old route is not a way out');

  // It re-arms: once the host answers again, the next failure is worth saying out loud.
  s.patch((v) => {
    v.hosts['gb-deploy'].authFail = false;
    v.hosts['gb-deploy'].sessions = { 'EDITH-T-back': { activity: 'now', created: 'now' } };
  });
  assert.equal((await s.get('/api/sessions')).status, 200, s.log());
  s.patch((v) => (v.hosts['gb-deploy'].authFail = true));
  assert.equal((await s.get('/api/sessions')).status, 200, s.log());

  assert.equal(
    (s.log().match(/mint-deploy-cert\.sh/g) || []).length,
    2,
    'a recovery re-arms the warning:\n' + s.log()
  );
});

test('an unreachable host is not a verdict on the cert', async (t) => {
  const s = await deck(t, [{ name: 'german-box', ssh: 'gb-deploy' }], {
    'gb-deploy': { pollFail: true, sessions: {} },
  });

  const r = await s.get('/api/sessions');
  assert.equal(r.status, 200, s.log());
  assert.equal(r.body.errors.length, 1, 'the host is reported unreachable: ' + s.log());
  assert.doesNotMatch(
    s.log(),
    /mint-deploy-cert\.sh/,
    'a TCP timeout must not be blamed on the cert:\n' + s.log()
  );
});
