// Fixture-only browser acceptance. Optional external Playwright installation; npm test
// stays dependency-free. Run with PLAYWRIGHT_MODULE=/path/to/playwright node this-file.
// Binds an ephemeral loopback port, never starts server.js or contacts the live deck.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.join(__dirname, '..');
const CLI = '22222222-2222-4222-8222-222222222222';
const now = Date.now();
const session = (id, title, changes = {}) => ({
  id, title, cwd: '/workspace/remote-system', worktree: '/workspace/remote-system/.worktrees/sessions',
  branch: 'agent-desktop-sessions-page', model: 'claude-opus-4-6', completedTurns: 12,
  createdAt: new Date(now - 86400000).toISOString(), lastActivityAt: new Date(now - 120000).toISOString(),
  cliSessionId: CLI, isArchived: false, live: false, liveState: 'offline',
  messageTarget: null, liveName: null, stale: false, ...changes,
});
const group = (account, machine, label, sessions) => ({
  accountUuid: account.repeat(8) + '-1111-4111-8111-111111111111',
  orgUuid: account.repeat(8) + '-2222-4222-8222-222222222222',
  machine, label, email: label.toLowerCase().replaceAll(' ', '.') + '@example.invalid', sessions,
});
const target = { type: 'claude-desktop', session: 'id:' + CLI };
const initial = {
  machines: [
    { id: 'macbook', label: 'MacBook Pro', state: 'ok', local: true, collected_at: now, stale: false },
    { id: 'german-box', label: 'german-box', state: 'ok', local: false, collected_at: now, stale: false },
  ],
  groups: [
    group('1', 'macbook', 'Reiner Garrecht', [
      session('local_one', 'Desktop sessions merge', { live: true, liveState: 'live', messageTarget: target, liveName: 'Immina' }),
      session('local_two', 'Machines usage history', { isArchived: true, branch: 'feature/usage', completedTurns: 28 }),
    ]),
    group('2', 'macbook', 'Lafayette Tabor', [session('local_three', 'Review SSH routing', { branch: 'feature/ssh-routes' })]),
    group('3', 'macbook', 'Daniel Tabor', [session('local_four', '<img src=x onerror="window.fixtureXss=true">', { completedTurns: 0 })]),
    group('4', 'german-box', 'Aylin Yeter', [session('local_five', 'Windows onboarding', { liveState: 'unknown', cwd: 'C:\\Users\\Fixture\\work', worktree: null })]),
  ], collecting: false, collected_at: now, ttl_ms: 300000,
};
let data = structuredClone(initial), failLoad = false, failSend = false, holdMessage = null;
const messages = [], paths = [];
const assets = new Map(['/sessions.html', '/sessions.js', '/style.css', '/index.html'].map((p) => [p, path.join(ROOT, 'public', p)]));
const server = http.createServer(async (req, res) => {
  paths.push(req.url);
  if (req.url.startsWith('/api/desktop-sessions')) {
    res.writeHead(failLoad ? 503 : 200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }
  if (req.url === '/api/messages' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    messages.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (holdMessage) { holdMessage(res); holdMessage = null; return; }
    return res.end(JSON.stringify({ ok: !failSend }));
  }
  const asset = assets.get(req.url.split('?')[0]);
  if (!asset) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : asset.endsWith('.js') ? 'text/javascript' : 'text/html' });
  res.end(fs.readFileSync(asset));
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = 'http://127.0.0.1:' + server.address().port;
    await page.goto(url + '/sessions.html');
    await page.waitForFunction(() => document.getElementById('sessions-count').textContent === '5 of 5 sessions · 1 live');
    check(await page.locator('.desktop-group').count() === 4, 'four account+machine groups');
    check(await page.locator('tbody tr').count() === 5, 'all sessions render');
    check(await page.locator('.desktop-title img').count() === 0 && !await page.evaluate(() => window.fixtureXss), 'HTML-like title stays text');
    await page.selectOption('#sessions-account', initial.groups[0].accountUuid + ':' + initial.groups[0].orgUuid);
    check(await page.locator('tbody tr').count() === 2, 'account filter');
    await page.selectOption('#sessions-archived', 'archived');
    check(await page.locator('tbody tr').count() === 1 && await page.locator('.desktop-title').textContent() === 'Machines usage history', 'account+archive intersection');
    await page.click('#sessions-reset');
    await page.selectOption('#sessions-machine', 'german-box');
    check(await page.locator('tbody tr').count() === 1 && await page.locator('.desktop-title').textContent() === 'Windows onboarding', 'machine filter');
    await page.selectOption('#sessions-live', 'live');
    check(await page.locator('tbody tr').count() === 0 && /No sessions match/.test(await page.locator('.desktop-empty').textContent()), 'empty filtered result');
    await page.click('#sessions-reset');
    await page.fill('#sessions-search', 'feature/ssh');
    check(await page.locator('tbody tr').count() === 1, 'search matches branch');
    await page.click('#sessions-reset');
    await page.selectOption('#sessions-live', 'unknown');
    check(await page.locator('tbody tr').count() === 1, 'unknown live filter');
    await page.click('#sessions-reset');
    await page.getByRole('button', { name: 'Message Desktop sessions merge', exact: true }).click();
    await page.fill('#composer-text', 'Fixture-only browser message');
    await page.click('#composer-send');
    await page.waitForFunction(() => document.getElementById('composer-status').textContent === 'Message delivered.');
    check(messages.length === 1 && messages[0].target.session === 'id:' + CLI && messages[0].source === 'desktop-sessions-page', 'message action addresses the exact CLI ID');
    check(await page.inputValue('#composer-text') === '', 'successful delivery clears draft');
    const refresh = async () => {
      await page.click('#sessions-refresh');
      await page.waitForFunction(() => !document.getElementById('sessions-refresh').disabled);
    };
    const deferredResponse = new Promise((resolve) => { holdMessage = resolve; });
    await page.fill('#composer-text', 'Delivered while session exits');
    await page.click('#composer-send');
    const response = await deferredResponse;
    data.groups[0].sessions[0].live = false;
    data.groups[0].sessions[0].messageTarget = null;
    data.groups[0].sessions[0].liveState = 'offline';
    await refresh();
    response.end(JSON.stringify({ ok: true }));
    await page.waitForFunction(() => !document.getElementById('composer-text').disabled);
    check(await page.locator('#composer-status').textContent() === 'Message delivered.' &&
      await page.inputValue('#composer-text') === '' && await page.isDisabled('#composer-send'),
    'offline refresh during a successful send preserves the delivery outcome');
    data = structuredClone(initial);
    await refresh();
    failSend = true;
    await page.fill('#composer-text', 'Keep this draft');
    await page.click('#composer-send');
    await page.waitForFunction(() => document.getElementById('composer-status').textContent.includes('could not be delivered'));
    check(await page.inputValue('#composer-text') === 'Keep this draft', 'failed delivery keeps draft');
    data.groups[0].sessions[0].live = false;
    data.groups[0].sessions[0].messageTarget = null;
    data.groups[0].sessions[0].liveState = 'offline';
    await refresh();
    check(await page.isDisabled('#composer-send') && await page.inputValue('#composer-text') === 'Keep this draft', 'session exit disables messaging without losing draft');
    await page.click('#composer-close');
    failLoad = true;
    await refresh();
    check(await page.locator('tbody tr').count() === 5 && /last view/.test(await page.locator('#sessions-errors').textContent()), 'failed refresh retains visible sessions');
    failLoad = false;
    data = structuredClone(initial);
    data.groups[2].sessions[0].title = 'Session metadata audit';
    data.machines[1].state = 'unavailable';
    data.machines[1].stale = true;
    data.groups[3].sessions[0].stale = true;
    await refresh();
    check(/german-box: Collection failed/.test(await page.locator('#sessions-errors').textContent()), 'remote failure is visible');
    data = structuredClone(initial);
    data.groups[2].sessions[0].title = 'Session metadata audit';
    await refresh();
    const output = process.env.DESKTOP_SCREENSHOT_DIR;
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'desktop-dark.png'), fullPage: true });
    }
    await page.click('#sessions-theme');
    check(await page.getAttribute('html', 'data-theme') === 'light', 'theme toggles');
    if (output) await page.screenshot({ path: path.join(output, 'desktop-light.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no page-level horizontal overflow');
    check(await page.locator('.desktop-table-wrap').first().evaluate((node) => node.scrollWidth > node.clientWidth), 'mobile table scroll stays within its own region');
    if (output) await page.screenshot({ path: path.join(output, 'mobile-light.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    data.groups = [];
    await refresh();
    check(/No Desktop sessions collected/.test(await page.locator('.desktop-empty').textContent()), 'first-use empty state');
    check(paths.some((p) => p === '/api/desktop-sessions?refresh=1'), 'explicit refresh bypasses TTL');
    check(errors.length === 0, 'no browser exceptions: ' + errors.join(', '));
    console.log(checks + ' browser acceptance checks passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
