# Alfons report: Lane 3 org-chart UI

**Issue:** XYZ-1818, child of XYZ-1742

**Worker:** Alfons, frontend-developer

**Branch:** `agent-alfons`

**Agent tag:** `agent-alfons`
**Date:** 2026-08-28

## Outcome

Fleetdeck now has an Org chart tab alongside Windows, Registry, and SSH keys. It consumes
the frozen M11 rows from `GET /api/sessions` and `GET /api/seats`, builds the tree from
`(parent_host,parent_name)`, places seat holders beneath coordinator and orchestrator roots,
and groups unresolved parents beneath stable host roots.

The org view keeps tmux liveness separate from M11 display liveness. A session renders live
when `row.live === true` or `lease_state === 'active'`, so the fixture's Mac coordinator is
green even though it is not a tmux session. The Windows view still uses tmux `row.live` before
offering terminal actions.

No server or hook files changed. There is no build step and no external CDN.

## Milestones

| Milestone | Commit | Result |
|---|---|---|
| A | `c7dc957` | Frozen-shape fixture and pure row/tree module |
| B | `ed093bc` | Org tab, stable hierarchy, host orphans, lifecycle states |
| C | `4032339` | Epoch, lease age, expiry countdowns, glows, Mac tombstone affordance |
| D | `cdd129a` | Dark/light themes, 30-second live refresh, integration check |
| E | report commit | Screenshots, acceptance sweep, registry completion, this report |

Each completed milestone was checkpointed on Linear issue XYZ-1818.

## Acceptance

### 1. Frozen fixture and light/dark proof: GREEN

The committed fixture contains:

- both coordinator and orchestrator seats;
- the 3-level tmux chain `FD-orchestrator → FD-alfons → LC-konrad`;
- the unresolved `FD-stray` parent under `german-box`;
- reaped Mac row `FD-old-desktop` with `🪦 close me`;
- suspect row `LC-edith`;
- `LC-konrad` with the blue `pinger_dead` cue and 15-minute attention state;
- Mac coordinator `live:false` plus `lease_state:"active"`, rendered active per M11.

Screenshots:

- [Dark fixture](../../../../public/screenshots/xyz-1818-orgchart-dark.png), PNG 1440×1000,
  SHA-256 `3719132f41ebca1ae6c70a222553cad90a3924d58c3704b190516454944e29c5`.
- [Light fixture](../../../../public/screenshots/xyz-1818-orgchart-light.png), PNG 1440×1000,
  SHA-256 `c82053b5020070f4c0fbcca56207460f9bae35732ac5dac290978e97b1d793c0`.

Both files were visually inspected after capture.

### 2. Existing views and static-deck constraints: GREEN

The browser sweep restored Windows after closing Org chart, opened Registry with all seven
fixture rows, and loaded all four SSH-keys panels. The run reported no page errors or console
errors on the disposable fixture server. The org overlay follows Registry's existing fixed
panel model, so open terminal tiles remain mounted and their sockets are not replaced.

No package, build, or external asset dependency was added. At 390×844 the org view has no
horizontal document overflow.

### 3. Polling and stable refresh order: GREEN

Fifty shuffled-input runs produced byte-identical tree output. Seats have a fixed coordinator,
orchestrator order; session children sort by worker/name and host; host roots sort by host.

The org endpoint refresh runs every 30 seconds only while the Org chart tab is open. Lease
countdowns update locally every second, so the countdown does not create additional API calls.
Rendering replaces one stable tree and does not retain input-order jitter.

### 4. Lane 1 integration: PENDING, fixture proof complete

Rechecked immediately before this report:

- local `agent-edith` was still the shared base `6e9ab71`;
- `git ls-remote --heads origin agent-edith` returned no remote head.

The live code path already requests `/api/sessions` and `/api/seats` and accepts the frozen row
fields without changing the contract. When `/api/seats` is absent, it fails closed with an
integration-pending message and a link to `/?orgFixture=1`. Live response verification must run
after Edith lands M11.

## Verification evidence

- `node --check public/app.js`: green.
- `node --check public/orgchart.js`: green.
- Contract assertion: every fixture session and seat carries all module-declared M11 fields.
- Stable-order assertion: 50 shuffled session/seat inputs matched one expected tree.
- Headless Chromium: required state counts, exact 3-level chain, active Mac lease, theme switch,
  Windows restoration, Registry rows, SSH-key panels, and 390px responsive width all green.
- `git diff --check` and every milestone's `git show --check`: green.
- Registry completion POST: HTTP 200, `{"ok":true}` for `german-box / FD-alfons`.

## Files

Product scope:

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `public/orgchart.js`
- `public/orgchart-m11.fixture.json`
- `public/screenshots/xyz-1818-orgchart-dark.png`
- `public/screenshots/xyz-1818-orgchart-light.png`

Required lane artifact:

- `docs/goals/xyz-1742-fleet-lifecycle/reports/alfons.md`

Signed: **Alfons**

Tag: `agent-alfons`
