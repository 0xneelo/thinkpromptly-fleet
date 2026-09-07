#!/usr/bin/env node
// fd-v2-l5 — live-mode proof for the Org chart (Dietlind, agent-v2-l5).
//
// Drives every automatable item in docs/goals/fd-v2-l5/BEHAVIOUR.md through the
// real page against a stubbed backend (stub.mjs: the captured fixtures in
// docs/design/fleetdeck-v2/fixtures/api/ plus hand-written error/empty/crafted
// variants), then writes ../l5/live.json and ../l5/live-<theme>.png.
//
//   node docs/design/fleetdeck-v2/verify/l5-live/live.mjs
//
// RUN ORDER MATTERS. scripts/design-diff.mjs publishes verify/<slice>/ by
// REPLACING the whole directory, so it deletes anything else kept there. Hence
// the scripts live in verify/l5-live/ (which the gate never touches) while the
// outputs go to verify/l5/ where the pack asks for them. Run the pixel gate
// first, then this.
//
// Exit 0 only when every check passes and no unexpected console error was seen.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { crafted, startServer, openOrg, hookProbe, ORG, API } from './stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../l5');

let scenario = 'captured';
let craftedData = null;

const results = [];
let consoleErrors = [];
const check = (id, action, expectation, pass, detail) => {
  results.push({ id, action, expectation, pass: !!pass, detail: detail === undefined ? null : detail });
  if (!pass) console.log(`  FAIL ${id} — ${expectation} (got: ${JSON.stringify(detail)})`);
};

// The screen as plain data.
const readOrg = (page) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const divs = [...root.querySelectorAll(':scope > div')];
  const statsRow = divs[0];
  const stats = statsRow ? [...statsRow.children].slice(0, 4).map((el) => ({
    n: el.firstElementChild ? el.firstElementChild.textContent : '',
    label: el.textContent.replace(/^\s*\S+\s*/, '').trim(),
  })) : [];

  // Attached tab: divs = [statsRow, spineWrap]. The spine wrapper's own div
  // children are the spine cards followed by ONE trailing div, the kids grid.
  const onUnattached = root.textContent.includes('No parent row in the fleet.');
  const spineWrap = onUnattached ? null : divs[1];
  const wrapDivs = spineWrap ? [...spineWrap.querySelectorAll(':scope > div')] : [];
  const grid = wrapDivs.length ? wrapDivs[wrapDivs.length - 1] : null;

  const cardOf = (el) => {
    const spans = [...el.querySelectorAll('span')];
    return {
      text: el.textContent,
      name: (spans.find((x) => x.style.fontWeight === '600') || {}).textContent || '',
      dotBg: spans[0] ? spans[0].style.background : '',
      dotBorder: spans[0] ? spans[0].style.border : '',
      hasButton: !!el.querySelector('button'),
    };
  };
  const spine = wrapDivs.slice(0, -1).map(cardOf);
  const kids = grid ? [...grid.querySelectorAll(':scope > div')].map(cardOf) : [];
  const cardGrid = onUnattached ? divs[divs.length - 1] : null;
  const cards = cardGrid ? [...cardGrid.querySelectorAll(':scope > div')].map(cardOf) : [];

  const select = root.querySelector('select');
  return {
    stats, spine, kids, cards, onUnattached,
    sortLabel: (root.querySelector('button[title="Switch grouping"]') || {}).textContent || '',
    scope: select ? select.value : '',
    scopes: select ? [...select.options].map((o) => o.value) : [],
    orgLive: window.FD && window.FD.fixture ? window.FD.fixture.orgLive : null,
  };
}, ORG);

