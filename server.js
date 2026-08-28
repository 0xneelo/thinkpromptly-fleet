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

const PORT = Number(process.env.PORT) || 3131;
const TAILNET_IP = process.env.TAILNET_IP || '100.125.231.25'; // Mac's tailscale address
// hosts.json entries are either "name" (a Windows+WSL box, the original shape) or
// {"name":..., "kind":"linux"} for a plain Linux host, where tmux is reached directly
// and the RDP-holder/WSL health probes do not apply.
const HOSTS_RAW = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'hosts.json'), 'utf8'));
const name_ = (h) => (typeof h === 'string' ? h : h.name);
const HOSTS = () => HOSTS_RAW().map(name_);
const KIND = (host) => {
  const e = HOSTS_RAW().find((h) => name_(h) === host);
  return typeof e === 'string' || !e ? 'wsl' : e.kind || 'wsl';
};
// Every remote command is written bare; a WSL box gets the `wsl ` prefix put back here.
const remote = (host, cmd) => (KIND(host) === 'linux' ? cmd : 'wsl ' + cmd);

// --- Session registry: this process is the only writer. Orchestrators classify sessions
// through /api/registry, and a row outlives the tmux session it describes — that is the
// point, a killed worker that reappears in `tmux ls` is then visible as evidence.
const db = new DatabaseSync(process.env.FLEET_DB || path.join(__dirname, 'fleet.db'));
db.exec(
  `CREATE TABLE IF NOT EXISTS sessions (host TEXT, name TEXT, label TEXT DEFAULT '', role TEXT DEFAULT '', worker TEXT DEFAULT '', status TEXT DEFAULT 'active', note TEXT DEFAULT '', created_at TEXT, updated_at TEXT, last_seen_at TEXT, active_at TEXT, PRIMARY KEY (host, name))`
);
// Added after the table shipped; sqlite has no IF NOT EXISTS here, so a second boot throws.
for (const col of ['msg_at TEXT', "grp TEXT DEFAULT ''", "task TEXT DEFAULT ''"])
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN ' + col);
  } catch (e) {
    // column already present
  }

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
const GH_ENV = path.join(__dirname, 'deploy-keys', 'github-app.env');
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
const ssh = (host, remoteCmd) =>
  run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, remoteCmd], SSH_OPTS);
const sshInput = (host, remoteCmd, input) =>
  runInput('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, remoteCmd], input, SSH_OPTS);

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
    live: isLive,
  });
  for (const s of live) out.sessions.push(row(reg.get(s.host + '\0' + s.name), true));
  // Registry rows with no live session stay in the list — a killed or vanished worker
  // must not silently disappear.
  for (const [k, r] of reg)
    if (!live.some((s) => s.host + '\0' + s.name === k)) out.sessions.push(row(r, false));
  return out;
}

async function health() {
  return Promise.all(
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
async function registryRoute(req, res, p) {
  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  const b = await body(req).catch(() => null);
  if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
  if (!(b.host === 'mac' || HOSTS().includes(b.host)) || !SAFE_NAME.test(b.name || ''))
    return json(res, { ok: false, error: 'unknown host or bad session name' }, 400);
  if (p === '/api/registry/delete') {
    db.prepare('DELETE FROM sessions WHERE host = ? AND name = ?').run(b.host, b.name);
    return json(res, { ok: true });
  }
  const r = registryWrite(b);
  return json(res, r.body, r.code);
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
    if (p === '/api/registry' || p === '/api/registry/delete') return await registryRoute(req, res, p);
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
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-t', host, remote(host, 'tmux attach -t ' + session)],
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

server.listen(PORT, '127.0.0.1', () => console.log('fleetdeck http://localhost:' + PORT));

// Tailnet broker: box workers need GitHub tokens and registry writes, so these routes —
// and nothing else — are reachable over tailscale. No static files, no key routes: a
// train is still started only from this Mac's loopback UI, and kill stays loopback-only
// because it reaches for ssh.
async function tailnetHandler(req, res) {
  if (req.headers.host !== TAILNET_IP + ':' + PORT) return send(res, 403, 'text/plain', 'forbidden');
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/registry' || p === '/api/registry/delete') return await registryRoute(req, res, p);
    if ((p === '/api/messages' || p === '/api/messages/retry') && req.method === 'POST') {
      if (!busAuthorized(req)) return json(res, { ok: false, error: 'invalid message bus token' }, 401);
      return await messageRoute(req, res, p, url);
    }
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
tailnet.listen(PORT, TAILNET_IP, () => console.log('tailnet broker http://' + TAILNET_IP + ':' + PORT));

module.exports = { tailnetHandler };
