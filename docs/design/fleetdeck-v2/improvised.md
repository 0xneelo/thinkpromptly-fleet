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

## L9 — Machines cards (Eckbert, `agent-v2-l9`, 2026-09-07)

Ledger row **D16**. Spec: `docs/goals/fd-v2-l9/BEHAVIOUR.md`, i.e. `public/machines.js` as it ships
today. Every entry below is something the mock leaves open, and every one is live-mode only —
fixture mode renders the mock's seed untouched and the pixel gate is 36/36 at 0.000000 % on both
Machines shots (`verify/l9/report.json`).

### I-L9-01 — `reported <ago>` is written into the slot the template hard-codes

**Serves:** `README.md` §Scope 1 ("reported <ago>"), BEHAVIOUR §2 (`machineCell`, `machines.js:187`).
**Screenshot:** `improvised/l9-reported-ago.png`.

The mock's card header ends with a fixed string, not a binding:

```js
h("span", { key: k1+"|1422", "data-dc-tpl": "618", style: a337(v1) },
  t(k1+"|1423", "reported just now"))          // app.js:2422-2424
```

There is no `{{ m.reported }}`. The compiled `app.js` and `template.dc.html` are out of this slice's
scope, so the value cannot arrive through the data seam. On a monitoring screen the string is not
cosmetic: leaving it would tell the operator a machine that last called in nine days ago reported
just now.

**Decision.** The screen finishes its own render. `FD.screens.machines.afterRender()` runs from
`AppLogic`'s `componentDidMount`/`componentDidUpdate` and writes the real
`'reported ' + ago(m.reported_at)` into that same span, found by the compiled template's own
`data-dc-tpl` id — a `data-*` hook, never a class grafted onto mock markup. No node is created and
no markup is typed.

**Why this is stable, not a race.** `runtime.js`'s `t()` rewrites a keyed text node whenever its
data differs from the compiled literal, so a one-shot patch would be undone on the next flush.
`flush()` runs `syncChildren` → `sweep` → refs → `componentDidUpdate` in one synchronous pass, so
re-applying from the lifecycle hook lands after the runtime every time and the mock's string never
reaches a paint. This is the same escape hatch `runtime.js` documents for the deck's `splitWords()`
edits.

**Follow-up for the design seat:** binding this span to `{{ m.reported }}` in the mock would delete
this entry outright. Filed as a ledger note on D16, not fixed here — the mock is not this slice's.

### I-L9-02 — Open in Registry filters by host; the header Refresh button gets its click

**Serves:** `README.md` §Scope 1 and 2. **Screenshot:** `improvised/l9-open-in-registry.png`.

Two header controls the mock draws but never wires.

`Open in Registry` is bound to `m.openRegistry`, which in the mock only switches screens. It now
calls the L4 hook, guarded, and keeps the mock's own switch as the fallback until L4 defines it:

```js
const q = mach.host || mach.name;
if (FD.screens && FD.screens.registry && typeof FD.screens.registry.open === 'function') { FD.screens.registry.open({ q }); return; }
this.setState({ screen: 'registry' });
```

`m.host` is the deck join key and is `null` for a machine absent from `hosts.json`, so the machine's
own name is the fallback filter. The button only appears when the card has sessions, which is the
mock's condition and matches today's screen, where a machine with no sessions has nothing to look up.

The header `Refresh` button (`data-dc-tpl="241"`) carries **no** `onClick` in the compiled template,
on any screen. BEHAVIOUR §3 requires a forcing refresh, so this screen attaches its own listener in
`afterRender`. Because the template never sets that prop, the runtime never removes the listener and
the node is reused by key, so it binds once. It is inert on every other screen: the handler returns
early unless the Machines block is in the DOM. If the shell later claims that button, this listener
should be deleted in favour of the shell's hook — noted for L2/L11.

### I-L9-03 — live cards default to expanded

**Serves:** `README.md` §Scope 2 ("default expanded (improvise + document)").
**Screenshot:** `improvised/l9-default-expanded.png`.

Today's Machines page is a table with every fact visible at once; the mock's cards start collapsed,
showing one summary line per row. Opening six cards by hand to see what the old page showed on load
would be a regression in a screen whose whole job is a fleet-wide glance.

