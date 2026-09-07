# Fleetdeck v2 — improvisation log

Every shape or behaviour the mock leaves open, decided by a worker, gets one entry here: what was
decided, which ledger row or open item it serves, and why. An improvisation without an entry fails
review (operator rule, `plan.md` §"Improvisation rule"). Screenshots are required for visual
improvisations; data-only entries do not need them.

---

## L1 — data layer, fixture mode, v2 routing (Juergen, `agent-v2-l1`, 2026-09-07)

### I-L1-01 — The seed arrays are not data; adapters and the fixture carry the *data* layer only

**Serves:** the whole of L1 (`README.md` §Scope 1, §Acceptance rows 2 and 3), ledger rows D06/D18–D20.

The mock's seed arrays are local `const`s inside `AppLogic.renderVals()`
(`mock/Fleetdeck Final.dc.html` L1245–L2004). They are not JSON. Each element mixes three layers:

| Layer | Example | Owner |
|---|---|---|
| 1 · data | `regData[].s/g/tk/st`, `tiles[].name/box`, `keyRows[].fp` | **L1** |
| 2 · derived presentation | `dotStyle: dot(t.good)`, `provStyle: chipTone('neutral')`, `lines[].style`, `trendPts` | the compiled template (S2) |
| 3 · behaviour | `openTerm`, `toggle`, `show`, `copyConv` — arrows added by trailing `.map()` chains | the screen slices (L2–L10) |

**Decision: L1 emits layer 1 only** — precisely the fields named in `diff.md` §"Binding map" — and both
the adapters and `fixture.js` emit that same layer-1 projection.

**Why.** Layer 2 is computed from the theme token object `t`, which is rebuilt per render from
`state.dark`; dark and light produce different token values. If L1 baked style objects into its rows,
a row adapted while dark would render wrong in light and the pixel gate (which runs both themes)
could not pass. Layer 3 is functions — not serializable, and explicitly the screen slices' job.
`diff.md` §"Binding map" independently confirms the boundary: it lists only layer-1 fields, and for
the org chart it lists the *arguments* of `orgCard()` (`name, on, role, path, grp, epoch, lease, age,
exp`) rather than its returned keys (`name, role, path, grp, badge, dotStyle, badgeStyle, meta`).

**Consequence for S2 / L2–L10.** The compiled template keeps `dot()`, `chipTone()`, `bar()`, `mSec()`,
`spark()` and the token object `t`, and applies them at render time to whatever rows it is handed.
That is not new work: it is exactly what `renderVals()` already does today — the only change is that
the array it maps over comes from `FD.data` instead of a literal. L1 adds no rendering and does not
touch `index.html`, `logic.js`, `app.js` or `runtime.js`.

**Therefore "byte-equal to the mock's seed arrays"** (`README.md` §Acceptance) is read as *deep-equal
and key-order-equal over the layer-1 projection*. It cannot mean more than that: layers 2 and 3 are
theme-dependent and non-serializable, so no file on disk can be equal to them in any theme-independent
way. `test/v2-data.test.js` asserts that reading.

### I-L1-02 — `tools/extract-fixture.mjs` evaluates the mock in a sandbox; it never re-types it

**Serves:** `README.md` §Scope 1 ("extracted **verbatim** … by a script"), §Acceptance row 2.

The extractor slices each seed literal's *source text* out of the mock by bracket-matching from its
declaration, then evaluates it under `node:vm` in a context of stub helpers, then drops every key whose
value came back a sentinel or a function. No value is ever hand-transcribed, and a mock change flows
through on the next `npm run v2:fixture`.

The stubs are what make the layer split mechanical:

| Real helper | Stub returns | Effect |
|---|---|---|
| `dot`, `chipTone`, and `t.*` (a Proxy) | a unique sentinel | the key is dropped — pure presentation |
| `bar(label, pct, resets, stale)` | `{label, pct, resets, stale}` | the layer-1 data *inside* the helper call survives |
| `mSec(env, name, email, chips, bars, note)` | one key per parameter | ditto |
| `orgMeta(...)`, `orgCard(...)` | one key per parameter | ditto — matches the binding map, which names the arguments |
| `spark(arr)` | `arr` | the raw 7-day numbers are data; the polyline string it builds is presentation |
| `this.state.adhoc` | `{}` → spread contributes nothing | keeps the fixture free of runtime state |

