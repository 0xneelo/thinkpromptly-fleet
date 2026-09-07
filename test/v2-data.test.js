// L1 acceptance: the v2 data layer must call exactly what the current app calls, and
// its adapters must produce exactly the shapes the design mock's seed arrays have.
// Adapters run against the responses captured from the live deck on 2026-09-07
// (docs/design/fleetdeck-v2/fixtures/api/) and are compared, key by key and in
// order, against the mock seeds. Those live in two generated files: S2's
// public/v2/fixture.js (the seeds its compiler substituted into the template) and
// public/v2/fixture-extract.js (the rest). No key is defined in both.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer } = require('./http');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');

const data = require(path.join(ROOT, 'public/v2/data.js'));
const router = require(path.join(ROOT, 'public/v2/router.js'));
// S2's fixture.js is a browser script, so load it the way the page does — into the
// real global as window.FD.fixture. data.js then finds it exactly as it would in a
// browser, and the precedence under test is the shipping one.
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'public/v2/fixture.js'), 'utf8'));
const s2Fixture = globalThis.FD.fixture;
const extract = require(path.join(ROOT, 'public/v2/fixture-extract.js'));
// Every seed, whichever file owns it — what the adapters are compared against.
const mock = Object.assign({}, extract, s2Fixture);

const api = (name) => JSON.parse(fs.readFileSync(path.join(API, name + '.json'), 'utf8'));

// Fixed clock so the humanised timestamps the adapters produce are deterministic.
const NOW = Date.parse('2026-09-07T00:00:00Z');

const keys = (o) => Object.keys(o);

// Records what the fetchers ask for, and answers with whatever the test wants.
function stubFetch(reply) {
  const calls = [];
  data._fetch = async (url, init) => {
    calls.push({ url, init });
    return reply || { ok: true, status: 200, json: async () => ({}) };
  };
  return calls;
}

test.afterEach(() => {
  delete data._fetch;
  delete globalThis.localStorage;
  delete globalThis.location;
  delete globalThis.history;
  // document too: a failed assertion inside a visibility test must not leave a
  // fake document behind for every later test in this file.
  delete globalThis.document;
});

// ---------------------------------------------------------------------------
// Fetchers — every URL, method and body is the current app's, unchanged.
// ---------------------------------------------------------------------------

test('every GET fetcher calls the URL the current app calls', async () => {
  const cases = [
    ['sessions', [], '/api/sessions'],
    ['health', [], '/api/health'],
    ['credits', [], '/api/credits'],
    ['credits', [{ refresh: true }], '/api/credits?refresh=1'],
    ['seats', [], '/api/seats'],
    ['messages', [], '/api/messages?limit=50'],
    ['messages', [{ limit: 7 }], '/api/messages?limit=7'],
    ['sshkeys', [], '/api/sshkeys'],
    ['ghtrain', [], '/api/ghtrain'],
    ['machines', [], '/api/machines'],
    ['machines', [{ refresh: true }], '/api/machines?refresh=1'],
    ['desktopSessions', [], '/api/desktop-sessions'],
    ['desktopSessions', [{ refresh: 1 }], '/api/desktop-sessions?refresh=1'],
  ];
  for (const [fn, args, url] of cases) {
    const calls = stubFetch();
    await data[fn](...args);
    assert.strictEqual(calls.length, 1, fn + ' made one request');
    assert.strictEqual(calls[0].url, url, fn + ' URL');
    assert.strictEqual(calls[0].init, undefined, fn + ' is a plain GET');
  }
});

test('a refresh-less call has no trailing question mark', async () => {
  // accounts.js:239 builds '/api/credits' + (force ? '?refresh=1' : ''), so an
  // unrefreshed call must not send '/api/credits?'.
  for (const [fn, url] of [['credits', '/api/credits'], ['machines', '/api/machines'], ['desktopSessions', '/api/desktop-sessions']]) {
    const calls = stubFetch();
    await data[fn]();
    assert.strictEqual(calls[0].url, url);
    await data[fn]({ refresh: false });
    assert.strictEqual(calls[1].url, url);
  }
});

test('every POST fetcher sends the current app\'s body and header', async () => {
  const cases = [
    ['sendMessage', [{ source: 'ui', target: { type: 'tmux' }, text: 'hi' }], '/api/messages', { source: 'ui', target: { type: 'tmux' }, text: 'hi' }],
    ['retryMessage', ['m1'], '/api/messages/retry', { id: 'm1' }],
    ['registryUpsert', [{ host: 'h', name: 'n', role: 'r' }], '/api/registry', { host: 'h', name: 'n', role: 'r' }],
    ['registryDelete', [{ host: 'h', name: 'n', extra: 'dropped' }], '/api/registry/delete', { host: 'h', name: 'n' }],
    ['kill', [{ host: 'h', name: 'n', extra: 'dropped' }], '/api/kill', { host: 'h', name: 'n' }],
    ['mintCert', [{ ttl: '4h', principals: 'root,vibe' }], '/api/sshkeys/mint', { ttl: '4h', principals: 'root,vibe' }],
    ['deleteKey', [{ dir: '/tmp/cert' }], '/api/sshkeys/delete', { dir: '/tmp/cert' }],
    ['startTrain', [{ ttl: '1h' }], '/api/ghtrain', { ttl: '1h' }],
    ['endTrain', [], '/api/ghtrain/end', {}],
  ];
  for (const [fn, args, url, body] of cases) {
    const calls = stubFetch();
    await data[fn](...args);
    assert.strictEqual(calls[0].url, url, fn + ' URL');
    assert.strictEqual(calls[0].init.method, 'POST', fn + ' method');
    // app.js:423-428 and keys.js:174-181 both send the lowercase header name.
    assert.deepStrictEqual(calls[0].init.headers, { 'content-type': 'application/json' }, fn + ' header');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), body, fn + ' body');
  }
});

