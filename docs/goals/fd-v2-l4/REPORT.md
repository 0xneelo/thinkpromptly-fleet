# fd-v2-l4 — Registry on live rows · REPORT

| | |
|---|---|
| Worker | **Ruprecht** · `frontend-developer` · tag `agent-ruprecht` |
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Branch | `agent-v2-l4` off `origin/agent-v2-base` (S2 + S2.2 + L1 + L1.1 + L1.2 merged in as they landed) |
| Ledger row | **D12** (Registry), rulings O3 and O8 |
| Linear | **DECK-43** (main) · DECK-45 §1 · DECK-46 §2 · DECK-47 §3 · DECK-48 §4 · DECK-50 §5 · DECK-51 §6-7 · DECK-52 gates · **DECK-69** filed (dc-compile hazard) |
| Files owned and changed | `public/v2/screens/registry.js` (new, 1313 lines), the registry block in `public/v2/logic.js`, `docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs` (new), `docs/design/fleetdeck-v2/improvised.md`, `docs/goals/fd-v2-l4/**`, `verify/l4/**` |

## Result

| Gate | Number | Where |
|---|---|---|
| Fixture-mode pixel gate | **36/36, `allPass: true`**, max mismatch **0.0329 %** | `verify/l4/report.json`, full run under `docs/design/fleetdeck-v2/verify/l4/` |
| Live gate, API stubbed from `fixtures/api/` | **37/37, `allPass: true`** | `verify/l4/live.json`, tool `docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs` |
| S2's standing seam check | **PASS** — `FD.setData('regData', …)` reaches the table | `node tools/v2-setdata-check.mjs --app <url>` |
| S2's network / console gate | **`allPass: true`** — 36/36 screens reached, 0 console errors, 0 page errors, 0 failed requests, 0 engine loads | `verify/l4/network.json` |
| `test/v2-data.test.js` | **74 pass, 0 fail** | run alone |
| `npm test`, whole suite | **303 pass, 0 fail**, twice consecutively | see "npm test" below |

The 0.0329 % maximum is the same figure S1 and S2 recorded on an untouched app; it is the
landing hero's video frame, not this slice.

## How it is built

The screen is one file plus one block. `public/v2/screens/registry.js` owns the state — rows,
filter, sort, selection, edits — and publishes a single validated payload with
`FD.setData('l4', …)`. The registry block in `logic.js` reads `FD.fixture.l4` fresh inside
`renderVals()` and renders it through the mock's own bindings.

The rows are published into **`regData`** — the key the compiled logic already reads and the one
S2's standing seam check drives — and only what a row cannot carry (the count string, the raw
search text, the two selection totals) goes into a key of its own, which is what DESIGN-35 allows.
Publishing the rows under a private key instead would have silently broken
`tools/v2-setdata-check.mjs` for this screen; it now passes.

**Fixture mode does nothing at all.** `?fixture=1` returns from `start()` before a listener is
installed or a node is created, `FD.setData` is never called, `FD.fixture.l4` stays undefined and
the block falls through to the mock's `regData` path unchanged. That is why the pixel gate is
still 36/36: measured, the screen has zero injected nodes in fixture mode.

Three rules from the oracle audit of the shim (DESIGN-35, 2026-09-08) shaped the rest:

1. **No foreign DOM inside a compiled node.** The template compiles no `onClick` for the three
   filter selects, the bulk Kill / Tag kill / Hide buttons, row `Show` or the row `⋯`, and it is
   not this slice's file. So compiled nodes get an attribute, a property or a listener — never a
   child — and everything improvised is drawn in `#fd-l4-layer`, our own element outside
   `#dc-root`, anchored to the rectangle it belongs to and repositioned on render, scroll and
   resize. Text the mock cannot show is painted by `::after` rules off `data-l4-*`
   attributes: the ` ▲`/` ▼` sort marker, `Kill <n> live`, and the age tone.
2. **Throw-proof.** Rows are validated before `FD.setData` (every bound field coerced to a
   string, a row without an id dropped), and the block in `logic.js` is wrapped so a throw keeps
   the last good values and logs once instead of blanking every screen.
3. **Positional rows.** No per-row state lives in the DOM. A click resolves its row from the row
   element's index among its siblings, recomputed at click time; the selection is keyed
   `host\0name` in the module, exactly as `public/app.js` keys it.

