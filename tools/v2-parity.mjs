#!/usr/bin/env node
/**
 * Fleetdeck v2 slice S2 — normalized-DOM parity gate (F2 precedent:
 * docs/design/fleetdeck-v2/precedent/f2-parity.mjs; contract: S2-runtime-spec.md).
 *
 *   PORT=3199 node server.js &
 *   node tools/v2-parity.mjs [--port 3199] [--a <url>] [--b <url>]
 *                            [--only <screen>] [--theme dark|light] [--self-test]
 *
 * For each of 18 screens x dark/light it drives both builds through the SAME real
 * clicks as scripts/design-diff.mjs (SCREEN_MAP mirrored verbatim), dumps the live
 * #dc-root subtree (see dumpScreen for why the head is out of scope), normalizes it
 * and asserts the two strings are byte-identical:
 *   side A  /v2/pass1/index.html  — the dc-runtime render
 *   side B  /v2/index.html        — the compiled render (--self-test points B at A)
 *
 * Both sides are frozen SYMMETRICALLY before any page script runs: setTimeout,
 * setInterval and requestAnimationFrame are no-ops, animation/transition are off and
 * media requests are blocked. Per S2-runtime-spec.md section 12 the only volatile
 * machinery in our logic is timer-driven (reveal ticker, video-setup poll, message
 * delivered/acked transitions, deck auto-advance) plus Date.now() inside interaction
 * handlers we never fire — with the timers dead, both sides show the same pre-timer
 * state and nothing needs masking. The script never starts a server; it takes URLs.
 */
