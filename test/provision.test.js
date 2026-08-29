// The provisioning scripts move two bearer secrets between the Mac and the box. Two rules
// govern them and neither is visible at a glance, so they are asserted here rather than
// trusted to review:
//
//   1. The quote-free rule (README.md): `ssh german-box <cmd>` traverses zsh -> Windows CMD
//      -> wsl -> bash. Nested quotes are mangled at some layer, so every remote command
//      string must hold ZERO quote characters.
//   2. No secret is ever an argv word, on either machine — `ps` is world-readable.
//
// Both are checked by running mac/provision-fleet-secrets.sh with a FAKE ssh on PATH that
// records exactly what it was asked to run and what arrived on its stdin. Nothing leaves
// this machine and no real secret exists here.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SECRET = 'deadbeefcafe0123456789abcdef0123456789abcdef0123456789abcdefdead';

// The fake ssh is a real file (test/fake-ssh-recorder.js) rather than an inline heredoc:
// quoting a JSON writer inside a shell script inside a JS template literal is exactly the
// kind of nested-quote mangling this suite exists to catch.
const RECORDER = path.join(__dirname, 'fake-ssh-recorder.js');

// A PATH directory whose `ssh` is the recorder. Nothing in this suite can reach a network.
function fakeBin(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'ssh'),
    '#!/bin/sh\nexec ' + process.execPath + ' ' + RECORDER + ' "$@"\n',
    { mode: 0o755 }
  );
  return bin;
}

