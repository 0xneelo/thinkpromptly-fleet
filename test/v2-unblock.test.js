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

test('the rail groups the rows by repository, with the unnamed ones last', () => {
  const shape = _.groupByRepo(SHEETS).map((g) => [g.repo, g.rows.map((s) => s.id)]);
  assert.deepStrictEqual(shape, [
    ['lowcap', ['b']], ['remote-system', ['a', 'd']], ['(no repository)', ['c']],
  ]);
  assert.strictEqual(_.NO_REPO, '(no repository)', 'the bucket is named like the selector option');
  assert.deepStrictEqual(_.groupByRepo([]), [], 'no sheets is no groups');
  assert.deepStrictEqual(_.groupByRepo(undefined), []);
});

test('the repo choice is remembered under its own key', () => {
  assert.strictEqual(_.REPO_KEY, 'adhd-unblock:repo');
});

// DECK-108: the operator sign-in bar, the per-answer signature line, and a refused write.
test('the sign-in bar draws the form, who is signed in, the read-only bar, or nothing', () => {
  assert.strictEqual(_.signinMode({ configured: true, signedIn: false }), 'out', 'the password form');
  assert.strictEqual(_.signinMode({ configured: true, signedIn: true, operatorId: 'neelo' }), 'in');
  assert.strictEqual(_.signinMode({ configured: false, signedIn: false }), 'off', 'read-only');
  assert.strictEqual(_.signinMode(null), '', 'a failed session read draws nothing');
});

test('no sign-in set up is a read-only sheet, and a 503 write says so even if the session read failed', () => {
  assert.strictEqual(_.READ_ONLY, '🔒 sign-in not set up — this sheet is read-only until the operator runs the deck set-up');
  assert.strictEqual(_.signinMode(null, false, true), 'off', 'a 503 forces the bar');
  assert.strictEqual(_.signinMode({ configured: true, signedIn: true }, false, true), 'off');
  assert.strictEqual(_.signinMode({ configured: false, signedIn: false }, true), 'off', 'no form to sign in with');
  assert.doesNotMatch(SOURCE, /answers unsigned — deck sign-in not configured/, 'the old quiet line is gone');
});

test('a 503 write rolls back like a 401: the choice snaps back, the typed note stays', () => {
  const was = { choice: 'a', note: 'old' };
  const answers = { one: was };
  const drafts = { one: 'typed over it' };
  const got = _.settleAnswer(answers, drafts, 'one', { status: 503, body: { error: 'sign-in not configured' } }, { note: 'typed over it' });
  assert.strictEqual(got, 'unset');
  assert.strictEqual(answers.one, was);
  assert.strictEqual(drafts.one, 'typed over it');
  assert.strictEqual(_.settleSign(answers, 'one', { status: 503, body: { error: 'sign-in not configured' } }), 'unset');
});

test('a refused sign-in says why, and never echoes the password', () => {
  assert.strictEqual(_.signinError({ status: 401, body: { error: 'wrong password' } }), 'wrong password');
  assert.strictEqual(_.signinError({ status: 429, body: { error: 'too many attempts', retryAfter: 30 } }),
    'too many tries — wait 30s');
  assert.strictEqual(_.signinError({ status: 429, body: { retryAfter: 30 }, retryAfter: '90' }), 'too many tries — wait 30s',
    'the body wins over the header');
  assert.strictEqual(_.signinError({ status: 429, body: {}, retryAfter: '90' }), 'too many tries — wait 90s',
    'the Retry-After header when the body has none');
  assert.strictEqual(_.signinError({ status: 429, body: {}, retryAfter: null }), 'too many tries — wait a moment');
  assert.strictEqual(_.signinError({ status: 409, body: { error: 'sign-in not configured' } }), 'sign-in not configured');
  assert.strictEqual(_.signinError({ status: 403, body: {} }), 'sign-in failed', 'a bad Origin has no JSON');
});

test('the password field is one a password manager can fill, and it is never logged', () => {
  assert.match(SOURCE, /\.type = 'password'/);
  assert.match(SOURCE, /setAttribute\('autocomplete', 'current-password'\)/);
  assert.doesNotMatch(SOURCE, /console\.[a-z]+\([^)]*password/i);
});

