# fd-v2-l4 — Registry on live rows

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
| Registry group | `fd-v2` |

## Goal (one line)

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

- [ ] `verify/l4/report.json` — fixture mode, `allPass` true, 36/36.
- [ ] `verify/l4/live.json` — all pass, API stubbed from `docs/design/fleetdeck-v2/fixtures/api/`.
- [ ] `npm test` green.
- [ ] Every BEHAVIOUR.md section reproduced: texts, confirms, localStorage keys and timers verbatim.
- [ ] Every improvised gap documented in `docs/design/fleetdeck-v2/improvised.md` with a screenshot.
- [ ] Branch `agent-v2-l4` pushed.
- [ ] `REPORT.md` signed **Ruprecht**, with the behaviour checklist.
- [ ] Main Linear issue DECK-43 Done; fleet registry row `done`.

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
