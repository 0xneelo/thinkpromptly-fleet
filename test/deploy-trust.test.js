'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const v1 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO4jL5PZycHkKIWlwaenerKq6VcuVk1PiqlyrrU18E4G v1';
const v2 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPer5OIi3/djg1FyVavjGUdXfbU6NNAjEa/iO356iBtC public-fixture';
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivo-trust-'));
  try {
    fs.mkdirSync(path.join(root, 'etc/ssh'), {recursive:true});
    fs.writeFileSync(path.join(root, 'etc/ssh/sshd_config'), 'Port 22\nMatch Group admins\n  X11Forwarding no\n');
    fs.writeFileSync(path.join(root, 'etc/ssh/deploy_ca.pub'), v1 + '\n');
    fs.writeFileSync(path.join(root, 'v2.pub'), v2 + '\n');
    return fn(root);
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
}
function run(root, args=[]) { return spawnSync('sh', ['deploy-keys/apply-trust-linux.sh', path.join(root, 'v2.pub'), '--root', root, ...args], {encoding:'utf8'}); }
test('trust dry-run appends without removing v1, global directive before Match, zero fixture mutation', () => fixture(root => {
  const before = fs.readFileSync(path.join(root, 'etc/ssh/deploy_ca.pub'), 'utf8');
  const r = run(root, ['--dry-run']); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+ssh-ed25519 .*public-fixture/);
  assert.doesNotMatch(r.stdout, /-ssh-ed25519/);
  assert.match(r.stdout, /\+TrustedUserCAKeys \/etc\/ssh\/deploy_ca.pub/);
  assert.equal(fs.readFileSync(path.join(root, 'etc/ssh/deploy_ca.pub'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(root, 'etc/ssh')).sort(), ['deploy_ca.pub', 'sshd_config']);
}));
test('append is idempotent by key identity, independent of comment', () => fixture(root => {
  fs.appendFileSync(path.join(root, 'etc/ssh/deploy_ca.pub'), v2.replace('public-fixture','other-comment') + '\n');
  const r = run(root, ['--dry-run']); assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stdout, /\+ssh-ed25519/);
}));
test('reject malformed public input, fixture applies, and symlink targets', () => fixture(root => {
  assert.notEqual(run(root).status, 0);
  fs.writeFileSync(path.join(root, 'v2.pub'), 'not-a-key\n'); assert.notEqual(run(root, ['--dry-run']).status, 0);
  fs.writeFileSync(path.join(root, 'v2.pub'), v2+'\n');
  fs.unlinkSync(path.join(root, 'etc/ssh/deploy_ca.pub')); fs.symlinkSync(path.join(root, 'v2.pub'),path.join(root, 'etc/ssh/deploy_ca.pub'));
  assert.notEqual(run(root, ['--dry-run']).status, 0);
}));
const pwsh = process.env.PWSH_BIN;
for (const box of ['german-box', 'rog-strix']) {
  test('Windows ' + box + ': DryRun/WhatIf show exact changes without mutation', {skip: !pwsh}, () => fixture(root => {
    const ssh = path.join(root, 'etc/ssh');
    const before = fs.readdirSync(ssh).map(n => [n, fs.readFileSync(path.join(ssh,n),'utf8')]);
    for (const flag of ['-DryRun', '-WhatIf']) {
      const r = spawnSync(pwsh, ['-NoProfile', '-File', 'deploy-keys/setup-' + box + '-ca.ps1', '-CaPub', path.join(root,'v2.pub'), '-Root', ssh, flag], {encoding:'utf8'});
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /\+ssh-ed25519 .*public-fixture/);
      assert.match(r.stdout, /\+TrustedUserCAKeys __PROGRAMDATA__\/ssh\/deploy_ca.pub/);
      assert.match(r.stdout, /DRY-RUN/);
      assert.deepEqual(fs.readdirSync(ssh).map(n => [n, fs.readFileSync(path.join(ssh,n),'utf8')]), before);
    }
  }));
}
test('Linux validation/reload failures restore prior public configuration with retained rollback', () => {
  const r = spawnSync('python3', ['test/deploy-apply-transaction.py'], {encoding:'utf8'});
  assert.equal(r.status, 0, r.stderr);
});

test('Windows audit regressions: precedence, mutex, atomic writes and malformed-config rollback', {skip:!process.env.PWSH_BIN}, () => {
  const r = spawnSync(process.env.PWSH_BIN, ['-NoProfile','-File','test/deploy-windows-transaction.ps1'], {encoding:'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const finding of ['A1','A2','A5','A7']) assert.match(r.stdout, new RegExp('PASS ' + finding));
});
