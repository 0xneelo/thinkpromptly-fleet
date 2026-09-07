#!/usr/bin/env node
/**
 * fd-v2 L9 (Machines) live-mode proof harness.
 *
 * Run from the repo root: node docs/design/fleetdeck-v2/verify/l9/live.mjs
 * Run the pixel gate FIRST and never at the same time: design-diff.mjs:244-250 replaces
 * this whole directory atomically, which deletes this file and its outputs.
 *
 * Drives public/v2 with the API stubbed from docs/design/fleetdeck-v2/fixtures/api/*.json,
 * reads the real DOM through the compiled template's data-dc-tpl anchors, and writes
 * live.json (one row per check), live-<theme>.png and improvised/*.png beside this file.
 * Every user-visible string asserted here is copied from public/machines.js as it ships.
 *
 * The fixture's timestamps are frozen, so each payload is re-based on Date.now() at serve
 * time: every *_at / *_ts / *_active epoch moves by the same delta, which keeps the
 * fixture's relative ages while making the age strings deterministic.
 *
 * Browser setup (viewport, reduced motion, animation/caret suppression, font + network
 * settle) mirrors scripts/design-diff.mjs so the screenshots are reproducible; it is copied,
 * not imported, because that script owns the pixel gate.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const FIXTURES = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const IMPROVISED = join(HERE, 'improvised');
const DEFAULT_ORIGIN = 'http://127.0.0.1:4197';
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const TIMEOUT = 30_000;
// design-diff.mjs's stabilisation CSS, verbatim.
const CSS = `*{animation:none!important;transition:none!important;caret-color:transparent!important}
*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
html{scroll-behavior:auto!important}video,canvas{visibility:hidden!important}`;

// Every /api/* the shell can reach gets its fixture, so nothing else on the page errors.
const API_FIXTURES = {
  '/api/machines': 'machines.json',
  '/api/sessions': 'sessions.json',
  '/api/health': 'health.json',
  '/api/credits': 'credits.json',
  '/api/seats': 'seats.json',
  '/api/messages': 'messages.json',
  '/api/sshkeys': 'sshkeys.json',
  '/api/ghtrain': 'ghtrain.json',
  '/api/desktop-sessions': 'desktop-sessions.json',
};

// --- results -----------------------------------------------------------------

const results = [];
function record(id, action, expectation, pass, detail) {
  const row = { id, action, expectation, pass: !!pass };
  if (!row.pass && detail !== undefined) row.detail = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push(row);
  return row.pass;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function eq(id, action, expectation, actual, want) {
  return record(id, action, expectation, same(actual, want), `actual ${JSON.stringify(actual)} · expected ${JSON.stringify(want)}`);
}

// --- payloads ----------------------------------------------------------------

const clone = (value) => JSON.parse(JSON.stringify(value));
const EPOCH_KEY = /(_at|_ts|_active)$/;

// Moves every epoch-second field by one delta: relative ages survive, absolute ones become
// clock-relative. Percentages, ids and ISO strings are left alone.
function shiftEpochs(node, delta) {
  if (Array.isArray(node)) { node.forEach((v) => shiftEpochs(v, delta)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'number' && EPOCH_KEY.test(key) && value > 1e9 && value < 3e9) node[key] = value + delta;
    else shiftEpochs(value, delta);
  }
}

const byId = (payload, id) => payload.machines.find((m) => m.id === id);
const client = (payload, machineId, name, where) =>
  byId(payload, machineId).clients.find((c) => c.client === name && c.where === where);

function defaultPayload(base, nowMs) {
  const payload = clone(base);
  const nowSec = Math.floor(nowMs / 1000);
  shiftEpochs(payload, nowSec - payload.collected_at);
  // german-box's header must read exactly "reported 3 h ago" (ago(): 180 min -> "3 h").
  byId(payload, 'german-box').reported_at = nowSec - 3 * 3600;
  return payload;
}

// Hand-written states the real fixture does not carry, each derived from a real machine.
function variantPayload(base, nowMs) {
  const payload = defaultPayload(base, nowMs);
  const rog = byId(payload, 'rog-strix');

  const errBox = clone(rog);
  errBox.id = 'err-box';
  errBox.label = 'Error box';
  errBox.error = 'ssh: connect to host err-box port 22: Connection refused';

  const sshBox = clone(rog);
  sshBox.id = 'ssh-noreport';
  sshBox.label = 'SSH no report';
  sshBox.route = 'ssh';
  sshBox.ssh = 'nr-deploy';

  const anon = (where, org) => ({
    client: where === 'windows' ? 'claude_cli' : 'claude_desktop',
    where, installed: true, signed_in: true, state: 'ok',
    label: null, email: null, config_email: null, org, usage: null,
  });
  const business = clone(client(payload, 'german-box', 'claude_cli', 'local'));
  business.plan = 'business';
  const expired = clone(client(payload, 'german-box', 'codex_cli', 'local'));
  expired.state = 'token_expired';
  const shared = clone(client(payload, 'german-box', 'codex_cli', 'local'));
  shared.client = 'codex_desktop';
  shared.shares = 'codex_cli';

  const variants = clone(byId(payload, 'ivy-vps'));
  variants.id = 'variants-box';
  variants.label = 'Variants box';
  variants.clients = [business, anon('windows', 'b14f597c-43a1-4b18-ab9d-a5ab74128546'), expired, anon('local', null), shared];

  const one = clone(byId(payload, 'macbook'));
  one.id = 'one-session';
  one.label = 'One session';
  one.sessions = [{ name: 'FD-one', worker: 'Eckbert', role: 'frontend-developer', status: 'active' }];

  // Wrong types where the template expects strings: validate() in machines.js must coerce
  // them before FD.setData rather than letting a number reach a binding.
  const malformed = clone(byId(payload, 'ivy-vps'));
  malformed.id = 'malformed';
  malformed.label = 424242;
  malformed.host = 99;

  payload.machines = [...payload.machines, errBox, sshBox, variants, one, malformed];
  return payload;
}

// --- browser plumbing --------------------------------------------------------

const consoleErrors = [];
const isMedia = (request) => request.resourceType() === 'media' || /\.(?:mp4|webm|m3u8|ts)(?:$|[?#])/i.test(request.url());

function initPage({ theme, css }) {
  localStorage.setItem('fd-landing-dark', theme === 'dark' ? '1' : '0');
  localStorage.setItem('fd-app-video', 'false');
  // The hook L9 uses (README §Cross-slice contract): L4 is an empty stub in this tree, so
  // the harness supplies it and records the argument the screen passes.
  window.FD = window.FD || {};
  FD.screens = FD.screens || {};
  FD.screens.registry = { open: (a) => { window.__reg = a; } };
  const inject = () => {
    if (!document.documentElement || document.getElementById('fd-l9-live-style')) return;
    const style = document.createElement('style');
    style.id = 'fd-l9-live-style';
    style.textContent = css;
    document.documentElement.appendChild(style);
  };
  inject();
  document.addEventListener('DOMContentLoaded', inject, { once: true });
}

async function openScenario(browser, { label, theme = 'dark', payload = null, control = {} }) {
  const ctl = { payload, abortMachines: false, delayMs: 0, requests: [], ...control };
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce',
    locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  context.setDefaultTimeout(TIMEOUT);
  await context.addInitScript(initPage, { theme, css: CSS });
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (isMedia(request)) return route.abort();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    ctl.requests.push({ url: request.url(), path: url.pathname, refresh: url.searchParams.get('refresh') === '1' });
    if (url.pathname === '/api/machines') {
      if (ctl.abortMachines) return route.abort();
      if (ctl.delayMs) await new Promise((done) => setTimeout(done, ctl.delayMs));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ctl.payload) });
    }
    const file = API_FIXTURES[url.pathname];
    const body = file ? await readFile(join(FIXTURES, file), 'utf8') : '{}';
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // A blocked subresource logs "Failed to load resource" with the URL only in location().
    const where = message.location();
    consoleErrors.push({ scenario: label, kind: 'console', text: message.text(), url: (where && where.url) || '' });
  });
  page.on('pageerror', (error) => consoleErrors.push({ scenario: label, kind: 'pageerror', text: error.message }));
  return { context, page, ctl };
}

async function gotoMachines(page, origin, query) {
  await page.goto(`${origin}/v2/index.html${query}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="Machines"]').click();
  await page.locator('[data-screen-label="Machines"]').waitFor({ state: 'visible' });
}

// Live data lands through FD.setData('machinesLive', cards); start() publishes an empty
// list first, so wait until the runtime has flushed exactly the loaded cards.
async function waitForCards(page, count) {
  await page.waitForFunction((n) => {
    const screen = document.querySelector('[data-screen-label="Machines"]');
    const live = window.FD && FD.fixture && FD.fixture.machinesLive;
    return !!screen && !!live && live.length === n && screen.querySelectorAll('[data-dc-tpl="609"]').length === n;
  }, count);
}

// The whole screen, read through the compiled template's own anchors.
function dumpScreen() {
  const screen = document.querySelector('[data-screen-label="Machines"]');
  if (!screen) return null;
  const q = (el, id) => el.querySelector(`[data-dc-tpl="${id}"]`);
  const qa = (el, id) => Array.from(el.querySelectorAll(`[data-dc-tpl="${id}"]`));
  const text = (el) => (el ? el.textContent : null);
  return qa(screen, '609').map((card) => ({
    name: text(q(card, '613')),
    kind: text(q(card, '614')),
    kindDisplay: q(card, '614') ? getComputedStyle(q(card, '614')).display : null,
    sessions: text(q(card, '616')),
    reported: text(q(card, '618')),
    registryButton: q(card, '620') ? text(q(card, '620')) : null,
    rows: qa(card, '623').map((row) => ({
      env: text(q(row, '625')),
      client: text(q(row, '627')),
      primary: text(q(row, '629')),
      primaryFont: q(row, '629') ? getComputedStyle(q(row, '629')).fontFamily : null,
      summary: text(q(row, '631')),
      secondary: text(q(row, '633')),
      chips: qa(row, '637').map((chip) => chip.textContent),
      bars: qa(row, '641').map((bar) => ({ label: text(q(bar, '642')), right: text(q(bar, '645')) })),
      note: text(q(row, '647')),
      noteTitle: q(row, '647') ? q(row, '647').getAttribute('title') : null,
    })),
  }));
}

const cardNamed = (cards, name) => (cards || []).find((c) => c.name === name) || null;
const rowsFor = (card, clientName) => (card ? card.rows.filter((r) => r.client === clientName || (r.client === null && r.env === clientName)) : []);
const rowIn = (card, clientName, env) => rowsFor(card, clientName).find((r) => r.env === env || (env === '' && r.client === null)) || null;

async function settle(page) {
  await page.mouse.move(0, 0);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

// --- static server -----------------------------------------------------------

const reachable = (origin) => new Promise((done) => {
  const { hostname, port } = new URL(origin);
  const socket = connect({ host: hostname, port: Number(port) }, () => { socket.end(); done(true); });
  socket.on('error', () => done(false));
  socket.setTimeout(1500, () => { socket.destroy(); done(false); });
});

async function ensureServer() {
  const origin = process.env.FD_L9_ORIGIN || DEFAULT_ORIGIN;
  if (await reachable(origin)) return { origin, close: async () => {} };
  const port = 4100 + Math.floor(Math.random() * 400);
  const child = spawn('python3', ['-m', 'http.server', String(port), '--directory', join(ROOT, 'public')], { stdio: 'ignore' });
  const own = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40 && !(await reachable(own)); i++) await new Promise((done) => setTimeout(done, 100));
  if (!(await reachable(own))) { child.kill(); throw new Error(`cannot start a static server on ${own}`); }
  return { origin: own, close: async () => { child.kill(); } };
}

// --- the run -----------------------------------------------------------------

async function main() {
  await mkdir(IMPROVISED, { recursive: true });
  const base = JSON.parse(await readFile(join(FIXTURES, 'machines.json'), 'utf8'));
  const server = await ensureServer();
  const browser = await chromium.launch();
  try {
    await defaultScenario(browser, server.origin, base);
    await variantScenario(browser, server.origin, base);
    await errorScenario(browser, server.origin, base);
    await fixtureScenario(browser, server.origin, base);
    await lightShot(browser, server.origin, base);
    consoleRow();
  } finally {
    await browser.close();
    await server.close();
  }

  const allPass = results.every((r) => r.pass);
  const report = { schemaVersion: 1, slice: 'l9', capturedAt: new Date().toISOString(), allPass, results };
  await writeFile(join(HERE, 'live.json'), JSON.stringify(report, null, 2) + '\n');
  const passed = results.filter((r) => r.pass).length;
  console.log(`${passed}/${results.length} rows pass`);
  for (const row of results) if (!row.pass) console.log(`FAIL ${row.id}: ${row.detail || ''}`);
  if (!allPass) process.exitCode = 1;
}

// --- scenario 1: the real fixture, clock-relative -----------------------------

const PUSH_COMMAND = 'sh fleet-logins.sh push http://100.125.231.25:3131/api/machines rog-strix';

async function defaultScenario(browser, origin, base) {
  const { context, page, ctl } = await openScenario(browser, { label: 'default', payload: defaultPayload(base, Date.now()) });
  try {
    await gotoMachines(page, origin, '');
    await waitForCards(page, 6);
    await settle(page);
    const cards = await page.evaluate(dumpScreen);
    const gb = cardNamed(cards, 'german-box');
    const mac = cardNamed(cards, 'MacBook Pro');
    const rog = cardNamed(cards, 'ROG Strix');

    // Cards and header.
    eq('cards-order', 'load the Machines screen on the stubbed /api/machines',
      'one card per payload machine, in payload order, MacBook Pro first',
      cards.map((c) => c.name), ['MacBook Pro', 'german-box', 'onboarding-vps', 'thinkpromptly-vps', 'ivy-vps', 'ROG Strix']);
    eq('kind-chip-ssh', 'read german-box\'s kind chip', 'reads "windows+wsl · ssh gb-deploy" (machines.js:177 ssh alias)',
      gb && gb.kind, 'windows+wsl · ssh gb-deploy');
    eq('kind-chip-push', 'read ROG Strix\'s kind chip', 'reads "windows · push"', rog && rog.kind, 'windows · push');
    eq('session-chip-plural', 'read german-box\'s session-count chip', 'reads "77 sessions" (machines.js:179)',
      gb && gb.sessions, '77 sessions');
    eq('no-sessions-no-chip', 'read MacBook Pro\'s header (0 sessions)', 'no session chip and no Open-in-Registry button',
      mac && { sessions: mac.sessions, button: mac.registryButton }, { sessions: null, button: null });
    eq('reported-ago', 'serve german-box reported_at = now - 3 h', 'the reported span reads exactly "reported 3 h ago", not the template\'s "reported just now"',
      gb && gb.reported, 'reported 3 h ago');
    eq('reported-empty', 'read ROG Strix\'s reported span (no reported_at)', 'the span is empty (machines.js:187 only appends when reported_at)',
      rog && rog.reported, '');

    // Machine status row.
    const rogStatus = rog && rog.rows[0];
    eq('push-status-row', 'read ROG Strix\'s first card row', 'reads "no report yet — cron this on that machine:" with the copyable push command and title="click to copy"',
      rogStatus && { env: rogStatus.env, primary: rogStatus.primary, note: rogStatus.note, title: rogStatus.noteTitle },
      { env: 'Status', primary: 'no report yet — cron this on that machine:', note: PUSH_COMMAND, title: 'click to copy' });

    // Rows and identity.
    eq('gb-row-shape', 'read german-box\'s card rows', 'four client columns contribute 5 rows: Claude CLI x2, Codex CLI x2, Claude desktop x1, Codex desktop x0',
      gb && gb.rows.map((r) => `${r.client}/${r.env}`),
      ['Claude CLI/WSL', 'Claude CLI/Windows', 'Codex CLI/WSL', 'Codex CLI/Windows', 'Claude desktop/Windows']);
    eq('not-installed-dropped', 'read german-box\'s Claude desktop column (local side is not_installed)',
      'exactly one row and no row rendered as the em dash',
      gb && { desktop: rowsFor(gb, 'Claude desktop').length, dashes: gb.rows.filter((r) => r.primary === '—').length },
      { desktop: 1, dashes: 0 });
    eq('env-tags', 'read the env cell on german-box vs MacBook Pro rows',
      'german-box rows carry WSL/Windows with the client beside them; MacBook Pro rows show the client name and no env tag',
      { gb: gb && Array.from(new Set(gb.rows.map((r) => r.env))).sort(), mac: mac && mac.rows.map((r) => ({ env: r.env, client: r.client })) },
      { gb: ['WSL', 'Windows'], mac: [{ env: 'Claude CLI', client: null }, { env: 'Codex CLI', client: null }, { env: 'Claude desktop', client: null }, { env: 'Codex desktop', client: null }] });
    const cliWsl = rowIn(gb, 'Claude CLI', 'WSL');
    eq('identity-mono-email', 'read german-box\'s Claude CLI/WSL identity', 'the email is the primary in a monospace font and the person is the secondary',
      cliWsl && { primary: cliWsl.primary, mono: /mono/i.test(cliWsl.primaryFont || ''), secondary: cliWsl.secondary },
      { primary: 'lafayette@infinite-holdings.llc', mono: true, secondary: 'Lafayette Tabor' });

    // Chips.
    eq('chips-order', 'read german-box\'s Claude CLI/WSL chips', 'exactly plan, tier, proof: claude_max, Max 20×, token-proved',
      cliWsl && cliWsl.chips, ['claude_max', 'Max 20×', 'token-proved']);
    const cliWin = rowIn(gb, 'Claude CLI', 'Windows');
    eq('config-only-no-state-chip', 'read german-box\'s Claude CLI/Windows chips (state config_only, proof config)',
      'the proof chip "config only" only — config_only is not in STATE (machines.js:12-19), so no state chip',
      cliWin && cliWin.chips, ['config only']);

    // Bars.
    eq('bar-labels', 'read german-box\'s Claude CLI/WSL bar labels', 'WIN_ORDER first, then unknown windows by name: 5 hour, 7 day, seven day fable',
      cliWsl && cliWsl.bars.map((b) => b.label), ['5 hour', '7 day', 'seven day fable']);
    eq('bar-rights', 'read german-box\'s Claude CLI/WSL bar right cells', 'the fixture\'s percentages: 29%, 62%, 100%',
      cliWsl && cliWsl.bars.map((b) => b.right), ['29%', '62%', '100%']);
    eq('bar-stale', 'read german-box\'s Claude CLI/Windows "5 hour" bar right cell', 'a stale window reads "stale" instead of a percentage',
      cliWin && cliWin.bars[0], { label: '5 hour', right: 'stale' });

    // Notes.
    const codexWsl = rowIn(gb, 'Codex CLI', 'WSL');
    const deskWin = rowIn(gb, 'Claude desktop', 'Windows');
    const macCodexDesktop = mac && mac.rows.find((r) => r.env === 'Codex desktop');
    record('note-joined', 'read german-box\'s Claude CLI/WSL note',
      'carries "token valid ", "5 hour resets in " and ends with "77 sessions run as Lafayette Tabor"',
      cliWsl && cliWsl.note.includes('token valid ') && cliWsl.note.includes('5 hour resets in ') &&
        cliWsl.note.endsWith('77 sessions run as Lafayette Tabor'),
      cliWsl && cliWsl.note);
    record('note-codex-refreshed', 'read german-box\'s Codex CLI/WSL note', 'carries "refreshed " (machines.js:115)',
      codexWsl && codexWsl.note.includes('refreshed '), codexWsl && codexWsl.note);
    record('note-stale-windows', 'read german-box\'s Claude desktop/Windows note',
      'carries "last active " and ends with " — older than the window it measured, so these have reset since"',
      deskWin && deskWin.note.includes('last active ') &&
        deskWin.note.endsWith(' — older than the window it measured, so these have reset since'),
      deskWin && deskWin.note);
    record('note-no-usage', 'read MacBook Pro\'s Codex desktop note (usage: null)', 'carries "no usage data" (machines.js:92)',
      macCodexDesktop && macCodexDesktop.note.includes('no usage data'), macCodexDesktop && macCodexDesktop.note);

    // The full-page shot first: the element crops below scroll the card list.
    await page.screenshot({ path: join(HERE, 'live-dark.png'), fullPage: true, animations: 'disabled', caret: 'hide' });

    // Improvisation screenshots, taken while the default stub is expanded.
    const gbIndex = cards.findIndex((c) => c.name === 'german-box');
    const gbCard = page.locator('[data-screen-label="Machines"] [data-dc-tpl="609"]').nth(gbIndex);
    const rogCard = page.locator('[data-screen-label="Machines"] [data-dc-tpl="609"]').nth(cards.findIndex((c) => c.name === 'ROG Strix'));
    await gbCard.locator('[data-dc-tpl="610"]').screenshot({ path: join(IMPROVISED, 'l9-reported-ago.png') });
    await rogCard.screenshot({ path: join(IMPROVISED, 'l9-machine-status-row.png') });
    await gbCard.screenshot({ path: join(IMPROVISED, 'l9-default-expanded.png') });
    await gbCard.locator('[data-dc-tpl="617"]').screenshot({ path: join(IMPROVISED, 'l9-open-in-registry.png') });
    const noteRow = gbCard.locator('[data-dc-tpl="623"]').nth(gb ? gb.rows.indexOf(cliWsl) : 0);
    await noteRow.screenshot({ path: join(IMPROVISED, 'l9-note-joined.png') });

    // Expand / collapse. logic.js keys the open state by machine name, not index.
    record('default-expanded', 'read german-box on first live load', 'the card is expanded: chips and bars are rendered, no collapsed summary',
      cliWsl && cliWsl.chips.length > 0 && cliWsl.bars.length > 0 && cliWsl.summary === null,
      cliWsl && { chips: cliWsl.chips.length, bars: cliWsl.bars.length, summary: cliWsl.summary });
    await gbCard.locator('[data-dc-tpl="610"]').click();
    await page.waitForTimeout(50);
    const collapsed = rowIn(cardNamed(await page.evaluate(dumpScreen), 'german-box'), 'Claude CLI', 'WSL');
    record('collapse-click', 'click the german-box card header', 'chips and bars are gone and the collapsed summary appears',
      collapsed && collapsed.chips.length === 0 && collapsed.bars.length === 0 && typeof collapsed.summary === 'string' && collapsed.summary.length > 0,
      collapsed && { chips: collapsed.chips.length, bars: collapsed.bars.length, summary: collapsed.summary });
    await gbCard.locator('[data-dc-tpl="610"]').click();
    await page.waitForTimeout(50);
    const reopened = rowIn(cardNamed(await page.evaluate(dumpScreen), 'german-box'), 'Claude CLI', 'WSL');
    record('expand-again', 'click the german-box card header a second time', 'chips and bars are back and the summary is gone',
      reopened && reopened.chips.length === 3 && reopened.bars.length === 3 && reopened.summary === null,
      reopened && { chips: reopened.chips.length, bars: reopened.bars.length, summary: reopened.summary });

    // Open in Registry.
    await gbCard.locator('[data-dc-tpl="620"]').click();
    await page.waitForTimeout(50);
    const registry = await page.evaluate(() => ({
      arg: window.__reg || null,
      onMachines: !!document.querySelector('[data-screen-label="Machines"]'),
      onRegistry: !!document.querySelector('[data-screen-label="Registry"]'),
    }));
    eq('open-in-registry', 'click german-box\'s Open in Registry button',
      'FD.screens.registry.open receives { q: "german-box" } and the screen does not switch',
      registry, { arg: { q: 'german-box' }, onMachines: true, onRegistry: false });

    // Polling and refresh.
    const firstMachines = ctl.requests.filter((r) => r.path === '/api/machines');
    eq('first-load-no-force', 'watch the first /api/machines request', 'the poll never forces: no refresh=1 on the first load (machines.js:222)',
      firstMachines.length ? { url: firstMachines[0].url.replace(/^https?:\/\/[^/]+/, ''), refresh: firstMachines[0].refresh } : null,
      { url: '/api/machines', refresh: false });
    ctl.delayMs = 800;
    const refreshButton = page.locator('[data-dc-tpl="241"]');
    await refreshButton.click();
    const busy = await refreshButton.isDisabled();
    await page.waitForFunction(() => !document.querySelector('[data-dc-tpl="241"]').disabled, null, { timeout: TIMEOUT });
    ctl.delayMs = 0;
    const forced = ctl.requests.filter((r) => r.path === '/api/machines' && r.refresh);
    eq('refresh-forces', 'click the header Refresh button', 'issues /api/machines?refresh=1 (machines.js:230 -> load(true))',
      forced.length ? forced[0].url.replace(/^https?:\/\/[^/]+/, '') : null, '/api/machines?refresh=1');
    record('refresh-disabled', 'read the Refresh button while the forced request is in flight',
      'disabled during the request and enabled again after (machines.js:220,226)',
      busy && !(await refreshButton.isDisabled()), `disabled during flight: ${busy}; after: ${await refreshButton.isDisabled()}`);
    const pollMs = await page.evaluate(() => FD.screens.machines._.POLL_MS);
    eq('poll-interval', 'read FD.screens.machines._.POLL_MS', 'the poll is 60 000 ms (machines.js:232)', pollMs, 60000);

    // The copy affordance is set AND cleared every render: rows are positional, so the node
    // that carried the push command becomes a client row's note when the machine reports.
    const reporting = defaultPayload(base, Date.now());
    const nowReporting = byId(reporting, 'rog-strix');
    nowReporting.state = 'ok';
    nowReporting.reported_at = Math.floor(Date.now() / 1000);
    nowReporting.clients = clone(byId(reporting, 'ivy-vps').clients);
    ctl.payload = reporting;
    await refreshButton.click();
    await page.waitForFunction(() => {
      const live = window.FD && FD.fixture && FD.fixture.machinesLive;
      return !!live && live.length === 6 && live[5].status === null;
    });
    await page.waitForTimeout(50);
    const rogAfter = cardNamed(await page.evaluate(dumpScreen), 'ROG Strix');
    const firstRow = rogAfter && rogAfter.rows[0];
    // __fdCopyBound on the same node proves the runtime reused the status row's note node
    // rather than building a fresh one, so the cleared title is syncCopy's doing.
    const copyState = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-screen-label="Machines"] > [data-dc-tpl="609"]');
      const note = cards[5].querySelector('[data-dc-tpl="623"] [data-dc-tpl="647"]');
      return note ? { reused: !!note.__fdCopyBound, text: note.__fdCopy } : null;
    });
    eq('copy-cleared', 'refresh with rog-strix now reporting, so its status row disappears',
      'the reused note node keeps no title="click to copy" and no copy text: the first row is a client row',
      firstRow && { env: firstRow.env, primary: firstRow.primary, title: firstRow.noteTitle, copy: copyState },
      { env: 'Codex CLI', primary: 'admin@deus.finance', title: null, copy: { reused: true, text: '' } });
  } finally {
    await context.close();
  }
}

// --- scenario 2: hand-written variants ----------------------------------------

async function variantScenario(browser, origin, base) {
  const { context, page } = await openScenario(browser, { label: 'variants', payload: variantPayload(base, Date.now()) });
  try {
    await gotoMachines(page, origin, '');
    await waitForCards(page, 11);
    await settle(page);
    const cards = await page.evaluate(dumpScreen);
    const err = cardNamed(cards, 'Error box');
    const ssh = cardNamed(cards, 'SSH no report');
    const variants = cardNamed(cards, 'Variants box');
    const one = cardNamed(cards, 'One session');

    eq('status-error', 'serve a push machine with error set', 'the status row shows the error text and no push command (machines.js:181 wins over :183)',
      err && err.rows[0] && { primary: err.rows[0].primary, note: err.rows[0].note },
      { primary: 'ssh: connect to host err-box port 22: Connection refused', note: null });
    eq('status-no-report-ssh', 'serve a no_report machine whose route is ssh', 'the status row reads "no report yet" with no command (machines.js:186)',
      ssh && ssh.rows[0] && { primary: ssh.rows[0].primary, note: ssh.rows[0].note },
      { primary: 'no report yet', note: null });
    eq('session-chip-singular', 'serve a machine with exactly one session', 'the session chip reads "1 session" (machines.js:179)',
      one && one.sessions, '1 session');

    const businessRow = rowIn(variants, 'Claude CLI', '') || (variants && variants.rows.find((r) => r.env === 'Claude CLI'));
    eq('plan-business-hidden', 'serve a client with plan "business"', 'no plan chip; tier and proof still render (machines.js:135)',
      businessRow && businessRow.chips, ['Max 20×', 'token-proved']);
    const expiredRow = variants && variants.rows.find((r) => r.env === 'Codex CLI');
    record('state-token-expired', 'serve a client with state "token_expired"', 'a "token expired" chip renders (machines.js:13)',
      expiredRow && expiredRow.chips.includes('token expired'), expiredRow && expiredRow.chips);
    const sharedRow = variants && variants.rows.find((r) => r.env === 'Codex desktop');
    record('shares-note', 'serve a client with shares set', 'its note carries "same login as CLI" (machines.js:146)',
      sharedRow && sharedRow.note && sharedRow.note.includes('same login as CLI'), sharedRow && sharedRow.note);
    const anonRow = variants && variants.rows.find((r) => r.env === 'Claude desktop');
    eq('identity-unknown', 'serve a client with no label, email, config_email or org',
      'the primary reads "signed in, account unknown" (machines.js:132)', anonRow && anonRow.primary, 'signed in, account unknown');
    const orgRow = variants && variants.rows.find((r) => r.env === 'Windows' && r.client === 'Claude CLI');
    eq('identity-unmapped-org', 'serve the same client with an org', 'the primary reads "<first 8 of org> · unmapped org" (machines.js:132)',
      orgRow && orgRow.primary, 'b14f597c · unmapped org');

    // validate() runs inside publish(), so the seam is read from FD.fixture.machinesLive —
    // the exact value logic.js renders — rather than from any private state.
    const malformed = await page.evaluate(() => {
      const card = FD.fixture.machinesLive.find((c) => c.name === '424242');
      return card ? { name: typeof card.name, host: typeof card.host, cols: Array.isArray(card.cols), rows: card.cols.length } : null;
    });
    eq('validate-drops-malformed', 'serve a machine whose label and host are numbers, not strings',
      'validate() coerces every field before FD.setData: nothing throws, the card still renders, and the seam carries strings and an array of cols',
      { seam: malformed, rendered: !!cardNamed(cards, '424242'), cards: cards.length },
      { seam: { name: 'string', host: 'string', cols: true, rows: 4 }, rendered: true, cards: 11 });
  } finally {
    await context.close();
  }
}

// --- scenario 3: the fetch error ----------------------------------------------

async function errorScenario(browser, origin, base) {
  const { context, page } = await openScenario(browser, {
    label: 'error', payload: defaultPayload(base, Date.now()), control: { abortMachines: true },
  });
  try {
    await gotoMachines(page, origin, '');
    await waitForCards(page, 1);
    await settle(page);
    const cards = await page.evaluate(dumpScreen);
    eq('fetch-error-card', 'abort /api/machines and load the screen',
      'a single card titled "cannot reach fleetdeck" (machines.js:224) whose empty kind chip is hidden',
      cards && cards.map((c) => ({ name: c.name, kind: c.kind, kindDisplay: c.kindDisplay, rows: c.rows.length })),
      [{ name: 'cannot reach fleetdeck', kind: '', kindDisplay: 'none', rows: 0 }]);
    await page.locator('[data-screen-label="Machines"] [data-dc-tpl="609"]').first()
      .screenshot({ path: join(IMPROVISED, 'l9-error-card.png') });
  } finally {
    await context.close();
  }
}

// --- scenario 4: fixture mode stays inert -------------------------------------

async function fixtureScenario(browser, origin, base) {
  const { context, page, ctl } = await openScenario(browser, { label: 'fixture', payload: defaultPayload(base, Date.now()) });
  try {
    await gotoMachines(page, origin, '?fixture=1');
    await settle(page);
    const cards = await page.evaluate(dumpScreen);
    const requested = ctl.requests.filter((r) => r.path === '/api/machines');
    record('fixture-no-fetch', 'load /v2/index.html?fixture=1', 'the screen makes no /api/machines request at all',
      requested.length === 0, requested.map((r) => r.url));
    eq('fixture-seed-cards', 'read the cards in fixture mode', 'the mock\'s two seed cards render unchanged',
      cards && cards.map((c) => c.name), ['MacBook Pro', 'german-box']);
    const chips = (cards || []).flatMap((c) => c.rows).flatMap((r) => r.chips);
    const bars = (cards || []).flatMap((c) => c.rows).flatMap((r) => r.bars);
    const summaries = (cards || []).flatMap((c) => c.rows).filter((r) => typeof r.summary === 'string' && r.summary);
    record('fixture-collapsed', 'read the seed cards\' open state in fixture mode', 'they stay collapsed: no chips, no bars, collapsed summaries shown',
      chips.length === 0 && bars.length === 0 && summaries.length > 0,
      { chips: chips.length, bars: bars.length, summaries: summaries.length });
    eq('fixture-reported-literal', 'read the reported span in fixture mode', 'the template\'s literal "reported just now" is untouched',
      cards && Array.from(new Set(cards.map((c) => c.reported))), ['reported just now']);
  } finally {
    await context.close();
  }
}

// --- scenario 5: the light screenshot -----------------------------------------

async function lightShot(browser, origin, base) {
  const { context, page } = await openScenario(browser, { label: 'light', theme: 'light', payload: defaultPayload(base, Date.now()) });
  try {
    await gotoMachines(page, origin, '');
    await waitForCards(page, 6);
    await settle(page);
    await page.screenshot({ path: join(HERE, 'live-light.png'), fullPage: true, animations: 'disabled', caret: 'hide' });
    record('light-theme-renders', 'load the Machines screen in the light theme', 'the same six cards render for the light screenshot',
      (await page.evaluate(dumpScreen)).length === 6, `card count ${(await page.evaluate(dumpScreen)).length}`);
  } finally {
    await context.close();
  }
}

// --- the console row ----------------------------------------------------------

function consoleRow() {
  // The error scenario aborts /api/machines on purpose, and every scenario blocks the hero
  // video: Chromium logs both as network failures. Nothing else is allowed.
  const deliberate = (e) => e.kind === 'console' && (
    (e.scenario === 'error' && /\/api\/machines/.test(e.url)) || /\/v2\/media\//.test(e.url));
  const unexpected = consoleErrors.filter((e) => !deliberate(e));
  record('console-clean', 'watch console and page errors across every navigation in this run',
    'zero console errors and zero page errors, apart from the deliberately aborted /api/machines and the blocked hero video',
    unexpected.length === 0, unexpected);
}

await main();
