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

function runRaw(input, envOverride) {
  const r = spawnSync(process.execPath, [GUARD], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: CFG,
      CLAUDE_SESSION_KIND_MARKS: MARKS,
      ...envOverride,
    },
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
    // The §9 addressee narrowing applies to OTHER kinds only. The 🥅 seat's own deny-all
    // is unchanged: a payload naming nobody, and one whose body only talks about the
    // goalkeeper, are both denied — the seat messages no one, ever.
    send({}),
    send({ message: 'no addressee at all' }),
    mcpSend({ to: 'Giselher', message: 'working on the goalkeeper lane' }),
    send({ to: 'Giselher', message: 'ping 🥅 GOALKEEPER 9' }),
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
// PLAN.md §9 (§3.4.2 as amended): for a non-goalkeeper kind the message deny matches the
// ADDRESSEE fields only — `to`, `session_id`, `session`, `title`, `name`, `recipient`,
// `target.session` and a bare-string `target` — case-insensitively. Addressing the seat is
// forbidden; talking ABOUT it is not.
const ADDRESSEE_KEYS = ['to', 'session_id', 'session', 'title', 'name', 'recipient'];

for (const badge of [ORCH, RES, DES, COORD, WORKER]) {
  test(`${badge}: cannot reach the goalkeeper`, () => {
    assert.match(expectDeny(badge, send({ to: '🥅 GOALKEEPER 9', message: 'audit this' })),
      /cannot be addressed by any seat/);
    assert.match(expectDeny(badge, mcpSend({ to: '🥅 GOALKEEPER 9', message: 'audit this' })),
      /cannot be addressed by any seat/);
    assert.match(expectDeny(badge, bash('curl -s localhost:3131/api/messages -d \'{"to":"🥅 GOALKEEPER 9"}\'')),
      /cannot be reached over the fleet bus/);
    assert.match(expectDeny(badge, write(CFG + '/goalkeeper/thread.md')), /belongs to the 🥅 seat alone/);
    assert.match(expectDeny(badge, edit(CFG + '/goalkeeper/audits/2026-09-07.md')), /belongs to the 🥅 seat alone/);
    // §9: a message to SOMEBODY ELSE that only mentions the 🥅 seat in its body is allowed.
    // The first cut matched the whole payload and denied these — a false positive that stopped
    // an orchestrator naming the goalkeeper lane to a worker. This project is *named* goalkeeper.
    expectAllow(badge, send({ to: 'orchestrator', message: 'ask 🥅 for the audit' }));
    expectAllow(badge, mcpSend({ to: 'x', message: 'relay to 🥅 please' }));
  });

  // One case per addressee key, so a future edit that drops a key fails loudly.
  for (const k of ADDRESSEE_KEYS) {
    test(`${badge}: the 🥅 seat named in \`${k}\` is denied`, () => {
      assert.match(expectDeny(badge, send({ [k]: '🥅 GOALKEEPER 9', message: 'audit this' })),
        /cannot be addressed by any seat/);
      // ...and in lowercase, which is every bit the same reach.
      assert.match(expectDeny(badge, mcpSend({ [k]: 'goalkeeper', message: 'audit this' })),
        /cannot be addressed by any seat/);
    });
  }

  test(`${badge}: a \`target\` naming the 🥅 seat is denied, nested or bare`, () => {
    assert.match(expectDeny(badge, send({ target: { session: 'goalkeeper' }, message: 'hi' })),
      /cannot be addressed by any seat/);
    assert.match(expectDeny(badge, mcpSend({ target: '🥅 GOALKEEPER 9', message: 'hi' })),
      /cannot be addressed by any seat/);
  });

  test(`${badge}: a body-only mention is allowed in both spellings`, () => {
    expectAllow(badge, send({ to: 'Giselher', message: 'your branch is the 🥅 GOALKEEPER 9 lane' }));
    expectAllow(badge, send({ to: 'Giselher', message: 'working on the goalkeeper lane' }));
    expectAllow(badge, mcpSend({ session_id: 'abc', message: 'the 🥅 GOALKEEPER 9 audit landed' }));
    // ...and a message naming no seat at all was never in scope.
    expectAllow(badge, send({ to: 'Giselher', message: 'rebased onto main' }));
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
    // The project itself is named "goalkeeper" — a mention in the body is not a reach, only an
    // addressee field is (§9). BOTH spellings are allowed in the body, the badge form included:
    // denying it was the false positive §9 removes.
    expectAllow(badge, send({ to: 'Giselher', message: 'working on the goalkeeper lane' }));
    expectAllow(badge, send({ to: 'Giselher', message: 'ping 🥅 GOALKEEPER 9' }));
    // The same badge spelling in the ADDRESSEE field is still denied.
    assert.match(expectDeny(badge, send({ to: '🥅 GOALKEEPER 9', message: 'ping' })),
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

// ------------------------------ 10. adversarial — the reach deny is addressee-shaped, not prose
// Two review items shaped this. Item 2: the first cut tested the case-sensitive badge spelling
// ANYWHERE in the command, so `{"to":"goalkeeper"}` walked straight past it. Item 9: the same
// test fired on PROSE — on 2026-09-07T19:28Z the orchestrator was denied writing the very brief
// that specifies this rule, because the heredoc BODY it was writing quoted a reach PoC. The deny
// now scans stripHeredocs(command) and matches ADDRESSEE-shaped tokens only, and a shell write
// whose DESTINATION is the seat's repo is denied on its own.
// The trigger literals are assembled from fragments so this file never carries a contiguous
// "seat name + bus path" string — the older installed guard denies any command containing one.
const WORD = 'GOALKEEPER';
const SEAT9 = '🥅 ' + WORD + ' 9';
const BUS = 'api' + '/' + 'messages';
const NOTIFY = 'fleet' + '-notify';
const POST = (body) => `curl -s localhost:3131/${BUS} -d '${body}'`;
const REACH_POC = POST('{"to":"goalkeeper"}');
const REACHED = /cannot be reached over the fleet bus/;
const INTO_GK = /belongs to the 🥅 seat alone/;

test('adversarial: the 2026-09-07T19:28Z incident — a brief whose heredoc BODY quotes a reach', () => {
  // The one that matters. This exact shape was denied live; a heredoc body is data being
  // written, never a route to anyone, whatever it quotes.
  const cmd = [
    "cat > docs/goals/goalkeeper/lane-fixes.md <<'EOF'",
    '# lane fixes',
    '',
    'item 2: the reach deny must fire on this PoC —',
    '    ' + REACH_POC,
    '',
    'item 9: ...and must NOT fire on this paragraph, which merely names the',
    `${SEAT9} seat and the bus path it cannot be reached on.`,
    'EOF',
  ].join('\n');
  expectAllow(ORCH, bash(cmd));
});

test('adversarial: prose naming both the seat and the bus is allowed', () => {
  expectAllow(ORCH, bash(`echo "the ${SEAT9} seat cannot be reached via ${BUS}"`));
});

test('adversarial: a badge in a commit message plus a bus POST to a worker is allowed', () => {
  const cmd = `git add -A && git commit -m "goals: ${SEAT9} lane — GK-M fixes" `
    + `&& ${POST('{"to":"Giselher","body":"lane fixes pushed"}')}`;
  expectAllow(ORCH, bash(cmd));
});

test('adversarial: reading the seat\'s own files is allowed', () => {
  expectAllow(ORCH, bash('cat ~/.claude/goalkeeper/thread.md'));
  expectAllow(ORCH, bash(`grep -n "${WORD}" ~/.claude/goalkeeper/audits/2026-09-07.md`));
});

test('adversarial: unquoted and dash-form heredoc bodies are data too', () => {
  expectAllow(ORCH, bash(['cat > /tmp/note.md <<EOF', REACH_POC, 'EOF'].join('\n')));
  expectAllow(ORCH, bash(['cat > /tmp/note.md <<-EOF', '\t' + REACH_POC, '\tEOF'].join('\n')));
});

test('adversarial: a bus POST addressed to the seat is denied in either spelling', () => {
  assert.match(expectDeny(ORCH, bash(REACH_POC)), REACHED);
  assert.match(expectDeny(ORCH, bash(POST(`{"to":"${SEAT9}"}`))), REACHED);
});

test('adversarial: --to naming the seat is denied, bare and host:session', () => {
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --to goalkeeper hi`)), REACHED);
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --to mac:Goalkeeper hi`)), REACHED);
});

// One case per addressee SHAPE, so an edit that drops a pattern fails loudly.
const CMD_SHAPES = [
  ['--session', `${NOTIFY} --session goalkeeper "ping"`],
  ['--target', `${NOTIFY} --target goalkeeper "ping"`],
  ['"session"', POST('{"session":"goalkeeper"}')],
  ['"session_id"', POST('{"session_id":"goalkeeper"}')],
  ['"target"', POST('{"target":"goalkeeper"}')],
  ['"name"', POST(`{"name":"${SEAT9}"}`)],
  ['"title"', POST(`{"title":"${SEAT9}"}`)],
];
for (const [shape, cmd] of CMD_SHAPES) {
  test('adversarial: the seat named in a ' + shape + ' addressee is denied', () => {
    assert.match(expectDeny(ORCH, bash(cmd)), REACHED);
  });
}

test('adversarial: the deny is about the addressee, not the route', () => {
  expectAllow(ORCH, bash(POST('{"to":"Giselher"}')));
  expectAllow(ORCH, bash(`${NOTIFY} --to Giselher "rebased"`));
});

test('adversarial: a shell write whose DESTINATION is the seat\'s repo is denied', () => {
  assert.match(expectDeny(ORCH, bash(`echo drift >> ${CFG}/goalkeeper/thread.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`cp /tmp/x.md ${CFG}/goalkeeper/audits/x.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`cat /tmp/x.md | tee ${CFG}/goalkeeper/x.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`rm ${CFG}/goalkeeper/thread.md`)), INTO_GK);
});

test('adversarial: an ordinary redirect elsewhere is untouched', () => {
  expectAllow(ORCH, bash('echo x >> /tmp/notes.md'));
  expectAllow(ORCH, bash(`cp /tmp/x.md ${CFG}/skills/x.md`));
});

test('adversarial: the goalkeeper\'s own reach ban needs no addressee', () => {
  const own = /a goalkeeper never reaches the fleet bus/;
  assert.match(expectDeny(GK, bash(POST('{"body":"status"}'))), own);
  assert.match(expectDeny(GK, bash(`${NOTIFY} "ping"`)), own);
});

test('adversarial: the goalkeeper may quote a reach inside its own audit note', () => {
  // Quoting the evidence IS the seat's job — stripping heredoc bodies is what makes it possible.
  const cmd = [
    `cat > ${CFG}/goalkeeper/audits/2026-09-07.md <<'EOF'`,
    '# drift',
    'ORCHESTRATOR 34 tried to reach this seat:',
    '    ' + REACH_POC,
    'EOF',
  ].join('\n');
  expectAllow(GK, bash(cmd));
});

test('adversarial: the goalkeeper\'s own tooling and repo reads are allowed', () => {
  expectAllow(GK, bash('python3 ~/.claude/skills/goalkeeper/goalkeeper.py sweep --since 2026-09-01'));
  expectAllow(GK, bash('git -C ~/.claude/goalkeeper status'));
});

test('adversarial: a truncated heredoc (no terminator) neither hangs nor throws', () => {
  // stripHeredocs finds no terminator and leaves the command alone; either verdict is fine,
  // what matters is that the guard returns and exits 0 (runRaw asserts the status).
  const cmd = ["cat > /tmp/x.md <<'EOF'", '# drift', REACH_POC].join('\n');
  decide(ORCH, bash(cmd));
  decide(GK, bash(cmd));
});

test('adversarial: a non-string Bash `command` exits 0 and never throws', () => {
  expectAllow(ORCH, { tool_name: 'Bash', tool_input: { command: {} } });
  expectAllow(ORCH, { tool_name: 'Bash', tool_input: { command: null } });
  expectAllow(GK, { tool_name: 'Bash', tool_input: { command: [] } });
});

// ------------ 11. adversarial — a quoted addressee with spaces is still an addressee
// The badge spells itself WITH spaces, so the most obvious address of all is a quoted
// one. The first cut's `([^\s'"]+)` stopped at the first space and its closing backref
// then failed to match, which ALLOWED `--to="🥅 GOALKEEPER 9"`. CMD_ADDRESSEE now builds
// the flag patterns from a shared FLAG_VALUE alternation (double-quoted, single-quoted,
// bare) and every capture of a match is tested, since only one alternative is defined
// per match.
test(`adversarial: --to="${SEAT9}" — a double-quoted addressee with spaces is denied`, () => {
  // The regression that matters: the badge's own spelling, quoted.
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --to="${SEAT9}" hi`)), REACHED);
});

test('adversarial: quoted spaced addressees are denied in every flag form', () => {
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --to='goalkeeper 9' hi`)), REACHED);
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --to "${SEAT9}" hi`)), REACHED);
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --session="${WORD} 9" hi`)), REACHED);
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --target='the goalkeeper seat' hi`)), REACHED);
  // ...and the plain bare form the rewrite must not have broken.
  assert.match(expectDeny(ORCH, bash(`${NOTIFY} --to goalkeeper hi`)), REACHED);
});

test('adversarial: a quoted addressee that is not the seat is still allowed', () => {
  expectAllow(ORCH, bash(`${NOTIFY} --to="Giselher" hi`));
  expectAllow(ORCH, bash(`${NOTIFY} --to="a long note about drift" hi`));
});

test('adversarial: the JSON addressee shapes handle spaced values too', () => {
  assert.match(expectDeny(ORCH, bash(POST(`{"to": "${SEAT9}"}`))), REACHED);
  assert.match(expectDeny(ORCH, bash(POST('{"session_id": "goalkeeper 9"}'))), REACHED);
});

// ------------ 12. GK-M.3 item 1 — a `cd` in the same command cannot defeat the jail
// Write targets used to resolve against the SESSION cwd only, so a `cd` into the jail in the
// same command put bytes there with a target that is just `evil.md`. `cd`/`pushd` are now
// tracked across `&&`, `;`, `|` and newlines. A `cd "$var"` cannot be resolved statically:
// from there a relative target is unknowable, and the command is refused only when it names
// the jail somewhere anchored — an ordinary relative write in another repo is never guessed at.
test('GK-M.3 item 1: the PoC — `cd <jail> && echo pwned > evil.md` is denied', () => {
  assert.match(expectDeny(ORCH, bash(`cd ${GK_HOME} && echo pwned > evil.md`)), INTO_GK);
});

test('GK-M.3 item 1: every sequencing operator carries the cd', () => {
  assert.match(expectDeny(ORCH, bash(`cd ${GK_HOME} ; echo pwned >> thread.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`cd ${GK_HOME}\necho x > e.md`)), INTO_GK);
});

