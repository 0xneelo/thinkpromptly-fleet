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

## L3 — Windows tiles, Session full screen, xterm engine (Gottlieb, `agent-v2-l3`, 2026-09-07)

Ledger rows D09, D10. The mock draws a *screenshot* of a terminal: four tiles of pre-baked log lines
and a full-screen overlay of more of the same. Everything a real terminal needs beyond that picture —
a place to mount xterm, a disconnected state, a stall warning, an empty state, a working close button
— is absent from the mock, so it is improvised here. Screenshots are in
`docs/design/fleetdeck-v2/improvised/`, taken by `scripts/l3-live.mjs` during the live gate.

### I-L3-01 — the xterm assets are injected at runtime, not added to the shell

**Serves:** `README.md` §Scope 1-2, ledger D09.

The old app loads `/vendor/xterm.css`, `/vendor/xterm.js`, `/vendor/addon-fit.js` and
`/vendor/addon-web-links.js` from `public/index.html:6,123-125`. The v2 shell — `public/v2/index.html`
— is generated by `tools/dc-compile.mjs` and owned by S2, and no slice may edit it, so the four tags
cannot be added there. `screens/windows.js` injects them itself, once, on the first live boot, from
the same `/vendor/*` routes `server.js:2367-2370` already serves. Nothing is fetched in fixture mode,
and nothing is fetched in live mode until a tile is actually opened.

The same reasoning applies to `public/v2/data.js`: the shell's script list does not include it either,
so the screen file injects it before its first `FD.data` call. When L2 lands a shell that loads both,
these injections become no-ops — they are guarded on `window.Terminal` and `FD.data` already existing.

### I-L3-02 — the xterm theme is re-derived from the mock's tokens

**Serves:** `BEHAVIOUR.md` §2 ("to be re-derived from the mock's tokens and recorded in improvised.md").

The old theme is a fixed four-colour object (`app.js:4-9`) in the pre-redesign palette:
`background:#1a1915, foreground:#e8e6dc, cursor:#d97757, selectionBackground:rgba(217,119,87,0.3)`.
It is replaced by the mock's own tokens, read per render from `FD.l3.tokens`:

| xterm key | mock token | why |
|---|---|---|
| `background` | `rgba(0,0,0,0)` | the tile body already paints `A_panel` over the app's blur; an opaque terminal background would punch a flat rectangle through the glass |
| `foreground` | `ink` | the mock's primary text colour, the one `tl.lines` command rows use |
| `cursor` | `good` | the mock has no cursor token; `good` is the colour of the live dot in the same tile header, so the cursor reads as "this session is alive" |
| `selectionBackground` | `hoverBg` | the mock's only selection-like surface |

Font size stays 12 px as in `app.js:1049` and the family is the mock's `mono`. The consequence to
know: the terminal is **theme-aware now**, where the old one was always dark. Light mode gets dark
text on the light panel instead of a black hole in the layout — see `improvised/l3-tile-xterm.png`.

### I-L3-03 — the Disconnected overlay and the stall line are built in mock tokens

**Serves:** `BEHAVIOUR.md` §3, ledger D09. Screenshots: `improvised/l3-dead-overlay.png`,
`improvised/l3-stall.png`.

The mock has no failure states at all. Both are rebuilt from the old app's structure
(`app.js:1104-1121`, `:1081-1086`), with the mock's surfaces:

- **Dead**: a full-tile scrim in `termBg` with the same `blur(28px) saturate(150%)` the mock uses on
  every panel, holding a card in `panel` + `line`, with `Disconnected`, the conditional
  `1Password locked — unlock it, then Reconnect` note, and a `Reconnect` button in `ctaBg`/`ctaFg`.
  The terminal underneath keeps the old `opacity:.35` + grayscale treatment (`style.css:607`).
- **Stall**: a strip pinned to the bottom of the tile body in `warn` on `panelHead`, above a
  `lineSoft` rule, carrying the 15-second copy verbatim.

Texts, the 15 s timer and the `communication with agent failed` / `agent refused operation` trigger
are unchanged from the old app.

### I-L3-04 — the terminals live in their own layer, aligned to the compiled boxes

