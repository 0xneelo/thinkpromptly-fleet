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
const HOSTS = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'hosts.json'), 'utf8'));

// --- Session registry: this process is the only writer. Orchestrators classify sessions
// through /api/registry, and a row outlives the tmux session it describes — that is the
// point, a killed worker that reappears in `tmux ls` is then visible as evidence.
const db = new DatabaseSync(path.join(__dirname, 'fleet.db'));
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
const ssh = (host, remoteCmd, opts) =>
  run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, remoteCmd], { ...SSH_OPTS, ...opts });

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

const CREDITS_SH = path.join(__dirname, 'box', 'fleet-credits.sh');
// Quote-free, argument-free: the same remote-command rule as fleet-lastmsg.sh.
const CREDITS_REMOTE = 'wsl sh /home/vibe/bin/fleet-credits.sh';
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
const pctOf = (v) =>
  typeof v !== 'number' || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;

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
      map.set(a.org, { email: a.email, label: (map.get(a.org) || {}).label || null, confirmed: true });
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
  for (const s of Array.isArray(d.desktop) ? d.desktop : [])
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
  for (const r of best.values()) {
    const prev = creditsGetId.get(r.kind, r.id);
    if (prev && !beats(r, safeParse(prev.payload))) continue;
    creditsUpsert.run(r.kind, r.id, r.email, r.org, r.host, JSON.stringify(r), r.updated_at);
    if (r.email && r.org) creditsDropId.run(r.kind, 'org:' + r.org);
    written++;
  }
  return written;
}

// Every mapped account is listed even before a machine has reported it, in file order, so
// a silent account reads as "no data yet" rather than vanishing.
function creditsRows() {
  const rows = db.prepare('SELECT * FROM credits').all().map((r) => JSON.parse(r.payload));
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
    const remote = HOSTS().map((host) => ssh(host, CREDITS_REMOTE, { timeout: 30000 }).then((r) => [host, r]));
    // A host that is down, or has no script installed, leaves its stored rows standing.
    const replies = [];
    for (const [host, r] of await Promise.all([local, ...remote])) {
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

// limit is generous only where it has to be: a credits push carries a whole usage response.
async function body(req, limit = 4096) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error('body too large');
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

// --- credits push. Shared by both listeners, same gate as the registry: an off-fleet
// machine (no ssh route from here) runs fleet-credits.sh push on a cron and carries no
// Origin, so a *foreign* origin is rejected rather than a missing one. The body is either
// a fleet-credits.sh line or one already-normalized row; nothing else is stored.
async function creditsRoute(req, res) {
  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  const b = await body(req, 32768).catch(() => null);
  if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
  // A normalized row names its kind at the top level; wrap it so both shapes take the
  // same whitelisting path.
  const d = b.kind === 'claude' || b.kind === 'codex' ? { host: b.host, ts: b.updated_at, [b.kind]: b } : b;
  const map = creditsMap(Array.isArray(d.accounts) ? d.accounts : []);
  if (!creditsWrite(creditsCandidates(d, 'push', map, true)))
    return json(res, { ok: false, error: 'body must carry a claude or codex account with an email address or org' }, 400);
  return json(res, { ok: true });
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
    if (p === '/api/credits' && req.method === 'GET')
      return json(res, await creditsCollect(url.searchParams.get('refresh') === '1'));
    if (p === '/api/credits') return await creditsRoute(req, res);
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

server.listen(PORT, '127.0.0.1', () => console.log('fleetdeck http://localhost:' + PORT));

// Tailnet broker: box workers need GitHub tokens and registry writes, so these routes —
// and nothing else — are reachable over tailscale. No static files, no key routes: a
// train is still started only from this Mac's loopback UI, and kill stays loopback-only
// because it reaches for ssh.
async function tailnetHandler(req, res) {
  if (req.headers.host !== TAILNET_IP + ':' + PORT) return send(res, 403, 'text/plain', 'forbidden');
  const p = new URL(req.url, 'http://localhost').pathname;
  try {
    if (p === '/api/registry' || p === '/api/registry/delete') return await registryRoute(req, res, p);
    if (p === '/api/credits') return await creditsRoute(req, res);
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