**Decision.** On live data a card is open unless the operator has closed it; the fixture's seed
keeps the mock's collapsed cards, so the pixel gate is unmoved.

```js
const open = mOpen[idx] === undefined ? !!mLive : !!mOpen[idx];
```

`mOpen[idx]` is only ever set by a click, so the first click on a live card closes it and the
mock's collapsed look is one click away. No new state key and no storage: today's screen has no
`localStorage` at all (BEHAVIOUR §3) and this adds none.

### I-L9-04 — the machine-level facts lead the card as one status cell

**Serves:** `README.md` §Scope 1 (the push line and its copyable command), §Scope 2 (error text
placement). **Screenshot:** `improvised/l9-machine-status-row.png`.

`machineCell` (`machines.js:181-186`) has three machine-level branches — `m.error`, the push
machine's `no report yet — cron this on that machine:` with its copyable command, and a plain
`no report yet`. The mock's card is a header plus a grid of *client* rows and has no slot for any
of them; a `no_report` machine reports no clients at all, so its card body would otherwise be empty.

**Decision.** They become the first cell of the grid, in the row shape the mock already draws:
`env` carries the one improvised label `Status`, `primary` carries the text verbatim, and the push
command rides in the row's note. Error text is toned with the mock's own `t.bad`, as its `.err`
class is today. The command keeps today's click-to-copy and its `title="click to copy"`, attached
in `afterRender` — the mock's note is a plain `<p>` with no click binding, and copying a cron line
by hand off a screen is exactly the friction the affordance exists to remove.

### I-L9-05 — one note per row: the joined line, and where a reset time goes

**Serves:** BEHAVIOUR §2 (freshness, `shares`, `note`, the sampled-age line, session attribution)
and §2 (usage bar tails). **Screenshot:** `improvised/l9-note-joined.png`.

Today's client cell stacks up to five separate lines under the chips. The mock's row has exactly one
`note`. Its own seed shows how it handles that — it joins with ` · `
(`'token valid in 6 h · 65 sessions run as Daniel Tabor'`), so this screen joins the same way, in
today's DOM order: freshness, `same login as CLI`, the client's own note, `no usage data` /
`no usage windows reported`, the reset times, the sampled-age line, then the session attribution.

The reset time is the one that needed a decision. Today each bar carries its own tail
(`resets in 3h 20m · stale`); the mock's machine bar row is a three-column grid of label, track and
right cell with no tail slot, and `stale` already occupies the right cell. Dropping the reset times
would lose a real fact, and the mock's seed puts one in the note. With up to three windows on a row,
an unlabelled `resets in 3h 20m` would be ambiguous, so each is named: `5 hour resets in 2h 10m`.
The `bar()` helper's `resets` argument is populated too, so binding it in the template later would
need no data change.

### I-L9-06 — the fetch error is a card with only a title

**Serves:** `README.md` §Scope 2 ("error text"), BEHAVIOUR §3.
**Screenshot:** `improvised/l9-error-card.png`.

`load()`'s catch (`machines.js:223-224`) replaces the whole table with one `.err` div reading
`cannot reach fleetdeck`. The mock has no empty state for this screen.

**Decision.** The list becomes a single card whose name is that string verbatim, with no rows —
in the mock's panel style, and it replaces the machines rather than sitting beside stale ones,
which is what today's screen does. The card's kind chip is empty, and an empty chip is still a
bordered pill, so `afterRender` hides it. Recovery is automatic: the next 60 s poll that succeeds
puts the machines back.

### I-L9-07 — the per-session lines are not ported; the count chip and Open in Registry replace them

**Serves:** ledger D16, BEHAVIOUR §2 (`.sess` lines). Data-only decision, no screenshot.

Today's machine cell prints one line per session, `[name, worker, role||label, status].join(' · ')`.
For german-box that is 77 lines inside one table cell. D16 and `README.md` §Scope 1 both describe
the mock's header as a session-*count* chip plus `Open in Registry` — the mock deliberately moved
the list to the Registry screen, which is the screen that exists to show it.

**Decision.** Follow the mock: the count chip states how many, the button goes and shows them,
filtered to the host. Recorded because it is the one BEHAVIOUR §2 item this slice does not render;
`REPORT.md` marks it *partial, by design*. If the design seat wants the lines back, they belong in a
collapsed sub-list, not in the card header.

