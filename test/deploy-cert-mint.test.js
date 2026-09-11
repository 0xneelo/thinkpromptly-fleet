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
test('each profile previews its own current link; Legacy includes every transition login', () => fixture(dir => {
  for(const profile of ['legacy','daily','admin']) {
    const r=run(dir,['--'+profile,'--dry-run']);assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,new RegExp('current_link=current'+(profile==='legacy'?'':'-'+profile)+'\\n'));
    if(profile==='legacy') assert.match(r.stdout,/principals=root,vibe,misterisley,tabor/);
  }
  const aliases=fs.readFileSync('deploy-keys/ssh-config.roles.example','utf8');
  assert.match(aliases,/Host vps-deploy ob-deploy ivybox-deploy gb-deploy rs-deploy\n    IdentityFile .*current-daily/);
  assert.match(aliases,/Host vps-admin ob-admin ivybox-admin gb-admin rs-admin\n    IdentityFile .*current-admin/);
  assert.doesNotMatch(aliases,/deploy-certs\/current\//);
}));
test('public CA snapshot is unchanged if the source changes after classification; all keygen/signing calls mocked', () => fixture(dir => {
  const bin=path.join(dir,'bin');fs.mkdirSync(bin);
  // The mock must also work on the operator's Mac: no GNU stat dependency.
  fs.writeFileSync(path.join(bin,'stat'), '#!/bin/sh\necho "stat: GNU options unavailable" >&2\nexit 97\n', {mode:0o700});
  fs.writeFileSync(path.join(bin,'ssh-keygen'),`#!/bin/sh
case "$1" in
  -lf) cat > "$SNAPSHOT_READ"; printf '%s\\n' "$REPLACEMENT_PUB" > "$CA_PUB"; echo '256 SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0 fixture';;
  -t) : ;; # no credential generation or file output
  -Lf) echo 'Valid: mocked metadata only';;
  *) exit 99;;
esac
`,{mode:0o700});
  const signer=path.join(dir,'signer-mock.sh');
  fs.writeFileSync(signer,`#!/bin/sh
set -eu
cmp "$SSH_CA_PUBLIC_SNAPSHOT" "$SNAPSHOT_READ"
perl -e 'printf("%o\\n",(stat $ARGV[0])[2] & 07777)' "$SSH_CA_PUBLIC_SNAPSHOT" > "$SNAPSHOT_MODE"
printf '%s\\n' "$SSH_CA_PUBLIC_SNAPSHOT" > "$SNAPSHOT_PATH"
`,{mode:0o700});
  const env={PATH:bin+':'+process.env.PATH,SSH_CA_TEST_MODE:'1',SSH_CA_TEST_SIGNER:signer,
    REPLACEMENT_PUB:other,SNAPSHOT_READ:path.join(dir,'classified.pub'),SNAPSHOT_MODE:path.join(dir,'mode.txt'),SNAPSHOT_PATH:path.join(dir,'path.txt')};
  const r=run(dir,['--daily','-o',path.join(dir,'mock-output')],env);assert.equal(r.status,0,r.stderr);
  assert.equal(fs.readFileSync(path.join(dir,'ca.pub'),'utf8'),other+'\n');
  assert.equal(fs.readFileSync(env.SNAPSHOT_MODE,'utf8').trim(),'600');
  assert.equal(fs.existsSync(fs.readFileSync(env.SNAPSHOT_PATH,'utf8').trim()),false,'public snapshot cleaned');
  assert.deepEqual(fs.readdirSync(path.join(dir,'mock-output')),[],'no key or certificate was generated');
}));
// Spawned through the shebang like server.js does: macOS /bin/bash 3.2 calls an empty
// array unbound under set -u, which broke every Legacy and Admin mint on the Mac.
test('legacy and admin reach the signer through the shebang interpreter; all keygen/signing calls mocked', () => fixture(dir => {
  const bin=path.join(dir,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'ssh-keygen'),`#!/bin/sh
case "$1" in
  -lf) cat >/dev/null; echo '256 SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0 fixture';;
  -t) : ;; # no credential generation or file output
  -Lf) echo 'Valid: mocked metadata only';;
  *) exit 99;;
esac
`,{mode:0o700});
  const signer=path.join(dir,'signer-mock.sh'), argv=path.join(dir,'argv.txt');
  fs.writeFileSync(signer,'#!/bin/sh\nprintf "%s\\n" "$@" > "$SIGN_ARGS"\n',{mode:0o700});
  for (const [args,principals,ttl] of [[['--legacy','-t','8h'],'root,vibe,misterisley,tabor','8h'],[['--admin'],'admin','1h']]) {
    fs.rmSync(argv,{force:true});
    const out=path.join(dir,args[0].slice(2));
    const r=spawnSync(script,[...args,'-o',out],{encoding:'utf8',env:{PATH:bin+':'+process.env.PATH,HOME:dir,CA_PUB:path.join(dir,'ca.pub'),
      SSH_CA_TEST_MODE:'1',SSH_CA_TEST_SIGNER:signer,SIGN_ARGS:argv}});
    assert.equal(r.status,0,r.stderr);
    assert.ok(fs.existsSync(argv),args[0]+' never reached the signer: '+r.stderr);
    assert.equal(fs.realpathSync(r.stdout.trim().split('\n').pop()),fs.realpathSync(out),'server.js reads the outdir from the last stdout line');
    const a=fs.readFileSync(argv,'utf8').trimEnd().split('\n');
    assert.equal(a.length,9,a.join(' '));
    assert.deepEqual([a[0],a[2],a[3],a[4],a[5],a[6],path.basename(a[8])],['-I','-n',principals,'-V','+'+ttl,'-z','deployer.pub']);
  }
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
    const fp = spawnSync('ssh-keygen', ['-lf', key + '.pub', '-E', 'sha256'], { encoding: 'utf8' }).stdout.split(/\s+/)[1];
    assert.ok(info.includes('Signing CA: ED25519 ' + fp), 'throwaway CA fingerprint matches');
    assert.match(info, /Key ID: "deployer-.*-ca2"/);
    assert.match(info, new RegExp('Principals:\\s+' + (profile === 'daily' ? 'deploy' : 'admin') + '\\s+Critical Options:'));
    const times = info.match(/Valid: from (\S+) to (\S+)/);
    assert.ok(times); const ttlMs = (profile === 'daily' ? 8 : 1) * 3600000;
    const span = Date.parse(times[2]) - Date.parse(times[1]);
    // OpenSSH backdates the implicit start to allow clock skew and rounds to a minute.
    assert.ok(span >= ttlMs && span <= ttlMs + 120000, 'profile validity cap plus OpenSSH start skew');
    assert.ok(Math.abs(Date.parse(times[2]) - Date.now() - ttlMs) < 10000, 'expiration is profile TTL from signing time');
    assert.match(info, /permit-pty/);
    if (profile === 'daily') assert.doesNotMatch(info, /permit-(agent-forwarding|port-forwarding|X11-forwarding|user-rc)/);
    else assert.match(info, /permit-agent-forwarding/);
  }
}));
