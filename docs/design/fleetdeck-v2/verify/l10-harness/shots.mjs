#!/usr/bin/env node
// fd-v2 L10 — the improvisation screenshots.
//
//   node docs/design/fleetdeck-v2/verify/l10-harness/shots.mjs [--url http://127.0.0.1:4178]
//
// Writes the seven PNGs that docs/design/fleetdeck-v2/improvised.md's L10 entries
// point at, into docs/design/fleetdeck-v2/improvised/. Each shot is scoped to the
// smallest element (or the smallest clip across two elements) that makes its entry's
// claim legible, so a reader sees the improvisation and not the whole screen.
//
// Everything about reaching the screen — the seed script, the data-layer shim, the
// route order workaround, the navigation — is live.mjs's, reused verbatim; see that
// file's header for why each piece exists. Only the capturing below is new. Dark
// theme, 1440x900, scale 1, reduced motion, and design-diff.mjs's animation/caret
// suppression CSS, so the images are stable between runs.
//
// NOTE on l10-filters.png: a native <select> popup is drawn by the OS, not the page,
// so Playwright cannot capture an open dropdown. improvised.md's I-L10-01 claim is
// therefore shown the documented other way — all four selects carry a live-derived
// selection that the mock's hard-coded option lists do not contain.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, states, materialise, transcriptText } from './stub.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = flag('--url', 'http://127.0.0.1:4178').replace(/\/+$/, '');
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '../../improvised');
const VIEWPORT = { width: 1440, height: 900 };
const SCREEN = '[data-screen-label="Desktop sessions"]';
const ROW = '[data-fd-l10-row]';
// scripts/design-diff.mjs:38 — the same suppression both sides of the pixel gate use.
const CSS = `*{animation:none!important;transition:none!important;caret-color:transparent!important}
*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
html{scroll-behavior:auto!important}video,canvas{visibility:hidden!important}`;

// -- page setup (live.mjs) ----------------------------------------------------

async function shimDataLayer(page) {
  const MARK = '<script src="/v2/runtime.js"></script>';
  await page.route('**/v2/index.html', async (route) => {
    const res = await route.fetch();
    const html = await res.text();
    if (!html.includes(MARK)) throw new Error('index.html no longer loads runtime.js — the data-layer shim needs rewriting');
    await route.fulfill({ response: res, body: html.replace(MARK, `<script src="/v2/data.js"></script>${MARK}`) });
  });
}

function seed(dark) {
  return `
    try { localStorage.setItem('fd-landing-dark', '${dark ? 1 : 0}'); } catch (e) {}
    try { localStorage.setItem('fd-app-video', '0'); } catch (e) {}
    try { localStorage.removeItem('fd-fixture'); } catch (e) {}
    window.__fdBus = [];
    window.FD = window.FD || {};
    window.FD.screens = window.FD.screens || {};
    window.FD.screens.bus = window.FD.screens.bus || {};
    window.FD.screens.bus.open = function (target) { window.__fdBus.push(target); };
  `;
}

