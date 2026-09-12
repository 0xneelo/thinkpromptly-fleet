# T3 Code evaluation (2026-09-07)

Ten reader passes over `pingdotgg/t3code` at v0.0.39 (commit 8b2838e0), asked one question:
is T3 Code useful to fleetdeck, and what can we borrow?
File paths below point into the t3code repo unless marked `ours:`.

## Verdict

- **Not a replacement.** T3 is a single-user harness: one operator, a few threads, one host per pairing.
  It has no fleet registry, no agent-to-agent bus, no orchestrator/worker roles, no merge train,
  and no "all my machines in one view". Those are fleetdeck's moat.
- **A strong design reference.** MIT licensed, 200k+ users, 6-8 nightly builds a day.
  Contributions are closed (`CONTRIBUTING.md:9-11`), so treat it as read-only prior art.
- **Its biggest lesson:** T3 never types into a TUI. Every agent is driven by a protocol.
  That removes the whole "unsubmitted pane line wedges" failure class we live with.

## What T3 is

- Control surface for coding-agent CLIs: Codex, Claude Code, Cursor, Grok Build, OpenCode, Antigravity (`README.md:8`).
- Clients: Electron desktop, hosted web (app.t3.codes), iOS/Android (Expo), `npx t3@latest` local server.
- Server: Bun + Effect-TS, SQLite, `node-pty`, `@anthropic-ai/claude-agent-sdk` (`apps/server/package.json`).
- Web: React 19, TanStack Router, Zustand, Tailwind 4. One WebSocket per environment, typed with Effect Schema RPC (`packages/contracts/src/rpc.ts`).
- Remote: desktop launches a full T3 server on the remote box over ssh and tunnels it back (`packages/ssh/src/tunnel.ts:710,941`). Reachability (LAN, Tailscale, ssh, "T3 Connect" relay) is only endpoint discovery, never a different execution model (`docs/internals/remote.md`).

## Borrow list, ranked by value to a 5-20 worker operator

| # | Idea | Where in T3 | Why for fleetdeck | Effort |
|---|---|---|---|---|
| 1 | Drive Codex via `codex app-server` JSON-RPC instead of the tmux TUI | `apps/server/src/provider/Layers/codexLaunchArgs.ts:13`, `packages/effect-codex-app-server/src/client.ts` | Structured turns, approvals, streaming. Kills pane-typing races for GPT workers first. | S-M |
| 2 | Persist a resume cursor per worker: `{sessionId, lastAssistantUuid, turnCount}` | `ClaudeAdapter.ts:2041-2050`, `Migrations/004_ProviderSessionRuntime.ts` | Re-attach after deck or box restart without reading tmux scrollback. | S |
| 3 | Approvals as a request/response channel, not prompt-string detection | `ClaudeAdapter.ts:4276-4331` (`canUseTool` → `user-input.requested` → Deferred) | Ends the "did the permission prompt get answered" race. | M |
| 4 | Thin per-box agent process; deck talks to it over a tunnel | `apps/desktop/src/ssh/DesktopSshEnvironment.ts` | Replaces ssh-into-pane driving. Big change, biggest payoff. | L |
| 5 | Disk-persisted bounded scrollback, snapshot on attach | `apps/server/src/terminal/Manager.ts:1696-1833, 2729-2760` | Fixes scrollback loss on reconnect. 5k lines / 8 MiB cap, 40 ms debounce. | M |
| 6 | Append-only event log + projections + sequence-cursor resume | `Migrations/001_OrchestrationEvents.ts`, `ws.ts:1527-1545` | Registry JSON and bus JSONL become replayable. Client sends `afterSequence`, server replays gap or sends snapshot past 1000 events. | M |
| 7 | Usage window schema `{id,kind,label,windowDurationMins,usedPercent,resetsAt}` | `providerUsageLimits.ts`, `claudeUsageLimits.ts:39-151`, `codexUsageLimits.ts` | One shape for 5 accounts × Claude/Codex in the Credits panel. Merges the probe and the mid-turn `rate_limit_event` by window id. | S |
| 8 | QR/URL phone pairing: host + one-time token in the URL hash, DPoP-bound short-lived grant | `apps/mobile/src/features/connection/pairing.ts:29-44`, `apps/server/src/auth/PairingGrantStore.ts:21-58` | Phone access to the deck without a static shared secret. | M |
| 9 | `tailscale serve` (not funnel) shelled to the CLI to publish the deck over HTTPS on the tailnet | `packages/tailscale/src/tailscale.ts:343-365` | Simplest phone-reaches-Mac path. No tsnet. | S |
| 10 | Rail: group by git origin `owner/name`, pinned / snoozed / settled sections, drag-to-pin | `apps/web/src/sidebarProjectGrouping.ts:53`, `Sidebar.tsx:626` | Extends our L12 project grouping. Worktrees of one repo stop looking unrelated. | M |
| 11 | One status color vocabulary everywhere: sky=working, amber=approval, indigo=input needed, red=failed. No animation on background rows. | `Sidebar.tsx:1113-1156` | Twenty pulsing rows is worse than twenty static ones. | S |
| 12 | Cmd+1..9 jump to the Nth rail row; compact approval pill with `1/N` counter | `packages/contracts/src/keybindings.ts:10-20`, `ComposerPendingApprovalPanel.tsx:14-59` | Keyboard hop across tiles, approvals visible without bloating the conversation. | S |
| 13 | Sticky "woke" pill until the operator re-engages | `Sidebar.tsx:1096-1108` | Async worker completions need a sticky signal, not a toast. | S |
| 14 | Process-tree diagnostics + identity-checked safe-signal RPC | `apps/server/src/diagnostics/ProcessDiagnostics.ts:89-161`, `native/resource-monitor` | "Kill this stuck worker" from the UI. Re-validates pid + start time before signalling. Never touches the deck itself. | M |
| 15 | Per-turn hidden-ref checkpoints with revert | `apps/server/src/checkpointing/CheckpointStore.ts`, `CheckpointReactor.ts:237-266` | Revert one worker turn without touching branch history. | M |
| 16 | Base branch in git config `branch.<x>.gh-merge-base`; `findOpenPr` before create; auto-rename branch on collision | `GitVcsDriverCore.ts:2917-2921, 960-994`, `GitManager.ts:1940` | Train broker stops inferring base by convention; no duplicate PRs on re-run. | S |
| 17 | Cap + evict idle PTY sessions (128), explicit onData/onExit unsubscribe on every teardown | `Manager.ts:99, 441-447, 1956` | Bounds fd growth even with the node-pty leak. | S |
| 18 | Always-on bounded NDJSON trace file, OTLP export opt-in via env | `docs/operations/observability.md` | Crash forensics for an unattended deck. 10 MB × 10 files rotation. | S |
| 19 | Nightly-then-promote release pipeline; stable ships a nightly's exact commit | `.github/workflows/release.yml`, `docs/operations/release.md` | Decouples merges to main from what runs. | L |
| 20 | AGENTS.md rules: never `pkill -f`, "hit every surface" checklist, no PR-summary docs | `AGENTS.md` | Cheap to adopt verbatim. | S |

