#!/usr/bin/env node
// fd-v2-l5 — the screenshots the improvisation log references (Dietlind).
// Writes docs/design/fleetdeck-v2/improvised/l5-*.png from the same stubbed
// backend live.mjs uses.
//
//   node docs/design/fleetdeck-v2/verify/l5-live/shots.mjs

import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { crafted, startServer, openOrg, hookProbe, ORG } from './stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../improvised');

let scenario = 'crafted';

async function main() {
  const now = Date.now();
  const craftedData = crafted(now);
  const { server, port } = await startServer(() => scenario, craftedData);
  const base = `http://127.0.0.1:${port}`;
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
    await ctx.route(/\.(?:mp4|webm)(?:$|[?#])/i, (r) => r.abort());
    const page = await ctx.newPage();
    await page.addInitScript(hookProbe);
    const shot = (name) => page.locator(ORG).screenshot({ path: join(OUT, name) });

    // I-L5-02 (kids flattened depth-first), I-L5-04 (live stats row),
    // I-L5-06 (state palette), I-L5-08 (vacant + conflict seat cards).
    scenario = 'crafted';
    await openOrg(page, base);
    await shot('l5-spine-and-kids.png');

    // I-L5-03 (one badge slot, precedence) and the four org-facts.
    await page.locator(`${ORG} button:has-text("unattached")`).click();
    await page.waitForTimeout(300);
    await shot('l5-unattached-badges.png');

    // I-L5-07 (the error / "integration pending" state in mock tokens).
    scenario = 'seatsDown';
    await openOrg(page, base);
    await shot('l5-error-state.png');

    // I-L5-11 (loading and empty states as spine cards).
    scenario = 'empty';
    await openOrg(page, base);
    await shot('l5-empty-state.png');

    await ctx.close();
    console.log('wrote 4 screenshots to docs/design/fleetdeck-v2/improvised/');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
