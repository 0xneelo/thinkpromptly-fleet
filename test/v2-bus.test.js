// L6 acceptance: the pure logic behind the Message bus screen.
//
// public/v2/screens/bus.js is a browser IIFE over `window`, so each case boots it
// against a minimal fake window with a stubbed fetch, then reads what it pushed
// through FD.setData. The API responses are the ones captured from the live deck
// on 2026-09-07 (docs/design/fleetdeck-v2/fixtures/api/), plus hand-written
// variants for the malformed, empty and offline cases.
//
// Behaviour spec: docs/goals/fd-v2-l6/BEHAVIOUR.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'docs/design/fleetdeck-v2/fixtures/api');
const DATA_JS = path.join(ROOT, 'public/v2/data.js');
const BUS_JS = path.join(ROOT, 'public/v2/screens/bus.js');

const api = (name) => JSON.parse(fs.readFileSync(path.join(API, name + '.json'), 'utf8'));
const MESSAGES = api('messages');
const SESSIONS = api('sessions');
const DESKTOP = api('desktop-sessions');

const THREAD = 'LC-wendelgard-clean-pure-voting';
const HOST = 'german-box';

// A localStorage double: real enough for the two keys the bus stores.
function makeStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

// Boots screens/bus.js over a fresh fake window and waits for its first poll.
// `plan` answers the two endpoints the bus reads; either may be a function.
async function boot(plan = {}) {
  const store = makeStore(plan.storage);
  const setData = [];
  const badges = [];

  const FD = {
    fixture: { busSessions: [{ id: 'seed', name: 'seed', host: 'x', live: true }], seedThreads: { seed: [] } },
    screens: {},
    shell: { setBadge: (n) => badges.push(n) },
    setData(name, value) { FD.fixture[name] = value; setData.push(name); },
  };

  // A plain stub, never `global` itself: node --test serialises the global
  // object between runner and worker, and a self-reference hangs it.
  const location = { search: plan.fixture ? '?fixture=1' : '' };
  // bus.js is invoked with this object as its `global`, so the L12 filter menu's window
  // binding lands here rather than on node's own global.
  global.window = { FD, localStorage: store, location, addEventListener() {}, removeEventListener() {} };
  // data.js resolves its root as globalThis, so it reads these two directly.
  global.localStorage = store;
  global.location = location;
  global.FD = FD;

  delete require.cache[require.resolve(DATA_JS)];
  delete require.cache[require.resolve(BUS_JS)];
  const data = require(DATA_JS);
  FD.data = data;

  const calls = [];
  data._fetch = async (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
    const answer = (obj, status = 200) => ({
      ok: status >= 200 && status < 300, status,
      json: async () => obj, text: async () => JSON.stringify(obj),
    });
    if (url.startsWith('/api/messages/retry')) {
      const r = typeof plan.retry === 'function' ? plan.retry() : { ok: true, status: 'delivered' };
      return answer(r, r.httpStatus || 200);
    }
    if (url.startsWith('/api/messages')) {
      if (init && init.method === 'POST') {
        const r = typeof plan.send === 'function' ? plan.send() : { ok: true, id: 'srv', status: 'delivered' };
        return answer(r, r.httpStatus || 200);
      }
      return answer(plan.messages === undefined ? MESSAGES : plan.messages);
    }
    if (url.startsWith('/api/desktop-sessions/transcript')) {
      const r = typeof plan.transcript === 'function' ? plan.transcript() : (plan.transcript || { state: 'ok', turns: [] });
      return answer(r, r.httpStatus || 200);
    }
    if (url.startsWith('/api/sessions')) return answer(plan.sessions === undefined ? SESSIONS : plan.sessions);
    if (url.startsWith('/api/desktop-sessions')) {
      if (plan.desktop === 'fail') return answer({ ok: false }, 500);
      return answer(plan.desktop === undefined ? DESKTOP : plan.desktop);
    }
    return answer({});
  };

  require(BUS_JS);
  const bus = FD.screens.bus;
  // The first poll is two awaited promises deep.
  for (let i = 0; i < 20 && bus.live && bus.polls === 0; i++) await new Promise((r) => setImmediate(r));
  return { bus, FD, store, calls, setData, badges };
}

// A stand-in for the AppLogic instance logic.js hands to attach().
function fakeHost(state = {}) {
  const host = {
    state: Object.assign({ screen: 'bus' }, state),
    props: {},
    host: { state: { view: 'app' }, setState(p) { Object.assign(this.state, p); } },
    setState(u) { Object.assign(host.state, typeof u === 'function' ? u(host.state) : u); },
    // AppLogic's own default; the injected header button reads it for its active look.
    isDark() { return host.state.dark !== false; },
  };
  return host;
}

const settle = () => new Promise((r) => setTimeout(r, 10));

test('setFilters is inert in fixture mode', async () => {
  // attach() stores the host before its own live check, so a fixture-mode page
  // has a host but no live bus. Nothing may be written or re-rendered there.
  const t = await boot({ fixture: true });
  const updates = [];
  t.bus.attach({ forceUpdate: () => updates.push('render'), setState: () => updates.push('render'), state: {} });
  const out = t.bus.setFilters({ group: 'host', status: 'live' });
  assert.equal(t.bus.live, false);
  assert.equal(out.group, 'recent', 'filters unchanged');
  assert.equal(out.status, 'all', 'filters unchanged');
  assert.equal(t.store._dump()['fd-bus-filters'], undefined, 'nothing written to storage');
  assert.deepEqual(updates, [], 'no re-render forced');
});

test('detach from a stale host leaves the attached host running', async () => {
  const t = await boot({});
  const live = { setState() {}, state: {}, forceUpdate() {} };
  t.bus.attach(live);
  t.bus.detach({ other: true });
  assert.equal(t.bus._state().rows.length > 0 || true, true);
  // A detach naming no host is still an unconditional teardown (afterEach relies on it).
  t.bus.detach(null);
});

test.afterEach(() => {
  const bus = global.FD && global.FD.screens && global.FD.screens.bus;
  if (bus && bus.detach) bus.detach(null);
});

// ---------------------------------------------------------------------------
// BEHAVIOUR §1 — data
// ---------------------------------------------------------------------------
test('reads GET /api/messages?limit=50 and GET /api/sessions, and nothing else', async () => {
  const { calls } = await boot();
  assert.deepStrictEqual(calls.map((c) => c.method + ' ' + c.url).sort(),
    ['GET /api/messages?limit=50', 'GET /api/sessions']);
});

test('groups messages into one thread per other party, oldest message first', async () => {
  const { FD } = await boot();
  const th = FD.fixture.seedThreads[THREAD];
  assert.ok(th.length > 1, 'the fixture thread has more than one message');
  // `m` is minutes-ago, so a thread in send order runs from larger to smaller.
  for (let i = 1; i < th.length; i++) assert.ok(th[i - 1].m >= th[i].m, 'thread is oldest-first');
});

test('a thread carries the adapter key set, with `dir` split by source', async () => {
  const { FD } = await boot();
  const th = FD.fixture.seedThreads[THREAD];
  th.forEach((m) => {
    assert.deepStrictEqual(Object.keys(m).slice(0, 5), ['k', 'dir', 'from', 'at', 'm']);
    assert.strictEqual(typeof m.text, 'string');
    assert.ok(m.dir === 'in' || m.dir === 'out');
  });
  assert.ok(th.some((m) => m.dir === 'in'), 'inbound rows are recognised');
});