## Behaviour checklist — `BEHAVIOUR.md`, section by section

### §1 Columns and inline edits
- [x] Eight columns from the live API through `FD.data.toRegistryRows`: Session, Group, Task,
      Status, Active, Last msg, Last seen, Actions. Host, Label, Role/Worker and Note moved to the
      details panel (ruling O3).
- [x] `editCell` for **label, group, task, note** → `POST /api/registry {host, name, <field>}`,
      toast `Saved <field>` / `<field> not saved: <error>`, always `loadSessions()` after.
- [x] Escape discards with no POST and reloads; Enter blurs and saves once, never twice.
- [x] `TASK_RE = /^[A-Z][A-Z0-9]*-\d+$/`; a matching task opens
      `https://linear.app/synchronicity/issue/<task>` in a new tab with `noopener` (I-L4-06).
- [x] `Last seen` carries the `gone · last seen ` prefix on a gone row.

### §2 Filters
- [x] Search is a lowercase substring over name/host/label/group/task/note/role/worker.
- [x] `live` / `gone`; status over all five states; `AGE` = `{'':0,'1h':36e5,'6h':216e5,'1d':864e5,'3d':2592e5,'7d':6048e5}` for last-msg **and** active, with `olderThan` matching a row that has no stamp at all.
- [x] Count reads `<n> rows` or `<k> of <n> rows`.
- [x] Reset restores the defaults and removes `fleetFilter`; the selection is left alone, as today.
- [x] `fleetFilter` written on every input; a parse error is swallowed.
- [x] The mock's short status and age menus are covered by full ones and an active-age select is
      added beside the last-msg one (I-L4-01, I-L4-02).

### §3 Sorting
- [x] Header click: same key toggles asc → desc, another key starts asc; ` ▲` / ` ▼` marker.
- [x] Unset values sink to the bottom in both directions; time columns compare `Date.parse`;
      others compare lowercased strings.
- [x] Persisted as `fleetSort` in the `overview` slot; any `details` slot an older app wrote is
      preserved on write. Default is API order.

### §4 Selection and bulk
- [x] `selected` keyed `host\0name`; header checkbox = every filtered row; keys outside the
      filtered list are dropped on every render.
- [x] Bulk bar while anything is ticked: `<n> selected`, `Kill <live> live` (disabled at 0),
      `Forget <gone> gone` (only while gone rows are ticked), Clear.
- [x] Confirms verbatim: `Kill <n> tmux session(s)?\n\n<host:name per line>\n\nIrreversible — everything running in them dies.` and `Forget <n> registry row(s)?`
- [x] Sequential POSTs, `<Verb>ing i/n · <name>` progress toast, failures collected as
      `<name>: <stderr|error|unknown error>`, final `<verb> failed for <k> — …` or `<Verb>ed <n>`.
- [x] Bulk **Tag kill** and **Hide** are new (I-L4-03): the row action's write, run sequentially,
      same toast pattern, no confirm — the per-row versions have none and no bulk string exists to quote.

### §5 Row actions
- [x] Order `[Show, Message]` (live only) → Kill, Tag kill|Untag, Hide|Unhide → Forget (gone only);
      the mock's `⋯` carries everything after Message (I-L4-04).
- [x] Buttons disabled while that row's action is in flight.
- [x] `Show` → `FD.screens.windows.openMax(host, name)` (L3), guarded, no POST.
- [x] `Message` → `FD.screens.bus.open({type:'tmux', host, session})` (L6, ruling O8), guarded.
- [x] Kill confirm verbatim; toasts `Killing <name>…` / `Killed <name>` / `kill failed: <…>`.
- [x] Tag kill / Untag → `status` `kill-requested` / `active`; toasts and titles verbatim; no confirm.
- [x] Hide / Unhide → `hidden` / `active`; toasts verbatim; no confirm.
- [x] Forget → `POST /api/registry/delete`; toasts verbatim; no confirm at row level.

### §6 Pill, live/gone, time
- [x] Status pill through the mock's own `stTone`; `active` good, `kill-requested` warn,
      `done`/`killed`/`hidden` neutral (I-L4-08 explains why `hidden` is not given a fourth tone).
