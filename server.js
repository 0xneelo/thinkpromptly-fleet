const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = Number(process.env.PORT) || 3131;
const TAILNET_IP = '100.125.231.25'; // Mac's tailscale address; token broker for box workers
// Both default to today's values. A test instance binds the second listener on another
// loopback address so the split between the two listeners can be exercised for real.
const TAILNET_BIND = process.env.FLEET_TAILNET_BIND || TAILNET_IP;
const TAILNET_HOST = process.env.FLEET_TAILNET_HOST || TAILNET_IP + ':' + PORT;
// Overridable so a worker can run a throwaway instance beside the operator's live deck.
const HOSTS_FILE = process.env.FLEET_HOSTS_FILE || path.join(__dirname, 'hosts.json');
const DB_FILE = process.env.FLEET_DB || path.join(__dirname, 'fleet.db');
const HOSTS = () => JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8'));

// --- Lifecycle numbers (CONTRACT §Numbers, S2). Seconds in, milliseconds everywhere else.
const secs = (k, d) => {
  const v = Number(process.env[k]);
  return (Number.isFinite(v) && v > 0 ? v : d) * 1000;
};
const TTL_S = Number(process.env.FLEET_TTL_S) > 0 ? Number(process.env.FLEET_TTL_S) : 90;
const LEASE_TTL_MS = TTL_S * 1000;
// Suspect doubles as the appeal window: the time a suspect row has to beat before it is reaped.
const SUSPECT_WINDOW_MS = secs('FLEET_SUSPECT_WINDOW_S', 2 * TTL_S);
const REAPER_TICK_MS = secs('FLEET_REAPER_TICK_S', 30);
const CASCADE_K = Number(process.env.FLEET_CASCADE_K) >= 0 ? Number(process.env.FLEET_CASCADE_K) : 3;
const RETENTION_DAYS =
  Number(process.env.FLEET_RETENTION_DAYS) > 0 ? Number(process.env.FLEET_RETENTION_DAYS) : 14;
const RETENTION_MS = RETENTION_DAYS * 86400 * 1000;

// Every lifecycle timestamp is INTEGER unix-ms (S4). The legacy columns stay ISO strings and
// the two are never compared: msNow() feeds the new columns, now() the old ones.
const msNow = () => Date.now();
// Wall clock can jump (Mac sleep, NTP step); the reaper measures elapsed time with this.
const monoNow = () => Number(process.hrtime.bigint() / 1000000n);

// M14: every lifecycle transition is logged with its epoch and its reason. A reaper silently
// disabled by a config branch is defect 3; a fence that fires with no trace is as bad.
const lifecycleLog = (event, host, name, epoch, reason) =>
  console.log(
    '[lifecycle] ' + now() + ' ' + event + ' ' + host + '/' + name +
      ' epoch=' + (epoch === null || epoch === undefined ? '-' : epoch) + ' ' + reason
  );

// --- Session registry: this process is the only writer. Orchestrators classify sessions
// through /api/registry, and a row outlives the tmux session it describes — that is the
// point, a killed worker that reappears in `tmux ls` is then visible as evidence.

// `lease_state` is the marker column of this migration: its absence from an existing
// sessions table is exactly the state where a backup is worth having, and its presence means
// the migration already ran. Probing read-only leaves the file untouched, so the copy below
// is still taken before any writer is attached and can never be a torn WAL snapshot.
function migrationPending(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return false;
  let probe;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
  } catch (e) {
    return true; // unreadable by the probe: copy it before this process goes anywhere near it
  }
  try {
    const has = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .all();
    if (!has.length) return false; // no table to lose
    return !probe
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('sessions')
      .some((r) => r.name === 'lease_state');
  } finally {
    probe.close();
  }
}

// M10: the live db is the operator's only fleet history, so it is copied before the one boot
// that migrates it — not on every restart, which would grow a backup per day forever.
function backupDb(file) {
  if (!migrationPending(file)) return null;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dest = file + '.bak-' + stamp;
  if (fs.existsSync(dest)) return dest; // a retried migration must not overwrite the good copy
  fs.copyFileSync(file, dest);
  // -wal/-shm only exist while a writer is attached; copy them so the backup is replayable.
  for (const ext of ['-wal', '-shm'])
    if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, dest + ext);
  return dest;
}
backupDb(DB_FILE);

// M9: acknowledged commits must survive power loss, so both pragmas are set AND read back —
// a silent downgrade to synchronous=NORMAL is exactly defect 7. Throwing at boot is the point.
// Exported so the read-back can be tested against a db deliberately left on the wrong setting;
// sqlite's own default already satisfies it, which would make an in-place test vacuous.
function assertPragmas(handle) {
  const jm = String(handle.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase();
  const sy = Number(handle.prepare('PRAGMA synchronous').get().synchronous);
  if (jm !== 'wal') throw new Error('fleet.db journal_mode is ' + jm + ', expected wal');
  if (sy !== 2) throw new Error('fleet.db synchronous is ' + sy + ', expected 2 (FULL)');
}

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = FULL');
assertPragmas(db);

db.exec(
  `CREATE TABLE IF NOT EXISTS sessions (host TEXT, name TEXT, label TEXT DEFAULT '', role TEXT DEFAULT '', worker TEXT DEFAULT '', status TEXT DEFAULT 'active', note TEXT DEFAULT '', created_at TEXT, updated_at TEXT, last_seen_at TEXT, active_at TEXT, PRIMARY KEY (host, name))`
);
// Added after the table shipped; sqlite has no IF NOT EXISTS here, so a second boot throws.
// Additive only (M10): every column is nullable or defaulted, so seenStmt/touchStmt inserts
// that name none of them keep working, and no existing row is rewritten or dropped.
for (const col of [
  'msg_at TEXT',
  "grp TEXT DEFAULT ''",
  "task TEXT DEFAULT ''",
  // --- lifecycle (CONTRACT §Schema)
  'pid INTEGER',
  'parent_host TEXT',
  'parent_name TEXT',
  'epoch INTEGER',
  'expires_at INTEGER',
  'lease_state TEXT',
  'suspect_at INTEGER',
  'warned_at INTEGER',
  // reaped_at/reap_reason carry the 410 body (M2) and drive retention (S5); killed_at makes
  // the kill retry idempotent (M4); pinger_dead flags a session the second sample saved (M5).
  'reaped_at INTEGER',
  'reap_reason TEXT',
  'killed_at INTEGER',
  'pinger_dead INTEGER',
])
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN ' + col);
  } catch (e) {
    // Only "column already present" is expected here. A locked db, a full disk or a real SQL
    // error must not be swallowed into a half-migrated schema the server then serves from.
    if (!/duplicate column/i.test(e.message)) throw e;
  }

// Seats are the two desktop roles. A seat is never deleted by the reaper — an expired one
// goes suspect and stays visible, so a fenced-out orchestrator is evidence, not a gap (M13).
db.exec(
  `CREATE TABLE IF NOT EXISTS seats (seat TEXT PRIMARY KEY, owner_host TEXT, owner_name TEXT, epoch INTEGER, expires_at INTEGER, suspect_at INTEGER)`
);

const STATUSES = new Set(['active', 'done', 'kill-requested', 'killed', 'hidden']);
const REG_FIELDS = ['label', 'role', 'worker', 'status', 'note'];
// A session carries exactly ONE Linear issue key — the lane's main task. Anchored, so a
// list ("A-1,B-2") or any stray character is a rejection, not a silently stored string.
const TASK_RE = /^[A-Z][A-Z0-9]*-\d+$/;
const now = () => new Date().toISOString();

// A sighting never touches label/role/worker/status: those are the operator's classification.
// COALESCE on msg_at: a failed helper run leaves the last known timestamp standing.
const seenStmt = db.prepare(
  `INSERT INTO sessions (host, name, created_at, updated_at, last_seen_at, active_at, msg_at) VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(host, name) DO UPDATE SET last_seen_at = excluded.last_seen_at, active_at = excluded.active_at,
     msg_at = COALESCE(excluded.msg_at, sessions.msg_at)`
);

const touchStmt = db.prepare(
  `INSERT INTO sessions (host, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(host, name) DO NOTHING`
);
// Column names come from these lists, never from the body — values stay bound.
const updStmt = new Map(
  [...REG_FIELDS, 'grp', 'task'].map((f) => [
    f,
    db.prepare(`UPDATE sessions SET ${f} = ?, updated_at = ? WHERE host = ? AND name = ?`),
  ])
);

