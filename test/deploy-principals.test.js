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
}));
test('fake-only verification distinguishes success, wrong role, refusal, and network error', () => fixtures(root => {
  const bin=path.join(root,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'ssh'),'#!/bin/sh\nprintf "%s\\n" "$FAKE_OUTPUT"\nexit "$FAKE_STATUS"\n',{mode:0o700});
  const id=path.join(root,'identity.mock');fs.writeFileSync(id,'not a credential');
  function verify(expect,output,status,alias='vps-deploy') {
    return spawnSync('bash',['deploy-keys/verify-cert.sh',alias,'--expect',expect,'--identity',id,'--certificate',id],{encoding:'utf8',env:{PATH:bin+':'+process.env.PATH,FAKE_OUTPUT:output,FAKE_STATUS:String(status)}});
  }
  assert.equal(verify('deploy','IVO_CERT_OK deploy',0).status,0);
  assert.notEqual(verify('deploy','IVO_CERT_OK admin',0).status,0);
  assert.equal(verify('admin','IVO_CERT_OK admin',0,'vps-admin').status,0);
  assert.equal(verify('refused','Permission denied (publickey).',255).status,0);
  for (const error of ['Connection timed out','Host key verification failed','Could not resolve hostname']) assert.notEqual(verify('refused',error,255).status,0);
  assert.notEqual(verify('refused','IVO_CERT_OK admin',0).status,0);
}));
test('sudoers renderer permits only an exact unit and never a shell or wildcard', () => {
  const render = app => spawnSync('bash',['deploy-keys/render-sudoers.sh','--app',app],{encoding:'utf8'});
  assert.match(render('onboarding').stdout,/deploy ALL=\(root\) NOPASSWD: \/usr\/bin\/systemctl restart onboarding.service/);
  for (const app of ['*','foo;id','../foo','foo bar','$(id)']) assert.notEqual(render(app).status,0);
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
