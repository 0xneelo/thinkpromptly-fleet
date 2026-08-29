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
