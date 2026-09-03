# Effective decisions

Currently-operative operator rulings (DESIGN §4.4). Superseded rows drop into git history — the
anti-rot mechanism. **Hard rule (DESIGN §2, failure #1):** auth / money / migration / delete /
scope rulings are **quoted verbatim or linked, never paraphrased** — the "one line" column is a
locator, not the ruling. Seeded 2026-08-28 by Sylvia: the *list* is PROPOSED (operator confirms
membership); the *quotes* are verbatim.

| id | one line | verbatim | source |
|---|---|---|---|
| D-1 | Boot-read gate is hard, not advisory | "**Boot-read gate: HARD.** PreToolUse-style hook denies orchestrator-seat work until the seat has read `board.json` and restated lane ownership. Advisory gates are proven failures (Class C/E)." | [DESIGN-v1.md §9.2](../docs/coordinator/DESIGN-v1.md) |
| D-2 | Overnight: reversible continues, irreversible holds + escalates | "**Overnight default: hold + Telegram escalation.** Reversible work continues; irreversible pauses hold AND escalate to a **Telegram bot with a simple accept button**. Operator checks the phone every ~4h including during sleep → ack-latency budget ≤4h. The Telegram accept-bot is a v0.2 build item (notify path first; button-ack second)." | [DESIGN-v1.md §9.3](../docs/coordinator/DESIGN-v1.md) |
| D-3 | The portal is a view, the files are the memory | "**Portal session approved.** The operator wants an interactive session to ask questions of, instead of clogging the orchestrator — \"the coordinator state should be in these files, yes; it's maybe just a portal.\" Adopted as §2a: state in files, portal as disposable view." | [DESIGN-v1.md §9.5](../docs/coordinator/DESIGN-v1.md) |
| D-4 | Each coordinator run is a disposable cheap session | "**Run owner: cheap session per run.** A timer/inbox-hook spawns a disposable cheap session for each coordinator run. True stateless reducer; the board is decoupled from seat health." | [DESIGN-v1.md §9.1](../docs/coordinator/DESIGN-v1.md) |
| D-5 | Coordinator v0.1 lives in the fleet repo | "(operator placement ruling: Coordinator v0.1 lives in the fleet repo, not lowcap — decided in-session 2026-08-28)." | [IMPORTED.md](../docs/coordinator/IMPORTED.md) |
| D-6 | Source coverage: want every source — no fixed caps, no minimum-N serve refusals; outlier detection scales with N | "i think we need more sources for anchor prices and outlier detections. our general policy should be if a token has 100 sources, we want 100 sources / if a token has 10 we want 10 / if a token has 5 we want 5 / if a token has 1 we want 1 / if a token has 1,000,000 sources, we want 1,000,000" (2026-08-29; retires ANCHOR_POOLS_PER_HOP=2; N=1 serves with degraded provenance; independence still counted — DS/GT/CG = one family) | [XYZ-1849](https://linear.app/synchronicity/issue/XYZ-1849), memory `source-coverage-policy-want-every-source` |
| D-7 | Coordinator context is stored mid-transit — in-flight init/interview state lives in `coordinator/` (committed), never only in chat or /tmp | "i mean your coordinator context...shouldnt that be in a single spot? … that seems to be a problem. the context should be already stored mid transit :))" (operator, 2026-08-29, portal c1 session; applied: interview draft = `coordinator/init-draft.json`, loudly non-binding, deleted by the initiation commit, never read by any run) | [init-draft.json](init-draft.json) |
| D-8 | Board `lane_cap` = 11 confirmed at initiation (closes the "drafted" flag) | "cap 11 ok" (operator, 2026-09-03T21:40:25Z, in the 🧭 COORDINATOR 4 portal chat, replying to the flag "lane_cap 11 was drafted, not your word") | [XYZ-1827](https://linear.app/synchronicity/issue/XYZ-1827) comment, [INIT-2026-09-03.md](../docs/coordinator/INIT-2026-09-03.md) |

## Archive

None yet. A superseded ruling moves here with `supersedes:` / `superseded-by:` ids, then drops out
of the loaded bundle at the next weekly pass.