test('registryDelete and kill narrow the row to host and name', async () => {
  // app.js:522/561 send only these two fields even when handed a whole row.
  const calls = stubFetch();
  await data.kill({ host: 'h', name: 'n', status: 'active', label: 'x' });
  assert.deepStrictEqual(Object.keys(JSON.parse(calls[0].init.body)), ['host', 'name']);
});

test('transcript reads text, not JSON', async () => {
  data._fetch = async () => ({ ok: true, status: 200, text: async () => 'line one\nline two' });
  const out = await data.transcript({ machine: 'm', account: 'a', org: 'o', id: 'i' });
  assert.strictEqual(out, 'line one\nline two');
});

test('transcript builds the same query string sessions.js does', async () => {
  const calls = stubFetch({ ok: true, status: 200, text: async () => '' });
  await data.transcript({ machine: 'macbook', account: 'a1', org: 'o1', id: 's1' });
  assert.strictEqual(
    calls[0].url,
    '/api/desktop-sessions/transcript?machine=macbook&account=a1&org=o1&id=s1'
  );
});

test('no fetcher targets anything but the page origin', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/v2/data.js'), 'utf8');
  assert.strictEqual(/https?:\/\//.test(src.replace(/^\s*\/\/.*$/gm, '')), false, 'no absolute URLs outside comments');
});

// ---------------------------------------------------------------------------
// Error contract: reject with {status, body}, never swallow, never mask.
// ---------------------------------------------------------------------------

test('a non-2xx rejects with the status and the parsed body', async () => {
  data._fetch = async () => ({ ok: false, status: 500, text: async () => '{"error":"boom"}' });
  await assert.rejects(data.sessions(), (err) => {
    assert.strictEqual(err.status, 500);
    assert.deepStrictEqual(err.body, { error: 'boom' });
    return true;
  });
});

test('a non-2xx with a non-JSON body keeps the raw text', async () => {
  data._fetch = async () => ({ ok: false, status: 404, text: async () => 'not found' });
  await assert.rejects(data.sessions(), (err) => {
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.body, 'not found');
    return true;
  });
});

test('a response with no readable body still rejects with the status', async () => {
  // A minimal response double, or a polyfill that returns a bare object on a
  // network failure, has no .text — reading it must not mask the status.
  data._fetch = async () => ({ ok: false, status: 502 });
  await assert.rejects(data.sessions(), (err) => {
    assert.strictEqual(err.status, 502);
    assert.strictEqual(err.body, '');
    return true;
  });
});

test('a 2xx whose body will not parse rejects with the same shape', async () => {
  data._fetch = async () => ({ ok: true, status: 200, text: async () => 'not json' });
  await assert.rejects(data.sessions(), (err) => {
    assert.strictEqual(err.status, 200);
    assert.strictEqual(err.body, 'not json');
    return true;
  });
});

test('nothing resolves on a failed request', async () => {
  data._fetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  let resolved = false;
  await data.health().then(() => { resolved = true; }, () => {});
  assert.strictEqual(resolved, false);
});

// ---------------------------------------------------------------------------
// Adapters vs the mock seed shapes. Same keys, same order, same types.
// ---------------------------------------------------------------------------

// Compares one adapter row against one mock row: identical key list in identical
// order, and matching value types (null is allowed anywhere the API cannot supply).
// Arrays are walked one level into their first element rather than merely
// type-checked, because a shallow check hides real structural bugs — duplicated
// columns, a dropped chip, a tuple that grew an element.
function assertShape(label, mockRow, gotRow, depth = 2) {
  assert.deepStrictEqual(keys(gotRow), keys(mockRow), label + ' key list and order');
  for (const k of keys(mockRow)) {
    const want = mockRow[k];
    const got = gotRow[k];
    if (got === null) continue; // documented gap, improvised.md I-L1-05
    if (Array.isArray(want)) {
      assert.ok(Array.isArray(got), label + '.' + k + ' is an array');
      if (depth > 0 && want.length && got.length) assertElement(label + '.' + k + '[0]', want[0], got[0], depth - 1);
    } else {
      assert.strictEqual(typeof got, typeof want, label + '.' + k + ' type');
    }
  }
}

// One array element: a positional tuple is compared by length and element types,
// an object by assertShape, a scalar by type.
function assertElement(label, want, got, depth) {
  if (Array.isArray(want)) {
    assert.ok(Array.isArray(got), label + ' is a tuple');
    assert.strictEqual(got.length, want.length, label + ' tuple length');
    return;
  }
  if (want && typeof want === 'object') {
    assertShape(label, want, got, depth);
    return;
  }
  assert.strictEqual(typeof got, typeof want, label + ' type');
}