// Only fields present in the body are written, so a label POST can't blank a status.
// Every validation runs before any write, so a rejected body changes nothing.
function registryWrite(b) {
  if (b.status !== undefined && !STATUSES.has(b.status))
    return { code: 400, body: { ok: false, error: 'status must be one of ' + [...STATUSES].join(', ') } };
  if (b.group !== undefined && (typeof b.group !== 'string' || b.group.trim().length > 64))
    return { code: 400, body: { ok: false, error: 'group must be a string of at most 64 characters' } };
  if (b.task !== undefined) {
    const v = typeof b.task === 'string' ? b.task.trim() : null;
    if (v === null || (v !== '' && (v.length > 32 || !TASK_RE.test(v))))
      return {
        code: 400,
        body: { ok: false, error: 'task must be exactly one Linear issue key like XYZ-1484, or empty to clear it' },
      };
  }
  const t = now();
  touchStmt.run(b.host, b.name, t, t);
  for (const f of REG_FIELDS)
    if (typeof b[f] === 'string') updStmt.get(f).run(b[f], t, b.host, b.name);
  // `group` is a reserved word in SQL, so the column is grp; the API keeps the plain name.
  if (typeof b.group === 'string') updStmt.get('grp').run(b.group.trim(), t, b.host, b.name);
  if (typeof b.task === 'string') updStmt.get('task').run(b.task.trim(), t, b.host, b.name);
  return { code: 200, body: { ok: true } };
}

// --- Leases. fleet.db has exactly one writer and node:sqlite is synchronous, so every
// transition below is a single conditional UPDATE with no await inside it (M3): the reaper
// cannot read a row, yield, and then write back over a heartbeat that landed in between.
// Heartbeat is liveness-only by design — it carries no status field to mis-store, so
// defect 1's mechanism cannot occur; distress goes through registry status/note (S7).

// `mac` names desktop lanes on the operator's machine: leasable, never an ssh or kill target.
const LEASE_HOSTS = () => new Set([...HOSTS(), 'mac']);
const SEATS = new Set(['coordinator', 'orchestrator']);
const LEASE_STATES = new Set(['active', 'suspect', 'reaped']);

// Session name, worker and parent name all end up interpolated into a quote-free remote
// command (warn, kill, `name.py close <Name>`), so all three are held to SAFE_NAME.
function leaseIdent(b) {
  if (!LEASE_HOSTS().has(b.host) || !SAFE_NAME.test(b.name || ''))
    return { error: 'unknown host or bad session name' };
  return { host: b.host, name: b.name };
}

// M12: the parent edge is written here and nowhere else, and it is validated before it is
// stored — an unvalidated edge is tree corruption by any peer that can reach the endpoint.
function leaseOptional(b) {
  if (b.pid !== undefined && b.pid !== null && !(Number.isInteger(b.pid) && b.pid > 0 && b.pid <= 2 ** 31))
    return 'pid must be a positive integer';
  for (const f of ['worker', 'role'])
    if (b[f] !== undefined && b[f] !== null && b[f] !== '' && !SAFE_NAME.test(String(b[f])))
      return f + ' must be letters, digits, _ or - (it reaches a quote-free remote command)';
  const hasHost = b.parent_host !== undefined && b.parent_host !== null && b.parent_host !== '';
  const hasName = b.parent_name !== undefined && b.parent_name !== null && b.parent_name !== '';
  if (hasHost !== hasName) return 'parent_host and parent_name must be given together';
  if (hasHost) {
    if (!LEASE_HOSTS().has(b.parent_host)) return 'unknown parent_host';
    if (!SAFE_NAME.test(String(b.parent_name))) return 'bad parent_name';
    if (b.parent_host === b.host && b.parent_name === b.name)
      return 'a session cannot be its own parent';
  }
  return null;
}

const leaseRow = db.prepare('SELECT * FROM sessions WHERE host = ? AND name = ?');

// epoch++ fences the prior incarnation of a reused (host,name): tmux names come back and the
// orchestrator number pool reuses N, so a re-claim must succeed and invalidate the old one (M1).
const claimStmt = db.prepare(
  `UPDATE sessions SET epoch = COALESCE(epoch, 0) + 1, lease_state = 'active', expires_at = ?,
     suspect_at = NULL, warned_at = NULL, reaped_at = NULL, reap_reason = NULL,
     killed_at = NULL, pinger_dead = NULL,
     pid = ?, parent_host = ?, parent_name = ?,
     worker = COALESCE(?, worker), role = COALESCE(?, role),
     updated_at = ?, last_seen_at = ?
   WHERE host = ? AND name = ?`
);

const opt = (v) => (v === undefined || v === null || v === '' ? null : v);

