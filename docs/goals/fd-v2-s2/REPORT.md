# fd-v2-s2 — pass-2 compile: report

Worker **Julius** · `frontend-developer` · Claude · branch `agent-v2-s2` · 2026-09-07.
Main issue **DECK-32**; sub-issues DECK-39 (runtime shim), DECK-40 (compiler), DECK-41 (gates).

## Result

The design template is compiled to plain-JS render functions. React, ReactDOM, Babel and dc-runtime
are gone. The mock's logic class runs unmodified on a dependency-free shim. Every gate is green.

| Gate | Result | Evidence |
|---|---|---|
| F2 normalized-DOM parity | **36/36 identical**, volatile mask **empty** | `verify/S2/parity.json` |
| Interaction parity | **34/34 steps identical**, mask **empty**, `failedSteps: []` | `verify/S2/interactions.json` |
| Pixel gate, 36 screens | **`allPass: true`**, max mismatch **0.032948 %** | `verify/S2/report.json` |
| No engine | **`allPass: true`** — 0 engine loads, 0 console errors, 0 page errors, 0 failed requests, 36/36 screens reached | `verify/S2/network.json` |
| `npm run v2:compile` | **idempotent** — all four outputs byte-identical across two runs | below |
| `npm run v2:check` | **green**, exit 0 | below |
| Round trip byte-identical | **yes** — template script body sha256 `d0db2453d48bee35…`, re-inserted reproduces the template exactly (205602 bytes, sha256 `96be98b6…`) | `verify/S2/logic-roundtrip.txt` |
| `logic.js` as emitted | 80544 bytes, sha256 `806484221cda532d…` — the body after the 7 T3 substitutions, differing by design | `verify/S2/logic-roundtrip.txt` |

The pixel maximum is the same number on the same screen (`registry` dark) as pass 1's own run. The
compiled build is pixel-identical to pass 1 to the digit.

Pass 1's four known diagnostics are gone **by construction**. dc-runtime parses the raw template before
binding, so it requested `/v2/%7B%7B%20A_videoUrl%20%7D%7D` and fed an unbound `{{ a.trendPts }}` to
`<polyline>`. A compiled render has no pre-bind DOM, so neither can happen. Measured: pass 1 produced
72 console errors and 36 failed requests across the 36 screen-theme runs; pass 2 produces **zero of each**.

## What I found before writing any code

**S0's pixel gate had never reached the S1 lineage.** `scripts/design-diff.mjs` and the 37 baselines
lived only on `origin/agent-v2-s0`. Wave A ran S0 and S1 in parallel off `main`, and S0 was never merged
into S1. That is why S1 shipped with its gate unrun — its `REPORT.md` recorded all 36 rows as "not run".
The S2 pack itself was also missing from my base, sitting on the docs branch.

Both are declared Inputs of my README, so I merged both, then ran the gate S1 could not: **pass 1 scored
36/36, `allPass: true`, max 0.032948 %**. That mattered before writing a line of compiler. The 36
baselines were captured from the **mock**, not from the port, so "compiled output vs baselines" only
isolates the compile step if the port already matches the mock. It does. Any S2 pixel mismatch was
therefore attributable to my work, not to inherited drift.

S1 was later accepted at `70c32bb` and merged. Its own report and my independent recheck agree exactly —
`allPass: true`, 36 results, max `0.03294753086419753` — from different ports. The gate is reproducible
to the digit. Details in `IMPORT-RECORD.md`.

## Method

I wrote the behavioural contract first (`docs/design/fleetdeck-v2/S2-runtime-spec.md`, 194 lines) from
two independent audits of `dc-runtime.js` — a GPT run that instrumented the runtime in a node `vm` and a
Sonnet reader that verified its findings against the source. Only then did compilation start.

The decisive ruling from that audit: `resolve`, `compileAttr`, `cssToObj`, `importantify`,
`findTopLevelEquality`, `parensWrapWhole`, `kebabToCamel` and `EVENT_MAP` are **ported verbatim** rather
than reimplemented. The DSL is a restricted evaluator with reproducible bugs — equality is split before
string literals are recognised, so `'a==b'` resolves to `true`; and the whole-value attribute regex spans
multiple holes, so `"{{ a }} {{ b }}"` collapses to `undefined`. A clean-room reimplementation would have
fixed those bugs and failed parity. Porting them keeps the bugs, which is the requirement.

