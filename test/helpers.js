// Shared fixtures. Every test gets its own db file and hosts.json under a temp dir, so no
// test can reach the operator's live deck or its fleet.db.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function tmpdir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-' + tag + '-'));
  return d;
}

// A db carrying the pre-lifecycle schema and one row, to prove the migration is additive.
function legacyDb(dir, rows = []) {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(dir, 'fleet.db');
  const db = new DatabaseSync(file);
  db.exec(
    `CREATE TABLE sessions (host TEXT, name TEXT, label TEXT DEFAULT '', role TEXT DEFAULT '', worker TEXT DEFAULT '', status TEXT DEFAULT 'active', note TEXT DEFAULT '', created_at TEXT, updated_at TEXT, last_seen_at TEXT, active_at TEXT, PRIMARY KEY (host, name))`
  );
  for (const col of ['msg_at TEXT', "grp TEXT DEFAULT ''", "task TEXT DEFAULT ''"])
    db.exec('ALTER TABLE sessions ADD COLUMN ' + col);
  for (const r of rows)
    db.prepare(
      'INSERT INTO sessions (host, name, label, role, worker, status, note, created_at, updated_at, last_seen_at, active_at, msg_at, grp, task) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      r.host, r.name, r.label || '', r.role || '', r.worker || '', r.status || 'active',
      r.note || '', r.created_at || '', r.updated_at || '', r.last_seen_at || '',
      r.active_at || '', r.msg_at || null, r.grp || '', r.task || ''
    );
  db.close();
  return file;
}

function hostsFile(dir, hosts = ['german-box']) {
  const f = path.join(dir, 'hosts.json');
  fs.writeFileSync(f, JSON.stringify(hosts));
  return f;
}

// DECK-108: a real operator file or allowed_signers on this Mac must never make a test deck
// require sign-in or reach 1Password — in-process (load) or as a child (boot, http.js startServer).
// Paths that cannot exist, not '' — '' deletes the var and the deck would fall back to the real
// defaults. A test's own env still wins.
const OPERATOR_DEFAULTS = {
  FLEET_OPERATOR_FILE: '/nonexistent/fleetdeck-operator.json',
  FLEET_ALLOWED_SIGNERS: '/nonexistent/fleetdeck-allowed_signers',
  FLEET_UNBLOCK_SIGNER: 'off',
};

// Boot server.js as a child that binds nothing and exits when the module finishes loading.
// Throws with the child's stderr if the boot assertions fail — that is the M9 test.
function boot(env) {
  return execFileSync(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, ...OPERATOR_DEFAULTS, FLEET_NO_LISTEN: '1', FLEET_NO_REAPER: '1', ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
}

// Load server.js in-process with the module cache cleared, so a test can drive reaperTick()
// as a step instead of racing a timer. `listen: true` also binds the two listeners on this
// instance's own ports, which is how a reaper test talks HTTP to the deck it is stepping.
// Always set the whole env, never a delta: node:test shares one process per file.
// The tailnet listener binds a second loopback address, which is an lo0 alias only on the
// operator's Mac. A machine without that alias sets FLEET_TEST_TAILNET_BIND (e.g. ::1) rather
// than hanging on every listener test.
const TAILNET_BIND = process.env.FLEET_TEST_TAILNET_BIND || '127.0.0.2';

function load(env = {}, opts = {}) {
  const full = {
    FLEET_NO_LISTEN: opts.listen ? '' : '1',
    FLEET_NO_REAPER: '1',
    FLEET_SSH_BIN: '',
    FLEET_FAKE_SSH_STATE: '',
    FLEET_TTL_S: '',
    FLEET_SUSPECT_WINDOW_S: '',
    FLEET_REAPER_TICK_S: '',
    FLEET_CASCADE_K: '',
    FLEET_RETENTION_DAYS: '',
    FLEET_FENCE: '',
    FLEET_TAILNET_KEY: '',
    FLEET_NAME_CLOSE_SCRIPT: '',
    FLEET_TAILNET_BIND: TAILNET_BIND,
    ...OPERATOR_DEFAULTS,
    ...env,
  };
  for (const [k, v] of Object.entries(full))
    if (v === '') delete process.env[k];
    else process.env[k] = String(v);
  if (opts.listen && !full.FLEET_TAILNET_HOST)
    process.env.FLEET_TAILNET_HOST =
      (TAILNET_BIND.includes(':') ? '[' + TAILNET_BIND + ']' : TAILNET_BIND) + ':' + process.env.PORT;
  delete require.cache[require.resolve(path.join(ROOT, 'server.js'))];
  return require(path.join(ROOT, 'server.js'));
}

// Every in-process instance holds two listeners and a db handle; a test that leaves them open
// keeps the whole test file alive.
async function unload(mod) {
  for (const srv of [mod.server, mod.tailnet])
    if (srv && srv.listening) await new Promise((r) => srv.close(r));
  try { mod.db.close(); } catch (e) { /* already closed */ }
}

module.exports = { ROOT, OPERATOR_DEFAULTS, tmpdir, legacyDb, hostsFile, boot, load, unload };
