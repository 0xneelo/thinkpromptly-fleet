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
  const a = { choice: 'deploy-now', answeredAt: '2026-09-11T08:00:00Z' };
  assert.deepStrictEqual(_.sigBadge(DEPLOY, a, { pending: true }), { text: '🔐 Approve in 1Password…', tone: 'wait' });
  const signed = _.sigBadge(DEPLOY, Object.assign({}, a, {
    sigValid: true, sigState: 'signed', sigKey: 'SHA256:abcdefghijklmnopqrstuvwxyz', sigStateAt: '2026-09-11T08:00:05Z',
  }));
  assert.strictEqual(signed.text, '✅ signed · abcdefghijkl · ' + _.fmt('2026-09-11T08:00:05Z'));
  assert.strictEqual(signed.tone, 'good');
  assert.ok(!signed.signNow, 'nothing left to sign');
  for (const why of ['dismissed', 'timeout', 'error', 'agent-shell']) {
    assert.deepStrictEqual(_.sigBadge(DEPLOY, Object.assign({}, a, { sigValid: false, sigState: why })), {
      text: '⚠ not signed (' + why + ') — this click is a record, not a trigger', tone: 'warn', signNow: true,
    });
  }
  assert.deepStrictEqual(_.sigBadge(DEPLOY, a), { text: '⚠ not signed', tone: 'warn', signNow: true },
    'no sig and no state yet');
  assert.strictEqual(_.sigBadge(DEPLOY, Object.assign({}, a, { sigValid: 'true', sigState: 'signed' })).text, '⚠ not signed',
    'signed is strictly sigValid === true');
  assert.deepStrictEqual(_.sigBadge(DEPLOY, a, { quiet: 'signing not configured' }),
    { text: 'signing not configured', tone: 'quiet' });
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
  assert.strictEqual(no(401, 'sign in required'), 'signin');
  assert.strictEqual(no(409, 'signing in progress'), 'failed');
  assert.strictEqual(no(409, 'not a deploy-class card'), 'failed');
  assert.strictEqual(_.settleSign(answers, 'ship', { status: 403, body: {} }), 'failed', 'a bad Origin has no JSON');
  assert.strictEqual(answers.ship, view, 'no refusal touches the card');
});

// A fetch double that records every call, and a localStorage double.
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
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const HDR = 'x-fleetdeck-session';

test('the session token rides on the operator routes and every write, and on no plain read', async () => {
  const f = fakeFetch(() => [200, {}]);
  const ask = _.makeAsk(f, { localStorage: fakeStore({ [_.SESSION_KEY]: 'tok-1' }) });
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

test('a sign-in stores the token, a sign-out and any 401 drop it', async () => {
  const store = fakeStore();
  let status = 200;
  const f = fakeFetch((url) => url === '/api/operator/signin'
    ? [status, status === 200 ? { signedIn: true, operatorId: 'neelo', expiresAt: 'x', sessionToken: 'tok-2' } : { error: 'wrong password' }]
    : [status, {}]);
  const ask = _.makeAsk(f, { localStorage: store });

  status = 401;
  await ask('/api/operator/signin', 'POST', { password: 'nope' });
  assert.strictEqual(store.getItem(_.SESSION_KEY), null, 'a refused sign-in stores nothing');

  status = 200;
  await ask('/api/operator/signin', 'POST', { password: 'pw' });
  assert.strictEqual(store.getItem(_.SESSION_KEY), 'tok-2');
  assert.strictEqual(_.SESSION_KEY, 'fleetdeck.operatorSession');

  await ask('/api/operator/signout', 'POST', {});
  assert.strictEqual(f.calls[2].init.headers[HDR], 'tok-2', 'the sign-out still names its session');
  assert.strictEqual(store.getItem(_.SESSION_KEY), null);

  store.setItem(_.SESSION_KEY, 'tok-3');
  status = 401;
  await ask('/api/unblock/s1/answers/q1', 'PUT', { choice: 'a' });
  assert.strictEqual(store.getItem(_.SESSION_KEY), null, 'a 401 is a dead session');
});

test('storage that throws is no token and no crash', async () => {
  const host = {};
  Object.defineProperty(host, 'localStorage', { get() { throw new Error('denied'); } });
  const f = fakeFetch(() => [200, { sessionToken: 't' }]);
  const ask = _.makeAsk(f, host);
  await ask('/api/operator/signin', 'POST', { password: 'pw' });
  await ask('/api/operator/signout', 'POST', {});
  assert.strictEqual(f.calls[0].init.headers[HDR], undefined);
});

test('a 429 hands the Retry-After header to the sign-in line', async () => {
  const f = fakeFetch(() => [429, { error: 'too many attempts' }, { 'retry-after': '45' }]);
  const r = await _.makeAsk(f, { localStorage: fakeStore() })('/api/operator/signin', 'POST', { password: 'pw' });
  assert.strictEqual(_.signinError(r), 'too many tries — wait 45s');
});

// The server's own questionSha256: hex SHA-256 of JSON.stringify(question).
const sha = (q) => require('crypto').createHash('sha256').update(JSON.stringify(q), 'utf8').digest('hex');
const LOADED = {
  id: 'ship', topic: 'Ship', decision: 'Deploy the deck now? — ✓ ünïcode', why: 'w', explain: '<b>e</b>',
  options: [{ key: 'deploy-now', label: 'Deploy now', recommended: true }, { key: 'hold', label: 'Hold' }],
};

test('the sign request carries the PUT response\'s choice and answeredAt, the loaded question\'s hash, and nothing else', async () => {
  const f = fakeFetch(() => [200, {}]);
  const ask = _.makeAsk(f, { localStorage: fakeStore({ [_.SESSION_KEY]: 'tok-1' }) });
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