Three findings from the audit shaped the shim and would each have broken parity if guessed:

- `ref` never becomes a DOM attribute. React extracts it, and the logic supplies **callback refs**
  (`videoRef: (el) => {…}`, `busRef`, `termRef`, `threadRef`). Video setup, bus autoscroll and terminal
  autoscroll depend on them, so the shim calls function refs on attach and with `null` on detach, and
  reuses DOM nodes rather than re-creating them.
- `muted` is set as a **property**, not an attribute — pass 1's rendered `<video>` carries no `muted`
  attribute at all.
- The pseudo-class rules are **mostly empty**. `style-hover` is passed to `pseudoClass()` as a raw,
  uninterpolated string, so `.scp0:hover{color:{{ L_ink }} !important}` is invalid CSS and the browser
  drops the declaration. Hover styling in pass 1 is largely inert. The compiled build reproduces the same
  dead rules. Making hover work would have been a behaviour change and a parity failure.

## Gates, and what they caught

Each gate was validated against pass 1 **before** it was pointed at the compiled build, and each parity
gate was proven to fail: a one-byte mutation inside `#dc-root` (`>Status<` → `>StatusZ<`) is caught at
offset 43016 with exit 1. A gate nobody has seen fail is not evidence.

**The volatile mask is empty in both parity gates.** Spec §12 predicted it. Every volatile source in the
logic is timer-driven — 2 `setInterval`, 7 `setTimeout`, 1 `requestAnimationFrame`, zero `Math.random` —
and `Date.now()` runs only inside handlers whose timers are frozen. With `setTimeout` frozen the
delivered/acked transitions and the inbound ACK bubble never fire, so no `Date.now()`-derived value ever
reaches the DOM. Nothing needed excusing, so nothing was excused.

The gates found one real bug in the compiled build: **`value` was dropped on `<option>`**. Setting the
DOM property is right for a controlled input but does not reflect to the attribute on `<option>`, so four
options on the org-chart screen lost their value — exactly the 74-byte deficit the gate reported. That is
functional, not cosmetic: a valueless `<option>` submits its text content. Fixed and re-verified.

I also found and fixed two **false greens in my own interaction gate** before trusting it:

1. `deck-enter` timed out, because the Deck link lives in the landing nav and the landing view is
   `display:none` once the app view is active. The deck step and its four ArrowRights were silent no-ops
   for 30 s each — and still scored 34/34 with `allIdentical: true, exit 0`.
2. A step that failed on **both** sides produced two matching dumps and counted as parity, because
   neither side had done anything.

Executing every step is now part of the verdict. Each ArrowRight is verified to change the DOM hash at
constant length (`9bab1af0 → fda4ee53 → af0eb28b → 3dd4ec8e`), the signature of slide switching by
opacity and z-index. The interactions are substantive: 30 distinct DOM states across 34 steps, with real
deltas — sidebar collapse −12,627 chars, registry +23,152, desktop sessions +67,722.

## T3 — the operator's fixture split

Received mid-slice and implemented (`T3-RULING.md`). Seed data moved out of `logic.js` into
`public/v2/fixture.js` behind `FD.fixture`; `runtime.js` gained `FD.setData(name, value)`;
`FD.screens` and `FD.shell` are exposed before the nine per-slice screen scripts load.

**7 of the 13 named seeds were substituted.** I verified every moved literal is byte-identical myself, by
balanced-literal extraction from the template rather than by trusting the generator:

| Seed | Bytes | Byte-identical |
|---|---|---|
| `regData` | 1736 | yes |
| `busSessions` | 741 | yes |
| `seedThreads` | 3347 | yes |
| `orgScopeData` | 1293 | yes |
| `keyRows` | 1238 | yes |
| `dsData` | 3308 | yes |
| `titles` | 927 | yes |

