# fd-v2-l7 — SSH keys + GitHub train

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Tankred** · `frontend-developer` · tag `agent-tankred` · Claude, high · `/goal` |
| Branch | `agent-v2-l7` off `origin/agent-v2-base`; first action `git merge --no-edit origin/agent-v2-l1` |
| Ledger rows | D14 (`docs/design/fleetdeck-v2/diff.md`) |
| Owned file | `public/v2/screens/keys.js` + this screen's methods in `logic.js` |
| Data identifiers | keyRows + cert/train state ← FD.data.toKeys(sshkeys, ghtrain) |
| API | FD.data.sshkeys(), mintCert(), deleteKey(), ghtrain(), startTrain(), endTrain() |
| Design seat | 🎨 DESIGN 35 — `docs/design/fleetdeck-v2/plan.md`, `decisions.md` |
| Registry group | `fd-v2` |

## Goal (one line)

Make the **SSH keys + GitHub train** screen work on live data exactly like today's app (`BEHAVIOUR.md`), inside the mock's markup (pixel gate green in fixture mode), with every gap the mock leaves improvised in its style and documented.

## Inputs (read in this order)

1. `BEHAVIOUR.md` in this directory — the behaviour spec, item by item.
2. `docs/design/fleetdeck-v2/diff.md` rows D14 + §"Binding map" + §"Behaviour contract".
3. `docs/goals/fd-v2-s2/REPORT.md` (S2 structure) and `docs/goals/fd-v2-l1/REPORT.md` (data.js shape table).
4. The mock line ranges cited in your ledger rows (`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`).
5. `docs/design/fleetdeck-v2/improvised.md` (append; never rewrite others' entries).

## Scope (In)

1. Mint card: TTL chips, principal chips root/vibe (titles verbatim), guard text, POST body, Minting…/error texts, flash of the new cert.
2. GitHub train card: ACTIVE / INACTIVE / BROKER DOWN, `h:mm`/`mm:ss` countdown, start chips (Touch ID…), End train, curl hint verbatim.
3. Certificates: active row + countdown + Kill now (confirm text) / expired + Delete, copy line (exact flags) + Copy → Copied 1.5 s, empty text; Keys table with REAL `type`.
4. 30 s poll + 1 s tick; error placements improvised (BROKER DOWN has no mock design).

**Out**: every other screen; the shell, runtime, template, data layer; server changes (unless listed above); cut-over (L11).

## Acceptance (definition of done)

- [x] Every `BEHAVIOUR.md` item ported (checklist in `REPORT.md` §2), texts/confirms/keys verbatim. Two items are **n.a.** with reasons: the old DOM ids (the mock has no such ids and hand-adding them is forbidden) and the 405 text (the screen never issues a wrong method; the `HTTP <status>` path that renders it is proven at L7-35/L7-48).
- [x] `verify/l7/report.json` **allPass 36/36** (fixture mode), `ssh-keys` 0.000000 % both themes; `verify/l7/live.json` **66/66 allPass**, zero console errors; `live-dark.png` / `live-light.png` filed.
- [x] `improvised.md` I-L7-01 … I-L7-08, each with its screenshot under `docs/design/fleetdeck-v2/improvised/`.
- [x] Hooks provided: **none** (declared in the first commit). Hooks used: **none**. The one internal seam, `FD.screens.keys.sync()`, is called guarded from `logic.js`.
- [x] `npm test` **320 pass / 320, 0 fail** on the current base (the `fixture.js` failure that dogged earlier runs, DECK-85, was fixed by the L1.2 base move). Branch pushed; `REPORT.md` signed **Tankred**; registry row gated (see REPORT §3).

## Cross-slice contract (nine slices edit in parallel — obey or the weave fails)

- Base `origin/agent-v2-base` (S2: plain-JS compile — `public/v2/index.html`, `runtime.js`, `logic.js`, `app.js`, `fixture.js`, `template.dc.html`, `FD.setData(name,value)`, `FD.fixture`, and empty `public/v2/screens/<screen>.js` files wired in the shell). First action: `git merge --no-edit origin/agent-v2-l1` (L1: `public/v2/data.js` fetchers + adapters, `router.js`, fixture extractor, API fixtures under `docs/design/fleetdeck-v2/fixtures/api/`).
- You own exactly ONE file, `public/v2/screens/keys.js`, plus your own screen's methods in `logic.js`. Never edit the shell, `runtime.js`, `app.js`, the template, `data.js`, other screens' methods or files. Need something from another slice? Call its hook guarded (`FD.screens?.bus?.open?.(t)`) and note the dependency in `REPORT.md`; never merge another L-branch.
- Data enters only through `FD.setData(<mock identifier>, adapterOutput)`; fixture mode (`?fixture=1`) stays untouched and pixel-identical.
- Hooks you PROVIDE (define in your first commit, no-ops until wired): none
- Hooks you USE: none
- Markup: no hand-typed markup; improvised UI (anything the mock lacks) is built in the mock's tokens and recorded in `docs/design/fleetdeck-v2/improvised.md` (entry: slice, ledger row, rationale, screenshot `docs/design/fleetdeck-v2/improvised/<slug>.png`). An undocumented improvisation fails review. Hooks are `data-*`/id only, never classes grafted onto mock markup.
- A conflict in `logic.js` on merge/rebase is resolved by keeping both sides; never drop another slice's code.
- Reviews run in parallel and never gate you: push on green, keep working; findings come back over the bus as follow-up goals.

## Gate and proof (mandatory)

1. Pixel gate in fixture mode: `npm run design:diff -- --app <static server>/v2/index.html?fixture=1 --slice l7` → 36/36 ≤ 0.5 % → `docs/design/fleetdeck-v2/verify/l7/report.json` + PNGs committed.
2. Live-mode proof with the API stubbed: a Playwright script under `verify/l7/` that routes `/api/*` to the JSON fixtures in `docs/design/fleetdeck-v2/fixtures/api/` (plus hand-written variants for error/empty/offline states), drives every automatable `BEHAVIOUR.md` item, writes `verify/l7/live.json` (id, action, expectation, pass) and `verify/l7/live-<theme>.png`. Zero console errors.
3. Unit tests for pure logic (`test/v2-keys.test.js`, node --test) where applicable.
4. `improvised.md` entries + screenshots for every improvisation.
5. `REPORT.md` signed **Tankred**: behaviour checklist (every `BEHAVIOUR.md` item → done / partial / n.a. with reason), hooks provided/used, open follow-ups.

## Constraints

- Preserve today's behaviour exactly (endpoints, params, bodies, localStorage keys, texts, confirms, timers) — `BEHAVIOUR.md` is the spec; the mock is the look.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (env only, never stored): `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l7` — 503 = `operator:gate`, block on that step only, keep committing.
- Never touch the operator's live deck (`localhost:3131` on the Mac); never edit `docs/design/fleetdeck-v2/mock/**`.
- Deadline: the whole redesign ships **2026-09-08 evening**. Push a green slice early and iterate; do not polish first.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no new lane, no re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