**Serves:** `BEHAVIOUR.md` §1 and §7, ledger D10; DESIGN-35 binding of 2026-09-07 (oracle audit
`s2-shim-oracle-2026-09-08.md`, items 1-2).

The old app maximizes by toggling a class: `.tile.max` becomes `position:fixed;inset:0` and the same
DOM stays put (`style.css:578-585`). The mock instead draws the full screen as a **separate overlay**
(mock L781-815) outside the tiles grid, so the tile and the overlay are two different boxes.

The first implementation mounted xterm inside the compiled tile body and moved that node into the
overlay on maximize. The design seat's audit rules that out: **foreign DOM is never mounted inside a
compiled node**, and a positional `sc-for` row is not a stable identity, so no per-row state may be
stored on one. Both were true of that approach.

What ships instead: one fixed layer, `[data-l3-layer]`, appended to `document.body` as a **sibling of
`#dc-root`**. Every session gets an absolutely-positioned box in it holding its terminal — and its
stall line and dead overlay, so a failure state can never be orphaned in a box the terminal has since
left. Each render the layer is re-aligned: the compiled tiles are **read** for their content rects
(padding subtracted) and nothing more; index is the only relationship, because index is the only one
a positional row honours. The model in `screens/windows.js` is the sole identity.

Consequences worth knowing:

- One `Terminal`, one WebSocket, one scrollback per session for the life of the tile. Maximize is a
  move of the *rect*, not of the DOM, so nothing is torn down.
- z-order: a tiled terminal sits at 54, under the mock's full-screen overlay (55); the maximized one
  is raised to 56, over the overlay's own background, so the overlay paints the chrome and the layer
  paints the terminal.
- Re-alignment is driven by a per-render callback (`FD.l3.onRender`), a `ResizeObserver` on the
  current target box, and window `resize` / capture-phase `scroll` — **not** a `MutationObserver`: a
  live terminal rewrites its own rows constantly, and a subtree observer re-enters on every byte of
  pty output.
- The overlay body is still reached through the mock's own `ref="{{ A_termRef }}"` binding, which is
  a reference handed out by the template, not state written onto it.

Proven by the live gate: `L3-33` asserts every one of 85 mounts is outside `#dc-root`, and `L3-34`
asserts zero slice attributes on the compiled rows.

**Addendum, S2.2 (2026-09-07).** The base later gained `key="{{ expr }}"` on `sc-for` and
`data-dc-raw` for an element that owns its own children, and the design seat left the choice open:
mount inside a keyed, raw tile body, or keep this layer. **This slice keeps the layer.** Taking the
in-tree option needs two edits to `template.dc.html` — marking the tile body raw and keying the tiles
loop — and no L-slice may edit the template; the layer additionally covers the full-screen case with
the same mechanism, and is already proven by the two checks above. The cost is the z-order juggling
and `I-L3-10`. If the seat prefers the in-tree mount later, the change is contained to `sync()`.

### I-L3-05 — the tile footer is the registry `role · label`, then `task`

**Serves:** `diff.md` §"Binding map" row `tiles[]` ("footer = registry `label`/`role`/`task` (decide in L3)").

The mock's footer is a wide left cell that truncates and a short right cell: `foot1` is
`gpt-5.6-sol xhigh · ~/projects/lowcap-connecto…` (what is running, and where) and `foot2` is
`Pursuing goal (11m)` (a short status). The registry's nearest pair:

- `foot1` = `role · label` — who this session is and what lane it is on, the long truncating half.
- `foot2` = `task` — the Linear key, already short, already right-aligned in the mock. `—` when absent,
  which is the same dash the Registry screen uses for a missing task.

