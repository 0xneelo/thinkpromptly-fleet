// XYZ-1890 M3 (seam 1) — fleet.db moves hosts with its fences intact. Epoch is the fencing
// primitive (claimStmt raises it, fenceCheck rejects on it), so the property under test is
// always the same one: no row's epoch comes out of the move lower than it went in, and the
// tool SAYS SO or FAILS. The regression tests below are the important half — a proof that
// always passes proves nothing, so each one breaks a db on purpose and demands a FAIL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { ROOT, tmpdir } = require('./helpers');

const SCRIPT = path.join(ROOT, 'scripts', 'fleet-db-migrate.js');

// --no-warnings: node:sqlite is experimental and its warning would drown the tool's output.
function run(...args) {
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

// The columns the fence actually turns on, in the shape server.js stores them (server.js:132,
// :162). Not the whole table — the extra lifecycle columns are carried by SELECT *, and a
// fixture that duplicated all of them would drift from the schema without testing anything.
const DDL = [
  `CREATE TABLE sessions (host TEXT, name TEXT, worker TEXT DEFAULT '', status TEXT DEFAULT 'active',
     epoch INTEGER, expires_at INTEGER, lease_state TEXT, PRIMARY KEY (host, name))`,
  `CREATE TABLE seats (seat TEXT PRIMARY KEY, owner_host TEXT, owner_name TEXT, epoch INTEGER,
     expires_at INTEGER, suspect_at INTEGER)`,
  `CREATE TABLE credits (kind TEXT, id TEXT, email TEXT, org TEXT, host TEXT, payload TEXT,
     updated_at INTEGER, PRIMARY KEY (kind, id))`,
  `CREATE TABLE credits_history (org TEXT, t INTEGER, fh REAL, sd REAL, xu REAL, PRIMARY KEY (org, t))`,
];

const SESSIONS = [
  ['german-box', 'EDITH-T-1', 'Edith', 9],
  ['german-box', 'FD-2', 'Fritz', 4],
  ['mac', 'ORCH-17', 'O17', 3],
];
const SEATS = [
  ['orchestrator', 'mac', 'O17', 4],
  ['coordinator', 'mac', 'C1', 2],
];

// A db in exactly the state the operator's Mac hands over: WAL, FULL, fences held.
function fleetDb(dir, file = 'fleet.db') {
  const f = path.join(dir, file);
  const db = new DatabaseSync(f);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  for (const sql of DDL) db.exec(sql);
  for (const [host, name, worker, epoch] of SESSIONS)
    db.prepare(
      "INSERT INTO sessions (host, name, worker, epoch, expires_at, lease_state) VALUES (?,?,?,?,?,'active')"
    ).run(host, name, worker, epoch, Date.now() + 60000);
  for (const [seat, oh, on, epoch] of SEATS)
    db.prepare('INSERT INTO seats VALUES (?,?,?,?,?,NULL)').run(seat, oh, on, epoch, Date.now() + 60000);
  db.prepare('INSERT INTO credits (kind, id, org, updated_at) VALUES (?,?,?,?)').run('acct', 'a1', 'org1', 1);
  db.prepare('INSERT INTO credits_history VALUES (?,?,?,?,?)').run('org1', 1000, 1, 2, 3);
  db.close(); // closing checkpoints and unlinks the wal: a quiesced Mac, the supported case
  return f;
}

// Reaching into a db to break it by hand is the only way to build the states the proof exists
// to catch — the deck itself can never produce them, which is the point.
function edit(file, sql, ...args) {
  const db = new DatabaseSync(file);
  db.prepare(sql).run(...args);
  db.close();
}

const rows = (file, sql, ...args) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};

// --- the happy path, stated as evidence rather than as an exit code

