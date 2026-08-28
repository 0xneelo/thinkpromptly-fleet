---
name: coordinator-run
description: Execute one stateless Coordinator run against the repo's coordinator/ state dir — boot the size-gated bundle, drain inbox/ sitreps oldest-first under the ordering rule, update board.json, re-run check.py, make exactly one commit, emit exceptions, then terminate. Use when a sitrep lands in coordinator/inbox/, when a coordinator run is due on the timer, or when the operator asks to apply the inbox / refresh the board.
---

# Coordinator run (stateless)

You are a **disposable cheap session** (DESIGN-v1 §9.1). Read state, drain the inbox, commit once,
emit exceptions, die. **Session context is never the memory** (§0) — the files are.

Do the six steps in order. Each is checkable; do not skip ahead.

## 1. Boot the bundle — size gate FIRST

```bash
python3 coordinator/check.py
```

`check.py` validates `board.json` **and** enforces the boot-bundle size gate: `board.json` +
`northstar.md` + `decisions-effective.md` ≤ `BUNDLE_GATE_BYTES` (8192 bytes ≈ 2k tokens; the
constant lives in `check.py`).

- **Gate tripped → STOP.** Do not drain. Do not touch `board.json`. Do not commit. Open a
  compaction exception: a Linear issue naming the byte count and what to compact — superseded
  decision rows to the `## Archive` section of `decisions-effective.md`, closed lanes out of
  `board.json`. If Linear is unreachable, write the same content to
  `coordinator/inbox/<ISO>-coordinator-EXCEPTION.md`. Then terminate.
  A tripped gate is a **stop condition, never a warning to work through**.
- `check.py` prints `WARN` at ≥90% of the gate. That is a compaction hint, not a stop — continue.

Then read `coordinator/board.json`, `coordinator/northstar.md`, `coordinator/decisions-effective.md`.
**That is the entire boot context.** Do not read source code, docs, or transcripts.

## 2. Drain `coordinator/inbox/` oldest-first

Order by `event_time`; fall back to the filename ISO prefix, then to mtime. Handle one file at a
time, in order.

### 2a. Parse strictly

Required keys (`coordinator/inbox/README.md`, DESIGN §3): `seat`, `lane`, `event`, `event_time`,
`state`, `blockers`, `next_report`. `evidence` is required when `state` is `done-claimed`.

Malformed, unparseable, unknown lane, or a `state` outside `active|blocked|done-claimed|closed`
→ move the file to `coordinator/inbox/rejected/` and write `<name>.reason` with **one line** saying
why. **Never best-effort parse** — DESIGN §3, a hard rule.

### 2b. Ordering rule (DESIGN §3)

> "apply a sitrep only if `event_time` is newer than the lane's last applied `event_time` AND the
> seat is the lane's registered owner. Anything else → inbox archive + flag, never applied."

Apply only if `event_time` is **strictly newer** than that lane's current `reported_at` **AND**
`seat` matches the lane's registered `owner`. Otherwise move the file to
`coordinator/inbox/archive/` and write `<name>.flag` with the reason:

- `stale: event_time <= lane reported_at`
- `wrong-owner: seat X is not owner Y`

Never applied.

### 2c. Apply an accepted sitrep

- `blockers` — replace **wholesale**. The sitrep carries the FULL set (level-triggered), so a
  shrinking list is a real change, not a partial update.
- `state` ← sitrep `state`; `reported_at` ← `event_time`; `next_report_due` ← `next_report`.
- `next_decision` / `goal` text — update **only** from the `delta` lines.
- `evidence` — append the links.
- `ruled_out` — preserve **verbatim** into the lane. Append; never rewrite it.
- Then **delete the applied file** from `coordinator/inbox/` — the commit carries the change, so
  the inbox ends the run empty of applied sitreps (`coordinator/inbox/README.md`).

### 2d. Never set `done-verified` from a sitrep

A seat's own claim stays `done-claimed` until an attestation card lands (DESIGN §4 guard b).
`verified_at` writes only against an evidence link.

### 2e. Conflicts

Two sitreps that contradict, or a claim contradicting an existing attestation → set the lane
`DISPUTED`, keep **both** attestations in the lane's evidence, suppress any done state, route to
the operator as an exception. **The Coordinator never picks a winner** (DESIGN §2 hard never).

## 3. Update `board.json`

Respect the **6-lane hard cap**. A 7th lane forces a park or a merge, never a denser board. If a
sitrep would open a lane at the cap: reject it into `coordinator/inbox/rejected/` and raise an
exception for the operator to park or merge a lane. **Never widen the cap.**

## 4. Re-run the validator

```bash
python3 coordinator/check.py
```

Non-zero exit → fix the board or revert the application. **Never commit a failing board.**

## 5. Exactly one commit

DESIGN §0: "commit exactly one revision." One `git commit` covering `board.json`, every inbox
move, and every archive/reject note — atomic, so there is no split-brain.

```
coordinator: run <ISO-date> — <n> applied, <n> archived, <n> rejected
```

Do not push unless the operator asked. The commit is the record.

## 6. Emit exceptions, then terminate

Exceptions are tracker records with a lifecycle — `pending → acknowledged → ruled → verified` —
coalesced one thread per incident. **Delivery is not acknowledgement.**

Then stop. Do not linger, do not answer questions, do not start a second run.

## Seat-ack markers

After a lane-ownership restatement sitrep from an orchestrator seat is **accepted**, write the
empty marker `coordinator/.seat-ack/<seat-id>` in the same commit. That marker is what releases the
boot gate (`coordinator/hooks/boot-gate.py`, DESIGN §9.2). Never write a marker by hand, and never
write one for a seat whose restatement was rejected or archived.

A run session is **not** an orchestrator seat: run with `COORDINATOR_SEAT_KIND` unset. An armed
orchestrator seat cannot write outside `coordinator/inbox/`, so a run started inside one could not
write the marker or the board.

## Hard nevers for the run (DESIGN §2)

- Never build.
- Never mint builders or workers. Bounded read-only verifier readers are allowed and are not workers.
- Never read source code.
- Never adjudicate — record `DISPUTED`, route to the operator.
- Never re-scope without the operator.
- Never restate an auth / money / migration / delete / scope ruling in your own words — verbatim
  quote under its ID, or a link. Never a paraphrase.
- Never sit on a critical path. Anything time-bounded goes seat→operator direct; the Coordinator is
  copied asynchronously.

The board must stay rebuildable from git history alone.