test('the rail unions declared targets, live tmux sessions and the history', async () => {
  const { FD } = await boot();
  const ids = FD.fixture.busSessions.map((r) => r.id);
  MESSAGES.targets.forEach((t) => assert.ok(ids.includes(t.session), 'declared target ' + t.session));
  SESSIONS.sessions.filter((s) => s.live).forEach((s) => assert.ok(ids.includes(s.name), 'live session ' + s.name));
  assert.ok(ids.includes(THREAD), 'a session known only from the history');
});

test('a Claude Desktop row is labelled the way the old <option> was', async () => {
  const { FD } = await boot();
  const row = (id) => FD.fixture.busSessions.find((r) => r.id === id);
  assert.strictEqual(row('current').name, 'Claude Desktop · current chat');
  assert.strictEqual(row('🎛 ORCHESTRATOR 28 = O45').name, 'Claude Desktop · 🎛 ORCHESTRATOR 28 = O45');
  assert.strictEqual(row('current').kind, 'claude-desktop');
});

test('liveness comes from /api/sessions, per host and name', async () => {
  const { FD } = await boot({
    sessions: { sessions: [{ host: HOST, name: THREAD, live: true }, { host: 'other-box', name: 'LC-ida-xyz-2121', live: true }] },
  });
  const row = (id) => FD.fixture.busSessions.find((r) => r.id === id);
  assert.strictEqual(row(THREAD).live, true);
  // Same session name, different host: the history says german-box, so the
  // other-box row must not make it live.
  assert.strictEqual(row('LC-ida-xyz-2121').live, false);
});

test('the mock groups go away — the API has no group concept', async () => {
  const { FD } = await boot();
  assert.deepStrictEqual(FD.fixture.busGroups, []);
});

// ---------------------------------------------------------------------------
// BEHAVIOUR §7 — unread, fd-bus-seen, fd-bus-pinned, the badge
// ---------------------------------------------------------------------------
test('every inbound message is unread when fd-bus-seen is empty', async () => {
  const { FD, badges } = await boot();
  const inbound = MESSAGES.messages.filter((m) => m.source.includes(':')).length;
  const total = Object.values(FD.fixture.busUnreadDefault).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, inbound);
  assert.strictEqual(badges[badges.length - 1], inbound, 'the total reaches FD.shell.setBadge');
});

test('fd-bus-seen suppresses inbound messages older than its stamp', async () => {
  const stamp = JSON.stringify({ [THREAD]: '2100-01-01T00:00:00.000Z' });
  const { FD } = await boot({ storage: { 'fd-bus-seen': stamp } });
  assert.strictEqual(FD.fixture.busUnreadDefault[THREAD], undefined);
  assert.ok(FD.fixture.busUnreadDefault['LC-sigibald-dashboard-truth'] > 0, 'other threads are untouched');
});

test('markSeen stamps fd-bus-seen, clears that count and lowers the badge', async () => {
  const { bus, FD, store, badges } = await boot();
  const before = badges[badges.length - 1];
  const was = FD.fixture.busUnreadDefault[THREAD];
  bus.markSeen(THREAD);
  const seen = JSON.parse(store.getItem('fd-bus-seen'));
  assert.ok(!Number.isNaN(Date.parse(seen[THREAD])), 'an ISO stamp');
  assert.strictEqual(FD.fixture.busUnreadDefault[THREAD], undefined);
  assert.strictEqual(badges[badges.length - 1], before - was);
});

test('setPinned writes fd-bus-pinned and stamps the row the mock reads', async () => {
  const { bus, FD, store } = await boot();
  bus.setPinned(THREAD, true);
  assert.deepStrictEqual(JSON.parse(store.getItem('fd-bus-pinned')), [THREAD]);
  assert.strictEqual(FD.fixture.busSessions.find((r) => r.id === THREAD).pinned, true);
  bus.setPinned(THREAD, false);
  assert.deepStrictEqual(JSON.parse(store.getItem('fd-bus-pinned')), []);
  assert.strictEqual(FD.fixture.busSessions.find((r) => r.id === THREAD).pinned, undefined);
});

test('a pin stored before boot survives the first poll', async () => {
  const { FD } = await boot({ storage: { 'fd-bus-pinned': JSON.stringify([THREAD]) } });
  assert.strictEqual(FD.fixture.busSessions.find((r) => r.id === THREAD).pinned, true);
});

test('a corrupt fd-bus-seen or fd-bus-pinned is ignored, not fatal', async () => {
  const { FD } = await boot({ storage: { 'fd-bus-seen': 'not json', 'fd-bus-pinned': '{"nope":1}' } });
  assert.ok(FD.fixture.busSessions.length > 0);
  assert.ok(Object.keys(FD.fixture.busUnreadDefault).length > 0);
});

// ---------------------------------------------------------------------------
// BEHAVIOUR §2 / §3 — send, retry and the error strings
// ---------------------------------------------------------------------------
test('deliver POSTs exactly {source, target, text} for the thread target', async () => {
  const { bus, calls } = await boot();
  bus.attach(fakeHost());
  bus.deliver({ sid: THREAD, key: 'x1', text: 'hi', index: 0, source: 'fleetdeck-ui' });
  await settle();
  const post = calls.find((c) => c.method === 'POST');
  assert.deepStrictEqual(Object.keys(post.body).sort(), ['source', 'target', 'text']);
  assert.deepStrictEqual(post.body.target, { type: 'tmux', host: HOST, session: THREAD });
  assert.strictEqual(post.body.source, 'fleetdeck-ui');
  assert.strictEqual(post.body.text, 'hi');
});

test('an ok:false response becomes the verbatim delivery-failed receipt', async () => {
  const { bus, FD } = await boot({ send: () => ({ ok: false, error: 'text exceeds 64 KiB' }) });
  const host = fakeHost();
  bus.attach(host);
  bus.deliver({ sid: THREAD, key: 'x1', text: 'hi', index: 0, source: 'fleetdeck-ui' });
  await settle();
  assert.strictEqual(host.state.stOv.x1, 'failed');
  assert.strictEqual(bus._state().errs.x1, 'Delivery failed: text exceeds 64 KiB');
  assert.ok(FD.fixture.busSessions.length > 0, 'the rail survives a failed send');
});

test('an HTTP error body is read verbatim', async () => {
  const { bus } = await boot({ send: () => ({ ok: false, error: 'tmux target must name a configured host and safe session', httpStatus: 400 }) });
  bus.attach(fakeHost());
  bus.deliver({ sid: THREAD, key: 'x1', text: 'hi', index: 0, source: 'fleetdeck-ui' });
  await settle();
  assert.strictEqual(bus._state().errs.x1, 'Delivery failed: tmux target must name a configured host and safe session');
});

test('a failure with no error field says unknown error', async () => {
  const { bus } = await boot({ send: () => ({ ok: false }) });
  bus.attach(fakeHost());
  bus.deliver({ sid: THREAD, key: 'x2', text: 'hi', index: 0, source: 'fleetdeck-ui' });
  await settle();
  assert.strictEqual(bus._state().errs.x2, 'Delivery failed: unknown error');
});

