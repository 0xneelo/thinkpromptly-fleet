#!/usr/bin/env node
/**
 * fd-v2 L8 live-mode proof — the Accounts (credits) screen on real data.
 *
 * Serves public/ itself, routes every /api/* call to a JSON fixture, drives each
 * automatable item of docs/goals/fd-v2-l8/BEHAVIOUR.md and writes
 *   verify/l8/live.json   { id, action, expectation, pass }
 *   verify/l8/live-dark.png, live-light.png
 * Console errors and page errors fail the run.
 *
 * The harness lives in verify/l8-live/ rather than verify/l8/ because
 * scripts/design-diff.mjs republishes verify/<slice>/ as a whole directory on every
 * gate run — a script stored there is deleted by the next `npm run design:diff`.
 * Its OUTPUTS still land in verify/l8/, where the acceptance expects them.
 *
 * The captured responses are docs/design/fleetdeck-v2/fixtures/api/*.json; the states
 * that capture does not contain (expired token, rate limit, capped credits, no source,
 * collector errors, empty, offline) are the hand-written variants in ./fixtures/.
 *
 * Run: node docs/design/fleetdeck-v2/verify/l8/live.mjs
 */
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, resolve, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
// The gate owns verify/l8/; this harness only writes its own files into it.
const OUT = resolve(HERE, '../l8');
const PUBLIC = join(ROOT, 'public');
const API = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const VARIANTS = join(HERE, 'fixtures');
const VIEWPORT = { width: 1440, height: 900 };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

