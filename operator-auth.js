// Operator sign-in and answer signing (DECK-108 layer 1).
//
// Every agent on this Mac runs as the operator's own macOS user, so an Origin header proves
// nothing and fleet.db is writable by all of them. The deck secret (root:wheel 0600, read only by
// the operator-run up.sh through sudo and handed to node on fd 3) holds the one thing an agent
// cannot get: the HMAC key an answer is signed with, and the password hash a session is minted on.
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
    throw new Error('deck secret: identity must be an object');
  if (identity.kind === 'password') {
    if (typeof identity.hash !== 'string' || !STORED.test(identity.hash))
      throw new Error('deck secret: identity.hash must be an scrypt$N$r$p$salt$hash string');
    return { kind: 'password', verify: (body) => verifyPassword(body && body.password, identity.hash) };
  }
  throw new Error('deck secret: identity.kind must be password');
}

const OPERATOR_ID = /^[A-Za-z0-9._@-]{1,64}$/;

// Every message names the field, never its value: the log line a broken secret produces must not
// carry the key or the hash, and JSON.parse's own message quotes the text it choked on.
function loadDeckSecret(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    throw new Error('deck secret: not valid JSON');
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('deck secret: must be a JSON object');
  if (s.version !== 1) throw new Error('deck secret: version must be 1');
  if (typeof s.hmacKey !== 'string' || !/^[0-9a-f]{64}$/i.test(s.hmacKey))
    throw new Error('deck secret: hmacKey must be 64 hex characters');
  if (typeof s.operatorId !== 'string' || !OPERATOR_ID.test(s.operatorId))
    throw new Error('deck secret: operatorId must match [A-Za-z0-9._@-]{1,64}');
  identityFrom(s.identity);
  return {
    hmacKey: Buffer.from(s.hmacKey, 'hex'),
    operatorId: s.operatorId,
    identity: { kind: s.identity.kind, hash: s.identity.hash },
  };
}

const COOKIE = 'fleetdeck_operator';
const TTL_MS = 12 * 3600e3;
const MAX_WRONG = 5;
const LOCK_MS = 60e3;
const HEX64 = /^[0-9a-f]{64}$/;
const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');

function cookieToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

// `secret` null is an unconfigured deck: sign-in answers 409, nothing is signed, and the unblock
// writes fall back to the Origin gate alone — which up.sh and the boot log both say out loud.
function createOperatorAuth({ secret, allowedOrigins }) {
  const identity = secret ? identityFrom(secret.identity) : null;
  // Keyed by sha256(token), so the map never holds a usable token. In memory only: a restart signs
  // everyone out, which is the point — a session outlives neither the deck nor its secret.
  const sessions = new Map();
  let strikes = 0;
  let lockedUntil = 0;

  function operator(req) {
    const token = cookieToken(req);
    if (!secret || !token) return null;
    const key = digest(token);
    const s = sessions.get(key);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      sessions.delete(key);
      return null;
    }
    return s.operatorId;
  }

  // The DECK-108 text reads `sheetId|qid|choice|answeredAt|operator_id`. A qid or an option key may
  // itself contain `|`, so a bare join is not injective ('a|b'+'c' and 'a'+'b|c' would share a MAC);
  // URI-encoding every field removes `|` from them, and the domain prefix pins what is being signed.
  const mac = (f) =>
    crypto
      .createHmac('sha256', secret.hmacKey)
      .update('fleetdeck-answer-v1|' + [f.sheetId, f.qid, f.choice, f.answeredAt, f.operatorId].map(encodeURIComponent).join('|'))
      .digest();

  function signAnswer(f) {
    return secret ? mac(f).toString('hex') : null;
  }

  function answerSigValid(f) {
    if (!secret) return false;
    for (const k of ['sheetId', 'qid', 'choice', 'answeredAt', 'operatorId'])
      if (typeof f[k] !== 'string') return false;
    if (typeof f.sig !== 'string' || !HEX64.test(f.sig)) return false;
    return crypto.timingSafeEqual(Buffer.from(f.sig, 'hex'), mac(f));
  }

  const cookie = (value, maxAge) =>
    COOKIE + '=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge;

  async function route(req, res, p, { json, send, body }) {
    if (p === '/api/operator/session') {
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'method not allowed');
      const token = cookieToken(req);
      const operatorId = operator(req);
      const s = operatorId && sessions.get(digest(token));
      return json(res, {
        configured: !!secret,
        signedIn: !!operatorId,
        operatorId: operatorId || null,
        expiresAt: s ? new Date(s.expiresAt).toISOString() : null,
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

    if (!secret) return json(res, { error: 'sign-in not configured' }, 409);
    const b = await body(req).catch(() => null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, { error: 'bad request body' }, 400);
    // Global, not per client: every caller is loopback, so there is no client to tell apart. The
    // lock check and the strike sit together with no await between them, and the strike is taken
    // before the (slow) verify, so parallel guesses cannot all start under the limit.
    const now = Date.now();
    if (now < lockedUntil)
      return json(res, { error: 'too many attempts', retryAfter: Math.ceil((lockedUntil - now) / 1000) }, 429);
    if (++strikes > MAX_WRONG) {
      lockedUntil = now + LOCK_MS;
      strikes = 0;
      return json(res, { error: 'too many attempts', retryAfter: LOCK_MS / 1000 }, 429);
    }
    if (!(await identity.verify(b))) {
      if (strikes >= MAX_WRONG) {
        lockedUntil = Date.now() + LOCK_MS;
        strikes = 0;
      }
      return json(res, { error: 'wrong password' }, 401);
    }
    strikes = 0;
    const t = Date.now();
    for (const [k, s] of sessions) if (s.expiresAt <= t) sessions.delete(k);
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = t + TTL_MS;
    sessions.set(digest(token), { operatorId: secret.operatorId, expiresAt });
    res.setHeader('set-cookie', cookie(token, TTL_MS / 1000));
    return json(res, { signedIn: true, operatorId: secret.operatorId, expiresAt: new Date(expiresAt).toISOString() });
  }

  return { configured: !!secret, operator, route, signAnswer, answerSigValid };
}

module.exports = { hashPassword, verifyPassword, identityFrom, loadDeckSecret, createOperatorAuth, OPERATOR_ID };