test('M3 — a clean migration verifies PASS and preserves every epoch exactly', () => {
  const dir = tmpdir('m3-clean');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');

  const m = run('--migrate', src, dst);
  assert.equal(m.code, 0, m.out);
  assert.match(
    m.out,
    /PASS — examined 5 fenced src rows \(sessions 3, seats 2\), zero epoch regressions, consistency clean on both sides, 0 dst rows absent from src \(dst max epoch: sessions 9, seats 4\)/,
    m.out
  );
  // Asserted before anything opens the db: the delivered artifact is one file, and any reader
  // (including the queries below) re-creates the sidecars the moment it attaches.
  for (const ext of ['-wal', '-shm'])
    assert.equal(fs.existsSync(dst + ext), false, 'no ' + ext + ' left beside the migrated db');

  assert.deepEqual(
    rows(dst, 'SELECT host, name, worker, epoch FROM sessions ORDER BY host, name').map(Object.values),
    [['german-box', 'EDITH-T-1', 'Edith', 9], ['german-box', 'FD-2', 'Fritz', 4], ['mac', 'ORCH-17', 'O17', 3]],
    'every session arrived with its epoch unchanged'
  );
  assert.deepEqual(
    rows(dst, 'SELECT seat, epoch FROM seats ORDER BY seat').map(Object.values),
    [['coordinator', 2], ['orchestrator', 4]],
    'both seat fences arrived unchanged'
  );
  // And a second, independent run of the proof against the same pair still passes.
  const v = run('--verify', src, dst);
  assert.equal(v.code, 0, v.out);
  assert.match(v.out, /PASS/, v.out);
});

// --- the tests that prove the proof works

test('M3 — a dst whose epoch was lowered FAILS, names the row, and exits non-zero', () => {
  const dir = tmpdir('m3-regress');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);

  // The whole hazard in one statement: this holder was superseded at epoch 9 and the new home
  // would let epoch 3 act again.
  edit(dst, "UPDATE sessions SET epoch = 3 WHERE host = 'german-box' AND name = 'EDITH-T-1'");

  const v = run('--verify', src, dst);
  assert.equal(v.code, 1, 'a regression must exit non-zero:\n' + v.out);
  assert.match(v.out, /FAIL sessions german-box\/EDITH-T-1: epoch 9 -> 3 — regression/, v.out);
  assert.match(v.out, /un-fences a superseded holder/, v.out);
  assert.match(v.out, /do NOT bring the new home up on this db/, v.out);
  assert.doesNotMatch(v.out, /PASS/, 'a FAIL never also prints PASS');
});

test('M3 — a seat epoch dropped to NULL is a regression, not an absence', () => {
  const dir = tmpdir('m3-seat');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);
  edit(dst, "UPDATE seats SET epoch = NULL WHERE seat = 'orchestrator'");

  const v = run('--verify', src, dst);
  assert.equal(v.code, 1, v.out);
  assert.match(v.out, /FAIL seats orchestrator: epoch 4 -> NULL — regression/, v.out);
});

test('M3 — a row missing from dst FAILS and is named', () => {
  const dir = tmpdir('m3-missing');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);
  edit(dst, "DELETE FROM sessions WHERE host = 'mac' AND name = 'ORCH-17'");

  const v = run('--verify', src, dst);
  assert.equal(v.code, 1, v.out);
  assert.match(v.out, /FAIL sessions mac\/ORCH-17: present in src, missing from dst/, v.out);
  assert.match(v.out, /sessions:\s+2\/3 src rows present in dst/, v.out);
});

test('M3 — a credits row count that does not match FAILS', () => {
  const dir = tmpdir('m3-credits');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);
  edit(dst, 'DELETE FROM credits_history');

  const v = run('--verify', src, dst);
  assert.equal(v.code, 1, v.out);
  assert.match(v.out, /FAIL credits_history: 1 rows in src, 0 in dst/, v.out);
});