function leaseClaim(b) {
  const id = leaseIdent(b);
  if (id.error) return { code: 400, body: { ok: false, error: id.error } };
  const bad = leaseOptional(b);
  if (bad) return { code: 400, body: { ok: false, error: bad } };
  // A claim must not land on a (host,name) whose predecessor's `tmux kill-session` is still in
  // flight: that command names only the session, so it would take the new session with it. The
  // window is one ssh round trip, and the re-claim M1 requires simply succeeds a moment later.
  if (REAPER.killing.has(id.host + '\0' + id.name))
    return {
      code: 409,
      body: {
        ok: false,
        error: 'a kill is in flight for this session — retry in a few seconds',
        current_epoch_hint: false,
      },
    };
  // A claim over a row whose kill was never confirmed still succeeds — M1 requires it, and tmux
  // names are unique, so a new session under this name is itself evidence the old one is gone.
  // What it does do is drop a standing kill obligation, and the row is the only record of it.
  const prior = leaseRow.get(id.host, id.name);
  if (prior && prior.lease_state === 'reaped' && prior.killed_at === null && prior.host !== 'mac') {
    lifecycleLog('kill-obligation-dropped', id.host, id.name, prior.epoch, 're-claimed before its kill was ever confirmed');
    raiseAlert(id.host, id.name + ' was re-claimed while a kill for epoch ' + prior.epoch + ' was still owed');
  }
  const t = now();
  const expiresAt = msNow() + LEASE_TTL_MS;
  db.exec('BEGIN IMMEDIATE');
  let r;
  try {
    touchStmt.run(id.host, id.name, t, t);
    // pid and the parent edge belong to THIS incarnation: a reused (host,name) is usually a
    // different session, and inheriting its predecessor's edge is how a tree gets corrupted.
    // worker/role are the operator's classification, so an omitted one is kept, not blanked.
    claimStmt.run(
      expiresAt, opt(b.pid), opt(b.parent_host), opt(b.parent_name), opt(b.worker), opt(b.role),
      t, t, id.host, id.name
    );
    r = leaseRow.get(id.host, id.name);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  lifecycleLog('claim', id.host, id.name, r.epoch, 'lease claimed');
  return { code: 200, body: { ok: true, epoch: r.epoch, expires_at: r.expires_at, ttl_s: TTL_S } };
}

// Only the current epoch renews, and only from active/suspect — a paused zombie that omits
// or replays an epoch moves nothing (M2). The 409 body deliberately carries no epoch value:
// telling a stale caller the current number would hand it the fence it just failed.
const beatStmt = db.prepare(
  `UPDATE sessions SET expires_at = ?, lease_state = 'active', suspect_at = NULL, warned_at = NULL,
     pinger_dead = NULL, last_seen_at = ?
   WHERE host = ? AND name = ? AND epoch = ? AND lease_state IN ('active', 'suspect')`
);
// A seat's clock is its holder session's beat (M13), renewed in the same transaction so a
// seat can never outlive the session holding it.
const seatRenewStmt = db.prepare(
  `UPDATE seats SET expires_at = ?, suspect_at = NULL WHERE owner_host = ? AND owner_name = ?`
);

const gone = (r) => ({
  code: 410,
  body: { ok: false, reason: r.reap_reason || 'reaped', reaped_at: r.reaped_at },
});
const fenced = (why) => ({ code: 409, body: { ok: false, error: why, current_epoch_hint: false } });

function heartbeat(b) {
  const id = leaseIdent(b);
  if (id.error) return { code: 400, body: { ok: false, error: id.error } };
  const r = leaseRow.get(id.host, id.name);
  if (!r) return { code: 404, body: { ok: false, error: 'no lease for this session — claim first' } };
  // A reaped row is a tombstone: it answers 410 to every epoch and never resurrects (M2).
  if (r.lease_state === 'reaped') return gone(r);
  if (r.epoch === null || r.lease_state === null)
    return fenced('no active lease — claim first');
  if (!Number.isInteger(b.epoch) || b.epoch !== r.epoch)
    return fenced('stale or missing epoch — re-claim');

  const t = now();
  const expiresAt = msNow() + LEASE_TTL_MS;
  let changed;
  let after;
  db.exec('BEGIN IMMEDIATE');
  try {
    changed = beatStmt.run(expiresAt, t, id.host, id.name, b.epoch).changes;
    // Only a beat that was itself accepted renews the seat its sender holds.
    if (changed) seatRenewStmt.run(expiresAt, id.host, id.name);
    after = leaseRow.get(id.host, id.name);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // Belt and braces: the read above and this write are one synchronous run, so a lost race is
  // impossible today — but the row is re-read rather than assumed, so it stays true if it isn't.
  if (!changed) return after && after.lease_state === 'reaped' ? gone(after) : fenced('lease not renewable');
  return {
    code: 200,
    body: { ok: true, expires_at: after.expires_at, ttl_s: TTL_S, lease_state: after.lease_state },
  };
}

// --- Seats. Two desktop roles on the operator's Mac. Loopback-only (M13): a tailnet peer that
// could seize the orchestrator seat would fence the real orchestrator out of its own fleet.
const seatRow = db.prepare('SELECT * FROM seats WHERE seat = ?');
const seatsAll = db.prepare('SELECT * FROM seats ORDER BY seat');
// Every claim takes the next number ACROSS both seats, not per seat. Per-seat counters would
// both start at 1, and the fence below matches on the number alone — a coordinator epoch that
// happened to equal the live orchestrator epoch would pass a fence it never earned.
const nextSeatEpoch = db.prepare('SELECT COALESCE(MAX(epoch), 0) + 1 AS e FROM seats');
const seatClaimStmt = db.prepare(
  `INSERT INTO seats (seat, owner_host, owner_name, epoch, expires_at, suspect_at)
     VALUES (?, ?, ?, ?, ?, NULL)
   ON CONFLICT(seat) DO UPDATE SET owner_host = excluded.owner_host, owner_name = excluded.owner_name,
     epoch = excluded.epoch, expires_at = excluded.expires_at, suspect_at = NULL`
);

function seatClaim(b) {
  if (!SEATS.has(b.seat))
    return { code: 400, body: { ok: false, error: 'seat must be one of ' + [...SEATS].join(', ') } };
  const id = leaseIdent({ host: b.owner_host, name: b.owner_name });
  if (id.error) return { code: 400, body: { ok: false, error: 'owner: ' + id.error } };
  const expiresAt = msNow() + LEASE_TTL_MS;
  let r;
  db.exec('BEGIN IMMEDIATE');
  try {
    seatClaimStmt.run(b.seat, id.host, id.name, nextSeatEpoch.get().e, expiresAt);
    r = seatRow.get(b.seat);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  lifecycleLog('seat-claim', id.host, id.name, r.epoch, 'seat ' + b.seat);
  return {
    code: 200,
    body: { ok: true, seat: b.seat, epoch: r.epoch, expires_at: r.expires_at, ttl_s: TTL_S },
  };
}

// --- Fencing (M17). The spec promises every privileged write carries its epoch; these three
// paths predate it and carried none, so today a zombie orchestrator on loopback can kill any
// session and delete any row. Agent calls send no Origin (the server.js:509-514 pattern) and
// must prove a live seat; the operator's browser is exempt, because the deck UI IS the seat.
const seatLive = db.prepare(
  'SELECT seat FROM seats WHERE epoch = ? AND suspect_at IS NULL AND expires_at >= ?'
);
const seatCount = db.prepare('SELECT count(*) c FROM seats');
// strict: a privileged agent write always needs a live seat_epoch. bootstrap (the default):
// while no seat has ever been claimed there is no current seat to prove, so the gate stands
// open — fencing against a seat that cannot yet exist would lock out every worker on day one.
const FENCE_MODE = process.env.FLEET_FENCE === 'strict' ? 'strict' : 'bootstrap';

// The seat fence is the LOOPBACK credential. Seats are loopback-only by M13, so a box worker
// on the tailnet has no route by which it could ever obtain a seat_epoch — fencing its
// registry writes on one would lock every worker out the moment the operator claims a seat.
// The tailnet's own credential is the shared bearer key (S3), which is what the coverage table
// points at for the same defect. See the operator:gate issue filed against this reading.
function fenceCheck(req, b, viaTailnet) {
  if (viaTailnet) return null;
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) return null;
  if (FENCE_MODE === 'bootstrap' && seatCount.get().c === 0) return null;
  if (!Number.isInteger(b.seat_epoch))
    return {
      code: 409,
      body: {
        ok: false,
        error: 'seat_epoch required — this write is fenced to the current orchestrator/coordinator seat',
      },
    };
  if (!seatLive.get(b.seat_epoch, msNow()))
    return {
      code: 409,
      body: { ok: false, error: 'stale seat_epoch — that seat has been taken or has expired' },
    };
  return null;
}

// S3: one shared bearer key on the tailnet listener's writes. The Host-header check alone is
// spoofable by any peer on the tailnet; loopback is exempt, since reaching it means being on
// this Mac already. Unset (the default) keeps today's box workers working — configure to arm.
const TAILNET_KEY = (process.env.FLEET_TAILNET_KEY || '').trim();
const safeCompare = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest()
  );
function tailnetAuthed(req) {
  if (!TAILNET_KEY) return true;
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return !!m && safeCompare(m[1], TAILNET_KEY);
}

// Irreversible on the box, so the row is only marked killed when tmux actually agreed.
async function kill(host, name) {
  const { err, stderr } = await ssh(host, 'wsl tmux kill-session -t ' + name);
  if (!err) registryWrite({ host, name, status: 'killed' });
  return { ok: !err, stderr: stderr.trim() };
}

const HOME = os.homedir();
const SSH_DIR = path.join(HOME, '.ssh');
const CERTS_DIR = path.join(SSH_DIR, 'deploy-certs');
const MINT_SH = path.join(__dirname, 'deploy-keys', 'mint-deploy-cert.sh');
const GH_ENV = path.join(__dirname, 'deploy-keys', 'github-app.env');
const OP_AGENT_SOCK = path.join(HOME, 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock');

// Quote-free rule: `ssh german-box <cmd>` traverses zsh -> Windows CMD -> wsl -> bash.
// Nested quotes are mangled at some layer and there is no reliable escaping, so every
// remote command string must contain ZERO quote characters. Session names are the only
// interpolated value; anything outside this charset is rejected rather than escaped.
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// Local-only: any other web origin could otherwise open /term into a live worker tmux.
const ALLOWED_HOSTS = new Set(['localhost:' + PORT, '127.0.0.1:' + PORT]);
const ALLOWED_ORIGINS = new Set(['http://localhost:' + PORT, 'http://127.0.0.1:' + PORT]);

// node-pty throws synchronously on a bad size, which would kill the process.
const dim = (v, fallback) => (Number.isInteger(v) && v >= 1 && v <= 1000 ? v : fallback);

const SSH_OPTS = { timeout: 15000, killSignal: 'SIGKILL' };

// Never rejects: callers need stderr/exit info (tmux and pgrep exit non-zero normally).
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      resolve({ err, stdout: stdout || '', stderr: stderr || '' })
    );
  });
}

// BatchMode: no interactive auth fallback — a locked 1Password agent fails fast with
// its message on stderr instead of hanging until the 15s kill.
// The binary is overridable so tests can drive a fake host poller with the same argv shape;
// unset, this is the plain `ssh` it has always been.
const SSH_BIN = process.env.FLEET_SSH_BIN || 'ssh';
const ssh = (host, remoteCmd) =>
  run(SSH_BIN, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, remoteCmd], SSH_OPTS);

const AGENT_LOCKED = 'communication with agent failed';

// Quote-free format string: no leading #, no comma inside braces, no $ — it survives
// CMD -> wsl -> bash intact (verified against the box).
const TMUX_LS = 'wsl tmux ls -F n=#{session_name},a=#{session_activity},c=#{session_created}';
// Reads each session pane's Claude Code transcript and prints name<TAB>iso<TAB>msg|mtime.
// Master copy: box/fleet-lastmsg.sh — the box may not have it installed, hence the soft fail.
const LAST_MSG = 'wsl bash /home/vibe/bin/fleet-lastmsg.sh';
const iso = (unix) => new Date(Number(unix) * 1000).toISOString();
// The Windows -> wsl pipeline can turn line ends into CRLF, and a stray \r makes every
// pattern below miss — which would silently mark the whole fleet gone.
const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, ''));

