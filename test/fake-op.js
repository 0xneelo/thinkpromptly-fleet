#!/usr/bin/env node
// A fake 1Password CLI, used as FLEET_OP_BIN. It is invoked exactly as the broker invokes the
// real one — `op document get <ref>` — and answers per FLEET_FAKE_OP_MODE:
//
//   ok (default) — print a real RSA private key PEM on stdout
//   locked       — exit 1 with 1Password's own "could not connect" stderr
//   notpem       — print something that is not a key and exit 0
//
// The key is a genuine 2048-bit RSA key because appJwt really signs with it: the broker test
// verifies the RS256 JWT the fake GitHub received against this key's public half, which is the
// proof the PEM never leaves the broker's memory yet still produces a valid signature.
//
// FLEET_FAKE_OP_KEY names a cache file, the same shape as fake-ssh's FLEET_FAKE_SSH_STATE, so
// every call inside one test yields the same key and the test can hold its public half. That
// file is the fake vault, not broker state: a test puts it outside every directory the broker
// itself is pointed at, so the "nothing is written to disk" assertion stays honest.
const fs = require('fs');
const crypto = require('crypto');

const MODE = process.env.FLEET_FAKE_OP_MODE || 'ok';
const CACHE = process.env.FLEET_FAKE_OP_KEY;
const args = process.argv.slice(2);

if (args[0] !== 'document' || args[1] !== 'get' || !args[2]) {
  process.stderr.write('fake-op: unhandled invocation: ' + args.join(' ') + '\n');
  process.exit(127);
}

if (MODE === 'locked') {
  process.stderr.write('[ERROR] 2026/01/01 00:00:00 could not connect to 1Password\n');
  process.exit(1);
}

if (MODE === 'notpem') {
  process.stdout.write('this is not a key\n');
  process.exit(0);
}

function pem() {
  if (CACHE) {
    try {
      return fs.readFileSync(CACHE, 'utf8');
    } catch (e) {
      // First call: fall through and mint it.
    }
  }
  // 2048 bits keeps a per-call generation around 50ms, fast enough that the cache is only
  // there to make the key stable, not to make the fixture quick.
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  if (CACHE) fs.writeFileSync(CACHE, privateKey, { mode: 0o600 });
  return privateKey;
}

process.stdout.write(pem());