test('M3 — a dst that would fail assertPragmas() FAILS before it can refuse to boot', () => {
  const dir = tmpdir('m3-pragma');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);

  // journal_mode is stored in the file header, so this is exactly what a db copied out of a
  // non-WAL deck would arrive as — and assertPragmas (server.js:112) throws on it at boot.
  const db = new DatabaseSync(dst);
  db.exec('PRAGMA journal_mode = DELETE');
  db.close();

  const v = run('--verify', src, dst);
  assert.equal(v.code, 1, v.out);
  assert.match(v.out, /assertPragmas: WOULD THROW/, v.out);
  assert.match(v.out, /FAIL pragmas: dst journal_mode=delete/, v.out);
});

// --- hazard 1: commits that live only in an uncheckpointed -wal

// A wal with frames in it and no process attached is what a crashed (or SIGKILLed) writer
// leaves behind. Building it any other way — by copying a wal, say — would test the fixture
// rather than sqlite, so this really does kill a live writer mid-life.
async function dbWithHotWal(dir) {
  const file = path.join(dir, 'fleet.db');
  fleetDb(dir);
  const child = spawn(
    process.execPath,
    ['--no-warnings', '-e',
      `const { DatabaseSync } = require('node:sqlite');
       const d = new DatabaseSync(process.env.FLEET_DB);
       d.exec('PRAGMA journal_mode = WAL'); d.exec('PRAGMA synchronous = FULL');
       d.prepare("UPDATE sessions SET epoch = 12 WHERE host = 'german-box' AND name = 'EDITH-T-1'").run();
       d.prepare("INSERT INTO sessions (host, name, worker, epoch, lease_state) VALUES ('german-box','LATE-1','Lena',1,'active')").run();
       console.log('written');
       setInterval(() => {}, 1000);`,
    ],
    { env: { ...process.env, FLEET_DB: file }, stdio: ['ignore', 'pipe', 'inherit'] }
  );
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('writer never reported: ' + out)), 15000);
    child.stdout.on('data', (c) => {
      out += c;
      if (/written/.test(out)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('writer exited early with ' + code));
    });
  });
  child.kill('SIGKILL'); // no clean close, so no checkpoint: the commits stay in the wal
  await new Promise((r) => child.on('exit', r));
  return file;
}

test('M3 — commits living only in an uncheckpointed -wal survive the migration', async () => {
  const dir = tmpdir('m3-wal');
  const src = await dbWithHotWal(dir);

  assert.ok(fs.statSync(src + '-wal').size > 32, 'the fixture really did leave frames in the wal');
  const chk = run('--check', src);
  assert.equal(chk.code, 0, chk.out);
  assert.match(chk.out, /bytes of UNMERGED commits/, chk.out);
  assert.match(chk.out, /sessions:\s+4 rows, max epoch 12/, chk.out);

  // The hazard, demonstrated: copying only the main file loses both writes, and epoch 12
  // silently becomes epoch 9 — the regression the acceptance forbids.
  const naive = path.join(dir, 'naive.db');
  fs.copyFileSync(src, naive);
  assert.deepEqual(
    rows(naive, "SELECT epoch FROM sessions WHERE name = 'EDITH-T-1'").map((r) => r.epoch),
    [9],
    'a main-file-only copy is stale — this is why the tool carries the wal'
  );
  assert.equal(rows(naive, "SELECT * FROM sessions WHERE name = 'LATE-1'").length, 0);

  const dst = path.join(dir, 'moved.db');
  const m = run('--migrate', src, dst);
  assert.equal(m.code, 0, m.out);
  assert.match(m.out, /checkpointed the copy: \d+ frames merged/, m.out);
  assert.match(m.out, /PASS/, m.out);
  assert.equal(fs.existsSync(dst + '-wal'), false, 'the migrated db carries its commits in the file itself');
  assert.deepEqual(
    rows(dst, "SELECT epoch FROM sessions WHERE name = 'EDITH-T-1'").map((r) => r.epoch), [12],
    'the wal-only epoch bump arrived at the new home'
  );
  assert.equal(rows(dst, "SELECT worker FROM sessions WHERE name = 'LATE-1'")[0].worker, 'Lena');
});

// --- hazard 3: a source that kept serving after the snapshot

