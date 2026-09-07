# verify/l4 — the two gates for slice L4 (Registry on live rows)

| File | What it is | How to reproduce |
|---|---|---|
| `report.json` | the 36-check design gate, **fixture mode**, 18 screens × dark/light. A copy of `docs/design/fleetdeck-v2/verify/l4/report.json`, where `scripts/design-diff.mjs` publishes the run with its PNG pairs. | `npm run design:diff -- --app "http://127.0.0.1:<port>/v2/index.html?fixture=1" --slice l4` |
| `live.json` | the 36-check behaviour gate, **live mode**, every `/api/**` call stubbed from `docs/design/fleetdeck-v2/fixtures/api/`. One check per row of `docs/goals/fd-v2-l4/BEHAVIOUR.md`. | `node tools/v2-live-check.mjs` |

Start the app on a scratch port first (`PORT=<port> node server.js`) — never 3131, that is the
operator's live deck.