**Six were deliberately not substituted**, with reasons recorded in `verify/S2/t3-substitutions.txt`:
`busGroups`, `tiles` and `groups` are literals that close over locals in the logic; `accounts` and
`machines` each have two declarations and are ambiguous; `termLinesFor` is a function, not a data literal.
Forcing any of them risked a behaviour change, and T3 must be behaviour-neutral. Every OUT→IN pair is
quoted in that file. **This needs a design-seat ruling**: the operator named all 13, and the ruling for
`termLinesFor` was to move "the data inside" it, which is a more surgical edit than the others and was
not attempted. All gates were re-run after T3 and stayed green.

## Deviations, declared

1. **A fifth normalization step, n5: canonical attribute order.** The first real parity run scored 0/36
   purely on `<video>` attribute order — same attributes, same values, identical byte lengths. That order
   is not a property of the template: React sets attributes in prop order, then `LandLogic.setupVideo`
   assigns `video.src` after mount. Requiring a compiler to reproduce an ordering produced by React's
   internal prop iteration plus a post-mount side effect would be fidelity theatre. n5 sorts attribute
   names only; the full attribute set and every value are still compared byte for byte. Three unit checks
   hold it honest: an order-only difference matches, a changed value is still caught, a missing attribute
   is still caught. That last property immediately earned itself — it is what surfaced the `<option
   value>` bug. This goes beyond the pack's "n1–n3 + volatile mask" wording, so it is declared in the
   file, recorded in `parity.json` as `normalizations[]`, and stated here.
2. **The DOM dump is scoped to the `#dc-root` subtree, not the document.** dc-runtime injects four
   stylesheets into `<head>` that S2 exists to delete, so a document-scoped comparison would forbid its
   own deliverable. Head styling is not unproven — the pixel gate covers it across 36 screens at 0.5 %,
   a stronger check on visual output than string equality.
3. **The mandated adversarial pass could not run.** The GPT `hunter` bridge returned
   `You've hit your usage limit … try again at Sep 12th, 2026`, five days past the ship date, and a Fable
   audit returned HTTP 429 `You've reached your Fable limit`. Both adversarial routes were unavailable at
   once. I ran the identical adversarial brief on a Sonnet `reviewer` instead. That substitute is weaker
   than a `hunter` pass and the reader should weigh it as such.
4. **`runtime.js` line count — RESOLVED.** The design seat has accepted the shim at 361 lines and
   confirmed the 300 was a guideline, not a hard cap. It now stands at **374**: the adversarial fix for
   the missing Array case added 13 lines on top of the accepted 361, and the seat asked for that fix to
   land. Recorded for completeness rather than as an open question. Composition: 323 code, 33 comment, 18 blank. A trim pass took it from 374 to 361 by collapsing
   genuinely-single statements and deleting a redundant event-type map; no semantics and no explanatory
   comments were touched. The adversarial fix for the missing Array case then added 13 lines back. The
   gates were re-run after each change.

   Reaching 300 costs more than it buys. The only three cuts that get there, with what each destroys:

   | Cut | Lands at | Cost |
   |---|---|---|
   | Move `importantify` + `stripComments` + `scanUnquotedUrl` to compile time | 312 | A required verbatim port leaves the shim — and 312 is still over 300 |
   | Write `style` as a string instead of per-property CSSOM | 304 | Loses the `0`->`0px` / `.5s`->`0.5s` normalization that carries much of the byte identity, and clobbers `applyView()`'s imperative `display` writes. **Breaks 36/36** |
   | Drop the form-control reflection (`value`/`checked`, `<option>`, `defaultValue`, `autoFocus`) | 306 | **Reintroduces the `<option value>` bug** the parity gate caught |

   Even all three together now land just above 300 after the Array fix. Each sacrifices something the pack values more than the line count:
   bug-compatible ports, 36/36 parity, and a real functional fix. A 361-line shim that reproduces the
   runtime faithfully is worth more than a 300-line one that quietly diverges. Recorded for the design
   seat to overrule if it disagrees.

## The L2-L10 data seam, proven