For the three `.map()`-chained arrays (`tiles` L1841–1870, `accounts` L1936–1964, `machines`
L1977–2001) the extractor takes the **raw array literal only**, stopping before `.map(` — which drops
layer 3 by construction.

Two drop rules beyond "the value is a sentinel or a function", both needed in practice:

- an object that had keys and lost all of them is dropped as well, so `lines[].style = {color: t.ink75}`
  disappears instead of leaving an empty `style: {}`;
- a key **named** `style` or `*Style` is dropped by name. This one is a convention, not a proof:
  `accounts[4].bannerStyle` is built by string concatenation with a theme token
  (`'1px solid ' + t.warn`), which yields a plain string that no sentinel test can catch. The mock's
  naming is consistent — every presentation key ends in `style`/`Style` and no data key does — but if a
  future mock breaks that convention the rule will silently keep a style string. Documented at
  `tools/extract-fixture.mjs:145`.

The tool fails loudly and names the declaration if a seed literal cannot be located **or if its anchor
is ambiguous** (`accounts:` and `machines:` each occur twice — the second time inside `titles`); a
silent partial extraction would be the worst outcome, because the mock is expected to change.
`npm run v2:fixture:check` fails when `public/v2/fixture.js` is stale, and it runs as part of
`pretest`, so `npm test` cannot pass against a stale fixture.

One consequence to hand on: `spark()` is stubbed to return its input, so `accounts[].trendPts` is a
number array in the fixture where the mock's runtime value is an SVG polyline string. The template
re-runs `spark()` on it — the same split as every other layer-2 value.

### I-L1-03 — `groups[]` keeps the mock's `items`, not the binding map's `sessions`

**Serves:** ledger D03, `diff.md` §"Binding map" row `groups[]`.

The binding map says `groups[]` has `box, n, sessions[]`. The mock actually declares
`{ box, n, items: [...] }` (L1817–1820). **The mock wins** — it is the pixel-gated ground truth and the
compiled template will read `items`; the binding map's `sessions[]` is a prose slip in the ledger.
`toGroups()` therefore emits `box, n, items`. Ledger correction for the design seat, not a build gap.

### I-L1-04 — Relative-time strings are formatted by the adapter

**Serves:** `diff.md` §"Binding map" rows `regData[]`, `dsData[]`, `orgCard()`.

The mock stores already-humanised strings — `regData[].active = '16h ago'`, `.msg/.seen = 'just now'`,
`dsData[].when = '1h ago'`, `.turns = '6 turns'`. The API returns machine timestamps
(`active_at`, `msg_at`, `last_seen_at`, `lastActivityAt`, all ISO strings or epoch numbers) and raw
counts (`completedTurns`). The adapters format to the mock's string shape so the type matches, using
one shared `ago()` helper. Formatting, not rendering: the value is a plain string either way, and the
template does no time maths today.

`created` is the exception — the mock keeps `dsData[].rows[].created` as a raw ISO string
(`'2026-09-06T13:49:10.097Z'`), so the adapter passes `createdAt` through unchanged.

### I-L1-05 — Fields the real API cannot supply are `null`

