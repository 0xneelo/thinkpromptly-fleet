#!/usr/bin/env node
// XYZ-1890 M3 (seam 1): move fleet.db to the german-box without losing a lease epoch.
//
// Epoch is the fleet's fencing primitive. claimStmt (server.js:304) is the ONLY site that
// raises one, fenceCheck (server.js:476) is the ONLY site that rejects on one, and every
// state-changing write — kill, registry delete, registry status/task, seat claim — passes the
// fence first. So this tool's entire correctness claim is one sentence: **no row's epoch may
// come out of the move lower than it went in**. An epoch that regresses at the new home
// un-fences a holder the old home had already superseded, which is the exact break the
// milestone exists to prevent.
//
// Copying the file preserves epochs trivially. What loses them is:
//   1. a -wal whose commits were never merged  — the copy silently drops the newest claims;
//   2. a copy taken while a writer was live    — a torn snapshot;
//   3. a source that kept serving afterwards   — the newer epochs stay behind on the Mac;
//   4. a rollback that reuses the pre-cutover file — see docs/goals/gb-home-migration/cutover.md.
// This tool checkpoints for (1), refuses to clobber and re-reads the source for (2), compares
// for (3) — and then PROVES the result row by row instead of asserting it.
//
//   node scripts/fleet-db-migrate.js --check        <db>
//   node scripts/fleet-db-migrate.js --migrate      <src> <dst> [--force]
//   node scripts/fleet-db-migrate.js --verify       <src> <dst>
//   node scripts/fleet-db-migrate.js --compare-live <snapshot> <current>
//
// Exit: 0 pass, 1 a regression/drift/refusal the operator must act on, 2 bad usage.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SIDECARS = ['-wal', '-shm'];
// A FAIL names the rows, because "3 regressions" is not something an operator can act on.
// Bounded, because a fleet-wide fault must not scroll the proof off the terminal.
const MAX_NAMED = 10;
// The wal header alone is 32 bytes; anything longer carries frames that are not in the db yet.
const WAL_HEADER_BYTES = 32;
// server.js:296 keys the same pair with the same joint (REAPER.killing).
const KEY = (a, b) => a + '\0' + b;
const label = (k) => k.replace('\0', '/');

// --- identity -------------------------------------------------------------------------
// A `sessions` row's identity is (host, name): it is the table's PRIMARY KEY (server.js:132),
// it is the entire WHERE clause of claimStmt (server.js:304-315) and of leaseRow, and it is
// what the reaper and the kill path address. `worker` is NOT identity — claimStmt rewrites it
// with COALESCE on every claim, so matching on it would call a re-staffed lane a missing row.
// A `seats` row's identity is `seat` — its PRIMARY KEY, and the only thing seatClaim matches.
const sessKey = (r) => KEY(r.host, r.name);
const seatKey = (r) => r.seat;

const TABLES = {
  sessions: { key: sessKey, fenced: true },
  seats: { key: seatKey, fenced: true },
  credits: { key: (r) => KEY(r.kind, r.id), fenced: false },
  credits_history: { key: (r) => KEY(r.org, r.t), fenced: false },
};
const FENCED = Object.keys(TABLES).filter((t) => TABLES[t].fenced);

// --- reading --------------------------------------------------------------------------

// Read-only means sqlite refuses every write to the database itself; the operator's live deck
// is safe to point --check at. It does still materialise empty -wal/-shm sidecars beside a WAL
// database, exactly as any reader attaching to it would — that is sqlite's shared-memory
// handshake, not a change to a single stored byte.
function openRead(file) {
  if (!fs.existsSync(file)) usage('no such database: ' + file);
  return new DatabaseSync(file, { readOnly: true });
}

const walBytes = (file) => (fs.existsSync(file + '-wal') ? fs.statSync(file + '-wal').size : 0);

// Everything a proof needs from one db, read once. Rows are kept as Maps so the comparison
// below is a lookup per row rather than a scan per row.
function snapshot(file) {
  const db = openRead(file);
  try {
    const present = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    const tables = {};
    for (const [name, spec] of Object.entries(TABLES)) {
      const rows = present.has(name) ? db.prepare('SELECT * FROM ' + name).all() : [];
      tables[name] = { present: present.has(name), rows: new Map(rows.map((r) => [spec.key(r), r])) };
    }
    return {
      file,
      tables,
      // journal_mode is a property of the FILE and is the one that can actually arrive wrong.
      // synchronous is per-connection, so reading it here mirrors assertPragmas() against the
      // runtime that will host the db rather than against the bytes — cheap, and it catches a
      // node/sqlite build whose default is not FULL before that build boots the deck.
      journal_mode: String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(),
      synchronous: Number(db.prepare('PRAGMA synchronous').get().synchronous),
      quick_check: String(db.prepare('PRAGMA quick_check').get().quick_check),
      wal: walBytes(file),
    };
  } finally {
    db.close();
  }
}

