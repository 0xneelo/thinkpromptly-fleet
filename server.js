const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { MessageBus, MAX_BODY_BYTES } = require('./message-bus');
const { coordinatorRoute } = require('./coordinator-api');

const PORT = Number(process.env.PORT) || 3131;
const TAILNET_IP = process.env.TAILNET_IP || '100.125.231.25'; // Mac's tailscale address; token broker for box workers
// Both default to today's values. A test instance binds the second listener on another
// loopback address so the split between the two listeners can be exercised for real.
const TAILNET_BIND = process.env.FLEET_TAILNET_BIND || TAILNET_IP;
const TAILNET_HOST = process.env.FLEET_TAILNET_HOST || TAILNET_IP + ':' + PORT;
// Overridable so a worker can run a throwaway instance beside the operator's live deck.
const HOSTS_FILE = process.env.FLEET_HOSTS_FILE || path.join(__dirname, 'hosts.json');
const DB_FILE = process.env.FLEET_DB || path.join(__dirname, 'fleet.db');
// hosts.json entries are either "name" (a Windows+WSL box, the original shape) or
// {"name":..., "kind":"linux"} for a plain Linux host, where tmux is reached directly
// and the RDP-holder/WSL health probes do not apply. An entry may also carry
// {"ssh":"<alias>"} to dial the host through a different ~/.ssh/config alias than its
// fleet name — see SSH_HOST.
//
// Re-read rather than captured at boot, so editing hosts.json takes effect without a deck
// restart. The parse is cached against the file's own mtime+size: every ssh call resolves a
// kind and a destination through here, so a poll tick would otherwise re-parse a file that
// changes once a month a dozen times over.
let hostsCache = null;
const HOSTS_RAW = () => {
  const st = fs.statSync(HOSTS_FILE);
  const key = st.mtimeMs + ':' + st.size;
  if (!hostsCache || hostsCache.key !== key)
    hostsCache = { key, val: JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8')) };
  return hostsCache.val;
};
const name_ = (h) => (typeof h === 'string' ? h : h.name);
const HOSTS = () => HOSTS_RAW().map(name_);
const entry_ = (host) => HOSTS_RAW().find((h) => name_(h) === host);
const KIND = (host) => {
  const e = entry_(host);
  return typeof e === 'string' || !e ? 'wsl' : e.kind || 'wsl';
};
// The ssh destination for a host, which need not be its fleet name. german-box carries
// "ssh":"gb-deploy" — a config alias pinned to the short-lived deploy cert with
// `IdentityAgent none`, so the ~20s poll authenticates without ever touching the
// operator's 1Password agent. `Host german-box` stays the operator's own personal route.
const SSH_HOST = (host) => {
  const e = entry_(host);
  return (typeof e === 'string' || !e ? null : e.ssh) || host;
};
// Every remote command is written bare; a WSL box gets the `wsl ` prefix put back here.
const remote = (host, cmd) => (KIND(host) === 'linux' ? cmd : 'wsl ' + cmd);

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
  const { err, stderr } = await ssh(host, remote(host, 'tmux kill-session -t ' + name));
  if (!err) registryWrite({ host, name, status: 'killed' });
  return { ok: !err, stderr: stderr.trim() };
}

