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
  const mod=load({HOME:dir,FLEETDECK_BUS_TOKEN:'ivo-offline-test-fixture',FLEET_DB:path.join(dir,'fleet.db'), FLEET_HOSTS_FILE:hostsFile(dir,[]),PORT:'39319'});
  t.after(async()=>{await unload(mod);fs.rmSync(dir,{recursive:true,force:true});});
  function request(body, origin='http://localhost:39319') {
    return new Promise(resolve=> {
      const req=Readable.from([JSON.stringify(body)]);
      req.url='/api/sshkeys/mint';req.method='POST';req.headers={host:'localhost:39319',...(origin?{origin}:{})};
      req.socket={remoteAddress:'127.0.0.1'};
      const headers={};
      const res={setHeader:(k,v)=>headers[k]=v,writeHead(code){this.statusCode=code;},end(data){resolve({status:this.statusCode||200,body:String(data||'')});}};
      mod.server.emit('request',req,res);
    });
  }
  assert.equal((await request({profile:'daily'},null)).status,403);assert.equal(calls.length,0);
  assert.equal((await request({})).status,200);
  assert.deepEqual(calls.pop().args,['--daily','-t','8h','-n','deploy']);
  assert.equal((await request({profile:'admin',ttl:'1h',extraTags:['promptly-only','rog-only']})).status,200);
  assert.deepEqual(calls.pop().args,['--admin','-t','1h','-n','admin,promptly-only,rog-only']);
  const invalid=[{profile:'root'},{profile:null},{profile:'daily',ttl:'1h'},{profile:'admin',ttl:'8h'},
    {profile:'daily',extraTags:['ivy-only']},{profile:'admin',extraTags:['vibes-asus-only']},
    {profile:'admin',extraTags:['root']},{profile:'admin',extraTags:['ivy-only','ivy-only']},
    {profile:'admin',extraTags:'ivy-only'},{profile:'admin',extraTags:['$(bad)']},
    {profile:'admin',principals:'root'},{profile:'admin',caPub:'/unexpected'},[], 'daily'];
  for(const input of invalid) assert.equal((await request(input)).status,400,JSON.stringify(input));
  assert.equal(calls.length,0,'invalid requests never spawn the mint script');
});
