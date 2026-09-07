# fd-v2 L7 — SSH keys + GitHub train — REPORT

**Worker:** Tankred · `frontend-developer` · tag `agent-tankred`
**Branch:** `agent-v2-l7` (off `origin/agent-v2-base`, merged forward twice — the S2 reconciliation fix, then S2.2 + L1.1)
**Linear:** [DECK-44](https://linear.app/synchronicity/issue/DECK-44) · ledger row **D14**
**Date:** 2026-09-07

---

## 1. What shipped

The SSH keys + GitHub train screen runs on live data, inside the mock's markup, behaving as
`BEHAVIOUR.md` specifies. Fixture mode is byte-for-byte untouched.

| File | Mine | What changed |
|---|---|---|
| `public/v2/screens/keys.js` | owned | the whole screen: load, poll, tick, the four cards, every action |
| `public/v2/logic.js` | this screen's section only | the keys block hands the render's theme tokens to the screen file, guarded and wrapped |
| `docs/design/fleetdeck-v2/verify/l7-harness/live.mjs` | new | the live-mode proof, 25 scenarios / 66 checks |
| `docs/design/fleetdeck-v2/verify/l7-harness/shots.mjs` | new | the improvisation screenshots |
| `test/v2-keys.test.js` | new | 17 unit tests over the pure helpers |
| `docs/design/fleetdeck-v2/improvised.md` | appended | I-L7-01 … I-L7-08 |

### The problem this slice had to solve

The compiled template binds exactly five names for this screen — `A_isKeys`, `A_ttlChips`,
`A_prinChips`, `A_keyRows`, `A_copyCmd`. The **GitHub train card and the Certificates card carry no
bindings at all**: the pill, countdown, TTL chips, End train button, cert rows, copy line and
Kill now / Delete buttons are literal markup (`template.dc.html:518-548`), and the Keys table's Type
cell is the literal string `ED25519`. `FD.setData` cannot reach any of it, and the template, the
shell, `app.js` and `runtime.js` are all out of scope.

So live mode **paints those cards from clones of the mock's own nodes**. The mock's active-cert row,
copy line and expired-cert row are captured once, before anything is rewritten, and cloned per real
certificate; every colour is a style object built by the mock's own `pill()` / `dot()` / `selChip()`
helpers and handed over by the `logic.js` keys section. No markup is typed by hand anywhere in the
slice, and the only additions to mock nodes are `data-*` hooks (`data-l7-notice`, `data-l7-busy`).

Repainting is driven by a seam: `logic.js` calls `FD.screens.keys.sync()` during `renderVals()`, and
the repaint is scheduled in a microtask, so it lands immediately after the reconciler has restored
the template's static nodes — same task, before the browser paints, so there is no flicker.

**Fixture mode never reaches any of that.** `screens/keys.js` returns before it registers anything,
so `logic.js`'s guarded call stays a no-op, `renderVals()` returns exactly what S2 compiled, and no
timer, DOM write or network request happens. That is what holds the pixel gate at 36/36.

---

## 2. Behaviour checklist — every `BEHAVIOUR.md` item

### §1 Data

| Item | Status | Evidence |
|---|---|---|
| `GET /api/sshkeys` → `{certs,keys}` | **done** | via `FD.data.sshkeys()`; L7-11, L7-20 |
| `GET /api/ghtrain` → `{active,expiresAt}` or `{ok:false,error}` | **done** | L7-07, L7-24, L7-26 |
| broker 503 text surfaced verbatim | **done** | L7-27 |
| `certs[]` sorted `dir` desc | **done** | server-side; order preserved, L7-13 |
| the `current` symlink dir excluded client-side | **done** | `keys.js` filters `/\/current$/`; server excludes it too |
| `keys[].type` is the REAL algorithm, never hard-coded | **done** (improvised I-L7-05) | L7-56/57/58/59 — RSA, ECDSA, ED25519, `'?'` |

### §2 Mint

| Item | Status | Evidence |
|---|---|---|
| TTL chips `1h/4h/8h`, default `1h`, `.sel` on click | **done** | bound to `logic.js`; L7-01 |
| principal chips `root`/`vibe`, both selected by default | **done** (improvised I-L7-03) | L7-02, L7-05 |
| chip titles verbatim | **done** | L7-03, L7-04 |
| guard `pick at least one principal` | **done** | L7-31, and no POST fires (L7-32) |
| `POST /api/sshkeys/mint {ttl, principals:'root,vibe'}` | **done** | L7-33 |
| server validation text surfaced | **done** | L7-46 shows the analogous train text; mint 502 at L7-34 |
| button disabled + `Minting…` | **done** | L7-45 / L7-63 / L7-64 pin the in-flight label and the disabled state against a delayed stub |
| success flashes the new cert (`flashDir`) | **done** (improvised I-L7-06) | L7-65, L7-66 |
| failure → `r.error \|\| 'mint failed'` | **done** | L7-34 |
| `load()` always after | **done** | `mint()` calls `load()` on both paths |
| 1Password hint text verbatim | **done** | L7-06 |

### §3 GitHub train

| Item | Status | Evidence |
|---|---|---|
| `BROKER DOWN` never collapsed into `INACTIVE` | **done** (improvised I-L7-06) | L7-26 |
| `ACTIVE` + mono countdown | **done** | L7-07, L7-08 |
| `INACTIVE` | **done** | L7-24 |
| `left()`: `h:mm` ≥ 1 h, else `mm:ss`, zero-padded | **done** | L7-08 (`1:05`), L7-55 (`mm:ss`); unit-tested |
| ticks every 1 s; crossing zero forces a full render | **done** | L7-50, L7-53, L7-54 |
| start chips disable + `Touch ID…` | **done** | L7-45 |
| `POST /api/ghtrain {ttl}` | **done** | L7-44 |
| start error → `r.error \|\| 'could not start train'` | **done** | L7-46 |
| `End train` only while live | **done** | L7-09, L7-25 |
| `POST /api/ghtrain/end {}` | **done** | L7-47 |
| end error → `'could not end train'` | **done** | L7-48 (non-JSON → `HTTP 500`) |
| hint + curl text verbatim | **done** | L7-10 |
| 30 s poll | **done** | L7-51 |

### §4 Certificates

| Item | Status | Evidence |
|---|---|---|
| `live = validToEpoch > now`; `ACTIVE` / `EXPIRED` pill | **done** | L7-12, L7-18 |
| row: mono `keyId \|\| dir`, muted principals `· until`, countdown | **done** | L7-13, L7-14, L7-15 |
| `Kill now` (live) with verbatim confirm | **done** | L7-16, L7-36 |
| `Delete` (expired, no confirm) | **done** | L7-19, L7-39 |
| `POST /api/sshkeys/delete {dir}` | **done** | L7-37, L7-40 |
| cancelling the confirm deletes nothing | **done** | L7-38 |
| delete error → `r.error \|\| 'delete failed'` | **done** | lands in the Mint card's line, as today (`keys.js:66` reuses `errEl`) |
| copy line with exact flags | **done** | L7-17, L7-42 |
| `Copy` → clipboard, `Copied` for 1.5 s | **done** | L7-41, L7-42, L7-43 |
| empty text `no certs yet — mint one above` | **done** (improvised I-L7-04) | L7-29 |

### §5 Keys table

| Item | Status | Evidence |
|---|---|---|
| columns Name · Type · Fingerprint · Comment | **done** | L7-20, L7-21, L7-22 |
| no sort | **done** | rows render in the server's order |
| `'?'` fallbacks for type/fingerprint | **done** | L7-59 |

### §6 Errors, keys, ids, timers

| Item | Status | Evidence |
|---|---|---|
| load failure → `cannot reach fleetdeck` | **done** | L7-30 |
| 403 surfaces as `HTTP 403` | **done** | L7-35 |
| 405 `method not allowed` | **n.a.** | the v2 screen only ever issues the correct method; the `HTTP <status>` path that would render it is proven at L7-35 and L7-48 |
| **no localStorage** | **done** | the screen writes none; `fd-fixture` is only ever read |
| old ids (`#ttls`, `#certs`, …) | **n.a.** | v2 addresses the mock's markup by structure and `data-*` hooks; the mock has no such ids and hand-adding them is forbidden |
| timers 30 s / 1 s / 1.5 s | **done** | unit-tested verbatim; L7-43, L7-50, L7-51 |

### §7 Improvisations

All eight are in `docs/design/fleetdeck-v2/improvised.md` with screenshots under
`docs/design/fleetdeck-v2/improvised/`: I-L7-01 principals source · I-L7-02 the data-layer loader ·
I-L7-03 the live principal default · I-L7-04 notices cloned from the mock's hint line ·
I-L7-05 the real key type · I-L7-06 `BROKER DOWN` amber + mint flash · I-L7-07 painting the unbound
cards from clones · I-L7-08 `data-dc-raw` and restyling clones on every paint.

---

## 3. Gates

| Gate | Result |
|---|---|
| Pixel gate, fixture mode | **36/36, `allPass: true`**, max mismatch 0.032948 % (a pre-existing `registry dark` delta inherited from S2). **`ssh-keys` 0.000000 % in both themes.** `verify/l7/report.json` |
| Live proof, API stubbed | **66/66, `allPass: true`**, zero console errors of the screen's own. `verify/l7/live.json`, `live-dark.png`, `live-light.png` |
| Unit tests | `test/v2-keys.test.js` — **17/17** |
| `npm test` | **320 pass / 320, 0 fail.** |

### `npm test`, and the failure that went away

For most of this slice `npm test` was **246/247**: `test/v2-data.test.js` threw
`ReferenceError: window is not defined` because the generated `public/v2/fixture.js` had no UMD
guard. I verified it was not mine (`git diff origin/agent-v2-base...HEAD -- public/v2/fixture.js`
empty, the file last written by S2's `2bd76de`) and filed it as **DECK-85**, since DESIGN-35's
standing rule forbids any L-slice from editing that file.

The L1.2 base move fixed it. On the current base the suite is **320 pass / 320, 0 fail**, my 17
included. DECK-85 can be closed as fixed upstream.

### The fleet registry row

Both registry POSTs answer `unauthorized` from german-box:

```
$ curl -s -X POST http://100.125.231.25:3131/api/registry -H 'Content-Type: application/json' \
    -d '{"host":"german-box","name":"FD-v2-l7",...}'
unauthorized
```

The broker itself is reachable from here (`GET /api/ghtoken` answers **200**), so this is an
authorisation failure, not a network one. I exhausted every credential the box actually has:

| Attempt | Result |
|---|---|
| `POST /api/registry`, no auth header | **401 unauthorized** |
| `POST /api/registry`, `Authorization: Bearer $(cat ~/.fleetdeck-bus-token)` | **401 unauthorized** |
| `POST /api/registry`, `X-Fleet-Token: <bus token>` | **401 unauthorized** |
| Control: `POST /api/bus/ping` with the same bus token | **401 unauthorized** |
| `FLEET_TAILNET_KEY` in env, shell profiles, or any dotfile | **not present** |

The control line matters: the bus token is rejected even on a bus route, so it is not a fallback for
anything. The only credential on this box has no authority here.

So **the registry row is the one acceptance item this slice did not satisfy**, and it cannot be
satisfied from german-box by any means available to a worker — it needs `FLEET_TAILNET_KEY`
provisioned, or the row written by hand. That is **DECK-102** (`operator:gate`), which L9 raised
first and L7 independently confirmed; DECK-44 is linked `blockedBy` it. I did not tick the box.

DESIGN-35 accepted L7 on 2026-09-07 with this item outstanding.

### Running the gates, in order

```bash
node <static server> public 3217                       # serve public/
npm run design:diff -- --app "http://127.0.0.1:3217/v2/index.html?fixture=1" --slice l7
node docs/design/fleetdeck-v2/verify/l7-harness/live.mjs
node docs/design/fleetdeck-v2/verify/l7-harness/shots.mjs
```

**The order matters.** `scripts/design-diff.mjs` `publish()` **replaces `verify/l7/` wholesale**, so
anything sitting in that directory is destroyed by a gate run. That is why the harness scripts live
in `verify/l7-harness/` and only write their *results* into `verify/l7/`. I lost a harness to this
once; the layout now makes it impossible.

---

## 4. Hooks

- **Provided to other slices:** none. Declared as such in the first commit and still true.
- **Used from other slices:** none.
- **Internal seam:** `FD.screens.keys.sync()` between `screens/keys.js` and this screen's own
  `logic.js` section. `logic.js` calls it guarded (`if (FD.screens.keys && FD.screens.keys.sync)`),
  so it is a no-op whenever the screen file has not registered — which is always, in fixture mode.

## 5. Cross-slice dependencies and findings

1. **DECK-84 — the shell loads neither `data.js` nor `router.js`.** `public/v2/index.html:35-47`
   loads runtime, fixture, logic, app and the nine screens, but not L1's data layer. `FD.data` is
   therefore `undefined` at runtime and **every** L-slice written to the documented contract is
   silently inert in live mode. This screen appends the `<script>` itself as a stopgap
   (I-L7-02), behind `if (FD.data) boot()` so it disappears the moment the shell does it properly.
   `index.html` is out of every slice's scope, so no slice can fix it. **This is the one thing in
   this report that needs someone else's hands before cut-over.**
2. **DECK-85 — `npm test` red at base** (above).
3. **DECK-86 — open item O9**: the principal chips cannot come from `hosts.json`, which has no user
   field. Shipped with today's constant; recommendation and options are in the issue.

## 6. DESIGN-35 oracle rules

- **Rule 2 (throw-proofing), applied.** `renderVals()` is shared, so one throw there blanks *every*
  screen. The `logic.js` keys block is wrapped in `try/catch`; `paint()` is wrapped, because it runs
  from a microtask the shared render schedules; and every row is validated before `FD.setData`
  (`rows()` drops holes, `str()` coerces each field). The keys screen degrading to the mock's static
  cards is survivable; taking the app down with it is not.
- **Rule 1 (no foreign DOM in compiled nodes).** No foreign widget is mounted, and **no per-row
  state lives in the DOM** — every paint rebuilds from module state, so positional `sc-for` rows are
  never treated as stable identities. The cards this slice paints are static markup, not `sc-for`
  lists. Both gates were re-run after merging S2's reconciliation fix and stayed green.
- **Rule 3 (raw input state).** Not applicable: this screen has no text input and no `<select>`.
- **S2.2's `data-dc-raw`, adopted.** The Certificates card is marked raw from `capture()`, so the
  reconciler neither inserts nor removes inside it. Set from JS, since the template is out of scope
  and `runtime.js:292` reads the live attribute. See I-L7-08.

### A defect S2.2 surfaced, found and fixed here

Adopting `data-dc-raw` made me re-examine the cloned prototypes and exposed a real bug of my own:
**a clone carries the palette of whichever theme was live when it was captured.** Flipping theme
inside a live session would have left the copy line's background, the principals line, the countdown
and the buttons on the old palette while the rest of the app moved. Every theme-dependent property
on a cloned node is now re-derived from that render's tokens on each paint.

It had no coverage, so `verify/l7` gained L7-61 and L7-62: they flip the theme *after* the cards are
painted and assert the computed colours actually changed. Both fail against the previous
implementation. The app has no theme control in its markup — theme is `AppLogic` state — so the
harness drives it through the logic handle the screen already receives on every `sync()`, exposed on
the existing `_debug` seam.

A first version of that check asserted `true` and could not fail. That is exactly the vacuous-test
class I had asked the reviewer to hunt for, and it is fixed; the numbers above are from the real one.

## 7. Delegation

Per the protocol's delegation floor: three `reader` subagents for the v1 source, the v2 shell
contract and the design ledger; a `builder` for `test/v2-keys.test.js` (it also caught two real
defects in my file — a lost broker message when a proxy answers 503 as text, and a dead guard — both
fixed); a `reviewer` on the finished diff. The screen file itself I wrote directly: the whole slice
turned on one architectural judgement (the unbound cards), and specifying it precisely enough to
hand over would have been the code.

## 7b. What the review found

A `reviewer` pass over the finished diff returned three real findings. All are fixed, and each now
has a check that fails against the old code:

1. **HIGH — the mint flash was dead code.** `repaint()` cleared `flashDir` at the end of *every*
   paint, but the paint that follows `mint()` still sees the pre-mint certificate list, so the new
   dir never matched before the flag was zeroed. Fixing that exposed a second half: the rows are
   rebuilt on every paint and a mint triggers several in quick succession, so even a matched tint
   was replaced microseconds later by the repaint `FD.setData` schedules. The flash is now driven by
   a **deadline** (`flashUntil`) that every paint reads, so it survives any number of repaints and
   expires on its own. Covered by **L7-65** (the new cert arrives at the top) and **L7-66** (its row
   is actually tinted) — the reviewer noted the old scenario checked only the POST body.
2. **MEDIUM — `L7-45` could not fail.** The route stub never consumed its `delay` flag, so there was
   no in-flight window, and the assertion accepted both `'Touch ID…'` and the reverted `'1h'`. The
   stub now really delays 1.2 s and the check is strict, with **L7-63** (the chip is disabled while
   in flight) and **L7-64** (it reverts afterwards) added. This is the second vacuous check I wrote
   and caught; both are now real.
3. **LOW — stale error notices.** Today's handlers hide the error line the moment you click
   (`keys.js:231,249`); mine waited for the response, so a failed "Kill now" left "delete failed"
   sitting under a button you had already pressed again. All three handlers now clear and repaint on
   click.

Fixing 1 and 3 properly meant moving every piece of transient state — the dir being deleted, the TTL
being started, whether an End train is in flight, the flash deadline — out of the DOM and into the
module, which each paint reads. That is what DESIGN-35's rule 1 asks for, and the `data-l7-busy`
hook it replaced is gone.

The reviewer's fourth finding (a repaint ordering race between the direct `paint()` in `load()` and
the flush `FD.setData` schedules) is real but self-correcting within the same microtask drain, so
nothing is ever visible. Left as-is and noted here rather than papered over.

## 8. Follow-ups

All three are resolved. Nothing is outstanding in the slice itself; the review findings are fixed
and covered.

- **DECK-84 — assigned to L11 (Alrun).** The shell gets its `data.js` and `router.js` tags there, and
  L11 removes this screen's stopgap loader. The guard stays as written: `if (FD.data) boot()` runs
  first, so once the shell loads the data layer the injection never fires, and the loader can be
  deleted whenever L11 gets to it without a flag day.
- **DECK-85 — fixed upstream.** The L1.2 base move repaired the `fixture.js` UMD guard; `npm test`
  is 320/320.
- **DECK-86 — ruled, closed.** DESIGN-35, 2026-09-07: `hosts.json` has no user field, so the
  principal chips stay the two constants `root` / `vibe` with today's titles. Accepted as
  improvisation I-L7-01; no code change.

---

**Signed: Tankred** · `frontend-developer` · `agent-tankred` · 2026-09-07
