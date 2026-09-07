# fd-v2-l11 — cut-over: routes, deletions, docs, gate hardening, final gate

**Worker:** Alrun · `fullstack-developer` · tag `agent-alrun` · branch `agent-v2-l11`
**Issue:** DECK-65 · **Filed blockers:** DECK-79, DECK-100
**Complete 2026-09-07.** Both phases done; the full weave (all nine slices) is merged and the
final gate is green. One acceptance box cannot be ticked: the registry row — see the end.

---

## Numbers

| Proof | Result |
|---|---|
| `verify/l11/report.json` — fixture-mode pixel gate | **36/36**, allPass true, max 0.033 % |
| `verify/l11/live.json` — live mode | **30/30**, allPass true |
| `verify/S0-selftest/report.json` — hardened gate self-test | **36/36**, allPass true, max 0.033 % |
| Baseline reproducibility after hardening | **36/36**, 35 of 36 PNGs byte-identical |
| `npm test` | **501/501** |

Measured on the complete weave (`origin/weave/fd-v2`, all nine slices) merged into
`agent-v2-l11`. The live proof breaks down as 14 route assertions on the wire, 8 shell
assertions across both themes, and 8 screens opened once each against a real server's own
API — 82 PNGs filed under `verify/l11/`.

`npm test` is genuinely green. A third run showed 4 failures; sibling worktrees run this
same suite concurrently and `test/http.js` picks its port at random, so a collision is
normal here. `test/v2-routes.test.js` shares one server across its 12 cases, which made a
collision cost twelve tests instead of one, so its `before` hook now retries five times.

## Behaviour checklist

The pack has **no `BEHAVIOUR.md`** — L2 through L10 each ship one, L11 does not. For a
cut-over slice the spec is the README's own §Scope, so the checklist is built from it.
Recorded as a pack gap rather than treated as a blocker.

| § | Item | State |
|---|---|---|
| 1 | `/` → landing view | **done** — 302 `/?view=land`, then the shell |
| 1 | `/app` → deck view | **done** — 200, no redirect |
| 1 | `/deck` → investor deck | **done** — 302 `/deck?view=deck`, then the shell |
| 1 | five legacy `.html` → 302 into `/app#<screen>` | **done** — all five, one hop each |
| 1 | `/v2/` keeps working | **done** — untouched; still what the pixel gate captures |
| 2 | delete the old UI | **done** — 12 files, `public/v2/pass1/`, 4 vendored runtimes |
| 2 | keep `board.html`, `orgchart-m11.fixture.json` | **done** — both served, both asserted |
| 3 | README UI sections rewritten | **done** — new "The UI" section; three view URLs |
| 3 | `.claude/launch.json` → `/app` | **done** |
| 3 | list every doc opening `localhost:3131/` | **done** — inventory below |
| 4 | gate hardening S0.1 | **done** — all six parts; see below |
| 5 | update tests referencing old pages | **done** — 3 files updated, 1 deleted, 1 added |
| 5 | `npm test` green | **done** — 314/314 |
| 5 | final gate 36/36 fixture mode | **done for phase 1** — re-runs after the weave |
| 5 | live-mode smoke, API stubbed | **20/22** — blocked on DECK-79 |

### §4 gate hardening, part by part

| Asked | Done |
|---|---|
| bounded settle replacing `networkidle` | `trackRequests()` counts only `fetch`/`xhr`; 300 ms quiet, 5 s cap |
| ignore websocket/eventsource | never counted — that was `networkidle`'s exact failure |
| blur after clicks | after each of the four clicks in `reachScreen`, and again in `settle` |
| hide focus-visible outlines and scrollbars, both sides | added to `CSS`, which both sides receive |
| `page.route` CDN → vendored when present | `CDN_MIRROR`; Inter's stylesheet and font are live, React/Babel inert (deleted in §2) |
| rename `verify/S0-baseline-failed` | now `verify/baseline-failed` |
| re-baseline only if PNGs change | **not re-baselined** — see below |

**No re-baseline was warranted.** A full baseline run after the hardening passed 36/36 at
max 0.033 %, inside the 0.05 % reproducibility target, and 35 of the 36 files came back
byte-identical to the committed baseline. The one that differed, `registry-dark.png`, is
the same screen that carries the run-to-run noise and it moved by exactly that 0.033 %. The
hardening is pixel-neutral, so the approved baseline was restored untouched.

## Deck URLs in docs

