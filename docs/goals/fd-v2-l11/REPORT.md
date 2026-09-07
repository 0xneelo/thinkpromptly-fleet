# fd-v2-l11 — cut-over: routes, deletions, docs, gate hardening, final gate

**Worker:** Alrun · `fullstack-developer` · tag `agent-alrun` · branch `agent-v2-l11`
**Issue:** DECK-65 · **Filed blockers:** DECK-79, DECK-100
**Phase 1 complete 2026-09-07.** Phase 2 in progress: the first (partial) weave is merged and
green; the final gate waits on the rest of it.

---

## Numbers

| Proof | Result |
|---|---|
| `verify/l11/report.json` — fixture-mode pixel gate | **36/36**, allPass true, max 0.033 % |
| `verify/S0-selftest/report.json` — hardened gate self-test | **36/36**, allPass true, max 0.033 % |
| Baseline reproducibility after hardening | **36/36**, max 0.033 %, 35 of 36 PNGs byte-identical |
| `verify/l11/live.json` — live mode, API stubbed | **20/22**; 14/14 routes, 0 console errors both themes |
| `npm test` | **314/314** on two of three consecutive runs |

The two live-mode reds are DECK-79, and they are not L11's to fix — see below.

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

## Phase 2 — first weave merged, and the weave is not finished

`origin/weave/fd-v2` appeared at `3f21496` and was merged. **It is partial**: it carries
L1, L9 and L10 only — L2 through L8 are not in it. `public/v2/screens/{windows,org,registry,
bus,keys,accounts,shell}.js` are still one-line stubs.

After the merge, re-run against the merged tree:

| Proof | Result |
|---|---|
| `verify/l11/report.json` — fixture-mode pixel gate | **36/36**, max 0.033 % |
| `verify/l11/live.json` | **20/22** — unchanged; DECK-79 is not in this weave |
| `npm test` | **378/378** |

**One conflict, one break, both handled.**

`improvised.md` conflicted as an append against an append — L9 and L10's sections against
L11's. Nothing was dropped: all four slice sections are in the file, in slice order.

`test/v2-desktop.test.js:341` then failed, and it is exactly what the merge broke: L1.2 came
from the base, L10 came from the weave, and the two had never met. The assertion was L10's
own tripwire, asserting the *pre*-L1.2 behaviour (`'0 turns'`) while the test's own name says
`"Turns unknown"` — designed to fire the moment L1.2 landed, which is what the DESIGN-35
broadcast meant by "L10: remove any TODO shims you added for these". Its two neighbouring
assertions, which check L10's screen override, still pass, because that override is
idempotent by its own design (`public/v2/screens/desktop.js:201-206`). The tripwire now
asserts `'Turns unknown'`, so the test name, the assertion and the shipped behaviour agree.
Left alone for Clodwig: the override at `desktop.js:214` is now redundant with L1.2 and
could be deleted, but it is not broken and it is not L11's file.

### Still to do

1. Wait for the rest of the weave (L2-L8) and merge again.
2. **DECK-79 must close for `live.json` to reach 22/22.** The shell fix is L2's, and L2 is
   not in this weave. If the completed weave still does not carry it, that is escalated
   rather than worked around.
3. Re-run both gates, fix only what the merge breaks, push again.

---

Signed **Alrun**, `fullstack-developer`, 2026-09-07.
