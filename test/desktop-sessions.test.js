const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DesktopSessions, sessionRow } = require('../desktop-sessions');
const { tmpdir } = require('./helpers');
const { startServer } = require('./http');

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ORG = 'd24c4827-df47-40e3-af74-574418a03a4b';
const CLI = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-09-06T12:00:00Z');
const row = (changes = {}) => ({
  accountUuid: ACCOUNT, orgUuid: ORG, id: 'local_one', title: 'A session',
  cliSessionId: CLI, lastActivityAt: '2026-09-06T11:55:00.000Z', ...changes,
});
const output = (sessions = [row()], changes = {}) => ({
  err: null, stdout: JSON.stringify({ v: 1, state: 'ok', complete: true, skipped: 0, sessions, ...changes }),
});
const mac = { id: 'macbook', host: 'mac', label: 'MacBook Pro', route: 'local', desktop_sessions: true };
const german = { id: 'german-box', host: 'german-box', label: 'german-box', route: 'ssh', ssh: 'gb-deploy', wsl: true, desktop_sessions: true };

function storeFixture(t, machines = [mac]) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let now = NOW, replies = new Map(machines.map((m) => [m.id, output()])), calls = 0;
  const accounts = { orgs: { [ORG]: { label: 'Aylin Yeter', email: 'example@example.invalid' } } };
  const store = new DesktopSessions({
    db, config: () => machines, accounts: () => accounts, ttl: 1000, clock: () => now,
    collect: async (machine) => { calls++; return replies.get(machine.id); },
  });
  return { store, db, machines, accounts, calls: () => calls, advance: (ms) => { now += ms; },
    reply: (value, id = mac.id) => replies.set(id, value) };
}

test('desktop sessions writer projects metadata fields and canonical identities', () => {
  const r = sessionRow(row({ extra: { private: 'ignored-field' }, model: { name: 'bad type' },
    completedTurns: -1, isArchived: 'true', createdAt: NOW, lastActivityAt: 'not-a-date' }));
  assert.deepEqual(Object.keys(r).sort(), ['accountUuid', 'orgUuid', 'id', 'title', 'cwd', 'worktree', 'branch', 'model',
    'createdAt', 'lastActivityAt', 'isArchived', 'completedTurns', 'cliSessionId'].sort());
  assert.equal(r.model, null);
  assert.equal(r.completedTurns, null);
  assert.equal(r.isArchived, false);
  assert.equal(r.createdAt, '2026-09-06T12:00:00.000Z');
  assert.equal(r.lastActivityAt, null);
  assert.equal(sessionRow(row({ id: '../config' })), null);
  assert.equal(sessionRow(row({ accountUuid: null })), null);
  assert.equal(sessionRow(row({ cliSessionId: 'not-a-uuid' })).cliSessionId, null);
});

test('desktop sessions groups four accounts and machines, joins live by CLI ID only', async (t) => {
  const f = storeFixture(t, [mac, german]);
  f.reply(output([1, 2, 3, 4].map((i) => row({ accountUuid: ACCOUNT.replace(/^1/, String(i)), cliSessionId: i === 1 ? CLI : null }))));
  await f.store.collect();
  const view = f.store.view([{ sessionId: CLI, name: 'Renamed live session' }]);
  assert.equal(view.groups.length, 5);
  const local = view.groups.find((g) => g.machine === mac.id && g.accountUuid === ACCOUNT);
  assert.equal(local.label, 'Aylin Yeter');
  assert.equal(local.sessions[0].live, true);
  assert.deepEqual(local.sessions[0].messageTarget, { type: 'claude-desktop', session: 'id:' + CLI });
  const remote = view.groups.find((g) => g.machine === german.id).sessions[0];
  assert.equal(remote.live, false, 'a copied ID on a remote machine must not borrow the Mac socket');
  assert.equal(remote.liveState, 'unknown');
  assert.equal(remote.messageTarget, null);
  assert.equal(f.store.view([{ sessionId: null, name: 'A session' }]).groups[0].sessions[0].live, false);
  f.accounts.orgs[ORG].label = 'Updated name';
  assert.equal(f.store.view().groups[0].label, 'Updated name', 'labels refresh without collection');
});

