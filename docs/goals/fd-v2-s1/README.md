# fd-v2-s1 — verbatim pass-1 port of the Fleetdeck Final artboard

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Waldemar** · `frontend-developer` · tag `agent-waldemar` · GPT Astra 6 xhigh · `/goal` |
| Branch | `agent-v2-s1` off `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` (= main + the design docs) (worktree `.claude/worktrees/v2-s1`) |
| Design seat | 🎨 DESIGN 35 (plan `docs/design/fleetdeck-v2/plan.md`, ledger `diff.md` rows D01, D02, D07 + the P1 half of D03–D19) |
| Registry group | `fd-v2` |
| Sibling | S0 (Gisbert) builds the gate script in parallel on `agent-v2-s0` |

## Goal (one line)

Land the design mock **byte-verbatim** as `public/v2/index.html` with its runtime and every asset
vendored, reachable at `/v2/index.html`, and prove it with the pixel gate on all 18 screens × 2 themes.

## The rule that governs this slice (D15, operator-ratified precedent)

**Mechanical verbatim only.** The template markup, the `<script data-dc-script>` body and the `data-props`
land byte-identical, altered ONLY by the enumerated substitutions below, each quoted OUT → IN in the
commit body. *Never edit shipped markup toward the mock.* No re-indent, no attribute reorder, no rename,
no copy change, no "small fix". If something looks wrong in the mock, it ships wrong and you file a
Linear issue `operator:decision`.

Allowed substitutions:

| Tag | OUT (in the mock) | IN (in `public/v2/`) |
|---|---|---|
| T1 runtime | `<script src="./support.js">` | `<script src="/v2/vendor/dc-runtime.js">` |
| T1 runtime | inside the copied `support.js`: `https://unpkg.com/react@18.3.1/umd/react.production.min.js` | `/v2/vendor/react.production.min.js` |
| T1 runtime | `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` | `/v2/vendor/react-dom.production.min.js` |
| T1 runtime | `https://unpkg.com/@babel/standalone@7.29.0/babel.min.js` | `/v2/vendor/babel.min.js` |
| T1 fonts | the Google Fonts `<link>` tags for Inter (and the `preconnect`) | one `<link rel="stylesheet" href="/v2/vendor/inter.css">` with `@font-face` for 400/500/600/700 pointing at woff2 files in `/v2/vendor/fonts/` |
| T2 asset | `uploads/fleetdeck-eye-minimal.svg` (6 places) | `/v2/media/fleetdeck-eye-minimal.svg` |
| T2 asset | `https://d8j0ntlcm91z4.cloudfront.net/…/hf_20260611_104107_….mp4` | `/v2/media/hero-dark.mp4` |
| T2 asset | `https://d8j0ntlcm91z4.cloudfront.net/…/hf_20260729_102822_….mp4` | `/v2/media/hero-light.mp4` |
| T2 asset | wikimedia `Claude_AI_symbol.svg/1280px-Claude_AI_symbol.svg.png` | `/v2/media/claude-logo.png` |
| T2 asset | wikimedia `ChatGPT-Logo.svg/1280px-ChatGPT-Logo.svg.png` | `/v2/media/chatgpt-logo.png` |

Anything not in this table is forbidden. If you discover another external URL, add a row to this table
in your commit, quote it, and continue.

## Scope