test('toTiles matches the mock tiles shape', () => {
  const out = data.toTiles(api('sessions'));
  assert.ok(out.length > 0);
  assertShape('tiles', mock.tiles[0], out[0]);
  assert.ok(out.every((t) => t.foot1 === null && t.foot2 === null), 'footer is L3 (I-L1-05)');
});

test('toGroups matches the mock groups shape and keeps the items key', () => {
  const out = data.toGroups(api('sessions'));
  assertShape('groups', mock.groups[0], out[0]);
  // I-L1-03: the mock says items; the binding map's `sessions[]` is a ledger slip.
  assert.ok('items' in out[0] && !('sessions' in out[0]));
  assert.strictEqual(out[0].n, out[0].items.length);
});

test('toGroups keeps hosts in first-appearance order', () => {
  const out = data.toGroups({ sessions: [
    { host: 'b', name: 's1', live: true },
    { host: 'a', name: 's2', live: true },
    { host: 'b', name: 's3', live: true },
  ] });
  assert.deepStrictEqual(out.map((g) => g.box), ['b', 'a']);
  assert.deepStrictEqual(out[0].items.map((i) => i.n), ['s1', 's3']);
});

test('toRegistryRows matches the mock regData shape', () => {
  const out = data.toRegistryRows(api('sessions'), NOW);
  assertShape('regData', mock.regData[0], out.find((r) => !r.gone));
});

test('toRegistryRows marks gone rows the way the mock does', () => {
  const goneMock = mock.regData.find((r) => r.gone);
  const out = data.toRegistryRows({ sessions: [
    { host: 'h', name: 'n', group: 'g', task: 't', status: 'active', live: false },
    { host: 'h', name: 'm', group: 'g', task: 't', status: 'active', live: true },
  ] }, NOW);
  assertShape('regData gone', goneMock, out[0]);
  assert.strictEqual(out[0].gone, true);
  // The mock omits `gone` on live rows rather than setting it false.
  assert.ok(!('gone' in out[1]));
});

test('toRegistryRows fills empty group and task with the mock dash', () => {
  const out = data.toRegistryRows({ sessions: [{ host: 'h', name: 'n', group: '', task: null, status: 'x', live: true }] }, NOW);
  assert.strictEqual(out[0].g, '—');
  assert.strictEqual(out[0].tk, '—');
});

test('toOrg wraps buildTree and exposes the mock scope and card shapes', () => {
  const out = data.toOrg(api('sessions'), api('seats'), NOW);
  assert.deepStrictEqual(keys(out), ['roots', 'unattached', 'scope', 'cards']);
  assert.ok(Array.isArray(out.roots) && Array.isArray(out.unattached));
  assert.deepStrictEqual(keys(out.scope), keys(mock.orgScopeData));
  // Scope tuples are [name, role, path] and gain a 4th `false` only when not live.
  const tuple = Object.values(out.scope.machine)[0][0];
  assert.ok(tuple.length === 3 || tuple.length === 4);
  assert.strictEqual(typeof tuple[0], 'string');
  if (tuple.length === 4) assert.strictEqual(tuple[3], false);
  // The binding map names orgCard()'s arguments, not its returned keys.
  assert.deepStrictEqual(keys(out.cards[0]), ['name', 'on', 'role', 'path', 'grp', 'epoch', 'lease', 'age', 'exp']);
});

test('toOrg agrees with FleetOrgChart.buildTree directly', () => {
  const orgchart = require(path.join(ROOT, 'public/v2/orgchart.js'));
  const sessions = api('sessions');
  const seats = api('seats');
  const direct = orgchart.buildTree(sessions.sessions, seats.seats);
  const out = data.toOrg(sessions, seats, NOW);
  assert.deepStrictEqual(out.roots, direct.roots);
  assert.deepStrictEqual(out.unattached, direct.unattached);
});

test('public/v2/orgchart.js is a byte-identical copy of public/orgchart.js', () => {
  assert.deepStrictEqual(
    fs.readFileSync(path.join(ROOT, 'public/v2/orgchart.js')),
    fs.readFileSync(path.join(ROOT, 'public/orgchart.js'))
  );
});

test('toThreads matches the mock bus shapes', () => {
  const out = data.toThreads(api('messages'), NOW);
  assert.deepStrictEqual(keys(out), ['busSessions', 'busGroups', 'threads']);
  // pinned is client-side (I-L1-05), so compare against a mock row without it.
  assertShape('busSessions', mock.busSessions.find((s) => !('pinned' in s)), out.busSessions[0]);
  assert.deepStrictEqual(out.busGroups, []);
});

