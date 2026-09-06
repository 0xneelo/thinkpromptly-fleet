const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT, tmpdir } = require('./helpers');

const SCRIPT = path.join(ROOT, 'box/desktop-sessions.sh');
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ORG = 'd24c4827-df47-40e3-af74-574418a03a4b';

function fixture(t) {
  const dir = tmpdir('desktop-collector');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const root = path.join(home, 'Library/Application Support/Claude/claude-code-sessions');
  fs.mkdirSync(root, { recursive: true });
  const write = (account, org, id, value) => {
    const folder = path.join(root, account, org);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'local_' + id + '.json'), JSON.stringify(value));
    return folder;
  };
  const collect = (env = {}) => {
    const stdout = execFileSync('sh', [SCRIPT], {
      env: { ...process.env, HOME: home, FLEET_DESKTOP_WINDOWS_USERS: path.join(dir, 'Users'), ...env },
      encoding: 'utf8', timeout: 5000,
    });
    return JSON.parse(stdout);
  };
  return { dir, root, write, collect };
}

test('collector merges accounts, preserves metadata, and never opens unrelated files', (t) => {
  const f = fixture(t);
  const row = {
    title: '<img src=x onerror=alert(1)>', cwd: '/project', worktree: '/project/worktree',
    branch: 'feature/sessions', model: 'claude-opus-4-6', createdAt: 1788690000000,
    lastActivityAt: '2026-09-06T12:00:00Z', isArchived: true, completedTurns: 4,
    cliSessionId: '22222222-2222-4222-8222-222222222222',
    extra: { notMetadata: 'discard-this-field' },
  };
  const folder = f.write(ACCOUNT, ORG, 'first', row);
  // A FIFO would hang the collector if it opened config or enumerated all JSON files.
  for (const filename of ['config.json', 'scheduled-tasks.json'])
    execFileSync('mkfifo', [path.join(folder, filename)]);
  for (let i = 2; i <= 4; i++)
    f.write(ACCOUNT.replace(/^1/, String(i)), ORG, 'first', { ...row, isArchived: false });
  const result = f.collect();
  assert.equal(result.state, 'ok');
  assert.equal(result.complete, true);
  assert.equal(result.sessions.length, 4);
  assert.equal(new Set(result.sessions.map((s) => s.accountUuid)).size, 4);
  assert.deepEqual(result.sessions[0], {
    accountUuid: ACCOUNT, orgUuid: ORG, id: 'local_first',
    ...Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'extra')),
    createdAt: '2026-09-06T10:20:00.000Z', lastActivityAt: '2026-09-06T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(result).includes('discard-this-field'), false);
});

test('collector skips malformed, oversized, and symlinked session files without echoing content', (t) => {
  const f = fixture(t);
  const folder = f.write(ACCOUNT, ORG, 'valid', { title: 'Good' });
  fs.writeFileSync(path.join(folder, 'local_broken.json'), '{ invalid fixture');
  fs.writeFileSync(path.join(folder, 'local_big.json'), ' '.repeat(2 * 1024 * 1024 + 1));
  fs.symlinkSync(path.join(folder, 'local_valid.json'), path.join(folder, 'local_link.json'));
  fs.symlinkSync(folder, path.join(f.root, ACCOUNT, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  const result = f.collect();
  assert.deepEqual(result.sessions.map((s) => s.title), ['Good']);
  assert.equal(result.complete, false);
  assert.ok(result.skipped >= 3);
  assert.equal(JSON.stringify(result).includes('invalid fixture'), false);
});

test('collector discovers the Windows Store layout under every Windows user', (t) => {
  const f = fixture(t);
  fs.rmSync(f.root, { recursive: true });
  const users = path.join(f.dir, 'Users');
  for (const user of ['Alice', 'Bob']) {
    const folder = path.join(users, user, 'AppData/Local/Packages/Claude_example/LocalCache/Roaming/Claude/claude-code-sessions', ACCOUNT, ORG);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'local_' + user + '.json'), JSON.stringify({ title: user }));
  }
  assert.deepEqual(f.collect().sessions.map((s) => s.title), ['Alice', 'Bob']);
});

test('collector isolates deeply nested ignored fields to one unreadable row', (t) => {
  const f = fixture(t);
  const folder = f.write(ACCOUNT, ORG, 'valid', { title: 'Good' });
  fs.writeFileSync(path.join(folder, 'local_nested.json'), '{"unknown":' + '['.repeat(20000) + '0' + ']'.repeat(20000) + '}');
  const result = f.collect();
  assert.deepEqual(result.sessions.map((s) => s.title), ['Good']);
  assert.equal(result.complete, false);
  assert.equal(result.skipped, 1);
});

test('collector distinguishes an installed empty directory from an absent app', (t) => {
  const f = fixture(t);
  assert.equal(f.collect().state, 'ok');
  assert.deepEqual(f.collect().sessions, []);
  fs.rmSync(f.root, { recursive: true });
  assert.equal(f.collect().state, 'not_found');
});