test('desktop sessions refreshes live badges within TTL and rejects ambiguous registry IDs', async (t) => {
  const f = storeFixture(t);
  await f.store.collect();
  assert.equal(f.store.view([{ sessionId: CLI, name: 'current' }]).groups[0].sessions[0].live, true);
  assert.equal(f.store.view().groups[0].sessions[0].live, false);
  const duplicate = f.store.view([{ sessionId: CLI, name: 'one' }, { sessionId: CLI, name: 'two' }]);
  assert.equal(duplicate.groups[0].sessions[0].messageTarget, null);
  await f.store.collect();
  assert.equal(f.calls(), 1);
  f.advance(1000);
  await f.store.collect();
  assert.equal(f.calls(), 2);
});

test('desktop sessions coalesces concurrent forced refreshes and never returns an empty first load', async (t) => {
  const f = storeFixture(t);
  let release;
  f.store.collectMachine = () => new Promise((resolve) => { release = resolve; });
  let completed = 0;
  const first = f.store.collect().then(() => completed++);
  const second = f.store.collect(true).then(() => completed++);
  await Promise.resolve();
  assert.equal(completed, 0);
  assert.equal(f.store.view().collecting, true);
  release(output());
  await Promise.all([first, second]);
  assert.equal(completed, 2);
  assert.equal(f.store.view().groups.length, 1);
  assert.equal(f.store.view().collecting, false);
});

test('desktop sessions retains cached rows and static errors through failure and TTL', async (t) => {
  const f = storeFixture(t);
  await f.store.collect();
  f.advance(500);
  f.reply({ err: new Error('ignored-diagnostic'), stdout: 'untrusted-output', stderr: 'untrusted-stderr' });
  await f.store.collect(true);
  const view = f.store.view();
  assert.equal(view.groups[0].sessions[0].title, 'A session');
  assert.equal(view.machines[0].collected_at, NOW);
  assert.equal(view.machines[0].state, 'unavailable');
  assert.equal(view.groups[0].sessions[0].stale, true);
  assert.equal(JSON.stringify(view).includes('untrusted'), false);
  await f.store.collect();
  assert.equal(f.calls(), 2);
  assert.equal(f.store.view().machines[0].state, 'unavailable');
});

test('desktop sessions partial scan keeps missing rows; a complete empty scan removes them', async (t) => {
  const f = storeFixture(t);
  f.reply(output([row(), row({ id: 'local_two' })]));
  await f.store.collect();
  f.reply(output([row({ title: 'Updated' })], { complete: false, skipped: 1 }));
  await f.store.collect(true);
  assert.equal(f.store.view().groups[0].sessions.length, 2);
  assert.equal(f.store.view().machines[0].state, 'partial');
  f.reply(output([], { state: 'not_found' }));
  await f.store.collect(true);
  assert.equal(f.store.view().groups[0].sessions.length, 2);
  f.reply(output([]));
  await f.store.collect(true);
  assert.deepEqual(f.store.view().groups, []);
  assert.equal(f.store.view().machines[0].state, 'ok');
});

test('desktop sessions rejects malformed reports, sanitizes stored rows, and hides removed machines', async (t) => {
  const f = storeFixture(t);
  await f.store.collect();
  f.reply(output(null));
  await f.store.collect(true);
  assert.equal(f.store.view().machines[0].state, 'unavailable');
  const payload = JSON.stringify(row({ extra: 'discard-on-read' }));
  f.db.prepare('UPDATE desktop_sessions SET payload = ?').run(payload);
  assert.equal(JSON.stringify(f.store.view()).includes('discard-on-read'), false);
  f.machines.splice(0);
  assert.deepEqual(f.store.view().groups, []);
  assert.deepEqual(f.store.view().machines, []);
});

