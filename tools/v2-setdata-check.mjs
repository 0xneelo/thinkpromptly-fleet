#!/usr/bin/env node
// v2-setdata-check.mjs — proves the L2-L10 data seam actually reaches the UI.
//
// T3 moved the mock's seed data out of logic.js into fixture.js, and the nine
// logic slices L2-L10 feed live API data through FD.setData(name, value). That
// call is their ONLY data entry point, so "it re-renders" must be a measured
// fact, not an assumption.
//
// The risk this rules out: if logic.js had captured the seeds at load time
// (`const regData = FD.fixture.regData` at module scope), FD.setData would
// replace FD.fixture.regData, schedule a re-render, and the UI would never
// change -- silently. It does not: the substituted declarations live INSIDE
// renderVals(), which re-runs on every render and re-reads FD.fixture.
//
// Usage: node tools/v2-setdata-check.mjs [--app <url>]

import { chromium } from 'playwright';

const args = process.argv.slice(2);
let app = 'http://127.0.0.1:3199/v2/index.html';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--app') app = args[++i];
  else throw new Error(`Unknown flag: ${args[i]}`);
}

const PROBE = 'ZZZ-setdata-probe';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await context.newPage();
await context.route(/\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i, r => r.abort());
await page.goto(app, { waitUntil: 'domcontentloaded' });
await page.getByRole('link', { name: 'App', exact: true }).click();
await page.locator('aside button[title="Registry"]').click();
await page.locator('[data-screen-label="Registry"]').waitFor({ state: 'visible' });

const rowSel = '[data-screen-label="Registry"] [aria-label="Select row"]';
const before = await page.evaluate(s => document.querySelectorAll(s).length, rowSel);

const seam = await page.evaluate(probe => {
  if (typeof FD === 'undefined') return { err: 'FD is not defined' };
  for (const k of ['fixture', 'screens', 'shell']) if (!FD[k]) return { err: `FD.${k} missing` };
  if (typeof FD.setData !== 'function') return { err: 'FD.setData is not a function' };
  FD.setData('regData', [{ id: 'r1', s: probe, g: 'g', tk: 't', st: 'active', active: '1h ago', msg: 'now', seen: 'now' }]);
  return { ok: true, fixtureLength: FD.fixture.regData.length };
}, PROBE);

await page.waitForTimeout(700);
const after = await page.evaluate(([s, probe]) => ({
  rows: document.querySelectorAll(s).length,
  probeVisible: document.body.innerText.includes(probe),
}), [rowSel, PROBE]);
await browser.close();

const pass = !seam.err && after.rows === 1 && after.probeVisible;
console.log(`FD surface        : ${seam.err ? 'FAIL — ' + seam.err : 'FD.fixture, FD.screens, FD.shell, FD.setData all present'}`);
console.log(`registry rows     : ${before} before -> ${after.rows} after`);
console.log(`new data rendered : ${after.probeVisible}`);
console.log(pass ? 'PASS: FD.setData replaces fixture data and the UI re-renders.'
                 : 'FAIL: FD.setData did not reach the UI — the L2-L10 data seam is broken.');
process.exit(pass ? 0 : 1);