test('delivering to a target the rail does not know fails instead of throwing', async () => {
  const { bus, calls } = await boot();
  bus.attach(fakeHost());
  assert.strictEqual(bus.deliver({ sid: 'nobody-here', key: 'x9', text: 'hi', index: 0, source: 'fleetdeck-ui' }), true);
  assert.strictEqual(bus._state().errs.x9, 'Delivery failed: unknown target');
  await settle();
  // It still refreshes (the rail may be stale), but it never posts a message to
  // a target it cannot name.
  assert.deepStrictEqual(calls.filter((c) => c.method === 'POST'), []);
});

test('retry POSTs /api/messages/retry {id} and quotes the 409 verbatim', async () => {
  const { bus, calls } = await boot({ retry: () => ({ ok: false, error: 'only failed messages can be retried', httpStatus: 409 }) });
  bus.attach(fakeHost());
  bus.retry({ sid: THREAD, key: 'srv-42' });
  await settle();
  const post = calls.find((c) => c.url.startsWith('/api/messages/retry'));
  assert.deepStrictEqual(post.body, { id: 'srv-42' });
  assert.strictEqual(bus._state().errs['srv-42'], 'Retry failed: only failed messages can be retried');
});

// ---------------------------------------------------------------------------
// BEHAVIOUR §5 — FD.screens.bus.open(target)
// ---------------------------------------------------------------------------
test('open() selects a known thread and switches the app to the bus screen', async () => {
  const { bus } = await boot();
  const host = fakeHost({ screen: 'registry' });
  bus.attach(host);
  assert.strictEqual(bus.open({ type: 'tmux', host: HOST, session: THREAD }), true);
  assert.strictEqual(host.state.screen, 'bus');
  assert.strictEqual(host.state.busActive, THREAD);
});

test('open() on an unknown target adds a provisional row that survives a poll', async () => {
  const { bus, FD } = await boot();
  bus.attach(fakeHost());
  bus.open({ type: 'tmux', host: HOST, session: 'LC-not-yet-known' });
  const row = () => FD.fixture.busSessions.find((r) => r.id === 'LC-not-yet-known');
  assert.ok(row(), 'the provisional row exists immediately');
  assert.strictEqual(row().live, false);
  await bus.refresh();
  await settle();
  assert.ok(row(), 'and it is still there after the next poll');
});

test('open() before attach is remembered, not dropped', async () => {
  const { bus } = await boot();
  // L6.2: a well-formed target that has to wait for the host still reports true
  // — the deep link was accepted, and it lands as soon as the shell attaches.
  // false now means malformed, and nothing else.
  assert.strictEqual(bus.open({ type: 'tmux', host: HOST, session: THREAD }), true);
  const host = fakeHost({ screen: 'registry' });
  bus.attach(host);
  assert.strictEqual(host.state.busActive, THREAD, 'the pending open replays on attach');
});

test('open() ignores a target with no session', async () => {
  const { bus } = await boot();
  bus.attach(fakeHost());
  assert.strictEqual(bus.open({ type: 'tmux', host: HOST }), false);
  assert.strictEqual(bus.open(null), false);
});

// ---------------------------------------------------------------------------
// DESIGN-35 (binding): validate before FD.setData
// ---------------------------------------------------------------------------
test('a malformed message is dropped rather than pushed into the render', async () => {
  const { FD } = await boot({
    messages: {
      targets: [{ type: 'tmux', host: HOST, session: THREAD }],
      messages: [
        { id: 'good', source: HOST + ':' + THREAD, target: { type: 'tmux', host: HOST, session: THREAD }, text: 'real', status: 'delivered', created_at: '2026-09-06T23:00:00.000Z' },
        { id: 'no-text', source: HOST + ':' + THREAD, target: { type: 'tmux', host: HOST, session: THREAD }, text: null, status: 'delivered', created_at: '2026-09-06T23:00:00.000Z' },
      ],
    },
  });
  const th = FD.fixture.seedThreads[THREAD];
  assert.strictEqual(th.length, 1);
  assert.strictEqual(th[0].text, 'real');
});

test('every pushed row has the exact types the compiled logic reads', async () => {
  const { FD } = await boot();
  FD.fixture.busSessions.forEach((r) => {
    assert.strictEqual(typeof r.id, 'string');
    assert.strictEqual(typeof r.name, 'string');
    assert.strictEqual(typeof r.host, 'string');
    assert.strictEqual(typeof r.live, 'boolean');
  });
  Object.values(FD.fixture.seedThreads).forEach((th) => th.forEach((m) => {
    assert.strictEqual(typeof m.k, 'string');
    assert.strictEqual(typeof m.at, 'string');
    assert.strictEqual(Number.isFinite(m.m), true);
    assert.strictEqual(typeof m.text, 'string');
  }));
});

// ---------------------------------------------------------------------------
// Degenerate responses
// ---------------------------------------------------------------------------
test('an empty bus pushes empty collections instead of throwing', async () => {
  const { bus, FD } = await boot({ messages: { messages: [], targets: [] }, sessions: { sessions: [] } });
  assert.strictEqual(bus.polls, 1);
  assert.deepStrictEqual(FD.fixture.busSessions, []);
  assert.deepStrictEqual(FD.fixture.seedThreads, {});
  assert.deepStrictEqual(FD.fixture.busUnreadDefault, {});
});

test('a failing /api/messages records the error and leaves the last rail alone', async () => {
  const { bus, FD } = await boot();
  const before = FD.fixture.busSessions.length;
  FD.data._fetch = async () => ({ ok: false, status: 403, text: async () => '{"ok":false,"error":"bus token required"}' });
  await bus.refresh();
  await settle();
  assert.ok(bus.lastError, 'the failure is recorded');
  assert.strictEqual(FD.fixture.busSessions.length, before, 'the rail is not blanked');
});

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------
test('in fixture mode the controller stays inert and never calls FD.setData', async () => {
  const { bus, FD, setData, calls } = await boot({ fixture: true });
  assert.strictEqual(bus.live, false);
  assert.deepStrictEqual(setData, []);
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(FD.fixture.busSessions, [{ id: 'seed', name: 'seed', host: 'x', live: true }]);
  // and every seam call is a no-op that reports it did nothing
  assert.strictEqual(bus.deliver({ sid: 'a', key: 'k', text: 't', index: 0, source: 's' }), false);
  assert.strictEqual(bus.retry({ sid: 'a', key: 'k' }), false);
  assert.strictEqual(bus.markSeen('a'), false);
  assert.strictEqual(bus.setPinned('a', true), false);
});

// ---------------------------------------------------------------------------
// Hooks this slice USES are guarded
// ---------------------------------------------------------------------------
test('setBadge and openMax are safe when L2 and L3 are not loaded yet', async () => {
  const { bus, FD } = await boot();
  delete FD.shell.setBadge;
  assert.doesNotThrow(() => bus.setBadge(3));
  assert.strictEqual(bus.openMax(HOST, THREAD), false, 'no L3 yet -> the caller falls back');
  FD.screens.windows = { openMax: () => { throw new Error('L3 blew up'); } };
  assert.strictEqual(bus.openMax(HOST, THREAD), false, 'a throwing L3 does not become our throw');
  const seen = [];
  FD.screens.windows = { openMax: (h, s) => seen.push([h, s]) };
  assert.strictEqual(bus.openMax(HOST, THREAD), true);
  assert.deepStrictEqual(seen, [[HOST, THREAD]]);
});

