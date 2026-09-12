// coordinator/check.py — the evidence rule. A done lane must carry an external pointer
// (DESIGN §4a: never done-verified without an evidence link). An evidence list that is
// non-empty but holds only "" used to pass; it proves nothing and must fail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmpdir } = require('./helpers');

const CHECK = path.join(ROOT, 'coordinator', 'check.py');
const NOW = '2026-08-29T12:00:00Z';

function lane(over) {
  return {
    id: 'L1',
    goal: 'ship the fixture pipeline to production',
    done_milestone: 'L1 serving on prod at https://example.invalid/L1',
    owner: 'Someone (role, agent-someone)',
    state: 'done-verified',
    blockers: [],
    next_decision: 'operator: none',
    reported_at: '2026-08-29T09:00:00Z',
    verified_at: '2026-08-29T10:00:00Z',
    evidence: ['git:df6de67'],
    next_report_due: '2026-08-30T09:00:00Z',
    ...over,
  };
}

function check(t, over) {
  const dir = tmpdir('coordinator-check');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'board.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 1,
    northstar: { text: 'one sentence', ruling_id: 'R-1', confirmed_at: '2026-08-28T09:00:00Z' },
    lane_cap: 9,
    lanes: [lane(over)],
    operator_queue: [],
  }));
  const r = spawnSync('python3', [CHECK, file, '--now', NOW], { encoding: 'utf8' });
  return { code: r.status, err: r.stderr, out: r.stdout };
}

const RULE = /^FAIL: lane L1: (done-\w+) needs at least one evidence entry that is a path, URL, or git:<sha>/m;

test('done-verified with evidence [""] fails: a blank entry is not an evidence link', (t) => {
  const r = check(t, { evidence: [''] });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, RULE);
  assert.equal(r.err.match(RULE)[1], 'done-verified');
});

test('done-verified with evidence [] fails', (t) => {
  const r = check(t, { evidence: [] });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, RULE);
});

test('done-verified with prose evidence fails: "done" is a claim, not a pointer', (t) => {
  const r = check(t, { evidence: ['done', '  '] });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, RULE);
});

test('done-verified with a git:<sha> passes', (t) => {
  const r = check(t, { evidence: ['git:df6de67'] });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^OK: /);
});

test('one shaped entry beside a blank one is enough (URL and path shapes)', (t) => {
  for (const good of ['https://example.invalid/L1', 'docs/coordinator/HANDOFF.md']) {
    const r = check(t, { evidence: ['', good] });
    assert.equal(r.code, 0, good + ': ' + r.err);
  }
});

test('done-claimed is held to the same rule', (t) => {
  const r = check(t, { state: 'done-claimed', verified_at: null, evidence: [''] });
  assert.equal(r.code, 1, r.out + r.err);
  assert.equal(r.err.match(RULE)[1], 'done-claimed');
});

test('an active lane is not held to it: the rule is scoped to done states', (t) => {
  const r = check(t, { state: 'active', verified_at: null, evidence: [''] });
  assert.equal(r.code, 0, r.err);
});

test('check.py --selftest stays green', () => {
  const r = spawnSync('python3', [CHECK, '--selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SELFTEST PASS/);
});
