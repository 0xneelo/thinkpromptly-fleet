// L8 acceptance: the Accounts (credits) screen's pure logic must produce exactly what
// today's public/accounts.js produces — same texts, same thresholds, same ordering.
// The row shapes come from the response captured from the live deck on 2026-09-07
// (docs/design/fleetdeck-v2/fixtures/api/credits.json); the states that capture does
// not contain (expired token, rate limit, no source, capped credits) are built here
// from the same row shape.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const acct = require(path.join(ROOT, 'public/v2/screens/accounts.js'));
const data = require(path.join(ROOT, 'public/v2/data.js'));

const credits = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api/credits.json'), 'utf8'));

// Fixed clock so every humanised timestamp is deterministic. The endpoint stores
// epoch SECONDS.
const NOW = 1788740000000;
const SEC = (ms) => ms / 1000;

test('ago: the four buckets and the amber/red ages', () => {
  assert.equal(acct.ago(SEC(NOW - 30 * 1000), NOW).text, 'just now');
  assert.equal(acct.ago(SEC(NOW - 5 * 60000), NOW).text, '5m ago');
  assert.equal(acct.ago(SEC(NOW - 3 * 3600000), NOW).text, '3h ago');
  assert.equal(acct.ago(SEC(NOW - 2 * 864e5), NOW).text, '2d ago');
  assert.equal(acct.ago(SEC(NOW - 3600000), NOW).cls, '');
  assert.equal(acct.ago(SEC(NOW - 2 * 864e5), NOW).cls, 'age-amber');
  assert.equal(acct.ago(SEC(NOW - 4 * 864e5), NOW).cls, 'age-red');
});

test('until: resets now, minutes, then hours and minutes', () => {
  assert.equal(acct.until(0, NOW), '');
  assert.equal(acct.until(null, NOW), '');
  assert.equal(acct.until(SEC(NOW - 60000), NOW), 'resets now');
  assert.equal(acct.until(SEC(NOW + 26 * 60000), NOW), 'resets in 26m');
  assert.equal(acct.until(SEC(NOW + (4 * 60 + 26) * 60000), NOW), 'resets in 4h 26m');
});

test('level: red over 90, amber from 70', () => {
  assert.equal(acct.level(0), '');
  assert.equal(acct.level(69), '');
  assert.equal(acct.level(70), 'amber');
  assert.equal(acct.level(90), 'amber');
  assert.equal(acct.level(91), 'red');
  assert.equal(acct.level(100), 'red');
});

test('worst: the highest main window, null when nothing reported a number', () => {
  const claude = (windows) => ({ kind: 'claude', windows });
  assert.equal(acct.worst(claude({ five_hour: { pct: 28 }, seven_day: { pct: 6 }, seven_day_fable: { pct: 100 } })), 100);
  // The paid extra pool is not a wall, so it never counts.
  assert.equal(acct.worst(claude({ five_hour: { pct: 12 }, extra: { pct: 99 } })), 12);
  assert.equal(acct.worst(claude({ five_hour: { pct: null }, seven_day: { pct: null } })), null);
  assert.equal(acct.worst({ kind: 'codex', weekly: { pct: 80 }, secondary: null }), 80);
});

test('order: most constrained first, unreported rows last', () => {
  const pair = (id, kind, windows) => ({ raw: { id, kind, windows }, base: {} });
  const out = acct.order([
    pair('a', 'claude', { five_hour: { pct: 28 } }),
    pair('b', 'claude', { five_hour: { pct: null } }),
    pair('c', 'claude', { five_hour: { pct: 96 } }),
    pair('d', 'claude', { five_hour: { pct: 62 } }),
  ]);
  assert.deepEqual(out.map((p) => p.raw.id), ['c', 'd', 'a', 'b']);
});