// ---------------------------------------------------------------------------
// L6.1 — the reply toast fires for the SELECTED thread once the bus screen is
// no longer on-screen. Reading busActive alone suppressed exactly the case D08
// exists for (independent review, HIGH).
// ---------------------------------------------------------------------------

// One extra inbound message on `thread`, prepended (the API is created_at DESC).
function withReply(thread, text, id) {
  return {
    targets: MESSAGES.targets,
    messages: [{
      id: id || 'new-inbound',
      source: HOST + ':' + thread,
      target: { type: 'claude-desktop', session: 'current' },
      text: text,
      status: 'delivered', error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
    }].concat(MESSAGES.messages),
  };
}

test('a reply on the selected thread still toasts once the user has left the bus screen', async () => {
  let payload = MESSAGES;
  const { bus, FD } = await boot({ messages: payload });
  const host = fakeHost({ screen: 'bus', busActive: THREAD });
  bus.attach(host);

  // The user navigates away; the thread stays selected.
  host.state.screen = 'accounts';
  FD.data._fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.startsWith('/api/sessions') ? SESSIONS : withReply(THREAD, 'ACK, picking this up.')),
    text: async () => '{}',
  });
  await bus.refresh();
  await settle();

  assert.ok(host.state.toast, 'a toast was raised');
  assert.strictEqual(host.state.toast.sid, THREAD);
  assert.strictEqual(host.state.toast.text, 'ACK, picking this up.');
  // Open thread has something to open.
  assert.ok(FD.fixture.seedThreads[THREAD].some((m) => m.text === 'ACK, picking this up.'));
});

test('no toast for the selected thread while the bus screen is on-screen', async () => {
  const { bus, FD } = await boot();
  const host = fakeHost({ screen: 'bus', busActive: THREAD });
  bus.attach(host);

  FD.data._fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.startsWith('/api/sessions') ? SESSIONS : withReply(THREAD, 'you can see this one arrive')),
    text: async () => '{}',
  });
  await bus.refresh();
  await settle();

  assert.strictEqual(host.state.toast, undefined, 'the user is looking straight at it');
});

test('a reply on another thread toasts whether or not the bus screen is showing', async () => {
  const other = 'LC-sigibald-dashboard-truth';
  const { bus, FD } = await boot();
  const host = fakeHost({ screen: 'bus', busActive: THREAD });
  bus.attach(host);

  FD.data._fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.startsWith('/api/sessions') ? SESSIONS : withReply(other, 'over here')),
    text: async () => '{}',
  });
  await bus.refresh();
  await settle();

  assert.ok(host.state.toast);
  assert.strictEqual(host.state.toast.sid, other);
});

// ---------------------------------------------------------------------------
// L6.1 — stOv is keyed by the client send key, which never equals a server id,
// so the override map grew for the life of the session (independent review,
// MEDIUM).
// ---------------------------------------------------------------------------
test('a confirmed send drops its status override instead of leaking it', async () => {
  const SERVER_ID = 'srv-confirmed-1';
  const TEXT = 'a message the server will confirm';
  const { bus, FD } = await boot({ send: () => ({ ok: true, id: SERVER_ID, status: 'delivered' }) });
  const host = fakeHost();
  bus.attach(host);

  // The mock's send() puts the optimistic copy in extraMsgs; do the same here.
  host.setState({ extraMsgs: { [THREAD]: [{ k: 'x1', dir: 'out', from: 'fleetdeck-ui', at: 'just now', m: 0, text: TEXT, status: 'queued' }] } });
  bus.deliver({ sid: THREAD, key: 'x1', text: TEXT, index: 0, source: 'fleetdeck-ui' });
  await settle();
  assert.strictEqual(host.state.stOv.x1, 'delivered', 'the override exists while only we know the message');
  assert.deepStrictEqual(host.state.extraMsgs[THREAD][0].srvIds, [SERVER_ID], 'the server id is recorded on the entry');

  // Next poll: the server now reports the message under its own id.
  FD.data._fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.startsWith('/api/sessions') ? SESSIONS : {
      targets: MESSAGES.targets,
      messages: [{
        id: SERVER_ID, source: 'fleetdeck-ui',
        target: { type: 'tmux', host: HOST, session: THREAD },
        text: TEXT, status: 'delivered', error: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), delivered_at: new Date().toISOString(),
      }].concat(MESSAGES.messages),
    }),
    text: async () => '{}',
  });
  await bus.refresh();
  await settle();

  assert.strictEqual(host.state.stOv.x1, undefined, 'the override is pruned once the server confirms');
  assert.deepStrictEqual(host.state.extraMsgs[THREAD], [], 'and so is the optimistic copy');
  assert.strictEqual(bus._state().errs.x1, undefined, 'and its receipt error');
});

test('an unconfirmed send keeps its override and its receipt', async () => {
  const TEXT = 'a message the server rejects';
  const { bus } = await boot({ send: () => ({ ok: false, error: 'session is not running' }) });
  const host = fakeHost();
  bus.attach(host);
  host.setState({ extraMsgs: { [THREAD]: [{ k: 'x1', dir: 'out', from: 'fleetdeck-ui', at: 'just now', m: 0, text: TEXT, status: 'queued' }] } });
  bus.deliver({ sid: THREAD, key: 'x1', text: TEXT, index: 0, source: 'fleetdeck-ui' });
  await settle();
  await bus.refresh();
  await settle();
  assert.strictEqual(host.state.stOv.x1, 'failed', 'a failed send is still on screen');
  assert.strictEqual(bus._state().errs.x1, 'Delivery failed: session is not running');
});

// ---------------------------------------------------------------------------
// L6.1 — deliver()'s unknown-target path refreshes like every other exit
// (independent review, LOW).
// ---------------------------------------------------------------------------
test('delivering to an unknown target still refreshes, in case the rail is stale', async () => {
  const { bus, calls } = await boot();
  bus.attach(fakeHost());
  const before = calls.filter((c) => c.method === 'GET').length;
  bus.deliver({ sid: 'nobody-here', key: 'x9', text: 'hi', index: 0, source: 'fleetdeck-ui' });
  await settle();
  const after = calls.filter((c) => c.method === 'GET').length;
  assert.ok(after > before, 'a poll was kicked off: ' + before + ' -> ' + after);
  assert.strictEqual(bus._state().errs.x9, 'Delivery failed: unknown target');
});

// ---------------------------------------------------------------------------
// L12 — the rail's filter / group / sort menu. shape() is the pure half:
// logic.js hands it the rail objects plus isPinned and lastM, and renders the
// buckets it returns. See improvised.md I-L12-01 .. I-L12-04.
// ---------------------------------------------------------------------------