`FD.setData(name, value)` is the only data entry point for the nine parallel slices, so "it re-renders"
had to be measured rather than assumed. The failure I went looking for: if `logic.js` had captured the
seeds at load time (`const regData = FD.fixture.regData` at module scope), `setData` would replace the
fixture, schedule a render, and the UI would never change — silently, and only discovered by nine slices
at once.

It does not. The substituted declarations sit **inside `renderVals()`** (lines 335-881), which re-runs on
every render and re-reads `FD.fixture`. Measured end to end: registry rows 12 -> 1, the new row's text
rendered, old rows gone. `tools/v2-setdata-check.mjs` keeps that a standing check for L2-L10 rather than a
one-off observation.

## Adversarial pass

The pack mandates a `hunter` (GPT) pass on `tools/dc-compile.mjs` and `public/v2/runtime.js`. It could
not run: the Codex bridge returned `You've hit your usage limit … try again at Sep 12th, 2026`, five days
past the ship date, and a Fable audit returned HTTP 429 `You've reached your Fable limit`. Both
adversarial routes were down at the same time. I ran the identical brief on a Sonnet `reviewer`. **That
substitute is weaker than a `hunter` pass and should be weighed as such.**

It verified line-for-line against `dc-runtime.js` that `resolve`, `parensWrapWhole`,
`findTopLevelEquality`, `resolvePath`, `compileAttr`, `cssToObj`, `kebabToCamel`, `importantify`,
`stripComments`, `scanUnquotedUrl`, `EVENT_MAP`, `encodeCase`, `$index` shadowing, the `sc-if`/`sc-for`
truthy-string quirk and the keyed reconciler are faithful ports — **including both documented BUGs**,
which reproduce correctly. The reconciler was traced by hand through rotation, reversal and insertion.

Five findings, **all latent for L2-L10, none reachable in the current build**.

**Fixed:**

1. **`I()` dropped a spec §2 case** (`runtime.js`). It handled `undefined`/`null`/boolean and otherwise
   always stringified into a span, never implementing "a React element or Array is inserted directly,
   with no span" (vendor `walkText`, L603-605). Once a slice feeds an array to a plain `{{ }}` text hole
   outside an `sc-for`, the shim would render `<span class="sc-interp">tag1,tag2</span>` via
   `Array.prototype.toString` where the vendor inserts the items unwrapped.
2. **`isPureData` was blind to `${…}`** (`dc-compile.mjs`). It blanked backtick spans before its
   bare-identifier scan, so a template literal closing over a logic-local was classified pure and its
   seed moved into `fixture.js` — which loads *before* `logic.js`, so the identifier is out of scope and
   the page throws `ReferenceError` at load and **fails to boot**, with `--check` reporting nothing wrong.
   Not triggered by the current template (its only two backticks sit inside plain strings in
   `termLinesFor`), but reshaping seed data is exactly what the nine slices will do. The classifier now
   errs toward "impure": a false impure costs one un-migrated seed, a false pure costs a dead page.

**Ruled, not fixed:**

3. `flush()` has no error boundary around the render itself, so a throw from `renderRoot`/`h`/
   `syncChildren` escapes as an unhandled rejection with the DOM half-updated, where the vendor's React
   boundary would show a per-component fallback. Real, but adding one is a behaviour change I declined to
   make on the last night before ship, and it is unreachable with fixture data. **Recommended for an
   L-slice.**
4. `logic.props` is reassigned before `componentDidUpdate(prevProps)` receives the same reference, so a
   prevProps-vs-current comparison always reads "unchanged". Unobservable today — nothing mutates
   `host.props` after mount — but it would silently disable prop-change detection in a future slice.
5. `CAMEL_ATTR_RE` matches inside text nodes, so prose like `set userName=info@x.com` is silently
   rewritten. This is a **faithful port of a vendor bug** (dc-runtime L361) and must not be fixed. It
   becomes a content-lint note for the new screens' copy.

## Subagents used

