#!/usr/bin/env node
// A stand-in for `ssh`, used by test/provision.test.js. It records what it was asked to run
// and what arrived on stdin, and reaches no network. ssh joins every argument word after the
// host into ONE remote command string, so that is what gets recorded — which is exactly the
// string the quote-free rule governs.
const fs = require('fs');

const args = process.argv.slice(2);
let i = 0;
// Skip ssh's own options. -o takes a separate value word; the rest here are flags.
while (i < args.length && args[i].startsWith('-')) i += args[i] === '-o' ? 2 : 1;
const host = args[i];
const cmd = args.slice(i + 1).join(' ');

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  fs.appendFileSync(
    process.env.FAKE_SSH_LOG,
    JSON.stringify({ host, cmd, stdin: Buffer.concat(chunks).toString('utf8') }) + '\n'
  );
  process.exit(0);
});
