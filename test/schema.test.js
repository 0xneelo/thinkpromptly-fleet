// Milestone A — M9 (pragmas pinned and asserted), M10 (additive migration with backup), S4.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { tmpdir, legacyDb, hostsFile, boot, load } = require('./helpers');

const LIFECYCLE_COLS = [
  'pid', 'parent_host', 'parent_name', 'epoch', 'expires_at', 'lease_state',
  'suspect_at', 'warned_at', 'reaped_at', 'reap_reason', 'killed_at', 'pinger_dead',
];

const cols = (db, table) =>
  db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((r) => r.name);

test('M10 — booting twice on an existing db leaves old rows intact and adds every column', () => {
  const dir = tmpdir('m10');
  const file = legacyDb(dir, [
    { host: 'german-box', name: 'FD-legacy', label: 'lane', role: 'rust-engineer',
      worker: 'Otto', status: 'done', note: 'keep me', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z', last_seen_at: '2026-01-03T00:00:00.000Z',
      active_at: '2026-01-04T00:00:00.000Z', grp: 'g1', task: 'XYZ-1' },
    { host: 'mac', name: 'ORCH-17', label: 'desk', status: 'active' },
  ]);
  const env = { FLEET_DB: file, FLEET_HOSTS_FILE: hostsFile(dir) };

  boot(env);
  boot(env); // second boot must not throw on the ALTERs, and must not rewrite anything

  const db = new DatabaseSync(file);
  const rows = db.prepare('SELECT * FROM sessions ORDER BY name').all();
  assert.equal(rows.length, 2, 'no row was dropped or duplicated');

  const legacy = rows.find((r) => r.name === 'FD-legacy');
  assert.deepEqual(
    [legacy.label, legacy.role, legacy.worker, legacy.status, legacy.note, legacy.grp, legacy.task],
    ['lane', 'rust-engineer', 'Otto', 'done', 'keep me', 'g1', 'XYZ-1'],
    'every legacy value survived both boots verbatim'
  );
  assert.equal(legacy.created_at, '2026-01-01T00:00:00.000Z');
  assert.equal(legacy.active_at, '2026-01-04T00:00:00.000Z');

  const have = cols(db, 'sessions');
  for (const c of LIFECYCLE_COLS) assert.ok(have.includes(c), 'column ' + c + ' was added');
  // Additive means the old rows carry NULL, not a rewritten default.
  for (const c of LIFECYCLE_COLS) assert.equal(legacy[c], null, c + ' is null on a legacy row');

  assert.deepEqual(
    cols(db, 'seats').sort(),
    ['epoch', 'expires_at', 'owner_host', 'owner_name', 'seat', 'suspect_at'],
    'seats table created with the contract shape'
  );
  db.close();
});

test('M10 — the db is copied to fleet.db.bak-<date> before the migrating boot', () => {
  const dir = tmpdir('m10bak');
  const file = legacyDb(dir, [{ host: 'german-box', name: 'FD-x' }]);
  boot({ FLEET_DB: file, FLEET_HOSTS_FILE: hostsFile(dir) });

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bak = file + '.bak-' + stamp;
  assert.ok(fs.existsSync(bak), 'backup written next to the db');

  // The backup is the pre-migration file: it must NOT carry the lifecycle columns.
  const b = new DatabaseSync(bak);
  const have = cols(b, 'sessions');
  assert.ok(!have.includes('lease_state'), 'backup is the pre-migration snapshot');
  assert.equal(b.prepare('SELECT count(*) c FROM sessions').get().c, 1, 'backup holds the rows');
  b.close();
});

test('M10 — a fresh checkout with no db boots clean and writes no backup', () => {
  const dir = tmpdir('m10fresh');
  const file = path.join(dir, 'fleet.db');
  boot({ FLEET_DB: file, FLEET_HOSTS_FILE: hostsFile(dir) });
  assert.ok(fs.existsSync(file), 'db created');
  assert.equal(
    fs.readdirSync(dir).filter((f) => f.includes('.bak-')).length, 0,
    'nothing to back up, so no backup file'
  );
});

test('M9 — WAL + synchronous=FULL are set, and read back, on every boot', () => {
  const dir = tmpdir('m9');
  const file = path.join(dir, 'fleet.db');
  boot({ FLEET_DB: file, FLEET_HOSTS_FILE: hostsFile(dir) });

  const db = new DatabaseSync(file);
  assert.equal(
    String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(), 'wal',
    'journal_mode persisted as WAL'
  );
  db.close();
});

test('M9 — boot refuses a db it cannot open for writing', () => {
  const dir = tmpdir('m9fail');
  const file = path.join(dir, 'fleet.db');
  // A db opened read-only cannot switch to WAL, so the read-back assertion must fire.
  new DatabaseSync(file).close();
  fs.chmodSync(file, 0o444);
  assert.throws(
    () => boot({ FLEET_DB: file, FLEET_HOSTS_FILE: hostsFile(dir) }),
    (e) => /journal_mode|readonly|attempt to write/i.test(String(e.stderr) + String(e.message)),
    'the process refuses to serve on a db it cannot make durable'
  );
});

test('M9 — the read-back assertion rejects a db left on the wrong durability setting', () => {
  // sqlite already defaults to synchronous=FULL, so asserting it on the server's own handle
  // proves nothing: the check is exercised against a handle deliberately set the wrong way.
  const dir = tmpdir('m9assert');
  const { assertPragmas } = load({
    FLEET_DB: path.join(dir, 'srv.db'),
    FLEET_HOSTS_FILE: hostsFile(dir),
  });
  const probe = new DatabaseSync(path.join(dir, 'probe.db'));
  probe.exec('PRAGMA journal_mode = WAL');

  probe.exec('PRAGMA synchronous = NORMAL');
  assert.throws(() => assertPragmas(probe), /synchronous is 1, expected 2/, 'defect 7 is refused');

  probe.exec('PRAGMA synchronous = FULL');
  assert.doesNotThrow(() => assertPragmas(probe), 'WAL + FULL is the one accepted pair');

  probe.exec('PRAGMA journal_mode = DELETE');
  assert.throws(() => assertPragmas(probe), /journal_mode is delete, expected wal/);
  probe.close();
});

test('M10 — an already-migrated db is not copied again on later boots', () => {
  // The backup guards the one boot that migrates. Repeating it per restart would grow one
  // full-size copy per calendar day, forever, with nothing ever pruning them.
  const dir = tmpdir('m10once');
  const file = legacyDb(dir, [{ host: 'german-box', name: 'FD-x' }]);
  const env = { FLEET_DB: file, FLEET_HOSTS_FILE: hostsFile(dir) };

  boot(env);
  const baks = () => fs.readdirSync(dir).filter((f) => f.includes('.bak-'));
  assert.equal(baks().length, 1, 'the migrating boot took a copy');

  for (const f of baks()) fs.unlinkSync(path.join(dir, f));
  boot(env);
  assert.deepEqual(baks(), [], 'a boot with nothing to migrate takes no copy');
});

test('M9 — the read-back assertion itself rejects a db that cannot hold WAL', () => {
  // An in-memory db silently ignores `PRAGMA journal_mode = WAL` and stays `memory`, so this
  // is the exact shape of a durability downgrade the process must refuse to serve on.
  assert.throws(
    () => boot({ FLEET_DB: ':memory:', FLEET_HOSTS_FILE: hostsFile(tmpdir('m9mem')) }),
    (e) => /journal_mode is memory, expected wal/.test(String(e.stderr)),
    'boot names the pragma that read back wrong'
  );
});
