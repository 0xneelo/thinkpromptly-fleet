// The Message bus bubble colours, and the transcript merge behind the thread header's
// 'Full conversation' button.
//
// public/v2/logic.js is a classic script the browser loads next to the compiled app, so
// each case evaluates it in a vm context with a stubbed FD and reads what renderVals()
// returns. FD.fixture starts as the mock's own seed (public/v2/fixture.js) and is
// overridden per case exactly the way screens/bus.js overrides it through FD.setData.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FIXTURE_JS = fs.readFileSync(path.join(ROOT, 'public/v2/fixture.js'), 'utf8');
const LOGIC_JS = fs.readFileSync(path.join(ROOT, 'public/v2/logic.js'), 'utf8');

const DESK = 'id:22222222-2222-4222-8222-222222222222';
const TMUX = 'tmux';
const WORKER = 'FD-v2-l11';
const iso = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

function render({ state = {}, props = {}, data = null } = {}) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: '', hash: '' },
    navigator: { clipboard: { writeText() {} } },
    document: { querySelector: () => null, addEventListener() {} },
    DCLogic: class DCLogic {},
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(FIXTURE_JS, ctx);
  vm.runInContext(LOGIC_JS, ctx);
  ctx.FD.data = { ago: () => 'a while ago' };
  if (data) Object.assign(ctx.FD.fixture, data);
  return vm.runInContext(`(function (props, state) {
    const host = { props, state: {}, forceUpdate() {}, _rootEl: null };
    const logic = new AppLogic(host, 'app');
    logic.state = Object.assign({}, logic.state, state);
    return logic.renderVals();
  })`, ctx)(props, Object.assign({ screen: 'bus' }, state));
}

// A live Claude thread: two bus messages and two transcript turns, whose ages interleave
// (operator 6m, sent 5m, received 4m, agent 3m). A tmux worker's thread is the same shape
// with another `kind`, and a host beside it -- the merge must not tell the two apart.
const liveData = (id = DESK, kind = 'claude-desktop') => ({
  busSessions: [{ id, name: kind === TMUX ? id : 'Claude Desktop · seat', host: kind === TMUX ? 'german-box' : '', live: true, kind }],
  busGroups: [],
  busUnreadDefault: {},
  busActiveDefault: id,
  seedThreads: {
    [id]: [
      { k: 'm1', dir: 'out', from: 'fleetdeck-ui', at: '5m ago', m: 5, status: 'delivered', text: 'ping' },
      { k: 'm2', dir: 'in', from: 'seat', at: '4m ago', m: 4, text: 'pong' },
    ],
  },
  busTranscripts: {
    [id]: {
      state: 'ok', omitted: 2, at: Date.now(),
      turns: [
        { role: 'user', ts: iso(6), text: 'operator turn' },
        { role: 'assistant', ts: iso(3), text: 'agent turn' },
      ],
    },
  },
});

const showAction = (vals) => vals.thActions.find((a) => a.id === 'show');

test('a fixture thread keeps the mock two greys — no bubble is tinted', () => {
  const vals = render({ state: { busActive: 'dorothea' } });
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.rowStyle.justifyContent), ['flex-end', 'flex-start']);
  for (const m of vals.thMsgs) {
    assert.equal(String(m.wrapStyle.background || '').includes('oklch'), false);
    assert.equal(String(m.fromStyle.color).includes('oklch'), false);
  }
});

test('the eye keeps its one job on every row type -- the transcript is its own button', () => {
  assert.equal(showAction(render({ state: { busActive: 'ermenhild' } })).label, 'Show session');
  const desk = showAction(render({ state: { busActive: DESK }, data: liveData() }));
  assert.equal(desk.label, 'Show session');
  assert.equal(desk.desc, 'Claude Desktop threads have no tmux terminal to show.');
  const tmux = showAction(render({ state: { busActive: WORKER }, data: liveData(WORKER, TMUX) }));
  assert.equal(tmux.label, 'Show session');
  assert.equal(tmux.desc, "Open this session's live terminal full screen.");
});

test('the merge follows the thread the toggle was armed on, not the open view', () => {
  const off = render({ state: { busActive: DESK }, data: liveData() });
  assert.equal(off.thMsgs.length, 2, 'the bus messages alone until the button is pressed');
  // busActive also moves through a toast and a broadcast send, and neither passes through
  // the rail's own off-toggle, so a bare flag would merge into the thread the user left.
  const moved = render({ state: { busActive: DESK, busTranscript: 'ermenhild' }, data: liveData() });
  assert.equal(moved.thMsgs.length, 2, 'a toggle armed elsewhere merges nothing here');
});

test("a tmux worker's transcript merges and tints exactly as a seat's does", () => {
  const vals = render({ state: { busActive: WORKER, busTranscript: WORKER }, data: liveData(WORKER, TMUX) });
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.text),
    ['… 2 earlier turns not shown', 'operator turn', 'ping', 'pong', 'agent turn']);
  const [, op, sent, recv, agent] = vals.thMsgs;
  assert.deepEqual([sent, recv, op, agent].map((m) => m.wrapStyle.background),
    ['oklch(0.75 0.13 250 / 0.20)', 'oklch(0.83 0.15 155 / 0.14)',
      'oklch(0.83 0.14 80 / 0.16)', 'oklch(0.78 0.13 300 / 0.16)']);
  assert.equal(new Set([sent, recv, op, agent].map((m) => m.fromStyle.color)).size, 4);
});

