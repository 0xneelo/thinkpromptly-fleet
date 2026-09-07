# fd-v2-l4 — Registry on live rows · REPORT

| | |
|---|---|
| Worker | **Ruprecht** · `frontend-developer` · tag `agent-ruprecht` |
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Branch | `agent-v2-l4` off `origin/agent-v2-base` (S2 + S2.2 + L1 + L1.1 + L1.2 merged in as they landed) |
| Ledger row | **D12** (Registry), rulings O3 and O8 |
| Linear | **DECK-43** (main) · DECK-45 §1 · DECK-46 §2 · DECK-47 §3 · DECK-48 §4 · DECK-50 §5 · DECK-51 §6-7 · DECK-52 gates · **DECK-69** filed (dc-compile hazard) |
| Files owned and changed | `public/v2/screens/registry.js` (new, 1313 lines), the registry block in `public/v2/logic.js`, `tools/v2-live-check.mjs` (new), `docs/design/fleetdeck-v2/improvised.md`, `docs/goals/fd-v2-l4/**`, `verify/l4/**` |

## Result

| Gate | Number | Where |
|---|---|---|
| Fixture-mode pixel gate | **36/36, `allPass: true`**, max mismatch **0.0329 %** | `verify/l4/report.json`, full run under `docs/design/fleetdeck-v2/verify/l4/` |
| Live gate, API stubbed from `fixtures/api/` | **36/36, `allPass: true`** | `verify/l4/live.json`, tool `tools/v2-live-check.mjs` |
| S2's standing seam check | **PASS** — `FD.setData('regData', …)` reaches the table | `node tools/v2-setdata-check.mjs --app <url>` |
| `test/v2-data.test.js` | **74 pass, 0 fail** | run alone |
| `npm test`, whole suite | **not green — see "npm test" below** | 298 tests |

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

**Not green, and not from this slice.** The whole suite is 298 tests; run in isolation every
suite passes, including the only one this slice can affect:

| Run | Result |
|---|---|
| `test/v2-data.test.js` alone | **74 pass, 0 fail** |
| `test/reaper.test.js` alone | **24 pass, 0 fail** |
| `npm test`, whole suite, run A | 296 pass, 2 fail |
| `npm test`, whole suite, run B | 278 pass, 20 fail |

The failures move between runs and land in the reaper, lease, sitrep and coordinator suites — M3
to M7, M15, S5 — none of which touch `public/v2`. They are the load-sensitivities DECK-7 already
records, made worse by the sibling worktrees running their own servers and suites on this box at
the same time. I did not chase them: they are outside this slice and they do not reproduce alone.
The honest statement is that **L4 adds no failing test, and `npm test` is not green on this box.**

## Verification, reproducible

```bash
PORT=3247 node server.js &                                   # never 3131 (the operator's deck)
npm run design:diff -- --app "http://127.0.0.1:3247/v2/index.html?fixture=1" --slice l4
node tools/v2-live-check.mjs                                 # writes verify/l4/live.json
node --test --test-concurrency=1 test/v2-data.test.js
```

The live gate is not self-confirming: with three deliberate mutations planted in the screen — the
save toast reworded, the tag toast shortened, the `gone · last seen ` prefix changed — it dropped
to **33/36** and named exactly those three checks. Restored, it is 36/36 again.

## Not done

- **Fleet registry row.** `POST http://100.125.231.25:3131/api/registry` answers `401 unauthorized`
  from the box; registry writes are seat-epoch fenced and a box worker holds no seat (XYZ-2137).
  Same wall Juergen hit in L1. Recorded in `LINEAR-PENDING.md`, no new gate filed.
- **The pack.** `docs/goals/fd-v2-l4/` shipped with only `BEHAVIOUR.md`. `PROTOCOL.md` is copied
  verbatim from `fd-v2-l1` and `README.md` is authored from the launch prompt's stop condition —
  L2 and L3 have the same gap and should be corrected at the source.
- **Fable post-audit.** Not run: `hard-crux` was not exercised for this slice. The diff was
  checked by the live gate's 36 assertions, its mutation run, and the fixture gate.

— **Ruprecht**, frontend-developer, `agent-ruprecht`, 2026-09-07
