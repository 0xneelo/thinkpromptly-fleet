# thinkpromptly audit: promptly vs fleetdeck

Date: 2026-09-11 (audit run 2026-09-07, figures re-measured 2026-09-11)
Requested by: operator
Session: Claude Code desktop, branch `claude/thinkpromptly-fleetdeck-compare-6f28f6`
Subjects:
- promptly ("thinkpromptly"): `0xneelo/promptly` master at `9d4c3f7` (2026-06-27), depth-1 clone
- fleetdeck: `0xneelo/thinkpromptly-fleet` (this repo) at `88a1765` (2026-09-07)

Status: **parked** by the operator on 2026-09-07. The direction leans to promptly's API as the
backbone. The operator has not confirmed it.

## 1. Summary

- The two projects overlap 15–20% on each of five axes. They share one product wish: see and
  control running Claude Code and Codex agents.
- Fleetdeck already delivers that wish and runs every day. Promptly has the stronger backend:
  a typed run state machine, transactions, an outbox, idempotency keys, user auth, approvals,
  and a phone app. Promptly stopped on 2026-06-27 and calls itself not ready.
- The operator ruled that both are one project. The recommended shape: promptly's API becomes
  the backbone. Fleetdeck's runtime ports into it as one typed module. The v2 deck becomes the
  frontend. Electron drops. A parallel run on a second port handles the cutover.
- Nothing is built yet.

> **Corrections.** Figures given in chat on 2026-09-07 were wrong. This report uses the
> re-measured values.
>
> | Said in chat | Measured 2026-09-11 |
> |---|---|
> | promptly has 139k lines | 48.9k TS/TSX source lines (tests, `.d.ts`, compiled `.js` excluded) |
> | promptly has 148 test files | 33 test files |
> | fleetdeck has 47k lines, 37 test files | 43.6k hand-written JS lines, 30 test files |
> | the repos use two test runners | both use `node:test` |
> | fleetdeck runtime to port is about 6k lines | 4,190 lines in 5 files |
> | redaction module is about 60 lines | 29 lines |
>
> Result: reasons 17 and 18 of the 20 reasons are withdrawn (section 6).

## 2. Question, scope, method

**Question.** How similar are promptly and fleetdeck? Can they merge?

**Method.** Five read-only reader subagents ran in parallel, one per dimension: domain model,
backend runtime, UI, infra and security, roadmap and maturity. Each reader returned an overlap
score, merge candidates, and conflicts with `file:line` evidence. The driver then answered four
operator challenges and re-measured the key figures.

**Limits.**
- Overlap scores are reader judgment, not computed metrics.
- The promptly clone has depth 1, so it has no commit history.
- No promptly code was run, built, or tested.
- `file:line` pointers come from the reader passes. A spot check found one wrong line number,
  now corrected. Promptly design-doc citations name the file only.
- Fleetdeck `main` moved on after `88a1765`. Line numbers in `server.js` can drift.

## 3. The two systems

| | promptly | fleetdeck |
|---|---|---|
| Purpose | Hosted service that turns tasks into coding-agent runs, approved from a phone | Operator console for Claude and Codex workers in tmux on remote hosts |
| User | Workspace members, many tenants | One operator |
| Core loop | task → ready prompt → run claimed by a desktop → clarify, execute, propose → approve → done | claim a seat on host + session → heartbeat → attach live → message over the bus → kill or reap |
| Language | TypeScript ESM, npm workspaces | Plain Node CommonJS, no server build step |
| Server | `apps/api`: hand-rolled HTTP router, 31 modules, 19.7k lines | `server.js`: hand-rolled router + `ws`, one file, 3,204 lines |
| Storage | Postgres 16, 34 tables; the local daemon uses SQLite | SQLite (`node:sqlite`) + JSON files |
| Identity | Email + device code, passkey/TOTP/password scaffolding, org → workspace → role | No user identity; short-lived ssh certs, GitHub App tokens, tailnet origin gate |
| Agent control | Local daemon spawns a detached child process; stdin ignored | pty → ssh → `tmux attach`; the bus pastes text into the live session |
| Hosts | One machine per daemon | Many hosts through `hosts.json` + ssh |
| UI | React 19 + Vite 6 in Electron 42 (7.7k lines) | Vanilla JS compiled from `.dc.html` templates |
| Terminal | None | xterm.js tiles, 5,000-line scrollback |
| Mobile | Expo + React Native app (4.1k lines) | None |
| Size | 48.9k TS/TSX source lines | 43.6k hand-written JS lines |
| Tests | 33 files, `node:test` | 30 files, `node:test` |
| Activity | Last commit 2026-06-27 | 426 commits, last 2026-09-07 |
| Status | Self-declared "not ready" (`_desktop-plan/IMPLEMENTATION_OVERVIEW.md:9`) | Daily use |

