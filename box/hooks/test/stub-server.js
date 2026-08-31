#!/usr/bin/env node
// Test stub of docs/goals/xyz-1742-fleet-lifecycle/CONTRACT.md (fleet lifecycle, FROZEN 2026-08-27).
//
// This is NOT the real server. Lane 1 (server.js, Edith) owns the real implementation;
// this file exists only so Lane 2's detached pinger can be tested end-to-end before that
// backend lands. State is in-memory and disposable: no sqlite, no fleet.db, no files.
// Node 18+ core only, no dependencies. Binds 127.0.0.1 - never point it at the live deck.
//
//   node box/hooks/test/stub-server.js
//   FD_STUB_PORT=3199 FD_STUB_TTL_S=90 FD_STUB_REAP_TICK_S=30 FD_STUB_TAILNET_KEY=<key>

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = Number(process.env.FD_STUB_PORT) || 3199;
const TTL_S = Number(process.env.FD_STUB_TTL_S) || 90;
// Reaper tick is its OWN number in the contract (S2 default 30s), not a function of the TTL.
const REAP_TICK_S = Number(process.env.FD_STUB_REAP_TICK_S) || 30;
const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;
// Same host list and charset the real server validates against (server.js:99,491): a body
// this stub accepts must be one the backend accepts, or a green test proves nothing.
let HOSTS = ['german-box'];
try {
  // Entries are "name" or {name, kind?, ssh?} — the same shape server.js reads (server.js:22).
  HOSTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'hosts.json'), 'utf8')).map(
    (h) => (typeof h === 'string' ? h : h.name)
  );
} catch (e) {
  console.warn(`[stub] WARNING: cannot read hosts.json (${e.message}); falling back to ${JSON.stringify(HOSTS)}`);
}
// The parent edge is written ONLY on claim, and only for these hosts (CONTRACT: HOSTS() + mac).
const PARENT_HOSTS = new Set([...HOSTS, 'mac']);
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// S3: the real server's tailnet listener rejects every POST that does not carry the shared
// bearer key, and exempts loopback. This stub is loopback-only, so it emulates the GATE, not
// the exemption - set FD_STUB_TAILNET_KEY and an unauthenticated POST gets the same
// `401 text/plain unauthorized` the real tailnetHandler sends. Never logged, anywhere.
// Mutable so /_test/tailnet_key can arm it under a running fleet of pingers.
let tailnetKey = (process.env.FD_STUB_TAILNET_KEY || '').trim();
function tailnetAuthed(req) {
  if (!tailnetKey) return true;
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return !!m && m[1] === tailnetKey;
}
// The real tailnetHandler (server.js:1445) gates on the Host header FIRST, for every method,
// and answers `403 text/plain forbidden` before the bearer check ever runs. Emulated only
// while the key is armed - unarmed, this stub is the plain loopback deck the other tests
// drive. The expected value is this listener's own host:port, which is exactly what curl
// sends to $FD_BASE_URL; override it to rehearse a mismatch.
const TAILNET_HOST = process.env.FD_STUB_TAILNET_HOST || `${HOST}:${PORT}`;
const tailnetHostOk = (req) => String(req.headers.host || '') === TAILNET_HOST;

// key(host,name) -> row. beats: key -> [unix-ms of every accepted heartbeat].
const sessions = new Map();
const beats = new Map();
const key = (host, name) => host + '\t' + name;
let reaperLastTickAt = null;
let mode = 'normal'; // normal | flaky | down | slow - see /_test/mode
let flakyCount = 0;

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

// All emitted timestamps are INTEGER unix-ms (S4) - never ISO strings.
const now = () => Date.now();

// --- reaper (simulated) ------------------------------------------------------
// Second liveness sample before a reap (M5): a live tmux session means the pinger died,
// not the session. execFileSync with an argv - never a shell string.
function tmuxLive(name) {
  try {
    execFileSync('tmux', ['has-session', '-t', '=' + name], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Without tmux this always says "dead", every suspect row falls through to reaped, and the
// M5 pinger_dead acceptance CANNOT fail - a green run that proved nothing. Say so loudly.
function tmuxAvailable() {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function transition(row, to, reason) {
  const from = row.lease_state;
  row.lease_state = to;
  console.log(`[reaper] ${row.host}/${row.name} ${from}->${to} epoch=${row.epoch} reason=${reason}`);
}

function tick() {
  reaperLastTickAt = now();
  const t = reaperLastTickAt;
  for (const row of sessions.values()) {
    if (row.lease_state === 'active' && row.expires_at != null && row.expires_at <= t) {
      row.suspect_at = t;
      transition(row, 'suspect', 'lease_expired');
      continue;
    }
    if (row.lease_state === 'suspect' && row.suspect_at != null && t - row.suspect_at > 2 * TTL_S * 1000) {
      // M4: mac rows are headstone-only, never reaped and never killed.
      if (row.host === 'mac') transition(row, 'pinger_dead', 'mac_never_reaped');
      else if (tmuxLive(row.name)) transition(row, 'pinger_dead', 'tmux_live');
      else {
        row.reaped_at = t;
        transition(row, 'reaped', 'suspect_window_elapsed');
      }
    }
  }
}

const timer = setInterval(tick, Math.max(1, Math.round(REAP_TICK_S * 1000)));
timer.unref?.();

// --- request plumbing --------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const fail = (code, msg) => reject(Object.assign(new Error(msg), { code }));
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Drain the rest instead of destroying the socket: the client must actually read
        // the 413 rather than see a connection reset.
        chunks.length = 0;
        req.removeAllListeners('data');
        req.resume();
        fail(413, 'too_large');
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return fail(400, 'bad_json');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'bad_json');
      resolve(parsed);
    });
    req.on('error', () => fail(400, 'bad_json'));
  });
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const rowOf = (b) => sessions.get(key(str(b.host), str(b.name)));

