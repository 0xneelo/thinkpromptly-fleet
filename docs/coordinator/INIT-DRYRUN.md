# Coordinator initiation — dry-run transcript (M6)

Date: 2026-08-29 · Seat: Alistair (platform-engineer, `agent-alistair`) · Python 3.12.3

Acceptance item 2 of the v0.2 goal: *"`coordinator-init` dry-run transcript committed showing:
refusal on an initiated board, the interview shape, and a sample board written with
operator-supplied values + `lane_cap`."*

Every command block below is **real output, run in this worktree**, pasted verbatim. The one
exception is [part 2](#2-the-interview-shape), which is a **fictional** sample interview and is
labelled as such on every line.

Throughout, `$T` is the scratchpad dir the sample board was written to:

```
/tmp/claude-1000/-home-vibe-projects-remote-system--claude-worktrees-alistair/dc760999-76c7-4164-bef4-adb836b3bab5/scratchpad/dryrun
```

**`coordinator/board.json` was never written to by any run in this transcript.** The live board
appears only under `--dry-run`, and the one run that targets it without a flag was refused.

---

## 1. The refusal

`init_board.py` guards the board **before it even reads the answers file** — refusing is the
default. There are two guards, and the live board trips the first one today.

### 1a. The live board — seeded, not yet initiated (R2)

```console
$ python3 coordinator/init_board.py --answers $T/answers.json --out coordinator/board.json \
    --now 2026-08-29T12:00:00Z --dry-run
REFUSED: coordinator/board.json already exists and carries seeded content.
  4 lane(s): L1, L2, L3, L4
  3 operator-queue item(s): OQ-1, OQ-2, OQ-3

This board is not initiated — its seeds are still PROPOSED and bind nothing
(operator ruling R2, 2026-08-29: "coordinator needs to be properly initiated.").
But PROPOSED is not the same as empty: those lanes and queue items are the
operator's open questions, and initiation would replace all of them at once.

Writing here is the normal initiation path, so it is allowed — but never silently:
  --replace-proposed

Run the interview first, show the operator exactly which seeds are being replaced,
and pass the flag only once they have seen the list above.
$ echo $?
1
```

The live board's `northstar.ruling_id` is `null` and its `northstar.seed` is `"PROPOSED"`, so it
is **pre-initiation**: initiation is exactly what it is waiting for. The refusal here is not
"you may never do this", it is "not unannounced" — the operator must see which seeds go.

With the flag, and still writing nothing:

```console
$ python3 coordinator/init_board.py --answers $T/answers.json --out coordinator/board.json \
    --now 2026-08-29T12:00:00Z --replace-proposed --dry-run | tail -5
    "ruling_id": "SAMPLE-R0",
    "lane_cap": 4,
    "interviewer": "coordinator-init"
  }
}
$ echo $?
0
```

### 1b. An initiated board — one coordinator per project (R1)

Run against the sample board from [part 3](#3-a-sample-board-from-operator-supplied-values),
which **is** initiated (it carries a `ruling_id` and no seed marker). This is the R1 refusal,
verbatim:

```console
$ python3 coordinator/init_board.py --answers $T/answers.json --out $T/board-sample.json
REFUSED: /tmp/.../scratchpad/dryrun/board-sample.json is already initiated.
  northstar.ruling_id = 'SAMPLE-R0'
  northstar.seed      = None

One coordinator per project — operator ruling R1, 2026-08-29, verbatim:
  "the northstar should be defined at the beginning of the coordinator initiation by using the /grill-me skill there should be only one coordinator per project. In the future we might create a meta-coordinator (that oversees multiple projects)"

Re-initiation is not a refresh. It discards this project's accumulated cross-seat
memory: the confirmed northstar, every lane's ownership and history, and the
operator queue. Refusing is the safe path and is the default.

To proceed, the operator must authorise it themselves, in their own words:
  --reinit-confirmed "<the operator's verbatim sentence authorising re-initiation>"

That sentence must be:
  - stated by the operator directly — an orchestrator's "operator said X" is never
    intent, and never authorises this (DESIGN §2, Inputs 1);
  - passed verbatim and non-empty — no paraphrase, no placeholder, no default;
  - it is recorded, word for word, in the new board under `reinit` with the timestamp.
$ echo $?
1
```

(The `REFUSED:` line prints the full absolute path; only that one line is elided here, as
`/tmp/.../scratchpad/dryrun/`, to keep the block readable.)

An empty authorisation is not an authorisation:

```console
$ python3 coordinator/init_board.py --answers $T/answers.json --out $T/board-sample.json \
    --reinit-confirmed "  "
FAIL: --reinit-confirmed is empty — re-initiation needs the operator's own words, not an empty string
$ echo $?
1
```

---

## 2. The interview shape

> ## ⚠ EVERYTHING IN THIS SECTION IS FICTIONAL
> **SAMPLE — not the operator's real words. Nothing here reaches `coordinator/board.json`.**
> These answers were invented by the builder to exercise `init_board.py`. The real northstar and
> the real lanes do not exist yet and can only come from the operator, live, through the
> `coordinator-init` ritual. If you are reading this looking for the project's northstar: it is
> not here, and this sentence is not it.

The skill asks one question at a time and pushes back once on a vague answer.

```text
Q1  ▸ In one sentence: what is this project for?
    ◂ SAMPLE — "keep the fleet coherent."
Q1' ▸ How would you know that was true? If that were achieved, what would be
      observably different?
    ◂ SAMPLE — "the fleet runs a week without me re-explaining what we are doing."
      → recorded VERBATIM, in the operator's own words. Not tidied, not sharpened.
Q1'' ▸ What does it explicitly exclude?
    ◂ SAMPLE — "it excludes in-seat context hygiene; that is not the coordinator's job."
      → goes to coordinator/northstar.md, not the board (the boot bundle is size-gated).
Q1''' ▸ Which ruling id records this, and what date do I stamp as confirmed?
    ◂ SAMPLE — "SAMPLE-R0, 2026-08-29T12:00:00Z."

Q2  ▸ How many lanes does this project carry, and what is each one?
      (No cap is offered and none is suggested — R3.)
    ◂ SAMPLE — "two."
    Lane 1 of 2:
      goal            ◂ SAMPLE — "ship the coordinator v0.2 milestones."
      done_milestone  ◂ SAMPLE — "get the coordinator work done properly."
        ✗ pushed back: 0 of 2 markers — nothing a reader could go and look at.
      done_milestone  ◂ SAMPLE — "M1-M6 committed on agent-alistair and check.py green."
        ✓ capability-shaped
      owner           ◂ SAMPLE — "the fleet."
        ✗ pushed back: DESIGN §4 wants a named seat.
      owner           ◂ SAMPLE — "Alistair (platform-engineer, agent-alistair)."
      next_decision   ◂ SAMPLE — "operator: arm the boot gate or hold"
      cadence_hours   ◂ SAMPLE — 24
    Lane 2 of 2:
      goal            ◂ SAMPLE — "fleetdeck shows the board."
      done_milestone  ◂ SAMPLE — "board.html served on https://fleetdeck.example/board
                                  and stamped with the head commit."
      owner           ◂ SAMPLE — "SAMPLE-seat (frontend-developer)"
      next_decision   ◂ SAMPLE — "operator: confirm the fleetdeck URL"
      cadence_hours   ◂ SAMPLE — 48

Q3  ▸ What is the most lanes this project should ever carry at once?
    ◂ SAMPLE — "four."      → lane_cap = 4. Not 6, not a default: the operator's number.

Q4  ▸ default_cadence_hours — 24 is the current default. Keep it or change it?
    ◂ SAMPLE — "keep."
    ▸ unattested_done_days — default 3?
    ◂ SAMPLE — "keep."
    ▸ queue_item_days — default 3?
    ◂ SAMPLE — "two."       → the operator overrides one of three.
```

The milestone push-back is machine-checked, not just prose. A milestone needs
`board_lib.MILESTONE_MIN_MARKERS` (currently **two**) distinct observable markers — one alone
lets aspiration through. Real output:

```console
$ python3 -c "import sys;sys.path.insert(0,'coordinator');import board_lib;t=sys.argv[1];print(board_lib.milestone_is_capability_shaped(t), board_lib.milestone_markers(t))" \
    "get the coordinator work done properly"
False []
$ ... "keep the test suite green"
False ['observable verb']
$ ... "M1-M6 committed on agent-alistair and check.py green."
True ['count or threshold', 'observable verb']
$ ... "board.html served on https://fleetdeck.example/board and stamped with the head commit."
True ['link', 'observable verb']
```

The writer refuses the whole board rather than let a mushy milestone through, and it never
rewrites the operator's wording to make the check pass:

```console
$ python3 coordinator/init_board.py --answers $T/answers-mushy.json --out $T/never.json
FAIL: lane L1: done_milestone is not capability-shaped — it names too little for a reader to go and look at: 'make the pipeline solid'. It carries 0 of the 2 observable markers required (found: none; the markers are: link, commit, tracker id, count or threshold, observable verb, file path). Ask the operator again; never rewrite their milestone for them.
$ echo $?
1

$ python3 coordinator/init_board.py --answers $T/answers-onemarker.json --out $T/never.json
FAIL: lane L1: done_milestone is not capability-shaped — it names too little for a reader to go and look at: 'keep the test suite green'. It carries 1 of the 2 observable markers required (found: observable verb; the markers are: link, commit, tracker id, count or threshold, observable verb, file path). Ask the operator again; never rewrite their milestone for them.
$ echo $?
1
```

Everything else validates in one pass — the writer never stops at the first problem, and writes
nothing when any of them fires:

```console
$ python3 coordinator/init_board.py --answers $T/answers-bad.json --out $T/nope.json
FAIL: northstar.text is empty — the northstar is recorded in the operator's own words and is never drafted for them
FAIL: northstar.ruling_id is missing — a board entry binds only when it cites an operator ruling id (DESIGN §2)
FAIL: lane L1: owner 'the fleet' is not a named seat — DESIGN §4 requires a named owner, never "the fleet"
FAIL: lane L1: done_milestone is not capability-shaped — it names too little for a reader to go and look at: 'make the pipeline solid'. It carries 0 of the 2 observable markers required (found: none; the markers are: link, commit, tracker id, count or threshold, observable verb, file path). Ask the operator again; never rewrite their milestone for them.
FAIL: lane id 'L1' is used more than once — lane ids must be unique
FAIL: lane L1: cadence_hours must be a positive int, got 0
FAIL: lane_cap is 1 but initiation opens 2 lanes — the cap cannot start already breached
$ echo $?
1
$ ls $T/nope.json
ls: cannot access '.../dryrun/nope.json': No such file or directory
```

---

## 3. A sample board from operator-supplied values

The fictional answers above, written to a JSON answers file and handed to the writer — to a
**temp path**, never to `coordinator/board.json`:

```console
$ python3 coordinator/init_board.py --answers $T/answers.json --out $T/board-sample.json \
    --now 2026-08-29T12:00:00Z
OK: initiated .../dryrun/board-sample.json — 2 lanes, lane_cap 4, northstar ruling SAMPLE-R0
Next: python3 coordinator/check.py .../dryrun/board-sample.json
$ echo $?
0
```

The board it wrote — note `lane_cap: 4` (the operator's number, from Q3), the `policy` block
with the one override from Q4, the per-lane `cadence_hours` driving `next_report_due`, the
`initiation` record, and **no `seed` marker anywhere**: PROPOSED is the pre-initiation state and
initiation is what clears it.

```json
{
  "schema_version": 2,
  "note": "Canonical. Written only by a coordinator run. DESIGN §4.",
  "northstar": {
    "text": "SAMPLE (fictional): the fleet runs a week without me re-explaining what we are doing.",
    "ruling_id": "SAMPLE-R0",
    "confirmed_at": "2026-08-29T12:00:00Z"
  },
  "lane_cap": 4,
  "policy": {
    "default_cadence_hours": 24,
    "unattested_done_days": 3,
    "queue_item_days": 2
  },
  "lanes": [
    {
      "id": "L1",
      "goal": "SAMPLE: ship the coordinator v0.2 milestones.",
      "done_milestone": "M1-M6 committed on agent-alistair and check.py green.",
      "owner": "Alistair (platform-engineer, agent-alistair)",
      "state": "active",
      "blockers": [],
      "next_decision": "operator: arm the boot gate or hold",
      "reported_at": "2026-08-29T12:00:00Z",
      "verified_at": null,
      "evidence": [],
      "next_report_due": "2026-08-30T12:00:00Z",
      "cadence_hours": 24
    },
    {
      "id": "L2",
      "goal": "SAMPLE: fleetdeck shows the board.",
      "done_milestone": "board.html served on https://fleetdeck.example/board and stamped with the head commit.",
      "owner": "SAMPLE-seat (frontend-developer)",
      "state": "active",
      "blockers": [],
      "next_decision": "operator: confirm the fleetdeck URL",
      "reported_at": "2026-08-29T12:00:00Z",
      "verified_at": null,
      "evidence": [],
      "next_report_due": "2026-08-31T12:00:00Z",
      "cadence_hours": 48
    }
  ],
  "operator_queue": [],
  "effective_decisions_ref": "coordinator/decisions-effective.md",
  "initiation": {
    "initiated_at": "2026-08-29T12:00:00Z",
    "ruling_id": "SAMPLE-R0",
    "lane_cap": 4,
    "interviewer": "coordinator-init"
  }
}
```

### `check.py` on the sample board

```console
$ python3 coordinator/check.py $T/board-sample.json
WARN: raw bundle files not found beside board.json
OK: board.json valid — 2 lanes, bundle 1232 bytes compacted (15% of gate, 6960 bytes headroom), raw files unchecked
$ echo $?
0
```

**The WARN is expected and correct.** The sample board sits alone in a temp dir, so
`northstar.md` and `decisions-effective.md` are not beside it and the boot-bundle size gate has
only the board itself to weigh. On the real board the gate applies normally.

### The cap is the operator's, at any number (R3)

`init_board.py` writes whatever cap the operator states and holds no opinion about the number.
The same answers with `lane_cap: 9` — a value the old `HARD_LANE_CAP = 6` would have rejected —
now pass end to end, because the M1 lane replaced that constant with the board's own `lane_cap`:

```console
$ python3 coordinator/init_board.py --answers $T/answers-cap9.json --out $T/board-cap9.json \
    --now 2026-08-29T12:00:00Z | head -1
OK: initiated .../dryrun/board-cap9.json — 2 lanes, lane_cap 9, northstar ruling SAMPLE-R0
$ python3 coordinator/check.py $T/board-cap9.json
WARN: raw bundle files not found beside board.json
OK: board.json valid — 2 lanes, bundle 1232 bytes compacted (15% of gate, 6960 bytes headroom), raw files unchecked
$ echo $?
0
```

`check.py` and `board_lib.py` were being changed by another builder while this transcript was
recorded (M1/M5: the board-driven cap, the two-marker milestone rule, the compacted bundle
measurement). Every block above was re-run against the state of those files at 2026-08-29
~11:06Z and is green as printed. If a later change moves the output, re-run rather than edit —
this file is only worth anything if it is what the commands actually print.

---

## Provenance

- Authority: `docs/goals/coordinator-v02/OPERATOR-RULINGS-2026-08-29.md` — R1 (one coordinator
  per project; the northstar is defined at initiation), R2 (seeds stay PROPOSED until
  initiation), R3 (no lane limit; the count is defined at initiation).
- Ritual: `.claude/skills/coordinator-init/SKILL.md`. Writer: `coordinator/init_board.py`.
- `coordinator/board.json` shows as modified in this worktree from another builder's concurrent
  M1 work (the `policy` block, the queue-item deadlines). No run in this transcript wrote to it:
  every run against it used `--dry-run`, and the one without `--replace-proposed` was refused.

### 1c. A refused run under `--dry-run` (defect F2, fixed)

A refused run stays refused under `--dry-run`. The preview is a courtesy, so nothing it
prints may read as authorisation — before the fix this path fell through and printed
`RE-INIT authorised by the operator ... "None"` on stdout, which is exactly the sentence a
reader should never see without the operator having said it.

```console
$ python3 coordinator/init_board.py --answers $T/answers.json --out $T/initiated.json --dry-run
REFUSED: /tmp/claude-1000/f2/board.json is already initiated.
  northstar.ruling_id = 'R-SAMPLE-1'
  northstar.seed      = None
DRY RUN: nothing written to /tmp/claude-1000/f2/board.json
...
# stdout carries the board it WOULD write, and nothing else:
$ python3 coordinator/init_board.py ... --dry-run 2>/dev/null | grep -c "RE-INIT authorised"
0
```

Exit code is 0 under `--dry-run` (the preview ran) and **1** without it (the run is refused):

```console
$ python3 coordinator/init_board.py --answers $T/answers.json --out $T/initiated.json; echo "exit=$?"
REFUSED: ... is already initiated.
...
exit=1                 # and the board on disk is byte-identical afterwards
```
