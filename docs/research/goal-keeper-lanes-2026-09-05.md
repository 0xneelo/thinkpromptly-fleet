# Goal-keeper seat — lane plan (2026-09-05)

Operator decision (09-05): a designated `🥅 GOAL-KEEPER <N>` desktop seat. Contract and evidence:
[goal-keeper-gap-analysis-2026-09-05.md](goal-keeper-gap-analysis-2026-09-05.md) (§Verdict amended).
Suggested ledger goal for every pack: `Goal: G1 — never lose an operator goal again` (remote-system
has no ledger yet; the orchestrator runs `/adhd-goals` once, then `goals.py add`).

Sources the seat needs live in `~/.claude` (not a repo). They are vendored on this branch under
`mac/claude-home/` (skills/adhd-goals, session-kind). Workers patch the vendored copies; the operator
syncs with `mac/install-claude-home.sh` (Lane 2 writes it). Alternative fast path: a Mac-local worker
edits `~/.claude` directly — orchestrator/operator call.

## Contract every lane obeys

- Ledger `docs/operator-goals/ledger.json` per repo. Only the goal-keeper seat writes it, only through
  `goals.py`. Everyone else reads it or files an intent.
- Intents: `docs/operator-goals/inbox/<ISO-ts>-<source>-<op>.json`, create-only (`wx`), never edited.
  `source: operator|seat`. Operator intents may `add/status/due/park/drop/done`. Seat intents may
  only `attach` a task or add `evidence`.
- Derived files, never hand-edited: `sweep.json`, `goals-brief.md` (≤10 lines, flagged goals only),
  `sweep-state.json`, `digest.md`.
- Flags: `late` (due < today, not done) · `stalled` (>24 h no task movement) · `orphaned` (active,
  no live lane/worker/seat on any task, not parked) · `done-candidate` (every task Done or
  done-verified). **Never set `done` from git or Linear** (lowcap ruling, decisions-effective.md:54:
  production evidence, never a SHA). `dropped` = operator cancellation only.
- Goal-keeper never messages a seat. Seats never write the ledger. Goal-keeper reads
  `coordinator/board.json` read-only. Lane cadence (`next_report_due`) ≠ goal `due`.

## Lanes

### L1 · ledger write path — `backend-developer`
Files: `mac/claude-home/skills/adhd-goals/{goals.py,REFERENCE.md,SKILL.md}` + `tests/`.
- `goals.py`: `fcntl` lock on `ledger.lock` around every read-modify-write; atomic replace.
- Fields: `due` (YYYY-MM-DD, optional), `started`; `list`/`render`/`check` show `late`.
- Intent mode: when the session mark is not `🥅 GOAL-KEEPER` (read `~/.claude/session-kind/marks/`
  by sha1(cwd), same as guard.js) or `--intent` is passed, `add/status/health/due/attach` write an
  intent file instead of the ledger. New `apply`: ingest inbox → ledger per the source rules →
  move to `inbox/archive/`. Idempotent.
- Docs: REFERENCE.md:26 ("allowed in every seat") → intents; SKILL.md standing rules → seats file
  intents, goal-keeper applies. Note for operator: `~/.claude/skills/local-orchestrator/SKILL.md:136`
  ("goals.py add same turn") keeps working — it now files an intent.
Accept: race test (two writers, no lost update, no torn JSON); a non-goal-keeper `add` never touches
`ledger.json`; `apply` twice = same ledger; `check` flags a past `due`.

### L2 · session kind 🥅 — `tooling-engineer`
Files: `mac/claude-home/session-kind/{mark.sh,guard.js,census.py,README.md}`, `mac/install-claude-home.sh`.
- `mark.sh --goal-keeper [topic]` → badge `🥅 GOAL-KEEPER <N>`, same number pool.
- `guard.js` kind `goal-keeper`: deny builder subagents; deny Edit/Write outside
  `/docs/operator-goals/` and the scratchpad; deny `SendMessage`; deny Skill
  `introduce-goal|notify|fleetdeck-message-bus`; deny Bash matching
  `fleet-message\.js|fleet-notify\.js|/notify`. Allow CronCreate.
- All other kinds: deny Edit/Write to `docs/operator-goals/ledger.json` and `sweep.json`
  (the `/docs/` allowlist exempts them today, guard.js:326-333). Inbox writes stay allowed.
