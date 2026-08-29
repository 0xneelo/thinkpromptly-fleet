# REPORT — Coordinator v0.2 (XYZ-1827 / XYZ-1839) — Alistair · platform-engineer

Host german-box · worktree `.claude/worktrees/alistair` · branch `agent-alistair`.
Authority: `docs/goals/coordinator-v02/OPERATOR-RULINGS-2026-08-29.md` (R1–R6).

## What shipped

| # | Milestone | State |
|---|---|---|
| M1 | Make silence visible — deadlines, ages, dead-man, `exceptions`, capability-shaped milestone rule | green |
| M2 | Reconciliation reader — attestation cards → `DISPUTED` with the quote | green |
| M3 | Glance surface — `public/board.html` on fleetdeck | green |
| M4 | Push — Telegram notify on exception transitions, digest + rate limit | green |
| M5 | Boot-bundle compaction (dependency of M1/M3) | green |
| M6 | The initiation ritual — `coordinator-init` + `init_board.py`, cap from the board (R3) | green |
| Rider | Box stop-hook wart | **blocked — operator:gate XYZ-1840** |

### New files

```
coordinator/board_lib.py     shared contract: board IO, time, ages, the milestone rule
coordinator/exceptions.py    M1 — compute / apply_deadman / ensure_deadlines
coordinator/bundle.py        M5 — the compacted boot bundle + gate report
coordinator/runlog.py        M1 hardening — archive artefacts + artefact-derived counters
coordinator/reconcile.py     M2 — attestation cards to board mutations
coordinator/render.py        M3 — board.json to public/board.html
coordinator/notify.py        M4 — exception-transition notifier
coordinator/init_board.py    M6 — the initiation writer, with two refusal tiers
public/board.html            M3 — the generated glance surface
.claude/skills/coordinator-init/SKILL.md
.claude/skills/coordinator-reconcile/SKILL.md
docs/coordinator/SCHEMA-v2.md
docs/coordinator/SURFACES-v2.md
docs/coordinator/INIT-DRYRUN.md
```

`coordinator/check.py` was extended; `coordinator/board.json` gained structural metadata only.

## M5 — the number that mattered

The proposal called compaction a *dependency* of M1 and M3, not cleanup, because the bundle was
already at 87% of its gate with four lanes and M1 adds material that must reach a booting seat.

| Bundle | Bytes | % of the 8192 B gate |
|---|---|---|
| v0.1 raw files, 4 lanes | 7127 | 87% |
| v0.2 compacted, 4 lanes | 3312 | **40%**, 4880 B headroom |
| v0.2 compacted, 6 lanes + 6 exceptions | 4753 | **58%**, 3439 B headroom |

The lever was the effective-decisions table: 2362 bytes of it are now a reference line, because a
booting seat can open the file when a decision is actually in play. Exceptions and lanes that need
attention still render in full — the gate exists to protect the bundle, not to thin the part a
seat is booting to read.

The gate still trips on a genuinely oversized bundle; that assertion is in the selftest.

## R1/R2 — nothing was seeded

Verified programmatically rather than by eye, against `HEAD:coordinator/board.json`:

```
northstar unchanged: True     lanes unchanged: True     lane_cap unchanged: True
added top keys: ['policy']
OQ-1 added=['opened_at','deadline'] changed=[]
OQ-2 added=['opened_at','deadline'] changed=[]
OQ-3 added=['opened_at','deadline'] changed=[]
```

The queue timestamps use the board's own existing seed time, `2026-08-28T09:00:00Z`. They are the
clock M1 needs — without an `opened_at` an item can never age into an exception, which is the
precise silence M1 exists to break. No lane goal, milestone, owner, state, evidence or
`seed: "PROPOSED"` marker was touched. Every seed stays PROPOSED until the ritual runs.

The file was also reflowed to the canonical `indent=2` form that `board_lib.save` writes, so the
next coordinator run produces no spurious formatting diff. Content is byte-identical as data.

## R3 — the cap is gone

`HARD_LANE_CAP` and all three of its references are deleted from `check.py`. The cap now comes
from the board's own `lane_cap`, written at initiation. DESIGN §4's "hard cap 6" is overridden and
the comment in `check.py` quotes R3 verbatim so the next reader does not reinstate it. The
selftest asserts a 9-lane board with `lane_cap: 9` passes and 10 lanes against it fails.

## Two defects found and fixed in my own work

