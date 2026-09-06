#!/usr/bin/env node
// v2-network.mjs — the S2 "no engine" proof.
//
// Drives a build through all 18 screens x 2 themes and records every request the
// browser actually makes, plus console errors and page errors. Then asserts:
//
//   1. no React, ReactDOM, Babel or dc-runtime is ever loaded;
//   2. the served shell contains no <x-dc> and no data-dc-script;
//   3. zero console errors and zero failed requests.
//
// (1) has to be measured on real requests rather than by reading the page source:
// in pass 1 the page references none of the engine files — dc-runtime injects them
// itself at runtime (REACT_URL etc. at dc-runtime.js L1143-1147, injection L1826).
// Grepping index.html would therefore "prove" the engine was gone while it was
// still loading.
//
// (3) is a real tightening over pass 1, which emits four console errors by
// construction: dc-runtime parses the raw template before binding, so the browser
// requests /v2/%7B%7B%20A_videoUrl%20%7D%7D once per theme and rejects the unbound
// <polyline points="{{ a.trendPts }}">. A compiled render has no pre-bind DOM, so
// pass 2 must show none of it.
//
// Usage: node tools/v2-network.mjs --app <url> [--out <path>] [--expect-engine]
//        --expect-engine inverts the engine assertion, for characterising pass 1.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { SCREEN_MAP } from '../scripts/design-diff.mjs';

const MEDIA_RE = /\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i;
const ENGINE_RE = /(?:^|\/)(?:react|react-dom)(?:\.[\w.]+)?\.js|babel|dc-runtime/i;
const THEMES = ['dark', 'light'];

function parseArgs(argv) {
  const out = { app: null, out: 'docs/design/fleetdeck-v2/verify/S2/network.json', expectEngine: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') out.app = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--expect-engine') out.expectEngine = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (!out.app) throw new Error('--app <url> is required');
  return out;
}

async function reachScreen(page, screen) {
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  if (screen.view === 'app') {
    await page.getByRole('link', { name: 'App', exact: true }).click();
    await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
    if (screen.nav) await page.locator(`aside button[title="${screen.nav}"]`).click();
    if (screen.fullscreen) {
      await page.locator('[data-screen-label="Windows"]')
        .getByRole('button', { name: 'Fullscreen', exact: true }).first().click();
    }
  } else if (screen.view === 'deck') {
    await page.getByRole('link', { name: /^Deck\b/ }).click();
    await page.locator('[data-screen-label="01 Title"]').waitFor({ state: 'visible' });
    for (let i = 0; i < screen.slide; i++) await page.keyboard.press('ArrowRight');
  }
  await page.locator(`[data-screen-label="${screen.label}"]`).waitFor({ state: 'visible' });
}

const opts = parseArgs(process.argv.slice(2));
const browser = await chromium.launch();
const requests = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];   // genuine failures only
const blockedMedia = [];     // deliberately aborted by our own route handler
const blockedMediaConsole = []; // console noise caused by those deliberate aborts
const visited = [];
let shell = null;

