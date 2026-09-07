# Fleetdeck v2 — decisions log

## 2026-09-07 · unblock sheet (8/8) — see `plan.md` §Operator decisions

## 2026-09-07 · precedent for "verbatim port, then pre-compile" (operator asked; found)

Two prior ports used the same method:

| Repo | Pack | What happened |
|---|---|---|
| `~/projects/onboarding-app` | `docs/goals/pitch-v4-clean-port/` (VIB-246..267, commits `91e7104`…`47bd1a7`) | `.dc.html` → verbatim dc-runtime port → JSX conversion. **Never dropped `@babel/standalone`**; `pitch-v4.html` still compiles JSX at load. |
| `~/projects/lowcap-connector` | `docs/goals/editorial-clean-port/` (Richmond, branch `agent-richmond/editorial-clean-port`, commits `27309326`, `082625e1`) | **Pass 1**: mocks land byte-verbatim on parked `/editorial/*` routes with their own dc-runtime. **Pass 2**: mechanical script compilation to plain HTML/JS, wired to the existing endpoints, then promoted. |

Rules and tools worth reusing:

- **D15 (lowcap DECISIONS.md):** mechanical verbatim only. The ONLY allowed edits are T1 (fonts) and T2 (asset uuid → src) substitutions, each quoted OUT/IN in the commit body. *"NEVER edit shipped markup toward the mock — that method failed and is banned."* Adopted here for S1.
- Parity suite: `~/projects/lowcap-connector/tools/f2-parity.mjs` (construct-counted parity mock ↔ compiled, normalized DOM byte-identical), `tools/hook-inventory.js` (every generated DOM hook resolves), `tools/promote-*.js` (count-asserted promote deltas), `tools/style-parity.mjs`.
- Converter: `~/projects/onboarding-app/server/scripts/convert-pitch-v4-jsx.js` (dc template → JSX, mirrors dc-runtime compile semantics: `{{ }}`, `sc-if`/`sc-for`, event map, pseudo-class CSS) and `extract-dc-bundle*.js`.
- Pitfall (lowcap REPORT.md): pass-2 normalization-order corruption, reproduced twice → fixed by script-strip-first + tail-anchored assert.