async function sessions() {
  const out = { sessions: [], errors: [] };
  const live = [];
  await Promise.all(
    HOSTS().map(async (host) => {
      const [ls, lm] = await Promise.all([ssh(host, TMUX_LS), ssh(host, LAST_MSG)]);
      const { err, stdout, stderr } = ls;
      const blob = (stdout + stderr).toLowerCase();
      if (err && !blob.includes('no server running') && !blob.includes('no sessions')) {
        out.errors.push({ host, message: (stderr.trim() || err.message).slice(0, 500) });
        return;
      }
      // A missing script or ssh failure just leaves the map empty: rows keep their stored value.
      const msgAt = new Map();
      for (const line of lines(lm.stdout)) {
        const m = line.match(/^(\S+)\t(\S+)\t/);
        if (m && !Number.isNaN(Date.parse(m[2]))) msgAt.set(m[1], new Date(m[2]).toISOString());
      }
      for (const line of lines(stdout)) {
        const m = line.match(/^n=(.+),a=(\d+),c=(\d+)$/);
        if (m) {
          const name = m[1].trim();
          live.push({
            host,
            name,
            activeAt: iso(m[2]),
            createdAt: iso(m[3]),
            msgAt: msgAt.get(name) || null,
          });
        }
      }
    })
  );

  const t = now();
  for (const s of live) seenStmt.run(s.host, s.name, s.createdAt, t, t, s.activeAt, s.msgAt);
  const reg = new Map(
    db.prepare('SELECT * FROM sessions').all().map((r) => [r.host + '\0' + r.name, r])
  );
  // M11: the row whitelist is what Lane 3 renders from, so the lifecycle columns have to be on
  // it or the org chart is hard-blocked. `live` is the contract's definition — tmux-live OR a
  // held lease — which is the only way a mac desktop row can ever read as alive: it never
  // appears in `tmux ls`. `tmux_live` is kept alongside so the tree can still tell the two
  // apart: a reaped box row renders grey until its kill lands, a mac row renders 🪦.
  const row = (r, isLive) => ({
    host: r.host,
    name: r.name,
    label: r.label,
    role: r.role,
    worker: r.worker,
    status: r.status,
    note: r.note,
    group: r.grp,
    task: r.task,
    last_seen_at: r.last_seen_at,
    active_at: r.active_at,
    msg_at: r.msg_at,
    pid: r.pid,
    parent_host: r.parent_host,
    parent_name: r.parent_name,
    epoch: r.epoch,
    lease_state: r.lease_state,
    expires_at: r.expires_at,
    suspect_at: r.suspect_at,
    warned_at: r.warned_at,
    reaped_at: r.reaped_at,
    pinger_dead: r.pinger_dead,
    tmux_live: isLive,
    live: isLive || r.lease_state === 'active',
  });
  for (const s of live) out.sessions.push(row(reg.get(s.host + '\0' + s.name), true));
  // Registry rows with no live session stay in the list — a killed or vanished worker
  // must not silently disappear.
  for (const [k, r] of reg)
    if (!live.some((s) => s.host + '\0' + s.name === k)) out.sessions.push(row(r, false));
  return out;
}

// --- Reaper: active -> suspect -> reaped. Every transition is one conditional UPDATE whose
// WHERE clause re-states the precondition, so a heartbeat that lands between this tick's read
// and its write simply makes the write match nothing (M3). Nothing here reads a row, awaits,
// and then writes that row's lease_state on the strength of what it read.
const REAPER = {
  lastTickAt: null, // wall ms; /api/health surfaces it so a stopped reaper is visible (M14)
  ticks: 0,
  lastMono: monoNow(),
  lastWall: msNow(),
  // M7: nothing is reaped for one full suspect window after boot. The deck runs foreground on
  // the operator's Mac and dies with it, so a restart must not mass-expire the fleet it finds.
  graceUntilMono: monoNow() + SUSPECT_WINDOW_MS,
  graceReason: 'boot',
  alerts: [],
  killing: new Set(), // host\0name with a kill in flight — at most one per row (M4)
};

const ALERT_MAX = 50;
function raiseAlert(host, message) {
  REAPER.alerts.push({ at: msNow(), host, message });
  if (REAPER.alerts.length > ALERT_MAX) REAPER.alerts.shift();
  console.error('[lifecycle-alert] ' + now() + ' ' + (host || 'fleet') + ' ' + message);
}

const leasedRows = db.prepare(
  "SELECT * FROM sessions WHERE lease_state IN ('active', 'suspect', 'reaped')"
);
const suspectStmt = db.prepare(
  `UPDATE sessions SET lease_state = 'suspect', suspect_at = ?, warned_at = NULL
   WHERE host = ? AND name = ? AND epoch = ? AND lease_state = 'active' AND expires_at < ?`
);
const warnedStmt = db.prepare(
  `UPDATE sessions SET warned_at = ?
   WHERE host = ? AND name = ? AND epoch = ? AND lease_state = 'suspect' AND warned_at IS NULL`
);
// The appeal window is enforced in the WHERE clause, not in the caller: a row whose warn is
// too young simply does not match, however the candidate list was computed.
const reapStmt = db.prepare(
  `UPDATE sessions SET lease_state = 'reaped', reaped_at = ?, reap_reason = ?
   WHERE host = ? AND name = ? AND epoch = ? AND lease_state = 'suspect'
     AND warned_at IS NOT NULL AND warned_at <= ? AND expires_at < ?`
);
const killedStmt = db.prepare(
  `UPDATE sessions SET killed_at = ?
   WHERE host = ? AND name = ? AND epoch = ? AND lease_state = 'reaped' AND killed_at IS NULL`
);
const pingerDeadStmt = db.prepare(
  `UPDATE sessions SET pinger_dead = 1
   WHERE host = ? AND name = ? AND epoch = ? AND lease_state = 'suspect'`
);
const seatSuspectStmt = db.prepare(
  'UPDATE seats SET suspect_at = ? WHERE expires_at < ? AND suspect_at IS NULL'
);
// S5: reaped rows are the only thing that accumulates — heartbeats update in place and no
// history row is ever written, so retention is one DELETE rather than a log rotation.
// A box row whose kill never landed is kept past the window on purpose: deleting it ends the
// retry contract for a session nobody ever confirmed dead, and the next poll would re-create it
// as a fresh sighting with no lifecycle history at all. `mac` rows are never killed, so they
// are the one kind that prunes on age alone.
const retentionStmt = db.prepare(
  `DELETE FROM sessions WHERE lease_state = 'reaped' AND reaped_at IS NOT NULL AND reaped_at < ?
     AND (killed_at IS NOT NULL OR host = 'mac')`
);

// One ssh, one answer: name -> last tmux activity in unix MILLISECONDS, or ok:false when the
// host could not be reached at all. "Unreachable" must never read as "every session is dead",
// and the fleet-wide poll and the per-session re-check must never drift apart on the wording
// tmux uses or the format it prints — so both go through here.
async function tmuxSample(host) {
  const { err, stdout, stderr } = await ssh(host, TMUX_LS);
  const blob = (stdout + stderr).toLowerCase();
  const empty = blob.includes('no server running') || blob.includes('no sessions');
  if (err && !empty) return { ok: false, sessions: new Map() };
  const sessions = new Map();
  for (const line of lines(stdout)) {
    const g = line.match(/^n=(.+),a=(\d+),c=(\d+)$/);
    if (g) sessions.set(g[1].trim(), Number(g[2]) * 1000);
  }
  return { ok: true, sessions };
}

// The second, independent liveness source for the whole fleet, taken once at the top of a tick.
async function pollHosts() {
  const sample = new Map();
  await Promise.all(HOSTS().map(async (host) => sample.set(host, await tmuxSample(host))));
  return sample;
}

// M5 wants the liveness sample taken immediately before the kill, not once per tick: a tick can
// spend tens of seconds in the warn phase's sequential ssh calls, and a session that came back
// during that window must not die on evidence that old.
async function sampleSession(host, name) {
  if (host === 'mac') return { ok: true, activeAt: undefined }; // never appears in `tmux ls`
  const s = await tmuxSample(host);
  return s.ok ? { ok: true, activeAt: s.sessions.get(name) } : { ok: false };
}

// M15: quote-free (server.js:95-99) and a single token — the warn crosses ssh -> CMD -> wsl ->
// bash, where a space would split it into arguments tmux then rejects.
const WARN_TEXT = 'fleetdeck-lease-expiring-heartbeat-now-or-this-session-is-reaped';

async function warnSuspect(r) {
  // A mac row has no tmux to display into; its appeal path is the 410 body it gets when it
  // comes back and beats. Marking it warned is what lets it eventually be tombstoned.
  if (r.host === 'mac') return { ok: true, note: 'mac row — 410 body is the appeal path' };
  const { err, stderr } = await ssh(
    r.host,
    'wsl tmux display-message -d 10000 -t ' + r.name + ' ' + WARN_TEXT
  );
  return { ok: !err, note: (stderr || '').trim().slice(0, 200) };
}

