# fd-v2-l1 — data layer, fixture mode, v2 routing

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Juergen** · `frontend-developer` · tag `agent-juergen` · Claude, high, `/goal` |
| Branch | `agent-v2-l1` off `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` (main + design docs); runs in parallel with S2 (Julius) — no dependency on S1/S2 output |
| Design seat | 🎨 DESIGN 35 (plan `docs/design/fleetdeck-v2/plan.md`, ledger `diff.md` rows D06, D18–D20 + the "Binding map" and "Behaviour contract" sections) |
| Registry group | `fd-v2` |

## Goal (one line)

Build `public/v2/data.js`: every API call the current app makes, wrapped once, plus adapters that turn
real API rows into the exact shapes the design template's seed arrays use, a fixture mode that returns
the mock's seed data byte-for-byte, and the v2 URL scheme — so every later screen slice only plugs data in.

## Why in parallel

The template (S1) and its plain-JS compile (S2, Julius) are the render side. This slice is the data side and
touches neither; it is defined by two contracts that already exist: the current app's API usage
(`diff.md` §Behaviour contract) and the mock's seed-array shapes (`diff.md` §Binding map, seed arrays listed
in `handoff.md`). Building it now takes a day off the critical path.

## Inputs

- Current callers to preserve exactly (read them; they are the behaviour spec): `public/app.js` (sessions
  L182-186, health L99-121, credits L136-158, org L189-205, registry edits L465, kill/forget L806-813, bus
  L911-979 + L1214-1233), `public/keys.js`, `public/accounts.js:239`, `public/machines.js:222-232`,
  `public/sessions.js:150-342`, `public/orgchart.js` (`FleetOrgChart.buildTree`).
- Real response samples captured from the operator's live deck on 2026-09-07:
  `docs/design/fleetdeck-v2/fixtures/api/{sessions,health,credits,seats,messages,sshkeys,ghtrain,machines,desktop-sessions}.json`.
  Use them for unit tests; never call the operator's deck from the box.
- Mock seed arrays: inside `<script data-dc-script>` of `docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html`
  (`tiles` L1841-1870, `groups` L1817-1820, `regData` L1366-1379, `busSessions` L1415-1424, `busGroups` L1425,
  `seedThreads` L1428-1446, `orgScopeData` L1702-1714 + `orgCard()`, `keyRows` L1924-1934, `accounts` L1936-1964,
  `machines` L1977-2001, `dsData` L1315-1330, `termLinesFor()` L1557-1585, `titles` L1302-1311).
- Server routes: `server.js:2729-2844` (static serving at L2839-2844; `/v2/` directory currently 404s — Waldemar's finding).

## Scope

**In**
1. `public/v2/data.js` (plain JS, no deps, loads as a classic script and exposes `window.FD.data`):
   - **Fetchers**, one per endpoint, same URLs/methods/bodies as today: `sessions()`, `health()`, `credits({refresh})`,
     `seats()`, `messages({limit})`, `sendMessage(body)`, `retryMessage(id)`, `registryUpsert(row)`, `registryDelete(row)`,
     `kill(row)`, `sshkeys()`, `mintCert(body)`, `deleteKey(body)`, `ghtrain()`, `startTrain(body)`, `endTrain()`,
     `machines({refresh})`, `desktopSessions({refresh})`, `transcript(params)`. Errors surface as rejected promises with
     `{status, body}`; no swallowing.
   - **Adapters** (pure functions, unit-tested): `toGroups(sessions)`, `toRegistryRows(sessions)`, `toOrg(sessions, seats)`
     (wraps `FleetOrgChart.buildTree`; move `orgchart.js` under `public/v2/` unchanged), `toThreads(messages)` (group by
     target → `busSessions`/`busGroups`/`threads` shapes, status → receipts), `toKeys(sshkeys, ghtrain)`, `toAccounts(credits)`
     (bars from `windows{}`/`weekly`/`secondary`, `trendPts` from `history[]`, banner from errors), `toMachines(machines)`,
     `toDesktop(desktopSessions)` (groups by account, "Live now" first), `toTiles(sessions)` (name/box only; xterm is L3).
     Each adapter's output must be **shape-identical** to the corresponding mock seed array (same keys, same value types).
   - **Fixture mode**: `?fixture=1` or `localStorage['fd-fixture']==='1'` → every fetcher resolves with the mock's seed data,
     extracted **verbatim** into `public/v2/fixture.js` by a script (`tools/extract-fixture.mjs`, reads the mock script,
     writes the arrays; `npm run v2:fixture` regenerates, a check fails when stale). The pixel gate runs in this mode
     after logic lands, so the shapes must be byte-equal to the mock's.
   - **Polling helper**: `poll(fn, ms, {whileVisible})` reproducing today's cadences (org 30 s + 1 s ticker, desktop 30 s
     visible-only, machines 60 s, keys 30 s; registry/bus/accounts/health manual).
   - **Theme key migration**: `theme()` reads `fd-landing-dark`, falls back to `fleetTheme`, writes `fd-landing-dark`.
