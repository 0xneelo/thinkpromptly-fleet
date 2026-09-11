#!/usr/bin/env node
// A fake ssh-keygen for the signer's failure paths, used as createSigner's `bin`. Every call is
// appended to FAKE_SSH_KEYGEN_LOG (one JSON argv per line), then per FAKE_SSH_KEYGEN_MODE:
//
//   refuse — what a dismissed 1Password prompt looks like: "agent refused operation", exit 1
//   sleep  — start a grandchild in the same process group, write both pids to
//            FAKE_SSH_KEYGEN_PIDS, and never answer (the signer's timeout must kill the group)
const fs = require('fs');
const { spawn } = require('child_process');

if (process.env.FAKE_SSH_KEYGEN_LOG)
  fs.appendFileSync(process.env.FAKE_SSH_KEYGEN_LOG, JSON.stringify(process.argv.slice(2)) + '\n');

const mode = process.env.FAKE_SSH_KEYGEN_MODE;
if (mode === 'refuse') {
  process.stderr.write('Signing data on standard input\nsign_and_send_pubkey: signing failed for ED25519 "test": agent refused operation\n');
  process.exit(1);
} else if (mode === 'sleep') {
  const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(process.env.FAKE_SSH_KEYGEN_PIDS, JSON.stringify([process.pid, grandchild.pid]));
  setTimeout(() => {}, 60000);
} else {
  process.stderr.write('fake-ssh-keygen: unknown FAKE_SSH_KEYGEN_MODE\n');
  process.exit(2);
}