// DECK-108 layer 2: deploy-class cards are signed through 1Password; the rest carry no badge.
const DEPLOY = { id: 'ship', options: [{ key: 'deploy-now', label: 'Deploy now' }, { key: 'wait', label: 'Wait' }] };
const PLAIN = { id: 'plain', options: [{ key: 'a', label: 'A' }] };

test('a card is deploy-class by its flag or by a deploy- option key, the server\'s rule', () => {
  assert.strictEqual(_.isDeployClass(DEPLOY), true);
  assert.strictEqual(_.isDeployClass({ deployClass: true, options: [] }), true);
  assert.strictEqual(_.isDeployClass({ deployClass: 'true', options: [{ key: 'a' }] }), false, 'a string is not true');
  assert.strictEqual(_.isDeployClass(PLAIN), false);
  assert.strictEqual(_.isDeployClass({ options: [{ key: 'redeploy-x' }] }), false, 'the prefix, not a substring');
  assert.strictEqual(_.isDeployClass({}), false);
  assert.strictEqual(_.isDeployClass(undefined), false);
});

test('only a choice set on a deploy-class card is signed next', () => {
  const row = { choice: 'deploy-now', answeredAt: '2026-09-11T08:00:00Z', sigValid: false };
  assert.strictEqual(_.wantsSign(DEPLOY, { choice: 'deploy-now', choiceLabel: 'Deploy now' }, row), true);
  assert.strictEqual(_.wantsSign(PLAIN, { choice: 'a' }, { choice: 'a' }), false, 'an ordinary card is never signed');
  assert.strictEqual(_.wantsSign(DEPLOY, { note: 'why' }, row), false, 'a note edit is not a click');
  assert.strictEqual(_.wantsSign(DEPLOY, { choice: 'deploy-now' }, Object.assign({}, row, { sigValid: true })), false,
    'a row already signed asks for no second Touch ID');
});

test('a non-deploy card shows no signature badge, signed or not', () => {
  assert.strictEqual(_.sigBadge(PLAIN, { choice: 'a' }), null, 'an unsigned ordinary answer is normal');
  assert.strictEqual(_.sigBadge(PLAIN, { choice: 'a', sigValid: true }), null);
  assert.strictEqual(_.sigBadge(DEPLOY, { choice: null }), null, 'unanswered says nothing');
  assert.strictEqual(_.sigBadge(DEPLOY, undefined), null);
});

test('a deploy-class badge: pending, signed, not signed with why, and Sign now', () => {
  const a = { choice: 'deploy-now', answeredAt: '2026-09-11T08:00:00Z', clickSeen: true };
  const mine = { click: 'deploy-now 2026-09-11T08:00:00Z' };   // a sign this page started, for a click this page made
  assert.deepStrictEqual(_.sigBadge(DEPLOY, a, { pending: true }), { text: '🔐 Approve in 1Password…', tone: 'wait' });
  const signed = _.sigBadge(DEPLOY, Object.assign({}, a, {
    sigValid: true, sigState: 'signed', sigKey: 'SHA256:abcdefghijklmnopqrstuvwxyz', sigStateAt: '2026-09-11T08:00:05Z',
  }), mine);
  assert.strictEqual(signed.text, '✅ signed · abcdefghijkl · ' + _.fmt('2026-09-11T08:00:05Z'));
  assert.strictEqual(signed.tone, 'good');
  assert.ok(!signed.signNow, 'nothing left to sign');
  for (const why of ['dismissed', 'timeout', 'error']) {
    assert.deepStrictEqual(_.sigBadge(DEPLOY, Object.assign({}, a, { sigValid: false, sigState: why }), mine), {
      text: '⚠ not signed (' + why + ') — this click is a record, not a trigger', tone: 'warn', signNow: true,
    });
  }
  assert.deepStrictEqual(_.sigBadge(DEPLOY, Object.assign({}, a, { sigValid: false, sigState: 'agent-shell' }), mine), {
    text: '⚠ not signed (agent-shell) — this click is a record, not a trigger', tone: 'warn',
  }, 'a sign refused in an agent shell is not retried from here');
  assert.strictEqual(_.sigBadge(DEPLOY, Object.assign({}, a, { sigValid: 'true', sigState: 'signed' })).tone, 'warn',
    'signed is strictly sigValid === true');
  assert.deepStrictEqual(_.sigBadge(DEPLOY, a, { quiet: 'signing not configured' }),
    { text: 'signing not configured', tone: 'quiet' });
});

