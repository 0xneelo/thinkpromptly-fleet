#!/usr/bin/env node
// v2-interactions.mjs — S2 interaction parity.
//
// Runs one scripted click-through IDENTICALLY on pass 1 (side A, dc-runtime) and
// on the compiled build (side B), dumping and normalizing the #dc-root subtree
// after every step, and asserting the two are byte-identical at each step.
//
// A static 36-screen DOM comparison only proves the first render. This proves the
// state machine: that setState, the keyed reconciliation, the callback refs and the
// event wiring all still behave as dc-runtime's React-backed version did.
//
// It shares normalizeDump() with tools/v2-parity.mjs on purpose — if the two used
// different normalizers, agreement between the gates would mean nothing.
//
// Timers are frozen symmetrically on both sides, exactly as in v2-parity.mjs. A
// reader audit of the logic confirmed the consequence: with setTimeout frozen the
// message delivered/acked transitions (900+250i, 3000+450i ms) and the inbound ACK
// bubble (5200+800i ms) never fire, so no Date.now()-derived value ever reaches the
// DOM. That is why the volatile mask here is empty, like the parity harness's.
//
// Usage:
//   node tools/v2-interactions.mjs [--a <url>] [--b <url>] [--theme dark]
//                                  [--out <path>] [--self-test]

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeDump } from './v2-parity.mjs';

const DEFAULT_A = 'http://127.0.0.1:3199/v2/pass1/index.html';
const DEFAULT_B = 'http://127.0.0.1:3199/v2/index.html';
const NAV_ITEMS = ['Windows', 'Org chart', 'Registry', 'Message bus', 'SSH keys', 'Accounts', 'Machines', 'Desktop sessions'];

// Every step is applied to BOTH sides in the same order. Selectors and the state
// each one drives were established by a line-by-line audit of the template and the
// logic class; template line refs are in the comments.
const STEPS = [
  ['enter-app',            p => p.getByRole('link', { name: 'App', exact: true }).click()],                    // :52  view -> app
  ['theme-toggle',         p => p.locator('aside button[title="Toggle light / dark mode"]').click()],          // :160 A_toggleMode
  ['sidebar-collapse',     p => p.locator('button[title="Collapse / expand sidebar"]').click()],               // :156 leftOpen  252px -> 64px
  ['right-rail-toggle',    p => p.locator('button[title="Toggle accounts panel"]').click()],                   // :217 rightOpen
  ['video-toggle',         p => p.locator('button[title="Toggle background video"]').click()],                 // :164 videoOn
  ...NAV_ITEMS.map(n => [`nav-${n.replace(/ /g, '-').toLowerCase()}`,
                          p => p.locator(`aside nav button[title="${n}"]`).click()]),                          // :171-178
  ['registry-open',        p => p.locator('aside nav button[title="Registry"]').click()],
  ['registry-select-all',  p => p.locator('button[aria-label="Select all"]').first().click()],                 // :367 A_toggleAll
  ['registry-unselect-row',p => p.locator('button[aria-label="Select row"]').first().click()],                 // :374 r.toggle
  ['bus-open',             p => p.locator('aside nav button[title="Message bus"]').click()],
  ['bus-select-mode',      p => p.locator('button[title="Pick several sessions for a broadcast"]').click()],    // :401 selecting
  ['bus-select-mode-off',  p => p.locator('button[title="Pick several sessions for a broadcast"]').click()],
  ['bus-compose',          p => p.locator('[data-screen-label="Message bus"] textarea').first().fill('parity probe')],
  ['windows-open',         p => p.locator('aside nav button[title="Windows"]').click()],
  ['term-fullscreen',      p => p.locator('[data-screen-label="Windows"] button[title="Fullscreen"]').first().click()], // :231 termOpen
  ['term-menu',            p => p.locator('button[title="Switch session"]').first().click()],                  // :784 termMenu
  ['term-escape-menu',     p => p.keyboard.press('Escape')],                                                   // :1239 closes menu first
  ['term-escape-close',    p => p.keyboard.press('Escape')],                                                   // :1240 closes terminal
  ['accounts-open',        p => p.locator('aside nav button[title="Accounts"]').click()],
  ['machines-open',        p => p.locator('aside nav button[title="Machines"]').click()],
  ['desktop-open',         p => p.locator('aside nav button[title="Desktop sessions"]').click()],
  // The Deck link lives in the LANDING nav (:51), and the landing view is
  // display:none while view === 'app'. Clicking it straight from the app view times
  // out -- which is exactly what happened on the first self-test run, silently
  // turning this and the four ArrowRight steps into no-ops. Reload to get a clean
  // landing view first; both sides do the same thing, so the comparison holds.
  ['deck-enter',           async (p, url) => {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
    await p.getByRole('link', { name: /^Deck\b/ }).click();
    await p.locator('[data-screen-label="01 Title"]').waitFor({ state: 'visible' });
  }],
  ['deck-right-1',         p => p.keyboard.press('ArrowRight')],                                               // :2026 DeckLogic.goTo
  ['deck-right-2',         p => p.keyboard.press('ArrowRight')],
  ['deck-right-3',         p => p.keyboard.press('ArrowRight')],
  ['deck-right-4',         p => p.keyboard.press('ArrowRight')],
];

