# Coordinator board schema — v0.2 additions

What v0.2 adds to the DESIGN-v1 §4 board spec, and the contracts other modules rely on.
The code is the authority; `coordinator/board_lib.py` holds every shared primitive.

## 1. Board additions

| Key | Where | Meaning |
|---|---|---|
| `policy` | top level, optional | `default_cadence_hours`, `unattested_done_days`, `queue_item_days` — positive ints. Missing keys fall back to `board_lib.DEFAULT_POLICY`; an unknown key fails the validator. |
| `exceptions` | top level, written by `exceptions.py --apply` | the computed exception list (below). Derived, never hand-edited. |
| `opened_at` | each `operator_queue` item | ISO, non-null. When the item started waiting. |
| `deadline` | each `operator_queue` item | ISO, non-null. `opened_at` + the cadence unless the operator set one. |

A null clock is how an item goes quiet: with no `opened_at` there is no age, with no age
there is no exception, and a silent board reads as a healthy one. `exceptions.ensure_deadlines`
fills a missing `deadline` and a missing lane `next_report_due`, so nothing stays unaged.

### The lane cap — R3 abolished the hard cap

**Operator ruling R3, 2026-08-29 (verbatim):** *"there is no point in having a limit or amount
of lanes, the amount of lanes is dependent on the project and will be defined during
initiation."* DESIGN-v1 §4's **"Lanes — hard cap 6" is overridden**. `check.py` no longer
carries a `HARD_LANE_CAP` constant. The only cap is the board's own `lane_cap` (an int >= 1,
written by the initiation ritual), and the failure message names that number.

## 2. The exception record

```json
{"id": "EX-overdue-lane-L1", "kind": "overdue-lane", "subject": "L1",
 "since": "2026-08-29T09:00:00Z", "age_seconds": 10800, "age": "3h",
 "detail": "lane L1 (owner UNASSIGNED …) is 3h past its next_report_due"}
```

`id` is `EX-<kind>-<subject>` and is **stable across runs**: M4 diffs ids between runs to
detect a transition, so an id may never carry an age or a timestamp.

| kind | raised when | `subject` | `since` |
|---|---|---|---|
| `overdue-lane` | `now > next_report_due`, state not in `board_lib.DEADMAN_EXEMPT` | lane id | `next_report_due` |
| `unattested-done` | `done-claimed`, `reported_at` older than `unattested_done_days`, `verified_at` null | lane id | `reported_at` |
| `stale-queue-item` | `opened_at` older than `queue_item_days` | queue item id | `opened_at` |
| `disputed-lane` | `state == "DISPUTED"` | lane id | `reported_at` |

Sorted by that kind order, then by `age_seconds` descending (oldest first). A subject whose
`since` is absent or unparseable yields **no** exception — you cannot age what has no clock.

**Dead-man:** `apply_deadman` flips a lapsed lane to `UNKNOWN` in place. `closed` and
`DISPUTED` are exempt: a closed lane owes nothing, and a DISPUTED lane is already an
exception the operator has to rule on.

## 3. The compacted boot bundle

`bundle.build(board, now, board_path)` is what a booting seat reads. The raw concatenation of
`board.json` + `northstar.md` + `decisions-effective.md` was at 87% of the 8192-byte gate with
four lanes, so compaction is a dependency of M1 and M3, not cleanup after them.

Sections are **fixed spatial slots and never reorder** (DESIGN §4):

1. `NORTHSTAR` — sentence, ruling id, confirmed date. Three lines. `northstar.md` is never inlined.
2. `EXCEPTIONS` — every exception in full, one line each. **Never summarised**: this is the point of the bundle.
3. `LANES` — full render (all board-spec columns) for a lane that carries an exception or is `active` / `blocked` / `DISPUTED`; one summary line for every other lane. A `goal` or `done_milestone` is never truncated mid-sentence — half a milestone is worse than a referenced one.
4. `OPERATOR QUEUE` — id, item, age, deadline. One line each.
5. `EFFECTIVE DECISIONS` — a reference line only: the count plus `effective_decisions_ref`. The 2362-byte table is the single biggest lever, and a seat can open it when a decision is in play.
6. Footer — the byte size and the headroom against the gate.

`check.py` gates **this** payload, not the raw file sum: FAIL over 8192 bytes, WARN at 90%.
The OK line reports both sizes so the compaction win stays visible.

## 4. The runlog artefact contract

The recorded gap (`coordinator/inbox/archive/PORTED-FROM-LOWCAP.md` #1): a lowcap run reported
"1 applied" and left no artefact, so the claim could not be falsified. v0.1 *deletes* an applied
sitrep, which is exactly how that happened.

**v0.2 rule: an applied sitrep MUST leave an archive artefact, and run counters MUST be
derivable from the artefacts alone.**

| disposition | lands in |
|---|---|
| `applied` | `coordinator/inbox/archive/applied/` |
| `archived` | `coordinator/inbox/archive/` |
| `rejected` | `coordinator/inbox/rejected/` |

Every move writes a sidecar `<same-name>.provenance.json` beside the artefact:
`{disposition, run, lane, seat, event_time, reason, archived_at, sha256}`. The `sha256` is of
the sitrep bytes, so a later silent edit of an artefact is detectable. An existing destination
is **refused, never overwritten** — an overwritten artefact is the same unfalsifiable claim.

- `runlog.py counters --run <ISO>` reads **only** the sidecars. A file with no sidecar moves no counter.
- `runlog.py verify --run <ISO> --applied n --archived n --rejected n` exits 1 when a claim
  exceeds what the artefacts support. That is what makes "1 applied with no artefact"
  impossible to commit.

## 5. Modules

| File | Role |
|---|---|
| `coordinator/board_lib.py` | shared contract: board IO, time, ages, policy, the milestone rule |
| `coordinator/exceptions.py` | `compute` · `apply_deadman` · `ensure_deadlines` (M1) |
| `coordinator/bundle.py` | `build` · `gate_report` (M5) |
| `coordinator/runlog.py` | `archive` · `counters` · `verify` |
| `coordinator/check.py` | the validator, plus `--selftest` covering all of the above |

## `schema_version`

v0.2 is **`schema_version: 2`**. The bump is real, not cosmetic: a v2 board carries
`policy`, may carry a top-level `exceptions` list, and every `operator_queue` item carries
`opened_at` and `deadline`. `init_board.py` writes 2, and the live board was moved to 2 when
it gained those keys.

`check.py` validates the shape rather than the number, so a v1 board that has since gained
the v2 keys still passes — but the number should track the shape, or the next reader has to
guess which one is lying.
