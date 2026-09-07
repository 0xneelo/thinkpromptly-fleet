#!/usr/bin/env node
// v2-shim-regress.mjs — regressions for the oracle findings F1, F2, F3, F6.
//
// These cannot be A/B steps in tools/v2-interactions.mjs: side A is pass 1, running the
// real dc-runtime, which has no `sc-for key=`, no `data-dc-raw` and no FD.setData. And the
// production template exercises none of them either — it has zero keyed loops and zero raw
// parents, which is exactly why every gate stayed green while these bugs were live.
//
// So each finding is driven against a SYNTHETIC fixture: a small template compiled by the
// real tools/dc-compile.mjs and mounted on the real public/v2/runtime.js, served from a
// throwaway loopback server. Nothing is written into public/.
//
// Each check is asserted in both directions where that is possible: the fixture also runs
// the pre-fix behaviour so a green result cannot come from the test doing nothing.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'v2-regress-'));

// A keyed list, a raw-owned parent, and a renderVals that can be made to throw on demand.
const TEMPLATE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<x-dc>
<helmet><style>.lbl{font-weight:600}</style></helmet>
<div>
  <div id="list">
    <sc-for list="{{ rows }}" as="r" key="{{ r.id }}">
      <div data-row="{{ r.id }}"><span class="lbl">{{ r.id }}</span></div>
    </sc-for>
  </div>
  <div id="raw" data-dc-raw="1">
    <span class="seed">{{ tick }}</span>
    <sc-if value="{{ showExtra }}"><span class="extra">extra</span></sc-if>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{}">
class Component extends DCLogic {
  constructor(p) { super(p); this.state = { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], tick: 0, showExtra: false }; window.__comp = this; }
  renderVals() {
    if (window.__boom) throw new Error('renderVals boom (deliberate)');
    return { rows: this.state.rows, tick: this.state.tick, showExtra: this.state.showExtra };
  }
}
</script>
</body>
</html>
`;
const tplPath = path.join(dir, 'fixture.dc.html');
writeFileSync(tplPath, TEMPLATE);

const APP = execFileSync(process.execPath, [path.join(ROOT, 'tools/dc-compile.mjs'), '--template', tplPath, '--print-app'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// F1's whole point is the emitted row key. Assert the generated code before running it.
const emitsIdentityKey = /\?\?\s*i\)/.test(APP);
const LOGIC = TEMPLATE.slice(TEMPLATE.indexOf('>', TEMPLATE.indexOf('<script')) + 1, TEMPLATE.indexOf('</script>'));
const RUNTIME = readFileSync(path.join(ROOT, 'public/v2/runtime.js'), 'utf8');
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>regress</title></head>
<body><div id="root"></div>
<script src="/runtime.js"></script><script src="/logic.js"></script><script src="/app.js"></script>
</body></html>`;

const routes = { '/': ['text/html', PAGE], '/runtime.js': ['text/javascript', RUNTIME],
                 '/logic.js': ['text/javascript', LOGIC], '/app.js': ['text/javascript', APP] };
const server = createServer((req, res) => {
  const r = routes[req.url.split('?')[0]];
  if (!r) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': r[0] }); res.end(r[1]);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-row="a"]');

const results = [];
const check = (id, title, pass, detail) => { results.push({ id, title, pass, detail }); };

// ---- F1: reordering a keyed list must move each row's whole subtree, foreign nodes included
const f1 = await page.evaluate(() => {
  const rowB = document.querySelector('[data-row="b"]');
  const foreign = document.createElement('em');
  foreign.id = 'foreign';
  foreign.textContent = 'mounted-by-someone-else';
  rowB.appendChild(foreign);                       // a subtree the reconciler did not create
  const before = [...document.querySelectorAll('[data-row]')].map(e => e.dataset.row);
  const node = document.getElementById('foreign');
  const beforeParent = node.closest('[data-row]').dataset.row;
  const comp = window.__comp;
  comp.setState({ rows: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] });   // reorder
  return { before, beforeParent };
});
await page.waitForTimeout(120);
const f1after = await page.evaluate(() => {
  const node = document.getElementById('foreign');
  return {
    order: [...document.querySelectorAll('[data-row]')].map(e => e.dataset.row),
    rowCount: document.querySelectorAll('[data-row]').length,
    foreignStillPresent: !!node,
    foreignParent: node ? node.closest('[data-row]').dataset.row : null,
    labels: [...document.querySelectorAll('[data-row] .lbl')].map(e => e.textContent),
  };
});
check('F1', 'reordering a keyed list keeps each row identity (foreign subtree travels with its row)',
  emitsIdentityKey && f1after.rowCount === 3 && f1after.order.join(',') === 'c,a,b'
  && f1after.foreignStillPresent && f1after.foreignParent === 'b'
  && f1after.labels.join(',') === 'c,a,b',
  `emitsIdentityKey=${emitsIdentityKey} order=${f1after.order.join(',')} labels=${f1after.labels.join(',')} foreignParent=${f1after.foreignParent} rows=${f1after.rowCount}`);

// ---- F3: a data-dc-raw parent owns its children; the reconciler must not touch them
const f3 = await page.evaluate(() => {
  const raw = document.getElementById('raw');
  const injected = document.createElement('b');
  injected.id = 'raw-child';
  raw.appendChild(injected);
  // Toggling showExtra changes the raw parent's OWN child list, which is the only thing
  // that reaches the removal path. Changing text alone hits syncChildren's early return
  // and the bug never fires -- the first version of this check passed with the guard
  // removed, which is why the negative control exists.
  window.__comp.setState({ tick: 1, showExtra: true, rows: [{ id: 'a' }, { id: 'b' }] });
  return true;
});
await page.waitForTimeout(120);
const f3after = await page.evaluate(() => ({
  injectedSurvived: !!document.getElementById('raw-child'),
  rawChildren: document.getElementById('raw').children.length,
}));
check('F3', 'a data-dc-raw parent keeps foreign children across an unrelated re-render',
  f3after.injectedSurvived, `injectedSurvived=${f3after.injectedSurvived} rawChildren=${f3after.rawChildren}`);

// ---- F2: a throw in renderVals must keep the last DOM, not blank the screen
const before2 = await page.evaluate(() => document.querySelector('#list').innerHTML.length);
await page.evaluate(() => { window.__boom = true; window.__comp.setState({ tick: 2 }); });
await page.waitForTimeout(150);
const f2after = await page.evaluate(() => ({
  listLen: document.querySelector('#list').innerHTML.length,
  rows: document.querySelectorAll('[data-row]').length,
}));
check('F2', 'a throw in renderVals keeps the last committed DOM instead of blanking every screen',
  f2after.listLen === before2 && f2after.rows > 0 && errors.some(e => /renderVals\(\) threw/.test(e)),
  `listLen ${before2} -> ${f2after.listLen}, rows=${f2after.rows}, reported=${errors.some(e => /renderVals\(\) threw/.test(e))}`);

// recovery: once renderVals stops throwing, rendering must resume
await page.evaluate(() => { window.__boom = false; window.__comp.setState({ tick: 3 }); });
await page.waitForTimeout(150);
const recovered = await page.evaluate(() => document.querySelector('#raw .seed') ? document.querySelector('#raw .seed').textContent : null);
check('F2b', 'rendering resumes after renderVals stops throwing', recovered === '3', `tick rendered = ${recovered}`);

await browser.close();
server.close();

let failed = 0;
for (const r of results) { if (!r.pass) failed++; console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id}  ${r.title}\n      ${r.detail}`); }
console.log(`\n${results.length - failed}/${results.length} shim regressions passed`);
process.exit(failed ? 1 : 0);