## Things T3 does not solve for us

- **node-pty ptmx leak.** T3 uses node-pty too and only chmods the spawn helper (`NodePtyAdapter.ts:27-70`). Our `reapStrayMasters` stays.
- **Multi-host aggregation.** One pairing = one host. No fleet view.
- **Agent-to-agent messaging, orchestrator/worker roles, merge train.** Absent.
- **Conflict resolution.** None. Git failures surface to the user.
- **Crash supervision.** No watchdog. Kill is manual from the UI.

## Notable design facts

- Claude is driven by the Agent SDK in-process (`query()` with `resume`, `permissionMode`, `effort`, `canUseTool`, `includePartialMessages`), `ClaudeAdapter.ts:1952, 4670-4699`. Cursor/Grok/Antigravity use ACP over stdio (`packages/effect-acp`). Claude Code also speaks ACP via `claude --experimental-acp` if we prefer one protocol for all.
- Runtime modes map to SDK permission modes: `auto-accept-edits → acceptEdits`, `full-access → bypassPermissions` (`ClaudeAdapter.ts:4643-4685`).
- Terminal rendering is client-side libghostty-vt compiled to WASM, Canvas 2D, no xterm.js (`apps/web/src/terminal/ghostty/`). Server ships raw bytes plus persisted history. An L-sized bet for us.
- SQLite in WAL mode with `busy_timeout=5000`, 49 numbered migrations run at startup (`persistence/Layers/Sqlite.ts:34-40`).
- Client reconnect has one retry owner with capped backoff; offline and auth failures wait for a wakeup instead of burning retries (`packages/client-runtime/src/connection/supervisor.ts`).
- Mobile has full parity: approve, reply, push notifications, iOS Live Activity (`apps/mobile/src/features/agent-awareness/`).
- Onboarding groups candidate folders by git origin and filters linked worktrees and scratch dirs (`apps/web/src/onboarding/projectImport.logic.ts`).
- Remote ssh launches are deduped by a sha256 of alias+host+user+port and guarded by a per-target lock (`packages/ssh/src/command.ts:76-81`, `tunnel.ts:1174-1178`).

## Suggested first slice

Spike #1 + #2 together on one GPT worker: launch `codex app-server` in the box session, speak JSON-RPC
from the deck, persist the resume cursor in the registry. Small, isolated, and it proves the
protocol path before touching Claude workers.

Sources: ten reader passes, 2026-09-07. Clone was `git clone --depth 50` of main at 8b2838e0.