### I-L9-08 — `collecting` / `collect_started_at` stay unrendered

**Serves:** `README.md` §Scope 2 ("collecting indicator (decide; today none)"). Data-only decision.

`/api/machines` returns both, and BEHAVIOUR §3 records that today's screen renders neither.
A sweep is bounded by the deck's own 300 s TTL and the rows on screen stay readable throughout, so
an indicator would flicker on a poll without telling the operator anything actionable.

**Decision.** Not rendered, matching today exactly. The fields reach the screen and are one line
away if the design seat wants a spinner later.

### I-L9-09 — the data seam is `machinesLive`, and `FD.data.toMachines` is thinner than BEHAVIOUR

**Serves:** `README.md` §Cross-slice contract. Data-only decision.

Two things the pack's data path did not anticipate.

**The key.** `README.md` names the identifier `machines`, but S2 could not byte-safely substitute
the mock's `machines` literal (it calls the theme helper `mSec()` and its anchor is ambiguous), so
there is no `FD.fixture.machines` to overwrite. Per the DESIGN-35 broadcast of 2026-09-07 this slice
publishes its own key instead — `FD.setData('machinesLive', cards)` — and `logic.js` falls back to
the mock's seed when it is absent. That is what keeps fixture mode byte-identical.

**The adapter.** `FD.data.toMachines()` (L1) supplies the card list, its names and the
group-by-client structure, and this screen uses it for exactly that. It does not carry BEHAVIOUR's
wording for the rest, so those are computed in the screen, where `improvised.md` I-L1-01 already
puts the presentation layer:

| BEHAVIOUR §2 | `toMachines` today | This screen |
|---|---|---|
| `kind` chip: `ssh <ssh>` for an ssh route | `m.os + ' · ' + m.route` — the alias is dropped | `windows+wsl · ssh gb-deploy` |
| session chip pluralises | always `N sessions` | `1 session` / `N sessions` |
| `PROOF.profile` → `token-proved` | `profile` → `profile only`, `warn` | today's map wins |
| `STATE` chips (`token expired`, `busy (429)`, `signed out`, `api key`, `never used`, `read failed`) | not emitted at all | emitted |
| plan `business` is suppressed | emitted | suppressed |
| windows sorted by `WIN_ORDER`, unknown ones after by name | raw `Object.keys` order | sorted |
| freshness, `shares`, sampled age, session attribution | only `c.note` or a bare sampled age | full note |
| `m.error`, `m.state`, `reported_at`, `push_url`, `m.host` | not carried | carried |

None of this is a defect in L1 — it emits the fields `diff.md` §"Binding map" names. It is recorded
so the next screen author does not assume an adapter is a complete port of its screen, and so the
design seat can decide whether these belong in `data.js` instead. **This slice does not edit
`data.js`.**
## L10 — Desktop sessions (Clodwig, `agent-v2-l10`, 2026-09-07)

Ledger row D17. The mock's Desktop sessions screen is `mock/Fleetdeck Final.dc.html` → compiled to
`public/v2/template.dc.html` L669-734. Every entry below exists because that markup cannot express
something `BEHAVIOUR.md` requires, and the template is not L10's file to edit.

**One rule governs all of them:** the improvisation is applied imperatively from
`public/v2/screens/desktop.js`, in **live mode only**. In fixture mode (`?fixture=1`) the screen file
returns before it wires anything, so `FD.screens.desktop` is not even defined there and the compiled
logic renders `FD.fixture` exactly as the mock does. The pixel gate stays at 36/36 — verified,
`verify/l10/report.json`, desktop-sessions 0.000000 % in both themes. Hooks placed on mock markup are `data-fd-l10="…"` attributes only; no class is ever
grafted on, and no markup is hand-typed into the template.

### After S2.2 — where the injected nodes now stand

S2.2 closed the runtime audit's F3 with `data-dc-raw`: an element carrying it owns its own children,
and the reconciler neither inserts nor removes inside it. L10 takes that offer in the one place it
fits — the **filter row**, whose template children are static — so **I-L10-05** (count line) and
**I-L10-07** (Refresh) are now sanctioned foreign children rather than tolerated ones.

