# fd-v2-l5 — REPORT

**Slice:** L5 · Org chart on live seats + sessions · ledger row **D11**
**Worker:** Dietlind · `frontend-developer` · tag `agent-dietlind` · session `cli-worker`
**Project / sub-project:** `remote-system` / `fleetdeck-v2`
**Branch:** `agent-v2-l5`, off `origin/agent-v2-base`. Merged three times, no `logic.js` conflict on
any of them: `origin/agent-v2-l1` (already contained in the base), the first S2 base move, and the
S2.2 + L1.1 base move, and the L1.2 base move (`toDesktop` / `toAccounts` fallbacks — `toOrg` is
untouched by it, and L5 added no shims to remove). Both gates were re-run after the final merge; the
numbers below are from that tree.
**Main issue:** DECK-54 · **Date:** 2026-09-07

---

## Result

| Gate | Required | Measured |
|---|---|---|
| Pixel gate, fixture mode | `report.json` allPass 36/36 | **36/36, allPass true**, max 0.0329 % (Registry dark, pre-existing); **Org chart 0.000000 % in BOTH themes** |
| Live proof, API stubbed | `live.json` all pass | **50/50, allPass true**, zero unexpected console errors |
| Unit tests | where applicable | `test/v2-org.test.js` **35/35** |
| `npm test` | green | v2 layer **109/109**; full suite varies with box contention, best **332/333**, every failure `EADDRINUSE` — see below |
| improvised.md | entry + screenshot per improvisation | **12 entries (I-L5-01..12), 4 screenshots** |
| Hooks | provided defined, used guarded | provided: **none**; used: 2, **both guarded** |

Commands, in the order they must run:

```bash
(cd public && python3 -m http.server 3199) &
npm run design:diff -- --app "http://127.0.0.1:3199/v2/index.html?fixture=1" --slice l5
node docs/design/fleetdeck-v2/verify/l5-live/live.mjs      # writes verify/l5/live.json + live-*.png
node docs/design/fleetdeck-v2/verify/l5-live/shots.mjs     # writes improvised/l5-*.png
node --test test/v2-org.test.js
```

Order matters: `design-diff` **replaces** `verify/l5/` wholesale, so it must run before the live
proof writes into that directory. That cost one rewrite here and is filed as DECK-92.

### The pixel gate is proven sensitive, not merely green

36/36 on a screen means little unless the gate can fail on that screen. Negative control: a copy of
`public/` with one character changed (`orgAttached: undefined`, reproducing a bug I actually hit)
was gated on its own port. Result, kept at `docs/design/fleetdeck-v2/verify/l5-negative-control/`:

```
allPass=false; maxMismatchPct=3.86
  Org chart dark   3.8645 %   FAIL
  Org chart light  0.9327 %   FAIL
  (the other 34 checks pass)
```

Exactly the two org rows, nothing else. So the 0.000000 % in the real run is evidence, not an
artefact. `docs/design/fleetdeck-v2/verify/l5/org-chart-dark.png` was also read by eye: stats row
`102 / 2 / 4 / 96`, the mock's three-card spine, the four kid cards.

### `npm test`

**The v2 layer is fully green: `test/v2-data.test.js` + `test/v2-org.test.js` = 109 pass / 0 fail**,
run together, including the tests L1.1 and L1.2 added. That is the part of the suite this slice can
affect.

The **full** suite is not a stable number on this box, and the reason is not code. Measured across
the session:

| Run | Result | Failures |
|---|---|---|
| before L5's changes | 229 / 230 | `v2-data` (`window` under Node — DECK-90, since fixed by L1.1) |
| after L5, pre-S2.2 | 264 / 265 | same one |
| post-S2.2 + L1.1 | **332 / 333** | 1 × `EADDRINUSE` |
| post-L1.2, busy box | 322 / 338 | 16 × `EADDRINUSE` |

Every failure in the last two rows is `listen EADDRINUSE` or `tailnet listener unavailable:
EADDRINUSE`, in `coordinator-api`, `reaper`, `seats-fencing` and `train-broker`. This box runs many
agent worktrees at once and those lifecycle tests bind **fixed** ports (`127.0.0.1:39xx`,
`127.0.0.2:18311`), so a concurrent session takes them. Run alone they pass: `coordinator-api`
41/41, `seats-fencing` 21/21, `train-broker` 16/16.