async function routeFixture(t, machines = [mac, german]) {
  const dir = tmpdir('desktop-route');
  const config = path.join(dir, 'machines.json');
  const script = path.join(dir, 'collector.sh');
  const registry = path.join(dir, 'registry');
  const argv = path.join(dir, 'ssh-argv');
  fs.mkdirSync(registry);
  fs.writeFileSync(config, JSON.stringify({ machines }));
  const fixture = JSON.stringify({ v: 1, state: 'ok', complete: true, skipped: 0, sessions: [row()] });
  fs.writeFileSync(script, '#!/bin/sh\ncat <<\'FIXTURE\'\n' + fixture + '\nFIXTURE\n');
  const socket = path.join(dir, 'fixture.sock');
  fs.writeFileSync(socket, '');
  const entry = path.join(registry, process.pid + '.json');
  fs.writeFileSync(entry, JSON.stringify({ pid: process.pid, name: 'current', sessionId: CLI, messagingSocketPath: socket }));
  const server = await startServer({
    FLEET_MACHINES_FILE: config, FLEET_DESKTOP_SESSIONS_SH: script, CLAUDE_SESSIONS_DIR: registry,
    FLEET_SSH_BIN: path.join(__dirname, 'ssh-shim.sh'), FLEET_SHIM_ARGV_LOG: argv, FLEET_SHIM_MAP_WSL: '1',
    FLEETDECK_BUS_TOKEN_FILE: path.join(dir, 'bus-fixture-key'),
  }, { dir, hosts: [] });
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { server, dir, script, entry, argv };
}

test('GET /api/desktop-sessions uses configured SSH route, TTL, SQLite, and live registry', async (t) => {
  const f = await routeFixture(t, [mac, german, { id: 'rog-strix', route: 'push', desktop_sessions: true }]);
  const r = await f.server.get('/api/desktop-sessions');
  assert.equal(r.status, 200);
  assert.equal(r.body.groups.length, 2);
  const local = r.body.groups.find((g) => g.machine === mac.id).sessions[0];
  assert.equal(local.live, true);
  assert.deepEqual(local.messageTarget, { type: 'claude-desktop', session: 'id:' + CLI });
  assert.deepEqual(fs.readFileSync(f.argv, 'utf8').trim().split('\0').filter(Boolean),
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'gb-deploy', 'wsl sh -s']);
  const db = f.server.open();
  assert.equal(db.prepare('SELECT count(*) AS n FROM desktop_sessions').get().n, 2);
  db.close();
  fs.unlinkSync(f.entry);
  fs.writeFileSync(f.script, 'exit 1\n');
  const cached = await f.server.get('/api/desktop-sessions');
  assert.equal(cached.body.groups.find((g) => g.machine === mac.id).sessions[0].live, false);
  assert.equal(cached.body.machines[0].state, 'ok');
  const refreshed = await f.server.get('/api/desktop-sessions?refresh=1');
  assert.equal(refreshed.body.machines[0].state, 'unavailable');
  assert.equal(refreshed.body.groups.length, 2);
  assert.equal((await f.server.post('/api/desktop-sessions', {})).status, 405);
  assert.equal((await f.server.tailGet('/api/desktop-sessions')).status, 404);
});

test('live-row message uses ID routing even for a tab named current and fails closed when it exits', async (t) => {
  const f = await routeFixture(t, [mac]);
  const r = await f.server.get('/api/desktop-sessions');
  const target = r.body.groups[0].sessions[0].messageTarget;
  const message = { source: 'desktop-sessions-page', text: 'fixture message', target };
  const live = await f.server.post('/api/messages', message);
  assert.match(live.body.error, /no peer key published/, 'must resolve the exact live session, not the current-chat bridge');
  fs.unlinkSync(f.entry);
  const gone = await f.server.post('/api/messages', message);
  assert.match(gone.body.error, /is not live/);
  assert.equal(gone.body.ok, false);
});