test('Sign now is offered only for a click this page made and a sign this page started', () => {
  const a = { choice: 'deploy-now', answeredAt: '2026-09-11T08:00:00Z', sigValid: false, clickSeen: true };
  const LOADED_LINE = { text: '⚠ not signed — click it again to sign', tone: 'warn' };
  assert.deepStrictEqual(_.sigBadge(DEPLOY, a), LOADED_LINE, 'no sig and no state yet: loaded from the deck');
  for (const why of ['dismissed', 'timeout', 'error', 'agent-shell']) {
    assert.deepStrictEqual(_.sigBadge(DEPLOY, Object.assign({}, a, { sigState: why })), LOADED_LINE,
      'a ' + why + ' row merely loaded from the deck offers no Sign now');
  }
  const later = Object.assign({}, a, { answeredAt: '2026-09-11T09:00:00Z', sigState: 'dismissed' });
  assert.deepStrictEqual(_.sigBadge(DEPLOY, later, { click: 'deploy-now 2026-09-11T08:00:00Z' }), LOADED_LINE,
    'a newer click on the deck (another tab) is not this page\'s click');
  assert.deepStrictEqual(_.sigBadge(DEPLOY, Object.assign({}, a, { sigState: 'dismissed' }), { unseen: true }),
    { text: '⚠ not signed — click your answer again, then sign', tone: 'warn' }, 'the deck never saw the click: re-click, no Sign now');
});

// DECK-108 H1: an agent can write a row into fleet.db. On a deploy-class card, a choice this deck
// never saw clicked (clickSeen !== true) is not the operator's: no ✓, no answered line, not counted.
const UNSEEN_LINE = { text: '⚠ not clicked in this deck session — choose again', tone: 'warn' };

test('an agent-written deploy-class row is shown as unanswered, with a choose-again badge and no Sign now', () => {
  const agent = { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: '2026-09-11T08:00:00Z', dirty: true,
    note: 'n', noteAt: '2026-09-11T08:00:01Z', sigValid: false, sigState: 'dismissed', clickSeen: false };
  for (const row of [agent, Object.assign({}, agent, { clickSeen: undefined }), Object.assign({}, agent, { clickSeen: 'true' }),
    Object.assign({}, agent, { sigValid: true, sigState: 'signed' })]) {
    const shown = _.shownAnswer(DEPLOY, row);
    assert.strictEqual(shown.choice, null, 'no option is selected');
    assert.strictEqual(_.chipText(1, 1, 'Ship', shown), '1/1 · Ship', 'the chip carries no ✓');
    assert.doesNotMatch(_.whenLine(shown), /🕒/, 'no answered line');
    assert.strictEqual(shown.note, 'n', 'the note box still shows what is stored');
    assert.deepStrictEqual(_.sigBadge(DEPLOY, row), UNSEEN_LINE);
    assert.deepStrictEqual(_.sigBadge(DEPLOY, row, { click: 'deploy-now 2026-09-11T08:00:00Z' }), UNSEEN_LINE,
      'never Sign now for a row the deck did not see clicked');
  }
  assert.deepStrictEqual(_.answeredIds([DEPLOY], { ship: agent }), [], 'not counted as answered');
  assert.deepStrictEqual(_.pendingIds([DEPLOY], { ship: agent }), [], 'and never sent as the operator\'s');
  assert.doesNotMatch(UNSEEN_LINE.text, /your answer/);
});

test('a deploy-class row the deck saw clicked, and any non-deploy row, shows its stored choice', () => {
  const seen = { choice: 'deploy-now', answeredAt: '2026-09-11T08:00:00Z', sigValid: false, clickSeen: true };
  assert.strictEqual(_.shownAnswer(DEPLOY, seen), seen);
  assert.deepStrictEqual(_.answeredIds([DEPLOY], { ship: seen }), ['ship']);
  const plain = { choice: 'a', answeredAt: '2026-09-11T08:00:00Z', dirty: true, clickSeen: false };
  assert.strictEqual(_.shownAnswer(PLAIN, plain), plain, 'an ordinary card is unchanged');
  assert.deepStrictEqual(_.pendingIds([PLAIN], { plain }), ['plain']);
  assert.strictEqual(_.sigBadge(PLAIN, plain), null);
});