`~/.claude/skills` on this box has **no** `localhost:3131` references; the Mac's copies are
already inventoried in `MAC-REFS.md` and belong to the design seat.

In-repo, one live document pointed at a page that no longer exists, and it was fixed:

- `deploy-keys/AGENT.md:36,42` — `localhost:3131/keys.html` → `localhost:3131/app#keys`.

Every other hit is a dated report or a goal pack recording what was true when it was
written, so they are listed, not rewritten: `docs/operator-goals/ledger.json:7,8,61`,
`docs/goals/fleetdeck-machines/goal.md:7,12,40,82`,
`docs/goals/xyz-1742-fleet-lifecycle/reports/konrad-BLOCKED-push.md:11` and
`edith-BLOCKED-push.md:55`, `docs/goals/o40-boot-brief-2026-09-04.md:22`,
`HANDOFF-XYZ-1742-orgchart.md:137`, `HANDOFF-2026-08-29-o17.md:4`,
`docs/goals/gb-home-migration/goal.md:36`, and the sibling packs
`docs/goals/fd-v2-s0/README.md:68`, `fd-v2-s1/README.md:74`, `fd-v2-s2/README.md:111`.
The remaining hits (`box/hooks/*`, `deploy-keys/mint-github-token.sh:60`, `README.md:107`)
name the deck's origin or an API path, which the cut-over does not change. Nothing breaks
either way: the old URLs answer a 302.

## Hooks

**Provided:** none. **Used:** none. The pack specifies both as none, and L11 adds no client
JavaScript at all — it never calls `FD.setData`, mounts no DOM and binds no input, so the
DESIGN-35 binding rules (foreign-DOM mounts, throw-proof `renderVals`, raw input state)
have no surface in this slice. Re-checked after each base merge.

## Improvisations

Four, all in `docs/design/fleetdeck-v2/improvised.md` as I-L11-01 … I-L11-04: the
canonicalising redirect scheme, the legacy→screen mapping, the settle/mirror/re-baseline
decisions, and deleting the old desktop-sessions acceptance script rather than repointing
it. All are behaviour-only — L11 writes no markup and adds no pixels — so per that log's
own rule they carry no screenshots; their proof is `verify/l11/live.json`.

## Blockers found, filed, not fixed

**DECK-79 — the shell ignores `?view=`.** `public/v2/logic.js:1053` seeds the root view from
`props.startView`, never from `FD.router`, so the shell shows the landing view whatever the
URL says. L11 serves the right document with the right query string — proved 14/14 on the
wire — and the shell then ignores it. The shell is on this pack's **Out** list and
`public/v2/screens/shell.js` reads `// fd-v2 L2 shell: owned by that slice`, so this was
filed rather than fixed. It is the only reason `live.json` is 20/22. The fixture-mode pixel
gate is unaffected: it reaches each screen by clicking.