**In**
1. `public/v2/index.html` = `docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html` after T1/T2 only.
2. `public/v2/vendor/`: `dc-runtime.js` (= `support.js` after the three URL swaps), `react.production.min.js` 18.3.1, `react-dom.production.min.js` 18.3.1, `babel.min.js` 7.29.0 (exact versions, downloaded from unpkg, sha256 of each recorded in `public/v2/vendor/MANIFEST.md`), `inter.css` + `fonts/*.woff2` (weights 400/500/600/700, latin; source and license noted in the manifest).
3. `public/v2/media/`: the svg, the two mp4 (download once; ~10–20 MB each — commit them, the operator ruled "vendor everything, videos included"), the two logo PNGs. Sizes in the manifest.
4. Proof of verbatim: `docs/design/fleetdeck-v2/verify/S1/port-diff.txt` = output of `diff` between the mock and `public/v2/index.html` plus between `support.js` and `dc-runtime.js`; only T1/T2 lines may appear.
5. Proof of no external loads: a Playwright run that visits `/v2/index.html` (landing, app, deck) and records every request host → `verify/S1/network.json`; only your own origin may appear.
6. The gate: run S0's `scripts/design-diff.mjs --app <your static server>/v2/index.html --slice S1` → 36 screenshots ≤ 0.5 % → `verify/S1/report.json` + PNGs committed. Serve `public/` with a static server for this (no `server.js` needed for pass 1). If S0 has not landed yet: `git fetch origin agent-v2-s0` and run the script from that ref (checkout only `scripts/design-diff.mjs`); if it still does not exist, do the port, commit everything else, and poll every 30 min — the slice is not done without the report.
7. `public/v2/README.md` (10 lines): what this is (pass-1 artifact, dc-runtime rendered), the D15 rule, how to run the gate.
8. `server.js` MIME map (`server.js:2356`) knows only `.html .js .css`; add `.svg`, `.png`, `.woff2`, `.mp4`, `.webp` (image/svg+xml, image/png, font/woff2, video/mp4, image/webp) as a five-line change, quoted in the commit body. Nothing else in `server.js`. Verify each vendored file serves with the right `Content-Type` through `node server.js` on a scratch port (`PORT=3199 FLEET_TRAIN_PORT=3198 node server.js`, kill it afterwards) and note the curl results in your report.

**Out**
- Routing, data, logic, theme-key migration, the old UI — all later slices (L1…L11). `public/index.html`, `app.js`, `style.css` stay untouched.
- Any improvement of the mock. The mock is the spec.
- Pre-compiling the template to plain JS (pass 2) — a later slice.

## Acceptance (definition of done)

- [x] `port-diff.txt` shows only T1/T2 lines; every substitution quoted OUT → IN in the commit body.
- [x] `/v2/index.html` renders the landing; "App" reaches the app view with all 8 nav screens + full screen; "Deck" reaches the 5 slides; dark and light both work; video toggle works.
- [x] `network.json`: zero requests to hosts other than your own origin.
- [x] `verify/S1/report.json`: `allPass: true` on 36 screens; PNGs committed.
- [x] `MANIFEST.md` with versions, sha256, sizes, licenses.
- [x] `reviewer` subagent pass on the diff, findings fixed (it must confirm the diff is T1/T2-only).
- [x] Branch pushed; final report at `docs/goals/fd-v2-s1/REPORT.md` signed **Waldemar**; registry row set `done`.

## Constraints

- No hand-typing of markup. Copy, substitute with a script (`sed`/node), diff, done.
- Never edit `docs/design/fleetdeck-v2/mock/**`.
- Never touch the operator's live deck on the Mac (`localhost:3131`).
- Push with a fresh train-broker token per push (recipe in `LAUNCH.md`); 503 = file `operator:gate` and block.
- Blocked on the gate script for > 2 h → Linear issue `needs:agent:gisbert`, keep everything else committed.

- **Linear unreachable** (expired OAuth on the box: `oauth_token_invalid_grant`, or any MCP error) is NEVER a blocker: write the would-be issue/comment into `LINEAR-PENDING.md` in this pack (title, labels, body, timestamp), commit it, register with `task: "PENDING"`, and keep working. Retry Linear once per milestone; file the pending entries when it is back. The design seat mirrors them otherwise.

## Execution protocol

`PROTOCOL.md` in this directory (Linear issues per subtask, tag `agent-waldemar`, labels
`project:remote-system`, `subproject:fleetdeck-v2`, `session:cli-worker`; commit per milestone; report on
finish). You execute; you never orchestrate.

## DESIGN-35 execution amendment

Linear OAuth expiry is non-blocking. Record every intended issue/comment in `LINEAR-PENDING.md` with title, labels, body, timestamp and Waldemar signature; commit local pending IDs and retry Linear once per milestone. The design seat mirrors later. The requested `PENDING` registration returned HTTP 401 unauthenticated, then HTTP 400 with the documented fleet authentication because the server requires a real Linear key. S1-REGISTRY records both responses; task registration is not represented as success. The separately authorized status-only done update succeeded with HTTP 200 and `{"ok":true}`; REPORT.md records the receipt. This amendment does not waive pixel-gate or registry-completion acceptance.