**No test fails for a reason in the code**, and none of the affected files is one L5 touches. The
honest summary: L5 leaves the suite exactly as it found it, plus 35 new passing tests.

**`test/v2-data.test.js` is fixed.** It was red when L5 started — generated `fixture.js` used
`window` under Node, filed as **DECK-90** rather than hand-editing a generated file. L1.1 resolved
it. DECK-90 should be closed against L1.1.

---

## Behaviour checklist — every `BEHAVIOUR.md` item

### §1 Data

| Item | State | Note |
|---|---|---|
| Session rows via `norm` | **done** | `norm()` ported verbatim into `org.js`; `FD.data.sessions()` returns raw rows, so L5 applies it |
| `SESSION_FIELDS` read by `buildTree` | **done** | real `FleetOrgChart.buildTree`, unmodified |
| `GET /api/seats`, epoch withheld on the wire | **done** | epoch badge shows only when the row carries one (I-L5-08) |
| `?orgFixture=1` → `/orgchart-m11.fixture.json` + `rebaseFixture` | **done** | live checks `X1`–`X3`; `X3` proves the rebase |
| else `Promise.all([sessions, seats])` | **done** | via `FD.data.sessions()` / `FD.data.seats()` |
| error `'/api/seats HTTP <status>'` | **done** | verbatim; live check `E4` |
| `#org-source` texts, **ruling O4** fold into the header pill | **done** | `FD.shell.setLiveApi(text, tone)`, guarded; `D5`, `E7`, `X2`. L2 owns the pill and has not landed, so it is currently a no-op — **the text itself is not on screen yet** |

### §2 `buildTree`

| Item | State | Note |
|---|---|---|
| roots are seats only, coordinator before orchestrator | **done** | `T3` |
| owner found → seat attached to that node, pushed as root | **done** | `T2`; the `has-seat` coral border is not reproduced (I-L5-06 — no mock token) |
| no owner → `seat-vacant`, `'No current owner row'` | **done** | `T4`, `D6` |
| owner already claimed → second vacant node, `conflict:true` | **done** | `T5` |
| `isLive` / `live` stays the terminal gate | **done** | untouched — L5 opens no terminals |
| `childSort` unchanged | **done** | `buildTree`'s ordering is consumed, never re-sorted |
| parent attach, self and cycle rejected → unattached | **done** | `T8`, `T9` |
| unattached keeps its own subtree | **done** | subtree-counted, `S5` |

### §3 States

| Item | State | Note |
|---|---|---|
| tombstone / reaped / suspect / active / offline | **done** | mapped onto the mock's tokens (I-L5-06) |
| `opacity:.62`, pulsing suspect shadow | **n.a.** | stylesheet effects on `.state-*`; the mock has no equivalent and classes may not be grafted on |
| `needsAttention` → `'idle 15m+'` | **done** | `S3`; unit-tested at the 15-minute boundary |
| `pinger_dead` → `'pinger'` + verbatim title | **done** | `S2`, `S4` |

### §4 Card

| Item | State | Note |
|---|---|---|
| vacant seat card: mark, seat, owner mono, epoch, expiry, reason | **done** | I-L5-08 |
| `dataset.host/name/state`, `aria-label` | **partial** | computed and carried on every row; **not written to the DOM** — the mock's markup has no binding for them and hooks may not be grafted on. Nothing in the mock reads them |
| dot + bold `worker\|\|name` + badges | **done** | one badge slot, precedence documented (I-L5-03) |
| tombstone `🪦 close me` + title | **done** | a `<span>` in the mock exactly as it is a `<span>` today (`app.js:287`) — a marker, not a button, in both |
| identity row `role \|\| 'unassigned role'`, mono `host / name` | **done** | `C4` |
| work row `group \|\| 'no group'` / task | **done** | `C5` |
| task as a Linear link when `TASK_RE` matches | **partial** | the task **text** is correct; it is **not a link** — the mock's `grp` slot is a plain `<span>` with no href binding. Unit-tested that a non-key becomes `'no task'` |
| four `org-facts`: epoch / lease / age / expires | **done** | `C1`, `C2`, `C3`, `C6`; formats verbatim |
| `shortDuration` bands | **done** | 11 boundary cases unit-tested |
| expiry `'none'` / `'<d> left'` / `'expired <d> ago'` | **done, one deliberate divergence** | absent expiry is `'none'`, not today's `expired 20703d 0h ago` — see **I-L5-05** |
| owner card `has-seat` + seat badge | **partial** | the seat is shown in the spine card's tag and mono line; the coral border is a class the mock has no token for |

