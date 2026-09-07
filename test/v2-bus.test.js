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
  global.window = { FD, localStorage: store, location };
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
    if (url.startsWith('/api/sessions')) return answer(plan.sessions === undefined ? SESSIONS : plan.sessions);
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
  };
  return host;
}

const settle = () => new Promise((r) => setTimeout(r, 10));

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
  assert.strictEqual(bus.open({ type: 'tmux', host: HOST, session: THREAD }), false);
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
