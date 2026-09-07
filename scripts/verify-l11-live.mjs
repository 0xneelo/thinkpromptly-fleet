#!/usr/bin/env node
/**
 * L11 live-mode proof. Boots a real fleetdeck on an ephemeral loopback port with
 * its own database, stubs every /api/* call with the responses captured from the
 * live deck (docs/design/fleetdeck-v2/fixtures/api/), and drives the cut-over
 * behaviour in a real browser: the three view routes, the five legacy redirects,
 * fixture-mode survival, the kept pages and the deleted ones.
 *
 * Writes docs/design/fleetdeck-v2/verify/l11/live.json and live-<theme>.png.
 * Run AFTER the pixel gate: that gate republishes the whole verify/l11 directory.
 *
 * Never starts the operator's deck: its own port, its own FLEET_DB, no reaper.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = join(ROOT, 'docs/design/fleetdeck-v2');
const API = join(DESIGN, 'fixtures/api');
const OUT = join(DESIGN, 'verify/l11');
const THEMES = ['dark', 'light'];

// Every /api path the screens call, mapped to the response captured from the deck.
// A path with no fixture answers an empty object rather than reaching the network.
const FIXTURES = {
  '/api/sessions': 'sessions', '/api/health': 'health', '/api/seats': 'seats',
  '/api/credits': 'credits', '/api/machines': 'machines', '/api/messages': 'messages',
  '/api/sshkeys': 'sshkeys', '/api/ghtrain': 'ghtrain', '/api/desktop-sessions': 'desktop-sessions',
};

const results = [];
const record = (id, action, expectation, pass, detail) => {
  results.push({ id, action, expectation, pass, ...(detail ? { detail } : {}) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${expectation}${pass ? '' : ' -- ' + detail}`);
};

async function startServer() {
  const dir = await mkdtemp(join(tmpdir(), 'l11-live-'));
  const hosts = join(dir, 'hosts.json');
  await writeFile(hosts, '[]');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), FLEET_DB: join(dir, 'fleet.db'),
      FLEET_HOSTS_FILE: hosts, FLEET_TAILNET_BIND: '127.0.0.2',
      FLEET_TAILNET_HOST: '127.0.0.2:' + port, FLEET_NO_REAPER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', c => (log += c));
  child.stderr.on('data', c => (log += c));
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('server did not start:\n' + log)), 15000);
    const poll = setInterval(() => {
      if (!/tailnet broker http/.test(log)) return;
      clearTimeout(timer); clearInterval(poll); done();
    }, 20);
    child.on('exit', code => { clearTimeout(timer); clearInterval(poll); fail(new Error('server exited ' + code + ':\n' + log)); });
  });
  return { url: `http://127.0.0.1:${port}`, stop: () => child.kill('SIGKILL') };
}

// Follows nothing: reports exactly what the server answered for one URL.
async function hop(request, url) {
  const response = await request.get(url, { maxRedirects: 0 });
  return { status: response.status(), location: response.headers()['location'] ?? null };
}

const server = await startServer();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // --- routes, asserted on the wire -----------------------------------------
  const wire = [
    ['R1', '/', 302, '/?view=land', 'the root redirects once to the landing view'],
    ['R2', '/app', 200, null, '/app serves the shell with no redirect'],
    ['R3', '/deck', 302, '/deck?view=deck', '/deck redirects once to the deck view'],
    ['R4', '/index.html', 302, '/app#windows', 'the old deck page reaches the Windows screen'],
    ['R5', '/keys.html', 302, '/app#keys', 'the old keys page reaches the SSH keys screen'],
    ['R6', '/accounts.html', 302, '/app#accounts', 'the old accounts page reaches the Accounts screen'],
    ['R7', '/machines.html', 302, '/app#machines', 'the old machines page reaches the Machines screen'],
    ['R8', '/sessions.html', 302, '/app#desktop', 'the old sessions page reaches the Desktop sessions screen'],
    ['R9', '/?fixture=1', 302, '/?fixture=1&view=land', 'fixture mode survives the landing redirect'],
    ['R10', '/v2/', 200, null, '/v2/ still serves the shell the design gate captures'],
    ['R11', '/board.html', 200, null, 'board.html is kept'],
    ['R12', '/orgchart-m11.fixture.json', 200, null, 'the org chart fixture is kept'],
    ['R13', '/style.css', 404, null, 'a deleted asset is gone, not redirected'],
    ['R14', '/orgchart.js', 404, null, 'the duplicated org chart is gone'],
  ];
  for (const [id, path, status, location, expectation] of wire) {
    const got = await hop(context.request, server.url + path);
    const pass = got.status === status && got.location === location;
    record(id, `GET ${path}`, expectation, pass,
      pass ? null : `expected ${status}${location ? ' -> ' + location : ''}, got ${got.status}${got.location ? ' -> ' + got.location : ''}`);
  }

  // --- the shell renders on stubbed live data, in both themes ---------------
  for (const theme of THEMES) {
    const page = await context.newPage({ colorScheme: theme });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    // Every API call is answered from the captured fixtures, so no screen can
    // reach the real fleet and no screen is left waiting on a dead endpoint.
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const name = FIXTURES[path];
      const body = name && existsSync(join(API, name + '.json'))
        ? await readFile(join(API, name + '.json'), 'utf8') : '{}';
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const response = await page.goto(server.url + '/app', { waitUntil: 'domcontentloaded' });
    record(`L1-${theme}`, 'GET /app on stubbed live data', `/app answers 200 in ${theme}`,
      response?.status() === 200, `status ${response?.status()}`);
    // The server half of D20 is proved by R1-R3 above. The client half -- the shell
    // seeding its view from FD.router instead of props.startView (logic.js:1053) --
    // belongs to the shell slice, so this check stays red until that lands.
    await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible', timeout: 30000 })
      .then(() => record(`L2-${theme}`, 'render /app', `the deck renders in ${theme}`, true))
      .catch(e => record(`L2-${theme}`, 'render /app', `the deck renders in ${theme}`, false,
        'the shell ignores ?view= and always shows land (logic.js:1053 reads props.startView, not FD.router); needs the shell slice. ' + e.message.split('\n')[0]));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `live-${theme}.png`), animations: 'disabled', caret: 'hide' });
    const markers = await page.locator('.sc-has-error, .sc-logic-error, .sc-placeholder-error').count();
    record(`L3-${theme}`, 'inspect the runtime', `no runtime error marker in ${theme}`, markers === 0, `${markers} marker(s)`);
    record(`L4-${theme}`, 'collect console output', `zero console errors in ${theme}`,
      errors.length === 0, [...new Set(errors)].join('; '));
    await page.close();
  }

  // --- every screen, once, against a real server's own API ------------------
  // No stubbing here: this is the deck talking to server.js on an empty fleet, which
  // is what an operator sees on a cold box. The bar is that each screen renders and
  // logs nothing to console.error -- empty data is a legitimate answer, a throw is not.
  const SCREENS = ['windows', 'org', 'registry', 'bus', 'keys', 'accounts', 'machines', 'desktop'];
  const page = await context.newPage({ colorScheme: 'dark' });
  const seen = [];
  page.on('pageerror', error => seen.push(error.message));
  page.on('console', message => { if (message.type() === 'error') seen.push(message.text()); });
  for (const screen of SCREENS) {
    const before = seen.length;
    await page.goto(`${server.url}/app#${screen}`, { waitUntil: 'domcontentloaded' });
    let rendered = true, why = null;
    try {
      await page.locator('[data-fd-view="app"]').waitFor({ state: 'visible', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
    } catch (error) { rendered = false; why = error.message.split('\n')[0]; }
    await page.screenshot({ path: join(OUT, `live-${screen}.png`), animations: 'disabled', caret: 'hide' });
    record(`S-${screen}`, `GET /app#${screen} against the real API`,
      `the ${screen} screen renders and logs no console error`,
      rendered && seen.length === before,
      why || [...new Set(seen.slice(before))].join('; '));
  }
  await page.close();
} finally {
  await browser.close();
  server.stop();
}

await mkdir(OUT, { recursive: true });
const report = {
  schemaVersion: 1, slice: 'l11', mode: 'live-stubbed', capturedAt: new Date().toISOString(),
  apiFixtures: 'docs/design/fleetdeck-v2/fixtures/api/',
  results, allPass: results.every(r => r.pass), passed: results.filter(r => r.pass).length, total: results.length,
};
await writeFile(join(OUT, 'live.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nlive.json: ${report.passed}/${report.total}; allPass=${report.allPass}`);
process.exit(report.allPass ? 0 : 1);
