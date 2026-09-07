/**
 * fd-v2 L2 — live-mode proof.
 *
 * Serves public/ on loopback, stubs every /api/* route from the captured
 * fixtures in docs/design/fleetdeck-v2/fixtures/api/ (plus the hand-written
 * variants in ./stubs/ for the error, empty, hidden and offline states the
 * capture does not contain), drives every automatable BEHAVIOUR.md item and
 * writes live.json + live-<theme>.png into ../l2/, beside the pixel gate's own
 * report. Run the pixel gate FIRST — it republishes that directory wholesale.
 *
 * Run: node docs/design/fleetdeck-v2/verify/l2-live/live.mjs
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
/* The pixel gate republishes verify/l2/ wholesale (design-diff.mjs publish()),
 * so the harness and its stubs live next door and only the *results* land in
 * verify/l2/. Run the gate first, then this. */
const OUT = resolve(HERE, '..', 'l2');

const VIEWPORT = { width: 1440, height: 900 };
const HOLDER_TIP =
  'Open Windows App → RDP to the box as Vibe → run: wsl -e sleep infinity → close (disconnect, never sign out)';

/* logic.js renderVals(): the dark theme's tokens, quoted so a tone change here
 * is caught rather than assumed. */
const T = {
  good: 'oklch(0.83 0.15 155)',
  warn: 'oklch(0.83 0.14 80)',
  bad: 'oklch(0.73 0.17 25)',
  ink35: 'rgba(255, 255, 255, 0.35)',
};

const results = [];
let shots = {};

function record(id, action, expectation, pass, detail) {
  results.push({ id, action, expectation, pass: !!pass, detail: detail ?? null });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}${pass ? '' : ' — ' + (detail ?? '')}`);
}

async function check(id, action, expectation, fn) {
  try {
    const out = await fn();
    if (out === true || out === undefined) return record(id, action, expectation, true);
    if (out && out.pass) return record(id, action, expectation, true, out.detail);
    record(id, action, expectation, false, (out && out.detail) || `got ${JSON.stringify(out)}`);
  } catch (e) {
    record(id, action, expectation, false, e.message);
  }
}

/* ---- static server (loopback, public/ only) ------------------------------ */

async function serve() {
  const root = await realpath(PUBLIC);
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const file = await realpath(resolve(root, '.' + pathname));
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return { port: server.address().port, close: () => new Promise((d) => { server.closeAllConnections(); server.close(d); }) };
}

const json = async (dir, name) => JSON.parse(await readFile(join(dir, name), 'utf8'));

/* ---- one page, one API stub set ------------------------------------------ */

/* The L3 seam is a recorder: the shell must call openTile/openMax/connectAll,
 * and nothing else, with exactly the host and name of the row that was hit. */
function initPage({ storage, stubWindows }) {
  for (const [k, v] of Object.entries(storage)) {
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  }
  window.__l2 = { calls: [], fullScreen: false, openKeys: [], api: [] };
  window.FD = window.FD || {};
  window.FD.screens = window.FD.screens || {};
  if (stubWindows) {
    window.FD.screens.windows = {
      openTile: (h, n) => window.__l2.calls.push(['openTile', h, n]),
      openMax: (h, n) => window.__l2.calls.push(['openMax', h, n]),
      connectAll: () => window.__l2.calls.push(['connectAll']),
      isFullScreen: () => window.__l2.fullScreen,
      openKeys: () => window.__l2.openKeys,
    };
  }
}

async function open(browser, port, { routes = {}, storage = {}, stubWindows = true, query = '', theme = 'dark' } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  context.setDefaultTimeout(15000);
  const seeded = { 'fd-app-video': '0', 'fd-landing-dark': theme === 'dark' ? '1' : '0', ...storage };
  await context.addInitScript(initPage, { storage: seeded, stubWindows });

  const calls = [];
  const consoleErrors = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.pathname);
    const stub = routes[url.pathname];
    if (stub === undefined) return route.fulfill({ status: 404, body: '{}' , contentType: 'application/json' });
    if (typeof stub === 'number') return route.fulfill({ status: stub, body: 'upstream failed', contentType: 'text/plain' });
    return route.fulfill({ status: 200, body: JSON.stringify(stub), contentType: 'application/json' });
  });
  // Videos are decoration; the deck's own gate blocks them too.
  await context.route('**/*.mp4', (route) => route.abort());

  const page = await context.newPage();
  const isMedia = (u) => /\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i.test(u || '');
  page.on('console', (m) => {
    // The harness aborts the decorative videos itself; its own ERR_FAILED is not
    // a finding. Everything else counts.
    if (m.type() === 'error' && !isMedia(m.location() && m.location().url)) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(`http://127.0.0.1:${port}/v2/index.html${query}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  return { context, page, calls, consoleErrors };
}

