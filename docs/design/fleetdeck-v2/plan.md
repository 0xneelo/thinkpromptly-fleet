# Fleetdeck v2 — implementation plan

Rule (operator 2026-09-07): **verbatim 1:1 first, logic second.** Every slice is accepted by a machine
pixel-diff against the mock, never by eye. Ledger: `diff.md`. Inventory: `handoff.md`.

## Why this shape

The mock is a Claude Design export whose markup is real HTML with inline styles, rendered by a small
React-based runtime (`support.js`). The most faithful port is to **ship that markup and runtime as-is**
(vendored, not from unpkg) and then swap the seed data for live data inside the same template. Nobody
re-types the design, so nothing drifts. The seed data stays in the app as a **fixture mode**
(`?fixture=1`), so the pixel gate keeps working after the logic is wired.

## Phase 0 — gate first (S0, size S, `qa-engineer`)

- Add devDeps `playwright`, `pixelmatch`, `pngjs`; `scripts/design-diff.mjs`:
  1. serves `docs/design/fleetdeck-v2/mock/` on a scratch port and the app (`PORT=3199 FLEET_TRAIN_PORT=3198 node server.js`) on another;
  2. for each screen (18 labels, by clicking the same nav text on both sides) at 1440×900, dark and light, with `fd-app-video=false` and reduced motion forced;
  3. writes `docs/design/fleetdeck-v2/baseline/<screen>-<theme>.png` (mock) and `verify/<slice>/<screen>-<theme>.{png,diff.png}` + `report.json` (mismatch %).
- Gate: **≤ 0.5 % mismatched pixels per screen** (threshold 0.1). Anything above fails the slice.
- Box has passwordless sudo, Ubuntu 24.04, node 24, chromium libs present → `npx playwright install --with-deps chromium` works there.

## Phase 1 — verbatim port (S1, size M, `frontend-developer`)

One slice, because the artboard is one file:
1. Vendor `react` + `react-dom` UMD **and `@babel/standalone`** via the `VENDOR` map (server.js:2361) — the runtime transpiles the artboard's inline script with Babel at load (`support.js:1143-1147`) — and ship `support.js` as `/vendor/dc-runtime.js`; point its three unpkg URLs at the vendored files (URL swap only, nothing else touched in the generated file). Pre-transpiling the script once to drop runtime Babel is an optional L11 follow-up, not P1.
2. `public/v2/index.html` = the artboard verbatim (all 18 screens: land/app/deck), asset paths rewritten to `/v2/uploads/…` and `/vendor/…`. Served at `/v2/` next to the old UI until cut-over.
3. Baselines + gate green on all 18 screens × 2 themes. Report filed under `verify/S1/`.

Closes ledger D01, D02, D07 and the P1 half of D03-D19.

## Phase 2 — logic integration (each slice keeps the fixture-mode gate green)

| Slice | Role | Ledger | What | Size |
|---|---|---|---|---|
| L1 | frontend-developer | D06, D18-D20 | `public/v2/data.js` adapters for every endpoint in the behaviour contract; `?fixture=1`; hash routing `#windows … #desktop` + `land`/`deck` routes (`/landing.html`, `/deck.html`); legacy `/keys.html` etc. redirect to `/#…`; `fleetTheme` → `fd-landing-dark` migration; vendor Inter + provider logos (O5) | M |
| L2 | frontend-developer | D03, D04, D05 | sidebar sessions from `/api/sessions`, Connect all, Refresh, Boxes rail from `/api/health`, Accounts rail from `/api/credits`, unread badge | M |
| L3 | frontend-developer | D09, D10 | port the xterm engine (app.js:1020-1179) into the tile body via ref; overlays, resize, copy-on-select, stagger; full-screen overlay = maximize; ≡ menu = drawer switch; Escape + shift+Esc; O1, O2 | L |
| L4 | frontend-developer | D12 | Registry on live rows; filters/sort persisted under the existing keys; bulk + row actions; edits behind ⋯ (O3); Message → bus thread (O8) | M |
| L5 | frontend-developer | D11 | Org chart from `buildTree`; spine/kids/unattached; seats; 30 s poll + countdown; fixture mode; O4 | M |
| L6 | frontend-developer | D13, D08 | bus threads from `/api/messages` grouped by target; send/retry/broadcast; receipts from `status`; pinned/unread client-side; toast on new inbound | L |
| L7 | frontend-developer | D14 | SSH keys + train cards on live data; O9 | M |
| L8 | frontend-developer | D15 | Accounts cards on `/api/credits`; O6 | S |
| L9 | frontend-developer | D16 | Machines cards on `/api/machines`, 60 s poll | S |
| L10 | frontend-developer | D17 | Desktop sessions on `/api/desktop-sessions`; transcript, copy context/conversation, composer → bus | M |
| L11 | frontend-developer | cut-over | `/` serves v2; delete `app.js`, `style.css`, old pages; README + tests updated; final full gate run | S |

Waves (all slices edit `public/v2/index.html`, so keep concurrent workers on disjoint screen line ranges):
**A** S0 ∥ S1 → **B** S2 (pass-2 compile) → **C** L1 → **D** L2 ∥ L3 ∥ L4 → **E** L5 ∥ L6 ∥ L7 → **F** L8 ∥ L9 ∥ L10 → **G** L11.