test('M3 — --compare-live is quiet on a quiesced source and reports drift on a live one', () => {
  const dir = tmpdir('m3-drift');
  const src = fleetDb(dir);
  const snap = path.join(dir, 'snapshot.db');
  assert.equal(run('--migrate', src, snap).code, 0);

  const quiet = run('--compare-live', snap, src);
  assert.equal(quiet.code, 0, quiet.out);
  assert.match(quiet.out, /NO DRIFT — the source has not claimed since the snapshot/, quiet.out);

  // The Mac deck was never actually stopped: one more claim, and the snapshot is stale.
  edit(src, "UPDATE sessions SET epoch = 10 WHERE host = 'german-box' AND name = 'EDITH-T-1'");
  edit(src, "INSERT INTO seats VALUES ('orchestrator2','mac','O18',5,0,NULL)");

  const drift = run('--compare-live', snap, src);
  assert.equal(drift.code, 1, 'drift must exit non-zero:\n' + drift.out);
  assert.match(drift.out, /DRIFT sessions german-box\/EDITH-T-1: epoch 9 -> 10/, drift.out);
  assert.match(drift.out, /DRIFT seats orchestrator2: row appeared after the snapshot/, drift.out);
  assert.match(drift.out, /redo the cutover/, drift.out);

  // The same drift, seen from the proof's side: verify re-reads the source, so a source that
  // moved on now reads as a regression at the destination.
  const v = run('--verify', src, snap);
  assert.equal(v.code, 1, v.out);
});

// --- refusals

test('M3 — --migrate refuses an existing destination unless --force, and never deletes one', () => {
  const dir = tmpdir('m3-force');
  const src = fleetDb(dir);
  const dst = fleetDb(dir, 'existing.db');
  edit(dst, "UPDATE seats SET epoch = 99 WHERE seat = 'orchestrator'"); // the fleet that lives there

  const refused = run('--migrate', src, dst);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /already exists/, refused.out);
  assert.match(refused.out, /pass --force/, refused.out);
  assert.equal(rows(dst, 'SELECT epoch FROM seats WHERE seat = ?', 'orchestrator')[0].epoch, 99,
    'a refusal leaves the destination exactly as it was');

  const forced = run('--migrate', src, dst, '--force');
  assert.equal(forced.code, 0, forced.out);
  assert.match(forced.out, /kept the previous destination as .*pre-migrate-/, forced.out);
  const kept = forced.out.match(/kept the previous destination as (\S+)/)[1];
  assert.equal(rows(kept, 'SELECT epoch FROM seats WHERE seat = ?', 'orchestrator')[0].epoch, 99,
    '--force means overwrite, never destroy: the old lease state is still on disk');
  assert.equal(rows(dst, 'SELECT epoch FROM seats WHERE seat = ?', 'orchestrator')[0].epoch, 4);
});

test('M3 — --check is read-only and reports the fences it found', () => {
  const dir = tmpdir('m3-check');
  const src = fleetDb(dir);
  const before = fs.readFileSync(src);

  const c = run('--check', src);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /sessions:\s+3 rows, max epoch 9/, c.out);
  assert.match(c.out, /seats:\s+2 rows, max epoch 4/, c.out);
  assert.match(c.out, /journal_mode=wal synchronous=2 quick_check=ok/, c.out);
  assert.match(c.out, /OK — no consistency problems/, c.out);
  assert.deepEqual(fs.readFileSync(src), before, '--check did not write one byte of the db it inspected');

  // Two seats sharing an epoch would pass a fence they never earned (server.js:426-428).
  edit(src, "UPDATE seats SET epoch = 4 WHERE seat = 'coordinator'");
  const bad = run('--check', src);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /share epoch 4 — the fence cannot tell them apart/, bad.out);
});

// --- review fixes: the ways a proof can lie about its own scope

