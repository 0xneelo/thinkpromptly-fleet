#!/usr/bin/env node
/**
 * fd-v2 L6 live-mode proof (ledger D13, D08).
 *
 * Serves public/ over a scratch HTTP server, drives /v2/index.html in LIVE mode
 * (no ?fixture=1) with every /api/* call stubbed from
 * docs/design/fleetdeck-v2/fixtures/api/ plus hand-written variants for the
 * error, empty and offline states, and walks every automatable item in
 * docs/goals/fd-v2-l6/BEHAVIOUR.md.
 *
 * Writes verify/l6/live.json  {id, action, expectation, pass, detail}
 *        verify/l6/live-dark.png, verify/l6/live-light.png
 *
 * Run: node docs/design/fleetdeck-v2/verify/l6-live/live.mjs
 * Exit 0 when every check passes and the console stayed clean, 1 otherwise.
 *
 * The script lives in verify/l6-live/ but writes into verify/l6/, because
 * design-diff.mjs publishes a slice by renaming the whole verify/<slice>/
 * directory away and moving a fresh staging directory in (publish(), line 244).
 * Anything of ours parked in verify/l6/ is destroyed by the next pixel-gate run,
 * so ORDER MATTERS: run the pixel gate first, this second.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../l6');
const ROOT = resolve(HERE, '../../../../..');
const PUBLIC = join(ROOT, 'public');
const API = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const VIEWPORT = { width: 1440, height: 900 };
const TIMEOUT = 20_000;

const MESSAGES = JSON.parse(readFileSync(join(API, 'messages.json'), 'utf8'));
const SESSIONS = JSON.parse(readFileSync(join(API, 'sessions.json'), 'utf8'));
const DESKTOP = JSON.parse(readFileSync(join(API, 'desktop-sessions.json'), 'utf8'));

// The live desktop row the Desktop screen offers "Message session" on. Its
// messageTarget is the API's resolved-at-delivery form, {type:'claude-desktop',
// session:'id:<cliSessionId>'} — the shape L6.2 was reported broken on.
const LIVE_DESKTOP = (() => {
  for (const g of DESKTOP.groups || []) {
    for (const x of g.sessions || []) if (x.live && x.messageTarget) return x;
  }
  throw new Error('desktop-sessions fixture has no live row with a messageTarget');
})();

// A tmux thread with real inbound traffic, and its host.
const THREAD = 'LC-wendelgard-clean-pure-voting';
const HOST = 'german-box';
// A session that /api/sessions does NOT report live -> the offline state.
const DEAD = 'LC-a-session-that-is-gone';

const results = [];
let failures = 0;

function record(id, action, expectation, pass, detail) {
  results.push({ id, action, expectation, pass: !!pass, detail: detail ?? null });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}  ${action}`);
  if (!pass) console.log(`     expected: ${expectation}\n     got:      ${detail}`);
}

async function check(id, action, expectation, fn) {
  try {
    const got = await fn();
    if (got === true) return record(id, action, expectation, true);
    if (got && typeof got === 'object' && 'pass' in got) {
      return record(id, action, expectation, got.pass, got.detail);
    }
    return record(id, action, expectation, false, String(got));
  } catch (e) {
    record(id, action, expectation, false, e && e.message ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// Static server for public/ — the same shape design-diff.mjs uses.
// ---------------------------------------------------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

// server.js serves the xterm bundle from node_modules under /vendor/*
// (server.js:2366-2371), not from public/. L3's windows.js injects those tags on
// demand, and since the weave L6's "Show session" reaches it for real — so the
// scratch server has to answer them too, or L3 logs a load failure that the
// zero-console-errors check would (fairly) blame on this page.
const VENDOR = {
  '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': '@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  '/vendor/addon-web-links.js': '@xterm/addon-web-links/lib/addon-web-links.js',
};

async function serve() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (VENDOR[pathname]) {
        const vendor = join(ROOT, 'node_modules', VENDOR[pathname]);
        const body = await readFile(vendor);
        res.writeHead(200, { 'Content-Type': TYPES[extname(vendor)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }
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

// ---------------------------------------------------------------------------
// The API stub. `plan` lets a scenario override one route at a time.
// ---------------------------------------------------------------------------
function apiStub(plan = {}) {
  const seen = [];
  const handler = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const name = url.pathname.replace(/^\/api\//, '');
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
    seen.push({ method: req.method(), path: url.pathname + url.search, body });

    const over = plan[name];
    if (over) return over(route, { url, body, seen });

    if (name === 'messages') return json(route, plan.messages_body || MESSAGES);
    if (name === 'sessions') return json(route, plan.sessions_body || SESSIONS);
    if (name === 'desktop-sessions') return json(route, DESKTOP);
    return json(route, {});
  };
  return { seen, handler };
}

const json = (route, obj, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

// ---------------------------------------------------------------------------
// A page in live mode, on the app view, with the bus screen showing.
// ---------------------------------------------------------------------------
async function openBus(browser, plan = {}, opts = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1,
    colorScheme: opts.theme === 'light' ? 'light' : 'dark',
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  context.setDefaultTimeout(TIMEOUT);
  const store = opts.storage || {};
  await context.addInitScript((seed) => {
    localStorage.setItem('fd-landing-dark', seed.theme === 'light' ? '0' : '1');
    localStorage.setItem('fd-app-video', 'false');
    Object.keys(seed.store).forEach((k) => localStorage.setItem(k, seed.store[k]));
  }, { theme: opts.theme, store });

  const stub = apiStub(plan);
  // Only /api/**. A second catch-all route would out-rank this one (Playwright
  // matches the last handler registered first) and route.continue() would send
  // every API call to the real network. The hero video is already off via
  // localStorage fd-app-video, so nothing else needs intercepting.
  await context.route('**/api/**', stub.handler);

  const page = await context.newPage();
  const errors = [];
  const netNoise = [];
  // Chromium logs a console error of its own for every non-2xx response. Some of
  // those responses are the failures this gate deliberately stubs (400, 403,
  // 409), so they are tallied separately from real page errors.
  const NET = /^Failed to load resource: the server responded with a status of \d+/;
  page.on('console', (m) => { if (m.type() === 'error') (NET.test(m.text()) ? netNoise : errors).push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  if (opts.clock) await page.clock.install();
  await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="Message bus"]').click();
  await page.locator('[data-screen-label="Message bus"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.FD && FD.screens.bus && FD.screens.bus.live === true);
  await page.waitForFunction(() => FD.screens.bus.polls > 0);

  // Record the two hooks this slice USES. Since the weave, L2's shell.js and
  // L3's windows.js provide both for real and load after any init script, so the
  // recorder WRAPS whatever is there rather than replacing it -- the real
  // implementation still runs and the gate sees the arguments it was handed.
  // (Absence, and a throwing implementation, are covered in test/v2-bus.test.js.)
  await page.evaluate(() => {
    window.__badge = [];
    window.__openMax = [];
    const F = window.FD;
    F.shell = F.shell || {};
    const realBadge = F.shell.setBadge;
    F.shell.setBadge = function (n) {
      window.__badge.push(n);
      if (typeof realBadge === 'function') return realBadge.apply(this, arguments);
      return undefined;
    };
    // openMax records but deliberately does NOT call through. What L6 owes the
    // contract is "a tmux thread calls FD.screens.windows.openMax(host, session)
    // and does not fall back to the mock's terminal". What L3 then does with it
    // -- a full-screen xterm that takes over the window, with its own close
    // lifecycle -- is L3's behaviour and L3's gate. Driving it here would make
    // this gate fail on L3's regressions, and every later check would have to
    // fight its overlay to get back to the bus.
    F.screens.windows = F.screens.windows || {};
    window.__openMaxReal = typeof F.screens.windows.openMax === 'function';
    F.screens.windows.openMax = function (h, s) { window.__openMax.push([h, s]); };
  });

  return { context, page, stub, errors, netNoise, close: () => context.close() };
}

// Handy locators.
const bus = (p) => p.locator('[data-screen-label="Message bus"]');
const railRows = (p) => bus(p).locator('div[data-dc-tpl="412"]');
const railNames = (p) => bus(p).locator('span[data-dc-tpl="420"]');
const groupLabels = (p) => bus(p).locator('span[data-dc-tpl="410"]');
const msgRows = (p) => bus(p).locator('div[data-dc-tpl="475"]');
const composer = (p) => bus(p).locator('textarea[data-dc-tpl="499"]');
const sendBtn = (p) => bus(p).locator('button[data-dc-tpl="507"]');
const srcChip = (p) => bus(p).locator('button[data-dc-tpl="505"]');
const srcInput = (p) => bus(p).locator('input[data-dc-tpl="503"]');
const offlineBanner = (p) => bus(p).locator('div[data-dc-tpl="496"]');
const selectBtn = (p) => bus(p).locator('button[data-dc-tpl="407"]');
const search = (p) => bus(p).locator('input[data-dc-tpl="406"]');
const toast = (p) => p.locator('div[data-dc-tpl="767"]');

// thActions puts a.label on the button's aria-label (app.js tpl 435) and repeats
// it, with the description, in a tooltip that only renders while the wrapper is
// hovered. The accessible name is the stable handle.
function action(page, label) {
  return bus(page).locator('button[data-dc-tpl="435"][aria-label="' + label + '"]');
}

const openThread = async (page, id) => {
  await page.evaluate((t) => FD.screens.bus.open(t), id);
  await page.waitForTimeout(150);
};

// ---------------------------------------------------------------------------
async function main() {
  const server = await serve();
  const browser = await chromium.launch();
  const url = server.url;
  const consoleErrors = [];
  const stubbedHttpNoise = [];

  try {
    // =====================================================================
    // BEHAVIOUR §1 — data
    // =====================================================================
    {
      const s = await openBus(browser, {}, { url });
      const { page, stub } = s;

      await check('L6-01', 'load the bus screen in live mode',
        'GET /api/messages?limit=50 exactly as app.js:918 builds it',
        () => {
          const hit = stub.seen.find((r) => r.path.startsWith('/api/messages'));
          return { pass: !!hit && hit.method === 'GET' && hit.path === '/api/messages?limit=50', detail: hit && hit.path };
        });

      await check('L6-02', 'load the bus screen in live mode',
        'GET /api/sessions is read for liveness',
        () => {
          const hit = stub.seen.find((r) => r.path === '/api/sessions');
          return { pass: !!hit && hit.method === 'GET', detail: hit && hit.method };
        });

      await check('L6-03', 'group /api/messages by target',
        'one thread per target; the 9 threads the fixture contains',
        async () => {
          const n = await page.evaluate(() => Object.keys(FD.fixture.seedThreads).length);
          return { pass: n === 9, detail: 'threads=' + n };
        });

      await check('L6-04', 'build the rail',
        'a row for every declared target, even one with no messages',
        async () => {
          const got = await page.evaluate(() => (FD.fixture.busSessions || []).map((r) => r.id));
          const declared = MESSAGES.targets.map((t) => t.session);
          const missing = declared.filter((d) => !got.includes(d));
          return { pass: missing.length === 0, detail: 'missing=' + JSON.stringify(missing) };
        });

      await check('L6-05', 'build the rail',
        'every live fleet tmux session merged client-side (app.js:920-925)',
        async () => {
          const got = await page.evaluate(() => (FD.fixture.busSessions || []).map((r) => r.id));
          const live = SESSIONS.sessions.filter((x) => x.live).map((x) => x.name);
          const missing = live.filter((n) => !got.includes(n));
          return { pass: missing.length === 0, detail: 'live=' + live.length + ' missing=' + missing.length };
        });

      await check('L6-06', 'read a thread',
        'messages oldest-first, so the newest sits at the bottom of the body',
        async () => {
          await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
          const mins = await page.evaluate((id) => FD.fixture.seedThreads[id].map((m) => m.m), THREAD);
          const ordered = mins.every((v, i) => i === 0 || mins[i - 1] >= v);
          return { pass: ordered && mins.length > 1, detail: 'm=' + JSON.stringify(mins) };
        });

      await check('L6-07', 'read a thread',
        'the adapter shape survives: k, dir, from, at, m, status/per, text',
        async () => {
          const m = await page.evaluate((id) => FD.fixture.seedThreads[id][0], THREAD);
          const need = ['k', 'dir', 'from', 'at', 'm', 'text'];
          const missing = need.filter((k) => !(k in m));
          return { pass: missing.length === 0, detail: 'keys=' + Object.keys(m).join(',') };
        });

      await check('L6-08', 'open a tmux thread',
        'the header shows the session name and its host',
        async () => {
          const txt = await bus(page).locator('span[data-dc-tpl="429"]').first().innerText();
          const meta = await bus(page).locator('span[data-dc-tpl="430"]').first().innerText();
          return { pass: txt.trim() === THREAD && meta.trim() === HOST, detail: txt + ' / ' + meta };
        });

      await check('L6-09', 'open the Claude Desktop "current" thread',
        'labelled "Claude Desktop · current chat" (BEHAVIOUR §2)',
        async () => {
          const name = await page.evaluate(() => (FD.fixture.busSessions.find((r) => r.id === 'current') || {}).name);
          return { pass: name === 'Claude Desktop · current chat', detail: name };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // BEHAVIOUR §2 — send
    // =====================================================================
    {
      let posted = null;
      const s = await openBus(browser, {
        messages: (route, ctx) => {
          if (route.request().method() === 'POST') {
            posted = ctx.body;
            return json(route, { ok: true, id: 'srv-1', status: 'delivered' });
          }
          return json(route, MESSAGES);
        },
      }, { url });
      const { page } = s;
      await openThread(page, { type: 'tmux', host: HOST, session: THREAD });

      await check('L6-10', 'read the composer',
        'the from chip defaults to fleetdeck-ui (app.js:1218)',
        async () => {
          const t = (await srcChip(page).innerText()).trim();
          return { pass: t === 'fleetdeck-ui', detail: t };
        });

      await check('L6-11', 'type a message and press Send',
        'POST /api/messages with exactly {source, target, text}',
        async () => {
          await composer(page).fill('hello from the l6 gate');
          await sendBtn(page).click();
          await page.waitForTimeout(400);
          if (!posted) return { pass: false, detail: 'no POST seen' };
          const keys = Object.keys(posted).sort().join(',');
          const ok = keys === 'source,target,text'
            && posted.source === 'fleetdeck-ui'
            && posted.text === 'hello from the l6 gate'
            && posted.target.type === 'tmux' && posted.target.host === HOST && posted.target.session === THREAD;
          return { pass: ok, detail: JSON.stringify(posted) };
        });

      await check('L6-12', 'after a successful send',
        'the composer is cleared',
        async () => {
          const v = await composer(page).inputValue();
          return { pass: v === '', detail: JSON.stringify(v) };
        });

      await check('L6-13', 'after a successful send',
        'the message receipt reads delivered',
        async () => {
          const txt = await msgRows(page).last().innerText();
          return { pass: /delivered/.test(txt), detail: txt.replace(/\s+/g, ' ').slice(-90) };
        });

      await check('L6-14', 'edit the from chip and send',
        'the new value is used as `source`',
        async () => {
          await srcChip(page).click();
          await srcInput(page).fill('design-35');
          await srcInput(page).blur();
          await composer(page).fill('second');
          await sendBtn(page).click();
          await page.waitForTimeout(400);
          return { pass: posted && posted.source === 'design-35', detail: posted && posted.source };
        });

      await check('L6-15', 'press Ctrl+Enter in the composer',
        'the message sends without touching the Send button',
        async () => {
          posted = null;
          await composer(page).fill('by keyboard');
          await composer(page).press('Control+Enter');
          await page.waitForTimeout(400);
          return { pass: posted && posted.text === 'by keyboard', detail: posted && posted.text };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // BEHAVIOUR §2/§3 — failure, error strings, retry
    // =====================================================================
    {
      let retried = null;
      const s = await openBus(browser, {
        messages: (route) => route.request().method() === 'POST'
          ? json(route, { ok: false, error: 'tmux target must name a configured host and safe session' }, 400)
          : json(route, MESSAGES),
        'messages/retry': (route, ctx) => { retried = ctx.body; return json(route, { ok: false, error: 'only failed messages can be retried' }, 409); },
      }, { url });
      const { page } = s;
      await openThread(page, { type: 'tmux', host: HOST, session: THREAD });

      await check('L6-16', 'send when the server answers 400',
        'the receipt reads failed with the server error verbatim',
        async () => {
          await composer(page).fill('doomed');
          await sendBtn(page).click();
          await page.waitForTimeout(500);
          const txt = (await msgRows(page).last().innerText()).replace(/\s+/g, ' ');
          const ok = txt.includes('failed')
            && txt.includes('Delivery failed: tmux target must name a configured host and safe session');
          return { pass: ok, detail: txt.slice(-140) };
        });

      await check('L6-17', 'a failed message',
        'offers a Retry button (BEHAVIOUR §3)',
        async () => {
          const n = await msgRows(page).last().locator('button[data-dc-tpl="486"]').count();
          return { pass: n === 1, detail: 'retry buttons=' + n };
        });

      await check('L6-18', 'click Retry',
        'POST /api/messages/retry {id}',
        async () => {
          await msgRows(page).last().locator('button[data-dc-tpl="486"]').click();
          await page.waitForTimeout(400);
          const ok = retried && Object.keys(retried).join(',') === 'id' && typeof retried.id === 'string';
          return { pass: !!ok, detail: JSON.stringify(retried) };
        });

      await check('L6-19', 'a retry the server rejects with 409',
        'the receipt reads "Retry failed: only failed messages can be retried"',
        async () => {
          const txt = (await msgRows(page).last().innerText()).replace(/\s+/g, ' ');
          return { pass: txt.includes('Retry failed: only failed messages can be retried'), detail: txt.slice(-140) };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // BEHAVIOUR §7 — offline banner and the Queue label
    // =====================================================================
    {
      let posted = null;
      const s = await openBus(browser, {
        messages: (route, ctx) => {
          if (route.request().method() === 'POST') { posted = ctx.body; return json(route, { ok: false, error: 'session is not running' }); }
          return json(route, MESSAGES);
        },
      }, { url });
      const { page } = s;
      await openThread(page, { type: 'tmux', host: HOST, session: DEAD });

      await check('L6-20', 'open a thread whose session is not live',
        'the offline banner shows the mock\'s wording verbatim',
        async () => {
          const txt = (await offlineBanner(page).innerText()).trim();
          return { pass: txt === 'Session is offline. The message queues and delivers when it returns.', detail: txt };
        });

      await check('L6-21', 'open an offline thread',
        'the send button reads Queue, not Send',
        async () => {
          const t = (await sendBtn(page).innerText()).trim();
          return { pass: t === 'Queue', detail: t };
        });

      await check('L6-22', 'queue a message to an offline session',
        'it still POSTs (the ruling: queue, do not disable)',
        async () => {
          await composer(page).fill('queued while away');
          await sendBtn(page).click();
          await page.waitForTimeout(400);
          return { pass: posted && posted.text === 'queued while away', detail: JSON.stringify(posted && posted.target) };
        });

      await check('L6-23', 'open a live thread',
        'the send button reads Send and the banner is gone',
        async () => {
          await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
          const t = (await sendBtn(page).innerText()).trim();
          const banner = await offlineBanner(page).count();
          return { pass: t === 'Send' && banner === 0, detail: t + ' banner=' + banner };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // BEHAVIOUR §7 — unread, fd-bus-seen, fd-bus-pinned, the badge
    // =====================================================================
    {
      const s = await openBus(browser, {}, { url });
      const { page } = s;

      await check('L6-24', 'boot with no fd-bus-seen',
        'every inbound row counts as unread and the total reaches FD.shell.setBadge',
        async () => {
          // The recorder is installed after the first poll, so provoke one.
          await page.evaluate(() => FD.screens.bus.refresh());
          await page.waitForTimeout(400);
          const got = await page.evaluate(() => ({
            unread: FD.fixture.busUnreadDefault,
            badge: window.__badge[window.__badge.length - 1],
          }));
          const total = Object.values(got.unread).reduce((a, b) => a + b, 0);
          return { pass: total === 24 && got.badge === total, detail: 'total=' + total + ' badge=' + got.badge };
        });

      await check('L6-25', 'open a thread with unread messages',
        'fd-bus-seen records an ISO stamp under that thread id',
        async () => {
          await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
          const raw = await page.evaluate(() => localStorage.getItem('fd-bus-seen'));
          const seen = JSON.parse(raw || '{}');
          const ok = typeof seen[THREAD] === 'string' && !Number.isNaN(Date.parse(seen[THREAD]));
          return { pass: ok, detail: raw };
        });

      await check('L6-26', 'after opening the thread',
        'its unread count is cleared and the badge drops by that many',
        async () => {
          const got = await page.evaluate((id) => ({
            left: FD.fixture.busUnreadDefault[id],
            badge: window.__badge[window.__badge.length - 1],
          }), THREAD);
          return { pass: got.left === undefined && got.badge === 17, detail: JSON.stringify(got) };
        });

      await check('L6-27', 'pin the open thread from the header',
        'fd-bus-pinned holds the thread id and the row moves under Pinned',
        async () => {
          await action(page, 'Pin thread').click();
          await page.waitForTimeout(250);
          const raw = await page.evaluate(() => localStorage.getItem('fd-bus-pinned'));
          // The heading is uppercased in CSS, so innerText reads "PINNED".
          const labels = (await groupLabels(page).allInnerTexts()).map((x) => x.trim().toLowerCase());
          return { pass: (JSON.parse(raw || '[]')).includes(THREAD) && labels.includes('pinned'), detail: raw + ' groups=' + labels.join('|') };
        });

      await check('L6-28', 'reload with fd-bus-seen already stamped',
        'the seen thread is no longer unread',
        async () => {
          const stamp = JSON.stringify({ [THREAD]: new Date().toISOString() });
          const s2 = await openBus(browser, {}, { url, storage: { 'fd-bus-seen': stamp } });
          const left = await s2.page.evaluate((id) => FD.fixture.busUnreadDefault[id], THREAD);
          s2.errors.forEach((e) => consoleErrors.push(e));
          s2.netNoise.forEach((e) => stubbedHttpNoise.push(e));
          await s2.close();
          return { pass: left === undefined, detail: 'unread=' + left };
        });

      await check('L6-29', 'type in the rail search box',
        'the rail filters to matching sessions only',
        async () => {
          await search(page).fill('wendelgard');
          await page.waitForTimeout(200);
          const names = await railNames(page).allInnerTexts();
          const ok = names.length > 0 && names.every((n) => n.toLowerCase().includes('wendelgard'));
          await search(page).fill('');
          return { pass: ok, detail: names.join('|').slice(0, 120) };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // BEHAVIOUR §7 — the inbound poll and the reply toast (D08)
    // =====================================================================
    {
      let payload = MESSAGES;
      const s = await openBus(browser, {
        messages: (route) => json(route, payload),
      }, { url, clock: true });
      const { page, stub } = s;
      await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
      const before = stub.seen.filter((r) => r.path.startsWith('/api/messages')).length;

      await check('L6-30', 'sit on the bus screen for 15 s',
        'the inbound poll fires (BEHAVIOUR §7: 15 s while open)',
        async () => {
          await page.clock.runFor(15_500);
          await page.waitForTimeout(400);
          const after = stub.seen.filter((r) => r.path.startsWith('/api/messages')).length;
          return { pass: after > before, detail: before + ' -> ' + after };
        });

      await check('L6-31', 'a new inbound row lands for another thread',
        'the reply toast reads "<from> replied" with a preview and Open thread',
        async () => {
          payload = {
            targets: MESSAGES.targets,
            messages: [{
              id: 'new-inbound-1',
              source: HOST + ':LC-sigibald-dashboard-truth',
              target: { type: 'claude-desktop', session: 'current' },
              text: 'ACK. Picking this up on the next turn.',
              status: 'delivered', error: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              delivered_at: new Date().toISOString(),
            }].concat(MESSAGES.messages),
          };
          await page.clock.runFor(15_500);
          await page.waitForTimeout(500);
          await toast(page).waitFor({ state: 'visible' });
          const from = (await toast(page).locator('span[data-dc-tpl="770"]').innerText()).trim();
          const said = (await toast(page).locator('span[data-dc-tpl="771"]').innerText()).trim();
          const prev = (await toast(page).locator('p[data-dc-tpl="773"]').innerText()).trim();
          const btn = (await toast(page).locator('button[data-dc-tpl="774"]').innerText()).trim();
          const ok = from === 'LC-sigibald-dashboard-truth' && said === 'replied'
            && prev === 'ACK. Picking this up on the next turn.' && btn === 'Open thread';
          return { pass: ok, detail: `${from} | ${said} | ${prev} | ${btn}` };
        });

      await check('L6-32', 'click Open thread on the toast',
        'the bus jumps to that thread and the toast closes',
        async () => {
          await toast(page).locator('button[data-dc-tpl="774"]').click();
          await page.waitForTimeout(300);
          const name = (await bus(page).locator('span[data-dc-tpl="429"]').first().innerText()).trim();
          const gone = await toast(page).count();
          return { pass: name === 'LC-sigibald-dashboard-truth' && gone === 0, detail: name + ' toast=' + gone };
        });

      await check('L6-33', 'a reply toast left alone',
        'auto-dismisses after 7 s (D08, mock L769-780)',
        async () => {
          payload = {
            targets: MESSAGES.targets,
            messages: [{
              id: 'new-inbound-2', source: HOST + ':LC-ida-xyz-2121',
              target: { type: 'claude-desktop', session: 'current' },
              text: 'second reply', status: 'delivered', error: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(), delivered_at: new Date().toISOString(),
            }].concat(payload.messages),
          };
          await page.clock.runFor(15_500);
          await page.waitForTimeout(500);
          const shown = await toast(page).count();
          await page.clock.runFor(7_200);
          await page.waitForTimeout(400);
          const after = await toast(page).count();
          return { pass: shown === 1 && after === 0, detail: 'shown=' + shown + ' after7s=' + after };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // BEHAVIOUR §7 — broadcast, header actions, hooks
    // =====================================================================
    {
      const posts = [];
      const s = await openBus(browser, {
        messages: (route, ctx) => {
          if (route.request().method() === 'POST') { posts.push(ctx.body); return json(route, { ok: true, id: 'b' + posts.length, status: 'delivered' }); }
          return json(route, MESSAGES);
        },
      }, { url });
      const { page } = s;
      await openThread(page, { type: 'tmux', host: HOST, session: THREAD });

      await check('L6-34', 'pick three sessions in Select mode and send',
        'one POST /api/messages per recipient, same text (BEHAVIOUR §7)',
        async () => {
          await selectBtn(page).click();
          const boxes = bus(page).locator('span[data-dc-tpl="414"]');
          for (let i = 0; i < 3; i++) await boxes.nth(i).click();
          await composer(page).fill('broadcast to three');
          await sendBtn(page).click();
          await page.waitForTimeout(700);
          const mine = posts.filter((b) => b.text === 'broadcast to three');
          const targets = mine.map((b) => b.target.session);
          return { pass: mine.length === 3 && new Set(targets).size === 3, detail: JSON.stringify(targets) };
        });

      await check('L6-35', 'after a broadcast',
        'the message carries one receipt per recipient',
        async () => {
          const txt = (await msgRows(page).last().innerText()).replace(/\s+/g, ' ');
          const n = (txt.match(/delivered/g) || []).length;
          return { pass: n === 3, detail: n + ' receipts :: ' + txt.slice(-160) };
        });

      await check('L6-36', 'click Show session on a tmux thread',
        'FD.screens.windows.openMax(host, session) is called (L3 hook, guarded)',
        async () => {
          await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
          await action(page, 'Show session').click();
          await page.waitForTimeout(350);
          const got = await page.evaluate(() => ({ calls: window.__openMax, real: window.__openMaxReal }));
          // The hook is really provided by L3 on this tree, and the mock's own
          // full-screen terminal must NOT have been used as the fallback.
          const fellBack = await page.locator('[data-screen-label="Session full screen"]').isVisible();
          const ok = got.real && got.calls.length === 1
            && got.calls[0][0] === HOST && got.calls[0][1] === THREAD && !fellBack;
          return { pass: ok, detail: `L3 present=${got.real} calls=${JSON.stringify(got.calls)} mockFallback=${fellBack}` };
        });

      await check('L6-37', 'click Show session on a Claude Desktop thread',
        'it is a no-op — desktop threads have no tmux terminal',
        async () => {
          await openThread(page, { type: 'claude-desktop', session: 'current' });
          const before = (await page.evaluate(() => window.__openMax)).length;
          await action(page, 'Show session').click();
          await page.waitForTimeout(300);
          const after = (await page.evaluate(() => window.__openMax)).length;
          const stillOnBus = await bus(page).isVisible();
          return { pass: before === after && stillOnBus, detail: `openMax ${before}->${after} bus=${stillOnBus}` };
        });

      await check('L6-38', 'Maximize then Escape',
        'the Escape chain leaves full view, per the mock',
        async () => {
          await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
          await action(page, 'Maximize').click();
          await page.waitForTimeout(200);
          const max = await page.evaluate(() => getComputedStyle(document.querySelector('[data-screen-label="Message bus"]')).position);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          const back = await page.evaluate(() => getComputedStyle(document.querySelector('[data-screen-label="Message bus"]')).position);
          return { pass: max === 'fixed' && back !== 'fixed', detail: max + ' -> ' + back };
        });

      await check('L6-39', 'click Copy thread',
        'the whole thread lands on the clipboard as plain text',
        async () => {
          await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
          await action(page, 'Copy thread').click();
          await page.waitForTimeout(300);
          const txt = await page.evaluate(() => navigator.clipboard.readText());
          const first = await page.evaluate((id) => FD.fixture.seedThreads[id][0].text, THREAD);
          return { pass: txt.includes(first.slice(0, 40)), detail: txt.slice(0, 80) };
        });

      await check('L6-40', 'toggle Reader view',
        'agent replies go full width instead of a bubble',
        async () => {
          // Only inbound replies change; an inbound row is the one carrying a
          // `from` line (tpl 478, rendered when showFrom is true).
          const inbound = msgRows(page)
            .filter({ has: page.locator('span[data-dc-tpl="478"]') })
            .first().locator('p[data-dc-tpl="479"]');
          const before = await inbound.evaluate((el) => getComputedStyle(el).fontSize);
          await action(page, 'Reader view').click();
          await page.waitForTimeout(250);
          const after = await inbound.evaluate((el) => getComputedStyle(el).fontSize);
          return { pass: before === '13px' && after === '15px', detail: before + ' -> ' + after };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // L6.1 — the primary D08 case: the reply lands on the thread you selected,
    // while you are somewhere else in the app. Suppressing on busActive alone
    // meant this exact toast never fired (independent review, HIGH).
    // =====================================================================
    {
      let payload = MESSAGES;
      const s = await openBus(browser, { messages: (route) => json(route, payload) }, { url, clock: true });
      const { page } = s;

      await check('L6-48', 'select a thread, then navigate to Accounts',
        'the bus screen is no longer showing but the thread stays selected',
        async () => {
          await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
          await page.locator('aside button[title="Accounts"]').click();
          await page.waitForTimeout(250);
          const busShown = await bus(page).isVisible();
          const accounts = await page.locator('[data-screen-label="Accounts"]').isVisible();
          return { pass: !busShown && accounts, detail: 'bus=' + busShown + ' accounts=' + accounts };
        });

      await check('L6-49', 'an inbound row arrives on that selected thread',
        'the reply toast still fires — this is the case D08 exists for',
        async () => {
          payload = {
            targets: MESSAGES.targets,
            messages: [{
              id: 'reply-on-selected', source: HOST + ':' + THREAD,
              target: { type: 'claude-desktop', session: 'current' },
              text: 'ACK. Picking this up on the next turn.',
              status: 'delivered', error: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              delivered_at: new Date().toISOString(),
            }].concat(MESSAGES.messages),
          };
          // Off the bus screen the poll throttles to 60 s, so advance past it.
          await page.clock.runFor(61_000);
          await page.waitForTimeout(600);
          await toast(page).waitFor({ state: 'visible' });
          const from = (await toast(page).locator('span[data-dc-tpl="770"]').innerText()).trim();
          const prev = (await toast(page).locator('p[data-dc-tpl="773"]').innerText()).trim();
          return {
            pass: from === THREAD && prev === 'ACK. Picking this up on the next turn.',
            detail: from + ' | ' + prev,
          };
        });

      await check('L6-50', 'click Open thread on that toast',
        'it returns to the bus screen with that thread selected and the reply shown',
        async () => {
          await toast(page).locator('button[data-dc-tpl="774"]').click();
          await page.waitForTimeout(400);
          const shown = await bus(page).isVisible();
          const name = (await bus(page).locator('span[data-dc-tpl="429"]').first().innerText()).trim();
          const last = (await msgRows(page).last().innerText()).replace(/\s+/g, ' ');
          const gone = await toast(page).count();
          return {
            pass: shown && name === THREAD && last.includes('ACK. Picking this up on the next turn.') && gone === 0,
            detail: `visible=${shown} name=${name} toast=${gone} :: ${last.slice(-70)}`,
          };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // BEHAVIOUR §5 — FD.screens.bus.open(target) as the deep link
    // =====================================================================
    {
      const s = await openBus(browser, {}, { url });
      const { page } = s;

      await check('L6-41', 'call FD.screens.bus.open for a known tmux target',
        'the bus screen shows and that thread is selected',
        async () => {
          await page.locator('aside button[title="Registry"]').click();
          await page.waitForTimeout(200);
          await openThread(page, { type: 'tmux', host: HOST, session: THREAD });
          const shown = await bus(page).isVisible();
          const name = (await bus(page).locator('span[data-dc-tpl="429"]').first().innerText()).trim();
          return { pass: shown && name === THREAD, detail: 'visible=' + shown + ' name=' + name };
        });

      await check('L6-42', 'call FD.screens.bus.open for a target with no history',
        'a provisional row is created and selected (setBusTarget, app.js:901-909)',
        async () => {
          await openThread(page, { type: 'tmux', host: HOST, session: 'LC-brand-new-session' });
          const name = (await bus(page).locator('span[data-dc-tpl="429"]').first().innerText()).trim();
          const empty = await bus(page).locator('span[data-dc-tpl="472"]').count();
          return { pass: name === 'LC-brand-new-session' && empty === 1, detail: name + ' empty=' + empty };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // Hand-written variants: empty and error
    // =====================================================================
    {
      const s = await openBus(browser, {
        messages_body: { messages: [], targets: [] },
        sessions_body: { sessions: [], errors: [] },
      }, { url });
      const { page } = s;

      await check('L6-43', 'an empty bus (no messages, no targets, no sessions)',
        'the screen renders the empty state instead of throwing',
        async () => {
          const shown = await bus(page).isVisible();
          const rows = await railRows(page).count();
          const empty = await bus(page).locator('span[data-dc-tpl="472"]').count();
          return { pass: shown && rows === 0 && empty === 1, detail: `visible=${shown} rows=${rows} empty=${empty}` };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    {
      const s = await openBus(browser, {
        messages: (route) => json(route, { ok: false, error: 'bus token required' }, 403),
      }, { url });
      const { page } = s;

      await check('L6-44', '/api/messages answers 403',
        'the screen still renders and nothing is thrown at the console',
        async () => {
          await page.waitForTimeout(600);
          const shown = await bus(page).isVisible();
          const err = await page.evaluate(() => !!FD.screens.bus.lastError);
          return { pass: shown && err, detail: 'visible=' + shown + ' recorded=' + err };
        });

      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    // L6.2 — the deployed entry point. /v2/index.html?view=app mounts the shell
    // inside app.js, BEFORE public/v2/screens/*.js load, so an attach that only
    // ran from componentDidMount never fired and every deep link was dead while
    // threads still painted. This scenario loads the page exactly that way.
    // =====================================================================
    {
      const posts = [];
      const context = await browser.newContext({
        viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark',
        reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
      });
      context.setDefaultTimeout(TIMEOUT);
      await context.addInitScript(() => {
        localStorage.setItem('fd-landing-dark', '1');
        localStorage.setItem('fd-app-video', 'false');
      });
      const stub = apiStub({
        messages: (route, ctx) => {
          if (route.request().method() === 'POST') { posts.push(ctx.body); return json(route, { ok: true, id: 'd1', status: 'delivered' }); }
          return json(route, MESSAGES);
        },
      });
      await context.route('**/api/**', stub.handler);
      const page = await context.newPage();
      const errs = [];
      const NET2 = /^Failed to load resource: the server responded with a status of \d+/;
      page.on('console', (m) => { if (m.type() === 'error' && !NET2.test(m.text())) errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

      // No App-link click: land in the app view the way the deployed deck does.
      await page.goto(url + '?view=app', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.FD && FD.screens.bus && FD.screens.bus.polls > 0);
      await page.waitForTimeout(400);

      await check('L6-51', 'load /v2/index.html?view=app — the shell mounts before the screen files',
        'the bus screen still attached to the shell, so a deep link actually lands',
        async () => {
          // Assert the EFFECT, not the return value: a queued open legitimately
          // reports true, so only "the bus is now showing that thread" proves
          // the shell was attached.
          const ok = await page.evaluate(() => FD.screens.bus.open({ type: 'claude-desktop', session: 'current' }));
          await page.waitForTimeout(500);
          const shown = await bus(page).isVisible();
          const name = shown ? (await bus(page).locator('span[data-dc-tpl="429"]').first().innerText()).trim() : '';
          return {
            pass: ok === true && shown && name === 'Claude Desktop · current chat',
            detail: `open=${ok} visible=${shown} name=${JSON.stringify(name)}`,
          };
        });

      await check('L6-52', 'click Message session on a live Desktop sessions row',
        'the bus opens on that id:<uuid> thread, labelled with the session title',
        async () => {
          await page.locator('aside button[title="Desktop sessions"]').click();
          await page.locator('[data-screen-label="Desktop sessions"]').waitFor({ state: 'visible' });
          await page.waitForTimeout(800);
          const btn = page.locator('[data-screen-label="Desktop sessions"]')
            .getByRole('button', { name: /Message session/i }).first();
          await btn.click();
          await page.waitForTimeout(900);
          const shown = await bus(page).isVisible();
          const name = (await bus(page).locator('span[data-dc-tpl="429"]').first().innerText()).trim();
          const hash = await page.evaluate(() => location.hash);
          return {
            pass: shown && name === 'Claude Desktop · ' + LIVE_DESKTOP.title && hash === '#bus',
            detail: `visible=${shown} name=${JSON.stringify(name)} hash=${hash}`,
          };
        });

      await check('L6-53', 'send from that thread',
        'the POST body carries {type:"claude-desktop", session:"id:<uuid>"} verbatim',
        async () => {
          await composer(page).fill('ping from the desktop deep link');
          await sendBtn(page).click();
          await page.waitForTimeout(600);
          const mine = posts.filter((b) => b.text === 'ping from the desktop deep link');
          return {
            pass: mine.length === 1 && JSON.stringify(mine[0].target) === JSON.stringify(LIVE_DESKTOP.messageTarget),
            detail: JSON.stringify(mine.map((b) => b.target)),
          };
        });

      errs.forEach((e) => consoleErrors.push(e));
      await context.close();
    }

    // =====================================================================
    // Screenshots, both themes
    // =====================================================================
    for (const theme of ['dark', 'light']) {
      const s = await openBus(browser, {}, { url, theme });
      await openThread(s.page, { type: 'tmux', host: HOST, session: THREAD });
      await s.page.waitForTimeout(400);
      await s.page.screenshot({ path: join(OUT, `live-${theme}.png`) });
      await check(`L6-4${theme === 'dark' ? 5 : 6}`, `render the live bus in ${theme} mode`,
        `verify/l6/live-${theme}.png captured with rail, thread and composer`,
        async () => {
          const rows = await railRows(s.page).count();
          const msgs = await msgRows(s.page).count();
          const send = await sendBtn(s.page).count();
          return { pass: rows > 0 && msgs > 0 && send === 1, detail: `rail=${rows} msgs=${msgs} send=${send}` };
        });
      s.errors.forEach((e) => consoleErrors.push(e));
      s.netNoise.forEach((e) => stubbedHttpNoise.push(e));
      await s.close();
    }

    // =====================================================================
    await check('L6-47', 'across every scenario above',
      'zero console errors and zero uncaught page errors',
      () => ({
        pass: consoleErrors.length === 0,
        detail: consoleErrors.length
          ? consoleErrors.slice(0, 5).join(' | ')
          : 'clean (plus ' + stubbedHttpNoise.length + ' Chromium status lines for the 400/403/409 responses this gate stubs on purpose)',
      }));
  } finally {
    await browser.close();
    await server.close();
  }

  const report = {
    schemaVersion: 1,
    slice: 'l6',
    mode: 'live',
    capturedAt: new Date().toISOString(),
    api: 'docs/design/fleetdeck-v2/fixtures/api/ + hand-written error/empty/offline variants',
    consoleErrors,
    stubbedHttpNoise,
    total: results.length,
    passed: results.length - failures,
    allPass: failures === 0,
    results,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'live.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.passed}/${report.total} pass; allPass=${report.allPass}; console errors=${consoleErrors.length}`);
  console.log('Report: docs/design/fleetdeck-v2/verify/l6/live.json');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