### §5 Header and status

| Item | State | Note |
|---|---|---|
| title, subtitle | **done** | already in the mock, unchanged (`FD.fixture.titles.org`) |
| `#org-status` success text | **done** | exact string in `orgLive.status`; `D4`, `E1`. On screen it is the mock's stats row (I-L5-04) |
| loading texts | **done** | verbatim, both variants (I-L5-11) |
| error text | **done** | verbatim; `E4` |
| unattached strip: count + `'no parent row in the fleet'` | **done** | the mock's tab + its own `No parent row in the fleet.`; count semantics kept (`S5`) |
| `'No seats or sessions to map.'` | **done** | `E2` |
| error-path empty state, three parts | **partial** | both sentences verbatim (`E5`); `Open fixture preview` is **text, not a link** — the URL `/?orgFixture=1` is shown instead (`E6`). See **I-L5-07** |
| `#theme-toggle`, `#org-close` | **n.a.** | v2 has no org overlay; the theme toggle is the shell's, already in the mock |

### §6 Timers and lifecycle

| Item | State | Note |
|---|---|---|
| `setInterval(tickOrgTimes, 1000)` always | **done** | `P1` |
| 30 s poll while open | **done** | gated on the screen being in the DOM, which is v2's `orgOpen` |
| `renderOrg` resets ticks; error path clears them | **done** | payload is rebuilt per tick; the error payload carries no rows |
| `toggleOrg`, Escape closes, boot auto-opens in fixture mode | **n.a.** | v2 has no overlay — the org is a routed screen; opening and closing is the shell's |
| no org-specific localStorage | **done** | L5 writes none |
| old ids/classes | **n.a.** | replaced by the mock's markup, per D11 |

### §7 Mock counterparts

All four D11 pairings are wired: stats row ⇄ status text (I-L5-04), tabs ⇄ tree + strip,
sort/scope built over `buildTree` output without touching `childSort`, spine ⇄ seat roots,
kids grid ⇄ the tree, unattached grid ⇄ the strip with the badge and the four facts.
**Ruling O8** — "Send a message" deep-links into the bus (I-L5-10, `B1`/`B2`).

---

## Hooks

**Provided:** none. `FD.screens.org` is this screen's own surface, read by the org methods in
`logic.js` and by the verify scripts; it is not a cross-slice contract.

**Used, both guarded — a missing slice is a no-op, never a crash:**

| Hook | Owner | State |
|---|---|---|
| `FD.shell.setLiveApi(text, tone)` | L2 | not landed; called on every publish, currently discarded. Live checks stand in for it |
| `FD.screens.bus.open({type,host,session})` | L6 | not landed; "Send a message" falls back to the mock's own bus jump (I-L5-10) |

---

## Files changed

| File | Why |
|---|---|
| `public/v2/screens/org.js` | new, 600 lines — the whole live path. **Owned.** |
| `public/v2/logic.js` | `_orgMessage()` and `_orgLive()`/`_orgVals()` added; the five org keys in `renderVals` become one spread; scope resolution no longer assumes `german-box`. **This screen's methods only.** |
| `test/v2-org.test.js` | new, 35 tests over the pure logic |
| `docs/design/fleetdeck-v2/verify/l5-live/{stub,live,shots}.mjs` | the stubbed backend and the two drivers |
| `docs/design/fleetdeck-v2/verify/l5/` | gate output + `live.json` + `live-{dark,light}.png` |
| `docs/design/fleetdeck-v2/verify/l5-negative-control/` | the gate-sensitivity proof |
| `docs/design/fleetdeck-v2/improvised.md` + `improvised/l5-*.png` | 12 entries, 4 screenshots |
| `docs/goals/fd-v2-l5/` | the pack, imported (see below) |