const rowsOf = (s, t) => s.tables[t].rows;
const count = (s, t) => rowsOf(s, t).size;
const maxEpoch = (s, t) =>
  [...rowsOf(s, t).values()].reduce((m, r) => (Number.isInteger(r.epoch) && r.epoch > m ? r.epoch : m), 0);

// --- checks ---------------------------------------------------------------------------

// The invariants server.js maintains while it writes, restated as things a file can be asked.
// A source that already violates one of these has a problem the move will faithfully carry
// across, so it is worth knowing before the cutover rather than after it.
function consistency(s) {
  const bad = [];
  const LEASE_STATES = new Set(['active', 'suspect', 'reaped']);
  for (const [k, r] of rowsOf(s, 'sessions')) {
    if (r.epoch !== null && !(Number.isInteger(r.epoch) && r.epoch >= 1))
      bad.push('sessions ' + label(k) + ': epoch is ' + JSON.stringify(r.epoch) + ', expected an integer >= 1 or NULL');
    if (r.lease_state !== null && !LEASE_STATES.has(r.lease_state))
      bad.push('sessions ' + label(k) + ': lease_state is ' + JSON.stringify(r.lease_state));
    // A lease state without an epoch is a row nothing can fence: fenceCheck has no number to
    // compare, so the holder is neither current nor supersedable.
    if (r.lease_state !== null && r.epoch === null)
      bad.push('sessions ' + label(k) + ': lease_state ' + r.lease_state + ' with no epoch — unfenceable');
  }
  const seen = new Map();
  for (const [k, r] of rowsOf(s, 'seats')) {
    if (r.epoch !== null && !(Number.isInteger(r.epoch) && r.epoch >= 1))
      bad.push('seats ' + k + ': epoch is ' + JSON.stringify(r.epoch) + ', expected an integer >= 1 or NULL');
    // nextSeatEpoch (server.js:428) counts across BOTH seats precisely so two seats can never
    // share a number: the fence matches on the number alone, so a collision would let the
    // coordinator pass a fence it never earned.
    if (r.epoch !== null && seen.has(r.epoch))
      bad.push('seats ' + k + ' and ' + seen.get(r.epoch) + ' share epoch ' + r.epoch + ' — the fence cannot tell them apart');
    if (r.epoch !== null) seen.set(r.epoch, k);
  }
  if (s.quick_check !== 'ok') bad.push('sqlite quick_check: ' + s.quick_check);
  return bad;
}

