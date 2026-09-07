import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('docs/design/fleetdeck-v2/fixtures/api/sessions.json','utf8'));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/api/**', r => r.request().url().includes('/api/sessions') ? r.fulfill({ json: sessions }) : r.fulfill({ json: { ok: true } }));
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:3247/v2/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Registry')?.click());
await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(() => {
  const root = document.querySelector('[data-screen-label="Registry"]');
  const fr = root.firstElementChild;
  const sels = [...fr.querySelectorAll('select')];
  const r0 = root.querySelector('[data-l4-row]');
  return {
    rootRect: root.getBoundingClientRect().toJSON(),
    filterRowRect: fr.getBoundingClientRect().toJSON(),
    selRects: sels.map(s => s.getBoundingClientRect().toJSON()),
    selDisplay: sels.map(s => getComputedStyle(s).display + '/' + getComputedStyle(s).visibility),
    rowRect: r0 && r0.getBoundingClientRect().toJSON(),
    anchoredCount: window.FD.screens.registry._state && 'n/a',
  };
})));
await b.close();