test('the old click-your-answer-to-sign line is gone', () => {
  assert.doesNotMatch(SOURCE, /click your answer to sign it/);
});

test('a sign result: 200 is the view, answer-changed reloads, unconfigured is quiet, the rest a banner', () => {
  const answers = { ship: { choice: 'deploy-now' } };
  const view = { choice: 'deploy-now', sigValid: true };
  assert.strictEqual(_.settleSign(answers, 'ship', { status: 200, body: view }), 'saved');
  assert.strictEqual(answers.ship, view);
  const no = (status, error) => _.settleSign(answers, 'ship', { status, body: { error } });
  assert.strictEqual(no(409, 'answer changed'), 'reload');
  assert.strictEqual(no(409, 'answer changed while signing'), 'reload');
  assert.strictEqual(no(409, 'signing not configured'), 'quiet');
  assert.strictEqual(no(409, 'question changed'), 'question');
  assert.strictEqual(no(409, 'click not seen by this deck'), 'unseen');
  assert.strictEqual(no(401, 'sign in required'), 'signin');
  assert.strictEqual(no(409, 'signing in progress'), 'failed');
  assert.strictEqual(no(409, 'not a deploy-class card'), 'failed');
  assert.strictEqual(_.settleSign(answers, 'ship', { status: 403, body: {} }), 'failed', 'a bad Origin has no JSON');
  assert.strictEqual(answers.ship, view, 'no refusal touches the card');
});

// A fetch double that records every call, and a storage double that records every write.
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const [status, body, headers] = reply(url, init) || [200, {}];
    return { status, json: async () => body, headers: { get: (h) => (headers || {})[h.toLowerCase()] ?? null } };
  };
  fn.calls = calls;
  return fn;
}

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  const writes = [];
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push([k, String(v)]); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k), m, writes,
  };
}

const HDR = 'x-fleetdeck-session';
const SIGNIN = { signedIn: true, operatorId: 'neelo', expiresAt: 'x' };

// A sign-in through the same ask, so the token is only ever where the screen put it.
async function signedIn(f) {
  const ask = _.makeAsk(f);
  await ask('/api/operator/signin', 'POST', { password: 'pw' });
  assert.strictEqual(f.calls[0].url, '/api/operator/signin');
  f.calls.length = 0;
  return ask;
}

test('the session token rides on the operator routes and every write, and on no plain read', async () => {
  const f = fakeFetch((url) => [200, url === '/api/operator/signin' ? Object.assign({ sessionToken: 'tok-1' }, SIGNIN) : {}]);
  const ask = await signedIn(f);
  await ask('/api/operator/session');
  await ask('/api/unblock/s1/answers/q1', 'PUT', { choice: 'a' });
  for (const op of ['close', 'reopen', 'send']) await ask('/api/unblock/s1/' + op, 'POST', {});
  await ask('/api/unblock/s1/answers/q1/sign', 'POST', { choice: 'a', answeredAt: 't' });
  await ask('/api/unblock');
  await ask('/api/unblock/s1');
  const sent = f.calls.map((c) => [c.url, c.init.headers[HDR]]);
  assert.deepStrictEqual(sent, [
    ['/api/operator/session', 'tok-1'],
    ['/api/unblock/s1/answers/q1', 'tok-1'],
    ['/api/unblock/s1/close', 'tok-1'], ['/api/unblock/s1/reopen', 'tok-1'], ['/api/unblock/s1/send', 'tok-1'],
    ['/api/unblock/s1/answers/q1/sign', 'tok-1'],
    ['/api/unblock', undefined], ['/api/unblock/s1', undefined],
  ]);
  assert.ok(f.calls.every((c) => c.init.credentials === 'same-origin'), 'the cookie half goes too');
  assert.ok(f.calls.every((c) => !('origin' in c.init.headers)), 'the browser owns Origin; the screen never sets one');
});

