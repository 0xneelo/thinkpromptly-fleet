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

Every item in `BEHAVIOUR.md`, in its order. **done** = ported and proved; **n.a.** = deliberately not
ported, with the reason.

### §1 Data

| Item | State | Where / note |
|---|---|---|
| `GET /api/desktop-sessions[?refresh=1]` | done | `FD.data.desktopSessions({refresh})`; a plain load sends no query string |
| `{groups[], machines[], collected_at, collecting, ttl_ms}` consumed | done | the whole body is kept as `response`; `machines[]` drives the notes, `collected_at` the last-collection line |
| TTL 300 s / `refresh=1` forces a collect | done | Refresh calls `load(true)`; the TTL itself is the server's |
| group fields `accountUuid, orgUuid, machine, label, email, sessions[]` | done | `build()` |
| session fields incl. `liveState`, `isArchived`, `stale`, `messageTarget` | done | carried as enrichment on each row |
| `liveState` only decidable locally; remote = `unknown` | done | the value is used as given; `Live unknown` is its chip |
| `machines[]` fields | done | `machineLabel()` and the notes panel |
| sessions sorted by `lastActivityAt` desc, `id` asc | done | `build()`, today's comparator |
| groups sorted by `label, accountUuid, machine, orgUuid` | done | `build()`, today's comparator |
| **No "Live now" group today** | n.a. | the mock adds one (I-L10-08); `logic.js` builds it and L1's duplicate head group is dropped |
| transcript endpoint 200 / 404 / 502 | done | `FD.data.transcript(...)`; 404 → `No transcript`, other failures → `Copy failed` |

### §2 Filters

| Item | State | Where / note |
|---|---|---|
| `#sessions-search` placeholder `Title, folder, branch…` | done | the mock's own input, already bound by `logic.js` |
| search over title/cwd/worktree/branch/model | done | `logic.js`, haystack widened to all five, `toLocaleLowerCase` both sides |
| `#sessions-account` `All accounts` + `label · uuid8` | done | I-L10-01; options rebuilt from the payload, sorted by label |
| `#sessions-machine` `All machines` | done | I-L10-01; unsorted, `machines[]` order, as today |
| `#sessions-live` `Any live status / Live / Offline / Unknown` | done | I-L10-01 |
| `#sessions-archived` `All sessions / Not archived / Archived` | done | I-L10-01 |
| defaults `""`, AND-combined, no persistence | done | `keep()` mirrors `sessions.js:84-92`; nothing is written to storage |
| Reset clears all | done | the mock's Reset clears `dq`/`dsExp`; this slice clears its four |
| `<shown> of <total> sessions · <live> live` | done | I-L10-05 |
| `Last collection: <age>` / `No completed collection` | done | I-L10-05 |
| `Previously selected (unavailable)` | done | I-L10-01 |

### §3 Rows

| Item | State | Where / note |
|---|---|---|
| `title \|\| 'Untitled session'` + cwd path line | done | `row()`; the mock splits the path into dir + leaf |
| details `Worktree, Created, CLI session, Session` | done | mock order first (Created / CLI session / Session / Full path), Worktree appended when present |
| `branch \|\| 'No branch'` (mono), `model \|\| 'Model unknown'` | done | `row()` |
| `age(lastActivityAt)` — `Just now` / `Nm` / `Nh` / `Nd` / `Unknown` | done | today's `age()`, not `FD.data.ago` (its strings differ) |
| `completedTurns === null ? 'Turns unknown' : 'N turns'` | done | `row()`, overriding `toDesktop`'s `0 turns` |
| chips `Live` / `Live unknown` / `Offline` | done | `logic.js`, from `liveState` |
| chips `Archived`, `Cached` | done | I-L10-02, appended into the same cell |
| `Message` when live + messageTarget | done | see §4 |
| else `Live check unavailable` / `Not running` | done | the mock has no text slot; the disabled button carries it as its title |
| Copy conversation label cycle over 1.5 s | done | I-L10-04, four strings verbatim, `COPY_REVERT_MS = 1500` |
| clipboard = `sessionContext` + `\n` + transcript | done | `actCopyConv()` |
| `sessionContext()` thirteen `Label: value` lines | done | line-for-line, ` · ` is U+00B7, trailing `\n` |
| Copy context (new, mock-only button) | done | I-L10-04; `sessionContext()` alone |
| Show (new, mock-only button) | done | I-L10-03; expand + scroll |

### §4 Composer

| Item | State | Where / note |
|---|---|---|
| `#session-composer` and all six `#composer-*` fields | **n.a.** | superseded by **ruling O8** — the bus thread replaces the page composer |
| `POST /api/messages {source:'desktop-sessions-page', target, text}` | **n.a.** | same; sending is L6's job now |
| `Message delivered.` / `Message could not be delivered. …` / `This session is no longer available to message.` | **n.a.** | same; those three strings belong to the composer that O8 removed |
| the Message action itself | done | `FD.screens.bus.open(messageTarget)`, guarded, with a guarded router fallback |

O8 is recorded in `diff.md:77` as *"yes, deep-link into the bus thread"*. Nothing here is dropped by
accident: the composer's behaviour moves to L6 intact, and this slice hands it the exact
`messageTarget` today's composer would have posted.

