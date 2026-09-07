# fd-v2-l2 — app shell: sidebar · page header · right rail

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Renate** · `frontend-developer` · tag `agent-renate` · Claude, high · `/goal` |
| Branch | `agent-v2-l2` off `origin/agent-v2-base`; first action `git merge --no-edit origin/agent-v2-l1` |
| Ledger rows | D03, D04, D05 (+ D06 key migration with L1) (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/shell.js` + this screen's methods in `logic.js` |
| Data identifiers | groups ← FD.data.toGroups(sessions); rail/header values through the shell methods in logic.js |
| API | FD.data.sessions(), health(), credits() |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
| Registry group | `fd-v2` |

## Goal (one line)

Make the **app shell: sidebar · page header · right rail** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D03, D04, D05 (+ D06 key migration with L1) + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. Sessions list from `/api/sessions` grouped by box (count chips), hidden-rows toggle (`showHidden`, improvise its place), row click → `FD.screens.windows.openTile` / `openMax` while maximized, `⤢` per row → `openMax`, open-tile dot state.
2. Connect all → `FD.screens.windows.connectAll()` (L3 owns the engine). Refresh (header) → sessions + health + credits reload, exactly today's three loads.
3. Right rail: Accounts mini bars from `/api/credits` (pct rule + thresholds, BEHAVIOUR §3) with provider logos; Boxes list from `/api/health` with the exact pill texts and tones of BEHAVIOUR §2.
4. Page header per screen: title/subtitle from the template `titles` map; "Live API" pill text via `FD.shell.setLiveApi(text)` (L5 uses it, ruling O4); Message bus unread badge via `FD.shell.setBadge(n)` (L6 calls it).
5. Theme toggle uses `FD.data.theme()` (L1 migration `fleetTheme` → `fd-landing-dark`); sidebar collapse and video toggle stay as the mock has them.

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

- [ ] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim.
- [ ] `verify/l2/report.json` allPass 36/36 (fixture mode); `verify/l2/live.json` all pass; live screenshots filed.
- [ ] `improvised.md` entries + screenshots for every improvisation.
- [ ] Hooks provided are defined; hooks used are guarded.
- [ ] `npm test` green; branch pushed; `REPORT.md` signed **Renate**; registry row `done`.

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-base` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/shell.js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): FD.shell.setBadge(n), FD.shell.setLiveApi(text), FD.shell.refresh(), FD.shell.selectSession(host,name)
- Hooks you USE: FD.screens.windows.openTile/openMax/connectAll (L3)
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l2` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l2/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l2/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l2/live.json` (id, action, expectation, pass) and `verify/l2/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-shell.test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Renate**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l2` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