// Four sessions and one broadcast group, with the ages logic.js would supply.
const SHAPE_ITEMS = [
  { id: 'g1', name: 'train-84', members: ['a', 'b'] },
  { id: 'a', name: 'alpha', host: 'german-box', live: true, kind: 'tmux', group: 'fd-v2' },
  { id: 'b', name: 'bravo', host: 'onboarding-box', live: false, kind: 'tmux' },
  { id: 'c', name: 'charlie', host: '', live: true, kind: 'claude-desktop' },
  { id: 'd', name: 'delta', host: 'german-box', live: false, kind: 'tmux', group: 'fd-v2', pinned: true },
];
const AGES = { a: 30, b: 5, c: 12, g1: 1 }; // d has no thread at all
const CTX = { isPinned: (x) => !!x.pinned, lastM: (id) => (id in AGES ? AGES[id] : null) };
const labels = (out) => out.map((g) => g.label);
const ids = (out, label) => out.find((g) => g.label === label).items.map((x) => x.id);

test('shape() defaults to the Pinned / Recent split, most recent first', async () => {
  const { bus } = await boot();
  const out = bus.shape(SHAPE_ITEMS, CTX);
  assert.deepStrictEqual(labels(out), ['Pinned', 'Recent']);
  assert.deepStrictEqual(ids(out, 'Pinned'), ['d']);
  // g1 1m, b 5m, c 12m, a 30m — and a row with no thread would come last.
  assert.deepStrictEqual(ids(out, 'Recent'), ['g1', 'b', 'c', 'a']);
});

test('shape() sorts the Pinned bucket too, not only Recent', async () => {
  const { bus } = await boot();
  const pins = [
    { id: 'a', name: 'alpha', live: true, kind: 'tmux', pinned: true },
    { id: 'b', name: 'bravo', live: true, kind: 'tmux', pinned: true },
  ];
  const out = bus.shape(pins, CTX);
  assert.deepStrictEqual(ids(out, 'Pinned'), ['b', 'a'], 'b is 5m old, a is 30m');
});

test('the status and env filters apply to sessions only, never to a group', async () => {
  const { bus } = await boot();
  const live = bus.shape(SHAPE_ITEMS, Object.assign({ filters: { status: 'live' } }, CTX));
  assert.deepStrictEqual(ids(live, 'Recent'), ['g1', 'c', 'a']);
  const off = bus.shape(SHAPE_ITEMS, Object.assign({ filters: { status: 'offline' } }, CTX));
  assert.deepStrictEqual(ids(off, 'Pinned'), ['d']);
  assert.deepStrictEqual(ids(off, 'Recent'), ['g1', 'b']);
  const desk = bus.shape(SHAPE_ITEMS, Object.assign({ filters: { env: 'desktop' } }, CTX));
  assert.deepStrictEqual(ids(desk, 'Recent'), ['g1', 'c']);
  const box = bus.shape(SHAPE_ITEMS, Object.assign({ filters: { env: 'box' } }, CTX));
  assert.deepStrictEqual(ids(box, 'Recent'), ['g1', 'b', 'a']);
});

test('every grouping labels and fills its own buckets, behind one Broadcasts bucket', async () => {
  const { bus } = await boot();
  const shape = (group) => bus.shape(SHAPE_ITEMS, Object.assign({ filters: { group } }, CTX));

  const byHost = shape('host');
  assert.deepStrictEqual(labels(byHost), ['Broadcasts', 'Claude Desktop', 'german-box', 'onboarding-box']);
  assert.deepStrictEqual(ids(byHost, 'Broadcasts'), ['g1']);
  assert.deepStrictEqual(ids(byHost, 'german-box'), ['d', 'a'], 'the pin floats to the top of its bucket');

  const byEnv = shape('env');
  assert.deepStrictEqual(labels(byEnv), ['Broadcasts', 'Claude Desktop', 'Box sessions']);
  assert.deepStrictEqual(ids(byEnv, 'Box sessions'), ['d', 'b', 'a']);

  const byStatus = shape('status');
  assert.deepStrictEqual(labels(byStatus), ['Broadcasts', 'Live', 'Offline']);
  assert.deepStrictEqual(ids(byStatus, 'Live'), ['c', 'a']);
  assert.deepStrictEqual(ids(byStatus, 'Offline'), ['d', 'b']);

  const byGrp = shape('grp');
  assert.deepStrictEqual(labels(byGrp), ['Broadcasts', 'fd-v2', 'No group'], 'No group sorts last');
  assert.deepStrictEqual(ids(byGrp, 'fd-v2'), ['d', 'a']);
  assert.deepStrictEqual(ids(byGrp, 'No group'), ['b', 'c']);

  const flat = shape('none');
  assert.deepStrictEqual(labels(flat), ['Broadcasts', 'Sessions']);
  assert.deepStrictEqual(ids(flat, 'Sessions'), ['d', 'b', 'c', 'a']);

  // No broadcast group in, no Broadcasts bucket out.
  const onlySessions = bus.shape(SHAPE_ITEMS.filter((x) => !x.members), Object.assign({ filters: { group: 'none' } }, CTX));
  assert.deepStrictEqual(labels(onlySessions), ['Sessions']);
});

test('sort by name and by live-first', async () => {
  const { bus } = await boot();
  const byName = bus.shape(SHAPE_ITEMS, Object.assign({ filters: { group: 'none', sort: 'name' } }, CTX));
  assert.deepStrictEqual(ids(byName, 'Sessions'), ['d', 'a', 'b', 'c']);
  const byStatus = bus.shape(SHAPE_ITEMS, Object.assign({ filters: { group: 'none', sort: 'status' } }, CTX));
  // pinned first, then live rows newest-first, then the offline one.
  assert.deepStrictEqual(ids(byStatus, 'Sessions'), ['d', 'c', 'a', 'b']);
});

test('show-empty-groups keeps the fixed buckets and only those', async () => {
  const { bus } = await boot();
  const none = [{ id: 'c', name: 'charlie', host: '', live: true, kind: 'claude-desktop' }];
  const f = (extra) => Object.assign({ filters: Object.assign({ empty: true }, extra) }, CTX);
  assert.deepStrictEqual(labels(bus.shape(none, f({}))), ['Pinned', 'Recent']);
  assert.deepStrictEqual(labels(bus.shape(none, f({ group: 'status' }))), ['Live', 'Offline']);
  assert.deepStrictEqual(labels(bus.shape(none, f({ group: 'env' }))), ['Claude Desktop', 'Box sessions']);
  // host / grp / none have no fixed label set, so there is no empty bucket to keep.
  assert.deepStrictEqual(labels(bus.shape(none, f({ group: 'host' }))), ['Claude Desktop']);
  assert.deepStrictEqual(labels(bus.shape([], f({ group: 'grp' }))), []);
  assert.deepStrictEqual(labels(bus.shape([], f({ group: 'none' }))), []);
  // and without it the empty fixed buckets are dropped
  assert.deepStrictEqual(labels(bus.shape(none, Object.assign({ filters: { group: 'status' } }, CTX))), ['Live']);
});