// The Name pool lives on the operator's Mac. Unconfigured, the reaper logs and skips instead of
// releasing a Name it cannot see — a box test instance must never free a live agent's Name.
const NAME_CLOSE_SCRIPT = process.env.FLEET_NAME_CLOSE_SCRIPT || '';
async function nameClose(r) {
  if (r.host === 'mac') return; // never for a desktop row: the session may still be alive
  if (!NAME_CLOSE_SCRIPT)
    return lifecycleLog('name-skip', r.host, r.name, r.epoch, 'no FLEET_NAME_CLOSE_SCRIPT set');
  if (!r.worker || !SAFE_NAME.test(r.worker))
    return lifecycleLog('name-skip', r.host, r.name, r.epoch, 'row carries no usable worker Name');
  const { err, stderr } = await run('python3', [NAME_CLOSE_SCRIPT, 'close', r.worker], {
    timeout: 15000,
  });
  lifecycleLog(
    err ? 'name-close-failed' : 'name-closed',
    r.host, r.name, r.epoch,
    err ? (stderr || '').trim().slice(0, 200) : r.worker
  );
}

// M4: the row is already `reaped` before this runs — the fence commits first, the kill second,
// the Name last. A crash anywhere here leaves a fenced row whose kill the next tick retries.
async function killReaped(r) {
  const key = r.host + '\0' + r.name;
  if (r.host === 'mac' || REAPER.killing.has(key)) return;
  // The row is re-read rather than trusted from the caller's snapshot. `tmux kill-session` names
  // its target, and this design expects names to be reused — so a row that has already been
  // re-claimed under a new epoch must not have its successor killed in its place.
  const cur = leaseRow.get(r.host, r.name);
  if (!cur || cur.epoch !== r.epoch || cur.lease_state !== 'reaped' || cur.killed_at !== null) return;
  REAPER.killing.add(key);
  try {
    const { err, stderr } = await ssh(r.host, 'wsl tmux kill-session -t ' + r.name);
    const blob = (stderr || '').toLowerCase();
    // tmux saying the session is not there is the outcome we wanted, not a failure to retry.
    const gone = !err || blob.includes('find session') || blob.includes('no server running');
    if (!gone) {
      lifecycleLog('kill-failed', r.host, r.name, r.epoch, blob.trim().slice(0, 200) || 'kill failed');
      return;
    }
    // CAS again: if the row moved while the kill was in flight, this process has just killed a
    // tmux session that belongs to a newer incarnation. Say so loudly and touch nothing else —
    // stamping the live successor `killed` and releasing its Name is the compounding harm.
    if (!killedStmt.run(msNow(), r.host, r.name, r.epoch).changes) {
      lifecycleLog('kill-orphaned', r.host, r.name, r.epoch, 'row moved on while the kill was in flight');
      raiseAlert(r.host, r.name + ' changed incarnation while its predecessor was being killed');
      return;
    }
    registryWrite({ host: r.host, name: r.name, status: 'killed' });
    lifecycleLog('killed', r.host, r.name, r.epoch, 'tmux session gone');
    await nameClose(cur);
  } finally {
    REAPER.killing.delete(key);
  }
}

async function reaperTick() {
  const wall = msNow();
  const mono = monoNow();
  // M7: wall and monotonic clocks are read together and compared by elapsed time. A wall jump
  // bigger than one TTL means the machine slept or NTP stepped, so every stored expires_at is
  // now meaningless — re-arm the grace rather than believe the fleet all died at once.
  const drift = Math.abs(wall - REAPER.lastWall - (mono - REAPER.lastMono));
  if (REAPER.ticks > 0 && drift > LEASE_TTL_MS) {
    REAPER.graceUntilMono = mono + SUSPECT_WINDOW_MS;
    REAPER.graceReason = 'clock-jump';
    raiseAlert(null, 'wall clock jumped ' + drift + 'ms — no reaps for one suspect window');
  }
  REAPER.lastWall = wall;
  REAPER.lastMono = mono;
  const inGrace = mono < REAPER.graceUntilMono;

  const sample = await pollHosts(); // the one await before any transition

  seatSuspectStmt.run(wall, wall); // an expired seat goes suspect, never deleted (M13)

  // 1. active -> suspect. Skipped in grace: marking the whole fleet suspect on a Mac wake would
  //    warn every session for something the clock did, not something the sessions did.
  if (!inGrace)
    for (const r of leasedRows.all())
      if (r.lease_state === 'active' && r.expires_at < wall)
        if (suspectStmt.run(wall, r.host, r.name, r.epoch, wall).changes)
          lifecycleLog('suspect', r.host, r.name, r.epoch, 'lease expired at ' + r.expires_at);

  // 2. Warn phase, durable and idempotent (M15). warned_at is set only after delivery, so a
  //    warn lost to a restart or an ssh failure is re-sent on the next tick — and a reap is
  //    gated on warned_at, so an undelivered warn can never be followed by a kill.
  for (const r of leasedRows.all()) {
    if (r.lease_state !== 'suspect' || r.warned_at !== null) continue;
    const w = await warnSuspect(r);
    if (!w.ok) {
      lifecycleLog('warn-failed', r.host, r.name, r.epoch, w.note || 'warn delivery failed');
      continue;
    }
    // CAS again rather than trusting the row read before the await: a heartbeat landing during
    // delivery moves the row back to active, and this write then matches nothing.
    if (warnedStmt.run(msNow(), r.host, r.name, r.epoch).changes)
      lifecycleLog('warned', r.host, r.name, r.epoch, w.note || 'appeal window open');
  }

  if (!inGrace) {
    const cut = wall - SUSPECT_WINDOW_MS;
    const rows = leasedRows.all();
    const candidates = rows.filter(
      (r) =>
        r.lease_state === 'suspect' &&
        r.warned_at !== null &&
        r.warned_at <= cut &&
        r.expires_at < wall
    );

    // 3. Cascade guard (M6). A partition, a sleeping Mac or a dead box looks exactly like a
    //    fleet that all died at once; when it does, the reaper does nothing and says so.
    const perHost = new Map();
    for (const r of candidates) perHost.set(r.host, (perHost.get(r.host) || 0) + 1);
    const livePerHost = new Map();
    for (const r of rows)
      if (r.lease_state !== 'reaped') livePerHost.set(r.host, (livePerHost.get(r.host) || 0) + 1);

    const trips = [];
    if (candidates.length > CASCADE_K)
      trips.push([null, candidates.length + ' sessions would be reaped in one tick (K=' + CASCADE_K + ')']);
    for (const [host, n] of perHost) {
      const s = sample.get(host);
      if (host !== 'mac' && (!s || !s.ok)) trips.push([host, 'ssh poll is failing']);
      // `n > 1` is deliberate. M6 guards against a fleet-wide mass kill after a partition; read
      // literally, "every session on one host" would also cover a host with exactly one leased
      // session, and that host's last session could then never be reaped at all.
      if (n > 1 && n >= (livePerHost.get(host) || 0))
        trips.push([host, 'every session on this host would be reaped in one tick']);
    }
    if (trips.length) {
      for (const [host, why] of trips) raiseAlert(host, 'cascade guard: ' + why + ' — no reaps this tick');
    } else {
      for (const r of candidates) {
        // 4. Second liveness sample (M5), taken now rather than read from the tick's opening
        //    poll. Heartbeat and tmux are independent evidence; a session with a dead pinger but
        //    a live terminal is a broken pinger, not a corpse.
        const fresh = await sampleSession(r.host, r.name);
        if (!fresh.ok) {
          lifecycleLog('reap-deferred', r.host, r.name, r.epoch, 'host stopped answering mid-tick');
          continue;
        }
        const at = msNow();
        if (fresh.activeAt !== undefined && at - fresh.activeAt < SUSPECT_WINDOW_MS) {
          pingerDeadStmt.run(r.host, r.name, r.epoch);
          raiseAlert(r.host, r.name + ' has a dead pinger but an active tmux session — not killed');
          lifecycleLog('pinger-dead', r.host, r.name, r.epoch, 'tmux active ' + (at - fresh.activeAt) + 'ms ago');
          continue;
        }
        if (!reapStmt.run(at, 'lease expired', r.host, r.name, r.epoch, cut, at).changes) continue;
        lifecycleLog('reaped', r.host, r.name, r.epoch, 'no heartbeat, no tmux activity');
        // Kill straight away, so the gap between the evidence and the kill stays as small as the
        // ssh round trip. The pass below then only picks up rows an earlier tick left behind.
        await killReaped(leaseRow.get(r.host, r.name));
      }
    }

    // 5. Retries for rows an earlier tick fenced but never confirmed killed (M4). Bounded two
    //    ways: a host this tick could not reach is skipped rather than waited on for a full ssh
    //    timeout, and no more than K are attempted per tick — otherwise one permanently dead
    //    host with N stuck rows costs N timeouts every tick and stalls the whole fleet's sweep.
    const retries = leasedRows
      .all()
      .filter((r) => r.lease_state === 'reaped' && r.killed_at === null && r.host !== 'mac')
      .filter((r) => {
        const s = sample.get(r.host);
        return s && s.ok;
      })
      .slice(0, Math.max(1, CASCADE_K));
    for (const r of retries) await killReaped(r);

    const pruned = retentionStmt.run(wall - RETENTION_MS).changes;
    if (pruned) lifecycleLog('retention', 'fleet', '-', null, pruned + ' reaped rows past ' + RETENTION_DAYS + 'd');
  }

  REAPER.ticks += 1;
  REAPER.lastTickAt = msNow();
  return { ticks: REAPER.ticks, inGrace, lastTickAt: REAPER.lastTickAt };
}