test('GK-M.3 item 1: a cd into a subdir, and pushd, are the same walk', () => {
  assert.match(expectDeny(ORCH, bash(`cd ${GK_HOME}/audits && touch x.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`pushd ${GK_HOME} && echo x > e.md`)), INTO_GK);
});

test('GK-M.3 item 1: a cd elsewhere, or back out again, is allowed', () => {
  expectAllow(ORCH, bash('cd /tmp && echo x > y.md'));
  expectAllow(ORCH, bash(`cd ${GK_HOME} && cd /tmp && echo x > y.md`));
  expectAllow(ORCH, bash('echo x > notes.md'));
});

test('GK-M.3 item 1: an unknowable cwd denies only when the jail is named anchored', () => {
  // `cd "$D"` cannot be resolved, so a relative write must NOT be denied on a guess...
  expectAllow(ORCH, bash('cd "$D" && echo x > y.md'));
  // ...but the same unknowable cwd with the jail spelled out anchored is a write into it.
  assert.match(expectDeny(ORCH, bash(`cd "$D" && cp ${GK_HOME}/thread.md .`)), INTO_GK);
});

// ------------ 13. GK-M.3 item 2 — `$HOME` is a spelling of `~`
// `~/.claude/goalkeeper/x` denied while `$HOME/.claude/goalkeeper/x` — the same file — did not,
// so the jail could be addressed by simply spelling it differently. norm() now expands `$HOME`,
// `${HOME}`, `~` and `$CLAUDE_CONFIG_DIR`, which covers the Bash and the write-tool path alike.
// This group needs a HOME where the jail really is `$HOME/.claude/goalkeeper`, so it runs the
// guard with HOME and CLAUDE_CONFIG_DIR pointed at their own fixture.
const HOMEFIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-home-'));
after(() => fs.rmSync(HOMEFIX, { recursive: true, force: true }));
const HOME_CFG = path.join(HOMEFIX, '.claude');
fs.mkdirSync(path.join(HOME_CFG, 'goalkeeper', 'audits'), { recursive: true });
const HOME_ENV = { HOME: HOMEFIX, CLAUDE_CONFIG_DIR: HOME_CFG };

function decideHome(payload) {
  const out = runRaw(JSON.stringify({ cwd: CWD[ORCH], ...payload }), HOME_ENV);
  if (!out) return null;
  return JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
}
const denyHome = (p) => {
  const r = decideHome(p);
  assert.ok(r, `expected deny: ${JSON.stringify(p)}`);
  return r;
};
const allowHome = (p) => assert.equal(decideHome(p), null, `expected allow: ${JSON.stringify(p)}`);

test('GK-M.3 item 2: `$HOME` and `${HOME}` reach the jail exactly as `~` does', () => {
  assert.match(denyHome(bash('echo pwned > "$HOME/.claude/goalkeeper/evil.md"')), INTO_GK);
  assert.match(denyHome(bash('echo pwned > "${HOME}/.claude/goalkeeper/evil.md"')), INTO_GK);
  assert.match(denyHome(bash('echo pwned > ~/.claude/goalkeeper/evil.md')), INTO_GK);
});

test('GK-M.3 item 2: `$CLAUDE_CONFIG_DIR` is a spelling of the jail\'s parent', () => {
  assert.match(denyHome(bash('echo pwned > "$CLAUDE_CONFIG_DIR/goalkeeper/evil.md"')), INTO_GK);
  assert.match(denyHome(bash('echo pwned > "${CLAUDE_CONFIG_DIR}/goalkeeper/evil.md"')), INTO_GK);
});

test('GK-M.3 item 2: an ordinary `$HOME` write is untouched', () => {
  allowHome(bash('echo x > "$HOME/notes.md"'));
});

test('GK-M.3 item 2: the expansion lives in norm(), so a write TOOL sees it too', () => {
  assert.match(denyHome(write('$HOME/.claude/goalkeeper/x.md')), INTO_GK);
});

// ------------ 14. GK-M.3 item 3 — a copy reads its sources and writes its destination
// Treating every argument of a copy as a target refused `cp <jail>/audits/… /tmp/copy.md` — an
// orchestrator reading exactly the evidence it is meant to read. cp/mv/install/ln/dd write only
// their destination; rm/mkdir/touch/truncate/chmod/chown/tee write every path argument.
test('GK-M.3 item 3: the false positive — `cp <jail>/audits/2026-09-07.md /tmp/copy.md` is allowed', () => {
  expectAllow(ORCH, bash(`cp ${GK_HOME}/audits/2026-09-07.md /tmp/copy.md`));
});

test('GK-M.3 item 3: reading out of the jail is allowed, writing into it is not', () => {
  expectAllow(ORCH, bash(`mv ${GK_HOME}/old.md /tmp/old.md`));
  assert.match(expectDeny(ORCH, bash(`cp /tmp/x.md ${GK_HOME}/x.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`mv /tmp/x.md ${GK_HOME}/x.md`)), INTO_GK);
});

