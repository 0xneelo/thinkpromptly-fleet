// The Goals screen's pure half. Ordering, grouping and the draft keys are asserted here; the
// DOM half is asserted by the pixel gate, which renders the fixture sample below.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// data.js first, exactly as public/v2/index.html loads it: both files publish onto globalThis.FD.
require(path.join(ROOT, 'public/v2/data.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/v2/screens/goals.js'), 'utf8');
const screen = require(path.join(ROOT, 'public/v2/screens/goals.js'));
const _ = screen._;

const goal = (id, project, status) => ({ id, project, status, text: id, horizon: 'week', refs: [], notes: [] });

test('the thread reads newest first without reordering the file', () => {
  const file = [{ id: 'T-1' }, { id: 'T-2' }, { id: 'T-3' }];
  assert.deepStrictEqual(_.threadOrder(file).map((e) => e.id), ['T-3', 'T-2', 'T-1']);
  assert.deepStrictEqual(file.map((e) => e.id), ['T-1', 'T-2', 'T-3'], 'the caller\'s array is untouched');
  assert.deepStrictEqual(_.threadOrder(undefined), [], 'a jail with no thread.md still renders');
});

test('goals group by project: all first, then projects.json order', () => {
  const goals = [goal('GK-1', 'beta', 'open'), goal('GK-2', 'all', 'open'), goal('GK-3', 'alpha', 'open')];
  const groups = _.groupGoals(goals, ['alpha', 'beta']);
  assert.deepStrictEqual(groups.map((g) => g.project), ['all', 'alpha', 'beta']);
});

test('a project no longer in projects.json keeps its goals, after the known ones', () => {
  const groups = _.groupGoals([goal('GK-1', 'gone', 'open'), goal('GK-2', 'alpha', 'open')], ['alpha']);
  assert.deepStrictEqual(groups.map((g) => g.project), ['alpha', 'gone']);
});

test('within a group open leads, parked follows, done and dropped fold away', () => {
  const goals = [
    goal('GK-1', 'alpha', 'done'),
    goal('GK-2', 'alpha', 'parked'),
    goal('GK-3', 'alpha', 'open'),
    goal('GK-4', 'alpha', 'dropped'),
  ];
  const [group] = _.groupGoals(goals, ['alpha']);
  assert.deepStrictEqual(group.open.map((g) => g.id), ['GK-3', 'GK-2']);
  assert.deepStrictEqual(group.folded.map((g) => g.id), ['GK-1', 'GK-4']);
});

test('a project with nothing in it is not a group', () => {
  assert.deepStrictEqual(_.groupGoals([], ['alpha', 'beta']), []);
});

test('draft keys are one per form and field', () => {
  assert.strictEqual(_.draftKey('thread', 'text'), 'fd-goals-draft:thread:text');
  assert.strictEqual(_.draftKey('goal', 'refs'), 'fd-goals-draft:goal:refs');
});

test('the relay lines are the audit verdicts, one per line', () => {
  assert.strictEqual(_.relayText({ verdicts: ['**Verdict:** stalled', 'relay to lowcapsxyz'] }),
    '**Verdict:** stalled\nrelay to lowcapsxyz');
  assert.strictEqual(_.relayText(null), '', 'no audit is an empty clipboard, never a throw');
});

// The operator dictates the thread verbatim, so a direction that contains markup has to stay
// text. This screen has no innerHTML at all — every string becomes a text node.
test('operator text is never treated as markup', () => {
  const evil = '<script>alert(1)</script>';
  assert.strictEqual(_.safeText(evil), evil, 'the value is carried through unchanged, as text');
  assert.doesNotMatch(SOURCE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
    'goals.js must build the screen with createElement and textContent only');
  const [group] = _.groupGoals([goal(evil, 'alpha', 'open')], ['alpha']);
  assert.strictEqual(group.open[0].id, evil, 'grouping never rewrites the text either');
});

test('safeText coerces every shape the API could send', () => {
  assert.strictEqual(_.safeText(null), '');
  assert.strictEqual(_.safeText(undefined), '');
  assert.strictEqual(_.safeText(7), '7');
});

test('the fixture sample is the deterministic screen the pixel gate renders', () => {
  const v = _.FIXTURE_VIEW;
  assert.strictEqual(v.thread.length, 2);
  assert.strictEqual(v.goals.length, 3);
  assert.strictEqual(new Set(v.goals.map((g) => g.project)).size, 2, 'two projects');
  assert.ok(v.goals.some((g) => g.status === 'done'), 'one is folded away');
  assert.ok(v.audit && v.audit.verdicts.length, 'one audit, with a relay line');
});
