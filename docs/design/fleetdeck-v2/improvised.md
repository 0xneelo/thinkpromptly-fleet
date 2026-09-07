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

## L10 — Desktop sessions (Clodwig, `agent-v2-l10`, 2026-09-07)

Ledger row D17. The mock's Desktop sessions screen is `mock/Fleetdeck Final.dc.html` → compiled to
`public/v2/template.dc.html` L669-734. Every entry below exists because that markup cannot express
something `BEHAVIOUR.md` requires, and the template is not L10's file to edit.

**One rule governs all of them:** the improvisation is applied imperatively from
`public/v2/screens/desktop.js`, in **live mode only**. In fixture mode (`?fixture=1`) the screen file
returns before it wires anything, so the compiled logic renders `FD.fixture` exactly as the mock does
and the pixel gate stays at 36/36 — verified, `verify/l10/report.json`, desktop-sessions 0.000000 % in
both themes. Hooks placed on mock markup are `data-fd-l10="…"` attributes only; no class is ever
grafted on, and no markup is hand-typed into the template.

### I-L10-01 — The four filter selects are inert in the mock, so they are wired from the screen file

**Serves:** `README.md` §Scope 1, `BEHAVIOUR.md` §2, ledger D17.

`template.dc.html:673-676` holds four `<select>` elements whose `<option>`s are hard-coded to the
mock's own seed people and machines (`All accounts / Aylin Yeter / Daniel Tabor`,
`All machines / MacBook Pro / german-box`, `Any live status / Live only / Offline only`,
`All sessions / Active / Archived`) and which carry **no `onChange` binding at all** — only
`style="{{ A_selectStyle }}"`. Nothing in `renderVals()` can reach them: adding keys to logic.js would
have nothing to read them.

**Decision.** `desktop.js` tags the four selects `data-fd-l10="filter-account|filter-machine|filter-live|filter-archived"`,
rebuilds their options from the live payload, and attaches one `change` listener each. Filter state
lives in the screen file, and the screen file **pre-filters the array it pushes through
`FD.setData('dsData', …)`**; logic.js keeps only the search filter it already had. The five controls
therefore AND-combine exactly as `sessions.js:84-92` does today.

**Why pre-filter rather than filter in logic.js.** The selects cannot reach logic.js in the first
place, so their state has to live in the screen file; putting the *predicate* there too keeps one
owner for one behaviour instead of splitting it across two files that different slices own.

The option texts are today's verbatim: `All accounts`, `All machines`,
`Any live status / Live / Offline / Unknown`, `All sessions / Not archived / Archived`. Account
options are labelled `<group label> · <accountUuid first 8>` and sorted by that label; machine options
follow `machines[]` order unsorted, as `sessions.js:80-81` does. A selection whose option has
disappeared from a later collection keeps a synthetic option reading exactly
`Previously selected (unavailable)`, so the filter stays visible instead of silently resetting.

### I-L10-02 — `Archived` and `Cached` chips are appended; the mock's status cell has one pill slot

**Serves:** `BEHAVIOUR.md` §3 state chips.

The status cell is `<span style="display:flex;"><span style="{{ r.pillStyle }}">…{{ r.status }}</span></span>`
(`template.dc.html:709`) — exactly one pill. Today's app shows up to three: the live chip, plus
`Archived`, plus `Cached` when the row is stale.

**Decision.** The live chip stays the template's own (its text now comes from `liveState`, so it reads
`Live` / `Live unknown` / `Offline` — that part is a logic.js change, not an improvisation). The
screen file appends the extra chips into the same cell, cloning the live pill's computed style so they
match the mock's pill tokens in both themes rather than hard-coding colours.

### I-L10-03 — `Show` expands the row's own details and scrolls to it

**Serves:** `README.md` §Scope 3 ("expand + scroll, or a transcript reader — pick, document").

Today's app has no Show action; the mock has an eye button (`template.dc.html:712`) pointing at
nothing. The pack offers two shapes.

**Decision: expand + scroll.** Show ensures the row's details panel is open (it *expands*, it never
collapses — that is what distinguishes it from clicking the row, which toggles) and scrolls it into
view with `block: 'nearest'`.

**Why not the transcript reader.** A reader panel is new surface the mock never drew, so its whole
appearance would be invented, and it would duplicate Copy conversation's transcript fetch for a
screen whose job is *finding* a conversation and reaching the session. Expand + scroll reuses the
mock's own `<sc-if value="{{ r.open }}">` panel, so nothing visual is invented at all.

