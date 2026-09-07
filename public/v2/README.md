# Fleetdeck v2

The compiled Fleetdeck Final artboard. `tools/dc-compile.mjs` turns
`template.dc.html` into plain JavaScript (`app.js`), so the page needs no React,
no Babel and no design runtime — `index.html` loads only its own files.

The server maps `/` to the landing view, `/app` to the deck and `/deck` to the
investor deck; `/v2/` serves the same shell for the design gate. The view travels
on the query string and the screen on the hash (`public/v2/router.js`).

From the repository root, install: `npm ci && npx playwright install chromium`.
Start a static server: `python3 -m http.server 4181 --directory public`.
Open `http://127.0.0.1:4181/v2/?fixture=1` to see it on fixture data.
Run the gate: `node scripts/design-diff.mjs --app 'http://127.0.0.1:4181/v2/?fixture=1' --slice <id>`.
The gate checks 18 screens × 2 themes at 1440×900, each ≤0.5% mismatch, and writes
`docs/design/fleetdeck-v2/verify/<id>/`.