function harness(t, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-prov-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = fakeBin(dir);
  const log = path.join(dir, 'ssh.log');
  fs.writeFileSync(log, '');

  // A fake HOME, so the script's key file and bus token are fixtures and the real ones on
  // this machine are never read, written or copied.
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, '.fleetdeck-bus-token'), SECRET + '\n', { mode: 0o600 });

  const out = execFileSync('sh', [path.join(ROOT, 'mac', 'provision-fleet-secrets.sh'), ...args], {
    env: {
      ...process.env,
      PATH: bin + ':' + process.env.PATH,
      HOME: home,
      FAKE_SSH_LOG: log,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const calls = fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { out, calls, home, dir };
}

test('every remote command string is quote-free', (t) => {
  const { calls } = harness(t);
  assert.ok(calls.length > 0, 'the script issued no ssh calls at all');
  for (const c of calls)
    assert.ok(
      !/['"`]/.test(c.cmd),
      'remote command holds a quote character, which zsh -> CMD -> wsl mangles: ' + c.cmd
    );
});

test('no secret value ever appears in a remote command string', (t) => {
  const { calls, out } = harness(t);
  for (const c of calls)
    assert.ok(!c.cmd.includes(SECRET), 'a secret became an argv word: ' + c.cmd);
  // Nor on the script's own stdout — an operator pastes that into a chat without thinking.
  assert.ok(!out.includes(SECRET), 'a secret was printed to stdout');
});

test('secrets travel on stdin, and arrive whole', (t) => {
  const { calls } = harness(t);
  const withSecret = calls.filter((c) => c.stdin && c.stdin.includes(SECRET));
  assert.ok(withSecret.length >= 1, 'the bus token never reached the box on stdin');
  for (const c of withSecret)
    assert.match(c.cmd, /fleet-env-set\.sh (FD_TAILNET_KEY|FLEETDECK_BUS_TOKEN)$/,
      'a secret went to something other than the env setter: ' + c.cmd);
});

test('the generated tailnet key is 0600, hex, and reused on a second run', (t) => {
  const h = harness(t, ['--tailnet']);
  const keyfile = path.join(h.home, '.fleetdeck', 'tailnet-key');
  const key = fs.readFileSync(keyfile, 'utf8').trim();
  assert.match(key, /^[0-9a-f]{64}$/, 'the key must be hex with no space, quote or backslash');
  assert.equal(fs.statSync(keyfile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(h.home, '.fleetdeck')).mode & 0o777, 0o700);

  // A second run must not rotate the key: rotating it silently would leave the box holding
  // the old value and every box POST would start 401-ing.
  const again = execFileSync('sh', [path.join(ROOT, 'mac', 'provision-fleet-secrets.sh'), '--tailnet'], {
    env: { ...process.env, PATH: path.join(h.dir, 'bin') + ':' + process.env.PATH, HOME: h.home, FAKE_SSH_LOG: path.join(h.dir, 'ssh.log') },
    encoding: 'utf8',
  });
  assert.match(again, /reusing the FLEET_TAILNET_KEY/);
  assert.equal(fs.readFileSync(keyfile, 'utf8').trim(), key, 'the key rotated on a re-run');
});

test('the key the box is sent is byte-identical to the one the Mac keeps', (t) => {
  const h = harness(t, ['--tailnet']);
  const key = fs.readFileSync(path.join(h.home, '.fleetdeck', 'tailnet-key'), 'utf8').trim();
  const sent = h.calls.find((c) => /FD_TAILNET_KEY$/.test(c.cmd));
  assert.ok(sent, 'FD_TAILNET_KEY was never pushed to the box');
  // A trailing newline here would end up inside the bearer key and every POST would 401.
  assert.equal(sent.stdin, key);
});

test('--bus refuses to run when the deck has never minted a token', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-prov-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = fakeBin(dir);
  const home = path.join(dir, 'home');
  fs.mkdirSync(home); // no .fleetdeck-bus-token in it
  assert.throws(
    () =>
      execFileSync('sh', [path.join(ROOT, 'mac', 'provision-fleet-secrets.sh'), '--bus'], {
        env: { ...process.env, PATH: bin + ':' + process.env.PATH, HOME: home, FAKE_SSH_LOG: path.join(dir, 'ssh.log') },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    /start the deck once/
  );
});

test('box/fleet-env-set.sh never echoes a value it was given', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-fes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = execFileSync('sh', [path.join(ROOT, 'box', 'fleet-env-set.sh'), 'FD_TAILNET_KEY'], {
    env: { ...process.env, FD_DIR: path.join(dir, 'fleet') },
    input: SECRET,
    encoding: 'utf8',
  });
  assert.ok(!out.includes(SECRET), 'the setter printed the secret: ' + out);
  assert.match(out, /64 chars, mode 0600/, 'it should report a length, never a value');
  const envfile = path.join(dir, 'fleet', 'fleet.env');
  assert.equal(fs.statSync(envfile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(envfile, 'utf8').trim(), 'FD_TAILNET_KEY=' + SECRET);
});

test('fleet-env-set.sh replaces its own key without touching a key it prefixes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-fes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fleet = path.join(dir, 'fleet');
  fs.mkdirSync(fleet);
  const envfile = path.join(fleet, 'fleet.env');
  fs.writeFileSync(envfile, '# comment\nFD_TAILNET_KEY_OLD=keepme\nFD_HOST=german-box\n', { mode: 0o600 });
  execFileSync('sh', [path.join(ROOT, 'box', 'fleet-env-set.sh'), 'FD_TAILNET_KEY'], {
    env: { ...process.env, FD_DIR: fleet },
    input: 'newvalue',
    encoding: 'utf8',
  });
  const after = fs.readFileSync(envfile, 'utf8');
  assert.match(after, /^FD_TAILNET_KEY_OLD=keepme$/m, 'a key this one is a prefix of was eaten');
  assert.match(after, /^FD_HOST=german-box$/m, 'an unrelated line was lost');
  assert.match(after, /^# comment$/m, "the operator's comment was lost");
  assert.match(after, /^FD_TAILNET_KEY=newvalue$/m);
});

test('an unreadable fleet.env is refused, never silently truncated', (t) => {
  // The bug this guards: `grep -v ... > tmp || :` masks grep's exit 2 (cannot read) the same
  // way it masks exit 1 (nothing matched). The script would then write a fleet.env holding
  // only the key it was given, destroying FLEETDECK_BUS_TOKEN, FD_HOST and every operator
  // edit — and provision-fleet-secrets.sh calls this three times in a row on the same file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-fes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fleet = path.join(dir, 'fleet');
  fs.mkdirSync(fleet);
  const envfile = path.join(fleet, 'fleet.env');
  const before = 'FD_HOST=german-box\nFLEETDECK_BUS_TOKEN=keepme\n';
  fs.writeFileSync(envfile, before, { mode: 0o600 });
  fs.chmodSync(envfile, 0o000);

  assert.throws(
    () =>
      execFileSync('sh', [path.join(ROOT, 'box', 'fleet-env-set.sh'), 'FD_TAILNET_KEY'], {
        env: { ...process.env, FD_DIR: fleet },
        input: SECRET,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    /refusing to rewrite it/
  );
  fs.chmodSync(envfile, 0o600);
  assert.equal(fs.readFileSync(envfile, 'utf8'), before, 'the file was rewritten anyway');
  assert.deepEqual(fs.readdirSync(fleet), ['fleet.env'], 'a temp file holding a key was left behind');
});

test('a failed run leaves no temp file holding the secret', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetdeck-fes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fleet = path.join(dir, 'fleet');
  fs.mkdirSync(fleet);
  fs.writeFileSync(path.join(fleet, 'fleet.env'), 'FD_HOST=german-box\n', { mode: 0o600 });
  fs.chmodSync(path.join(fleet, 'fleet.env'), 0o000);
  try {
    execFileSync('sh', [path.join(ROOT, 'box', 'fleet-env-set.sh'), 'FD_TAILNET_KEY'], {
      env: { ...process.env, FD_DIR: fleet },
      input: SECRET,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { /* expected */ }
  fs.chmodSync(path.join(fleet, 'fleet.env'), 0o600);
  for (const f of fs.readdirSync(fleet))
    assert.ok(!fs.readFileSync(path.join(fleet, f), 'utf8').includes(SECRET) || f === 'fleet.env',
      'the secret survived in ' + f);
  assert.deepEqual(fs.readdirSync(fleet), ['fleet.env']);
});
