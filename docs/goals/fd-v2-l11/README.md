# fd-v2-l11 — cut-over: routes, deletions, docs, gate hardening, final gate

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Alrun** · `fullstack-developer` · tag `agent-alrun` · Claude, high · `/goal` |
| Branch | `agent-v2-l11` off `origin/weave/fd-v2`; first action none — `weave/fd-v2` already contains S2 + L1 + L2–L10 |
| Ledger rows | D18, D19, D20 + closes every P2 row (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/(whole app).js` + this screen's methods in `logic.js` |
| Data identifiers | (none) |
| API | (none new) |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
| Registry group | `fd-v2` |

## Goal (one line)

Make the **cut-over: routes, deletions, docs, gate hardening, final gate** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D18, D19, D20 + closes every P2 row + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. server.js routes: `/` → v2 shell view=land, `/app` → view=app (hash screens), `/deck` → view=deck; `/keys.html /accounts.html /machines.html /sessions.html /index.html` → 302 to `/app#keys` etc.; `/v2/` keeps working. Every change quoted in the commit body.
2. Delete the old UI: `public/index.html, app.js, style.css, keys.*, accounts.*, machines.*, sessions.*, orgchart.js` (copy under public/v2/ stays), `public/v2/pass1/`, vendored React/ReactDOM/Babel/dc-runtime. KEEP `public/board.html` and `public/orgchart-m11.fixture.json`.
3. README.md UI sections rewritten for `/`, `/app`, `/deck`, screens, fixture mode, the design gate; `.claude/launch.json` `fleetdeck` url → `http://localhost:3131/app`; list every file under `~/.claude/skills` and `docs/` that opens `localhost:3131/` in REPORT.md (the design seat edits the Mac skills).
4. Gate hardening S0.1 (moved here from Gisbert, whose Codex lane hit its usage limit): in `scripts/design-diff.mjs` replace `networkidle` with a bounded in-flight-request settle (fonts ready + 2 rAF + no fetch/XHR for 300 ms, cap 5 s; ignore websocket/eventsource), blur after clicks, hide focus-visible outlines and scrollbars on both sides, `page.route` CDN URLs to the vendored files when present, rename `verify/S0-baseline-failed` → `verify/baseline-failed`; re-baseline only if PNGs change (say which).
5. Tests: update `scripts/verify-desktop-sessions-ui.js` and every test referencing old pages; `npm test` green; final gate 36/36 in fixture mode on `/app`; live-mode smoke with the API stubbed from `docs/design/fleetdeck-v2/fixtures/api/` (every screen renders, zero console errors).

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

- [ ] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md`), texts/confirms/keys verbatim.
- [ ] `verify/l11/report.json` allPass 36/36 (fixture mode); `verify/l11/live.json` all pass; live screenshots filed.
- [ ] `improvised.md` entries + screenshots for every improvisation.
- [ ] Hooks provided are defined; hooks used are guarded.
- [ ] `npm test` green; branch pushed; `REPORT.md` signed **Alrun**; registry row `done`.

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-s2` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/(whole app).js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): none
- Hooks you USE: none
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l11` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l11/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l11/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l11/live.json` (id, action, expectation, pass) and `verify/l11/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-(whole app).test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Alrun**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l11` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
