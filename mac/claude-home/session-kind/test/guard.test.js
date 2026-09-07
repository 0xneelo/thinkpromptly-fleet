// Tests for the PreToolUse session-kind guard. Every run reads FIXTURE marks:
// CLAUDE_SESSION_KIND_MARKS + CLAUDE_CONFIG_DIR point at temp dirs, so the live
// ~/.claude tree is never touched.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const GUARD = path.join(__dirname, '..', 'guard.js');
const MARKS = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-guard-'));
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-cfg-'));
after(() => {
  fs.rmSync(MARKS, { recursive: true, force: true });
  fs.rmSync(CFG, { recursive: true, force: true });
});

const ORCH = '🎛 ORCHESTRATOR 34';
const RES = '🔬 RESEARCHER 12';
const DES = '🎨 DESIGN 7';
const COORD = '🧭 COORDINATOR 5';
const GK = '🥅 GOALKEEPER 9';
const WORKER = '🔨 WORKER · Giselher';
const JUNK = 'not-a-badge';
const UNSTAMPED = '(unstamped)';

const key = (cwd) => crypto.createHash('sha1').update(String(cwd)).digest('hex').slice(0, 12);
const CWD = {};
for (const badge of [ORCH, RES, DES, COORD, GK, WORKER, JUNK, UNSTAMPED]) {
  CWD[badge] = '/fixture/' + key(badge);
}
for (const badge of [ORCH, RES, DES, COORD, GK, WORKER, JUNK]) {
  fs.writeFileSync(path.join(MARKS, key(CWD[badge])), badge + '\n');
}

function runRaw(input) {
  const r = spawnSync(process.execPath, [GUARD], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: CFG, CLAUDE_SESSION_KIND_MARKS: MARKS },
  });
  assert.equal(r.status, 0, 'guard must always exit 0');
  return r.stdout;
}

// null = allow, string = the deny reason.
function decide(badge, payload) {
  const out = runRaw(JSON.stringify({ cwd: CWD[badge], ...payload }));
  if (!out) return null;
  const o = JSON.parse(out).hookSpecificOutput;
  assert.equal(o.hookEventName, 'PreToolUse');
  assert.equal(o.permissionDecision, 'deny');
  return o.permissionDecisionReason;
}

function expectDeny(badge, payload) {
  const reason = decide(badge, payload);
  assert.ok(reason, `expected deny: ${badge} ${JSON.stringify(payload)}`);
  return reason;
}

function expectAllow(badge, payload) {
  assert.equal(decide(badge, payload), null, `expected allow: ${badge} ${JSON.stringify(payload)}`);
}

const agent = (t) => ({ tool_name: 'Agent', tool_input: { subagent_type: t } });
const task = (t) => ({ tool_name: 'Task', tool_input: { subagent_type: t } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } });
const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } });
const send = (input) => ({ tool_name: 'SendMessage', tool_input: input });
const mcpSend = (input) => ({ tool_name: 'mcp__ccd_session_mgmt__send_message', tool_input: input });
const skill = (s) => ({ tool_name: 'Skill', tool_input: { skill: s } });

const BUILDERS = ['builder', 'gpt-builder', 'honey:hive-builder'];
const REACH_CMDS = [
  'bash ~/.claude/bin/fleet-notify --to orchestrator "ping"',
  'node scripts/fleet-message.js --seat 34',
  'curl -s localhost:3131/api/notify -d \'{"to":"orchestrator"}\'',
  'curl -s localhost:3131/api/messages -d \'{"to":"orchestrator"}\'',
  'cat ~/.claude/sessions/local_abc.json',
];

// ---------------------------------------------------------------- 1. goalkeeper denies
test('goalkeeper: builder subagents denied via Agent and Task', () => {
  for (const b of BUILDERS) {
    assert.match(expectDeny(GK, agent(b)), /a goalkeeper does not build/);
    assert.match(expectDeny(GK, task(b)), /a goalkeeper does not build/);
  }
});

test('goalkeeper: /introduce-goal denied', () => {
  assert.match(expectDeny(GK, skill('introduce-goal')), /minting workers is the orchestrator/);
});

test('goalkeeper: every message is denied, goalkeeper mention or not', () => {
  for (const p of [
    send({ to: 'orchestrator', message: 'hi' }),
    send({ to: '🎛 ORCHESTRATOR 34', message: 'findings ready' }),
    mcpSend({ session_id: 'self', message: 'hi' }),
    mcpSend({ to: 'anyone', message: 'anything' }),
  ]) assert.match(expectDeny(GK, p), /a goalkeeper never messages a seat/);
});