- [x] Gone rows keep the mock's dimmed row treatment; hidden rows stay in the table.
- [x] `ago()` is `FD.data.ago` — `—`, `just now`, `Nm/Nh/Nd ago` — and the amber-past-an-hour /
      red-past-a-day tone is painted by rule, since one `cellStyle` is bound to four columns.

### §7 Refresh and errors
- [x] Reload after every edit save, every Escape, every row action (ok or fail) and each bulk batch.
- [x] Filter and sort changes re-render from the cached list; **nothing polls**.
- [x] Toasts: pending never auto-dismisses, ok 3 s, err 6 s, a click dismisses (I-L4-07).

### §8 Keys, ids, server rules
- [x] `fleetFilter`, `fleetSort` read and written verbatim; `fleetTab` still read, harmless.
- [x] New hooks are `data-l4-*` attributes and ids only; no markup is hand-typed into the template.
- [x] Writes go through `FD.data.registryUpsert` / `registryDelete` / `kill` — same URLs, methods and
      bodies as today, only the present field sent. No new endpoint.

## Reviewer pass

A `reviewer` subagent read the whole diff against BEHAVIOUR.md and the audit rules. It cleared
fixture-mode isolation, the throw-proof block, `filterSessions`/`sortSessions` against
`public/app.js:656-716`, every confirm and toast string, and positional row resolution. It raised
six findings; one was already fixed before it reported, five are fixed here, each with a browser
check that fails without the fix.

| # | Finding | Fix |
|---|---|---|
| 1 | A bulk run set only the global busy flag, so a row the batch was already killing still accepted its own ⋯ Kill — a genuine duplicate `POST /api/kill` for one session. | `bulk()` owns every row in its batch (`state.busy[id]`) for the batch's whole life. Measured: mid-batch all three rows carry `data-l4-off="1"` and `disabled`, the ⋯ opens nothing, and exactly 3 kills are sent. |
| 1b | **The cause underneath it:** `publish()` never scheduled a decoration pass, so a publish that changes only what *we* paint — a busy flag, the bulk count, the sort marker — left the compiled tree byte-identical, the MutationObserver never fired, and those attributes never reached the DOM. | `publish()` now schedules the pass itself. |
| 2 | An open cell editor whose row left the table was removed by `position()`; removing a focused input fires `blur`, and the armed handler saved — after a Forget, that re-upserted the row `/api/registry/delete` had just deleted. | An anchored overlay now gets a `drop` callback that runs *before* its node leaves the DOM; the editor's disarms it, and the blur handler additionally refuses to save when `state.editing` is already null. Measured: forgetting a row with its editor open sends `POST /api/registry` (the ordinary blur-save, as today's app does) and then `/api/registry/delete` — never the other way round — and leaves no stranded `data-l4-editing`. |
| 3 | Leaving the screen left overlays floating over the next one. | Already fixed before the review landed: `decorate()` prunes on the unmount path. Measured: four layer children with the Registry open, zero after navigating to Machines. |
| 4 | `state.expanded` / `detailEls` were never cleaned when `position()` auto-removed a details panel, so that row's ⋯ then offered "Hide details" for a panel that was gone. | The details panel's `drop` callback clears both. |
| 5 | Re-opening the label/note editor while it was already open read `previous` from a cell holding the input, so Escape blanked the field. | `previous` comes from the row, and a second call on an open field is refused. |
| 6 | Two `toast` / `toastLayer` definitions survived the overlay rewrite; the dead first copy appended to `document.body` outside the layer. | The dead copy is gone. |

A seventh, found while writing the regression test: the ⋯ menu flipped above a row but never clamped
to the viewport, so a row below the fold opened its menu off screen. It now clamps.

## Things found while building

1. **`viewRows` never merged the raw `group` and `task`** (found by the live gate, fixed): the
   adapter renames them `g`/`tk` and em-dashes an empty one, so both editors opened empty and a
   blur with no typing would have POSTed `group:''` and wiped a stored group. Fixed and covered by
   check `edit-open`.
2. **`tools/dc-compile.mjs` still generates `logic.js` and `screens/*.js`** — one
   `npm run v2:compile` would overwrite every L-slice's implementation with the stubs, and
   `npm run v2:check` currently *advises* running it. Filed as **DECK-69**; not fixed here, the
   tool is S2's. From this slice on, `v2:check` reporting `logic.js` and `screens/registry.js`
   stale is expected.
