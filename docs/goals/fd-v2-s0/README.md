# fd-v2-s0 — pixel-diff gate harness

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Gisbert** · `qa-engineer` · tag `agent-gisbert` · GPT Astra 6 xhigh · `/goal` |
| Branch | `agent-v2-s0` off `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` (= main + the design docs) (worktree `.claude/worktrees/v2-s0`) |
| Design seat | 🎨 DESIGN 35 (plan `docs/design/fleetdeck-v2/plan.md`, ledger `diff.md`) |
| Registry group | `fd-v2` |

## Goal (one line)

Build `scripts/design-diff.mjs`: a Playwright + pixelmatch gate that screenshots every screen of the
design mock and of the built app at the same viewport and fails when they differ by more than 0.5 %.

## Why

Operator rule (2026-09-07): the redesign is accepted only as a **verbatim 1:1 copy of the mock,
machine-checked**. This script is the check. Every later slice (S1, L1…L11) commits a report from it.

## Inputs you have

- Mock: `docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html` + `support.js` (dc-runtime; loads
  React 18 + Babel from unpkg, so the box needs network) + `uploads/fleetdeck-eye-minimal.svg`.
  Serve the `mock/` directory with a static server (`python3 -m http.server` or a tiny node one you
  write into the script — **no new runtime dependency for serving**).
- The mock has three top-level views switched by its own script (`state.view`: `land` / `app` /
  `deck`, `applyView()` at L2124-2133) and 18 `data-screen-label`s. App screens are switched by the
  sidebar nav buttons (labels: Windows, Org chart, Registry, Message bus, SSH keys, Accounts,
  Machines, Desktop sessions). Landing → app via the nav link "App"; landing → deck via "Deck".
  "Session full screen" opens by clicking a tile's ⤢ button on the Windows screen. Deck slides
  advance with ArrowRight.
- Theme: `localStorage['fd-landing-dark']` (`'1'` dark / `'0'` light) read at load. Background video
  toggle: `localStorage['fd-app-video']` (`'false'` off).

## Scope

**In**
1. devDependencies: `playwright` (chromium only), `pixelmatch`, `pngjs`. `npx playwright install --with-deps chromium` on the box (passwordless sudo exists). Document the install in the script header and README.
2. `scripts/design-diff.mjs` with:
   - `--baseline` → screenshots the MOCK for every screen × theme into `docs/design/fleetdeck-v2/baseline/<screen>-<theme>.png` (36 files: 18 screens × dark/light).
   - `--app <url> --slice <id>` → screenshots the APP at the same screens (same clicks, same labels) into `docs/design/fleetdeck-v2/verify/<slice>/<screen>-<theme>.png`, writes `<screen>-<theme>.diff.png` and `report.json` (`{screen, theme, mismatchPct, pass}` per entry + `allPass`), exit code 1 when any screen > 0.5 %.
   - `--mock <url>` optional override; default = the script's own static server over `docs/design/fleetdeck-v2/mock/`.
   - viewport 1440×900, deviceScaleFactor 1, `colorScheme` follows the theme, `reducedMotion: 'reduce'`.
   - Determinism, applied identically to BOTH sides via `addInitScript` + an injected style: set the two localStorage keys before load; `*{animation:none!important;transition:none!important;caret-color:transparent!important}`; `video,canvas{visibility:hidden!important}` (the landing scrubs a video into a canvas and the app blurs a video; both are non-deterministic); wait for `document.fonts.ready` and network idle before each shot.
   - pixelmatch threshold 0.1, `includeAA: false`.
3. `npm run design:diff` script entry; a short section in `README.md` ("Design gate").
4. Self-test: run the MOCK as the app (`--app <mock url> --slice S0-selftest`) → every screen ≤ 0.05 %. Commit that report under `verify/S0-selftest/`. This proves the harness is deterministic before anyone trusts a failure.
5. Screen map as a small table in the script (label → how to reach it), exported so S1+ can reuse it.

**Out**
- Anything under `public/` or in `server.js`. You never touch the app.
- The app side may not exist yet (S1 builds it in parallel). Do not wait for it; the self-test is your proof.
- Repairing the mock. If a screen cannot be reached deterministically, document it in `report.json` as `skipped` with the reason and file a Linear issue `operator:decision`.

## Acceptance (definition of done)

- [x] `npm run design:diff -- --baseline` produces 36 PNGs; committed.
- [ ] `npm run design:diff -- --app <mock> --slice S0-selftest` → `allPass: true`, every mismatch ≤ 0.05 %; `verify/S0-selftest/report.json` committed.
- [x] A second baseline run reproduces the first within 0.05 % (run it twice, diff the two reports; note the max delta in your report).
- [ ] `reviewer` subagent pass on the diff, findings fixed.
- [x] README section + script header explain install, flags, thresholds, and the determinism hacks.
- [ ] Branch pushed; final report at `docs/goals/fd-v2-s0/REPORT.md` signed **Gisbert**; registry row set `done`.

## Constraints

- Mechanical, boring, deterministic. No visual judgement in the script.
- No screenshots of the operator's live deck (`localhost:3131` on the Mac); only what you serve yourself.
- Never edit the mock files (`docs/design/fleetdeck-v2/mock/**`).
- Push with a fresh train-broker token per push (recipe in `LAUNCH.md`); 503 = file `operator:gate` and block.

## Execution protocol

`PROTOCOL.md` in this directory (Linear issues per subtask, tag `agent-gisbert`, labels
`project:remote-system`, `subproject:fleetdeck-v2`, `session:cli-worker`; commit per milestone; report on
finish). You execute; you never orchestrate.