**1. The M1 milestone rule accepted pure aspiration.** Review caught that the marker regex counted
a bare `no` as a quantity, so `"no progress has been made"` validated as a done-milestone — gutting
the rule M1 exists for. `"make sure the tests stay green"` and `"we want this to be reachable
eventually"` also passed on a single verb. The rule is now **two distinct observable markers**;
`no`/`all`/`every`/`each` are dropped, and the commit-hash pattern requires a digit so `effaced`
and `deadbeef` no longer read as shas. All four real board milestones pass; fourteen aspiration
and false-positive cases reject.

**2. `init_board.py` destroyed the live board during my own test.** I pointed `--out` at
`coordinator/board.json` and it wrote a sample board over all four seeded lanes. The guard only
refused *initiated* boards — and a PROPOSED board is by definition not initiated, so the one board
the ritual is meant to protect was the one board it would overwrite. Restored from `HEAD` with the
metadata re-applied, and a second guard tier added: an existing board carrying seeded lanes or
queue items now refuses without `--replace-proposed`, printing exactly which lanes and queue items
would be lost. Both tiers are exercised in `docs/coordinator/INIT-DRYRUN.md`.

## Rider — the box stop-hook wart: not what it was thought to be

The rider assumed `Stop hook error: JSON validation failed` came from the SessionEnd wiring. It
does not, and no edit under `box/hooks/` can close it. Verified on german-box:

- No `Stop` hook is configured anywhere. `~/.claude/settings.json` declares exactly `SessionStart`
  and `SessionEnd`; `settings.local.json` does not exist.
- `deregister.sh`, invoked as the hook invokes it and again with a real `SessionEnd` payload on
  stdin: **0 bytes stdout, 0 bytes stderr, exit 0**, both times.
- `box/hooks/deregister.sh` is byte-identical to the installed `~/.claude/fleet/deregister.sh`, and
  `install-box.sh` already writes a `SessionEnd` entry, not a `Stop` one.
- The error is Claude Code's own prompt-type Stop evaluator: a transcript record carries
  `hookName: "Stop"`, `stderr: "JSON validation failed"`, and the entire worker launch prompt —
  `STOP when: …` and all — in its `command` field.
- It fires **per turn**, not at session close: 9 occurrences in this session while it was still
  running. A session-close script cannot do that.

So the SessionEnd path is already clean, which is the part acceptance item 4 actually asks about.
The remaining noise is upstream. `box/hooks/` is untouched. Options are in **XYZ-1840**.

## Acceptance

| # | Item | Result |
|---|---|---|
| 1 | M1–M5 acceptance, incl. artefact-derivable counters + compaction self-test | green — `SELFTEST PASS (53 assertions)` |
| 2 | `coordinator-init` dry-run transcript: refusal, interview shape, sample board + `lane_cap` | green — `docs/coordinator/INIT-DRYRUN.md`, both refusal tiers |
| 3 | `check.py` validates the cap from the board; selftest updated; green | green — `HARD_LANE_CAP` deleted |
| 4 | Box session close clean, proven with a throwaway session | **not closable in this lane** — the SessionEnd path is proven clean; the error is upstream. XYZ-1840 |
| 5 | Branch pushed, report, registry row, lane issue checkpointed | see below |

## What I did not do, and why

- **Rider acceptance item 4** — escalated as XYZ-1840 rather than edited around. The subsystem the
  rider names is not the subsystem at fault, and changing clean code to look like a fix would have
  been worse than saying so.
- **Boot gate stays disarmed** — R4 puts arming at weave, not in this lane. The stanza and
  checklist are above.
- **Meta-coordinator** — recorded as a future note in the init skill per R1. Nothing built.
- **No `server.js` change was needed.** `server.js:1969` already serves any file under `public/`,
  so `public/board.html` reaches fleetdeck without an API change.

## Review

Every diff went through a reviewer before it was committed. Four findings were acted on;
none were waved through.

| Finding | Severity | Action |
|---|---|---|
| Milestone rule accepted pure aspiration via a bare `no` | high | rule rewritten — two independent markers |
| A reference token satisfied two markers by itself (`"stuff is done b00b1e5"`) | medium | markers made independent by construction; `commit` now requires the `git:` prefix |
| `is_initiated()` read False on a board with no northstar object, routing a live board to the weaker guard | medium | an unreadable board is now treated as initiated |
| `save()` shared a fixed `.tmp` name, no fsync | low | pid-scoped temp + fsync before rename |
| Lane `id` was never type-checked | low | `check.py` now requires a string |
| `--dry-run` could not preview a refused run | low | the refusal now prints the board it would write |
| `board_exceptions()` duplicated across both surfaces | low | hoisted into `board_lib` |