test('goalkeeper: every REACH shell route denied without any goalkeeper mention', () => {
  for (const c of REACH_CMDS) {
    assert.match(expectDeny(GK, bash(c)), /a goalkeeper never reaches the fleet bus/);
  }
});

test('goalkeeper: docs/.md outside its repo is still denied (no generic allowlist)', () => {
  const p = '/Users/misterislez/remote-system/docs/foo.md';
  assert.match(expectDeny(GK, write(p)), /a goalkeeper writes only inside its own repo/);
  assert.match(expectDeny(GK, edit(p)), /a goalkeeper writes only inside its own repo/);
});

test('goalkeeper: inside cfg but outside cfg/goalkeeper/ is denied', () => {
  expectDeny(GK, write(CFG + '/skills/goalkeeper/SKILL.md'));
});

// ---------------------------------------------------------------- 2. goalkeeper allows
test('goalkeeper: writes inside its own repo allowed', () => {
  expectAllow(GK, write(CFG + '/goalkeeper/thread.md'));
  expectAllow(GK, write(CFG + '/goalkeeper/audits/2026-09-07.md'));
});

test('goalkeeper: scratchpad writes allowed', () => {
  expectAllow(GK, write('/private/tmp/claude-501/abc/scratchpad/x.md'));
  expectAllow(GK, write('/Users/misterislez/work/scratchpad/notes.txt'));
});

test('goalkeeper: innocent shell allowed', () => {
  expectAllow(GK, bash('git status'));
  expectAllow(GK, bash('git log --oneline -5'));
});

test('goalkeeper: unguarded tools and non-builder subagents allowed', () => {
  expectAllow(GK, { tool_name: 'Read', tool_input: { file_path: '/Users/misterislez/remote-system/server.js' } });
  expectAllow(GK, agent('reader'));
});

// ---------------------------------------------------------------- 3. every other stamped kind cannot reach the 🥅 seat
for (const badge of [ORCH, RES, DES, COORD, WORKER]) {
  test(`${badge}: cannot reach the goalkeeper`, () => {
    assert.match(expectDeny(badge, send({ to: '🥅 GOALKEEPER 9', message: 'audit this' })),
      /cannot be addressed by any seat/);
    assert.match(expectDeny(badge, send({ to: 'orchestrator', message: 'ask 🥅 for the audit' })),
      /cannot be addressed by any seat/);
    assert.match(expectDeny(badge, mcpSend({ to: '🥅 GOALKEEPER 9', message: 'audit this' })),
      /cannot be addressed by any seat/);
    assert.match(expectDeny(badge, mcpSend({ to: 'x', message: 'relay to 🥅 please' })),
      /cannot be addressed by any seat/);
    assert.match(expectDeny(badge, bash('curl -s localhost:3131/api/messages -d \'{"to":"🥅 GOALKEEPER 9"}\'')),
      /cannot be reached over the fleet bus/);
    assert.match(expectDeny(badge, write(CFG + '/goalkeeper/thread.md')), /belongs to the 🥅 seat alone/);
    assert.match(expectDeny(badge, edit(CFG + '/goalkeeper/audits/2026-09-07.md')), /belongs to the 🥅 seat alone/);
  });

  test(`${badge}: normal bus access unaffected`, () => {
    expectAllow(badge, bash('curl -s localhost:3131/api/messages -d \'{"to":"orchestrator"}\''));
    expectAllow(badge, bash('echo "🥅 GOALKEEPER 9"'));
    expectAllow(badge, send({ to: '🎛 ORCHESTRATOR 34', message: 'findings ready' }));
  });
}