test('transcript turns merge into the thread by age, oldest first', () => {
  const vals = render({ state: { busActive: DESK, busTranscript: DESK }, data: liveData() });
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.text),
    ['… 2 earlier turns not shown', 'operator turn', 'ping', 'pong', 'agent turn']);
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.rowStyle.justifyContent),
    ['flex-start', 'flex-end', 'flex-end', 'flex-start', 'flex-start']);
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.from), ['', 'operator', 'fleetdeck-ui', 'seat', 'agent']);
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.showFrom), [false, true, false, true, true]);
  // A receipt and a retry belong to a message the deck sent, and to nothing else.
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.receipts.length), [0, 0, 1, 0, 0]);
  assert.equal(vals.thMsgs[1].at, 'a while ago', 'a turn is stamped by the shared time formatter');
});

test('the four sources get four distinct tints, each bordered in its own hue', () => {
  const [, op, sent, recv, agent] = render({ state: { busActive: DESK, busTranscript: DESK }, data: liveData() }).thMsgs;
  const bg = [sent, recv, op, agent].map((m) => m.wrapStyle.background);
  assert.equal(new Set(bg).size, 4, 'four backgrounds, no two alike');
  assert.deepEqual(bg, ['oklch(0.75 0.13 250 / 0.20)', 'oklch(0.83 0.15 155 / 0.14)',
    'oklch(0.83 0.14 80 / 0.16)', 'oklch(0.78 0.13 300 / 0.16)']);
  assert.deepEqual([sent, recv, op, agent].map((m) => String(m.wrapStyle.border)),
    ['1px solid oklch(0.75 0.13 250 / 0.45)', '1px solid oklch(0.83 0.15 155 / 0.40)',
      '1px solid oklch(0.83 0.14 80 / 0.45)', '1px solid oklch(0.78 0.13 300 / 0.40)']);
  assert.equal(new Set([sent, recv, op, agent].map((m) => m.fromStyle.color)).size, 4);
});

test('statusColors off falls back to the two greys plus a border', () => {
  const vals = render({ state: { busActive: DESK, busTranscript: DESK }, data: liveData(), props: { statusColors: false } });
  const [note, op, sent, recv, agent] = vals.thMsgs;
  assert.equal(op.wrapStyle.background, sent.wrapStyle.background);
  assert.equal(agent.wrapStyle.background, recv.wrapStyle.background);
  assert.match(op.wrapStyle.border, /^1px solid /);
  assert.match(agent.wrapStyle.border, /^1px dashed /);
  assert.match(note.wrapStyle.border, /^1px dashed /);
  for (const m of vals.thMsgs) assert.equal(String(m.fromStyle.color).includes('oklch'), false);
});

test('a delivered bus message is not doubled, and another sender keeps its own blue bubble', () => {
  const wrap = (from, text) =>
    '<cross-session-message from="fleetdeck:' + from + '" from-name="' + from + '" from-mode="bypass">\n'
    + text + '\n</cross-session-message>';
  const data = liveData();
  data.busTranscripts[DESK] = {
    state: 'ok', omitted: 0, at: Date.now(),
    turns: [
      // The seat's own copy of the 'ping' this deck sent: the blue bus bubble already is it.
      { role: 'user', ts: iso(5), text: 'The user sent:\n' + wrap('fleetdeck-ui', ' ping ') },
      { role: 'user', ts: iso(2), text: wrap('O45', 'from another seat') },
    ],
  };
  const vals = render({ state: { busActive: DESK, busTranscript: DESK }, data });
  assert.deepEqual(Array.from(vals.thMsgs, (m) => m.text), ['ping', 'pong', 'from another seat']);
  const relay = vals.thMsgs[2];
  assert.equal(relay.rowStyle.justifyContent, 'flex-end', 'a cross-session delivery is a sent bubble');
  assert.equal(relay.wrapStyle.background, 'oklch(0.75 0.13 250 / 0.20)');
  assert.equal(relay.from, 'O45');
  assert.equal(relay.at, 'O45 · a while ago');
  assert.equal(relay.receipts.length, 0, 'the deck has no receipt for a message it did not send');
  assert.equal(relay.canRetry, false);
});

test('a transcript that has not arrived is one neutral note, never an empty thread', () => {
  for (const [state, text] of [
    ['loading', 'Loading the conversation…'],
    ['not_found', 'No transcript found for this session on its machine.'],
    ['unavailable', 'Transcript unavailable — the machine did not answer.'],
  ]) {
    const data = liveData();
    data.busTranscripts[DESK] = { state, omitted: 0, turns: [], at: 0 };
    const vals = render({ state: { busActive: DESK, busTranscript: DESK }, data });
    assert.deepEqual(Array.from(vals.thMsgs, (m) => m.text), ['ping', 'pong', text]);
    const note = vals.thMsgs[2];
    assert.equal(note.rowStyle.justifyContent, 'flex-start');
    assert.equal(note.textStyle.fontStyle, 'italic');
    assert.equal(note.showFrom, false);
  }
});
