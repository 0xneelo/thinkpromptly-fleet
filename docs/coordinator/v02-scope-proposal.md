# Coordinator v0.2 — scope proposal

**RESEARCHER 8 · 2026-08-28.** Written at the operator's request ("lets update the plan for
v0.2 — I will make sure it gets built tomorrow"). Input, not authority: the operator rules
and an orchestrator cuts the pack.

> **RE-HOMED 2026-08-29 — read this first.** The canonical coordinator is the
> **`thinkpromptly-fleet` repo** (operator placement ruling 2026-08-28), merged to its main
> at `652f55f` and running behind the live deck. **v0.2 must be built there, not in
> lowcap-connector.** Every path below refers to the fleet checkout. The lowcap
> `agent-sylvia` line is **superseded** for v0.1; the design + research corpus legitimately
> stays in lowcap (`claude/coordinator-role-design-49d5d9`, provenance recorded fleet-side in
> `docs/coordinator/IMPORTED.md`) as reference, not as a build target. Deltas get **ported**,
> never given a second home.

Baseline: v0.1 is built, acceptance-tested and **deployed in the fleet repo**; the boot gate
ships **unarmed** (arming is operator-owned) and `board.json` seeds remain **PROPOSED**
pending the operator's `OQ-2` answer. v0.2's existing list (DESIGN-v1 §7 + the v0.1 goal
pack) is: `board.html` renderer on fleetdeck, Telegram accept-button bot, dead-man deadlines
+ `UNKNOWN`, readers.

## The governing question

v0.1 **captures** truth. v0.2 must **deliver** it. Judge every item by one test:

> Does this make the operator realize something **without having to ask?**

Evidence that this is the right test: `OQ-2` sat in the operator queue from the build until
they learned of it from a researcher; and their actual realization mechanism this week was
asking the same suspicious question four times ("is it built", "is this done", "is this all
cleared", "is that fixed"). v0.1 would not have changed either.

## The sequencing insight — build the event source before the notifier

The existing v0.2 list is mostly **surfaces** (renderer, bot). But **v0.1 emits no event that
means "you should look."** A notifier wired to a board with no exception concept can only
send heartbeats, which are noise, which get muted — and a muted channel is worse than none.

So v0.2 splits in two layers, in this order:

1. **Event source** — compute exceptions. Makes silence visible.
2. **Surfaces** — render them (glance) and push them (tap on the shoulder).

## M1 — Make silence visible (the load-bearing milestone)

Everything here is arithmetic over the existing schema. No new state.

- **Deadlines stop being null.** Every `operator_queue` item gets a deadline — an explicit one
  or a default cadence. Every lane's `next_report_due` is enforced rather than decorative.
- **Age is computed**, not eyeballed: for each lane, `now − reported_at`, `now − verified_at`,
  and `now − next_report_due`; for each queue item, `now − opened_at`.
- **Dead-man:** a lane past `next_report_due` flips to `UNKNOWN` automatically. Silence must
  change the board by itself, or silence reads as health.
- **An `exceptions` list** becomes a first-class output — machine-readable, four kinds:
  overdue lane · `done-claimed` older than N days with no attestation · operator-queue item
  older than N days · `DISPUTED`.
- **Validator gains the capability-shaped rule** (operator-agreed today): `done_milestone`
  must name something observable in production. `done-claimed` vs `done-verified` only has
  teeth if the milestone is checkable.

**Acceptance:** on a seeded board with one stale lane and one aged queue item, the exceptions
list names exactly those two, with ages; on a fresh board it is empty. A lane whose
`done_milestone` is unverifiable prose is rejected by the validator with the reason.

## M2 — The reconciliation reader

DESIGN-v1 §4e calls this "the role's actual justification for existing", and v0.1 shipped
"no readers yet". A cheap read-only reader checks each lane's top claim against its evidence
link; a mismatch opens `DISPUTED` with the quote that contradicts it.

This is the pass that would have caught both of this week's failures: XYZ-1484 (Done, but
nothing scheduled the system) and XYZ-1559 (Done 08-26, defect alive on 08-28 in a second
binary).

**Acceptance:** a lane claiming done against a link that does not support it opens `DISPUTED`
carrying the contradicting quote; a well-evidenced lane is left untouched.

## M3 — The glance surface: `board.html` on fleetdeck

**Highest daily value for this operator specifically** — higher than the bot. Fleetdeck is
already a dashboard they look at, so this converts "ask a question" into "notice in passing".

- Static file derived from `board.json`. One screen, fixed spatial slots, rows never reshuffle
  (DESIGN §4).
- `done-claimed` and `done-verified` rendered **differently**, never collapsed.
- Staleness dimming, now that M1 computes age.
- **M1's exceptions pinned at the top**, and `operator_queue` prominent with ages — the two
  things the operator is there to see.

**Acceptance:** renders the seeded board; a 4-day-stale lane is visually distinct from a fresh
one at a glance; opens in fleetdeck without a server.

## M4 — Push: notify path only

- Telegram **notify on exception transitions** — a *new* exception, never a heartbeat.
- **No buttons yet** (DESIGN §9.3 sequences notify first, button-ack second).
- Digest/rate-limit so a bad day cannot produce a flood. A channel that gets muted has
  negative value.

**Acceptance:** a lane going overdue produces exactly one message; a quiet board produces
none; ten simultaneous exceptions produce one digest, not ten messages.

## M5 — Boot bundle compaction (schedule it EARLY, not last)

**Measured on the live fleet board 2026-08-29 (O17): the boot bundle is already at 87% of its
8 KB gate with only 4 lanes.** The gate is not advisory — it has already stopped a run once
(`c168d7d4`: "boot bundle 8768B over 8192B, run stopped before boot"). So the compaction
exception will trip early in v0.2's life, and it will trip **at boot**, which is the worst
possible moment: the gate's whole job is to stand between a seat and unowned work.

Two independent pressures push it over:
- **Lanes.** Every lane the operator confirms adds bundle. Seating a 5th and 6th lane — which
  `OQ-2` is precisely about — is enough to cross it.
- **v0.2 itself.** M1's exceptions and computed ages are new material that must reach a
  booting seat, or they inform nobody.

**Therefore:** compaction is a *dependency* of M1 and M3, not a cleanup task after them.
Shape (design's own escape hatch): the bundle carries a **compacted view** — exceptions and
owned lanes in full, everything else summarised or referenced — rather than the whole board.

**Acceptance:** with six confirmed lanes plus a populated exceptions list, the bundle is
under the gate with headroom stated as a number; the gate still trips on a genuinely
oversized bundle (the self-test must keep passing).

## Explicitly OUT of v0.2

Button-ack (v0.3) · autonomous northstar rewrites · task tracking of any kind · worker
routing · %-complete or utilization metrics (Goodhart, DESIGN §6) · anything that puts the
coordinator on a critical path.

## Two operator-only steps this plan assumes

1. **Arm the boot gate** — built and verified in v0.1, deliberately unarmed; installing it is
   operator-owned.
2. **Answer `OQ-2`** — confirm the six lanes. Recommended: make pools one of them, phrased as
   the capability *found → added → picked → corrected, running in production*.

## Honest risk

The whole plan assumes lanes are kept current. Nothing here forces a seat to report; the boot
gate is what does that, and it is unarmed. **If the gate stays unarmed, M1's dead-man will
mostly report that nobody is reporting** — technically correct, operationally useless. Arm the
gate in the same change, or M1 measures an empty room.