### I-L10-04 — The copy label cycle needs a label; the mock's copy buttons are icon-only

**Serves:** `BEHAVIOUR.md` §3 copy conversation.

Today the button *is* the label: `Copy conversation → Copying… → Copied | Copy failed | No transcript`,
reverting after 1500 ms (`sessions.js:204-220`). The mock replaced it with two icon buttons
(`template.dc.html:714-715`) that have no text node to cycle.

**Decision.** The cycling text appears in a small pill injected next to the button, in the mock's
neutral chip tokens, and is mirrored into the button's `title` for screen readers and hover. The pill
is removed when the cycle ends, so the resting state is the mock's own. The four strings and the
1500 ms timer are verbatim; `No transcript` is used only when the copy did not succeed *and* the
transcript request answered 404, exactly as today.

### I-L10-05 — The count line is rebuilt; the mock hard-codes "collected 4m ago"

**Serves:** `BEHAVIOUR.md` §2 count and last-collection line.

`template.dc.html:677` reads `{{ A_dsCount }} sessions · {{ A_dsLive }} live · collected 4m ago`. The
separator text and the collection age are **literals in the template**, so no value logic.js can
supply produces today's two strings.

**Decision.** The screen file rewrites that span's text to `<shown> of <total> sessions · <live> live`
and appends a second span, in the same muted style, reading `Last collection: <age>` or
`No completed collection`. On a first-load failure the first span reads exactly `Sessions unavailable`.

### I-L10-06 — Machine notes, empty states and the error banner have no markup at all

**Serves:** `BEHAVIOUR.md` §5.

The mock draws no equivalent of `#sessions-errors` or the empty-state block. All nine texts are
required verbatim.

**Decision.** One panel is injected directly under the filter row, built by cloning the computed
style of a live group card so the mock's panel tokens (radius, border, backdrop blur, panel
background) come out right in both themes without being re-typed. It carries the per-machine notes —
one per machine whose `state !== 'ok'` or which is stale, `label + ': ' + text`, with `no_report`,
`not_found`, `unavailable`, `partial` and the `Cached metadata. Refresh to collect the latest
sessions.` fallback — the refresh-failure note, and the empty state.

### I-L10-07 — A Refresh control, because the mock only drew Reset

**Serves:** `BEHAVIOUR.md` §5 (`#sessions-refresh` → `load(true)`).

The filter row ends with a Reset button (`template.dc.html:678`) and nothing else; the 300 s TTL means
a user who wants fresh data has no way to ask for it.

**Decision.** A `Refresh` button is inserted immediately before Reset, cloning Reset's own computed
style so it is visually indistinguishable from a button the mock drew. While a forced collection is in
flight it reads `Collecting…` and is disabled — today's exact pair.

### I-L10-08 — "Live now" pinned first is the mock's invention, and it is kept

**Serves:** `README.md` §Scope 2, ledger D17. Data-only; no screenshot.

Today's app has **no** "Live now" group (`BEHAVIOUR.md` §1 says so explicitly). The mock introduces
one, pinned above the per-person groups, holding every live row with a `<person> · <machine>` locator.

**Decision.** Keep it, and let `logic.js` keep building it from the rows' `live` flags, which is what
the compiled mock already does. `FD.data.toDesktop` *also* prepends a `Live now` head group of its
own; the screen file drops that one before pushing, or the screen would render two.

### I-L10-09 — Message opens the bus thread; the page composer is not ported

**Serves:** ruling O8 (`diff.md:77`), `BEHAVIOUR.md` §4. Behavioural; no screenshot of its own.

`BEHAVIOUR.md` §4 describes a page-level composer (`#session-composer`, `#composer-*`) that POSTs
`{source:'desktop-sessions-page', target, text}` to `/api/messages`. Ruling O8 replaces it: "yes,
deep-link into the bus thread".

**Decision.** Message calls `FD.screens.bus.open(messageTarget)`, guarded, and L10 ports **no**
composer, no `POST /api/messages`, and none of the composer's six strings. They are recorded as
`n.a. — superseded by O8` in `REPORT.md`'s behaviour checklist rather than silently dropped. Until L6
lands the guarded call returns false and the click falls back to `FD.router.navigate('bus')`, also
guarded, so the row still goes somewhere sensible.