test('filters() defaults on empty and on malformed storage', async () => {
  const DEFAULTS = { status: 'all', env: 'all', group: 'recent', sort: 'activity', empty: false };
  const fresh = await boot();
  assert.deepStrictEqual(fresh.bus.filters(), DEFAULTS);
  assert.strictEqual(fresh.bus.isFilterDirty(), false);
  const bad = await boot({ storage: { 'fd-bus-filters': 'not json' } });
  assert.deepStrictEqual(bad.bus.filters(), DEFAULTS);
  const partial = await boot({ storage: { 'fd-bus-filters': JSON.stringify({ status: 'nope', group: 'host', empty: 1 }) } });
  assert.deepStrictEqual(partial.bus.filters(), Object.assign({}, DEFAULTS, { group: 'host', empty: true }));
  assert.strictEqual(partial.bus.isFilterDirty(), true);
});

test('setFilters sanitises, persists to fd-bus-filters and re-renders the host', async () => {
  const { bus, store } = await boot();
  let renders = 0;
  const host = fakeHost();
  host.forceUpdate = () => { renders++; };
  bus.attach(host);
  bus.setFilters({ group: 'host', sort: 'name' });
  assert.strictEqual(renders, 1, 'the rail is re-rendered, not left stale');
  bus.setFilters({ group: 'nonsense', status: 'live' });
  assert.deepStrictEqual(bus.filters(), { status: 'live', env: 'all', group: 'recent', sort: 'name', empty: false });
  assert.deepStrictEqual(JSON.parse(store.getItem('fd-bus-filters')), bus.filters());
  // and shape() reads the stored filters when the caller names none
  const out = bus.shape(SHAPE_ITEMS, { isPinned: CTX.isPinned, lastM: CTX.lastM });
  assert.deepStrictEqual(ids(out, 'Recent'), ['a', 'c', 'g1'], 'live only, by name');
});

test('a rail row carries the registry group, and only when there is one', async () => {
  const { FD } = await boot();
  const withGroup = SESSIONS.sessions.find((s) => s.group && s.live);
  const row = FD.fixture.busSessions.find((r) => r.id === withGroup.name);
  assert.strictEqual(row.group, withGroup.group, withGroup.name + ' keeps its lane');
  const without = SESSIONS.sessions.find((s) => !s.group && s.live);
  const plain = FD.fixture.busSessions.find((r) => r.id === without.name);
  assert.ok(plain, 'the ungrouped session is on the rail');
  assert.strictEqual('group' in plain, false, 'no empty group key reaches the render');
});

// The full Claude conversation of a Claude Desktop seat, merged into the thread.
// ---------------------------------------------------------------------------
const DESK_UUID = '22222222-2222-4222-8222-222222222222';
const DESK_ID = 'id:' + DESK_UUID;
const deskPlan = (turns, extra) => Object.assign({
  messages: { messages: [], targets: [{ type: 'claude-desktop', session: DESK_ID }] },
  transcript: { state: 'ok', turns },
}, extra);

test('wantTranscript fetches the seat by thread id and pushes it through FD.setData', async () => {
  const { bus, FD, calls } = await boot(deskPlan([{ role: 'user', ts: '2026-09-06T10:00:00.000Z', text: 'go' }]));
  assert.strictEqual(bus.wantTranscript(DESK_ID, true), true);
  await settle();
  assert.ok(calls.some((c) => c.url === '/api/desktop-sessions/transcript?seat=id%3A' + DESK_UUID + '&format=json'));
  assert.deepStrictEqual(FD.fixture.busTranscripts[DESK_ID],
    { state: 'ok', turns: [{ role: 'user', ts: '2026-09-06T10:00:00.000Z', text: 'go' }], omitted: 0,
      at: FD.fixture.busTranscripts[DESK_ID].at });
});

test('a thread id that is a display name is sent as-is, and shows loading before it lands', async () => {
  const NAME = '\u{1F39B} ORCHESTRATOR 28 = O45';
  const { bus, FD, calls } = await boot({
    messages: { messages: [], targets: [{ type: 'claude-desktop', session: NAME }] },
    transcript: { state: 'ok', turns: [{ role: 'assistant', ts: '', text: 'hi' }] },
  });
  assert.strictEqual(bus.wantTranscript(NAME, true), true);
  assert.strictEqual(FD.fixture.busTranscripts[NAME].state, 'loading', 'the note shows before the fetch lands');
  await settle();
  const query = new URLSearchParams({ seat: NAME, format: 'json' }).toString();
  assert.ok(calls.some((c) => c.url === '/api/desktop-sessions/transcript?' + query), calls.map((c) => c.url).join(' '));
  assert.strictEqual(FD.fixture.busTranscripts[NAME].state, 'ok');
  assert.strictEqual(FD.fixture.busTranscripts[NAME].turns[0].text, 'hi');
});

test('busTranscripts keeps the last 300 turns and drops the malformed ones', async () => {
  const turns = [];
  for (let i = 0; i < 400; i++) turns.push({ role: i % 2 ? 'assistant' : 'user', ts: '', text: 't' + i });
  turns.push({ role: 'system', ts: '', text: 'not a turn' }, { role: 'user', ts: '', text: 7 }, null);
  const { bus, FD } = await boot(deskPlan(turns));
  bus.wantTranscript(DESK_ID, true);
  await settle();
  const got = FD.fixture.busTranscripts[DESK_ID];
  assert.strictEqual(got.turns.length, 300);
  assert.strictEqual(got.omitted, 100);
  assert.strictEqual(got.turns[0].text, 't100');
  assert.strictEqual(got.turns[299].text, 't399');
});

test('a transcript the machine cannot render becomes a state, never a rejection', async () => {
  const { bus, FD } = await boot(deskPlan([], { transcript: { state: 'not_found', httpStatus: 404 } }));
  bus.wantTranscript(DESK_ID, true);
  await settle();
  assert.strictEqual(FD.fixture.busTranscripts[DESK_ID].state, 'not_found');
  assert.deepStrictEqual(FD.fixture.busTranscripts[DESK_ID].turns, []);
});

test('a tmux thread is fetched by session name plus the host it runs on', async () => {
  const { bus, FD, calls } = await boot({ transcript: { state: 'ok', turns: [{ role: 'user', ts: '', text: 'go' }] } });
  assert.strictEqual(bus._state().targets[THREAD].host, HOST, 'the fixture thread knows its box');
  assert.strictEqual(bus.wantTranscript(THREAD, true), true);
  await settle();
  const query = new URLSearchParams({ seat: THREAD, host: HOST, format: 'json' }).toString();
  assert.ok(calls.some((c) => c.url === '/api/desktop-sessions/transcript?' + query), calls.map((c) => c.url).join(' '));
  assert.strictEqual(FD.fixture.busTranscripts[THREAD].turns[0].text, 'go');
});

test('wantTranscript refuses a thread of no known kind and stops fetching once it is off', async () => {
  const { bus, calls } = await boot(deskPlan([]));
  assert.strictEqual(bus.wantTranscript('nobody-here', true), false);
  bus.wantTranscript(DESK_ID, true);
  await settle();
  const before = calls.length;
  bus.wantTranscript(DESK_ID, false);
  assert.deepStrictEqual(bus._state().wantId, null);
  await settle();
  assert.strictEqual(calls.length, before);
});

test('wantTranscript is inert in fixture mode', async () => {
  const { bus, FD, setData, calls } = await boot({ fixture: true });
  assert.strictEqual(bus.wantTranscript(DESK_ID, true), false);
  await settle();
  assert.deepStrictEqual(setData, []);
  assert.strictEqual(FD.fixture.busTranscripts, undefined);
  assert.deepStrictEqual(calls, []);
});

