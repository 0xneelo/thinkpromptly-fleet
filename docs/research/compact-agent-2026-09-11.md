# The compact-agent — feasibility brief

**From:** 🔬 RESEARCHER 6 · compact-agent · 2026-09-11
**Question:** an agent scans all live sessions; at 50–60 % context fill it runs two readers over the session, then makes the session compact itself. Sessions tagged *important* first get an unblock card where the operator approves what the compact keeps. Does it make sense, and is it feasible?

**Verdict:** feasible, and worth it. One design change: do not *type* `/compact` into sessions. Use Claude Code's own auto-compact window plus three hooks as the control plane, and the deck as the brain. The typed path stays as a tmux-only fallback.

Sources per claim: `[docs]` = live code.claude.com docs fetched 2026-09-11; `[probe]` = transcript probe on this Mac; `[deck]` = fleetdeck code read (file:line). Claims with one source are marked *unconfirmed*.

## 1. Observe — can we read a foreign session's fill? Yes, three ways

| Surface | What it gives | Source |
|---|---|---|
| Status-line stdin JSON | `context_window.used_percentage`, `context_window_size`, `total_input_tokens`, plus `session_id`, `transcript_path`, `cwd`, `model`. Event-driven, 300 ms debounce; `refreshInterval` keeps it alive while idle. | `[docs]` statusline.md L184–188, L152 |
| Transcript JSONL | every assistant line carries `message.usage`; `input + cache_creation + cache_read` = current fill, the same formula the docs use. Verified on 3 live files. | `[probe]`, `[docs]` statusline.md L366 |
| Deck ssh path | the deck already opens `~/.claude/projects/*/*.jsonl` on boxes via `box/desktop-transcript.sh` (server.js:1840–1860). | `[deck]` |

Gaps: the registry `sessions` table has no context field, no Claude session id, no model (server.js:154–178). Desktop sessions carry `cliSessionId`, `cwd`, `model` (box/desktop-sessions.sh:62–71). Our `session-kind/statusline.sh` reads only `.cwd` today.

Feed: a **Stop hook**, not the status line. The status line likely never runs in the desktop app: a 40 s process sample caught zero `statusline.sh` runs while this desktop seat made five tool calls, and the fleet CLAUDE.md already says the desktop app has no status line. *Unconfirmed; two sources.* Hooks do run in desktop seats: this seat's SessionStart hooks fired (title, Honey context). `[probe]`

So: one Stop hook on every machine. It reads the last `message.usage` and `message.model` from `transcript_path` and POSTs `{session_id, cwd, model, fill}` to the deck. It fires when a turn ends, so it also gives the **idle** signal for free, which is exactly when a compact is safe. Window size comes from the model id (Models API `max_input_tokens`, or a static table). The status-line `context_window_size` stays a bonus for terminal sessions.

Window size: **every Claude session in this fleet runs a 1M window.** Fable, Sonnet 5 and Opus 4.7+ are native 1M on the Anthropic API and auto-compact at ~967K by default. `[docs]` model-config.md L715. The 200K cases (Bedrock/Vertex/Foundry, `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`) do not apply: no such env or setting found on this Mac. `[probe]` Still read `context_window_size` from the status line instead of assuming it.

Observed on this Mac, transcripts touched in the last 24 h, peak fill per session `[probe]`:

| Model | Sessions | Peak fill | > 200K | > 500K |
|---|---|---|---|---|
| claude-opus-5 | 20 | 965K | 12 | 5 |
| claude-fable-5-1 | 23 | 611K | 11 | 1 |
| claude-sonnet-5 | 4 | 93K | 0 | 0 |
| claude-fable-5 | 2 | 96K | 0 | 0 |

**Max window is readable per session, three ways:**

| Source | Field | Covers | Source |
|---|---|---|---|
| Status-line stdin JSON | `context_window.context_window_size` (subagent rows: `contextWindowSize`) | Claude Code sessions, as Claude Code itself sizes them | `[docs]` statusline.md L185, L1101 |
| Models API `GET /v1/models/{id}` | `max_input_tokens` (plus `max_tokens` = output cap) | any Claude model id; needs an API credential (`ant` CLI not installed here) | claude-api skill `shared/models.md` L13, L44 |
| Codex rollout JSONL `~/.codex/sessions/**/rollout-*.jsonl` | `token_count` events: `info.model_context_window`, `info.last_token_usage.input_tokens` | GPT workers | `[probe]` |

The Claude transcript JSONL carries only the model id, no window size. `[probe]`

**GPT workers: the model takes 1.05M, Codex runs it at 272K.**

