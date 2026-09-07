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

## L6 — message bus threads + reply toast (Gerhild, `agent-v2-l6`, 2026-09-07)

Ledger rows **D13** (Message bus) and **D08** (Reply toast). Owned files:
`public/v2/screens/bus.js` and this screen's methods in `public/v2/logic.js`.

The old bus is a form, a table and four toasts (`index.html:108-113`, `app.js:911-979`,
`1214-1233`). The mock replaces all of it with a two-pane chat. Every entry below is a gap
that substitution opens.

### I-L6-01 — a thread is keyed by the *other party*, which is a session name, not a target key

**Serves:** `BEHAVIOUR.md` §7 ("group `messages[]` by target"), ledger D13. Data-only.

`BEHAVIOUR.md` proposes `type\0host\0session` as the thread key. L1's shipped adapter does
something different and better, and L6 follows it rather than fight it.

`toThreads` (`data.js:297-316`) keys a message by the party that is *not us*: `target.session`
for a message we sent, the session half of `source` for one we received. That matters because a
reply from a fleet session to the desktop has `source: 'german-box:LC-x'` and
`target: {type:'claude-desktop', session:'…'}`. Under the target key it would land in the
desktop's thread; under L1's key it lands in `LC-x`'s thread, next to what we sent them. The
second is the conversation a human is looking for.

**Consequence, stated plainly:** the key is a bare session name, so two live sessions with the
same name on different hosts share one rail row. `messages.json` has no such collision and the
fleet's names are `LC-<person>-<task>`, so it is not reachable today — but it is a real limit of
L1's keying, not something L6 can fix inside its own file. See also I-L6-11.

### I-L6-02 — a Claude Desktop row keeps the old `<option>` label; a tmux row is split across two slots

**Serves:** `BEHAVIOUR.md` §2 (option labels, verbatim). Screenshot:
`improvised/l6-desktop-thread-label.png`.

Today's `<select>` renders one string per target: `"Claude Desktop · <label||'current chat'>"`
or `"<host> · <session>"`. The mock's rail has two slots — `s.name` on the row and `actS.host`
in the thread header's meta position — so the second form is already split for us and needs no
label at all: name is the session, host is the host.

For a desktop target there is no host to put in the meta slot (`/api/messages` targets carry
only `{type, session}`, and `/api/sessions` does not list desktop sessions), so the full old
label goes in the name slot and the meta slot is empty. `'current'` still reads
`'Claude Desktop · current chat'`, exactly as it does today.

### I-L6-03 — a desktop session is live iff the server offers it as a target

**Serves:** `BEHAVIOUR.md` §1, §7 (offline banner). Screenshot: `improvised/l6-desktop-thread-label.png`.

tmux liveness comes from `/api/sessions` (`live: true`, matched on host **and** name). There is
no equivalent for Claude Desktop: `/api/sessions` does not know about it. But `server.js:2333-2340`
builds `targets[]` from the *currently connected* desktop sessions, so presence in `targets[]`
is the liveness signal, and L6 uses it as one. A desktop thread whose session has disconnected
keeps its row, loses its dot, and its composer reads `Queue`.

### I-L6-04 — thread arrays are reversed; the adapter hands them back newest-first

**Serves:** ledger D13. Screenshot: `improvised/l6-thread-order-and-receipts.png`.

`/api/messages` is ordered `created_at DESC` (`message-bus.js:13-30`) and `toThreads` pushes in
iteration order, so its arrays are newest-first. The mock's `seedThreads` are oldest-first and
the thread body scrolls to `scrollHeight` on open, i.e. it expects the newest at the bottom.
L6 reverses each array on the way in. Nothing else would read as a conversation.

### I-L6-05 — the mock's `train-84` group is dropped; groups stay client-side

**Serves:** `BEHAVIOUR.md` §7 (broadcast), ledger D13. Screenshot:
`improvised/l6-thread-order-and-receipts.png` (the rail is all Recent).

`logic.js` hard-codes one group, `train-84`, whose members are fixture session ids. The API has
no group concept at all — `toThreads` returns `busGroups: []` and says so (`data.js:311`). In
live mode L6 pushes `busGroups: []` through `FD.setData`, and `logic.js` reads
`FD.fixture.busGroups` with the mock's literal as its fallback, so fixture mode is unchanged.

Ad-hoc broadcast groups (Select mode) remain exactly what the mock made them: client-side rows
in `AppLogic.state.adhoc`, never persisted. A broadcast is N independent `POST /api/messages`,
one per recipient, which is what `BEHAVIOUR.md` §7 asks for.

### I-L6-06 — one 15 s timer serves both poll cadences

**Serves:** `BEHAVIOUR.md` §7 (15 s open / 60 s on the shell). Behaviour-only.

