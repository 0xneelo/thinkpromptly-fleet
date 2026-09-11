// Click signing (DECK-108 layer 2): a deploy-class unblock answer is signed with the operator's SSH
// key through `ssh-keygen -Y sign` and verified with `ssh-keygen -Y verify` against allowed_signers.
// This module is the only sign/verify entry for the deck's routes and for the seat-side CLI.
//
// The signed bytes, verbatim (UTF-8, no trailing newline):
//   v2|sheetId|qid|choice|answeredAt|operator_id|project|expiresAt|question_sha256
// Each field is escaped first — `%` → `%25`, then `|` → `%7C` — so the join stays injective and
// plain ids read unchanged. A lone surrogate is refused: UTF-8 would encode it as U+FFFD, the same
// bytes as a real U+FFFD.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NAMESPACE = 'fleetdeck-unblock';
const FIELDS = ['sheetId', 'qid', 'choice', 'answeredAt', 'operatorId', 'project', 'expiresAt', 'questionSha256'];
const escape = (v) => v.replace(/%/g, '%25').replace(/\|/g, '%7C');
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function joined(tag, f, keys) {
  return [tag, ...keys.map((k) => {
    if (typeof f[k] !== 'string' || !f[k].isWellFormed()) throw new TypeError(tag + ': ' + k + ' must be a well-formed string');
    return escape(f[k]);
  })].join('|');
}
const canonical = (f) => joined('v2', f, FIELDS);

// `question` exactly as GET /api/unblock/:id returns it; any field added to it moves the hash.
// JSON.stringify escapes a lone surrogate (`\ud800`), so these bytes stay injective without a check.
const questionSha256 = (question) => sha256(JSON.stringify(question));

// The sheet's own words as GET /api/unblock/:id serves them: title, intro ('' when absent) and
// source.project ('' unless a string). A JSON array, so the three stay apart without escaping.
const sheetSha256 = ({ title, intro, source }) =>
  sha256(JSON.stringify([title, intro == null ? '' : intro, source && typeof source.project === 'string' ? source.project : '']));

// The seat's pin, from its own POST: binds the sheet, the question id, the question text and the
// sheet's own words, so the same question copied onto another sheet — or its sheet retitled into a
// "drill" — pins differently. Lowercase hex SHA-256 of the UTF-8 bytes of
//   v2-pin|sheetId|qid|question_sha256|sheet_sha256
// escaped and refused like canonical().
const pin = (sheetId, qid, questionSha256, sheetSha256) =>
  sha256(joined('v2-pin', { sheetId, qid, questionSha256, sheetSha256 }, ['sheetId', 'qid', 'questionSha256', 'sheetSha256']));

// allowed_signers lines: `principals [options] keytype base64 [comment]`. An options field may be
// quoted (namespaces="a,b"), so tokens keep their quotes whole.
function parseAllowedSigners(text) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const i = tokens.findIndex((t, n) => n > 0 && /^(ssh-|ecdsa-|sk-)/.test(t));
    if (i < 1 || !tokens[i + 1]) continue;
    lines.push({ principals: tokens[0].replace(/"/g, '').split(','), key: tokens[i] + ' ' + tokens[i + 1] });
  }
  return lines;
}

// OpenSSH's `SHA256:<unpadded base64>` of a public key blob.
const fingerprint = (blob) => 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');

// The key that made an armored SSHSIG: magic "SSHSIG", uint32 version, then the public key blob.
function signatureKey(armored) {
  const buf = Buffer.from(armored.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
  if (buf.length < 14 || buf.toString('latin1', 0, 6) !== 'SSHSIG') return null;
  const len = buf.readUInt32BE(10);
  return 14 + len <= buf.length ? fingerprint(buf.subarray(14, 14 + len)) : null;
}

const withoutAgent = () => {
  const env = { ...process.env };
  delete env.SSH_AUTH_SOCK;
  return env;
};

// Detached, so the timeout kill (-pid) also takes down anything ssh-keygen is blocked on (the
// 1Password prompt) — the same shape as the cert mint in server.js. `fd3`, when a string, is
// written to the child's fd 3 (read as /dev/fd/3).
function run(bin, args, input, { env, timeoutMs, fd3 }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { detached: true, env, stdio: ['pipe', 'pipe', 'pipe', ...(fd3 === undefined ? [] : ['pipe'])] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (e) {
        // ESRCH: the group is already gone, which is the outcome we wanted anyway.
        if (e.code !== 'ESRCH') console.error('signer kill failed:', e.message);
      }
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: e.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {}); // EPIPE: the child exited before reading the message
    child.stdin.end(input);
    if (fd3 !== undefined) {
      child.stdio[3].on('error', () => {});
      child.stdio[3].end(fd3);
    }
  });
}