**Serves:** `README.md` §Scope "Out" ("If a shape needs data the API lacks, document it … and leave the
field `null`").

Checked against the live responses captured on 2026-09-07 in `fixtures/api/`.

| Mock field | Status | Decision |
|---|---|---|
| `tiles[].foot1`, `.foot2`, `.lines` | footer copy is a registry-derived string, and `lines` is live xterm output | `null` / `[]`. `README.md` scopes `toTiles()` to name/box only; the footer is decided in **L3** (ledger D09, open item O2). |
| `busSessions[].pinned` | not in `/api/messages`; the binding map says "pinned/unread = client-side" | omitted by the adapter; a later slice (L6) adds it from local state. |
| `busSessions[].live` | `/api/messages` carries no liveness at all — only `source`, `target`, `status` and timestamps | `null` on every row. `toThreads()` takes messages alone, per the signature the pack fixes, so it cannot know. **L6 should join on `/api/sessions` by name** to fill it — the data exists there (`live`), just not on this endpoint. |
| `busSessions[].host` | present for `tmux` targets, absent for `claude-desktop` ones | the target's `host` when there is one, else `null`. |
| `busGroups[]` | the mock's one group is a hand-made ad-hoc group (`this.state.adhoc`); the API has no group concept | `[]` from live data. L6 owns ad-hoc groups. |
| `keyRows[].type` | the mock hard-codes ED25519 | **not** improvised — `/api/sshkeys` `.keys[].type` is real and is used. |
| `accounts[].trendPts` | open item **O6** says history does not exist server-side | it partly does: `credits.json` `.rows[].history` is present on 4 of 5 rows. The adapter passes `history` through as the raw number array when present and `null` otherwise. **Flagged for the design seat: O6 and the plan's new `L8s` server rider may be narrower than assumed.** L1 does not act on this beyond passing the data through. |
| `sessions[].reaped_at`, `.pinger_dead` | present in the schema, `null` on all 114 captured rows | passed through; nothing in the mock binds them. |
| `messages[].error` | `null` on all 50 captured rows | passed through — it is the source for a failed message's `err`, and the capture simply had no failures. |
| `health.alerts[].host` | `null` on all 10 captured rows | passed through. |
| `desktop-sessions … .worktree` | `null` on all 923 captured rows | passed through; the mock binds `path` from `cwd`. |

### I-L1-06 — `receipts` derive from the message `status`, per-recipient only for broadcasts

**Serves:** ledger D13, `diff.md` §"Binding map" row `busSessions[]`/`seedThreads`.

The mock's thread messages carry `status` (one of `queued | delivered | acked | failed | offline`) on
**outbound** messages only; inbound messages have no `status` key, and a broadcast carries `per`
(a map of member id → status) *instead of* `status` (L1429–L1446). `/api/messages` returns a flat
`status` on every row plus `target`, `error`, `created_at`, `delivered_at`.

`toThreads()` reproduces that split exactly: direction from whether `source` or `target` names the
session; `status` copied through on outbound only; `err` set from `error` when `status === 'failed'`;
`per` built only when a row's `target` addresses more than one recipient. Inbound rows get no `status`
key at all — an absent key, not `null`, because the mock distinguishes the two and the template's
`sc-if` bindings test presence.

### I-L1-07 — `tk` is filled from the registry `task` field

**Serves:** `diff.md` §"Binding map" row `regData[]`.

The binding map maps `regData[].tk` to registry `task`, and `/api/sessions` rows carry `task`
(present on all 114 captured rows). No ambiguity in practice — recorded because `README.md` names it
as an open shape decision. The mock's sample values (`'O44-84'`) are Linear-style issue keys, which is
what `task` holds.

### I-L1-08 — `fd-landing-dark` stores a `'1'`/`'0'` dark flag

**Serves:** ledger D06 (theme key migration).

The new key is named for a *dark* boolean, so it stores `'1'` / `'0'`, not `'light'` / `'dark'`.
Migration reads `fd-landing-dark` first; when absent it falls back to the legacy `fleetTheme` and maps
`'light'` → `'0'` and anything else → `'1'`. That "anything else is dark" rule is today's behaviour,
not a new one: `public/sessions.js:32` already tests only for `'light'`. The resolved value is written
back to `fd-landing-dark`; the legacy key is left in place so the old UI keeps working until the L11
cut-over deletes it.

### I-L1-09 — the `/v2/` fix is a general directory-index rule

**Serves:** `README.md` §Scope 2, §Acceptance row 4.

`server.js` had exactly one index fallback, the literal root check `p === '/' ? 'index.html' : …`, so
every other directory URL reached `fs.readFile` on a directory, got `EISDIR`, and was mapped to 404.
The fix adds one ternary arm rather than a `/v2`-special case:

```js
const rel = p === '/' ? 'index.html'
  : p.endsWith('/') ? p.replace(/^\/+/, '') + 'index.html'
  : p.replace(/^\/+/, '');
```

It is smaller than a path-specific branch and matches the surrounding style. It applies to any
trailing-slash URL under `public/`, but changes behaviour only where an `index.html` actually exists —
every other directory URL still 404s, just one `readFile` later. The traversal guard below it is
untouched and still rejects anything escaping `public/`.

### I-L1-13 — the desktop-row fallbacks are the current app's words

**Serves:** ledger D17; design ruling 2026-09-07.

`/api/desktop-sessions` leaves fields empty often enough that the fallback wording is part of the
shape, not an edge case: on the 923 captured rows `branch` is null 313 times and `completedTurns` is
null 43 times. The adapter uses the current app's exact strings, so the two UIs never disagree:

| Field | Null becomes | Source |
|---|---|---|
| `branch` | `'No branch'` | `public/sessions.js:225` |
| `model` | `'Model unknown'` | `public/sessions.js:225` |
| `turns` | `'Turns unknown'` | `public/sessions.js:229` |

The turn count matters most: it previously rendered `'0 turns'`, which asserts something the API never
said — a session whose count is unknown is not a session with no turns. A reported `0` still renders
`'0 turns'`. `sessions.js:229` tests `=== null`; the adapter folds in `undefined` too, since a missing
key can only mean the same thing (the API always sends the key, so this is not observable today).

### I-L1-12 — human labels the API does not carry, and fixture mode is read-only

**Serves:** ledger D15, D16; found by the reviewer pass on the adapters.

Four label decisions and one safety rule, all from comparing adapter output against the mock
row by row rather than against its key list.

| Field | API gives | Mock shows | Decision |
|---|---|---|---|
| `accounts[].plan`, `machines[]…chips[1]` | `tier: 'default_claude_max_20x'` | `'Max 20×'` | derived: `/max[_-]?(\d+)x$/` → `'Max N×'`. The API has no human tier name, and passing the raw enum puts `claude_max` on screen. |
| `machines[]…chips[0]` | `plan: 'claude_max'` | the plan family **and** the tier, as two chips | both are emitted; the mock always carries the pair for a tiered account. |
| `accounts[].id` | the full org uuid | first 8 hex (`'c578669c'`) | sliced, matching what `toDesktop()` already does for the account uuid. |
| `accounts[].banner` | `state: 'error'` | a sentence, `'could not read usage on rfc1918-internal'` | the server's own `errors[]` message when one names the row, otherwise that sentence. The raw enum must never reach the screen. |

**`machines[].cols` groups by client, it does not map 1:1.** A machine can report the same client
twice — german-box runs a WSL side and a Windows side, and `/api/machines` returns eight client rows
for it. The mock puts those in **four** columns of **two** sections (`fixture.machines[1]`), with
`env` labelling the environment. A 1:1 map produced eight single-section columns: the right key set,
the wrong structure, and the shape tests did not catch it because they only walked `Array.isArray`.
`env` is `''` on a single-environment machine and `WSL` / `Windows` where there are two.

**`machines[]…bars` tuples are two elements, not three.** The mock writes `[label, pct]` and only
grows a third element when the window is stale. The adapter now matches; a fixed-width triple was a
silent shape mismatch.

**Fixture mode is read-only.** `?fixture=1` originally intercepted only the ten reading endpoints, so
`kill`, `registryDelete`, `deleteKey`, `mintCert`, `sendMessage`, `retryMessage`, `registryUpsert`,
`startTrain` and `endTrain` still reached the network. A Kill clicked on a page in fixture mode would
have destroyed a real session. All nine now resolve `{ok: true, fixture: true}` and touch nothing;
a test asserts both that they are inert in fixture mode and that they still work outside it.

### I-L1-11 — `trendPct` is derived, and empty history is `null` rather than `''`

**Serves:** ledger D15, open item **O6**, `diff.md` §"Binding map" row `accounts[]`.

Two small divergences in `accounts[]`, both deliberate.

**`trendPct` is not adapted.** The mock's five accounts do not share one key set: row 0 carries the
base set, rows 1–4 add `trendPct`, rows 2–4 add `staleNote`, row 4 adds `banner`. `trendPct` is a
percentage computed *from* `trendPts` — the same derivation that produces the sparkline polyline and
`trendColor`, both of which are layer 2 and were dropped at extraction. Emitting it from L1 would mean
guessing the mock's formula, and a wrong guess shows up as a wrong number on screen. The adapter
therefore emits the base key set plus `staleNote` / `banner` where they apply, and the template
computes `trendPct` from the `trendPts` array it already receives — exactly as it computes the
polyline. Consistent with I-L1-01.

**Empty history is `null`, not `''`.** The mock's own "no history" sentinel is the empty string
(`accounts[0].trendPts === ''`); the pack's convention for data the API cannot supply is `null`. The
adapter uses `null`. Both are falsy, so the template's `showTrend` test behaves identically; the type
differs only in the empty case.

**`trendPts` is a `number[]`, not the raw history rows** (design ruling 2026-09-07). `/api/credits`
returns `history[]` as `{t, fh, sd, xu}` samples; `sd` is the sampled seven-day percentage and is the
series the sparkline draws. The adapter emits `history.map(h => h.sd)` sorted by `t`, dropping samples
with no reading, so the value is a clean array of numbers the template hands straight to `spark()`.
The raw objects never reach the seed. Sorting rather than trusting the server's order is defensive —
the captured rows are already ordered, and staying ordered is what makes the line meaningful.

Worth the design seat's attention: **O6 is narrower than it looks.** The ledger says "trend history
does not exist server-side", but `/api/credits` returns a `history[]` of `{t, fh, sd, xu}` samples on
4 of the 5 captured rows. The sparkline may need no server rider at all, or a much smaller one than
the planned `L8s` slice assumes. L1 passes the history straight through and does nothing further.

### I-L1-10 — the v2 URL scheme follows the pack, not the plan's decision 3

**Serves:** `README.md` §Scope 2, ledger D20.

`plan.md` decision 3 rules "Landing on `/`, App on `/app`". `README.md` §Scope 2 instead specifies
`?view=land|app|deck` plus `#screen` hashes, defaulting to `app` inside `/v2/`, and puts the cut-over
and legacy redirects in **L11**. L1 implements the pack: the two are not in conflict, they are
different phases — `?view=` is how the shell selects a view while v2 lives beside the old UI at
`/v2/`, and L11 maps the final `/` and `/app` routes onto it. Recorded so L11 does not read the query
scheme as a contradiction of the ruling.

---

## L2 — app shell: sidebar · page header · right rail (Renate, `agent-v2-l2`, 2026-09-07)

Ledger rows D03, D04, D05 (+ D06 with L1). Every entry below is **live mode only**: under
`?fixture=1` the slice returns before it loads anything, so the mock renders untouched and the pixel
gate stays at 36/36, max 0.032948 %.

Screenshots are in `improvised/`, captured by
`docs/design/fleetdeck-v2/verify/l2-live/shots.mjs` against the API fixtures.

### I-L2-01 — the shell loads `data.js` itself; `index.html` does not list it

**Serves:** the whole slice (`README.md` §API "FD.data.sessions(), health(), credits()").

`public/v2/index.html` is generated by `tools/dc-compile.mjs` from the mock's `<helmet>` and lists
`runtime.js`, `fixture.js`, `logic.js`, `app.js` and the nine screen files. `data.js` and `router.js`
landed one slice later (L1) and are in no `<script>` tag. The shell may not edit `index.html`, so it
appends the tag itself, once, on a promise parked at `FD.__dataLoading` that any other slice can await.

Nothing is loaded in fixture mode — the check that decides is a four-line copy of
`FD.data.isFixture()` (`data.js:563`), because asking `FD.data` would mean loading `data.js` to find
out whether to load it, and that request would show up in the page the pixel gate captures.

**For the design seat:** the right fix is one `<script src="/v2/data.js">` in the compiler's head list,
which is S2's file, not L2's. Until then every slice that wants the data layer must do this.
Data-only entry; no screenshot.

### I-L2-02 — the mock's tokens are read back out of `renderVals()`

**Serves:** every improvised element below.

The theme table `t` is a local inside `AppLogic.renderVals()`; nothing exposes it. Improvised chrome
still has to be the mock's `ink45`, `bad`, `lineSoft` and not a second palette. The shell calls
`renderVals()` once per theme change and keeps the six tokens it needs, with the literal values as a
fallback if that call ever fails. No token is re-typed as a design decision; the fallbacks are quoted
from `logic.js` so a token change there is a one-line change here. Data-only entry.

### I-L2-03 — behaviour is attached by delegation on `data-dc-tpl`, never by editing the markup

**Serves:** §Scope 1, 2, 4; the pack rule "hooks are `data-*`/id only".

The compiled markup gives the shell's controls no handler at all: `Connect all` (`data-dc-tpl="217"`)
and `Refresh` (`241`) carry only a style, and a session row's only `onClick` is `A_goWindows` — the
same function the nav's Windows button uses, with no row argument. One delegated capture-phase listener
on `document` resolves the target by its `data-dc-tpl` id and adds today's behaviour. No class is
grafted onto mock markup and no compiled attribute is rewritten.

A row is resolved by **its position among the rows rendered at that moment**, looked up in the same
flat index the paint pass walks — never by state parked on the node. That is the oracle audit's ruling 1
(`audits/s2-shim-oracle-2026-09-08.md`, F1): positional `sc-for` rows are not stable identities.
Data-only entry.

### I-L2-04 — one ⤢ follows the hovered row, in a layer this slice owns

**Serves:** §Scope 1 ("`⤢` per row → `openMax`"), BEHAVIOUR §1. **Screenshot:** `l2-sidebar-rows.png`.

Today every sidebar row carries a ghost `⤢` (`app.js:851-857`); the mock's row is a dot and a name.
The first build appended a button per row. The oracle audit's binding ruling 1 forbids that — foreign
DOM inside a compiled node is deleted whenever that parent's child list changes (F3) and is stranded on
the wrong row when a poll reorders the list (F1).

So there is exactly **one** `⤢`, in `#fd-l2-layer` — a fixed, `pointer-events:none` layer on
`document.body`, outside `#dc-root` — positioned over whichever row the pointer is on and hidden when
that row scrolls out of its scroller. It inherits `ink60`, has no background and no border, and reads
as the mock's own ghost control. Nothing per row exists to go stale.

### I-L2-05 — the hidden-rows toggle is a strip at the foot of the sidebar list

**Serves:** §Scope 1 (`showHidden`, "improvise its place"), BEHAVIOUR §1. **Screenshot:** `l2-sidebar-rows.png`.

The mock has no hidden state at all. The toggle keeps its two texts verbatim — `show N hidden` and
`hide hidden` — the `showHidden` key and its `'1'`/`'0'` values, and re-runs `loadSessions()` on click,
exactly as `app.js:868-880`. It sits in the same owned layer, pinned to the bottom edge of the sidebar
scroller with the page's solid ground behind it and the mock's `lineSoft` rule above, at the sidebar's
own 11 px scale. Pinned rather than in-flow because the list is long and the toggle is a control, not
a row: a strip at the foot is reachable without scrolling 85 sessions.

### I-L2-06 — per-host errors and "no sessions" share that strip

**Serves:** BEHAVIOUR §1 (`errors[]`, `"no sessions"`). **Screenshots:** `l2-sidebar-errors.png`,
`l2-sidebar-no-sessions.png`.

Same strip, same placement, `bad` tone, one line per `errors[]` entry as `"<host>: <message>"`, and
`"no sessions"` when there are no live rows and no errors — never both, as today.

### I-L2-07 — a spent credit pool marks the value; the rail has no fourth cell

**Serves:** BEHAVIOUR §3 (`€` flag, row tooltip). **Screenshot:** `l2-right-rail.png`;
tooltips captured as text in `l2-account-tooltips.txt`.

The mock's rail row is a three-column grid: logo, name, value. Today's `€` flag (`app.js:163`) is a
fourth element, and ruling 1 forbids adding one. It therefore prefixes the value — `€71%`, `€—` — which
needs no node at all. **The colour is lost**: today the flag is `#f0836b`, here it inherits the value's
own tone. Recorded as a real, if small, loss.

The row tooltip is an attribute, not a node, so it is set as today builds it: identity, highest window,
credits used / limit, source (`app.js:145-152`).

### I-L2-08 — the Windows empty state, in the operator's new words

**Serves:** BEHAVIOUR §4, open item O1. **Screenshot:** `l2-windows-empty.png`.

The mock always draws four tiles and has no empty state. Today's copy is replaced per the operator's
ruling with one sentence, verbatim:

> There are no sessions yet, open a new session via an orchestrator first.

It has no button — the old `#empty-fleet` ("open the Registry") is gone with the copy. It lives in the
same owned layer, over the Windows screen's own column, in `ink45` at the mock's body scale, and shows
when the tile grid is empty. The count is read **off the DOM**, not off a fixture key, so it answers to
whatever L3 ends up feeding the grid.

### I-L2-09 — the "Boxes" rail splits today's pill into the mock's two columns

**Serves:** §Scope 3, BEHAVIOUR §2. **Screenshot:** `l2-right-rail.png`.

Today each health pill is one string, `"<host> · <state>"` (`app.js:112-129`). The mock's box row is a
dot, a monospace name and a right-aligned status. The host becomes the name and the state becomes the
status: same words, same order, same colour semantics, no sentence rewritten. The mock's two seed rows
are both green, so the `bad` tone (`HOLDER DOWN`, `unreachable`, `health unreachable`) is added to the
row mapping; `warn` and `good` are the mock's own.

### I-L2-10 — `—` for no usage, and a red bar past 90 %

**Serves:** BEHAVIOUR §3. **Screenshot:** `l2-right-rail.png`.

Two deliberate departures from the mock's rail, both because BEHAVIOUR is the spec for text and
thresholds and the mock is the look:

| | mock | live |
|---|---|---|
| no usage reported | `no data` | `—` (`app.js:161`) |
| pct > 90 | amber (the mock's rule stops at 70) | `bad` (`app.js:154`) |

Neither changes fixture mode: the mock's seed rows carry 80 and 71, which both rules render identically,
and its null rows still print `no data` because the value comes from the seed.

### I-L2-11 — the session dot carries state again

**Serves:** BEHAVIOUR §1. **Screenshot:** `l2-sidebar-rows.png`.

Every dot in the mock is green. Today's dot is muted by default, green when that session's tile is open
(`style.css:156`) and amber when the row is `kill-requested` (`style.css:287`). The live list maps them
to `ink35` / `good` / `warn`, with `kill-requested` winning over open, as today. Which tiles are open is
read from L3 through a guarded `FD.screens.windows.openKeys()`; with L3 absent every dot is idle.

### I-L2-12 — the sidebar always groups, even with one host

**Serves:** §Scope 1, ledger D03. **Screenshot:** `l2-sidebar-rows.png`.

Today a host divider appears only when more than one host is present (`app.js:842`). The mock's sidebar
is *built* out of box groups with a count chip, and D03 describes it that way. A single-host fleet
therefore still gets its one group header rather than a bare list. The rows themselves keep API order
and are never re-sorted, as today.

### I-L2-13 — the theme toggle keeps BEHAVIOUR's title, not the mock's

**Serves:** BEHAVIOUR §5, ledger D06.

The mock's sidebar control is an icon button titled `Toggle light / dark mode`, so the old
`"☀ Light"` / `"☾ Dark"` **label** has nowhere to go and is dropped. The **title** and `aria-pressed`
are today's, verbatim: `Switch to light theme` / `Switch to dark theme`. Both are attributes on the
compiled button, so no node is added.

The key migration is L1's `FD.data.theme()` (`fleetTheme` → `fd-landing-dark`), called once at boot. Two
details of today's resolution order that `theme()` does not cover are kept here: `?theme=light|dark`
still wins over storage, and with **neither** key set the OS preference decides
(`prefers-color-scheme`), where `theme()` alone would default to dark. `data-theme` and
`style.colorScheme` are still written onto `<html>`, as `syncTheme()` does today.

### I-L2-14 — the "Live API" pill carries the org source badge

**Serves:** open item O4, §Scope 4. **Screenshot:** `l2-page-header.png`.

Ruling O4 folds the org chart's live/fixture/pending badge into the page-header pill. `FD.shell.setLiveApi(text)`
writes that text; passing `null` restores `Live API`. The pill's text is a static text node in the
compiled render, which the runtime rewrites on every flush, so the shell re-applies it straight after
each render — in the same task, before paint.

### I-L2-15 — four BEHAVIOUR §4 items have no counterpart in the mock, and are not built

**Serves:** BEHAVIOUR §4.

| Today | Why there is nothing to port |
|---|---|
| `#drawer-close`, outside-click closes the drawer | the mock has no drawer; the sidebar is permanent and collapsible (D03) |
| Escape closes fleet / org / bus | those three overlays became nav **screens**; there is nothing to close. `AppLogic` already binds Escape for the full-screen terminal, the terminal menu and the maximised bus |
| `#empty-fleet` → open the Registry | removed with the copy it belonged to (I-L2-08) |
| the `.sel` / `aria-selected` bookkeeping of `sync()` | the mock's `navBtn(screen === …)` already does it, per render |

Recorded rather than silently dropped, so a reviewer can overrule any of the four.