test('summary: counts, the limit tally and money per currency', () => {
  assert.deepEqual(acct.summary([]), ['0 accounts', '0 at or over a limit', 'no credits spent']);
  // One account is singular — accounts.js:207.
  assert.deepEqual(acct.summary([{ kind: 'claude', windows: {} }]),
    ['1 account', '0 at or over a limit', 'no credits spent']);
  assert.deepEqual(acct.summary([
    { kind: 'claude', windows: { seven_day_fable: { pct: 100 } } },
    { kind: 'claude', windows: { five_hour: { pct: 12 } }, credit: { used: 1.5, limit: 10, currency: 'USD' } },
    { kind: 'claude', windows: { five_hour: { pct: 1 } }, credit: { used: 2.25, limit: 10, currency: 'USD', capped: true } },
    { kind: 'codex', weekly: { pct: 100 } },
  ]), ['4 accounts', '3 at or over a limit', 'spent 3.75 USD']);
  // Currencies are listed side by side — adding them would invent a rate.
  assert.deepEqual(acct.summary([
    { kind: 'claude', windows: {}, credit: { used: 1, limit: 5, currency: 'USD' } },
    { kind: 'claude', windows: {}, credit: { used: 2, limit: 5, currency: 'EUR' } },
  ])[2], 'spent 1.00 USD · 2.00 EUR');
});

test('creditsLine: money for claude, balance for codex, verbatim suffixes', () => {
  const claude = (credit) => acct.creditsLine({ kind: 'claude', credit });
  assert.equal(claude(null), null);
  assert.equal(claude({ used: null, limit: null, decimals: 0, enabled: false }), null);
  assert.deepEqual(claude({ used: 1.5, limit: 10, decimals: 2, currency: 'USD', enabled: true, capped: false }),
    { text: 'credits: 1.50 / 10.00 USD', notice: false });
  assert.deepEqual(claude({ used: 10, limit: 10, decimals: 2, currency: 'USD', enabled: true, capped: true }),
    { text: 'credits: 10.00 / 10.00 USD · spend limit reached', notice: true });
  assert.deepEqual(claude({ used: 1, limit: 10, decimals: 0, currency: 'USD', enabled: false, capped: false }),
    { text: 'credits: 1 / 10 USD · extra usage off', notice: false });
  // No currency on the row means no trailing space.
  assert.equal(claude({ used: 1, limit: 2, decimals: 2, currency: null, enabled: true }).text, 'credits: 1.00 / 2.00');

  const codex = (c) => acct.creditsLine({ kind: 'codex', credits: c });
  assert.equal(codex({ has_credits: false, balance: '0' }), null);
  assert.equal(codex({ has_credits: true, unlimited: true }).text, 'credits: unlimited');
  assert.equal(codex({ has_credits: true, unlimited: false, balance: '12.40' }).text, 'credits: 12.40');
});

test('banner: one sentence per state, a rate limit is not a fault', () => {
  assert.equal(acct.banner({ state: 'ok', host: 'h' }), null);
  assert.deepEqual(acct.banner({ state: 'token_expired', host: 'german-box' }),
    { text: 'token expired — open Claude Code on german-box', tone: 'notice' });
  assert.deepEqual(acct.banner({ state: 'rate_limited', host: 'german-box', windows: { seven_day: { pct: 40 } }, }),
    { text: 'usage endpoint busy on german-box — figures below are the last good read', tone: 'muted' });
  // A row that never got a good read has no figures to point at.
  assert.deepEqual(acct.banner({ state: 'rate_limited', host: 'german-box', windows: {} }),
    { text: 'usage endpoint busy on german-box', tone: 'muted' });
  assert.deepEqual(acct.banner({ state: 'error', host: 'german-box' }),
    { text: 'could not read usage on german-box', tone: 'notice' });
});

