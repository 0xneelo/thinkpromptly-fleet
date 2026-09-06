# Fleetdeck v2 — pass-1 artifact

This is the verbatim Fleetdeck Final artboard, rendered by the vendored dc-runtime.
Source: `docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`.
D15 requires mechanical verbatim copying; the mock remains the specification.
Only the goal README’s enumerated T1 runtime/font and T2 asset substitutions apply.
Start a static server: `python3 -m http.server 3199 --directory public`.
Run the gate: `node scripts/design-diff.mjs --app http://127.0.0.1:3199/v2/index.html --slice S1`.
The gate covers 18 screens in dark and light at 1440×900; each must differ by ≤0.5%.
Proof: `docs/design/fleetdeck-v2/verify/S1/` (port diff, network log, report and PNGs).