test('a sign-in holds the token in page memory, a sign-out and any 401 drop it', async () => {
  let status = 200;
  let token = 'tok-2';
  const f = fakeFetch((url) => url === '/api/operator/signin'
    ? [status, status === 200 ? Object.assign({ sessionToken: token }, SIGNIN) : { error: 'wrong password' }]
    : [status, {}]);
  const ask = _.makeAsk(f);
  const hdr = async () => { status = 200; await ask('/api/operator/session'); return f.calls[f.calls.length - 1].init.headers[HDR]; };

  status = 401;
  await ask('/api/operator/signin', 'POST', { password: 'nope' });
  assert.strictEqual(await hdr(), undefined, 'a refused sign-in holds nothing');

  await ask('/api/operator/signin', 'POST', { password: 'pw' });
  assert.strictEqual(await hdr(), 'tok-2');

  await ask('/api/operator/signout', 'POST', {});
  assert.strictEqual(f.calls[f.calls.length - 1].init.headers[HDR], 'tok-2', 'the sign-out still names its session');
  assert.strictEqual(await hdr(), undefined);

  token = 'tok-3';
  await ask('/api/operator/signin', 'POST', { password: 'pw' });
  status = 401;
  await ask('/api/unblock/s1/answers/q1', 'PUT', { choice: 'a' });
  assert.strictEqual(await hdr(), undefined, 'a 401 is a dead session');
});

test('the token never touches web storage, under any key', async () => {
  const local = fakeStore();
  const session = fakeStore();
  const f = fakeFetch((url) => [200, url === '/api/operator/signin' ? Object.assign({ sessionToken: 'tok-secret' }, SIGNIN) : {}]);
  const ask = _.makeAsk(f, { localStorage: local, sessionStorage: session });
  await ask('/api/operator/signin', 'POST', { password: 'pw' });
  await ask('/api/unblock/s1/answers/q1', 'PUT', { choice: 'a' });
  assert.strictEqual(f.calls[1].init.headers[HDR], 'tok-secret', 'the write still carries it');
  for (const store of [local, session]) {
    assert.ok(store.writes.every(([k, v]) => !k.includes('tok-secret') && !v.includes('tok-secret')), 'no storage write holds the token');
    assert.strictEqual(store.m.size, 0);
  }
  assert.doesNotMatch(SOURCE, /(local|session)Storage\.setItem\([^)]*[Tt]oken/, 'no code path stores it');
});

test('a 429 hands the Retry-After header to the sign-in line', async () => {
  const f = fakeFetch(() => [429, { error: 'too many attempts' }, { 'retry-after': '45' }]);
  const r = await _.makeAsk(f)('/api/operator/signin', 'POST', { password: 'pw' });
  assert.strictEqual(_.signinError(r), 'too many tries — wait 45s');
});

// The server's own questionSha256: hex SHA-256 of JSON.stringify(question).
const sha = (q) => require('crypto').createHash('sha256').update(JSON.stringify(q), 'utf8').digest('hex');
const LOADED = {
  id: 'ship', topic: 'Ship', decision: 'Deploy the deck now? — ✓ ünïcode', why: 'w', explain: '<b>e</b>',
  options: [{ key: 'deploy-now', label: 'Deploy now', recommended: true }, { key: 'hold', label: 'Hold' }],
};

test('the sign request carries the PUT response\'s choice and answeredAt, the loaded question\'s hash, and nothing else', async () => {
  const f = fakeFetch((url) => [200, url === '/api/operator/signin' ? Object.assign({ sessionToken: 'tok-1' }, SIGNIN) : {}]);
  const ask = await signedIn(f);
  const row = { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: '2026-09-11T08:00:00Z', note: 'n', sigValid: false };
  const sheet = { questions: [JSON.parse(JSON.stringify(LOADED))] };
  const texts = _.questionTexts(sheet);
  sheet.questions[0].seen = true;   // the screen adding a field to its own state moves nothing
  sheet.questions[0].options.push({ key: 'x', label: 'x' });
  await _.requestSign(ask, 'u 1', 'ship', row, texts.ship);
  const c = f.calls[0];
  assert.strictEqual(c.url, '/api/unblock/u%201/answers/ship/sign');
  assert.strictEqual(c.init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(c.init.body), { choice: 'deploy-now', answeredAt: '2026-09-11T08:00:00Z', questionSha256: sha(LOADED) });
  assert.strictEqual(c.init.headers[HDR], 'tok-1');
});

