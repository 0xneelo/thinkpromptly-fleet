import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('docs/design/fleetdeck-v2/fixtures/api/sessions.json','utf8'));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/api/**', r => r.request().url().includes('/api/sessions')
  ? r.fulfill({ json: sessions }) : r.fulfill({ json: { ok: true } }));
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:3247/v2/index.html', { waitUntil: 'networkidle' });
await p.getByRole('link', { name: 'App', exact: true }).click();
await p.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
await p.locator('aside button[title="Registry"]').click();
await p.locator('[data-screen-label="Registry"]').waitFor({ state: 'visible' });
await p.waitForTimeout(1200);
const out = await p.evaluate(() => {
  const layer = document.getElementById('fd-l4-layer');
  const root = document.querySelector('[data-screen-label="Registry"]');
  const compiled = [...root.firstElementChild.querySelectorAll('select')];
  const mine = [...layer.querySelectorAll('select')];
  const box = e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; };
  const head = root.lastElementChild.firstElementChild.firstElementChild;
  return {
    layerExists: !!layer,
    insideCompiled: root.querySelectorAll('[data-l4-extra]').length,
    mySelects: mine.map(s => s.getAttribute('data-l4-filter')),
    compiledBoxes: [box(compiled[1]), box(compiled[2])],
    mineBoxes: [box(mine.find(s=>s.getAttribute('data-l4-filter')==='status')), box(mine.find(s=>s.getAttribute('data-l4-filter')==='msg'))],
    css: mine.find(s=>s.getAttribute('data-l4-filter')==='status').style.cssText.slice(0,160),
    activeLeft: box(mine.find(s=>s.getAttribute('data-l4-filter')==='active'))[0] - (box(compiled[2])[0]+box(compiled[2])[2]),
    hidden: compiled.map(s => s.style.visibility),
    styleRules: !!document.getElementById('fd-l4-style'),
    statusFull: [...mine.find(s=>s.getAttribute('data-l4-filter')==='status').options].map(o=>o.value),
  };
});
console.log('LAYER', JSON.stringify(out));
// sort + arrow
await p.evaluate(() => document.querySelector('[data-l4-sort="name"]').click());
await p.waitForTimeout(400);
console.log('SORT', JSON.stringify(await p.evaluate(() => ({
  dir: document.querySelector('[data-l4-sort="name"]').getAttribute('data-l4-dir'),
  arrow: getComputedStyle(document.querySelector('[data-l4-sort="name"]'), '::after').content,
  first: document.querySelector('[data-l4-row]').children[1].textContent,
  stored: localStorage.fleetSort,
}))));
// select a gone row -> bulk bar + overlay Forget
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-l4-row]')];
  const gone = rows.find(r => r.children[7].textContent.startsWith('gone'));
  gone.children[0].click();
});
await p.waitForTimeout(400);
console.log('BULK', JSON.stringify(await p.evaluate(() => {
  const kill = document.querySelector('[data-l4-bulk="kill"]');
  const forget = document.querySelector('[data-l4-bulk="forget"]');
  return { killCount: kill && kill.getAttribute('data-l4-count'), killOff: kill && kill.getAttribute('data-l4-off'),
           killAfter: kill && getComputedStyle(kill,'::after').content,
           forget: forget && forget.textContent, forgetInLayer: !!(forget && forget.closest('#fd-l4-layer')) };
})));
// menu + details
await p.evaluate(() => document.querySelector('[data-l4-act="menu"]').click());
await p.waitForTimeout(300);
console.log('MENU', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('[data-l4-menu]')].map(b=>b.textContent))));
await p.evaluate(() => document.querySelector('[data-l4-menu="details"]').click());
await p.waitForTimeout(300);
console.log('DETAILS', JSON.stringify(await p.evaluate(() => {
  const d = document.querySelector('[data-l4-details]');
  return d && { inLayer: !!d.closest('#fd-l4-layer'), fields: [...d.querySelectorAll('div > div:first-child')].map(x=>x.textContent) };
})));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
