#!/usr/bin/env node
/**
 * fd-v2 L6 — the screenshots the improvisation log requires.
 *
 * Drives the live bus (API stubbed from docs/design/fleetdeck-v2/fixtures/api/)
 * into each improvised state and writes docs/design/fleetdeck-v2/improvised/<slug>.png.
 *
 * Run: node docs/design/fleetdeck-v2/verify/l6-live/shots.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const PUBLIC = join(ROOT, 'public');
const API = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const SHOTS = join(ROOT, 'docs/design/fleetdeck-v2/improvised');
const VIEWPORT = { width: 1440, height: 900 };

const MESSAGES = JSON.parse(readFileSync(join(API, 'messages.json'), 'utf8'));
const SESSIONS = JSON.parse(readFileSync(join(API, 'sessions.json'), 'utf8'));
const DESKTOP = JSON.parse(readFileSync(join(API, 'desktop-sessions.json'), 'utf8'));
const LIVE_DESKTOP = (() => {
  for (const g of DESKTOP.groups || []) {
    for (const x of g.sessions || []) if (x.live && x.messageTarget) return x;
  }
  throw new Error('desktop-sessions fixture has no live row with a messageTarget');
})();
const THREAD = 'LC-wendelgard-clean-pure-voting';
const HOST = 'german-box';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

async function serve() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = resolve(PUBLIC, '.' + pathname);
      if (!file.startsWith(PUBLIC + sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return {
    url: `http://127.0.0.1:${server.address().port}/v2/index.html`,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

const json = (route, obj, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

async function page(browser, url, plan = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark',
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  context.setDefaultTimeout(20_000);
  await context.addInitScript(() => {
    localStorage.setItem('fd-landing-dark', '1');
    localStorage.setItem('fd-app-video', 'false');
    const style = document.createElement('style');
    style.textContent = '*{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style), { once: true });
  });
  await context.route('**/api/**', (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^\/api\//, '');
    if (plan[name]) return plan[name](route);
    if (name === 'messages') return json(route, plan.messages_body || MESSAGES);
    if (name === 'sessions') return json(route, SESSIONS);
    if (name === 'desktop-sessions') return json(route, DESKTOP);
    return json(route, {});
  });
  const p = await context.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.getByRole('link', { name: 'App', exact: true }).click();
  await p.locator('aside button[title="Message bus"]').click();
  await p.waitForFunction(() => window.FD && FD.screens.bus.polls > 0);
  await p.waitForTimeout(300);
  return { context, p };
}

const open = async (p, target) => {
  await p.evaluate((t) => FD.screens.bus.open(t), target);
  await p.waitForTimeout(350);
};
const shot = async (p, slug) => {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  await p.screenshot({ path: join(SHOTS, slug + '.png') });
  console.log('wrote improvised/' + slug + '.png');
};

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  try {
    // I-L6-02 / I-L6-03 / I-L6-05: Claude Desktop rows carry the old <option>
    // label, their liveness comes from targets[], and the mock's train-84 group
    // is gone — the rail is all Recent.
    {
      const { context, p } = await page(browser, server.url);
      await open(p, { type: 'claude-desktop', session: 'current' });
      await shot(p, 'l6-desktop-thread-label');
      await context.close();
    }

    // I-L6-04 / I-L6-07: the thread reads oldest at the top, newest at the
    // bottom, and each outbound message carries its own receipt line.
    {
      const { context, p } = await page(browser, server.url);
      await open(p, { type: 'tmux', host: HOST, session: THREAD });
      await shot(p, 'l6-thread-order-and-receipts');
      await context.close();
    }

    // I-L6-07: the send/retry strings BEHAVIOUR quotes have no toast slot in the
    // mock, so they land verbatim in the failed message's receipt, next to Retry.
    {
      const { context, p } = await page(browser, server.url, {
        messages: (route) => route.request().method() === 'POST'
          ? json(route, { ok: false, error: 'tmux target must name a configured host and safe session' }, 400)
          : json(route, MESSAGES),
      });
      await open(p, { type: 'tmux', host: HOST, session: THREAD });
      await p.locator('[data-screen-label="Message bus"] textarea[data-dc-tpl="499"]').fill('a message the server will reject');
      await p.locator('[data-screen-label="Message bus"] button[data-dc-tpl="507"]').click();
      await p.waitForTimeout(600);
      await shot(p, 'l6-receipt-error-strings');
      await context.close();
    }

    // I-L6-12: an offline target keeps the composer open, banner up and the
    // button reading Queue — it still posts.
    {
      const { context, p } = await page(browser, server.url);
      await open(p, { type: 'tmux', host: HOST, session: 'LC-a-session-that-is-gone' });
      await shot(p, 'l6-offline-queue');
      await context.close();
    }

    // I-L6-08: FD.screens.bus.open() for a target with no history creates a
    // provisional thread that survives the next poll.
    {
      const { context, p } = await page(browser, server.url);
      await open(p, { type: 'tmux', host: HOST, session: 'LC-brand-new-session' });
      await shot(p, 'l6-provisional-thread');
      await context.close();
    }

    // D08: the reply toast on live data — "<from> replied", preview, Open thread.
    {
      const { context, p } = await page(browser, server.url);
      await open(p, { type: 'tmux', host: HOST, session: THREAD });
      await p.evaluate(() => {
        const el = document.querySelector('[data-screen-label="Message bus"]');
        void el;
      });
      // Drive one more poll whose payload carries a reply on another thread.
      await p.route('**/api/messages*', (route) => json(route, {
        targets: MESSAGES.targets,
        messages: [{
          id: 'reply-shot', source: 'german-box:LC-sigibald-dashboard-truth',
          target: { type: 'claude-desktop', session: 'current' },
          text: 'ACK O45-DASH-TRUTH. Frozen at 25a9ae00, no further pushes until sealed.',
          status: 'delivered', error: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        }].concat(MESSAGES.messages),
      }));
      await p.evaluate(() => FD.screens.bus.refresh());
      await p.waitForTimeout(600);
      await shot(p, 'l6-reply-toast');
      await context.close();
    }
    // I-L6-13: an id:<cliSessionId> thread, labelled with the session's title.
    {
      const { context, p } = await page(browser, server.url);
      await open(p, LIVE_DESKTOP.messageTarget);
      await p.waitForTimeout(500);
      await shot(p, 'l6-desktop-id-thread');
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