// The live half in a sandbox of its own: a document with no mount node (so nothing paints), the
// fetch double, and the host's WebCrypto.
test('live: Sign hashes the question as loaded, and a question changed on the deck reloads the sheet with a banner', async () => {
  const vm = require('vm');
  let question = LOADED;
  const f = fakeFetch((url) => {
    if (url === '/api/unblock/ub-1')
      return [200, {
        sheet: { id: 'ub-1', status: 'open', questions: [JSON.parse(JSON.stringify(question))] },
        answers: { ship: { choice: 'deploy-now', answeredAt: '2026-09-11T08:00:00.000Z', sigValid: false } },
      }];
    if (url.endsWith('/sign')) return [409, { error: 'question changed' }];
    return [200, {}];
  });
  const box = {
    document: { readyState: 'complete', getElementById: () => null },
    fetch: f, crypto: globalThis.crypto, TextEncoder, localStorage: fakeStore(),
    setInterval: () => 0, clearInterval: () => {},
  };
  vm.runInNewContext(SOURCE, box);
  const live = box.FD.screens.unblock;
  await new Promise((r) => setImmediate(r));   // start()'s own reads settle first
  await live.loadSheet('ub-1');
  live.state.sheet.questions[0].seen = true;   // a UI-side mutation of its state
  question = Object.assign({}, LOADED, { decision: 'Deploy to prod and skip the train?' });   // an agent rewrites it in fleet.db
  const from = f.calls.length;
  await live.signCard('ship');
  const after = f.calls.slice(from);
  assert.deepStrictEqual(after.map((c) => c.url), ['/api/unblock/ub-1/answers/ship/sign', '/api/unblock/ub-1'], 'signed, then the sheet re-read');
  assert.strictEqual(JSON.parse(after[0].init.body).questionSha256, sha(LOADED), 'the hash of the question as the GET returned it');
  assert.strictEqual(live.state.sheet.questions[0].decision, 'Deploy to prod and skip the train?', 'the new text is on screen');
  assert.strictEqual(live.state.error, 'the question changed on the deck — read it again before you sign');
});

// One page load of the live half, in a sandbox of its own. The same stores across two loads are
// one browser profile; a second load is a reload.
async function loadPage(f, local, session) {
  const vm = require('vm');
  const box = {
    document: { readyState: 'complete', getElementById: () => null },
    fetch: f, crypto: globalThis.crypto, TextEncoder, localStorage: local, sessionStorage: session,
    setInterval: () => 0, clearInterval: () => {},
  };
  vm.runInNewContext(SOURCE, box);
  await new Promise((r) => setTimeout(r, 10));   // start()'s own reads settle first
  return box.FD.screens.unblock;
}

// Holds until the card's sign is no longer in flight.
async function signSettled(live, key) {
  for (let i = 0; i < 100 && (live.state.sign[key] || {}).pending; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(!(live.state.sign[key] || {}).pending, 'the sign settled');
}

test('live: the token lives only as long as the page; a reload signs in again, and the old stored key is removed', async () => {
  const local = fakeStore({ 'fleetdeck.operatorSession': 'tok-old', 'adhd-unblock:hide': '0' });
  const session = fakeStore();
  const f = fakeFetch((url, init) => {
    const h = init.headers[HDR];
    if (url === '/api/operator/session') return [200, h === 'tok-live' ? { configured: true, signedIn: true, operatorId: 'neelo' } : { configured: true, signedIn: false }];
    if (url === '/api/operator/signin') return [200, Object.assign({ sessionToken: 'tok-live' }, SIGNIN)];
    return [200, {}];
  });
  const sessionReads = () => f.calls.filter((c) => c.url === '/api/operator/session').map((c) => c.init.headers[HDR]);

  let live = await loadPage(f, local, session);
  assert.strictEqual(local.getItem('fleetdeck.operatorSession'), null, 'the key an earlier build left is gone');
  assert.strictEqual(local.getItem('adhd-unblock:hide'), '0', 'and nothing else is');
  assert.deepStrictEqual(sessionReads(), [undefined], 'the old token is never sent');
  assert.strictEqual(_.signinMode(live.state.session, false, false), 'out');

  await live.signIn({ value: 'pw' });
  assert.deepStrictEqual(sessionReads(), [undefined, 'tok-live'], 'the session read names it while the page lives');
  assert.strictEqual(_.signinMode(live.state.session, false, false), 'in');
  await live.putAnswer({ id: 'plain', options: [{ key: 'a', label: 'A' }] }, { choice: 'a', choiceLabel: 'A' });
  assert.ok(f.calls.some((c) => c.init.method === 'PUT' && c.init.headers[HDR] === 'tok-live'), 'and every write');
  for (const store of [local, session]) {
    assert.ok(store.writes.every(([k, v]) => !(k + v).includes('tok-live')), 'no storage write holds the token');
  }

  f.calls.length = 0;
  live = await loadPage(f, local, session);   // the reload
  assert.deepStrictEqual(sessionReads(), [undefined], 'a fresh page has no token');
  assert.strictEqual(_.signinMode(live.state.session, false, false), 'out', 'so the form is back');
  assert.strictEqual(_.SIGNIN_LINE, '🔒 Sign in to answer — sign-in lasts until this page reloads');
  assert.match(SOURCE, /SIGNIN_LINE\)\);/, 'the form says it');
});