**Operator ruling 2026-09-07 (after the precedent search): compile EARLY.** S2 turns the pass-1 port into plain HTML + JS with a parity check (Richmond's method, lowcap `editorial-clean-port`); every logic slice L1–L10 is then written in plain JS like today's `app.js`, and the product never ships React/Babel. The fixture-mode pixel gate stays the acceptance for every slice.

## Verification per slice (design seat)

1. `reviewer` on the diff.
2. Worker's `verify/<slice>/report.json` must be green; I re-run the gate on the branch and compare mock vs built in the browser pane side by side.
3. Ledger row → ✅ only with the screenshot pair + diff % filed. Disputes → `oracle` or the operator.

## Launch mechanics

- Packs: `docs/goals/fd-v2-<slice>/` via `/introduce-goal`, named workers (`name.py claim --role frontend-developer`), each pack cites its ledger rows and mock line ranges, and carries the token recipe.
- Box: `/german-box-workers` §4.0 gate before every launch (breed, effort, /goal vs one-shot). Broker probe `GET /api/ghtoken` was `200` at plan time.
- Branches `claude/fd-v2-<slice>` off `main`; workers push; nothing is merged here.
- Exit: weave brief to the live 🎛 ORCHESTRATOR of remote-system. **None is live** (census 2026-09-07: only lowcap-connector seats) → `operator-handoff` at the end unless one boots.

## Operator decisions (unblock sheet 2026-09-07, 8/8 answered)

| # | Decision | Ruling | Consequence in the plan |
|---|---|---|---|
| 1 | Runtime | vendor dc-runtime + React + Babel for S1; then **compile to plain JS EARLY (S2), before any logic** — ruling revised 2026-09-07 after the precedent search (`decisions.md`) | S1 verbatim; S2 = pass-2 compile + parity; L1–L10 in plain JS; L11 has no compile step. |
| 2 | External assets | **vendor everything, videos included** | S1 downloads the two CloudFront videos, Inter woff2 and the two provider logos into `public/v2/media/`; no external URL remains. Repo grows ~30-40 MB. |
| 3 | Routes | **Landing on `/`, App on `/app`** | L1: `/` = landing view, `/app` = app view (hash screens `#windows` …), `/deck` = investor deck; legacy `/keys.html` etc. → `/app#…`; README, `.claude/launch.json` and skills that open `/` get updated in L11. |
| 4 | Workers | **mixed**: GPT Astra xhigh for the mechanical slices, Claude high for the logic slices; both `/goal` mode | Astra: S0, S1, L7, L8, L9, L11. Claude: L1, L2, L3, L4, L5, L6, L10. Reviewer on every diff. |
| 5 | Windows empty state + ☰ | keep an empty state; ≡ only in the full-screen header | Copy: **"There are no sessions yet, open a new session via an orchestrator first."** (operator wording, typo fixed) |
| 6 | Registry edits | ⋯ row menu + expandable details row | plus the improvisation rule below |
| 7 | Accounts trend | **server rider now**: 7-day snapshots in `fleet.db` | new slice **L8s** (server) before L8; but first check what usage trackers already exist (operator: "we had so many systems") — search in progress |
| 8 | Small defaults O4/O8/O9 | confirmed | as written in `diff.md` |

### Improvisation rule (operator, same sheet)

**Everything the app needs that the mock does not show is designed by the worker, in the mock's visual
language, and recorded in `docs/design/fleetdeck-v2/improvised.md`**: one entry per improvisation with
the ledger row / open item it serves, a one-line rationale, and a linked screenshot under
`docs/design/fleetdeck-v2/improvised/<slug>.png`. An improvisation without an entry fails review.
Applies to: empty states, the ⋯ menu contents, the details expand row, error/loading states, the
source badge text, principal chips, anything else discovered while wiring logic.

### Slice table amendments

| Slice | Change |
|---|---|
| S1 | + vendor videos/fonts/logos (`public/v2/media/`), rewrite every external URL |
| L1 | routes per decision 3; theme key migration; no asset work left |
| L8s (new, Claude, size S) | server: `usage_snapshots` table in `fleet.db` (account, ts, windows/pct), written on every credits collect, pruned after 8 days; `GET /api/credits` returns `trend[]` per account. Blocked on the tracker audit result. |
| S2 (new, size M, Claude high) | pass-2: mechanical compile of `public/v2/index.html` (template + DCLogic script) into plain HTML + JS (`public/v2/app.js`, `landing.js`, `deck.js`), no React/Babel at runtime; parity suite ported from lowcap (`tools/f2-parity.mjs`, `hook-inventory.js`) → normalized DOM byte-identical to pass 1; pixel gate green on 36 screens; pass-1 files kept under `public/v2/pass1/` until L11 deletes them |
| L11 | + update README / launch.json / skills for `/` → landing, `/app` → app; delete `public/v2/pass1/` and the vendored React/Babel |

## Timeline (estimate given to the operator 2026-09-07, one wave per day, no rerun loops)

| Date | Milestone |
|---|---|
| 2026-09-08 | pixel-identical static preview at `/v2/` on the worker branch (wave A: S0 + S1) |
| 2026-09-09 | same preview as plain JS, engine removed (S2) |
| 2026-09-11 | terminals, sidebar, registry live in the new design (waves C + D) |
| 2026-09-13 | bus, org chart, keys, accounts, machines, desktop sessions (waves E + F) |
| 2026-09-14 | cut-over: `/` = landing, `/app` = deck, old UI deleted (L11); merged to main; operator runs `./up.sh` |

Stretch factors: GitHub train window must be open for every worker push; a red pixel gate returns a slice
(one rerun, then escalate); the weave into main needs a live remote-system 🎛 ORCHESTRATOR (none at plan time).