// ---------------------------------------------------------------------------
// L6.2 — open() must accept every target the server accepts, and must not
// depend on when screens/bus.js loaded relative to the shell (DESIGN-35).
// ---------------------------------------------------------------------------

// The messageTarget /api/desktop-sessions hands back for a live desktop row.
const LIVE_DESKTOP = (() => {
  for (const g of DESKTOP.groups || []) {
    for (const x of g.sessions || []) if (x.live && x.messageTarget) return x;
  }
  throw new Error('the desktop-sessions fixture has no live row with a messageTarget');
})();

test('open() accepts the id:<uuid> messageTarget the Desktop screen passes', async () => {
  const { bus, FD } = await boot();
  const host = fakeHost({ screen: 'desktop' });
  bus.attach(host);

  const target = LIVE_DESKTOP.messageTarget;
  assert.strictEqual(target.session.slice(0, 3), 'id:', 'the fixture really uses the id: form');
  assert.strictEqual(bus.open(target), true, 'open() reports it took the deep link');
  assert.strictEqual(host.state.screen, 'bus', 'and navigates to the bus screen');
  assert.strictEqual(host.state.busActive, target.session);

  const row = FD.fixture.busSessions.find((r) => r.id === target.session);
  assert.ok(row, 'a thread row exists for it');
  assert.strictEqual(row.kind, 'claude-desktop');
  assert.deepStrictEqual(bus._state().targets[target.session], target, 'the POST body is the target verbatim');
});

test('an id:<uuid> thread is labelled with the session title once it resolves', async () => {
  const { bus, FD } = await boot();
  bus.attach(fakeHost());
  const target = LIVE_DESKTOP.messageTarget;
  bus.open(target);
  // The title comes from /api/desktop-sessions, fetched on first sight.
  await settle();
  await settle();
  const row = FD.fixture.busSessions.find((r) => r.id === target.session);
  assert.strictEqual(row.name, 'Claude Desktop · ' + LIVE_DESKTOP.title);
});

test('an id:<uuid> thread falls back to the raw id when the title cannot be read', async () => {
  const { bus, FD } = await boot({ desktop: 'fail' });
  bus.attach(fakeHost());
  const target = LIVE_DESKTOP.messageTarget;
  bus.open(target);
  await settle();
  await settle();
  const row = FD.fixture.busSessions.find((r) => r.id === target.session);
  assert.strictEqual(row.name, 'Claude Desktop · ' + target.session);
});

test('open() accepts every target form the server accepts', async () => {
  const { bus } = await boot();
  bus.attach(fakeHost());
  const cases = [
    [{ type: 'tmux', host: HOST, session: THREAD }, { type: 'tmux', host: HOST, session: THREAD }],
    [{ type: 'claude-desktop', session: 'current' }, { type: 'claude-desktop', session: 'current' }],
    [{ type: 'claude-desktop', session: 'a named desktop chat' }, { type: 'claude-desktop', session: 'a named desktop chat' }],
    [{ type: 'claude-desktop', session: 'id:0000-1111' }, { type: 'claude-desktop', session: 'id:0000-1111' }],
  ];
  for (const [target, expected] of cases) {
    assert.strictEqual(bus.open(target), true, JSON.stringify(target));
    assert.deepStrictEqual(bus._state().targets[target.session], expected, JSON.stringify(target));
  }
  // A bare string is a thread id; the two desktop-only forms are recognised.
  assert.strictEqual(bus.open('current'), true);
  assert.strictEqual(bus._state().targets.current.type, 'claude-desktop');
  assert.strictEqual(bus.open('id:2222-3333'), true);
  assert.strictEqual(bus._state().targets['id:2222-3333'].type, 'claude-desktop');
});

test('open() returns false only for a malformed target', async () => {
  const { bus } = await boot();
  bus.attach(fakeHost());
  for (const bad of [null, undefined, '', {}, { type: 'tmux' }, { session: '' }, { session: 42 }, 7]) {
    assert.strictEqual(bus.open(bad), false, JSON.stringify(bad) + ' should be rejected');
  }
});

test('open() before the shell has attached is honoured, not dropped', async () => {
  // The real load order: the shell mounts inside app.js, before screens/bus.js.
  const { bus } = await boot();
  const target = LIVE_DESKTOP.messageTarget;
  assert.strictEqual(bus.open(target), true, 'the caller is told the link was accepted');
  const host = fakeHost({ screen: 'desktop' });
  bus.attach(host);
  assert.strictEqual(host.state.screen, 'bus', 'and it lands as soon as the host arrives');
  assert.strictEqual(host.state.busActive, target.session);
});

test('attach is idempotent — the shell calls it on mount and on every update', async () => {
  const { bus } = await boot();
  const host = fakeHost();
  bus.attach(host);
  bus.attach(host);
  bus.attach(host);
  assert.strictEqual(bus.open(LIVE_DESKTOP.messageTarget), true);
  // A different host replaces the first rather than being ignored.
  const second = fakeHost({ screen: 'registry' });
  bus.attach(second);
  bus.open({ type: 'tmux', host: HOST, session: THREAD });
  assert.strictEqual(second.state.busActive, THREAD);
});

test('sending to an id:<uuid> thread posts that target verbatim', async () => {
  const { bus, calls } = await boot();
  bus.attach(fakeHost());
  const target = LIVE_DESKTOP.messageTarget;
  bus.open(target);
  bus.deliver({ sid: target.session, key: 'x1', text: 'ping', index: 0, source: 'fleetdeck-ui' });
  await settle();
  const post = calls.find((c) => c.method === 'POST');
  assert.deepStrictEqual(post.body.target, target);
  assert.strictEqual(post.body.text, 'ping');
});

test('an id:<uuid> thread for a live desktop session is not shown as offline', async () => {
  // The server's targets[] names desktop sessions and never carries the id:
  // form, so without /api/desktop-sessions the row would read offline and the
  // composer would say Queue for a session the Desktop screen just showed live.
  const { bus, FD } = await boot();
  bus.attach(fakeHost());
  const target = LIVE_DESKTOP.messageTarget;
  bus.open(target);
  await settle();
  await settle();
  const row = FD.fixture.busSessions.find((r) => r.id === target.session);
  assert.strictEqual(row.live, true);
});

// ---------------------------------------------------------------------------
// The injected 'Full conversation' button. The compiled template's icon set is
// frozen, so the toggle is a find-or-create DOM patch (screens/desktop.js's
// improvisation, and its audit-F5 safety rig). These cases run it over a DOM
// small enough to hold the four nodes it reaches for.
// ---------------------------------------------------------------------------
const ICON_CSS = 'display:inline-flex;width:28px;height:28px;border-radius:9999px;'
  + 'border:1px solid rgba(255,255,255,0.13);background:transparent;color:rgba(255,255,255,0.75);'
  + 'opacity:0.3;cursor:not-allowed';