test('live: Sign now follows only this page\'s own click; a click the deck never saw asks for a re-click', async () => {
  const T0 = '2026-09-11T08:00:00.000Z';
  const T1 = '2026-09-11T08:05:00.000Z';
  const T2 = '2026-09-11T08:09:00.000Z';
  let put = null;
  let sign = null;
  const f = fakeFetch((url, init) => {
    if (url === '/api/unblock/ub-1')
      return [200, {
        sheet: { id: 'ub-1', status: 'open', questions: [JSON.parse(JSON.stringify(LOADED))] },
        answers: { ship: { choice: 'deploy-now', answeredAt: T0, sigValid: false, sigState: 'dismissed', clickSeen: true } },
      }];
    if (url.endsWith('/sign')) return sign;
    if (init.method === 'PUT') return put;
    return [200, {}];
  });
  const live = await loadPage(f, fakeStore(), fakeStore());
  const KEY = 'ub-1 ship';
  const badge = () => _.sigBadge(LOADED, live.state.answers.ship, live.state.sign[KEY]);
  await live.loadSheet('ub-1');
  assert.deepStrictEqual(badge(), { text: '⚠ not signed — click it again to sign', tone: 'warn' },
    'a dismissed row loaded from the deck offers no Sign now');

  // The operator clicks; this page's own sign comes back dismissed: Sign now.
  put = [200, { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: T1, sigValid: false, clickSeen: true }];
  sign = [200, { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: T1, sigValid: false, sigState: 'dismissed', clickSeen: true }];
  await live.putAnswer(LOADED, { choice: 'deploy-now', choiceLabel: 'Deploy now' });
  await signSettled(live, KEY);
  assert.strictEqual(badge().signNow, true);

  // Sign now, but the deck restarted since the click: it will not sign what it did not see.
  sign = [409, { error: 'click not seen by this deck' }];
  await live.signCard('ship');
  assert.deepStrictEqual(badge(), { text: '⚠ not signed — click your answer again, then sign', tone: 'warn' });
  assert.strictEqual(live.state.error, '', 'the card says it; no banner');

  // A poll re-read does not bring Sign now back.
  await live.loadSheet('ub-1', true);
  assert.ok(!badge().signNow);

  // The re-click is a fresh PUT, and its sign goes through.
  put = [200, { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: T2, sigValid: false, clickSeen: true }];
  sign = [200, { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: T2, sigValid: true, sigState: 'signed', sigKey: 'SHA256:k', clickSeen: true }];
  await live.putAnswer(LOADED, { choice: 'deploy-now', choiceLabel: 'Deploy now' });
  await signSettled(live, KEY);
  assert.strictEqual(badge().tone, 'good');
  const signs = f.calls.filter((c) => c.url.endsWith('/sign')).map((c) => JSON.parse(c.init.body));
  assert.deepStrictEqual(signs.map((b) => b.answeredAt), [T1, T1, T2], 'each sign names the click the PUT stamped');
  assert.ok(signs.every((b) => b.questionSha256 === sha(LOADED)), 'the question hash still rides');
});