Not touched: `index.html`, `runtime.js`, `app.js`, `template.dc.html`, `data.js`, `fixture.js`,
`orgchart.js`, `server.js`, any other screen's file or methods.

### `logic.js` is generated, and that is a hazard for every slice

`tools/dc-compile.mjs` emits `public/v2/logic.js` from `template.dc.html`'s script body. The pack
gives each slice "this screen's methods in `logic.js`" while forbidding template edits, so **the next
`npm run v2:compile` overwrites every slice's logic edits at once.** No test enforces the link today
(`npm test` does not run `v2:check`), so nothing is red — which makes it more dangerous, not less.
Flagged for the design seat; not filed as a separate issue because it is really the same decision as
DECK-91.

---

## The pack was missing from the base

`docs/goals/fd-v2-l5/` did not exist on `origin/agent-v2-base`, which carries `s0`–`s2` and
`l1`–`l4`. It existed complete on `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5`, the branch every
pack was authored on. I imported it verbatim (`git checkout <that ref> -- docs/goals/fd-v2-l5`)
rather than filing `operator:gate` and stopping: the launch prompt's gate is for a **missing spec**,
and the spec was in the repo. Recorded here so the base can be corrected.

## Registry

`POST http://100.125.231.25:3131/api/registry` answers **`unauthorized`** from this box, for both the
opening and the closing call. Known and already covered by XYZ-2137; no gate filed, per that ruling.
Attempted with `task: "PENDING"` first and again with `DECK-54`.

## Linear

Reachable this session. Main issue **DECK-54** (In Progress → Done), labels `agent:dietlind`,
`project:remote-system`, `subproject:fleetdeck-v2`, `session:cli-worker`. Two labels did not exist and
were created (`agent:dietlind`; `subproject:fleetdeck-v2` already existed on the `fleetdeck` team,
which is where the issue was filed). No `LINEAR-PENDING.md` was needed.

Filed out-of-scope findings:

| Issue | What |
|---|---|
| **DECK-89** | `index.html` loads neither `data.js` nor `orgchart.js` — blocks every slice L2–L10 |
| **DECK-90** | `test/v2-data.test.js` red: generated `fixture.js` uses `window` under Node — **fixed by L1.1 on the base; close it** |
| **DECK-91** | the org stats row is four unbound literals in the mock |
| **DECK-92** | `design-diff` replaces `verify/<slice>/`, deleting anything else kept there |

## Open follow-ups

1. **DECK-89** — delete the self-loading block in `org.js` once the shell loads `data.js`. Still
   open after S2.2: `index.html` lists neither `data.js` nor `orgchart.js`.
2. **DECK-91** — replace the imperative stats write with four template bindings.
3. Depth is lost in the kids grid (**I-L5-02**); the mock has no nested affordance.
4. `Open fixture preview` is text, not a link (**I-L5-07**); the mock's only in-card affordance has a
   hard-coded label.
5. The task cell is not a Linear link (§4); the mock's `grp` slot has no href binding.
6. `has-seat`'s coral border and the reaped/suspect stylesheet effects have no mock token (**I-L5-06**).
7. Live data makes the spine taller than the mock's three cards (**I-L5-12**).
8. `logic.js` is generated from the template — see above.

## Subagents used

`reader` ×2 (the ledger and binding contract; the S2/L1 reports and `data.js` shapes),
`builder` ×1 (`test/v2-org.test.js`, 35/35 on its first run; it corrected my loader snippet —
`orgchart.js`'s UMD prefers `module.exports`, so it must be assigned to `global.FleetOrgChart`
explicitly). No `hard-crux` pre-audit: the design here is mine, not a handed-down plan, and the
post-audit is the negative control plus the 50-check live proof.

---

**Signed: Dietlind** · `frontend-developer` · `agent-dietlind` · 2026-09-07
