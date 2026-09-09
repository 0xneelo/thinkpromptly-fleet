# Promptly (thinkpromptly) vs Fleetdeck — merge assessment

Date: 2026-09-07. Source: 0xneelo/promptly@master (shallow clone, last commit 2026-06-27)
vs this repo (426 commits, last 2026-09-07). Five read-only reader passes, one per dimension.

## Verdict: keep separate, harvest 5 pieces

Overlap is 15–20% on every axis. They are two different products that share one wish:
"see and control my running Claude Code agents". Fleetdeck already ships that wish, live, daily.

| Dimension | Overlap | Promptly | Fleetdeck |
|---|---|---|---|
| Domain model | ~20% | typed multi-tenant Run/Task FSM, approvals, workspaces, RBAC | untyped single-operator sessions, leases+epoch, hosts, bus |
| Runtime | ~15% | local daemon spawns detached child_process, no PTY, no ssh, single machine | pty→ssh→tmux attach, multi-host, message bus injects text into live sessions |
| UI | ~20% | React 19 + Electron 42 desktop, Expo mobile, no terminal at all | vanilla compiled-template JS, xterm.js tiles, web only |
| Infra/auth | ~15% | Postgres (33 tables), email+device-code auth, MFA scaffold, Stripe, stored OAuth tokens | file/SQLite state, no user identity, mint-on-demand 1P certs + GitHub App tokens |
| Maturity | — | 139k LOC, 148 test files, self-declared "not ready", paused since June | 47k LOC, 37 test files, in daily use, goal ledger live |

## Why not merge

1. Process-control channel: promptly owns stdio pipes with launch-time-only input; fleetdeck types into a live TTY. One IPC model must win.
2. Trust boundary: promptly = hosted multi-tenant users/orgs; fleetdeck = one operator, machine identity, no stored secrets. Bolting RBAC onto fleetdeck or stripping it from promptly is a rewrite.
3. Frontend: React/Electron/RN vs framework-free compiled templates. No incremental path.
4. Dead weight: billing, mobile, provider OAuth in promptly have zero live evidence. Importing them drags months of unverified surface into a repo that ships weekly.

## Harvest list (promptly → fleetdeck, by value)

1. `packages/agent-adapters` launch planning for claude-code/codex — fleetdeck assumes a tmux session already exists.
2. `packages/domain/src/run-state.ts` FSM + `run-approvals.ts` — formalize `lease_state`/epoch and gate `/api/kill`, `/api/registry/delete`.
3. `packages/runner-core/src/daemon-recovery.ts` resume/reattach decisions — generalize the ad-hoc reap/reclaim in server.js:293-348.
4. OKLCH `do/later/refine/close` action tokens (desktop `app.css`, mobile `tokens.ts`) — seed a real token file for the `L_*`/`A_*` vars.
5. Mobile pairing + approve-from-phone loop (`apps/mobile-app`, `mobile-devices.ts`) — the one product idea fleetdeck lacks. Worth a fleetdeck goal, not a code merge.

Reverse direction (fleetdeck → promptly) is moot while promptly is paused.

## Update 2026-09-07: one builder, one project — what promptly adds to fleetdeck

Operator ruling: promptly and fleetdeck are one project. The question becomes "which promptly
parts does fleetdeck absorb". Portability check: every candidate below imports only
`@promptly/contracts` (types) plus node core. No Postgres, no React. They port to CJS as-is.

| # | Promptly part | LOC | Fleetdeck gains | Lands in |
|---|---|---|---|---|
| 1 | `packages/domain/run-state.ts` 13-state FSM | 85 | typed seat lifecycle (queued→leased→running→clarifying→waiting_for_user→ready_for_approval→review→succeeded); org/windows screens show real status; coordinator reacts to transitions | lease rows in server.js + `run-state.js` |
| 2 | `apps/mobile-app` (Expo) + `mobile-devices.ts` pairing + `run-approvals.ts` + `run-questions.ts` | 910+506+476 | approve a worker's proposal or answer its question from the phone; the bus pastes the answer into tmux | `apps/mobile/` beside `public/`; pairing + approval routes in server.js |
| 3 | `packages/agent-adapters` probe + launch plan | 299 | machines screen shows per-host claude/codex ready / needs_auth / missing_binary; launcher gets a planned command | machines collector over ssh; `fd-launch-*` launchers |
| 4 | `runner-core/daemon-recovery.ts` resume/reattach table | 728 | replaces ad-hoc reap/reclaim (server.js:293-348) with a tested decision table, tmux as truth | server.js reaper |
| 5 | `security/proposal-hash.ts` + approval gate | 41 | `/api/kill`, `/api/registry/delete` require a signed proposal; goalkeeper hooks in | server.js routes |
| 6 | `security/redaction.ts` | ~60 | transcripts, bus messages, support bundles redacted before store/show | desktop-sessions.js, message-bus.js |
| 7 | `task-sources.ts` + `linear-sync.ts` | 559+625 | coordinator board/inbox syncs with Linear both ways | coordinator-api.js |
| 8 | `audit-log.ts` | 218 | verify/l4 snapshots + OPERATOR-TASK ledger become one queryable audit table | SQLite in server.js |
| 9 | `notifications.ts` + expo push | 459 | durable notify inbox with push to phone; pairs with #2 | `/api/notify`, bus |
| 10 | OKLCH `do/later/refine/close` tokens | small | one token file for `L_*`/`A_*` vars | tools/dc-compile.mjs |

Retire, do not port: `apps/api` (Postgres, workspaces/RBAC, Stripe), `apps/desktop` (Electron shell;
the web deck is the desktop), React web UI. Their logic folds into server.js where listed above.

Monorepo shape that works: `server.js` + `public/` (deck) + `apps/mobile/` (Expo) + `packages/contracts`
(shared types). The earlier "conflict" was the web UI only; a separate mobile app beside the deck is fine.

Suggested order: 1 → 3 → 4 → 5 → 6 (backend, no UI) then 2 + 9 (phone), then 7, 8, 10.

## Revision 2026-09-07 (later): backbone flips to promptly — parked

Operator pushed back: promptly's API is more built out. Numbers agree: 31 modules / 19.7k lines with
idempotency (20 modules), transactions (19), outbox (20), revision checks (11), audit (18), 27 module
tests, vs server.js = one 3204-line file, epoch fencing as the main consistency tool.

Revised shape (not yet confirmed, parked "for now"):
- Backbone = promptly `apps/api` (keep Postgres, transactions, outbox, idempotency, migrations, audit).
- Port fleetdeck runtime INTO it as one typed `fleet` module: hosts/ssh, tmux+pty attach, message bus,
  train broker, machines + desktop-session collectors, credits (~6k proven lines).
- Frontend = the deck (`public/v2`, xterm tiles, design gate) replaces the React hub.
- Workspaces kept in single-workspace local mode with one bootstrap operator account.
- Electron still dropped unless keychain/tray is wanted.
- Cutover = parallel run: new server on its own port, deck switches API base per screen, server.js
  stays until every screen has moved. Risk: promptly never ran live; fleetdeck runs daily.

The "Lands in" column of the table above is superseded by this section.
