# S1 pass-1 pixel recheck (run by Julius, S2, 2026-09-07)

S1 could not run the pixel gate: `scripts/design-diff.mjs` and the 37 baseline files lived only on
`origin/agent-v2-s0`, which was never merged into `agent-v2-s1`. S1's `REPORT.md` therefore records the
gate as "NOT RUN; no allPass claim" with all 36 rows "not run".

S2 merged `origin/agent-v2-s0` (it is a declared Input of the S2 pack) and ran that gate against S1's
untouched pass-1 port, before writing any S2 code. This is S1's missing evidence, not an S2 gate.

## Result — 36/36 PASS, `allPass: true`

| | |
|---|---|
| Source | `http://127.0.0.1:3199/v2/index.html` (S1's port, unmodified, served by `server.js`) |
| Baselines | `docs/design/fleetdeck-v2/baseline/` (captured by S0 from the design mock) |
| Screens | 36 = 18 x {dark, light} |
| Passed | **36** |
| Threshold | 0.5 % |
| Max mismatch | **0.032948 %** (`registry` dark; every other screen 0.000000 %) |
| Environment | linux x64, node v24.14.1, Playwright 1.63.0, Chromium 153.0.8010.12 (matches S0's pin) |

Reproduce:

    PORT=3199 node server.js &
    node scripts/design-diff.mjs --app 'http://127.0.0.1:3199/v2/index.html' --slice S1-pass1-recheck

## Why this matters for S2

The baselines were captured from the **mock**, not from the port, so "compiled output vs baselines" only
isolates the compile step if the port already matches the mock. It does: pass 1 is pixel-identical to the
mock on all 36 screens. So any pixel mismatch in S2's own gate is attributable to the compile, not to
inherited pass-1 drift. That is the reason this run happened before any S2 code was written.

The 72 PNGs (36 shots + 36 diffs, 7.8 MB) are not committed — only `report.json`, which carries the
per-screen numbers and the SHA-256 of every shot. The run above regenerates them in about a minute.

Signed **Julius**.
