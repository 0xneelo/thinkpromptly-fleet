import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('docs/design/fleetdeck-v2/fixtures/api/sessions.json','utf8'));
const OUT = 'docs/design/fleetdeck-v2/improvised/l4/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/api/**', r => r.request().url().includes('/api/sessions') ? r.fulfill({ json: sessions }) : r.fulfill({ json: { ok: true } }));
const p = await ctx.newPage();
const reach = async () => {
  await p.goto('http://127.0.0.1:3247/v2/index.html', { waitUntil: 'networkidle' });
  await p.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await p.getByRole('link', { name: 'App', exact: true }).click();
  await p.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await p.locator('aside button[title="Registry"]').click();
  await p.locator('[data-screen-label="Registry"]').waitFor({ state: 'visible' });
  await p.waitForTimeout(900);
};
const clip = async (name, box) => { await p.screenshot({ path: OUT + name, clip: box }); console.log('wrote', name); };
const rectOf = async (sel) => p.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect();
  return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: Math.min(1440, r.width + 24), height: Math.min(900, r.height + 24) }; }, sel);

await reach();
// 01 filter row: the covered menus + the improvised active-age select
await clip('01-filter-row.png', { x: 268, y: 76, width: 1150, height: 46 });
// 02 the full status menu (opened)
await p.selectOption('#fd-l4-layer select[data-l4-filter="status"]', 'kill-requested');
await p.waitForTimeout(500);
await clip('02-status-kill-requested.png', { x: 268, y: 76, width: 1150, height: 240 });
await p.selectOption('#fd-l4-layer select[data-l4-filter="status"]', '');
await p.waitForTimeout(400);

// 03 bulk bar with the improvised Forget
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-l4-row]')];
  const gone = rows.find(r => r.children[7].textContent.startsWith('gone'));
  gone.children[0].click();
  const live = rows.find(r => !r.children[7].textContent.startsWith('gone'));
  live.children[0].click();
});
await p.waitForTimeout(500);
{
  const box = await p.evaluate(() => {
    const root = document.querySelector('[data-screen-label="Registry"]');
    let bar = null;
    [...root.children].forEach(c => { const f = c.firstElementChild;
      if (f && f.tagName === 'SPAN' && /selected$/.test(f.textContent||'')) bar = c; });
    const r = bar.getBoundingClientRect();
    return { x: r.left - 10, y: r.top - 10, width: r.width + 20, height: r.height + 20 };
  });
  await clip('03-bulk-bar.png', box);
}
await p.evaluate(() => document.querySelector('[data-l4-bulk="kill"]').closest('div').querySelector('button:last-of-type').click());
await p.waitForTimeout(400);

// 04 the row menu
await reach();
await p.evaluate(() => document.querySelectorAll('[data-l4-act="menu"]')[2].click());
await p.waitForTimeout(400);
await clip('04-row-menu.png', await rectOf('#fd-l4-layer [data-l4-extra="menu"]'));

// 05 the details panel
await p.evaluate(() => document.querySelector('[data-l4-menu="details"]').click());
await p.waitForTimeout(400);
await clip('05-details-panel.png', await rectOf('#fd-l4-layer [data-l4-details]'));

// 06 the cell editor over a Group cell
await reach();
await p.evaluate(() => document.querySelectorAll('[data-l4-row]')[3].children[2].click());
await p.waitForTimeout(400);
await clip('06-cell-editor.png', { x: 268, y: 140, width: 1150, height: 140 });

// 07 a toast (tag a row for kill)
await reach();
await p.evaluate(() => document.querySelectorAll('[data-l4-act="menu"]')[1].click());
await p.waitForTimeout(300);
await p.evaluate(() => document.querySelector('[data-l4-menu="tag"]').click());
await p.waitForTimeout(600);
await clip('07-toast.png', { x: 1040, y: 780, width: 396, height: 110 });

// 08 the whole screen, live
await reach();
await p.screenshot({ path: OUT + '08-registry-live.png' });
console.log('wrote 08-registry-live.png');
await b.close();
