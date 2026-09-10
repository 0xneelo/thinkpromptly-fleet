'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {Readable, PassThrough} = require('node:stream');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {tmpdir, hostsFile, load, unload} = require('./helpers');

test('actual mint route: origin fence, fixed profiles, tag validation and argv; no real process minted', async t => {
  const dir = tmpdir('ivo-mint-route');
  const calls=[];
  const original = cp.spawn;
  t.mock.method(cp,'spawn',(file,args,opts) => {
    if (!file.endsWith('/deploy-keys/mint-deploy-cert.sh')) return original(file,args,opts);
    calls.push({file,args});
    const child = new EventEmitter(); child.stdout=new PassThrough();child.stderr=new PassThrough();
    process.nextTick(()=> {child.stdout.end('/mock/certificate-output-directory\n'); child.emit('close',0);});
    return child;
  });
  const oldHome=process.env.HOME;
  t.after(()=>{process.env.HOME=oldHome;});
  const machines=path.join(dir,'machines.json');
  const fleet={machines:[{id:'german-box',route:'ssh',ssh:'gb-deploy'},{id:'think-box',route:'ssh',ssh:'vps-deploy'},{id:'rog-strix',route:'ssh',ssh:'rs-deploy'}]};
  fs.writeFileSync(machines,JSON.stringify(fleet));
  const mod=load({HOME:dir,FLEETDECK_BUS_TOKEN:'ivo-offline-test-fixture',FLEET_DB:path.join(dir,'fleet.db'), FLEET_HOSTS_FILE:hostsFile(dir,[]),FLEET_MACHINES_FILE:machines,SSH_ROTATION_STATE:'legacy',PORT:'39319'});
  t.after(async()=>{await unload(mod);fs.rmSync(dir,{recursive:true,force:true});});
  delete process.env.SSH_ROTATION_STATE; // Exercise the committed Legacy state file first.
  function request(body, origin='http://localhost:39319', url='/api/sshkeys/mint') {
    return new Promise(resolve=> {
      const req=Readable.from([JSON.stringify(body)]);
      req.url=url;req.method='POST';req.headers={host:'localhost:39319',...(origin?{origin}:{})};
      req.socket={remoteAddress:'127.0.0.1'};
      const headers={};
      const res={setHeader:(k,v)=>headers[k]=v,writeHead(code){this.statusCode=code;},end(data){resolve({status:this.statusCode||200,body:String(data||'')});}};
      mod.server.emit('request',req,res);
    });
  }
  assert.equal((await request({profile:'daily'},null)).status,403);assert.equal(calls.length,0);
  assert.equal((await request({})).status,200);
  assert.deepEqual(calls.pop().args,['--legacy','-t','1h','-n','root,vibe,misterisley,tabor']);
  assert.equal((await request({profile:'legacy',ttl:'8h',extraTags:[]})).status,200);
  assert.deepEqual(calls.pop().args,['--legacy','-t','8h','-n','root,vibe,misterisley,tabor']);
  assert.equal((await request({profile:'daily'})).status,200);
  assert.deepEqual(calls.pop().args,['--daily','-t','8h','-n','deploy']);
  assert.equal((await request({profile:'admin',ttl:'1h',extraTags:['promptly-only','rog-only']})).status,200);
  assert.deepEqual(calls.pop().args,['--admin','-t','1h','-n','admin,promptly-only,rog-only']);
  const invalid=[{profile:'root'},{profile:null},{profile:'daily',ttl:'1h'},{profile:'admin',ttl:'8h'},{profile:'legacy',ttl:['1h']},{profile:'legacy',ttl:{toString:null}},
    {profile:'legacy',ttl:'24h'},{profile:'legacy',extraTags:['ivy-only']},{profile:'legacy',principals:'tabor'},
    {profile:'daily',extraTags:['ivy-only']},{profile:'admin',extraTags:['vibes-asus-only']},
    {profile:'admin',extraTags:['root']},{profile:'admin',extraTags:['ivy-only','ivy-only']},
    {profile:'admin',extraTags:'ivy-only'},{profile:'admin',extraTags:['$(bad)']},
    {profile:'admin',principals:'root'},{profile:'admin',caPub:'/unexpected'},[], 'daily'];
  for(const input of invalid) assert.equal((await request(input)).status,400,JSON.stringify(input));
  assert.equal(calls.length,0,'invalid requests never spawn the mint script');
  fs.writeFileSync(machines,JSON.stringify({machines:[...fleet.machines,{id:'new-box',route:'ssh',user:'new-user',ssh:'new-alias'}]}));
  assert.equal((await request({profile:'legacy'})).status,400,'new login outside Legacy blocks mint');
  fs.writeFileSync(machines,JSON.stringify({machines:[{id:'unknown',route:'ssh',ssh:'unmapped-alias'}]}));
  assert.equal((await request({profile:'legacy'})).status,400,'unknown alias must not guess a login');
  fs.writeFileSync(machines,'malformed');assert.equal((await request({profile:'legacy'})).status,400);
  fs.writeFileSync(machines,JSON.stringify(fleet));
  process.env.SSH_ROTATION_STATE='s3-applied';
  assert.equal((await request({})).status,200);
  assert.deepEqual(calls.pop().args,['--daily','-t','8h','-n','deploy']);
  assert.equal(calls.length,0);
  // Empty fixture directories only: no key or certificate material is created.
  const certs=path.join(dir,'.ssh/deploy-certs');fs.mkdirSync(certs,{recursive:true});
  const kept=path.join(certs,'retained');fs.mkdirSync(kept);
  const names=['current','current-daily','current-admin'];
  for(const selected of names) {
    const victim=path.join(certs,'delete-fixture');fs.mkdirSync(victim);
    for(const name of names) fs.symlinkSync(name===selected?victim:'retained',path.join(certs,name));
    assert.equal((await request({dir:victim},undefined,'/api/sshkeys/delete')).status,200);
    assert.equal(fs.existsSync(victim),false);
    assert.equal(fs.readdirSync(certs).includes(selected),false,selected+' pointer removed');
    for(const name of names.filter(n=>n!==selected)) {
      assert.equal(fs.readlinkSync(path.join(certs,name)),'retained','other profile pointer preserved');
      fs.unlinkSync(path.join(certs,name));
    }
  }
  assert.equal((await request({dir:certs},undefined,'/api/sshkeys/delete')).status,400,'cannot delete the credential root');
});
