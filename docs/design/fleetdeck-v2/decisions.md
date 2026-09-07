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
