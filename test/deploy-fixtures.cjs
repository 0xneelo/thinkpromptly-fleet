'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const first = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO4jL5PZycHkKIWlwaenerKq6VcuVk1PiqlyrrU18E4G v1';
const other = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPer5OIi3/djg1FyVavjGUdXfbU6NNAjEa/iO356iBtC other';
function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ivo-principals-'));
  try {
    fs.mkdirSync(path.join(root,'etc/ssh'),{recursive:true});
    fs.writeFileSync(path.join(root,'etc/ssh/sshd_config'),'Port 22\nMatch Group administrators\n    X11Forwarding no\n');
    fs.writeFileSync(path.join(root,'etc/ssh/deploy_ca.pub'),first+'\n');
    return fn(root);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
fixture.other=other;
fixture.snapshot=function(root) {
  const out={};
  for (const n of fs.readdirSync(root,{recursive:true})) {
    const p=path.join(root,n);const stat=fs.statSync(p);
    out[n]=[stat.mode,stat.isDirectory() ? null : fs.readFileSync(p,'utf8')];
  }
  return out;
};
module.exports=fixture;
