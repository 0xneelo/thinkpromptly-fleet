// Offline browser proof: every request is fulfilled locally; mint is a recorded mock.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[], mints=[];
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.route('**/*', async route => {
      const req=route.request(); const url=new URL(req.url());
      if (url.pathname.startsWith('/api/')) {
        let body={};
        if(url.pathname==='/api/sshkeys') body={keys:[],certs:[]};
        else if(url.pathname==='/api/ghtrain') body={active:false};
        else if(url.pathname==='/api/sshkeys/mint') {mints.push(req.postDataJSON());body={ok:false,error:'Offline preview: no mint performed'};}
        else if(url.pathname==='/api/sessions') body={sessions:[],errors:[]};
        else if(url.pathname==='/api/registry') body=[];
        else if(url.pathname==='/api/messages') body={messages:[]};
        else if(url.pathname==='/api/health') body={hosts:[]};
        await route.fulfill({contentType:'application/json',body:JSON.stringify(body)}); return;
      }
      const rel=url.pathname==='/app'?'v2/index.html':url.pathname.replace(/^\//,'');
      const file=path.resolve('public',rel);
      if(!file.startsWith(path.resolve('public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) {await route.fulfill({status:404,body:''});return;}
      const ext=path.extname(file); const contentType={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[ext]||'application/octet-stream';
      await route.fulfill({contentType,body:fs.readFileSync(file)});
    });
    await page.goto('http://ivo.invalid/app#keys');
    const card=page.locator('[data-screen-label="SSH keys"]').locator(':scope > div').first();
    await card.getByRole('button',{name:'Daily cert',exact:true}).waitFor();
    assert.equal(await card.getByRole('button',{name:'Daily cert',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await card.getByRole('button',{name:'rog-only',exact:true}).count(),0);
    await card.getByRole('button',{name:'Mint daily cert',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('Offline preview: no mint performed'));
    assert.deepEqual(mints.shift(),{profile:'daily',ttl:'8h',extraTags:[]});
    await card.getByRole('button',{name:'Admin cert',exact:true}).click();
    await card.getByRole('button',{name:'rog-only',exact:true}).waitFor();
    assert.equal(await card.getByRole('button',{name:'vibes-asus',exact:true}).isDisabled(),true);
    await card.getByRole('button',{name:'rog-only',exact:true}).click();
    assert.equal(await card.getByRole('button',{name:'rog-only',exact:true}).getAttribute('aria-pressed'),'true');
    assert.match(await card.getByRole('button',{name:'rog-only',exact:true}).getAttribute('title'),/rog-strix/);
    await card.getByRole('button',{name:'Mint admin cert',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('Offline preview: no mint performed'));
    assert.deepEqual(mints.shift(),{profile:'admin',ttl:'1h',extraTags:['rog-only']});
    await page.screenshot({path:'/tmp/ivo-keys-admin.png'});
    await card.getByRole('button',{name:'Daily cert',exact:true}).click();
    await card.getByRole('button',{name:'Mint daily cert',exact:true}).waitFor();
    assert.equal(await card.getByRole('button',{name:'rog-only',exact:true}).count(),0);
    // Measure the actual card independently of the pre-existing desktop shell.
    await page.evaluate(()=> {
      const card=document.querySelector('[data-screen-label="SSH keys"]').firstElementChild.cloneNode(true);
      card.id='ivo-card-preview'; card.style.width='100%';card.style.boxSizing='border-box';
      document.body.replaceChildren(card);document.body.style.padding='16px';document.body.style.boxSizing='border-box';
    });
    await page.setViewportSize({width:390,height:844});
    const narrow=page.locator('#ivo-card-preview');
    const box=await narrow.boundingBox(); assert.ok(box.x>=0 && box.x+box.width<=391 && box.width>200,'isolated mint card fits narrow viewport');
    assert.equal(await narrow.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:'/tmp/ivo-keys-daily-mobile.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: offline browser Daily/Admin, hidden tags, label join, unknown host disabled, requests, isolated 390px mint card, no page errors');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
