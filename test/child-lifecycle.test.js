// The leak this guards: ~46 fleetdeck servers once survived their test runs as ppid-1 orphans,
// each holding a port, a db handle and its share of the node-pty ptmx fds. A stop() that never
// runs is not a bug to be found again — the child must die with its parent by construction.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnChild, liveChildren } = require('./helpers');
const { startServer } = require('./http');

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
};

test('a SIGKILLed test process cannot leave a server behind', async () => {
  const parent = spawnChild(path.join(__dirname, 'orphan-parent.js'));
  let out = '';
  const pid = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture never reported a pid:\n' + out)), 20000);
    parent.stderr.on('data', (c) => (out += c));
    parent.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/PID (\d+)/);
      if (!m) return;
      clearTimeout(timer);
      resolve(Number(m[1]));
    });
  });
  assert.ok(alive(pid), 'the spawned server should be running: ' + out);

  // SIGKILL, not SIGTERM: nothing in the parent gets to run, so only the stdin deadman's
  // switch can save the child. That is the case the orphans came from.
  process.kill(parent.pid, 'SIGKILL');
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(!alive(pid), 'the spawned server outlived the process that spawned it');
});

// The path the orphans actually came from: on a host without the 127.0.0.2 alias every deck
// boot times out, and the reject used to skip the stop() the test would have run — one server
// left running per attempt, one every 15s for as long as the suite ran.
test('a server that never finishes booting is not left running', async () => {
  const before = liveChildren();
  await assert.rejects(
    // An address this host cannot bind, so the tailnet listener never comes up and the boot
    // hangs exactly the way the missing loopback alias makes it hang.
    startServer({ FLEET_TAILNET_BIND: '10.255.255.1' }, { timeoutMs: 2000 }),
    /server did not start/
  );
  for (let i = 0; i < 40 && liveChildren().length > before.length; i++)
    await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(liveChildren().filter((p) => !before.includes(p)), [], 'a failed boot leaked a server');
});
