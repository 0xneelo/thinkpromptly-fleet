# fd-v2 L10 — Desktop sessions · REPORT

| | |
|---|---|
| Worker | **Clodwig** · `frontend-developer` · tag `agent-clodwig` |
| Branch | `agent-v2-l10` off `origin/agent-v2-base` (+ `origin/agent-v2-l1`, already contained) |
| Linear | **DECK-53** (main) · DECK-61 / 62 / 63 / 64 / 66 (one per BEHAVIOUR section) · DECK-68 (base defect, filed not fixed) |
| Ledger row | D17 |
| Owned files | `public/v2/screens/desktop.js`, the desktop screen's methods in `public/v2/logic.js` |

## Hooks

**Provided:** none was required by the contract. `FD.screens.desktop.rowAction(kind, row, el)` exists, but
it is an *internal* seam between this slice's own two files (the screen file and the screen's methods in
`logic.js`) — no other slice is invited to call it, and it is registered in live mode only.

**Used:** `FD.screens.bus.open(messageTarget)` — **L6**, ruling O8. Guarded at every call site
(`openBus()` in `screens/desktop.js`): it checks the hook is a function, calls it inside `try/catch`, and
returns whether the bus took it. When L6 has not landed, Message falls back to
`FD.router.navigate('bus')`, also guarded.

**Dependency on L6:** until L6 ships `FD.screens.bus.open`, the Message action navigates to the bus
screen without selecting the thread. Nothing throws, and no L6 code is merged into this branch.

## Data seam

Data enters only through `FD.setData('dsData', …)`. In fixture mode (`?fixture=1`) `screens/desktop.js`
returns before it wires anything — no `setData`, no listeners, no poll, no `rowAction` — so the compiled
logic renders `FD.fixture` exactly as the mock does. That is what keeps the pixel gate at 36/36.

### `FD.data.toDesktop` is used, and three gaps are compensated for in this slice

`data.js` is L1's file, so the gaps are worked around here rather than fixed there. Reported on DECK-61.

| Gap | Consequence for L10 | What this slice does |
|---|---|---|
| Drops every `isArchived` session | no Archived filter, no `Archived` chip | builds archived rows in the same shape |
| Always prepends an empty `Live now` head group | `logic.js` builds its own → two groups | drops L1's head before pushing |
| Renders `completedTurns === null` as `0 turns` | BEHAVIOUR requires `Turns unknown` | overrides the string |

## Improvisations

Nine, all in `docs/design/fleetdeck-v2/improvised.md` (`I-L10-01` … `I-L10-09`) with rationale, and
screenshots under `docs/design/fleetdeck-v2/improvised/` for the seven visual ones. `I-L10-08` (Live now)
and `I-L10-09` (Message → bus) are data/behaviour decisions and carry no screenshot.

## Behaviour checklist

_(filled below from BEHAVIOUR.md, item by item)_

## Verification

_(filled below)_

## Open follow-ups

_(filled below)_

---

Signed **Clodwig** · `frontend-developer` · 2026-09-07