## 4. Findings by dimension

| Dimension | Overlap | Finding |
|---|---|---|
| Domain model | ~20% | Both claim a unit of live agent work and keep it alive. Promptly types it. Fleetdeck does not. |
| Backend runtime | ~15% | Both stream agent output to a UI. Process model, storage, and topology differ. |
| UI | ~20% | Same concept names, different stacks. Only fleetdeck has a terminal. |
| Infra and security | ~15% | Promptly has user identity. Fleetdeck has credential hygiene. |
| Roadmap | one shared wish | "See and control my running agents." Fleetdeck shipped it. |

### 4.1 Domain model (~20%)

Promptly entities: `RunRecord` with a 13-state `RunState` (`packages/domain/src/run-state.ts:9-21`),
the `RunCommand` union, `TaskBrief` and `TaskSource` (Linear, Jira, GitHub), `ReadyPrompt`,
execution proposals with approvals, `ActorRef` and `WorkspaceRole`, and the desktop device lease
(`packages/contracts/src/types.ts`).

Fleetdeck entities: a lease per host + session with an epoch (`server.js:307`, `:375`), the
registry, seats (`/api/seats`), desktop sessions, the message bus (`message-bus.js`), machines and
hosts, ssh keys, credits, the coordinator board, inbox, and sitrep (`coordinator-api.js`), and the
git train.

| promptly | fleetdeck | Match |
|---|---|---|
| `RunRecord` + `RunState` | tmux session + lease with epoch | Similar. Promptly has a full state machine; fleetdeck has a liveness lease. |
| run claim + desktop device lease | `leaseClaim` + heartbeat | Similar. Both claim, then keep alive. |
| `TaskBrief` + `TaskSource` | coordinator board, inbox, sitrep | Similar. Promptly has a typed task model; fleetdeck tracks goals in files. |
| execution proposal + approval | — | None. |
| workspace roles | — | None. |
| agent profile + ready prompt | — | None. Fleetdeck attaches to agents; it does not build prompts. |
| — | message bus | None in promptly. |
| — | machines, ssh keys, registry, credits | None in promptly. |
| run states (queued … failed) | reap, kill, `lease_state` | Similar. Promptly's vocabulary is richer. |

Conflicts:
1. Many tenants with roles against one operator.
2. Typed idempotent commands with revision checks against direct REST with epoch fencing.
3. A promptly run survives its machine. A fleetdeck session dies with its host.

### 4.2 Backend runtime (~15%)

How promptly runs an agent:
- The API never spawns a process. A local daemon (`packages/runner-core`) plans the launch
  (`planLocalAgentLaunch` in `packages/agent-adapters/src/index.ts`).
- The daemon calls `child_process.spawn` detached, with stdin ignored
  (`packages/runner-core/src/supervisor.ts:216-260`). Kill is `process.kill(-pid)` (`:317`).
- Resume and reattach are decisions on pid liveness (`daemon-recovery.ts:286-298`).
- Output goes to files, then over a WebSocket worker stream (`apps/api/src/worker-websocket.ts`).
- Mid-run input goes over HTTP approvals and questions, never stdin.