// The fencing proof. Direction is fixed: dst may only ever be at or ahead of src.
// opts.allowEmpty  — the operator states that a source with no fleet in it is intended.
// opts.strict      — rows in dst that src never had become a FAIL instead of a warning.
function verify(src, dst, opts = {}) {
  const out = [];
  const fail = [];
  const warn = [];
  const per = {};
  let checked = 0;
  let extras = 0;

  // A proof must be non-vacuous BY CONSTRUCTION. Every row check below iterates the source, so
  // an empty source satisfies all of them trivially and the verdict reads PASS while the
  // fleet's entire lease state sits outside the comparison. A typo'd path, a fresh checkout, a
  // snapshot taken from the wrong host all land exactly here, and "zero epoch regressions" is
  // true of a comparison that examined nothing. Migrating an empty fleet is legitimate — but it
  // is something the operator says, never something the tool infers from silence.
  const srcFenced = FENCED.reduce((n, t) => n + count(src, t), 0);
  if (srcFenced === 0 && !opts.allowEmpty)
    fail.push(
      'FAIL src holds no sessions and no seats — there is nothing here to prove. Check the path, ' +
        'or pass --allow-empty if the source really is an empty fleet.'
    );

  // Zero rows and no table at all are different facts, and the tool must not report the second
  // as the first: a db with no `sessions` table never held a fleet, whatever its row counts say.
  for (const t of Object.keys(TABLES)) {
    if (src.tables[t].present !== dst.tables[t].present)
      fail.push(
        'FAIL table ' + t + ': present in ' +
          (src.tables[t].present ? 'src but missing from dst' : 'dst but missing from src')
      );
    else if (!dst.tables[t].present && TABLES[t].fenced)
      fail.push('FAIL table ' + t + ': absent from src and dst — this pair never held a fleet');
  }

  for (const t of FENCED) {
    const a = rowsOf(src, t);
    const b = rowsOf(dst, t);
    let missing = 0;
    let regressed = 0;
    per[t] = a.size;
    for (const [k, r] of a) {
      checked++;
      const d = b.get(k);
      if (!d) {
        missing++;
        if (fail.length < MAX_NAMED) fail.push('FAIL ' + t + ' ' + label(k) + ': present in src, missing from dst');
        continue;
      }
      // NULL is "never claimed" (a legacy row). NULL -> NULL is fine, NULL -> a number is fine
      // (the new home claimed it), but a number -> NULL drops a fence and is a regression.
      if (r.epoch === null) continue;
      if (d.epoch === null || d.epoch < r.epoch) {
        regressed++;
        if (fail.length < MAX_NAMED)
          fail.push(
            'FAIL ' + t + ' ' + label(k) + ': epoch ' + r.epoch + ' -> ' +
              (d.epoch === null ? 'NULL' : d.epoch) + ' — regression, this un-fences a superseded holder'
          );
      }
    }
    // Not a fencing regression — a row the destination has and the source never did cannot
    // un-fence anyone. It is evidence that the destination is not the file the operator thinks
    // it is, which is the same mistake F1 guards against, one row at a time.
    const extra = [...b.keys()].filter((k) => !a.has(k));
    extras += extra.length;
    for (const k of extra.slice(0, MAX_NAMED))
      (opts.strict ? fail : warn).push(
        (opts.strict ? 'FAIL ' : 'WARN ') + t + ' ' + label(k) +
          ': present in dst, absent from src — the destination is not a copy of this source'
      );
    out.push(
      '  ' + (t + ':').padEnd(17) + (a.size - missing) + '/' + a.size + ' src rows present in dst, ' +
        regressed + ' epoch regressions, ' + extra.length + ' dst rows absent from src' +
        ', max epoch src=' + maxEpoch(src, t) + ' dst=' + maxEpoch(dst, t)
    );
  }

  for (const t of ['credits', 'credits_history']) {
    const [x, y] = [count(src, t), count(dst, t)];
    out.push('  ' + (t + ':').padEnd(17) + x + ' -> ' + y + ' rows');
    if (x !== y) fail.push('FAIL ' + t + ': ' + x + ' rows in src, ' + y + ' in dst');
  }

  // A target that cannot boot is not a migrated fleet. assertPragmas (server.js:109-115) throws
  // unless it reads back exactly these two, so a dst that fails here would refuse to serve.
  const ok = dst.journal_mode === 'wal' && dst.synchronous === 2;
  out.push(
    '  ' + 'pragmas:'.padEnd(17) + 'dst journal_mode=' + dst.journal_mode + ' synchronous=' + dst.synchronous +
      ' (assertPragmas: ' + (ok ? 'ok' : 'WOULD THROW') + ')'
  );
  if (!ok)
    fail.push(
      'FAIL pragmas: dst journal_mode=' + dst.journal_mode + ' synchronous=' + dst.synchronous +
        ', expected wal/2 — this db would throw at boot'
    );

  // The proof states its own scope, so it must not have a narrower scope than --check: a
  // destination --check would reject (two seats sharing an epoch, say) has an ambiguous fence
  // and must never pass the migration's own proof. Both sides, because a source that already
  // violates an invariant hands the destination the same violation, faithfully copied.
  const problems = { src: consistency(src), dst: consistency(dst) };
  for (const side of ['src', 'dst'])
    for (const c of problems[side].slice(0, MAX_NAMED)) fail.push('FAIL ' + side + ' consistency: ' + c);
  out.push(
    '  ' + 'consistency:'.padEnd(17) + 'src ' + problems.src.length + ' problem(s), dst ' +
      problems.dst.length + ' problem(s)'
  );

  return { checked, per, extras, out, fail, warn, empty: srcFenced === 0 };
}

