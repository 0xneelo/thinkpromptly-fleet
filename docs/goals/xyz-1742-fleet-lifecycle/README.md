# Goal pack — XYZ-1742 fleet lifecycle ownership + org chart

Project **remote-system** · sub-project **fleetdeck-lifecycle** · parent issue **XYZ-1742**
Packaged by 🎛 ORCHESTRATOR 17, 2026-08-27, from `HANDOFF-XYZ-1742-orgchart.md` (O12) +
`AUDIT-XYZ-1742-lane1.md` (Fable audit, verdict AMEND FIRST — amendments folded into
`CONTRACT.md`, which is FROZEN).

## Operator decisions (2026-08-27, in-session)

1. Hosting: **german-box**, all three lanes in parallel (overrides the handoff's Mac-local
   deviation; Lane 2's Mac-side install becomes an operator step).
2. Breeds: Lane 1 + 2 **Claude** (fast mode), Lane 3 **GPT 5.6 SOL xhigh** (Codex).
3. Run mode: **/goal** on all lanes, stop conditions written into each objective.
4. Lane 1 acceptance (M16 option b): **15 named defects + M1–M17 + S1–S7** — not the
   unenumerable "35".

## Lanes

| Lane | Worker | Role | Branch | Files | Pack |
|---|---|---|---|---|---|
| 1 backend | Edith | backend-developer | `agent-edith` | `server.js` + schema | `lane1-backend.md` |
| 2 hooks | Konrad | devops-engineer | `agent-konrad` | `box/hooks/` (new), box `~/.claude` | `lane2-hooks.md` |
| 3 org-chart UI | Alfons | frontend-developer | `agent-alfons` | `public/` | `lane3-orgchart-ui.md` |

Files are disjoint; lanes run in parallel against `CONTRACT.md`. Lane 1 implements the
contract; Lanes 2/3 stub against it until `agent-edith` lands, then integrate.
Contract deviation = `operator:gate` issue, never improvisation.

## Shared rules (all lanes)

- **Worktree/branch**: `~/projects/remote-system/.claude/worktrees/<name>` on the box,
  branch `agent-<name>` off `origin/claude/xyz-1742-fleet-orgchart-c2b616`.
- **Never orchestrate**: no /introduce-goal, no peer sessions, no new lanes. Out-of-scope
  → Linear issue. In-session subagents (reader/builder/reviewer) yes.
- **Linear**: create your lane issue under XYZ-1742 on start — title
  `[<Name> · <role>] Lane N — <slug>`, labels `session:cli-worker`,
  `project:remote-system`, `subproject:fleetdeck-lifecycle`, `agent-<name>`; In Progress
  on start, checkpoint every milestone, Done + report at end. Linear OAuth dead → commit
  the would-be comment to `docs/goals/xyz-1742-fleet-lifecycle/reports/` on your branch.
- **Pushes**: train-broker token per push, GH_TOKEN env only (see prompt files). curl 503
  = train closed → operator:gate issue and stop.
- **Registry**: the launcher registers you (`group:xyz-1742`, `task:XYZ-1742`); before
  your final report POST `{"host":"german-box","name":"FD-<name>","status":"done"}` to
  `http://100.125.231.25:3131/api/registry`.
- **Test instances**: never touch the operator's live deck (Mac :3131) or its `fleet.db`.
  Run your own instance in your worktree on another port with a local `hosts.json`;
  your own `fleet.db` is disposable.
- **SSH**: read `deploy-keys/AGENT.md` first; workers never mint or `ssh-add`.

## Launch (operator, plain terminal — see `launch/`)

`launch/gb-launch-fd.sh` + three prompt files stage to the box at `~/gb-launch-fd.sh`
and `~/launch/launch-{edith,konrad,alfons}.txt`. One call per lane:
`wsl sh gb-launch-fd.sh Edith edith claude`, `… Konrad konrad claude`,
`… Alfons alfons gpt xhigh`.
