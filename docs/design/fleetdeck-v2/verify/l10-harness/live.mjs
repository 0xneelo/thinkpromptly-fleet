#!/usr/bin/env node
// fd-v2 L10 — LIVE-MODE proof for the Desktop sessions screen.
//
//   node docs/design/fleetdeck-v2/verify/l10-harness/live.mjs [--url http://127.0.0.1:4178]
//
// Drives <base>/v2/index.html with NO ?fixture=1 and no fd-fixture key, so
// public/v2/screens/desktop.js runs its live path: it fetches, adapts, injects its
// filter options / Refresh / count / notes / chips, and registers rowAction. The API
// is stubbed by ./stub.mjs; every user-visible string asserted here is verbatim from
// docs/goals/fd-v2-l10/BEHAVIOUR.md.
//
// The harness lives outside verify/l10/ because the pixel gate wipes that directory
// (see stub.mjs). Its OUTPUTS go there, because the README asks for them there:
// live.json ({schemaVersion, slice, capturedAt, base, results, total, passed,
// allPass}) plus live-dark.png / live-light.png. Exits non-zero when a single check
// failed. One check never aborts another: check() catches.
//
// PRECONDITION (recorded as check `shell-data-layer`): public/v2/index.html does not
// load /v2/data.js yet — that wiring is L11's cut-over — so `FD.data` is undefined in
// a stock live page and desktop.js takes its "nothing live to do" exit at line 56.
// This script therefore rewrites the served document to add the one missing
// <script src="/v2/data.js">, and nothing else. Remove the shim once L11 lands.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { install, states, empty, materialise, transcriptText, OUT } from './stub.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = flag('--url', 'http://127.0.0.1:4178').replace(/\/+$/, '');
const VIEWPORT = { width: 1440, height: 900 };
const SCREEN = '[data-screen-label="Desktop sessions"]';
const ROW = '[data-fd-l10-row]';

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const results = [];
const consoleErrors = [];
// A stubbed 4xx/5xx still makes Chromium log a resource error of its own. That is
// the network stack talking, not the app, so it is separated out and reported in
// the zero-console-errors check's detail rather than dropped in silence.
const IGNORABLE = [
  /^Failed to load resource: the server responded with a status of \d+/,
  // desktop.js:126 reports a rejected load on purpose. It only ever fires on the
  // pages where this suite breaks /api/desktop-sessions itself.
  /^\[fd-v2 l10\] desktop sessions load failed/,
];
const ignored = [];