The full-screen footer (`A_termFoot`, mock's `model · path · branch`) is the same triple in full:
`role · label · task`. `status` was **not** used for `foot2` even though it is the closer analogue of
"Pursuing goal (11m)": the binding map names `label`/`role`/`task` and nothing else, and status is
already carried by the header dot.

### I-L3-06 — the tile close button and Connect all are bound by delegation

**Serves:** ledger D09; `BEHAVIOUR.md` §1 (close), §5 (tile bar).

The mock's tile header draws `⤢` with an `onClick` and `✕` with none (mock L235: `title="Close tile
(session keeps running)"`, no handler). The compiled template is S2's and cannot be edited to add the
binding, and the seed data has no `closeTile` field for it to bind to. So the screen file delegates: a
single document-level click listener matches that exact `title` inside the Windows screen, walks up to
the `data-l3-key` element and closes that tile. Behaviour is the old one exactly — the observer,
socket, terminal and DOM node are released and **nothing is sent to the server**, so the remote tmux
session survives (`app.js:1149-1158`). The tile is identified by its **position** among its
siblings, computed at click time — a positional row has no stable identity to store on it.

The sidebar's **Connect all** button has the same problem and the same fix: `template.dc.html:182`
draws it with no `onClick`, no id and no title, so it was dead markup. It is matched on its exact
label inside `<aside>` and calls this slice's `connectAll()` hook. Noted for L2: if the shell slice
also binds it, the two bindings both fire — one of them should go, and this one is the natural loser
since the button is in the shell's region.

Caught by review: the first version of the live gate called `connectAll()` through the hook, so the
check passed while the button itself did nothing. The gate now clicks the real button (`L3-25`).

### I-L3-07 — the Windows subtitle reports what is actually attached

**Serves:** ledger D09, open item O1.

The mock's screen subtitle is a seed sentence: `4 tiles attached · german-box · holder OK`. Live, it
would be a standing lie. It becomes `<n> tile(s) attached · <the hosts they are on>`, and
`No tiles attached` when the grid is empty. The whole `titles` map is copied and only the `windows`
entry replaced, so a sibling slice writing its own entry is never dropped.

`holder OK` was **not** carried over: it is a health claim from `/api/health`, not something this
screen knows, and repeating it unverified is exactly the kind of decorative untruth the port is
supposed to remove.

### I-L3-08 — the empty state, per the ruling

**Serves:** `BEHAVIOUR.md` §5 ruling, open item O1. Screenshot: `improvised/l3-empty-state.png`.

The old app's empty state is `No terminals open — pick a session, Connect all, or open the Registry`
(`index.html:37`) with a button in it. The ruling replaces the copy with
`There are no sessions yet, open a new session via an orchestrator first.` and the mock has no empty
state at all, so the block is improvised: one panel in `panel` + a **dashed** `line` border, in
`ink45` at 13.5 px, centred, occupying the space a first tile would. Dashed rather than solid so it
reads as an absence rather than as an empty tile.

It is drawn in the terminal layer, not inside the compiled screen (I-L3-04). That forces one more
decision: with no tiles the compiled Windows box has **no children and collapses to zero height**, so
it cannot be the thing the empty state is aligned to. The nearest ancestor that still has a content
area is used instead, and "is this screen showing" is answered by walking the ancestors for
`display:none` rather than by asking whether the box has a size — because at exactly the moment the
empty state is due, it does not.

The old button is dropped with the old copy — the new sentence names an orchestrator, not the
Registry, and there is no in-app control that opens a session, so a button would have nowhere to go.

### I-L3-09 — the live gate script lives in `scripts/`, not in `verify/l3/`

**Serves:** `README.md` §"Gate and proof" item 2.

The pack asks for "a Playwright script under `verify/l3/`". `scripts/design-diff.mjs:244-251`
publishes `verify/<slice>/` **atomically by replacing the directory**, so anything kept there is
deleted by the next pixel-gate run. The script is therefore `scripts/l3-live.mjs`; only its outputs
(`live.json`, `live-<theme>.png`) are written into `verify/l3/`. Run the pixel gate first and the live
gate second, or the live artefacts are swept away.

### I-L3-10 — the maximized terminal steps aside for the ≡ menu

**Serves:** ledger D10, mock L785-791.

The ≡ session-switch dropdown is drawn *inside* the full-screen overlay (mock L787), so it lives in
that overlay's stacking context at z-index 55. The maximized terminal is in this slice's own layer at
56 — above the overlay, which is what makes it visible at all — so the dropdown, which overlaps the
terminal body, would be painted underneath it and become unclickable.

Raising the dropdown is not available: it is a compiled node and this slice does not write to those.
So the terminal hides while the menu is open and returns when it closes. The session keeps running
throughout — only the pixels step aside. The alternative, lowering the terminal behind the overlay,
looked worse: the overlay's translucent background would show a half-erased terminal rather than a
clean menu.