// --- contract routes ---------------------------------------------------------
function claim(res, b) {
  const host = str(b.host);
  const name = str(b.name);
  if (!host || !name) return json(res, 400, { error: 'host_and_name_required' });
  // Primary identity gets the same gate as the parent edge and the same gate as production
  // (server.js:491). It also guarantees no tab can reach key(host,name).
  if (!(host === 'mac' || HOSTS.includes(host)) || !SAFE_NAME.test(name))
    return json(res, 400, { error: 'unknown host or bad session name' });

  const parentHost = str(b.parent_host);
  const parentName = str(b.parent_name);
  const hasParent = b.parent_host != null || b.parent_name != null;
  if (hasParent) {
    if (!parentHost || !parentName) return json(res, 400, { error: 'parent_host_and_parent_name_required' });
    if (!PARENT_HOSTS.has(parentHost)) return json(res, 400, { error: 'bad_parent_host' });
    if (!SAFE_NAME.test(parentHost) || !SAFE_NAME.test(parentName)) return json(res, 400, { error: 'bad_parent_name' });
    if (parentHost === host && parentName === name) return json(res, 400, { error: 'self_parent' });
  }

  // One synchronous txn (M1): no await between read and write, so a re-claim fences the
  // prior incarnation - the old epoch is stale the instant this returns.
  const k = key(host, name);
  const row = sessions.get(k) || {
    host,
    name,
    worker: null,
    role: null,
    pid: null,
    parent_host: null,
    parent_name: null,
    epoch: 0,
  };
  row.epoch = (row.epoch || 0) + 1;
  row.lease_state = 'active';
  row.suspect_at = null;
  row.reaped_at = null;
  // Integer unix-ms (S4), even for a fractional FD_STUB_TTL_S.
  row.expires_at = now() + Math.round(TTL_S * 1000);
  if (b.worker != null) row.worker = str(b.worker) || null;
  if (b.role != null) row.role = str(b.role) || null;
  if (b.pid != null) row.pid = b.pid;
  if (hasParent) {
    row.parent_host = parentHost;
    row.parent_name = parentName;
  }
  sessions.set(k, row);
  if (!beats.has(k)) beats.set(k, []);
  json(res, 200, { epoch: row.epoch, expires_at: row.expires_at, ttl_s: TTL_S });
}

function heartbeat(res, b) {
  const row = rowOf(b);
  // 404, not 409, for a row that is not there at all. Verified against Lane 1's server.js on
  // 2026-08-28: it answers `404 {"error":"no lease for this session - claim first"}`, and the
  // contract only ever specifies 409 for a missing or stale epoch on a row that EXISTS. The
  // difference is load-bearing for the pinger: 409 is a stop-and-alert, 404 is transient, and
  // a wiped or restarted deck must not stop every pinger in the fleet.
  if (!row) return json(res, 404, { error: 'no lease for this session - claim first' });
  // M2: a reaped row never resurrects, whatever epoch the pinger holds.
  if (row.lease_state === 'reaped') return json(res, 410, { reason: 'reaped', reaped_at: row.reaped_at });
  if (typeof b.epoch !== 'number' || !Number.isFinite(b.epoch) || b.epoch !== row.epoch)
    return json(res, 409, { current_epoch_hint: false, reason: 'stale_epoch' });

  const t = now();
  row.expires_at = t + Math.round(TTL_S * 1000);
  if (row.lease_state !== 'active') {
    // A pinger_dead (or suspect) row that beats again with the current epoch is alive.
    row.suspect_at = null;
    transition(row, 'active', 'heartbeat');
  }
  beats.get(key(row.host, row.name)).push(t);
  // Liveness-only (S7): no status field by design.
  json(res, 200, { expires_at: row.expires_at, ttl_s: TTL_S, lease_state: row.lease_state });
}

function listSessions(res) {
  const out = [...sessions.values()].map((r) => ({
    host: r.host,
    name: r.name,
    worker: r.worker ?? null,
    role: r.role ?? null,
    pid: r.pid ?? null,
    parent_host: r.parent_host ?? null,
    parent_name: r.parent_name ?? null,
    epoch: r.epoch,
    lease_state: r.lease_state,
    expires_at: r.expires_at ?? null,
    suspect_at: r.suspect_at ?? null,
    reaped_at: r.reaped_at ?? null,
  }));
  json(res, 200, { sessions: out });
}