test('remote desktop collection bounds both output streams and keeps diagnostics out of responses and logs', async (t) => {
  const f = await routeFixture(t, [german]);
  for (const stream of ['stdout', 'stderr']) {
    fs.writeFileSync(f.script, "python3 - <<'PY'\nimport sys\nsys." + stream + ".write('oversized-fixture-output' * 800000 + '\\n')\nsys." + stream + ".flush()\nprint('{\"v\":1,\"state\":\"ok\",\"complete\":true,\"sessions\":[]}')\nPY\n");
    const result = await f.server.get('/api/desktop-sessions?refresh=1');
    assert.equal(result.status, 200);
    assert.equal(result.body.machines[0].state, 'unavailable');
    assert.equal(result.text.includes('oversized-fixture-output'), false);
    assert.equal(f.server.log().includes('oversized-fixture-output'), false);
  }
});

const TRANSCRIPT_SH = path.join(__dirname, '..', 'box', 'desktop-transcript.sh');
const line = (obj) => JSON.stringify(obj) + '\n';
function transcriptFixture(dir, id = CLI) {
  // The renderer resolves ~/.claude/projects, so HOME pins it to the fixture.
  const home = path.join(dir, 'home');
  const project = path.join(home, '.claude', 'projects', '-workspace-app');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, id + '.jsonl'), [
    line({ type: 'custom-title', customTitle: 'Fixture chat', sessionId: id }),
    line({ type: 'user', timestamp: '2026-09-06T10:00:00.000Z', cwd: '/workspace/app', gitBranch: 'feature/x',
      message: { role: 'user', content: 'Fix the bug' } }),
    line({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'hidden meta prompt' }] } }),
    line({ type: 'assistant', timestamp: '2026-09-06T10:00:01.000Z', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'Reading the file.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/workspace/app/a.js' } }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(500) }] } }),
    line({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagent chatter' }] } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }),
    'not json\n',
  ].join(''));
  return home;
}

test('desktop-transcript.sh renders text and tool calls, drops thinking, meta, and sidechains', (t) => {
  const dir = tmpdir('desktop-transcript');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = transcriptFixture(dir);
  const render = (id) => JSON.parse(execFileSync('sh', [TRANSCRIPT_SH, id], { env: { ...process.env, HOME: home } }));
  const r = render(CLI.toUpperCase());
  assert.equal(r.state, 'ok');
  assert.equal(r.text, [
    '# Fixture chat', 'CLI session: ' + CLI, 'Directory: /workspace/app', 'Branch: feature/x', '',
    '## User · 2026-09-06T10:00:00.000Z', 'Fix the bug', '',
    '## Assistant · 2026-09-06T10:00:01.000Z', 'Reading the file.',
    '> Tool Read: {"file_path": "/workspace/app/a.js"}',
    '> Result: ' + 'x'.repeat(400) + ' … (+100 chars)',
    'Done.', ''].join('\n'));
  assert.ok(!r.text.includes('private reasoning') && !r.text.includes('hidden meta') && !r.text.includes('subagent chatter'));
  // The same content, split one entry per role section, for the message bus to merge.
  assert.equal(r.title, 'Fixture chat');
  assert.equal(r.cwd, '/workspace/app');
  assert.equal(r.branch, 'feature/x');
  assert.deepEqual(r.turns, [
    { role: 'user', ts: '2026-09-06T10:00:00.000Z', text: 'Fix the bug' },
    { role: 'assistant', ts: '2026-09-06T10:00:01.000Z', text: [
      'Reading the file.', '> Tool Read: {"file_path": "/workspace/app/a.js"}',
      '> Result: ' + 'x'.repeat(400) + ' … (+100 chars)', 'Done.'].join('\n') },
  ]);
  assert.deepEqual(render('33333333-3333-4333-8333-333333333333'), { v: 1, state: 'not_found' });
  assert.deepEqual(render('../escape'), { v: 1, state: 'unavailable' });
  // 'tmux:<session>' is the same renderer over a pane directory: '/workspace/app' slugs to
  // the fixture's own '-workspace-app' folder, and the newest .jsonl in it is the session.
  const bin = tmuxStub(dir, 'FD-v2-l11', '/workspace/app');
  const worker = (id) => JSON.parse(execFileSync('sh', [TRANSCRIPT_SH, id],
    { env: { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH } }));
  const byPane = worker('tmux:FD-v2-l11');
  assert.deepEqual(byPane.turns, r.turns);
  assert.equal(byPane.text, r.text, 'the file names the session, so the header is the same');
  assert.deepEqual(worker('tmux:FD-v2-l99'), { v: 1, state: 'not_found' }, 'no such tmux session');
  assert.deepEqual(worker('tmux:bad name'), { v: 1, state: 'unavailable' });
  assert.deepEqual(worker('tmux:-leading-dash'), { v: 1, state: 'unavailable' });
});

