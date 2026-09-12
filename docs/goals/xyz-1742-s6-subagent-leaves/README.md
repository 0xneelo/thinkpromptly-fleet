# Goal pack — XYZ-1742 S6: subagent leaves in the org chart

Project **remote-system** · sub-project **fleetdeck-lifecycle** · parent issue **XYZ-1742**
Drafted 2026-09-03 in worktree `agenttrail-org-chart-eval-9e222c` from the agenttrail
evaluation (github.com/sodiumsun/agenttrail, MIT). Status: **DRAFT — needs operator
sign-off (decisions below) before launch.**

## Why

CONTRACT v1 left leaf subagents OUT of the tree: "no data source exists"
(`AUDIT-XYZ-1742-lane1.md:76`, `CONTRACT.md` §Org tree, S6). The source exists.
Claude Code 2.1.259 fires two hooks, verified against the installed binary:

| Event | Fires | stdin JSON adds |
|---|---|---|
| `SubagentStart` | when an Agent-tool subagent starts | `agent_id`, `agent_type` (+ common: `session_id`, `cwd`, `hook_event_name`) |
| `SubagentStop` | right before it concludes | `agent_id`, `agent_type`, `agent_transcript_path` |

`agent_id` pairs start to stop exactly, so parallel fan-outs never mis-pair. (agenttrail
pairs "first unended" on PreToolUse `Task` — we do better.) Exit-0 stdout on
`SubagentStart` is injected into the subagent as `additionalContext`, so the relay prints
nothing, ever.

## What lands

One lane, one worker. Three disjoint touch areas, one branch:

| Area | Files | Change |
|---|---|---|
| hooks | `box/hooks/fd-subagent.sh` (new), `install-box.sh`, `INSTALL-MAC.md` | relay `SubagentStart`/`SubagentStop` → deck, fail-silent, reuses `fd-common.sh` identity + auth |
| backend | `server.js`, `test/` | table `subagents`, `POST /api/subagent`, `GET /api/subagents`, reaper cascade + retention |
| UI | `public/orgchart.js`, `public/app.js`, `public/style.css`, fixture | leaves under their parent session, compact chips, done/offline states |

Contract: `CONTRACT-ADDENDUM.md` (v1.1, additive only, M10 spirit). Lane brief:
`lane-odilia.md`. Launch: `launch/launch-odilia.txt`.

## Operator decisions needed (Phase 2 sign-off)

1. **Approve CONTRACT v1.1 addendum.** v1 is frozen; S6 was explicitly out. Addendum is
   additive: one table, two routes, one reaper cascade. Recommendation: **yes**.
2. **Breed/host/mode:** Claude, german-box, `/goal` (same as Lanes 1–2).
   Recommendation: **yes**.
3. **Role:** `fullstack-developer` (hooks + server + UI in one slice). Name **Odilia**
   already claimed for `XYZ-1742-S6`. Confirm or override.
4. **Base branch:** `main` at `f4652da` (Lanes 1–3 landed there). Branch `agent-odilia`.
5. **Mac install is an operator step** (worker never touches the Mac): add the two hook
   entries per the new `INSTALL-MAC.md` section so desktop orchestrator/researcher seats
   show their readers too.
6. **Codex breed shows no leaves.** Codex has no hooks (same limit Lane 2 hit). Accept
   for v1.1, or file a follow-up for `fd-codex-wrap.sh` transcript tailing.

## Shared rules

Same as `../xyz-1742-fleet-lifecycle/README.md` §Shared rules: worktree
`~/projects/remote-system/.claude/worktrees/odilia`, never orchestrate, Linear issue under
XYZ-1742 (fallback: commit report under `reports/`), train-broker token per push, registry
`done` before final report, never touch the operator's live deck or its `fleet.db`, read
`deploy-keys/AGENT.md` before any ssh.

## Launch (operator)

Stage `../xyz-1742-fleet-lifecycle/launch/gb-launch-fd.sh` + `launch/launch-odilia.txt`
to the box, then: `wsl sh gb-launch-fd.sh Odilia odilia claude`.
