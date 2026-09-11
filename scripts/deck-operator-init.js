#!/usr/bin/env node
// Operator gate step (DECK-108): write the deck's operator file — the operator id and the scrypt
// hash of the sign-in password. Run it once, in a plain Terminal window of your own (not tmux or
// screen); no sudo. To rotate, delete the file and run it again, then restart the deck.
//
//   node scripts/deck-operator-init.js <operator_id>
//
// Target: $FLEET_OPERATOR_FILE, default ~/.fleetdeck/operator.json. The password is GENERATED, never
// chosen: the file is readable by every same-user agent, so its hash is open to offline guessing, and
// only a random password (144 bits) stands up to that. It is printed once, on stdout; the file holds
// only its hash.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashPassword, loadOperator, OPERATOR_ID } = require('../operator-auth');

class Refusal extends Error {}

async function main() {
  // Same rule as up.sh: the operator's secrets are set up by the operator, not by an agent shell.
  if (Object.keys(process.env).some((k) => k.startsWith('CLAUDE')))
    throw new Refusal('agent shell detected (CLAUDE* in env) — run it in your own Terminal');
  if ('TMUX' in process.env || 'STY' in process.env)
    throw new Refusal(
      'run it in a plain Terminal window, not tmux/screen — the password is printed once and a multiplexer keeps scrollback any same-user process can read'
    );
  const operatorId = process.argv[2];
  if (process.argv.length !== 3 || !OPERATOR_ID.test(operatorId))
    throw new Refusal('usage: deck-operator-init.js <operator_id>  (operator_id matches [A-Za-z0-9._@-]{1,64})');
  const file = process.env.FLEET_OPERATOR_FILE || path.join(os.homedir(), '.fleetdeck', 'operator.json');
  if (fs.existsSync(file)) throw new Refusal(file + ' exists — delete it to rotate');

  const password = crypto.randomBytes(18).toString('base64url'); // 24 characters, 144 bits
  const text =
    JSON.stringify({ version: 1, operatorId, identity: { kind: 'password', hash: await hashPassword(password) } }, null, 2) + '\n';
  loadOperator(text); // never write a file the deck would refuse to start on

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // O_EXCL temp file, then a no-clobber publish: link(2) fails if the target appeared meanwhile,
  // where rename(2) would silently replace it.
  const tmp = path.join(dir, '.operator-' + crypto.randomBytes(6).toString('hex') + '.tmp');
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(tmp, file);
  } catch (e) {
    throw new Refusal(e.code === 'EEXIST' ? file + ' exists — delete it to rotate' : 'cannot write ' + file + ' (' + e.code + ')');
  } finally {
    fs.unlinkSync(tmp);
  }
  // Only once the file is published: a refusal above never shows a password that is not stored.
  console.log('wrote ' + file + ' for ' + operatorId);
  console.log(password);
  console.log('save it in 1Password as "fleetdeck deck sign-in", then press Cmd-K to clear the scrollback — it is not shown again');
}

main().catch((e) => {
  console.error('error: ' + (e instanceof Refusal ? e.message : 'failed (' + (e.code || e.message) + ')'));
  process.exitCode = 1;
});