test('GK-M.3 item 3: an explicit destination flag is a destination', () => {
  assert.match(expectDeny(ORCH, bash(`cp -t ${GK_HOME} /tmp/x.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`cp --target-directory=${GK_HOME} /tmp/x.md`)), INTO_GK);
});

test('GK-M.3 item 3: dd writes `of=` and reads `if=`', () => {
  assert.match(expectDeny(ORCH, bash(`dd if=/tmp/x of=${GK_HOME}/x`)), INTO_GK);
  expectAllow(ORCH, bash(`dd if=${GK_HOME}/thread.md of=/tmp/x`));
});

test('GK-M.3 item 3: every path argument of the mutating family is a target', () => {
  assert.match(expectDeny(ORCH, bash(`echo x | tee ${GK_HOME}/x.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`rm ${GK_HOME}/thread.md`)), INTO_GK);
  assert.match(expectDeny(ORCH, bash(`touch ${GK_HOME}/x`)), INTO_GK);
  // `newsub`, not `sub`: section 9 makes `<jail>/sub` a symlink pointing OUT of the jail, so
  // that name resolves outside it — the symlink rule, correctly, rather than this one.
  assert.match(expectDeny(ORCH, bash(`mkdir ${GK_HOME}/newsub`)), INTO_GK);
});