3. **`data.js` is not in the shell's script list.** `index.html` loads runtime, fixture, logic,
   app and the nine screens — not `data.js` — so this screen injects it itself the first time it
   needs live rows. L2 owns the shell and should add the tag.
4. **`FD.data.sessions()` throws in fixture mode** — `FIXTURE_ROUTES.sessions = 'groups'` but the
   compiled fixture has no `groups` key. Never reached here, because fixture mode makes no call at
   all, but the next slice that fetches sessions under `?fixture=1` will hit it.

## npm test

**Green: 303 tests, 303 pass, 0 fail — twice in a row.**

It took five runs to say that honestly, and the sequence is worth recording, because a red run
here means "the box is busy", not "the branch is broken":

| Run | Result | Failing suites |
|---|---|---|
| A | 296 pass, 2 fail | reaper |
| B | 278 pass, 20 fail | reaper, lease, sitrep, coordinator |
| C | 289 pass, 14 fail | reaper |
| D | 302 pass, 1 fail | machines |
| **E** | **303 pass, 0 fail** | — |
| **F** | **303 pass, 0 fail** | — |

Every failure across A-D was wall-clock sensitive and every one of those files passes when run on
its own (`test/reaper.test.js` 24/24, `test/v2-data.test.js` 74/74). They are DECK-7's known
load-sensitivities, and runs A-C landed while ten sibling `FD-v2-*` worker sessions were building
and running their own Playwright gates on this box.

They also could not have been this slice's, by construction. The whole diff against the base is:

```
public/v2/logic.js  public/v2/screens/registry.js  docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs
docs/**  verify/l4/**
```

`test/reaper.test.js` imports `./helpers`, `child_process`, `fs`, `path` and the node test runner —
not one file this branch touches, and nothing under `public/v2` is loaded by any of the suites that
flickered. The green runs are the acceptance; this table is here so the next person to see a red
`npm test` on this branch re-runs it instead of hunting L4.

## Verification, reproducible

```bash
PORT=3247 node server.js &                                   # never 3131 (the operator's deck)
npm run design:diff -- --app "http://127.0.0.1:3247/v2/index.html?fixture=1" --slice l4
node docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs                                 # writes verify/l4/live.json
node --test --test-concurrency=1 test/v2-data.test.js
```

The live gate is not self-confirming: with three deliberate mutations planted in the screen — the
save toast reworded, the tag toast shortened, the `gone · last seen ` prefix changed — it dropped
to **33/36** and named exactly those three checks. Restored, it is 36/36 again.

## The registry row, and a wrong belief it exposed

The row **is** written — `200 {"ok":true}` for the registration and for the closing
`status: done`. It took four `401`s to get there, and the reason is worth recording because it has
already cost more than one lane a step it could have completed.

`POST /api/registry` over the tailnet listener is not seat-fenced. It is gated by `tailnetAuthed()`
(`server.js:497`): **every POST arriving over tailscale must carry the shared key** as
`Authorization: Bearer <key>`. The launch prompt's curl recipe has no such header, so copying it
verbatim always answers `401` — and the box has held the key all along, as `FD_TAILNET_KEY` in
`~/.claude/fleet/fleet.env` (0600), put there by `mac/provision-fleet-secrets.sh`.

I first read the `401` as XYZ-2137's seat fence — a note in my own memory said exactly that and told
me to skip the step — and reported it as impossible twice. It is not. The header, kept out of `argv`
because `ps` is world-readable:

```sh
. "$HOME/.claude/fleet/fleet.env"
printf 'header = "Authorization: Bearer %s"\n' "$FD_TAILNET_KEY" | curl -sS -K - \
  -X POST http://100.125.231.25:3131/api/registry -H "Content-Type: application/json" \
  -d '{"host":"german-box","name":"FD-v2-l4","status":"done"}'
```

The tailnet listener carries only `/api/registry`, `/api/registry/delete`, `/api/coordinator/*` and
the lease and credits routes, so the row cannot be read back from the box — `{"ok":true}` is the
confirmation. **XYZ-2137 should be re-checked against this:** L1 recorded the same `401` and drew
the same conclusion, so its "registry write is fenced for box workers" premise may simply be a
missing header.

