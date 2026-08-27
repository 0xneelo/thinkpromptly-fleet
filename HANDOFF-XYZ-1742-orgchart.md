# HANDOFF — XYZ-1742 fleet lifecycle ownership + org chart

**From:** 🎛 ORCHESTRATOR 12 (`remote-system/.claude/worktrees/orgchart-agent-fleet-1fe872`)
**To:** the next orchestrator seat on this build
**Date:** 2026-08-27
**State:** research complete, plan drafted, **nothing built, no workers launched**

Read this file top to bottom and you have the whole build cold. You do not need to
re-run the research — it cost 28 agents and the conclusions are recorded below with
citations.

---

## 1. What the operator wants

A live **org chart** of the agent fleet — a tree, not a list:

```
coordinator          seat · long lease · swapped ~weekly
└── orchestrator     seat · fenced · high context-churn, swapped often
    ├── researchers
    ├── workers
    └── designers
        └── readers / hunters they spawn
```

Spanning every surface: Claude Code CLI, Codex CLI, Claude Desktop (possibly several
accounts), ChatGPT Desktop, across Mac + german-box over Tailscale.

The operator's own diagnosis, which the research confirmed: **the chart is worthless
without a backend that owns the machines**, because agents do not shut themselves down.
Skills that politely ask an orchestrator to clean up its lanes will always leak.

---

## 2. The decision already made — LIFT, DO NOT FORK

Full dossier (private artifact, keeps its URL on republish):
**https://claude.ai/code/artifact/3c20ea35-8c61-49d8-b12f-34178e361847**

### Buy vs build
Nothing on the market does this. Every commercial "agent ops" product (AgentOps,
Langfuse, LangSmith, W&B Weave, Arize Phoenix, Microsoft Agent 365, Anthropic's Claude
Code analytics) is **tracing, analytics, or governance metadata** — none owns a local
process. Temporal/Inngest own real worker liveness but for workflow steps, not
interactive CLI/desktop sessions.

