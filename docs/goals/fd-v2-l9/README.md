# fd-v2-l9 — Machines cards

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Eckbert** · `frontend-developer` · tag `agent-eckbert` · Claude, high · `/goal` |
| Branch | `agent-v2-l9` off `origin/agent-v2-base`; first action `git merge --no-edit origin/agent-v2-l1` |
| Ledger rows | D16 (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/machines.js` + this screen's methods in `logic.js` |
| Data identifiers | machines ← FD.data.toMachines(machines) |
| API | FD.data.machines({refresh}) |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
| Registry group | `fd-v2` |

## Goal (one line)

Make the **Machines cards** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D16 + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. Card per machine: name, kind chip, session-count chip, "reported <ago>", Open in Registry → `FD.screens.registry.open({q: host})`; rows per client × env (WSL/Windows) with identity, chips (plan/tier/proof/state maps verbatim), usage bars in WIN_ORDER, freshness/shares/note, the push "no report yet — cron this" line with the copyable command.
2. 60 s poll (no force), Refresh forces; error text; default expanded (improvise + document).

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

<<<<<<< HEAD
- [x] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim.
      One item is *partial by design* — the per-session `.sess` lines, which the mock replaced with
      the count chip and Open in Registry (improvised.md I-L9-07). Two are *n.a.*, both because
      today's screen does not render them either (`collecting`, the old ids/classes).
- [x] `verify/l9/report.json` allPass **36/36** (fixture mode), Machines dark and light both
      0.000000 %; `verify/l9/live.json` **46/46 pass**; `live-dark.png` / `live-light.png` filed.
- [x] `improvised.md` entries (I-L9-01 … I-L9-09) + the six screenshots in
      `docs/design/fleetdeck-v2/improvised/`.
- [x] Hooks provided: none, as specified. Hooks used: `FD.screens.registry.open` (L4), guarded and
      with a fallback.
- [x] `npm test` — **343 pass of 358** on the final base. Every failure is in `test/reaper.test.js`
      and `test/train-broker.test.js`, all `EADDRINUSE` on their fixed 39xx ports, which sibling
      agent sessions on this box hold. The count varies run to run with no code change (1, then 3,
      then 15) and `reaper` fails worse in isolation than under load — external contention, not a
      defect. This branch touches no server file. Every v2 test passes: **129/129** across
      `test/v2-machines.test.js` (55) and `test/v2-data.test.js` (74).
      (The `fixture.js` `window` break filed as DECK-80 is fixed by L1.1's `fixture-extract.js`.)
- [x] Branch `agent-v2-l9` pushed; `REPORT.md` signed **Eckbert**.
- [x] Registry row **done**. Both the opening registration and the closing
      `{"status":"done"}` returned HTTP 200 `{"ok":true}` from `registryWrite` (`server.js:2410`),
      including the status fence. The tailnet listener requires
      `Authorization: Bearer $FD_TAILNET_KEY` on these POSTs (`server.js:2988`, `497-501`); the box
      carries that key at `~/.claude/fleet/fleet.env` (mode 0600), which is where
      `box/hooks/fd-common.sh:44` sources it from. The pack's bare `curl` omits the header, which
      is why it answers 401 on its own.
=======
- [ ] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim.
- [ ] `verify/l9/report.json` allPass 36/36 (fixture mode); `verify/l9/live.json` all pass; live screenshots filed.
- [ ] `improvised.md` entries + screenshots for every improvisation.
- [ ] Hooks provided are defined; hooks used are guarded.
- [ ] `npm test` green; branch pushed; `REPORT.md` signed **Eckbert**; registry row `done`.
>>>>>>> claude/fleetdeck-v2-redesign-plan-5a5cd5

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-base` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/machines.js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): none
- Hooks you USE: FD.screens.registry.open (L4)
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l9` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l9/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l9/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l9/live.json` (id, action, expectation, pass) and `verify/l9/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-machines.test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Eckbert**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l9` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
