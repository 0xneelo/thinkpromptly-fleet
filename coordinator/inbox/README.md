# inbox — the durable sitrep drop

One file per event. Never a session queue, never chat (DESIGN-v1 §2 Inputs, §3).

**Filename:** `<ISO-time>-<seat>-<lane>.md` — e.g. `2026-08-28T18:40:00Z-o31-L1.md`.
Use the `event_time` (when it happened), not when you wrote it. Colons are fine on this box;
if a filesystem rejects them, use `2026-08-28T184000Z-o31-L1.md`.

**Body — the fixed schema (DESIGN §3), ~15 lines cap:**

```text
seat:        o31 (seat id + name)
lane:        L3
event:       one of the CCIR list
event_time:  ISO, when it happened (not when sent)
state:       proposed lane state (active|blocked|done-claimed|closed)
delta:       <=5 lines, what changed vs the board's current text
blockers:    FULL current list for the lane (ids) — level-triggered, every time
evidence:    >=1 link for any done/deployed/verified claim (commit, deploy log, live URL)
ruled_out:   <=3 lines, approaches tried and dead (optional, preserved verbatim)
next_report: expected time of my next event on this lane
```

Required keys: `seat`, `lane`, `event`, `event_time`, `state`, `blockers`, `next_report`.
`evidence` is required whenever `state` is `done-claimed`.

**CCIR — when a sitrep is due (DESIGN §3):**
1. Lane opened / closed / owner changed (rotation must transfer or abandon every open commitment).
2. Train deployed or deploy failed.
3. Blocker new / cleared / set changed.
4. Done-milestone claimed (evidence link mandatory; renders `done-claimed` until attested).
5. Operator ruling received in-session (verbatim quote + confirmation ping).
6. Disagreement: two agents' conclusions conflict, or a cross-verification failed.
7. Sub-threshold drift ("trending toward blocked") — cheap FYI line, no ping.
8. `next_report` deadline reached with nothing to say → explicit "no change, alive" one-liner.

**What happens to your file:**

- Applied → deleted from `inbox/` by the run commit; the board carries the change.
- Stale (`event_time` not newer than the lane's `reported_at`) or wrong owner (seat is not the
  lane's registered `owner`) → moved to `inbox/archive/` with a `<name>.flag` note. Never applied.
- Malformed (missing a required key, unparseable, unknown lane, bad state) → moved to
  `inbox/rejected/` with a one-line reason. **Never best-effort parsed** (DESIGN §3).

`archive/` and `rejected/` are read by the operator, not by the run.
