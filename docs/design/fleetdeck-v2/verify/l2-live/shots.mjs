/**
 * fd-v2 L2 — the screenshots improvised.md requires, one per visual
 * improvisation. Same stub set as live.mjs; writes into
 * docs/design/fleetdeck-v2/improvised/.
 *
 * Run: node docs/design/fleetdeck-v2/verify/l2/shots.mjs
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, realpath } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../..');
const PUBLIC = join(REPO, 'public');
const API = join(REPO, 'docs/design/fleetdeck-v2/fixtures/api');
const STUBS = join(HERE, 'stubs');
const OUT = join(REPO, 'docs/design/fleetdeck-v2/improvised');

const SIDEBAR = '[data-dc-tpl="113"]';
const RAIL = '[data-dc-tpl="739"]';
const HEADER = '[data-dc-tpl="234"]';

async function serve() {
  const root = await realpath(PUBLIC);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const file = await realpath(resolve(root, '.' + pathname));
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((d, f) => { server.once('error', f); server.listen(0, '127.0.0.1', d); });
  return { port: server.address().port, close: () => new Promise((d) => { server.closeAllConnections(); server.close(d); }) };
}

const json = async (dir, name) => JSON.parse(await readFile(join(dir, name), 'utf8'));

function initPage({ storage }) {
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  window.__l2 = { calls: [], fullScreen: false, openKeys: [] };
  window.FD = window.FD || {};
  window.FD.screens = window.FD.screens || {};
  window.FD.screens.windows = {
    openTile: () => {}, openMax: () => {}, connectAll: () => {},
    isFullScreen: () => window.__l2.fullScreen,
    openKeys: () => window.__l2.openKeys,
  };
}

async function page(browser, port, routes) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark',
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(initPage, { storage: { 'fd-app-video': '0', 'fd-landing-dark': '1' } });
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const stub = routes[path];
    if (typeof stub === 'number') return route.fulfill({ status: stub, body: 'nope', contentType: 'text/plain' });
    return route.fulfill({ status: 200, body: JSON.stringify(stub ?? {}), contentType: 'application/json' });
  });
  await context.route('**/*.mp4', (r) => r.abort());
  const p = await context.newPage();
  await p.goto(`http://127.0.0.1:${port}/v2/index.html`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('link', { name: 'App', exact: true }).click();
  await p.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await p.waitForFunction(() => window.FD?.fixture?.l2Groups !== undefined && window.FD.fixture.l2Boxes !== undefined);
  await p.waitForTimeout(150);
  return { context, p };
}

const shot = async (locator, name) => {
  await writeFile(join(OUT, name), await locator.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }));
  console.log('wrote', name);
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const base = {
    '/api/sessions': await json(API, 'sessions.json'),
    '/api/health': await json(API, 'health.json'),
    '/api/credits': await json(API, 'credits.json'),
  };
  try {
    /* I-L2-04 ⤢ · I-L2-05 hidden toggle · I-L2-11 dot tones — one sidebar, all three. */
    {
      const { context, p } = await page(browser, server.port, { ...base, '/api/sessions': await json(STUBS, 'sessions-hidden.json') });
      await p.evaluate(() => { window.__l2.openKeys = [{ host: 'german-box', name: 'FD-v2-l2' }]; return window.FD.shell.refresh(); });
      await p.waitForTimeout(200);
      await p.locator('[data-dc-tpl="227"]').nth(1).hover();
      await p.waitForTimeout(220);
      await shot(p.locator(SIDEBAR), 'l2-sidebar-rows.png');
      await context.close();
    }
    /* I-L2-06 — error rows in the sidebar. */
    {
      const { context, p } = await page(browser, server.port, { ...base, '/api/sessions': await json(STUBS, 'sessions-errors.json') });
      await shot(p.locator(SIDEBAR), 'l2-sidebar-errors.png');
      await context.close();
    }
    /* I-L2-06 "no sessions" · I-L2-08 the empty state, together. */
    {
      const { context, p } = await page(browser, server.port, { ...base, '/api/sessions': await json(STUBS, 'sessions-empty.json') });
      await p.locator('aside button[title="Windows"]').click();
      await p.locator('[data-screen-label="Windows"]').waitFor({ state: 'visible' });
      await p.evaluate(() => {
        document.querySelectorAll('[data-dc-tpl="250"]').forEach((el) => el.remove());
        window.FD.shell.setLiveApi(null);
      });
      await p.waitForTimeout(200);
      await shot(p.locator(SIDEBAR), 'l2-sidebar-no-sessions.png');
      // The screen box collapses to nothing once the tiles are gone, so this one
      // is the viewport: the empty copy sits in the layer, over the main column.
      await writeFile(join(OUT, 'l2-windows-empty.png'),
        await p.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }));
      console.log('wrote l2-windows-empty.png');
      await context.close();
    }
    /* I-L2-07 € flag · I-L2-09 box tones · I-L2-10 em dash and the red bar. */
    {
      const { context, p } = await page(browser, server.port, {
        ...base,
        '/api/credits': await json(STUBS, 'credits-variants.json'),
        '/api/health': await json(STUBS, 'health-branches.json'),
      });
      await shot(p.locator(RAIL), 'l2-right-rail.png');
      await context.close();
    }
    /* I-L2-07 — the tooltip itself, as text (a native title cannot be screenshot). */
    {
      const { context, p } = await page(browser, server.port, { ...base, '/api/credits': await json(STUBS, 'credits-variants.json') });
      const tips = await p.locator('[data-dc-tpl="749"]').evaluateAll((els) => els.map((e) => e.title));
      await writeFile(join(OUT, 'l2-account-tooltips.txt'), tips.join('\n---\n') + '\n');
      console.log('wrote l2-account-tooltips.txt');
      await context.close();
    }
    /* I-L2-14 — the Live API pill carrying a source badge (ruling O4). */
    {
      const { context, p } = await page(browser, server.port, base);
      await p.evaluate(() => window.FD.shell.setLiveApi('live API · org fixture'));
      await p.waitForTimeout(120);
      await shot(p.locator(HEADER), 'l2-page-header.png');
      await context.close();
    }
    /* I-L2-12 — health unreachable, the one state that replaces the whole list. */
    {
      const { context, p } = await page(browser, server.port, { ...base, '/api/health': 500, '/api/credits': 500 });
      await shot(p.locator(RAIL), 'l2-right-rail-offline.png');
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main();