test('banner: a held usage call speaks before the row\'s own state', () => {
  // The row still reads state ok — the numbers are the last good ones — so only `hold` can
  // say the live call is not being made. A throttle is not a fault, hence muted.
  const at = SEC(NOW - 5 * 60000);
  assert.deepEqual(
    acct.banner({ state: 'ok', host: 'mac', windows: { seven_day: { pct: 40 } }, hold: { state: 'rate_limited', host: 'ROG Strix', note: 'usage call refused with HTTP 429, pausing 3600s', at, until: at + 3600 } }),
    { text: 'usage call throttled on ROG Strix until ' + acct.hhmm(at + 3600) + ' — figures below are the last good read', tone: 'muted' }
  );
  // No pause length in the note, no clock time in the sentence.
  assert.deepEqual(acct.banner({ state: 'ok', host: 'mac', windows: { seven_day: { pct: 40 } }, hold: { state: 'rate_limited', host: 'ROG Strix', note: null, at, until: null } }),
    { text: 'usage call throttled on ROG Strix — figures below are the last good read', tone: 'muted' });
  // Anything but a throttle is a fault the operator can act on.
  assert.deepEqual(acct.banner({ state: 'ok', host: 'mac', windows: { seven_day: { pct: 40 } }, hold: { state: 'token_expired', host: 'german-box', note: null, at, until: null } }),
    { text: 'usage call refused, token expired on german-box — figures below are the last good read', tone: 'notice' });
  assert.deepEqual(acct.banner({ state: 'ok', host: 'mac', windows: { seven_day: { pct: 40 } }, hold: { state: 'error', host: 'german-box', note: null, at, until: null } }),
    { text: 'usage call failed on german-box — figures below are the last good read', tone: 'notice' });
});

test('bars: window order and labels, extra last, empty rows still render', () => {
  const r = {
    kind: 'claude',
    windows: {
      extra: { pct: 3, resets_at: null },
      seven_day_fable: { pct: 8, resets_at: null },
      seven_day: { pct: 71, resets_at: null },
      five_hour: { pct: 12, resets_at: SEC(NOW + (4 * 60 + 26) * 60000) },
    },
  };
  const out = acct.bars(r, NOW);
  assert.deepEqual(out.map((b) => b.label), ['5 hour', '7 day', '7 day Fable', 'extra usage']);
  assert.deepEqual(out[0], { label: '5 hour', pct: 12, right: '12%', level: '', resets: 'resets in 4h 26m' });
  assert.equal(out[1].level, 'amber');
  // A window with no percentage still gets a row — an empty bar says "reported, unknown".
  assert.deepEqual(acct.bars({ kind: 'claude', windows: { five_hour: { pct: null, resets_at: null, stale: true } } }, NOW),
    [{ label: '5 hour', pct: null, right: '—', level: '', resets: '' }]);
  // An aged-out window keeps the number it last held: greyed, and named as history.
  assert.deepEqual(acct.bars({ kind: 'claude', windows: { five_hour: { pct: null, resets_at: null, stale: true, last: 42 } } }, NOW),
    [{ label: '5 hour', pct: null, last: 42, right: 'was 42%', level: '', resets: '' }]);
  // Codex: weekly then the session window.
  assert.deepEqual(acct.bars({ kind: 'codex', weekly: { pct: 80, resets_at: null }, secondary: { pct: 4, resets_at: null } }, NOW)
    .map((b) => [b.label, b.right]), [['weekly', '80%'], ['session', '4%']]);
});

test('trend: time-scaled points, tooltip, last sample drives the colour', () => {
  assert.equal(acct.trend([]), null);
  assert.equal(acct.trend([{ t: 1, sd: 5 }]), null, 'one point cannot make a line');
  // Non-numeric samples are dropped before the count is taken.
  assert.equal(acct.trend([{ t: 1, sd: 5 }, { t: 2, sd: null }]), null);

  const day = 86400;
  const t = acct.trend([{ t: 0, sd: 0 }, { t: day, sd: 50 }, { t: 2 * day, sd: 95 }]);
  assert.equal(t.points, '0.00,24.00 50.00,12.00 100.00,1.20');
  assert.equal(t.pct, '95%');
  assert.equal(t.level, 'red');
  assert.equal(t.title, '2 days, 3 samples');
  // Percentages outside 0-100 are clamped into the box.
  assert.equal(acct.trend([{ t: 0, sd: -10 }, { t: day, sd: 140 }]).points, '0.00,24.00 100.00,0.00');
  // Every sample in the same second would divide by zero: spread them by index.
  assert.equal(acct.trend([{ t: 5, sd: 0 }, { t: 5, sd: 100 }]).points, '0.00,24.00 100.00,0.00');
  assert.equal(acct.trend([{ t: 0, sd: 1 }, { t: 60, sd: 1 }]).title, '1 days, 2 samples');
});