test('thread messages keep the mock key order per direction', () => {
  const out = data.toThreads(api('messages'), NOW);
  const all = Object.values(out.threads).flat();
  const outbound = all.find((m) => m.dir === 'out');
  const inbound = all.find((m) => m.dir === 'in');
  assert.ok(outbound && inbound, 'the capture has both directions');
  assert.deepStrictEqual(keys(outbound), keys(mock.seedThreads.ermenhild[0]));
  // Inbound carries no status key at all — the template tests presence (I-L1-06).
  assert.deepStrictEqual(keys(inbound), keys(mock.seedThreads.christa[1]));
  assert.ok(!('status' in inbound));
  assert.strictEqual(typeof outbound.m, 'number');
});

test('a failed message carries err immediately before text', () => {
  const out = data.toThreads({ messages: [{
    id: 'f1', source: 'fleetdeck-ui', target: { type: 'tmux', host: 'h', session: 'sess' },
    status: 'failed', error: 'pane not accepting input', text: 'hello',
    created_at: '2026-09-06T23:50:00.000Z',
  }] }, NOW);
  const msg = out.threads.sess[0];
  assert.deepStrictEqual(keys(msg), keys(mock.seedThreads.frowin[0]));
  assert.strictEqual(msg.err, 'pane not accepting input');
});

test('a broadcast carries per instead of status', () => {
  const out = data.toThreads({ messages: [{
    id: 'b1', source: 'claude-desktop',
    target: { type: 'tmux', host: 'h', session: 'grp', sessions: ['a', 'b'] },
    status: 'delivered', error: null, text: 'all hands',
    created_at: '2026-09-06T23:50:00.000Z',
  }] }, NOW);
  const msg = out.threads.grp[0];
  assert.deepStrictEqual(keys(msg), keys(mock.seedThreads['b-train84'][0]));
  assert.deepStrictEqual(msg.per, { a: 'delivered', b: 'delivered' });
  assert.ok(!('status' in msg));
});

test('an outbound message to a target with no host still threads', () => {
  // The capture only has outbound-to-tmux and inbound; a claude-desktop target
  // carries no host, and the mock's busSessions allow that.
  const out = data.toThreads({ messages: [{
    id: 'd1', source: 'fleetdeck-ui', target: { type: 'claude-desktop', session: 'ORCHESTRATOR 28' },
    status: 'delivered', error: null, text: 'hi',
    created_at: '2026-09-06T23:50:00.000Z',
  }] }, NOW);
  assert.deepStrictEqual(out.busSessions[0], {
    id: 'ORCHESTRATOR 28', name: 'ORCHESTRATOR 28', host: null, live: null,
  });
  assert.strictEqual(out.threads['ORCHESTRATOR 28'][0].dir, 'out');
});

test('toKeys does not hand back the response\'s own certs array', () => {
  const res = api('sshkeys');
  const out = data.toKeys(res, api('ghtrain'));
  assert.notStrictEqual(out.certs, res.certs, 'certs is copied, not aliased');
  assert.deepStrictEqual(out.certs, res.certs);
});

test('toKeys matches the mock keyRows shape', () => {
  const out = data.toKeys(api('sshkeys'), api('ghtrain'));
  assert.deepStrictEqual(keys(out), ['keyRows', 'certs', 'train']);
  assertShape('keyRows', mock.keyRows[0], out.keyRows[0]);
  assert.deepStrictEqual(out.train, api('ghtrain'));
});

test('toAccounts matches the mock accounts shape', () => {
  const out = data.toAccounts(api('credits'), NOW);
  // accounts[0] is the mock's base key set; the rows with history add trendPct,
  // which is derived from trendPts and belongs to the template (I-L1-11).
  assert.deepStrictEqual(keys(out[0]), keys(mock.accounts[0]), 'accounts key list and order');
  assert.ok(out.every((a) => Array.isArray(a.bars)));
  // The mock's own empty-history sentinel is '' (accounts[0]); the pack's
  // convention for absent data is null. Both are falsy, so the template's
  // showTrend test behaves the same either way (I-L1-11).
  assert.ok(out.every((a) => a.trendPts === null || Array.isArray(a.trendPts)));
  assert.ok(out.every((a) => !('trendPct' in a)), 'trendPct is derived, not adapted');
});

test('toAccounts uses the mock label forms, not the raw API enums', () => {
  const out = data.toAccounts(api('credits'), NOW);
  const claude = out.find((a) => a.prov === 'claude');
  const codex = out.find((a) => a.prov === 'codex');
  // The API reports tier 'default_claude_max_20x'; the mock shows 'Max 20×'.
  assert.strictEqual(claude.plan, 'Max 20×', 'tier is humanised (I-L1-12)');
  assert.strictEqual(codex.plan, 'pro', 'a readable plan passes through');
  // The mock shows the first 8 hex of the org uuid, not the whole thing.
  assert.strictEqual(claude.id.length, 8);
  assert.ok(mock.accounts.some((a) => a.id === claude.id), 'the sliced id is a form the mock uses');
});

test('toAccounts writes a sentence banner, not the state enum', () => {
  const out = data.toAccounts(api('credits'), NOW);
  const failed = out.find((a) => 'banner' in a);
  assert.ok(failed, 'the capture has a row that could not be read');
  assert.notStrictEqual(failed.banner, 'error', 'the raw enum must not reach the screen');
  assert.match(failed.banner, /could not read usage on /);
  // The server's own message wins when errors[] names the row.
  const withError = data.toAccounts({
    rows: [{ kind: 'claude', id: 'x', host: 'h', label: 'L', email: 'e', state: 'error' }],
    errors: [{ host: 'h', message: 'ssh timed out' }],
  }, NOW);
  assert.strictEqual(withError[0].banner, 'ssh timed out');
});