The **screen root** deliberately does not get the marker: its children are the group cards, which must
keep reconciling as filters change their number, so **I-L10-06** (the notes panel) still depends on
being re-derived every `apply()`. **I-L10-02** (chips) and **I-L10-04** (copy label) sit inside a
positional `sc-for`; S2.2 also added `key="{{ }}"` support, but the key has to be written into
`template.dc.html`, which is not this slice's file. Their mitigations therefore stand as built: chips
are reconciled from data on every pass, and the copy label lives in a Map keyed by session id rather
than in the DOM, so a positional reuse cannot strand it on the wrong session. Tracked as DECK-78.

Every injected node — **its styles included** — is re-derived on each `apply()`. That is not only the
F3/F1 mitigation: injected nodes originally copied their theme tokens once at creation, and a
light/dark toggle left the Refresh button, the collected line, the notes and the chips near-invisible
on the previous theme. The live proof's `theme-resync` check is the regression guard.

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

![the filter row with the selects carrying live values](improvised/l10-filters.png)

### I-L10-02 — `Archived` and `Cached` chips are appended; the mock's status cell has one pill slot

**Serves:** `BEHAVIOUR.md` §3 state chips.

The status cell is `<span style="display:flex;"><span style="{{ r.pillStyle }}">…{{ r.status }}</span></span>`
(`template.dc.html:709`) — exactly one pill. Today's app shows up to three: the live chip, plus
`Archived`, plus `Cached` when the row is stale.

**Decision.** The live chip stays the template's own (its text now comes from `liveState`, so it reads
`Live` / `Live unknown` / `Offline` — that part is a logic.js change, not an improvisation). The
screen file appends the extra chips into the same cell, cloning the live pill's computed style so they
match the mock's pill tokens in both themes rather than hard-coding colours.

![Cached and Archived beside the template’s own Offline pill](improvised/l10-chips.png)

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

![a row after Show — details expanded and scrolled to](improvised/l10-show.png)

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

![the transient copy label, inside its 1500 ms window](improvised/l10-copy-label.png)

### I-L10-05 — The count line is rebuilt; the mock hard-codes "collected 4m ago"

**Serves:** `BEHAVIOUR.md` §2 count and last-collection line.

`template.dc.html:677` reads `{{ A_dsCount }} sessions · {{ A_dsLive }} live · collected 4m ago`. The
separator text and the collection age are **literals in the template**, so no value logic.js can
supply produces today's two strings.

**Decision.** The screen file rewrites that span's text to `<shown> of <total> sessions · <live> live`
and appends a second span, in the same muted style, reading `Last collection: <age>` or
`No completed collection`. On a first-load failure the first span reads exactly `Sessions unavailable`.

![the rebuilt count and last-collection line](improvised/l10-count.png)

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

![the machine-notes panel, all five texts](improvised/l10-notes.png)

### I-L10-07 — A Refresh control, because the mock only drew Reset

**Serves:** `BEHAVIOUR.md` §5 (`#sessions-refresh` → `load(true)`).

The filter row ends with a Reset button (`template.dc.html:678`) and nothing else; the 300 s TTL means
a user who wants fresh data has no way to ask for it.

**Decision.** A `Refresh` button is inserted immediately before Reset, cloning Reset's own computed
style so it is visually indistinguishable from a button the mock drew. While a forced collection is in
flight it reads `Collecting…` and is disabled — today's exact pair.

![Refresh beside Reset, cloning its style](improvised/l10-refresh.png)

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

## L11 — cut-over: routes, deletions, docs, gate hardening (Alrun, `agent-v2-l11`, 2026-09-07)

All four entries are data- and behaviour-only: L11 writes no markup and adds no pixels, so per this
log's own rule they carry no screenshots. Their proof is on the wire, in
`verify/l11/live.json` (22 checks) and `verify/l11/report.json` (36/36 fixture-mode pixel gate).

### I-L11-01 — a pretty path canonicalises itself into the query, rather than the router learning paths

**Serves:** `README.md` §Scope 1, ledger rows D18, D19, D20. Continues I-L1-10.

`public/v2/router.js:28` reads the view from the query string only, and never looks at the pathname.
`router.js` is L1's file and the shell is L11's **Out** list, so the cut-over could not teach either
one about paths. The server closes the gap instead: each path states which view it means, and
redirects only when the router's own default (`'app'`, `router.js:20`) would be wrong.