for (const theme of THEMES) {
  for (const screen of SCREEN_MAP) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: theme,
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'UTC',
      serviceWorkers: 'block',
    });
    await context.addInitScript(t => {
      try { localStorage.setItem('fd-landing-dark', t === 'dark' ? '1' : '0'); } catch {}
    }, theme);
    const page = await context.newPage();
    // Block media exactly as scripts/design-diff.mjs does. Without this the video
    // fetch is still in flight when the context closes and every run reports a
    // spurious net::ERR_ABORTED that has nothing to do with the build.
    // Block real media FILES only, by URL extension -- deliberately not by
    // resourceType. A <video src="{{ A_videoUrl }}"> that never got bound is also
    // resourceType 'media', and that unbound request is precisely the pass-1
    // diagnostic this proof exists to detect. Blocking it would hide the evidence.
    await page.route(/\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i, route => route.abort());
    const tag = `${screen.id}/${theme}`;
    page.on('request', r => requests.push({ screen: tag, url: r.url(), type: r.resourceType() }));
    page.on('requestfailed', r => {
      const mediaFile = /\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i.test(r.url());
      const rec = { screen: tag, url: r.url(), error: r.failure()?.errorText ?? '' };
      if (mediaFile) blockedMedia.push(rec); else failedRequests.push(rec);
    });
    page.on('response', r => { if (r.status() >= 400) failedRequests.push({ screen: tag, url: r.url(), error: `HTTP ${r.status()}` }); });
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const text = m.text().slice(0, 300);
      // Our own route handler aborts real media files, and Chromium logs a console
      // error for each abort. Those are artefacts of the instrumentation, not of the
      // build, so they are recorded separately and excluded from the assertion.
      // Chromium logs this bare, URL-less message for every request our own route
      // handler aborts -- one per blocked media file. It is an artefact of the
      // instrumentation. Excluding it loses nothing: real resource failures are
      // recorded precisely, WITH their URL, in failedRequests below, and that list
      // is what the zeroFailedRequests check actually gates on.
      if (text === 'Failed to load resource: net::ERR_FAILED') {
        blockedMediaConsole.push({ screen: tag, text });
        return;
      }
      consoleErrors.push({ screen: tag, text });
    });
    page.on('pageerror', e => pageErrors.push({ screen: tag, text: String(e.message).split('\n')[0].slice(0, 300) }));

    const response = await page.goto(opts.app, { waitUntil: 'domcontentloaded' });
    if (shell === null) shell = await response.text();
    try {
      await reachScreen(page, screen);
      visited.push({ screen: screen.id, theme, reached: true });
    } catch (err) {
      visited.push({ screen: screen.id, theme, reached: false, error: String(err.message).split('\n')[0].slice(0, 200) });
    }
    await page.waitForTimeout(400);
    await context.close();
  }
}
await browser.close();

const engineLoads = requests.filter(r => ENGINE_RE.test(r.url));
const uniqueEngine = [...new Set(engineLoads.map(r => r.url))];
const shellHasXdc = /<x-dc[\s>]/i.test(shell ?? '');
const shellHasDcScript = /data-dc-script/i.test(shell ?? '');
const unreached = visited.filter(v => !v.reached);

const checks = {
  noEngineLoads: opts.expectEngine ? engineLoads.length > 0 : engineLoads.length === 0,
  shellHasNoXdc: !shellHasXdc,
  shellHasNoDcScript: !shellHasDcScript,
  zeroConsoleErrors: consoleErrors.length === 0,
  zeroPageErrors: pageErrors.length === 0,
  zeroFailedRequests: failedRequests.length === 0,
  allScreensReached: unreached.length === 0,
};
const allPass = Object.values(checks).every(Boolean);

const report = {
  schemaVersion: 1,
  slice: 'S2',
  generatedAt: new Date().toISOString(),
  source: opts.app,
  expectEngine: opts.expectEngine,
  screensVisited: visited.length,
  totalRequests: requests.length,
  shellSha256: shell === null ? null : createHash('sha256').update(shell).digest('hex'),
  shellHasXdc,
  shellHasDcScript,
  engineLoadCount: engineLoads.length,
  engineUrls: uniqueEngine,
  uniqueUrls: [...new Set(requests.map(r => r.url))].sort(),
  consoleErrors,
  pageErrors,
  failedRequests,
  blockedMediaCount: blockedMedia.length,
  blockedMediaConsoleCount: blockedMediaConsole.length,
  unreachedScreens: unreached,
  checks,
  allPass,
};

mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');

for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log(`engine loads: ${engineLoads.length}${uniqueEngine.length ? ' -> ' + uniqueEngine.join(', ') : ''}`);
console.log(`console errors: ${consoleErrors.length} | page errors: ${pageErrors.length} | failed requests: ${failedRequests.length} (media deliberately blocked: ${blockedMedia.length})`);
console.log(`console noise from deliberate media blocking, excluded: ${blockedMediaConsole.length}`);
console.log(`screens reached: ${visited.length - unreached.length}/${visited.length}`);
console.log(`Report: ${opts.out}; allPass=${allPass}`);
process.exit(allPass ? 0 : 1);