Reads and audits went to subagents throughout, per the delegation policy: a GPT run and a Sonnet reader
for the dc-runtime audit, Sonnet readers for the template anatomy, the precedent tools, the pixel-gate
interface and the interaction selector inventory, Opus builders for the parity harness and for the
compiler and shim, and a Sonnet reviewer on every diff. The reviewer pass on the three gate tools
returned 8 findings; its two critical ones were the false greens I had already fixed, four more were real
and fixed (media-blocking predicate mismatch, a missing freeze assertion, a code-point/code-unit offset
bug, an over-anchored engine regex), and two were ruled with reasons.

## A trap in the gate suite, for whoever runs it next

`scripts/design-diff.mjs` publishes by renaming a staging directory over `verify/<slice>/` and deleting
the old one (`publish()`, L244-251). It therefore **destroys every sibling report in that directory**. It
silently removed `parity.json`, `interactions.json` and `network.json` on one run here. **Run the pixel
gate first, then the other three**, or give `design-diff` its own output directory. It bit twice here:
once destroying `parity.json`, `interactions.json` and `network.json`, and once destroying
`logic-roundtrip.txt` and `t3-substitutions.txt`, which `v2:compile` writes *before* the pixel gate runs.
The second time a `git add -A` committed the deletion. Both proofs were regenerated with `npm run
v2:compile` afterwards, and that run changed no build output — which is itself a second demonstration
that the compiler is idempotent. All six artifacts now coexist.

One cosmetic inaccuracy in the generated proofs, left as-is because the hashes are the real evidence:
`logic-roundtrip.txt` reports "source bytes 205150" and "body bytes 92669" where the files are 205602 and
93067 bytes. Those figures are UTF-16 code-unit counts labelled as bytes; the ~450 difference is
multi-byte UTF-8 characters in the template. The sha256 values are computed over the real bytes and do
match, and I verified byte-identity independently by byte-offset extraction.

## Commits

`git log --oneline origin/agent-v2-s1..HEAD` — 31 commits at the time of writing. Milestones:

- `f6eca9f` record the input import and the S1 gate gap
- `b6d4b62` run S1's missing pixel gate — pass 1 is 36/36
- `5d867a3` freeze the template source, preserve pass 1 as side A
- `27252bb` pin the dc-runtime behavioural contract
- `1f08c19` no-engine proof, calibrated against pass 1
- `221fd0c` DOM and interaction parity gates
- `55b9e0c` declared n5 canonical attribute order
- `dafeba6` close reviewer findings in the gate tools
- `2bd76de` compile the template to plain JS and split the fixture

## S2.1 — follow-up after the independent review

The design seat's review of S2 raised six items. S2 stays accepted; these landed in one follow-up commit.

**1. The two proofs `REPORT.md` cites were missing at `f370e4e`.** Correct — the pixel gate had deleted
them and a `git add -A` committed the deletion. I had already caught and restored them in `8abf779`
before the review arrived; they are present and regenerated here.

**2. `npm run v2:check` now exits 0 at HEAD, and stays 0.** The root cause was real:
`tools/dc-compile.mjs` counted `logic-roundtrip.txt` and `t3-substitutions.txt` as generated outputs, so
every pixel-gate run — which republishes `verify/S2/` by renaming a staging directory over it — left the
check red for a reason that says nothing about whether the app is stale. **The two proofs are now
evidence documents, written by a compile but excluded from the staleness verdict.** A `--check` must not
write files, so healing them inside `--check` was the wrong half of the choice.

Proven three ways, by exit code:

| Scenario | `npm run v2:check` |
|---|---|
| proofs present | **exit 0** |
| proofs deleted, exactly as the pixel gate leaves them | **exit 0** |
| `public/v2/app.js` tampered with one appended line | **exit 1**, `stale: public/v2/app.js` |

So the check no longer goes red for the wrong reason, and still catches the thing it exists to catch.

**3. The `logic.js sha256` label was wrong.** It printed the sha of the pre-T3 template script body under
a `logic.js` label — the same hash as the line above it, which is how it went unnoticed. Now the proof
reads `template script body sha256` for the body and prints the sha of the **emitted** `public/v2/logic.js`
under `logic.js`, with a note that the two differ by design because of the T3 substitutions. Verified
against independent hashing of the files on disk: `806484221cda532d…`, 80544 bytes.