async function check(id, action, expectation, fn) {
  const entry = { id, action, expectation, pass: false };
  try {
    const detail = await fn();
    entry.pass = true;
    if (detail) entry.detail = String(detail);
  } catch (err) {
    entry.detail = (err && err.message) || String(err);
  }
  results.push(entry);
  console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${id}${entry.pass || !entry.detail ? '' : ` — ${entry.detail.split('\n')[0]}`}`);
  return entry.pass;
}

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    (IGNORABLE.some((re) => re.test(msg.text())) ? ignored : consoleErrors).push(`[${label}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------

// The one shim: add the data layer the shell has not wired yet (see the header).
async function shimDataLayer(page) {
  const MARK = '<script src="/v2/runtime.js"></script>';
  await page.route('**/v2/index.html', async (route) => {
    const res = await route.fetch();
    const html = await res.text();
    if (!html.includes(MARK)) throw new Error('index.html no longer loads runtime.js — the data-layer shim needs rewriting');
    await route.fulfill({ response: res, body: html.replace(MARK, `<script src="/v2/data.js"></script>${MARK}`) });
  });
}

// Every page: the theme key L1 documents, video off, and a spy standing in for L6's
// FD.screens.bus.open so Message can be asserted without that slice on the page.
function seed(dark) {
  return `
    try { localStorage.setItem('fd-landing-dark', '${dark ? 1 : 0}'); } catch (e) {}
    try { localStorage.setItem('fd-app-video', '0'); } catch (e) {}
    try { localStorage.removeItem('fd-fixture'); } catch (e) {}
    window.__fdBus = [];
    window.FD = window.FD || {};
    window.FD.screens = window.FD.screens || {};
    window.FD.screens.bus = window.FD.screens.bus || {};
    window.FD.screens.bus.open = function (target) { window.__fdBus.push(target); };
  `;
}

async function openScreen(browser, label, { stub = {}, route, dark = true } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(seed(dark));
  const page = await context.newPage();
  watch(page, label);
  const requests = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/desktop-sessions')) requests.push(url.pathname + url.search);
  });
  await shimDataLayer(page);
  await install(page, stub);
  // Registered last, so it wins over stub.mjs's glob for the two checks that need to
  // change what the endpoint answers mid-page. Matched on the exact pathname, which
  // also keeps it off /api/desktop-sessions/transcript.
  if (route) await page.route((url) => url.pathname === '/api/desktop-sessions', route);
  // WORKAROUND (stub.mjs): its '**/api/desktop-sessions**' glob is registered after
  // its transcript glob, and Playwright matches routes newest-first, so the sessions
  // route swallows /api/desktop-sessions/transcript and answers it with the sessions
  // JSON. Re-registering the transcript route here — last, on an exact pathname —
  // restores the status stub.mjs was asked for. Delete this once stub.mjs orders its
  // two routes the other way round.
  const status = stub.transcript === undefined ? 200 : stub.transcript;
  await page.route((url) => url.pathname === '/api/desktop-sessions/transcript', async (r) => {
    if (status === 200) return r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: await transcriptText() });
    if (status === 404) return r.fulfill({ status: 404, contentType: 'text/plain', body: 'no transcript' });
    return r.fulfill({ status: 502, contentType: 'text/plain', body: 'transcript unavailable' });
  });

  await page.goto(`${BASE}/v2/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="Desktop sessions"]').click();
  await page.locator(SCREEN).waitFor({ state: 'visible' });
  // Live mode has landed once desktop.js has replaced the mock's count line — the
  // seed one is the only text on that node that mentions "collected".
  await page.waitForFunction(() => {
    const bar = document.querySelector('[data-screen-label="Desktop sessions"] > [data-dc-tpl]');
    const span = bar && bar.querySelector('span:not([data-fd-l10])');
    return !!span && !/collected/.test(span.textContent);
  });
  return { context, page, requests };
}

// ---------------------------------------------------------------------------
// Reading the screen
// ---------------------------------------------------------------------------

const snapshot = (page) => page.evaluate(() => {
  const norm = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const tpl = (list, id) => list.filter((n) => n.getAttribute('data-dc-tpl') === id)[0];
  const root = document.querySelector('[data-screen-label="Desktop sessions"]');
  const parts = [...root.children].filter((n) => n.hasAttribute('data-dc-tpl'));
  const bar = parts[0];
  const readRow = (el) => {
    const divs = [...el.children].filter((n) => n.tagName === 'DIV');
    const meta = [...divs[0].children][1];
    return {
      title: norm(divs[0].children[0]),
      branch: norm(meta.children[0]),
      model: norm(meta.children[1]),
      where: norm(meta.children[2]),
      when: norm(divs[1].children[0]),
      turns: norm(divs[1].children[1]),
      chips: [...el.querySelector('[data-dc-tpl="708"]').children].map(norm),
      // The details panel is the row's third div, and only exists while expanded.
      details: divs[2] ? [...divs[2].children].map((d) => [norm(d.children[0]), norm(d.children[1])]) : null,
    };
  };
  return {
    search: bar.querySelector('input').value,
    selects: [...bar.querySelectorAll('select')].map((s) => ({
      hook: s.getAttribute('data-fd-l10'),
      value: s.value,
      options: [...s.options].map((o) => o.textContent),
    })),
    count: norm(bar.querySelector('span:not([data-fd-l10])')),
    collected: norm(bar.querySelector('[data-fd-l10="collected"]')),
    refresh: norm(bar.querySelector('[data-fd-l10="refresh"]')),
    notes: [...root.querySelectorAll('[data-fd-l10="notes"] > p')].map((p) => p.textContent),
    groups: parts.slice(1).map((card) => {
      const head = [...card.children[0].children];
      return {
        name: norm(tpl(head, '675')),
        n: norm(tpl(head, '676')),
        sub: norm(tpl(head, '677')),
        machine: norm(tpl(head, '680')),
        rows: [...card.children[1].children[0].children].slice(1).map(readRow),
      };
    }),
  };
});

const titles = (snap) => snap.groups.map((g) => g.rows.map((r) => r.title));
const rows = (page) => page.locator(ROW);
const button = (page, index, aria) => rows(page).nth(index).locator(`button[aria-label="${aria}"]`);
const notes = (page) => page.locator(`${SCREEN} [data-fd-l10="notes"] > p`);
const setSelect = async (page, kind, value) => {
  await page.selectOption(`${SCREEN} select[data-fd-l10="filter-${kind}"]`, value);
  await page.waitForTimeout(120); // one microtask flush + the runtime's re-render
};

// BEHAVIOUR.md §3's sessionContext(), rebuilt from the served body so the assertion
// is against the spec's field list and order, not against the implementation.
function expectedContext(body, groupIndex, sessionId) {
  const group = body.groups[groupIndex];
  const s = group.sessions.filter((x) => x.id === sessionId)[0];
  const machine = body.machines.filter((m) => m.id === group.machine)[0];
  return [
    ['Title', s.title || 'Untitled session'],
    ['Account', [group.label, group.email, s.accountUuid].filter(Boolean).join(' · ')],
    ['Machine', (machine && machine.label) || group.machine],
    ['Directory', s.cwd],
    ['Worktree', s.worktree],
    ['Branch', s.branch],
    ['Model', s.model],
    ['Created', s.createdAt],
    ['Last activity', s.lastActivityAt],
    ['Turns', s.completedTurns],
    ['Status', s.liveState + (s.isArchived ? ', archived' : '')],
    ['CLI session', s.cliSessionId],
    ['Session', s.id],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
}

// BEHAVIOUR.md §3's age(), so the last-collection line can be asserted exactly even
// though its source is a wall-clock stamp.
function ageOf(ms) {
  const minutes = Math.floor(Math.max(0, Date.now() - ms) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + 'm ago';
  if (minutes < 1440) return Math.floor(minutes / 60) + 'h ago';
  return Math.floor(minutes / 1440) + 'd ago';
}

// desktop.js:601 takes the NEWEST per-machine collected_at, not the response's own
// collected_at (sessions.js:292 is the ground truth it cites). The states fixture's
// machines carry absolute stamps that materialise() does not rewrite, so the string
// is derived here rather than hard-coded.
const lastCollection = (body) =>
  'Last collection: ' + ageOf(body.machines.reduce((max, m) => Math.max(max, m.collected_at || 0), 0));

const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const copyLabel = (page, index) => rows(page).nth(index).locator('[data-fd-l10="copylabel"]');

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const MACHINE_NOTES = [
  'german-box: Some session files could not be read. Previously collected sessions are still shown.',
  'ivy-box: Waiting for a first collection.',
  'onboarding-box: No Desktop session directory found.',
  'win-box: Collection failed. Previously collected sessions are still shown.',
  'mac-mini: Cached metadata. Refresh to collect the latest sessions.',
];

async function main() {
  const browser = await chromium.launch();
  try {
    await check('shell-data-layer', 'fetch the shipped /v2/index.html and look for the data layer',
      'documents the one shim this run applies: the shell does not load /v2/data.js yet (L11 cut-over)', async () => {
        const html = await (await fetch(`${BASE}/v2/index.html`)).text();
        assert.ok(html.includes('<script src="/v2/screens/desktop.js"></script>'), 'the shell no longer loads screens/desktop.js');
        if (html.includes('/v2/data.js')) return 'the shell now loads /v2/data.js — the shim in shimDataLayer() is redundant and can be deleted';
        return 'shim applied: <script src="/v2/data.js"> inserted before runtime.js, nothing else changed';
      });
    await mainRows(browser);
    await mainCopyErrors(browser);
    await mainStates(browser);
  } finally {
    await check('console-clean', 'watch console + pageerror on every page of the run', 'zero console errors', () => {
      assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
      return ignored.length ? `filtered ${ignored.length} browser resource error(s) for deliberately stubbed 4xx/5xx: ${[...new Set(ignored)].join(' | ')}` : 'no messages filtered';
    });
    await browser.close();
  }
}

// -- rows, filters, actions (sessions: states, transcript: 200) ---------------

async function mainRows(browser) {
  const body = materialise(await states(), Date.now());
  const { context, page, requests } = await openScreen(browser, 'rows', { stub: { sessions: body } });
  try {
    let snap = await snapshot(page);

    await check('rows-render', 'load the screen with the six-session states fixture',
      'six rows across the person groups, "Live now" pinned first holding exactly the one live row', () => {
        assert.equal(snap.groups[0].name, 'Live now');
        assert.deepEqual(snap.groups[0].rows.map((r) => r.title), ['Live session with a target']);
        assert.deepEqual(titles(snap).slice(1), [
          ['Live session with a target', 'Remote session, liveness undecidable', 'Cached row from a stale collection', 'Archived conversation'],
          ['Untitled session', 'Plain offline session'],
        ]);
        assert.equal(snap.groups.slice(1).reduce((n, g) => n + g.rows.length, 0), 6);
      });

    await check('group-headings', 'read the two per-person group headings',
      'name, "email · Account xxxxxxxx" and the machine chip', () => {
        assert.deepEqual(snap.groups.slice(1).map((g) => [g.name, g.sub, g.machine, g.n]), [
          ['Aylin Yeter', 'aylianator@gmail.com · Account 097e8f43', 'macbook', '4'],
          ['Daniel Tabor', 'admin@deus.finance · Account be25ab11', 'german-box', '2'],
        ]);
      });

    await check('row-fallbacks', 'read the session with no title, branch, model or completedTurns',
      '"Untitled session", "No branch", "Model unknown", "Turns unknown"', () => {
        const bare = snap.groups[2].rows[0];
        assert.equal(bare.title, 'Untitled session');
        assert.equal(bare.branch, 'No branch');
        assert.equal(bare.model, 'Model unknown');
        assert.equal(bare.turns, 'Turns unknown');
      });

    await check('row-ages', 'read every row\'s last-activity string',
      'Just now, 9m ago, 1h ago, 2d ago, 30m ago, 3h ago', () => {
        assert.deepEqual(snap.groups.slice(1).map((g) => g.rows.map((r) => r.when)), [
          ['Just now', '9m ago', '1h ago', '2d ago'],
          ['30m ago', '3h ago'],
        ]);
      });

    await check('row-status-chips', 'read every row\'s status pill',
      'Live / Live unknown / Offline', () => {
        assert.deepEqual(snap.groups.slice(1).map((g) => g.rows.map((r) => r.chips[0])), [
          ['Live', 'Live unknown', 'Offline', 'Offline'],
          ['Offline', 'Offline'],
        ]);
      });

    await check('row-extra-chips', 'read the stale row\'s and the archived row\'s status cell',
      'the stale row also shows Cached; the archived row also shows Archived', () => {
        assert.deepEqual(snap.groups[1].rows.map((r) => r.chips), [
          ['Live'], ['Live unknown'], ['Offline', 'Cached'], ['Offline', 'Archived'],
        ]);
      });

    await check('row-details', 'click Show on the live row (has a worktree) and on the unknown row (has none)',
      'Created, CLI session, Session, Full path — plus Worktree only where there is one', async () => {
        await button(page, 1, 'Show session').click();
        await button(page, 2, 'Show session').click();
        await rows(page).nth(1).locator('[data-dc-tpl="733"]').waitFor();
        const now = await snapshot(page);
        const live = now.groups[1].rows[0];
        const unknown = now.groups[1].rows[1];
        assert.deepEqual(live.details.map(([k]) => k), ['Created', 'CLI session', 'Session', 'Full path', 'Worktree']);
        assert.deepEqual(unknown.details.map(([k]) => k), ['Created', 'CLI session', 'Session', 'Full path']);
        assert.deepEqual(live.details.slice(1), [
          ['CLI session', 'cli-live-1'],
          ['Session', 'local_live-1'],
          ['Full path', '/Users/misterislez/projects/fleetdeck'],
          ['Worktree', '/Users/misterislez/projects/fleetdeck/.claude/worktrees/wt-1'],
        ]);
      });

    await check('action-show-keeps-open', 'click Show again on the already-expanded live row',
      'the row stays expanded (Show expands, it never toggles)', async () => {
        await button(page, 1, 'Show session').click();
        await page.waitForTimeout(200);
        const now = await snapshot(page);
        assert.ok(now.groups[1].rows[0].details, 'details panel disappeared — Show collapsed an open row');
      });

    await check('action-message', 'click Message on the live row with FD.screens.bus.open spied on',
      'the bus is opened once with {type:"claude-desktop", session:"id:cli-live-1"}', async () => {
        await button(page, 1, 'Message session').click();
        await page.waitForTimeout(200);
        assert.deepEqual(await page.evaluate(() => window.__fdBus), [{ type: 'claude-desktop', session: 'id:cli-live-1' }]);
      });

    await check('action-message-not-live', 'click Message on the offline row',
      'nothing happens: the bus is not opened again', async () => {
        await button(page, 6, 'Message session').click();
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => window.__fdBus.length), 1);
        assert.equal(await page.evaluate(() => location.hash), '');
      });

    await check('action-copy-context', 'click Copy context on the live row and read the clipboard back',
      'exactly sessionContext(): the thirteen "Label: value" lines, empties skipped, trailing newline', async () => {
        await button(page, 1, 'Copy session context').click();
        await copyLabel(page, 1).filter({ hasText: 'Copied' }).waitFor({ timeout: 1400 });
        assert.equal(await clipboard(page), expectedContext(body, 0, 'local_live-1'));
      });

    await check('action-copy-conversation', 'click Copy conversation on the live row with the transcript stub at 200',
      'clipboard = context + "\\n" + transcript, and the label cycles to Copied', async () => {
        await page.waitForTimeout(1600); // let the previous label revert first
        await button(page, 1, 'Copy conversation').click();
        await copyLabel(page, 1).filter({ hasText: 'Copied' }).waitFor({ timeout: 1400 });
        assert.equal(await clipboard(page), expectedContext(body, 0, 'local_live-1') + '\n' + (await transcriptText()));
      });

    await check('machine-notes', 'read the per-machine notes panel',
      'all five state texts verbatim, one per machine that is not a healthy fresh "ok"', async () => {
        assert.deepEqual(await notes(page).allTextContents(), MACHINE_NOTES);
      });

    await check('request-plain-load', 'inspect the URL of the first (unforced) /api/desktop-sessions call',
      'exactly /api/desktop-sessions, no query string', () => {
        assert.ok(requests.length, 'no /api/desktop-sessions request was made');
        assert.equal(requests[0], '/api/desktop-sessions');
      });

    await check('count-line', 'read the count line and the last-collection line with no filters applied',
      '"<shown> of <total> sessions · <live> live" and "Last collection: <age>"', () => {
        assert.equal(snap.count, '6 of 6 sessions · 1 live');
        assert.match(snap.collected, /^Last collection: (Just now|\d+[mhd] ago)$/);
        assert.equal(snap.collected, lastCollection(body));
        return `last collection read from the newest machine stamp: ${snap.collected}`;
      });

    await check('filter-account', 'open the account select, then pick Aylin Yeter',
      '"All accounts" + both accounts as "label · uuid8"; picking one hides the other group', async () => {
        assert.deepEqual(snap.selects[0].options, ['All accounts', 'Aylin Yeter · 097e8f43', 'Daniel Tabor · be25ab11']);
        await setSelect(page, 'account', '097e8f43-9275-40e8-a64f-ae8cd6f486fb:d24c4827-df47-40e3-af74-574418a03a4b');
        const now = await snapshot(page);
        assert.deepEqual(now.groups.map((g) => g.name), ['Live now', 'Aylin Yeter']);
        assert.equal(now.count, '4 of 6 sessions · 1 live');
        await setSelect(page, 'account', '');
      });

    await check('filter-machine', 'open the machine select, then pick german-box',
      '"All machines" + every collected machine; picking one filters to it', async () => {
        assert.deepEqual(snap.selects[1].options,
          ['All machines', 'MacBook Pro', 'german-box', 'ivy-box', 'onboarding-box', 'win-box', 'mac-mini']);
        await setSelect(page, 'machine', 'german-box');
        const now = await snapshot(page);
        assert.deepEqual(titles(now), [['Untitled session', 'Plain offline session']]);
        assert.equal(now.count, '2 of 6 sessions · 0 live');
        await setSelect(page, 'machine', '');
      });

    await check('filter-live', 'step the live select through all four values',
      'Any live status / Live / Offline / Unknown, each filtering to the matching rows', async () => {
        assert.deepEqual(snap.selects[2].options, ['Any live status', 'Live', 'Offline', 'Unknown']);
        await setSelect(page, 'live', 'live');
        assert.deepEqual(titles(await snapshot(page)), [['Live session with a target'], ['Live session with a target']]);
        await setSelect(page, 'live', 'offline');
        assert.deepEqual(titles(await snapshot(page)), [
          ['Cached row from a stale collection', 'Archived conversation'],
          ['Untitled session', 'Plain offline session'],
        ]);
        await setSelect(page, 'live', 'unknown');
        assert.deepEqual(titles(await snapshot(page)), [['Remote session, liveness undecidable']]);
        await setSelect(page, 'live', '');
        assert.equal((await snapshot(page)).count, '6 of 6 sessions · 1 live');
      });

    await check('filter-archived', 'step the archived select through all three values',
      'All sessions / Not archived / Archived — Archived shows only the archived row, Not archived hides it', async () => {
        assert.deepEqual(snap.selects[3].options, ['All sessions', 'Not archived', 'Archived']);
        await setSelect(page, 'archived', 'archived');
        assert.deepEqual(titles(await snapshot(page)), [['Archived conversation']]);
        await setSelect(page, 'archived', 'active');
        const active = await snapshot(page);
        assert.equal(active.groups.slice(1).reduce((n, g) => n + g.rows.length, 0), 5);
        assert.ok(!JSON.stringify(titles(active)).includes('Archived conversation'));
        await setSelect(page, 'archived', '');
      });

    await check('filter-search', 'type "opus-4-8" into the search box — a string only the model field holds',
      'the widened haystack (title/cwd/worktree/branch/model) leaves only the claude-opus-4-8 row', async () => {
        await page.fill(`${SCREEN} input`, 'opus-4-8');
        await page.waitForTimeout(200);
        const now = await snapshot(page);
        assert.deepEqual(titles(now), [['Cached row from a stale collection']]);
        assert.equal(now.count, '1 of 6 sessions · 0 live');
      });

    await check('empty-filtered', 'type a string no row matches',
      '"No sessions match these filters. Reset filters to see all conversations."', async () => {
        await page.fill(`${SCREEN} input`, 'zzz-no-such-session');
        await page.waitForTimeout(200);
        const now = await snapshot(page);
        assert.deepEqual(now.groups, []);
        assert.deepEqual(now.notes.slice(-1), ['No sessions match these filters. Reset filters to see all conversations.']);
      });

    await check('filter-reset', 'set all five controls, then click Reset',
      'search and all four selects go back to their defaults and every row returns', async () => {
        await page.fill(`${SCREEN} input`, 'claude');
        await setSelect(page, 'account', 'be25ab11-4696-444a-b1b7-3b287c0ca994:8323fe6e-fd4d-4f47-8a0d-7291a9da464c');
        await setSelect(page, 'machine', 'german-box');
        await setSelect(page, 'live', 'offline');
        await setSelect(page, 'archived', 'active');
        await page.click(`${SCREEN} [data-fd-l10-reset]`);
        await page.waitForFunction(() => {
          const bar = document.querySelector('[data-screen-label="Desktop sessions"] > [data-dc-tpl]');
          return bar.querySelector('input').value === '' && [...bar.querySelectorAll('select')].every((s) => s.value === '');
        });
        const now = await snapshot(page);
        assert.equal(now.search, '');
        assert.deepEqual(now.selects.map((s) => s.value), ['', '', '', '']);
        assert.equal(now.count, '6 of 6 sessions · 1 live');
        assert.equal(now.groups.length, 3);
      });

    await check('screenshots', 'screenshot the live screen, then click the app\'s light/dark toggle and screenshot again',
      'live-dark.png and live-light.png, with fd-landing-dark flipped to "0"', async () => {
        await page.screenshot({ path: join(OUT, 'live-dark.png'), fullPage: true, animations: 'disabled', caret: 'hide' });
        await page.click('[data-screen-label="Fleetdeck app"] button[aria-label="Toggle light / dark mode"]');
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => localStorage.getItem('fd-landing-dark')), '0');
        await page.screenshot({ path: join(OUT, 'live-light.png'), fullPage: true, animations: 'disabled', caret: 'hide' });
        return 'live-dark.png, live-light.png';
      });

    // Not on the mandated list. Added because live-light.png showed it failing: the
    // injected nodes used to copy their tokens off a template node once, in their
    // `if (!node)` create branch, so a light/dark toggle left them on the old theme
    // and near-invisible. desktop.js:422 restyle() now re-reads the source style on
    // every apply(). This check is the regression guard for that.
    await check('theme-resync', 'read the colours of the injected nodes after clicking the light/dark toggle',
      'every injected node re-themes with the screen, the way the template nodes do', async () => {
        const colours = () => page.evaluate(() => {
          const colour = (sel) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el).color : null;
          };
          return {
            template: colour('[data-screen-label="Desktop sessions"] [data-dc-tpl="668"]'),
            collected: colour('[data-fd-l10="collected"]'),
            note: colour('[data-fd-l10="notes"] > p'),
            refresh: colour('[data-fd-l10="refresh"]'),
            cached: colour('[data-fd-l10="cached"]'),
          };
        });
        // The page is already in light mode from the screenshots check above.
        const now = await colours();
        const stale = Object.keys(now).filter((k) => k !== 'template' && now[k] !== now.template && /^rgba\(255, 255, 255/.test(now[k]));
        assert.deepEqual(stale, [],
          'REGRESSION public/v2/screens/desktop.js — these injected nodes kept the previous theme\'s tokens after ' +
          'the toggle, so the Refresh button, the "Last collection" line, the machine notes and the Cached/Archived ' +
          'chips go near-invisible. restyle() (desktop.js:422) must re-read its source style on every apply(), and ' +
          'apply() must be reached after a theme flip. Colours read in light mode: ' + JSON.stringify(now));
      });
  } finally {
    await context.close();
  }
}

// -- the two transcript failures --------------------------------------------

async function mainCopyErrors(browser) {
  for (const [status, label, id] of [[404, 'No transcript', 'transcript-404'], [502, 'Copy failed', 'transcript-502']]) {
    const body = materialise(await states(), Date.now());
    const { context, page } = await openScreen(browser, id, { stub: { sessions: body, transcript: status } });
    try {
      await check(id, `click Copy conversation with the transcript endpoint answering ${status}`,
        `the label reads "${label}"`, async () => {
          await button(page, 1, 'Copy conversation').click();
          await copyLabel(page, 1).filter({ hasText: label }).waitFor({ timeout: 1400 });
          assert.equal((await copyLabel(page, 1).textContent()).trim(), label);
        });
    } finally {
      await context.close();
    }
  }
}

// -- empty, load failures, refresh, the vanished selection --------------------

async function mainStates(browser) {
  {
    const { context, page } = await openScreen(browser, 'empty', { stub: { sessions: materialise(await empty(), Date.now()) } });
    try {
      await check('empty-nothing-collected', 'load with a collection that returned no groups and no machines',
        'the empty text verbatim and "No completed collection" as the last-collection line', async () => {
          const snap = await snapshot(page);
          assert.deepEqual(snap.notes, ['No Desktop sessions collected yet. Open a Code tab on a configured machine, then refresh.']);
          assert.equal(snap.collected, 'No completed collection');
          assert.equal(snap.count, '0 of 0 sessions · 0 live');
        });
    } finally {
      await context.close();
    }
  }

  {
    const { context, page } = await openScreen(browser, 'first-load-500', { stub: { sessions: 500 } });
    try {
      await check('first-load-failure', 'let the very first /api/desktop-sessions answer HTTP 500',
        '"Sessions could not be refreshed. Try Refresh to reconnect.", count "Sessions unavailable", body "Could not load desktop sessions."', async () => {
          await page.waitForFunction(() => document.querySelector('[data-screen-label="Desktop sessions"] [data-fd-l10="notes"] > p'));
          const snap = await snapshot(page);
          assert.deepEqual(snap.notes, [
            'Sessions could not be refreshed. Try Refresh to reconnect.',
            'Could not load desktop sessions.',
          ]);
          assert.equal(snap.count, 'Sessions unavailable');
          assert.deepEqual(snap.groups, []);
        });
    } finally {
      await context.close();
    }
  }

  {
    // Good first, broken after: the note changes and the rows must survive.
    let broken = false;
    const body = materialise(await states(), Date.now());
    const { context, page } = await openScreen(browser, 'refresh-500', {
      route: (route) => (broken
        ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })),
    });
    try {
      await check('later-load-failure', 'load once successfully, then break the endpoint and click Refresh',
        '"Sessions could not be refreshed. The last view is still shown." and the rows stay on screen', async () => {
          assert.equal((await snapshot(page)).groups.length, 3);
          broken = true;
          await page.click(`${SCREEN} [data-fd-l10="refresh"]`);
          await notes(page).first().filter({ hasText: 'The last view is still shown.' }).waitFor();
          const snap = await snapshot(page);
          assert.equal(snap.notes[0], 'Sessions could not be refreshed. The last view is still shown.');
          assert.equal(snap.groups.length, 3);
          assert.equal(snap.groups.slice(1).reduce((n, g) => n + g.rows.length, 0), 6);
        });
    } finally {
      await context.close();
    }
  }

  {
    // A deliberately slow forced collect, so "Collecting…" is observable.
    const body = materialise(await states(), Date.now());
    const slow = async (route) => {
      if (new URL(route.request().url()).search === '?refresh=1') await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    };
    const { context, page, requests } = await openScreen(browser, 'refresh', { route: slow });
    try {
      await check('refresh-forces-collect', 'click Refresh',
        'the request carries refresh=1 and the button reads "Collecting…" until it answers', async () => {
          await page.click(`${SCREEN} [data-fd-l10="refresh"]`);
          await page.locator(`${SCREEN} [data-fd-l10="refresh"]`).filter({ hasText: 'Collecting…' }).waitFor({ timeout: 1000 });
          await page.locator(`${SCREEN} [data-fd-l10="refresh"]`).filter({ hasText: 'Refresh' }).waitFor();
          assert.deepEqual(requests, ['/api/desktop-sessions', '/api/desktop-sessions?refresh=1']);
        });
    } finally {
      await context.close();
    }
  }

  {
    // Aylin selected, then a payload that no longer has her.
    let full = true;
    const whole = materialise(await states(), Date.now());
    const shrunk = { ...whole, groups: whole.groups.slice(1) };
    const AYLIN = '097e8f43-9275-40e8-a64f-ae8cd6f486fb:d24c4827-df47-40e3-af74-574418a03a4b';
    const { context, page } = await openScreen(browser, 'vanished-account', {
      route: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(full ? whole : shrunk) }),
    });
    try {
      await check('vanished-selection', 'select an account, then serve a payload without it and click Refresh',
        'the select keeps the selection and offers it as "Previously selected (unavailable)"', async () => {
          await setSelect(page, 'account', AYLIN);
          full = false;
          await page.click(`${SCREEN} [data-fd-l10="refresh"]`);
          await page.waitForFunction(() => {
            const sel = document.querySelector('[data-screen-label="Desktop sessions"] select[data-fd-l10="filter-account"]');
            return !!sel && [...sel.options].some((o) => o.textContent === 'Previously selected (unavailable)');
          });
          const account = (await snapshot(page)).selects[0];
          assert.equal(account.value, AYLIN);
          assert.deepEqual(account.options, ['All accounts', 'Daniel Tabor · be25ab11', 'Previously selected (unavailable)']);
        });
    } finally {
      await context.close();
    }
  }
}

// ---------------------------------------------------------------------------

await main();

const passed = results.filter((r) => r.pass).length;
const report = {
  schemaVersion: 1,
  slice: 'l10',
  capturedAt: new Date().toISOString(),
  base: BASE,
  results,
  total: results.length,
  passed,
  allPass: passed === results.length,
};
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'live.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\n${passed}/${results.length} checks passed → ${join(OUT, 'live.json')}`);
process.exit(report.allPass ? 0 : 1);
