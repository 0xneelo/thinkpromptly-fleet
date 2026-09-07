#!/usr/bin/env node
// v2-live-check.mjs — the L4 behaviour gate for the Registry screen.
//
// Drives /v2/index.html in LIVE mode (no ?fixture=1) with every /api/** call
// stubbed from docs/design/fleetdeck-v2/fixtures/api/, and asserts the 36
// behaviours docs/goals/fd-v2-l4/BEHAVIOUR.md lists. Every asserted string is
// quoted from that spec, which is why they are written out in full instead of
// composed from the screen's own constants: a gate that imports the strings it
// checks proves nothing.
//
// The screen is public/v2/screens/registry.js. It owns the live registry by
// progressive enhancement over the compiled mock, stamping its own data-l4-*
// hooks; those hooks are what this file selects on, because the mock's markup
// carries nothing but [data-screen-label="Registry"].
//
// Since the S2 shim audit the screen may not add a child to a compiled node, so
// half of what is asserted here is NOT where a reader would first look:
//   * everything improvised — the ⋯ menu, the details panel, the cell editor,
//     the toasts, the bulk Forget button and three <select>s — is in
//     #fd-l4-layer, a body-level div positioned over the element it belongs to;
//   * the sort arrow and the bulk Kill count are ::after rules off data-l4-dir
//     and data-l4-count, so they are asserted as attributes, with the rendered
//     ::after text checked where it resolves;
//   * only the live/gone select is compiled; status and last-msg are compiled
//     selects made visibility:hidden under full-menu overlays.
//
// Each check is independent: a failure is recorded and the run continues, and
// the page is reloaded between groups that mutate filters, sort or selection.
// The stubs never let an /api/** request reach the network.
//
// Usage:
//   node docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs [--app http://127.0.0.1:3247/v2/index.html]
//                                [--out verify/l4/live.json]
// Exit 0 when all 36 pass, 1 otherwise, 2 on a bad flag. Run from the worktree
// root so the `playwright` import resolves.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// This file lives at docs/design/fleetdeck-v2/verify/l4-live/, four levels down.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const API_FIXTURES = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const DEFAULT_APP = 'http://127.0.0.1:3247/v2/index.html';
const DEFAULT_OUT = 'verify/l4/live.json';
const TIMEOUT = 20_000;
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });

const SESSIONS = JSON.parse(readFileSync(join(API_FIXTURES, 'sessions.json'), 'utf8'));
const ROWS = SESSIONS.sessions;
const LIVE_ROWS = ROWS.filter((s) => s.live);
const GONE_ROWS = ROWS.filter((s) => !s.live);

// BEHAVIOUR §2: the filter is a lowercase substring over these eight fields.
const SEARCH_FIELDS = ['name', 'host', 'label', 'group', 'task', 'note', 'role', 'worker'];
// A host-only needle, so a hit proves `host` is in the haystack and not just `name`.
const HOST_ONLY_Q = 'onboarding';

// Anything that is not /api/sessions still has to answer, or another screen's
// fetcher rejects and its toast covers the table we are measuring.
const EMPTY_OK = Object.freeze({
  ok: true, sessions: [], errors: [], rows: [], items: [], keys: [], machines: [],
  accounts: [], messages: [], threads: [], groups: [], seats: [], credits: [], health: {},
});

// The report's results are emitted in this order whatever happens during the run.
const ORDER = [
  ['rows-render', '§1'], ['col-session', '§1'], ['col-group', '§1'], ['col-task', '§1'],
  ['col-status', '§1'], ['col-seen-gone', '§1'], ['edit-open', '§1'], ['edit-save', '§1'],
  ['edit-toast-ok', '§1'], ['edit-escape', '§1'],
  ['filter-search', '§2'], ['filter-live', '§2'], ['filter-status', '§2'], ['filter-msg-ages', '§2'],
  ['filter-active-select', '§2'], ['count-filtered', '§2'], ['filter-reset', '§2'], ['filter-persist', '§2'],
  ['sort-asc', '§3'], ['sort-desc', '§3'], ['sort-unset-last', '§3'], ['sort-persist', '§3'],
  ['select-row', '§4'], ['bulk-kill-label', '§4'], ['bulk-forget-label', '§4'], ['select-all', '§4'],
  ['bulk-clear', '§4'], ['bulk-kill-confirm', '§4'], ['bulk-row-independent', '§4'],
  ['menu-items', '§5'], ['act-tag', '§5'], ['act-hide', '§5'], ['act-forget', '§5'],
  ['act-kill-confirm', '§5'], ['act-show-hook', '§5'], ['act-message-hook', '§5'],
  ['details-row', '§6-§7'],
];

