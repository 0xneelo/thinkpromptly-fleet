#!/usr/bin/env node
// `npm test` on a fresh clone or a fresh worktree used to die inside the first test file with
// `Cannot find module 'ws'` — a stack trace that reads like a broken branch rather than a
// missing `npm install` (node_modules is gitignored and is per-worktree). This runs as
// `pretest`, so the suite says what to do instead of how it crashed.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'package.json');

// This check exists to replace a stack trace with a sentence, so it must not produce one of
// its own — not even for the one file it cannot do its job without.
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  console.error('fleetdeck: cannot read ' + MANIFEST + ' (' + e.message + ') — fix it, then `npm test` again.');
  process.exit(1);
}
const deps = Object.keys(pkg.dependencies || {});

const missing = deps.filter((name) => {
  try {
    require.resolve(name, { paths: [ROOT] });
    return false;
  } catch {
    return true;
  }
});

if (missing.length) {
  console.error(
    'fleetdeck: dependencies are not installed in this worktree (missing ' +
      missing.join(', ') +
      ') — run `npm install` here first, then `npm test` again.'
  );
  process.exit(1);
}

// test/http.js gives the tailnet listener its own loopback address so the suite can tell a
// tailnet-source request from a loopback-source one — the composed-gate coverage whose absence
// produced XYZ-1888. macOS does not provide 127.0.0.2 until someone adds the alias. Without it
// every test that boots a deck child sits out test/http.js's 15s start timeout instead of
// failing, so the suite takes minutes to say what this says once, here, in a sentence.
const net = require('net');
const TAILNET_BIND = '127.0.0.2';

const probe = net.createServer();
probe.once('error', (e) => {
  const fix =
    process.platform === 'darwin'
      ? 'sudo ifconfig lo0 alias ' + TAILNET_BIND + ' up    # not persistent — re-run after a reboot'
      : 'sudo ip addr add ' + TAILNET_BIND + '/8 dev lo';
  console.error(
    'fleetdeck: the suite needs ' +
      TAILNET_BIND +
      ' and this machine cannot bind it (' +
      e.code +
      ') — run:\n  ' +
      fix +
      '\nthen `npm test` again.'
  );
  // exitCode rather than exit(): a bare process.exit() can truncate this message on the way out
  // when stderr is a pipe, and the message is the only reason this check exists.
  process.exitCode = 1;
});
probe.listen(0, TAILNET_BIND, () => probe.close());
