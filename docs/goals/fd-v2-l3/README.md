# fd-v2-l3 — Windows tiles + Session full screen (xterm engine)

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Gottlieb** · `frontend-developer` · tag `agent-gottlieb` · Claude, high · `/goal` |
| Branch | `agent-v2-l3` off `origin/agent-v2-base`; first action `git merge --no-edit origin/agent-v2-l1` |
| Ledger rows | D09, D10 (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/windows.js` + this screen's methods in `logic.js` |
| Data identifiers | tiles (name/box/footer per open tile; body = xterm mount live, seed lines in fixture mode) |
| API | FD.data.sessions(); WebSocket /term per tile |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
| Registry group | `fd-v2` |

## Goal (one line)

Make the **Windows tiles + Session full screen (xterm engine)** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D09, D10 + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. Port the xterm engine from `public/app.js:1020-1179` (BEHAVIOUR §1–§4): dedupe key, WS URL + JSON frames, resize path, stall 15 s text, dead overlay + Reconnect, copy-on-select, close never kills, Connect all 500 ms stagger, shift+Esc, one maximized tile.
2. Tile body: fixture mode renders the seed lines (pixel gate); live mode mounts xterm in the same box with font-size/line-height/colours from the mock tokens (improvise + document the xterm theme). Footer = registry `label/role/task` (decide + document).
3. Session full screen (mock L781-815) = maximize: ≡ menu lists live sessions (dot, name, host) = the old drawer switcher; Message → `FD.screens.bus.open({type:"tmux",host,session})`; Close restores; Escape (mock chain) AND shift+Esc restore.
4. Empty state (ruling): "There are no sessions yet, open a new session via an orchestrator first." in mock tokens when no tile is open; improvise + screenshot.

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

- [x] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim. — §1-§7 checklist in `REPORT.md`; every text, timer and frame verbatim from the spec.
- [x] `verify/l3/report.json` allPass **36/36** (max 0.033 %, Windows and Session full screen 0.000000 %); `verify/l3/live.json` **37/37** allPass; `live-dark.png` and `live-light.png` filed.
- [x] `improvised.md` entries `I-L3-01`..`I-L3-10`, five with screenshots under `improvised/`.
- [x] The four provided hooks were defined as no-ops in the first commit (`096270c`) and are fixture-guarded; `FD.screens.bus.open` and `FD.shell.selectSession` are both called through guards.
- [x] `npm test` **309/310** — the one failure is a rotating flake among the port-binding HTTP tests, a different one each run, each passing on its own; unrelated to this slice (numbers and evidence in `REPORT.md`); branch pushed; `REPORT.md` signed **Gottlieb**; the registry row could not be written — the box's registry POST answers `401 unauthorized` (XYZ-2137), recorded on DECK-42.

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-base` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/windows.js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): FD.screens.windows.openTile(host,name), openMax(host,name), connectAll(), closeTile(host,name)
- Hooks you USE: FD.screens.bus.open (L6), FD.shell.selectSession (L2)
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l3` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l3/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l3/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l3/live.json` (id, action, expectation, pass) and `verify/l3/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-windows.test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Gottlieb**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l3` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
