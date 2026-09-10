// fd-v2 L7 — live-mode proof for the SSH keys + GitHub train screen.
//
// Serves public/ for real (no ?fixture=1), routes every /api/* call to the JSON
// captured in docs/design/fleetdeck-v2/fixtures/api/ plus hand-written variants
// for the error, empty, offline and non-ED25519 states the capture cannot show,
// then drives every automatable item in docs/goals/fd-v2-l7/BEHAVIOUR.md.
//
// Writes verify/l7/live.json ({id, action, expectation, pass}) and
// verify/l7/live-<theme>.png. Any console error, page error or failed request
// fails the run — BEHAVIOUR is only ported if the screen is also silent.
//
// Run: node docs/design/fleetdeck-v2/verify/l7/live.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, stat, realpath, mkdir } from 'node:fs/promises';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
// The pixel gate REPLACES docs/design/fleetdeck-v2/verify/l7 wholesale
// (scripts/design-diff.mjs publish()), so this harness lives beside that
// directory rather than inside it, and only writes its results there.
// Run order matters: pixel gate first, then this.
const OUT = process.env.FLEET_L7_OUT || join(ROOT, 'docs/design/fleetdeck-v2/verify/l7');
const PUBLIC = join(ROOT, 'public');
const API = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const VIEWPORT = { width: 1440, height: 900 };
const TIMEOUT = 20_000;

// The captured train expires at 1788749923252 and the newest captured cert at
// 1788749914000. Freezing the clock 65 min 30 s before that cert's expiry puts
// both countdowns in the h:mm branch at 1:05 and leaves the other two certs
// expired, so one fixed instant exercises both cert states at once.
const NOW = 1788749914000 - 3_930_000;

const json = (o) => JSON.stringify(o);
const readApi = async (name) => JSON.parse(await readFile(join(API, name + '.json'), 'utf8'));
const legacyPolicy = { defaultProfile:'legacy', requiredLogins:['root','vibe','misterisley'], error:null };