/* Wait until the shell has pushed its three lists through FD.setData. */
async function settled(page) {
  await page.waitForFunction(() => window.FD && window.FD.fixture && window.FD.fixture.l2Groups !== undefined);
  await page.waitForFunction(() => window.FD.fixture.l2Boxes !== undefined && window.FD.fixture.l2Accounts !== undefined);
  await page.waitForTimeout(60);
}

const rows = (page) => page.locator('[data-dc-tpl="227"]');
const boxRows = (page) => page.locator('[data-dc-tpl="762"]');
const acctRows = (page) => page.locator('[data-dc-tpl="749"]');

async function main() {
  const server = await serve();
  const browser = await chromium.launch();
  const base = {
    '/api/sessions': await json(API, 'sessions.json'),
    '/api/health': await json(API, 'health.json'),
    '/api/credits': await json(API, 'credits.json'),
  };
  const stub = async (n) => json(STUBS, n);

  try {
    /* ================= A · captured fixtures ============================== */
    {
      const { context, page, calls, consoleErrors } = await open(browser, server.port, { routes: base });
      await settled(page);

      const live = base['/api/sessions'].sessions.filter((s) => s.live);
      const hosts = [...new Set(live.map((s) => s.host))];

      await check('A01-boot-loads', 'load /v2 in live mode', 'sessions, health and credits are each fetched once', () => {
        const want = ['/api/sessions', '/api/health', '/api/credits'];
        return want.every((p) => calls.filter((c) => c === p).length === 1) || { detail: JSON.stringify(calls) };
      });

      await check('A02-groups', 'render the sidebar', `one group per live host, in API order: ${hosts.join(', ')}`, async () => {
        const got = await page.locator('[data-dc-tpl="224"]').allTextContents();
        return JSON.stringify(got) === JSON.stringify(hosts) || { detail: JSON.stringify(got) };
      });

      await check('A03-counts', 'read the count chips', 'each chip is that box\'s live row count', async () => {
        const got = (await page.locator('[data-dc-tpl="225"]').allTextContents()).map(Number);
        const want = hosts.map((h) => live.filter((s) => s.host === h).length);
        return JSON.stringify(got) === JSON.stringify(want) || { detail: `${got} vs ${want}` };
      });

      await check('A04-live-only', 'count the rows', 'only live rows are listed', async () => {
        const n = await rows(page).count();
        return n === live.length || { detail: `${n} rows vs ${live.length} live` };
      });

      await check('A05-row-title', 'hover a row', '"<name> [· <label>] · active <ago>"', async () => {
        const title = await rows(page).first().getAttribute('title');
        return /^\S+ · active (just now|\d+[mhd] ago|—)$/.test(title) || { detail: title };
      });

      await check('A06-idle-dot', 'read the row dot with no tile open', `muted ${T.ink35}`, async () => {
        const bg = await page.locator('[data-dc-tpl="228"]').first().evaluate((el) => el.style.background);
        return bg === T.ink35 || { detail: bg };
      });

      await check('A07-rowmax-follows-hover',
        'hover a session row',
        'the one ⤢ button the slice owns moves over that row, outside #dc-root',
        async () => {
          const btn = page.locator('#fd-l2-rowmax');
          const hiddenFirst = await btn.isVisible();
          await rows(page).nth(3).hover();
          await page.waitForTimeout(80);
          const box = await btn.boundingBox();
          const row = await rows(page).nth(3).boundingBox();
          const inside = box && row && box.y >= row.y - 2 && box.y + box.height <= row.y + row.height + 2;
          const owned = await btn.evaluate((el) => el.closest('#dc-root') === null && el.parentElement.id === 'fd-l2-layer');
          const perRow = await page.locator('[data-fd-rowmax]').count();
          return (!hiddenFirst && inside && owned && perRow === 0)
            || { detail: `hiddenFirst=${hiddenFirst} inside=${inside} owned=${owned} perRow=${perRow}` };
        });

      await check('A08-row-click-opentile', 'click a session row', 'FD.screens.windows.openTile(host, name)', async () => {
        await page.evaluate(() => { window.__l2.calls.length = 0; });
        const first = rows(page).first();
        const [host, name] = [await first.getAttribute('data-fd-host'), await first.getAttribute('data-fd-name')];
        await first.click();
        const got = await page.evaluate(() => window.__l2.calls);
        return JSON.stringify(got) === JSON.stringify([['openTile', host, name]]) || { detail: JSON.stringify(got) };
      });

      await check('A09-row-click-openmax', 'click a row while a session is full screen', 'openMax, not openTile', async () => {
        await page.evaluate(() => { window.__l2.calls.length = 0; window.__l2.fullScreen = true; });
        const r = rows(page).nth(1);
        const [host, name] = [await r.getAttribute('data-fd-host'), await r.getAttribute('data-fd-name')];
        await r.click();
        const got = await page.evaluate(() => { window.__l2.fullScreen = false; return window.__l2.calls; });
        return JSON.stringify(got) === JSON.stringify([['openMax', host, name]]) || { detail: JSON.stringify(got) };
      });

      await check('A10-rowmax-click', 'hover a row and click ⤢', 'openMax only — the row itself is not opened as a tile', async () => {
        const r = rows(page).nth(2);
        const [host, name] = [await r.getAttribute('data-fd-host'), await r.getAttribute('data-fd-name')];
        await r.hover();
        await page.waitForTimeout(80);
        await page.evaluate(() => { window.__l2.calls.length = 0; });
        await page.locator('#fd-l2-rowmax').click();
        const got = await page.evaluate(() => window.__l2.calls);
        return JSON.stringify(got) === JSON.stringify([['openMax', host, name]]) || { detail: JSON.stringify(got) };
      });

      await check('A11-open-dot-green', 'report an open tile through openKeys()', `the row dot turns ${T.good}`, async () => {
        const r = rows(page).first();
        const [host, name] = [await r.getAttribute('data-fd-host'), await r.getAttribute('data-fd-name')];
        await page.evaluate(([h, n]) => { window.__l2.openKeys = [{ host: h, name: n }]; return window.FD.shell.refresh(); }, [host, name]);
        await page.waitForTimeout(120);
        const bg = await page.locator('[data-dc-tpl="228"]').first().evaluate((el) => el.style.background);
        await page.evaluate(() => { window.__l2.openKeys = []; return window.FD.shell.refresh(); });
        await page.waitForTimeout(120);
        return bg === T.good || { detail: bg };
      });

      await check('A12-connect-all', 'click Connect all', 'FD.screens.windows.connectAll()', async () => {
        await page.evaluate(() => { window.__l2.calls.length = 0; });
        await page.locator('[data-dc-tpl="217"]').click();
        const got = await page.evaluate(() => window.__l2.calls);
        return JSON.stringify(got) === JSON.stringify([['connectAll']]) || { detail: JSON.stringify(got) };
      });

      await check('A13-refresh', 'click Refresh', 'sessions + health + credits reload, and nothing else', async () => {
        const before = calls.length;
        await page.locator('[data-dc-tpl="241"]').click();
        await page.waitForTimeout(400);
        const fresh = calls.slice(before).sort();
        return JSON.stringify(fresh) === JSON.stringify(['/api/credits', '/api/health', '/api/sessions']) || { detail: JSON.stringify(fresh) };
      });

      await check('A14-boxes', 'read the right-rail Boxes list', 'one row per host with today\'s status words', async () => {
        const names = await page.locator('[data-dc-tpl="764"]').allTextContents();
        const sts = await page.locator('[data-dc-tpl="765"]').allTextContents();
        return JSON.stringify([names, sts]) === JSON.stringify([['german-box', 'onboarding-box'], ['holder OK', 'reachable']])
          || { detail: JSON.stringify([names, sts]) };
      });

      await check('A15-box-tip', 'hover the german-box row', 'the holder tip, verbatim', async () => {
        const tip = await boxRows(page).first().getAttribute('title');
        return tip === HOLDER_TIP || { detail: tip };
      });

      await check('A16-accounts', 'read the right-rail Accounts bars', 'one row per credits row, first-name label', async () => {
        const names = await page.locator('[data-dc-tpl="755"]').allTextContents();
        const want = base['/api/credits'].rows.map((r) => String(r.label || r.email || r.id).split(' ')[0] + (r.kind === 'codex' ? ' ·gpt' : ''));
        return JSON.stringify(names) === JSON.stringify(want) || { detail: JSON.stringify(names) };
      });

      await check('A17-account-tip', 'hover an account row', 'label · email, then the highest window', async () => {
        const tip = await acctRows(page).first().getAttribute('title');
        const r = base['/api/credits'].rows[0];
        return tip.startsWith(`${r.label} · ${r.email}\nhighest window `) || { detail: tip };
      });

      await check('A18-live-api-default', 'read the page-header pill', '"Live API" until L5 says otherwise', async () => {
        const txt = await page.locator('[data-dc-tpl="239"]').textContent();
        return txt.trim() === 'Live API' || { detail: txt };
      });

      await check('A19-set-live-api', 'FD.shell.setLiveApi("fixture · org")', 'the pill carries the source badge (ruling O4)', async () => {
        await page.evaluate(() => window.FD.shell.setLiveApi('fixture · org'));
        await page.waitForTimeout(60);
        const txt = await page.locator('[data-dc-tpl="239"]').textContent();
        await page.evaluate(() => window.FD.shell.setLiveApi(null));
        return txt.trim() === 'fixture · org' || { detail: txt };
      });

      await check('A20-set-badge', 'FD.shell.setBadge(7)', 'the sidebar nav badge reads 7', async () => {
        await page.evaluate(() => window.FD.shell.setBadge(7));
        await page.waitForTimeout(80);
        const txt = await page.locator('[data-dc-tpl="187"]').first().textContent();
        return txt.trim() === '7' || { detail: txt };
      });

      await check('A21-badge-zero', 'FD.shell.setBadge(0)', 'the badge disappears', async () => {
        await page.evaluate(() => window.FD.shell.setBadge(0));
        await page.waitForTimeout(80);
        const n = await page.locator('[data-dc-tpl="187"]').count();
        return n === 0 || { detail: `${n} badges still rendered` };
      });

      await check('A22-theme-attrs', 'read the document element', 'data-theme and color-scheme follow the stored theme', async () => {
        const got = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.style.colorScheme]);
        return JSON.stringify(got) === JSON.stringify(['dark', 'dark']) || { detail: JSON.stringify(got) };
      });

      await check('A23-theme-toggle-title', 'hover the sidebar theme toggle in dark', '"Switch to light theme", aria-pressed=false', async () => {
        const btn = page.locator('[data-dc-tpl="132"]');
        const got = [await btn.getAttribute('title'), await btn.getAttribute('aria-pressed')];
        return JSON.stringify(got) === JSON.stringify(['Switch to light theme', 'false']) || { detail: JSON.stringify(got) };
      });

      await check('A24-theme-toggle-flips', 'click the theme toggle', 'fd-landing-dark flips and the attributes follow', async () => {
        await page.locator('[data-dc-tpl="132"]').click();
        await page.waitForTimeout(120);
        const got = await page.evaluate(() => [localStorage.getItem('fd-landing-dark'), document.documentElement.dataset.theme,
          document.querySelector('[data-dc-tpl="132"]').title]);
        await page.locator('[data-dc-tpl="132"]').click();
        await page.waitForTimeout(120);
        return JSON.stringify(got) === JSON.stringify(['0', 'light', 'Switch to dark theme']) || { detail: JSON.stringify(got) };
      });

      await check('A25-no-poll', 'idle for 2.5 s', 'the shell never polls — no timer for sessions, health or credits', async () => {
        const before = calls.length;
        await page.waitForTimeout(2500);
        return calls.length === before || { detail: JSON.stringify(calls.slice(before)) };
      });

      shots.dark = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });

      await check('A26-console-clean', 'watch the console for the whole run', 'zero console errors and zero page errors', () =>
        consoleErrors.length === 0 || { detail: consoleErrors.join(' | ') });

      await context.close();
    }

    /* ================= B · hidden rows ==================================== */
    {
      const sessions = await stub('sessions-hidden.json');
      const { context, page, consoleErrors } = await open(browser, server.port, {
        routes: { ...base, '/api/sessions': sessions },
      });
      await settled(page);

      await check('B01-hidden-excluded', 'load with two hidden rows and showHidden off', 'hidden rows stay out of the list', async () => {
        const names = await page.locator('[data-dc-tpl="229"]').allTextContents();
        return !names.includes('FD-retired') && names.length === 3 || { detail: JSON.stringify(names) };
      });

      await check('B02-dead-excluded', 'check a not-live row', 'a dead row is never listed', async () => {
        const names = await page.locator('[data-dc-tpl="229"]').allTextContents();
        return !names.includes('FD-dead') || { detail: JSON.stringify(names) };
      });

      await check('B03-toggle-text', 'read the hidden toggle', '"show 2 hidden"', async () => {
        const txt = await page.locator('[data-fd-hidden-toggle]').textContent();
        return txt === 'show 2 hidden' || { detail: txt };
      });

      await check('B04-toggle-click', 'click the toggle', 'hidden rows appear, text becomes "hide hidden", showHidden = 1', async () => {
        await page.locator('[data-fd-hidden-toggle]').click();
        await page.waitForTimeout(250);
        const names = await page.locator('[data-dc-tpl="229"]').allTextContents();
        const txt = await page.locator('[data-fd-hidden-toggle]').textContent();
        const stored = await page.evaluate(() => localStorage.getItem('showHidden'));
        return (names.includes('FD-retired') && txt === 'hide hidden' && stored === '1')
          || { detail: JSON.stringify([names, txt, stored]) };
      });

      await check('B05-hidden-dim', 'inspect a shown hidden row', 'it renders dimmed, as .session.inactive does today', async () => {
        const op = await page.locator('[data-dc-tpl="227"][data-fd-name="FD-retired"]').evaluate((el) => el.style.opacity);
        return op === '0.45' || { detail: op };
      });

      await check('B06-kill-dot', 'inspect the kill-requested row', `an amber dot ${T.warn}`, async () => {
        const bg = await page.locator('[data-dc-tpl="227"][data-fd-name="FD-v2-l3"] [data-dc-tpl="228"]').evaluate((el) => el.style.background);
        return bg === T.warn || { detail: bg };
      });

      await check('B07-label-in-title', 'hover the row that carries a registry label', 'name · label · active <ago>', async () => {
        const title = await page.locator('[data-dc-tpl="227"][data-fd-name="FD-v2-l2"]').getAttribute('title');
        return /^FD-v2-l2 · fd-v2 L2 shell · active /.test(title) || { detail: title };
      });

      await check('B08-console-clean', 'watch the console', 'zero console errors', () =>
        consoleErrors.length === 0 || { detail: consoleErrors.join(' | ') });

      await context.close();
    }

    /* showHidden persisted across a load */
    {
      const { context, page } = await open(browser, server.port, {
        routes: { ...base, '/api/sessions': await stub('sessions-hidden.json') },
        storage: { showHidden: '1' },
      });
      await settled(page);
      await check('B09-showhidden-persisted', 'reload with showHidden = 1', 'hidden rows are listed from the first paint', async () => {
        const names = await page.locator('[data-dc-tpl="229"]').allTextContents();
        return names.includes('FD-retired') || { detail: JSON.stringify(names) };
      });
      await context.close();
    }

    /* ================= C · errors and empty =============================== */
    {
      const { context, page } = await open(browser, server.port, {
        routes: { ...base, '/api/sessions': await stub('sessions-errors.json') },
      });
      await settled(page);
      await check('C01-error-rows', 'answer /api/sessions with two host errors', 'one row per error, "<host>: <message>"', async () => {
        const txt = await page.locator('#fd-l2-listfoot div').allTextContents();
        return JSON.stringify(txt) === JSON.stringify([
          'german-box: ssh: connect to host german-box port 22: Connection refused',
          'onboarding-box: tmux not running',
        ]) || { detail: JSON.stringify(txt) };
      });
      await check('C02-no-no-sessions', 'with errors present', '"no sessions" is not added on top', async () => {
        const txt = await page.locator('#fd-l2-listfoot div').allTextContents();
        return !txt.includes('no sessions') || { detail: JSON.stringify(txt) };
      });
      await context.close();
    }
    {
      const { context, page } = await open(browser, server.port, {
        routes: { ...base, '/api/sessions': await stub('sessions-empty.json') },
      });
      await settled(page);
      await check('C03-no-sessions', 'answer /api/sessions with nothing at all', 'the list reads "no sessions"', async () => {
        const txt = await page.locator('#fd-l2-listfoot div').allTextContents();
        return JSON.stringify(txt) === JSON.stringify(['no sessions']) || { detail: JSON.stringify(txt) };
      });
      await check('C04-empty-state',
        'open the Windows screen and empty the tile grid (L3 still renders the mock\'s four seed tiles)',
        'the operator\'s new empty-state copy appears, and goes again as soon as a tile is there',
        async () => {
          await page.locator('aside button[title="Windows"]').click();
          await page.locator('[data-screen-label="Windows"]').waitFor({ state: 'visible' });
          const before = await page.locator('#fd-l2-empty').isVisible();
          await page.evaluate(() => {
            document.querySelectorAll('[data-dc-tpl="250"]').forEach((el) => el.remove());
            window.FD.shell.setLiveApi(null);   // repaint without a re-render
          });
          await page.waitForTimeout(80);
          const txt = await page.locator('#fd-l2-empty').textContent();
          return (before === false && txt === 'There are no sessions yet, open a new session via an orchestrator first.')
            || { detail: `before=${before} txt=${txt}` };
        });
      await context.close();
    }

    {
      const { context, page } = await open(browser, server.port, {
        routes: { ...base, '/api/sessions': await stub('sessions-unkeyable.json') },
      });
      await settled(page);
      await check('C05-unkeyable-rows',
        'answer /api/sessions with three live rows that have no host or no name',
        'none reaches FD.setData, and "no sessions" still shows rather than an empty list',
        async () => {
          const rowCount = await rows(page).count();
          const groups = await page.evaluate(() => window.FD.fixture.l2Groups);
          const txt = await page.locator('#fd-l2-listfoot div').allTextContents();
          return (rowCount === 0 && Array.isArray(groups) && groups.length === 0
                  && JSON.stringify(txt) === JSON.stringify(['no sessions']))
            || { detail: `rows=${rowCount} groups=${JSON.stringify(groups)} foot=${JSON.stringify(txt)}` };
        });
      await context.close();
    }

    /* ================= D · health branches ================================ */
    {
      const { context, page } = await open(browser, server.port, {
        routes: { ...base, '/api/health': await stub('health-branches.json') },
      });
      await settled(page);
      await check('D01-health-texts', 'answer /api/health with every branch', 'the five status words of app.js:112-129, in order', async () => {
        const names = await page.locator('[data-dc-tpl="764"]').allTextContents();
        const sts = await page.locator('[data-dc-tpl="765"]').allTextContents();
        return JSON.stringify([names, sts]) === JSON.stringify([
          ['mac', 'onboarding-box', 'lab-box', 'quiet-box', 'german-box'],
          ['1Password locked', 'unreachable', 'reachable', 'unreachable', 'HOLDER DOWN'],
        ]) || { detail: JSON.stringify([names, sts]) };
      });
      await check('D02-health-tones', 'read the dots', 'warn · bad · good · warn · bad', async () => {
        const got = await page.locator('[data-dc-tpl="763"]').evaluateAll((els) => els.map((e) => e.style.background));
        return JSON.stringify(got) === JSON.stringify([T.warn, T.bad, T.good, T.warn, T.bad]) || { detail: JSON.stringify(got) };
      });
      await check('D03-health-tips', 'hover each row', 'the four tips of app.js, verbatim', async () => {
        const got = await boxRows(page).evaluateAll((els) => els.map((e) => e.getAttribute('title')));
        return JSON.stringify(got) === JSON.stringify([
          'Unlock 1Password on this Mac, then Refresh',
          'ssh to this Linux host failed — network or key',
          'ssh + tmux answered on this Linux host',
          'ssh to the box failed — network or 1Password',
          HOLDER_TIP,
        ]) || { detail: JSON.stringify(got) };
      });
      await context.close();
    }
    {
      const { context, page } = await open(browser, server.port, { routes: { ...base, '/api/health': 500 } });
      await settled(page);
      await check('D04-health-unreachable', 'answer /api/health with a 500', 'one red "health unreachable" row', async () => {
        const names = await page.locator('[data-dc-tpl="764"]').allTextContents();
        const bg = await page.locator('[data-dc-tpl="763"]').first().evaluate((el) => el.style.background);
        return (JSON.stringify(names) === JSON.stringify(['health unreachable']) && bg === T.bad) || { detail: JSON.stringify([names, bg]) };
      });
      await context.close();
    }

    /* ================= E · credits variants =============================== */
    {
      const { context, page } = await open(browser, server.port, {
        routes: { ...base, '/api/credits': await stub('credits-variants.json') },
      });
      await settled(page);
      await check('E01-pct-rule', 'answer /api/credits with mixed windows', 'the highest window wins; codex reads its own fields', async () => {
        const got = await page.locator('[data-dc-tpl="756"]').allTextContents();
        return JSON.stringify(got) === JSON.stringify(['95%', '€71%', '—', '80%']) || { detail: JSON.stringify(got) };
      });
      await check('E02-red-over-90', 'a window past 90 %', `the bar turns ${T.bad}`, async () => {
        const bg = await page.locator('[data-dc-tpl="758"]').first().evaluate((el) => el.style.background);
        return bg === T.bad || { detail: bg };
      });
      await check('E03-amber-over-70', 'a window at 71 %', `the bar is ${T.warn}`, async () => {
        const bg = await page.locator('[data-dc-tpl="758"]').nth(1).evaluate((el) => el.style.background);
        return bg === T.warn || { detail: bg };
      });
      await check('E04-null-pct', 'an account with no window at all', 'the cell reads "—" and the bar is empty', async () => {
        const w = await page.locator('[data-dc-tpl="758"]').nth(2).evaluate((el) => el.style.width);
        return w === '0%' || { detail: w };
      });
      await check('E05-capped-flag', 'an account whose credit pool is spent',
        'the € marks that value and no other — no node is added to the compiled row', async () => {
          const got = await page.locator('[data-dc-tpl="756"]').allTextContents();
          return (got.filter((v) => v.includes('€')).length === 1 && got[1].startsWith('€'))
            || { detail: JSON.stringify(got) };
        });
      await check('E06-codex-suffix', 'the codex account', 'its label carries the " ·gpt" suffix', async () => {
        const txt = await page.locator('[data-dc-tpl="755"]').nth(3).textContent();
        return txt === 'Daniel ·gpt' || { detail: txt };
      });
      await check('E07-credit-tip', 'hover the capped account', 'the tooltip quotes used / limit and the source', async () => {
        const tip = await acctRows(page).nth(1).getAttribute('title');
        return tip.includes('credits 9 / 9 EUR') && tip.includes('source: oauth') || { detail: tip };
      });
      await context.close();
    }
    {
      const { context, page } = await open(browser, server.port, { routes: { ...base, '/api/credits': 500 } });
      await settled(page);
      await check('E08-accounts-unavailable', 'answer /api/credits with a 500', 'the rail reads "accounts unavailable"', async () => {
        const txt = await page.locator('[data-dc-tpl="755"]').allTextContents();
        return JSON.stringify(txt) === JSON.stringify(['accounts unavailable']) || { detail: JSON.stringify(txt) };
      });
      await context.close();
    }

    /* ================= F · theme migration and fixture mode =============== */
    {
      const { context, page } = await open(browser, server.port, {
        routes: base, storage: { 'fd-landing-dark': null, fleetTheme: 'light' },
      });
      await settled(page);
      await check('F01-theme-migration', 'boot with only the legacy fleetTheme = light', 'fd-landing-dark becomes 0 and the page is light (D06)', async () => {
        const got = await page.evaluate(() => [localStorage.getItem('fd-landing-dark'), document.documentElement.dataset.theme]);
        return JSON.stringify(got) === JSON.stringify(['0', 'light']) || { detail: JSON.stringify(got) };
      });
      shots.light = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
      await context.close();
    }
    {
      // Today's app holds ?theme= in a variable and only the toggle writes
      // storage (app.js:11-20 vs 60-63). The stored choice must survive.
      const { context, page } = await open(browser, server.port, {
        routes: base, storage: { 'fd-landing-dark': '1' }, query: '?theme=light',
      });
      await settled(page);
      await check('F05-url-theme-wins', 'load with ?theme=light over a stored dark', 'the page is light for this visit', async () => {
        const got = await page.evaluate(() => document.documentElement.dataset.theme);
        return got === 'light' || { detail: got };
      });
      await check('F06-url-theme-not-persisted', 'read storage after ?theme=light', 'fd-landing-dark is still the stored 1', async () => {
        const got = await page.evaluate(() => localStorage.getItem('fd-landing-dark'));
        return got === '1' || { detail: got };
      });
      await check('F07-toggle-still-wins', 'click the theme toggle after a URL override', 'the toggle takes over and does persist', async () => {
        await page.locator('[data-dc-tpl="132"]').click();
        await page.waitForTimeout(150);
        const got = await page.evaluate(() => [localStorage.getItem('fd-landing-dark'), document.documentElement.dataset.theme]);
        return JSON.stringify(got) === JSON.stringify(['1', 'dark']) || { detail: JSON.stringify(got) };
      });
      await context.close();
    }
    {
      const { context, page, calls, consoleErrors } = await open(browser, server.port, { routes: base, query: '?fixture=1' });
      await page.waitForTimeout(800);
      await check('F02-fixture-inert', 'load with ?fixture=1', 'the shell fetches nothing and loads no data layer', async () => {
        const loaded = await page.evaluate(() => !!(window.FD && window.FD.data));
        return (calls.length === 0 && !loaded) || { detail: `calls=${JSON.stringify(calls)} data=${loaded}` };
      });
      await check('F03-fixture-untouched', 'read the sidebar in fixture mode', 'the mock\'s own seed groups still render', async () => {
        const boxes = await page.locator('[data-dc-tpl="224"]').allTextContents();
        return JSON.stringify(boxes) === JSON.stringify(['onboarding-box', 'german-box']) || { detail: JSON.stringify(boxes) };
      });
      await check('F04-fixture-console', 'watch the console in fixture mode', 'zero console errors', () =>
        consoleErrors.length === 0 || { detail: consoleErrors.join(' | ') });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  await mkdir(OUT, { recursive: true });
  if (shots.dark) await writeFile(join(OUT, 'live-dark.png'), shots.dark);
  if (shots.light) await writeFile(join(OUT, 'live-light.png'), shots.light);

  const allPass = results.every((r) => r.pass);
  await writeFile(join(OUT, 'live.json'), JSON.stringify({
    schemaVersion: 1, slice: 'l2', mode: 'live',
    capturedAt: new Date().toISOString(),
    harness: 'docs/design/fleetdeck-v2/verify/l2-live/live.mjs',
    apiFixtures: 'docs/design/fleetdeck-v2/fixtures/api + docs/design/fleetdeck-v2/verify/l2-live/stubs',
    total: results.length, passed: results.filter((r) => r.pass).length, allPass, results,
  }, null, 2) + '\n');

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass; allPass=${allPass}`);
  process.exit(allPass ? 0 : 1);
}

main();
