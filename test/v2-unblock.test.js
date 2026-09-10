// The Unblock screen's pure half. The explain whitelist, what counts as pending and the payload
// envelope are asserted here; the DOM half is asserted by the pixel gate, which renders the
// fixture sample below.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// data.js first, exactly as public/v2/index.html loads it: both files publish onto globalThis.FD.
require(path.join(ROOT, 'public/v2/data.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/v2/screens/unblock.js'), 'utf8');
const screen = require(path.join(ROOT, 'public/v2/screens/unblock.js'));
const _ = screen._;

const text = (tokens) => tokens.map((t) => (t.br ? '\n' : t.text)).join('');

test('the explain box keeps the six inline tags the skill allows', () => {
  const tokens = _.explainTokens('plain <b>bold</b> <i>it</i> <code>x</code><br>next');
  assert.deepStrictEqual(tokens.filter((t) => t.text === 'bold')[0].tags, ['b']);
  assert.deepStrictEqual(tokens.filter((t) => t.text === 'it')[0].tags, ['i']);
  assert.deepStrictEqual(tokens.filter((t) => t.text === 'x')[0].tags, ['code']);
  assert.ok(tokens.some((t) => t.br), '<br> is a break, not text');
  assert.strictEqual(text(tokens), 'plain bold it x\nnext');
});

test('nesting is kept, so <b><code>x</code></b> is both', () => {
  const tokens = _.explainTokens('<b><code>up.sh</code></b>');
  assert.deepStrictEqual(tokens[0], { text: 'up.sh', tags: ['b', 'code'] });
});

test('a script tag is not a tag here — it is characters the operator sees', () => {
  const tokens = _.explainTokens('a<script>alert(1)</script>b');
  assert.strictEqual(text(tokens), 'a<script>alert(1)</script>b');
  assert.ok(tokens.every((t) => !t.tags || !t.tags.length), 'nothing about it is markup');
});

test('an attribute drops a whitelisted tag back to text', () => {
  const tokens = _.explainTokens('<b onclick="steal()">x</b>');
  // The open tag was never honoured, so its close matches nothing and is text too.
  assert.strictEqual(text(tokens), '<b onclick="steal()">x</b>', 'both tags are shown as written');
  assert.deepStrictEqual(tokens.filter((t) => t.text === 'x')[0].tags, [], 'and it wraps nothing');
  assert.strictEqual(_.explainTokens('<img src=x onerror=alert(1)>').length, 1, 'an img is text too');
});

test('the screen builds itself with createElement and textContent only', () => {
  assert.doesNotMatch(SOURCE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
    'unblock.js must never parse a string as markup');
});

const q = (id) => ({ id, topic: id, decision: 'decide ' + id, options: [{ key: 'a', label: 'A' }] });
const QS = [q('one'), q('two'), q('three')];

test('an answer is pending only while it is chosen and not yet sent', () => {
  const answers = {
    one: { choice: 'a', dirty: true },
    two: { choice: 'a', dirty: false },
    three: { choice: null, dirty: true },
  };
  assert.deepStrictEqual(_.pendingIds(QS, answers), ['one']);
  assert.deepStrictEqual(_.answeredIds(QS, answers), ['one', 'two']);
  assert.deepStrictEqual(_.pendingIds(QS, {}), [], 'an untouched sheet sends nothing');
  assert.strictEqual(_.isDirty(undefined), false);
});

test('the chip says where the card is, and whether it still owes a send', () => {
  assert.strictEqual(_.chipText(1, 3, 'Deploy route', undefined), '1/3 · Deploy route');
  assert.strictEqual(_.chipText(2, 3, 'Deploy route', { choice: 'a', dirty: false }), '2/3 · Deploy route ✓');
  assert.strictEqual(_.chipText(3, 3, 'Deploy route', { choice: 'a', dirty: true }), '3/3 · Deploy route ✓ · not sent');
});