import { createHash } from 'node:crypto';
import { writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/design/fleetdeck-v2/verify/S2');
const THEMES = ['dark', 'light'];
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const TIMEOUT = 30_000;
const CONTEXT_CHARS = 200; // divergence context printed from each side
const SENTINEL = 'fd-v2-parity-style'; // id of the injected suppression sheet, also the freeze sentinel
const CSS = '*,*::before,*::after{animation:none!important;transition:none!important}';

// n4 — THE VOLATILE MASK. Applied last, to both sides, after every structural
// normalization. Every entry must name the non-deterministic source it excuses
// (a Date.now()-derived id, a live clock) and nothing else. An empty mask is the
// goal: with timers frozen there is no clock left to drift. Keep it that way.
const VOLATILE_MASK = Object.freeze([]);

// Mirrors scripts/design-diff.mjs SCREEN_MAP so both gates drive the app identically.
const SCREEN_MAP = Object.freeze([
  { id: 'landing', label: 'Landing', view: 'land' },
  { id: 'hero', label: 'Hero', view: 'land' },
  { id: 'capability', label: 'Capability', view: 'land' },
  { id: 'fleetdeck-app', label: 'Fleetdeck app', view: 'app' },
  { id: 'windows', label: 'Windows', view: 'app', nav: 'Windows' },
  { id: 'org-chart', label: 'Org chart', view: 'app', nav: 'Org chart' },
  { id: 'registry', label: 'Registry', view: 'app', nav: 'Registry' },
  { id: 'message-bus', label: 'Message bus', view: 'app', nav: 'Message bus' },
  { id: 'ssh-keys', label: 'SSH keys', view: 'app', nav: 'SSH keys' },
  { id: 'accounts', label: 'Accounts', view: 'app', nav: 'Accounts' },
  { id: 'machines', label: 'Machines', view: 'app', nav: 'Machines' },
  { id: 'desktop-sessions', label: 'Desktop sessions', view: 'app', nav: 'Desktop sessions' },
  { id: 'session-full-screen', label: 'Session full screen', view: 'app', nav: 'Windows', fullscreen: true },
  { id: '01-title', label: '01 Title', view: 'deck', slide: 0 },
  { id: '02-problem', label: '02 Problem', view: 'deck', slide: 1 },
  { id: '03-market', label: '03 Market', view: 'deck', slide: 2 },
  { id: '04-sales', label: '04 Sales', view: 'deck', slide: 3 },
  { id: '05-expansion', label: '05 Expansion', view: 'deck', slide: 4 },
].map(Object.freeze));

export function parseArgs(args) {
  const options = { port: '3199' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--port', '--a', '--b', '--only', '--theme', '--self-test', '--help'].includes(flag)) throw new Error(`Unknown flag: ${flag}`);
    const key = flag.slice(2);
    if (key === 'self-test' || key === 'help') { options[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[key] = value;
  }
  if (options.help) return options;
  if (!/^\d{1,5}$/.test(options.port)) throw new Error('--port must be a port number');
  if (options.theme && !THEMES.includes(options.theme)) throw new Error('--theme must be dark or light');
  if (options.only && !SCREEN_MAP.some(screen => screen.id === options.only)) throw new Error(`--only must be one of: ${SCREEN_MAP.map(s => s.id).join(', ')}`);
  options.a ??= `http://127.0.0.1:${options.port}/v2/pass1/index.html`;
  options.b = options['self-test'] ? options.a : options.b ?? `http://127.0.0.1:${options.port}/v2/index.html`;
  for (const key of ['a', 'b']) {
    const url = new URL(options[key]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`--${key} requires an HTTP(S) URL without credentials`);
    options[key] = url.href;
  }
  return options;
}

// Runs before any page script, on both sides. Freezing setTimeout matters as much as
// setInterval: the video-setup poll (200 ms) and the message delivered/acked
// transitions are setTimeout-driven, so a one-sided freeze would compare a pre-timer
// render against a post-timer one.
function initPage({ theme, css, sentinel }) {
  localStorage.setItem('fd-landing-dark', theme === 'dark' ? '1' : '0');
  localStorage.setItem('fd-app-video', 'false');
  window.setInterval = () => 0;
  window.setTimeout = () => 0;
  window.requestAnimationFrame = () => 0;
  const inject = () => {
    if (!document.head || document.getElementById(sentinel)) return;
    const style = document.createElement('style');
    style.id = sentinel;
    style.textContent = css;
    document.head.appendChild(style);
  };
  inject();
  document.addEventListener('DOMContentLoaded', inject, { once: true });
}

// The freeze is the whole basis for an empty mask, so prove it landed rather than
// assume it: real timer ids are non-zero, and the suppression sheet must be in head.
// Negative control (run against this page without initPage): 4 / 5 / 2 and no style —
// so this assertion does fire when the freeze is missing.
async function assertFrozen(page) {
  const state = await page.evaluate(id => ({
    setTimeout: setTimeout(() => {}, 0),
    setInterval: setInterval(() => {}, 0),
    requestAnimationFrame: requestAnimationFrame(() => {}),
    style: !!document.getElementById(id),
  }), SENTINEL);
  const broken = ['setTimeout', 'setInterval', 'requestAnimationFrame'].filter(key => state[key] !== 0);
  if (broken.length || !state.style) throw new Error(`Determinism freeze did not land (live: ${broken.join(', ') || 'none'}${state.style ? '' : '; suppression style missing'})`);
}

function isMedia(request) {
  return request.resourceType() === 'media' || /\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i.test(request.url());
}

// Mirrors scripts/design-diff.mjs reachScreen: the same clicks, the same readiness gate.
async function reachScreen(page, screen) {
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  if (screen.view === 'app') {
    await page.getByRole('link', { name: 'App', exact: true }).click();
    await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
    if (screen.nav) await page.locator(`aside button[title="${screen.nav}"]`).click();
    if (screen.fullscreen) await page.locator('[data-screen-label="Windows"]').getByRole('button', { name: 'Fullscreen', exact: true }).first().click();
  } else if (screen.view === 'deck') {
    await page.getByRole('link', { name: /^Deck\b/ }).click();
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

// design-diff.mjs settle, minus its closing double requestAnimationFrame: rAF is frozen
// here, and that wait was a paint barrier for the screenshot, not a DOM condition.
async function settle(page) {
  await page.mouse.move(0, 0);
  await page.waitForLoadState('networkidle');
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
  });
}

/**
 * Drives one screen on one side and returns the raw #dc-root subtree.
 *
 * SCOPE — deliberate, not a loosening (coordinator ruling, S2): the dump is the
 * #dc-root subtree, NOT the document. dc-runtime injects several stylesheets into
 * <head> at runtime (BASE_CSS, x-dc{display:none}, the CSSOM-only pseudo sheet,
 * FULL_PAGE_CSS); S2 exists to delete that engine, so a document-scoped comparison
 * would demand side B reproduce exactly the scaffolding the slice removes — the gate
 * would forbid its own deliverable. Head styling is still proven, by the pixel gate
 * (scripts/design-diff.mjs, all 36 screens at 0.5 %), which is a stronger check on
 * visual output than string equality. DOM parity's job is structure.
 *
 * Taking the subtree from the live DOM also removes the F2 tail-anchor hazard at the
 * source instead of asserting around it (precedent f2-parity.mjs n1).
 */
export async function dumpScreen(browser, url, screen, theme) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  try {
    context.setDefaultTimeout(TIMEOUT);
    await context.addInitScript(initPage, { theme, css: CSS, sentinel: SENTINEL });
    await context.route('**/*', route => isMedia(route.request()) ? route.abort() : route.continue());
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`Document HTTP ${response?.status() ?? 'missing response'}`);
    await assertFrozen(page);
    await reachScreen(page, screen);
    await settle(page);
    await assertFrozen(page);
    return await page.evaluate(() => document.querySelector('#dc-root')?.outerHTML ?? null);
  } finally { await context.close(); }
}

/**
 * n3 -> n2 -> n4, in that order, on a #dc-root subtree from dumpScreen().
 * n3 still runs FIRST: a script's raw text can contain any substring, and stripping it
 * before anything else scans the markup is what kept the F2 precedent honest (its
 * reviewer reproduced a corruption when the order was reversed).
 * n2 (data-dc-tpl) is the editor instrumentation dc-runtime stamps and the compiler
 * never emits; stripping it on both sides is what makes the two sides comparable.
 */
// n5 — CANONICAL ATTRIBUTE ORDER.
//
// Sorts each element's attributes by name before comparing. This is an
// order-insensitivity normalization, NOT a mask: the full attribute SET and every
// VALUE is still compared byte for byte. Only the sequence is neutralised, and
// attribute order carries no semantic or visual meaning in HTML -- the CSSOM, the
// layout and the pixel gate are all blind to it.
//
// It is needed because pass 1's order is not even a property of the template. React
// sets attributes in prop order at render, and then the logic mutates nodes
// imperatively afterwards: LandLogic.setupVideo assigns video.src post-mount, which
// lands the attribute wherever insertion order happens to put it. Pass 1 serialises
// the hero video as (preload, src, playsinline, style); the compiled build produces
// (playsinline, preload, src, style) -- same attributes, same values, same total
// byte length, different sequence. Demanding the compiler reproduce an ordering that
// is an artefact of React's internal prop iteration plus a post-mount side effect
// would be fidelity theatre, not fidelity.
//
// This goes beyond the pack's "n1-n3 + volatile mask" wording, so it is declared
// here, recorded in parity.json as normalizations[], and called out in REPORT.md
// rather than buried.
const ATTR_RE = /([^\s=/>]+)(?:=("[^"]*"|'[^']*'|[^\s>]+))?/g;
const TAG_RE = /<([a-zA-Z][^\s/>]*)((?:\s+[^\s=/>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)+)(\s*\/?)>/g;
function canonicalAttrOrder(html) {
  return html.replace(TAG_RE, (whole, tag, attrs, tail) => {
    const pairs = [];
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(attrs)) !== null) pairs.push(m[2] === undefined ? m[1] : `${m[1]}=${m[2]}`);
    if (pairs.length < 2) return whole;
    pairs.sort();
    return `<${tag} ${pairs.join(' ')}${tail}>`;
  });
}

export function normalizeDump(html, side) {
  const at = message => `${side}: ${message}`;
  if (!html) throw new Error(at('#dc-root not found — did the runtime mount?'));
  let s = html.replace(/<script[\s\S]*?<\/script>/g, '');                            // n3
  if (!s.startsWith('<div id="dc-root"')) throw new Error(at(`dump is not a #dc-root subtree: ${JSON.stringify(s.slice(0, 80))}`));
  s = s.replace(/ data-dc-tpl="\d+"/g, '').replace(/\n\s*\n/g, '\n');                // n2
  s = canonicalAttrOrder(s);                                                          // n5
  for (const entry of VOLATILE_MASK) s = s.replace(entry.pattern, entry.replacement); // n4
  return s;
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
const firstDiff = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i === a.length && i === b.length ? null : i;
};

export async function run(options) {
  const screens = SCREEN_MAP.filter(screen => !options.only || screen.id === options.only);
  const themes = THEMES.filter(theme => !options.theme || theme === options.theme);
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    mode: options['self-test'] ? 'self-test' : 'parity',
    sources: { a: options.a, b: options.b },
    // dumpScope: the #dc-root subtree only — <head> is out of scope on purpose; see
    // dumpScreen(). The pixel gate covers head styling across all 36 screens.
    determinism: { dumpScope: '#dc-root', setTimeout: 'frozen', setInterval: 'frozen', requestAnimationFrame: 'frozen', animations: 'suppressed', media: 'blocked', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', viewport: VIEWPORT },
    volatileMask: VOLATILE_MASK.map(entry => ({ pattern: String(entry.pattern), why: entry.why })),
    normalizations: [
      { step: 'n3', what: 'strip <script> blocks (first, before any structural work)' },
      { step: 'n2', what: 'strip data-dc-tpl="N" and collapse blank lines' },
      { step: 'n5', what: 'canonical attribute order; full attribute set and values still compared' },
      { step: 'n4', what: 'volatile mask (empty)' },
    ],
    filter: { only: options.only ?? null, theme: options.theme ?? null },
    results: [],
    identicalCount: 0,
    total: screens.length * themes.length,
    allIdentical: false,
  };
  const browser = await chromium.launch();
  try {
    for (const screen of screens) for (const theme of themes) {
      const result = { screen: screen.id, label: screen.label, theme, identical: false, aLength: null, bLength: null, firstDiffOffset: null, aSha256: null, bSha256: null };
      let a, b;
      try {
        a = normalizeDump(await dumpScreen(browser, options.a, screen, theme), 'A (pass1)');
        b = normalizeDump(await dumpScreen(browser, options.b, screen, theme), 'B (compiled)');
        Object.assign(result, { aLength: a.length, bLength: b.length, aSha256: sha256(a), bSha256: sha256(b) });
        result.firstDiffOffset = firstDiff(a, b);
        result.identical = result.firstDiffOffset === null;
      } catch (error) {
        result.error = error.message;
      }
      if (result.identical) report.identicalCount++;
      report.results.push(result);
      console.log(`${result.identical ? 'SAME' : 'DIFF'} ${screen.id} ${theme}: ${result.error ?? (result.identical ? `${a.length} bytes` : `first divergence at offset ${result.firstDiffOffset} (A ${a.length} / B ${b.length} bytes)`)}`);
      if (!result.identical && !result.error) {
        const from = Math.max(0, result.firstDiffOffset - CONTEXT_CHARS / 2);
        console.error(`  A: ...${JSON.stringify(a.slice(from, result.firstDiffOffset + CONTEXT_CHARS))}...`);
        console.error(`  B: ...${JSON.stringify(b.slice(from, result.firstDiffOffset + CONTEXT_CHARS))}...`);
      }
    }
  } finally { await browser.close(); }
  report.allIdentical = report.results.length === report.total && report.identicalCount === report.total;
  report.finishedAt = new Date().toISOString();
  await mkdir(OUT, { recursive: true });
  const temporary = join(OUT, `.parity-${process.pid}.json`);
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
  await rename(temporary, join(OUT, 'parity.json'));
  console.log(`${report.identicalCount}/${report.total} identical; mask entries ${VOLATILE_MASK.length}; report: ${relative(ROOT, join(OUT, 'parity.json'))}`);
  return report;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message + '\nUse --help for usage.'); process.exitCode = 2; return; }
  if (options.help) {
    console.log('Fleetdeck v2 S2 normalized-DOM parity gate\n\n  node tools/v2-parity.mjs [--port 3199] [--a <url>] [--b <url>] [--only <screen>] [--theme dark|light] [--self-test]\n\nStart the server yourself: PORT=3199 node server.js\nA defaults to /v2/pass1/index.html, B to /v2/index.html; --self-test points B at A\n(two independent pass-1 renders, which must be 36/36). Exits 0 only when every\ncompared combination is byte-identical, 1 otherwise, 2 on bad flags.');
    return;
  }
  const report = await run(options);
  process.exitCode = report.allIdentical ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
