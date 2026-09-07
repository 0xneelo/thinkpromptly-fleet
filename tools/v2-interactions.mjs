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
  // Five real keystrokes, one at a time -- not fill(). setDraft re-renders per character.
  ['bus-compose-clear',    p => p.locator('[data-screen-label="Message bus"] textarea').first().fill('')],
  ['bus-keystrokes',       async p => {
    const ta = p.locator('[data-screen-label="Message bus"] textarea').first();
    await ta.click();
    await p.keyboard.type('abcde', { delay: 15 });
  }, probeComposer],
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
// The freeze is the reason the volatile mask can be empty, so it is asserted rather
// than trusted -- v2-parity.mjs does the same. Without the init script these counters
// come back non-zero; with it they are all 0 and the suppression style is present.
async function assertFrozen(page, where) {
  const state = await page.evaluate(() => ({
    setTimeout: setTimeout(() => {}, 0),
    setInterval: setInterval(() => {}, 0),
    requestAnimationFrame: requestAnimationFrame(() => {}),
  }));
  const live = ['setTimeout', 'setInterval', 'requestAnimationFrame'].filter(k => state[k] !== 0);
  if (live.length) throw new Error(`Determinism freeze did not land on ${where} (live: ${live.join(', ')})`);
}

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
  // Match v2-parity.mjs's isMedia exactly: resourceType OR extension. Extension alone
  // would let a blob:, query-stringed or unbound-template media URL through, and a real
  // async fetch outside the frozen-timer model is precisely the nondeterminism the empty
  // volatile mask assumes cannot happen. The 'video-toggle' step exercises this surface.
  await context.route('**/*', route => {
    const r = route.request();
    const media = r.resourceType() === 'media' || /\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i.test(r.url());
    return media ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await assertFrozen(page, url);
  return { context, page, url };
}

// Both strings indexed as UTF-16 code units. The previous spread-based version indexed
// A by code point and B by code unit, so a surrogate pair before the divergence pushed
// the reported offset out of step. Diagnostics only -- the verdict is a plain a === b.
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

// Focus and caret are DOM state that a normalized-DOM dump cannot see: the markup is
// identical whether or not the textarea kept focus and whether the caret sits at 0 or 5.
// logic.js's setDraft calls setState on EVERY keystroke, so each character re-renders the
// composer. If the reconciler replaced the node instead of reusing it, focus and caret
// would be lost and typing would be unusable -- silently, with DOM parity still green.
// This is the seam the nine L2-L10 slices will hit hardest, so it is probed explicitly.
async function probeComposer(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const ta = document.querySelector('[data-screen-label="Message bus"] textarea');
    return {
      focusedTag: el ? el.tagName : null,
      focusIsComposer: !!ta && el === ta,
      selectionStart: ta && typeof ta.selectionStart === 'number' ? ta.selectionStart : null,
      selectionEnd: ta && typeof ta.selectionEnd === 'number' ? ta.selectionEnd : null,
      value: ta ? ta.value : null,
    };
  });
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
    firstDiffOffset: identical ? null : firstDiff(a, b) });
}

for (const [name, action, probe] of STEPS) {
  const status = {};
  for (const [side, ctx] of [['a', A], ['b', B]]) {
    try { await action(ctx.page, ctx.url); status[side] = 'ok'; }
    catch (err) { status[side] = 'error: ' + String(err.message).split('\n')[0].slice(0, 140); }
  }
  let a, b, dumpError = null;
  try { a = await snapshot(A.page, 'A'); b = await snapshot(B.page, 'B'); }
  catch (err) { dumpError = String(err.message).slice(0, 200); }
  const identical = !dumpError && a === b;
  let probeA = null, probeB = null, probeMatch = null, probeOk = null;
  if (probe && !dumpError) {
    probeA = await probe(A.page);
    probeB = await probe(B.page);
    probeMatch = JSON.stringify(probeA) === JSON.stringify(probeB);
    // Both sides must agree AND the composer must actually have kept focus with the
    // caret after all five characters. Agreeing that focus was lost is not a pass.
    probeOk = probeMatch && probeA.focusIsComposer === true
      && probeA.selectionStart === 5 && probeA.selectionEnd === 5 && probeA.value === 'abcde';
  }
  const row = { step: name, sideA: status.a, sideB: status.b, sameOutcome: status.a === status.b, identical };
  if (probe) {
    row.probeA = probeA; row.probeB = probeB; row.probeMatch = probeMatch; row.probeOk = probeOk;
    if (!probeOk) row.identical = false;
  }
  if (dumpError) row.dumpError = dumpError;
  else {
    row.aLength = a.length; row.bLength = b.length;
    row.aSha256 = createHash('sha256').update(a).digest('hex');
    row.bSha256 = createHash('sha256').update(b).digest('hex');
    if (!identical) {
      const off = firstDiff(a, b);
      row.firstDiffOffset = off;
      row.aContext = a.slice(Math.max(0, off - 100), off + 100);
      row.bContext = b.slice(Math.max(0, off - 100), off + 100);
    }
  }
  if (row.identical) identicalCount++;
  results.push(row);
  if (probe) {
    console.log(`  probe ${name}: focusIsComposer=${probeA && probeA.focusIsComposer} caret=${probeA && probeA.selectionStart}/${probeA && probeA.selectionEnd} value=${JSON.stringify(probeA && probeA.value)} bothSidesAgree=${probeMatch}`);
  }
  console.log(`${row.identical ? 'SAME' : 'DIFF'} ${name}${identical ? '' : `  (A ${row.aLength ?? '?'} / B ${row.bLength ?? '?'}${row.firstDiffOffset != null ? `, first divergence at ${row.firstDiffOffset}` : ''})`}`);
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
const probeFailures = results.filter(r => r.probeOk === false).map(r => r.step);
// A probe failure already forces row.identical false, so it cannot reach total --
// but state it explicitly so the verdict reads as what it is.
const allIdentical = identicalCount === total && failedSteps.length === 0 && probeFailures.length === 0;
const report = {
  schemaVersion: 1, slice: 'S2', mode: opts.selfTest ? 'self-test' : 'interaction-parity',
  generatedAt: new Date().toISOString(),
  sources: { a: opts.a, b: opts.b }, theme: opts.theme,
  determinism: { dumpScope: '#dc-root', setTimeout: 'frozen', setInterval: 'frozen',
    requestAnimationFrame: 'frozen', animations: 'suppressed', media: 'blocked' },
  volatileMask: [],
  steps: total, identicalCount, allIdentical, outcomeMismatches, failedSteps, probeFailures, results,
};
mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
console.log(`\n${identicalCount}/${total} steps identical; mask entries ${report.volatileMask.length}`);
if (outcomeMismatches.length) console.log(`step-outcome mismatches: ${outcomeMismatches.join(', ')}`);
if (failedSteps.length) console.log(`steps that did not execute cleanly: ${failedSteps.join(', ')}`);
if (probeFailures.length) console.log(`focus/caret probe failures: ${probeFailures.join(', ')}`);
console.log(`Report: ${opts.out}; allIdentical=${allIdentical}`);
process.exit(allIdentical ? 0 : 1);