test('toAccounts key set stays the mock base set for every real row', () => {
  const out = data.toAccounts(api('credits'), NOW);
  const base = keys(mock.accounts[0]);
  for (const acct of out) {
    // staleNote and banner are the only additions the mock ever makes.
    const extra = keys(acct).filter((k) => !base.includes(k));
    assert.deepStrictEqual(extra.filter((k) => k !== 'staleNote' && k !== 'banner'), [], 'no unexpected keys');
  }
});

test('toAccounts bars match the mock bar shape', () => {
  const out = data.toAccounts(api('credits'), NOW);
  const bar = out.flatMap((a) => a.bars).find((b) => b.pct !== null);
  assert.ok(bar, 'at least one window reports a percentage');
  const mockBar = mock.accounts.flatMap((a) => a.bars || []).find(Boolean);
  assert.deepStrictEqual(keys(bar), keys(mockBar));
});

test('toAccounts passes the usage history through as raw numbers', () => {
  // O6 assumed no server-side history; /api/credits actually returns some.
  const out = data.toAccounts(api('credits'), NOW);
  assert.ok(out.some((a) => Array.isArray(a.trendPts)), 'history survives');
  assert.ok(out.every((a) => a.trendPts === null || Array.isArray(a.trendPts)));
});

test('toMachines matches the mock machines shape', () => {
  const out = data.toMachines(api('machines'), NOW);
  assertShape('machines', mock.machines[0], out[0]);
  const section = out.flatMap((m) => m.cols).flatMap((c) => c.sections)[0];
  assertShape('machines.section', mock.machines[0].cols[0].sections[0], section);
  assert.strictEqual(typeof out[0].sessions, 'string', 'sessions is a string in the mock');
});

test('toMachines groups a two-environment machine the way the mock does', () => {
  // german-box reports every client twice, once per environment. The mock puts
  // those in ONE column with two sections; a 1:1 map would double the columns.
  const out = data.toMachines(api('machines'), NOW);
  const gb = out.find((m) => m.name === 'german-box');
  const mockGb = mock.machines[1];
  assert.strictEqual(gb.cols.length, mockGb.cols.length, 'column count matches the mock');
  assert.deepStrictEqual(
    gb.cols.map((c) => c.sections.length),
    mockGb.cols.map((c) => c.sections.length),
    'sections per column match the mock'
  );
  assert.deepStrictEqual(gb.cols.map((c) => c.client), mockGb.cols.map((c) => c.client));
  // Each column's sections are the distinct environments, labelled as the mock labels them.
  assert.deepStrictEqual(gb.cols[0].sections.map((s) => s.env), ['WSL', 'Windows']);
  // A single-environment machine leaves env empty, as the mock does.
  assert.ok(out.find((m) => m.name === 'MacBook Pro').cols.every((c) => c.sections.every((s) => s.env === '')));
});

test('toMachines carries the plan family and the tier label as separate chips', () => {
  const out = data.toMachines(api('machines'), NOW);
  const gb = out.find((m) => m.name === 'german-box');
  const chips = gb.cols[0].sections[0].chips;
  assert.deepStrictEqual(chips[0], ['claude_max', 'neutral'], 'plan family chip');
  assert.deepStrictEqual(chips[1], ['Max 20×', 'neutral'], 'human tier chip (I-L1-12)');
  assert.ok(chips.every((c) => c.length === 2), 'chips are [text, tone] tuples');
});

test('toMachines bar tuples are 2 long unless the window is stale', () => {
  const out = data.toMachines(api('machines'), NOW);
  const bars = out.flatMap((m) => m.cols).flatMap((c) => c.sections).flatMap((s) => s.bars);
  assert.ok(bars.length > 0);
  for (const bar of bars) {
    assert.ok(bar.length === 2 || bar.length === 3, 'a bar is [label, pct] or [label, pct, true]');
    if (bar.length === 3) assert.strictEqual(bar[2], true, 'the third element only marks stale');
  }
  // The mock uses both widths, so the adapter must too.
  assert.deepStrictEqual(
    [...new Set(bars.map((b) => b.length))].sort(),
    [...new Set(mock.machines.flatMap((m) => m.cols).flatMap((c) => c.sections).flatMap((s) => s.bars).map((b) => b.length))].sort()
  );
});

test('toDesktop matches the mock dsData shape and pins Live now first', () => {
  const out = data.toDesktop(api('desktop-sessions'), NOW);
  assert.strictEqual(out[0].name, 'Live now');
  assertShape('dsData', mock.dsData[0], out[1]);
  assertShape('dsData.row', mock.dsData[0].rows[0], out[1].rows[0]);
});

