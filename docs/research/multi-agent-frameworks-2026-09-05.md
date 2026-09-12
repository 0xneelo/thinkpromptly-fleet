# Multi-agent frameworks vs the fleet (2026-09-05)

Source: 10 reader subagents. 5 mapped this repo + the skill dirs, 5 pulled framework docs.
Question: are LangGraph / CrewAI / AutoGen (or others) useful for orchestrator, coordinator,
goal-tracker, worker, fleetdeck?

## Verdict

None of the three fits as the fleet runtime. All assume agents are in-process LLM loops.
Our agents are external processes: tmux CLI sessions on the german-box and desktop-app seats.
Two things are worth taking: LangGraph's checkpoint + interrupt semantics, and Agent Framework's
request/response ports. Both describe the one thing the fleet lacks: a durable lane state machine.

| Framework | As fleet runtime | Steal |
|---|---|---|
| LangGraph (MIT, Py+TS, sqlite/postgres checkpointers) | No as agent runtime. Usable as a plain library: nodes are plain functions, `interrupt()` pauses and persists, `Command(resume=)` continues, `RetryPolicy` per node, `Send` fan-out. Docs confirm no LLM needed. | thread-per-goal; checkpoint per super-step; interrupt = wait for external event; node re-runs from top on resume so nodes must be idempotent |
| CrewAI (MIT, Python only) | No. `Task.agent` must be an LLM `BaseAgent`; no pluggable executor. | Flow `@human_feedback` with async providers (Slack/webhook); checkpoint fork/resume via CLI |
| AutoGen (MIT) | No. Maintenance mode since 2025-09-30; distributed gRPC runtime marked experimental. Core does allow non-LLM actors. | `AgentId(type,key)` + topic subscriptions; successor **Microsoft Agent Framework** (Py/.NET/Go, 1.17.0 on 2026-09-03): `ctx.request_info()` → pause with `request_id` → resume with `responses={id: reply}`, checkpointed |
| OpenAI Agents SDK | No. In-process, no durability. Provider-agnostic though. | nothing |
| Claude Agent SDK | Already what workers run. Hooks incl. SubagentStart/Stop, SessionStart/End; `claude -p --output-format json` is the subprocess escape hatch. | hook telemetry per lane |
| DBOS (MIT, TS+Py) | Best durable engine if we want one: `DBOS.recv(topic, days)`, `setEvent`, cron, no server. Needs Postgres. | — |
| Temporal / Restate / Inngest | Too heavy (server+DB), BUSL, SSPL+SaaS respectively. | — |

## What the repo readers found (the actual gap)

- **fleetdeck** = registry + bus + lease/reaper + train proxy in one node process on `fleet.db` (sqlite).
  No workflow, no "assign work X to session Y and track completion", no auto-retry except
  notify's 2 tries at 5 s, alerts in a 50-entry in-memory ring, reaper never relaunches.
- **coordinator** = git-versioned `board.json` + stateless batch runs (exceptions arithmetic,
  DISPUTED, operator_queue with deadline + default). Designed to never sit on a critical path.
  Not wired to fleetdeck or the ledger. This repo builds it, never runs it.
- **goal tracking** = five stores, all linked by prose: operator ledger (missing in this repo),
  goal packs in `docs/goals/`, Linear, `board.json`, `OPERATOR-TASK.md`. Ledger reconcile
  mines chat transcripts, not packs or Linear.
- **protocol enforcement**: `guard.js` code-gates orchestrator/researcher/design kinds
  (no builders, no source writes, researcher can't `/introduce-goal`). Worker kind has no guard.
  Handoff laws, cross-project refusal, no-weave, no-deploy are prose only.
- **train** = 1h/4h/8h GitHub App token broker in launchd memory. Not a merge queue.
  There is no code that weaves branches. Merge is manual.

## The one thing to build

A durable **lane state machine** in fleetdeck, one row per lane (goal pack lane), events:
`dispatched → reported → gated(operator, deadline, default) → merged | disputed | dead`.
Waiting steps are interrupts with an id; `/notify` ack and coordinator sitreps are the resumes.
`board.json` becomes a rendered export of it, or it stays authoritative and fleetdeck mirrors it.
That fork (live sqlite vs git board as source of truth) is the operator's call.

Engine fork: LangGraph JS with `SqliteSaver` gives this for free but pulls LangChain into
fleetdeck; ~200 lines over `fleet.db` covers 5 states and 3 event kinds. Lean: hand-roll,
copy the semantics, revisit LangGraph if we need fan-out/subgraphs/time-travel.

## Anthropic multi-agent research post, lessons that transfer

- Detailed task briefs to workers (objective, output format, boundaries) — `/introduce-goal` already does this.
- Workers write artifacts to disk, return references — goal packs `reports/` already do this.
- Resume from failure point, never restart — this is the lane state machine above.
- Evaluate end-state, not turn-by-turn; ~20 real-query evals early beat hundreds late.
- Their subagent execution is still synchronous; async is future work.
