#!/usr/bin/env node
/**
 * fd-v2 L3 live-mode gate (DECK-42).
 *
 * Runs the Windows screen in LIVE mode — no ?fixture=1 — with /api/* routed to
 * the JSON fixtures in docs/design/fleetdeck-v2/fixtures/api/ (plus hand-written
 * empty/error variants) and window.WebSocket replaced by a scriptable double, so
 * every BEHAVIOUR.md item that does not need a real ssh pty can be driven and
 * asserted. Writes docs/design/fleetdeck-v2/verify/l3/live.json (id, action,
 * expectation, pass) plus live-<theme>.png and the improvised.md screenshots.
 *
 * Run: node scripts/l3-live.mjs --app http://127.0.0.1:3219
 *
 * The script lives under scripts/ rather than verify/l3/ because design-diff.mjs
 * publishes verify/<slice>/ atomically (scripts/design-diff.mjs:244-251) — it
 * replaces the whole directory, so anything kept there is deleted by the next
 * pixel-gate run. Order: pixel gate first, this second.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = path.join(ROOT, 'docs/design/fleetdeck-v2');
const FIXTURES = path.join(DESIGN, 'fixtures/api');
const OUT = path.join(DESIGN, 'verify/l3');
const SHOTS = path.join(DESIGN, 'improvised');
const VIEWPORT = { width: 1440, height: 900 };
const TIMEOUT = 30000;
const STALL_TEXT = 'no output — 1Password on this Mac may be locked or waiting for approval';
const EMPTY_TEXT = 'There are no sessions yet, open a new session via an orchestrator first.';
const LOCKED_NOTE = '1Password locked — unlock it, then Reconnect';
const AGENT_LOCKED = 'communication with agent failed';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const APP = arg('--app', 'http://127.0.0.1:3219');

// /api/<name> -> fixture file. Anything unmapped answers {} so a stray call is
// visible as a behaviour change, not as a network error.
const ROUTES = {
  '/api/sessions': 'sessions.json',
  '/api/health': 'health.json',
  '/api/credits': 'credits.json',
  '/api/messages': 'messages.json',
  '/api/machines': 'machines.json',
  '/api/seats': 'seats.json',
  '/api/sshkeys': 'sshkeys.json',
  '/api/ghtrain': 'ghtrain.json',
  '/api/desktop-sessions': 'desktop-sessions.json',
};

// A scriptable WebSocket. The engine only uses url/readyState/send/close and the
// four handlers, so this covers the whole client half of BEHAVIOUR §3.
function installFakeWs() {
  window.__ws = [];
  window.__wrote = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      window.__ws.push(this);
      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        if (this.onopen) this.onopen({});
      }, 0);
    }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
  }
  FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;
  window.WebSocket = FakeWebSocket;
  // Drive helpers used from the test.
  window.__wsLast = () => window.__ws[window.__ws.length - 1];
  window.__wsMsg = (text) => { const w = window.__wsLast(); w.onmessage({ data: text }); };
  window.__wsDie = () => { const w = window.__wsLast(); w.readyState = 3; if (w.onclose) w.onclose({}); };
  // Record everything the terminal is asked to render, so "did it write?" is
  // answerable without reading xterm's canvas.
  const patchTerm = () => {
    if (!window.Terminal || window.Terminal.__l3patched) return;
    const write = window.Terminal.prototype.write;
    window.Terminal.prototype.write = function (d) { window.__wrote.push(String(d)); return write.apply(this, arguments); };
    window.Terminal.__l3patched = true;
  };
  const iv = setInterval(patchTerm, 20);
  setTimeout(() => clearInterval(iv), 20000);
}

function initPage(theme) {
  localStorage.setItem('fd-landing-dark', theme === 'dark' ? '1' : '0');
  localStorage.setItem('fd-app-video', 'false');
  localStorage.removeItem('fd-fixture');
}

async function fixtureBody(pathname) {
  const file = ROUTES[pathname];
  if (!file) return '{}';
  const abs = path.join(FIXTURES, file);
  if (!existsSync(abs)) return '{}';
  return await readFile(abs, 'utf8');
}

async function newPage(browser, theme, { empty = false } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  context.setDefaultTimeout(TIMEOUT);
  await context.addInitScript(initPage, theme);
  await context.addInitScript(installFakeWs);
  const errors = [];
  // Only /api/* is stubbed. The hero videos are served for real from the local
  // server: aborting them raises net::ERR_FAILED in the console, which would
  // make the zero-console-errors check (L3-27) unable to see a genuine one.
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    // The empty variant is hand-written here, not a file: it is the same shape
    // with no rows, which is what an unprovisioned fleet actually returns.
    const body = empty && pathname === '/api/sessions'
      ? JSON.stringify({ sessions: [], errors: [] })
      : await fixtureBody(pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  return { context, page, errors };
}

async function reachWindows(page, { screenState = 'attached' } = {}) {
  await page.goto(APP + '/v2/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="Windows"]').click();
  // With no tiles the compiled Windows box has no children and so collapses to
  // zero height — attached, not visible, is the right wait for the empty case.
  await page.locator('[data-screen-label="Windows"]').waitFor({ state: screenState });
  await page.waitForFunction(() => window.FD && window.FD.screens && window.FD.screens.windows && window.FD.fixture.l3Live === true);
  await page.waitForFunction(() => Array.isArray(window.FD.fixture.l3TermSessions));
}

const open = (page, host, name) =>
  page.evaluate(([h, n]) => window.FD.screens.windows.openTile(h, n), [host, name]);
const openMax = (page, host, name) =>
  page.evaluate(([h, n]) => window.FD.screens.windows.openMax(h, n), [host, name]);
const closeTile = (page, host, name) =>
  page.evaluate(([h, n]) => window.FD.screens.windows.closeTile(h, n), [host, name]);
// The compiled tiles are counted, not the terminal layer: they are the thing
// FD.setData drives, and the layer is aligned to them.
const tileCount = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-screen-label="Windows"]');
  const grid = root && root.firstElementChild;
  return grid ? grid.children.length : 0;
});
const tilePart = (page, i, part) => page.evaluate(([n, p]) => {
  const grid = document.querySelector('[data-screen-label="Windows"]').firstElementChild;
  return grid.children[n].children[p].innerText;
}, [i, part]);
// Visible terminal boxes in this slice's own layer, with their z-index.
const boxes = (page) => page.evaluate(() => [...document.querySelectorAll('[data-l3-layer] > div')]
  .filter((b) => b.style.visibility === 'visible' && b.querySelector('[data-l3-term]'))
  .map((b) => { const r = b.getBoundingClientRect();
    return { z: Number(b.style.zIndex), top: r.top, bottom: r.bottom, w: r.width, h: r.height }; }));
const settle = (page) => page.waitForTimeout(250);

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(SHOTS, { recursive: true });
  const results = [];
  const record = (id, action, expectation, pass, note) => {
    results.push({ id, action, expectation, pass: !!pass, ...(note ? { note } : {}) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${expectation}${note ? ' (' + note + ')' : ''}`);
  };

  const sessions = JSON.parse(await readFile(path.join(FIXTURES, 'sessions.json'), 'utf8'));
  const rows = sessions.sessions || sessions;
  const live = rows.filter((s) => s.live && s.status !== 'hidden');
  if (live.length < 2) throw new Error('sessions fixture needs at least two live rows');
  const a = live[0];
  const b = live[1];

  const browser = await chromium.launch();
  try {
    // ---- empty state -----------------------------------------------------
    {
      const { context, page } = await newPage(browser, 'dark', { empty: true });
      await reachWindows(page);
      await settle(page);
      await page.waitForTimeout(500);
      const text = await page.locator('[data-l3-empty]').innerText().catch(() => '');
      record('L3-01', 'load the Windows screen with no sessions',
        'the improvised empty state carries the ruling copy verbatim', text.trim() === EMPTY_TEXT, text.trim());
      await page.screenshot({ path: path.join(SHOTS, 'l3-empty-state.png') });
      const emptyShown = await page.locator('[data-l3-empty]').isVisible().catch(() => false);
      record('L3-35', 'render the empty state with the grid collapsed',
        'it is anchored to the nearest sized ancestor, so it is actually on screen', emptyShown);
      const noSetData = await page.evaluate(() => (window.FD.fixture.l3Tiles || []).length === 0);
      record('L3-02', 'inspect FD.fixture in live mode with no sessions',
        'l3Tiles is published and empty; no seed tiles leak into live mode', noSetData);
      await context.close();
    }

    // ---- the main behaviour run ------------------------------------------
    const { context, page, errors } = await newPage(browser, 'dark');
    await reachWindows(page);

    // sessions list feeds the switcher
    const menuRows = await page.evaluate(() => window.FD.fixture.l3TermSessions.length);
    const expectLive = live.length;
    record('L3-03', 'load /api/sessions through FD.data in live mode',
      'the ≡ switcher lists exactly the live, non-hidden sessions', menuRows === expectLive,
      `${menuRows} of ${expectLive}`);

    await open(page, a.host, a.name);
    await settle(page);
    record('L3-04', 'openTile(host, name)', 'one tile is rendered', (await tileCount(page)) === 1);

    const header = await tilePart(page, 0, 0);
    record('L3-05', 'read the tile header', 'the header shows the session name and its box',
      header.includes(a.name) && header.includes(a.host), header.split('\n').join(' · '));

    const foot = await tilePart(page, 0, 2);
    const wantFoot2 = a.task || '—';
    record('L3-06', 'read the tile footer',
      'foot1 is the registry role · label, foot2 is the registry task',
      foot.includes(wantFoot2), foot.split('\n').join(' | '));

    const url = await page.evaluate(() => window.__wsLast().url);
    const wantUrl = `/term?host=${encodeURIComponent(a.host)}&session=${encodeURIComponent(a.name)}&cols=`;
    record('L3-07', 'inspect the WebSocket the tile opened',
      'ws://<host>/term?host&session&cols&rows, both values URI-encoded',
      url.startsWith('ws://') && url.includes(wantUrl) && /&rows=\d+$/.test(url), url);

    const openedResize = await page.evaluate(() => {
      const w = window.__wsLast();
      return w.sent.some((s) => { try { return JSON.parse(s).type === 'resize'; } catch (e) { return false; } });
    });
    record('L3-08', 'let the socket open', 'a {type:"resize"} frame is replayed on open', openedResize);

    await page.evaluate(() => window.__wsMsg('hello from the pty'));
    await settle(page);
    const wrote = await page.evaluate(() => window.__wrote.join(''));
    record('L3-09', 'server sends pty bytes', 'the bytes are written to the terminal',
      wrote.includes('hello from the pty'));

    await page.evaluate(() => window.__wsMsg('{"type":"exit","code":0}'));
    await settle(page);
    const wroteAfter = await page.evaluate(() => window.__wrote.join(''));
    record('L3-10', 'server sends the exit control frame',
      'the control frame is dropped, never written to the terminal',
      !wroteAfter.includes('"type":"exit"'));

    await open(page, a.host, a.name);
    await settle(page);
    const dedupe = await page.evaluate(() => window.__ws.length);
    record('L3-11', 'openTile the same host+session again',
      'the tile is deduped on host+NUL+session — no second tile, no reconnect',
      (await tileCount(page)) === 1 && dedupe === 1, `${dedupe} socket(s)`);

    // input frames
    await page.evaluate(() => {
      const rec = window.FD.screens.windows._model()[0];
      window.__typed = true;
      return rec;
    });
    const typed = await page.evaluate(() => {
      const w = window.__wsLast();
      const before = w.sent.length;
      // xterm's onData is the only input path; drive it the way a keystroke does.
      const term = document.querySelector('[data-l3-term]');
      term.querySelector('textarea')?.focus();
      return { before, hasTextarea: !!term.querySelector('textarea') };
    });
    if (typed.hasTextarea) {
      await page.keyboard.type('ls');
      await settle(page);
      const input = await page.evaluate(() => window.__wsLast().sent
        .map((s) => { try { return JSON.parse(s); } catch (e) { return {}; } })
        .filter((f) => f.type === 'input').map((f) => f.data).join(''));
      record('L3-12', 'type into the focused terminal',
        'each keystroke is sent as {type:"input",data}', input.includes('l') && input.includes('s'), input);
    } else {
      record('L3-12', 'type into the focused terminal',
        'each keystroke is sent as {type:"input",data}', false, 'no xterm textarea found');
    }

    // maximize / full screen
    await openMax(page, a.host, a.name);
    await settle(page);
    const fullVisible = await page.locator('[data-screen-label="Session full screen"]').isVisible();
    const fullRect = await page.locator('[data-screen-label="Session full screen"]').boundingBox();
    const overBoxes = await boxes(page);
    const movedIn = overBoxes.some((b) => b.z === 56 && b.top > fullRect.y && b.bottom <= fullRect.y + fullRect.height + 1);
    record('L3-13', 'openMax(host, name)',
      'the overlay opens and the live terminal is aligned over its body, above it in z',
      fullVisible && movedIn, JSON.stringify(overBoxes));

    const fullFoot = await page.locator('[data-screen-label="Session full screen"]').innerText();
    record('L3-14', 'read the full-screen header and footer',
      'name, host and the registry role · label · task are shown',
      fullFoot.includes(a.name) && fullFoot.includes(a.host));
    await page.screenshot({ path: path.join(SHOTS, 'l3-full-screen.png') });

    // bar double-click toggles maximize (app.js:1038-1040)
    await page.locator('[data-screen-label="Session full screen"] button[title="Exit full screen (Esc)"]').click();
    await settle(page);
    await page.evaluate(() => {
      const grid = document.querySelector('[data-screen-label="Windows"]').firstElementChild;
      grid.children[0].children[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await settle(page);
    record('L3-36', 'double-click a tile bar away from its buttons', 'the tile maximizes',
      await page.locator('[data-screen-label="Session full screen"]').isVisible());
    await page.evaluate(() => {
      const full = document.querySelector('[data-screen-label="Session full screen"]');
      full.firstElementChild.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await settle(page);
    record('L3-37', 'double-click the full-screen header away from its buttons', 'it restores',
      !(await page.locator('[data-screen-label="Session full screen"]').isVisible()));
    await openMax(page, a.host, a.name);
    await settle(page);

    // ≡ menu
    await page.locator('[data-screen-label="Session full screen"] button[title="Switch session"]').click();
    await settle(page);
    const menuText = await page.locator('[data-screen-label="Session full screen"]').innerText();
    record('L3-15', 'open the ≡ menu',
      'it lists the live sessions with dot, name and host — the old drawer switcher',
      menuText.includes(b.name));

    await page.locator('[data-screen-label="Session full screen"] button', { hasText: b.name }).first().click();
    await settle(page);
    const switched = await page.evaluate(() => window.FD.l3.term && window.FD.l3.term.name);
    record('L3-16', 'pick another session from the ≡ menu',
      'that session is attached (deduped) and becomes the maximized one',
      switched === b.name && (await tileCount(page)) === 2, String(switched));

    const onlyOne = (await boxes(page)).filter((b) => b.z === 56).length;
    record('L3-17', 'with two tiles open and one maximized',
      'exactly one terminal is raised over the full screen at a time', onlyOne === 1, String(onlyOne));

    // shift+Esc restores; plain Esc must not
    await page.keyboard.press('Escape');
    await settle(page);
    const stillOpen = await page.locator('[data-screen-label="Session full screen"]').isVisible();
    record('L3-18', 'press plain Escape with the terminal focused',
      'plain Escape reaches tmux/vim and does not restore', stillOpen);

    await page.keyboard.press('Shift+Escape');
    await settle(page);
    const restored = !(await page.locator('[data-screen-label="Session full screen"]').isVisible());
    record('L3-19', 'press shift+Escape', 'the maximized tile is restored', restored);

    // Message hands off to the bus slice
    await openMax(page, b.host, b.name);
    await settle(page);
    await page.evaluate(() => {
      window.__bus = [];
      window.FD.screens.bus = { open: (t) => window.__bus.push(t) };
    });
    await page.locator('[data-screen-label="Session full screen"] button[title="Message this session"]').click();
    await settle(page);
    const bus = await page.evaluate(() => window.__bus);
    record('L3-20', 'click Message in the full-screen header',
      'FD.screens.bus.open({type:"tmux",host,session}) is called',
      bus.length === 1 && bus[0].type === 'tmux' && bus[0].host === b.host && bus[0].session === b.name,
      JSON.stringify(bus));

    await page.locator('[data-screen-label="Session full screen"] button[title="Exit full screen (Esc)"]').click();
    await settle(page);
    record('L3-21', 'click Close in the full-screen header', 'the overlay closes and the tiles come back',
      !(await page.locator('[data-screen-label="Session full screen"]').isVisible()));

    // dead overlay + reconnect
    await page.evaluate(() => {
      const w = window.__ws.find((s) => s.readyState === 1);
      w.onmessage({ data: 'debug1: communication with agent failed' });
      w.readyState = 3;
      w.onclose({});
    });
    await settle(page);
    const deadText = await page.locator('[data-l3-overlay]').first().innerText();
    record('L3-22', 'the socket closes after a locked-agent tail',
      'a Disconnected overlay appears with the 1Password note and a Reconnect button',
      deadText.includes('Disconnected') && deadText.includes(LOCKED_NOTE) && deadText.includes('Reconnect'),
      deadText.split('\n').join(' · '));
    await page.screenshot({ path: path.join(SHOTS, 'l3-dead-overlay.png') });

    const before = await page.evaluate(() => window.__ws.length);
    await page.locator('[data-l3-reconnect]').first().click();
    await settle(page);
    const after = await page.evaluate(() => window.__ws.length);
    record('L3-23', 'click Reconnect', 'a fresh socket is opened and the overlay clears',
      after === before + 1 && (await page.locator('[data-l3-overlay]').count()) === 0,
      `${before} → ${after}`);

    // close never kills
    const apiCalls = [];
    page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.method() + ' ' + new URL(r.url()).pathname); });
    const openBefore = await tileCount(page);
    const namesBefore = await page.evaluate(() => window.FD.screens.windows._model().map((r) => r.name));
    // A real click on the real ✕, on the SECOND tile: this is what exercises the
    // delegated index matcher in windows.js. A matcher that always closed the
    // first tile would pass a one-tile check and fail this one.
    await page.locator('[data-screen-label="Windows"] > div > div').nth(1)
      .locator('button[title="Close tile (session keeps running)"]').click();
    await settle(page);
    const namesAfter = await page.evaluate(() => window.FD.screens.windows._model().map((r) => r.name));
    record('L3-24', 'click the ✕ on the second tile',
      'that tile closes, the first stays open, and no API call is made — the remote session survives',
      (await tileCount(page)) === openBefore - 1 &&
      namesAfter.length === namesBefore.length - 1 &&
      namesAfter[0] === namesBefore[0] &&
      namesAfter.indexOf(namesBefore[1]) < 0 &&
      apiCalls.length === 0,
      `[${namesBefore.join(', ')}] → [${namesAfter.join(', ')}]; api: ${apiCalls.join(', ') || 'none'}`);

    // connect all
    await page.evaluate(() => window.FD.screens.windows._model().slice().forEach((r) =>
      window.FD.screens.windows.closeTile(r.host, r.name)));
    await settle(page);
    const t0 = Date.now();
    // Clicked, not called: a hook the UI never reaches would pass vacuously.
    await page.locator('aside button', { hasText: 'Connect all' }).first().click();
    await page.waitForFunction((n) => window.FD.screens.windows._model().length === n, expectLive,
      { timeout: expectLive * 1500 + 15000 });
    const elapsed = Date.now() - t0;
    record('L3-25', 'connectAll()',
      'every live non-hidden session opens, 500 ms apart, hidden and dead rows skipped',
      (await page.evaluate(() => window.FD.screens.windows._model().length)) === expectLive &&
      elapsed >= (expectLive - 1) * 500, `${expectLive} tiles in ${elapsed} ms`);

    // One click, one call: the shell (L2) binds this button by template id, and
    // this slice must not add a second binding of its own (L3.1 item 4).
    await page.evaluate(() => {
      window.__ca = 0;
      window.__caOrig = window.FD.screens.windows.connectAll;
      window.FD.screens.windows.connectAll = function () { window.__ca++; return Promise.resolve(); };
    });
    await page.locator('aside button', { hasText: 'Connect all' }).first().click();
    await settle(page);
    const caCount = await page.evaluate(() => window.__ca);
    await page.evaluate(() => { window.FD.screens.windows.connectAll = window.__caOrig; });
    record('L3-38', 'click the sidebar Connect all once',
      'exactly one connectAll call — the shell owns the binding, this slice adds none',
      caCount === 1, caCount + ' call(s)');

    const skipped = await page.evaluate(() => window.FD.screens.windows._model().map((r) => r.name));
    const hidden = rows.filter((s) => s.status === 'hidden' || !s.live).map((s) => s.name);
    record('L3-26', 'inspect what connectAll opened',
      'no hidden and no dead session was attached',
      !skipped.some((n) => hidden.includes(n)));

    await page.screenshot({ path: path.join(OUT, 'live-dark.png') });
    await page.screenshot({ path: path.join(SHOTS, 'l3-tile-xterm.png') });

    // The binding rule this layer exists for (oracle audit item 1).
    const outside = await page.evaluate(() => {
      const root = document.getElementById('dc-root');
      const mounts = [...document.querySelectorAll('[data-l3-term]')];
      return { n: mounts.length, inside: mounts.filter((m) => root && root.contains(m)).length };
    });
    record('L3-33', 'inspect where every xterm mount lives',
      'no terminal is mounted inside a compiled node — the layer is a sibling of #dc-root',
      outside.n > 0 && outside.inside === 0, JSON.stringify(outside));
    const stamped = await page.evaluate(() => {
      const root = document.querySelector('[data-screen-label="Windows"]');
      return root ? root.querySelectorAll('[data-l3-key]').length : -1;
    });
    record('L3-34', 'inspect the compiled tiles for slice state',
      'no per-row state is stored on a positional sc-for row', stamped === 0, String(stamped));

    record('L3-27', 'watch the console for the whole run', 'zero console errors',
      errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');
    await context.close();

    // ---- the 15 s stall line, on its own page ----------------------------
    {
      const { context: c2, page: p2 } = await newPage(browser, 'dark');
      await reachWindows(p2);
      await open(p2, a.host, a.name);
      await p2.waitForSelector('[data-l3-stall]', { timeout: 25000 }).catch(() => {});
      const stall = await p2.locator('[data-l3-stall]').innerText().catch(() => '');
      record('L3-28', 'open a tile and send nothing for 15 s',
        'the stall line appears with its copy verbatim', stall.trim() === STALL_TEXT, stall.trim());
      await p2.screenshot({ path: path.join(SHOTS, 'l3-stall.png') });
      await p2.evaluate(() => window.__wsMsg('output at last'));
      await p2.waitForTimeout(300);
      record('L3-29', 'the pty finally sends output',
        'the stall line is cleared on the first message',
        (await p2.locator('[data-l3-stall]').count()) === 0);
      await c2.close();
    }

    // ---- light theme screenshot -----------------------------------------
    {
      const { context: c3, page: p3 } = await newPage(browser, 'light');
      await reachWindows(p3);
      await open(p3, a.host, a.name);
      await open(p3, b.host, b.name);
      await settle(p3);
      await p3.screenshot({ path: path.join(OUT, 'live-light.png') });
      const themed = await p3.evaluate(() => window.FD.l3.tokens && window.FD.l3.tokens.dark === false);
      record('L3-30', 'run the whole screen in the light theme',
        'the improvised nodes read the light palette from the mock tokens', themed);
      await c3.close();
    }

    // ---- fixture mode stays inert ---------------------------------------
    {
      const context4 = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark', reducedMotion: 'reduce' });
      context4.setDefaultTimeout(TIMEOUT);
      await context4.addInitScript(initPage, 'dark');
      const p4 = await context4.newPage();
      const calls = [];
      p4.on('request', (r) => { if (r.url().includes('/api/')) calls.push(new URL(r.url()).pathname); });
      await p4.goto(APP + '/v2/index.html?fixture=1', { waitUntil: 'domcontentloaded' });
      await p4.getByRole('link', { name: 'App', exact: true }).click();
      await p4.locator('aside button[title="Windows"]').click();
      await p4.locator('[data-screen-label="Windows"]').waitFor({ state: 'visible' });
      await p4.waitForTimeout(1200);
      const inert = await p4.evaluate(() => ({
        live: window.FD.fixture.l3Live,
        tiles: window.FD.fixture.l3Tiles,
        rendered: document.querySelectorAll('[data-l3-layer]').length,
        seeded: document.querySelectorAll('[data-screen-label="Windows"] > div > div').length,
      }));
      record('L3-31', 'load the app with ?fixture=1',
        'this slice never calls FD.setData in fixture mode and builds no layer',
        inert.live === undefined && inert.tiles === undefined && inert.rendered === 0 && inert.seeded === 4,
        JSON.stringify(inert));
      record('L3-32', 'watch the network with ?fixture=1',
        'no /api/* request is made from the Windows screen', calls.length === 0, calls.join(', ') || 'none');
      await context4.close();
    }
  } finally {
    await browser.close();
  }

  const allPass = results.length > 0 && results.every((r) => r.pass);
  const report = {
    schemaVersion: 1,
    mode: 'live',
    slice: 'l3',
    issue: 'DECK-42',
    capturedAt: new Date().toISOString(),
    source: APP + '/v2/index.html',
    apiFixtures: 'docs/design/fleetdeck-v2/fixtures/api/ (+ a hand-written empty /api/sessions variant)',
    websocket: 'client half driven here through a scriptable double (no ssh pty); server half covered for real by test/v2-term-ws.test.js, which boots server.js on a scratch port with a fake ssh first on PATH and asserts the pty stream, the input and resize frames, the single exit control frame and the 4400 closes',
    viewport: VIEWPORT,
    results,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    allPass,
  };
  await writeFile(path.join(OUT, 'live.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nlive.json: ${report.passed}/${report.total}; allPass=${allPass}`);
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