How fleetdeck runs an agent:
- The agent already runs in tmux. The deck opens one pty per browser tab:
  `ssh -t <host> tmux attach -t <session>` (`server.js:3062-3068`).
- Keystrokes go into the pty (`server.js:3099`).
- The bus delivers text with `tmux load-buffer`, `paste-buffer`, and `send-keys` over ssh
  (`server.js:2272-2291`).
- Kill is `tmux kill-session` over ssh, fenced by the row epoch.

Multi-host: promptly has no ssh or multi-host code; the only hits are strings in a test fixture.
Fleetdeck is multi-host by design (`server.js:31-51`). API equivalents are in Appendix A.

Conflicts:
1. Control channel: owned stdio pipes against typing into a live TTY.
2. Liveness truth: a local pid check against `tmux ls` over ssh.
3. Tenancy: multi-tenant Postgres with auth in the same process against single-operator SQLite.

### 4.3 UI (~20%)

| promptly screen | fleetdeck screen | Match |
|---|---|---|
| runs | windows (terminal tiles) | Similar intent. Approval cards against live xterm. |
| machines | machines | Same. |
| repositories, services | registry (keys, git train) | Loose. |
| account, billing | accounts (credits) | Similar. |
| agents | org (org chart, seats) | Loose. |
| network, security | keys | Partial. |
| mobile pairing | — | None. |
| today, tasks, create (mobile) | — | None. |
| — | bus (message threads) | None. |
| — | desktop sessions | None. |

Design system:
- Promptly has OKLCH tokens with two themes (`softPop`, `paperDeck`). It has an action vocabulary,
  `do` / `later` / `refine` / `close`, shared by the desktop CSS and the mobile `tokens.ts`.
- Fleetdeck bakes theme values (`L_*`, `A_*`) into compiled markup. It has no token file.
- Both have a pixel-diff design gate. Promptly's is a one-shot script (`qa-visual-diff.mjs`,
  `qa-design-audit.mjs`). Fleetdeck's compiles `.dc.html` and gates 18 screens in 2 themes
  (`tools/dc-compile.mjs`, `scripts/design-diff.mjs`).

Terminal: promptly has none. Its mobile "terminal" and "cursor" routes are approval cards
(`apps/mobile-app/src/native/screenModels.ts`). Fleetdeck runs xterm.js per tile over a
WebSocket, with resize and maximize (`public/v2/screens/windows.js`).

Conflicts:
1. React and Electron against framework-free compiled templates.
2. The Expo app has no fleetdeck counterpart. Later judged fine as a separate app.
3. Promptly has no PTY transport for a live terminal.

### 4.4 Infra, auth, security (~15%)

- **Deployment.** Promptly runs a Node API with Postgres from `docker-compose.api.yml`. Its daemon
  runs as an OS service. Fleetdeck runs one Node process on the Mac, started by `up.sh`. Only the
  operator may run `up.sh`, because the 1Password grant follows the starting process. The
  git-train broker (`fleetdeck-train.js`) runs apart on port 3132.
- **Identity.** Promptly has email and device-code auth (`apps/api/src/auth.ts`, 2,054 lines),
  mobile pairing with public-key enrollment (`mobile-devices.ts`), MFA scaffolding, and five roles.
  Fleetdeck has no users. It mints ssh certs per use with a 1–8 hour TTL
  (`deploy-keys/mint-deploy-cert.sh`) and GitHub App tokens that expire in 1 hour
  (`deploy-keys/mint-github-token.sh`). A tailnet origin gate and a bearer key guard the listener.
- **Secrets.** Promptly stores provider OAuth tokens in Postgres (`provider-token-store.ts`,
  table `provider_token_secrets`). Fleetdeck stores no standing secret. It mints on demand.
- **Tests and CI.** Both use `node:test`. Neither repo has CI config.
- **Data.** Promptly has 34 tables (Appendix B). Fleetdeck state maps only in part:
  `machines.json` to `desktop_devices`, `credits-accounts.json` to `organizations` and `users`.
  `hosts.json` has no counterpart.

