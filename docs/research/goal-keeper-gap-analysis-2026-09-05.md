# Goal-keeper: gap analysis (2026-09-05)

Question: the operator proposed a new seat "goal-keeper" that only tracks operator goals.
Fear: "we just have another coordinator". Research: 10 session-pack readers (7 days,
lowcap-connector + remote-system), 7 doc readers, 1 Linear probe, 2 GPT hunters (overlap, gap).

## Verdict

**Operator decision 2026-09-05: a designated `🥅 GOAL-KEEPER <N>` seat.** Reason: a clean-context
session is the only thing that can run the anchor check (verify an orchestrator's ask against files it
cannot fake). The seat is narrow by contract: goals, due dates, lateness, the anchor check; never
lanes, decisions, northstar, steering, or messages to seats. Lane plan:
[goal-keeper-lanes-2026-09-05.md](goal-keeper-lanes-2026-09-05.md).

Research verdict before that decision: build the goal-keeper as a run, not a role. Kept below as evidence.

The coordinator already owns goal tracking by design and by operator ruling:

- DESIGN-v1.md:58 — coordinator "owns the Goal Board and the intent/decision ledger; runs the
  reconciliation loop that keeps them honest."
- Operator, 08-28 22:33 — "the coordinator should track the operator's tasks and over-arching
  goals, while orchestrators manage the subtasks."
- Lowcap 🧭 COORDINATOR 7 seeded `docs/operator-goals/ledger.json` (15 goals, 09-05); 🧭 9 republishes it.
- R1 (08-29): "only one coordinator per project."

A seat with the charter "track goals, talk only to the operator" is a second coordinator.
Both hunters: a second seat compounds the two reproduced write races (goals.py:58/138,
board_lib.py:46/60) and adds a third "ask me what's happening" window (orchestrator ledger
restatement, portal, goal-keeper).

## What the operator is missing (all proven absent)

| # | Gap | Evidence | Smallest fill |
|---|---|---|---|
| 1 | Nobody looks unless asked | all 10 pack readers: every goal-status answer in 7 days was operator-initiated; "next coordinator run 21:33Z, manual, I run it" | hourly timer (D-4 ruled it, never built) |
| 2 | No due / late on goals | goals.py:27 has no `due`; D-45 "done by tomorrow" and D-15 "done this week or cancelled" live only as prose; XYZ-2050 (due 09-06) is in no ledger goal | `due` field + computed `late` |
| 3 | No single writer | REFERENCE.md:26 "allowed in every seat"; orchestrator SKILL:136 and coordinator both write; goals.py has no lock; two 🧭 7 forks collided on 09-05 | one locked mutation path + guard.js deny + intents inbox |
| 4 | No machine movement signal | board evidence is free text; fleetdeck-train.js persists nothing; reconcile reads claims, not git/Linear | sweep reads git tips, Linear `completedAt`/`dueDate`, board `exceptions.py` |
| 5 | No proactive nudge | Telegram escalation D-2/D-41 unbuilt; portal lists "dead-man cron" as not built; operator-handoff notify is opt-in per call | deduped hourly digest to the operator only |
| 6 | No per-project deck page | coordinator-api.js:21 fixed to one board dir (seam 8, XYZ-1890); no goals route | `/goals?project=` reading ledger + sweep.json |

Operator's own pain, 09-05 01:09: "I don't even know anymore what other goals we had… we're
missing that skill that actually pushes orchestrator and coordinator to think about these goals."

## Hard constraints found

- **Never mark done from git.** Lowcap decisions-effective.md:54 (XYZ-2050): completion means
  "runs on production with counts and timestamps, never a commit SHA." Git and Linear feed
  `moving` and `done-candidate` only; `done` stays operator/attestation-driven.
- `dropped` = intentional operator cancellation (REFERENCE.md:20). Accidental abandonment needs
  its own flag (`orphaned`), never `dropped`.
- Coordinator lane cadence (`next_report_due`) ≠ goal deadline. Keep the two clocks separate.
- Linear is an evidence feed, not the goal database: zero initiatives, milestones, cycles;
  92% of recent issues unprojected; any worker can flip Done.
- CronCreate is session-only (dies with the desktop session, 7-day cap) — a desktop seat
  cannot be the reliable hourly clock.

## Design: the goal-keeper run

Object: `docs/operator-goals/ledger.json` per repo (exists in lowcap). Add `due`, `started`.
Board lanes get `goal: G<n>` refs (coordinator writes its own file; today 0 of 11 lanes link).

1. **Sole writer = the run.** `goals.py` gets one locked, atomic mutation path. Interactive
   seats calling `add/status/due/attach` write an intent file to `docs/operator-goals/inbox/`
   (never overwrite, one file per intent, `source: operator|seat`). Only the run applies.
   Status/due/drop intents apply only when `source: operator`; seat intents may only attach
   tasks and evidence. guard.js denies Edit/Write on `ledger.json` for every kind.
   Update REFERENCE.md:26, adhd-goals SKILL boot rule, local-orchestrator SKILL:136.
2. **Sweep, hourly, deterministic** (`sweep.py` under a LaunchAgent with `StartInterval 3600`,
   gui domain, same pattern as `mac/com.fleetdeck.train.plist`; or a second `setInterval` in
   server.js). Inputs: ledger, board.json, `exceptions.py`, git branch tips, Linear
   state/completedAt/dueDate, desktop session liveness. Output: `docs/operator-goals/sweep.json`
   (derived, never hand-edited) with per-goal flags `late`, `stalled` (>24 h no task movement),
   `orphaned` (active, no live lane/worker/seat, not parked), `done-candidate`.
3. **Nudge on flag change only.** Dedupe by goal+flag (SURFACES-v2 incident rule). One digest
   per hour max, to the operator only: PushNotification (proven from sessions), deck notify to
   the seat the operator names, and the deck goals page. Never to another seat.
4. **Answer path.** `/adhd-goals due|park|drop|done G<n>` in any session → intent; or buttons on
   the deck page → `POST /api/goals/intent` → inbox file. Write surface = inbox only, same rule
   as the portal API.
5. **Deck page** `/goals?project=<repo>` from a small `{project → ledger path}` config.
6. **Optional daily proposer** (D-4 cheap disposable `claude -p`): reads sweep.json + newest
   inbox + scan.py packs, files candidate goals/attachments as `needs-operator` intents.
   Replaces the manual `/adhd-goals` rebuild the coordinator runs today.

Separation: separate object (goals, not lanes), separate writer (the run), separate channel
(operator only), no chat seat, reads board.json read-only. That is the "highly separated"
requirement without a second coordinator.

## Defects found on the way (not goal-keeper scope)

- P1 goals.py:58/138 unlocked read-modify-write; P1 board_lib.py:46/60 lost updates.
- P1 fleetdeck-train.js:99/218 ending a train does not cancel a pending start.
- P2 check.py:160 `done-verified` accepts `evidence=[""]`.
- P2 lowcap coordinator/README.md:8 still says "NOT a live instance" on the live instance.
- P2 ledger G2/G15 both carry XYZ-1936 with contradictory state.
