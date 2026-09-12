# fd-v2-l4 — Registry on live rows

<<<<<<< HEAD
> **Pack note.** This directory shipped with only `BEHAVIOUR.md`. `PROTOCOL.md` is copied verbatim from
> `fd-v2-l1`; this README is authored by the worker from the launch prompt's stop condition and the L1
> template, so the acceptance boxes have a home. Recorded in `LINEAR-PENDING.md` and on DECK-43.

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Ruprecht** · `frontend-developer` · tag `agent-ruprecht` · Claude, high, `/goal` |
| Branch | `agent-v2-l4` off `origin/agent-v2-base` (S2 + L1 already merged into the base) |
| Design seat | 🎨 DESIGN 35 (`docs/design/fleetdeck-v2/plan.md`, ledger row **D12**) |
| Linear | main **DECK-43**; sub-issues DECK-45 (§1), DECK-46 (§2), DECK-47 (§3), DECK-48 (§4), DECK-50 (§5), DECK-51 (§6-7), DECK-52 (§8 + gates) |
=======
| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Ruprecht** · `frontend-developer` · tag `agent-ruprecht` · Claude, high · `/goal` |
| Branch | `agent-v2-l4` off `origin/agent-v2-base`; first action `git merge --no-edit origin/agent-v2-l1` |
| Ledger rows | D12 (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/registry.js` + this screen's methods in `logic.js` |
| Data identifiers | regData ← FD.data.toRegistryRows(sessions) |
| API | FD.data.sessions(), registryUpsert(), registryDelete(), kill() |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
>>>>>>> claude/fleetdeck-v2-redesign-plan-5a5cd5
| Registry group | `fd-v2` |

## Goal (one line)

<<<<<<< HEAD
Make the Registry screen work on live data exactly like today's app — `docs/goals/fd-v2-l4/BEHAVIOUR.md`
is the spec — inside the mock's markup, fed only through `FD.setData` with adapters from `FD.data`.

## Scope

**In**
1. `public/v2/screens/registry.js` — the whole screen: load, filter, sort, select, edit, act.
2. The registry screen's methods in `public/v2/logic.js` — nothing else in that file.
3. `docs/design/fleetdeck-v2/improvised.md` — one entry per gap the mock leaves, each with a screenshot.
4. `verify/l4/` — the fixture-mode pixel gate and the live-data run.
5. `docs/goals/fd-v2-l4/REPORT.md` — signed, with the BEHAVIOUR checklist section by section.

**Out** — never edited: `public/v2/index.html`, `runtime.js`, `app.js`, `template.dc.html`, `data.js`,
`fixture.js`, every other screen file and every other screen's methods in `logic.js`, the mock, the old UI.
No new server endpoints. No merge of another L-branch.

## Hooks

- **Provided** (defined as no-ops in the first commit, real later): `FD.screens.registry.open({q?, host?})`.
- **Consumed, always guarded**: `FD.screens.windows.openMax(host, name)` (L3), `FD.screens.bus.open(target)` (L6).

## Acceptance (definition of done)

- [x] `verify/l4/report.json` — fixture mode, `allPass` true, **36/36**, max mismatch 0.0329 %
      (the figure S1 and S2 recorded on an untouched app). Full run with its PNG pairs under
      `docs/design/fleetdeck-v2/verify/l4/`.
- [x] `verify/l4/live.json` — **37/37, `allPass` true** (36 at L4, plus `bulk-row-independent`
      from L4.1), API stubbed from
      `docs/design/fleetdeck-v2/fixtures/api/` by `docs/design/fleetdeck-v2/verify/l4-live/live-check.mjs`. Falsified by planting
      three mutations in the screen: it dropped to 33/36 and named exactly those three checks.
- [x] `npm test` green — **303 tests, 303 pass, 0 fail**, twice in a row. The suite is
      load-sensitive on this box (earlier runs, with ten sibling worker sessions building at once,
      lost 1 to 20 tests in the reaper / lease / sitrep / coordinator suites — DECK-7); every one of
      those passes on a re-run and none of them import a file this branch touches. The green runs
      are the acceptance; the variance is recorded in `REPORT.md` so nobody reads a red run as L4's.
- [x] Every BEHAVIOUR.md section reproduced: texts, confirms, localStorage keys and timers verbatim
      — section-by-section checklist in `REPORT.md`.
- [x] Every improvised gap documented in `docs/design/fleetdeck-v2/improvised.md` (I-L4-01..08) with
      eight screenshots under `docs/design/fleetdeck-v2/improvised/l4/`.
- [x] Branch `agent-v2-l4` pushed.
- [x] `REPORT.md` signed **Ruprecht**, with the behaviour checklist.
- [x] Main Linear issue DECK-43 Done; fleet registry row written — `200 {"ok":true}` for both the
      registration and the closing `status: done`. The `401` three earlier attempts hit was a
      missing `Authorization: Bearer $FD_TAILNET_KEY`, not the seat fence of XYZ-2137; the launch
      recipe omits that header and the box has held the key all along.

## Constraints

- Fixture mode (`?fixture=1`) stays pixel-identical and **never calls `FD.setData`** — the compiled logic
  renders `FD.fixture` as-is (DESIGN-35, 2026-09-07). Live mode only loads data.
- No hand-typed markup; new hooks are `data-*` / `id` only.
- Texts, confirm strings, localStorage keys (`fleetFilter`, `fleetSort`, `fleetTab`) and timers verbatim
  from BEHAVIOUR.md.
- Linear unreachable is never a blocker — `LINEAR-PENDING.md`, `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push; 503 = `operator:gate` on that step only.
- Never touch the operator's deck at `localhost:3131`; never edit `docs/design/fleetdeck-v2/mock/**`.

## Execution protocol

`PROTOCOL.md` in this directory. You execute; you never orchestrate.
=======
Make the **Registry on live rows** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D12 + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. Filters (search, live/gone, status, last-msg + the active-age filter improvised in the mock select style), count text, Reset, persistence `fleetFilter`; column sort with `fleetSort.overview`.
2. Selection + bulk bar: Kill (confirm verbatim), Tag kill, Hide, Clear per mock; Forget for gone rows when selected (improvise); sequential POSTs with the toast pattern of BEHAVIOUR §4.
3. Row actions: Show → `FD.screens.windows.openMax`; Message → `FD.screens.bus.open`; ⋯ menu (improvise in mock tokens): Kill / Tag kill|Untag / Hide|Unhide / Forget / Edit label·group·task·note (inline inputs, POST bodies of BEHAVIOUR §1); details expand row for host/label/role/note.
4. Status pill tone map, `tr.gone` greying, `ago()` classes, error strings verbatim; `loadSessions()` after every action.

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

- [ ] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim.
- [ ] `verify/l4/report.json` allPass 36/36 (fixture mode); `verify/l4/live.json` all pass; live screenshots filed.
- [ ] `improvised.md` entries + screenshots for every improvisation.
- [ ] Hooks provided are defined; hooks used are guarded.
- [ ] `npm test` green; branch pushed; `REPORT.md` signed **Ruprecht**; registry row `done`.

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-base` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/registry.js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): FD.screens.registry.open({q?, host?})
- Hooks you USE: FD.screens.windows.openMax (L3), FD.screens.bus.open (L6)
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l4` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l4/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l4/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l4/live.json` (id, action, expectation, pass) and `verify/l4/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-registry.test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Ruprecht**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l4` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
>>>>>>> claude/fleetdeck-v2-redesign-plan-5a5cd5