Judgment: promptly is more mature as an identity system. Fleetdeck is more mature in credential
hygiene.

Conflicts:
1. Trust model: users and orgs against machine identity.
2. Storage and start-up: Postgres as a service against files and an operator-only `up.sh`.
3. Secret lifecycle: stored tokens against mint-on-demand.

### 4.5 Roadmap and maturity

- **Promptly's plan.** An Electron desktop with a supervised local runner, plus a cloud control
  plane (`_desktop-plan/specs/TECHNICAL_ARCHITECTURE.md`). A hosted service with Stripe billing and
  push notifications (`_desktop-plan/IMPLEMENTATION_OVERVIEW.md`).
- **Fleetdeck's aim.** A browser deck for tmux worker fleets on ssh hosts. One click opens a live
  terminal tile (`README.md:1-3`).

| promptly gap (`_desktop-plan/REMAINING_PRODUCTION_GAPS.md`) | fleetdeck | Same wish? |
|---|---|---|
| Real Claude Code and Codex adapter lifecycle | Live tmux sessions, shipped | Yes. Promptly launches; fleetdeck observes. |
| Desktop live read models, run inspector | Sessions, machines, registry screens, shipped | Yes. |
| Provider integrations | Coordinator talks to Linear on the ops side | Weak. |
| Mobile pairing and approvals | — | No. |
| Hosted VPS deploy | — (local by design) | No. |
| Packaging and installer | — | No. |

Promptly has, fleetdeck lacks: multi-tenant auth and workspaces, Stripe billing, a mobile app, a
Postgres API with outbox and idempotency, an agent-adapter layer, a per-run security model.

Fleetdeck has, promptly lacks: a live multi-host tmux fleet view, a working cross-session message
bus, the coordinator, a git train in daily use, the operator decision ledger.

## 5. Verdict history (all 2026-09-07)

| # | Operator input | Verdict |
|---|---|---|
| 1 | Compare the two with five readers; maybe merge them. | Keep separate. Harvest five pieces into fleetdeck. |
| 2 | The verdict is wrong; fleetdeck can be expanded. | 20 reasons against a direct code merge. Expansion means porting ideas into fleetdeck's stack. |
| 3 | They are one project; the operator builds both. | The question becomes what promptly adds. Ten contributions. Retire promptly's API, Postgres, workspaces, Stripe, Electron. |
| 4 | Why retire those parts? | Rationale per part (section 8). |
| 5 | Is promptly not more built out in Postgres, workspaces, Electron, and the API? | Measured: yes. The backbone flips to promptly's API. |
| 6 | Fine for now; return to it soon. | Parked. |

## 6. The 20 reasons against a direct code merge

These reasons argue against merging the two repos as they stand. After the backbone flip, several
become port tasks.