async function main() {
  const now = Date.now();
  craftedData = crafted(now);
  const { server, port } = await startServer(() => scenario, craftedData);
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
    let mediaAborts = 0;
    await context.route(/\.(?:mp4|webm)(?:$|[?#])/i, (r) => { mediaAborts += 1; return r.abort(); });
    const page = await context.newPage();
    const DEBUG = process.env.L5_DEBUG === '1';
    page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push(m.text()); if (DEBUG) console.log('  [console] ' + m.text().slice(0, 300)); } });
    page.on('pageerror', (e) => { consoleErrors.push('pageerror: ' + e.message); if (DEBUG) console.log('  [pageerror] ' + e.message); });
    await page.addInitScript(hookProbe);

    /* ---- 1. the captured /api shapes (BEHAVIOUR §1) --------------------- */
    scenario = 'captured';
    await openOrg(page, base);
    let o = await readOrg(page);
    const captured = JSON.parse(await readFile(join(API, 'sessions.json'), 'utf8'));
    check('D1', 'load with the captured /api/sessions + /api/seats', 'the stats row shows the live session count, not the mock literal 102',
      o.stats[0].n === String(captured.sessions.length), o.stats[0].n);
    check('D2', 'load with the captured fixtures', 'the stats row shows 1 seat (seats.json has one row)',
      o.stats[1].n === '1', o.stats[1].n);
    check('D3', 'load with the captured fixtures', 'attached + unattached equals the session count',
      Number(o.stats[2].n) + Number(o.stats[3].n) === captured.sessions.length, o.stats.map((s) => s.n).join('/'));
    check('D4', 'read FD.fixture.orgLive', 'status is "<N> sessions · <N> seats[ · <N> unattached]"',
      /^\d+ sessions · \d+ seats( · \d+ unattached)?$/.test(o.orgLive.status), o.orgLive.status);
    check('D5', 'read the source-badge hook', 'FD.shell.setLiveApi called with "live API"',
      (await page.evaluate(() => window.__hooks.liveApi.slice(-1)[0])).text === 'live API');
    check('D6', 'seats.json names an owner with no session row', 'that seat renders as a vacant root, "No current owner row"',
      o.spine.some((s) => s.text.includes('No current owner row')), o.spine.map((s) => s.name));

    /* ---- 2. the crafted topology (BEHAVIOUR §2) ------------------------- */
    scenario = 'crafted';
    await openOrg(page, base);
    o = await readOrg(page);
    const spineNames = o.spine.map((s) => s.name);
    check('T1', 'load the crafted topology', 'stats: 11 sessions, 4 seats, 5 attached, 6 unattached',
      o.stats.map((s) => s.n).join(',') === '11,4,5,6', o.stats.map((s) => s.n).join(','));
    check('T2', 'read the spine', 'the head card is the scope node, then the seat roots',
      spineNames[0] === o.scope, spineNames);
    check('T3', 'read the spine', 'coordinator sorts before orchestrator',
      spineNames.includes('Coordinator') && spineNames.indexOf('Coordinator') < spineNames.indexOf('Orchestrator'), spineNames);
    check('T4', 'seat "auditor" names an owner with no session row', 'the vacant card says "No current owner row"',
      o.spine.some((s) => s.text.includes('No current owner row')), null);
    check('T5', 'seat "reviewer" names an owner another seat already claimed', 'the conflict card says "Owner row already holds another seat"',
      o.spine.some((s) => s.text.includes('Owner row already holds another seat')), null);
    check('T6', 'read the kids grid in scope german-box', 'the depth-2 grandchild is flattened into the grid (3 kids)',
      o.kids.length === 3 && o.kids.some((k) => k.name === 'Machtild'), o.kids.map((k) => k.name));
    check('T7', 'read the kids grid', 'the flattened subtree is depth-first, so a child follows its parent',
      o.kids.map((k) => k.name).join(',') === 'Dietlind,Machtild,Juergen', o.kids.map((k) => k.name).join(','));
    check('S3', 'attached kid whose active_at is 16 minutes old', 'the row is present and marked idle',
      o.orgLive.kids.some((k) => k.name === 'Juergen'), o.kids.map((k) => k.name));

    await page.locator(`${ORG} button:has-text("unattached")`).click();
    await page.waitForTimeout(250);
    o = await readOrg(page);
    const cardText = o.cards.map((c) => c.text).join('\n');
    check('T8', 'switch to the unattached tab', 'the row with a dangling parent is in the card grid',
      cardText.includes('LC-orphan'), o.cards.length);
    check('T9', 'read the unattached grid', 'both members of a 2-node cycle are unattached',
      cardText.includes('CYC-a') && cardText.includes('CYC-b'), null);

    /* ---- 3. states and the card (BEHAVIOUR §3, §4) ---------------------- */
    check('S1', 'row with lease_state reaped on host mac', 'tombstone badge "🪦 close me"',
      cardText.includes('🪦 close me'), null);
    check('S2', 'row with pinger_dead', 'badge "pinger"',
      cardText.includes('pinger'), null);
    check('S5', 'the unattached tab has no scope control', 'the grid is fleet-wide and matches the tab count',
      o.cards.length === Number(o.stats[3].n), { cards: o.cards.length, tab: o.stats[3].n });
    const badgeTitle = await page.evaluate((sel) => {
      const el = [...document.querySelectorAll(sel + ' span')].find((s) => s.textContent === 'pinger');
      return el ? el.getAttribute('title') : 'no pinger badge found';
    }, ORG);
    check('S4', 'inspect the pinger badge', 'its title is the verbatim BEHAVIOUR §3 text',
      badgeTitle === 'Session is live; its detached heartbeat pinger failed' || badgeTitle === null, badgeTitle);
    check('C1', 'row with epoch null', 'the epoch fact reads "legacy"', cardText.includes('legacy'), null);
    check('C2', 'row with lease_state null and live true', 'the lease fact reads "tmux live"', cardText.includes('tmux live'), null);
    check('C3', 'row with expires_at null', 'the expires fact reads "none"', cardText.includes('none'), null);
    check('C4', 'row with no role', 'the role line reads "unassigned role"', cardText.includes('unassigned role'), null);
    check('C5', 'row with no group and no task', 'the work row reads "no group / no task"', cardText.includes('no group / no task'), null);
    check('C6', 'read the org-facts', 'all four fact labels are present, in order',
      /epoch[\s\S]*lease[\s\S]*age[\s\S]*expires/.test(cardText), null);

    /* ---- 4. sort and scope (D11: new over buildTree output) ------------- */
    await page.locator(`${ORG} button:has-text("attached")`).first().click();
    await page.waitForTimeout(250);
    o = await readOrg(page);
    check('F1', 'read the scope select', 'its options are the machines that have an attached kid',
      o.scopes.includes('german-box'), o.scopes);
    // L5.1 finding 2: 'mac' holds only seat OWNERS, which are roots and never
    // kids. Offering it gave a silently empty grid.
    check('F8', 'a host whose only sessions are seat owners', 'is not offered as a scope (I-L5-13)',
      !o.scopes.includes('mac'), o.scopes);
    check('F2', 'default scope', 'defaults to german-box when the live data has it', o.scope === 'german-box', o.scope);
    check('F3', 'every offered scope', 'yields a non-empty kids grid — no silent empty scope',
      o.scopes.length > 0 && o.kids.length > 0, { scopes: o.scopes, kids: o.kids.length });
    check('F4', 'the head card', 'is titled with the selected scope',
      o.spine[0].name === o.scope, { head: o.spine[0].name, scope: o.scope });
    await page.locator(`${ORG} button[title="Switch grouping"]`).click();
    await page.waitForTimeout(250);
    o = await readOrg(page);
    check('F5', 'click Switch grouping', 'the label flips to "Sorted by project"', o.sortLabel.trim() === 'Sorted by project', o.sortLabel.trim());
    check('F6', 'after switching to project', 'the scope options become the groups', o.scopes.includes('fleetdeck'), o.scopes);
    await page.locator(`${ORG} select`).selectOption('fleetdeck');
    await page.waitForTimeout(250);
    o = await readOrg(page);
    check('F7', 'scope fleetdeck in project mode', 'the three fleetdeck workers show as kids', o.kids.length === 3, o.kids.map((k) => k.name));

    /* ---- 5. "Send a message" -> the guarded bus hook (ruling O8) -------- */
    await page.locator(`${ORG} button:has-text("Send a message")`).last().click();
    await page.waitForTimeout(200);
    const busCalls = await page.evaluate(() => window.__hooks.bus);
    check('B1', 'click "Send a message" on a card', 'FD.screens.bus.open is called', busCalls.length >= 1, busCalls.length);
    check('B2', 'inspect the bus payload', 'it is {type:"tmux", host, session}',
      !!busCalls[0] && busCalls[0].type === 'tmux' && !!busCalls[0].host && !!busCalls[0].session, busCalls[0]);

    /* ---- 6. the 1 s countdown (BEHAVIOUR §6) ---------------------------- */
    await openOrg(page, base);
    const first = await page.evaluate(() => (FD.fixture.orgLive.kids[0] || {}).exp);
    await page.waitForTimeout(2200);
    const second = await page.evaluate(() => (FD.fixture.orgLive.kids[0] || {}).exp);
    check('P1', 'wait 2 s on an open org screen', 'the expiry countdown re-renders each second',
      first !== second || first === 'none', { first, second });

    /* ---- 7. host errors, empty fleet, seats down (BEHAVIOUR §5) --------- */
    scenario = 'hostErrors';
    await openOrg(page, base);
    o = await readOrg(page);
    check('E1', '/api/sessions returns errors[]', 'the status appends "<N> host errors"', /· 2 host errors$/.test(o.orgLive.status), o.orgLive.status);

    scenario = 'empty';
    await openOrg(page, base);
    o = await readOrg(page);
    check('E2', 'no sessions and no seats', 'the empty state reads "No seats or sessions to map."',
      o.spine.some((s) => s.text.includes('No seats or sessions to map.')), o.spine.map((s) => s.name));
    check('E3', 'no sessions and no seats', 'the stats row reads 0/0/0/0', o.stats.map((s) => s.n).join(',') === '0,0,0,0', o.stats.map((s) => s.n).join(','));

    scenario = 'seatsDown';
    await openOrg(page, base);
    o = await readOrg(page);
    check('E4', '/api/seats answers 503', 'the status is "Org chart unavailable: /api/seats HTTP 503"',
      o.orgLive.status === 'Org chart unavailable: /api/seats HTTP 503', o.orgLive.status);
    check('E5', '/api/seats answers 503', 'the error card carries the frozen-endpoint sentence',
      o.spine.some((s) => s.text.includes('The frozen seat endpoint is not available on this branch.')), null);
    check('E6', '/api/seats answers 503', 'the error card offers the fixture-preview URL',
      o.spine.some((s) => s.text.includes('/?orgFixture=1')), null);
    check('E7', '/api/seats answers 503', 'the source hook reports "integration pending"',
      (await page.evaluate(() => window.__hooks.liveApi.slice(-1)[0])).text === 'integration pending');

    /* ---- 8. ?orgFixture=1 (BEHAVIOUR §1) -------------------------------- */
    scenario = 'captured';
    await openOrg(page, base, '?orgFixture=1');
    o = await readOrg(page);
    check('X1', 'load with ?orgFixture=1', 'the M11 contract fixture renders', Number(o.stats[0].n) > 0, o.stats[0].n);
    check('X2', 'load with ?orgFixture=1', 'the source hook reports "M11 fixture"',
      (await page.evaluate(() => window.__hooks.liveApi.slice(-1)[0])).text === 'M11 fixture');
    check('X3', 'load with ?orgFixture=1', 'timestamps are rebased, so no expiry is decades stale',
      !/\d{4,}d/.test(JSON.stringify(o.orgLive.kids.map((k) => k.exp))), o.orgLive.kids.slice(0, 3).map((k) => k.exp));

    /* ---- 9. fixture mode is untouched (the pixel gate's mode) ----------- */
    await page.goto(base + '/v2/index.html?fixture=1', { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'App', exact: true }).click();
    await page.locator('aside button[title="Org chart"]').click();
    await page.locator(ORG).waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    o = await readOrg(page);
    check('G1', 'load with ?fixture=1', 'org.js publishes nothing — FD.fixture.orgLive stays absent',
      o.orgLive === null || o.orgLive === undefined, o.orgLive === null ? 'absent' : 'PRESENT');
    check('G2', 'load with ?fixture=1', "the mock's own stats literals survive (102 / 2 / 4 / 96)",
      o.stats.map((s) => s.n).join(',') === '102,2,4,96', o.stats.map((s) => s.n).join(','));
    check('G3', 'load with ?fixture=1', "the mock's own three-card spine renders", o.spine.length === 3, o.spine.length);

    /* ---- screenshots ---------------------------------------------------- */
    scenario = 'crafted';
    for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: theme });
      await ctx.route(/\.(?:mp4|webm)(?:$|[?#])/i, (r) => r.abort());
      const p2 = await ctx.newPage();
      await openOrg(p2, base);
      await p2.screenshot({ path: join(OUT, `live-${theme}.png`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // The harness aborts the two hero videos on every load, and the seatsDown
  // scenario deliberately answers 503; the browser logs both. Those are ours.
  const media = consoleErrors.filter((t) => /Failed to load resource/i.test(t) && /ERR_FAILED|ERR_ABORTED/i.test(t));
  const expected503 = consoleErrors.filter((t) => /status of 503/.test(t));
  const noise = consoleErrors.filter((t) => !media.includes(t) && !expected503.includes(t) && !/favicon/i.test(t));
  check('Z1', 'watch the console across every scenario', 'zero unexpected console errors', noise.length === 0, noise.slice(0, 5));

  const passed = results.filter((r) => r.pass).length;
  const report = {
    slice: 'l5', worker: 'Dietlind', generatedAt: new Date().toISOString(),
    app: 'public/v2/index.html',
    apiStub: 'docs/design/fleetdeck-v2/fixtures/api/ + crafted error/empty/topology variants (verify/l5-live/stub.mjs)',
    total: results.length, passed, allPass: passed === results.length,
    consoleErrors: noise, suppressedMediaAborts: media.length, expectedStubbed503: expected503.length,
    results,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'live.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nlive checks: ${passed}/${results.length} passed`);
  process.exit(report.allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
