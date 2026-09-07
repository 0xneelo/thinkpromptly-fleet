# fd-v2-l4 — Linear + registry state

Linear was **reachable** on 2026-09-07 from this box, so nothing is pending here.
Main issue: **DECK-43** — `[Ruprecht · frontend-developer] fd-v2 L4 Registry on live rows`, In Progress,
labels `agent:ruprecht` `project:remote-system` `subproject:fleetdeck-v2` `session:cli-worker`.
(The label `agent:ruprecht` did not exist and was created.)

## Fleet registry row — written, after four self-inflicted 401s

```
POST http://100.125.231.25:3131/api/registry            →  401 unauthorized   (no Authorization header)
POST … with Authorization: Bearer $FD_TAILNET_KEY       →  200 {"ok":true}
```

The `401` is `tailnetAuthed()` (`server.js:497`), not the seat fence of XYZ-2137: every POST over
the tailnet listener must carry the shared key, and the launch prompt's curl recipe omits the
header. The box has the key as `FD_TAILNET_KEY` in `~/.claude/fleet/fleet.env` (0600). Both the
registration and the closing `status: done` returned `{"ok":true}`.

Worth re-checking XYZ-2137 against this — L1 recorded the same `401` and concluded the write was
fenced for box workers.

## Pack gap (recorded, not a stop)

`docs/goals/fd-v2-l4/` shipped with only `BEHAVIOUR.md` — no `README.md`, no `PROTOCOL.md`
(identical for `fd-v2-l2` and `fd-v2-l3`). BEHAVIOUR.md *is* the spec and the launch prompt states the
acceptance verbatim, so stopping would have delivered nothing. Instead: `PROTOCOL.md` copied verbatim
from `fd-v2-l1`, `README.md` authored from the launch prompt + the L1 template. Flagged on DECK-43 so the
orchestrator can correct the packs for L2/L3.
