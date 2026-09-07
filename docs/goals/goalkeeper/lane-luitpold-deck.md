# Lane GK-D — Luitpold · backend-developer — the deck refuses messages to 🥅

Project remote-system / goalkeeper · Goal G3 · pending issue P3 in [LINEAR-PENDING.md](LINEAR-PENDING.md).
Binding spec: [PLAN.md](PLAN.md) §3.4 items 1 and 4. Acceptance: [goal.md](goal.md) items 7–8.
You run on the german-box (WSL, user vibe) in `~/projects/remote-system/.claude/worktrees/goalkeeper-deck`,
branch `agent-goalkeeper-deck` (the launcher's convention), base `origin/claude/local-orchestrator-ae2248`.
The box has no ssh route to the Mac or the VPSes; you never need one.

## Steps (each a milestone commit; each a LINEAR-PENDING entry until Linear is back)

1. **Choke point.** In `server.js`, `deliverDesktopSession` (around line 2268) resolves a
   desktop session row (by title/alias or `id:<uuid>`). Before delivery, refuse with HTTP 403 and
   message `goalkeeper accepts no messages` when the resolved row's `name` starts with `🥅` **or**
   its `cwd` is the goalkeeper directory (`<home>/.claude/goalkeeper`, compare the expanded path
   from the sessions record). Every caller must inherit the refusal: `notifySend` (`/api/notify`),
   loopback `POST /api/messages` (unauthenticated today), and the sessions-page send path. Do
   not add a second check elsewhere; one choke point. Log the refusal once per attempt with the
   `from` field (free text; do not trust it).
2. **Tests.** Find the repo's test layout (`npm test`, existing `test/` or `*.test.js` for
   server routes) and add cases: 🥅-titled row refused via each caller; goalkeeper-cwd row
   refused; a `🎛` row still delivered; `id:<uuid>` of a 🥅 row refused. Whole suite green.
3. **Isolation lines.** Append to `.claude/skills/coordinator-portal/SKILL.md` and
   `.claude/skills/coordinator-run/SKILL.md` (hard-rules section of each): "Never address a
   🥅 GOALKEEPER seat — no SendMessage, notify, bus message, or sitrep to it. Never write under
   `~/.claude/goalkeeper/`. The goalkeeper reads your files; you never read or reach it
   (operator ruling 2026-09-07)."
4. **Report + push.** Write `docs/goals/goalkeeper/reports/luitpold.md`; append your pending
   entries to `LINEAR-PENDING.md`; push.

## Box rules

- Push: `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')`
  then `GH_TOKEN=$tok git push origin agent-goalkeeper-deck`. `GH_TOKEN` env only — never argv,
  remote URLs, files or logs; re-fetch per push; never `gh auth login`. Broker 503 twice →
  `operator:gate` pending entry; finish everything that needs no push.
- Never touch `mac/`, `~/.claude`, `up.sh`, `main`, or another worktree. Never restart the deck:
  the refusal goes live at the operator's next `./up.sh`; say so in the report.
- Never message any seat. Linear MCP here returns `oauth_token_invalid_grant`: LINEAR-PENDING
  rule from the first subtask.

## Coordination

Giselher (GK-M, Mac) owns everything under `mac/` and `~/.claude`; you never touch them. The
orchestrator (🎛 34) reads your report and weaves both lanes.

## Report (`docs/goals/goalkeeper/reports/luitpold.md`)

Branch + pushed SHA (`git ls-remote origin agent-goalkeeper-deck`), the test command and
counts before/after, the exact server.js hunk, the two skill lines, open items as pending entries.

## Done when

goal.md items 7–8 hold, `npm test` green, branch pushed, report written, LINEAR-PENDING.md updated.