test('toDesktop skips archived sessions and keeps created as raw ISO', () => {
  const out = data.toDesktop({ groups: [{
    accountUuid: 'abcdef0123', orgUuid: 'o', machine: 'm', label: 'L', email: 'e',
    sessions: [
      { id: 'a', title: 't', cwd: '/c', branch: 'b', model: 'm', createdAt: '2026-09-06T13:49:10.097Z', lastActivityAt: '2026-09-06T23:00:00.000Z', completedTurns: 3, cliSessionId: 'cli', isArchived: true },
      { id: 'b', title: 't', cwd: '/c', branch: 'b', model: 'm', createdAt: '2026-09-06T13:49:10.097Z', lastActivityAt: '2026-09-06T23:00:00.000Z', completedTurns: 3, cliSessionId: 'cli', isArchived: false },
    ],
  }] }, NOW);
  const person = out[1];
  assert.strictEqual(person.rows.length, 1, 'archived row dropped');
  assert.strictEqual(person.rows[0].created, '2026-09-06T13:49:10.097Z');
  assert.strictEqual(person.rows[0].turns, '3 turns');
  assert.strictEqual(person.acct, 'Account abcdef01');
});

test('adapters are pure — they do not mutate their input', () => {
  const sessions = api('sessions');
  const before = JSON.stringify(sessions);
  data.toTiles(sessions);
  data.toGroups(sessions);
  data.toRegistryRows(sessions, NOW);
  assert.strictEqual(JSON.stringify(sessions), before);
});

test('adapters are deterministic for a fixed clock', () => {
  const a = data.toRegistryRows(api('sessions'), NOW);
  const b = data.toRegistryRows(api('sessions'), NOW);
  assert.deepStrictEqual(a, b);
});

test('ago formats the way the mock writes timestamps', () => {
  assert.strictEqual(data.ago(NOW - 5000, NOW), 'just now');
  assert.strictEqual(data.ago(NOW - 2 * 60000, NOW), '2m ago');
  assert.strictEqual(data.ago(NOW - 16 * 3600000, NOW), '16h ago');
  assert.strictEqual(data.ago(NOW - 8 * 86400000, NOW), '8d ago');
  assert.strictEqual(data.ago(null, NOW), '—');
  // Epoch seconds, epoch millis and ISO all appear across the endpoints.
  assert.strictEqual(data.ago(Math.floor(NOW / 1000) - 120, NOW), '2m ago');
  assert.strictEqual(data.ago(new Date(NOW - 120000).toISOString(), NOW), '2m ago');
});

// ---------------------------------------------------------------------------
// Fixture mode: the fetchers hand back the mock's seed arrays unchanged.
// ---------------------------------------------------------------------------

function enableFixture() {
  const store = { 'fd-fixture': '1' };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  return store;
}

test('fixture mode is off by default under Node', () => {
  assert.strictEqual(data.isFixture(), false);
});

test('localStorage fd-fixture=1 turns fixture mode on', () => {
  enableFixture();
  assert.strictEqual(data.isFixture(), true);
});

test('?fixture=1 in the query string turns fixture mode on', () => {
  globalThis.location = { search: '?fixture=1' };
  assert.strictEqual(data.isFixture(), true);
  globalThis.location = { search: '?fixture=0' };
  assert.strictEqual(data.isFixture(), false);
  globalThis.location = { search: '?view=app&fixture=1' };
  assert.strictEqual(data.isFixture(), true);
});

test('in fixture mode the fetchers resolve the mock seed arrays unchanged', async () => {
  enableFixture();
  // Any real network call would be a bug, so there is no fetch to fall back to.
  data._fetch = async () => { throw new Error('fixture mode must not fetch'); };
  await data.loadFixtures();
  const cases = [
    ['sessions', 'groups'],
    ['messages', 'busSessions'],
    ['sshkeys', 'keyRows'],
    ['credits', 'accounts'],
    ['machines', 'machines'],
    ['desktopSessions', 'dsData'],
  ];
  for (const [fn, key] of cases) {
    const got = await data[fn]();
    // Deep-equal AND key order, per the acceptance wording.
    assert.deepStrictEqual(got, mock[key], fn + ' returns the mock ' + key);
    assert.deepStrictEqual(
      got.map((row) => keys(row)),
      mock[key].map((row) => keys(row)),
      fn + ' preserves key order'
    );
  }
});

test('fixtureFor reaches every seed array by name, from either file', async () => {
  await data.loadFixtures();
  const names = ['tiles', 'groups', 'regData', 'busSessions', 'busGroups', 'seedThreads',
    'orgScopeData', 'keyRows', 'accounts', 'machines', 'dsData', 'titles', 'gbSessions',
    'termLinesFor'];
  for (const n of names) assert.ok(data.fixtureFor(n) !== undefined, n);
  assert.throws(() => data.fixtureFor('nope'), /no fixture named/);
});

test('S2 owns its seeds and this slice never redefines one', () => {
  const owned = keys(s2Fixture);
  assert.ok(owned.length > 0, 'S2 ships seeds');
  const mine = keys(extract);
  const overlap = mine.filter((k) => owned.includes(k));
  assert.deepStrictEqual(overlap, [], 'fixture-extract.js must not define a key S2 owns');
  // Together they still cover every seed the adapters and the template need.
  for (const n of ['tiles', 'groups', 'regData', 'busSessions', 'busGroups', 'seedThreads',
    'orgScopeData', 'keyRows', 'accounts', 'machines', 'dsData', 'titles', 'gbSessions', 'termLinesFor']) {
    assert.ok(owned.includes(n) || mine.includes(n), n + ' is defined by exactly one of the two files');
  }
});

