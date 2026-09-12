# CTRL NODE (ctrlnode.ai) — fit eval for fleetdeck, 2026-09-02

Source: tweet https://x.com/ctrlnodeai/status/2087671763799003224 (2026-08-12), https://ctrlnode.ai, https://docs.ctrlnode.ai, https://github.com/ctrlnode-ai/ctrlnode (Bridge source, v2026.3.1).

## Verdict

**Not a replacement for the deck. Optional sandbox trial as a scheduler only.**

## What it is

- SaaS control plane (app.ctrlnode.ai, `wss://api.ctrlnode.ai/ws/bridge`) + open-source local Bridge (ELv2, Bun/TypeScript, Linux/macOS/Windows binaries).
- Bridge makes one outbound WebSocket. Cloud dispatches tasks; Bridge spawns providers locally.
- Features: agent graphs (canvas), Kanban, routines (cron), live activity, Files browser, guarded git ops.
- Providers: Claude Code CLI, Claude Agent SDK, Codex SDK, Copilot, Gemini, Cursor, Hermes, OpenClaw, OpenRouter, Ollama.
- Auth: Claude subscription login works (`claude login` on the host, no API key). Codex: ChatGPT OAuth synced into a per-agent `CODEX_HOME` (source), API key optional.

## Execution model (source, ClaudeCodeProvider.ts)

```
claude -p <prompt> --output-format stream-json --verbose --include-partial-messages \
  --allowedTools Read,Write,Edit --max-turns 200 --dangerously-skip-permissions \
  [--model X] [--resume <id>|--no-session-persistence] [--append-system-prompt-file CLAUDE.md]
```

- One-shot headless run per task in `{BASE_PATH}/.ctrlnode/tasks/...` (OUTPUT ONLY) or in-place in the project dir (WORK DIRECTORY). No worktree, no branch, no auto-commit.
- Defaults: no Bash tool (`CLAUDE_TOOLS`), 10-min timeout (`CLAUDE_TIMEOUT_MINUTES`).
- Codex: `approvalPolicy: never`, `sandboxMode: workspace-write`, workspace trust forced in `config.toml`.
- Cannot attach to or observe existing tmux sessions. It is a parallel runner, not a viewer.

## Why it does not fit as a control plane

| # | Finding | Evidence |
|---|---|---|
| 1 | Cloud-only control plane, no self-host. | README, docs; only the Bridge is open source. |
| 2 | Everything streams up: text deltas, tool calls with paths, command output, `read_file` contents (≤10–15 MB), full git diffs, dir listings. | `websocket.ts`, `filesystemConfigHandlers.ts:304-360`, `gitHandlers.ts:128-276` |
| 3 | Cloud can write files, `delete_path` recursively, `push`, `checkout`. Pairing token = remote control of `BASE_PATH` (default: whole home dir). | `filesystemConfigHandlers.ts:80-163`, `gitHandlers.ts:283-425` |
| 4 | Auto-update on every start; headless runs apply it with no opt-out. Binary self-replaces from their release URL. | `updater.ts:173-227` |
| 5 | Bypass-permissions by default on all providers, driven from a browser account. | `config.ts:150-178` |
| 6 | Conflicts with repo rules: the deck is the fleet control plane; credentials never leave the box; up.sh operator-only. | README.md:37-39,74-76; docs/goals/train-broker-isolation/reports/zita.md:122 |
| 7 | Young: first release 2026-04-29, 27 stars, legal entity unnamed, EU-law ToS, pricing behind login (free tier exists). | gh repo view; /terms; /privacy |

Privacy policy: no training on payloads; transient payloads "not persisted beyond what is strictly required"; hosting provider and region unnamed.

## Where it could help

- Scheduler: fleetdeck has no cron for agent runs. Routines + graphs give that with a UI.
- Codex on ChatGPT subscription ($0 marginal) and Claude Max both work.

## If trialled

1. Throwaway box or dedicated user on german-box. `BASE_PATH` pinned to a scratch dir, never `~`.
2. OUTPUT ONLY mode only; no `repositoryPaths` to lowcap or customer repos.
3. `CLAUDE_TOOLS=Read,Write,Edit,Bash,Glob,Grep` if runs need tests.
4. Run under tmux (no service file shipped); expect silent self-updates.
5. Keep the deck as the only control surface for real worker sessions.

Multi-bridge per account: docs silent; "More tokens: System → Bridge Setup" suggests one token per machine. Unverified.