**DECK-100 — the base's fixture seam.** `test/v2-data.test.js` could not load at all
(`window is not defined` from S2's browser-only `fixture.js`), taking all 64 of its tests
with it, and 21 more failed on seed keys the base's `fixture.js` does not define. Both were
present on a clean checkout of `origin/agent-v2-base`. **Closed upstream during phase 1** by
L1.1's `fixture-extract.js`, which the merge brought in; the suite is now 314/314. L11's
one-line `globalThis.window` shim was superseded by L1.1's fuller version and dropped in
favour of it at the merge.

## Deviations from the pack

1. **Branch base.** The pack says `origin/weave/fd-v2`; the operator split the work in two
   and had phase 1 start from `origin/agent-v2-base`. Followed the operator.
2. **The pack lives on the plan branch.** `docs/goals/fd-v2-l11/` exists on
   `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5`, not on the base, so it was copied into
   this branch rather than filing the "pack missing" gate. The pack exists; it was not merged.
3. **`scripts/verify-desktop-sessions-ui.js` deleted, not updated.** §Scope 5 says "update";
   its four served files are all deleted here and none of its selectors exists in v2, so
   there was nothing to repoint it at. Reasoned in I-L11-04.
4. **`deploy-keys/AGENT.md` edited.** §Scope 3 only asks for a list. This one is a live
   agent-facing instruction rather than a dated record, so its two URLs were fixed too.
5. **The live-mode script lives in `scripts/`, not `verify/l11/`.** The gate republishes
   `verify/<slice>/` wholesale on every run, so a script stored there is deleted by the next
   gate run. It writes its outputs into `verify/l11/` as specified.

## Review

One `reviewer` pass over the whole diff. Five findings; three fixed, one already filed, one
rejected:

- *A settle that gives up leaves no trace* (medium) — **fixed**: `settle()` returns whether
  it reached quiet and the result carries `settleTimedOut`, so a mid-load screenshot is no
  longer indistinguishable from an ordinary pixel mismatch.
- *Page routes answer any method* (low) — **fixed**: GET and HEAD only; everything else
  falls through to the static handler exactly as before.
- *Repeated `view` parameter is untested* (low) — **fixed**: a test pins first-wins on both
  sides, matching `router.js:28`.
- *The live proof shows the shell ignoring the routes* (high) — **already filed** as DECK-79.
- *The `fonts.googleapis.com` mirror can never fire* (low) — **rejected**: the reviewer
  checked `public/v2/index.html`, which already links the local stylesheet. The **mock** is
  the side that loads the CDN, at `mock/Fleetdeck Final.dc.html:12`, and the mock is the
  gate's other side. The rule fires there, which is the whole point.

No Fable audit: `hard-crux` was not run for this slice. The work is mechanical (routes,
deletions, a settle loop) rather than a hard separable problem, and the gates measure it
directly.

## Phase 2 — three weave merges, and the two rulings that changed the scope

The weave arrived in three parts and was merged each time: `3f21496` (L1, L9, L10),
`8431130` (+L2), `444fc6d` (+L3, L4, L5, L7, L8), and finally the complete weave with L6.
Every merge conflict was `improvised.md` appending against `improvised.md` — resolved by
keeping both sides every time, and the file now carries all eleven slice sections.

**What the merges broke, and nothing else was touched.** `test/v2-desktop.test.js:341` was
L10's own tripwire: it asserted the *pre*-L1.2 behaviour (`'0 turns'`) while the test's own
name said `"Turns unknown"`, so that it would fire the moment L1.2 landed — which is what the
DESIGN-35 broadcast meant by "L10: remove any TODO shims". L1.2 came from the base and L10
from the weave, and the two had never met. Fixed to agree with its own name; on the next
weave Clodwig had made the identical fix in his own file, so his wording won the conflict.

### The two rulings

DESIGN-35 assigned L11 two things that its own pack had put out of scope, and they turned
out to be the same bug seen from two ends.

**DECK-84 — the shell never loaded the data layer.** `public/v2/index.html` listed the
runtime, the logic, the compiled render and the nine screens, but not `data.js` or
`router.js`. `FD.data` was therefore undefined on a plain page load, and **seven** screens
had each shipped a private `<script>` injector to work around it. The shell now loads
`data.js`, `router.js` and `orgchart.js`, and all seven injectors are gone — `accounts`,
`keys`, `machines`, `org`, `registry`, `windows` and `shell` itself. Every `if (FD.data)`
guard stayed, as the ruling asked, and each replacement kept its caller's contract: same
name, same async-ness, same return type, so no call site moved.

**DECK-79 — the shell never read the URL.** `logic.js` seeded its view from
`props.startView` and its screen from a `'bus'` default, and asked the router nothing.

Two deviations from the ruling's letter, both measured rather than argued:

1. **The script tags go before `app.js`, not after.** `app.js:3409` calls `D.mount()` at
   parse time, so the root is constructed — and reads the URL — while `app.js` is still
   executing. Loaded after it, `router.js` arrives too late to be read. Verified both ways:
   after `app.js`, `live.json` stays 20/22; before it, 22/22.
2. **The seed reads the raw query and then the path, never `FD.router.route()`.** `route()`
   substitutes its own defaults — `'app'` for the view, `'windows'` for the screen — so it
   cannot distinguish "nothing was asked for" from "app was asked for". That distinction is
   the whole of fixture parity: `/v2/?fixture=1` names no view and no screen and must keep
   rendering the mock's own `startView` and `'bus'` default. A seed built on `route()` would
   have opened every fixture capture on the app view showing Windows and failed 36 screens
   for a reason with nothing to do with design. The path arm is needed because `/app` carries
   no query at all — the server only redirects to add `?view=` where the router's default
   would be wrong. Recorded as I-L11-05.

`componentDidMount` subscribes to `FD.router.onChange` so back and forward move the deck;
`componentWillUnmount` releases it. Only a URL that names something changes anything.

**Tests that asserted the removed loader.** `test/v2-shell.test.js` checked the injector
directly — one `<script>` appended, `FD.__dataLoading` set. That is no longer an observable.
The rule those tests exist for is unchanged, so they now assert the start path itself, which
reports the absent data layer; a third case was added for the direction that had only been
implied, that fixture mode stops before the start path and not merely before the network.

### The live proof, and the one thing it forgives

`verify/l11/live.json` is 30 checks: 14 routes asserted on the wire, 8 shell checks across
both themes with `/api/*` stubbed from `docs/design/fleetdeck-v2/fixtures/api/`, and 8
screens opened once each against a **real** server's own API on an empty fleet, each
screenshotted to `verify/l11/live-<screen>.png`.

It forgives exactly one thing, and names it: a 503 from `/api/ghtrain`. That path proxies
the GitHub-train broker, a separate process that does not run beside a scratch server, so its
503 is absent infrastructure rather than anything a screen did. Everything else is strict —
and the proof now records the URL beside each non-2xx, because "Failed to load resource:
503" on its own names nothing. Finding that took a diagnostic pass; it is in the script so
the next person does not repeat it.

### DECK-85 — asked to confirm the Mac's 460/460 on the box

`npm test` is **501/501** here. Nothing red, nothing filed. But the suite is not reliably
green on a *first* read: `test/http.js` picks its port from a random band per process and
several worktrees run this suite concurrently on this box, so a run can lose tests to
`EADDRINUSE` on entirely different files each time. Read the summary counts and re-run before
believing a red. L11 hardened its own file — `test/v2-routes.test.js` shares one server
across 12 cases, so a single collision was taking all twelve down; its `before` hook now
retries five times. The shared band in `test/http.js` is untouched and is fair game for its
own issue.

## L11.1 — the last integration pass (weave `52069d1`)

The rider weave (L2.1 L3.1 L4.1 L5.1 L7.1 L8.1 L9 L10.1) merged with no conflicts and
brought two items, both caused by the merge rather than by either side being wrong.

**`keys.js` had its data.js loader back.** L7.1 edited the same region L11 had emptied, so
the 3-way merge kept both. Deleted again; L7.1's start/stop gating is untouched. The guard
`if (FD.data) boot();` stays, and the file already returns on fixture mode at its top, so
the loader's own `isFixture` re-check was redundant. No injector remains in any screen.

**Four badge tests went red, and the fix was in the shell, not the tests.** L2.1 made
`setBadge` retain a count until `ready` and apply it on arrival; L11 had changed how the
data layer arrives. `loadDataLayer()` had been reduced to "resolve if `FD.data`, else
reject at once", which is right for the new load order and wrong for anything else: the
shell could never recover if the data layer showed up a moment later. It now resolves
immediately when `FD.data` is there — the ordinary path, since `index.html` loads `data.js`
before the screens and classic scripts run in order, so `ready` means exactly "the data
layer was present when the screen booted" — and otherwise re-checks for a bounded number
of turns, through `setTimeout` where there is one so a request still in flight can land,
and on microtasks where there is not.

The four tests pass unweakened: their assertions are untouched, and the only harness line
that changed was the one modelling the deleted injector. It asserted the shell had appended
exactly one `<script>` and then fired its `onload`; it now asserts the shell appends
**nothing**, which is a stricter claim than the one it replaced.

**One bug found by instrumenting rather than reasoning.** The first version of that wait
declared its bound with `var` next to the function instead of above the boot call that uses
it. Function declarations hoist; `var` initialisers do not, so the bound read `undefined`,
`--left` was `NaN`, `NaN <= 0` never became true, and the retry chain starved the event loop
— the whole test file hung with no output at all rather than failing. Counting the
iterations found it in one run where reading the code had not. The constant now sits with
the module's other state, above the boot.

Final numbers on `52069d1` merged:

| Proof | Result |
|---|---|
| `verify/l11/report.json` — fixture-mode pixel gate | **36/36**, allPass true, max 0.033 % |
| `verify/l11/live.json` — live mode | **30/30**, allPass true |
| `npm test` | **544/544** |

## The one box that cannot be ticked

**The registry row.** `POST /api/registry` to the deck answers **401 unauthorized** from this
box, both with and without the bearer token in `~/.fleetdeck-bus-token`, and the tailnet
listener answers 404 on reads. Tried at the start of the slice and again at the end. This is
the deck's tailnet auth, not this slice; it is recorded rather than gated, and no row exists.

---

Signed **Alrun**, `fullstack-developer`, 2026-09-07.