test('sourceText: whose numbers are on show', () => {
  assert.equal(acct.sourceText({ source: null }), '');
  assert.equal(acct.sourceText({ source: 'oauth' }), 'live');
  assert.equal(acct.sourceText({ source: 'push' }), 'push');
  // The desktop app no longer names a row at all — no row is ever sourced from it.
  assert.equal(acct.sourceText({ source: 'desktop' }), 'desktop');
  assert.equal(acct.sourceText({ source: 'push', windows_from: 'codex' }), 'push · usage from live');
  // An unknown source shows verbatim rather than as nothing.
  assert.equal(acct.sourceText({ source: 'ssh' }), 'ssh');
  // A held live read is named in the header, the only line a collapsed card shows.
  const at = SEC(NOW);
  assert.equal(
    acct.sourceText({ source: 'oauth', hold: { state: 'rate_limited', host: 'rog-strix', note: null, at, until: at + 3600 } }),
    'live · live read throttled on rog-strix until ' + acct.hhmm(at + 3600)
  );
  assert.equal(acct.sourceText({ source: 'oauth', hold: { state: 'token_expired', host: 'mac', note: null, at, until: null } }),
    'live · live read refused on mac');
});

test('enrich: header identity, and the states the capture does not contain', () => {
  const base = { prov: 'claude' };
  const row = {
    kind: 'claude', id: 'x', host: 'german-box', updated_at: SEC(NOW - 5 * 60000), source: 'push',
    org: '8323fe6e-1111-2222-3333-444455556666', email: 'admin@deus.finance', label: 'Daniel Tabor',
    confirmed: true, tier: 'default_claude_max_20x', state: 'ok', windows: { five_hour: { pct: 12, resets_at: null } },
    seen: [{ host: 'german-box', source: 'oauth' }], history: [],
  };
  const a = acct.enrich(base, row, NOW);
  assert.equal(a.name, 'Daniel Tabor');
  assert.equal(a.id, '8323fe6e', 'the org uuid is cut to eight characters');
  assert.equal(a.plan, 'Max 20×');
  assert.equal(a.live, 'push');
  assert.equal(a.pillTone, 'green');
  // source 'push' names the push, not the host it arrived from — accounts.js:141.
  assert.equal(a.right, '5m ago · push');
  assert.equal(a.seen, 'german-box · live');
  assert.equal(a.unconfirmed, false);
  assert.equal(a.noData, false);
  assert.equal(a.noHistory, true, 'a claude row with nothing to plot says so');
  assert.equal(a.atLimit, false);

  // No source at all: no bars, one sentence.
  const none = acct.enrich(base, { kind: 'claude', host: 'h', source: null, state: 'absent', windows: {}, seen: [] }, NOW);
  assert.equal(none.noData, true);
  assert.equal(none.pillTone, '');
  assert.equal(none.right, '');
  assert.equal(none.noHistory, false, 'a row with no source has nothing to say about history');

  // A source that reported, but not cleanly: amber pill, and the fault named.
  const expired = acct.enrich(base, { kind: 'claude', host: 'gb', source: 'oauth', state: 'token_expired', windows: {}, seen: [], updated_at: SEC(NOW) }, NOW);
  assert.equal(expired.pillTone, 'amber');
  assert.equal(expired.banner, 'token expired — open Claude Code on gb');
  assert.equal(expired.bannerTone, 'notice');
  assert.equal(expired.noWindows, true, 'a claude row whose source reported no windows says so');

  const unconfirmed = acct.enrich(base, { kind: 'claude', host: 'h', source: 'oauth', state: 'ok', confirmed: false, windows: {}, seen: [] }, NOW);
  assert.equal(unconfirmed.unconfirmed, true);

  // The label falls back to the email, then to the id — accounts.js:124.
  assert.equal(acct.enrich(base, { kind: 'claude', label: '', email: 'a@b.c', id: 'i', windows: {}, seen: [] }, NOW).name, 'a@b.c');
  assert.equal(acct.enrich(base, { kind: 'claude', label: '', email: '', id: 'i', windows: {}, seen: [] }, NOW).name, 'i');
});