### §5 Polling, errors, keys

| Item | State | Where / note |
|---|---|---|
| `setInterval(load, 30000)` only when `!document.hidden` | done | `FD.data.poll(fn, 30000, {whileVisible:true})` |
| `#sessions-refresh` → `load(true)`, `Collecting…` / `Refresh` | done | I-L10-07 |
| `Sessions could not be refreshed.` + ` The last view is still shown.` / ` Try Refresh to reconnect.` | done | I-L10-06 |
| `Sessions unavailable` / `Could not load desktop sessions.` | done | I-L10-06 |
| five per-machine note texts | done | I-L10-06, verbatim incl. the `Cached metadata. …` fallback |
| both empty states | done | I-L10-06, verbatim |
| localStorage: only `fleetTheme` | done | this slice writes **no** key; theme is L1's `FD.data.theme()`, already migrated to `fd-landing-dark` |
| old ids `#sessions-* #desktop-session-groups #session-composer #composer-*` | n.a. | the v2 screen is the mock's markup; hooks are `data-fd-l10` attributes, never the old ids |

## Response to the S2 shim oracle audit (2026-09-08)

`docs/design/fleetdeck-v2/audits/s2-shim-oracle-2026-09-08.md` landed mid-slice with three binding
instructions. Two are obeyed; one cannot be, and is filed as **DECK-78** (`operator:decision`) with a
recommendation rather than quietly ignored.

| Finding | Effect on L10 | Response |
|---|---|---|
| **F2** — a throw in `renderVals` blanks all nine screens | this slice feeds `renderVals` live rows | the desktop block in `logic.js` is wrapped in try/catch and keeps its last good `dsGroups`/`dsCount`/`dsLive`; `dsData` is coerced to an array and every row field access is guarded; the screen file validates the array before `FD.setData` |
| **F1** — `sc-for` rows are positional, never keep per-row state in the DOM | the transient copy label was a DOM node on the clicked button | the label moved to module state keyed by session id and is rendered onto whichever row currently carries that id; chips are reconciled from data on every pass, never accumulated |
| **F5** — no update-depth guard | `apply()` writes DOM and a `MutationObserver` re-triggers it | explicit guard: the observer is disconnected around the mutations `apply()` makes, plus a per-macrotask apply cap |
| **F4** — a `<select>` fed from live data can show a value the page is not rendering | all four filter selects | compare-then-set on every option-set and `value` write |
| **F3 / instruction 1** — never mount foreign DOM inside a compiled node | **this slice does** | see DECK-78: L10's injected nodes are inline in the mock's flex layout (Refresh, count line, notes panel, row chips, copy label), so the "overlay outside `#dc-root`" remedy — written for L3's opaque xterm rectangle — cannot express them. Mitigated by re-deriving every injected node from data on each `apply()`, so an F3 deletion or F1 reuse self-heals on the next render |

Instruction 3 was already satisfied by construction: `state.dq` holds what the user typed verbatim and the
value is normalised (`trim().toLocaleLowerCase()`) only at the filter site — which is also what keeps the
caret alive across poll-driven renders, per the audit's own verified non-finding.

## A real bug the live proof caught: Reset never cleared the search box

Worth recording, because it is invisible to a synthetic test. This slice attaches its own `click`
listener to the mock's Reset button, alongside the runtime's `onClick`. Calling `push()` inline from
that listener queued a render; the HTML spec runs a **microtask checkpoint after each listener
callback**; that render re-bound the button (`removeEventListener` + `addEventListener`); and the DOM
spec then **skips a listener removed mid-dispatch** — so `logic.js`'s `resetDs` never ran and the search
box did not clear for a real user.

A synthetic `el.click()` hides it entirely (the JS stack is not empty, so no checkpoint runs). A trusted
mouse click reproduced it 3/3. Fixed by deferring that one listener's `push()` to a `setTimeout(…, 0)`,
documented in place.

## Verification

_(filled below)_

## Two defects found outside this slice, filed not fixed

**DECK-93 (urgent, `operator:gate`) — the shell loads neither `data.js` nor `router.js`.**
`public/v2/index.html` at base `42b56bb` loads `runtime.js, fixture.js, logic.js, app.js` and the nine
screen files. `FD.data` is therefore `undefined` on the real page, so **every** L-slice's live path is
dead, not just this one. Fixture mode is unaffected, which is precisely why all nine slices can show a
green 36/36 pixel gate over a page that has no live data — the gate only ever exercises fixture mode.
L10's live proof works around it with a `shimDataLayer(page)` step that injects both files before the
shell scripts run; with that shim its 33 checks pass. `index.html` is the shell and the contract forbids
editing it, so this is S2's or L2's to land.

**DECK-68 — `test/v2-data.test.js` failed on `origin/agent-v2-base` itself.** L1's test required the
browser-only `fixture.js` (`window.FD = …`, no `module.exports`) after the base merge resolved that file
to S2's compiled version. Filed; L1's `3e1c06a` fixture-extract split then fixed it, verified here.

## Open follow-ups

_(filled below)_

---

Signed **Clodwig** · `frontend-developer` · 2026-09-07
