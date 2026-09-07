# fd-v2-l4 — Linear + registry state

Linear was **reachable** on 2026-09-07 from this box, so nothing is pending here.
Main issue: **DECK-43** — `[Ruprecht · frontend-developer] fd-v2 L4 Registry on live rows`, In Progress,
labels `agent:ruprecht` `project:remote-system` `subproject:fleetdeck-v2` `session:cli-worker`.
(The label `agent:ruprecht` did not exist and was created.)

## Fleet registry row — cannot be written from the box

```
POST http://100.125.231.25:3131/api/registry  →  401 unauthorized
```

Same failure Juergen hit in L1: registry writes are seat-epoch fenced and a box worker has no seat
(XYZ-2137). Recorded here rather than filed as a new gate; the launch prompt's "registry row done"
step is blocked by that known issue, not by this slice.

## Pack gap (recorded, not a stop)

`docs/goals/fd-v2-l4/` shipped with only `BEHAVIOUR.md` — no `README.md`, no `PROTOCOL.md`
(identical for `fd-v2-l2` and `fd-v2-l3`). BEHAVIOUR.md *is* the spec and the launch prompt states the
acceptance verbatim, so stopping would have delivered nothing. Instead: `PROTOCOL.md` copied verbatim
from `fd-v2-l1`, `README.md` authored from the launch prompt + the L1 template. Flagged on DECK-43 so the
orchestrator can correct the packs for L2/L3.
