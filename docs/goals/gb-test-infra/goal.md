# Goal — GB test infra (Lorenz · qa-expert) — XYZ-1851

Project **remote-system (fleetdeck)** · prerequisite of the GB-home migration (XYZ-1850
ruling). Filed by Kendra during XYZ-1842; scope is exactly her two findings.

**One line:** make `npm test` on the german-box trustworthy — the suite must be runnable
from a fresh worktree without tribal knowledge, and a full-suite red must mean a real
failure, not box load.

## Scope

1. **The undocumented install.** A fresh worktree dies on `Cannot find module 'ws'`.
   Fix per repo convention: document the `npm install` prerequisite where a worker will
   actually see it (README test section) AND make the failure self-explaining — e.g. a
   pretest check that prints "run npm install first" instead of a stack trace. Worker
   picks the mechanism; the acceptance is that a fresh worktree gives a clear next step.
2. **The two load-flakes** (~1 in 4 under load, pass alone, base passes unloaded):
   - `test/kill-race.test.js:125` (M5 — reappeared session not killed; got reaped)
   - `test/seats-fencing.test.js:486` (M14 — /api/health reaper tick age)
   Make them robust to a loaded box WITHOUT weakening what they assert — fix the timing
   assumptions (fake clocks, event hooks, generous-but-bounded waits), never the claim.
   Prove: 8 consecutive full-suite runs green under parallel load on the box.

## Out of scope

Everything else — server.js, coordinator, broker. Zita (XYZ-1854) owns server.js right
now; do not touch it.

## Acceptance

1. Fresh worktree + `npm test` → either green or a one-line actionable message.
2. 8/8 full-suite green under load; the two tests still fail when their guarded behavior
   is genuinely broken (prove by reverting the behavior once, test-only).
3. `agent-lorenz` pushed; XYZ-1851 Done with report `docs/goals/gb-test-infra/reports/lorenz.md`.

## Protocol (short form)

You are Lorenz, a qa-expert. Badge `🔨 WORKER · Lorenz`; tag `agent-lorenz`; sign as
Lorenz. Labels `session:cli-worker` + `agent-lorenz` + `project:remote-system` on the
lane issue and any subtasks (`[Lorenz · qa-expert]` prefix). Commit per milestone;
reviewer subagent on the diff. Never orchestrate; blocked → `operator:gate`. Push via
train broker token, env only, re-fetch per operation
(`http://100.125.231.25:3131/api/ghtoken`); broker 503 → standing abort, file the gate.
