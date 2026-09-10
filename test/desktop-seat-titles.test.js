const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('./helpers');
const { DesktopSeatTitles } = require('../desktop-seat-titles');

const CLI = 'd4f52004-39d2-433f-abbd-e93f240f6f85';
const LOCAL = '11111111-1111-4111-8111-111111111111';

function fixture(t) {
  const dir = tmpdir('titles');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const org = path.join(dir, 'account', 'org');
  fs.mkdirSync(org, { recursive: true });
  const file = path.join(org, 'local_' + LOCAL + '.json');
  let now = 0;
  const titles = new DesktopSeatTitles({ dir, clock: () => now });
  const write = (changes = {}) => fs.writeFileSync(file, JSON.stringify({
    sessionId: 'local_' + LOCAL, cliSessionId: CLI, title: '🎛 ORCHESTRATOR 20 · remote-system',
    cwd: '/private/project', lastActivityAt: '2026-09-10T19:00:00Z', isArchived: false, ...changes,
  }));
  return { dir, org, file, titles, write, advance: (ms) => { now += ms; } };
}

test('title index keys metadata by cliSessionId, never the store sessionId', (t) => {
  const f = fixture(t);
  f.write({ cliSessionId: CLI.toUpperCase(), unrelated: 'not projected' });
  assert.deepEqual(f.titles.get().get(CLI), {
    title: '🎛 ORCHESTRATOR 20 · remote-system', cwd: '/private/project',
    lastActivityAt: '2026-09-10T19:00:00Z', isArchived: false,
  });
  assert.equal(f.titles.get().has('local_' + LOCAL), false);
});

test('five-second cache refreshes title edits, archives and deletions', (t) => {
  const f = fixture(t);
  f.write();
  const first = f.titles.get();
  f.write({ title: '🎨 DESIGN 14' });
  f.advance(4999);
  assert.equal(f.titles.get(), first);
  f.advance(1);
  assert.equal(f.titles.get().get(CLI).title, '🎨 DESIGN 14');
  f.write({ isArchived: true });
  f.advance(5000);
  assert.equal(f.titles.get().has(CLI), false);
  f.write();
  f.advance(5000);
  assert.equal(f.titles.get().has(CLI), true);
  fs.unlinkSync(f.file);
  f.advance(5000);
  assert.equal(f.titles.get().size, 0);
});

test('missing store is empty and recovers after cache expiry', (t) => {
  const f = fixture(t);
  fs.rmSync(f.dir, { recursive: true });
  assert.equal(f.titles.get().size, 0);
  fs.mkdirSync(f.org, { recursive: true });
  f.write();
  f.advance(5000);
  assert.equal(f.titles.get().get(CLI).title, '🎛 ORCHESTRATOR 20 · remote-system');
});

test('malformed records, unrelated files and symlinks cannot supply a title', (t) => {
  const f = fixture(t);
  f.write({ cliSessionId: 'invalid' });
  const valid = JSON.stringify({ cliSessionId: CLI, title: '🌐 GLOBAL' });
  fs.writeFileSync(path.join(f.org, 'config.json'), valid);
  fs.writeFileSync(path.join(f.dir, 'local_' + LOCAL + '.json'), valid);
  fs.symlinkSync(path.join(f.org, 'config.json'), path.join(f.org, 'local_link.json'));
  fs.writeFileSync(path.join(f.org, 'local_bad.json'), '{');
  fs.writeFileSync(path.join(f.org, 'local_null.json'), 'null');
  assert.equal(f.titles.get().size, 0);
  f.write({ title: { bad: 'type' } });
  f.advance(5000);
  assert.equal(f.titles.get().get(CLI).title, null);
});

test('duplicate active store keys fail closed instead of choosing a title by file order', (t) => {
  const f = fixture(t);
  f.write();
  fs.writeFileSync(path.join(f.org, 'local_other.json'), JSON.stringify({ cliSessionId: CLI, title: '🌐 GLOBAL' }));
  assert.equal(f.titles.get().get(CLI), null);
});

test('oversized title records are skipped before reading and recover after replacement', (t) => {
  const f = fixture(t);
  const limit = 16 * 1024 * 1024;
  f.write();
  fs.appendFileSync(f.file, Buffer.alloc(limit - fs.statSync(f.file).size, 0x20));
  assert.equal(f.titles.get().get(CLI).title, '🎛 ORCHESTRATOR 20 · remote-system', 'the exact byte limit is allowed');
  fs.appendFileSync(f.file, ' ');
  const readFile = fs.readFileSync;
  let oversizedReads = 0;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    if (file === f.file) oversizedReads++;
    return readFile.call(this, file, ...args);
  });
  f.advance(5000);
  assert.equal(f.titles.get().has(CLI), false);
  assert.equal(oversizedReads, 0, 'an oversized record must be rejected before loading it');
  f.write();
  f.advance(5000);
  assert.equal(f.titles.get().get(CLI).title, '🎛 ORCHESTRATOR 20 · remote-system');
});