test('toRows: the captured credits response, most constrained first', () => {
  const rows = acct.toRows(credits, NOW, data.toAccounts);
  assert.equal(rows.length, 5);
  // seven_day_fable at 100 leads; the claude row at 96 % and the codex week at 96 %
  // tie and keep the response's own order; the row whose windows are all stale-null
  // sorts last.
  assert.deepEqual(rows.map((r) => r.name),
    ['Lafayette Tabor', 'Daniel Tabor', 'Daniel Tabor (personal · ChatGPT)', 'Reiner Garrecht', 'Aylin Yeter']);
  assert.deepEqual(rows.map((r) => r.atLimit), [true, false, false, false, false]);

  const fable = rows[0];
  assert.deepEqual(fable.bars.map((b) => [b.label, b.right, b.level]),
    [['5 hour', '29%', ''], ['7 day', '62%', ''], ['7 day Fable', '100%', 'red']]);
  // The trend is the desktop app's own samples, not the window: the last sample is 59.
  assert.equal(fable.trendPct, '59%');
  assert.equal(fable.trendLevel, '');
  assert.equal(rows[4].trendPct, '88%');
  assert.equal(rows[4].trendLevel, 'amber');
  assert.equal(fable.creditsText, '', 'the captured rows report no used/limit pair');

  // The error row keeps its bars and carries the banner.
  const errored = rows[4];
  assert.equal(errored.banner, 'could not read usage on rfc1918-internal');
  assert.deepEqual(errored.bars.map((b) => b.right), ['—', '—']);

  // Codex rows carry no sparkline at all.
  const codex = rows[2];
  assert.equal(codex.prov, 'codex');
  assert.equal(codex.trendPts, '');
  assert.equal(codex.noHistory, false);
  assert.equal(codex.plan, 'pro');
  assert.equal(codex.creditsText, '', 'has_credits is false on the captured row');

  // The summary the improvised bar shows for this response.
  assert.deepEqual(acct.summary(rows.map((r) => r.__raw)),
    ['5 accounts', '1 at or over a limit', 'no credits spent']);
});

test('toErrors: one line per collector error', () => {
  assert.deepEqual(acct.toErrors(credits), []);
  assert.deepEqual(acct.toErrors({ errors: [{ host: 'ivy-box', message: 'ssh: connect: timed out' }] }),
    ['ivy-box: ssh: connect: timed out']);
  assert.deepEqual(acct.toErrors(null), []);
});

// The Refresh popup. A forced refresh sweeps every polled machine over ssh before it merges
// the readings, and `sweep` on the machines view is what says where it has got to.
test('progressRows: one row per polled machine, tenths of a second, error truncated', () => {
  const long = 'ssh: connect to host gb-deploy port 22: ' + 'x'.repeat(40);
  const rows = acct.progressRows({
    sweep: {
      collecting: true,
      machines: [
        { id: 'german-box', label: 'German Box', status: 'error', ms: 25150, error: long },
        { id: 'vps', label: 'VPS', status: 'ok', ms: 940, error: null },
        { id: 'macbook', label: null, status: 'pending', ms: 3000, error: null },
      ],
    },
  });
  assert.deepEqual(rows.map((r) => r.status), ['error', 'ok', 'pending']);
  assert.deepEqual(rows.map((r) => r.secs), [25.2, 0.9, 3]);
  // A missing label still names the machine, never an empty row.
  assert.equal(rows[2].label, 'macbook');
  assert.equal(rows[0].error.length, 60);
  assert.ok(rows[0].error.endsWith('…'));
  assert.equal(rows[1].error, '');
  // Nothing to show before the first poll lands, and an unknown status is not "done".
  assert.deepEqual(acct.progressRows(null), []);
  assert.deepEqual(acct.progressRows({ sweep: { machines: [{ id: 'x', ms: 0 }] } }),
    [{ id: 'x', label: 'x', status: 'pending', secs: 0, error: '' }]);
});