// A slow ssh must not stack ticks on top of each other; a skipped tick is visible as a stale
// reaper_last_tick_at, which is the whole point of M14.
let reaping = false;
async function reaperLoop() {
  if (reaping) return;
  reaping = true;
  try {
    await reaperTick();
  } catch (e) {
    console.error('reaper tick failed:', e.message);
  } finally {
    reaping = false;
  }
}

// M14: the tick age is the only way a stopped reaper is visible before the leak it allows —
// defect 3 was a reaper silently switched off by a config branch, found months later.
// NOTE for Lane 3: this is now an object, not the bare host array it used to be. The hosts are
// under `hosts`; everything else is reaper observability.
async function health() {
  const hosts = await Promise.all(
    HOSTS().map(async (host) => {
      // holderOk: a disconnected RDP session for user Vibe is what keeps WSL alive on the box.
      const [q, p] = await Promise.all([
        ssh(host, 'qwinsta'),
        ssh(host, 'wsl pgrep -f sleep.infinity'), // dot matches the space, quote-free
      ]);
      // null = the ssh itself failed, so we can't claim anything about the holder
      const holderOk = q.err
        ? null
        : q.stdout.split('\n').some((l) => {
            const t = l.trim().split(/\s+/);
            return t.includes('Vibe') && t.includes('Disc');
          });
      const wslAlive = p.err ? null : /\d/.test(p.stdout.trim());
      const agentLocked = (q.stderr + p.stderr).includes(AGENT_LOCKED);
      return { host, holderOk, wslAlive, agentLocked };
    })
  );
  return {
    hosts,
    reaper_last_tick_at: REAPER.lastTickAt,
    reaper_ticks: REAPER.ticks,
    reaper_tick_s: REAPER_TICK_MS / 1000,
    reaper_grace: monoNow() < REAPER.graceUntilMono ? REAPER.graceReason : null,
    fence_mode: FENCE_MODE,
    ttl_s: TTL_S,
    alerts: REAPER.alerts.slice(-10),
  };
}

// ssh-keygen -Lf prints one indented block per cert; every field is optional on a
// hand-made cert, so a miss is null rather than a throw.
function parseCert(dir, out) {
  const one = (re) => (out.match(re) || [])[1] || null;
  const block = one(/Principals:\s*\n([\s\S]*?)\n\s*(?:Critical Options|Extensions):/);
  const validTo = one(/Valid: from \S+ to (\S+)/);
  return {
    dir,
    keyId: one(/Key ID: "(.*)"/),
    serial: one(/Serial: (\d+)/),
    signingCA: one(/Signing CA: \S+ (SHA256:\S+)/),
    principals: block ? block.trim().split(/\s+/) : [],
    validFrom: one(/Valid: from (\S+) to /),
    validTo,
    // ssh-keygen prints local time with no offset, which Date parses as local time too.
    validToEpoch: validTo && !Number.isNaN(Date.parse(validTo)) ? Date.parse(validTo) : null,
  };
}

async function sshkeys() {
  // Skip the `current` alias symlink — listing it would show the same cert twice,
  // with a Kill button that the symlink guard in deleteCertDir then rejects.
  const dirs = fs.existsSync(CERTS_DIR)
    ? fs.readdirSync(CERTS_DIR).filter((n) => !fs.lstatSync(path.join(CERTS_DIR, n)).isSymbolicLink())
    : [];
  const certs = (
    await Promise.all(
      dirs.map(async (name) => {
        const dir = path.join(CERTS_DIR, name);
        const file = path.join(dir, 'deployer-cert.pub');
        // A mint that died at the signing step leaves a dir with a key but no cert.
        if (!fs.existsSync(file)) return null;
        const { err, stdout } = await run('ssh-keygen', ['-Lf', file]);
        return err ? null : parseCert(dir, stdout);
      })
    )
  ).filter(Boolean);
  // Dir names are YYYYMMDD-HHMMSS stamps, so lexicographic desc = newest first.
  certs.sort((a, b) => b.dir.localeCompare(a.dir));

  // .pub only — private key files are never read, listed or exposed.
  const pubs = fs.readdirSync(SSH_DIR).filter((f) => f.endsWith('.pub'));
  const keys = (
    await Promise.all(
      pubs.map(async (f) => {
        const { err, stdout } = await run('ssh-keygen', ['-lf', path.join(SSH_DIR, f)]);
        if (err) return null;
        const m = stdout.trim().match(/^\d+ (\S+) (.*) \((\w+)\)$/);
        return {
          name: f.slice(0, -4),
          type: m ? m[3] : null,
          fingerprint: m ? m[1] : null,
          comment: m ? m[2] : '',
        };
      })
    )
  ).filter(Boolean);
  keys.sort((a, b) => a.name.localeCompare(b.name));
  return { certs, keys };
}

const TTL_MS = { '1h': 3600e3, '4h': 4 * 3600e3, '8h': 8 * 3600e3 };
const SAFE_PRINCIPALS = /^[a-z0-9_][a-z0-9_.,-]*$/i;

// The signature comes from the 1Password agent, which pops an approval on this Mac —
// the timeout has to outlast a human walking back to the keyboard.
const MINT_TIMEOUT = 120000;

// detached puts the script in its own process group, so the timeout kill (-pid) also takes
// down the ssh-keygen still blocked on the 1Password prompt. execFile's own timeout kills
// only the script, leaving that child free to mint a cert after we already answered 502.
function mint(ttl, principals) {
  return new Promise((resolve) => {
    const child = spawn(MINT_SH, ['-t', ttl, '-n', principals], {
      detached: true,
      env: { ...process.env, SSH_AUTH_SOCK: OP_AGENT_SOCK },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (e) {
        // ESRCH: the group is already gone, which is the outcome we wanted anyway.
        if (e.code !== 'ESRCH') console.error('mint kill failed:', e.message);
      }
    }, MINT_TIMEOUT);
    // The script's own "1Password is probably locked" text must reach the UI verbatim.
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ code: 200, body: { ok: true, outdir: stdout.trim().split('\n').pop() } });
      resolve({ code: 502, body: { ok: false, error: stderr.trim() || 'mint failed (exit ' + code + ')' } });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 502, body: { ok: false, error: e.message } });
    });
  });
}

// rm -rf target: must be a real directory strictly inside deploy-certs/, never the dir
// itself, never a symlink out of it (lstat, so a link is not treated as a directory).
function deleteCertDir(input) {
  const dir = path.resolve(String(input || ''));
  if (!dir.startsWith(CERTS_DIR + path.sep) || !fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory())
    return { code: 400, body: { ok: false, error: 'not a cert directory' } };
  fs.rmSync(dir, { recursive: true, force: true });
  // If the vps-deploy/gb-deploy alias pointer targeted this dir, remove it too so
  // ssh fails with a clear missing-file error instead of a dangling symlink.
  const cur = path.join(CERTS_DIR, 'current');
  try {
    if (path.resolve(CERTS_DIR, fs.readlinkSync(cur)) === dir) fs.unlinkSync(cur);
  } catch (e) {
    // no symlink present — nothing to clean
  }
  return { code: 200, body: { ok: true } };
}

// --- GitHub train: the App PEM is fetched from 1Password once, held in this process's
// memory for the train window and never logged, written to disk or sent to a browser.
// While a train runs, any local process can GET a fresh 1h installation token.