// Hazard 3, as a question instead of an assumption: did the source keep serving after the
// snapshot was taken? Any epoch ahead of the snapshot's, or any fenced row that did not exist
// when the snapshot was taken, means the Mac issued claims the box will never know about.
function compareLive(snap, cur) {
  const drift = [];
  for (const t of FENCED) {
    for (const [k, r] of rowsOf(cur, t)) {
      const s = rowsOf(snap, t).get(k);
      if (!s) {
        if (drift.length < MAX_NAMED) drift.push('DRIFT ' + t + ' ' + label(k) + ': row appeared after the snapshot');
      } else if (r.epoch !== null && (s.epoch === null || r.epoch > s.epoch)) {
        if (drift.length < MAX_NAMED)
          drift.push(
            'DRIFT ' + t + ' ' + label(k) + ': epoch ' + (s.epoch === null ? 'NULL' : s.epoch) + ' -> ' + r.epoch +
              ' — the source claimed after the snapshot was taken'
          );
      }
    }
  }
  return drift;
}

// --- copying --------------------------------------------------------------------------

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');

// Symlink-aware, because a lexical comparison would let `--migrate fleet.db link-to-fleet.db`
// through: preserve() would then rename the source out from under itself and the
// `.pre-migrate-` file the operator is told holds the previous destination would be the live
// db. A dst that does not exist yet is resolved through its directory instead.
function sameFile(a, b) {
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch (e) {
      try {
        return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
      } catch (e2) {
        return path.resolve(p);
      }
    }
  };
  return real(a) === real(b);
}

// The whole point of copying before checkpointing: PRAGMA wal_checkpoint takes a write lock,
// and taking one on the operator's live db is the torn-snapshot hazard, not a fix for it.
//
// The copy lands on a temp name in the SAME directory and is renamed into place, so the rename
// stays on one filesystem and is therefore atomic. An interruption mid-copy is the same class
// of event the -wal handling is designed around, and it must leave the authoritative path
// either untouched or complete — never a truncated db sitting where the fleet's home should be.
function copyDb(src, dst) {
  const tmp = dst + '.copying-' + process.pid;
  const staged = [];
  try {
    fs.copyFileSync(src, tmp);
    // Same order as backupDb (server.js:104-106): the wal carries the commits the main file has
    // not merged yet, and the shm is sqlite's index into it.
    for (const ext of SIDECARS) if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, tmp + ext);
    // Sidecars first, the db itself last: the destination path appears only once everything
    // behind it is already there. A -wal with no db beside it is inert, and the existence check
    // in --migrate sees it on the next run.
    for (const ext of SIDECARS) {
      if (fs.existsSync(tmp + ext)) {
        fs.renameSync(tmp + ext, dst + ext);
        staged.push(dst + ext);
      } else if (fs.existsSync(dst + ext)) fs.unlinkSync(dst + ext); // never pair a fresh db with a stale wal
    }
    fs.renameSync(tmp, dst);
  } catch (e) {
    for (const f of [tmp, ...SIDECARS.map((ext) => tmp + ext), ...staged])
      if (fs.existsSync(f)) fs.unlinkSync(f);
    throw e;
  }
}

// Moves an existing destination aside instead of clobbering it. --force is the operator saying
// "overwrite", not "destroy": a fleet's lease state is never something this script deletes.
// The stamp is second-granular and rename() overwrites silently, so two --force runs in the
// same second would have the second backup eat the first — and a re-run under pressure is
// precisely when a --force happens twice. Never rename onto a path that exists.
function preserve(dst) {
  if (!fs.existsSync(dst)) return null;
  const base = dst + '.pre-migrate-' + stamp();
  const taken = (p) => ['', ...SIDECARS].some((ext) => fs.existsSync(p + ext));
  let kept = base;
  for (let n = 2; taken(kept); n++) kept = base + '-' + n;
  fs.renameSync(dst, kept);
  for (const ext of SIDECARS) if (fs.existsSync(dst + ext)) fs.renameSync(dst + ext, kept + ext);
  return kept;
}

const removeDb = (f) => {
  for (const ext of ['', ...SIDECARS]) if (fs.existsSync(f + ext)) fs.unlinkSync(f + ext);
};

// --- modes ----------------------------------------------------------------------------