const HOME = os.homedir();
const SSH_DIR = path.join(HOME, '.ssh');
const CERTS_DIR = path.join(SSH_DIR, 'deploy-certs');
const MINT_SH = path.join(__dirname, 'deploy-keys', 'mint-deploy-cert.sh');
const OP_AGENT_SOCK = path.join(HOME, 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock');
const CLAUDE_BRIDGE = process.env.CLAUDE_BRIDGE || path.join(__dirname, '.fleetdeck', 'claude-desktop-send');
const BUS_TOKEN_FILE = process.env.FLEETDECK_BUS_TOKEN_FILE || path.join(HOME, '.fleetdeck-bus-token');

function loadBusToken() {
  if (process.env.FLEETDECK_BUS_TOKEN) return process.env.FLEETDECK_BUS_TOKEN;
  try {
    return fs.readFileSync(BUS_TOKEN_FILE, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(BUS_TOKEN_FILE, token + '\n', { mode: 0o600, flag: 'wx' });
  console.log('fleetdeck message token created at ' + BUS_TOKEN_FILE);
  return token;
}

const BUS_TOKEN = loadBusToken();

function busAuthorized(req) {
  const prefix = 'Bearer ';
  const header = req.headers.authorization || '';
  if (!header.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(BUS_TOKEN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

// The two routes busAuthorized() owns. Named once so the S3 exemption in tailnetHandler() and
// the routes it exempts cannot drift apart.
const BUS_ROUTES = new Set(['/api/messages', '/api/messages/retry']);

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

function runInput(cmd, args, input, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => (spawnError = error));
    child.on('close', (code, signal) =>
      resolve({
        err:
          spawnError ||
          (code === 0 ? null : new Error(cmd + (signal ? ' killed by ' + signal : ' exited ' + code))),
        stdout,
        stderr,
      })
    );
    child.stdin.end(input);
  });
}

// BatchMode: no interactive auth fallback — a locked 1Password agent fails fast with
// its message on stderr instead of hanging until the 15s kill.
// The binary is overridable so tests can drive a fake host poller with the same argv shape;
// unset, this is the plain `ssh` it has always been.
const SSH_BIN = process.env.FLEET_SSH_BIN || 'ssh';
const sshArgs = (dest, remoteCmd) => ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', dest, remoteCmd];

// A host reached through a cert alias offers the deploy cert and nothing else, so a publickey
// refusal there has exactly one cause and one fix. Said once per host and not again until that
// host answers: at three polls a minute the alternative is a deck.log full of one line.
const CERT_FAIL = /permission denied \(publickey|no such identity|identity file .* not accessible/i;
// ssh's own transport diagnostics all begin `ssh: ` — refused, timed out, no such hostname.
// An unreachable host is not a verdict on the cert, so it neither warns nor clears: without
// this, one poll timing out at TCP would wipe the flag its sibling poll had just set and the
// same line would be logged again on the next tick.
const SSH_TRANSPORT = /^ssh: /im;
const certWarned = new Set();
function certGate(host, dest, r) {
  if (dest === host) return r; // no cert alias — nothing here is about the cert
  if (r.err && CERT_FAIL.test(r.stderr)) {
    if (!certWarned.has(host))
      console.error(
        '[ssh] ' + now() + ' ' + host + ' via ' + dest + ': deploy cert rejected or missing — ' +
          'mint a fresh one with deploy-keys/mint-deploy-cert.sh. This host has no 1Password fallback.'
      );
    certWarned.add(host);
  } else if (!r.err || !SSH_TRANSPORT.test(r.stderr)) {
    // The remote command itself ran — whatever it exited with, the cert was accepted.
    certWarned.delete(host);
  }
  return r;
}

const ssh = async (host, remoteCmd, opts) => {
  const dest = SSH_HOST(host);
  return certGate(host, dest, await run(SSH_BIN, sshArgs(dest, remoteCmd), { ...SSH_OPTS, ...opts }));
};
const sshInput = async (host, remoteCmd, input) => {
  const dest = SSH_HOST(host);
  return certGate(host, dest, await runInput(SSH_BIN, sshArgs(dest, remoteCmd), input, SSH_OPTS));
};

const AGENT_LOCKED = 'communication with agent failed';

// An idle host is not a broken host: tmux exits non-zero when no server is running,
// and says so differently per version — 3.6 reports the missing socket path instead.
const NO_TMUX_SERVER = /no server running|no sessions|error connecting to .*(no such file or directory)/i;

// Quote-free format string: no leading #, no comma inside braces, no $ — it survives
// CMD -> wsl -> bash intact (verified against the box).
const TMUX_LS = 'tmux ls -F n=#{session_name},a=#{session_activity},c=#{session_created}';
// Reads each session pane's Claude Code transcript and prints name<TAB>iso<TAB>msg|mtime.
// Master copy: box/fleet-lastmsg.sh — the box may not have it installed, hence the soft fail.
const LAST_MSG = 'bash /home/vibe/bin/fleet-lastmsg.sh';
const iso = (unix) => new Date(Number(unix) * 1000).toISOString();
// The Windows -> wsl pipeline can turn line ends into CRLF, and a stray \r makes every
// pattern below miss — which would silently mark the whole fleet gone.
const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, ''));

async function sessions() {
  const out = { sessions: [], errors: [] };
  const live = [];
  await Promise.all(
    HOSTS().map(async (host) => {
      const [ls, lm] = await Promise.all([
        ssh(host, remote(host, TMUX_LS)),
        ssh(host, remote(host, LAST_MSG)),
      ]);
      const { err, stdout, stderr } = ls;
      const blob = (stdout + stderr).toLowerCase();
      if (err && !NO_TMUX_SERVER.test(blob)) {
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
      // A Linux host has no RDP holder and no WSL to keep alive: reachability is the
      // whole story, so probe tmux directly and let the UI render kind 'linux'.
      if (KIND(host) === 'linux') {
        const r = await ssh(host, 'tmux -V');
        const blob = r.stdout + r.stderr;
        return {
          host,
          kind: 'linux',
          reachable: !r.err || /no server running|no sessions/i.test(blob),
          agentLocked: blob.includes(AGENT_LOCKED),
        };
      }
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

// --- Credits: per-account AI usage. box/fleet-credits.sh runs on each machine and reports
// two things: a live usage read for whichever account that machine's CLI is logged into
// (its own token, read and used only there), and the Claude desktop app's usage history,
// which covers every org that app has sampled — that is how accounts with no login on the
// fleet are still seen. Only derived numbers come back (percentages, reset stamps, plan,
// email, org uuid, hostname). No token is ever stored in fleet.db, logged, or sent to a
// browser, and the desktop app's token cache is never read at all.
db.exec(
  `CREATE TABLE IF NOT EXISTS credits (kind TEXT, id TEXT, email TEXT, org TEXT, host TEXT, payload TEXT, updated_at INTEGER, PRIMARY KEY (kind, id))`
);
// The desktop app samples usage as it is used, so the trend it keeps is the only history
// the fleet has. A sample is immutable — same org and second means same reading, whichever
// machine reports it — so the merge across machines is an INSERT OR IGNORE on that key.
db.exec(
  `CREATE TABLE IF NOT EXISTS credits_history (org TEXT, t INTEGER, fh REAL, sd REAL, xu REAL, PRIMARY KEY (org, t))`
);

const CREDITS_SH = path.join(__dirname, 'box', 'fleet-credits.sh');
// Quote-free, argument-free: the same remote-command rule as fleet-lastmsg.sh. No wsl
// prefix here — remote() adds it per host, so a plain Linux host runs the script directly.
const CREDITS_REMOTE = 'sh /home/vibe/bin/fleet-credits.sh';
const CREDITS_TTL = 60000; // the ssh fan-out is slow; a page load must not re-run it
const ACCOUNTS_FILE = path.join(__dirname, 'credits-accounts.json');
// Codex rollouts carry no account email, and the fleet has exactly one ChatGPT login. A
// push may name its own account; anything else keys to this one.
const CODEX_EMAIL = 'admin@deus.finance';
const CREDIT_STATES = new Set(['ok', 'token_expired', 'rate_limited', 'error', 'absent']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A live read carries real reset stamps, so it beats a desktop sample describing the same
// account in the same collect; both beat nothing.
const SOURCE_RANK = { oauth: 3, push: 2, codex: 2, desktop: 1 };
// A better source wins, but only while it is still reporting: once its row is half a day
// old a weaker fresh one takes over, so a machine that stops pushing cannot pin a row.
const RANK_STALE = 12 * 3600;
const safeParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const beats = (a, b) => {
  if (!b) return true;
  const ra = SOURCE_RANK[a.source] || 0;
  const rb = SOURCE_RANK[b.source] || 0;
  const at = a.updated_at || 0;
  const bt = b.updated_at || 0;
  // A read that failed carries no numbers, so it must not displace a recent one that
  // succeeded: a single rate-limited call would otherwise erase a good live reading.
  if (ra === rb && b.state === 'ok' && a.state !== 'ok' && at - bt < RANK_STALE) return false;
  return ra === rb ? at >= bt : ra > rb || at - bt > RANK_STALE;
};

// Freshest wins: the same account is reported by every machine it is signed in on.
const creditsUpsert = db.prepare(
  `INSERT INTO credits (kind, id, email, org, host, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(kind, id) DO UPDATE SET email = excluded.email, org = excluded.org, host = excluded.host,
     payload = excluded.payload, updated_at = excluded.updated_at WHERE excluded.updated_at >= credits.updated_at`
);
// An org row is provisional: once its email is known the account merges under that address.
const creditsDropId = db.prepare('DELETE FROM credits WHERE kind = ? AND id = ?');
const creditsGetId = db.prepare('SELECT payload FROM credits WHERE kind = ? AND id = ?');
const historyInsert = db.prepare('INSERT OR IGNORE INTO credits_history (org, t, fh, sd, xu) VALUES (?, ?, ?, ?, ?)');
const historyPrune = db.prepare('DELETE FROM credits_history WHERE t < ?');
const historyGet = db.prepare('SELECT t, fh, sd, xu FROM credits_history WHERE org = ? ORDER BY t');
const HISTORY_KEEP = 60 * 86400; // a trend older than two months answers no question anyone asks
const HISTORY_POINTS = 120; // enough shape for a sparkline; the rest is payload weight

// Evenly spaced, first and last kept exactly — a trend line needs its shape and its ends,
// not every point.
function thin(a, max) {
  if (a.length <= max) return a;
  const step = (a.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => a[Math.round(i * step)]);
}

// What one report may add. The collector sends at most HISTORY_PER_ORG per org, so these
// are that promise enforced at the writer: /api/credits takes pushes from machines off the
// fleet, and a caller that ignores the limits must not be able to grow fleet.db without
// bound. Anything past a limit is dropped, not an error — a long-running box is allowed to
// know more than one request can carry.
const HISTORY_PER_ORG = 300;
const HISTORY_ORGS = 25;
let historyPrunedAt = 0;

// Only the three percentages travel, each 0-100 like every other source here. An org this
// process cannot name still gets its samples: the mapping may arrive on a later collect.
function creditsHistoryWrite(d) {
  const now = Math.floor(Date.now() / 1000);
  const perOrg = new Map();
  for (const s of Array.isArray(d.history) ? d.history : []) {
    if (!s || typeof s !== 'object' || typeof s.org !== 'string') continue;
    const t = epochOf(s.t);
    // A future stamp is a skewed clock; it would sit forever at the right of every chart.
    if (t === null || t > now || t < now - HISTORY_KEEP) continue;
    const org = s.org.slice(0, 64);
    const n = perOrg.get(org) || 0;
    if (n === 0 && perOrg.size >= HISTORY_ORGS) continue;
    if (n >= HISTORY_PER_ORG) continue;
    perOrg.set(org, n + 1);
    historyInsert.run(org, t, pctOf(s.fh), pctOf(s.sd), pctOf(s.xu));
  }
  // Pruning used to ride along with a collect, which a push never triggers: a deck nobody
  // opens would then keep every sample it was ever sent. Throttled, so a burst prunes once.
  if (perOrg.size && Date.now() - historyPrunedAt > 60000) {
    historyPrunedAt = Date.now();
    historyPrune.run(now - HISTORY_KEEP);
  }
}

// Operator-editable, read per collect so an edit needs no restart. A malformed file must
// not take the deck down — it just leaves every org unmapped and visibly so.
function creditsAccounts() {
  try {
    const d = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    return { orgs: d.orgs && typeof d.orgs === 'object' ? d.orgs : {}, codex: d.codex && typeof d.codex === 'object' ? d.codex : {} };
  } catch (e) {
    return { orgs: {}, codex: {} };
  }
}

// Every source reports 0-100: the endpoint answers utilization 3.0 for 3% and 100.0 for a
// spent pool, Codex used_percent likewise. Reading a value under 1 as a fraction instead
// would turn the 0.4% right after a window resets into a 40% bar.
// Clamped, because the number is also printed: the endpoint already reports a pool spent
// past its limit as 100, and a faulty 145 must not reach a label saying "145%".
const pctOf = (v) =>
  typeof v !== 'number' || !Number.isFinite(v) ? null : Math.min(100, Math.max(0, Math.round(v * 10) / 10));

// resets_at is an ISO string in some versions and an epoch (s or ms) in others.
const epochOf = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v > 1e11 ? v / 1000 : v);
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : Math.round(t / 1000);
};

// Accepts a raw window from the endpoint or one this collector already normalized, so a
// push of either shape lands on the same row.
const HAS_PCT = ['utilization', 'used_percentage', 'used_percent', 'pct'];
const win = (w) => {
  if (!w || typeof w !== 'object') return null;
  const raw = w.pct ?? w.utilization ?? w.used_percentage ?? w.used_percent;
  return { pct: pctOf(raw), resets_at: epochOf(w.resets_at) };
};
const creditState = (s) => (CREDIT_STATES.has(s) ? s : 'error');

// Window names drift (model-specific ones appear), so every window found is kept. Only the
// fields below are kept: the untouched response is never stored or served, so a field the
// endpoint adds later cannot leak into fleet.db or out to a browser.
function claudeRow(c) {
  // Some builds nest the windows under rate_limits, others return them at the top level.
  const usage = c.usage && typeof c.usage === 'object' ? c.usage : null;
  const limits = (usage && (usage.rate_limits || usage)) || c.windows || {};
  const windows = {};
  for (const [name, w] of Object.entries(limits)) {
    if (name === 'extra_usage' || !w || typeof w !== 'object' || Array.isArray(w)) continue;
    // Siblings like the flat `limits` array carry no utilization; only real windows count.
    if (!HAS_PCT.some((k) => k in w)) continue;
    const v = win(w);
    if (!v) continue;
    // The reply also carries codenamed windows for unreleased features; keep an unknown
    // one only once it reports something, so the view is not padded with 0% noise.
    if (!/^(five_hour|seven_day)(_|$)/.test(name) && !v.pct && v.resets_at === null) continue;
    windows[String(name).slice(0, 40)] = v;
  }
  // extra_usage is the paid-credit pool: utilization is already 0-100, but the amounts are
  // in minor units — decimal_places 2 means 4142 is 41.42 EUR against a 40.00 limit, which
  // is why that pool reads as spent. Scaling is what makes used/limit agree with utilization.
  const x = limits.extra_usage;
  let credit = null;
  if (x && typeof x === 'object') {
    const pct = pctOf(x.utilization);
    if (pct !== null) windows.extra = { pct, resets_at: null };
    const dp = Number.isInteger(x.decimal_places) && x.decimal_places >= 0 && x.decimal_places <= 8 ? x.decimal_places : 0;
    const amount = (v) => (typeof v === 'number' && Number.isFinite(v) ? v / 10 ** dp : null);
    credit = {
      used: amount(x.used_credits),
      limit: amount(x.monthly_limit),
      decimals: dp,
      currency: typeof x.currency === 'string' ? x.currency.slice(0, 8) : null,
      enabled: !!x.is_enabled,
      capped: !!x.spend_limit_reached,
    };
  }
  // An already-normalized row (a relayed push) carries its pool here, not under extra_usage.
  if (!credit && c.credit && typeof c.credit === 'object') credit = c.credit;
  return { state: creditState(c.state), windows, ...(credit ? { credit } : {}) };
}

// window_minutes 10080 = the weekly window (primary); secondary is the shorter one.
function codexRow(c) {
  const rl = c.rate_limits && typeof c.rate_limits === 'object' ? c.rate_limits : c;
  const cr = rl.credits;
  const secondary = win(rl.secondary);
  const plan = typeof rl.plan_type === 'string' ? rl.plan_type : c.plan;
  return {
    state: creditState(c.state),
    weekly: win(rl.primary || rl.weekly),
    ...(secondary ? { secondary } : {}),
    // balance arrives as a decimal string; kept verbatim rather than lossily parsed.
    credits: cr && typeof cr === 'object'
      ? {
          balance: typeof cr.balance === 'number' ? cr.balance : String(cr.balance ?? '').slice(0, 32) || null,
          unlimited: !!cr.unlimited,
          has_credits: !!cr.has_credits,
        }
      : null,
    plan: typeof plan === 'string' ? plan.slice(0, 40) : null,
    snapshot_ts: epochOf(c.snapshot_ts),
  };
}

// The desktop app's sample: fh/sd/xu are already 0-100, and it carries no reset stamps.
// sample_ts is what matters — an org sampled six days ago is stale data, not 0% usage.
function desktopRow(s) {
  const u = s.u && typeof s.u === 'object' ? s.u : {};
  const windows = {};
  for (const [k, name] of [['fh', 'five_hour'], ['sd', 'seven_day'], ['xu', 'extra']]) {
    const pct = pctOf(u[k]);
    if (pct !== null) windows[name] = { pct, resets_at: null };
  }
  return { state: 'ok', windows, sample_ts: epochOf(s.t) };
}

// The file names the accounts; a CLI login on any machine proves one, so it wins and
// confirms. An org can change hands on a shared box, which is why rows key on the uuid.
function creditsMap(accounts) {
  const map = new Map(
    Object.entries(creditsAccounts().orgs).map(([org, m]) => [
      org,
      { email: typeof m.email === 'string' ? m.email : null, label: typeof m.label === 'string' ? m.label : null, confirmed: !!m.confirmed },
    ])
  );
  for (const a of accounts)
    if (a && typeof a.org === 'string' && typeof a.email === 'string')
      map.set(a.org, {
        email: a.email,
        label: (map.get(a.org) || {}).label || null,
        confirmed: true,
        // The plan behind the windows — only a CLI login on some machine knows it.
        tier: typeof a.tier === 'string' ? a.tier.slice(0, 40) : null,
        type: typeof a.type === 'string' ? a.type.slice(0, 40) : null,
      });
  return map;
}

// An account with neither an email nor an org is dropped rather than guessed at; an org
// nobody can name still shows, flagged, so the operator knows a mapping is missing.
function ident(org, email, map) {
  const m = (typeof org === 'string' && map.get(org)) || null;
  const addr = (typeof email === 'string' && email) || (m && m.email) || null;
  const ok = addr && addr.length <= 254 && EMAIL_RE.test(addr);
  return {
    org: typeof org === 'string' ? org.slice(0, 64) : null,
    email: ok ? addr.toLowerCase() : null,
    label: (m && m.label) || (ok ? null : org ? String(org).slice(0, 8) + ' · unmapped org' : null),
    confirmed: m ? m.confirmed : !!ok,
    tier: (m && m.tier) || null,
    type: (m && m.type) || null,
  };
}

// One emitted line -> candidate rows: the live read for this machine's CLI account, one
// per org the desktop app has sampled, and its Codex login. Nothing outside the whitelist
// each *Row builder produces is kept.
function creditsCandidates(d, host, map, push) {
  if (!d || typeof d !== 'object') return [];
  // Never later than now: a future stamp — a skewed clock, or a push claiming someone
  // else's account — would otherwise outrank every later report and pin the row for good.
  const now = Math.floor(Date.now() / 1000);
  const claimed = Number.isFinite(d.ts) ? d.ts : Number.isFinite(d.updated_at) ? d.updated_at : now;
  const t = Math.min(claimed, now);
  const h = typeof d.host === 'string' && d.host ? d.host.slice(0, 64) : host;
  const out = [];
  const add = (kind, org, email, source, payload) => {
    const i = ident(org, email, map);
    const id = i.email || (i.org ? 'org:' + i.org : null);
    if (id) out.push({ kind, id, host: h, updated_at: t, source: push ? 'push' : source, ...i, ...payload });
  };
  if (d.claude && typeof d.claude === 'object') add('claude', d.claude.org, d.claude.email, 'oauth', claudeRow(d.claude));
  // One row per org, and a machine sees a handful: the slice is what stops a push from
  // turning a long list into as many stored rows.
  for (const s of (Array.isArray(d.desktop) ? d.desktop : []).slice(0, HISTORY_ORGS))
    if (s && typeof s === 'object' && typeof s.org === 'string') add('claude', s.org, null, 'desktop', desktopRow(s));
  if (d.codex && typeof d.codex === 'object')
    add('codex', null, typeof d.codex.email === 'string' ? d.codex.email : CODEX_EMAIL, 'codex', codexRow(d.codex));
  return out;
}

// The endpoint answers for some accounts with every window zeroed and every resets_at
// null — an unpopulated reply, not a real 0%. Taken at face value it would hide genuine
// usage the desktop sample knows about, so a signal-free reply does not count as windows.
// `extra` comes from the separate credit block and is populated even when the rate-limit
// windows are not, so it cannot vouch for them.
const hasSignal = (r) =>
  Object.entries(r.windows || {}).some(([n, w]) => n !== 'extra' && w && (w.pct > 0 || w.resets_at !== null));

function creditsWrite(rows) {
  const best = new Map();
  const groups = new Map();
  for (const r of rows) {
    const k = r.kind + '\0' + r.id;
    groups.set(k, (groups.get(k) || []).concat(r));
    if (beats(r, best.get(k))) best.set(k, r);
  }
  // Keep the winner's richer fields (only the endpoint reports credits) but borrow the
  // percentages from the best source that actually reported any.
  for (const [k, r] of best) {
    if (hasSignal(r)) continue;
    const alt = (groups.get(k) || [])
      .filter((o) => o !== r && hasSignal(o))
      .sort((a, b) => (SOURCE_RANK[b.source] || 0) - (SOURCE_RANK[a.source] || 0) || b.updated_at - a.updated_at)[0];
    if (alt) best.set(k, { ...r, windows: alt.windows, sample_ts: alt.sample_ts, windows_from: alt.source });
  }
  // A collect carries no pushed rows, so without comparing against what is already stored
  // a local snapshot would clobber a better report an off-fleet machine pushed earlier.
  let written = 0;
  for (const [k, r] of best) {
    const prev = creditsGetId.get(r.kind, r.id);
    if (prev && !beats(r, safeParse(prev.payload))) continue;
    // Which machines report this account and how — every candidate for the key, not just
    // the winner: an account signed in on three boxes is a different fact from one on one.
    const seen = [];
    for (const c of groups.get(k))
      if (!seen.some((s) => s.host === c.host && s.source === c.source)) seen.push({ host: c.host, source: c.source });
    creditsUpsert.run(r.kind, r.id, r.email, r.org, r.host, JSON.stringify({ ...r, seen }), r.updated_at);
    if (r.email && r.org) creditsDropId.run(r.kind, 'org:' + r.org);
    written++;
  }
  return written;
}

// Every mapped account is listed even before a machine has reported it, in file order, so
// a silent account reads as "no data yet" rather than vanishing.
// How long a sample may still be quoted as a current figure. Not the window's own length:
// the desktop source carries no reset stamp, so a seven-day reading days old may sit on
// the far side of a reset and read "at the limit" for an account now at zero. These are
// the ages within which the number is still worth asserting; past them the reading becomes
// no reading, and only the trend line keeps it, which is honestly historical.
const WINDOW_AGE = { five_hour: 2 * 3600, seven_day: 24 * 3600, extra: 7 * 86400 };
function agedOut(r, now) {
  if (!r.sample_ts) return r;
  const age = now - r.sample_ts;
  const windows = {};
  let any = false;
  for (const [n, w] of Object.entries(r.windows || {})) {
    if (age > (WINDOW_AGE[n] ?? 7 * 86400)) {
      windows[n] = { ...w, pct: null, stale: true };
      any = true;
    } else windows[n] = w;
  }
  return any ? { ...r, windows, stale_windows: true } : r;
}

function creditsRows() {
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = db
    .prepare('SELECT * FROM credits')
    .all()
    .map((r) => agedOut(JSON.parse(r.payload), nowSec));
  const have = new Set(rows.map((r) => r.kind + '\0' + r.id));
  const cfg = creditsAccounts();
  const blank = (kind, id, extra) => ({
    kind, id, host: null, updated_at: null, source: null, state: 'absent', windows: {}, ...extra,
  });
  const order = [];
  for (const [org, m] of Object.entries(cfg.orgs)) {
    const id = typeof m.email === 'string' ? m.email.toLowerCase() : 'org:' + org;
    order.push('claude\0' + id);
    if (!have.has('claude\0' + id))
      rows.push(blank('claude', id, { org, email: typeof m.email === 'string' ? m.email.toLowerCase() : null, label: m.label || null, confirmed: !!m.confirmed }));
  }
  for (const [email, m] of Object.entries(cfg.codex)) {
    const id = String(email).toLowerCase();
    order.push('codex\0' + id);
    if (!have.has('codex\0' + id))
      rows.push(blank('codex', id, { org: null, email: id, label: m.label || null, confirmed: true }));
  }
  // Labels are applied on the way out, so renaming an account in the file shows up on the
  // next page load rather than only after the row is collected again.
  const byEmail = new Map(Object.values(cfg.orgs).map((m) => [String(m.email || '').toLowerCase(), m.label]));
  const at = (r) => (order.indexOf(r.kind + '\0' + r.id) + 1 || 999) - 1;
  // Only Claude accounts have a trend: the desktop app is what samples them, and it knows
  // nothing about Codex.
  for (const r of rows) {
    if (r.kind !== 'claude' || !r.org) continue;
    const h = thin(historyGet.all(r.org), HISTORY_POINTS);
    if (h.length) r.history = h;
  }
  for (const r of rows)
    r.label =
      (r.kind === 'codex' ? (cfg.codex[r.id] || {}).label : (cfg.orgs[r.org] || {}).label || byEmail.get(r.id)) ||
      r.label ||
      null;
  return rows.sort((a, b) => at(a) - at(b));
}

let creditsAt = 0; // last live collect, ms

async function creditsCollect(force) {
  const errors = [];
  if (force || Date.now() - creditsAt > CREDITS_TTL) {
    creditsAt = Date.now(); // claimed before the awaits, so parallel loads don't stampede
    const local = run('sh', [CREDITS_SH], { timeout: 30000 }).then((r) => ['mac', r]);
    // Longer than the session poll's 15s: this one waits on a remote HTTPS call, and a
    // slow endpoint must not be reported as a missing script.
    const remotes = HOSTS().map((host) =>
      ssh(host, remote(host, CREDITS_REMOTE), { timeout: 30000 }).then((r) => [host, r])
    );
    // A host that is down, or has no script installed, leaves its stored rows standing.
    const replies = [];
    for (const [host, r] of await Promise.all([local, ...remotes])) {
      try {
        const line = lines(r.stdout).map((l) => l.trim()).filter(Boolean).pop();
        // A killed ssh reports neither stdout nor stderr, so name the timeout rather than
        // blaming a script that may well be installed and working.
        if (!line)
          throw new Error(
            r.stderr.trim() ||
              (r.err ? 'fleet-credits.sh did not answer: ' + (r.err.killed ? 'timed out' : r.err.message) : 'no output from fleet-credits.sh')
          );
        replies.push([host, JSON.parse(line)]);
      } catch (e) {
        errors.push({ host, message: e.message.slice(0, 500) });
      }
    }
    // One mapping for the whole fleet: a CLI login on any machine names an org for all of them.
    const map = creditsMap(replies.flatMap(([, d]) => (Array.isArray(d.accounts) ? d.accounts : [])));
    creditsWrite(replies.flatMap(([host, d]) => creditsCandidates(d, host, map, false)));
    // Every machine's samples merge into one series per org — one box keeps sampling the
    // accounts another stopped using. Retention is bounded here, once per collect.
    for (const [, d] of replies) creditsHistoryWrite(d);
    historyPrune.run(Math.floor(Date.now() / 1000) - HISTORY_KEEP);
  }
  return { rows: creditsRows(), errors };
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

// --- GitHub train: the window itself now lives in fleetdeck-train.js, a loopback-only process
// the com.fleetdeck.train LaunchAgent keeps running, so the App PEM and the train window survive
// a deck restart. The deck keeps every consumer-facing URL and every gate and forwards the four
// routes; nothing about /api/ghtoken or /api/ghtrain changed for a caller.
const TRAIN_PORT = Number(process.env.FLEET_TRAIN_PORT) || 3132;
const TRAIN_BIND = process.env.FLEET_TRAIN_BIND || '127.0.0.1';

// startTrain blocks on the 1Password approval prompt for up to MINT_TIMEOUT (120s), so the
// proxy deadline has to outlast it: a shorter one would 503 a train that then starts anyway.
const TRAIN_PROXY_TIMEOUT = 130000;

// Deliberately different text from the broker's own `no active GitHub train` 503, so the two
// are tellable apart: this one means the broker never answered, not that no train is running.
const TRAIN_DOWN =
  'train broker unreachable at ' + TRAIN_BIND + ':' + TRAIN_PORT +
  ' — is the com.fleetdeck.train launch agent loaded?';

// The broker answers with a small JSON object and nothing else. Buffering without a cap
// would let anything that got to 127.0.0.1:TRAIN_PORT first — a crashed broker replaced by
// another process, or a bug — grow the deck's memory without bound, and the deck is the
// control plane for the whole fleet.
const TRAIN_MAX_BODY = 65536;

// Never rejects, and never logs the response — it carries an installation token.
// `clientReq` is the inbound request, passed so an abandoned browser tab frees the deck's
// socket to the broker instead of holding it for the full Touch ID window.
async function trainProxy(method, p, bodyObj, clientReq) {
  return new Promise((resolve) => {
    const payload = bodyObj === undefined ? null : JSON.stringify(bodyObj);
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const req = http.request(
      {
        host: TRAIN_BIND,
        port: TRAIN_PORT,
        path: p,
        method,
        // The broker's own Host guard checks this authority, so set it rather than inherit it.
        headers: {
          host: TRAIN_BIND + ':' + TRAIN_PORT,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
        signal: AbortSignal.timeout(TRAIN_PROXY_TIMEOUT),
      },
      (res) => {
        let data = '';
        let over = false;
        res.on('data', (c) => {
          if (over) return;
          data += c;
          if (data.length <= TRAIN_MAX_BODY) return;
          over = true;
          res.destroy();
          done({ code: 502, body: { ok: false, error: 'train broker sent an oversized response' } });
        });
        res.on('end', () => {
          if (over) return;
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            // A text body from the broker (403/404/405) is not a shape a caller expects here.
            parsed = { ok: false, error: data.trim() || 'train broker sent no body' };
          }
          done({ code: res.statusCode, body: parsed });
        });
      }
    );
    req.setTimeout(TRAIN_PROXY_TIMEOUT, () => req.destroy());
    req.on('error', () => done({ code: 503, body: { ok: false, error: TRAIN_DOWN } }));
    // A start POST can sit here for the whole 120s Touch ID window. If the operator closes
    // the tab, nothing is left waiting on this end. The broker still finishes the mint it
    // already began — the sensor was touched, so opening that train is the right outcome.
    if (clientReq) clientReq.on('close', () => req.destroy());
    if (payload) req.write(payload);
    req.end();
  });
}

function messageFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateMessageTarget(target) {
  if (!target || typeof target !== 'object') messageFailure(400, 'target must be an object');
  if (target.type === 'claude-desktop') {
    if (target.session !== 'current')
      messageFailure(400, 'Claude Desktop currently supports session "current" only');
    const label = typeof target.label === 'string' ? target.label.trim().slice(0, 60) : '';
    return { type: 'claude-desktop', session: 'current', ...(label ? { label } : {}) };
  }
  if (target.type === 'tmux') {
    if (!(target.host === 'mac' || HOSTS().includes(target.host)) || !SAFE_NAME.test(target.session || ''))
      messageFailure(400, 'tmux target must name a configured host and safe session');
    return { type: 'tmux', host: target.host, session: target.session };
  }
  messageFailure(400, 'target type must be tmux or claude-desktop');
}

function deliveryError(action, result) {
  if (!result.err) return;
  throw new Error(action + ': ' + (result.stderr.trim() || result.err.message));
}

async function deliverTmux(message) {
  const { host, session } = message.target;
  const buffer = 'fleetdeck_' + message.id.replace(/-/g, '').slice(0, 24);
  const local = host === 'mac';
  const loaded = local
    ? await runInput('tmux', ['load-buffer', '-b', buffer, '-'], message.text, SSH_OPTS)
    : await sshInput(host, remote(host, 'tmux load-buffer -b ' + buffer + ' -'), message.text);
  deliveryError('tmux load-buffer failed', loaded);
  const pasted = local
    ? await run('tmux', ['paste-buffer', '-p', '-d', '-b', buffer, '-t', session], SSH_OPTS)
    : await ssh(host, remote(host, 'tmux paste-buffer -p -d -b ' + buffer + ' -t ' + session));
  if (pasted.err) {
    if (local) await run('tmux', ['delete-buffer', '-b', buffer], SSH_OPTS);
    else await ssh(host, remote(host, 'tmux delete-buffer -b ' + buffer));
    deliveryError('tmux paste-buffer failed', pasted);
  }
  const submitted = local
    ? await run('tmux', ['send-keys', '-t', session, 'Enter'], SSH_OPTS)
    : await ssh(host, remote(host, 'tmux send-keys -t ' + session + ' Enter'));
  deliveryError('tmux submit failed', submitted);
}

async function deliverClaudeDesktop(message) {
  if (process.platform !== 'darwin') throw new Error('Claude Desktop delivery requires macOS');
  if (!fs.existsSync(CLAUDE_BRIDGE))
    throw new Error('Claude bridge is not built; run npm run build:claude-bridge');
  const result = await runInput(CLAUDE_BRIDGE, [], message.text, {
    timeout: 8000,
    killSignal: 'SIGKILL',
  });
  deliveryError('Claude Desktop delivery failed', result);
}

async function deliverMessage(message) {
  if (message.target.type === 'tmux') return deliverTmux(message);
  return deliverClaudeDesktop(message);
}

const messageBus = new MessageBus(db, deliverMessage, validateMessageTarget);

async function messageTargets() {
  const result = await run('tmux', ['list-sessions', '-F', '#{session_name}'], SSH_OPTS);
  const local = result.err && !NO_TMUX_SERVER.test((result.stdout + result.stderr).toLowerCase())
    ? []
    : lines(result.stdout).map((name) => name.trim()).filter((name) => SAFE_NAME.test(name));
  return [
    { type: 'claude-desktop', session: 'current' },
    ...local.map((session) => ({ type: 'tmux', host: 'mac', session })),
  ];
}

// maxBytes is generous only where it has to be: a credits push carries a whole usage
// response plus a month of samples.
async function body(req, maxBytes = 4096) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > maxBytes) throw new Error('body too large');
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

// --- credits push. Shared by both listeners, same gate as the registry: an off-fleet
// machine (no ssh route from here) runs fleet-credits.sh push on a cron and carries no
// Origin, so a *foreign* origin is rejected rather than a missing one. The body is either
// a fleet-credits.sh line or one already-normalized row; nothing else is stored.
async function creditsRoute(req, res) {
  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  // A month of desktop samples is ~100KB of derived numbers, so the cap is per-line, not
  // per-window: a push carrying its history must still fit.
  const b = await body(req, 262144).catch(() => null);
  if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
  // A normalized row names its kind at the top level; wrap it so both shapes take the
  // same whitelisting path.
  const d =
    b.kind === 'claude' || b.kind === 'codex'
      ? { host: b.host, ts: b.updated_at, history: b.history, [b.kind]: b }
      : b;
  const map = creditsMap(Array.isArray(d.accounts) ? d.accounts : []);
  const wrote = creditsWrite(creditsCandidates(d, 'push', map, true));
  // Only a body that named an account writes anything: a rejected push must not leave its
  // samples behind, or a 400 would be a receipt for a write that happened anyway.
  if (!wrote)
    return json(res, { ok: false, error: 'body must carry a claude or codex account with an email address or org' }, 400);
  creditsHistoryWrite(d);
  return json(res, { ok: true });
}

async function messageRoute(req, res, p, url) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  try {
    if (p === '/api/messages' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit')) || 50;
      return json(res, { messages: messageBus.list(limit), targets: await messageTargets() });
    }
    if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
    const b = await body(req, MAX_BODY_BYTES + 4096).catch(() => null);
    if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
    const message =
      p === '/api/messages/retry' ? await messageBus.retry(b.id) : await messageBus.send(b);
    return json(res, { ok: message.status === 'delivered', ...message });
  } catch (error) {
    const code = Number.isInteger(error.code) ? error.code : 500;
    return json(res, { ok: false, error: error.message }, code);
  }
}

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
    if (p === '/api/credits' && req.method === 'GET')
      return json(res, await creditsCollect(url.searchParams.get('refresh') === '1'));
    if (p === '/api/credits') return await creditsRoute(req, res);
    if (p === '/api/messages' || p === '/api/messages/retry')
      return await messageRoute(req, res, p, url);
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
    if (p.startsWith('/api/coordinator/'))
      return await coordinatorRoute(req, res, p, { send, json, body, allowedOrigins: ALLOWED_ORIGINS });
    // Agent-facing: a local process holds no Origin, and the train itself is the gate.
    if (p === '/api/ghtoken' && req.method === 'GET') {
      const r = await trainProxy('GET', '/api/ghtoken', undefined, req);
      return json(res, r.body, r.code);
    }
    if (p === '/api/ghtrain' && req.method === 'GET') {
      const r = await trainProxy('GET', '/api/ghtrain', undefined, req);
      return json(res, r.body, r.code);
    }
    if (p === '/api/ghtrain' || p === '/api/ghtrain/end') {
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      // Same fail-closed Origin rule as the mint POSTs: starting a train unlocks the PEM. The
      // gate stays here rather than moving to the broker — the browser only ever talks to the
      // deck, and the deck's proxy request carries no Origin of its own.
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) return send(res, 403, 'text/plain', 'forbidden');
      if (p === '/api/ghtrain/end') {
        const r = await trainProxy('POST', '/api/ghtrain/end', {}, req);
        return json(res, r.body, r.code);
      }
      const b = await body(req).catch(() => null);
      if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
      // Checked here as well as in the broker: defence in depth, and a bad ttl never travels.
      if (!TTL_MS[b.ttl]) return json(res, { ok: false, error: 'ttl must be 1h, 4h or 8h' }, 400);
      const r = await trainProxy('POST', '/api/ghtrain', b, req);
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

      // BatchMode: never fall back to a password prompt inside the tile — a refused
      // credential must fail fast so the Disconnected overlay shows the hint. The tile
      // dials SSH_HOST(host), the same cert alias the poll uses, not the fleet name.
      const term = pty.spawn(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-t', SSH_HOST(host), remote(host, 'tmux attach -t ' + session)],
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
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  // S3: every write that arrives over tailscale carries the shared key. Reads keep their own
  // gates — /api/ghtoken is still fenced by whether a train is running at all.
  //
  // XYZ-1888: the bus routes are the single exemption. They carry the deck's own BUS_TOKEN in
  // this same `authorization: Bearer ...` header, so asking them for the tailnet key as well
  // asks one header to equal two secrets — with the key armed, a box worker's reply could
  // satisfy neither gate and the worker->deck half of the bus was structurally dead. The bus
  // token is an equivalent-strength shared secret and busAuthorized() below still gates both
  // routes unconditionally, so this frees the header, never the authority.
  if (req.method === 'POST' && !BUS_ROUTES.has(p) && !tailnetAuthed(req))
    return send(res, 401, 'text/plain', 'unauthorized');
  try {
    if (p === '/api/registry' || p === '/api/registry/delete') return await registryRoute(req, res, p, true);
    // The portal API is the reason a coordinator session no longer needs the repo, so it has to
    // reach the deck from wherever that session runs — which is what this listener is for. It
    // adds no authority: reads are open like /api/ghtoken, and the sitrep drop is a POST, so the
    // S3 gate above already asked it for the shared key. The board itself stays unwritable.
    if (p.startsWith('/api/coordinator/'))
      return await coordinatorRoute(req, res, p, { send, json, body, allowedOrigins: ALLOWED_ORIGINS });
    if (LEASE_ROUTES.has(p)) return await leaseRoute(req, res, p);
    if (p === '/api/credits') return await creditsRoute(req, res);
    if (BUS_ROUTES.has(p) && req.method === 'POST') {
      if (!busAuthorized(req)) return json(res, { ok: false, error: 'invalid message bus token' }, 401);
      return await messageRoute(req, res, p, url);
    }
    if (req.method === 'GET' && p === '/api/ghtoken') {
      const r = await trainProxy('GET', '/api/ghtoken', undefined, req);
      return json(res, r.body, r.code);
    }
    if (req.method === 'GET' && p === '/api/ghtrain') {
      const r = await trainProxy('GET', '/api/ghtrain', undefined, req);
      return json(res, r.body, r.code);
    }
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
