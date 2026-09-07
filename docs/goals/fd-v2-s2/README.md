# fd-v2-s2 — pass-2: compile the design template to plain JS (engine removed)

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Julius** · `frontend-developer` · tag `agent-julius` · Claude, high, `/goal` |
| Branch | `agent-v2-s2` off `origin/agent-v2-s1` (= main + design docs + S1's pass-1 port) — launch only after S1 is pushed with a green gate |
| Design seat | 🎨 DESIGN 35 (plan `docs/design/fleetdeck-v2/plan.md`, ledger `diff.md`, precedent `decisions.md`) |
| Registry group | `fd-v2` |

## Goal (one line)

Replace the mock's runtime (dc-runtime + React + Babel) with a build-time compiler that turns the design
template into plain-JS render functions, keep the mock's own UI logic running on a tiny shim, and prove
the result is DOM-identical and pixel-identical to pass 1 on every screen and after every interaction.

## Why this shape (design-seat decision, 2026-09-07)

The precedent (lowcap `editorial-clean-port`, see `decisions.md`) dumped the rendered DOM to static HTML
and hand-wrote behaviour. That fits marketing pages. Fleetdeck is an app with eight data-driven screens
whose tabs, menus, toggles, composer and lists ARE the design. So pass 2 here keeps the template as the
source of truth and compiles it: the mock's `renderVals()`/state class keeps driving the UI, React and
Babel go away, and every later logic slice only swaps seed arrays for API data inside that class.
Fallback (only via `operator:decision`): the precedent's DOM-dump method.

## Inputs

- `public/v2/index.html` (S1: mock after T1/T2), `public/v2/vendor/dc-runtime.js` (= `support.js`), S1's
  `verify/S1/` report, the pixel gate `scripts/design-diff.mjs` (S0), baselines under `docs/design/fleetdeck-v2/baseline/`.
- DSL scope the compiler must cover, with line refs in `dc-runtime.js` (from the reader audit): `{{ }}` bindings
  (`resolve` L205, `collectProps` L415-443); `sc-if` (`walkIf` L646-660); `sc-for` with `as`/`$index` (`walkFor`
  L611-644); `style-<pseudo>` → generated `.scpN` classes (L428-431, `createPseudoSheet` L1567-1587, `::before/::after`
  L1580-1581); event attrs via `EVENT_MAP` (L317-335, applied L437-440); `class`→`className`, `for`→`htmlFor` (L436-437);
  `data-props` (L29, L47); `DCLogic` contract: `renderVals()` (L838-840, merged L1085), `setState` (L825/829),
  `componentDidMount` (L831, L993-1007), `componentDidUpdate`, `componentWillUnmount`; `value`/`checked` coercion (L802-804);
  `hint-*` streaming attrs are no-ops. Verify whether `ref=` is honoured anywhere (the audit found no handler; the template
  uses `ref="{{ … }}"`): document what the runtime actually does and match it exactly.
- Reusable precedent tools (read them first): `~/projects/lowcap-connector/tools/compile-dc.js` (frozen-clock headless
  render + script-strip-first + tail-anchored unwrap, L129-133, L175-195), `tools/f2-parity.mjs` (normalized-DOM byte
  parity, volatile mask L36-50), `tools/style-parity.mjs` (computed-style parity), `~/projects/onboarding-app/server/scripts/convert-pitch-v4-jsx.js`
  (the DSL parser that mirrors dc-runtime; change its emitter from JSX to plain calls). Those repos are on the operator's
  Mac; the design seat copies the four files into `docs/design/fleetdeck-v2/precedent/` before launch.

## Scope

**In**
1. `tools/dc-compile.mjs`: reads `public/v2/template.dc.html` (= S1's `index.html`, moved, byte-identical) and emits
   `public/v2/app.js` (render functions for the whole template: land/app/deck views, all `sc-if`/`sc-for`, bindings, events,
   pseudo-class sheet) — deterministic, idempotent, no network.
2. `public/v2/runtime.js` (≤ 300 lines, plain JS, no deps): `h()`-style DOM builder, keyed `sc-for` reconciliation
   (or full re-render of the changed view root — pick the simpler one that passes the gates), pseudo-class sheet, event
   map, `setState` → re-render, lifecycle calls in the same order as dc-runtime.
3. `public/v2/logic.js`: the `<script data-dc-script>` class body extracted **byte-identical** (`split`-style, round-trip
   checked); it runs on `runtime.js` unchanged. `data-props` → `public/v2/props.json`.
4. `public/v2/index.html` becomes a shell: the mock's `<head>` (fonts/css) + `<div id="root">` + `runtime.js`, `logic.js`,
   `app.js`. React, ReactDOM, Babel, dc-runtime are no longer loaded; keep pass 1 runnable at `public/v2/pass1/index.html`
   (moved files, byte-identical) as side A for parity until L11 deletes it.
5. `npm run v2:compile` (regenerate `app.js`) and `npm run v2:check` (fails when `app.js` is stale vs the template).
6. Gates, all committed under `docs/design/fleetdeck-v2/verify/S2/`:
   - **F2 DOM parity**: for each of the 18 screens × 2 themes, normalized DOM of pass 1 (side A) vs compiled (side B),
     byte-identical after the precedent's n1–n3 normalization + a declared volatile mask (ticking timers only). Script:
     `tools/v2-parity.mjs`, exit 1 on any mismatch, report `parity.json`.
   - **Interaction parity**: a scripted click-through executed identically on both sides (theme toggle, sidebar collapse,
     right rail toggle, video toggle, every nav item, Registry select rows + bulk bar, bus: pick thread, Select mode,
     maximize, send a message, full-screen terminal open + ≡ menu + Escape, Accounts/Machines expand, Desktop sessions
     expand, deck ArrowRight ×4) — normalized DOM identical after every step; `interactions.json`.
   - **Pixel gate**: `scripts/design-diff.mjs --app <compiled> --slice S2` → 36 screens ≤ 0.5 %.
   - **No engine**: Playwright request log shows no `react`, `react-dom`, `babel`, `dc-runtime` loads; `network.json`.
7. `docs/design/fleetdeck-v2/improvised.md`: nothing should be improvised in this slice; if the compiler needs a
   behavioural choice the runtime leaves undefined, record it there with evidence.

**Out**
- Any data wiring, routing, theme-key migration, old UI — L1…L11.
- Editing the template toward the mock, or "simplifying" the mock's logic class. Byte-identical or fail.
- Hand-written per-screen render code. If you find yourself writing markup by hand, stop: that is the fallback method and needs `operator:decision`.

## Acceptance (definition of done)

- [x] `template.dc.html` byte-identical to S1's `index.html` (sha256 `96be98b6…`); `logic.js` body byte-identical to the mock's script, sha256 `d0db2453…`, round-trip proof in `verify/S2/logic-roundtrip.txt`. **Amended by the T3 ruling**: byte-identical except the 7 fixture substitutions, whose moved literals are byte-identical in `fixture.js` and quoted OUT->IN in `verify/S2/t3-substitutions.txt`.
- [x] `parity.json`: **36/36 identical**, volatile mask empty. `interactions.json`: **34/34 steps identical**, mask empty, `failedSteps: []`.
- [x] `verify/S2/report.json`: **`allPass: true`** on 36 screens, max mismatch **0.032948 %**.
- [x] `network.json`: **0** React/ReactDOM/Babel/dc-runtime loads; shell has no `<x-dc>` and no `data-dc-script`; also 0 console errors, 0 page errors, 0 failed requests, 36/36 screens reached.
- [x] `npm run v2:check` green; `npm run v2:compile` reproduces all four outputs byte-identical twice.
- [x] `reviewer` pass clean (8 findings: 2 already fixed, 4 fixed, 2 ruled). Adversarial pass on `tools/dc-compile.mjs` + `runtime.js`: 5 findings, **2 fixed and 3 ruled**. **Caveat, declared:** the mandated GPT `hunter` could not run (usage limit until Sep 12) and a Fable audit returned HTTP 429, so the identical brief ran on a Sonnet `reviewer` — a weaker substitute. See REPORT.md.
- [x] Branch pushed; `REPORT.md` signed **Julius**; registry `done`.

## Pitfalls to carry (from the precedent report)

1. Script-strip FIRST, then any tail-anchored unwrap; assert the tail is exactly `</body></html>` before slicing.
2. Volatile values get an explicit declared mask; nothing else may differ.
3. Freeze `setInterval`/`setTimeout` symmetrically and disable animations on both sides before any parity dump.
4. Never graft CSS classes onto mock-derived markup; generated pseudo-classes must be named identically on both sides or normalized away.
5. Vendored engine only, egress denied during parity runs.
6. Never `git stash`.
7. Time-box: if F2 parity is not 36/36 after 1.5 working days, file `operator:decision` with the fallback proposal and the current numbers; do not keep grinding silently.


## Known pass-1 diagnostics to eliminate by construction (from S1's network proof)

The dc-runtime parses the raw template before binding, so the browser requests `/v2/%7B%7B%20A_videoUrl%20%7D%7D`
once per theme (mock line 145, `src="{{ A_videoUrl }}"`) and logs invalid `<polyline points>` for the unbound
`{{ a.trendPts }}` — four console errors, zero JS exceptions, preserved under D15 in S1. A compiled render has no
pre-bind DOM, so these must be absent in pass 2; assert zero console errors and zero 404s in `network.json`.
Also: `/v2/` (directory) returns 404 from `server.js`; only `/v2/index.html` resolves. Routing is L1's; keep using
`/v2/index.html` (and `/v2/pass1/index.html`) in every gate URL.

## Constraints

- Linear unreachable (`oauth_token_invalid_grant`) is never a blocker: `LINEAR-PENDING.md` fallback, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (recipe in `LAUNCH.md`); 503 = `operator:gate` and block on that step only.
- Never touch the operator's live deck (`localhost:3131` on the Mac). Never edit `docs/design/fleetdeck-v2/mock/**`.

## Execution protocol

`PROTOCOL.md` in this directory. You execute; you never orchestrate.