function modeCheck(file, opts = {}) {
  const s = snapshot(file);
  console.log('fleet-db-migrate --check ' + file);
  for (const t of Object.keys(TABLES))
    console.log(
      '  ' + (t + ':').padEnd(18) + (s.tables[t].present ? count(s, t) + ' rows' : 'TABLE ABSENT') +
        (TABLES[t].fenced ? ', max epoch ' + maxEpoch(s, t) : '')
    );
  console.log('  ' + 'pragmas:'.padEnd(18) + 'journal_mode=' + s.journal_mode + ' synchronous=' + s.synchronous +
    ' quick_check=' + s.quick_check);
  console.log(
    '  ' + 'wal:'.padEnd(18) +
      (s.wal > WAL_HEADER_BYTES
        ? s.wal + ' bytes of UNMERGED commits — copy the -wal too, or those claims are lost'
        : (s.wal ? s.wal + ' bytes (header only)' : 'absent') + ', nothing unmerged')
  );
  const bad = consistency(s);
  // Same rule as the proof: an empty fleet is a legitimate thing to migrate and an illegitimate
  // thing to discover by accident, so the tool says it rather than leaving a human to notice a
  // zero in a row count.
  if (FENCED.reduce((n, t) => n + count(s, t), 0) === 0 && !opts.allowEmpty)
    bad.push('no sessions and no seats — this db holds no fleet (pass --allow-empty if that is intended)');
  for (const b of bad.slice(0, MAX_NAMED)) console.log('  ! ' + b);
  if (bad.length > MAX_NAMED) console.log('  ! ... and ' + (bad.length - MAX_NAMED) + ' more');
  console.log(bad.length ? 'FAIL — ' + bad.length + ' problem(s)' : 'OK — no consistency problems');
  return bad.length ? 1 : 0;
}

function modeVerify(srcFile, dstFile, opts = {}) {
  const src = snapshot(srcFile);
  const dst = snapshot(dstFile);
  const { checked, per, extras, out, fail, warn, empty } = verify(src, dst, opts);
  console.log('fleet-db-migrate --verify');
  console.log('  src ' + srcFile);
  console.log('  dst ' + dstFile);
  for (const l of out) console.log(l);
  for (const w of warn) console.log('  ' + w);
  for (const f of fail.slice(0, MAX_NAMED)) console.log('  ' + f);
  if (fail.length > MAX_NAMED) console.log('  ... and ' + (fail.length - MAX_NAMED) + ' more');
  if (fail.length) {
    console.log('FAIL — ' + fail.length + ' fencing problem(s); do NOT bring the new home up on this db');
    return 1;
  }
  // The verdict names what it examined. "Zero regressions" over nothing is not a result, so a
  // proof that examined nothing says so in the same breath as the word PASS.
  console.log(
    'PASS — examined ' + checked + ' fenced src rows (sessions ' + per.sessions + ', seats ' + per.seats +
      '), zero epoch regressions, consistency clean on both sides, ' + extras +
      ' dst rows absent from src (dst max epoch: sessions ' + maxEpoch(dst, 'sessions') +
      ', seats ' + maxEpoch(dst, 'seats') + ')' +
      (empty ? ' [--allow-empty: this proof examined NOTHING]' : '')
  );
  return 0;
}

function modeCompareLive(snapFile, curFile) {
  const snap = snapshot(snapFile);
  const cur = snapshot(curFile);
  const drift = compareLive(snap, cur);
  console.log('fleet-db-migrate --compare-live');
  console.log('  snapshot ' + snapFile);
  console.log('  current  ' + curFile);
  for (const d of drift) console.log('  ' + d);
  for (const t of ['credits', 'credits_history'])
    if (count(snap, t) !== count(cur, t))
      console.log('  note: ' + t + ' ' + count(snap, t) + ' -> ' + count(cur, t) + ' rows (not fenced, but the snapshot is stale)');
  if (drift.length) {
    console.log('DRIFT — the source advanced after the snapshot; that snapshot is stale, redo the cutover');
    return 1;
  }
  console.log(
    'NO DRIFT — the source has not claimed since the snapshot ' +
      '(sessions max epoch ' + maxEpoch(cur, 'sessions') + ', seats max epoch ' + maxEpoch(cur, 'seats') + ')'
  );
  return 0;
}