// ---------------------------------------------------------------------------
// Static server for public/, loopback only.
async function serve() {
  const root = await realpath(PUBLIC);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      let candidate = resolve(root, '.' + p);
      let st;
      try { st = await stat(candidate); } catch { res.writeHead(404).end(); return; }
      if (st.isDirectory()) candidate = resolve(candidate, 'index.html');
      const file = await realpath(candidate);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
  return { port: server.address().port, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

// ---------------------------------------------------------------------------
const results = [];
let sawFailure = false;

function check(id, action, expectation, pass, detail) {
  results.push({ id, action, expectation, pass: !!pass, ...(detail ? { detail } : {}) });
  if (!pass) sawFailure = true;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${expectation}${pass || !detail ? '' : `\n        got: ${detail}`}`);
}
const eq = (id, action, expectation, actual, want) =>
  check(id, action, expectation, actual === want, `expected ${json(want)}, got ${json(actual)}`);

// ---------------------------------------------------------------------------
// One scenario: fresh context, its own API stubs, landed on the SSH keys screen.
async function scenario(browser, port, opts, body) {
  const { theme = 'dark', sshkeys, ghtrain, offline = false, posts = [], gets = [], expectHttpErrors = false } = opts;
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  context.setDefaultTimeout(TIMEOUT);
  await context.routeWebSocket('**/*', socket => socket.close());
  const noise = [];
  await context.addInitScript(({ dark }) => {
    localStorage.setItem('fd-landing-dark', dark ? '1' : '0');
    localStorage.setItem('fd-app-video', 'false');
    localStorage.removeItem('fd-fixture');
    const css = '*{animation:none!important;transition:none!important;caret-color:transparent!important}video,canvas{visibility:hidden!important}';
    const inject = () => {
      if (!document.documentElement || document.getElementById('fd-l7-style')) return;
      const s = document.createElement('style');
      s.id = 'fd-l7-style'; s.textContent = css;
      document.documentElement.appendChild(s);
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }, { dark: theme === 'dark' });

  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === 'POST') {
      let parsed = null;
      try { parsed = JSON.parse(req.postData() || 'null'); } catch { /* keep null */ }
      posts.push({ path, body: parsed });
      const reply = opts.onPost ? opts.onPost(path) : { status: 200, body: { ok: true } };
      if (reply.abort) return route.abort('failed');
      // A real in-flight window, so a busy-label check has something to observe.
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      return route.fulfill({ status: reply.status, contentType: reply.contentType || 'application/json', body: typeof reply.body === 'string' ? reply.body : json(reply.body) });
    }
    gets.push(path);
    if (path === '/api/sshkeys') {
      if (offline) return route.abort('failed');
      // Read through opts, not the destructured copy: a scenario whose response
      // changes after a POST exposes it as a getter, and destructuring would
      // have frozen the pre-POST value.
      return route.fulfill({ status: 200, contentType: 'application/json', body: json({policy:legacyPolicy,...opts.sshkeys}) });
    }
    if (path === '/api/ghtrain') {
      if (ghtrain && ghtrain.__status) {
        return route.fulfill({ status: ghtrain.__status, contentType: 'application/json', body: json(ghtrain.body) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: json(ghtrain) });
    }
    // Everything the other screens poll for: answer emptily and stay silent.
    return route.fulfill({ status: 200, contentType: 'application/json', body: json({}) });
  });

  const page = await context.newPage();
  // Chrome logs 'Failed to load resource' itself for any non-2xx or aborted
  // fetch — it is the browser reporting the stub, not the screen logging an
  // error. Scenarios that deliberately stub a failure declare expectHttpErrors
  // and only that exact line shape is forgiven; a pageerror never is.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (expectHttpErrors && /^Failed to load resource/.test(t)) return;
    noise.push('console: ' + t);
  });
  page.on('pageerror', (e) => noise.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    const t = r.resourceType();
    if (['document', 'script', 'stylesheet', 'font'].includes(t)) noise.push(`load failed: ${r.url()}`);
  });
  // A screen file or the data layer failing to load is never acceptable, even
  // in a scenario that expects API errors.
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/v2\//.test(r.url())) noise.push(`HTTP ${r.status()}: ${r.url()}`);
  });

  await page.clock.install({ time: NOW });
  await page.goto(`http://127.0.0.1:${port}/v2/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="SSH keys"]').click();
  const keys = page.locator('[data-screen-label="SSH keys"]');
  await keys.waitFor({ state: 'visible' });
  // Let the first load() land and its repaint run.
  await page.waitForTimeout(300);

  try {
    await body({ page, keys, posts, gets, noise, context });
  } finally {
    await context.close();
  }
  return noise;
}

// Card accessors: the screen is four cards in the mock's own order.
const card = (keys, i) => keys.locator('> div').nth(i);
const MINT = 0, TRAIN = 1, CERTS = 2, TABLE = 3;
const text = async (loc) => (await loc.textContent() ?? '').trim();

// ---------------------------------------------------------------------------
async function main() {
  const server = await serve();
  const browser = await chromium.launch();
  const baseKeys = await readApi('sshkeys');
  const baseTrain = await readApi('ghtrain');
  const allNoise = [];

  const TRAIN_DOWN = 'train broker unreachable at 127.0.0.1:3132 — is the com.fleetdeck.train launch agent loaded?';

  try {
    // -- S1 base: the captured deck, dark ---------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys }) => {
      const mint = card(keys, MINT), train = card(keys, TRAIN), certs = card(keys, CERTS), table = card(keys, TABLE);

      const ttlBtns = mint.locator('button');
      eq('L7-01', 'read the Mint card profiles', 'Legacy / Daily / Admin are available', (await ttlBtns.allTextContents()).slice(0, 3).join(','), 'Legacy cert,Daily cert,Admin cert');
      eq('L7-02', 'read Legacy aria state', 'Legacy is the transition default', await mint.getByRole('button',{name:'Legacy cert',exact:true}).getAttribute('aria-pressed'), 'true');
      check('L7-03', 'read Daily mode', 'Daily is available without changing the default', await mint.getByRole('button',{name:'Daily cert',exact:true}).isVisible());
      check('L7-04', 'read Admin mode', 'Admin is available without changing the default', await mint.getByRole('button',{name:'Admin cert',exact:true}).isVisible());
      eq('L7-05', 'inspect box scope controls', 'additive Admin box chips are removed', await mint.getByRole('button',{name:/^(rog-only|german-only|ivy-only|promptly-only|onboarding-only)$/}).count(), 0);
      check('L7-06', 'read the Legacy hint', 'all four legacy logins remain visible', (await text(mint.locator('p').first())).includes('root, vibe, misterisley, tabor'));

      eq('L7-07', 'read the GitHub train pill', 'an open train reads ACTIVE', await text(train.locator('span').first()), 'ACTIVE');
      eq('L7-08', 'read the train countdown', 'over an hour formats as h:mm', await text(train.locator('> div > span').nth(1)), '1:05');
      const endBtn = train.getByRole('button', { name: 'End train', exact: true });
      check('L7-09', 'look for End train', 'End train is shown while a train is live', await endBtn.isVisible());
      const hint = await text(train.locator('p').first());
      check('L7-10', 'read the train hint', 'hint and curl command verbatim', hint === 'Starting a train pops one Touch ID on the Mac. While active, agents self-serve 1h tokens: curl -s localhost:3131/api/ghtoken', hint);

      const rows = certs.locator('> div');
      eq('L7-11', 'count the certificate rows', '1 active row + its copy line + 2 expired rows', await rows.count(), 4);
      eq('L7-12', 'read the active cert pill', 'the live cert reads ACTIVE', await text(rows.nth(0).locator('span').first()), 'ACTIVE');
      eq('L7-13', 'read the active cert key id', 'the row is keyed by keyId', await text(rows.nth(0).locator('span').nth(2)), 'deployer-20260906-215834');
      eq('L7-14', 'read the active cert principals', 'principals joined, then · until <validTo>', await text(rows.nth(0).locator('span').nth(3)), 'root, vibe · until 2026-09-07T05:58:34');
      eq('L7-15', 'read the active cert countdown', 'the cert countdown matches its expiry', await text(rows.nth(0).locator('span').nth(4)), '1:05');
      eq('L7-16', 'read the active cert button', 'a live cert offers Kill now', await text(rows.nth(0).locator('button')), 'Kill now');
      eq('L7-17', 'read the copy line', 'exact ssh flags for the live cert dir', await text(rows.nth(1).locator('code')),
        '-o IdentitiesOnly=yes -o IdentityAgent=none -i /Users/misterislez/.ssh/deploy-certs/20260906-215834/deployer -o CertificateFile=/Users/misterislez/.ssh/deploy-certs/20260906-215834/deployer-cert.pub');
      eq('L7-18', 'read the expired cert pill', 'a lapsed cert reads EXPIRED', await text(rows.nth(2).locator('span').first()), 'EXPIRED');
      eq('L7-19', 'read the expired cert button', 'an expired cert offers Delete', await text(rows.nth(2).locator('button')), 'Delete');

      // The card is [h2, header grid, ...key rows]; `> div` drops the h2, so the
      // header is nth(0) and the first key row is nth(1).
      // A bound cell renders as span > span, so index the row's DIRECT children.
      const tableRows = table.locator('> div');
      eq('L7-20', 'count the key rows', 'every key from /api/sshkeys is listed', (await tableRows.count()) - 1, baseKeys.keys.length);
      eq('L7-21', 'read the first key name', 'the name column is the real key name', await text(tableRows.nth(1).locator('> span').nth(0)), baseKeys.keys[0].name);
      eq('L7-22', 'read the first key fingerprint', 'the fingerprint column is the real fingerprint', await text(tableRows.nth(1).locator('> span').nth(2)), baseKeys.keys[0].fingerprint);

      await page.screenshot({ path: join(OUT, 'live-dark.png'), animations: 'disabled', caret: 'hide' });
    }));

    // -- S1b base in light, for the second screenshot ----------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain, theme: 'light' }, async ({ page, keys }) => {
      eq('L7-23', 'render the screen in light theme', 'the live screen renders in both themes', await text(card(keys, TRAIN).locator('span').first()), 'ACTIVE');
      await page.screenshot({ path: join(OUT, 'live-light.png'), animations: 'disabled', caret: 'hide' });
    }));

    // -- S2 train inactive -------------------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: { active: false, expiresAt: null } }, async ({ keys }) => {
      const train = card(keys, TRAIN);
      eq('L7-24', 'load with no train open', 'the pill reads INACTIVE', await text(train.locator('span').first()), 'INACTIVE');
      check('L7-25', 'look for End train with no train', 'End train is hidden unless a train is live',
        !(await train.getByRole('button', { name: 'End train', exact: true }).isVisible()));
    }));

    // -- S3 broker down, with the server's message -------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: { __status: 503, body: { ok: false, error: TRAIN_DOWN } }, expectHttpErrors: true }, async ({ keys }) => {
      const train = card(keys, TRAIN);
      eq('L7-26', 'load with the broker unreachable', 'a dead broker is not collapsed into INACTIVE', await text(train.locator('span').first()), 'BROKER DOWN');
      eq('L7-27', 'read the broker error line', "the broker's own message is surfaced verbatim", await text(train.locator('[data-l7-notice]')), TRAIN_DOWN);
    }));

    // -- S4 broker down with no message ------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: { __status: 503, body: { ok: false } }, expectHttpErrors: true }, async ({ keys }) => {
      eq('L7-28', 'load with a silent dead broker', 'the default broker text is used', await text(card(keys, TRAIN).locator('[data-l7-notice]')), 'the train broker is not answering');
    }));

    // -- S5 no certs -------------------------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: { certs: [], keys: [] }, ghtrain: baseTrain }, async ({ keys }) => {
      eq('L7-29', 'load a deck with no certs', 'the empty text is verbatim', await text(card(keys, CERTS).locator('[data-l7-notice]')), 'no certs yet — mint one above');
    }));

    // -- S6 offline --------------------------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: null, ghtrain: baseTrain, offline: true, expectHttpErrors: true }, async ({ keys }) => {
      eq('L7-30', 'load with the deck unreachable', 'the certificates area is replaced by one line', await text(card(keys, CERTS).locator('[data-l7-notice]')), 'cannot reach fleetdeck');
    }));

    // -- S7 mint guard -----------------------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: {...baseKeys,policy:{...legacyPolicy,requiredLogins:['uncovered-user']}}, ghtrain: baseTrain }, async ({ page, keys, posts }) => {
      const mint = card(keys, MINT);
      eq('L7-31', 'load a login outside Legacy coverage', 'the guard explains the missing login', await text(mint.locator('[data-l7-notice]')), 'Legacy mint would drop a login used by machines.json.');
      check('L7-32', 'load a login outside Legacy coverage', 'mint is disabled and no request is sent', await mint.getByRole('button',{name:'Mint legacy cert',exact:true}).isDisabled() && !posts.some((p) => p.path === '/api/sshkeys/mint'));
    }));

    // -- S8 mint sends today's body ----------------------------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: baseKeys, ghtrain: baseTrain,
      onPost: (p) => p === '/api/sshkeys/mint' ? { status: 200, body: { ok: true, outdir: '/Users/misterislez/.ssh/deploy-certs/20260907-000000' } } : { status: 200, body: { ok: true } },
    }, async ({ page, keys, posts }) => {
      const mint = card(keys, MINT);
      await mint.getByRole('button', { name: 'Mint legacy cert', exact: true }).click();
      await page.waitForTimeout(300);
      const sent = posts.find((p) => p.path === '/api/sshkeys/mint');
      eq('L7-33', 'mint Legacy', 'the POST uses the profile schema', json(sent && sent.body), json({ profile:'legacy', ttl:'8h', extraTags:[] }));
    }));

    // -- S8b a successful mint flashes the cert it just created --------------
    // The reload has to bring the new dir back before the flash can land, so
    // this stubs mint and the follow-up GET together. Without holding flashDir
    // across that reload the highlight is dead code (it was).
    const minted = { ...baseKeys.certs[0], dir: '/Users/misterislez/.ssh/deploy-certs/20260907-000000', keyId: 'deployer-20260907-000000' };
    let mintedYet = false;
    allNoise.push(...await scenario(browser, server.port, {
      get sshkeys() { return mintedYet ? { certs: [minted, ...baseKeys.certs], keys: baseKeys.keys } : baseKeys; },
      ghtrain: baseTrain,
      onPost: (p) => { if (p === '/api/sshkeys/mint') { mintedYet = true; return { status: 200, body: { ok: true, outdir: minted.dir } }; } return { status: 200, body: { ok: true } }; },
    }, async ({ page, keys }) => {
      await card(keys, MINT).getByRole('button', { name: 'Mint legacy cert', exact: true }).click();
      await page.waitForTimeout(500);
      const rows = card(keys, CERTS).locator('> div');
      eq('L7-65', 'mint a cert successfully', 'the new cert appears at the top of the list', await text(rows.nth(0).locator('span').nth(2)), 'deployer-20260907-000000');
      const bg = await rows.nth(0).evaluate((n) => n.style.background);
      check('L7-66', 'mint a cert successfully', 'the new cert row is flashed once it is on screen', !!bg && bg !== 'transparent', `row background ${JSON.stringify(bg)}`);
    }));

    // -- S9 mint failure surfaces the server's message ---------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: baseKeys, ghtrain: baseTrain, expectHttpErrors: true,
      onPost: (p) => p === '/api/sshkeys/mint' ? { status: 502, body: { ok: false, error: 'mint failed (exit 1)' } } : { status: 200, body: { ok: true } },
    }, async ({ page, keys }) => {
      const mint = card(keys, MINT);
      await mint.getByRole('button', { name: 'Mint legacy cert', exact: true }).click();
      await page.waitForTimeout(300);
      eq('L7-34', 'mint against a failing minter', "the server's error text is shown", await text(mint.locator('[data-l7-notice]')), 'mint failed (exit 1)');
    }));

    // -- S10 a non-JSON 403 becomes HTTP 403 -------------------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: baseKeys, ghtrain: baseTrain, expectHttpErrors: true,
      onPost: (p) => p === '/api/sshkeys/mint' ? { status: 403, contentType: 'text/plain', body: 'forbidden' } : { status: 200, body: { ok: true } },
    }, async ({ page, keys }) => {
      const mint = card(keys, MINT);
      await mint.getByRole('button', { name: 'Mint legacy cert', exact: true }).click();
      await page.waitForTimeout(300);
      eq('L7-35', 'mint against an origin-refused deck', 'a body that will not parse becomes HTTP 403', await text(mint.locator('[data-l7-notice]')), 'HTTP 403');
    }));

    // -- S11 Kill now confirms, then deletes -------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys, posts }) => {
      let asked = '';
      page.on('dialog', (d) => { asked = d.message(); d.accept(); });
      await card(keys, CERTS).locator('> div').nth(0).locator('button').click();
      await page.waitForTimeout(300);
      eq('L7-36', 'press Kill now on a live cert', 'the confirm text is verbatim', asked, 'Kill this cert now? Agents using it lose access immediately.');
      const sent = posts.find((p) => p.path === '/api/sshkeys/delete');
      eq('L7-37', 'accept the Kill now confirm', 'the cert dir is posted to the delete route', json(sent && sent.body), json({ dir: baseKeys.certs[0].dir }));
    }));

    // -- S12 Kill now cancelled sends nothing ------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys, posts }) => {
      page.on('dialog', (d) => d.dismiss());
      await card(keys, CERTS).locator('> div').nth(0).locator('button').click();
      await page.waitForTimeout(300);
      check('L7-38', 'dismiss the Kill now confirm', 'nothing is deleted', !posts.some((p) => p.path === '/api/sshkeys/delete'));
    }));

    // -- S13 expired Delete asks nothing -----------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys, posts }) => {
      let asked = false;
      page.on('dialog', (d) => { asked = true; d.accept(); });
      await card(keys, CERTS).locator('> div').nth(2).locator('button').click();
      await page.waitForTimeout(300);
      check('L7-39', 'press Delete on an expired cert', 'an expired cert deletes without a confirm', !asked);
      const sent = posts.find((p) => p.path === '/api/sshkeys/delete');
      eq('L7-40', 'press Delete on an expired cert', 'that cert dir is posted', json(sent && sent.body), json({ dir: baseKeys.certs[1].dir }));
    }));

    // -- S14 Copy ----------------------------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys }) => {
      const copyRow = card(keys, CERTS).locator('> div').nth(1);
      const btn = copyRow.locator('button');
      await btn.click();
      await page.waitForTimeout(100);
      eq('L7-41', 'press Copy', 'the label becomes Copied', await text(btn), 'Copied');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      eq('L7-42', 'press Copy', 'the exact ssh flags reach the clipboard', clip,
        '-o IdentitiesOnly=yes -o IdentityAgent=none -i /Users/misterislez/.ssh/deploy-certs/20260906-215834/deployer -o CertificateFile=/Users/misterislez/.ssh/deploy-certs/20260906-215834/deployer-cert.pub');
      await page.clock.runFor(1500);
      await page.waitForTimeout(120);
      eq('L7-43', 'wait 1.5 s after Copy', 'the label reverts to Copy', await text(btn), 'Copy');
    }));

    // -- S15 start a train -------------------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: { active: false, expiresAt: null } }, async ({ page, keys, posts }) => {
      const train = card(keys, TRAIN);
      const chip = train.locator('button').nth(1);   // the 4h start chip
      await chip.click();
      await page.waitForTimeout(200);
      const sent = posts.find((p) => p.path === '/api/ghtrain');
      eq('L7-44', 'press the 4h start chip', 'the chosen TTL is posted to the train route', json(sent && sent.body), json({ ttl: '4h' }));
    }));

    // -- S16 a start chip shows Touch ID… while it waits -------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: baseKeys, ghtrain: { active: false, expiresAt: null },
      onPost: (p) => p === '/api/ghtrain' ? { status: 200, body: { ok: true }, delayMs: 1200 } : { status: 200, body: { ok: true } },
    }, async ({ page, keys }) => {
      const chip = card(keys, TRAIN).locator('button').nth(0);
      await chip.click();
      await page.waitForTimeout(250);          // inside the 1.2 s stub delay
      const label = await text(chip);
      const disabled = await chip.isDisabled();
      eq('L7-45', 'press a start chip and look while it is in flight', 'the chip reads Touch ID…', label, 'Touch ID…');
      check('L7-63', 'press a start chip and look while it is in flight', 'the chip is disabled until the broker answers', disabled);
      await page.waitForTimeout(1400);         // let it land
      eq('L7-64', 'wait for the start to land', 'the chip goes back to its TTL', await text(chip), '1h');
    }));

    // -- S17 train start failure -------------------------------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: baseKeys, ghtrain: { active: false, expiresAt: null }, expectHttpErrors: true,
      onPost: (p) => p === '/api/ghtrain' ? { status: 400, body: { ok: false, error: 'ttl must be 1h, 4h or 8h' } } : { status: 200, body: { ok: true } },
    }, async ({ page, keys }) => {
      await card(keys, TRAIN).locator('button').nth(0).click();
      await page.waitForTimeout(300);
      eq('L7-46', 'start a train the broker refuses', "the broker's validation text is shown", await text(card(keys, TRAIN).locator('[data-l7-notice]')), 'ttl must be 1h, 4h or 8h');
    }));

    // -- S18 end a train ---------------------------------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys, posts }) => {
      await card(keys, TRAIN).getByRole('button', { name: 'End train', exact: true }).click();
      await page.waitForTimeout(250);
      const sent = posts.find((p) => p.path === '/api/ghtrain/end');
      eq('L7-47', 'press End train', 'today\'s empty body is posted to the end route', json(sent && sent.body), json({}));
    }));

    // -- S19 end-train failure ---------------------------------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: baseKeys, ghtrain: baseTrain, expectHttpErrors: true,
      onPost: (p) => p === '/api/ghtrain/end' ? { status: 500, contentType: 'text/plain', body: 'boom' } : { status: 200, body: { ok: true } },
    }, async ({ page, keys }) => {
      await card(keys, TRAIN).getByRole('button', { name: 'End train', exact: true }).click();
      await page.waitForTimeout(300);
      eq('L7-48', 'end a train against a broken deck', 'a non-JSON failure becomes HTTP 500', await text(card(keys, TRAIN).locator('[data-l7-notice]')), 'HTTP 500');
    }));

    // -- S20 the 1 s tick and the 30 s poll --------------------------------
    // fastForward jumps the clock and fires each timer at most once, the way a
    // closed laptop lid would. runFor would replay ~4000 ticks and ~130 polls.
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys, gets }) => {
      const cd = card(keys, TRAIN).locator('> div > span').nth(1);
      eq('L7-49', 'read the countdown before ticking', 'the countdown starts at 1:05', await text(cd), '1:05');
      await page.clock.fastForward(60_000);
      await page.waitForTimeout(150);
      eq('L7-50', 'advance the clock one minute', 'the countdown ticks down locally', await text(cd), '1:04');
      const before = gets.filter((p) => p === '/api/sshkeys').length;
      await page.clock.fastForward(30_000);
      await page.waitForTimeout(300);
      const after = gets.filter((p) => p === '/api/sshkeys').length;
      check('L7-51', 'advance the clock past 30 s', 'the screen re-polls /api/sshkeys', after > before, `before ${before}, after ${after}`);
    }));

    // -- S21 a cert crossing zero flips to EXPIRED -------------------------
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys }) => {
      const row = card(keys, CERTS).locator('> div').nth(0);
      eq('L7-52', 'read the live cert before expiry', 'it is ACTIVE with a Kill now button', await text(row.locator('button')), 'Kill now');
      await page.clock.fastForward(3_960_000);   // past the cert's expiry
      await page.waitForTimeout(300);
      const first = card(keys, CERTS).locator('> div').nth(0);
      eq('L7-53', 'advance past the cert expiry', 'the badge flips to EXPIRED', await text(first.locator('span').first()), 'EXPIRED');
      eq('L7-54', 'advance past the cert expiry', 'the button becomes Delete', await text(first.locator('button')), 'Delete');
    }));

    // -- S22 the mm:ss branch ----------------------------------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: { certs: [{ ...baseKeys.certs[0], validToEpoch: NOW + 310_000 }], keys: baseKeys.keys },
      ghtrain: { active: true, expiresAt: NOW + 310_000 },
    }, async ({ keys }) => {
      // The installed clock still advances with real time, so the exact second
      // depends on how long the page took to reach this line. What is under
      // test is the branch: zero-padded mm:ss, not the h:mm shape.
      const cd = await text(card(keys, TRAIN).locator('> div > span').nth(1));
      check('L7-55', 'load a train under an hour out', 'under an hour formats as zero-padded mm:ss', /^0[45]:[0-5]\d$/.test(cd), cd);
    }));

    // -- S23 the real key type, which the mock hard-codes -------------------
    allNoise.push(...await scenario(browser, server.port, {
      sshkeys: {
        certs: baseKeys.certs,
        keys: [
          { name: 'id_rsa', type: 'RSA', fingerprint: 'SHA256:aaa', comment: 'legacy' },
          { name: 'id_ecdsa', type: 'ECDSA', fingerprint: 'SHA256:bbb', comment: 'yubikey' },
          { name: 'id_ed25519', type: 'ED25519', fingerprint: 'SHA256:ccc', comment: 'daily' },
          { name: 'id_odd', type: '', fingerprint: '', comment: '' },
        ],
      },
      ghtrain: baseTrain,
    }, async ({ keys }) => {
      const rows = card(keys, TABLE).locator('> div');
      eq('L7-56', 'load keys that are not all ED25519', 'the Type column shows the real algorithm', await text(rows.nth(1).locator('> span').nth(1)), 'RSA');
      eq('L7-57', 'load an ECDSA key', 'the Type column is per row, not hard-coded', await text(rows.nth(2).locator('> span').nth(1)), 'ECDSA');
      eq('L7-58', 'load an ED25519 key', 'ED25519 still reads ED25519', await text(rows.nth(3).locator('> span').nth(1)), 'ED25519');
      eq('L7-59', 'load a key with no type', "a missing type falls back to '?'", await text(rows.nth(4).locator('> span').nth(1)), '?');
    }));

    // -- S24 switching theme in a live session restyles the painted rows ----
    // The cloned prototypes carry whichever palette was live when they were
    // captured, so a theme flip after the first paint is the case that catches
    // a frozen colour. The sidebar's theme toggle drives it, as a user would.
    allNoise.push(...await scenario(browser, server.port, { sshkeys: baseKeys, ghtrain: baseTrain }, async ({ page, keys }) => {
      const codeEl = card(keys, CERTS).locator('> div').nth(1).locator('code');
      const principals = card(keys, CERTS).locator('> div').nth(0).locator('> span').nth(2);
      const read = async () => ({
        code: await codeEl.evaluate((n) => getComputedStyle(n).backgroundColor),
        principals: await principals.evaluate((n) => getComputedStyle(n).color),
      });
      const before = await read();
      // The app has no theme control in its markup — theme is AppLogic state
      // read from localStorage. Drive it the way the app itself would, through
      // the logic handle the screen already receives on every sync.
      const flipped = await page.evaluate(() => {
        const c = window.FD && FD.screens && FD.screens.keys && FD.screens.keys._debug && FD.screens.keys._debug.ctx;
        if (!c || !c.logic) return false;
        c.logic.setState({ dark: false });
        return true;
      });
      await page.waitForTimeout(400);
      const after = await read();
      check('L7-61', 'flip to the light theme after the cards are painted',
        'the painted copy line takes the new palette instead of the captured one',
        flipped && before.code !== after.code, `flipped=${flipped} ${before.code} -> ${after.code}`);
      check('L7-62', 'flip to the light theme after the cards are painted',
        'the principals line is restyled too, not left on the dark ink',
        flipped && before.principals !== after.principals, `${before.principals} -> ${after.principals}`);
    }));

    // -- S25 leave the screen and come back ---------------------------------
    // The sc-if tears this subtree down on navigation, so a revisit gets fresh
    // nodes carrying none of our attributes. capture() used to set data-dc-raw
    // once, which left every visit after the first unguarded. Also checks the
    // poll follows the screen rather than running from wherever you navigate to.
    let listSwapped = false;
    const extraCert = { ...baseKeys.certs[0], dir: '/Users/misterislez/.ssh/deploy-certs/20260907-111111', keyId: 'deployer-20260907-111111' };
    allNoise.push(...await scenario(browser, server.port, {
      get sshkeys() { return listSwapped ? { certs: [extraCert, ...baseKeys.certs], keys: baseKeys.keys } : baseKeys; },
      ghtrain: baseTrain,
    }, async ({ page, keys, gets }) => {
      const certsCard = card(keys, CERTS);
      eq('L7-67', 'load the keys screen', 'the Certificates card is marked as owning its children',
        await certsCard.getAttribute('data-dc-raw'), '');

      // Leave for another screen.
      await page.locator('aside button[title="Machines"]').click();
      await page.locator('[data-screen-label="SSH keys"]').waitFor({ state: 'detached' });
      const awayFrom = gets.filter((p) => p === '/api/sshkeys').length;
      await page.clock.fastForward(90_000);       // three poll periods away
      await page.waitForTimeout(300);
      check('L7-68', 'navigate away and let three poll periods pass', 'the sshkeys poll stops with the screen',
        gets.filter((p) => p === '/api/sshkeys').length === awayFrom,
        `polled ${gets.filter((p) => p === '/api/sshkeys').length - awayFrom} more times while away`);

      // Come back, with a different cert list behind it.
      listSwapped = true;
      await page.locator('aside button[title="SSH keys"]').click();
      await keys.waitFor({ state: 'visible' });
      await page.waitForTimeout(500);
      const back = card(keys, CERTS);
      eq('L7-69', 'return to the keys screen', 'the guard is re-applied on the fresh subtree',
        await back.getAttribute('data-dc-raw'), '');
      eq('L7-70', 'return to the keys screen', 'the poll restarts and the new cert list is painted',
        await text(back.locator('> div').nth(0).locator('span').nth(2)), 'deployer-20260907-111111');

      // Force further renders; the painted rows must survive them.
      await page.evaluate(() => {
        const c = window.FD && FD.screens && FD.screens.keys && FD.screens.keys._debug && FD.screens.keys._debug.ctx;
        if (c && c.logic) { c.logic.setState({ ttl: '4h' }); c.logic.setState({ ttl: '8h' }); }
      });
      await page.waitForTimeout(300);
      eq('L7-71', 'render repeatedly after returning', 'the painted rows survive later renders',
        await text(card(keys, CERTS).locator('> div').nth(0).locator('span').nth(2)), 'deployer-20260907-111111');
    }));

    // -- silence -----------------------------------------------------------
    const noise = [...new Set(allNoise)];
    check('L7-60', 'watch the console across every scenario', 'the screen logs no errors of its own', noise.length === 0, noise.join(' | '));
  } finally {
    await browser.close();
    await server.close();
  }

  const passed = results.filter((r) => r.pass).length;
  const report = {
    schemaVersion: 1,
    mode: 'live',
    slice: 'l7',
    capturedAt: new Date().toISOString(),
    clock: { fixedNow: NOW, iso: new Date(NOW).toISOString(), note: 'page.clock.install so every countdown is deterministic' },
    source: 'public/ served on loopback, /api/* stubbed from docs/design/fleetdeck-v2/fixtures/api/ plus hand-written error, empty, offline and non-ED25519 variants',
    viewport: VIEWPORT,
    total: results.length,
    passed,
    failed: results.length - passed,
    allPass: !sawFailure && results.length > 0,
    results,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'live.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${passed}/${results.length} live checks passed; allPass=${report.allPass}`);
  console.log('Report: docs/design/fleetdeck-v2/verify/l7/live.json');
  if (!report.allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