### Fork vs lift — three repos inspected
| Repo | Stack | Verdict |
|---|---|---|
| [mission-control](https://github.com/builderz-labs/mission-control) | Next.js + better-sqlite3, MIT, ★6.1k | **Lift mechanisms.** Closest kin, but see §3. |
| [agent-deck](https://github.com/asheshgoplani/agent-deck) | Go + tmux, MIT, ★799 | **Lift mechanisms.** Best watchdog logic found anywhere. |
| [amux](https://github.com/mixpeek/amux) | Rust, MIT+Commons Clause, ★370 | **Ignore.** Wrong language, resale-restricted, one-author sprawl. |

---

## 3. Why mission-control is not a fork target (this is the load-bearing finding)

It looks ideal — Node + sqlite like fleetdeck, 1,574/1,577 unit tests pass, hardened CI
(CodeQL, OSV, pinned actions), production-grade route handlers. **The code is not
sloppy.** But:

**Architecturally it does not own processes either.** It is a dashboard over an external
OpenClaw/Hermes gateway. Presence = "an agent phoned home recently" or a file's mtime.
Kills go out as gateway RPC. Forking means adopting Next.js *underneath* fleetdeck.

**The lifecycle core — the exact part you'd fork it for — is broken.** Three independent
GPT-5.6 hunters at xhigh, three "no" verdicts, 35 defects. The ones that matter:

| Defect | File:line | Why it kills the fork |
|---|---|---|
| Heartbeat POST ignores the agent's reported `status` | `agents/[id]/heartbeat/route.ts:170` | an agent posting `error` is stored `idle` and handed new work |
| Reaper marks offline without re-checking `last_seen` | `scheduler.ts:183` | kills agents that heartbeated mid-sweep |
| Stale-task reaping disabled if any direct provider exists | `task-dispatch.ts:1665` | crashed tasks never reclaimed, forever |
| Only the *initial* claim is CAS-guarded | `task-dispatch.ts:1481,1681,1984` | later transitions overwrite by id, erasing authoritative state |
| Any agent key can reset another agent's presence | `agents/register/route.ts:23` | agent A keeps crashed agent B "online" |
| Migration 035 drops `api_keys` empty, no rollback | `migrations.ts:1058` | upgrade destroys all credentials |
| `synchronous=NORMAL` | `db.ts:46` | acknowledged commits can vanish on power loss |
| Event bus fire-and-forget, no outbox/replay | `event-bus.ts:69` | events lost on disconnect; consumers stale |
| Workspace `admin` ⇒ host super-admin (`useradd`/`chpasswd`) | `super/os-users/route.ts:260` | critical; also can rotate the global API key |

**Use these 35 findings as the build's test list from day one.** That is the single most
valuable thing this research produced: a map of every way this problem is gotten wrong.

---

## 4. What fleetdeck already has (≈60% of the backend)

Verified against `server.js` in this worktree:

| Exists | Where |
|---|---|
| sqlite `fleet.db` via `node:sqlite` `DatabaseSync`; table `sessions`, PK `(host,name)` | `server.js:18-21` |
| Columns: `host,name,label,role,worker,status,note,grp,task,created_at,updated_at,last_seen_at,active_at,msg_at` | `server.js:20` |
| `sessions()` — polls hosts over ssh (`tmux ls`), merges live tmux with sqlite rows | `server.js:137-197` |
| `POST /api/registry` upsert (+ validation in `registryWrite`) | `server.js:58-79`, `485-499` |
| `POST /api/registry/delete` | `server.js:493-496` |
| Registry mounted on **both** loopback and tailnet listeners | `server.js:526`, `681` |
| Tailnet listener `100.125.231.25:3131` — registry, `/api/ghtoken`, `/api/ghtrain` (status) | `server.js:677-697` |
| Loopback-only: `/api/sessions`, `/api/health`, `/api/sshkeys*`, `/api/kill`, `/api/ghtrain*`, static, `/term` ws | `server.js:502`, `671` |
| Manual kill over ssh (`tmux kill-session`) | `server.js:82-86`, `527-537` |
| `HOSTS()` reads `hosts.json` (currently `["german-box"]`) | `server.js:13` |
| Registry accepts `mac` as a host | `server.js:491` |

### What it lacks — the whole ownership layer
1. **No heartbeat/lease.** `last_seen_at` updates only when the UI calls `/api/sessions` (`server.js:172`). No background poller.
2. **No reaper.** `reapStrayMasters()` (`server.js:592-597`) is a **pty fd-leak workaround, unrelated to session lifecycle** — do not mistake it for one.
3. **No parent/child edge.** `role`/`worker`/`grp` are unlinked free text (`server.js:20,30-31`). No tree can be derived reliably. *Every surveyed repo is flat too — nobody stores this.*
4. **No pid / process identity** — only the tmux session name.
5. **`mac` rows are registry-only** — never polled by `sessions()`, never killable via `/api/kill` (both iterate `HOSTS()` only). Asymmetric.

---

## 5. The plan (drafted, not yet packaged)

### Host: Mac-local, NOT german-box — deviation, needs operator confirmation
The default launch target is the box. This build should run **Mac-local** because:
fleetdeck runs foreground on the operator's Mac (`localhost:3131`); Goal 2 edits the
Mac's `~/.claude` hooks and `mark.sh`; verifying the reaper means killing real tmux
sessions fleetdeck can see. A box worker cannot exercise any of it.
**Confirm with the operator before minting lanes.**

### Three lanes
| Lane | Goal | Role | Files (disjoint) | Sequencing |
|---|---|---|---|---|
| 1 | Backend — schema, heartbeat/lease, reaper, seat fencing | `backend-developer` | `server.js`, `fleet.db` schema | **first, solo** |
| 2 | Hooks — register + detached heartbeat pinger + deregister | `devops-engineer` | `~/.claude/*`, `mark.sh`, codex wrapper | after L1 contract |
| 3 | Org-chart UI — tree render, status glows, 🪦 stale rows | `frontend-developer` | deck client (`public/`) | after L1 contract |

**Lane 1 goes alone and first** — it is the foundation *and* the riskiest (lease renewal,
epoch fencing, reaper correctness are exactly where mission-control accumulated its 35
defects). Its job is to land the schema and **freeze the contract**. Once that contract
is real code, Lanes 2 and 3 run **in parallel** — disjoint files, no conflict.

### The contract Lane 1 must freeze (put this in the goal pack so 2/3 have a spec)
```
POST /api/heartbeat  {host,name,epoch?}  -> 200 {expires_at}
                                         -> 410 {reason}   once reaped
POST /api/seats/claim {seat,owner}       -> {epoch,expires_at}
                                            in BEGIN IMMEDIATE, epoch++

sessions  += pid, parent_host, parent_name, epoch, expires_at, lease_state
seats      = (seat, owner, epoch, expires_at)          -- coordinator | orchestrator

reaper states: active -> suspect (bus warn) -> reaped
   reaped: box/CLI  = tmux kill-session + `name.py close <Name>`
           mac/desktop = 🪦 marked, "close me" in UI (cannot kill remotely)
```

### The lease recipe (from k8s leases / Nomad heartbeats / etcd election / Kleppmann fencing)
1. Store a thin lease `{owner, epoch, expires_at}` — cheap to write often.
2. Renew every **TTL/3–4**, so one missed beat does not trip expiry.
3. Expiry is **suspect**, not death — warn on the bus first.
4. Claim a seat in `BEGIN IMMEDIATE`: conditional update that **bumps the epoch**.
5. Every privileged write carries its epoch; a stale epoch is **rejected**. *That* is the
   fence — the timeout alone is not (a paused zombie can still write after expiry).

### Operator's own design contributions — keep these, they are good
- **Two-phase reap with an appeal window.** A killed tmux session cannot read a message,
  so the bus warning must come *before* the kill. Reaped sessions appeal to the
  orchestrator explaining what they were doing and why they went quiet — that telemetry
  tells you where the TTL is too tight instead of guessing grace periods.
- **The heartbeat response is the guaranteed delivery channel.** Bus messages can be
  missed; the next `POST /api/heartbeat` cannot — it returns `410 Gone` with the reason.
- **Caveat that must be honoured in Lane 2:** a long-running Bash call blocks hooks, so a
  hook-only heartbeat false-positives on hard-working sessions. The pinger must be
  **detached** (statusline ping or a background loop spawned by SessionStart).

---

## 6. The lift ledger — what to copy, and from where

**Tier 1 — lift as code** (small, pure, portable)
| Piece | Source | Note |
|---|---|---|
| Reaper loop | mission-control `scheduler.ts:175-232` `runHeartbeatCheck` | 60s tick, 10-min timeout, mark-offline + log + notify in one transaction. **Fix first:** make it monotonic and re-check `last_seen` before killing. |
| Webhooks | `webhooks.ts` (HMAC `42-77`, backoff `34,94-98`, breaker `337-343`) | cleanest lift in that repo |
| pty-manager | `pty-manager.ts` (idle-dispose `43,188-197`; ring buffer `38,42,74-77,117-124`) | idle-timeout auto-dispose + scrollback replay — **relevant to our node-pty fd leak**, bounds session count |
| Cost accounting | `token-pricing.ts`, `task-costs.ts` | pure, dependency-light; gives cost-per-seat on the chart |
| CAS claim | `task-dispatch.ts:1767-1775` | conditional UPDATE as compare-and-swap. **Extend to every transition, not just the first.** |
| Guardrails | `validation.ts` (Zod + prototype-pollution guard), `safeCompare` (`auth.ts:43-54`) | one hashed key is enough for a tailnet |

**Tier 2 — lift as schema**
- `agents(status, last_seen, last_activity)` — minimal presence shape.
- `spawn_history(status, exit_code, duration_ms, finished_at)` — lease-outcome record.

**Tier 3 — lift as concept**
- **agent-deck's watchdog** (`scripts/watchdog/watchdog.py` + `DESIGN.md`,
  `internal/session/restart_guard.go` `ShouldSkipRestart`) — the best-engineered
  lifecycle logic found in any repo: restart rate-limit (3/300s), cascade guard (≥5
  restarts in 10s → 60s global pause), **a second liveness sample before killing** (a
  stale banner in scrollback pins a false "error"), auth-hold short-circuit (a restart
  cannot fix a bad credential), 60s "too fresh to restart" window. ~150–300 lines of JS.
- **agent-deck `--parent` / `set-parent`** — the naming convention for who-spawned-whom.
- mission-control `/api/v1/runs` **Agent Run Protocol** — versioned header, SSE stream,
  provenance hash; a clean external contract to imitate.
- office-panel: status→glow/badge map, and `needsAttention` after 15 idle minutes.

### Re-cloning the reference repos
The mission-control clone used for this research lived in a **session-scoped scratchpad
and is gone**. Recreate cheaply:
```bash
git clone --depth 1 https://github.com/builderz-labs/mission-control
git clone --depth 1 https://github.com/asheshgoplani/agent-deck
```

---

## 7. What is ours to build regardless

Nothing off the shelf provides these:
1. **Singleton seat fencing** for coordinator + orchestrator — a new orchestrator *claims*
   the seat and the backend fences the old holder atomically. Replaces "the new
   orchestrator should remember to kill the old one".
2. **The org tree itself** — one `parent` edge; every surveyed repo is a flat roster.
3. **Correct lifecycle** — durable, monotonic, reaped, CAS-guarded on *every* transition.
4. **Two-phase reap + bus appeal loop** (§5).

---

## 8. Gates and state at handoff

- **GitHub train:** probed `200` at handoff (`curl -s -o /dev/null -w '%{http_code}' http://localhost:3131/api/ghtoken`). **Re-probe before releasing any launch prompt** — `503` means hold the prompt and page the operator; the train dies with fleetdeck and GitHub caps tokens at 1h.
- **fleetdeck health:** `200`.
- **Box cert:** not applicable if the build stays Mac-local (§5).
- **Fleet hygiene, unrelated but worth knowing:** census showed 12 ghost registry entries and several 27h-idle `LIVE·WAITING` sessions. `number.py reap --days 2` + `mark.sh --reap` when convenient. Not part of this build — but it is the exact pain this build exists to fix.

## 9. Open decisions for you

1. **Confirm Mac-local hosting** with the operator (§5) — this is a deviation from the box default.
2. **Run a `fable-audit` of the lease/fencing/reaper design against the 35 findings before packaging Lane 1?** ORCHESTRATOR 12 recommended yes — cheap insurance that Lane 1 is specced to avoid those bugs rather than rediscover them. Not yet done.
3. **Linear:** parent ticket XYZ-1742 exists (see `REPORT-XYZ-1742.md`, and commits `6198384`, `89ce887`). Decide whether the three lanes become sub-issues.

## 10. Immediate next action

`/introduce-goal` for **Lane 1** (backend lease/reaper/fencing), Mac-local, role
`backend-developer`, with §5's contract block and §3's defect table pasted into the goal
pack as the acceptance criteria. Lanes 2 and 3 stay parked until Lane 1's contract lands.

**Nothing has been built. No worker has been launched. No goal pack exists yet.**
