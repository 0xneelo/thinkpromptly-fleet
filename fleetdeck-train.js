// fleetdeck-train — the GitHub train broker, split out of server.js so the train window
// outlives every deck restart. Started by the com.fleetdeck.train LaunchAgent (mac/), which
// runs it inside the operator's GUI login session because `op` only reaches the 1Password
// desktop app from there.
//
// It holds exactly one secret and holds it in memory: the App PEM, for the length of a train.
// Nothing here writes state to disk, and no log line ever carries a PEM, a token or a JWT.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

// Loopback only, and not overridable to a routable address by accident: a box worker reaches
// the train through the deck's tailnet listener, never this process directly.
const PORT = Number(process.env.FLEET_TRAIN_PORT) || 3132;
const BIND = process.env.FLEET_TRAIN_BIND || '127.0.0.1';
// Test seams, same convention as FLEET_SSH_BIN: a fixture names the binary/path/base URL.
const GH_ENV = process.env.FLEET_GH_ENV || path.join(__dirname, 'deploy-keys', 'github-app.env');
const OP_BIN = process.env.FLEET_OP_BIN || 'op';
const GH_API = process.env.FLEET_GH_API || 'https://api.github.com';
const NO_LISTEN = process.env.FLEET_TRAIN_NO_LISTEN === '1';
// The Linux CI box has no caffeinate; skipping it leaves ghTrain.caffeinate null.
const NO_CAFFEINATE = process.env.FLEET_TRAIN_NO_CAFFEINATE === '1';

// "Loopback only" is an invariant, not a default. FLEET_TRAIN_BIND exists so a test can pick
// a second loopback address, not so the broker can be moved onto a real interface: the Host
// allowlist below is derived from BIND, so a routable BIND would put the PEM-holding process
// on the network while the rebinding guard quietly agreed with it. Refuse to start instead.
if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^::1$|^localhost$/.test(BIND)) {
  console.error(
    'fleetdeck-train: FLEET_TRAIN_BIND=' + BIND + ' is not a loopback address. The broker ' +
      'holds the GitHub App PEM and must never listen on a routable interface; box workers ' +
      'reach the train through the deck tailnet listener, never this process.'
  );
  process.exit(2);
}

const TTL_MS = { '1h': 3600e3, '4h': 4 * 3600e3, '8h': 8 * 3600e3 };

// The signature comes from the 1Password agent, which pops an approval on this Mac —
// the timeout has to outlast a human walking back to the keyboard.
const MINT_TIMEOUT = 120000;

// Never rejects: callers need stderr/exit info.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      resolve({ err, stdout: stdout || '', stderr: stderr || '' })
    );
  });
}

// --- GitHub train: the App PEM is fetched from 1Password once, held in this process's
// memory for the train window and never logged, written to disk or sent to a browser.
// While a train runs, any local process can GET a fresh 1h installation token.

const GH_ENV_UNREADABLE = 'deploy-keys/github-app.env unreadable — the GitHub App config is missing';

// Read per request so a corrected id takes effect without restarting the broker.
// Format is `export KEY=VALUE`, the same file the shell script sources.
// Returns null when the file cannot be read, so a route answers JSON rather than throwing.
function ghConfig() {
  let raw;
  try {
    raw = fs.readFileSync(GH_ENV, 'utf8');
  } catch (e) {
    return null;
  }
  const cfg = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*export\s+([A-Z_]+)=(.*)$/);
    if (m) cfg[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return cfg;
}

let ghTrain = null; // { pem, expiresAt, timer, caffeinate } while a train is running

function endTrain(reason) {
  if (!ghTrain) return;
  // Lifecycle only — never the PEM, a token or a JWT. Without these lines the broker's log
  // cannot answer "did the window survive that restart", which is the question it exists for.
  console.log(new Date().toISOString() + ' train ended: ' + (reason || 'unspecified'));
  clearTimeout(ghTrain.timer);
  try {
    if (ghTrain.caffeinate) ghTrain.caffeinate.kill();
  } catch (e) {
    // ESRCH: caffeinate already exited on its own -t deadline, which is the outcome we wanted.
    if (e.code !== 'ESRCH') console.error('caffeinate kill failed:', e.message);
  }
  ghTrain = null;
}