| URL | Answer |
|---|---|
| `/` | 302 → `/?view=land`, then the shell |
| `/app` | 200, the shell — the router already defaults to `app` |
| `/deck` | 302 → `/deck?view=deck`, then the shell |

**Why not 200 everywhere.** Serving the shell at `/` with no query would render the app view, because
that is the router's default — the landing page would be unreachable at the URL that is supposed to
show it. **Why not redirect `/app` too**, for symmetry: it would put a redirect on the deck's own
entry point, the URL in `.claude/launch.json` and in every operator's muscle memory, to change
nothing. The rule is therefore stated once, as a fact about the router rather than a table of paths:
*redirect when the resolved view differs from the view this path names.* A path and a stale query that
disagree (`/app?view=deck`) resolve to the path, because the path is what the operator typed.

Every other query parameter survives the hop — `/?fixture=1` becomes `/?fixture=1&view=land` — so
fixture mode reaches the landing page. Without that, a design-gate capture of `/` would have called
the live API.

### I-L11-02 — each old page URL maps to the screen that replaced it, in one hop

**Serves:** `README.md` §Scope 1.

`/index.html` → `/app#windows`, `/keys.html` → `/app#keys`, `/accounts.html` → `/app#accounts`,
`/machines.html` → `/app#machines`, `/sessions.html` → `/app#desktop`.

Two are not literal renames. The old `index.html` was the tiles page, so it lands on `windows`, the
screen that holds the tiles — not on the app's default screen, which would silently move an old
bookmark. `sessions.html` was the *Desktop sessions* page, so it lands on `desktop`; `windows` is the
tmux tiles, an unrelated screen with a confusingly close name.

The redirect names the fragment itself (`/app#keys`) rather than relying on a browser to re-attach the
original one. Browsers do preserve a fragment across a redirect whose target has none, but that is a
courtesy of the redirect, not of the server, and it costs one line to be explicit.

### I-L11-03 — the gate's settle is bounded, and the hardening did not earn a re-baseline

**Serves:** `README.md` §Scope 4 (gate hardening S0.1).

`networkidle` waits on every connection, so a single live WebSocket or EventSource holds it open until
the timeout. The replacement counts **only** `fetch` and `xhr`, and is bounded: 300 ms of quiet, giving
up after 5 s. The numbers are chosen so a hung request costs one screen rather than the whole run —
the capture continues and that screen fails with its reason recorded, which is more useful than 36
screens dying together. Websocket and eventsource resource types are never counted, which is the
specific failure `networkidle` had.

**The CDN mirror is keyed on presence, deliberately.** The same slice deletes the vendored
React/ReactDOM/Babel, so their mirror entries have no file to serve and the request goes out exactly as
before; the entries stay because the mock still names those URLs, and a future re-vendoring should not
need a code change. The Inter entries *are* live: `public/v2/vendor/inter.css` and its `.woff2` remain,
so both sides now render text from the same local font file instead of whatever Google serves that day.

**No re-baseline.** The pack says to re-baseline only if the PNGs change. A full baseline run after the
hardening passed 36/36 at max 0.033 %, inside the 0.05 % reproducibility target, and 35 of the 36 files
came back **byte-identical** to the committed baseline. The one that differed, `registry-dark.png`, is
the same screen that carries the run-to-run noise, and it moved by that same 0.033 %. So the hardening
is pixel-neutral and the approved baseline was restored untouched — re-baselining on capture noise
would have thrown away the approval for nothing.

### I-L11-04 — the old desktop-sessions acceptance script is deleted, not repointed

**Serves:** `README.md` §Scope 5.

`scripts/verify-desktop-sessions-ui.js` served `/sessions.html`, `/sessions.js`, `/style.css` and
`/index.html` from `public/` and drove that page's own selectors (`#sessions-count`, `.desktop-group`).
All four files are deleted here and none of those selectors exists in v2, so there was nothing to
repoint it at: rebuilding it against the v2 Desktop sessions screen means writing a test for another
slice's screen, which the cross-slice contract forbids. It goes, and its README paragraph with it.

What replaces it: the design gate captures that screen in both themes as `desktop-sessions-*`, and
`verify/l11/live.json` proves the screen's route and a clean console. The screen's own behavioural
coverage belongs to the slice that owns it.