// ---------------------------------------------------------------- 4. regressions: pre-existing rules
const KINDS = [
  { badge: ORCH, build: /`\/introduce-goal`/, source: /writes plans and docs, not source/, mintDenied: false },
  { badge: DES, build: /german-box worker/, source: /diff ledgers, plans, and goal packs/, mintDenied: false },
  { badge: RES, build: /a researcher session does not build/, source: /writes findings and docs, not source/, mintDenied: true },
  { badge: COORD, build: /a coordinator portal does not build/, source: /sitreps and portal state under coordinator\//, mintDenied: true },
];

for (const k of KINDS) {
  test(`${k.badge}: builder subagents denied with its own reason`, () => {
    for (const b of BUILDERS) {
      assert.match(expectDeny(k.badge, agent(b)), k.build);
      assert.match(expectDeny(k.badge, task(b)), k.build);
    }
    expectAllow(k.badge, agent('reader'));
  });

  test(`${k.badge}: source write denied, allowlisted writes allowed`, () => {
    assert.match(expectDeny(k.badge, write('/Users/misterislez/remote-system/server.js')), k.source);
    expectAllow(k.badge, write('/Users/misterislez/remote-system/PLAN.md'));
    expectAllow(k.badge, write('/Users/misterislez/remote-system/docs/goals/pack.txt'));
    expectAllow(k.badge, write(CFG + '/skills/x/SKILL.md'));
    expectAllow(k.badge, write('/private/tmp/claude-501/abc/scratchpad/x.json'));
  });

  test(`${k.badge}: coordinator carve-out`, () => {
    const p = '/Users/misterislez/remote-system/coordinator/board.json';
    if (k.badge === COORD) expectAllow(k.badge, write(p));
    else assert.match(expectDeny(k.badge, write(p)), k.source);
  });

  test(`${k.badge}: /introduce-goal ${k.mintDenied ? 'denied' : 'allowed'}`, () => {
    if (k.mintDenied) assert.match(expectDeny(k.badge, skill('introduce-goal')), /minting workers is the orchestrator/);
    else expectAllow(k.badge, skill('introduce-goal'));
  });
}

// ---------------------------------------------------------------- 5. worker: otherwise unguarded
test('worker: builds, writes source and mints at the guard level', () => {
  for (const b of BUILDERS) {
    expectAllow(WORKER, agent(b));
    expectAllow(WORKER, task(b));
  }
  expectAllow(WORKER, write('/Users/misterislez/remote-system/server.js'));
  expectAllow(WORKER, skill('introduce-goal'));
});

// ---------------------------------------------------------------- 6. unstamped session
test('unstamped: nothing is guarded', () => {
  expectAllow(UNSTAMPED, agent('builder'));
  expectAllow(UNSTAMPED, task('honey:hive-builder'));
  expectAllow(UNSTAMPED, write('/Users/misterislez/remote-system/server.js'));
  expectAllow(UNSTAMPED, send({ to: '🥅 GOALKEEPER 9', message: 'hi' }));
  expectAllow(UNSTAMPED, write(CFG + '/goalkeeper/thread.md'));
  expectAllow(UNSTAMPED, bash('curl -s localhost:3131/api/messages -d \'{"to":"🥅 GOALKEEPER 9"}\''));
});

// ---------------------------------------------------------------- 7. robustness
test('malformed stdin is inert and exits 0', () => {
  assert.equal(runRaw('{not json'), '');
  assert.equal(runRaw(''), '');
});

test('payload with no cwd exits 0', () => {
  assert.equal(runRaw(JSON.stringify(agent('builder'))), '');
});

test('junk marker: stamped but unknown kind — builds allowed, 🥅 still unreachable', () => {
  expectAllow(JUNK, agent('builder'));
  expectAllow(JUNK, write('/Users/misterislez/remote-system/server.js'));
  assert.match(expectDeny(JUNK, send({ to: '🥅 GOALKEEPER 9', message: 'hi' })), /cannot be addressed by any seat/);
  assert.match(expectDeny(JUNK, write(CFG + '/goalkeeper/thread.md')), /belongs to the 🥅 seat alone/);
});

test('deny reason carries the badge hint', () => {
  assert.match(expectDeny(ORCH, agent('builder')), /This session is marked 🎛 ORCHESTRATOR 34\./);
});

// ------------------------------------------- 8. adversarial — isolation cannot be spelled around
// The jail is enforced on the RESOLVED path and on addressee fields, so neither a `..`
// segment nor a lowercase spelling nor an MCP shell wrapper walks past it.
const GK_HOME = path.join(CFG, 'goalkeeper');
fs.writeFileSync(path.join(MARKS, key(GK_HOME)), GK + '\n');

// Same contract as decide(), but the session's cwd is the goalkeeper's own repo — the
// anchor every relative path below resolves against.
function decideAt(cwd, payload) {
  const out = runRaw(JSON.stringify({ cwd, ...payload }));
  if (!out) return null;
  return JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
}
const denyAt = (cwd, p) => {
  const r = decideAt(cwd, p);
  assert.ok(r, `expected deny: ${JSON.stringify(p)}`);
  return r;
};
const allowAt = (cwd, p) => assert.equal(decideAt(cwd, p), null, `expected allow: ${JSON.stringify(p)}`);

test('adversarial: goalkeeper cannot escape its jail with .. or a prefix-adjacent sibling', () => {
  const esc = /a goalkeeper writes only inside its own repo/;
  assert.match(denyAt(GK_HOME, write(GK_HOME + '/../../remote-system/server.js')), esc);
  assert.match(denyAt(GK_HOME, write(GK_HOME + '/../skills/evil.md')), esc);
  assert.match(denyAt(GK_HOME, write('/private/tmp/claude-x/scratchpad/../../../etc/passwd')), esc);
  // prefix-adjacent sibling: `<cfg>/goalkeeper-other` is NOT inside `<cfg>/goalkeeper`
  assert.match(denyAt(GK_HOME, write(CFG + '/goalkeeper-other/x.md')), esc);
});

test('adversarial: goalkeeper relative paths resolve against cwd (its own repo)', () => {
  allowAt(GK_HOME, write('thread.md'));
  assert.match(denyAt(GK_HOME, write('../skills/x.md')), /a goalkeeper writes only inside its own repo/);
});

test('adversarial: the goalkeeper repo dir itself is writable, tilde form is not', () => {
  allowAt(GK_HOME, write(GK_HOME));
  // The fixture cfg is a temp dir, so `~/.claude/goalkeeper/` resolves OUTSIDE it —
  // asserting the tilde form is DENIED here is the honest test: it proves `~` is expanded
  // and compared, not string-matched against the allowlist.
  assert.match(denyAt(GK_HOME, write('~/.claude/goalkeeper/thread.md')),
    /a goalkeeper writes only inside its own repo/);
});

test('adversarial: other kinds cannot write into the goalkeeper repo by spelling', () => {
  const into = /belongs to the 🥅 seat alone/;
  assert.match(expectDeny(ORCH, write(CFG + '//goalkeeper/evil.md')), into);
  assert.match(expectDeny(ORCH, write(CFG + '/skills/../goalkeeper/evil.md')), into);
  assert.match(expectDeny(ORCH, write(CFG + '/goalkeeper/audits/x.md')), into);
  // ...and the fix did not over-block ordinary cfg writes.
  expectAllow(ORCH, write(CFG + '/skills/foo/x.md'));
});

for (const badge of [ORCH, COORD, WORKER]) {
  test(`adversarial: ${badge} cannot address the 🥅 seat in lowercase or mixed case`, () => {
    const into = /cannot be addressed by any seat/;
    assert.match(expectDeny(badge, send({ to: 'goalkeeper' })), into);
    assert.match(expectDeny(badge, send({ to: 'Goalkeeper 9' })), into);
    assert.match(expectDeny(badge, send({ target: 'the goalkeeper seat' })), into);
    assert.match(expectDeny(badge, mcpSend({ session: '🥅 goalkeeper' })), into);
  });

  test(`adversarial: ${badge} may still say "goalkeeper" in a message BODY`, () => {
    // The project itself is named "goalkeeper" — a lowercase mention in the body is not a
    // reach, only an addressee field is. The badge spelling stays denied anywhere.
    expectAllow(badge, send({ to: 'Giselher', message: 'working on the goalkeeper lane' }));
    assert.match(expectDeny(badge, send({ to: 'Giselher', message: 'ping 🥅 GOALKEEPER 9' })),
      /cannot be addressed by any seat/);
  });
}

test('adversarial: a non-Bash shell wrapper is still a shell reach', () => {
  const mcpShell = (command) => ({ tool_name: 'mcp__shell__exec', tool_input: { command } });
  assert.match(expectDeny(ORCH, mcpShell('curl -s localhost:3131/api/messages -d \'{"to":"🥅 GOALKEEPER 9"}\'')),
    /cannot be reached over the fleet bus/);
  expectAllow(ORCH, mcpShell('curl -s localhost:3131/api/messages -d \'{"to":"orchestrator"}\''));
  assert.match(expectDeny(GK, mcpShell('fleet-notify orchestrator hi')),
    /a goalkeeper never reaches the fleet bus/);
});

test('adversarial: a non-string command neither throws nor denies', () => {
  expectAllow(ORCH, { tool_name: 'mcp__shell__exec', tool_input: { command: {} } });
  expectAllow(GK, { tool_name: 'mcp__shell__exec', tool_input: { command: 42 } });
});

// ------------------------------------------- 9. adversarial — symlinks cannot cross the jail wall
// Lexical resolution alone is not enough: `ln -s /elsewhere <cfg>/goalkeeper/x.js` string-matches
// the jail and then lands outside it. Every path below is a REAL symlink on disk, so these fixtures
// exercise realDeep() — including the dangling-link case that plain realpathSync throws on.
// Note: on macOS os.tmpdir() is itself under a symlink (/var/folders -> /private/var/folders),
// which is why the guard realpaths the jail as well; an in-jail write must still be allowed.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-out-'));
after(() => fs.rmSync(OUT, { recursive: true, force: true }));

fs.mkdirSync(path.join(GK_HOME, 'audits'), { recursive: true });
fs.writeFileSync(path.join(GK_HOME, 'thread.md'), '# thread\n');
fs.mkdirSync(path.join(OUT, 'realsub'));
fs.mkdirSync(path.join(OUT, 'plain'));
fs.writeFileSync(path.join(OUT, 'live.js'), '// live\n');

// inside the jail, pointing out (evil.js is never created — the link dangles)
fs.symlinkSync(path.join(OUT, 'evil.js'), path.join(GK_HOME, 'x.js'));
fs.symlinkSync(path.join(OUT, 'live.js'), path.join(GK_HOME, 'live.js'));
fs.symlinkSync(path.join(OUT, 'realsub'), path.join(GK_HOME, 'sub'));
// inside the jail, pointing back inside it
fs.symlinkSync(path.join(GK_HOME, 'audits'), path.join(GK_HOME, 'alias'));
// outside, pointing in
fs.symlinkSync(GK_HOME, path.join(OUT, 'link-in'));
fs.symlinkSync(path.join(OUT, 'plain'), path.join(OUT, 'plain-link'));
// a loop: neither end resolves
fs.symlinkSync(path.join(OUT, 'loop-b'), path.join(OUT, 'loop-a'));
fs.symlinkSync(path.join(OUT, 'loop-a'), path.join(OUT, 'loop-b'));

const ESCAPE = /a goalkeeper writes only inside its own repo/;

test('adversarial: goalkeeper cannot follow a DANGLING symlink out of its jail', () => {
  // realpathSync throws on a dangling link, so this is the case a naive fix misses — but a Write
  // still follows it and creates the file outside. realDeep() resolves the link by hand.
  assert.match(denyAt(GK_HOME, write(GK_HOME + '/x.js')), ESCAPE);
});

test('adversarial: goalkeeper cannot follow a live symlink out of its jail', () => {
  assert.match(denyAt(GK_HOME, write(GK_HOME + '/live.js')), ESCAPE);
  assert.match(denyAt(GK_HOME, edit(GK_HOME + '/live.js')), ESCAPE);
});

test('adversarial: goalkeeper cannot write a new file under a symlinked dir leaving the jail', () => {
  assert.match(denyAt(GK_HOME, write(GK_HOME + '/sub/new.md')), ESCAPE);
});

test('adversarial: a symlink that stays inside the jail is still allowed (no over-blocking)', () => {
  allowAt(GK_HOME, write(GK_HOME + '/alias/x.md'));
});

test('adversarial: ordinary in-jail writes survive the symlink fix', () => {
  allowAt(GK_HOME, write(GK_HOME + '/thread.md'));            // exists
  allowAt(GK_HOME, write(GK_HOME + '/audits/2026-09-08.md')); // does not exist yet
  allowAt(GK_HOME, write('thread.md'));                       // relative to cwd
});

test('adversarial: other kinds cannot write INTO the jail through a symlink pointing at it', () => {
  const into = /belongs to the 🥅 seat alone/;
  assert.match(expectDeny(ORCH, write(OUT + '/link-in/thread.md')), into);
  assert.match(expectDeny(ORCH, write(OUT + '/link-in/audits/x.md')), into);
});

test('adversarial: symlinks outside the jail are untouched for other kinds', () => {
  expectAllow(ORCH, write(OUT + '/plain/x.md'));
  expectAllow(ORCH, write(OUT + '/plain-link/x.md'));
});

test('adversarial: a symlink loop terminates instead of hanging', () => {
  // realDeep()'s depth-32 cap is what bounds the a -> b -> a ping-pong. Either verdict is fine;
  // what matters is that the guard returns and exits 0 (runRaw asserts the status).
  decideAt(GK_HOME, write(OUT + '/loop-a'));
  decideAt(CWD[ORCH], write(OUT + '/loop-a'));
});