test('live: choosing on an agent-written deploy-class card is a fresh click, signed with its own answeredAt', async () => {
  const T0 = '2026-09-11T08:00:00.000Z';
  const T1 = '2026-09-11T08:07:00.000Z';
  const f = fakeFetch((url, init) => {
    if (url === '/api/unblock/ub-1')
      return [200, {
        sheet: { id: 'ub-1', status: 'open', questions: [JSON.parse(JSON.stringify(LOADED))] },
        answers: { ship: { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: T0, sigValid: false, clickSeen: false } },
      }];
    if (url.endsWith('/sign')) return [200, { choice: 'deploy-now', answeredAt: T1, sigValid: true, sigState: 'signed', sigKey: 'SHA256:k', clickSeen: true }];
    if (init.method === 'PUT') return [200, { choice: 'deploy-now', choiceLabel: 'Deploy now', answeredAt: T1, sigValid: false, clickSeen: true }];
    return [200, {}];
  });
  const live = await loadPage(f, fakeStore(), fakeStore());
  const KEY = 'ub-1 ship';
  await live.loadSheet('ub-1');
  assert.strictEqual(_.shownAnswer(LOADED, live.state.answers.ship).choice, null, 'loaded: nothing selected');
  assert.deepStrictEqual(_.sigBadge(LOADED, live.state.answers.ship, live.state.sign[KEY]), UNSEEN_LINE);

  const from = f.calls.length;
  await live.putAnswer(LOADED, { choice: 'deploy-now', choiceLabel: 'Deploy now' });
  await signSettled(live, KEY);
  const after = f.calls.slice(from).filter((c) => c.init.method);   // the list refresh is a plain read
  assert.deepStrictEqual(after.map((c) => [c.init.method, c.url]), [
    ['PUT', '/api/unblock/ub-1/answers/ship'], ['POST', '/api/unblock/ub-1/answers/ship/sign'],
  ], 'the click PUTs, then signs');
  assert.deepStrictEqual(JSON.parse(after[1].init.body), { choice: 'deploy-now', answeredAt: T1, questionSha256: sha(LOADED) },
    'signed with the answeredAt this click was stamped with, not the agent row\'s');
  assert.strictEqual(_.shownAnswer(LOADED, live.state.answers.ship).choice, 'deploy-now', 'now it is the operator\'s');
  assert.strictEqual(_.sigBadge(LOADED, live.state.answers.ship, live.state.sign[KEY]).tone, 'good');
});

test('the session token is never logged', () => {
  assert.doesNotMatch(SOURCE, /console\.[a-z]+\([^)]*(token|session)/i);
});

test('a write refused for want of a sign-in rolls back the choice and keeps the typed note', () => {
  const was = { choice: 'a', note: 'old', sigValid: true };
  const answers = { one: was };
  const drafts = { one: 'typed over it' };
  const got = _.settleAnswer(answers, drafts, 'one', { status: 401, body: { error: 'sign in required' } }, { note: 'typed over it' });
  assert.strictEqual(got, 'signin');
  assert.strictEqual(answers.one, was, 'the click is not shown as saved');
  assert.strictEqual(drafts.one, 'typed over it', 'the operator\'s words stay in the box');
  assert.strictEqual(_.signinMode({ configured: true, signedIn: false }, true), 'out');
  assert.strictEqual(_.signinMode(null, true), 'out', 'the form shows even if the session read failed');
  assert.strictEqual(_.SIGNIN_REQUIRED, 'sign in required — your click was not saved');
});

test('a saved note clears its draft, but not a draft typed since', () => {
  const drafts = { one: 'ship it' };
  _.settleAnswer({}, drafts, 'one', { status: 200, body: { note: 'ship it' } }, { note: 'ship it' });
  assert.strictEqual(drafts.one, undefined);
  const newer = { one: 'ship it now' };
  _.settleAnswer({}, newer, 'one', { status: 200, body: { note: 'ship it' } }, { note: 'ship it' });
  assert.strictEqual(newer.one, 'ship it now');
  const click = { one: 'half-typed' };
  _.settleAnswer({}, click, 'one', { status: 200, body: { choice: 'a' } }, { choice: 'a' });
  assert.strictEqual(click.one, 'half-typed', 'a choice click leaves a pending note alone');
});

test('a bad Origin is not a sign-in, and a 200 is the row the server wrote', () => {
  const answers = { one: { choice: 'a' } };
  const drafts = { one: 'keep' };
  assert.strictEqual(_.settleAnswer(answers, drafts, 'one', { status: 403, body: {} }), 'failed');
  assert.strictEqual(drafts.one, 'keep');
  const row = { choice: 'b', sigValid: true };
  assert.strictEqual(_.settleAnswer(answers, drafts, 'one', { status: 200, body: row }), 'saved');
  assert.strictEqual(answers.one, row);
});