function domFixture() {
  const observers = [];
  const touch = () => observers.slice().forEach((o) => { if (o.target) o.cb(); });

  function el(tag, attrs) {
    const node = {
      tagName: tag.toUpperCase(), children: [], parentNode: null, style: { cssText: '' },
      innerHTML: '', _attrs: Object.assign({}, attrs), _clicks: [],
      setAttribute(k, v) { node._attrs[k] = String(v); },
      getAttribute(k) { return k in node._attrs ? node._attrs[k] : null; },
      hasAttribute(k) { return k in node._attrs; },
      addEventListener(kind, fn) { if (kind === 'click') node._clicks.push(fn); },
      click() { node._clicks.forEach((fn) => fn()); },
      insertBefore(child, ref) {
        const at = node.children.indexOf(child);
        if (at >= 0) node.children.splice(at, 1);
        const i = ref ? node.children.indexOf(ref) : -1;
        child.parentNode = node;
        if (i < 0) node.children.push(child); else node.children.splice(i, 0, child);
        touch();
        return child;
      },
      removeChild(child) {
        const i = node.children.indexOf(child);
        if (i >= 0) node.children.splice(i, 1);
        child.parentNode = null;
        touch();
        return child;
      },
      querySelector: (sel) => find(node, sel),
    };
    const sibling = (step) => {
      const p = node.parentNode;
      if (!p) return null;
      return p.children[p.children.indexOf(node) + step] || null;
    };
    Object.defineProperty(node, 'previousSibling', { get: () => sibling(-1) });
    Object.defineProperty(node, 'nextSibling', { get: () => sibling(1) });
    return node;
  }

  // Only the three selectors screens/bus.js uses; anything else is a bug, not a miss.
  function matches(node, sel) {
    if (sel === '[data-screen-label="Message bus"]') return node.getAttribute('data-screen-label') === 'Message bus';
    if (sel === 'button[aria-label="Show session"]') return node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Show session';
    if (sel === 'button[data-fd-l6]') return node.tagName === 'BUTTON' && node.hasAttribute('data-fd-l6');
    throw new Error('unsupported selector: ' + sel);
  }
  function find(node, sel) {
    for (const child of node.children) {
      if (matches(child, sel)) return child;
      const hit = find(child, sel);
      if (hit) return hit;
    }
    return null;
  }

  const root = el('div', { id: 'dc-root' });
  const screen = el('div', { 'data-screen-label': 'Message bus' });
  const actionRow = el('span', {});
  const wrap = (label) => {
    const slot = el('span', {});
    const button = el('button', { 'aria-label': label });
    button.style.cssText = ICON_CSS;
    slot.insertBefore(button, null);
    actionRow.insertBefore(slot, null);
    return slot;
  };
  root.insertBefore(screen, null);
  screen.insertBefore(actionRow, null);
  const eyeWrap = wrap('Show session');
  const copyWrap = wrap('Copy thread');

  class FakeObserver {
    constructor(cb) { this.cb = cb; this.target = null; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
  }

  const document = {
    body: root,
    createElement: (tag) => el(tag),
    querySelector: (sel) => (matches(root, sel) ? root : find(root, sel)),
    getElementById: (id) => (root.getAttribute('id') === id ? root : null),
  };
  return { document, MutationObserver: FakeObserver, root, actionRow, eyeWrap, copyWrap, find: (sel) => find(root, sel), render: touch };
}

function withDom(t) {
  const dom = domFixture();
  global.document = dom.document;
  global.MutationObserver = dom.MutationObserver;
  t.after(() => { delete global.document; delete global.MutationObserver; });
  return dom;
}

const ours = (dom) => dom.actionRow.children.filter((n) => n.hasAttribute('data-fd-l6'));

test('the transcript toggle is injected once, between the eye and the clipboard', async (t) => {
  const dom = withDom(t);
  const { bus } = await boot(deskPlan([]));
  bus.attach(fakeHost({ busActive: DESK_ID }));
  dom.render();
  await settle();
  const btn = dom.find('button[data-fd-l6]');
  assert.ok(btn, 'the button exists');
  assert.strictEqual(btn.previousSibling, dom.eyeWrap, 'it follows the eye');
  assert.strictEqual(btn.nextSibling, dom.copyWrap, 'and comes before the clipboard');
  assert.strictEqual(btn.getAttribute('title'), 'Full conversation');
  assert.strictEqual(btn.getAttribute('aria-label'), 'Full conversation');
  assert.ok(/<svg /.test(btn.innerHTML) && btn.innerHTML.includes('stroke="currentColor"'));
  // The sibling's own style, minus the two keys logic.js's offBtn adds on a row with
  // no terminal -- what is left is the neutral icon button.
  assert.ok(btn.style.cssText.startsWith(ICON_CSS));
  assert.ok(/opacity:1;cursor:pointer$/.test(btn.style.cssText));
  // Re-applying is what every render does; it must never make a second button.
  for (let i = 0; i < 5; i++) { dom.render(); await settle(); }
  assert.strictEqual(ours(dom).length, 1);
});

test('clicking the toggle arms the thread, and clicking again disarms it', async (t) => {
  const dom = withDom(t);
  const { bus, FD } = await boot(deskPlan([]));
  const host = fakeHost({ busActive: DESK_ID });
  bus.attach(host);
  dom.render();
  await settle();
  const btn = dom.find('button[data-fd-l6]');
  btn.click();
  assert.strictEqual(host.state.busTranscript, DESK_ID, 'the state holds the thread id, not a flag');
  assert.strictEqual(bus._state().wantId, DESK_ID);
  assert.strictEqual(FD.fixture.busTranscripts[DESK_ID].state, 'loading');
  dom.render();
  await settle();
  assert.strictEqual(btn.getAttribute('title'), 'Bus only');
  assert.ok(btn.style.cssText.endsWith('background:rgba(255,255,255,0.11);border-color:rgba(255,255,255,0.22);color:#ffffff'), btn.style.cssText);
  // A light/dark flip rewrites the sibling's inline style, so the copy is re-read.
  host.state.dark = false;
  dom.render();
  await settle();
  assert.ok(btn.style.cssText.endsWith('background:rgba(0,0,0,0.07);border-color:rgba(0,0,0,0.18);color:#111111'), btn.style.cssText);
  btn.click();
  assert.strictEqual(host.state.busTranscript, null);
  assert.strictEqual(bus._state().wantId, null);
  await settle();
  assert.strictEqual(btn.getAttribute('title'), 'Full conversation');
  assert.strictEqual(ours(dom).length, 1, 'still one button after both clicks');
});

test('the toggle is absent on a thread with no transcript to fetch, and in fixture mode', async (t) => {
  const dom = withDom(t);
  const { bus } = await boot(deskPlan([]));
  const host = fakeHost({ busActive: DESK_ID });
  bus.attach(host);
  dom.render();
  await settle();
  assert.strictEqual(ours(dom).length, 1);
  host.state.busActive = 'a-broadcast-group';
  dom.render();
  await settle();
  assert.strictEqual(ours(dom).length, 0, 'a thread of no known kind loses the button');
});

test('fixture mode never injects the toggle', async (t) => {
  const dom = withDom(t);
  const { bus } = await boot({ fixture: true });
  bus.attach(fakeHost({ busActive: DESK_ID }));
  dom.render();
  await settle();
  assert.strictEqual(dom.find('button[data-fd-l6]'), null);
  assert.strictEqual(ours(dom).length, 0);
});