Two intervals would drift apart and double-fetch whenever the user moved between screens. One
15 s timer fires always; it fetches immediately when the bus screen is open, and otherwise only
once 60 s have passed since the last fetch. Same two observed cadences, one timer to stop.

### I-L6-07 — the four send/retry toast strings become receipt text

**Serves:** `BEHAVIOUR.md` §2 and §3 (texts verbatim), ledger D13. Screenshot:
`improvised/l6-receipt-error-strings.png`.

`BEHAVIOUR.md` quotes `"Delivering message…"`, `"Message delivered"`,
`"Delivery failed: <error||'unknown error'>"`, `"Retrying message…"` and
`"Retry failed: <error>"`. The mock has exactly one toast, and its markup is fixed: a dot, a
name, the literal word **replied**, a preview and **Open thread**. There is no slot for these
five, and hand-typing markup is forbidden.

The mock already answers the same question in a better place. `receipt()` renders
`status · error` under each message, and `thMsgs` puts a **Retry** button on a failed one — the
D13 redesign deliberately replaces a transient toast with a durable per-message receipt.

**Decision:** the progress strings map onto receipt states (`queued` → `delivered`), and the two
*error* strings — the ones that carry information a user cannot reconstruct — are preserved
**verbatim** as the receipt's error text: a failed send reads
`failed · Delivery failed: <error||'unknown error'>`, a failed retry
`failed · Retry failed: <error>`. Nothing is lost; the error stops vanishing after four seconds.

### I-L6-08 — `FD.screens.bus.open()` on an unknown target makes a provisional thread

**Serves:** `BEHAVIOUR.md` §5, ruling O8. Screenshot: `improvised/l6-provisional-thread.png`.

Today's `setBusTarget` (`app.js:901-909`) stores the target and selects it *if the option
exists, else on the next `loadBus()`* — the deep link never fails, it just waits. The v2
equivalent is a provisional rail row: created immediately with `live: false` and an empty
thread, kept in a `provisional` map so the next poll cannot drop it, and replaced by the real
row as soon as the server mentions that session. The composer works the whole time, because a
message to a session with no history is the normal way a thread starts.

### I-L6-09 — the bus screen loads `public/v2/data.js` itself

**Serves:** the whole slice. Behaviour-only. **Wants a shell owner** (filed as DECK-71).

S2's `public/v2/index.html` loads `runtime.js`, `fixture.js`, `logic.js`, `app.js` and the nine
screen files — but not L1's `data.js`, and nothing else in the browser does either
(`grep -rn 'v2/data.js' --include='*.html'` finds nothing). Without it `FD.data` is undefined
and no screen can go live. The shell is not L6's to edit, so `bus.js` appends the script tag
once, tagged `data-fd-dep="data"` so a second slice doing the same reuses it, and boots when it
loads. In fixture mode it is never requested — the fixture check is made locally first, so the
pixel gate pays nothing for it.

This should become one line in `index.html` and this improvisation should then be deleted.

### I-L6-10 — every row is validated before it reaches `FD.setData`

**Serves:** DESIGN-35 binding directive, 2026-09-08. Data-only.

"One throw in any slice blanks ALL screens." So nothing reaches `FD.fixture` until it has the
exact types the compiled logic reads: a rail row is `{id, name, host: string, live: boolean}`,
a message is the adapter's key set with `at` a string and `m` a finite number. A row that cannot
be coerced is dropped rather than half-rendered. On the render side, `logic.js`'s four
throw-prone derived values (`railGroups`, `thMsgs`, `thActions`, `toChips`) each compute behind
`busSafe()`, which returns the previous render's value if the computation throws.

### I-L6-11 — the message history wins over a same-named live session

**Serves:** I-L6-01's consequence. Data-only.

The rail is a union of four sources, and when two disagree about a session's host the order
decides. History runs first: a thread that actually happened on `german-box` keeps `german-box`,
so a same-named session on another box neither captures the thread nor makes it look live.
Sessions from `/api/sessions` still add rows for every name the history has never seen — which
is how today's client-side merge behaves (`app.js:920-925`).

### I-L6-12 — an offline target queues, it does not disable the composer

**Serves:** `BEHAVIOUR.md` §7 ("banner + `Queue` … or disable send; pick one, document").
Screenshot: `improvised/l6-offline-queue.png`.

**Chosen: queue.** The mock already decided this — `sendLabel` is
`thOffline ? 'Queue' : 'Send'` and the banner text is baked into the template: *"Session is
offline. The message queues and delivers when it returns."* Disabling send would contradict
markup we are not allowed to change. The message posts, the server tries and fails, the receipt
reads `failed` with the server's reason, and **Retry** is there when the session comes back —
which is what the banner promises.