test('the two standard options are appended to every card', () => {
  const keys = _.options(q('one')).map((o) => o.key);
  assert.deepStrictEqual(keys, ['a', 'you-decide', 'more-info']);
  assert.deepStrictEqual(_.options({}).map((o) => o.key), ['you-decide', 'more-info'],
    'a question with no options still offers both');
});

test('the payload preview is the skill envelope, and says when it is a subset', () => {
  const answers = { one: { choice: 'a', choiceLabel: 'A', answeredAt: '2026-09-10T06:00:00Z', note: 'ship it', noteAt: '2026-09-10T06:01:00Z' } };
  const partial = JSON.parse(_.payloadText({ title: 'Sheet' }, QS, answers, ['one']));
  assert.strictEqual(partial.sheet, 'adhd-unblock');
  assert.strictEqual(partial.title, 'Sheet');
  assert.strictEqual(partial.answered, '1/3');
  assert.strictEqual(partial.partial, true);
  assert.deepStrictEqual(partial.answers, [{
    id: 'one', decision: 'decide one', choice: 'a', choiceLabel: 'A',
    answeredAt: '2026-09-10T06:00:00Z', note: 'ship it', noteAt: '2026-09-10T06:01:00Z',
  }]);
  const full = JSON.parse(_.payloadText({ title: 'Sheet' }, QS, answers, ['one', 'two', 'three']));
  assert.strictEqual(full.partial, undefined, 'the whole sheet is not a subset');
  assert.strictEqual(full.answers.length, 3);
});

test('closed sheets stay behind the toggle', () => {
  const sheets = [{ id: 'a', status: 'open' }, { id: 'b', status: 'closed' }];
  assert.deepStrictEqual(_.visibleSheets(sheets, false).map((s) => s.id), ['a']);
  assert.deepStrictEqual(_.visibleSheets(sheets, true).map((s) => s.id), ['a', 'b']);
  assert.deepStrictEqual(_.visibleSheets(undefined, true), [], 'no sheets is not a throw');
});

test('the time line names both stamps, and an unanswered card has none', () => {
  const line = _.whenLine({ answeredAt: '2026-09-10T06:00:00Z', noteAt: '2026-09-10T06:01:00Z' });
  assert.match(line, /^🕒 answered .+ · ✏️ note .+$/);
  assert.strictEqual(_.whenLine({ answeredAt: '2026-09-10T06:00:00Z' }).indexOf('✏️'), -1);
  assert.strictEqual(_.whenLine({}), '');
  assert.strictEqual(_.whenLine(null), '');
  assert.strictEqual(_.fmt('not a date'), '', 'a broken stamp is blank, never "Invalid Date"');
});

test('the hide-answered toggle keeps the standalone template\'s storage key', () => {
  assert.strictEqual(_.HIDE_KEY, 'adhd-unblock:hide');
});

test('the fixture sample is the deterministic screen the pixel gate renders', () => {
  const v = _.FIXTURE_VIEW;
  assert.strictEqual(v.sheets.length, 1);
  assert.strictEqual(v.sheet.questions.length, 2);
  assert.strictEqual(_.answeredIds(v.sheet.questions, v.answers).length, 1, 'one answered');
  assert.deepStrictEqual(_.pendingIds(v.sheet.questions, v.answers), ['deploy-route'], 'and not yet sent');
  assert.ok(v.sheet.questions.every((qq) => qq.options.some((o) => o.recommended)), 'every card has a ⭐');
});

test('a stamp lands on the operator\'s calendar day, and a broken one on none', () => {
  const local = new Date(2026, 8, 10, 13, 30).toISOString();
  assert.strictEqual(_.dayKey(local), '2026-09-10');
  assert.strictEqual(_.dayKey('not a date'), '');
  assert.strictEqual(_.dayKey(null), '');
});