**Sequencing question raised by the precedent.** Richmond compiled to plain JS *before* wiring logic. The
sheet ruling was "vendor first, pre-compile at the end (L11)". Proposal: insert **S2 = pass-2 compile**
right after S1, so L1–L10 are written against plain JS (our stack, like today's `app.js`) instead of
against the dc-runtime template. **Operator ruling (same day, after a from-zero explainer): compile EARLY.** S2 follows S1; L1–L10 are written in plain JS; L11 no longer compiles.

## 2026-09-07 · Accounts trend: history already exists (reader audit)

- `credits_history (org, t, fh, sd, xu)` in `fleet.db` (`server.js:1158`), 60-day retention (`server.js:1209`), written by `creditsHistoryWrite` (`server.js:1229-1251`) from each machine's collector push, read by `creditsRows` (`server.js:1543-1548`) and attached as `history[]` (thinned to 120 points) on every Claude row of `GET /api/credits`. Codex rows have no series by design (`server.js:1543-1544`).
- Cadence gap: history only advances on page-load collects (60 s TTL); no cron/launchd poller exists.
- **Ruling applied:** sheet decision 7 ("server rider") is moot. **L8 plots `row.history`**; no `L8s`. A periodic collect is a cadence improvement, not a design item.
- **Operator, same day:** "we have the usage trackers here but they are absolutely unusable, always wrong, they definitely need fixing, lots of fixing." → **Out of design scope.** Logged as a separate goal for the remote-system orchestrator: `fd-usage-trackers` (backend correctness of `/api/credits` collectors: stale samples, "could not read usage on rfc1918-internal", 15-day-old snapshots shown as live, per-machine merge). L8 renders whatever the API returns and must not mask wrong data.

## 2026-09-07 · packaging S0 + S1 (introduce-goal, signed off)

- Project `remote-system` / sub-project `fleetdeck-v2`.
- S0 → **Gisbert** (`qa-engineer`), GPT Astra xhigh, `/goal`. S1 → **Waldemar** (`frontend-developer`), GPT Astra xhigh, `/goal`. Both on the german-box, in parallel.
- S1 stays inside `public/v2/` (vendored runtime under `public/v2/vendor/`, media under `public/v2/media/`) so no `server.js` change is needed for pass 1 and the gate can run against a plain static server.

## 2026-09-07 · S2 method (design-seat decision after the tools audit)

Precedent pass 2 dumped rendered DOM to static HTML and hand-wrote behaviour (fits marketing pages). Fleetdeck
is an app whose tabs/menus/toggles/composer/lists are the design, so **S2 compiles the template into plain-JS
render functions and keeps the mock's logic class running on a ≤300-line shim**; React/Babel/dc-runtime are
dropped; the template stays in the repo as the source (`public/v2/template.dc.html`, `npm run v2:compile`,
`v2:check`). Gates: F2 normalized-DOM parity 36/36, interaction parity after a scripted click-through, pixel gate,
no-engine network proof. Fallback = the precedent's DOM-dump method, only via `operator:decision`. Precedent
tools copied to `docs/design/fleetdeck-v2/precedent/`. Pack: `docs/goals/fd-v2-s2/`.

Launch stall 2026-09-07: both GPT workers stopped on `oauth_token_invalid_grant` from the box's Linear MCP
(the prompt said "a blocker that is not a Linear issue does not exist"). Fixed by a bus nudge (never-block rule,
`LINEAR-PENDING.md`) and by amending the packs + the introduce-goal skill references. Operator action pending:
re-auth Linear on the box over RDP (german-box-workers skill §9).

## 2026-09-07 · launch log (wave A + early S2/L1, operator: "I want it ASAP")

| Session | Worker | Slice | Breed | Base | Launched (Mac local) |
|---|---|---|---|---|---|
| `FD-v2-s0` | Gisbert | S0 gate harness | GPT Astra xhigh | docs branch @ `76c859c` | ~01:00 |
| `FD-v2-s1` | Waldemar | S1 verbatim port | GPT Astra xhigh | docs branch @ `76c859c` | ~01:00 |
| `FD-v2-s2` | Julius | S2 compile to plain JS | Claude high | `origin/agent-v2-s1` @ `39ae4ad` (before S1's gate report; rebases if S1 changes) | ~02:25 |
| `FD-v2-l1` | Juergen | L1 data layer + fixture + v2 routing | Claude high | docs branch @ `226f02c` | ~02:40 |

S1 independent review (design seat, 2026-09-07 ~02:30): T1/T2-only YES; MANIFEST hashes verified; MIME lines exact.
Two findings sent back: align `package.json`/lock with S0's; prove the vendored Inter woff2 is variable.

## 2026-09-07 · S0 accepted; S0.1 follow-up

Independent review of `origin/agent-v2-s0` @ `cf88d29`: harness trustworthy YES (exit codes, screen map by text/key
actions, numbers traceable to committed artifacts, scope clean). Findings routed to Gisbert as goal **S0.1** on the
same branch: `networkidle` hangs against a live app with WebSockets → bounded in-flight-request settle; blur after
clicks + hide focus-visible outlines and scrollbars on both sides; mock side served with `page.route` mapping CDN
URLs to S1's vendored files when present; rename `verify/S0-baseline-failed` → `verify/baseline-failed`.
Kept as designed: pixelmatch threshold 0.1 with `includeAA:false` (per pack; same Chromium on the same box on both sides).
Rule for later slices: every gate report records the script sha it ran with; S1's report is valid against the S0
script version it names.

## 2026-09-07 · S1 accepted

`origin/agent-v2-s1` @ `70c32bb`: independent review T1/T2-only YES; both findings fixed (package.json/lock identical to
S0's; Inter = one variable woff2 covering 400-700, documented in MANIFEST); gate `verify/S1/report.json` allPass 36/36,
max 0.033 % (registry dark); `network.json` zero external hosts; design-seat spot check of registry-dark and
message-bus-light screenshots against the baselines: identical to the eye. Ledger: D01/D02/D07 ✅, P1 half of D03–D19 ✅.
Waldemar released. Julius (S2) told to merge `70c32bb` before his final gate run.

## 2026-09-07 (evening) · OPERATOR RULING — done by 2026-09-08 evening

Recorded verbatim in `plan.md` §"OPERATOR RULING 2026-09-07 (evening)". Consequences applied the same night:
T3 sent to Julius and amended in `docs/goals/fd-v2-s2/README.md`; fixture-naming contract sent to Juergen;
six behaviour inventories (L5–L10) commissioned; ten worker names claimed; packs L2–L11 written; polling of
S2/L1 every 20 min with launch-on-land of all nine L-slices from `origin/agent-v2-s2`. Reviews run in parallel
and never gate a launch. Weave into a local `weave/fd-v2` branch by the design seat; operator runs the ff-merge + `./up.sh`.

## 2026-09-07 (night) · Codex lane exhausted → every remaining slice on Claude high

`FD-v2-s0` (Gisbert, GPT Astra) stopped mid-S0.1 with `You've hit your usage limit … try again at Sep 12th`. The
$0 lane is gone until 2026-09-12, so the breed ruling (Astra for L7, L8, L9, L11) is overridden by the design seat:
**L2–L11 all run as Claude high** (`fd-launch-claude.sh`). S0.1 (gate hardening) folds into L11's scope; S0 stays
accepted at `cf88d29`; Gisbert's name released. Risk: eleven Claude sessions on the box account — a `usage_limited`
report from any worker is escalated to the operator immediately (no Astra fallback exists).

## 2026-09-08 (early) · S2 accepted, base branch, nine launches

- **S2** `origin/agent-v2-s2` @ `f370e4e` (Julius): compile + T3 landed; proofs `verify/S2/`: parity 36/36 identical,
  interaction parity 34/34, pixel gate 36/36 max 0.033 %, no React/Babel/dc-runtime loads; `FD.setData` seam proven
  by `tools/v2-setdata-check.mjs`; nine empty `public/v2/screens/*.js` wired. Accepted without a design-seat reviewer
  pass (Mac subagent session limit until 03:20; Julius ran his own reviewer + hunter loop, 8 findings closed).
- **L1** `origin/agent-v2-l1` @ `93bc722` (Juergen): data.js, router.js, extractor, tests, REPORT — accepted;
  reviewer pass deferred (same limit). Follow-up L1.1 sent: extractor writes `fixture-extract.js`, check compares
  the seven S2 seeds.
- **Merge conflict** S2 + L1 on `public/v2/fixture.js` (add/add) and `package.json` (scripts): resolved once by the
  design seat → `origin/agent-v2-base` @ `66e81e0` (S2's fixture.js, scripts unioned). The nine L-slices branch
  from `agent-v2-base` (packs updated from `agent-v2-s2`); their first-action merge of L1 is a no-op.
- Rule for L2–L10: in fixture mode (`?fixture=1`) never call `FD.setData`; only live mode loads data.

## 2026-09-08 (early) · all nine logic slices launched

Base `origin/agent-v2-base` @ `66e81e0`. Sessions `FD-v2-l2` … `FD-v2-l10` (Renate, Gottlieb, Ruprecht, Dietlind,
Gerhild, Tankred, Kunhild, Eckbert, Clodwig), all Claude high, `/goal active`, bypass on, registered in group `fd-v2`.
Prompts staged on the box (`~/launch/launch-<name>.txt`), launcher `~/fd-launch-claude.sh`. Monitor polls their
branches every 20 min for `verify/L<N>/report.json` + `live.json` and their panes for limit/stall/done. L11 (Alrun)
launches from `origin/weave/fd-v2` once the last of them is green.

## 2026-09-08 (early) · operator: "launch all now" → L11 started in two phases

`FD-v2-l11` (Alrun, Claude high) launched off `origin/agent-v2-base`: phase 1 = routes, deletions, README,
launch.json, gate hardening S0.1, tests, green on `/app` in fixture mode; phase 2 = merge `origin/weave/fd-v2`
when the design seat announces it, final full gate + live smoke. Preview worktree moved to `agent-v2-base`
(http://localhost:4174/v2/index.html); it follows `weave/fd-v2` from the first accepted slice on.

## 2026-09-08 · S2 independent review (parallel, after acceptance) → S2.1

Reviewer verdict "not ready for fan-out" — on evidence hygiene, not on the shim: the final commit deleted two cited
proof files (`logic-roundtrip.txt`, `t3-substitutions.txt`), so `npm run v2:check` would exit 1 at HEAD; the compiler's
proof output labels a pre-T3 hash as `logic.js sha256`; `.claude/launch.json` + `.gitignore` edited out of scope;
composer keystroke focus/caret across re-renders unmeasured. The parity (36/36), interaction (34/34), pixel (36/36)
and no-engine artifacts are genuine. **Design-seat rulings:** runtime.js at 361 lines is accepted (300 was a
guideline); the missing hunter pass is replaced by an oracle audit run by the seat. Follow-up **S2.1** sent to Julius
(regenerate proofs, green `v2:check`, hash label, keystroke interaction step, arrayKids fix, scope cleanup). The nine
slices keep building on `agent-v2-base`; S2.1 will be merged into the base and broadcast when it lands.

## 2026-09-08 · L1 independent review → L1.2

`origin/agent-v2-l1`: tests 296/296, fetchers and router clean, server change scoped. Two data-correctness bugs
(desktop `completedTurns` null → "0 turns"; accounts `trendPts` = raw history objects instead of numbers) plus
`branch`/`model` null passthrough. Rulings: `trendPts = history[].sd` (numbers, time order); null turns → "Turns
unknown", null branch → "No branch", null model → "Model unknown" (today's texts). Follow-up L1.2 sent to Juergen;
Kunhild (L8) and Clodwig (L10) warned to build against the fixed shapes.

## 2026-09-08 · base moved to `42b56bb` (S2 fix folded in)

Julius pushed `3e64200` + `8abf779` (arrayKids reconciliation fix in `runtime.js`, restored `logic-roundtrip.txt` and
`t3-substitutions.txt`, 34/34 interactions, gates green). Merged into `agent-v2-base` @ `42b56bb` (no conflicts),
pushed, and all ten L-workers told to merge it. Still open in S2.1: keystroke interaction step, `logic.js sha256`
label, `.claude/launch.json` / `.gitignore` scope cleanup. Preview follows the base.

## 2026-09-08 · oracle audit of the shim → S2.2 (CRITICAL) + binding instructions to the nine

Audit filed at `docs/design/fleetdeck-v2/audits/s2-shim-oracle-2026-09-08.md`. Two criticals (positional `sc-for`
identity moves/drops foreign subtrees; a throw in `renderVals` blanks every screen), one high (child-list change
deletes foreign nodes), two mediums (`<select>` sync, no update-depth guard), two lows. S2.2 sent to Julius ahead of
S2.1's remainder; the three binding instructions broadcast to L2–L11 (mount xterm outside `#dc-root`; validate +
throw-proof render sections; bind raw input state). Nine slices continue on `agent-v2-base` @ `42b56bb`; S2.2 will
be folded into the base and broadcast when it lands.

## 2026-09-08 · S2.1 + S2.2 landed; base moved again

`agent-v2-s2` @ `30b1e9c`: S2.1 (green `v2:check`, proof labels, composer keystroke parity step) and S2.2 (all seven
oracle findings: keyed `sc-for`, throw keeps last DOM, `data-dc-raw`, SELECT re-sync, update-depth guard, checked
assignment, `isPureData` ternary) — parity 36/36, interactions 36/36 (two new regression steps: keyed reorder with a
foreign node, throwing `renderVals`), pixel 36/36 max 0.033 %, no engine. `agent-v2-l1` @ `3e1c06a` (L1.1 fixture
split) merged with it into `agent-v2-base`; pushed; ten workers told to merge; preview follows. Still open: L1.2
(adapter fixes) from Juergen.

## 2026-09-08 · L1.2 landed; base final before the weave

`agent-v2-l1` @ `79a8cd8` (desktop-row fallbacks, `trendPts` numbers) merged → `agent-v2-base` moved; pushed; ten
workers told to merge (L8/L10 to drop their interim shims). L1 accepted in full; Juergen's name released after his
registry row shows done. No further base moves planned; the next integration point is `weave/fd-v2`.

## 2026-09-08 · first slices accepted: L9 (Machines), L10 (Desktop sessions)

- **L9** `origin/agent-v2-l9` @ `9054f5b` (Eckbert): fixture gate 36/36 max 0.033 %, live proof 46/46 with the API
  stubbed, BEHAVIOUR checklist complete, improvisations I-L9-* logged with screenshots, re-gated after merging the base.
- **L10** `origin/agent-v2-l10` @ `3bdcaf5` (Clodwig): fixture gate 36/36 max 0.033 %, live proof 33/33, harness under
  `verify/l10-harness/`, nine improvisations with screenshots, hardened per the oracle audit, L1.2 strings adopted.
- Ledger D16, D17 P2 ✅. Both merged into `weave/fd-v2` (from `agent-v2-base` @ `6cb8e2d`), pushed as a branch (never
  main). Parallel reviews launched; findings go back as follow-ups. Preview now follows `weave/fd-v2`.

## 2026-09-08 · L9 review: ACCEPT (no defects)

Reviewer: contract scope clean, BEHAVIOUR texts byte-identical to `public/machines.js`/`server.js`, fixture mode
untouched, oracle rules followed, live checks substantive, tests 353/353. Notes for the weave: L9 adds calls in the
shared `componentDidMount`/`componentDidUpdate` hooks (other slices will too → keep-both resolution); `weave/fd-v2`
confirmed to carry L1.2's `data.js` (merge from base `6cb8e2d`).

## 2026-09-08 · L10 review: NO on `3bdcaf5`, resolved on the tip

Reviewer found a stale `agent-v2-l1` merge on the reviewed commit reverting L1.2 (data.js, five regression tests,
L1's REPORT) and a real behaviour gap (Message/Show disabled texts must read "Live check unavailable" vs "Not
running" by `liveState`). The weave was never affected (3-way merge kept the base's newer `data.js`, verified
`Turns unknown`/`trendSeries` present). Clodwig's later `224f019` took L1.2; tip `05c3c5c` has `79a8cd8` as ancestor
and the three files identical to the base. Weave updated to `27da9eb`. Follow-up **L10.1** sent (two verbatim
strings + live assertion; restore the five L1 tests if missing; keyed-reorder proof for the injected chips).
Acceptance of D17 stands; L10.1 is a rider.

## 2026-09-08 · weave integration check: tests green, the pixel gate runs on the box only

`weave/fd-v2` @ `27da9eb` (base + L9 + L10) on the Mac: `npm test` 353/353. The pixel gate on the Mac fails every
screen uniformly (0.67–3.65 %, landing and deck slides included, which no slice touched) because the committed
baselines are box-rendered (Linux Chromium fonts/AA); `--baseline` on the Mac refuses to replace them (repeat limit
0.05 %, "Baseline preserved"). Ruling: the gate is a box instrument. The design seat runs the weave gate on the
german-box with a runner script (`fd-weave-gate.sh`, tmux `FD-weave-gate`); L11 phase 2 repeats it as the final
gate. Mac runs are informative only and are not filed.

## 2026-09-08 · six more slices accepted (L2, L3, L4, L5, L7, L8)

All with fixture gate 36/36 max 0.033 %, both base fixes as ancestors, scope clean, reports signed, improvisations
logged with screenshots: L2 `e904077` (Renate, live 59/59), L3 `b6d94b5` (Gottlieb, live 37/37, adds
`scripts/l3-live.mjs`), L4 `ecd6985` (Ruprecht, live 36/36), L5 `0edc033` (Dietlind, live 50/50), L7 `ca8b4a8`
(Tankred, live 66/66), L8 `97bdbb2` (Kunhild, live 60/60). Ledger D03–D05, D09–D12, D14, D15 P2 ✅. Merged into
`weave/fd-v2` (keep-both on shared lifecycle hooks and appended docs), pushed; parallel reviews staggered (L2, L3, L4
first). Outstanding: L6 (Gerhild, bus + toast) and L11 phase 1; riders L10.1, any L4/L7 late pushes.

## 2026-09-08 · weave/fd-v2 @ `444fc6d` = base + L2, L3, L4, L5, L7, L8, L9, L10

Merged with a base-aware keep-both resolver (`resolve3.py`: the side that changed the base lines wins, the other
side's additions are appended). One hunk needed a hand splice: L2's rewritten `boxRows` mapping vs L3's `tiles`
block at the same spot (`logic.js` ~L1181-1186) — kept L2's line, dropped the stale copy, kept L3's block. `node
--check` clean on every v2 file; `npm test` 460/460. Pushed as a branch; preview follows; box gate re-launched
(`FD-weave-gate`). Outstanding: L6 (bus + toast), L11 phase 1, riders L10.1 and any late L4/L7 pushes.

## 2026-09-08 · DECK-84 (shell never loads data.js/router.js) → L11; DECK-86 closed

L7's report found the one cross-slice gap: S2's shell loads runtime/fixture/logic/app + the nine screens but not
L1's `data.js`/`router.js`, so `FD.data` is undefined unless a slice self-loads it (L7 added a guarded stopgap).
Ruling: L11 (Alrun) adds the two tags to the shell, removes the stopgaps, and makes `router.js` drive `/`, `/app`
(+ hash screens on load and hashchange) and `/deck`. DECK-86 (principal chips from `hosts.json`, ruling O9): no
user field exists → keep `root`/`vibe` constants as an accepted improvisation. DECK-85 ("npm test red at base"):
Mac weave run is 460/460; L11 confirms on the box. Alrun is already merging `origin/weave/fd-v2` on his own.

## 2026-09-08 · DECK-79 (shell ignores `?view=`) → L11, authorized to touch the root-view seed

L11's phase-1 report: routes correct on the wire (14/14) but `logic.js` ~L1053 seeds the root view from
`props.startView`, ignoring the URL (live smoke 20/22). Ruling: Alrun changes that seed (and the screen seed from the
hash) to read `FD.router` with the prop as fallback, quoted OUT→IN; fixture-mode default unchanged. Closes DECK-79
with DECK-84. Names released: Julius (S2 complete after S2.2), Tankred (L7 accepted).

## 2026-09-08 · box gate green on weave `444fc6d`; L2 review accept

`fd-weave-gate.sh` on the german-box (`~/weave-gate/weave-fd-v2/result.txt`): HEAD 444fc6d, `npm test` 460 pass,
pixel gate fixture mode allPass 36/36 max 0.0329 %, no fails. The eight-slice weave is proven on the gate machine.
L2 review: ACCEPT; follow-up L2.1 to Renate (setBadge must retain a count set before the data layer is ready).

## 2026-09-08 · L5 review: accept + L5.1

Scope clean, `orgchart.js` untouched, formats verbatim, gate 36/36 + live 50/50 real, 109/109 unit tests. Follow-up
L5.1 to Dietlind: gate the 1 s ticker on `orgOpen()` and wire `stop()/start()` (HIGH: perpetual app re-render +
Live API pill overwrite after one visit); scope select options that yield an empty kids grid (MEDIUM). I-L5-05
(`expires: none` replaces the old `expired 20703d ago` quirk) accepted.

## 2026-09-08 · L3 review: accept + L3.1; reviewer incident

L3 engine parity verified line by line against `app.js:1007-1250` / `server.js:2878-2947`; gate 36/36 (Windows and
full screen at 0 %), live 37/37, tests 310/310. Follow-up L3.1 to Gottlieb: real ✕ click in the live proof; the
"server half covered" claim in `live.json` is false → add a real `/term` integration test or drop it; fix the
`data-l3-key` wording; remove the document-level "Connect all" text binding (L2's shell owns the button; hook stays).
Incident: the reviewer subagent ran `rm -rf <path>/../<same dir>` which resolved to this design seat's own worktree
and deleted it; it recreated the worktree from git at the branch tip. Verified afterwards: worktree at `56f43ef`
(= origin), all docs present, nothing lost (everything was committed). Memory note written so reviewer prompts forbid
`..`-relative removals and confine scratch worktrees to `/private/tmp/claude-501/`.

## 2026-09-08 · L4 review: accept + L4.1

Filters/sort/count/persistence byte-for-byte vs `app.js:609-716`, confirm/toast strings verbatim, POST bodies proven
in `live.json` 36/36, fixture mode inert, hooks guarded, 8 improvisations with screenshots. Follow-up L4.1 to
Ruprecht: scope the busy guard per row (bulk op must not block unrelated row actions — behaviour deviation), add the
missing `test/v2-registry.test.js`, move `tools/v2-live-check.mjs` under `verify/l4/`, stop propagation on Enter in
the cell editor.

## 2026-09-08 · L6 accepted — all nine logic slices in

`origin/agent-v2-l6` @ `b4fd310` (Gerhild): fixture gate 36/36 max 0.033 %, live 47/47, both base fixes merged, scope
clean, I-L6-01..12 with screenshots, threads/receipts/poll/toast per BEHAVIOUR. Ledger D13, D08 P2 ✅ — every ledger
row is now ✅ for P1 and P2 except the cut-over rows D18–D20 (L11). Weave updated with L6 + riders (L10.1 `de8c3e4`,
L4 `0ce3a52`, L7 `e3edadc`), box gate re-launched, phase 2 GO sent to Alrun. Gerhild's name released.

## 2026-09-08 · L8 review: accept + ruling on style writes

Verbatim port confirmed line by line; gate 36/36 (accounts 0 %), live 60/60, 15/15 unit tests; improvised chrome
mounted outside `#dc-root`; render section throw-proof. **Ruling:** inline style writes onto compiled nodes are
allowed when re-applied idempotently on every render and listed in `improvised.md`; data-* hook + stylesheet rule
preferred. L8.1 to Kunhild: stop keying on the compiled `data-dc-tpl="573"` id (silent zero-match on template regen).
DECK-87 = DECK-84 (L11).

## 2026-09-08 · box gate green on the full weave `dba2c6a`

`fd-weave-gate.sh`: HEAD dba2c6a, pixel gate fixture mode allPass 36/36 max 0.0329 %, no fails. `npm test` on the box
487 pass / 2 fail (Mac: 489/489) — the failures are in the pre-existing non-v2 suites that the workers documented as
port-collision flakes under concurrent runs (ten worker worktrees run the suite on the same box); named below once
read. Nine slices proven together on the gate machine; L11 phase 2 is the last step before the weave is final.

## 2026-09-08 · L7 review: accept + L7.1; timer-gating sweep

Parity traced line by line incl. 403/503 unwrapping; POST bodies asserted in the harness; tests 320/320. Follow-up
L7.1 to Tankred: gate the 30 s poll + 1 s tick on the keys screen being active (today they run from module load,
polling the deck forever) and re-apply `data-dc-raw` on every capture (the sc-if teardown drops it after the first
visit). Same class as L5.1's ticker → L9 and L10 asked to confirm their polls are screen-gated. Box test flakes on
`dba2c6a` were `test/lease.test.js` and `test/notify.test.js` (pre-existing, port/timing under concurrency).

## 2026-09-08 · L6 review: HOLD on the toast → L6.1 priority

Contract, parity, gates (36/36, 47/47), tests 332/332 all check out; one HIGH defect: `activeId()` suppresses the
reply toast for the selected thread even when the bus screen is not on-screen, so the primary D08 case never fires.
Per the ruling L6 stays in the weave; L6.1 (priority) sent to Gerhild with three smaller items (unbounded `stOv`
growth, unknown-target path without refresh, unguarded rail builders). Ledger D08 P2 back to 🔨 until L6.1 lands;
D13 stays ✅.

## 2026-09-08 · poll-gating sweep results

L9 (Eckbert): fixed on the branch — 4 new unit tests (no poll or request while off-screen, start/stop on enter/leave,
no stacked interval, inert in fixture mode), 59/59. L10 (Clodwig): probe confirmed the 30 s poll stops off-screen;
a permanent live + unit guard is being added on request. L5.1 and L7.1 carry the same fix for org and keys.

## 2026-09-08 · L11 phase 2 accepted; weave candidate `52069d1`; two merge-caused fixes → L11.1

L11 `8f95eb2` (Alrun): fixture gate 36/36 on `/app`, live smoke 30/30, 10 real-API screenshots, shell loads
`data.js`/`router.js`, URL drives the views (DECK-84/79 closed), old UI + pass-1 + Babel deleted, `board.html` kept,
tests 501/501 on the box. Weave candidate `52069d1` = nine slices + riders + L11. Two merge artefacts: four
`v2-shell` tests red on the weave (L2.1's setBadge retention vs L11's new data-layer load order) and a leftover
data.js loader in `keys.js` (L7.1 vs L11 both-sides hunk). Sent to Alrun as L11.1. Operator asked when main is
deployed: answer — I never push main; the one-liner follows the next green candidate, est. 2–3 h (L6.1 + L11.1).

## 2026-09-08 · box gate green on candidate `52069d1`; Mac-side cut-over chores done

Box: pixel gate allPass 36/36 max 0.0329 %; tests 540 pass / 4 fail (the `v2-shell` setBadge quartet, merge-caused,
L11.1). Design seat updated the Mac-side references listed in `docs/goals/fd-v2-l11/MAC-REFS.md` (three skills now
point at `localhost:3131/app#keys` / `/app`) and the `fleetdeck-app` memory (routes, v2 layout, gate-on-box rule).

## 2026-09-08 · DEPLOYED — main fast-forwarded to `weave/fd-v2` @ `79cd53a`, `./up.sh` run by the operator

Final box gate on `79cd53a`: tests 551/551, pixel gate 36/36 max 0.0329 %. Routes verified live: `/` → 302
`?view=land`, `/app` 200, `/deck` 302, legacy `.html` → `/app#…`. Mac-side skill references updated.

**Live defects found by the operator in the first minutes, both post-deploy riders:**
- **L6.2 (priority, Gerhild):** every deep link into the bus is dead — `FD.screens.bus.open()` returns `false` for
  all targets because `host` is never set: `bus.attach(h)` runs only in `AppLogic.componentDidMount`, which fires while
  `app.js` executes, before `screens/bus.js` has loaded (verified on the live page: no `FD.host`, `open()` false even
  with the bus screen open, threads still paint via the bus's own `start2()`). Fix: attach idempotently from
  `componentDidUpdate` and/or on module load with a runtime-exposed host; keep `pendingOpen`. The workers' live proofs
  passed because their harness loaded the screen scripts before the first mount.
- **L11.2 (Alrun):** nav clicks switch the screen but never write the hash; reload/back/bookmark land wrong.
Ledger D08 P2 ✅ (L6.1 `2f72f00`) recorded here since the earlier docs commit was declined. Next: merge both riders
into `weave/fd-v2`, box gate, second one-liner `cd ~/remote-system && git merge --ff-only weave/fd-v2 && ./up.sh`.

## 2026-09-07 late — live defect 3: landing scroll-scrub video (L11.3)

Operator: "the scroll effect on the landing page doesn't work at all."

**Diagnosis (headless Playwright, `scratchpad/probe-scroll.cjs`, viewport 1440×900, `/?view=land`):** the
LandLogic draw loop runs (58 rAF/s, 174 drawImage/s), reveals toggle, the page scrolls (2520 px), but the
canvas hash is identical at scroll 0 / 50 % / 100 % — the scrub always draws frame 0.

**Root cause (proven):** `server.js` `sendFile` (weave/fd-v2 line 2395) reads the whole file and answers
`200` with no `Accept-Ranges`, `Content-Length` or `Content-Range`, ignoring the `Range` header. Chrome
therefore treats `/v2/media/hero-*.mp4` as non-seekable (`video.seekable` = [0, 0]); every `currentTime`
seek snaps to 0 (`probe-seek.cjs`: seeks to 3 s and 6 s both report `currentTime 0`, three identical frame
hashes), so `extractFrames` caches 90 identical frames. The mock worked because CloudFront serves byte
ranges. Not a port/compile defect — logic.js is byte-identical and behaves exactly as designed.

**Fix:** L11.3 to Alrun (server.js only): Range support in `sendFile` (206 + `Content-Range` +
`Content-Length` + `Accept-Ranges: bytes`, 416 on unsatisfiable, `Content-Length` on 200), node test for
200/206/416, headless proof with three distinct hashes. Sent over the bus 2026-09-07 (id c59bfd35).

Gate note: the pixel gate runs with `fd-app-video=false` and reduced motion, so it can never see scroll
scrub defects. A scroll probe (canvas hash at three positions) belongs in the verify set for landing slices.

**Reassignment (same night):** the L11.3 bus message (id c59bfd35) was marked delivered but never appeared in
Alrun's pane (full scrollback grep empty; session 22 min into one test turn). Operator re-ran the one-liner
and saw no change — nothing new had been pushed. Minted **Hadwig** (`backend-developer`) on `agent-v2-l12`
from `origin/weave/fd-v2` for the Range fix (pack `docs/goals/fd-v2-l12/`); Alrun told to ship L11.2 only.
Lesson: a bus "delivered" is not a read — verify the text in the pane, and never queue a priority rider
behind a long turn; mint a parallel worker when the slice is independent.

## 2026-09-07 03:43 — candidate `e646554` = deployed `79cd53a` + L6.2 + L11.2

- **L6.2 accepted** (Gerhild, `eb3c015`): `AppLogic._busAttach()` publishes the host on `FD.screens.busHost` and
  retries `bus.attach` on every render; `bus.open()` takes every target. `test/v2-bus.test.js` +142 lines,
  live proof `verify/l6/live.json`. Closes the dead "Message session" deep links.
- **L11.2 accepted** (Alrun, `2b7254b`): a screen switch writes `location.hash`, so reload and Back follow.
  `scripts/verify-l11-live.mjs` + `verify/l11/live.json`.
- Merge clean (both touch `logic.js`, disjoint hunks). `npm test` 560/560. Box gate on `e646554`:
  **allPass, 36/36, max 0.0329 %**. Pushed to `origin/weave/fd-v2`.
- Still open: **L12** (Hadwig, Range support → landing scroll scrub). Server-only, so it cannot move the pixel
  gate (the gate renders `public/` through a static python server); it gets `npm test` + the headless scroll
  probe, not a re-gate.
- Handover line unchanged: `cd ~/remote-system && git merge --ff-only weave/fd-v2 && ./up.sh`.

## 2026-09-07 03:53 — candidate `9147462` = `e646554` + L12 (all three live defects closed)

**L12 accepted** (Hadwig, `453e57c`): `sendFile` now answers `Accept-Ranges: bytes` + `Content-Length` on 200,
206 with `Content-Range` for single ranges (explicit, open-ended, suffix), 416 for unsatisfiable, full 200 for
multi-range or malformed. `test/static-range.test.js` (+210 lines). A second commit holds the response head
back until the file actually opens, so a mid-flight ENOENT still yields 404 rather than a half-sent 200.

**Independently verified by the design seat** (not taken from the worker's report): server started from the
merged weave on port 31999 —
```
Range: bytes=0-99 → 206, content-range: bytes 0-99/10321675, content-length: 100, accept-ranges: bytes
probe-scroll: s0 vt 0 hash 385233935 · s1 vt 4.99 hash 4218100027 · s2 vt 9.98 hash 3935661745 · s3 back to s0's hash
```
Screenshots at scroll top/mid/end (`scratchpad/shots/`) show three different video frames; sent to the operator.

**Merge note:** Hadwig committed her scratch probe (`probe-scroll.cjs`) to the repo root; removed in the merge
commit — a worker's measurement tool is not shipped code. Everything else merged clean.

`npm test` 578/578. Box gate on `9147462`: **allPass, 36/36, max 0.0329 %** (unchanged — the gate serves
`public/` through python's static server, so it can never observe a `server.js` fix; that is exactly why the
scroll probe now belongs in the verify set).

Handover line: `cd ~/remote-system && git merge --ff-only weave/fd-v2 && ./up.sh`.

## 2026-09-07 04:00 — `9147462` LIVE; all three post-deploy defects closed and verified on the running deck

The operator ff-merged and ran `./up.sh` while the gate was finishing (`main@{0}` = `9147462`). Verified
against `http://localhost:3131` itself, not against a worker report:

| Defect | Live evidence |
|---|---|
| Landing scroll scrub (L12) | `Range: bytes=0-99` → `206 … bytes 0-99/10321675`; probe `s0` vt 0 / `s1` vt 4.99 / `s2` vt 9.98, three distinct canvas hashes, `s3` back to `s0`'s hash |
| Bus deep links (L6.2) | `FD.screens.busHost` attached; clicking the real "Message this session" icon on the 🎨 DESIGN 35 row lands on `#bus` with that thread selected and the composer live (`shots/msg-icon-after.png`) |
| Hash on nav (L11.2) | Windows → `#windows`, Org chart → `#org`, Registry → `#registry`, Message bus → `#bus`; zero page errors |

`npm test` 578/578 · box gate `9147462` allPass 36/36 max 0.0329 %. No open riders on the redesign.
Registry `status:done` for FD-v2-l12 is fenced to the orchestrator seat (`seat_epoch required`); Hadwig posts
her own from the box, as her pack instructs.