| # | Reason | Status now |
|---|---|---|
| 1 | Two agent-control channels. Promptly owns stdio pipes with stdin ignored; fleetdeck types into a live tmux TTY. | Holds. The merged system must pick tmux as the control channel. |
| 2 | Two liveness authorities: a local pid check against `tmux ls` over ssh. | Holds. Pick tmux as the truth. |
| 3 | Opposite answer to host death. A promptly run is cloud-owned; a fleetdeck session is keyed by host + name. | Holds. Open design decision. |
| 4 | No terminal in promptly. | Holds. The deck as frontend resolves it. |
| 5 | No ssh or multi-host in promptly. | Holds. Becomes a port task (the `fleet` module). |
| 6 | Frontend frameworks clash: React + Electron against compiled templates. | Holds. The deck as frontend resolves it. |
| 7 | The mobile app has no landing spot. | Revised. A separate Expo app beside the deck is fine. |
| 8 | Fleetdeck's design gate would reject promptly screens. | Moot. Promptly screens do not port. |
| 9 | Module systems differ: TS ESM against CommonJS with no server build. | Holds. Port task: the `fleet` module becomes TypeScript. |
| 10 | Storage differs: Postgres against SQLite + JSON. | Holds. The backbone keeps Postgres; fleetdeck state migrates. |
| 11 | No user identity in fleetdeck. | Revised. Keep workspaces in single-workspace mode. |
| 12 | Secret lifecycles conflict: stored OAuth tokens against mint-on-demand. | Holds. Open risk (section 10). |
| 13 | Process supervision conflicts: `up.sh` refuses agent-shell starts; the promptly daemon runs as an OS service. | Holds. Open risk (section 10). |
| 14 | Billing is dead weight. | Holds. Stripe stays dormant. |
| 15 | Provider OAuth is a stub. | Corrected. Linear sync code exists (`linear-sync.ts`, 625 lines). The gaps doc still lists provider integrations as unfinished. |
| 16 | Promptly is paused and self-declared not ready. | Holds. A parallel run is required. |
| 17 | Size inverts ownership (139k against 47k lines). | **Withdrawn.** Measured 48.9k against 43.6k. |
| 18 | Two test runners (148 against 37 files). | **Withdrawn.** Both use `node:test`; 33 against 30 files. |
| 19 | Write gating differs: idempotent commands with revision checks against REST with epoch fencing. | Holds. Resolved in favor of promptly's model. |
| 20 | The bus has no target: promptly runs take no mid-run input. | Holds. Port task: the bus delivers into tmux; approvals and questions become the typed path. |

## 7. What promptly adds to fleetdeck

Portability: every backend candidate imports only promptly's own contracts, domain, or adapter
packages plus Node core. None needs Postgres or React.

| # | promptly part | Lines | What the fleet gains |
|---|---|---|---|
| 1 | Run state machine, 13 states (`packages/domain/src/run-state.ts`) | 85 | A typed seat lifecycle. Screens show real status. The coordinator reacts to transitions. |
| 2 | Phone approvals: Expo app, `mobile-devices.ts`, `run-approvals.ts`, `run-questions.ts` | 4,137 + 910 + 506 + 476 | Approve a proposal or answer a question from the phone. The bus pastes the answer into tmux. |
| 3 | Agent adapters: probe and launch plan (`packages/agent-adapters/src/index.ts`) | 299 | Per-host status: claude ready, codex needs auth, binary missing. Launchers get a planned command. |
| 4 | Recovery decision table (`packages/runner-core/src/daemon-recovery.ts`) | 728 | A tested resume and reattach table replaces the ad-hoc reap and reclaim code. |
| 5 | Proposal hash and approval gate (`packages/security/src/proposal-hash.ts`) | 41 | Kill and registry-delete need a signed proposal. |
| 6 | Secret redaction (`packages/security/src/redaction.ts`) | 29 | Transcripts, bus messages, and support bundles are scrubbed. |
| 7 | Task sources and Linear sync (`task-sources.ts`, `linear-sync.ts`) | 559 + 625 | The coordinator board syncs with Linear both ways. |
| 8 | Audit log (`apps/api/src/audit-log.ts`) | 218 | One queryable audit table for verify snapshots and the decision ledger. |
| 9 | Notifications and push (`apps/api/src/notifications.ts`) | 459 | A durable notify inbox with push to the phone. |
| 10 | OKLCH action tokens (`do` / `later` / `refine` / `close`) | small | One token file behind the deck's theme values. |

The first version of this list said where each item lands in `server.js`. The backbone flip
(section 9) replaces that. In the revised shape these items stay in promptly's API, and
fleetdeck's runtime moves to them.

## 8. Retire list: first rationale and revision

Verdict 3 proposed retiring five parts. The operator challenged it in verdict 5. Measurement
supported the challenge.