// F1. The vacuous PASS is worse than the regressions the tool exists to catch, because it is
// better disguised: a typo'd path or a fresh checkout compares nothing and every row check is
// trivially satisfied. An empty fleet is legitimate; discovering one by accident is not.
test('M3 — an empty source FAILS instead of passing a comparison that examined nothing', () => {
  const dir = tmpdir('m3-empty');
  const dst = fleetDb(dir, 'real.db'); // the destination holds the whole fleet
  const empty = path.join(dir, 'empty.db');
  const db = new DatabaseSync(empty);
  db.exec('PRAGMA journal_mode = WAL');
  for (const sql of DDL) db.exec(sql);
  db.close();

  const v = run('--verify', empty, dst);
  assert.equal(v.code, 1, 'a proof over zero rows must not pass:\n' + v.out);
  assert.match(v.out, /FAIL src holds no sessions and no seats — there is nothing here to prove/, v.out);
  assert.doesNotMatch(v.out, /PASS/, v.out);

  // Every fenced row in dst is also reported as absent from src — the same mistake, one row at
  // a time, and the reason a mismatched pair cannot look like a clean migration.
  assert.match(v.out, /WARN sessions german-box\/EDITH-T-1: present in dst, absent from src/, v.out);

  // --migrate refuses the same case, before it copies anything or moves a destination aside.
  const out = path.join(dir, 'out.db');
  const m = run('--migrate', empty, out);
  assert.equal(m.code, 1, m.out);
  assert.match(m.out, /holds no sessions and no seats/, m.out);
  assert.equal(fs.existsSync(out), false, 'nothing was copied');

  // Stated intent turns it into a legitimate migration — and the verdict still says what it
  // examined, so "0 rows" can never be read as success.
  const allowed = run('--migrate', empty, out, '--allow-empty');
  assert.equal(allowed.code, 0, allowed.out);
  assert.match(allowed.out, /PASS — examined 0 fenced src rows \(sessions 0, seats 0\)/, allowed.out);
  assert.match(allowed.out, /\[--allow-empty: this proof examined NOTHING\]/, allowed.out);

  // And --check says it too, rather than leaving a human to notice a zero in a row count.
  const c = run('--check', empty);
  assert.equal(c.code, 1, c.out);
  assert.match(c.out, /this db holds no fleet \(pass --allow-empty if that is intended\)/, c.out);
  assert.equal(run('--check', empty, '--allow-empty').code, 0);
});

test('M3 — a table missing from either side FAILS, because no table is not zero rows', () => {
  const dir = tmpdir('m3-table');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);

  const db = new DatabaseSync(dst);
  db.exec('DROP TABLE seats');
  db.close();

  const v = run('--verify', src, dst);
  assert.equal(v.code, 1, v.out);
  assert.match(v.out, /FAIL table seats: present in src but missing from dst/, v.out);
});

test('M3 — rows in dst that src never had warn by default and FAIL under --strict', () => {
  const dir = tmpdir('m3-extra');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);
  edit(dst, "INSERT INTO sessions (host, name, worker, epoch, lease_state) VALUES ('mac','STRANGER-1','X',7,'active')");

  const v = run('--verify', src, dst);
  assert.equal(v.code, 0, 'an extra row un-fences nobody, so it is not a regression:\n' + v.out);
  assert.match(v.out, /WARN sessions mac\/STRANGER-1: present in dst, absent from src/, v.out);
  assert.match(v.out, /1 dst rows absent from src/, v.out);

  const strict = run('--verify', src, dst, '--strict');
  assert.equal(strict.code, 1, strict.out);
  assert.match(strict.out, /FAIL sessions mac\/STRANGER-1: present in dst, absent from src/, strict.out);
});

