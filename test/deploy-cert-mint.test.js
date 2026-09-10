'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve('deploy-keys/mint-deploy-cert.sh');
const v1 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO4jL5PZycHkKIWlwaenerKq6VcuVk1PiqlyrrU18E4G';
const other = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPer5OIi3/djg1FyVavjGUdXfbU6NNAjEa/iO356iBtC';
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivo-mint-'));
  try { fs.writeFileSync(path.join(dir, 'ca.pub'), v1 + '\n'); return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function run(dir, args, env = {}) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, CA_PUB: path.join(dir, 'ca.pub'), ...env } });
}
test('daily dry-run: deploy, 8h, PTY only; no credential or current directory created', () => fixture(dir => {
  const r = run(dir, ['--daily', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /principals=deploy\nttl=8h/);
  assert.match(r.stdout, /extensions=permit-pty/);
  assert.doesNotMatch(r.stdout, /key_id=.*-ca2/);
  assert.deepEqual(fs.readdirSync(dir), ['ca.pub']);
}));
test('admin dry-run, override precedence and v2 tag', () => fixture(dir => {
  const pub = path.join(dir, 'v2.pub'); fs.writeFileSync(pub, other + '\n');
  const r = run(dir, ['--admin', '-n', 'admin,rog-only', '--ca-pub', pub, '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /principals=admin,rog-only\nttl=1h/);
  assert.match(r.stdout, /key_id=deployer-.*-ca2/);
  assert.match(r.stdout, /extensions=default/);
}));
test('admin supports a tag-only certificate for actual box restriction', () => fixture(dir => {
  const r = run(dir, ['--admin', '-n', 'promptly-only', '--dry-run']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /principals=promptly-only\n/);
}));
test('reject invalid profiles, principals, TTLs and conflicting options before writes', () => fixture(dir => {
  for (const args of [['--daily', '--admin'], ['--daily', '-n', 'root'], ['--admin', '-n', 'root'], ['--admin', '-t', '8h'], ['--daily', '-t', '1h'], ['-n', 'root', '-t', '24h'], ['--ca-pub'], ['--admin', '-n', 'admin,$(bad)']]) {
    assert.notEqual(run(dir, [...args, '--dry-run']).status, 0, args.join(' '));
  }
  assert.deepEqual(fs.readdirSync(dir), ['ca.pub']);
}));
test('legacy explicit principals retain 1h/4h/8h cap', () => fixture(dir => {
  for (const ttl of ['1h', '4h', '8h']) assert.equal(run(dir, ['-n', 'root,vibe', '-t', ttl, '--dry-run']).status, 0);
}));
// Explicit operator opt-in only: this test generates and signs disposable credentials.
// Never enabled by npm test or by a goal that prohibits minting.
test('isolated file signer: ssh-keygen -L proves real principals, validity, Key ID and extensions', { skip: process.env.SSH_CA_ALLOW_TEST_MINT !== '1' }, () => fixture(dir => {
  const key = path.join(dir, 'test-ca');
  const gen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { encoding: 'utf8' });
  assert.equal(gen.status, 0, 'throwaway CA generation failed');
  const hook = path.join(dir, 'sign-test.sh');
  fs.writeFileSync(hook, '#!/bin/bash\nset -eu\nexec ssh-keygen -s "$SSH_CA_TEST_KEY" "$@"\n', { mode: 0o700 });
  for (const profile of ['daily', 'admin']) {
    const out = path.join(dir, profile);
    const r = run(dir, ['--' + profile, '--ca-pub', key + '.pub', '-o', out], { SSH_CA_TEST_MODE: '1', SSH_CA_TEST_SIGNER: hook, SSH_CA_TEST_KEY: key });
    assert.equal(r.status, 0, 'test signing failed (credential output suppressed)');
    const info = spawnSync('ssh-keygen', ['-L', '-f', path.join(out, 'deployer-cert.pub')], { encoding: 'utf8' }).stdout;
    assert.match(info, /Key ID: "deployer-.*-ca2"/);
    assert.match(info, new RegExp('Principals:\\s+' + (profile === 'daily' ? 'deploy' : 'admin') + '\\s+Critical Options:'));
    const times = info.match(/Valid: from (\S+) to (\S+)/);
    assert.ok(times); assert.equal(Date.parse(times[2]) - Date.parse(times[1]), (profile === 'daily' ? 8 : 1) * 3600000);
    assert.match(info, /permit-pty/);
    if (profile === 'daily') assert.doesNotMatch(info, /permit-(agent-forwarding|port-forwarding|X11-forwarding|user-rc)/);
    else assert.match(info, /permit-agent-forwarding/);
  }
}));