// Read per request so a corrected id takes effect without restarting the deck.
// Format is `export KEY=VALUE`, the same file the shell script sources.
function ghConfig() {
  const cfg = {};
  for (const line of fs.readFileSync(GH_ENV, 'utf8').split('\n')) {
    const m = line.match(/^\s*export\s+([A-Z_]+)=(.*)$/);
    if (m) cfg[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return cfg;
}

let ghTrain = null; // { pem, expiresAt, timer, caffeinate } while a train is running

function endTrain() {
  if (!ghTrain) return;
  clearTimeout(ghTrain.timer);
  try {
    ghTrain.caffeinate.kill();
  } catch (e) {
    // ESRCH: caffeinate already exited on its own -t deadline, which is the outcome we wanted.
    if (e.code !== 'ESRCH') console.error('caffeinate kill failed:', e.message);
  }
  ghTrain = null;
}

// op prints the document to stdout; its own error text (locked vault, CLI integration
// off) is what the operator needs to see, so stderr goes to the UI verbatim.
async function startTrain(ttl) {
  const keyOp = ghConfig().GH_APP_KEY_OP;
  if (!keyOp) return { code: 500, body: { ok: false, error: 'GH_APP_KEY_OP missing from deploy-keys/github-app.env' } };
  const { err, stdout, stderr } = await run('op', ['document', 'get', keyOp], { timeout: MINT_TIMEOUT });
  if (err)
    return {
      code: 502,
      body: {
        ok: false,
        error:
          stderr.trim() ||
          '1Password read failed for ' + keyOp + ' — unlock 1Password; CLI integration must be on (Settings → Developer).',
      },
    };
  if (!stdout.includes('PRIVATE KEY'))
    return { code: 502, body: { ok: false, error: '1Password document ' + keyOp + ' is not a PEM private key' } };
  endTrain(); // a second start replaces the running train rather than stacking timers
  const expiresAt = Date.now() + TTL_MS[ttl];
  // Keeps the Mac from idle-sleeping while a train is active, so a box worker can still
  // reach the broker. Lid-close on battery still sleeps it — documented limitation.
  const caffeinate = spawn('caffeinate', ['-i', '-t', String(TTL_MS[ttl] / 1000)], {
    detached: true,
    stdio: 'ignore',
  });
  caffeinate.on('error', (e) => console.error('caffeinate failed:', e.message)); // never kill the deck over it
  caffeinate.unref();
  ghTrain = { pem: stdout, expiresAt, timer: setTimeout(endTrain, TTL_MS[ttl]), caffeinate };
  return { code: 200, body: { ok: true, expiresAt } };
}

const NO_TRAIN = 'no active GitHub train — ask the operator to start one on the keys page';

// Signed in-process: the PEM never becomes an argv, a temp file or a child's stdin.
function appJwt(pem, appId) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 30, exp: now + 540, iss: appId })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(head + '.' + payload);
  return head + '.' + payload + '.' + signer.sign(pem, 'base64url');
}

async function ghToken() {
  if (!ghTrain || Date.now() >= ghTrain.expiresAt) return { code: 503, body: { ok: false, error: NO_TRAIN } };
  // Hoisted before any await: the wipe timer or /end may null ghTrain mid-request.
  const { pem, expiresAt: trainExpiresAt } = ghTrain;
  const cfg = ghConfig();
  // Numeric check doubles as the guard for the id interpolated into the API path.
  if (!/^\d+$/.test(cfg.GH_APP_ID || '') || !/^\d+$/.test(cfg.GH_APP_INSTALLATION_ID || ''))
    return { code: 500, body: { ok: false, error: 'GH_APP_ID / GH_APP_INSTALLATION_ID must be numeric in deploy-keys/github-app.env' } };
  let r;
  try {
    r = await fetch(
      'https://api.github.com/app/installations/' + cfg.GH_APP_INSTALLATION_ID + '/access_tokens',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + appJwt(pem, cfg.GH_APP_ID),
          accept: 'application/vnd.github+json',
          'user-agent': 'fleetdeck-broker', // GitHub rejects the request without one
        },
        signal: AbortSignal.timeout(15000),
      }
    );
  } catch (e) {
    return { code: 502, body: { ok: false, error: 'GitHub unreachable: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message) } };
  }
  const d = await r.json().catch(() => ({}));
  // Only GitHub's own message is echoed — never the JWT that produced it.
  if (!r.ok || !d.token)
    return { code: 502, body: { ok: false, error: d.message || 'GitHub token request failed (HTTP ' + r.status + ')' } };
  return { code: 200, body: { ok: true, token: d.token, expires_at: d.expires_at, train_expires_at: trainExpiresAt } };
}

async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 4096) throw new Error('body too large'); // no legit body is close
  }
  return JSON.parse(data || '{}');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const VENDOR = {
  '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': '@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  '/vendor/addon-web-links.js': '@xterm/addon-web-links/lib/addon-web-links.js',
};

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'text/plain', 'not found');
    send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', buf);
  });
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}

const json = (res, obj, code = 200) => send(res, code, 'application/json', JSON.stringify(obj));

// --- registry. Shared by both listeners: orchestrators curl from loopback, box workers
// over tailnet. Agent POSTs carry no Origin header, so the gate rejects a *foreign*
// origin rather than a missing one; every value is validated before any write. Host
// "mac" is registry-only — it names lanes on this machine, which no ssh loop may target.
async function registryRoute(req, res, p, viaTailnet) {
  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  const b = await body(req).catch(() => null);
  if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
  if (!(b.host === 'mac' || HOSTS().includes(b.host)) || !SAFE_NAME.test(b.name || ''))
    return json(res, { ok: false, error: 'unknown host or bad session name' }, 400);
  if (p === '/api/registry/delete') {
    const f = fenceCheck(req, b, viaTailnet);
    if (f) return json(res, f.body, f.code);
    db.prepare('DELETE FROM sessions WHERE host = ? AND name = ?').run(b.host, b.name);
    return json(res, { ok: true });
  }
  // Only `status` and `task` are fenced (M17): a label or note is classification, not authority.
  if (typeof b.status === 'string' || typeof b.task === 'string') {
    const f = fenceCheck(req, b, viaTailnet);
    if (f) return json(res, f.body, f.code);
  }
  const r = registryWrite(b);
  return json(res, r.body, r.code);
}

// --- lease routes. Mounted on BOTH listeners: box pingers arrive over tailscale, and a
// session cannot beat a lease it has no way to reach. Seats are deliberately not here (M13).
async function leaseRoute(req, res, p) {
  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  const b = await body(req).catch(() => null);
  if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
  const r = p === '/api/lease/claim' ? leaseClaim(b) : heartbeat(b);
  return json(res, r.body, r.code);
}

const LEASE_ROUTES = new Set(['/api/lease/claim', '/api/heartbeat']);

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, 'text/plain', 'forbidden');
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/sessions') return json(res, await sessions());
    if (p === '/api/health') return json(res, await health());
    if (p === '/api/sshkeys' && req.method === 'GET') return json(res, await sshkeys());
    if (p === '/api/sshkeys/mint' || p === '/api/sshkeys/delete') {
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      // These sign keys and rm -rf, so the Origin check fails closed: a browser always
      // sends Origin on POST, and a curl POST without -H origin is meant to be rejected.
      // GET stays open (no Origin needed) so the CLI can still read the list.
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) return send(res, 403, 'text/plain', 'forbidden');
      const b = await body(req).catch(() => null);
      if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
      if (p === '/api/sshkeys/delete') {
        const r = deleteCertDir(b.dir);
        return json(res, r.body, r.code);
      }
      if (!TTL_MS[b.ttl] || typeof b.principals !== 'string' || !SAFE_PRINCIPALS.test(b.principals))
        return json(res, { ok: false, error: 'ttl must be 1h, 4h or 8h; principals must be names like root or root,vibe' }, 400);
      const r = await mint(b.ttl, b.principals);
      return json(res, r.body, r.code);
    }
    if (p === '/api/registry' || p === '/api/registry/delete') return await registryRoute(req, res, p, false);
    if (LEASE_ROUTES.has(p)) return await leaseRoute(req, res, p);
    // Loopback only, and deliberately absent from tailnetHandler (M13).
    // The epoch is deliberately withheld: it is the credential fenceCheck trusts, and this
    // route has no auth of its own. A holder learns its epoch from its own claim response.
    if (p === '/api/seats' && req.method === 'GET')
      return json(res, {
        ok: true,
        seats: seatsAll.all().map(({ epoch, ...rest }) => ({ ...rest, fenced: epoch !== null })),
      });
    if (p === '/api/seats/claim') {
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      const origin = req.headers.origin;
      if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
      const b = await body(req).catch(() => null);
      if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
      const r = seatClaim(b);
      return json(res, r.body, r.code);
    }
    if (p === '/api/kill') {
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      const origin = req.headers.origin;
      if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
      const b = await body(req).catch(() => null);
      if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
      // Kill reaches for ssh, so only fleet hosts qualify — never mac.
      if (!HOSTS().includes(b.host) || !SAFE_NAME.test(b.name || ''))
        return json(res, { ok: false, error: 'unknown host or bad session name' }, 400);
      const f = fenceCheck(req, b);
      if (f) return json(res, f.body, f.code);
      return json(res, await kill(b.host, b.name));
    }
    // Agent-facing: a local process holds no Origin, and the train itself is the gate.
    if (p === '/api/ghtoken' && req.method === 'GET') {
      const r = await ghToken();
      return json(res, r.body, r.code);
    }
    if (p === '/api/ghtrain' && req.method === 'GET')
      return json(res, { active: !!ghTrain, expiresAt: ghTrain ? ghTrain.expiresAt : null });
    if (p === '/api/ghtrain' || p === '/api/ghtrain/end') {
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      // Same fail-closed Origin rule as the mint POSTs: starting a train unlocks the PEM.
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) return send(res, 403, 'text/plain', 'forbidden');
      if (p === '/api/ghtrain/end') {
        endTrain();
        return json(res, { ok: true });
      }
      const b = await body(req).catch(() => null);
      if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
      if (!TTL_MS[b.ttl]) return json(res, { ok: false, error: 'ttl must be 1h, 4h or 8h' }, 400);
      const r = await startTrain(b.ttl);
      return json(res, r.body, r.code);
    }
  } catch (e) {
    return send(res, 500, 'text/plain', String(e.message));
  }
  if (VENDOR[p]) return sendFile(res, require.resolve(VENDOR[p]));
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const file = path.join(__dirname, 'public', rel);
  if (!file.startsWith(path.join(__dirname, 'public') + path.sep))
    return send(res, 403, 'text/plain', 'forbidden');
  sendFile(res, file);
});