// op prints the document to stdout; its own error text (locked vault, CLI integration
// off) is what the operator needs to see, so stderr goes to the UI verbatim.
async function startTrain(ttl) {
  const cfg = ghConfig();
  if (!cfg) return { code: 500, body: { ok: false, error: GH_ENV_UNREADABLE } };
  const keyOp = cfg.GH_APP_KEY_OP;
  if (!keyOp) return { code: 500, body: { ok: false, error: 'GH_APP_KEY_OP missing from deploy-keys/github-app.env' } };
  const { err, stdout, stderr } = await run(OP_BIN, ['document', 'get', keyOp], { timeout: MINT_TIMEOUT });
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
  endTrain('replaced by a new train'); // a second start replaces the running train rather than stacking timers
  const expiresAt = Date.now() + TTL_MS[ttl];
  // Keeps the Mac from idle-sleeping while a train is active, so a box worker can still
  // reach the broker. Lid-close on battery still sleeps it — documented limitation.
  let caffeinate = null;
  if (!NO_CAFFEINATE) {
    caffeinate = spawn('caffeinate', ['-i', '-t', String(TTL_MS[ttl] / 1000)], {
      detached: true,
      stdio: 'ignore',
    });
    caffeinate.on('error', (e) => console.error('caffeinate failed:', e.message)); // never kill the broker over it
    caffeinate.unref();
  }
  ghTrain = { pem: stdout, expiresAt, timer: setTimeout(() => endTrain('ttl expired'), TTL_MS[ttl]), caffeinate };
  console.log(new Date().toISOString() + ' train started: ttl=' + ttl + ' until ' + new Date(expiresAt).toISOString());
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
  if (!cfg) return { code: 500, body: { ok: false, error: GH_ENV_UNREADABLE } };
  // Numeric check doubles as the guard for the id interpolated into the API path.
  if (!/^\d+$/.test(cfg.GH_APP_ID || '') || !/^\d+$/.test(cfg.GH_APP_INSTALLATION_ID || ''))
    return { code: 500, body: { ok: false, error: 'GH_APP_ID / GH_APP_INSTALLATION_ID must be numeric in deploy-keys/github-app.env' } };
  let r;
  try {
    r = await fetch(
      GH_API + '/app/installations/' + cfg.GH_APP_INSTALLATION_ID + '/access_tokens',
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

// --- HTTP. Same helpers as the deck's, kept small on purpose: this process serves four routes.
function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}

const json = (res, obj, code = 200) => send(res, code, 'application/json', JSON.stringify(obj));

async function body(req, maxBytes = 4096) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > maxBytes) throw new Error('body too large');
  }
  return JSON.parse(data || '{}');
}

// DNS-rebinding guard: a page on any origin can make the browser resolve a name it controls
// to 127.0.0.1, so binding to loopback alone is not a gate. The Host authority has to be one
// we chose, exactly as the deck's two listeners check theirs.
const ALLOWED_HOSTS = new Set([BIND + ':' + PORT, 'localhost:' + PORT]);

// No Origin check here on purpose. The deck keeps the fail-closed ALLOWED_ORIGINS gate on the
// start/stop POSTs; the deck's own proxy request carries no Origin, so an Origin rule here
// would either reject the deck or have to trust a header the deck already vouched for.
async function handler(req, res) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, 'text/plain', 'forbidden');
  const p = new URL(req.url, 'http://localhost').pathname;
  try {
    if (p === '/api/ghtoken') {
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'method not allowed');
      const r = await ghToken();
      return json(res, r.body, r.code);
    }
    if (p === '/api/ghtrain') {
      if (req.method === 'GET')
        return json(res, { active: !!ghTrain, expiresAt: ghTrain ? ghTrain.expiresAt : null });
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      const b = await body(req).catch(() => null);
      if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);
      if (!TTL_MS[b.ttl]) return json(res, { ok: false, error: 'ttl must be 1h, 4h or 8h' }, 400);
      const r = await startTrain(b.ttl);
      return json(res, r.body, r.code);
    }
    if (p === '/api/ghtrain/end') {
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      endTrain('ended by operator');
      return json(res, { ok: true });
    }
  } catch (e) {
    return send(res, 500, 'text/plain', String(e.message));
  }
  send(res, 404, 'text/plain', 'not found');
}

const server = http.createServer(handler);

if (!NO_LISTEN)
  server.listen(PORT, BIND, () => console.log('fleetdeck-train http://' + BIND + ':' + PORT));

// launchd stop/restart must leave no window behind: a train that survived a SIGTERM would be
// a PEM held by a process nobody thinks is running.
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    // Clearing the window is synchronous and happens first, so it cannot be lost.
    endTrain('broker stopping (' + sig + ')');
    // process.exit() truncates a pending stdout/stderr write, and under launchd both are
    // redirected to a log file rather than a TTY — so the last diagnostic line before a
    // stop would be the one that goes missing. Close the listener and let the loop drain,
    // with a hard deadline so a lingering keep-alive socket cannot make launchd wait.
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });

module.exports = { server, handler, ghTokenForTest: ghToken, endTrain };