// F2. --migrate's own PASS must not have a narrower scope than --check, or an operator trusting
// it has no way to know consistency was never part of the verdict.
test('M3 — the proof includes consistency: two seats sharing an epoch cannot PASS', () => {
  const dir = tmpdir('m3-consistency');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  assert.equal(run('--migrate', src, dst).code, 0);
  // The fence matches on the number alone (server.js:426-428), so a shared epoch is a fence
  // that cannot tell two seats apart — and no epoch went backwards to produce it.
  edit(dst, "UPDATE seats SET epoch = 4 WHERE seat = 'coordinator'");

  const v = run('--verify', src, dst);
  assert.equal(v.code, 1, v.out);
  assert.match(v.out, /FAIL dst consistency: seats .* share epoch 4 — the fence cannot tell them apart/, v.out);
  assert.match(v.out, /consistency:\s+src 0 problem\(s\), dst 1 problem\(s\)/, v.out);
  assert.equal(run('--check', dst).code, 1, '--check and --verify agree about this file');
});

// F3. The stamp is second-granular, and a --force re-run under pressure is exactly what an
// operator does. Never rename onto a path that exists.
test('M3 — a second --force in the same second cannot eat the first backup', () => {
  const dir = tmpdir('m3-backup');
  const src = fleetDb(dir);
  const dst = fleetDb(dir, 'existing.db');
  edit(dst, "UPDATE seats SET epoch = 100 WHERE seat = 'orchestrator'"); // the state that must survive

  // Deterministic collision: occupy both candidate stamps, so the run must disambiguate however
  // the second boundary falls between here and the child process starting.
  const at = (d) => dst + '.pre-migrate-' + d.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const taken = [at(new Date()), at(new Date(Date.now() + 1000))];
  for (const f of taken) fs.writeFileSync(f, 'an earlier backup');

  const forced = run('--migrate', src, dst, '--force');
  assert.equal(forced.code, 0, forced.out);
  for (const f of taken)
    assert.equal(fs.readFileSync(f, 'utf8'), 'an earlier backup', 'an existing backup is never renamed over');
  const kept = forced.out.match(/kept the previous destination as (\S+)/)[1];
  assert.match(kept, /-2$/, 'the colliding name was disambiguated, and the final path is printed');
  assert.equal(rows(kept, 'SELECT epoch FROM seats WHERE seat = ?', 'orchestrator')[0].epoch, 100,
    'the fleet that lived at the destination is still on disk, intact');
});

// F4. An interrupted copy must leave the authoritative path untouched or complete, never a
// truncated db sitting where the fleet's home should be.
test('M3 — a copy that fails part-way leaves no half-written destination and no temp files', () => {
  const dir = tmpdir('m3-atomic');
  const src = fleetDb(dir);
  const dst = path.join(dir, 'moved.db');
  // A directory where the -wal should be: copyFileSync throws after the main file is staged.
  fs.mkdirSync(src + '-wal');

  assert.throws(() => require(SCRIPT).copyDb(src, dst));
  assert.equal(fs.existsSync(dst), false, 'the destination path was never created');
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.includes('.copying-')), [], 'no temp file was left behind'
  );

  fs.rmdirSync(src + '-wal');
  assert.equal(run('--migrate', src, dst).code, 0, 'and the same paths migrate cleanly once it can');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.copying-')), []);
});

// F5. A lexical comparison would let a symlinked alias through, and preserve() would then move
// the source out from under itself — a "backup" that is the live db.
test('M3 — a symlinked alias of the source is refused as a destination', () => {
  const dir = tmpdir('m3-symlink');
  const src = fleetDb(dir);
  const alias = path.join(dir, 'alias.db');
  fs.symlinkSync(src, alias);

  const m = run('--migrate', src, alias, '--force');
  assert.equal(m.code, 2, m.out);
  assert.match(m.out, /src and dst are the same file/, m.out);
  assert.equal(fs.existsSync(src), true, 'the source is still where it was');
  assert.equal(rows(src, 'SELECT epoch FROM seats WHERE seat = ?', 'orchestrator')[0].epoch, 4);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.pre-migrate-')), []);
});

test('M3 — bad usage exits 2 rather than guessing', () => {
  assert.equal(run('--verify', 'only-one-path').code, 2);
  assert.equal(run('--nonsense').code, 2);
  assert.equal(run().code, 2);
});
