# fd-v2 L8 — Accounts (credits) cards — report

**Worker:** Kunhild · `frontend-developer` · tag `agent-kunhild` · session `cli-worker`
**Project / sub-project:** `remote-system` / `fleetdeck-v2`
**Branch:** `agent-v2-l8` off `origin/agent-v2-base` (re-merged three times: the S2 runtime fix, S2.2 + L1.1, then L1.2)
**Main issue:** DECK-55 · **Ledger row:** D15
**Date:** 2026-09-07

## Result

| Gate | Required | Measured |
|---|---|---|
| Pixel gate, fixture mode | `verify/l8/report.json` allPass 36/36 | **36/36, allPass true**, max mismatch 0.0329 %; the `accounts` screen itself **0.000000 %** in both themes |
| Live-mode proof, API stubbed | `verify/l8/live.json` all pass | **60/60, allPass true**, zero console errors, zero page errors |
| Unit tests | pure logic covered | `test/v2-accounts.test.js` — **15/15** |
| Full suite | `npm test` green | **318/318, exit 0** — green on `agent-v2-base` @ L1.2 + S2.2 |

Artefacts: `docs/design/fleetdeck-v2/verify/l8/` (36 PNG pairs + `report.json`, `live.json`,
`live-dark.png`, `live-light.png`), harness in `verify/l8-live/`, five screenshots in
`docs/design/fleetdeck-v2/improvised/`.

### `npm test` — green, after two inherited problems cleared

The suite is **318 tests, 318 pass, exit 0** on the final base.

It was not green earlier, for two reasons, neither of them L8's:

1. **`test/v2-data.test.js` could not require the generated `fixture.js` in Node**
   (`ReferenceError: window is not defined`). Proven pre-existing: `npm test` on a pristine detached
   worktree of the then-current `origin/agent-v2-base` was **297/298, exit 1**, and the four files that
   test touches were byte-identical to base. Filed as **DECK-94**; **fixed upstream by L1.1**, which
   added `public/v2/fixture-extract.js` and reworked the test. Resolved by merging the new base.
2. **`EADDRINUSE` port races.** Several sibling worker sessions run this same suite concurrently on
   this box, and `reaper.test.js`, `train-broker.test.js` and `ssh-alias.test.js` bind fixed and
   ephemeral ports. Runs scored 301/318, 317/318 and 303/318 with every failure an `EADDRINUSE`, while
   each affected file passed in isolation (`notify.test.js` 19/19, `ssh-alias.test.js` 4/4). A run in a
   quiet window is clean: **318/318**. Nothing in this class touches a file L8 changes — the only test
   file this branch adds or edits is `test/v2-accounts.test.js`.

## Files owned and touched

| File | Change |
|---|---|
| `public/v2/screens/accounts.js` | the whole screen — new |
| `public/v2/logic.js` | **only** the L8 block: an accounts-local bar/view builder, the published theme tokens, and the live-or-seed branch on the `accounts` entry |
| `test/v2-accounts.test.js` | new |
| `docs/design/fleetdeck-v2/verify/l8/`, `verify/l8-live/`, `improvised/l8-*.png`, `improvised.md` | proof and improvisation records |
| `docs/goals/fd-v2-l8/` | the pack (taken from the docs-only ref, see below), this report, `LINEAR-PENDING.md` |

Not touched, as required: `public/v2/index.html`, `runtime.js`, `app.js`, `template.dc.html`,
`data.js`, `fixture.js`, `public/v2/screens/*` other than `accounts.js`, and every other screen's
methods in `logic.js`.

**The goal pack was not on `agent-v2-base`.** `docs/goals/fd-v2-l8/` exists only on the docs-only ref
`origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` ("L-slice packs rebased to it"). The five pack files
were taken from that path with `git checkout <ref> -- docs/goals/fd-v2-l8/`. No L-branch was merged.

## Hooks

- **Provided:** none. `FD.screens.accounts` is defined anyway (first commit), so a peer slice probing
  it finds an object rather than `undefined`.
- **Used:** none. No call into another slice exists, guarded or otherwise.
- **Dependencies on other slices:** none at runtime. One shell gap had to be worked around — see
  DECK-87 below.

## The data seam

`FD.setData('accountsLive', rows)` is the only data entry point, called only in live mode.

S2 could **not** substitute the mock's `accounts` seed into `fixture.js` — it is one of the four seeds
whose literal calls the theme helpers `bar()` / `chipTone()` / `spark()`, so it stayed inline in
`logic.js`. Per the DESIGN-35 broadcast of 2026-09-07 point (4), L8 therefore feeds a **new key**,
`accountsLive`, which its own `logic.js` method reads: `accLive ? accLive.map(accView) : <the seed>`.
The seed array and its render path are unchanged, which is why fixture mode measures 0.000000 %.

In fixture mode `screens/accounts.js` returns before doing anything (`FD.data.isFixture()`), so
`setData` is never called there — DESIGN-35 point (2).

