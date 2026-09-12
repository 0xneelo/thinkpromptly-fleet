// Shared fixtures. Every test gets its own db file and hosts.json under a temp dir, so no
// test can reach the operator's live deck or its fleet.db.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Every node child a test starts goes through here, so none of them can outlive this process.
// Two layers, because neither alone holds: the exit hook kills survivors when the file ends or
// a test throws, and the stdin pipe covers this process being SIGKILLed, where no hook of ours
// runs at all — the kernel closes the write end and the preloaded guard exits the child on EOF.
const children = new Set();

function spawnChild(script, opts = {}) {
  const [, out = 'pipe', err = 'pipe'] = opts.stdio || [];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'die-with-parent.js'), script], {
    ...opts,
    stdio: ['pipe', out, err], // fd 0 is the deadman's switch, never 'ignore'
  });
  child.stdin.on('error', () => {}); // EPIPE if the child dies first
  child.stdin.unref(); // an open pipe must not keep this process alive
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

// The pids still running, so a test can assert a failed boot left nothing behind.
const liveChildren = () => [...children].map((c) => c.pid);

process.on('exit', () => {
  for (const c of children) {
    try { c.kill('SIGKILL'); } catch (e) { /* already gone */ }
  }
});

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

// Boot server.js as a child that binds nothing and exits when the module finishes loading.
// Throws with the child's stderr if the boot assertions fail — that is the M9 test.
function boot(env) {
  return execFileSync(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, FLEET_NO_LISTEN: '1', FLEET_NO_REAPER: '1', ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
}

// Load server.js in-process with the module cache cleared, so a test can drive reaperTick()
// as a step instead of racing a timer. `listen: true` also binds the two listeners on this
// instance's own ports, which is how a reaper test talks HTTP to the deck it is stepping.
// Always set the whole env, never a delta: node:test shares one process per file.
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
    FLEET_TAILNET_BIND: '127.0.0.2',
    ...env,
  };
  for (const [k, v] of Object.entries(full))
    if (v === '') delete process.env[k];
    else process.env[k] = String(v);
  if (opts.listen && !full.FLEET_TAILNET_HOST)
    process.env.FLEET_TAILNET_HOST = '127.0.0.2:' + process.env.PORT;
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

module.exports = { ROOT, tmpdir, legacyDb, hostsFile, boot, load, unload, spawnChild, liveChildren };