- `census.py`: 🥅 bucket in the summary line. README: the new kind.
- `mac/install-claude-home.sh`: operator-only; rsync `mac/claude-home/skills/*` → `~/.claude/skills/`,
  `session-kind/*` → `~/.claude/session-kind/`, exclude `marks/`, `numbers.db`; backup first.
Accept: unit test feeding fake PreToolUse payloads to guard.js for each rule above, both kinds.

### L3 · `/goal-keeper` skill — `prompt-engineer`
Files: `mac/claude-home/skills/goal-keeper/SKILL.md`, `references/anchor-check.md`.
Model on `~/.claude/skills/desktop-researcher/SKILL.md` (structure: kinds table, stamp, rename line,
contract, fan-out, exit hatch, anti-patterns, checklist).
- Boot ritual: `goals.py apply` → `sweep.py` → `goals.py list` → restate flagged goals → arm
  CronCreate hourly (`7 * * * *`) with prompt "run the sweep, digest on change"; note the 7-day
  auto-expiry and re-arm at boot.
- Anchor check: input = pasted ask; extract refs (G<n>, L<n>, XYZ-####, D-<n>, branch/sha, "you asked");
  verify each against ledger, board, decisions-effective.md, Linear (MCP), git, inbox; verdict per
  claim ANCHORED / DRIFTED / UNANCHORED; last line: which open goal it serves, or "none — your call".
- Digest rules: only on flag change, ≤1 per hour, in-chat; `PushNotification` when the operator is
  away. One line per goal: id · flag · due · last movement · one question.
- Hard nevers: no builders, no source, no messages to seats, no lanes/decisions/northstar, never
  `done` from git, never invent a goal (no operator words → not a goal).
Depends on L1 CLI names and L4 file names (write against this plan; adjust at review).

### L4 · sweep — `backend-developer`
Files: `mac/claude-home/skills/adhd-goals/sweep.py` + `tests/fixtures/`.
- Inputs: ledger; `coordinator/board.json` + `coordinator/exceptions.py` output if present; git per
  task lane (branch exists, tip date, `merge-base --is-ancestor` main); Linear GraphQL via
  `LINEAR_API_KEY` if set (state, completedAt, dueDate) else ⚠ skip; desktop liveness from
  `~/.claude/sessions/*.json` (pid alive, same check as server.js desktopSessions); optional
  fleetdeck `GET /api/sessions` for box workers.
- Outputs: `sweep.json`, `goals-brief.md`, `sweep-state.json`, `digest.md` (only when flags changed).
Accept: fixture ledger+board → expected flags; no network → still runs with ⚠ lines; never writes
`ledger.json`.

### L5 · hooks: brief injection — `tooling-engineer`
Files: `mac/claude-home/hooks/goals-brief.sh`, `mac/claude-home/settings-hooks.json`, install merge.
- SessionStart + UserPromptSubmit: print `docs/operator-goals/goals-brief.md` of the cwd repo when the
  session mark is 🎛 or 🧭 and the file exists; ≤10 lines; silent otherwise.
- Install: merge the two hook entries into `~/.claude/settings.json` (backup, idempotent).
Depends on L4 file name only.

### L6 · deck goals page — `fullstack-developer`
Files: `goals-api.js`, `public/goals.html`, `public/index.html` (nav button), `goals-projects.json`,
`test/goals-api.test.js`. Pure remote-system, no `~/.claude`.
- `GET /api/goals?project=<name>` → ledger + sweep.json from `goals-projects.json`
  (`{ "lowcap-connector": "/abs/path/docs/operator-goals", ... }`).
- `POST /api/goals/intent` → one inbox file, `wx`, `source: operator`. Write surface = inbox only
  (same rule as the portal API: never board, never ledger).
- `goals.html`: per-project list with flags and buttons today/park/drop/done → POST intent.
Accept: tests for GET shape, POST creates one file and refuses overwrite, unknown project → 404.

## Waves

Wave 1 (parallel): L1, L2, L4, L6. Wave 2: L3, L5. Review each with `reviewer`; L1/L2 with `hunter`.

## Not lanes — hand to the lowcap 🧭 coordinator via the operator

- Add `goal: G<n>` to all 11 board lanes (0 of 11 link today).
- Add XYZ-2050 as a goal with `due 2026-09-06` (in no ledger goal today).
- G2/G15 both carry XYZ-1936 with contradictory state.
- `lowcap-connector/coordinator/README.md:8` still says "NOT a live instance".