| Part | First reason to retire | After measurement |
|---|---|---|
| promptly API server | Two servers make two sources of truth. Its worker protocol serves daemons that spawn agents. | Keep as the backbone. It is the more structured server. |
| Postgres | Needs a service before the deck boots. One writer. Most of its 34 tables serve tenancy. | Keep. It backs transactions, the outbox, and idempotency. The boot dependency becomes a managed risk. |
| Workspaces, roles, auth | One operator. A second identity system with stored session tokens. | Keep in single-workspace mode with one bootstrap operator account. Device pairing covers the phone. |
| Stripe | Nothing to bill. Needs a public webhook. Never ran live. | Keep dormant. Revisit if fleetdeck becomes multi-user or goes on sale. |
| Electron shell | The deck already runs in a browser and the desktop app. Electron hosts a runner daemon fleetdeck does not need. | Still drop, unless the operator wants a tray icon or the OS keychain. |

The evidence behind the flip:

| Signal | promptly `apps/api` | fleetdeck `server.js` |
|---|---|---|
| Structure | 31 modules, 19.7k lines | 1 file, 3,204 lines, 87 functions |
| Idempotency keys | 20 modules | 2 mentions |
| Transactions | 19 modules | 1 mention |
| Outbox | 20 modules | none |
| Revision checks | 11 modules | none; epoch fencing instead (72 mentions) |
| Audit log | 18 modules | 2 mentions |

The counts are keyword grep hits. They show where each concept appears. They do not prove
correctness.

## 9. Recommended shape (not confirmed)

- **Backbone:** promptly `apps/api`. Keep Postgres, transactions, the outbox, idempotency,
  migrations, audit, device pairing, approvals, and notifications.
- **Port in:** fleetdeck's runtime as one typed `fleet` module: hosts and ssh, tmux and pty attach,
  the message bus, the git-train broker, the machines and desktop-session collectors, credits.
  The source today is 4,190 lines: `server.js` (3,204), `coordinator-api.js` (371),
  `fleetdeck-train.js` (248), `desktop-sessions.js` (217), `message-bus.js` (150).
- **Frontend:** the v2 deck (`public/v2`, xterm tiles, design gate) replaces the React hub.
- **Phone:** the Expo app stays as the approval and push surface.
- **Identity:** single-workspace mode with one bootstrap operator account. Fleetdeck's cert and
  token minting stays as the machine trust layer.
- **Drop:** the Electron shell. Stripe stays dormant.
- **Cutover:** a parallel run. The new API runs on its own port. The deck switches its API base
  one screen at a time. `server.js` stays until every screen has moved.

Suggested sequence:
1. Parallel-run scaffold: promptly's API boots locally beside the deck with one operator workspace.
   This is goal 1.
2. Port the fleet runtime into the API as the `fleet` module.
3. Switch deck screens one at a time, read-only screens first.
4. Wire the phone surface: pairing, approvals, questions, push.
5. Retire `server.js`.

## 10. Risks

1. **Unproven backbone.** Promptly never ran live; fleetdeck runs daily. A failed cutover stops the
   fleet. Mitigation: the parallel run, with `server.js` kept until the last screen moves.
2. **Boot dependency.** Postgres must run before the API. `up.sh` is operator-only and bound to
   1Password. The new start path must keep that rule.
3. **Secret lifecycle.** Promptly stores provider tokens in Postgres. Fleetdeck's rule is no
   standing secret. Keep provider OAuth off until its tokens follow mint-on-demand.
4. **Control channel.** The fleet runs on tmux. Promptly's child-process supervisor must not become
   a second, competing control path.
5. **Unverified surface.** Billing, provider OAuth, and mobile never ran in production. Enable each
   one only with its own test.

## 11. Open decisions for the operator

1. Confirm promptly's API as the backbone.
2. Choose the home repo for the merged code: `0xneelo/promptly` or `0xneelo/thinkpromptly-fleet`.
3. Keep Postgres, or run promptly's repositories on SQLite. Its daemon already uses SQLite.
4. Electron: drop it, or keep it for a tray icon and the OS keychain.
5. Stripe and multi-tenant roles: keep dormant, or delete.

## 12. How to resume

