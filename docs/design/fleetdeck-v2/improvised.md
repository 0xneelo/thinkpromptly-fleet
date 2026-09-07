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

## L5 — org chart on live seats + sessions (Dietlind, `agent-v2-l5`, 2026-09-07)

Ledger row **D11**. Owned files: `public/v2/screens/org.js` and the org methods in
`public/v2/logic.js`. Screenshots referenced below are in
`docs/design/fleetdeck-v2/improvised/`, captured by
`docs/design/fleetdeck-v2/verify/l5-live/shots.mjs` against the stubbed API.

### I-L5-01 — the screen loads `data.js` and `orgchart.js` itself

**Serves:** the whole slice. **Data-only, no screenshot.**

`public/v2/index.html` (S2's file) loads `runtime.js`, `fixture.js`, `logic.js`, `app.js` and the
nine `screens/*.js`. It does **not** load L1's `public/v2/data.js` or `public/v2/orgchart.js`, so
`FD.data` and `FleetOrgChart` are both `undefined` when a screen runs. The first live load failed
with `Cannot read properties of undefined (reading 'sessions')`.

`index.html` is the shell's file and not ours to edit, so `org.js` appends the two `<script>` tags
itself, once, guarded on the globals already existing and marked `data-fd-dep` so a second screen
reuses the same tag rather than adding another. `async = false` keeps `orgchart.js` before
`data.js`.

This is a **shell gap, not an org gap** — every L2–L10 slice needs `FD.data`. The right fix is two
lines in `index.html`, which the shell owner should make; until then each screen pays for itself.
Filed for the design seat.

### I-L5-02 — the kids grid is one level, so a deeper subtree is flattened depth-first

**Serves:** D11 ("kids grid ⇄ nested `.org-level` tree"). **Screenshot:** `l5-spine-and-kids.png`.

Today's org chart is a `<ul>` tree of arbitrary depth. The mock's kids grid is a single CSS grid row
with one horizontal connector — it has no affordance for a second level, and inventing one would be
hand-typed markup.

`org.js` therefore flattens each seat root's subtree **depth-first**, so a child immediately follows
its parent, and preserves `childSort` within each level by walking `buildTree`'s already-sorted
output without re-sorting. In the screenshot `Machtild` (a child of `Dietlind`) sits between
`Dietlind` and `Juergen` for exactly this reason.

**What is lost:** depth. A grandchild is visually indistinguishable from a child; only the
`host / name` line hints at the relationship. Recorded for the design seat as a real gap in the
mock — the org chart's whole point is hierarchy, and the mock's attached view shows two levels
(spine, kids) where the data has N.

### I-L5-03 — one badge slot, precedence tombstone > pinger > idle

**Serves:** BEHAVIOUR §3, §4. **Screenshot:** `l5-unattached-badges.png`.

Today's card can show three badges at once: `pinger` (blue), `idle 15m+` (amber) and `🪦 close me`
(tombstone). The mock's unattached card has exactly **one** badge slot, always filled with
`idle 15m+`.

Decision: one badge, precedence **tombstone > pinger > idle**, most-actionable first — a stale Mac
row needs closing whatever else is true of it, and a dead pinger outranks mere idleness. The verbatim
`title` from today's app rides on the badge, so the full text is still reachable on hover. A row that
earns no badge **hides** the pill (`display:none`) rather than showing an empty chip; the mock never
renders an empty one because its sample data always has a badge.

The mock's chip style uppercases its text — `🪦 close me` renders as `🪦 CLOSE ME`. The string is
verbatim; the casing is the mock's look, applied unchanged.

**Not wired:** the tombstone badge is a `<span>` in the mock, exactly as it is a `<span>` in today's
app (`app.js:287`), so it is a marker and not a button in either. No behaviour was dropped.

### I-L5-04 — the stats row is written imperatively, because the mock bound no identifier

**Serves:** D11 ("stats `N sessions · N seats` ⇄ `#org-status` text"), README §Scope 1.
**Screenshot:** `l5-spine-and-kids.png` (`11 sessions · 4 seats · 5 attached · 6 unattached`).

The mock bakes the four numbers into the compiled template as **plain text nodes** —
`t(k+"|561","102")`, `"2"`, `"4"`, `"96"` in `app.js`, from `template.dc.html:253-256`. There is no
`A_` identifier to feed and no `FD.fixture` key behind them, and neither `app.js` nor the template is
ours to edit. `diff.md` and `decisions.md` carry no rule for this case (checked: the only
mock-literal note is the SSH-key type at `diff.md:61`), so it is decided here.

`org.js` writes the four numbers with `textContent` after each publish, addressing them positionally
from `[data-screen-label="Org chart"]`'s first child row — no new elements, no classes, no markup.
The write survives the next render by the shim's own documented rule: `syncChildren()` returns early
when the child *set* is unchanged, which is what already lets the deck's imperative `splitWords()`
edits survive (`runtime.js`, `syncChildren` comment).

**It never runs in `?fixture=1`**, so the pixel gate sees the mock's own `102 / 2 / 4 / 96`. Proven
both ways: the gate is 0.000000 % on the org chart in both themes, and live check `G2` asserts the
literals are still there in fixture mode.

The clean fix is four `{{ }}` bindings in the template. Filed for the design seat.

### I-L5-05 — an absent expiry reads `none`, not `expired 20703d 0h ago`

**Serves:** BEHAVIOUR §4. **Data-only, no screenshot.**

`expiryText` today is `const stamp = Number(epoch); if (!Number.isFinite(stamp)) return 'none'`
(`app.js:230-235`). `Number(null)` is `0`, which *is* finite — and `buildTree`'s `copyShape` turns a
missing field into `null`, never `undefined`. So a row with no `expires_at` renders
`expired 20703d 0h ago` today. It is not hypothetical: **4 of the 114 captured rows** in
`fixtures/api/sessions.json` have `expires_at: null`.

BEHAVIOUR §4 states the contract as `'none' | '<d> left' | 'expired <d> ago'`, and the pack makes
BEHAVIOUR the spec. L5 follows the spec: `null`, `undefined` and `''` all give `'none'`. This is a
**deliberate divergence from today's rendered output** — the only one in the slice — and it fixes a
visible nonsense string rather than porting it. `test/v2-org.test.js` pins the new behaviour.

### I-L5-06 — today's state hexes map onto the mock's theme tokens

**Serves:** BEHAVIOUR §3. **Screenshot:** `l5-spine-and-kids.png`, `l5-unattached-badges.png`.

BEHAVIOUR §3 gives today's literal CSS colours: `#43b779` active, `#e4a354` suspect, `#777570`
reaped/offline/tombstone. Those are the old stylesheet's; the mock is the look, and its tokens are
theme-dependent (`t.good`, `t.warn`, `t.ink35`, each different in dark and light).

Mapping: `active → t.good`, `suspect → t.warn`, `reaped | offline | tombstone → t.ink35`, and a
vacant or conflicting seat gets the **hollow** dot the mock already uses for its own fenced
orchestrator card. Hard-coding the hexes would have failed the light-theme half of the pixel gate.

`org.js` emits tone *names* and `logic.js` resolves them against `t` at render time — the layer split
L1 recorded as I-L1-01, so a row adapted in dark renders correctly in light.

**Not carried over:** today's `opacity: .62` on reaped rows and the pulsing shadow on suspect ones.
Both are stylesheet effects on `.state-*` classes; the mock has no equivalent and grafting classes
onto mock markup is forbidden. The state is still legible from the dot colour and the `lease` fact.

### I-L5-07 — the error state lives in a spine card, in the mock's tokens

**Serves:** BEHAVIOUR §5, ruling O4. **Screenshot:** `l5-error-state.png`.

Today's error path writes into `#org-status` and drops a three-part empty state into `#org-tree`:
a bold sentence, a plain sentence, and an `Open fixture preview` link to `/?orgFixture=1`. The mock
has no status element and no empty state at all.

Decision: render one spine card — the only card shape the mock gives that carries a title, a
subtitle, a mono line and a two-column footer — and put the four texts in it verbatim:

| Slot | Text |
|---|---|
| title | `The frozen seat endpoint is not available on this branch.` |
| subtitle | `Use the committed contract fixture to review this UI.` |
| mono path | `/?orgFixture=1` |
| footer left | `Org chart unavailable: <message>` |
| footer right | `integration pending`, in `t.bad` |

**What is lost:** `Open fixture preview` is a link today and is plain text here — the mock's only
in-card affordance is a button whose label `Send a message` is hard-coded in the markup, so it cannot
be relabelled without editing the template. The URL is shown so the destination is still reachable by
hand. Filed for the design seat.

The source badge itself is folded into the header "Live API" pill through `FD.shell.setLiveApi`
(**ruling O4**), with the three verbatim texts `M11 fixture` / `live API` / `integration pending`.
L2 owns that pill and has not landed, so the call is guarded and currently a no-op; live checks
`D5`, `E7` and `X2` assert L5 makes it with the right text.

### I-L5-08 — vacant and conflicting seats, and the fixture-only epoch badge

**Serves:** BEHAVIOUR §4, D11. **Screenshot:** `l5-spine-and-kids.png` (the `auditor` and `reviewer`
cards).

The mock's spine has three cards and no vacant-seat shape. A `seat-vacant` node renders as a spine
card with: the seat name as title, the verbatim reason as subtitle (`No current owner row` or
`Owner row already holds another seat`), the `C`/`O` mark plus `owner_host / owner_name` on the mono
line, `vacant` and the expiry countdown in the footer, and the hollow dot. No `Send a message`
button, because there is no session to message.

`epoch` is **withheld on the wire** (`server.js:2757`), so the tag slot shows `#<epoch>` only when the
seat actually carries one — the M11 fixture does, `/api/seats` does not — and falls back to the seat
name. That reproduces today's rule (`app.js:264,327`) without a fixture-only branch.

### I-L5-09 — the unattached grid is not scope-filtered

**Serves:** D11 ("keep count semantics"). **Screenshot:** `l5-unattached-badges.png`.

The sort and scope controls sit **inside** the mock's attached tab (`template.dc.html:257-266`), so
there is no scope control while the unattached grid is on screen. Filtering that grid by the scope
last chosen on the other tab produced a grid of 4 cards under a tab reading `6 unattached` — the view
contradicting its own count.

Decision: the scope filters the **kids grid only**. The unattached grid is fleet-wide, which also
matches today's `<details>` strip, which lists every orphan. Live check `S5` asserts the grid length
equals the tab count.

### I-L5-10 — "Send a message" falls back to the mock's own behaviour until L6 lands

**Serves:** README §Scope 3, ruling O8. **Data-only, no screenshot.**

The button calls `FD.screens.bus.open({type:'tmux', host, session})` — ruling O8's deep-link. L6 owns
the bus and has not landed, so the hook is guarded; when it is absent the button keeps the mock's own
action (`setState({screen:'bus', busActive:'desktop'})`) rather than doing nothing. A dead button
would read as a bug during the parallel build. Live checks `B1`/`B2` assert the payload against a
probe standing in for L6.

### I-L5-11 — loading and empty states are spine cards

**Serves:** BEHAVIOUR §5. **Screenshot:** `l5-empty-state.png`.

Same reasoning as I-L5-07: the mock has no loading or empty state, and the spine card is its
general-purpose card. Loading shows `Loading live seats and sessions…` or `Loading M11 fixture…`
verbatim, chosen by `?orgFixture=1`; an empty fleet shows `No seats or sessions to map.` verbatim
under the scope head card. Both use the hollow dot, which reads as "nothing here" rather than a
state colour that would be a lie.

### I-L5-12 — live data makes the spine taller than the mock's three cards

**Serves:** D11. **Screenshot:** `l5-spine-and-kids.png`. **No decision to make, recorded so the
design seat sees it.**

The mock's spine is exactly three cards (scope → coordinator → orchestrator) and the kids grid sits
just below the fold at 1440×900. Live data has as many spine cards as there are seats plus the scope
head — the crafted topology has five — which pushes the kids grid off the first screen. Nothing in
L5 can fix that inside the mock's markup; the design seat may want a denser seat card or a
horizontal seat row.