| Layer | Tokens | Source |
|---|---|---|
| GPT-6 Astra API window | 1,050,000 | third-party only: Medium, OpenRouter, llm-stats, aicybr. OpenAI's pricing page lists short- and long-context tiers ($10 / $20 input) but not the threshold |
| API long-context step | above 272K input the whole request bills 2x input and cache, 1.5x output | third-party only |
| Codex 0.153.2 catalog, `gpt-6-astra` | `context_window` 272,000; `max_context_window` 872,000 | `[probe]` binary strings |
| Usable in our sessions today | 258,400 = 95 % of 272K (`effective_context_window_percent`) | `[probe]` 6 of 6 rollouts |
| How to raise it | top-level `model_context_window = 872000` in `~/.codex/config.toml`; profile-scoped values are ignored (openai/codex#14456); Codex caps auto-compact at 90 % of the window | web, 2 sources |

Subscription cost above 272K is **unconfirmed**. Reports in a r/codex thread range from no difference to ~1.5x faster quota burn at a 500K window; an OpenAI employee is quoted saying usage rises linearly. Every turn re-sends the whole context, so quota per turn grows with fill either way.

One live GPT session sat at 149K of 258K, i.e. 58 %, at probe time. `[probe]` Codex sessions need their own path: fill and window come from the rollout's `token_count` events, and the trigger is typing `/compact` into the tmux pane (no Claude hooks there).

Compactions seen (`type: system`, `subtype: compact_boundary`, `compactMetadata.preTokens`): one lowcap-connector seat compacted **manually** at 678K and 717K, then **auto** at 971K → 21K. So the default 967K trigger is real, and the operator already compacts by hand around 700K.

So 50–60 % means 500–600K tokens for every Claude session and ~130–155K for a GPT worker. The policy should be a percent of the *reported* window, never a hard-coded size.

## 2. Curate — can the compact be steered? Partly; can the result be re-fed? Fully

- `/compact <instructions>` steers the summary. A `# Compact Instructions` section in CLAUDE.md sets a default. `[docs]` context-window.md L1621
- **PreCompact hook**: receives `trigger` (`manual`/`auto`) and `custom_instructions`. It can only **block** (exit 2 or `decision: block`). It cannot rewrite the instructions. `[docs]` hooks.md L3015–3045
- Blocking a *proactive* auto-compact skips it and the conversation continues. Blocking a *limit-recovery* compact fails the request. **The gate must fail open near the real limit.** `[docs]` hooks.md L3025
- **PostCompact hook**: receives `compact_summary`, the text the compaction produced. Audit trail for free. `[docs]` hooks.md L3047–3073
- **SessionStart hook, source `compact`**: fires after every compaction and can return `additionalContext` (10 000 chars; larger output spills to a file with a preview). `[docs]` hooks.md L1146, L941, L1000–1015
- Nothing lets us supply the summary text or pick another model for the compaction itself. `[docs]`

So the strong path is: the curated brief is **re-injected after** compaction via SessionStart(compact), whatever the built-in summary kept. Steering the summary is a bonus, not the mechanism.

Who writes the brief:

| Option | Cost at 500K fill | Note |
|---|---|---|
| A. `claude -p --resume <id> --fork-session "write the compact brief"` | runs on the session's own model: ~$0.50 on Fable with a warm cache (cache read ~$1/M); Opus 5 price unverified | full context, no re-parse. Fork keeps the live transcript untouched. *Unconfirmed* for a session that is running interactively — test. `[docs]` sessions.md L213, cli-reference L91 |
| B. Sonnet reader over the JSONL | ~$1.00–1.50 per reader uncached ($2–3/M); less after jq strips tool output | independent second opinion; jq-extract text first |

Recommend A as reader 1, B as reader 2 (the cross-check), on the *important* path only. Plain sessions: A alone.

## 3. Trigger — can we make a foreign session compact? tmux yes, desktop no (by typing)

- **tmux (box workers, local tmux)**: the bus pastes text and sends Enter (`deliverTmux`, server.js:2872–2891). Slash lines are proven in production: the unblock reply is delivered as `/adhd-unblock answers …` (unblock.js:321–327). `/compact <text>` rides the same path. Typed while a turn runs, most commands **queue** and run when the turn ends. `[deck]`, `[docs]` interactive-mode.md L347–355
- **Desktop seats**: the peer socket and `send_message` deliver a *user turn*, not a slash command (server.js:2902–2946; tool description). `/compact` is not reachable through the Skill tool, so a seat cannot compact itself on request. `[deck]`, `[docs]` slash-commands.md L726. **A desktop seat cannot be compacted from outside by typing.** *Single-source on the wrapped-turn point; near certain.*
- **Auto-compact window is settable**: `/autocompact 500k` (saved as user setting `autoCompactWindow`, 100K–1M), `--autocompact` flag per launch, `CLAUDE_CODE_AUTO_COMPACT_WINDOW` env for scripts. `[docs]` model-config.md L692–706

### Recommended control plane (no typing, works for every session kind)

```
Stop hook ─────POST fill+idle─▶ deck /api/context ──▶ policy: % of window, idle?, important?
                                                       │
Claude Code auto-compact fires at a LOW window ────────┤
  PreCompact hook ──ask deck "may I?"──▶ block until brief ready (or operator approved)
                                        fail OPEN above ~90 % of the real window
  compaction runs (built-in summary)
  SessionStart(source=compact) hook ──GET brief──▶ additionalContext = curated brief
  PostCompact hook ──POST compact_summary──▶ deck audit log
```

- The low window is one number per machine (`autoCompactWindow`). With every session on 1M, set it straight to the chosen threshold (e.g. 500K). The PreCompact hook then only holds the compaction until the brief is ready.
- **Crux to test first:** whether a blocked proactive auto-compact is re-attempted on later turns. The docs do not say. Test: `claude --autocompact 100k`, a PreCompact hook that logs and exits 2, push past 100K, watch the log across turns. If it is not retried, the fallback is: tmux → the bus types `/compact`; desktop seats → the operator types it from the unblock card (they are in the loop for *important* sessions anyway).
- Hooks are user-scoped per machine: Mac `~/.claude/settings.json` and the boxes (`box/hooks/` already ships `fd-pinger.sh`, so there is a delivery path).

## 4. The *important* path — the unblock card fits as is

`POST /api/unblock` takes a sheet with questions; each question has option buttons **and** a free-text `note` the operator edits (`PUT /api/unblock/:id/answers/:qid` with `{choice, note}`, unblock.js:246–289). So the card is: intro = why (fill, model, session), one question = "keep this?" with the proposed brief in the note, buttons Approve / Edit / Skip. `[deck]`

Gap: the answer travels back over the message bus to `sheet.reply` (unblock.js:321–327). A deck-internal compact-agent has no bus address. Needs either a `source: 'compact'` branch that calls the policy directly, or the compact-agent runs as a session with a bus address.

## 5. Where the agent runs

- Policy + audit + card: a tick beside `reaperLoop` (`setInterval`, server.js:3931, 30 s) or the statusline POST handler itself. The deck already has `msNow()/monoNow()` drift guards (server.js:970–983).
- Readers: the deck shells out to `claude -p` (it already shells out for transcripts). Sonnet for the JSONL reader; the fork uses the session's own model.
- "Important" flag: a column on `sessions` and on the desktop merge, toggled from the deck UI.

## 6. Risks

1. **Mid-turn compaction.** Gate on idle: the Stop hook POST is the idle signal. Never gate on the tmux prompt line (memory: typed lines wedge).
2. **Blocking near the limit fails the request.** Fail open above ~90 %.
3. **Fork on a live session.** Unconfirmed; may race the live transcript. Test on a scratch seat first.
4. **10 000-char cap on additionalContext.** Briefs above that spill to a file; keep briefs under the cap or point at the file.
5. **Threshold on 1M models.** 500K of Fable at $10/M input is $5 per uncached turn. Early compaction there is the biggest win and the biggest quality risk. Start conservative (600K) and measure via PostCompact.

## 7. Open questions for the operator

1. Threshold: all Claude sessions are 1M, so one number. 500K (50 %) or 600K (60 %)? Manual compactions today land near 700K.
2. One reader (fork) for plain sessions, two for important ones?
3. Is "important" a manual tag, or inferred (orchestrator/portal/goalkeeper seats always important)?
4. Should the deck also lower `autoCompactWindow` on the boxes at worker launch (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` in `fd-launch`)?
5. GPT workers: keep Codex's default 272K window, or raise it toward 872K? Default is safest for quota; the compact-agent adapts either way because it reads the reported window.

## Pointers

- deck: `server.js` (registry L154, heartbeat L378–412, reaper L969–1097, tmux deliver L2872–2891, desktop deliver L2902–2946, transcript ssh L1840–1860), `unblock.js` L187–327, `box/hooks/fd-pinger.sh`, `box/desktop-transcript.sh`
- Mac: `~/.claude/session-kind/statusline.sh` (reads `.cwd` only), `~/.claude/settings.json` (SessionStart hooks only; no PreCompact today)
- docs: hooks.md §PreCompact/§PostCompact/§SessionStart, statusline.md §context window fields, model-config.md §Set the auto-compact window, interactive-mode.md §Queue messages