// allowed_signers is a path (`allowedSigners`, read by ssh-keygen on every verify) or its text
// (`allowedSignersText`, handed over on fd 3 — the deck's boot-time snapshot).
async function verifySignature({ allowedSigners, allowedSignersText, principal, message, signature, namespace = NAMESPACE, bin = 'ssh-keygen' }) {
  if (typeof signature !== 'string' || typeof message !== 'string' || typeof principal !== 'string' || !principal)
    return { ok: false, key: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-verify-')); // mkdtemp creates it 0700
  try {
    const sigFile = path.join(dir, 'answer.sig');
    fs.writeFileSync(sigFile, signature, { mode: 0o600 });
    const snapshot = typeof allowedSignersText === 'string';
    const r = await run(bin, ['-Y', 'verify', '-f', snapshot ? '/dev/fd/3' : allowedSigners, '-I', principal, '-n', namespace, '-s', sigFile], message, {
      env: withoutAgent(),
      timeoutMs: 10000,
      fd3: snapshot ? allowedSignersText : undefined,
    });
    const m = r.code === 0 && / key (SHA256:[A-Za-z0-9+/]+)/.exec(r.stdout);
    return { ok: r.code === 0, key: m ? m[1] : null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const createVerifier = ({ allowedSigners, allowedSignersText, bin }) => ({
  verify: (message, signature, principal) => verifySignature({ allowedSigners, allowedSignersText, principal, message, signature, bin }),
});

// OP_AGENT_SOCK is the 1Password SSH agent; only the op-agent signer and the cert mint use it.
const OP_AGENT_SOCK = path.join(os.homedir(), 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock');
const failure = (code, message) => Object.assign(new Error(message), { code });

// The identity-binding swap point (DECK-109): how a click becomes a signature. Nothing outside this
// function knows which key or agent is in use; a hardware key or another agent is one more `spec`.
//   'op-agent'           — the operator's key (`operatorKey`, from allowed_signers) through the
//                          1Password agent: a Touch ID prompt on this Mac.
//   'file:<private key>' — a key file, agent-free (dev and tests).
// sign(message) resolves { sig, signerId } or rejects with `code` dismissed | timeout | error | agent-shell.
function createSigner(spec, { operatorKey, bin = 'ssh-keygen', timeoutMs = 120000 } = {}) {
  let kind;
  let keyPath;
  if (spec === 'op-agent') {
    if (typeof operatorKey !== 'string' || !/^(ssh-|ecdsa-|sk-)\S+ [A-Za-z0-9+/]+={0,2}$/.test(operatorKey))
      throw new Error('op-agent signer needs the operator public key');
    kind = 'op-agent';
  } else if (typeof spec === 'string' && spec.startsWith('file:') && spec.length > 5) {
    kind = 'file';
    keyPath = spec.slice(5);
  } else {
    throw new Error('signer must be op-agent or file:<private key path>');
  }

  async function sign(message) {
    let dir = null;
    let keyFile = keyPath;
    const env = withoutAgent();
    if (kind === 'op-agent') {
      // Same rule as up.sh: 1Password prompts follow the process that started the deck, so a deck
      // started from an agent shell must never ask — refused before anything is spawned.
      if (Object.keys(process.env).some((k) => k.startsWith('CLAUDE')))
        throw failure('agent-shell', 'deck started from an agent shell (CLAUDE* in env) — no 1Password prompt from here');
      // ssh-keygen -Y sign -f <public key> asks the agent for that key's signature.
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-sign-'));
      keyFile = path.join(dir, 'operator.pub');
      fs.writeFileSync(keyFile, operatorKey + '\n', { mode: 0o600 });
      env.SSH_AUTH_SOCK = OP_AGENT_SOCK;
    }
    try {
      const r = await run(bin, ['-Y', 'sign', '-f', keyFile, '-n', NAMESPACE], message, { env, timeoutMs });
      if (r.timedOut) throw failure('timeout', 'no signature within ' + timeoutMs / 1000 + ' s');
      const signerId = r.code === 0 && signatureKey(r.stdout);
      if (signerId) return { sig: r.stdout, signerId };
      const first = r.stderr.split('\n').map((l) => l.trim()).find((l) => l && l !== 'Signing data on standard input');
      if (r.code !== 0 && /refused/i.test(r.stderr)) throw failure('dismissed', first || 'agent refused operation');
      throw failure('error', first || 'ssh-keygen exit ' + r.code);
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return { kind, sign };
}

module.exports = {
  NAMESPACE, OP_AGENT_SOCK, canonical, questionSha256, sheetSha256, pin, parseAllowedSigners, fingerprint,
  verifySignature, createVerifier, createSigner,
};
