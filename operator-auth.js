// Operator sign-in (DECK-108).
//
// Every agent on this Mac runs as the operator's own macOS user, so an Origin header proves
// nothing. A write needs a session, and a session needs the operator's password, whose scrypt hash
// lives in the operator file (~/.fleetdeck/operator.json, written by scripts/deck-operator-init.js).
// The session is also the only way to make the deck sign a click (signer.js).
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
// N=32768, r=8 needs 32 MiB; node's default maxmem is exactly that and refuses it.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const B64 = '[A-Za-z0-9+/]+={0,2}';
const STORED = new RegExp('^scrypt\\$(\\d+)\\$(\\d+)\\$(\\d+)\\$(' + B64 + ')\\$(' + B64 + ')$');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const m = typeof stored === 'string' && STORED.exec(stored);
  if (!m || typeof password !== 'string') return false;
  const [N, r, p] = [m[1], m[2], m[3]].map(Number);
  const salt = Buffer.from(m[4], 'base64');
  const want = Buffer.from(m[5], 'base64');
  if (salt.length < 16 || want.length !== 32) return false;
  try {
    const got = await scrypt(password, salt, 32, { N, r, p, maxmem: SCRYPT.maxmem });
    return crypto.timingSafeEqual(got, want);
  } catch {
    return false; // parameters scrypt refuses (N not a power of two, over maxmem)
  }
}

// Identity providers: how the operator proves who they are at sign-in. This is the swap point for
// the DECK-109 design (a passkey, a hardware key): a provider is { kind, verify(body) } and nothing
// outside this function knows which one is in use. Throws on a shape it cannot use.
function identityFrom(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity))
    throw new Error('operator file: identity must be an object');
  if (identity.kind === 'password') {
    if (typeof identity.hash !== 'string' || !STORED.test(identity.hash))
      throw new Error('operator file: identity.hash must be an scrypt$N$r$p$salt$hash string');
    return { kind: 'password', verify: (body) => verifyPassword(body && body.password, identity.hash) };
  }
  throw new Error('operator file: identity.kind must be password');
}

const OPERATOR_ID = /^[A-Za-z0-9._@-]{1,64}$/;

const onlyFields = (o, allowed, prefix) => {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) throw new Error('operator file: unknown field ' + prefix + k.slice(0, 40));
};

// { "version": 1, "operatorId": "…", "identity": { "kind": "password", "hash": "scrypt$…" } }, strictly.
// Every message names the field, never its value: the log line a broken file produces must not
// carry the hash, and JSON.parse's own message quotes the text it choked on.
function loadOperator(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    throw new Error('operator file: not valid JSON');
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('operator file: must be a JSON object');
  onlyFields(s, ['version', 'operatorId', 'identity'], '');
  if (s.version !== 1) throw new Error('operator file: version must be 1');
  if (typeof s.operatorId !== 'string' || !OPERATOR_ID.test(s.operatorId))
    throw new Error('operator file: operatorId must match [A-Za-z0-9._@-]{1,64}');
  identityFrom(s.identity);
  onlyFields(s.identity, ['kind', 'hash'], 'identity.');
  return { operatorId: s.operatorId, identity: { kind: s.identity.kind, hash: s.identity.hash } };
}

// The operator file's fingerprint: deck-operator-init prints it, the deck logs it at boot, so a
// replaced file shows as a different value after a restart. 8 hex of sha256(identity.hash): the
// hash is readable by every same-user agent anyway, so this gives nothing away.
const operatorFingerprint = (identity) => crypto.createHash('sha256').update(identity.hash).digest('hex').slice(0, 8);

const COOKIE = 'fleetdeck_operator';
const HEADER = 'x-fleetdeck-session';
const TTL_MS = 12 * 3600e3;
const MAX_WRONG = 5;
const WINDOW_MS = 60e3;
const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');

function cookieToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