test('fixtureFor resolves an extract-owned seed without an explicit load', () => {
  // A screen slice may read a seed before any fetcher ran. Under Node that is a
  // synchronous require rather than a throw.
  delete globalThis.FD.fixtureExtract;
  try {
    assert.ok(Array.isArray(data.fixtureFor('tiles')), 'tiles resolves cold');
  } finally {
    globalThis.FD.fixtureExtract = extract;
  }
});

test('the drift check distinguishes a missing key from an undefined one', () => {
  // JSON.stringify drops undefined-valued keys, so a naive canonical form would
  // report these identical — and key presence is exactly what the template tests
  // (improvised.md I-L1-06). Mirrors tools/extract-fixture.mjs canon().
  const UNDEF = ' undefined';
  const canon = (v) => JSON.stringify(v, (k, val) => (val === undefined ? UNDEF : val), 1);
  assert.notStrictEqual(canon({ id: 1, tk: undefined }), canon({ id: 1 }), 'missing vs undefined key');
  assert.notStrictEqual(canon([1, undefined, 3]), canon([1, null, 3]), 'undefined vs null slot');
  assert.notStrictEqual(canon({ a: 1, b: 2 }), canon({ b: 2, a: 1 }), 'key order still caught');
  assert.strictEqual(canon({ a: 1, b: [2, 3] }), canon({ a: 1, b: [2, 3] }), 'equal stays equal');
});

test('FD.fixture wins over FD.fixtureExtract for a key in both', async () => {
  await data.loadFixtures();
  const key = keys(s2Fixture)[0];
  const before = globalThis.FD.fixtureExtract[key];
  globalThis.FD.fixtureExtract[key] = 'SHADOW';
  try {
    assert.notStrictEqual(data.fixtureFor(key), 'SHADOW', 'S2 is the authority');
    assert.deepStrictEqual(data.fixtureFor(key), s2Fixture[key]);
  } finally {
    if (before === undefined) delete globalThis.FD.fixtureExtract[key];
    else globalThis.FD.fixtureExtract[key] = before;
  }
});

test('fixture mode makes every WRITING endpoint a no-op', async () => {
  // A Kill or a Delete key clicked on a ?fixture=1 page must not reach a real
  // backend. Any fetch at all here is the bug.
  enableFixture();
  data._fetch = async () => { throw new Error('fixture mode must not fetch'); };
  const writes = [
    ['sendMessage', [{ source: 'ui', target: {}, text: 'x' }]],
    ['retryMessage', ['m1']],
    ['registryUpsert', [{ host: 'h', name: 'n' }]],
    ['registryDelete', [{ host: 'h', name: 'n' }]],
    ['kill', [{ host: 'h', name: 'n' }]],
    ['mintCert', [{ ttl: '1h', principals: 'root' }]],
    ['deleteKey', [{ dir: '/tmp/c' }]],
    ['startTrain', [{ ttl: '1h' }]],
    ['endTrain', []],
  ];
  for (const [fn, args] of writes) {
    const res = await data[fn](...args);
    assert.deepStrictEqual(res, { ok: true, fixture: true }, fn + ' is a no-op in fixture mode');
  }
});

test('the writing endpoints still reach the network when fixture mode is off', async () => {
  const calls = stubFetch();
  await data.kill({ host: 'h', name: 'n' });
  assert.strictEqual(calls.length, 1, 'fixture wrapping must not disable live writes');
  assert.strictEqual(calls[0].url, '/api/kill');
});

test('the endpoints with no seed array still resolve a response-shaped value', async () => {
  enableFixture();
  data._fetch = async () => { throw new Error('fixture mode must not fetch'); };
  assert.deepStrictEqual(await data.seats(), { ok: true, seats: [] });
  assert.deepStrictEqual(await data.health(), { hosts: [], alerts: [] });
  assert.deepStrictEqual(await data.ghtrain(), { active: false, expiresAt: null });
});

test('the checked-in fixture is what the extractor produces', () => {
  // pretest runs extract-fixture --check; this asserts the file is loadable and
  // carries every array the mock declares, so a partial extraction fails here too.
  for (const k of ['tiles', 'groups', 'regData', 'busSessions', 'seedThreads', 'keyRows', 'accounts', 'machines', 'dsData', 'titles']) {
    const v = mock[k];
    assert.ok(v && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0), k + ' is non-empty');
  }
  const src = fs.readFileSync(path.join(ROOT, 'public/v2/fixture-extract.js'), 'utf8');
  assert.ok(/DO NOT EDIT/i.test(src), 'generated banner present');
  // Presentation must not have survived extraction (I-L1-01).
  assert.strictEqual(/"[a-zA-Z]*[sS]tyle":/.test(src), false, 'no style keys in the fixture');
});

// ---------------------------------------------------------------------------
// Polling and the theme-key migration.
// ---------------------------------------------------------------------------

