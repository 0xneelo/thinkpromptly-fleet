# fd-v2-l1 — REPORT

| | |
|---|---|
| Worker | **Juergen** · `frontend-developer` · tag `agent-juergen` |
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Slice | L1 — data layer, fixture mode, v2 routing (ledger D06, D18–D20) |
| Branch | `agent-v2-l1` off `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` |
| Linear | **DECK-33** (main) · DECK-34 … DECK-38 (subtasks) |
| Date | 2026-09-07 |

> Status: **draft — filled in as milestones land.** The shape table, test results and the
> acceptance checklist below are completed before this report is signed.

## What shipped

| File | What it is |
|---|---|
| `public/v2/data.js` | 19 fetchers (one per endpoint the current app uses), 9 pure adapters, fixture mode, `poll()`, `theme()` |
| `public/v2/router.js` | `?view=land\|app\|deck` + `#screen` hash routing, `route()` / `navigate()` / `onChange()` |
| `public/v2/fixture.js` | **generated** — the mock's seed arrays, extracted verbatim |
| `public/v2/orgchart.js` | byte-identical copy of `public/orgchart.js` |
| `tools/extract-fixture.mjs` | the extractor; `npm run v2:fixture` / `v2:fixture:check` |
| `test/v2-data.test.js` | adapters vs the captured API fixtures and vs the mock seed arrays; every fetcher's URL/method/body |
| `server.js` | one ternary arm so a directory URL serves its `index.html` |
| `docs/design/fleetdeck-v2/improvised.md` | 10 improvisation entries (I-L1-01 … I-L1-10) |

## The design decision that shaped the slice

The mock's seed arrays are not data. They are local `const`s inside `AppLogic.renderVals()`
(`mock/Fleetdeck Final.dc.html` L1245–L2004) whose elements mix three layers: plain values,
theme-derived style objects (`dot(t.good)`, `chipTone('neutral')`, `bar(...)`), and closures added by
trailing `.map()` chains (`openTerm`, `toggle`, `copyConv`).

**L1 emits the data layer only** — exactly the fields `diff.md` §"Binding map" names. Styles are
rebuilt per render from the theme token object `t`, so a row carrying baked styles would render wrong
in the other theme and could not pass a pixel gate that runs both. Closures are the screen slices'
job. The binding map corroborates the line independently: for the org chart it lists the *arguments*
of `orgCard()`, not its returned keys.

Consequence for S2 and L2–L10: the compiled template keeps `dot`/`chipTone`/`bar`/`mSec`/`spark` and
`t`, and applies them at render time to rows from `FD.data` — which is what `renderVals()` already
does; only the source of the array changes. L1 adds no rendering and touches none of S2's files.

Full reasoning and the nine other decisions: `docs/design/fleetdeck-v2/improvised.md`.

## Shape table

_(one row per seed array — filled in from the adapter comparison run)_

## Verification

_(filled in: `npm test`, fixture idempotence, `/v2/` smoke test, reviewer findings)_

## Acceptance

_(the README checkboxes, each with its evidence)_

## Notes for the design seat

_(carried forward from the run)_

—
**Juergen** · frontend-developer
