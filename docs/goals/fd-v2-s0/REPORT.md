# fd-v2 S0 — pixel-diff gate

Worker: **Gisbert** (`qa-engineer`, `agent-gisbert`).
Project: `remote-system` / `fleetdeck-v2`. Branch: `agent-v2-s0`.
Date: 2026-09-07 (Europe/Berlin; capture timestamps are UTC).

Status: **complete** under DESIGN-35's pending-ledger authorization. Every
Acceptance checkbox is checked.

## Built

[`scripts/design-diff.mjs`](../../../scripts/design-diff.mjs) exports the 18-screen
map, serves the untouched mock on a scratch loopback port, navigates through the
same clicks on both sides, and captures every label in dark and light. It writes
1440×900 PNGs, pixel diffs and a JSON report. Pixelmatch uses threshold `0.1`,
`includeAA: false`; more than `0.5%` mismatch exits 1.

Both sides use identical pre-load storage and CSS, DPR 1, corresponding color
scheme, reduced motion, en-US locale and UTC. Each capture gets a fresh context.
Animation, transition and caret pixels are disabled; video/canvas pixels are
hidden and media requests blocked. Native reveals, fonts, visible images and
network idle settle before screenshots. Runtime error markers and resource
failures prevent a pass. Fatal startup replaces any stale successful report with
an explicit failed attempt; failed baseline capture preserves canonical images.

Added only development dependencies (`playwright`, `pixelmatch`, `pngjs`), the npm
entry, documentation, baselines and verification artifacts. No `public/`,
`server.js`, or mock source file was edited. The app under development in S1 was
not needed or contacted.

## Run

From the worktree root:

```sh
npm ci
npx playwright install --with-deps chromium
npm run design:diff -- --baseline
npm run design:diff -- --baseline
npm run design:diff -- --app mock --slice S0-selftest
npm run design:diff -- --app 'http://127.0.0.1:3199/v2/?fixture=1' --slice S1
```

`--mock <url>` overrides the mock source for baseline capture or `--app mock`.
The official self-test instead used a separately served copy of the same mock:

```sh
python3 -m http.server 4175 --bind 127.0.0.1 --directory docs/design/fleetdeck-v2/mock
# Another terminal:
npm run design:diff -- --app 'http://127.0.0.1:4175/Fleetdeck%20Final.dc.html' --slice S0-selftest
```

Supply only mock/fixture URLs served for testing. The source mock requires
network access for React/Babel and Inter. Use the locked dependencies and the same
Chromium/OS/fonts as these baselines: Playwright 1.63.0, Chromium 153.0.8010.12,
Node v24.14.1, Linux x64. Later baseline runs compare against the prior images at
the stricter 0.05% repeatability limit. A new run replaces its output directory;
archive earlier run manifests before re-running if retaining historical evidence.

## Numeric evidence

| Proof | Coverage | Maximum mismatch | Result |
|---|---|---:|---|
| First baseline | 36 captures | Not a comparison | allPass |
| Second baseline vs first | 36 pairs | 0.04737654320987654% | 36/36 ≤0.05% |
| Mock-as-app self-test | 36 pairs | 0.03294753086419753% | allPass; 36/36 ≤0.05% |
| Deliberately changed scratch app | 30 measured pairs + 6 injected errors | 1.483719135802469% | Expected exit 1; allPass false |

Repeatability is not byte-identical: registry dark differed by 427 pixels
(0.03294753086419753%); desktop sessions dark differed by 614 pixels
(0.04737654320987654%). The other 34 pairs were zero. The reviewer inspected the
nonzero regions: native select text only. In the self-test, registry dark differed
by 427 pixels and the other 35 pairs were zero. Every required comparison passed
the specified 0.05% limit; no source screen was skipped.

The [baseline report](../../design/fleetdeck-v2/baseline/report.json) records all
36 current PNG hashes and first-run hashes. The
[self-test report](../../design/fleetdeck-v2/verify/S0-selftest/report.json), 36 app
PNGs and 36 diff PNGs are retained together, along with
`baseline-run-1.json` and `baseline-run-2.json`. All positive PNG hashes and diff
images were independently recomputed against the actual comparator.

The [failure checks](../../design/fleetdeck-v2/verify/S0-selftest/checks/checks.json)
also prove the precise boundary: 6,480 changed pixels of 1,296,000 is 0.5% and
passes; 6,481 is 0.5000771604938271% and fails. Seven invalid CLI cases, invalid
dimensions, screen-map uniqueness, traversal rejection and method rejection pass.

The [adversarial evidence](../../design/fleetdeck-v2/verify/S0-selftest/checks/adversarial.json)
used an isolated scratch checkout and in-memory HTML changes: a fixed magenta
160×120 overlay, two missing Capability labels and two Machines runtime errors;
one missing baseline and one 100×100 baseline existed only in that scratch copy.
All 36 rows remained accounted for: 30 numeric failures with diffs and six explicit
error reasons. A missing Chromium executable replaced a seeded stale-green report
with 36 failed entries. Original mock and baseline PNGs remained unchanged.

## Review

Reader pre-audit confirmed all 18 routes and identified reveal, slide-opacity,
font and runtime readiness requirements. The reviewer found and rechecked fixes
for four defects: frozen pngjs options, stale green reports on startup failure,
suppressed runtime errors, and an overbroad README claim. Script and baseline
reviews are clean. The final implementation/artifact review is also clean: all
36 positive comparisons, all 36 diff images and 72 PNG hash links recomputed; all
30 measured negative comparisons/diffs and six explicit errors verified. The
[review receipt](../../design/fleetdeck-v2/verify/S0-selftest/checks/review.json)
records the verdict and tested script hash.

## Tracking and delivery

Milestones pushed: `47dbabb` dependencies; `f94b5f2` script/documentation;
`f17f1b5` baselines; `8ccb7d8a04eae2169be390b29abe3e2bd5657a7d` self-test
proof and reviewed artifacts. Fresh broker credentials were passed in the process
environment for each push. A separately authenticated `git ls-remote` matched the
full proof commit SHA. The final documentation head receipt accompanies the
completion response.
Each milestone references its local pending ID, without inventing a Linear key.

DESIGN-35 explicitly authorized [LINEAR-PENDING.md](LINEAR-PENDING.md) as the
committed transport for every issue/comment while box OAuth is expired. Linear
was retried at milestones and still returns `oauth_token_invalid_grant`; the
design seat mirrors these entries later. No actual issue creation or state
transition is claimed. This is an authorized tracking follow-up, not a blocker.

Registry metadata registration returned HTTP 200 with the documented provisioned
tailnet key. The API rejected literal `task: PENDING` with HTTP 400 because task
must be an issue key; a note points to the pending ledger and no fake key was
supplied. The design seat can set the real main key when mirroring. The authorized
registry completion POST (`german-box`, `FD-v2-s0`, `status: done`) returned
HTTP 200 / `{"ok":true}` at 2026-09-06T23:26:01Z. The signed
[delivery receipt](../../design/fleetdeck-v2/verify/S0-selftest/checks/delivery.json)
records the exact request body and the authenticated proof-commit verification.

Open implementation issues: none. Live S1 integration is outside this slice.

Signed: **Gisbert**
