#!/usr/bin/env node
/**
 * Fleetdeck design gate. Install: npm ci && npx playwright install --with-deps chromium
 * Run: npm run design:diff -- --baseline [--mock http://127.0.0.1:4173/mock.html]
 *      npm run design:diff -- --app <url|mock> --slice <id> [--mock <url>]
 * --app mock uses the same scratch mock server as --baseline (the S0 self-test).
 * Captures 18 screens x dark/light at 1440x900, deviceScaleFactor 1. Pixelmatch:
 * threshold 0.1, includeAA false; >0.5 percent mismatched pixels fails (exit 1).
 * The second baseline run compares every image to the previous baseline and
 * records maxMismatchPct; the stricter reproducibility target is <=0.05 percent.
 * Both sides receive IDENTICAL storage initialization, reduced motion, CSS that
 * disables animation/transition/caret and hides video/canvas, and media blocking.
 * Native reveals, fonts, visible images and a bounded fetch/XHR quiet period
 * settle before each shot; a vendored copy of a CDN asset is served in its place.
 * No global timer/time overrides, mock changes, application fixture changes or
 * screenshot masks. Live video is intentionally outside this visual contract.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, stat, realpath } from 'node:fs/promises';
import { dirname, resolve, join, relative, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = join(ROOT, 'docs/design/fleetdeck-v2');
const BASELINE = join(DESIGN, 'baseline');
const MOCK = join(DESIGN, 'mock');
const MOCK_FILE = 'Fleetdeck Final.dc.html';
const THEMES = ['dark', 'light'];
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const PIXELMATCH = Object.freeze({ threshold: 0.1, includeAA: false });
const LIMIT = 0.5;
const REPEAT_LIMIT = 0.05;
const TIMEOUT = 30_000;
const CSS = `*{animation:none!important;transition:none!important;caret-color:transparent!important}
*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
html{scroll-behavior:auto!important}video,canvas{visibility:hidden!important}
*:focus,*:focus-visible{outline:none!important}
*::-webkit-scrollbar{width:0!important;height:0!important}
*{scrollbar-width:none!important}`;

// A CDN can be unreachable, or can quietly serve different bytes on two runs.
// Where a vendored copy of a remote asset exists, both sides get that identical
// local file instead; where it does not, the request goes out as before.
const CDN_MIRROR = Object.freeze([
  { match: url => url.startsWith('https://fonts.googleapis.com/css2'), file: 'public/v2/vendor/inter.css', type: 'text/css' },
  { match: url => url.endsWith('/v2/vendor/fonts/inter-latin-v20.woff2'), file: 'public/v2/vendor/fonts/inter-latin-v20.woff2', type: 'font/woff2' },
  { match: url => url === 'https://unpkg.com/react@18.3.1/umd/react.production.min.js', file: 'public/v2/vendor/react.production.min.js', type: 'text/javascript' },
  { match: url => url === 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', file: 'public/v2/vendor/react-dom.production.min.js', type: 'text/javascript' },
  { match: url => url === 'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js', file: 'public/v2/vendor/babel.min.js', type: 'text/javascript' },
].map(Object.freeze));

// How long the page must go without a fetch/XHR before a shot, and how long we
// are willing to wait for that. A hung request costs one screen, not the run.
const QUIET_MS = 300;
const QUIET_CAP_MS = 5_000;

// Reusable navigation table: screen label -> the same real clicks on both sides.
export const SCREEN_MAP = Object.freeze([
  { id: 'landing', label: 'Landing', view: 'land', reach: 'Landing at scroll top' },
  { id: 'hero', label: 'Hero', view: 'land', reach: 'Landing; Hero section at top' },
  { id: 'capability', label: 'Capability', view: 'land', reach: 'Landing; scroll Capability section to top' },
  { id: 'fleetdeck-app', label: 'Fleetdeck app', view: 'app', reach: 'App link; default Message bus' },
  { id: 'windows', label: 'Windows', view: 'app', nav: 'Windows', reach: 'App link; Windows sidebar button' },
  { id: 'org-chart', label: 'Org chart', view: 'app', nav: 'Org chart', reach: 'App link; Org chart sidebar button' },
  { id: 'registry', label: 'Registry', view: 'app', nav: 'Registry', reach: 'App link; Registry sidebar button' },
  { id: 'message-bus', label: 'Message bus', view: 'app', nav: 'Message bus', reach: 'App link; Message bus sidebar button' },
  { id: 'ssh-keys', label: 'SSH keys', view: 'app', nav: 'SSH keys', reach: 'App link; SSH keys sidebar button' },
  { id: 'accounts', label: 'Accounts', view: 'app', nav: 'Accounts', reach: 'App link; Accounts sidebar button' },
  { id: 'machines', label: 'Machines', view: 'app', nav: 'Machines', reach: 'App link; Machines sidebar button' },
  { id: 'goals', label: 'Goals', view: 'app', nav: 'Goals', reach: 'App link; Goals sidebar button' },
  { id: 'docs', label: 'Docs', view: 'app', nav: 'Docs', reach: 'App link; Docs sidebar button' },
  { id: 'desktop-sessions', label: 'Desktop sessions', view: 'app', nav: 'Desktop sessions', reach: 'App link; Desktop sessions sidebar button' },
  { id: 'session-full-screen', label: 'Session full screen', view: 'app', nav: 'Windows', fullscreen: true, reach: 'App; Windows; first tile Fullscreen button' },
  { id: '01-title', label: '01 Title', view: 'deck', slide: 0, reach: 'Deck link; 0 ArrowRight presses' },
  { id: '02-problem', label: '02 Problem', view: 'deck', slide: 1, reach: 'Deck link; 1 ArrowRight press' },
  { id: '03-market', label: '03 Market', view: 'deck', slide: 2, reach: 'Deck link; 2 ArrowRight presses' },
  { id: '04-sales', label: '04 Sales', view: 'deck', slide: 3, reach: 'Deck link; 3 ArrowRight presses' },
  { id: '05-expansion', label: '05 Expansion', view: 'deck', slide: 4, reach: 'Deck link; 4 ArrowRight presses' },
].map(Object.freeze));

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--baseline', '--app', '--slice', '--mock', '--help'].includes(flag)) throw new Error(`Unknown flag: ${flag}`);
    const key = flag.slice(2);
    if (key in options) throw new Error(`Repeated flag: ${flag}`);
    if (key === 'baseline' || key === 'help') options[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      options[key] = value;
    }
  }
  if (options.help) {
    if (Object.keys(options).length !== 1) throw new Error('--help must be used alone');
    return options;
  }
  if (!!options.baseline === !!options.app) throw new Error('Choose exactly one of --baseline or --app <url|mock>');
  if (options.app && !options.slice) throw new Error('--app requires --slice <id>');
  if (options.baseline && options.slice) throw new Error('--slice is only valid with --app');
  if (options.slice && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(options.slice)) throw new Error('Slice must be 1-80 letters, digits, underscores or hyphens, starting with a letter or digit');
  for (const key of ['app', 'mock']) {
    if (!options[key] || (key === 'app' && options[key] === 'mock')) continue;
    const url = new URL(options[key]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`--${key} requires an HTTP(S) URL without credentials`);
    options[key] = url.href;
  }
  return options;
}

// Only exposes files whose real path is inside the mock directory, on loopback.
export async function serveMock() {
  const root = await realpath(MOCK);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css; charset=utf-8' };
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const candidate = resolve(root, '.' + (pathname === '/' ? '/' + MOCK_FILE : pathname));
      const file = await realpath(candidate);
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': data.length });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return {
    url: `http://127.0.0.1:${server.address().port}/${encodeURIComponent(MOCK_FILE)}`,
    close: () => new Promise((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); }),
  };
}

function initPage({ theme, css }) {
  localStorage.setItem('fd-landing-dark', theme === 'dark' ? '1' : '0');
  localStorage.setItem('fd-app-video', 'false');
  // Install on every document, including a real navigation triggered by an App link.
  const inject = () => {
    if (!document.documentElement) return;
    if (!document.getElementById('fd-design-diff-style')) {
      const style = document.createElement('style');
      style.id = 'fd-design-diff-style'; style.textContent = css;
      document.documentElement.appendChild(style);
    }
  };
  inject();
  document.addEventListener('DOMContentLoaded', inject, { once: true });
}

function isMedia(request) {
  return request.resourceType() === 'media' || /\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i.test(request.url());
}

// networkidle waits on every connection, so one live WebSocket or EventSource
// holds it open forever. This counts only fetch/XHR, and it is bounded.
function trackRequests(page) {
  const inFlight = new Set();
  let lastActivity = Date.now();
  const counted = request => ['fetch', 'xhr'].includes(request.resourceType());
  const started = request => { if (counted(request)) { inFlight.add(request); lastActivity = Date.now(); } };
  const ended = request => { if (inFlight.delete(request)) lastActivity = Date.now(); };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return async function quiet() {
    const deadline = Date.now() + QUIET_CAP_MS;
    while (inFlight.size || Date.now() - lastActivity < QUIET_MS) {
      if (Date.now() >= deadline) return false;
      await new Promise(done => setTimeout(done, 25));
    }
    return true;
  };
}

// A click leaves the button focused, and a focus ring is a real pixel difference
// whenever the two sides were reached by a different number of clicks.
const blur = page => page.evaluate(() => {
  const el = document.activeElement;
  if (el && typeof el.blur === 'function') el.blur();
});

async function reachScreen(page, screen) {
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  if (screen.view === 'app') {
    await page.getByRole('link', { name: 'App', exact: true }).click();
    await blur(page);
    await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
    if (screen.nav) { await page.locator(`aside button[title="${screen.nav}"]`).click(); await blur(page); }
    if (screen.fullscreen) { await page.locator('[data-screen-label="Windows"]').getByRole('button', { name: 'Fullscreen', exact: true }).first().click(); await blur(page); }
  } else if (screen.view === 'deck') {
    await page.getByRole('link', { name: /^Deck\b/ }).click();
    await blur(page);
    await page.locator('[data-screen-label="01 Title"]').waitFor({ state: 'visible' });
    for (let i = 0; i < screen.slide; i++) await page.keyboard.press('ArrowRight');
  }
  const target = page.locator(`[data-screen-label="${screen.label}"]`);
  await target.waitFor({ state: 'visible' });
  if (screen.view === 'land') await target.evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' }));
  await page.waitForFunction(label => {
    const el = document.querySelector(`[data-screen-label="${label}"]`);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height || box.top >= innerHeight || box.bottom <= 0) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) !== 1) return false;
    }
    return true;
  }, screen.label);
}

// Returns false when the bounded wait gave up rather than reaching quiet, so the
// caller can say so: a screenshot taken mid-load must not be reported as a plain
// pixel mismatch with no trace of why.
async function settle(page, quiet) {
  await page.mouse.move(0, 0);
  await blur(page);
  const quiesced = await quiet();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-reveal]')].every(el => {
    const r = el.getBoundingClientRect();
    // Match the native reveal controller's viewport band, without changing it.
    return !r.width || !r.height || r.top >= innerHeight * 0.92 || r.bottom <= innerHeight * 0.06 || el.dataset.shown === '1';
  }));
  await page.evaluate(async () => {
    if ([...document.fonts].some(font => font.status === 'error')) throw new Error('A font failed to load');
    const visible = el => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top >= innerHeight || rect.bottom <= 0 || rect.left >= innerWidth || rect.right <= 0) return false;
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    await Promise.all([...document.images].filter(visible).map(async img => {
      await img.decode();
      if (!img.complete || !img.naturalWidth) throw new Error(`Image did not load: ${img.currentSrc || img.src}`);
    }));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  return quiesced;
}

async function capture(browser, url, screen, theme) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  try {
    context.setDefaultTimeout(TIMEOUT);
    await context.addInitScript(initPage, { theme, css: CSS });
    await context.route('**/*', async route => {
      const request = route.request();
      if (isMedia(request)) return route.abort();
      const mirror = CDN_MIRROR.find(entry => entry.match(request.url()));
      const body = mirror && await readFile(join(ROOT, mirror.file)).catch(() => null);
      if (body) return route.fulfill({ status: 200, contentType: mirror.type, body });
      return route.continue();
    });
    const page = await context.newPage();
    const quiet = trackRequests(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => { if (!isMedia(request) && ['document', 'script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) errors.push(`Load failed: ${request.url()} (${request.failure()?.errorText})`); });
    page.on('response', response => { if (response.status() >= 400 && !isMedia(response.request()) && ['document', 'script', 'stylesheet', 'font', 'image'].includes(response.request().resourceType())) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`Document HTTP ${response?.status() ?? 'missing response'}`);
    await reachScreen(page, screen);
    const quiesced = await settle(page, quiet);
    const checkRuntime = async () => {
      const runtimeErrors = await page.locator('.sc-has-error, .sc-logic-error, .sc-placeholder-error').count();
      if (runtimeErrors) throw new Error(`Design runtime reported ${runtimeErrors} error marker(s)`);
      if (errors.length) throw new Error([...new Set(errors)].join('; '));
    };
    await checkRuntime();
    const image = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', caret: 'hide' });
    await checkRuntime();
    return { image, quiesced };
  } finally { await context.close(); }
}

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function png(buffer) {
  const result = PNG.sync.read(buffer);
  if (result.width !== VIEWPORT.width || result.height !== VIEWPORT.height) throw new Error(`Expected 1440x900 PNG; got ${result.width}x${result.height}`);
  return result;
}

export function comparePng(baselineBuffer, actualBuffer, limit = LIMIT) {
  const baseline = png(baselineBuffer), actual = png(actualBuffer);
  const diff = new PNG({ ...VIEWPORT });
  const mismatchPixels = pixelmatch(baseline.data, actual.data, diff.data, VIEWPORT.width, VIEWPORT.height, PIXELMATCH);
  const mismatchPct = mismatchPixels / (VIEWPORT.width * VIEWPORT.height) * 100;
  return { mismatchPixels, mismatchPct, pass: mismatchPct <= limit, diff: PNG.sync.write(diff) };
}

async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function writeReport(directory, report) {
  const temporary = join(directory, `.report-${process.pid}.json`);
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
  await rename(temporary, join(directory, 'report.json'));
}

// Publish complete directories, keeping the old one intact if capture failed.
async function publish(staging, destination) {
  const backup = destination + `.previous-${process.pid}`;
  const hadDestination = await exists(destination);
  if (hadDestination) await rename(destination, backup);
  try { await rename(staging, destination); }
  catch (error) { if (hadDestination) await rename(backup, destination); throw error; }
  if (hadDestination) await rm(backup, { recursive: true });
}

export async function run(options) {
  let server, browser, staging, report;
  const baselineMode = !!options.baseline;
  const destination = baselineMode ? BASELINE : join(DESIGN, 'verify', options.slice);
  const failureDirectory = baselineMode ? join(DESIGN, 'verify', 'baseline-failed') : destination;
  try {
    report = { schemaVersion: 1, mode: baselineMode ? 'baseline' : 'verify', slice: options.slice ?? null, capturedAt: new Date().toISOString(), status: 'running', results: [], allPass: false };
    await mkdir(failureDirectory, { recursive: true });
    await writeReport(failureDirectory, report);
    let url = options.app;
    if (baselineMode || options.app === 'mock') {
      if (options.mock) url = options.mock;
      else { server = await serveMock(); url = server.url; }
    }
    await mkdir(dirname(destination), { recursive: true });
    staging = await mkdtemp(join(dirname(destination), '.design-diff-'));
    browser = await chromium.launch();
    const require = createRequire(import.meta.url);
    const previous = baselineMode && await exists(BASELINE);
    report = {
      schemaVersion: 1, mode: baselineMode ? 'baseline' : 'verify', slice: options.slice ?? null, status: 'running',
      capturedAt: new Date().toISOString(), source: server ? 'built-in mock server' : url,
      viewport: VIEWPORT, deviceScaleFactor: 1, pixelmatch: PIXELMATCH, thresholdPct: baselineMode && previous ? REPEAT_LIMIT : LIMIT,
      environment: { platform: process.platform, arch: process.arch, node: process.version, playwright: require('playwright/package.json').version, chromium: browser.version() },
      determinism: { initScriptSha256: sha256(initPage.toString()), cssSha256: sha256(CSS), reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', mediaRequests: 'blocked', videoCanvas: 'hidden', storage: { 'fd-landing-dark': '1 dark / 0 light', 'fd-app-video': 'false' } },
      previousBaselineCompared: previous, results: [], allPass: false,
    };
    for (const screen of SCREEN_MAP) for (const theme of THEMES) {
      const filename = `${screen.id}-${theme}.png`;
      const result = { screen: screen.id, label: screen.label, theme, mismatchPct: null, pass: false };
      try {
        const { image: actual, quiesced } = await capture(browser, url, screen, theme);
        // A screen that never went quiet is still compared, but it is never allowed
        // to look like an ordinary result: the reason a diff exists must be visible.
        if (!quiesced) result.settleTimedOut = true;
        png(actual);
        await writeFile(join(staging, filename), actual);
        result.sha256 = sha256(actual);
        if (!baselineMode || previous) {
          const baseline = await readFile(join(BASELINE, filename));
          result.baselineSha256 = sha256(baseline);
          const { diff, ...comparison } = comparePng(baseline, actual, baselineMode ? REPEAT_LIMIT : LIMIT);
          Object.assign(result, comparison);
          if (!baselineMode) await writeFile(join(staging, `${screen.id}-${theme}.diff.png`), diff);
        } else { result.pass = true; result.captured = true; }
      } catch (error) {
        result.skipped = true;
        result.reason = error.message;
      }
      report.results.push(result);
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${screen.id} ${theme}: ${result.mismatchPct === null ? result.reason || 'captured (no previous baseline)' : result.mismatchPct.toFixed(6) + '%'}`);
    }
    report.allPass = report.results.length === SCREEN_MAP.length * THEMES.length && report.results.every(result => result.pass && !result.skipped);
    report.status = 'complete';
    const measured = report.results.filter(result => result.mismatchPct !== null).map(result => result.mismatchPct);
    report.maxMismatchPct = measured.length ? Math.max(...measured) : null;
    if (previous) report.reproducibility = { thresholdPct: REPEAT_LIMIT, compared: measured.length, maxMismatchPct: report.maxMismatchPct, allPass: report.allPass };
    await writeReport(staging, report);
    if (baselineMode && !report.allPass) {
      const failure = join(DESIGN, 'verify', 'baseline-failed');
      await mkdir(dirname(failure), { recursive: true });
      await publish(staging, failure); staging = null;
      console.error(`Baseline preserved. Failure report: ${relative(ROOT, join(failure, 'report.json'))}`);
    } else {
      await publish(staging, destination); staging = null;
      if (baselineMode) await rm(failureDirectory, { recursive: true, force: true });
      console.log(`Report: ${relative(ROOT, join(destination, 'report.json'))}; allPass=${report.allPass}; maxMismatchPct=${report.maxMismatchPct}`);
    }
    return report;
  } catch (error) {
    // A failed browser launch/server setup must not leave a previous green
    // verification report masquerading as the result of this invocation.
    report ??= { schemaVersion: 1, mode: baselineMode ? 'baseline' : 'verify', slice: options.slice ?? null, capturedAt: new Date().toISOString(), results: [] };
    report.allPass = false;
    report.status = 'failed';
    report.fatalError = error.message;
    for (const screen of SCREEN_MAP) for (const theme of THEMES) {
      if (!report.results.some(result => result.screen === screen.id && result.theme === theme)) {
        report.results.push({ screen: screen.id, label: screen.label, theme, mismatchPct: null, pass: false, skipped: true, reason: `Run failed: ${error.message}` });
      }
    }
    const failure = failureDirectory;
    await mkdir(dirname(failure), { recursive: true });
    staging ??= await mkdtemp(join(dirname(failure), '.design-diff-'));
    await writeReport(staging, report);
    await publish(staging, failure); staging = null;
    console.error(`Run failed: ${error.message}\nFailure report: ${relative(ROOT, join(failure, 'report.json'))}`);
    return report;
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message + '\nUse --help for usage.'); process.exitCode = 2; return; }
  if (options.help) {
    console.log('Fleetdeck design gate\n\nInstall: npm ci && npx playwright install --with-deps chromium\n\n  npm run design:diff -- --baseline [--mock <url>]\n  npm run design:diff -- --app <url|mock> --slice <id> [--mock <url>]\n\n36 screenshots: 18 screens x dark/light, 1440x900, scale 1.\nPixelmatch threshold 0.1, includeAA false; mismatch >0.5% exits 1.\nSecond baseline compares to previous at <=0.05%. Invalid flags exit 2.\n--app mock uses the built-in mock server; --mock overrides that server URL.\nBoth sides: identical localStorage, reduced motion, animation/transition/caret suppression, hidden video/canvas and blocked media; native reveals, fonts/images and network idle settle.');
    return;
  }
  const report = await run(options);
  process.exitCode = report.allPass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
