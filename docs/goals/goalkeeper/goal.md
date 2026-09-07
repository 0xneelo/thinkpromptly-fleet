# Goal — Goalkeeper v1 (G3)

Project: **remote-system** · sub-project: **goalkeeper** · Goal: **G3**
(`docs/operator-goals/ledger.json`). Plan: [PLAN.md](PLAN.md) v2 (signed off by the operator
2026-09-07, this session). Orchestrator: 🎛 ORCHESTRATOR 34.

**One line.** One `🥅 GOALKEEPER <N>` desktop seat for all projects that records the operator's
dated directions verbatim, audits what the coordinator and orchestrator seats actually did
against them, and reports drift to the operator only.

## Scope

In: session kind + guard rules; `/goalkeeper` skill; `goalkeeper.py` (`thread add`, `sweep`,
`audit`); the `~/.claude/goalkeeper/` data repo; installer; deck refusal of messages to 🥅;
isolation lines in the seat skills.

Out (v1): HTML render, hourly cron digest, deck goals page, per-turn hook injection into other
seats, intent inbox, ledger locking. Retired 09-05 lanes L1/L5/L6 stay retired.

## Acceptance (definition of done for G3 v1)

1. `sh ~/.claude/session-kind/mark.sh --goalkeeper "<topic>"` prints `🥅 GOALKEEPER <N>`;
   `census.py` counts it; `mark.sh` refuses a second `--goalkeeper` while census shows a live 🥅.
2. `guard.js` unit tests (node, fixtures, no live marks touched) prove: goalkeeper kind denies
   builders, `introduce-goal`, every `SendMessage`/`mcp__ccd_session_mgmt__send_message`, Bash
   matching `fleet-notify|fleet-message|api/notify|api/messages|\.claude/sessions/`, and writes
   outside `~/.claude/goalkeeper/` + scratchpad; every other kind denies `SendMessage`/
   `send_message` whose serialised input contains `GOALKEEPER` or `🥅`, and writes under
   `/goalkeeper/`; all existing rules unchanged (regression fixtures per kind). `settings.json`
   PreToolUse matcher is `Agent|Task|Edit|Write|NotebookEdit|Skill|Bash|SendMessage|mcp__ccd_session_mgmt__send_message`.
3. `~/.claude/skills/goalkeeper/` holds `SKILL.md` (auditor charter, PLAN §3), `references/anchor-check.md`
   (Bertwin's verdict machine, adapted), `goalkeeper.py`.
4. `goalkeeper.py thread add|sweep|audit` pass fixture tests; `sweep.json` matches PLAN §3.2;
   the operator-turn filter is PLAN §3.3 verbatim; a fetch failure yields `fetched_at: null`.
5. `~/.claude/goalkeeper/` is a git repo with `projects.json` (remote-system, lowcap-connector,
   alias `lowcapsxyz`), `thread.md`, `audits/`, first commit.
6. One real `sweep --since 2026-09-06T00:00:00Z` + `audit` over this Mac; the audit note is
   attached to the lane report.
7. `server.js deliverDesktopSession` returns 403 for a row whose name starts with `🥅` or whose
   cwd is `~/.claude/goalkeeper`; covered by the repo test suite; `.claude/skills/coordinator-portal`
   and `coordinator-run` carry the isolation line.
8. Reports at `docs/goals/goalkeeper/reports/<name>.md`; branches pushed; pending Linear
   entries in [LINEAR-PENDING.md](LINEAR-PENDING.md).

## Constraints (bind both lanes)

- Linear is unreachable (box MCP token dead, no Linear MCP on the Mac desktop). Apply the
  LINEAR-PENDING rule from minute one. Never a blocker.
- Push on the broker token only (`GH_TOKEN` env, never argv/URL/file). Never push to `main`.
  Broker 503 twice → `operator:gate` entry, keep working on what does not need a push.
- Never restart the deck; `up.sh` is operator-only. Never message any seat. Never touch
  `~/.claude/session-kind/marks/`, `numbers.db`, or another lane's files.
- Evidence docs, read-only: `origin/claude/goal-keeper-role-4b183a` (09-05 gap analysis + lane
  plan) and `origin/agent-gk-l3-skill` d451497 (Bertwin's skill draft). Where they disagree with
  PLAN.md v2, PLAN.md wins.
- Giselher runs on the operator's Mac by explicit operator ruling 2026-09-07 (exception to the
  2026-09-06 "all workers run on the german-box" rule): every v1 artifact lives under `~/.claude`.

## Lanes

| Lane | Worker | Where | Breed | Brief |
|---|---|---|---|---|
| GK-M | Giselher · tooling-engineer | Mac, worktree `.claude/worktrees/goalkeeper-mac` | Claude, plain boot (operator switches the pane to auto mode once) | [lane-giselher-mac.md](lane-giselher-mac.md) |
| GK-D | Luitpold · backend-developer | german-box, worktree `.claude/worktrees/goalkeeper-deck` | Codex `gpt-6-astra` xhigh, `/goal` | [lane-luitpold-deck.md](lane-luitpold-deck.md) |

Base for both: `origin/claude/local-orchestrator-ae2248` (carries this pack).

## After the lanes

Orchestrator 34 reviews both branches, weaves onto `main` as `weave/goalkeeper-v1`, hands the
operator ONE gate: `./up.sh` (deck refusal goes live) — the Mac install is already live via
Giselher's installer. Then the operator opens the first 🥅 seat: new desktop session with cwd
`~/.claude/goalkeeper`, `/goalkeeper`.