function modeMigrate(srcFile, dstFile, opts = {}) {
  if (!fs.existsSync(srcFile)) usage('no such database: ' + srcFile);
  if (sameFile(srcFile, dstFile)) usage('src and dst are the same file');
  // The proof at the end would catch an empty source too, but only after the copy has been made
  // and the previous destination moved aside. Refuse before touching anything.
  if (!opts.allowEmpty) {
    const s = snapshot(srcFile);
    if (FENCED.reduce((n, t) => n + count(s, t), 0) === 0) {
      console.error(
        'fleet-db-migrate: ' + srcFile + ' holds no sessions and no seats. Migrating it would prove\n' +
          'nothing — check the path, or pass --allow-empty if the source really is an empty fleet.'
      );
      return 1;
    }
  }
  const existing = fs.existsSync(dstFile) || SIDECARS.some((e) => fs.existsSync(dstFile + e));
  if (existing && !opts.force) {
    console.error(
      'fleet-db-migrate: ' + dstFile + ' already exists. Overwriting it would replace a fleet\'s lease\n' +
        'state with another\'s — pass --force if that is genuinely what you mean.'
    );
    return 1;
  }

  console.log('fleet-db-migrate --migrate');
  const kept = existing ? preserve(dstFile) : null;
  if (kept) console.log('  kept the previous destination as ' + kept);

  copyDb(srcFile, dstFile);
  console.log('  copied ' + srcFile + ' -> ' + dstFile + (walBytes(srcFile) ? ' (with a ' + walBytes(srcFile) + '-byte -wal)' : ''));

  // Now, and only now — on the copy, where a write lock costs nothing.
  const db = new DatabaseSync(dstFile);
  try {
    if (String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase() !== 'wal') {
      db.exec('PRAGMA journal_mode = WAL');
      console.log('  note: the copy was not in WAL; set it, so the new home does not switch modes on its first boot');
    }
    const cp = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (cp.busy !== 0) throw new Error('wal_checkpoint reported busy=' + cp.busy + ' on the copy');
    console.log('  checkpointed the copy: ' + cp.checkpointed + ' frames merged, wal truncated');
  } finally {
    db.close();
  }
  // The proof runs against the source AS IT IS NOW, so a writer that advanced it during the
  // copy shows up here as a regression rather than as a quiet loss.
  const code = modeVerify(srcFile, dstFile, opts);
  if (code === 0) {
    // Closing a handle checkpoints and unlinks the sidecars, and the read-only verify above
    // re-created empty ones; drop them so what the operator ships is a single file. The guard is
    // the wal, always: a -wal with frames in it is data. The -shm is only sqlite's index into
    // that wal and is rebuilt on demand, so an empty wal makes both safe to remove.
    if (walBytes(dstFile) === 0)
      for (const ext of SIDECARS) if (fs.existsSync(dstFile + ext)) fs.unlinkSync(dstFile + ext);
  } else {
    removeDb(dstFile);
    console.error('fleet-db-migrate: verification failed — removed ' + dstFile + ' rather than leave an unfenced db in place.');
    if (kept) console.error('fleet-db-migrate: the previous destination is still at ' + kept + '; restore it by hand if you need it.');
  }
  return code;
}

// --- cli ------------------------------------------------------------------------------

function usage(msg) {
  if (msg) console.error('fleet-db-migrate: ' + msg);
  console.error(
    'usage:\n' +
      '  fleet-db-migrate.js --check <db> [--allow-empty]\n' +
      '  fleet-db-migrate.js --migrate <src> <dst> [--force] [--allow-empty] [--strict]\n' +
      '  fleet-db-migrate.js --verify <src> <dst> [--allow-empty] [--strict]\n' +
      '  fleet-db-migrate.js --compare-live <snapshot> <current>\n' +
      '\n' +
      '  --allow-empty  the source holds no fleet and that is intended (a proof over zero rows\n' +
      '                 proves nothing, so it is refused unless you say this)\n' +
      '  --strict       rows present in dst but absent from src FAIL instead of warning\n' +
      '  --force        overwrite an existing destination (it is moved aside, never deleted)'
  );
  process.exit(2);
}

const FLAGS = ['--force', '--allow-empty', '--strict'];

function main(argv) {
  const opts = {
    force: argv.includes('--force'),
    allowEmpty: argv.includes('--allow-empty'),
    strict: argv.includes('--strict'),
  };
  const args = argv.filter((a) => !FLAGS.includes(a));
  const [mode, ...rest] = args;
  const need = (n) => {
    if (rest.length !== n) usage(mode + ' takes exactly ' + n + ' path argument(s)');
    return rest;
  };
  switch (mode) {
    case '--check':
      return modeCheck(need(1)[0], opts);
    case '--migrate':
      return modeMigrate(...need(2), opts);
    case '--verify':
      return modeVerify(...need(2), opts);
    case '--compare-live':
      return modeCompareLive(...need(2));
    default:
      return usage(mode ? 'unknown mode ' + mode : null);
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { snapshot, verify, compareLive, consistency, copyDb, sameFile, main };
