// fd-v2 L10 — API stubbing for the live-mode proof.
//
// Routes /api/* to the JSON fixtures under docs/design/fleetdeck-v2/fixtures/api/
// (L1's captures) and to the hand-written variants in ./fixtures/ that cover the
// states the capture does not contain: liveState 'unknown', a stale row, and the
// per-machine collection failures.
//
// `_minutesAgo` and `_collectedMinutesAgo` are NOT API fields. They are resolved
// against the clock at route time and deleted before the body is served, so the
// age() strings the suite asserts ('Just now', '9m ago', '1h ago', '2d ago') are
// exact no matter when the suite runs.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This harness deliberately lives OUTSIDE verify/l10/: scripts/design-diff.mjs
// builds that directory in a staging dir and renames it into place, which wipes
// anything else kept there. Only the gate's own output belongs in verify/l10/;
// live.mjs writes its live.json and PNGs there after the gate has run.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../..');
const API = join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const VARIANTS = join(HERE, 'fixtures');
export const OUT = join(ROOT, 'docs/design/fleetdeck-v2/verify/l10');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

export const capture = () => readJson(join(API, 'desktop-sessions.json'));
export const states = () => readJson(join(VARIANTS, 'desktop-sessions-states.json'));
export const empty = () => readJson(join(VARIANTS, 'desktop-sessions-empty.json'));
export const transcriptText = () => readFile(join(VARIANTS, 'transcript-ok.txt'), 'utf8');

const iso = (minutes, now) => new Date(now - minutes * 60000).toISOString();

// Materialise every _minutesAgo into a real timestamp, then strip the helper keys.
export function materialise(body, now = Date.now()) {
  const out = JSON.parse(JSON.stringify(body));
  if (typeof out._collectedMinutesAgo === 'number') {
    out.collected_at = now - out._collectedMinutesAgo * 60000;
    delete out._collectedMinutesAgo;
  }
  for (const group of out.groups || []) {
    for (const session of group.sessions || []) {
      if (typeof session._minutesAgo === 'number') {
        session.lastActivityAt = iso(session._minutesAgo, now);
        // Created is always older than the last activity, and only ever displayed raw.
        if (!session.createdAt) session.createdAt = iso(session._minutesAgo + 60, now);
        delete session._minutesAgo;
      }
    }
  }
  return out;
}

// One place that decides what every /api/* route answers, so a test can swap the
// desktop-sessions body (capture / states / empty / an HTTP error) and leave the
// rest of the fleet's endpoints answering something well-formed.
export async function install(page, options = {}) {
  const { sessions = 'states', transcript = 200, now = Date.now(), messages = { ok: true } } = options;

  const bodyFor = async () => {
    if (sessions === 'capture') return materialise(await capture(), now);
    if (sessions === 'empty') return materialise(await empty(), now);
    if (sessions === 'states') return materialise(await states(), now);
    return sessions; // an explicit object
  };

  await page.route('**/api/desktop-sessions/transcript**', async (route) => {
    if (transcript === 200) {
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: await transcriptText() });
    }
    if (transcript === 404) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no transcript' });
    return route.fulfill({ status: 502, contentType: 'text/plain', body: 'transcript unavailable' });
  });

  await page.route('**/api/desktop-sessions**', async (route) => {
    if (typeof sessions === 'number') {
      return route.fulfill({ status: sessions, contentType: 'text/plain', body: 'boom' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await bodyFor()) });
  });

  await page.route('**/api/messages**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(messages) }));

  // Everything else the shell may touch answers from L1's captures, so a screen
  // switch never leaves an unrouted request hanging.
  for (const name of ['sessions', 'health', 'credits', 'seats', 'machines', 'sshkeys', 'ghtrain']) {
    await page.route(`**/api/${name}**`, async (route) => {
      try {
        const body = await readFile(join(API, `${name}.json`), 'utf8');
        return route.fulfill({ status: 200, contentType: 'application/json', body });
      } catch {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
  }
}