// ---------------------------------------------------------------------------
// A static server for public/, so the proof does not depend on a running deck.
// ---------------------------------------------------------------------------
function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, path);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => res.writeHead(404).end());
    stream.on('open', () => {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      stream.pipe(res);
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
const results = [];
let failures = 0;

function check(id, action, expectation, pass, detail) {
  const row = { id, action, expectation, pass: !!pass };
  if (!pass && detail !== undefined) row.actual = String(detail).slice(0, 400);
  results.push(row);
  if (!pass) failures++;
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${expectation}${pass ? '' : `\n      actual: ${row.actual}`}\n`);
}

const eq = (id, action, expectation, actual, want) => check(id, action, expectation, actual === want, actual);
const has = (id, action, expectation, actual, want) =>
  check(id, action, expectation, typeof actual === 'string' && actual.includes(want), actual);
// The mock's pills are uppercased in CSS, so their rendered text is compared case-blind.
const hasi = (id, action, expectation, actual, want) =>
  check(id, action, expectation, typeof actual === 'string' && actual.toLowerCase().includes(want.toLowerCase()), actual);

// ---------------------------------------------------------------------------
// Page harness
// ---------------------------------------------------------------------------
const SCREEN = '[data-screen-label="Accounts"]';
// The cards are addressed by the hook the screen sets on them, never by a compiled
// data-dc-tpl id — that id changes on any template regeneration and would make every
// card assertion below pass vacuously. CARD_ANY is the structural cross-check: the
// screen's own children after the summary row.
const CARD = `${SCREEN} > div[data-fd-l8-card]`;
const CARD_ANY = `${SCREEN} > div`;
// The trend svg, not the chevron: both are svg children of a card.
const TREND = 'svg[viewBox="0 0 100 24"]';

async function open(browser, url, { credits, theme = 'dark', fail = false } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, locale: 'en-US', timezoneId: 'UTC' });
  const problems = [];
  const calls = [];
  await context.addInitScript((dark) => {
    try { localStorage.setItem('fd-landing-dark', dark); localStorage.setItem('fd-app-video', '0'); } catch (e) {}
  }, theme === 'dark' ? '1' : '0');
  // The media is served from the same static server rather than aborted: an aborted
  // request logs a console error of its own, and this run asserts a clean console.
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    // Only the credits endpoint is this slice's. Every other endpoint answers an empty
    // 200 so the sibling screens the weave brought in stay quiet and their fetches never
    // show up as this screen's console errors.
    if (!url.includes('/api/credits')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    calls.push(url);
    if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(credits) });
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('aside button[title="Accounts"]').click();
  await page.locator(SCREEN).waitFor({ state: 'visible' });
  // The screen paints its improvised chrome right after the first setData.
  await page.waitForFunction(() => {
    const box = document.getElementById('fd-l8-chrome');
    return !!box && box.style.display !== 'none';
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
  return { context, page, problems, calls };
}

// The summary bar is the improvised overlay the screen owns, not the mock's static
// row — that one is hidden with visibility and carries the placeholder counts.
const summaryText = (page) => page.locator('#fd-l8-summary').innerText();
const cardText = (page, i) => page.locator(CARD).nth(i).innerText();

// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT, { recursive: true });
  const { server, url: base } = await serve();
  const app = `${base}/v2/index.html`;
  const browser = await chromium.launch();
  const captured = await json(join(API, 'credits.json'));
  const variants = await json(join(VARIANTS, 'credits-variants.json'));
  const empty = await json(join(VARIANTS, 'credits-empty.json'));
  const one = await json(join(VARIANTS, 'credits-one.json'));
  const spend = await json(join(VARIANTS, 'credits-spend.json'));
  const allProblems = [];

  try {
    // ---- A. the captured response ------------------------------------------
    {
      const { context, page, problems, calls } = await open(browser, app, { credits: captured });

      // public/v2/screens/shell.js (L2) fetches credits for the sidebar's accounts mini,
      // so the page makes more than one call and the count alone attributes nothing. What
      // is L8's to prove: the load carries no refresh param, nothing polls, and Refresh
      // adds exactly one refreshing call.
      const credited = () => calls.filter((u) => u.includes('/api/credits'));
      check('B1', 'load the Accounts screen', 'GET /api/credits is called, and never with a refresh param',
        credited().length >= 1 && credited().every((u) => !u.includes('refresh')), credited().join(','));

      const sum = await summaryText(page);
      has('B2', 'read the summary bar', '"5 accounts"', sum, '5 accounts');
      has('B3', 'read the summary bar', '"1 at or over a limit"', sum, '1 at or over a limit');
      has('B4', 'read the summary bar', '"no credits spent"', sum, 'no credits spent');
      has('B5', 'read the privacy note', 'the sidebar note, verbatim', sum,
        'Every machine reads its own token locally and reports only percentages — no access token ever leaves the machine that owns it.');
      has('B6', 'read the privacy note', 'it names credits-accounts.json', sum, 'Names and org mapping live in credits-accounts.json.');

      // Fail loudly if the hooks matched nothing: every card assertion below is keyed on
      // them, so a silent zero would turn this whole file green against an empty page.
      const marked = await page.locator(CARD).count();
      const structural = await page.locator(CARD_ANY).count();
      check('B7a', 'count the cards the screen marked', 'one hooked card per account, and more than zero',
        marked === 5, marked);
      eq('B7b', 'cross-check against the screen\'s own structure',
        'the hooked cards are exactly the screen children after the summary row', marked, structural - 1);
      const painted = await page.evaluate(() => (FD.screens.accounts || {}).painted || null);
      // A note line exists only on an open card that has something to say, so the count
      // is not one per row — but a zero here would mean the hook matched nothing at all.
      check('B7c', 'read what the last paint reported', 'it hooked every card and at least one note line',
        !!painted && painted.rows === 5 && painted.cards === 5 && painted.notes >= 1, JSON.stringify(painted));

      const names = await page.locator(`${CARD} span[style*="font-weight:600"], ${CARD} span[style*="font-weight: 600"]`).allInnerTexts();
      eq('B7', 'read the card order', 'most constrained first, unreported last',
        names.join(' | '), 'Lafayette Tabor | Daniel Tabor | Daniel Tabor (personal · ChatGPT) | Reiner Garrecht | Aylin Yeter');

      const first = await cardText(page, 0);
      hasi('B8', 'read the leading card header', 'the provider pill reads "claude"', first, 'claude');
      has('B9', 'read the leading card header', 'the account email', first, 'lafayette@infinite-holdings.llc');
      hasi('B10', 'read the leading card header', 'the plan label "Max 20×"', first, 'Max 20×');
      has('B11', 'read the leading card header', 'the source reads "live"', first, 'live');
      check('B12', 'read the leading card header', 'the right side is "<ago> · <host>"',
        /\d+[mhd] ago · \S+|just now · \S+/.test(first), first.split('\n').slice(0, 8).join(' / '));

      // At or over a limit, so this card opens by itself (improvised.md I-L8-02).
      has('B13', 'read the leading card, opened by default', 'every window bar, in order', first, '5 hour');
      has('B14', 'read the leading card', 'the 7 day window', first, '7 day');
      has('B15', 'read the leading card', 'the model weekly reads "7 day Fable"', first, '7 day Fable');
      has('B16', 'read the leading card', 'the window at 100 % shows its percentage', first, '100%');
      has('B17', 'read the leading card', 'a reset time reads "resets in Nh Nm"', first, 'resets in');
      has('B18', 'read the leading card', '"seen on <host> · <source>"', first, 'seen on');
      has('B19', 'read the leading card', 'the 7 day trend row', first, '7 day trend');

      // Today's page turns a bar red over 90 %; the mock's own bar() stops at amber.
      const fills = await page.locator(CARD).nth(0).evaluate((card) => {
        const rows = [...card.querySelectorAll('div')].filter((d) => (d.style.gridTemplateColumns || '').startsWith('92px 1fr 44px 130px'));
        return rows.map((r) => {
          const spans = [...r.children];
          // children: label, track, pct, resets. The fill is the track's own child —
          // r.querySelector('span > span') would match the runtime's sc-interp wrapper
          // around the label text instead.
          const fill = spans[1] && spans[1].firstElementChild;
          return [spans[0].textContent, spans[2].textContent, fill ? getComputedStyle(fill).backgroundColor : ''];
        });
      });
      const over90 = fills.find((f) => f[1] === '100%');
      const under70 = fills.find((f) => f[1] === '29%');
      check('B20', 'compare a bar over 90 % with one under 70 %', 'the bar over 90 % is a different (red) colour',
        !!over90 && !!under70 && over90[2] !== under70[2], JSON.stringify(fills));

      eq('B21', 'inspect the sparkline', 'no foreign node is mounted inside the compiled svg',
        await page.locator(`${CARD} ${TREND} title`).count(), 0);
      const pts = await page.locator(`${CARD} ${TREND} polyline`).first().getAttribute('points');
      check('B22', 'inspect the sparkline', 'a time-scaled polyline is plotted from history[].sd',
        !!pts && pts.split(' ').length === 120, (pts || '').slice(0, 60));

      // The Codex row carries no history at all.
      const codex = await cardText(page, 2);   // ties on 96 %, after the claude row
      hasi('B23', 'read the Codex card', 'it is a codex row', codex, 'codex');
      check('B24', 'read the Codex card', 'no sparkline block', !codex.includes('7 day trend'), codex);
      eq('B24b', 'read the Codex card', 'it has no trend svg at all',
        await page.locator(CARD).nth(2).locator(TREND).count(), 0);
      has('B25', 'read the Codex card', 'its weekly bar', codex, 'weekly');

      // The row whose windows are all stale.
      const stale = await cardText(page, 4);
      has('B26', 'read the stale card', 'the sampled sentence, verbatim', stale,
        '— older than the window it measured, so these have reset since');
      has('B27', 'read the stale card', 'the collector banner, verbatim', stale, 'could not read usage on rfc1918-internal');
      has('B28', 'read the stale card', 'a window with no percentage still gets a row', stale, '—');

      // Collapsed by default unless at or over a limit.
      const closed = await page.locator(CARD).nth(3).innerText();
      check('B29', 'read a card that is under every limit', 'it is collapsed: no "seen on" line',
        !closed.includes('seen on'), closed);
      await page.locator(CARD).nth(3).locator('div').first().click();
      await page.waitForTimeout(150);
      const opened = await page.locator(CARD).nth(3).innerText();
      check('B30', 'click that card header', 'it opens and shows "seen on"', opened.includes('seen on'), opened);

      // No polling: the collect fans out over ssh, so nothing asks again on its own.
      const settled = credited().length;
      await page.waitForTimeout(3000);
      eq('B31', 'wait three seconds', 'no further /api/credits call is made', credited().length, settled);

      // Refresh forces a collect, and adds exactly one call.
      await page.locator('#accounts-refresh').click();
      await page.waitForTimeout(600);
      eq('B32', 'click Refresh', 'exactly one more call, carrying ?refresh=1',
        credited().length - settled, 1);
      check('B32a', 'click Refresh', 'that call is GET /api/credits?refresh=1',
        credited().some((u) => u.endsWith('/api/credits?refresh=1')), credited().join(','));

      // The stale row is more than three days old, so its note line must be red — the
      // template paints every note line warn, so this proves the hook took effect.
      const tone = await page.locator(CARD).nth(4).evaluate((card) => {
        const p = card.querySelector('p');
        if (!p) return { err: 'no note line' };
        const css = getComputedStyle(document.documentElement);
        return {
          hook: p.getAttribute('data-fd-l8-note'),
          inline: p.style.color,
          colour: getComputedStyle(p).color,
          bad: css.getPropertyValue('--fd-l8-bad').trim(),
        };
      });
      eq('B32d', 'read the stale row\'s note line', 'it carries the red tone hook', tone.hook, 'bad');
      check('B32e', 'read the stale row\'s note line',
        'the stylesheet rule beats the template\'s own inline colour',
        !!tone.bad && tone.colour === tone.bad && tone.inline !== '' && tone.inline !== tone.bad,
        JSON.stringify(tone));

      eq('B32b', 'inspect the compiled tree', 'the screen mounts no foreign node inside it',
        await page.locator('#dc-root [data-fd-l8], #dc-root #fd-l8-chrome').count(), 0);
      eq('B32c', 'inspect the improvised chrome', 'it is a single container outside #dc-root',
        await page.locator('body > #fd-l8-chrome').count(), 1);

      allProblems.push(...problems);
      await page.screenshot({ path: join(OUT, 'live-dark.png'), fullPage: false });
      await context.close();
    }

    // ---- B. the hand-written states ----------------------------------------
    {
      const { context, page, problems } = await open(browser, app, { credits: variants });
      const all = await page.locator(SCREEN).innerText();
      has('B33', 'stub a token_expired row', 'the banner, verbatim', all, 'token expired — open Claude Code on german-box');
      has('B34', 'stub a rate_limited row', 'the banner, verbatim', all,
        'usage endpoint busy on ivy-box — figures below are the last good read');
      has('B35', 'stub a row with no source', 'the no-data line, verbatim', all, 'no data yet — run push from their machine');
      has('B36', 'stub a source that reported no windows', 'the empty-windows line, verbatim', all, 'no usage windows reported');
      has('B37', 'stub a capped credit pool', 'the credits line with both suffixes', all,
        'credits: 10.00 / 10.00 USD · spend limit reached · extra usage off');
      has('B38', 'stub an unconfirmed mapping', 'the amber "unconfirmed mapping" note', all, 'unconfirmed mapping');
      has('B39', 'stub a push row', 'the right side names the push, not a host', all, '· push');
      // A collapsed card shows only its primary bar, so the codex row is opened first.
      const codexCard = page.locator(CARD).filter({ hasText: 'Unlimited Codex' }).first();
      await codexCard.locator('div').first().click();
      await page.waitForTimeout(150);
      const codexText = await codexCard.innerText();
      has('B40', 'open the codex card', 'its credits line reads "credits: unlimited"', codexText, 'credits: unlimited');
      has('B41', 'open the codex card', 'its second window is labelled "session"', codexText, 'session');
      has('B42', 'stub a claude row with no history', 'the no-history line, verbatim', all, 'no history yet');
      const foot = await page.locator('#fd-l8-summary').innerText();
      has('B43', 'stub two collector errors', 'the panel heading', foot, 'Collector errors');
      has('B44', 'stub two collector errors', '"<host>: <message>" per error', foot,
        'ivy-box: ssh: connect to host ivy-box port 22: Connection timed out');
      has('B45', 'stub two collector errors', 'the second error line', foot, 'onboarding-box: credits collector exited 1');
      has('B46', 'stub a row sampled 15 days ago', 'the "no reset times" sentence when the windows are not stale',
        all, '— no reset times in this source');
      allProblems.push(...problems);
      await context.close();
    }

    // ---- C. spend, empty, one, offline -------------------------------------
    {
      const { context, page, problems } = await open(browser, app, { credits: spend });
      has('B47', 'stub two rows with money spent', 'the summary totals them per currency',
        await summaryText(page), 'spent 3.75 USD');
      allProblems.push(...problems);
      await context.close();
    }
    {
      const { context, page, problems } = await open(browser, app, { credits: empty });
      const sum = await summaryText(page);
      has('B48', 'stub an empty response', '"0 accounts"', sum, '0 accounts');
      has('B49', 'stub an empty response', '"no credits spent"', sum, 'no credits spent');
      eq('B50', 'stub an empty response', 'no cards are rendered', await page.locator(CARD).count(), 0);
      allProblems.push(...problems);
      await context.close();
    }
    {
      const { context, page, problems } = await open(browser, app, { credits: one });
      has('B51', 'stub a single account', '"1 account", singular', await summaryText(page), '1 account');
      await page.locator(CARD).first().locator('div').first().click();
      await page.waitForTimeout(150);
      has('B52', 'open a card whose history has one sample', 'the no-history line, verbatim',
        await page.locator(SCREEN).innerText(), 'no history yet');
      allProblems.push(...problems);
      await context.close();
    }
    {
      const { context, page, problems } = await open(browser, app, { credits: null, fail: true });
      has('B53', 'make /api/credits fail', 'the failure text, verbatim',
        await page.locator('#fd-l8-chrome').innerText(), 'cannot reach fleetdeck');
      eq('B54', 'make /api/credits fail', 'no cards are rendered', await page.locator(CARD).count(), 0);
      // This scenario answers 500 deliberately, so the browser's own "failed to load"
      // line is the harness's doing, not the page's.
      allProblems.push(...problems.filter((m) => !m.includes('status of 500')));
      await context.close();
    }

    // ---- D. the light theme ------------------------------------------------
    {
      const { context, page, problems } = await open(browser, app, { credits: captured, theme: 'light' });
      has('B55', 'switch to the light theme', 'the screen renders the same summary',
        await summaryText(page), '5 accounts');
      allProblems.push(...problems);
      await page.screenshot({ path: join(OUT, 'live-light.png'), fullPage: false });
      await context.close();
    }

    check('B56', 'watch the console across every scenario', 'zero console errors and zero page errors',
      allProblems.length === 0, allProblems.join(' | '));

    const shots = (await readdir(OUT)).filter((f) => f.startsWith('live-') && f.endsWith('.png'));
    eq('B57', 'write the screenshots', 'live-dark.png and live-light.png exist', shots.sort().join(','), 'live-dark.png,live-light.png');
  } finally {
    await browser.close();
    server.close();
  }

  const report = {
    schemaVersion: 1,
    slice: 'l8',
    mode: 'live',
    capturedAt: new Date().toISOString(),
    source: 'docs/design/fleetdeck-v2/fixtures/api/credits.json + verify/l8/fixtures/*.json',
    viewport: VIEWPORT,
    total: results.length,
    passed: results.length - failures,
    failed: failures,
    allPass: failures === 0,
    consoleProblems: [],
    results,
  };
  await writeFile(join(OUT, 'live.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.passed}/${report.total} live checks pass — ${report.allPass ? 'ALL PASS' : 'FAILURES'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
