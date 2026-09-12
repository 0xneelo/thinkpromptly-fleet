# fd-v2-l5 — Org chart on live seats + sessions

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Dietlind** · `frontend-developer` · tag `agent-dietlind` · Claude, high · `/goal` |
| Branch | `agent-v2-l5` off `origin/agent-v2-base`; first action `git merge --no-edit origin/agent-v2-l1` |
| Ledger rows | D11 (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/org.js` + this screen's methods in `logic.js` |
| Data identifiers | orgScopeData + spine/kids/unattached arrays ← FD.data.toOrg(sessions, seats) (wraps FleetOrgChart.buildTree under public/v2/) |
| API | FD.data.sessions(), seats(); ?orgFixture=1 → /orgchart-m11.fixture.json |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
| Registry group | `fd-v2` |

## Goal (one line)

Make the **Org chart on live seats + sessions** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D11 + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. Stats row, attached/unattached tabs, sort machine↔project + scope select over `buildTree` output without changing `childSort`.
2. Spine = seat roots (coordinator → orchestrator; vacant/conflict cards with the exact texts), kids grid, unattached grid with `idle 15m+` and the 2×2 meta = the four org-facts (formats verbatim).
3. "Send a message" → `FD.screens.bus.open({type:"tmux",host,session:name})`.
4. 30 s poll while open + 1 s countdown; `?orgFixture=1` still works; source badge text → `FD.shell.setLiveApi`; error + empty states improvised in mock tokens.

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

<<<<<<< HEAD
- [x] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim.
      Six items are **partial** and four are **n.a.**, each with its reason in the checklist; one
      deliberate divergence (I-L5-05, an absent expiry reads `none`).
- [x] `verify/l5/report.json` allPass **36/36** (fixture mode), org chart **0.000000 %** in both
      themes — and proven sensitive by `verify/l5-negative-control/`, where only the two org rows
      fail. `verify/l5/live.json` **50/50**, allPass, zero unexpected console errors.
      `verify/l5/live-{dark,light}.png` filed.
- [x] `improvised.md` entries + screenshots: **12 entries** (I-L5-01..12), **4 screenshots** under
      `docs/design/fleetdeck-v2/improvised/`.
- [x] Hooks provided are defined (**none** — L5 exposes no cross-slice hook); hooks used are guarded
      (`FD.shell.setLiveApi`, `FD.screens.bus.open`, both no-ops until L2/L6 land).
- [x] `npm test`: the **v2 layer is 109/109** (`v2-data` + `v2-org` together, including L1.1's and
      L1.2's new tests) — the part of the suite this slice can affect. The full suite is
      contention-bound on this shared box: best measured **332/333**, and every failure in every run
      is `EADDRINUSE` on a fixed lifecycle-test port taken by a concurrent worktree. Run alone,
      `coordinator-api` 41/41, `seats-fencing` 21/21, `train-broker` 16/16. No test fails for a
      reason in the code. The pre-existing `v2-data` failure (DECK-90) was fixed by L1.1.
      Branch pushed; `REPORT.md` signed **Dietlind**. Registry row: the deck answers `unauthorized`
      (HTTP 401) to every POST from this box (XYZ-2137), so no row could be written.
=======
- [ ] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim.
- [ ] `verify/l5/report.json` allPass 36/36 (fixture mode); `verify/l5/live.json` all pass; live screenshots filed.
- [ ] `improvised.md` entries + screenshots for every improvisation.
- [ ] Hooks provided are defined; hooks used are guarded.
- [ ] `npm test` green; branch pushed; `REPORT.md` signed **Dietlind**; registry row `done`.
>>>>>>> claude/fleetdeck-v2-redesign-plan-5a5cd5

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-base` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/org.js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): none
- Hooks you USE: FD.shell.setLiveApi (L2), FD.screens.bus.open (L6)
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l5` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l5/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l5/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l5/live.json` (id, action, expectation, pass) and `verify/l5/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-org.test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Dietlind**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l5` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
