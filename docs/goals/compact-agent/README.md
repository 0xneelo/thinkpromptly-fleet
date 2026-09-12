# compact-agent — the deck compacts sessions before they bloat

**Project:** remote-system · **sub-project:** fleetdeck-compact-agent · **worker:** Maurice · backend-developer (`agent-maurice`)
**Packaged by:** 🎛 ORCHESTRATOR 11, 2026-09-12 · **source brief:** `docs/research/compact-agent-2026-09-11.md` (🔬 RESEARCHER 6, verdict: feasible, worth it)
**Run mode:** GPT-6 Astra xhigh, `/goal`, german-box (`fd-launch-gpt.sh`), branch `agent-compact-agent` from `origin/main`.
**Launch gate:** unblock sheet `ub-ba823ee7` cards `compact-lane`, `compact-threshold`, `compact-gpt-window` + an open key window (train + cert). Defaults below apply unless a card or its note says otherwise.

## Goal (one line)
A deck service watches every live Claude/GPT session's context fill; at the threshold it drafts a curated brief, lets the session compact itself through Claude Code's own hooks (no typing into panes), and re-injects the brief after the compaction. Important sessions get an operator card first.

## Defaults locked at packaging (operator may override on the sheet)
| Knob | Default | Source |
|---|---|---|
| Threshold | 60 % of the **reported** window (600K on 1M Claude; ~155K on a 272K Codex worker). Never a hard-coded size. | brief §1, §6 risk 5 |
| Brief writers | A (`claude -p --resume <id> --fork-session`) for plain sessions; A + B (Sonnet reader over jq-stripped JSONL) for important ones | brief §2 |
| "Important" | inferred: 🎛 orchestrator, 🧭 portal/coordinator, 🥅 goalkeeper seats; plus a manual toggle on the deck sessions/desktop rows | brief §5 |
| Box Claude workers | launcher exports `CLAUDE_CODE_AUTO_COMPACT_WINDOW=<threshold tokens>` | brief §7 q4 |
| GPT workers | keep Codex's 272K window; trigger = `/compact` typed through the bus (tmux fallback path) | brief §7 q5 |
| Fail-open | above 90 % of the real window the PreCompact gate never blocks | brief §6 risk 2 |

## Milestones (one Linear sub-issue each, commit per milestone, SHAs in REPORT.md)
- **M0 crux test (first, blocks the design):** in a scratch session on the box (`claude --autocompact 100k`, a PreCompact hook that logs and exits 2), push past 100K and record across ≥3 later turns whether the blocked *proactive* auto-compact is retried. Retried → hook path; not retried → the bus types `/compact` for tmux sessions and desktop seats get the operator card only. Write the finding into REPORT.md before M1.
- **M1 fill reporter:** `box/hooks/fd-context.sh` (Stop hook) reads the last `message.usage` + `message.model` from `transcript_path`, derives the window (static table per model id; status-line `context_window_size` when present) and POSTs `{session_id, cwd, model, fill, window, host}` to `POST /api/context`; the deck stores it (new `context` table keyed by session id, `reported_at`) and serves `GET /api/context`. Codex sessions: the deck reads `~/.codex/sessions/**/rollout-*.jsonl` `token_count` events over the existing box ssh path (like `box/desktop-transcript.sh`). Mac install = a documented snippet for `~/.claude/settings.json` (the operator applies it; a lane never edits the operator's settings).
- **M2 policy tick:** beside `reaperLoop` (server.js `setInterval`, 30 s): a session is `due` when `fill ≥ threshold · window` AND idle (its last Stop POST is the idle signal — never the tmux prompt line, memory `pane-typed-lines-wedge-unsubmitted`). Plain → M3 then release; important → post an unblock card (`source: "compact"`, answered by a direct policy call — the deck agent has no bus address) with the draft brief in the note: Approve / Edit / Skip.
- **M3 brief writers:** writer A forks the session (`claude -p --resume <id> --fork-session "…"`) — prove on a scratch seat that a fork never races the live transcript; writer B = Sonnet over `jq`-stripped JSONL. Brief ≤ 10 000 chars (SessionStart `additionalContext` cap), else a file + pointer. Stored on the deck with the session id.
- **M4 hooks:** `PreCompact` asks the deck "may I?" and waits for the brief (fail OPEN above 90 %); `SessionStart(source=compact)` fetches the brief as `additionalContext`; `PostCompact` posts `compact_summary` to a deck audit table. Ship in `box/hooks/`, wire into the box worker settings the launcher already writes; document the Mac snippet.
- **M5 launcher:** `fd-launch` / `fd-launch-gpt.sh` export `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for Claude lanes; Codex lanes unchanged (272K) — the bus `/compact` path is the trigger there.
- **M6 tests + report:** `FLEET_TEST_TAILNET_BIND=::1 npm test` green on the box; new tests for `/api/context`, the policy tick, the card path; REPORT.md with SHAs, the M0 finding, and cost observations (PostCompact preTokens → postTokens).

## Acceptance
1. `GET /api/context` shows fill + window for every live box session within 60 s of a turn end; desktop seats appear once the operator installs the Mac snippet (documented, not required for acceptance).
2. A scratch session pushed past the threshold compacts with the curated brief present in its post-compact context — hook path proven, or the tmux fallback proven and the hook gap recorded from M0.
3. An important session gets the card and does not compact until answered, except above 90 % (fail-open proven in a test).
4. PostCompact audit rows exist for every compaction the deck triggered.
5. Suite green; REPORT.md signed with every SHA; no typing into any pane except the documented bus `/compact` fallback.

## Constraints
- Never gate on the tmux prompt line; never send bytes on `/term`; the bus is the only write path to a pane.
- Deck restart is operator-only (`up.sh`) — file the restart as an `operator:gate` issue, do not restart.
- Push with the broker token only (`GH_TOKEN` env from `http://100.125.231.25:3131/api/ghtoken`, re-fetched per push; never argv/URL/file/log). Never 1Password, never `ssh-add`.
- Auth / secrets / deletes stay exact; no compaction of those paths.
- Out of scope: editing the operator's Mac settings, changing the deck's sign-in model, raising the Codex window (card `compact-gpt-window` decides that separately).

## Pointers
brief `docs/research/compact-agent-2026-09-11.md` (§Pointers: server.js registry L154, heartbeat L378–412, reaper L969–1097, tmux deliver L2872–2891, desktop deliver L2902–2946, transcript ssh L1840–1860; `unblock.js` L187–327; `box/hooks/fd-pinger.sh`; `box/desktop-transcript.sh`) · memories `pane-typed-lines-wedge-unsubmitted`, `up-sh-operator-only`, `fleetdeck-unblock-screen`.
