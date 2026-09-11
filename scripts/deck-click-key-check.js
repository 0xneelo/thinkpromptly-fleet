#!/usr/bin/env node
// Operator gate step (DECK-108): the first Touch ID signing. Signs a throwaway check string the way
// the deck signs a click — through the 1Password agent with the operator's key from
// allowed_signers — and verifies it the way a seat does. Besides the deck, this is the only
// command that raises a 1Password prompt, and only in the operator's own Terminal.
//
//   node scripts/deck-click-key-check.js [--signer file:<private key>]
//
// Reads $FLEET_OPERATOR_FILE (~/.fleetdeck/operator.json) and $FLEET_ALLOWED_SIGNERS
// (~/.claude/fleet/allowed_signers), the same as the deck. Exit 0 OK, 1 failed, 2 usage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadOperator } = require('../operator-auth');
const { createSigner, createVerifier, parseAllowedSigners } = require('../signer');

function fail(message, code = 1) {
  console.error('error: ' + message);
  process.exit(code);
}

// Same rule as up.sh: a prompt raised from an agent shell never reaches the operator.
if (Object.keys(process.env).some((k) => k.startsWith('CLAUDE')))
  fail('agent shell detected (CLAUDE* in env) — run it in your own Terminal');
const args = process.argv.slice(2);
let spec = 'op-agent';
if (args.length === 2 && args[0] === '--signer' && args[1].startsWith('file:')) spec = args[1];
else if (args.length) fail('usage: deck-click-key-check.js [--signer file:<private key>]', 2);

const operatorFile = process.env.FLEET_OPERATOR_FILE || path.join(os.homedir(), '.fleetdeck', 'operator.json');
const signersFile = process.env.FLEET_ALLOWED_SIGNERS || path.join(os.homedir(), '.claude', 'fleet', 'allowed_signers');

async function main() {
  let operator;
  let lines;
  try {
    operator = loadOperator(fs.readFileSync(operatorFile, 'utf8'));
  } catch (e) {
    fail('operator file ' + operatorFile + ' unusable (' + (e.code || e.message) + ') — run scripts/deck-operator-init.js first');
  }
  try {
    lines = parseAllowedSigners(fs.readFileSync(signersFile, 'utf8'));
  } catch (e) {
    fail('allowed_signers ' + signersFile + ' unreadable (' + (e.code || e.message) + ')');
  }
  const line = lines.find((l) => l.principals.includes(operator.operatorId));
  if (!line) fail('no line for ' + operator.operatorId + ' in ' + signersFile + ' — add "<operator_id> namespaces="fleetdeck-unblock" <public key>"');

  const signer = createSigner(spec, { operatorKey: line.key });
  const message = 'v2|deck-click-key-check|' + new Date().toISOString();
  let signed;
  try {
    signed = await signer.sign(message);
  } catch (e) {
    fail('signing through ' + signer.kind + ' failed: ' + e.code + ' (' + e.message + ')');
  }
  const r = await createVerifier({ allowedSigners: signersFile }).verify(message, signed.sig, operator.operatorId);
  if (!r.ok) fail('signed by ' + signed.signerId + ' but not verified against ' + signersFile + ' as ' + operator.operatorId);
  console.log('OK — signed through ' + signer.kind + ' and verified: ' + operator.operatorId + ' ' + r.key);
}

main().catch((e) => fail(e.message));