function parseArgs(argv) {
  const o = { a: DEFAULT_A, b: DEFAULT_B, theme: 'dark', out: 'docs/design/fleetdeck-v2/verify/S2/interactions.json', selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--a') o.a = argv[++i];
    else if (f === '--b') o.b = argv[++i];
    else if (f === '--theme') o.theme = argv[++i];
    else if (f === '--out') o.out = argv[++i];
    else if (f === '--self-test') o.selfTest = true;
    else throw new Error(`Unknown flag: ${f}`);
  }
  if (o.selfTest) o.b = o.a;
  return o;
}

// Identical to v2-parity.mjs's freeze. Both sides get it, so a frozen timer is not
// a difference — it is a shared, declared condition of the comparison.
async function openSide(browser, url, theme) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  await context.addInitScript(t => {
    try {
      localStorage.setItem('fd-landing-dark', t === 'dark' ? '1' : '0');
      localStorage.setItem('fd-app-video', 'false');
    } catch {}
    window.setInterval = () => 0;
    window.setTimeout = () => 0;
    window.requestAnimationFrame = () => 0;
    const kill = () => {
      const s = document.createElement('style');
      s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
      document.head.appendChild(s);
    };
    if (document.head) kill(); else document.addEventListener('DOMContentLoaded', kill);
  }, theme);
  await context.route(/\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i, r => r.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  return { context, page, url };
}

async function snapshot(page, side) {
  await page.waitForTimeout(120);
  const html = await page.evaluate(() => document.querySelector('#dc-root')?.outerHTML ?? null);
  if (!html) throw new Error(`${side}: #dc-root not found`);
  return normalizeDump(html, side);
}

const opts = parseArgs(process.argv.slice(2));
const browser = await chromium.launch();
const A = await openSide(browser, opts.a, opts.theme);
const B = await openSide(browser, opts.b, opts.theme);

const results = [];
let identicalCount = 0;

{
  const a = await snapshot(A.page, 'A'), b = await snapshot(B.page, 'B');
  const identical = a === b;
  if (identical) identicalCount++;
  results.push({ step: 'initial-load', identical, aLength: a.length, bLength: b.length,
    aSha256: createHash('sha256').update(a).digest('hex'), bSha256: createHash('sha256').update(b).digest('hex'),
    firstDiffOffset: identical ? null : [...a].findIndex((c, i) => c !== b[i]) });
}

for (const [name, action] of STEPS) {
  const status = {};
  for (const [side, ctx] of [['a', A], ['b', B]]) {
    try { await action(ctx.page, ctx.url); status[side] = 'ok'; }
    catch (err) { status[side] = 'error: ' + String(err.message).split('\n')[0].slice(0, 140); }
  }
  let a, b, dumpError = null;
  try { a = await snapshot(A.page, 'A'); b = await snapshot(B.page, 'B'); }
  catch (err) { dumpError = String(err.message).slice(0, 200); }
  const identical = !dumpError && a === b;
  if (identical) identicalCount++;
  const row = { step: name, sideA: status.a, sideB: status.b, sameOutcome: status.a === status.b, identical };
  if (dumpError) row.dumpError = dumpError;
  else {
    row.aLength = a.length; row.bLength = b.length;
    row.aSha256 = createHash('sha256').update(a).digest('hex');
    row.bSha256 = createHash('sha256').update(b).digest('hex');
    if (!identical) {
      const off = [...a].findIndex((c, i) => c !== b[i]);
      row.firstDiffOffset = off;
      row.aContext = a.slice(Math.max(0, off - 100), off + 100);
      row.bContext = b.slice(Math.max(0, off - 100), off + 100);
    }
  }
  results.push(row);
  console.log(`${identical ? 'SAME' : 'DIFF'} ${name}${identical ? '' : `  (A ${row.aLength ?? '?'} / B ${row.bLength ?? '?'}${row.firstDiffOffset != null ? `, first divergence at ${row.firstDiffOffset}` : ''})`}`);
  if (!row.sameOutcome) console.log(`  NOTE step outcome differed: A=${status.a} B=${status.b}`);
}

await browser.close();

const total = results.length;
const outcomeMismatches = results.filter(r => r.sameOutcome === false).map(r => r.step);
// A step that fails on BOTH sides produces two identical dumps -- because neither
// side did anything. Counting that as parity is a false green: the first self-test
// run passed 34/34 while the five deck steps were silently no-ops. So executing
// every step is part of the verdict, not just agreeing about the result.
const failedSteps = results.filter(r => (r.sideA && r.sideA !== 'ok') || (r.sideB && r.sideB !== 'ok')).map(r => r.step);
const allIdentical = identicalCount === total && failedSteps.length === 0;
const report = {
  schemaVersion: 1, slice: 'S2', mode: opts.selfTest ? 'self-test' : 'interaction-parity',
  generatedAt: new Date().toISOString(),
  sources: { a: opts.a, b: opts.b }, theme: opts.theme,
  determinism: { dumpScope: '#dc-root', setTimeout: 'frozen', setInterval: 'frozen',
    requestAnimationFrame: 'frozen', animations: 'suppressed', media: 'blocked' },
  volatileMask: [],
  steps: total, identicalCount, allIdentical, outcomeMismatches, failedSteps, results,
};
mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
console.log(`\n${identicalCount}/${total} steps identical; mask entries ${report.volatileMask.length}`);
if (outcomeMismatches.length) console.log(`step-outcome mismatches: ${outcomeMismatches.join(', ')}`);
if (failedSteps.length) console.log(`steps that did not execute cleanly: ${failedSteps.join(', ')}`);
console.log(`Report: ${opts.out}; allIdentical=${allIdentical}`);
process.exit(allIdentical ? 0 : 1);
