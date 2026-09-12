// The Credits merge: which machine's word about an account stands when machines disagree.
// The collect path is driven with canned collector lines (FLEET_CREDITS_SH), never a token.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, hostsFile } = require('./helpers');
const { startServer } = require('./http');

const iso = (t) => new Date(t * 1000).toISOString();
const usage = (pct, now) => ({
  five_hour: { utilization: pct, resets_at: iso(now + 3600) },
  seven_day: { utilization: 0, resets_at: iso(now + 86400) },
});
const sample = (org, fh, t) => ({ org, t: t * 1000, u: { fh, sd: 20 } });
const ACCOUNTS = [{ org: 'org-a', email: 'a@x.test' }, { org: 'org-b', email: 'b@x.test' }];

test('a machine whose CLI moved to another account releases the row it held', async () => {
  const dir = tmpdir('credits');
  const state = path.join(dir, 'line.json');
  const sh = path.join(dir, 'collector.sh');
  fs.writeFileSync(sh, '#!/bin/sh\ncat ' + state + '\n');
  const s = await startServer({ FLEET_CREDITS_SH: sh, FLEET_HOSTS_FILE: hostsFile(dir, []) }, { dir });
  const now = Math.floor(Date.now() / 1000);
  const collect = async (line) => {
    fs.writeFileSync(state, JSON.stringify(line) + '\n');
    const r = await s.get('/api/credits?refresh=1');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.errors, []);
    return Object.fromEntries(r.body.rows.map((row) => [row.id, row]));
  };
  try {
    // The bug as stored: the Mac's token was really a@'s, but the line filed the live 4%
    // under b@ — who the desktop app, on the same machine, had just sampled at 93%.
    let rows = await collect({
      host: 'mac', ts: now - 4, accounts: ACCOUNTS,
      claude: { email: 'b@x.test', org: 'org-b', state: 'ok', usage: usage(4, now) },
      desktop: [sample('org-b', 93, now - 60)],
    });
    assert.equal(rows['b@x.test'].source, 'oauth');
    assert.equal(rows['b@x.test'].windows.five_hour.pct, 4);

    // The fixed collector names the token's own account. The Mac no longer backs its live
    // claim about b@, so b@ falls back to the desktop sample right away — not in 12 hours.
    rows = await collect({
      host: 'mac', ts: now - 3, accounts: ACCOUNTS,
      claude: { email: 'a@x.test', org: 'org-a', state: 'ok', usage: usage(4, now) },
      desktop: [sample('org-b', 93, now - 60), sample('org-a', 4, now - 60)],
    });
    assert.equal(rows['b@x.test'].source, 'desktop');
    assert.equal(rows['b@x.test'].windows.five_hour.pct, 93);
    assert.equal(rows['a@x.test'].source, 'oauth');
    assert.equal(rows['a@x.test'].windows.five_hour.pct, 4);

    // Rank still holds against a machine not heard from: a box's desktop sample of a@ does
    // not displace the Mac's fresh live read.
    rows = await collect({ host: 'box', ts: now - 2, desktop: [sample('org-a', 50, now - 30)] });
    assert.equal(rows['a@x.test'].source, 'oauth');
    assert.equal(rows['a@x.test'].windows.five_hour.pct, 4);

    // Between two desktop samples the newer sample wins, whichever collect ran last.
    rows = await collect({ host: 'box', ts: now - 1, desktop: [sample('org-b', 50, now - 600)] });
    assert.equal(rows['b@x.test'].windows.five_hour.pct, 93);
    rows = await collect({ host: 'box', ts: now, desktop: [sample('org-b', 95, now - 10)] });
    assert.equal(rows['b@x.test'].windows.five_hour.pct, 95);
    assert.equal(rows['b@x.test'].host, 'box');
  } finally {
    await s.stop();
  }
});
