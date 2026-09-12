// creditsWrite(): which of several machines' reports of one account gets stored. Driven
// straight, no collect and no ssh — the rows are what creditsCandidates() would have built.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { tmpdir, hostsFile, load, unload } = require('./helpers');

const ORG = 'd24c4827-df47-40e3-af74-574418a03a4b'; // Aylin Yeter in credits-accounts.json
const EMAIL = 'aylianator@gmail.com';
const NOW = 1757000000;

function seams(t) {
  const dir = tmpdir('credits-seams');
  const m = load({ FLEET_DB: path.join(dir, 'fleet.db'), FLEET_HOSTS_FILE: hostsFile(dir) });
  t.after(async () => {
    await unload(m);
    delete process.env.FLEET_NO_LISTEN;
  });
  return m;
}

const stored = (db) => JSON.parse(db.prepare('SELECT payload FROM credits WHERE kind = ? AND id = ?').get('claude', EMAIL).payload);

const desktop = (host, updated_at, sample_ts, windows) => ({
  kind: 'claude', id: EMAIL, email: EMAIL, org: ORG, host, updated_at, source: 'desktop', state: 'ok',
  confirmed: false, sample_ts, windows,
});

test('creditsWrite — the freshest desktop sample wins, not the machine whose reply landed last', (t) => {
  const { creditsWrite, db } = seams(t);
  // The Mac's app is where the account is live: sampled ten minutes ago. The german box's
  // app last saw this org two weeks ago and relays that sample on every collect, and its
  // ssh reply happens to land a second after the Mac's.
  const fresh = desktop('rfc1918-internal', NOW - 1, NOW - 600, { five_hour: { pct: 22, resets_at: null }, seven_day: { pct: 68, resets_at: null } });
  const stale = desktop('DESKTOP-LJMEJQN', NOW, NOW - 14 * 86400, { five_hour: { pct: 0, resets_at: null }, seven_day: { pct: 100, resets_at: null } });
  assert.equal(creditsWrite([fresh, stale]), 1);
  let r = stored(db);
  assert.equal(r.host, 'rfc1918-internal');
  assert.equal(r.sample_ts, NOW - 600);
  assert.equal(r.windows.seven_day.pct, 68);
  // Both reporters are still listed: the row's provenance is every machine, not the winner.
  assert.deepEqual(r.seen.map((s) => s.host).sort(), ['DESKTOP-LJMEJQN', 'rfc1918-internal']);

  // Order of arrival must not matter either.
  creditsWrite([stale, fresh]);
  assert.equal(stored(db).sample_ts, NOW - 600);

  // The next collect carries only the stale relay (the Mac is asleep): it must not displace
  // the fresher reading already stored, however new its relay stamp.
  creditsWrite([desktop('DESKTOP-LJMEJQN', NOW + 60, NOW - 14 * 86400, stale.windows)]);
  r = stored(db);
  assert.equal(r.sample_ts, NOW - 600);
  assert.equal(r.host, 'rfc1918-internal');
});

test('creditsWrite — a stale desktop sample relayed today does not outrank a live read from this morning', (t) => {
  const { creditsWrite, db } = seams(t);
  const live = {
    kind: 'claude', id: EMAIL, email: EMAIL, org: ORG, host: 'rfc1918-internal', updated_at: NOW - 13 * 3600,
    source: 'oauth', state: 'ok', confirmed: true,
    windows: { five_hour: { pct: 3, resets_at: NOW - 12 * 3600 }, seven_day: { pct: 41, resets_at: NOW + 86400 } },
  };
  creditsWrite([live]);
  // Thirteen hours is past RANK_STALE, so a weaker source that is actually fresher may take
  // over — but a two-week-old sample is not fresher, whatever its relay stamp says.
  creditsWrite([desktop('DESKTOP-LJMEJQN', NOW, NOW - 14 * 86400, { seven_day: { pct: 100, resets_at: null } })]);
  assert.equal(stored(db).source, 'oauth');
  // A desktop sample taken just now does take over from the thirteen-hour-old live read.
  creditsWrite([desktop('rfc1918-internal', NOW, NOW - 60, { seven_day: { pct: 68, resets_at: null } })]);
  const r = stored(db);
  assert.equal(r.source, 'desktop');
  assert.equal(r.windows.seven_day.pct, 68);
});
