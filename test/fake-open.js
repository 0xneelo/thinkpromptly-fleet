#!/usr/bin/env node
// A fake macOS `open`, used as FLEET_OPEN_BIN. It records its argv as one JSON line in the
// file named by FLEET_FAKE_OPEN_LOG instead of launching a real application: no test may put
// a window on the operator's screen. A target containing `fail-me` is how a test asks for the
// failure path — the same shape a missing application has, a non-zero exit with stderr.
const fs = require('fs');

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FLEET_FAKE_OPEN_LOG, JSON.stringify(args) + '\n');

if (args.some((a) => a.includes('fail-me'))) {
  process.stderr.write('Unable to find application named ' + args[1] + '\n');
  process.exit(1);
}