test('GET /api/desktop-sessions/transcript renders on the owning machine, local and over SSH', async (t) => {
  const f = await routeFixture(t);
  const home = transcriptFixture(f.dir);
  // The child deck inherits HOME for its local run and for the shim's local stand-in of the box.
  await f.server.stop();
  const server = await startServer({
    HOME: home, FLEET_MACHINES_FILE: path.join(f.dir, 'machines.json'), FLEET_DESKTOP_SESSIONS_SH: f.script,
    CLAUDE_SESSIONS_DIR: path.join(f.dir, 'registry'), FLEET_SSH_BIN: path.join(__dirname, 'ssh-shim.sh'),
    FLEET_SHIM_ARGV_LOG: f.argv, FLEET_SHIM_MAP_WSL: '1', FLEETDECK_BUS_TOKEN_FILE: path.join(f.dir, 'bus-fixture-key'),
  }, { dir: f.dir, hosts: [] });
  t.after(() => server.stop());
  assert.equal((await server.get('/api/desktop-sessions')).status, 200);
  const query = (machine) => `/api/desktop-sessions/transcript?machine=${machine}&account=${ACCOUNT}&org=${ORG}&id=local_one`;
  const local = await server.get(query(mac.id));
  assert.equal(local.status, 200);
  assert.match(local.text, /^# Fixture chat\n/);
  assert.match(local.text, /\n## Assistant · .*\nReading the file\.\n> Tool Read: /);
  fs.writeFileSync(f.argv, '');
  const remote = await server.get(query(german.id));
  assert.equal(remote.status, 200);
  assert.equal(remote.text, local.text);
  assert.deepEqual(fs.readFileSync(f.argv, 'utf8').trim().split('\0').filter(Boolean),
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'gb-deploy', 'wsl sh -s ' + CLI]);
  assert.equal((await server.get(query('rog-strix'))).status, 404);
  assert.equal((await server.get(query(mac.id).replace('local_one', 'local_missing'))).status, 404);
  assert.equal((await server.get(query(mac.id).replace(ACCOUNT, 'not-a-uuid'))).status, 404);
  fs.rmSync(path.join(home, '.claude'), { recursive: true });
  assert.equal((await server.get(query(mac.id))).status, 404);
  assert.equal((await server.post('/api/desktop-sessions/transcript', {})).status, 405);
  assert.equal((await server.tailGet(query(mac.id))).status, 404);
});

// A tmux worker on a fleet box: `host=` names the machine, `seat=` the tmux session on it,
// and the renderer resolves the pane's working directory to the projects folder over there.
// The stub answers only for the one session name, so a miss is a miss for the right reason.
function tmuxStub(dir, session, cwd) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, 'tmux');
  fs.writeFileSync(shim, ['#!/bin/sh', '[ "$4" = "' + session + '" ] || exit 1', 'printf \'%s\\n\' "' + cwd + '"', ''].join('\n'));
  fs.chmodSync(shim, 0o755);
  return bin;
}

