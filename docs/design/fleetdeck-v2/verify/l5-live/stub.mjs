// fd-v2-l5 — the stubbed backend shared by live.mjs (the proof) and shots.mjs
// (the improvisation screenshots). Serves public/ and answers /api/* from
// docs/design/fleetdeck-v2/fixtures/api/ plus the hand-written variants the
// captured fixtures cannot reach.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// verify/l5-live -> verify -> fleetdeck-v2 -> design -> docs -> repo root
export const ROOT = resolve(HERE, '../../../../..');
export const PUBLIC = join(ROOT, 'public');
export const API = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};

/* The crafted topology: every buildTree branch the captured fixtures miss —
 * a vacant seat, a conflicting seat, a depth-2 child, a tombstone, a pinger,
 * an idle row, a two-node cycle and a dangling parent. */
export function crafted(now) {
  const iso = (ms) => new Date(ms).toISOString();
  const S = (host, name, extra) => ({
    host, name, label: '', role: '', worker: '', status: 'active', note: '',
    group: '', task: '', last_seen_at: iso(now - 3000), active_at: iso(now - 3000),
    msg_at: null, pid: null, parent_host: null, parent_name: null, epoch: null,
    lease_state: null, expires_at: null, suspect_at: null, pinger_dead: null,
    live: true, ...extra,
  });
  const sessions = [
    S('mac', 'O45-orch', { worker: 'Orchestrator', lease_state: 'active', epoch: 3, expires_at: now + 3600000 }),
    S('mac', 'COORD', { worker: 'Coordinator', lease_state: 'active', epoch: 7, expires_at: now + 6 * 86400000 }),
    S('german-box', 'FD-kid-a', { worker: 'Dietlind', role: 'frontend-developer', group: 'fleetdeck', task: 'DECK-54', lease_state: 'active', epoch: 1, expires_at: now + 60000, parent_host: 'mac', parent_name: 'O45-orch' }),
    S('german-box', 'FD-kid-b', { worker: 'Juergen', role: 'backend-developer', group: 'fleetdeck', lease_state: 'suspect', live: false, epoch: 2, expires_at: now - 120000, last_seen_at: iso(now - 16 * 60000), active_at: iso(now - 16 * 60000), parent_host: 'mac', parent_name: 'O45-orch' }),
    S('german-box', 'FD-grandkid', { worker: 'Machtild', role: 'tooling-engineer', group: 'fleetdeck', lease_state: 'active', epoch: 4, expires_at: now + 90000, parent_host: 'german-box', parent_name: 'FD-kid-a' }),
    S('german-box', 'LC-orphan', { parent_host: 'nowhere', parent_name: 'nobody' }),
    S('mac', 'DEAD-DESKTOP', { worker: 'Ghost', lease_state: 'reaped' }),
    S('german-box', 'FD-pinger', { worker: 'Pinger', lease_state: 'active', pinger_dead: true, epoch: 5, expires_at: now + 45000 }),
    S('german-box', 'CYC-a', { worker: 'CycA', parent_host: 'german-box', parent_name: 'CYC-b' }),
    S('german-box', 'CYC-b', { worker: 'CycB', parent_host: 'german-box', parent_name: 'CYC-a' }),
    S('onboarding-box', 'reaped-one', { worker: 'Reaped', lease_state: 'reaped' }),
  ];
  const seats = [
    { seat: 'coordinator', owner_host: 'mac', owner_name: 'COORD', expires_at: now + 6 * 86400000, suspect_at: null, fenced: false },
    { seat: 'orchestrator', owner_host: 'mac', owner_name: 'O45-orch', expires_at: now + 3600000, suspect_at: null, fenced: true },
    { seat: 'auditor', owner_host: 'ghost-box', owner_name: 'never-existed', expires_at: now - 60000, suspect_at: null, fenced: false },
    { seat: 'reviewer', owner_host: 'mac', owner_name: 'COORD', expires_at: now + 120000, suspect_at: null, fenced: false },
  ];
  return { sessions, seats };
}

// getScenario() is read per request, so a caller can switch state between loads.
export async function startServer(getScenario, craftedData) {
  const apiBody = async (pathname) => {
    const scenario = getScenario();
    if (pathname === '/api/sessions') {
      if (scenario === 'crafted') return { code: 200, body: { sessions: craftedData.sessions, errors: [] } };
      if (scenario === 'empty') return { code: 200, body: { sessions: [], errors: [] } };
      if (scenario === 'hostErrors') return { code: 200, body: { sessions: craftedData.sessions, errors: ['gb: ssh timeout', 'ivy: refused'] } };
      if (scenario === 'seatsDown') return { code: 200, body: { sessions: craftedData.sessions, errors: [] } };
      return { code: 200, body: JSON.parse(await readFile(join(API, 'sessions.json'), 'utf8')) };
    }
    if (pathname === '/api/seats') {
      if (scenario === 'seatsDown') return { code: 503, body: { ok: false, error: 'seat endpoint frozen' } };
      if (scenario === 'crafted' || scenario === 'hostErrors') return { code: 200, body: { ok: true, seats: craftedData.seats } };
      if (scenario === 'empty') return { code: 200, body: { ok: true, seats: [] } };
      return { code: 200, body: JSON.parse(await readFile(join(API, 'seats.json'), 'utf8')) };
    }
    return null;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      const stub = await apiBody(url.pathname);
      if (stub) {
        res.writeHead(stub.code, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(stub.body));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end('{}');
        return;
      }
      const rel = url.pathname === '/' ? 'index.html'
        : url.pathname.endsWith('/') ? url.pathname.replace(/^\/+/, '') + 'index.html'
        : url.pathname.replace(/^\/+/, '');
      const file = join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('no'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found: ' + url.pathname);
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, port: server.address().port };
}

export const ORG = '[data-screen-label="Org chart"]';

// The guarded hooks L2 and L6 have not landed yet; record calls in their place.
export const hookProbe = () => {
  window.__hooks = { liveApi: [], bus: [] };
  const install = () => {
    window.FD = window.FD || {};
    FD.shell = FD.shell || {};
    FD.screens = FD.screens || {};
    FD.shell.setLiveApi = (text, tone) => window.__hooks.liveApi.push({ text, tone });
    FD.screens.bus = { open: (t) => window.__hooks.bus.push(t) };
  };
  install();
  document.addEventListener('DOMContentLoaded', install);
};

export async function openOrg(page, base, query = '') {
  await page.goto(base + '/v2/index.html' + query, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'App', exact: true }).click();
  await page.locator('aside button[title="Org chart"]').click();
  await page.locator(ORG).waitFor({ state: 'visible' });
  await page.waitForTimeout(900); // org.js probes for the screen every 50 ms, then fetches
}