// `operator` null is a deck with no operator file: sign-in answers 409 and every unblock write
// fails closed (unblock.js). `signer` is the click signer's kind, reported by the session GET.
function createOperatorAuth({ operator, allowedOrigins, signer = null, now = Date.now }) {
  const identity = operator ? identityFrom(operator.identity) : null;
  // A session is two tokens: the HttpOnly cookie and a header token handed out once in the sign-in
  // body. Browsers send cookies to every port on 127.0.0.1/localhost, so any dev server the
  // operator opens would receive a replayable cookie; the header token lives only in the deck
  // page's memory, which no other port can read (a reload means signing in again). Keyed by sha256(cookie) and holding
  // sha256(header), so the map never holds a usable token. In memory only: a restart signs
  // everyone out, which is the point.
  const sessions = new Map();
  // The sign-in rate limit: a fixed window opened by the first attempt, at most MAX_WRONG wrong
  // passwords in it. Global, not per client: every caller is loopback, so there is none to tell apart.
  let windowStart = 0;
  let wrong = 0;
  let pending = 0;
  // The window whose trip is already logged: a guessing loop leaves one line per window, not one per try.
  let loggedTrip = null;

  function session(req) {
    const token = cookieToken(req);
    const header = req.headers[HEADER];
    if (!operator || !token || typeof header !== 'string') return null;
    const key = digest(token);
    const s = sessions.get(key);
    if (!s) return null;
    if (s.expiresAt <= now()) {
      sessions.delete(key);
      return null;
    }
    return crypto.timingSafeEqual(Buffer.from(digest(header), 'hex'), Buffer.from(s.header, 'hex')) ? s : null;
  }
  const operatorOf = (req) => {
    const s = session(req);
    return s ? s.operatorId : null;
  };

  const cookie = (value, maxAge) =>
    COOKIE + '=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge;

  async function route(req, res, p, { json, send, body }) {
    if (p === '/api/operator/session') {
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'method not allowed');
      // A same-origin browser GET carries no Origin, so — like the sheet POST — only a present,
      // foreign one is refused.
      if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return send(res, 403, 'text/plain', 'forbidden');
      const s = session(req);
      return json(res, {
        configured: !!operator,
        signedIn: !!s,
        operatorId: s ? s.operatorId : null,
        expiresAt: s ? new Date(s.expiresAt).toISOString() : null,
        signer,
      });
    }
    if (p !== '/api/operator/signin' && p !== '/api/operator/signout') return send(res, 404, 'text/plain', 'not found');
    if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
    if (!allowedOrigins.has(req.headers.origin)) return send(res, 403, 'text/plain', 'forbidden');

    if (p === '/api/operator/signout') {
      const token = cookieToken(req);
      if (token) sessions.delete(digest(token));
      res.setHeader('set-cookie', cookie('', 0));
      return json(res, { signedIn: false });
    }

    if (!operator) return json(res, { error: 'sign-in not configured' }, 409);
    const b = await body(req).catch(() => null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, { error: 'bad request body' }, 400);
    // The check and the pending count sit together with no await between them, and an in-flight
    // (slow) verify counts as wrong until it is known, so parallel guesses cannot all start. A
    // refused attempt is neither verified nor counted, and never moves the window.
    const t0 = now();
    if (windowStart && t0 - windowStart >= WINDOW_MS) [windowStart, wrong] = [0, 0];
    // Audit lines carry the outcome only — never the password or the body.
    if (wrong + pending >= MAX_WRONG) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + WINDOW_MS - t0) / 1000));
      if (loggedTrip !== windowStart) {
        loggedTrip = windowStart;
        console.log('operator: sign-in rate-limited (' + MAX_WRONG + ' wrong in ' + WINDOW_MS / 1000 + ' s window, retry in ' + retryAfter + ' s)');
      }
      res.setHeader('retry-after', String(retryAfter));
      return json(res, { error: 'too many attempts', retryAfter }, 429);
    }
    if (!windowStart) windowStart = t0;
    pending++;
    let ok;
    try {
      ok = await identity.verify(b);
    } finally {
      pending--;
    }
    if (!ok) {
      wrong++;
      console.log('operator: sign-in refused (wrong password)');
      return json(res, { error: 'wrong password' }, 401);
    }
    [windowStart, wrong] = [0, 0];
    const t = now();
    for (const [k, s] of sessions) if (s.expiresAt <= t) sessions.delete(k);
    // A sign-in that still carries an old session's cookie ends that session.
    const old = cookieToken(req);
    if (old) sessions.delete(digest(old));
    const token = crypto.randomBytes(32).toString('base64url');
    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = t + TTL_MS;
    sessions.set(digest(token), { header: digest(sessionToken), operatorId: operator.operatorId, expiresAt });
    res.setHeader('set-cookie', cookie(token, TTL_MS / 1000));
    return json(res, { signedIn: true, operatorId: operator.operatorId, expiresAt: new Date(expiresAt).toISOString(), sessionToken });
  }

  return { configured: !!operator, operatorId: operator ? operator.operatorId : null, operator: operatorOf, route };
}

module.exports = { hashPassword, verifyPassword, identityFrom, loadOperator, operatorFingerprint, createOperatorAuth, OPERATOR_ID };