The marker rule is the one worth spelling out. Markers are now scored with the reference
matches cut out of the text, so a single token can never satisfy two of them: `"XYZ-1742"`
alone is a tracker id and nothing else, and is rejected. All four real board milestones pass;
fifteen aspiration and false-positive cases reject, including every bypass the review found.

M3/M4 review found no severe defects. Escaping was verified against a hostile board — a lane
goal carrying `<script>`, `<img onerror>` and a literal `</script>` renders as text in the
markup and cannot terminate the inlined JSON block. The Telegram token is absent from argv,
state, logs and error paths; failure paths report `type(exc).__name__`, never `str(exc)`,
because a `urllib` exception can carry the full URL.

## Verification

```
$ python3 coordinator/check.py
OK: board.json valid — 4 lanes, bundle 3312 bytes compacted
    (40% of gate, 4880 bytes headroom), raw files 7746 bytes
$ python3 coordinator/check.py --selftest
  M5: six lanes + 6 exceptions -> 4753 bytes compacted, 3439 bytes headroom (58% of gate)
SELFTEST PASS (53 assertions)
$ python3 coordinator/notify.py --selftest
SELFTEST PASS (14 assertions)
$ python3 coordinator/hooks/boot-gate.py --selftest
SELFTEST PASS (44 assertions)          # v0.1 gate untouched, still green
$ python3 coordinator/render.py
OK: wrote public/board.html — 21328 bytes, 4 lanes, 4 exceptions
```

Existing deck views are untouched: no `server.js` change, no edit to `index.html`,
`app.js`, `orgchart.js` or any existing asset. `public/board.html` is a new file only.

## Commits

```
144826f  M3+M4 — the glance surface, and notify on transitions only
c019f5d  M6+M2 — the initiation ritual, and the reconciliation pass
c7e8e8a  M1+M5 — exceptions, dead-man, artefact-derived counters, bundle compaction
```

## Open items for the operator

1. **XYZ-1840 (operator:gate)** — the box stop-hook wart is upstream. Options are in the issue;
   recommendation is to accept the noise, since the error is non-blocking and deregistration is
   unaffected.
2. **Arm the boot gate** at weave, per R4 and the checklist above.
3. **Run `/coordinator-init`.** Everything in `board.json` is still PROPOSED and binds nothing.
   Until the ritual runs, M1's dead-man mostly reports that nobody is reporting — the proposal's
   own honest risk, and it is still live.


## Boot gate — still DISARMED (R4)

R4 verbatim: *"build the initialization ritual as well as v0.2 finished"*. Arming happens at
weave, by the operator, not in this lane. `coordinator/hooks/boot-gate.py` is unchanged and
nothing in this branch installs it.

### Final arming stanza

Add to the operator's `settings.json`. The path below is this box's checkout; on the Mac,
substitute the Mac checkout path.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command",
            "command": "python3 /home/vibe/projects/remote-system/coordinator/hooks/boot-gate.py" }
        ]
      }
    ]
  }
}
```

### Arming checklist

Arm only when every line is true:

1. `python3 coordinator/hooks/boot-gate.py --selftest` prints `SELFTEST PASS` on the machine
   being armed.
2. `python3 coordinator/check.py` and `python3 coordinator/check.py --selftest` are green on
   the board being gated.
3. The initiation ritual (`/coordinator-init`) has run: `board.json` carries a real
   `northstar.ruling_id` and an `initiation` block — a gate over a PROPOSED board would deny
   orchestrator work against a board that binds nothing.
4. The stanza's absolute path resolves on that machine (`python3 <path> --selftest` runs).
5. `COORDINATOR_SEAT_KIND=orchestrator` and `COORDINATOR_SEAT=<seat-id>` are set for the
   orchestrator seat only. Unset elsewhere; a missing seat id on an armed gate denies.
6. The disarm path is known to whoever arms it: remove the `PreToolUse` stanza, or unset
   `COORDINATOR_SEAT_KIND`.

**One-line arming checklist:** *selftests green (gate + check), board initiated with a real
ruling id, absolute path resolves, `COORDINATOR_SEAT_KIND`/`COORDINATOR_SEAT` set on the
orchestrator seat only, disarm path known.*

— Alistair