- In a session in this repo, say "resume promptly merge". Start with goal 1.
- This report lives on branch `claude/thinkpromptly-fleetdeck-compare-6f28f6`.
- Clone promptly with the broker token. A plain https clone fails closed on the Mac:

```bash
tok=$(curl -sf http://localhost:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])') && GH_TOKEN=$tok git -c credential.helper= -c credential.helper='!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' clone --depth 1 https://x-access-token@github.com/0xneelo/promptly.git
```

- A broker 503 means no GitHub train is open. Start one on the deck's keys screen (`/app#keys`).

## Appendix A. API surface

promptly (`apps/api/src/server.ts`, prefix `/v1`): `bootstrap`, `auth/*` (device code, passkey,
TOTP, password, session), `account/*`, `workspaces`, `members`, `billing/*` (Stripe),
`providers/linear/*`, `repositories`, `tasks`, `task-sources`, `runs`, `runs/commands`,
`workers/enroll`, `workers/leases/renew`, `workers/runs/claim|events|release`,
`workers/stream/message` (WebSocket), `devices/mobile/*`, `notifications`, `audit-log`,
`security/report`, `support-bundles`, `events`, `health`.

fleetdeck (`server.js` at `88a1765`): `/api/sessions`, `/api/health`, `/api/sshkeys` (mint,
delete), `/api/registry` (delete), `/api/seats` (claim), `/api/credits`, `/api/machines`,
`/api/desktop-sessions` (transcript), `/api/messages` (retry), `/api/notify*`, `/api/kill`,
`/api/coordinator/*`, `/api/ghtoken`, `/api/ghtrain` (end), `/term` (WebSocket pty), plus a
tailnet mirror set.

| promptly | fleetdeck |
|---|---|
| `runs`, `tasks` | `/api/sessions`, `/api/registry` |
| `workers/runs/events`, `workers/stream/message` | `/term` (different transport) |
| `workers/enroll` | `/api/machines` |
| `notifications` | `/api/notify` |
| `health` | `/api/health` |
| `workers/runs/claim` | none; fleetdeck discovers sessions by polling tmux |
| none | `/api/kill`, `/api/sshkeys`, `/api/messages`, `/api/ghtrain` |
| `auth/*`, `billing/*`, `providers/*`, `devices/mobile/*` | none |

## Appendix B. promptly Postgres tables (34)

Source: `apps/api/src/migrations.ts`.

- Tenancy: `organizations`, `workspaces`, `users`, `memberships`, `workspace_invitations`,
  `subscriptions`
- Devices: `desktop_devices`, `mobile_devices`, `pairing_codes`
- Work: `tasks`, `task_sources`, `repositories`, `agent_profiles`, `runs`, `run_events`,
  `worker_leases`
- Human loop: `questions`, `answers`, `execution_proposals`, `approvals`, `notifications`
- Reliability: `outbox_messages`, `idempotency_keys`, `audit_log`, `schema_migrations`
- Auth: `auth_device_codes`, `auth_sessions`, `auth_idempotency_keys`,
  `auth_security_challenges`, `auth_security_factors`, `auth_password_credentials`
- Providers: `provider_oauth_attempts`, `provider_connections`, `provider_token_secrets`

## Appendix C. How the figures were measured

- promptly source lines: `*.ts` and `*.tsx` under `apps`, `packages`, `scripts`; excluding
  `*.test.*`, `*.d.ts`, and `node_modules`. Promptly also commits 29 compiled `.js` files in
  `packages`; they are excluded.
- fleetdeck lines: `*.js` and `*.mjs`; excluding `node_modules`, `vendor`, and the compiled
  `public/v2/app.js` and `public/v2/fixture.js`.
- Test files: `*.test.ts` / `*.test.tsx` (promptly) and `test/*.test.js` (fleetdeck).
- Test runner: sampled promptly API tests import `node:test`; fleetdeck's `npm test` runs
  `node --test`.
- Tables: unique `CREATE TABLE` names in `apps/api/src/migrations.ts`.
- Commit count: `git rev-list --count 88a1765`.
