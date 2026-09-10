'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixtures = require('./deploy-fixtures.cjs');
const boxes = { 'think-box':['root','promptly-only'], 'onboarding-app-box':['root','onboarding-only'], 'ivy-box':['root','ivy-only'], 'german-box':['vibe','german-only'], 'rog-strix':['misterisley','rog-only'] };
test('five transition templates: daily is separate; admin, tag, legacy are alternatives', () => {
  for (const [box, [user,tag]] of Object.entries(boxes)) {
    assert.equal(fs.readFileSync(`deploy-keys/principals/${box}/deploy`,'utf8'),'deploy\n');
    assert.equal(fs.readFileSync(`deploy-keys/principals/${box}/${user}`,'utf8'),`admin\n${tag}\n${user}\n`);
  }
});
for (const box of Object.keys(boxes).slice(0,3)) {
  test('Linux principals dry-run and legacy retirement: ' + box, () => fixtures(root => {
    const before = fixtures.snapshot(root);
    for (const retire of [false,true]) {
      const r = spawnSync('sh',['deploy-keys/apply-principals-linux.sh','--box',box,'--root',root,'--dry-run',...(retire?['--retire-legacy']:[])],{encoding:'utf8'});
      assert.equal(r.status,0,r.stderr);
      assert.match(r.stdout,/\+AuthorizedPrincipalsFile \/etc\/ssh\/principals\/%u/);
      assert.match(r.stdout,/\+deploy\n/); assert.match(r.stdout,/\+admin\n/);
      assert.equal(r.stdout.includes('+root\n'),!retire);
      assert.match(r.stdout,/\+ ACCOUNT deploy/);
      assert.deepEqual(fixtures.snapshot(root),before);
    }
  }));
}
for (const box of Object.keys(boxes).slice(3)) {
  test('Windows standard deploy and principal preview: ' + box, {skip:!process.env.PWSH_BIN}, () => fixtures(root => {
    const before = fixtures.snapshot(root);
    for (const flag of ['-DryRun','-WhatIf']) {
      const r = spawnSync(process.env.PWSH_BIN,['-NoProfile','-File','deploy-keys/apply-principals-windows.ps1','-Box',box,'-Root',path.join(root,'etc/ssh'),flag],{encoding:'utf8'});
      assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/\+ ACCOUNT deploy: standard Users/);
      assert.match(r.stdout,/PasswordNeverExpires; UserMayNotChangePassword/);
      assert.match(r.stdout,/AllowStartIfOnBatteries \+ DontStopIfGoingOnBatteries/);
      assert.match(r.stdout,/service PathName validator/);
      assert.match(r.stdout,/AuthorizedPrincipalsFile __PROGRAMDATA__\/ssh\/principals\/%u/);
      assert.deepEqual(fixtures.snapshot(root),before);
    }
  }));
}
test('v1 retirement leaves other CA and refuses removal of last CA', () => fixtures(root => {
  const pub = path.join(root,'etc/ssh/deploy_ca.pub');
  const args = ['deploy-keys/apply-trust-linux.sh','--retire-v1','--root',root,'--dry-run'];
  assert.notEqual(spawnSync('sh',args,{encoding:'utf8'}).status,0);
  fs.appendFileSync(pub,fixtures.other+'\n');
  const r = spawnSync('sh',args,{encoding:'utf8'}); assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/-ssh-ed25519/); assert.doesNotMatch(r.stdout,/-ssh-ed25519 .*other/);
}));
test('verify dry-run never invokes SSH and forces certificate-only, no multiplexing or agent fallback', () => fixtures(root => {
  const r = spawnSync('bash',['deploy-keys/verify-cert.sh','gb-deploy','--expect','deploy','--identity','not-read','--certificate','not-read.pub','--dry-run'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/IdentityAgent=none/);
  assert.match(r.stdout,/PubkeyAcceptedAlgorithms=ssh-ed25519-cert-v01@openssh.com/);
  assert.match(r.stdout,/ControlPath=none/); assert.match(r.stdout,/-l deploy/);
  assert.match(r.stdout,/-F \/dev\/null/);
}));
test('fake-only verification isolates credentials and distinguishes target cert refusal from unrelated failures', () => fixtures(root => {
  const bin=path.join(root,'bin');fs.mkdirSync(bin);
  const fp='SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0';
  fs.writeFileSync(path.join(bin,'ssh'),`#!/bin/sh
if [ "$1" = -G ]; then printf 'hostname target.invalid\\nport 2222\\nidentityfile alias-v1\\ncertificatefile alias-v1-cert.pub\\nproxyjump unrelated.invalid\\n'; exit 0; fi
printf '%s\\n' "$@" > "$FAKE_ARGV"
if [ "$1" != -F ] || [ "$2" != /dev/null ]; then echo 'IVO_CERT_OK deploy'; exit 0; fi
printf '%s\\n' "$FAKE_OUTPUT"
exit "$FAKE_STATUS"
`,{mode:0o700});
  fs.writeFileSync(path.join(bin,'ssh-keygen'),`#!/bin/sh
[ "$FAKE_PREFLIGHT_STATUS" != 1 ] || exit 1
case "$1" in
  -L) echo '        Type: ssh-ed25519-cert-v01@openssh.com user certificate';;
  -lf) echo '256 ${fp} public-fixture';;
  *) exit 99;;
esac
`,{mode:0o700});
  const id=path.join(root,'identity.mock');fs.writeFileSync(id,'not a credential');
  const argv=path.join(root,'argv.txt');
  function verify(expect,output,status,alias='vps-deploy',extra={}) {
    return spawnSync('bash',['deploy-keys/verify-cert.sh',alias,'--expect',expect,'--identity',id,'--certificate',id],{encoding:'utf8',env:{PATH:bin+':'+process.env.PATH,FAKE_OUTPUT:output,FAKE_STATUS:String(status),FAKE_ARGV:argv,...extra}});
  }
  assert.equal(verify('deploy','IVO_CERT_OK deploy',0).status,0);
  const used=fs.readFileSync(argv,'utf8');
  assert.match(used,/-F\n\/dev\/null\n/);assert.match(used,/HostName=target.invalid\n-p\n2222/);
  assert.doesNotMatch(used,/alias-v1|unrelated.invalid/);assert.equal(used.split('CertificateFile=').length,2);
  assert.notEqual(verify('deploy','IVO_CERT_OK admin',0).status,0);
  assert.equal(verify('admin','IVO_CERT_OK admin',0,'vps-admin').status,0);
  assert.equal(verify('deploy','IVO_CERT_OK deploy\r\n',0,'gb-deploy').status,0,'Windows CRLF marker');
  const denied=["debug1: Authenticating to target.invalid [192.0.2.1]:2222 as 'deploy'",
    'debug1: SSH2_MSG_NEWKEYS received',`debug1: Offering public key: ${id} ED25519-CERT ${fp} explicit`,
    'debug3: send packet: type 50','debug2: we sent a publickey packet, wait for reply',
    'debug3: receive packet: type 51','debug1: Authentications that can continue: publickey',
    'deploy@target.invalid: Permission denied (publickey).'].join('\n');
  assert.equal(verify('refused',denied,255).status,0);
  for(const bad of [denied.replaceAll('target.invalid','jump.invalid'),denied.replace('SSH2_MSG_NEWKEYS received','KEX missing'),
    denied.replace('ED25519-CERT','ED25519'),denied.replace('send packet: type 50','no mutual signature algorithm'),
    denied.replace('receive packet: type 51','receive packet: type 60'),denied+'\ndebug1: Server accepts key: explicit',
    'Permission denied (publickey).']) assert.notEqual(verify('refused',bad,255).status,0,bad);
  for (const error of ['Connection timed out','Host key verification failed','Could not resolve hostname']) assert.notEqual(verify('refused',error,255).status,0);
  assert.notEqual(verify('refused','IVO_CERT_OK admin',0).status,0);
  assert.notEqual(verify('refused',denied,255,'vps-deploy',{FAKE_PREFLIGHT_STATUS:'1'}).status,0,'invalid cert must fail preflight');
  fs.writeFileSync(id,'');
  assert.notEqual(verify('refused',denied,255).status,0,'empty identity cannot prove refusal');
}));
test('verify refuses ambiguous credential paths before any SSH or key inspection', () => fixtures(root => {
  for(const name of ['cert set.pub','line\nbreak.pub','quote".pub','%d-cert.pub']) {
    const r=spawnSync('bash',['deploy-keys/verify-cert.sh','vps-deploy','--expect','deploy','--identity','unread','--certificate',name,'--dry-run'],{encoding:'utf8'});
    assert.equal(r.status,2);assert.match(r.stderr,/credential paths/);
  }
}));
test('sudoers renderer permits only an exact unit and never a shell or wildcard', () => {
  const render = app => spawnSync('bash',['deploy-keys/render-sudoers.sh','--app',app],{encoding:'utf8'});
  assert.match(render('onboarding').stdout,/deploy ALL=\(root\) NOPASSWD: \/usr\/bin\/systemctl restart onboarding.service/);
  assert.equal(render('onboarding.service').stdout,render('onboarding').stdout);
  for (const app of ['*','foo;id','../foo','foo bar','$(id)','.service']) assert.notEqual(render(app).status,0);
});
test('Linux rollback preview restores exact snapshot and disables newly created deploy without writes', () => fixtures(root => {
  const backup=path.join(root,'etc/ssh/ca-rotation-backups/example');
  fs.mkdirSync(path.join(backup,'etc/ssh'),{recursive:true});
  fs.writeFileSync(path.join(backup,'etc/ssh/sshd_config'),'Port 2222\n');
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({created_deploy:true,files:{'etc/ssh/sshd_config':true,'etc/ssh/principals/deploy':false}}));
  const before=fixtures.snapshot(root);
  const r=spawnSync('sh',['deploy-keys/apply-principals-linux.sh','--root',root,'--rollback',backup,'--dry-run'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/\+Port 2222/);assert.match(r.stdout,/- ACCOUNT deploy: lock, expire/);
  assert.deepEqual(fixtures.snapshot(root),before);
}));
test('Windows retirement and rollback preview retain v2 and restore saved public config/ACL', {skip:!process.env.PWSH_BIN}, () => fixtures(root => {
  const ssh=path.join(root,'etc/ssh');fs.appendFileSync(path.join(ssh,'deploy_ca.pub'),fixtures.other+'\n');
  const backup=path.join(ssh,'ca-rotation-backups/example');fs.mkdirSync(backup,{recursive:true});
  const saved=path.join(backup,'0.bak');fs.writeFileSync(saved,'Port 2222\n');
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({createdDeploy:true,files:[{path:path.join(ssh,'sshd_config'),saved,existed:true,acl:'public-fixture-sddl'}]}));
  const before=fixtures.snapshot(root);
  const run=(file,args)=>spawnSync(process.env.PWSH_BIN,['-NoProfile','-File','deploy-keys/'+file,'-Root',ssh,...args],{encoding:'utf8'});
  const retire=run('setup-rog-strix-ca.ps1',['-RetireV1','-DryRun']);assert.equal(retire.status,0,retire.stderr);
  assert.doesNotMatch(retire.stdout,/CA fingerprint: SHA256:Sg4T/);assert.match(retire.stdout,/CA fingerprint: SHA256:JaxL/);
  const rollback=run('apply-principals-windows.ps1',['-Rollback',backup,'-WhatIf']);assert.equal(rollback.status,0,rollback.stderr);
  assert.match(rollback.stdout,/\+Port 2222/);assert.match(rollback.stdout,/- ACCOUNT deploy: disable/);assert.match(rollback.stdout,/ACL RESTORE .*public-fixture-sddl/);
  assert.deepEqual(fixtures.snapshot(root),before);
}));
