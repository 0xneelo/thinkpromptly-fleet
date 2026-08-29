# Operator rulings — Fleet Rulings sheet, 2026-08-29 (verbatim)

Source: the operator's answers to the six-card unblock sheet, pasted into the
🎛 ORCHESTRATOR 17 session. Notes are quoted verbatim; they are the authority.

| # | Card | Choice | Verbatim note |
|---|---|---|---|
| R1 | northstar | write-own | "the northstar should be defined at the beginning of the coordinator initiation by using the /grill-me skill there should be only one coordinator per project. In the future we might create a meta-coordinator (that oversees multiple projects)" |
| R2 | seed-lanes | keep-proposed | "coordinator needs to be properly initiated." |
| R3 | free-slots | neither | "there is no point in having a limit or amount of lanes, the amount of lanes is dependent on the project and will be defined during initiation" |
| R4 | boot-gate | arm-v02 | "build the initialization ritual as well as v0.2 finished" |
| R5 | v02-routing | claude-now | (no note) |
| R6 | fleet-cleanup | full | (no note) — executed 2026-08-29: FD-{edith,konrad,alfons,sylvia} killed, names released, wart fix riding on the v0.2 lane |

## What they change

1. **Initiation ritual is now v0.2 scope (M6)**: northstar + lane set are produced by a
   grill-me-driven initiation, not seeded by builders. Until initiation runs, the board's
   seeds stay PROPOSED and bind nothing (R1, R2).
2. **The hard lane cap is abolished** (R3): lane count is project-dependent, fixed at
   initiation. `check.py`'s `HARD_LANE_CAP = 6` becomes a board-driven `lane_cap`
   parameter written by the initiation ritual. DESIGN-v1 §4's "hard cap 6" is overridden
   by this ruling.
3. **One coordinator per project** (R1). A meta-coordinator over multiple projects is a
   recorded future idea, explicitly OUT of v0.2.
4. **Boot gate arms when v0.2 (incl. the ritual) is finished** (R4) — not before.