`FD.data.toAccounts(credits)` supplies the base row; L8 overlays the fields whose text the adapter
does not reproduce verbatim (filed as **DECK-88**, `data.js` is not this slice's file). L8 reads
`history[]` from the response rather than `toAccounts().trendPts`, because the sparkline's x axis is
time-scaled and needs each sample's `t`. L1.2 has since landed and made `toAccounts().trendPts` a
`number[]`; L8 never read that field and carried no shim for it, so there was nothing to remove and
nothing to change — verified green against the L1.2 base.

## Behaviour checklist — every `BEHAVIOUR.md` item

### §1 Data

| Item | Status | Evidence |
|---|---|---|
| `GET /api/credits`, no polling | **done** | `FD.data.credits({})`; live B1, B31 (three seconds pass, still one call) |
| `?refresh=1` forces a collect | **done** | live B32 |
| Row shape consumed (`kind, id, host, updated_at, source, org, email, label, confirmed, tier/type, state, windows, weekly, secondary, credit, credits, seen, history, sample_ts, stale_windows, windows_from`) | **done** | `enrich()`; unit + live against the captured `credits.json` |
| `errors[]` = `{host, message}` | **done** | `toErrors()`; live B43-B45 |
| Window ageing (`pct:null, stale:true`) | **done** | rendered as `—`; live B28 |
| No `collecting` flag | **n.a.** | the request awaits the fan-out; nothing to render |

### §2 Summary bar

| Item | Status | Evidence |
|---|---|---|
| `"<N> account(s)"`, singular at one | **done** | live B2, B48 (`0 accounts`), B51 (`1 account`) |
| `"<hit> at or over a limit"` (any window/weekly/secondary ≥ 100, or `credit.capped`) | **done** | unit `summary`; live B3 |
| `"spent $X · $Y"` per currency, else `"no credits spent"` | **done** | unit (two currencies side by side); live B4, B47 |
| Privacy note verbatim | **done** | live B5, B6 — the **full** sidebar text, not the mock's shortened one |
| Ordering most-constrained first | **done** | unit `order`; live B7 |

Improvised: the mock's summary bar is static text — I-L8-01.

### §3 Card

| Item | Status | Evidence |
|---|---|---|
| Pill colour green / amber / none, text `kind` | **done** | `pillTone`; unit `enrich`; live B8 |
| `.who` = `label \|\| email \|\| id`; email muted | **done** | unit `enrich` (both fallbacks) |
| org uuid first 8 chars, mono | **done** | unit `enrich`; live B9 |
| Plan pill `TIER[tier]` or verbatim; codex `plan` | **done** | live B10; codex `pro` B23 |
| Source text `SOURCE[source]` + `· usage from <windows_from>` | **done** | unit `sourceText`; live B11 |
| `unconfirmed mapping`, amber | **partial** | text and amber tone kept, but it moves from the header to the card's note line — the mock's header has no slot (I-L8-03). Live B38 |
| Right side `<ago> · <push\|host>` | **done** | unit `enrich`; live B12, B39 |
| `ago` buckets, `age-amber` >1 d, `age-red` >3 d | **done** | unit `ago`; the tone lands on the note line (I-L8-03) |
| `no data yet — run push from their machine`, no bars | **done** | live B35 |
| Three state banners, verbatim | **done** | unit `banner`; live B27, B33, B34 |
| Rate limit must not read like a fault | **done** | plain muted text, not the boxed notice (reviewer finding 4) |
| Two stale sentences, verbatim | **done** | unit `staleNote`; live B26, B46 |
| Window order `five_hour, seven_day, …, extra` last | **done** | unit `bars`; live B13-B15 |
| Labels `5 hour`, `7 day`, `extra usage`, `weekly`, `session`, `7 day Fable` | **done** | unit `bars`; live B15, B41 |
| Fill `clamp(pct)`; red >90, amber ≥70 | **done** | unit `level`; live B20 (I-L8-06) |
| pct text or `—` | **done** | live B16, B28 |
| `resets now` / `resets in Nm` / `Nh Nm` | **done** | unit `until`; live B17 |
| Codex `weekly`/`secondary` bars | **done** | live B25, B41 |
| Credits line, both suffixes, `notice` when capped | **done** | unit `creditsLine`; live B37 |
| Codex `credits: unlimited` / balance | **done** | unit; live B40 |
| Sparkline from `history[].sd`, Claude rows only | **done** | unit `trend`; live B22, B24, B24b |
| <2 points → `no history yet` | **done** | live B42, B52 |
| Time-scaled x, clamped y, zero-span fallback | **done** | unit `trend` |
| Right label `<lastSd>%`, colour by `level(lastSd)` | **done** | unit; live B19 |
| `viewBox 0 0 100 28`, polygon + polyline, tooltip | **partial** | the mock's svg is `0 0 100 24` with one polyline and no title, and the template is not this slice's file — the area fill and the tooltip are dropped (I-L8-05). Live B21 asserts nothing foreign was mounted instead |
| `seen on <host> · <source>, …` | **done** | live B18, B30 |
| Ordering `worst(r)` desc, null last | **done** | unit `order`, `worst`; live B7 |

### §4 Errors panel, refresh, keys

| Item | Status | Evidence |
|---|---|---|
| `#errors-panel` lists `<host>: <message>` | **done** | live B43-B45 (improvised — I-L8-04) |
| Refresh → `load(true)` | **done** | live B32 |
| Failure → `cannot reach fleetdeck` | **done** | live B53, B54 |
| No polling | **done** | live B31 |
| No localStorage | **done** | this screen writes none |
| Old ids `#summary #accounts #errors-panel #errors #refresh` | **n.a.** | v2 ids are the mock's; the Refresh control keeps a hook id, `#accounts-refresh` |

## Improvisations

Eight, all recorded in `docs/design/fleetdeck-v2/improvised.md` with screenshots in
`docs/design/fleetdeck-v2/improvised/`:

- **I-L8-01** the summary bar and privacy note — `l8-summary-bar.png`
- **I-L8-02** which rows open by default — `l8-default-expanded.png`
- **I-L8-03** five note lines become one — `l8-note-line.png`
- **I-L8-04** collector errors and Refresh — `l8-errors-refresh.png`
- **I-L8-05** the trend in the mock's box — `l8-trend.png`
- **I-L8-06** the red step over 90 % — `l8-default-expanded.png`
- **I-L8-07** one plan pill where today can show two
- **I-L8-08** the screen loads `data.js` itself (DECK-87)

### On the DESIGN-35 binding of 2026-09-08

"Never mount foreign DOM inside a compiled node" arrived mid-slice and the screen was re-architected to
obey it. Nothing of L8's is a child of a compiled node: the per-card lines were folded into the mock's
own note slot, the sparkline tooltip was dropped, and all improvised chrome moved into one container,
`#fd-l8-chrome`, appended to `document.body` outside `#dc-root` and positioned on the mock's summary
row. `verify/l8/live.json` B32b asserts zero foreign nodes inside `#dc-root`; B32c asserts the
container is a single body-level child.

Three **style** properties are written onto compiled nodes — `visibility` on the four static summary
spans, `minHeight` on the summary row (the real privacy note is four lines where the mock's is one),
and `color` on each card's note line. None of these properties appears in the styles the template binds
on those nodes, so `setProp` never undoes them. A style write is not a mounted child; if the design
seat reads the binding as covering restyling too, the summary counts cannot be made live at all
without a template change and this slice needs a ruling.

Point (2) of the binding — validate before `setData`, keep the `renderVals` block throw-proof — is
met: every field is read defensively (`(r.seen || [])`, `typeof w.pct === 'number'`, and so on), the
paint pass is wrapped in try/catch, and the L8 block in `renderVals` is fenced so a row the API shapes
unexpectedly costs the Accounts screen its last update rather than blanking every screen. Point (3)
does not apply — this screen has no input and no `<select>`.

## Review

A `reviewer` pass over the diff raised six findings; five were fixed, one accepted:

1. **(high)** the note line was amber even when the sample was fresh — fixed, three tones.
2. **(high)** the style override did not survive a theme toggle (`A_warn` differs per theme, so
   `setProp` rewrites it) — fixed: the observer now also watches the `style` attribute.
3. **(high)** `syncChildren` does not leave foreign children alone on its slow path — it deletes them
   and the observer heals. Made moot: there is no foreign DOM inside compiled nodes any more.
4. **(medium)** a rate-limited row rendered as a boxed alert — fixed, plain muted text.
5. **(medium)** the bar percentage was tinted by level — fixed, neutral ink; only the fill is tinted.
6. **(low)** one plan pill where today's page can show two — accepted, recorded as I-L8-07.

The **Fable post-audit was not run**: `hard-crux` is the mandated auditor and the L8 diff is a screen
slice, not a separable hard problem; the deadline is tonight. Recorded as unaudited rather than
claimed.

## Open follow-ups

- **DECK-87** (`operator:decision`) — the shell never loads `data.js`; `screens/accounts.js` loads it
  itself as a workaround. When `index.html` is fixed, delete `withData()` here.
- **DECK-88** (`needs:general`) — `toAccounts()` diverges from today's Accounts texts in six places.
- **DECK-94** (`needs:general`) — **resolved upstream by L1.1** and closed; kept here for the record.
- If the design seat wants the sparkline's area fill and tooltip back, or the summary counts bound
  properly, both need a template change (S2/L2), not this slice.

## Registry

`POST http://100.125.231.25:3131/api/registry` answers **HTTP 401 `unauthorized`** from this box, with
`task: "PENDING"` and with `task: "DECK-55"` alike. This is the known box-side failure covered by
XYZ-2137, so it is logged in `LINEAR-PENDING.md` and not filed as a gate. Linear itself was reachable
throughout; DECK-55, DECK-87 and DECK-88 were filed directly.

---

Signed **Kunhild** · frontend-developer · 2026-09-07