test('GET /api/desktop-sessions/transcript?host= renders a tmux worker on its own box', async (t) => {
  const f = await routeFixture(t);
  const home = transcriptFixture(f.dir);
  // The fixture project folder is '-workspace-app', which is '/workspace/app' with '/' and
  // '.' both mapped to '-' -- the slug Claude Code gives a worktree.
  const bin = tmuxStub(f.dir, 'FD-v2-l11', '/workspace/app');
  await f.server.stop();
  const server = await startServer({
    HOME: home, PATH: bin + ':' + process.env.PATH,
    FLEET_MACHINES_FILE: path.join(f.dir, 'machines.json'), FLEET_DESKTOP_SESSIONS_SH: f.script,
    CLAUDE_SESSIONS_DIR: path.join(f.dir, 'registry'), FLEET_SSH_BIN: path.join(__dirname, 'ssh-shim.sh'),
    FLEET_SHIM_ARGV_LOG: f.argv, FLEET_SHIM_MAP_WSL: '1', FLEETDECK_BUS_TOKEN_FILE: path.join(f.dir, 'bus-fixture-key'),
  }, { dir: f.dir, hosts: [] });
  t.after(() => server.stop());
  const seat = (session, host, format = '&format=json') => server.get('/api/desktop-sessions/transcript?seat='
    + encodeURIComponent(session) + '&host=' + encodeURIComponent(host) + format);

  const local = await seat('FD-v2-l11', mac.host);
  assert.equal(local.status, 200);
  assert.equal(local.body.state, 'ok');
  assert.equal(local.body.title, 'Fixture chat');
  assert.deepEqual(local.body.turns.map((x) => x.role), ['user', 'assistant']);
  assert.equal(local.body.turns[0].text, 'Fix the bug');

  // Over SSH the selector rides as the positional argument after `sh -s`, like the UUID.
  fs.writeFileSync(f.argv, '');
  const remote = await seat('FD-v2-l11', german.host);
  assert.equal(remote.status, 200);
  assert.deepEqual(remote.body.turns, local.body.turns);
  assert.deepEqual(fs.readFileSync(f.argv, 'utf8').trim().split('\0').filter(Boolean),
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'gb-deploy', 'wsl sh -s tmux:FD-v2-l11']);

  // The plain-text form is still the same renderer, without the per-turn split.
  const plain = await seat('FD-v2-l11', mac.host, '');
  assert.equal(plain.status, 200);
  assert.match(plain.text, /^# Fixture chat\n/);

  // A name no tmux server answers for is a miss, not an error.
  const missing = await seat('FD-v2-l99', mac.host);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { state: 'not_found' });
  // A session name outside the allowed shape never reaches the box at all.
  for (const bad of ['FD v2; rm -rf /', '-leading-dash', 'x'.repeat(129), '']) {
    assert.equal((await seat(bad, mac.host)).status, 404, 'rejected: ' + bad);
  }
  // An unknown host, and a machine with no local or ssh route, are both not found.
  assert.equal((await seat('FD-v2-l11', 'no-such-box')).status, 404);
  assert.equal((await seat('FD-v2-l11', 'rog-strix')).status, 404);
});

test('byTitle takes the freshest row and refuses a title two sessions share', async (t) => {
  const f = storeFixture(t);
  const other = '55555555-5555-4555-8555-555555555555';
  f.reply(output([row({ id: 'local_one', title: 'Shared' }), row({ id: 'local_two', title: 'Only mine', cliSessionId: other })]));
  await f.store.collect(true);
  assert.equal(f.store.byTitle('Only mine').row.cliSessionId, other);
  assert.equal(f.store.byTitle('no such title'), null);
  assert.equal(f.store.byTitle(''), null);
  // Two tabs answering to one name resolve to nothing rather than to a coin flip.
  f.reply(output([row({ id: 'local_one', title: 'Shared' }), row({ id: 'local_two', title: 'Shared', cliSessionId: other })]));
  f.advance(2000);
  await f.store.collect(true);
  assert.equal(f.store.byTitle('Shared'), null);
});