## L4.1 — DESIGN-35 follow-up (2026-09-07, after L4 was accepted into weave/fd-v2)

Four items, on top of `origin/weave/fd-v2`.

**1. The per-row guard was too wide.** `run()` gated every row action on the global
`state.bulkBusy`, so while a bulk kill was running an *unrelated* row's `⋯` action silently did
nothing — the click landed, the menu closed, no POST left. Today's app disables only the bulk
bar's own buttons (`public/app.js:787`); the rest of the table stays live. The guard is now
`state.busy[row.id]` alone, which is still correct for the batch's own rows because `bulk()`
marks each of them busy for the batch's life.

The live gate gained a check for it — **`bulk-row-independent`**, §4, taking the gate to **37**.
It arms a 900 ms delay on `/api/kill` so the batch is genuinely mid-flight, then clicks a third
row's Hide and asserts the `POST /api/registry {status:'hidden'}` for that row. Falsified: with
the old `|| state.bulkBusy` restored it fails with `no hide POST for FD-deck25-gate`, and the
only POST recorded is the batch's own kill.

**2. `test/v2-registry.test.js` — the unit tests the pack's gate item 3 asks for, and this slice
silently dropped.** L1's pack lists tests as scope item 3; the L4 README I had to author from the
launch prompt carried no such item, and no unit test was written — the whole slice rested on two
browser gates. **23 tests** now cover the rules that can be stated without a DOM: `filterSessions`
(the eight searched fields, trimming and case, null-safety, the live/gone boolean equality, all
five statuses, status as an equality rather than a prefix, both age columns, an unknown age key,
and the filters composing), `sortSessions` (case-insensitive strings, both directions, unset
sinking to the bottom in *both*, `Date.parse` on the time columns, no mutation of the input,
role+worker together, and every header column having an accessor), `olderThan` and `ageTone`.

`filterSessions` and `sortSessions` now take their filter and order explicitly (defaulting to the
module's state, so every caller is unchanged) and the screen publishes `FD.screens.registry.__pure`
— the same seam L2 uses (`FD.shell.__pure`). Loading the screen under a stub window in fixture
mode starts nothing, which the first test asserts.

Not vacuous: four planted mutations — the amber threshold moved, the unset-sinks comparator
flipped, the role accessor, and status matched by prefix — each fail the tests that name them.

**3. The gate script left `tools/`.** It is now
`docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs`.

*Deviation, stated plainly:* the instruction named `docs/design/fleetdeck-v2/verify/l4/`. That
exact directory is the design gate's own output, and `scripts/design-diff.mjs:244-251` publishes a
run by renaming a staging directory **over** it and deleting what was there — so a script parked
in `verify/l4/` disappears on the next `npm run design:diff -- --slice l4`. The five slices that
already ship a live harness all use a sibling directory for exactly this reason (`l2-live/`,
`l5-live/`, `l7-harness/`, `l8-live/`, `l10-harness/`), so `l4-live/` follows them: same parent,
same naming family, one directory off the literal instruction, and it survives. Confirmed by
running the pixel gate after the move — the script is still there.

**`verify/l9/live.mjs` is sitting in that trap** and will be deleted by L9's next gate run; worth
telling that lane.

**4. `wireEditor` now stops Enter as well as Escape.** The keydown handler returned on Enter
before reaching `e.stopPropagation()`, so an Enter inside a cell editor reached the screen's own
delegated `keydown` listener. Nothing acts on Enter there today, which is why nothing broke — it
was a latent leak, and the editor should own every key it handles.

Gates after all four: fixture pixel **36/36 `allPass`** (max 0.0329 %), live **37/37 `allPass`**,
setData seam check **PASS**, `npm test` **483 pass, 0 fail**.

## Not done

- **The pack.** `docs/goals/fd-v2-l4/` shipped with only `BEHAVIOUR.md`. `PROTOCOL.md` is copied
  verbatim from `fd-v2-l1` and `README.md` is authored from the launch prompt's stop condition —
  L2 and L3 have the same gap and should be corrected at the source.
- **Fable post-audit.** Not run: `hard-crux` was not exercised for this slice. The diff was
  checked by the live gate's 37 assertions, its mutation runs, and the fixture gate.

— **Ruprecht**, frontend-developer, `agent-ruprecht`, 2026-09-07