async function openScreen(browser, { stub = {} } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(seed(true));
  const page = await context.newPage();
  await shimDataLayer(page);
  await install(page, stub);
  // live.mjs's route-order workaround: stub.mjs's sessions glob otherwise swallows
  // /api/desktop-sessions/transcript, and Copy conversation would never succeed.
  await page.route((url) => url.pathname === '/api/desktop-sessions/transcript', async (r) =>
    r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: await transcriptText() }));

  await page.goto(`${BASE}/v2/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="Desktop sessions"]').click();
  await page.locator(SCREEN).waitFor({ state: 'visible' });
  // Live mode has landed once desktop.js has replaced the mock's count line.
  await page.waitForFunction(() => {
    const bar = document.querySelector('[data-screen-label="Desktop sessions"] > [data-dc-tpl]');
    const span = bar && bar.querySelector('span:not([data-fd-l10])');
    return !!span && !/collected/.test(span.textContent);
  });
  await page.locator(`${SCREEN} [data-fd-l10="refresh"]`).waitFor({ state: 'visible' });
  await page.locator(`${SCREEN} [data-fd-l10="notes"] > p`).first().waitFor({ state: 'visible' });
  await page.addStyleTag({ content: CSS });
  await page.waitForTimeout(300);
  return { context, page };
}

// -- capturing ----------------------------------------------------------------

const failures = [];
const written = [];
// PNG IHDR: width/height are the two big-endian u32 at byte 16 and 20.
const dim = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

async function shot(name, what, take) {
  const path = join(SHOTS, name);
  try {
    const buf = await take(path);
    if (!buf || buf.length < 256) throw new Error('screenshot returned no image data');
    const { w, h } = dim(buf);
    if (w < 40 || h < 16) throw new Error(`degenerate image ${w}x${h} — the element was collapsed or off-screen`);
    written.push(name);
    console.log(`wrote ${name} ${w}x${h} — ${what}`);
  } catch (err) {
    failures.push(`${name}: ${(err && err.message) || err}`);
    console.log(`FAILED ${name} — ${(err && err.message) || err}`);
  }
}

const element = (locator) => async (path) => {
  await locator.scrollIntoViewIfNeeded();
  return locator.screenshot({ path, animations: 'disabled', caret: 'hide' });
};

// A clip across several elements, for the shots improvised.md asks to see cropped
// out of a bigger container (two chip rows out of a card, two spans out of the bar).
const region = (page, locators, pad = 10) => async (path) => {
  for (const l of locators) await l.scrollIntoViewIfNeeded();
  const boxes = [];
  for (const l of locators) {
    const box = await l.boundingBox();
    if (!box) throw new Error('element has no box — it is not rendered');
    boxes.push(box);
  }
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(VIEWPORT.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(VIEWPORT.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return page.screenshot({ path, clip: { x, y, width: right - x, height: bottom - y }, animations: 'disabled', caret: 'hide' });
};

// -- the run ------------------------------------------------------------------

const rowAt = (page, i) => page.locator(`${SCREEN} ${ROW}`).nth(i);
const action = (page, i, aria) => rowAt(page, i).locator(`button[aria-label="${aria}"]`);

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const { context, page } = await openScreen(browser, { stub: { sessions: materialise(await states(), Date.now()) } });
  const bar = page.locator(`${SCREEN} > [data-dc-tpl]`).first();
  try {
    // I-L10-06 — the injected machine-notes panel, all five per-machine texts.
    await shot('l10-notes.png', 'I-L10-06 machine-notes panel', element(page.locator(`${SCREEN} [data-fd-l10="notes"]`)));

    // I-L10-05 — the rewritten count span plus the appended last-collection span.
    await shot('l10-count.png', 'I-L10-05 count + last collection',
      region(page, [bar.locator('span:not([data-fd-l10])').first(), bar.locator('[data-fd-l10="collected"]')], 8));

    // I-L10-07 — Refresh sitting immediately before the mock's own Reset.
    await shot('l10-refresh.png', 'I-L10-07 Refresh beside Reset',
      region(page, [bar.locator('[data-fd-l10="refresh"]'), bar.locator('[data-fd-l10-reset]')], 12));

    // I-L10-02 — rows 3 and 4 of Aylin's card: the stale row (Cached) and the
    // archived one (Archived), each beside the template's own live pill.
    const cached = rowAt(page, 3);
    const archived = rowAt(page, 4);
    for (const [row, chip] of [[cached, 'Cached'], [archived, 'Archived']]) {
      await row.locator('[data-dc-tpl="708"]').getByText(chip, { exact: true }).waitFor();
    }
    await shot('l10-chips.png', 'I-L10-02 Cached + Archived chips', region(page, [cached, archived], 6));

    // I-L10-04 — the transient copy label, caught inside its 1500 ms window.
    await shot('l10-copy-label.png', 'I-L10-04 transient copy label', async (path) => {
      const row = rowAt(page, 1);
      const label = row.locator('[data-fd-l10="copylabel"]');
      await row.scrollIntoViewIfNeeded();
      await action(page, 1, 'Copy conversation').click();
      await label.filter({ hasText: 'Copied' }).waitFor({ timeout: 1400 });
      // The pill overflows the row's own box, so the clip has to span both or the
      // one thing this shot exists for is cut off at the right edge.
      const buf = await region(page, [row, label], 6)(path);
      if (!(await label.count())) throw new Error('the copy label reverted before the screenshot was taken');
      return buf;
    });
    await page.waitForTimeout(1700); // let the label revert before the next shot

    // I-L10-03 — Show expands the row's own details panel.
    await shot('l10-show.png', 'I-L10-03 Show expands the details panel', async (path) => {
      const row = rowAt(page, 1);
      await action(page, 1, 'Show session').click();
      await row.locator('[data-dc-tpl="733"]').waitFor();
      for (const key of ['Created', 'CLI session', 'Session', 'Full path']) {
        await row.getByText(key, { exact: true }).first().waitFor();
      }
      await page.waitForTimeout(200);
      return element(row)(path);
    });

    // I-L10-01 — all four selects carrying a value only a live payload can offer.
    // Chosen so every one of them differs from the mock's hard-coded option list
    // (template.dc.html:673-676): the account carries its uuid8, mac-mini is not a
    // mock machine, and Unknown / Not archived are not mock option texts.
    await shot('l10-filters.png', 'I-L10-01 filter row on live-derived selections', async (path) => {
      const picks = [
        ['filter-account', 'Daniel Tabor · be25ab11'],
        ['filter-machine', 'mac-mini'],
        ['filter-live', 'Unknown'],
        ['filter-archived', 'Not archived'],
      ];
      for (const [hook, label] of picks) {
        const select = page.locator(`${SCREEN} select[data-fd-l10="${hook}"]`);
        const options = await select.locator('option').allTextContents();
        if (!options.includes(label)) {
          throw new Error(`${hook} has no live option "${label}" — options were ${JSON.stringify(options)}`);
        }
        await select.selectOption({ label });
      }
      await page.waitForTimeout(300);
      return element(bar)(path);
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();

console.log(`\n${written.length}/7 shots written → ${SHOTS}`);
if (failures.length) {
  console.log(`FAILED ${failures.length}:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