// node-pty 1.1.0 leaks one extra pty master per spawn on macOS: pty_posix_spawn
// opens a throwaway posix_openpt fd so the real master lands above stderr, and
// its cleanup loop (`for (; count > 0; count--)`) never closes low_fds[0]. The
// stray is invisible to JS — term.fd itself is closed by destroy()/EIO — so on
// 2026-08-22 this process held 500 of the machine's 511 ptys (kern.tty.ptmx_max)
// and nothing on the Mac could open a terminal. After every spawn and teardown,
// close any pty-master fd that no live session owns. A session's own term.fd
// stays registered until its exit event — destroy()'s close is async, so an
// early sweep would double-close a number libuv may hand to the next tile.
// Values are the owning term: a reused fd number registers to the new owner,
// and the old session's late deregistration then no-ops instead of exposing it.
const liveMasters = new Map();
let masterMajor = -1; // device major of pty masters, learned from the first spawn
let fdCeil = 4;
const charMajor = (fd) => {
  try {
    const s = fs.fstatSync(fd);
    return s.isCharacterDevice() ? s.rdev >>> 24 : -1;
  } catch (e) {
    return -1;
  }
};
function reapStrayMasters() {
  if (masterMajor === -1) return;
  for (let fd = 3; fd <= fdCeil; fd++)
    if (!liveMasters.has(fd) && charMajor(fd) === masterMajor)
      try { fs.closeSync(fd); } catch (e) {}
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!ALLOWED_HOSTS.has(req.headers.host) || (origin && !ALLOWED_ORIGINS.has(origin)))
    return socket.destroy();
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/term') return socket.destroy();
  const host = url.searchParams.get('host');
  const session = url.searchParams.get('session');
  const cols = dim(parseInt(url.searchParams.get('cols'), 10), 80);
  const rows = dim(parseInt(url.searchParams.get('rows'), 10), 24);

  wss.handleUpgrade(req, socket, head, (ws) => {
    try {
      if (!HOSTS().includes(host) || !SAFE_NAME.test(session || '')) return ws.close(4400);

      // BatchMode: never fall back to a password prompt inside the tile — a locked
      // 1Password agent must fail fast so the Disconnected overlay shows the hint.
      const term = pty.spawn(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-t', host, 'wsl tmux attach -t ' + session],
        {
        name: 'xterm-256color',
        cols,
        rows,
      });

      liveMasters.set(term.fd, term);
      if (masterMajor === -1) masterMajor = charMajor(term.fd);
      if (term.fd > fdCeil) fdCeil = term.fd;
      reapStrayMasters();
      let reaped = false;
      const reap = () => {
        if (reaped) return;
        reaped = true;
        term.kill();
        try { term.destroy(); } catch (e) {}
        reapStrayMasters();
      };

      term.onData((d) => ws.readyState === 1 && ws.send(d));
      term.onExit(({ exitCode }) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
          ws.close();
        }
        reap();
        // node-pty emits exit only after the socket's close event, so the fd
        // is truly closed here; the owner check covers an already-reused number.
        if (liveMasters.get(term.fd) === term) liveMasters.delete(term.fd);
      });

      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m.type === 'input' && typeof m.data === 'string') term.write(m.data);
          else if (m.type === 'resize' && dim(m.cols, 0) && dim(m.rows, 0))
            term.resize(m.cols, m.rows);
        } catch (e) {
          console.error('bad frame:', e.message);
        }
      });

      ws.on('close', reap);
    } catch (e) {
      console.error('upgrade failed:', e.message);
      ws.close(4400);
    }
  });
});

// Unit tests require this file for its lease/reaper functions and drive them directly, so
// binding the ports is opt-out. Nothing else changes: unset, the deck behaves as it always has.
const NO_LISTEN = process.env.FLEET_NO_LISTEN === '1';

// Both gates are configuration, so both are stated at boot rather than discovered by the leak
// or the lockout they cause.
console.log(
  'lifecycle: ttl=' + TTL_S + 's suspect=' + SUSPECT_WINDOW_MS / 1000 + 's tick=' +
    REAPER_TICK_MS / 1000 + 's cascade_k=' + CASCADE_K + ' retention=' + RETENTION_DAYS + 'd' +
    ' fence=' + FENCE_MODE + ' tailnet_key=' + (TAILNET_KEY ? 'armed' : 'unset')
);

if (!NO_LISTEN)
  server.listen(PORT, '127.0.0.1', () => console.log('fleetdeck http://localhost:' + PORT));

// Tailnet broker: box workers need GitHub tokens and registry writes, so these routes —
// and nothing else — are reachable over tailscale. No static files, no key routes: a
// train is still started only from this Mac's loopback UI, and kill stays loopback-only
// because it reaches for ssh.
async function tailnetHandler(req, res) {
  if (req.headers.host !== TAILNET_HOST) return send(res, 403, 'text/plain', 'forbidden');
  const p = new URL(req.url, 'http://localhost').pathname;
  // S3: every write that arrives over tailscale carries the shared key. Reads keep their own
  // gates — /api/ghtoken is still fenced by whether a train is running at all.
  if (req.method === 'POST' && !tailnetAuthed(req))
    return send(res, 401, 'text/plain', 'unauthorized');
  try {
    if (p === '/api/registry' || p === '/api/registry/delete') return await registryRoute(req, res, p, true);
    if (LEASE_ROUTES.has(p)) return await leaseRoute(req, res, p);
    if (req.method === 'GET' && p === '/api/ghtoken') {
      const r = await ghToken();
      return json(res, r.body, r.code);
    }
    if (req.method === 'GET' && p === '/api/ghtrain')
      return json(res, { active: !!ghTrain, expiresAt: ghTrain ? ghTrain.expiresAt : null });
  } catch (e) {
    return send(res, 500, 'text/plain', String(e.message));
  }
  send(res, 404, 'text/plain', 'not found');
}

const tailnet = http.createServer(tailnetHandler);
// Tailscale down or the address not yet assigned: log it and keep serving loopback.
tailnet.on('error', (e) => console.error('tailnet listener unavailable: ' + e.code));
if (!NO_LISTEN)
  tailnet.listen(PORT, TAILNET_BIND, () => console.log('tailnet broker http://' + TAILNET_HOST));

// Off only for tests, which drive reaperTick() by hand so a sweep is a step rather than a race.
const NO_REAPER = process.env.FLEET_NO_REAPER === '1';
if (!NO_REAPER) {
  setInterval(reaperLoop, REAPER_TICK_MS);
  console.log('reaper: every ' + REAPER_TICK_MS / 1000 + 's, no reaps for the first ' + SUSPECT_WINDOW_MS / 1000 + 's');
}

module.exports = {
  tailnetHandler, db, server, tailnet, assertPragmas, migrationPending,
  // Test seams: a tick is a step, and REAPER is the observability the tick writes into.
  reaperTick, reaperLoop, REAPER,
};