const sheet = (id, project, at, status) => ({
  id, status: status || 'open', created_at: at,
  source: project === undefined ? undefined : { seat: 'S', project },
});
const D1 = new Date(2026, 8, 10, 9, 0).toISOString();
const D0 = new Date(2026, 8, 9, 22, 0).toISOString();
const SHEETS = [
  sheet('a', 'remote-system', D1), sheet('b', 'lowcap', D1), sheet('c', undefined, D0),
  sheet('d', 'remote-system', D0, 'closed'),
];

test('the selector offers every repo the seats posted from, sorted, plus the ones with none', () => {
  assert.deepStrictEqual(_.repoOptions(SHEETS), { repos: ['lowcap', 'remote-system'], none: true });
  assert.deepStrictEqual(_.repoOptions([sheet('a', 'lowcap', D1)]), { repos: ['lowcap'], none: false });
  assert.deepStrictEqual(_.repoOptions(undefined), { repos: [], none: false }, 'no sheets is not a throw');
  assert.strictEqual(_.repoOf(sheet('a', 42, D1)), '', 'a non-string project is no repository');
  assert.strictEqual(_.repoOf({}), '');
});

test('the pager walks the days newest first, counting the sheets on each', () => {
  assert.deepStrictEqual(_.dayPages(SHEETS), [
    { key: '2026-09-10', count: 2 }, { key: '2026-09-09', count: 2 },
  ]);
  assert.deepStrictEqual(_.dayPages([sheet('a', 'lowcap', 'not a date')]), [], 'an unstamped sheet has no day');
});

test('a day that is no longer there falls back to the newest one', () => {
  const pages = _.dayPages(SHEETS);
  assert.strictEqual(_.pickDay(pages, '2026-09-09'), '2026-09-09', 'a day still there is kept');
  assert.strictEqual(_.pickDay(pages, '2026-09-01'), '2026-09-10', 'a day the filter dropped is not');
  assert.strictEqual(_.pickDay(pages, ''), '2026-09-10', 'and nothing chosen means the newest');
  assert.strictEqual(_.pickDay([], ''), '');
});

test('the day label says Today and Yesterday before it says a date', () => {
  const now = new Date(2026, 8, 10, 12, 0).toISOString();
  assert.strictEqual(_.dayLabel('2026-09-10', now), 'Today');
  assert.strictEqual(_.dayLabel('2026-09-09', now), 'Yesterday');
  assert.strictEqual(_.dayLabel('2026-09-04', now),
    new Date(2026, 8, 4).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
  assert.strictEqual(_.dayLabel('', now), '');
});

test('the day selector offers every page the arrows walk, newest first, counted', () => {
  const now = new Date(2026, 8, 10, 12, 0).toISOString();
  assert.deepStrictEqual(_.dayOptions(_.dayPages(SHEETS), now), [
    { value: '2026-09-10', label: 'Today · 2' }, { value: '2026-09-09', label: 'Yesterday · 2' },
  ]);
  const none = [{ value: '', label: 'No days' }];
  assert.deepStrictEqual(_.dayOptions([], now), none, 'no days is still one thing to read');
  assert.deepStrictEqual(_.dayOptions(undefined, now), none);
});

test('the list rows pass the closed toggle, then the repo, then the day', () => {
  const ids = (o) => _.filterSheets(SHEETS, o).map((s) => s.id);
  assert.deepStrictEqual(ids({}), ['a', 'b', 'c'], 'closed stays behind its toggle');
  assert.deepStrictEqual(ids({ showClosed: true, day: '2026-09-09' }), ['c', 'd']);
  assert.deepStrictEqual(ids({ repo: 'remote-system' }), ['a']);
  assert.deepStrictEqual(ids({ repo: '-' }), ['c'], '- is the sheets that name no repository');
  assert.deepStrictEqual(ids({ repo: 'lowcap', day: '2026-09-09' }), [], 'and both together can be empty');
  assert.deepStrictEqual(ids({ showClosed: true, repo: 'remote-system', day: '2026-09-09' }), ['d']);
});

test('the repo choice is remembered under its own key', () => {
  assert.strictEqual(_.REPO_KEY, 'adhd-unblock:repo');
});
