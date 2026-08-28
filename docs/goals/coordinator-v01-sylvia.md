# GOAL — Coordinator v0.1 (XYZ-1827) — fleet-repo port

You are **Sylvia, a tooling-engineer**. Tag: `agent-sylvia`. Report on Linear issue **XYZ-1827**,
signed as Sylvia. Repo: `thinkpromptly-fleet` (operator placement ruling 2026-08-28 — the role is
fleet-level; the original lowcap packaging is superseded, see `docs/coordinator/IMPORTED.md`).
Base your branch on `claude/xyz-1742-fleet-orgchart-c2b616` (the woven tip: lifecycle backend,
hooks, org chart); work on `agent-sylvia`; push when green.

## Read first (in this order, nothing else required)

1. `docs/coordinator/DESIGN-v1.md` — the binding design. §0 TL;DR, §2 charter, §2a portal,
   §3 wire spec, §4 board spec, §7 rollout (you are building v0.1), §9 operator rulings.
2. `docs/coordinator/oracle-verdict.md` §2–§4 only if a design point is ambiguous.
   The rest of the research corpus lives in lowcap-connector and is background; do not load it.

## What you build (v0.1, four deliverables)

### 1. `coordinator/` state dir (repo root)

- `board.json` — canonical state. Shape it from DESIGN §4: top-level `northstar` (text +
  `ruling_id` + `confirmed_at`), `lanes` (array, **hard cap 6** — reject more), each lane:
  `id, goal, done_milestone, owner, state, blockers (full list), next_decision, reported_at,
  verified_at, evidence, next_report_due`. State enum exactly:
  `active | blocked | done-claimed | done-verified | DISPUTED | UNKNOWN | closed`.
- Seed lanes as `state: "UNKNOWN"` with `goal` drafted from BOTH seed sources, every seed marked
  `"seed": "PROPOSED"`: (a) `docs/coordinator/HANDOFF-2026-08-28-o30-to-o31.md` (lowcap lanes),
  (b) this repo's live fleet lanes — XYZ-1742 with sub-lanes XYZ-1818/1819/1820 (done-claimed)
  and XYZ-1827 (this build). Respect the cap 6: prefer one rolled-up lane per project if needed.
  Seeds become real only when the operator confirms (intent is operator-only, DESIGN §2).
- `northstar.md` — skeleton: one-sentence slot, ruling-ID slot, confirmed-at slot. Do NOT invent
  the northstar text; leave a `PROPOSED:` draft line and flag it for the operator.
- `decisions-effective.md` — skeleton table `id | one line | verbatim link`. Seed with at most 5
  obviously-standing operator rulings, each **quoted verbatim with a link to its source file**
  (memory file or Linear). Never paraphrase — DESIGN §2 hard-never.
- `inbox/` — with `README.md` describing the sitrep drop format (one file per event, filename
  `<ISO-time>-<seat>-<lane>.md`, fields per DESIGN §3).
- `coordinator/check.py` — stdlib-only validator: schema of `board.json`, lane cap, state enum,
  `next_report_due` present on every non-closed lane. Exit non-zero on violation.

### 2. Run-procedure skill — `.claude/skills/coordinator-run/SKILL.md`

Project-scoped so it ships with every checkout. The procedure (DESIGN §2 Form, §3):
boot from the bundle (`board.json` + `northstar.md` + `decisions-effective.md`; the skill runs the
size gate first — if the bundle exceeds **2k tokens ≈ 8KB**, STOP and open a compaction exception
instead of proceeding) → drain `inbox/` oldest-first applying the ordering rule (apply only if
`event_time` newer than lane's last AND seat is registered owner; else move to `inbox/archive/` and
flag) → update `board.json` → run `coordinator/check.py` → **exactly one commit** → write exception
items if any → terminate. Malformed sitreps bounce to `inbox/rejected/` with a one-line reason —
never best-effort parsed.

### 3. Portal skill — `.claude/skills/coordinator-portal/SKILL.md`

Primes a 🧭 COORDINATOR portal session per DESIGN §2a. Must encode the three disposability rules:
fresh-read of `board.json` + `decisions-effective.md` on every operator question; intents go
Linear-ID-at-acceptance → `inbox/` → run procedure, never chat memory; rotate freely, boot bundle
is the handoff. Plus the inherited hard nevers (§2a list) and the session-title convention
(`🧭 COORDINATOR <N> · <topic>`, number from the shared pool via
`python3 ~/.claude/session-kind/number.py claim`).

### 4. Boot-gate hook — `coordinator/hooks/boot-gate.py` + `coordinator/hooks/README.md`

Operator ruling §9.2: HARD gate. A PreToolUse-style hook script (stdlib python) that, for sessions
marked as orchestrator seats, denies non-read tool use until a marker file
(`coordinator/.seat-ack/<seat-id>`) exists — created by the seat restating lane ownership (the run
skill or portal writes it after the seat posts its restatement sitrep to `inbox/`). Deliver the
script + a README with the exact `settings.json` hook stanza to arm it. **Do not arm it yourself**
— Mac-side install is an operator step (session-kind hooks are operator-owned).

## Boundaries (hard)

- Touch ONLY: `coordinator/`, `.claude/skills/coordinator-run/`, `.claude/skills/coordinator-portal/`,
  `docs/coordinator/`, `docs/goals/` (this file's checkbox status), and nothing else. No service
  code, no `server.js`, no `public/`, no `box/hooks/`, no migrations, no deploy scripts.
- v0.2 is OUT: no `board.html` renderer, no fleetdeck push, no Telegram bot, no dead-man cron.
- Out-of-scope discoveries → a Linear issue, never a scope expansion (worker doctrine).

## Acceptance (prove each on the issue)

1. `python3 coordinator/check.py` passes on your seeded `board.json`; fails on a 7th lane and on a
   bad state enum (show both).
2. A sample sitrep dropped in `inbox/` is applied end-to-end by the run procedure in a fresh cheap
   session: one commit, board updated, inbox drained. Paste the commit subject.
3. A stale sitrep (older `event_time`) and a wrong-owner sitrep both land in `inbox/archive/`
   flagged, not applied.
4. Boot-bundle size gate demonstrably trips (pad a file past 8KB, show the stop).
5. `boot-gate.py` unit-run: denies before marker, allows after.
6. Worktree clean, branch `agent-sylvia` pushed, report on XYZ-1827 signed Sylvia.