test('progressSummary: the one line the popup closes on', () => {
  const row = (status) => ({ status });
  assert.equal(acct.progressSummary([row('ok'), row('ok'), row('ok'), row('error')]),
    '4 machines · 3 ok · 1 failed');
  assert.equal(acct.progressSummary([row('ok'), row('ok')]), '2 machines · 2 ok');
  assert.equal(acct.progressSummary([row('ok')]), '1 machine · 1 ok');
  assert.equal(acct.progressSummary([]), 'no machines polled');
});

test('accountLines — every proved login, live or with the collector\'s own reason it was not read', () => {
  const view = { machines: [
    { id: 'german-box', label: 'german-box', clients: [
      { client: 'claude_cli', proof: 'profile', email: 'lafayette@infinite-holdings.llc' },
      { client: 'claude_cli', proof: 'config', email: 'admin@deus.finance' },
      { client: 'codex_cli', proof: 'jwt', email: 'admin@deus.finance' },
    ] },
    { id: 'rog-strix', label: 'ROG Strix', clients: [
      { client: 'claude_cli', proof: 'profile', email: 'aylianator@gmail.com', note: 'usage call skipped, endpoint asked for a 3210s pause' },
      { client: 'claude_cli', proof: 'profile', email: 'x@y.z', note: 'token refreshed' },
    ] },
  ] };
  assert.deepStrictEqual(acct.accountLines(view), [
    { email: 'lafayette@infinite-holdings.llc', host: 'german-box', status: 'live', text: 'usage read live' },
    { email: 'aylianator@gmail.com', host: 'ROG Strix', status: 'held', text: 'usage call skipped, endpoint asked for a 3210s pause' },
    { email: 'x@y.z', host: 'ROG Strix', status: 'live', text: 'usage read live' },
  ]);
  assert.deepStrictEqual(acct.accountLines({}), []);
  const rows = [{ status: 'ok' }, { status: 'ok' }];
  assert.equal(acct.progressSummary(rows, acct.accountLines(view)), '2 machines · 2 ok · 2 accounts read live · 1 not read');
  assert.equal(acct.progressSummary(rows), '2 machines · 2 ok');
});

// The usage-call log below the cards: the three shapes a stored call can have, and the
// text each reads as. hhmm is local time, so the expected stamp is built the same way
// rather than hard-coded to one timezone.
test('usageLogLines — a read that answered, one refused, one the deck did not make', () => {
  const t = 1788739000;
  const at = (e) => {
    const d = new Date(e * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  const payload = { usage_log: [
    { t, host: 'german-box', email: 'lafayette@infinite-holdings.llc', code: 200, retry_after: null,
      pause: null, skipped: null, state: 'ok', note: null, fh: 12, sd: 57, sf: 100 },
    { t: t - 60, host: 'rog-strix', email: 'aylianator@gmail.com', code: 429, retry_after: 216,
      pause: 600, skipped: null, state: 'rate_limited', note: 'usage call refused with HTTP 429, pausing 600s (3rd refusal)',
      fh: null, sd: null, sf: null },
    { t: t - 120, host: 'mac', email: 'admin@deus.finance', code: 429, retry_after: null, pause: null,
      skipped: 'backoff', state: 'rate_limited', note: 'usage call skipped, endpoint asked for a 3210s pause',
      fh: null, sd: null, sf: null },
    // A box whose clock runs ahead would otherwise pin its lines to the top forever.
    { t: t + 3600, host: 'skewed', email: 'x@y.z', state: 'ok', code: 200 },
  ] };

  assert.deepStrictEqual(acct.usageLogLines(payload, t + 5), [
    { time: at(t), host: 'german-box', email: 'lafayette@infinite-holdings.llc',
      text: '200 · 5h 12% · 7d 57% · Fable 100%', tone: 'ok' },
    { time: at(t - 60), host: 'rog-strix', email: 'aylianator@gmail.com',
      text: 'HTTP 429 · retry-after 216s · paused 600s (3rd refusal)', tone: 'bad' },
    { time: at(t - 120), host: 'mac', email: 'admin@deus.finance',
      text: 'skipped · usage call skipped, endpoint asked for a 3210s pause', tone: 'muted' },
  ]);
  assert.deepStrictEqual(acct.usageLogLines({}, t), []);
});