// --- test-control routes: NOT part of the contract ---------------------------
// Everything under /_test/ is stub-only scaffolding for Lane 2's pinger tests. The real
// server (Lane 1) has none of it. These are always served normally, even in down/slow
// mode, so a test can always reset the stub.
function testRoute(res, path, b) {
  if (path === '/_test/reset') {
    sessions.clear();
    beats.clear();
    mode = 'normal';
    flakyCount = 0;
    reaperLastTickAt = null;
    return json(res, 200, { ok: true });
  }
  if (path === '/_test/reap') {
    const row = rowOf(b);
    if (!row) return json(res, 404, { error: 'not_found' });
    row.reaped_at = now();
    transition(row, 'reaped', 'test_forced');
    return json(res, 200, { ok: true, reaped_at: row.reaped_at });
  }
  if (path === '/_test/expire') {
    const row = rowOf(b);
    if (!row) return json(res, 404, { error: 'not_found' });
    row.expires_at = now() - 1000;
    return json(res, 200, { ok: true, expires_at: row.expires_at });
  }
  if (path === '/_test/tailnet_key') {
    // Arms or disarms the S3 gate on a RUNNING stub - the one thing an env var cannot do, and
    // exactly the operator action this exists to rehearse: the key goes on while sessions are
    // already beating. `key` is write-only; nothing ever reads it back out of this stub.
    const k = typeof b.key === 'string' ? b.key.trim() : '';
    if (/["\\]/.test(k)) return json(res, 400, { error: 'bad_key' });
    tailnetKey = k;
    return json(res, 200, { ok: true, tailnet_key: tailnetKey ? 'armed' : 'unset' });
  }
  if (path === '/_test/mode') {
    const m = str(b.mode);
    if (!['normal', 'flaky', 'down', 'slow'].includes(m)) return json(res, 400, { error: 'bad_mode' });
    mode = m;
    flakyCount = 0;
    return json(res, 200, { ok: true, mode });
  }
  if (path === '/_test/state') {
    const rows = [...sessions.entries()].map(([k, r]) => ({ ...r, beats: beats.get(k) || [] }));
    return json(res, 200, {
      mode,
      ttl_s: TTL_S,
      now: now(),
      reaper_last_tick_at: reaperLastTickAt,
      sessions: rows,
      counts: {
        sessions: sessions.size,
        beats: [...beats.values()].reduce((n, a) => n + a.length, 0),
        by_state: rows.reduce((acc, r) => ((acc[r.lease_state] = (acc[r.lease_state] || 0) + 1), acc), {}),
      },
    });
  }
  return json(res, 404, { error: 'not_found' });
}

function serveContract(req, res, path, body) {
  if (req.method === 'POST' && path === '/api/lease/claim') return claim(res, body);
  if (req.method === 'POST' && path === '/api/heartbeat') return heartbeat(res, body);
  if (req.method === 'GET' && path === '/api/sessions') return listSessions(res);
  if (req.method === 'GET' && path === '/api/health')
    return json(res, 200, { ok: true, reaper_last_tick_at: reaperLastTickAt, now: now(), ttl_s: TTL_S });
  return json(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  let body = {};
  try {
    if (req.method === 'POST' || req.method === 'PUT') body = await readBody(req);
  } catch (e) {
    const code = e.code === 413 ? 413 : 400;
    return json(res, code, { error: code === 413 ? 'too_large' : 'bad_json' });
  }

  // Test-control routes are never gated: a harness must always be able to reset the stub,
  // exactly as it is never gated on the real server (it has no /_test/ at all).
  if (path.startsWith('/_test/')) return testRoute(res, path, body);

  // Her order, exactly: 403 for a Host that is not ours, then 401 for a bad or missing key.
  if (tailnetKey && !tailnetHostOk(req)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('forbidden');
  }
  if (req.method === 'POST' && !tailnetAuthed(req)) {
    res.writeHead(401, { 'content-type': 'text/plain' });
    return res.end('unauthorized');
  }

  // Fault injection applies to contract routes only.
  if (mode === 'down') return json(res, 503, { error: 'synthetic_down' });
  if (mode === 'flaky' && ++flakyCount % 2 === 0) return json(res, 500, { error: 'synthetic' });
  if (mode === 'slow') return setTimeout(() => serveContract(req, res, path, body), 2000);
  serveContract(req, res, path, body);
});

server.listen(PORT, HOST, () => {
  console.log(
    `fd stub listening on http://${HOST}:${PORT} ttl_s=${TTL_S} reap_tick_s=${REAP_TICK_S} ` +
      `tailnet_key=${tailnetKey ? 'armed' : 'unset'} (NOT the real server)`
  );
  if (!tmuxAvailable())
    console.warn(
      '[stub] WARNING: tmux is not available. The M5 second liveness sample always reads ' +
        '"dead", so every suspect row reaps and no pinger_dead test can fail. Results are void.'
    );
});

for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    // A held-open keepalive socket must not wedge the shutdown.
    setTimeout(() => process.exit(0), 500).unref();
  });