test('poll runs on the interval and stops when told to', async () => {
  let n = 0;
  const handle = data.poll(() => { n += 1; }, 5);
  await new Promise((r) => setTimeout(r, 40));
  handle.stop();
  const seen = n;
  assert.ok(seen > 0, 'polled at least once');
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(n, seen, 'stopped means stopped');
});

test('a visible-only poll skips ticks while the document is hidden', async () => {
  globalThis.document = { hidden: true };
  let n = 0;
  const handle = data.poll(() => { n += 1; }, 5, { whileVisible: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(n, 0, 'hidden means no work — sessions.js:342');
  globalThis.document.hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  handle.stop();
  assert.ok(n > 0, 'ticks resume when visible');
});

test('theme migrates fleetTheme to fd-landing-dark', () => {
  const store = { fleetTheme: 'light' };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  assert.strictEqual(data.theme(), false, 'legacy light stays light');
  assert.strictEqual(store['fd-landing-dark'], '0');
  // The legacy key stays put until the L11 cut-over removes the old UI.
  assert.strictEqual(store.fleetTheme, 'light');
});

test('anything but light migrates to dark, as the current app reads it', () => {
  for (const legacy of ['dark', '', 'nonsense']) {
    const store = { fleetTheme: legacy };
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    assert.strictEqual(data.theme(), true, legacy + ' reads as dark (sessions.js:32)');
    assert.strictEqual(store['fd-landing-dark'], '1');
  }
});

test('an existing fd-landing-dark wins over the legacy key', () => {
  const store = { 'fd-landing-dark': '0', fleetTheme: 'dark' };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  assert.strictEqual(data.theme(), false);
});

test('theme survives storage being unavailable', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
  };
  assert.strictEqual(data.theme(), true, 'defaults to dark, does not throw');
});

// ---------------------------------------------------------------------------
// Router.
// ---------------------------------------------------------------------------

test('route defaults to the app view and the windows screen', () => {
  assert.deepStrictEqual(router.route(), { view: 'app', screen: 'windows' });
});

test('route reads the view from the query and the screen from the hash', () => {
  globalThis.location = { search: '?view=deck', hash: '#registry' };
  assert.deepStrictEqual(router.route(), { view: 'deck', screen: 'registry' });
  globalThis.location = { search: '?view=land', hash: '' };
  assert.deepStrictEqual(router.route(), { view: 'land', screen: 'windows' });
});

test('an unknown view or screen falls back to the defaults', () => {
  globalThis.location = { search: '?view=bogus', hash: '#nope' };
  assert.deepStrictEqual(router.route(), { view: 'app', screen: 'windows' });
});

test('every screen in the pack is routable', () => {
  const expected = ['windows', 'org', 'registry', 'bus', 'keys', 'accounts', 'machines', 'desktop'];
  assert.deepStrictEqual([...router.SCREENS], expected);
  assert.deepStrictEqual([...router.VIEWS], ['land', 'app', 'deck']);
  for (const screen of expected) {
    globalThis.location = { search: '', hash: '#' + screen };
    assert.strictEqual(router.route().screen, screen);
  }
});

test('VIEWS and SCREENS are frozen', () => {
  assert.ok(Object.isFrozen(router.VIEWS));
  assert.ok(Object.isFrozen(router.SCREENS));
});

// ---------------------------------------------------------------------------
// The /v2/ directory fix. The shell itself is S2's file, so this asserts the
// server mechanism: a trailing-slash URL serves that directory's index.html.
// ---------------------------------------------------------------------------

test('a directory URL serves its index.html', async () => {
  const dir = path.join(ROOT, 'public/v2');
  const index = path.join(dir, 'index.html');
  const preexisting = fs.existsSync(index);
  const body = '<!doctype html><title>v2 shell</title><div id="root"></div>';
  if (!preexisting) fs.writeFileSync(index, body);
  const srv = await startServer();
  try {
    const viaDir = await srv.get('/v2/');
    assert.strictEqual(viaDir.status, 200, '/v2/ resolves');
    const viaFile = await srv.get('/v2/index.html');
    assert.strictEqual(viaFile.status, 200, '/v2/index.html resolves');
    assert.strictEqual(viaDir.text, viaFile.text, 'both serve the same shell');
    if (!preexisting) assert.ok(viaDir.text.includes('v2 shell'));
    // The root special case still works, and a directory with no index still 404s.
    assert.strictEqual((await srv.get('/')).status, 200);
    assert.strictEqual((await srv.get('/screenshots/')).status, 404);
  } finally {
    await srv.stop();
    if (!preexisting) fs.unlinkSync(index);
  }
});

test('the static handler still refuses to escape public/', async () => {
  const srv = await startServer();
  try {
    for (const p of ['/../server.js', '/v2/../../server.js', '/%2e%2e/server.js', '/v2/..%2f..%2fserver.js']) {
      const res = await srv.get(p);
      assert.notStrictEqual(res.status, 200, p + ' must not serve a file outside public/');
      assert.ok(!/FLEET_DB|require\('node:sqlite'\)/.test(res.text || ''), p + ' leaked server source');
    }
  } finally {
    await srv.stop();
  }
});