2. **v2 URL scheme** (`public/v2/router.js`, no deps): `/v2/` and `/v2/index.html` both serve the shell (fix the directory
   404 in `server.js` static handler — smallest possible change, quoted in the commit); view from the path
   `?view=land|app|deck` (default `app` inside `/v2/`, since the cut-over to `/` = landing is L11); screens from the hash
   `#windows #org #registry #bus #keys #accounts #machines #desktop`; hash written on nav, read on load, `popstate` handled.
   Export `route()` / `navigate(screen)`; do not wire it into the template (that is the screen slices' job).
3. Tests: `test/v2-data.test.js` (node --test) — every adapter against the captured fixtures AND against the mock seed
   arrays (fixture mode returns them unchanged); every fetcher's URL/method/body asserted with a stubbed `fetch`.
4. `docs/design/fleetdeck-v2/improvised.md`: entries for any shape decision the mock leaves open (e.g. which registry field
   fills `tk`, how `receipts` derive from `status`), each with rationale; screenshots not required for data-only entries.

**Out**
- Any rendering, any edit to the template, `logic.js`, `app.js` (S2's), the old UI, xterm (L3), cut-over/redirects (L11).
- New server endpoints or changes to existing ones (except the `/v2/` directory fix). If a shape needs data the API lacks,
  document it in `improvised.md` and leave the field `null`.

## Acceptance (definition of done)

- [x] `public/v2/data.js`, `router.js`, `fixture.js`, `orgchart.js` present; `npm test` green including `test/v2-data.test.js`. — 294 pass, 0 fail.
- [x] Fixture mode returns arrays byte-equal (deep-equal + key order) to the mock's seed arrays; `npm run v2:fixture` idempotent. — read as the layer-1 projection (improvised.md I-L1-01); `v2:fixture -- --check` runs in `pretest`.
- [x] Every adapter output validated against the mock shapes (a shape table in `REPORT.md`, one row per array: keys, types, source field).
- [x] `/v2/` resolves (curl through `node server.js` on a scratch port shows 200 + the shell), change quoted in the commit `a918cc5`. The shell is S2's file; the test supplies a stand-in when it is absent.
- [x] No fetch to any host but the page origin; no call to the operator's deck. — asserted by a test.
- [x] `reviewer` pass clean (two passes, 14 findings, all fixed); branch pushed; `REPORT.md` signed **Juergen**; registry `done` — **not written**: `POST /api/registry` answers `unauthorized` from the box (XYZ-2137).

## Constraints

- Preserve today's behaviour exactly: same endpoints, same query params (`?refresh=1`), same bodies, same localStorage keys read.
- Linear unreachable (`oauth_token_invalid_grant`) is never a blocker: `LINEAR-PENDING.md` fallback, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push (recipe in `LAUNCH.md`); 503 = `operator:gate`, block on that step only.
- Never touch the operator's live deck (`localhost:3131` on the Mac). Never edit `docs/design/fleetdeck-v2/mock/**`.

## Execution protocol

`PROTOCOL.md` in this directory. You execute; you never orchestrate.