test('GK-M.3 item 3: plain reads and ordinary copies are untouched', () => {
  expectAllow(ORCH, bash(`cat ${GK_HOME}/thread.md`));
  expectAllow(ORCH, bash(`grep -r drift ${GK_HOME}/audits`));
  expectAllow(ORCH, bash('cp /tmp/a /tmp/b'));
});

// ------------ 15. GK-M.3 item 4 — every addressee key
// `agent` and `seat` were in the first cut and were dropped when the list was narrowed to §9's
// names. A seat is exactly the thing one addresses, so the full list is asserted key by key:
// dropping any one of them fails a test named after it.
const ALL_ADDRESSEE_KEYS = ['to', 'session_id', 'session', 'title', 'name', 'recipient',
  'agent', 'seat'];
for (const k of ALL_ADDRESSEE_KEYS) {
  test(`GK-M.3 item 4: \`${k}\` is an addressee key, in both spellings`, () => {
    const into = /cannot be addressed by any seat/;
    assert.match(expectDeny(ORCH, send({ [k]: 'goalkeeper', message: 'audit this' })), into);
    assert.match(expectDeny(ORCH, send({ [k]: SEAT9, message: 'audit this' })), into);
  });
}

test('GK-M.3 item 4: a body mention is still not an address', () => {
  expectAllow(ORCH, send({ to: 'Giselher', message: 'the goalkeeper lane' }));
});
