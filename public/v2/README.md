# Fleetdeck v2 — pass-1 artifact

This is the verbatim Fleetdeck Final artboard, rendered by the vendored dc-runtime.
D15 permits only the goal README’s enumerated T1 runtime/font and T2 asset substitutions.
From the repository root, install: `npm ci && npx playwright install chromium`.
Fetch pinned S0 baselines: `git fetch origin agent-v2-s0 && git archive f17f1b5be614f921bd70dc4d190c50f66537b4c0 docs/design/fleetdeck-v2/baseline | tar -x`.
Start a static server: `python3 -m http.server 4181 --directory public`.
Open `http://127.0.0.1:4181/v2/index.html`; DESIGN-35 defers `/v2/` directory routing to L1.
Run the gate: `node scripts/design-diff.mjs --app http://127.0.0.1:4181/v2/index.html --slice S1-recheck`.
The gate checks 18 screens × 2 themes at 1440×900, each ≤0.5% mismatch; reruns write `docs/design/fleetdeck-v2/verify/S1-recheck/`, preserving the committed S1 proof.
