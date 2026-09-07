# fd-v2-l6 — Message bus threads + reply toast

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Gerhild** · `frontend-developer` · tag `agent-gerhild` · Claude, high · `/goal` |
| Branch | `agent-v2-l6` off `origin/agent-v2-base`; first action `git merge --no-edit origin/agent-v2-l1` |
| Ledger rows | D13, D08 (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/bus.js` + this screen's methods in `logic.js` |
| Data identifiers | busSessions, busGroups, seedThreads ← FD.data.toThreads(messages, targets, sessions) |
| API | FD.data.messages(), sendMessage(), retryMessage(); sessions() for liveness |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
| Registry group | `fd-v2` |

## Goal (one line)

Make the **Message bus threads + reply toast** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D13, D08 + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. Threads by target; rail Pinned/Recent with previews + timestamps; unread via localStorage `fd-bus-seen`; pinned via `fd-bus-pinned`; badge → `FD.shell.setBadge`.
2. Send / broadcast (Select mode = N POSTs), receipts from status/delivered_at/error, Retry on failed, offline banner + Queue label from liveness, composer ⌘↩ + editable `from` chip (= source), error strings verbatim.
3. Header actions: reader view, maximize, pin, show session (tmux → `FD.screens.windows.openMax`), copy thread; Escape chain per mock.
4. Inbound poll (15 s while open, 60 s otherwise) and the reply toast (mock L769-780: "<from> replied", preview, Open thread, 7 s).
5. Expose `FD.screens.bus.open(target)` in the first commit: selects/creates the thread for `{type,host?,session}` and navigates to the bus screen.

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

- [x] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim. — 41 items: 31 done, 4 done-and-adapted with the reason in `improvised.md`, 1 partial (`maxlength`, absent from the mock's markup), 5 n.a. (server-side). Error strings, `fd-bus-seen`, `fd-bus-pinned`, 15 s / 60 s / 7 s all verbatim.
- [x] `verify/l6/report.json` allPass 36/36 (fixture mode); `verify/l6/live.json` all pass; live screenshots filed. — pixel **36/36 allPass**, max 0.0329 % (registry-dark AA noise; message-bus itself 0.000000 % both themes). Live **47/47 allPass**, 0 console errors, `live-dark.png` + `live-light.png`.
- [x] `improvised.md` entries + screenshots for every improvisation. — I-L6-01..12; six screenshots under `improvised/l6-*.png` (the six visual ones; six entries are data- or behaviour-only).
- [x] Hooks provided are defined; hooks used are guarded. — `FD.screens.bus.open(target)` defined as a no-op in `440fbaa` and wired in `1c330de`; `FD.shell.setBadge` (L2) and `FD.screens.windows.openMax` (L3) wrapped once, proven safe when absent **and** when throwing.
- [x] `npm test` green; branch pushed; `REPORT.md` signed **Gerhild**; registry row `done`. — `npm test` **332/332, 0 fail** (incl. 29 new in `test/v2-bus.test.js`); `agent-v2-l6` pushed; report signed. Registry POST answers 401 from the box (known, see `REGISTRY-PENDING.md`); DECK-49 carries the state.

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-base` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/bus.js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): FD.screens.bus.open(target)
- Hooks you USE: FD.shell.setBadge (L2), FD.screens.windows.openMax (L3)
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l6` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l6/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l6/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l6/live.json` (id, action, expectation, pass) and `verify/l6/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-bus.test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Gerhild**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l6` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
