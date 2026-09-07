// fd-v2 L7 — the screenshots the improvisation log cites.
//
// Each shot is of the card the improvisation is about, in the state that shows
// it, on the same stubbed API the live proof uses. Writes into
// docs/design/fleetdeck-v2/improvised/.
//
// Run: node docs/design/fleetdeck-v2/verify/l7/shots.mjs
import { createServer } from 'node:http';
import { readFile, stat, realpath, mkdir } from 'node:fs/promises';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const PUBLIC = join(ROOT, 'public');
const API = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const OUT = join(ROOT, 'docs/design/fleetdeck-v2/improvised');
const NOW = 1788749914000 - 3_930_000;

const json = (o) => JSON.stringify(o);
const readApi = async (n) => JSON.parse(await readFile(join(API, n + '.json'), 'utf8'));

async function serve() {
  const root = await realpath(PUBLIC);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      let c = resolve(root, '.' + p);
      let st;
      try { st = await stat(c); } catch { res.writeHead(404).end(); return; }
      if (st.isDirectory()) c = resolve(c, 'index.html');
      const file = await realpath(c);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': data.length });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
  return { port: server.address().port, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

async function shot(browser, port, { sshkeys, ghtrain, theme = 'dark', cardIndex, file }) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  context.setDefaultTimeout(20_000);
  await context.addInitScript(({ dark }) => {
    localStorage.setItem('fd-landing-dark', dark ? '1' : '0');
    localStorage.setItem('fd-app-video', 'false');
    localStorage.removeItem('fd-fixture');
    const inject = () => {
      if (!document.documentElement || document.getElementById('s')) return;
      const s = document.createElement('style');
      s.id = 's';
      s.textContent = '*{animation:none!important;transition:none!important;caret-color:transparent!important}video,canvas{visibility:hidden!important}';
      document.documentElement.appendChild(s);
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }, { dark: theme === 'dark' });
  await context.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: json({ ok: true }) });
    if (p === '/api/sshkeys') return route.fulfill({ status: 200, contentType: 'application/json', body: json(sshkeys) });
    if (p === '/api/ghtrain') {
      if (ghtrain && ghtrain.__status) return route.fulfill({ status: ghtrain.__status, contentType: 'application/json', body: json(ghtrain.body) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: json(ghtrain) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const page = await context.newPage();
  await page.clock.install({ time: NOW });
  await page.goto(`http://127.0.0.1:${port}/v2/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen-label="Landing"]').waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('[data-screen-label="Fleetdeck app"]').waitFor({ state: 'visible' });
  await page.locator('aside button[title="SSH keys"]').click();
  await page.locator('[data-screen-label="SSH keys"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  const target = cardIndex == null
    ? page.locator('[data-screen-label="SSH keys"]')
    : page.locator('[data-screen-label="SSH keys"] > div').nth(cardIndex);
  await target.screenshot({ path: join(OUT, file), animations: 'disabled', caret: 'hide' });
  console.log('wrote improvised/' + file);
  await context.close();
}

const server = await serve();
const browser = await chromium.launch();
const keys = await readApi('sshkeys');
const train = await readApi('ghtrain');
const TRAIN_DOWN = 'train broker unreachable at 127.0.0.1:3132 — is the com.fleetdeck.train launch agent loaded?';

try {
  await mkdir(OUT, { recursive: true });

  // I-L7-03 — live mode lights both principal chips (the mock seeds only root).
  await shot(browser, server.port, { sshkeys: keys, ghtrain: train, cardIndex: 0, file: 'l7-principals-live.png' });

  // I-L7-06 + I-L7-04 — the amber BROKER DOWN pill and the cloned notice line.
  await shot(browser, server.port, { sshkeys: keys, ghtrain: { __status: 503, body: { ok: false, error: TRAIN_DOWN } }, cardIndex: 1, file: 'l7-broker-down.png' });

  // I-L7-07 — certificates painted from clones of the mock's own rows.
  await shot(browser, server.port, { sshkeys: keys, ghtrain: train, cardIndex: 2, file: 'l7-certificates.png' });

  // I-L7-05 — the Type column carries the real algorithm, not the mock's literal.
  await shot(browser, server.port, {
    sshkeys: {
      certs: keys.certs,
      keys: [
        { name: 'id_rsa', type: 'RSA', fingerprint: 'SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', comment: 'legacy deploy key' },
        { name: 'id_ecdsa', type: 'ECDSA', fingerprint: 'SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', comment: 'yubikey' },
        { name: 'id_ed25519', type: 'ED25519', fingerprint: 'SHA256:ccccccccccccccccccccccccccccccccccccccccccc', comment: 'daily driver' },
        { name: 'id_unknown', type: '', fingerprint: '', comment: '' },
      ],
    },
    ghtrain: train, cardIndex: 3, file: 'l7-key-types.png',
  });

  // The whole screen, live, for the record.
  await shot(browser, server.port, { sshkeys: keys, ghtrain: train, file: 'l7-screen-dark.png' });
  await shot(browser, server.port, { sshkeys: keys, ghtrain: train, theme: 'light', file: 'l7-screen-light.png' });
} finally {
  await browser.close();
  await server.close();
}
