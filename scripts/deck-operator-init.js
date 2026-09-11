#!/usr/bin/env node
// Operator gate step (DECK-108): write the deck's operator file — the operator id and the scrypt
// hash of the sign-in password. Run it once, in your own Terminal; no sudo. To rotate, delete the
// file and run it again, then restart the deck.
//
//   node scripts/deck-operator-init.js <operator_id>
//
// Target: $FLEET_OPERATOR_FILE, default ~/.fleetdeck/operator.json. The password is read twice
// without echo (on a pipe: two lines). Prints only the path and the operator id.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { hashPassword, loadOperator, OPERATOR_ID } = require('../operator-auth');

class Refusal extends Error {}

async function main() {
  // Same rule as up.sh: the operator's secrets are set up by the operator, not by an agent shell.
  if (Object.keys(process.env).some((k) => k.startsWith('CLAUDE')))
    throw new Refusal('agent shell detected (CLAUDE* in env) — run it in your own Terminal');
  const operatorId = process.argv[2];
  if (process.argv.length !== 3 || !OPERATOR_ID.test(operatorId))
    throw new Refusal('usage: deck-operator-init.js <operator_id>  (operator_id matches [A-Za-z0-9._@-]{1,64})');
  const file = process.env.FLEET_OPERATOR_FILE || path.join(os.homedir(), '.fleetdeck', 'operator.json');
  if (fs.existsSync(file)) throw new Refusal(file + ' exists — delete it to rotate');

  const tty = process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt) => {
    process.stderr.write(prompt);
    const { value, done } = await lines.next();
    if (tty) process.stderr.write('\n');
    if (done) throw new Refusal('no password given');
    return value;
  };
  const echo = (on) => execFileSync('stty', [on ? 'echo' : '-echo'], { stdio: ['inherit', 'ignore', 'inherit'] });
  let password;
  let again;
  if (tty) {
    echo(false);
    process.once('SIGINT', () => {
      echo(true);
      process.exit(130);
    });
  }
  try {
    password = await ask('sign-in password (12+ characters): ');
    again = await ask('again: ');
  } finally {
    if (tty) echo(true);
    rl.close();
  }
  if (password.length < 12) throw new Refusal('the password must be at least 12 characters');
  if (password !== again) throw new Refusal('the two passwords do not match');

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
  console.log('wrote ' + file + ' for ' + operatorId);
}

main().catch((e) => {
  console.error('error: ' + (e instanceof Refusal ? e.message : 'failed (' + (e.code || e.message) + ')'));
  process.exitCode = 1;
});