While fixing the label I also corrected the byte counts. They were `String.length`, which is UTF-16 code
units, so the proof reported 205150 and 92669 for files that are 205602 and 93067 bytes. They now use
`Buffer.byteLength`, and the numbers match `wc -c`.

**4. A keystroke step, and it is the seam that mattered.** `tools/v2-interactions.mjs` now clears the bus
composer, clicks it, and types five characters **one keystroke at a time** with `page.keyboard.type`.
`setDraft` calls `setState` on every character, so the composer re-renders five times.

The probe asserts what a DOM dump structurally cannot see: focus and caret. Markup is identical whether or
not the textarea kept focus and whether the caret sits at 0 or 5, so if the reconciler had replaced the
node instead of reusing it, typing would be unusable **with DOM parity still green**.

Result on both sides: `focusIsComposer=true`, caret `5/5`, value `"abcde"`, both sides agreeing.

The probe is proven to fail. With a `blur()` injected after typing as a negative control, the step goes
DIFF, `focus/caret probe failures: bus-keystrokes`, exit 1 — **even though both sides agreed and the DOM
dump was unchanged**. Agreeing that focus was lost is deliberately not a pass.

**5. The `arrayKids` fix is in this branch** (landed `3e64200`, re-gated here).

**6. Out-of-scope edits, declared.**
- `.claude/launch.json` — **not mine.** It was changed by commit `826d5fa` ("tooling: launch config
  v2-preview", author `0xneelo`), which is on `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` and
  arrived on this branch through the docs merge the seat asked me to perform. Nothing to revert.
- `.gitignore` — **mine, and I recommend keeping it.** Four lines adding `.tmp/` and `.tmp2/`, in commit
  `c0324a4`. It exists because my own `git add -A` swept 790 KB of a builder's scratch directory into the
  tree; the same commit removed it. Reverting the ignore would re-expose the repo to the accident it was
  written to prevent. Happy to drop it if the seat prefers.

### S2.1 gate re-run, all green

| Gate | Result |
|---|---|
| F2 DOM parity | **36/36 identical**, mask empty |
| Interaction parity | **36/36 steps identical** (34 + the 2 new keystroke steps), mask empty |
| Keystroke focus/caret probe | **pass** — focus held, caret 5/5, both sides agree; proven to fail under a blur |
| Pixel gate | **`allPass: true`**, max **0.032948 %** |
| No engine | **`allPass: true`** — 0 loads, 0 console errors, 0 page errors, 0 failed requests |
| `npm run v2:compile` | **idempotent** |
| `npm run v2:check` | **exit 0** |
| `FD.setData` seam | **pass** |

## S2.2 — the oracle's shim findings

Seven findings from the design seat's oracle audit of `runtime.js` and `dc-compile.mjs` at `3e64200`,
all reproduced in Chromium. Fixed in one push, ahead of S2.1's remaining items, because F1-F3 block the
nine logic slices.

**The audit file itself was not reachable.** `docs/design/fleetdeck-v2/audits/s2-shim-oracle-2026-09-08.md`
does not exist on `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` after a fresh fetch
(`0724bdf..32fc491`), nor on any other ref — I scanned every remote branch for `oracle` and `s2-shim`.
The same thing happened with the T3 README amendment. The instruction text specifies every finding with
file, line and required fix, so I implemented from it and recorded the gap here rather than blocking.

I also checked before starting that this was not already fixed elsewhere: `origin/agent-v2-base` @
`42b56bb` is simply my own `8abf779` merged in, and its `runtime.js` is byte-identical to mine with no
`data-dc-raw` and no `keyGet`. All seven were genuinely live.

| | Finding | Fix |
|---|---|---|
| **F1** | CRITICAL — rows keyed by position, so reordering a list left externally mounted subtrees under the wrong row and dropped the last | `<sc-for key="{{ expr }}">` support; the emitted row key becomes `+ (keyGet(sub) ?? i)`, evaluated in the row scope |
| **F2** | CRITICAL — a throw in `renderVals` fell through to `vals = host.props` and rendered anyway, blanking every screen | On catch, return **without rendering**; the last committed DOM stands and the error is reported |
| **F3** | HIGH — any child-list change deleted foreign nodes | `syncChildren` skips a parent marked `data-dc-raw` entirely |
| **F4** | MEDIUM — a `<select>`'s value was skipped when the prop had not changed, so an assignment made before its options existed was never retried | `value` on `SELECT` is always re-applied |
| **F5** | MEDIUM — no update-depth guard | Chained-flush counter; above 50 it logs and bails |
| **F6** | LOW — `checked` skipped when unchanged, so DOM drift from a user click was never corrected | `checked` is always re-applied |
| **F7** | LOW — `?` poisoned `isPureData` | A literal containing `?` is refused, like the `${` case |

**On F5 I deviated deliberately.** The instruction said to count flushes per macrotask. Both parity
harnesses freeze `setTimeout`, so a timer-based window would never reset and would misfire on a long
legitimate run. I count **chained** flushes instead — a flush scheduled from inside a flush, which is
exactly the runaway shape (`setState` from `renderVals` or `componentDidUpdate`) — and the counter resets
whenever a flush is scheduled from outside one. Same defect caught, no dependence on a timer the gates
disable.

### Regressions, each proven to fail without its fix

`tools/v2-shim-regress.mjs`. These **cannot** be A/B steps in `v2-interactions.mjs`, which is why they
are a separate script: side A is pass 1 running the real dc-runtime, which has no `sc-for key=`, no
`data-dc-raw` and no `FD.setData`. The production template exercises none of them either — zero keyed
loops, zero raw parents — which is precisely why every gate stayed green while these bugs were live. So
each finding is driven against a synthetic fixture compiled by the real `tools/dc-compile.mjs` and
mounted on the real `public/v2/runtime.js`, served from a throwaway loopback server. Nothing is written
into `public/`.

| Check | With the fix | Fix reverted |
|---|---|---|
| F1 — reorder `[a,b,c]` -> `[c,a,b]` with a foreign `<em>` mounted inside row b | PASS: order `c,a,b`, 3 rows, foreign node still inside row **b** | **FAIL** |
| F2 — `renderVals` throws | PASS: `#list` innerHTML unchanged (303 -> 303 chars), rows still present, error reported | **FAIL** |
| F2b — recovery once it stops throwing | PASS: renders again | — |
| F3 — foreign child inside a `data-dc-raw` parent across a child-list change | PASS: survived | **FAIL** |

The F3 check needed a second pass to be worth anything. My first version toggled only the parent's text,
which hits `syncChildren`'s unchanged-list early return, so the removal path never ran and **the test
passed with the guard removed**. It now toggles an `sc-if` inside the raw parent so the child list
genuinely changes. That is what the negative controls are for.

To make F1 testable at all I added `--template <path>` and `--print-app` to `dc-compile.mjs`:
`--print-app` writes nothing, it prints `app.js` and exits, so a test can assert on generated code
without touching `public/`. The F1 check asserts the emitted key expression *and* the resulting runtime
behaviour.

### Gates after F1-F7

F1 and F3 are additive: the production template has zero `sc-for key=` and zero `data-dc-raw`, so neither
can alter current output — confirmed, all generated files unchanged and T3 still 7 of 13.

| Gate | Result |
|---|---|
| F2 DOM parity | **36/36**, mask empty |
| Interaction parity | **36/36**, mask empty, keystroke probe passing |
| Pixel | **`allPass: true`**, max **0.032948 %** |
| No engine | **`allPass: true`** — 0 loads, 0 console errors, 0 failed requests |
| `v2:compile` / `v2:check` | idempotent / **exit 0** |
| Shim regressions | **4/4**, each proven to fail without its fix |

`runtime.js` is now **416** lines. The seat has accepted the shim over the 300 guideline; F2, F3 and F5
add code and the comments that explain why each behaves as it does.

Signed **Julius**.