test('GET /api/desktop-sessions/transcript takes seat=<thread id> and serves per-turn JSON', async (t) => {
  const f = await routeFixture(t, [mac]);
  const home = transcriptFixture(f.dir);
  await f.server.stop();
  const server = await startServer({
    HOME: home, FLEET_MACHINES_FILE: path.join(f.dir, 'machines.json'), FLEET_DESKTOP_SESSIONS_SH: f.script,
    CLAUDE_SESSIONS_DIR: path.join(f.dir, 'registry'), FLEETDECK_BUS_TOKEN_FILE: path.join(f.dir, 'bus-fixture-key'),
  }, { dir: f.dir, hosts: [] });
  t.after(() => server.stop());
  assert.equal((await server.get('/api/desktop-sessions')).status, 200);
  const seat = (id, format = '&format=json') =>
    server.get('/api/desktop-sessions/transcript?seat=' + encodeURIComponent(id) + format);
  const json = await seat('id:' + CLI);
  assert.equal(json.status, 200);
  assert.equal(json.body.state, 'ok');
  assert.equal(json.body.title, 'Fixture chat');
  assert.equal(json.body.cwd, '/workspace/app');
  assert.equal(json.body.branch, 'feature/x');
  assert.deepEqual(json.body.turns.map((x) => x.role), ['user', 'assistant']);
  assert.equal(json.body.turns[0].text, 'Fix the bug');
  assert.equal(json.body.text, undefined, 'the JSON form carries turns, not the 4 MB text');
  // A message-bus thread id is the live seat's display name, not an id: form. The registry
  // fixture publishes this session as 'current' (routeFixture), so the name resolves too.
  const byName = await seat('current');
  assert.equal(byName.status, 200);
  assert.deepEqual(byName.body.turns, json.body.turns);
  // The same id, without format=json, is still the plain text the Desktop screen copies.
  const plain = await seat('id:' + CLI.toUpperCase(), '');
  assert.equal(plain.status, 200);
  assert.match(plain.text, /^# Fixture chat\n/);
  const unknown = await seat('id:33333333-3333-4333-8333-333333333333');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { state: 'not_found' });
  const missName = await seat('🎛 ORCHESTRATOR 28 = O45');
  assert.equal(missName.status, 404);
  assert.deepEqual(missName.body, { state: 'not_found' }, 'a name no live seat answers to is not found');
  const bad = await seat('id:not-a-uuid');
  assert.equal(bad.status, 404);
  // A seat the collector has not stored yet is still live in the registry, and still renders
  // -- on the deck's own machine, which is where an unstored session can only be.
  const fresh = '44444444-4444-4444-8444-444444444444';
  transcriptFixture(f.dir, fresh);
  fs.writeFileSync(path.join(f.dir, 'registry', process.ppid + '.json'), JSON.stringify({
    pid: process.ppid, name: 'unstored seat', sessionId: fresh, messagingSocketPath: path.join(f.dir, 'fixture.sock'),
  }));
  const unstored = await seat('unstored seat');
  assert.equal(unstored.status, 200);
  assert.equal(unstored.body.turns[0].text, 'Fix the bug');
  // The seat the operator is looking at has gone offline: it is out of the live registry,
  // but the collector stored its title and its transcript is still on its machine.
  fs.rmSync(path.join(f.dir, 'registry', process.pid + '.json'));
  assert.equal((await seat('current')).status, 404, 'the live name goes with the registry entry');
  const offline = await seat('A session');
  assert.equal(offline.status, 200, 'the stored title still reaches the transcript');
  assert.deepEqual(offline.body.turns, json.body.turns);
  fs.rmSync(path.join(home, '.claude'), { recursive: true });
  const gone = await seat('id:' + CLI);
  assert.equal(gone.status, 404);
  assert.deepEqual(gone.body, { state: 'not_found' });
});