// ----------------------------------------------------------------- assertions
const fail = (message) => { throw new Error(message); };
const ok = (condition, message) => { if (!condition) fail(message); };
const eq = (actual, expected, what) => {
  if (actual !== expected) fail(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const deepEq = (actual, expected, what) => eq(JSON.stringify(actual), JSON.stringify(expected), what);

// Node-side polling: the page settles through a fetch, a render and a rAF
// decoration pass, so nothing here can be asserted on the next tick.
async function until(probe, what, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) fail(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

// ------------------------------------------------------------------ page-side
// Installed on every document, before any of the app's own scripts run.
function initPage() {
  // A stale filter or sort from a previous group must not leak into this load.
  try {
    localStorage.removeItem('fleetFilter');
    localStorage.removeItem('fleetSort');
    localStorage.removeItem('fleetTab');
  } catch { /* storage disabled: the screen swallows that too */ }
  const log = { confirms: [], opens: [], openMax: [], bus: [], toasts: [] };
  window.__l4 = log;
  window.confirm = (message) => { log.confirms.push(String(message)); return true; };
  window.open = (...args) => { log.opens.push(args); return null; };
  // A toast lives 3 s (ok) or 6 s (err) and a pending one is rewritten in place,
  // so the strings are recorded as they appear rather than read afterwards.
  const seen = new Set();
  const sweep = () => {
    const host = document.querySelector('[data-l4-toasts]');
    if (!host) return;
    for (const el of host.children) {
      const text = el.textContent;
      if (text && !seen.has(text)) { seen.add(text); log.toasts.push(text); }
    }
  };
  const observe = () => new MutationObserver(sweep)
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });
}

const LAYER = '#fd-l4-layer';                                     // everything improvised
const SCREEN = '[data-screen-label="Registry"]';                  // everything compiled
const rowSel = (id) => `[data-l4-row="${id}"]`;
const readRows = (page) => page.$$eval('[data-l4-row]', (els) => els.map((el) => ({
  id: el.getAttribute('data-l4-row'),
  cells: Array.from(el.children, (cell) => cell.textContent),
  checked: !!el.firstElementChild.querySelector('svg'),
})));
const readLog = (page, field) => page.evaluate((f) => window.__l4[f].slice(), field);
const optionValues = (page, selector) =>
  page.$eval(selector, (el) => Array.from(el.options, (o) => o.value));
// A ::after string, without its quotes; '' when the browser leaves attr() unresolved.
const after = (page, selector) => page.$eval(selector, (el) => {
  const content = getComputedStyle(el, '::after').content;
  return /^".*"$/.test(content) ? content.slice(1, -1) : '';
});
const rect = (page, selector) => page.$eval(selector, (el) => {
  const box = el.getBoundingClientRect();
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
});
// The count is the filter row's own "<n> rows" span (template.dc.html:359).
const countText = (page) => page.$eval('[data-screen-label="Registry"]', (el) =>
  Array.from(el.firstElementChild.querySelectorAll('span'), (span) => span.textContent).find((text) => / rows$/.test(text)));
const readBulk = (page) => page.evaluate(() => {
  const kill = document.querySelector('[data-l4-bulk="kill"]');   // compiled, in the bar
  if (!kill) return null;
  const forget = document.querySelector('#fd-l4-layer [data-l4-bulk="forget"]');
  return {
    count: kill.parentElement.firstElementChild.textContent,
    killText: kill.textContent,
    killCount: kill.getAttribute('data-l4-count'),
    killDisabled: kill.disabled,
    killOff: kill.getAttribute('data-l4-off'),
    forget: forget ? forget.textContent : null,
  };
});
const menuItems = (page) => page.$$eval('#fd-l4-layer [data-l4-menu]', (els) =>
  els.map((el) => ({ id: el.getAttribute('data-l4-menu'), label: el.textContent })));

// ------------------------------------------------------------------ navigation
async function enterRegistry(page, app) {
  await page.goto(app, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  // The same two clicks scripts/design-diff.mjs uses to reach this screen.
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="Registry"]').click();
  await page.locator('[data-screen-label="Registry"]').waitFor({ state: 'visible' });
  // Rows only exist after the fetch, the publish and the decoration pass.
  await page.waitForFunction(() => document.querySelectorAll('[data-l4-row]').length > 0, null, { timeout: TIMEOUT });
}

// --------------------------------------------------------------------- the run
async function run({ app, out }) {
  const require = createRequire(import.meta.url);
  const posts = [];
  const results = [];
  const record = (id, section, name, pass, detail) => {
    results.push({ id, section, name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${name}${pass ? '' : `: ${detail}`}`);
  };
  const browser = await chromium.launch();
  let report;
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark',
      reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
    });
    context.setDefaultTimeout(TIMEOUT);
    await context.addInitScript(initPage);
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const method = request.method();
      if (method !== 'GET') {
        let body = request.postData();
        try { body = JSON.parse(body ?? 'null'); } catch { /* keep the raw text */ }
        posts.push({ method, pathname, body });
      }
      if (pathname === '/api/sessions') return route.fulfill({ json: SESSIONS });
      if (pathname === '/api/kill' && killDelayMs) await new Promise((done) => setTimeout(done, killDelayMs));
      return route.fulfill({ json: EMPTY_OK });
    });
    // A bulk batch is only observable mid-flight if its writes are slow, and only
    // this check wants that, so the delay is armed for the length of one check.
    let killDelayMs = 0;
    const page = await context.newPage();

    // One check: failures are recorded, never thrown, so nothing cascades.
    const check = async (id, name, body) => {
      const section = (ORDER.find((entry) => entry[0] === id) || [])[1] || '';
      try { record(id, section, name, true, (await body()) || ''); }
      catch (error) { record(id, section, name, false, error.message); }
    };
    // A group shares one page load; if the load itself fails its checks fail with it.
    const group = async (ids, body) => {
      try { await enterRegistry(page, app); }
      catch (error) {
        for (const id of ids) record(id, (ORDER.find((e) => e[0] === id) || [])[1] || '', id, false, `page setup failed: ${error.message}`);
        return;
      }
      await body(check);
    };
    const postsSince = async (mark, count, what) => {
      await until(() => posts.length >= mark + count, what);
      return posts.slice(mark);
    };
    const noPostsSince = async (mark, what) => {
      // The screen reloads the list after an escape or a hook call; give the
      // round trip time to land before claiming no POST followed it.
      await page.waitForTimeout(800);
      ok(posts.length === mark, `${what}: ${JSON.stringify(posts.slice(mark))}`);
    };
    const waitToast = async (page_, exact) => {
      const seen = await until(async () => {
        const all = await readLog(page_, 'toasts');
        return all.includes(exact) ? all : null;
      }, `toast ${JSON.stringify(exact)}`).catch(async (error) => {
        fail(`${error.message}; saw ${JSON.stringify(await readLog(page_, 'toasts'))}`);
      });
      return seen;
    };

    // ------------------------------------------------- §1 columns (read only)
    const firstGone = ROWS.findIndex((s) => !s.live);
    const emptyGroup = ROWS.findIndex((s) => !s.group);
    const withTask = ROWS.findIndex((s) => s.task);
    await group(['rows-render', 'col-session', 'col-group', 'col-task', 'col-status', 'col-seen-gone'], async (c) => {
      const rows = await readRows(page);
      await c('rows-render', 'one row element per API session', () => {
        eq(rows.length, ROWS.length, 'row count');
        return `${rows.length} rows`;
      });
      await c('col-session', "Session cell is the API row's name", () => {
        eq(rows[0].cells[1], ROWS[0].name, 'first Session cell');
        return rows[0].cells[1];
      });
      await c('col-group', 'an empty API group renders —', () => {
        ok(emptyGroup >= 0, 'no fixture row has an empty group');
        eq(rows[emptyGroup].cells[2], '—', `Group cell of row ${emptyGroup}`);
        return `row ${emptyGroup}`;
      });
      await c('col-task', 'a set API task renders its text', () => {
        ok(withTask >= 0, 'no fixture row has a task');
        eq(rows[withTask].cells[3], ROWS[withTask].task, `Task cell of row ${withTask}`);
        return rows[withTask].cells[3];
      });
      await c('col-status', 'the status pill text is the API status', () => {
        const wrong = rows.findIndex((row, i) => row.cells[4] !== ROWS[i].status);
        ok(wrong === -1, wrong === -1 ? '' : `row ${wrong}: ${rows[wrong].cells[4]} != ${ROWS[wrong].status}`);
        return `all ${rows.length} pills match`;
      });
      await c('col-seen-gone', 'a gone row prefixes "gone · last seen "', () => {
        ok(firstGone >= 0, 'no fixture row is gone');
        const seen = rows[firstGone].cells[7];
        ok(seen.startsWith('gone · last seen '), `Last seen cell of row ${firstGone}: ${JSON.stringify(seen)}`);
        return seen;
      });
    });

    // ------------------------------------------------------------ §1 editing
    const groupRow = ROWS.find((s) => s.group);
    const groupId = groupRow && `${groupRow.host}/${groupRow.name}`;
    await group(['edit-open', 'edit-save', 'edit-toast-ok'], async (c) => {
      const cell = page.locator(`${rowSel(groupId)} > span:nth-child(3)`);
      // The editor is ours: an input in the layer over a cell flagged data-l4-editing.
      const editor = page.locator(`${LAYER} input`);
      await c('edit-open', 'clicking a Group cell opens an input with the current value', async () => {
        await cell.click();
        await editor.waitFor({ state: 'visible' });
        eq(await editor.inputValue(), groupRow.group, 'editor value');
        eq(await cell.getAttribute('data-l4-editing'), '1', 'the cell is flagged as editing');
        const over = await rect(page, `${LAYER} input`);
        const under = await rect(page, `${rowSel(groupId)} > span:nth-child(3)`);
        ok(Math.abs(over.left - under.left) <= 1 && Math.abs(over.width - under.width) <= 1,
          `the editor is not over its cell: ${JSON.stringify(over)} vs ${JSON.stringify(under)}`);
        return `input carries ${JSON.stringify(groupRow.group)} over its cell`;
      });
      await editor.press('Escape').catch(() => {});
      await page.waitForTimeout(300);

      const mark = posts.length;
      await c('edit-save', 'Enter POSTs /api/registry with {host,name,group} only', async () => {
        await cell.click();
        const input = editor;
        await input.waitFor({ state: 'visible' });
        await input.fill('l4-check');
        await input.press('Enter');
        const [sent] = await postsSince(mark, 1, 'the group save POST');
        eq(sent.method, 'POST', 'method');
        eq(sent.pathname, '/api/registry', 'path');
        deepEq(sent.body, { host: groupRow.host, name: groupRow.name, group: 'l4-check' }, 'body');
        deepEq(Object.keys(sent.body).sort(), ['group', 'host', 'name'], 'body keys');
        return JSON.stringify(sent.body);
      });
      await c('edit-toast-ok', 'the save toasts "Saved group"', async () => {
        await waitToast(page, 'Saved group');
        return 'Saved group';
      });
    });

    await group(['edit-escape'], async (c) => {
      await c('edit-escape', 'Escape discards the edit and sends no POST', async () => {
        const mark = posts.length;
        await page.locator(`${rowSel(groupId)} > span:nth-child(3)`).click();
        const input = page.locator(`${LAYER} input`);
        await input.waitFor({ state: 'visible' });
        await input.fill('discard-me');
        await input.press('Escape');
        await noPostsSince(mark, 'Escape sent a POST');
        return 'no POST';
      });
    });

    // ------------------------------------------------------------- §2 filters
    const expectedQ = ROWS.filter((s) => SEARCH_FIELDS.some((f) => s[f] && String(s[f]).toLowerCase().includes(HOST_ONLY_Q)));
    await group(['filter-search', 'filter-live', 'filter-status', 'filter-msg-ages', 'filter-active-select',
      'count-filtered', 'filter-reset', 'filter-persist'], async (c) => {
      const search = page.locator(`${SCREEN} input[placeholder="Search sessions"]`);
      // live/gone is the one menu the mock carries in full, so it is the compiled
      // select; status, last-msg and active-age are overlays in the layer.
      const live = page.locator(`${SCREEN} select[data-l4-filter="live"]`);
      const overlay = (name) => page.locator(`${LAYER} select[data-l4-filter="${name}"]`);

      await c('filter-search', 'the search is a lowercase substring over all eight fields', async () => {
        ok(expectedQ.length > 0 && expectedQ.length < ROWS.length, `"${HOST_ONLY_Q}" is not a narrowing needle`);
        const hostOnly = expectedQ.every((s) => s.host.toLowerCase().includes(HOST_ONLY_Q)
          && !SEARCH_FIELDS.filter((f) => f !== 'host').some((f) => s[f] && String(s[f]).toLowerCase().includes(HOST_ONLY_Q)));
        ok(hostOnly, `"${HOST_ONLY_Q}" matches a field other than host`);
        // Typed upper case: matching lowercases both sides.
        await search.fill(HOST_ONLY_Q.toUpperCase());
        const rows = await until(async () => {
          const all = await readRows(page);
          return all.length === expectedQ.length ? all : null;
        }, `${expectedQ.length} rows for "${HOST_ONLY_Q}"`);
        deepEq(rows.map((r) => r.id), expectedQ.map((s) => `${s.host}/${s.name}`), 'matched rows');
        return `${rows.length} of ${ROWS.length} on a host-only needle`;
      });
      await search.fill('');
      await until(async () => (await readRows(page)).length === ROWS.length, 'the cleared search');

      await c('filter-live', 'live leaves 85 rows and gone leaves 29', async () => {
        await live.selectOption('live');
        await until(async () => (await readRows(page)).length === LIVE_ROWS.length, `${LIVE_ROWS.length} live rows`);
        await live.selectOption('gone');
        await until(async () => (await readRows(page)).length === GONE_ROWS.length, `${GONE_ROWS.length} gone rows`);
        return `live ${LIVE_ROWS.length}, gone ${GONE_ROWS.length}`;
      });
      await live.selectOption('');
      await until(async () => (await readRows(page)).length === ROWS.length, 'the cleared live filter');

      await c('filter-status', 'the status select offers the five states plus any', async () => {
        const values = await optionValues(page, `${LAYER} select[data-l4-filter="status"]`);
        deepEq(values, ['', 'active', 'done', 'kill-requested', 'killed', 'hidden'], 'status options');
        return values.join('|');
      });
      await c('filter-msg-ages', 'the last-msg select offers the six ages', async () => {
        const values = await optionValues(page, `${LAYER} select[data-l4-filter="msg"]`);
        deepEq(values, ['', '1h', '6h', '1d', '3d', '7d'], 'last-msg options');
        return values.join('|');
      });
      await c('filter-active-select', 'a fourth select carries the same six ages', async () => {
        const all = await page.$$eval('select[data-l4-filter]', (els) => els.map((el) => el.getAttribute('data-l4-filter')));
        deepEq(all.slice().sort(), ['active', 'live', 'msg', 'status'], 'the four filter selects');
        const values = await optionValues(page, `${LAYER} select[data-l4-filter="active"]`);
        deepEq(values, ['', '1h', '6h', '1d', '3d', '7d'], 'active-age options');
        // I-L4-02 places it 10px right of the last-msg select, in its own size.
        const msg = await rect(page, `${LAYER} select[data-l4-filter="msg"]`);
        const active = await rect(page, `${LAYER} select[data-l4-filter="active"]`);
        ok(Math.abs(active.left - (msg.right + 10)) <= 1 && Math.abs(active.top - msg.top) <= 1,
          `the active-age select is not beside last-msg: ${JSON.stringify(active)} vs ${JSON.stringify(msg)}`);
        return `4 selects, active-age at +10px: ${values.join('|')}`;
      });

      await c('count-filtered', 'the count reads "<k> of <n>" filtered and "<n>" clean', async () => {
        eq(await countText(page), `${ROWS.length} rows`, 'unfiltered count');
        await live.selectOption('live');
        await until(async () => (await readRows(page)).length === LIVE_ROWS.length, 'the live filter');
        const filtered = await countText(page);
        eq(filtered, `${LIVE_ROWS.length} of ${ROWS.length} rows`, 'filtered count');
        return filtered;
      });

      await c('filter-reset', 'Reset restores the defaults and drops fleetFilter', async () => {
        await search.fill('FD');
        await overlay('status').selectOption('active');
        await overlay('msg').selectOption('1d');
        await overlay('active').selectOption('6h');
        await until(async () => await page.evaluate(() => localStorage.getItem('fleetFilter')), 'a persisted filter');
        await page.locator(SCREEN).getByRole('button', { name: 'Reset', exact: true }).click();
        const state = await until(async () => {
          const now = await page.evaluate(() => ({
            q: document.querySelector('[data-screen-label="Registry"] input[placeholder="Search sessions"]').value,
            selects: Array.from(document.querySelectorAll('select[data-l4-filter]'), (el) => el.value),
            stored: localStorage.getItem('fleetFilter'),
            rows: document.querySelectorAll('[data-l4-row]').length,
          }));
          return now.q === '' && now.selects.every((v) => v === '') && now.stored === null ? now : null;
        }, 'the reset filter row');
        eq(state.rows, ROWS.length, 'rows after reset');
        return `all ${state.selects.length} selects and the search cleared, fleetFilter removed`;
      });

      await c('filter-persist', 'typing persists fleetFilter.q', async () => {
        await search.fill('gb-home');
        const stored = await until(async () => {
          const raw = await page.evaluate(() => localStorage.getItem('fleetFilter'));
          const parsed = raw && JSON.parse(raw);
          return parsed && parsed.q === 'gb-home' ? parsed : null;
        }, 'fleetFilter.q');
        eq(typeof stored, 'object', 'fleetFilter shape');
        return JSON.stringify(stored);
      });
    });

    // ---------------------------------------------------------------- §3 sort
    const ascending = (values) => values.every((v, i) => i === 0 || values[i - 1].toLowerCase() <= v.toLowerCase());
    await group(['sort-asc', 'sort-desc', 'sort-unset-last', 'sort-persist'], async (c) => {
      const header = page.locator('[data-l4-sort="name"]');
      // The rows re-render on the click and the marker lands one rAF later (the
      // decoration pass), so both have to be waited for as one state. The header
      // label is compiled text, so the arrow is a ::after off data-l4-dir.
      const sorted = async (dir, arrow, order) => {
        const seen = await until(async () => {
          const rows = await readRows(page);
          const names = rows.map((r) => r.cells[1]);
          const marker = await header.getAttribute('data-l4-dir');
          return rows.length === ROWS.length && order(names) && marker === dir ? names : null;
        }, `the session names ${dir} under data-l4-dir="${dir}"`);
        eq(await header.textContent(), 'Session', 'the compiled header text is untouched');
        eq(await after(page, '[data-l4-sort="name"]'), arrow, 'rendered ::after arrow');
        return `${seen.length} names ${dir}, "Session${arrow}"`;
      };
      await c('sort-asc', 'the Session header sorts ascending and shows ▲', async () => {
        await header.click();
        return sorted('asc', ' ▲', ascending);
      });
      await c('sort-desc', 'a second click sorts descending and shows ▼', async () => {
        await header.click();
        return sorted('desc', ' ▼', (names) => ascending(names.slice().reverse()));
      });
      await c('sort-unset-last', 'sorting by Group sinks — to the bottom both ways', async () => {
        const boundary = async (direction) => {
          const groups = await until(async () => {
            const rows = await readRows(page);
            return rows.length === ROWS.length ? rows.map((r) => r.cells[2]) : null;
          }, `the ${direction} group sort`);
          const lastSet = groups.reduce((last, g, i) => (g === '—' ? last : i), -1);
          const firstUnset = groups.indexOf('—');
          ok(firstUnset > lastSet, `${direction}: — at index ${firstUnset} before the last set group at ${lastSet}`);
          return `${direction}: ${groups.length - firstUnset} unset rows last`;
        };
        await page.locator('[data-l4-sort="group"]').click();
        const asc = await boundary('asc');
        await page.locator('[data-l4-sort="group"]').click();
        const desc = await boundary('desc');
        return `${asc}; ${desc}`;
      });
      await c('sort-persist', 'fleetSort holds {overview:{key,dir}}', async () => {
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fleetSort')));
        deepEq(stored, { overview: { key: 'group', dir: 'desc' } }, 'fleetSort');
        return JSON.stringify(stored);
      });
    });

    // --------------------------------------------------- §4 selection and bulk
    const liveIds = LIVE_ROWS.map((s) => `${s.host}/${s.name}`);
    const goneIds = GONE_ROWS.map((s) => `${s.host}/${s.name}`);
    const tick = (id) => page.locator(`${rowSel(id)} button[aria-label="Select row"]`).click();
    await group(['select-row', 'bulk-kill-label', 'bulk-forget-label', 'select-all', 'bulk-clear', 'bulk-kill-confirm'], async (c) => {
      await c('select-row', 'ticking a row shows the bulk bar reading "<n> selected"', async () => {
        await tick(liveIds[0]);
        const bar = await until(async () => await readBulk(page), 'the bulk bar');
        eq(bar.count, '1 selected', 'bulk count');
        return bar.count;
      });
      await c('bulk-kill-label', 'Kill counts the live rows and is disabled at zero', async () => {
        // The button's own text stays the compiled "Kill"; the count is a ::after
        // off data-l4-count, so the label is asserted as attribute + rendered text.
        const withLive = await until(async () => {
          const bar = await readBulk(page);
          return bar && bar.killCount === '1 live' ? bar : null;
        }, 'data-l4-count="1 live"');
        eq(withLive.killText, 'Kill', 'the compiled Kill label');
        ok(!withLive.killDisabled && withLive.killOff === null, 'Kill is disabled with a live row ticked');
        await tick(liveIds[0]);          // untick the live row
        await tick(goneIds[0]);          // leave only a gone row ticked
        const goneOnly = await until(async () => {
          const bar = await readBulk(page);
          return bar && bar.killCount === '0 live' ? bar : null;
        }, 'data-l4-count="0 live"');
        ok(goneOnly.killDisabled && goneOnly.killOff === '1', 'Kill is enabled with no live row ticked');
        return 'Kill 1 live enabled; Kill 0 live disabled + data-l4-off';
      });
      await c('bulk-forget-label', 'Forget appears only for gone rows', async () => {
        const goneOnly = await until(async () => {
          const bar = await readBulk(page);
          return bar && bar.forget ? bar : null;
        }, 'the Forget button');
        eq(goneOnly.forget, 'Forget 1 gone', 'Forget label');
        await tick(goneIds[0]);          // untick the gone row
        await tick(liveIds[0]);          // one live row, no gone row
        const liveOnly = await until(async () => {
          const bar = await readBulk(page);
          return bar && bar.killCount === '1 live' ? bar : null;
        }, 'a live-only selection');
        eq(liveOnly.forget, null, 'Forget button with no gone row ticked');
        return 'Forget 1 gone shown for gone, absent for live';
      });
      await c('select-all', 'the header checkbox ticks every filtered row', async () => {
        await page.locator(`${SCREEN} button[aria-label="Select all"]`).click();
        const rows = await until(async () => {
          const all = await readRows(page);
          return all.length === ROWS.length && all.every((r) => r.checked) ? all : null;
        }, 'every row ticked');
        const bar = await readBulk(page);
        eq(bar.count, `${ROWS.length} selected`, 'bulk count');
        return `${rows.length} rows ticked`;
      });
      await c('bulk-clear', 'Clear empties the selection and hides the bar', async () => {
        await page.locator('[data-l4-bulk="kill"]').locator('xpath=..').getByRole('button', { name: 'Clear', exact: true }).click();
        await until(async () => (await readBulk(page)) === null, 'the bulk bar to disappear');
        const rows = await readRows(page);
        ok(rows.every((r) => !r.checked), 'a row is still ticked after Clear');
        return 'bar hidden, no row ticked';
      });
      await c('bulk-kill-confirm', 'bulk Kill confirms verbatim then POSTs one kill per row', async () => {
        const picked = LIVE_ROWS.slice(0, 2);
        for (const s of picked) await tick(`${s.host}/${s.name}`);
        await until(async () => {
          const bar = await readBulk(page);
          return bar && bar.killCount === '2 live';
        }, 'data-l4-count="2 live"');
        const mark = posts.length;
        const before = (await readLog(page, 'confirms')).length;
        await page.locator('[data-l4-bulk="kill"]').click();
        const confirms = await until(async () => {
          const all = await readLog(page, 'confirms');
          return all.length > before ? all : null;
        }, 'the bulk kill confirm');
        eq(confirms[before], `Kill 2 tmux session(s)?\n\n${picked.map((s) => `${s.host}:${s.name}`).join('\n')}`
          + '\n\nIrreversible — everything running in them dies.', 'bulk kill confirm');
        const sent = await postsSince(mark, 2, 'two kill POSTs');
        const kills = sent.filter((p) => p.pathname === '/api/kill');
        eq(kills.length, 2, 'kill POST count');
        deepEq(kills.map((p) => p.body), picked.map((s) => ({ host: s.host, name: s.name })), 'kill bodies');
        return '2 kills, confirm verbatim';
      });
    });

    // L4.1: a bulk run owns the rows it is working through, and nothing else. The
    // old guard tested the global bulkBusy flag, so an unrelated row's action
    // silently no-opped for the length of the batch — today's app disables only
    // the bulk bar's own buttons (public/app.js:787).
    await group(['bulk-row-independent'], async (c) => {
      await c('bulk-row-independent', 'a row outside the batch still acts while a bulk kill runs', async () => {
        const batch = LIVE_ROWS.filter((s) => s.status === 'active').slice(0, 2);
        const other = LIVE_ROWS.filter((s) => s.status === 'active' && !batch.includes(s))[0];
        ok(other, 'a third active live row to act on');
        for (const s of batch) await tick(`${s.host}/${s.name}`);
        await until(async () => {
          const bar = await readBulk(page);
          return bar && bar.killCount === `${batch.length} live`;
        }, `data-l4-count="${batch.length} live"`);

        killDelayMs = 900;               // hold each kill open so the batch is still running
        try {
          const mark = posts.length;
          await page.locator('[data-l4-bulk="kill"]').click();
          await postsSince(mark, 1, 'the first kill of the batch');

          // Mid-batch: the untouched row must not be disabled, and its Hide must POST.
          const id = `${other.host}/${other.name}`;
          const menuBtn = page.locator(`${rowSel(id)} [data-l4-act="menu"]`);
          ok(!(await menuBtn.isDisabled()), 'the unrelated row\'s ⋯ is enabled during the batch');
          const before = posts.length;
          await menuBtn.click();
          await page.locator(`${LAYER} [data-l4-extra="menu"]`).waitFor({ state: 'visible' });
          await page.locator(`${LAYER} [data-l4-menu="hide"]`).click();   // clickMenu is declared with §5
          const sent = await postsSince(before, 1, 'the unrelated row\'s hide POST');
          const hide = sent.find((p) => p.pathname === '/api/registry'
            && p.body && p.body.name === other.name && p.body.status === 'hidden');
          ok(hide, `no hide POST for ${other.name}; saw ${JSON.stringify(sent)}`);
          return `hide POSTed for ${other.name} while ${batch.length} kills were in flight`;
        } finally {
          killDelayMs = 0;
        }
      });
    });

    // -------------------------------------------------------- §5 row actions
    // One row per action: the screen disables a row's buttons until its
    // re-fetch lands, so reusing a row would race its own busy flag.
    const activeLive = LIVE_ROWS.filter((s) => s.status === 'active');
    const [tagRow, hideRow, killRow] = activeLive;
    const goneRow = GONE_ROWS[0];
    // The menu is drawn in the layer, anchored to the row's actions cell.
    const openMenu = async (id) => {
      await page.locator(`${rowSel(id)} [data-l4-act="menu"]`).click();
      await page.locator(`${LAYER} [data-l4-extra="menu"]`).waitFor({ state: 'visible' });
    };
    const clickMenu = (id) => page.locator(`${LAYER} [data-l4-menu="${id}"]`).click();
    await group(['menu-items', 'act-tag', 'act-hide', 'act-forget', 'act-kill-confirm'], async (c) => {
      await c('menu-items', 'the ⋯ menu lists Details, the edits and the actions; Forget only when gone', async () => {
        await openMenu(`${activeLive[0].host}/${activeLive[0].name}`);
        const live = await menuItems(page);
        deepEq(live.map((item) => item.id),
          ['details', 'edit-label', 'edit-group', 'edit-task', 'edit-note', 'kill', 'tag', 'hide'], 'live row menu ids');
        deepEq(live.map((item) => item.label),
          ['Details', 'Edit label', 'Edit group', 'Edit task', 'Edit note', 'Kill', 'Tag kill', 'Hide'], 'live row menu labels');
        await page.keyboard.press('Escape');
        await openMenu(`${goneRow.host}/${goneRow.name}`);
        const gone = await menuItems(page);
        deepEq(gone, [...live, { id: 'forget', label: 'Forget' }], 'gone row menu');
        await page.keyboard.press('Escape');
        return `${live.length} items live, ${gone.length} gone`;
      });

      await c('act-tag', 'Tag kill POSTs status kill-requested and toasts', async () => {
        const mark = posts.length;
        await openMenu(`${tagRow.host}/${tagRow.name}`);
        await clickMenu('tag');
        const [sent] = await postsSince(mark, 1, 'the tag POST');
        eq(sent.pathname, '/api/registry', 'path');
        deepEq(sent.body, { host: tagRow.host, name: tagRow.name, status: 'kill-requested' }, 'body');
        await waitToast(page, `Tagged ${tagRow.name} for kill`);
        return `Tagged ${tagRow.name} for kill`;
      });

      await c('act-hide', 'Hide POSTs status hidden and toasts', async () => {
        const mark = posts.length;
        await openMenu(`${hideRow.host}/${hideRow.name}`);
        await clickMenu('hide');
        const [sent] = await postsSince(mark, 1, 'the hide POST');
        eq(sent.pathname, '/api/registry', 'path');
        deepEq(sent.body, { host: hideRow.host, name: hideRow.name, status: 'hidden' }, 'body');
        await waitToast(page, `Hidden ${hideRow.name}`);
        return `Hidden ${hideRow.name}`;
      });

      await c('act-forget', 'Forget POSTs /api/registry/delete and toasts', async () => {
        const mark = posts.length;
        await openMenu(`${goneRow.host}/${goneRow.name}`);
        await clickMenu('forget');
        const [sent] = await postsSince(mark, 1, 'the forget POST');
        eq(sent.pathname, '/api/registry/delete', 'path');
        deepEq(sent.body, { host: goneRow.host, name: goneRow.name }, 'body');
        await waitToast(page, `Forgot ${goneRow.name}`);
        return `Forgot ${goneRow.name}`;
      });

      await c('act-kill-confirm', 'the row Kill confirms verbatim then POSTs /api/kill', async () => {
        const mark = posts.length;
        const before = (await readLog(page, 'confirms')).length;
        await openMenu(`${killRow.host}/${killRow.name}`);
        await clickMenu('kill');
        const confirms = await until(async () => {
          const all = await readLog(page, 'confirms');
          return all.length > before ? all : null;
        }, 'the row kill confirm');
        eq(confirms[before], `Kill tmux session ${killRow.name} on ${killRow.host}?`
          + '\n\nIrreversible — everything running in it dies.', 'row kill confirm');
        const [sent] = await postsSince(mark, 1, 'the kill POST');
        eq(sent.pathname, '/api/kill', 'path');
        deepEq(sent.body, { host: killRow.host, name: killRow.name }, 'body');
        return 'confirm verbatim, one kill';
      });
    });

    // ------------------------------------------------------ §5 the two hooks
    const hookRow = LIVE_ROWS[0];
    await group(['act-show-hook'], async (c) => {
      await c('act-show-hook', 'Show calls FD.screens.windows.openMax(host, name) and sends no POST', async () => {
        await page.evaluate(() => {
          window.FD.screens.windows = { openMax: (host, name) => window.__l4.openMax.push([host, name]) };
        });
        const mark = posts.length;
        await page.locator(`${rowSel(`${hookRow.host}/${hookRow.name}`)} [data-l4-act="show"]`).click();
        const calls = await until(async () => {
          const all = await readLog(page, 'openMax');
          return all.length ? all : null;
        }, 'an openMax call');
        deepEq(calls[0], [hookRow.host, hookRow.name], 'openMax arguments');
        await noPostsSince(mark, 'Show sent a POST');
        return `openMax(${calls[0].join(', ')})`;
      });
    });

    await group(['act-message-hook'], async (c) => {
      await c('act-message-hook', 'Message calls FD.screens.bus.open({type,host,session})', async () => {
        await page.evaluate(() => {
          window.FD.screens.bus = { open: (target) => window.__l4.bus.push(target) };
        });
        await page.locator(`${rowSel(`${hookRow.host}/${hookRow.name}`)} [data-l4-act="message"]`).click();
        const calls = await until(async () => {
          const all = await readLog(page, 'bus');
          return all.length ? all : null;
        }, 'a bus.open call');
        deepEq(calls[0], { type: 'tmux', host: hookRow.host, session: hookRow.name }, 'bus target');
        return JSON.stringify(calls[0]);
      });
    });

    // ------------------------------------------------------- §6-§7 the details
    await group(['details-row'], async (c) => {
      await c('details-row', 'Details opens a panel under the row with Host, Label, Role/Worker and Note', async () => {
        const detailRow = ROWS.find((s) => s.label && s.role) || ROWS[0];
        const id = `${detailRow.host}/${detailRow.name}`;
        await openMenu(id);
        await clickMenu('details');
        const panelSel = `${LAYER} [data-l4-details="${id}"]`;
        const panel = page.locator(panelSel);
        await panel.waitFor({ state: 'visible' });
        // The panel is drawn in the layer, so "under the row" is geometry now,
        // not sibling order: it is anchored to the row's own rectangle.
        const box = await rect(page, panelSel);
        const row = await rect(page, rowSel(id));
        ok(Math.abs(box.top - row.bottom) <= 1 && Math.abs(box.left - row.left) <= 1 && Math.abs(box.width - row.width) <= 1,
          `the details panel is not anchored under its row: ${JSON.stringify(box)} vs ${JSON.stringify(row)}`);
        const fields = await panel.evaluate((el) => Array.from(el.children, (cell) => cell.firstElementChild.textContent));
        deepEq(fields, ['Host', 'Label', 'Role/Worker', 'Note'], 'details fields');
        const values = await panel.evaluate((el) => Array.from(el.children, (cell) => cell.lastElementChild.textContent));
        eq(values[0], detailRow.host, 'Host value');
        eq(values[1], detailRow.label || '—', 'Label value');
        return fields.join(' · ');
      });
    });

    await context.close();

    // Emit in ORDER whatever the run did, so a crashed group is still 36 rows.
    const byId = new Map(results.map((result) => [result.id, result]));
    const ordered = ORDER.map(([id, section]) => byId.get(id)
      || { id, section, name: id, pass: false, detail: 'check did not run' });
    report = {
      schemaVersion: 1,
      mode: 'live',
      slice: 'l4',
      status: 'complete',
      capturedAt: new Date().toISOString(),
      source: app,
      apiFixtures: relative(ROOT, API_FIXTURES),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        playwright: require('playwright/package.json').version,
        chromium: browser.version(),
      },
      results: ordered,
      allPass: ordered.length === 37 && ordered.every((result) => result.pass),
      passed: ordered.filter((result) => result.pass).length,
      total: ordered.length,
    };
  } finally {
    await browser.close();
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.passed}/${report.total} passed; allPass=${report.allPass}; report: ${relative(ROOT, out) || out}`);
  return report;
}

function parseArgs(argv) {
  const options = { app: DEFAULT_APP, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--app' && flag !== '--out') throw new Error(`Unknown flag: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag.slice(2)] = value;
  }
  const url = new URL(options.app);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--app requires an HTTP(S) URL');
  options.app = url.href;
  options.out = resolve(process.cwd(), options.out);
  return options;
}

let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (error) {
  console.error(`${error.message}\nUsage: node docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs [--app <url>] [--out <path>]`);
  process.exit(2);
}
const report = await run(options);
process.exitCode = report.allPass ? 0 : 1;
