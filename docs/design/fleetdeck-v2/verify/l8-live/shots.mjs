#!/usr/bin/env node
/**
 * fd-v2 L8 — one screenshot per improvisation, for docs/design/fleetdeck-v2/improvised.md.
 * Same stubbed API as live.mjs. Writes docs/design/fleetdeck-v2/improvised/l8-*.png.
 *
 * Run: node docs/design/fleetdeck-v2/verify/l8-live/shots.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, resolve, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const PUBLIC = join(ROOT, 'public');
const SHOTS = join(ROOT, 'docs/design/fleetdeck-v2/improvised');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const SCREEN = '[data-screen-label="Accounts"]';
const CARD = `${SCREEN} div[data-dc-tpl="573"]`;

const json = async (f) => JSON.parse(await readFile(f, 'utf8'));

function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, path);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => res.writeHead(404).end());
    stream.on('open', () => { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); stream.pipe(res); });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

async function open(browser, url, credits) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC' });
  await context.addInitScript(() => { try { localStorage.setItem('fd-landing-dark', '1'); localStorage.setItem('fd-app-video', '0'); } catch (e) {} });
  await context.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(credits) }));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('aside button[title="Accounts"]').click();
  await page.locator(SCREEN).waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  return { context, page };
}

const { server, url: base } = await serve();
const app = `${base}/v2/index.html`;
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();
const captured = await json(join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api/credits.json'));
const variants = await json(join(HERE, 'fixtures/credits-variants.json'));

try {
  {
    const { context, page } = await open(browser, app, captured);
    // I-L8-01 the live summary bar and the full privacy note.
    await page.locator('#fd-l8-summary').screenshot({ path: join(SHOTS, 'l8-summary-bar.png') });
    // I-L8-02 the default expanded state: the row at a limit is open, the rest closed.
    await page.locator(SCREEN).screenshot({ path: join(SHOTS, 'l8-default-expanded.png') });
    // I-L8-05 the trend inside the mock's own 0 0 100 24 box: a stroke, no area, no tooltip.
    await page.locator(CARD).first().screenshot({ path: join(SHOTS, 'l8-trend.png') });
    await context.close();
  }
  {
    const { context, page } = await open(browser, app, variants);
    // I-L8-03 the one note line per card, carrying every note the mock has no slot for.
    await page.locator(CARD).filter({ hasText: 'Capped Credit' }).first().screenshot({ path: join(SHOTS, 'l8-note-line.png') });
    // I-L8-04 the collector-errors panel and Refresh, in the container the screen owns.
    await page.locator('#fd-l8-summary').screenshot({ path: join(SHOTS, 'l8-errors-refresh.png') });
    await context.close();
  }
  console.log('wrote 5 screenshots to docs/design/fleetdeck-v2/improvised/');
} finally {
  await browser.close();
  server.close();
}
