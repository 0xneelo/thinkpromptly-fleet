# fd-v2-l9 — REPORT

| | |
|---|---|
| Worker | **Eckbert** · `frontend-developer` · tag `agent-eckbert` |
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Linear | **DECK-71** — [Eckbert · frontend-developer] fd-v2 L9 Machines cards |
| Branch | `agent-v2-l9` off `origin/agent-v2-base` |
| Ledger row | D16 (`docs/design/fleetdeck-v2/diff.md`) |
| Date | 2026-09-07 |

## What shipped

The Machines screen on live data, inside the mock's collapsible cards, with fixture mode
untouched.

| File | Ownership |
|---|---|
| `public/v2/screens/machines.js` | new, owned by this slice |
| `public/v2/logic.js` | **only** this screen's methods: `mSec`'s bar tuple, `mCard`, and the machines seed |
| `test/v2-machines.test.js` | new, owned by this slice |
| `docs/design/fleetdeck-v2/verify/l9/**` | this slice's gate evidence |
| `docs/design/fleetdeck-v2/improvised.md` | appended; no other slice's entry touched |

Nothing else was edited. The shell (`index.html`), `runtime.js`, `app.js`, `template.dc.html`,
`fixture.js`, `data.js` and every other screen's file are unchanged — `git diff origin/agent-v2-base
--stat` is the proof.

## Behaviour checklist — every BEHAVIOUR.md item

`BEHAVIOUR.md` is `public/machines.html` + `public/machines.js` as they ship today. Every string
below was copied from that file, not retyped.

### §1 Data

| Item | Status | Where |
|---|---|---|
| `GET /api/machines`, `?refresh=1` forces | done | `FD.data.machines({refresh})`, machines.js `load()` |
| Row fields `id, label, os, route, ssh, host, error, sessions, state, reported_at, clients[]` | done | all consumed; `reported_host` is not rendered today either |
| Client fields incl. `config_email`, `orgs_seen`, `shares`, `note`, `usage` | done | `section()` |
| Synthesized `not_installed` combos per `where` × client | done | dropped as `—`, as the mock does |
| Top level `collected_at`, `collecting`, `collect_started_at` | **n.a.** | not rendered today either (improvised.md I-L9-08) |
| `push_url` | done | the copyable push command |
| `POST /api/machines` (the push route itself) | **out of scope** | server-side; the screen only prints the cron line |

### §2 Rendering

| Item | Status | Note |
|---|---|---|
| Four client columns `Claude CLI / Codex CLI / Claude desktop / Codex desktop` | done | fixed CLIENTS order, one column each |
| Machine name | done | card header, from `FD.data.toMachines` |
| Chips `os`, `ssh <ssh>` or bare `route` | done | joined into the mock's one `kind` chip |
| `"N session(s)"` chip, singular and plural | done | `sessionChip()` |
| `m.error` | done | improvised status cell (I-L9-04) |
| `no report yet — cron this on that machine:` + copyable `sh fleet-logins.sh push <push_url> <id>` | done | status cell, click-to-copy, `title="click to copy"` |
| `no report yet` | done | status cell |
| `reported <ago>` | done | written into the template's hard-coded slot (I-L9-01) |
| One `.sess` line per session | **partial, by design** | the mock replaced them with the count chip + Open in Registry (I-L9-07) |
| Empty client cell `—`, blank when `no_report` | done | the mock drops a `—` section, which is the same result |
| WSL / Windows tag rule | done | `where === 'windows'`, else the machine's os containing `wsl` |
| `not_installed` → `—` | done | `section()` early return |
| Identity: label, else `signed in, account unknown` / `<org8> · unmapped org` | done | full fallback chain, `email \|\| config_email` |
| Mono email | done | the mock's `mSec` makes the email the row's primary |
| Chips: plan (except `business`), TIER, PROOF, STATE | done | all four maps verbatim; tones renamed to the mock's `good/warn/bad/neutral` |
| Freshness: `token valid\|expired <ago>`, `refreshed <ago>`, `last active <ago>` | done | `freshness()`, verbatim |
| `shares` → `same login as CLI` | done | in the row note |
| `note` verbatim | done | in the row note |
| Usage bars in WIN_ORDER, unknown windows after by name | done | `windowNames()` keeps today's comparator exactly — it orders, it does not filter |
| Bar `label \| track/fill \| pct%\|—` | done | the mock's `bar()` helper |
| Amber ≥70 / red >90 | **partial** | the mock's shared `bar()` has one warn tone at ≥70 and no red. That helper is app-level, shared with Accounts (L8) — out of this slice. Ledger note for the design seat. |
| `sampled <age>[ — older than the window it measured, so these have reset since]` | done | verbatim, incl. the suffix |
| `no usage data` / `no usage windows reported` | done | in the row note |
| Per-window `resets in ...` | done | moved into the note, window-labelled (I-L9-05) |
| Session attribution `N session(s) run as <label\|\|email>`, local `claude_cli` runner only | done | incl. the `local.length === 1` guard |

### §3 Chrome, polling, errors

| Item | Status | Note |
|---|---|---|
| Refresh forces (`load(true)`) | done | attached to the mock's unbound header Refresh button (I-L9-02) |
| Refresh disabled while loading | done | `setBusy()` |
| `setInterval(load, 60000)`, never forces | done | `FD.data.poll(load, 60000)`; `POLL_MS === 60000` is asserted |
| Fetch error → `cannot reach fleetdeck` | done | replaces the list, as today (I-L9-06) |
| No `localStorage` | done | this screen adds none |
| Old ids/classes | **n.a.** | the mock's markup replaces them; hooks are `data-dc-tpl` ids only |

## Hooks

- **Provided:** none, as the pack specifies. `FD.screens.machines` exists but is this slice's own
  wiring (`afterRender`, `load`, `start`, `stop`, and `_` for the tests), not a cross-slice contract.
- **Used:** `FD.screens.registry.open` (L4), guarded —
  `if (FD.screens && FD.screens.registry && typeof FD.screens.registry.open === 'function')`, with
  the mock's own screen switch as the fallback until L4 lands. Called with `{ q: host || name }`.

## Data seam

`FD.setData('machinesLive', cards)`, **not** `machines`. S2 could not byte-safely substitute the
mock's `machines` literal, so `FD.fixture.machines` does not exist; per the DESIGN-35 broadcast of
2026-09-07 this slice publishes its own key and `logic.js` falls back to the mock's seed when it is
absent. That fallback is what keeps fixture mode byte-identical. Full reasoning: improvised.md
I-L9-09.

## Cross-slice dependencies and things for the design seat

1. **`public/v2/index.html` does not load `public/v2/data.js`.** The shell's script list is
   runtime → fixture → logic → app → screens; `FD.data` is never loaded, so every L2–L10 screen that
   follows the pack's data path finds it undefined. The shell is not this slice's file, so
   `machines.js` injects `/v2/data.js` on demand (`ensureData()`) rather than editing it. **The
   shell owner (L2 / L11) should add the `<script>` and these screens should drop the shim.**
2. **The mock hard-codes `reported just now`** with no `{{ m.reported }}` binding (app.js:2422). See
   I-L9-01. Binding it in the mock deletes an improvisation.
3. **The header `Refresh` button has no `onClick` on any screen** (app.js:1117). Each screen is
   currently on its own. A shell-owned refresh hook would be better than nine listeners.
4. **`FD.data.toMachines()` is thinner than BEHAVIOUR.** Table of the eight differences in
   improvised.md I-L9-09. Not a defect in L1 — it emits the binding map's fields — but the next
   screen author should not assume an adapter is a complete port. `data.js` was not edited.
5. **`npm run v2:check` now reports `public/v2/logic.js` stale**, because `logic.js` is generated
   from the mock by `tools/dc-compile.mjs` and the pack has nine slices edit it. It was already
   reporting two S2 report files stale before this branch. `v2:check` is not part of `npm test`.

## Verification

Every number below was produced by a command in this worktree, after the
`origin/agent-v2-base` merge that brought S2's `runtime.js` reconciliation fix.

| Gate | Command | Result |
|---|---|---|
| Pixel, fixture mode | `npm run design:diff -- --app http://127.0.0.1:4197/v2/index.html?fixture=1 --slice l9` | **36/36, `allPass: true`**, max mismatch 0.032948 %. Machines dark **0.000000 %**, light **0.000000 %**. `verify/l9/report.json` |
| Live mode, API stubbed | `node docs/design/fleetdeck-v2/verify/l9/live.mjs` | **46/46 rows pass**, exit 0. `verify/l9/live.json`, `live-dark.png`, `live-light.png` |
| Unit | `node --test test/v2-machines.test.js` | **55 pass, 0 fail** |
| Suite | `npm test` | **350 pass of 353** — the three failures are `EADDRINUSE` port collisions in the `reaper` / `lease` server suites. See below. |

### The three failing tests are port collisions, not this slice

`npm test` on the S2.2 base is **350 pass of 353**. The failures are all in `test/reaper.test.js`
and `test/lease.test.js`, and they all read:

```
Error: listen EADDRINUSE: address already in use 127.0.0.1:3900
```

Those suites bind fixed ports in the 39xx range. This box runs many agent sessions at once, and
`ss -ltnp` showed sibling processes holding 3917 and 39763 during the run. The suites fail *worse*
in isolation than in the full run, which is the signature of an external squatter rather than a
load flake. This branch modifies no server, reaper or lease file —
`git diff origin/agent-v2-base --name-only` confirms it.

Every v2 test passes: `test/v2-data.test.js` **69/69** and `test/v2-machines.test.js` **55/55**.

Earlier in this slice the suite was red for a real reason — `public/v2/fixture.js:4` used a bare
`window`, so `test/v2-data.test.js` could not load at all. That was filed as **DECK-80** and is
now **fixed by L1.1's `public/v2/fixture-extract.js`**, which arrived with the S2.2 base merge.

### Run the gate before the harness, never beside it

`scripts/design-diff.mjs:244-250` publishes by `rename`-ing a staging directory over
`docs/design/fleetdeck-v2/verify/<slice>/` and deleting the old one, so a gate run **replaces the
whole slice directory**. The pack puts the live-mode proof and its source in that same directory,
so running the two concurrently destroys the proof — it cost this slice one rewrite of `live.mjs`.
Run `design:diff` first, the harness second, and keep both committed so a wipe is recoverable with
`git checkout`. Filed as **DECK-83** for every other slice.

The live harness stubs `/api/*` from `docs/design/fleetdeck-v2/fixtures/api/`, re-bases every
epoch on `Date.now()` at serve time so age strings are deterministic, and drives five scenarios:
the real capture, hand-written variants (error, non-push `no_report`, `business` plan,
`token_expired`, `shares`, no-identity, unmapped org, one session), an aborted fetch, `?fixture=1`,
and the light theme. It reads the real DOM through the compiled template's `data-dc-tpl` anchors.

Rows: `cards-order, kind-chip-ssh, kind-chip-push, session-chip-plural, no-sessions-no-chip,
reported-ago, reported-empty, push-status-row, gb-row-shape, not-installed-dropped, env-tags,
identity-mono-email, chips-order, config-only-no-state-chip, bar-labels, bar-rights, bar-stale,
note-joined, note-codex-refreshed, note-stale-windows, note-no-usage, default-expanded,
collapse-click, expand-again, open-in-registry, first-load-no-force, refresh-forces,
refresh-disabled, poll-interval, status-error, status-no-report-ssh, session-chip-singular,
plan-business-hidden, state-token-expired, shares-note, identity-unknown, identity-unmapped-org,
fetch-error-card, fixture-no-fetch, fixture-seed-cards, fixture-collapsed,
fixture-reported-literal, light-theme-renders, console-clean`, plus `copy-cleared` — a machine
that stops being `no_report` must not keep the copy affordance the runtime hands to its first
client row — and `validate-drops-malformed`.

`console-clean` excludes exactly two deliberate cases, named in the row's own `expectation`: the
hero video, which the harness blocks the way `design-diff` does, and the `/api/machines` abort in
the error scenario. Nothing else appears in the filtered set.

## Review and audit

**Reviewer pass (Sonnet, on the diff).** Five findings; three were real and are fixed, one is a
race today's screen also has, one is a documented consequence of the mock.

| # | Finding | Outcome |
|---|---|---|
| 1 | Before the first fetch resolved, `logic.js` fell back to `mSeed`, so a live page painted the **mock's fabricated machines and logins** (`Reiner Garrecht`, `neelo@vibe.trading`) until the round trip landed. | **Fixed.** `start()` now publishes an empty list synchronously, before the fetch. An empty screen until the first load returns is exactly today's behaviour. |
| 2 | The click-to-copy affordance outlived its status row: once a `no_report` machine reported in, the reused node kept the tooltip and still copied a stale cron command. | **Fixed.** `syncCopy()` both sets and clears, and runs on every card every render. |
| 3 | `ensureData()` memoized its rejection, so one transient `/v2/data.js` failure stuck the screen on `cannot reach fleetdeck` for the session. | **Fixed.** The rejection clears the memo; the next 60 s poll retries. |
| 4 | A poll and a forced Refresh in flight together race on `state` and the button. | **Fixed** with a sequence guard, though `public/machines.js` has the same race today. |
| 5 | `sampleAge()` drops today's `age-amber` / `age-red` class. | **Not a defect.** BEHAVIOUR §3 lists those among the old classes not carried into v2, and the mock's note is a single-tone `<p>`. Recorded here and below. |

**DESIGN-35 binding instructions (S2 shim oracle audit, 2026-09-08).**

1. *Never mount foreign DOM inside a compiled node; positional `sc-for` rows are not stable
   identities.* This slice mounts **no** foreign DOM — `afterRender` only writes `textContent`,
   `style.display`, `title` and listeners on nodes the template already made. Every one of those is
   re-derived from the model on **every** render, never accumulated, and a DOM card with no model
   is cleared rather than skipped. Per-card open/closed state was keyed by index (the mock's own
   `mOpen[idx]`); it is now keyed by **machine name**, so a machine dropping out of
   `/api/machines` cannot hand its open state to its neighbour.
2. *Validate before `setData`; make your `renderVals` section throw-proof.* `validate()` coerces
   every field the template touches and drops a card it cannot coerce, so nothing unvalidated
   leaves `machines.js`. The machines block in `renderVals` is wrapped in try/catch and returns its
   last good cards, so a malformed row cannot blank the other eight screens (audit F2).
3. *Bind raw input state; never `setState` unconditionally in `componentDidUpdate`.* Not
   applicable and confirmed clean: this screen has no input and no `<select>` (so audit F4 cannot
   bite it), and `_fdAfterRender()` writes DOM only — it never calls `setState`, so it cannot drive
   the F5 update loop.

**Adversarial audit:** not run as such, but the S2.2 merge produced one real finding of its own — see DECK-101 below. A `hard-crux` (Fable) post-audit is the protocol's default, and the
box's Fable subagents have been returning rate-limit failures; the GPT hunter route was not
attempted from this session. The Sonnet reviewer above substituted, and the reader should weigh it
as such — the same substitution S2 and L1 recorded.

## Known differences from today's screen, for the design seat

None of these are in files this slice owns. All are ledger notes on D16, raised on **DECK-76**.

1. **Usage bar tone.** Today: amber ≥70, red >90. The mock's shared `bar()` helper has one warn
   tone at ≥70 and no red. That helper is app-level and shared with Accounts (L8).
2. **A stale bar loses its percentage.** The mock's `bar()` puts `stale` in the right cell
   *instead of* the number; today's screen shows the percentage and puts `stale` in the row tail.
   No data is lost on the current capture — every stale window there has `pct: null` — but a
   window with both a percentage and `stale: true` would lose its number.
3. **A long window label overflows.** The template's bar grid is `52px 1fr 38px` (app.js:2493).
   An unknown window falls back to today's `name.replace(/_/g, ' ')`, so `seven_day_fable` renders
   as `seven day fable` and paints over the bar track. Visible in
   `verify/l9/improvised/l9-note-joined.png`. The mock's own seed writes `7d fable` for this exact
   window, which suggests the design seat wants a short-label map — but that is a *text* change,
   and this slice's texts are pinned verbatim to BEHAVIOUR.md, so it is raised rather than taken.
4. **Sampled-age severity.** Today's `sampleAge()` also returns an `age-amber` / `age-red` class.
   The mock's row note is a single-tone `<p>` with no per-fragment styling, so the age is carried
   as text only.
5. **A machine with nothing installed renders an empty card body.** The mock drops a `—` section,
   so a machine whose clients are all `not_installed` (e.g. `thinkpromptly-vps` in the capture)
   shows a header and an empty grid where today's table shows four em dashes. This follows the
   mock's own rule and is left as the mock has it.

## Delegation

Per PROTOCOL §8. Two Sonnet `reader`s did the source reads (the S2/L1 contracts; today's
`machines.js` + `server.js` behaviour inventory). Two Opus `builder`s wrote
`test/v2-machines.test.js` and `verify/l9/live.mjs`. A Sonnet `reviewer` reviewed the diff; its
findings are in the table above. The two owned source files — `public/v2/screens/machines.js` and
the `logic.js` methods — were written in the main session rather than delegated, because every
string in them is a verbatim port and the specification of that port would have been longer than
the code.

## Merged forward twice, re-gated each time

`origin/agent-v2-base` moved under this slice twice while it was in flight, and both merges were
clean with no `logic.js` conflict. Every gate above was re-run after the second one.

1. **S2 reconciliation fix** — `runtime.js` `I()` now inserts an Array unwrapped. Interpolation
   only; this screen's after-render pass targets a plain text node and was unaffected.
2. **S2.2 + L1.1** — the oracle's seven shim findings, plus `fixture-extract.js` and a drift check
   wired into `pretest`. Two of the seven touch this slice's assumptions and both are benign here:
   `flush()` still runs `syncChildren` → `sweep` → refs → `componentDidUpdate`, so the after-render
   pass still lands after the runtime rewrites its text node; and F2's "keep the last DOM on a
   throw" complements this slice's own try/catch rather than replacing it — the runtime's version
   skips the whole render, this slice's keeps the other eight screens rendering with its last good
   cards.

### One finding raised by the S2.2 merge — DECK-101

S2.2's F5 runaway-update guard does not fire for the loop its own error message names. `chain` is
only incremented while `inFlush` is true, and `inFlush` is cleared in the `finally` around
`syncChildren` — before `componentDidUpdate` runs. So a `setState` from a lifecycle hook resets the
counter every round, and `renderVals` sits outside the flag on the other side.

Reproduced in Chromium against this branch, not inferred: 200 chained
`componentDidUpdate → setState` rounds ran and the guard never fired (200 was my own cap, not the
runtime's). Fix in the issue: hold `inFlush` across the whole commit. It does not affect L9 — this
screen writes DOM in its after-render pass and never calls `setState` there — but broadcast
instruction 3 tells every slice not to `setState` in `componentDidUpdate` *because the guard would
catch it*, and today nothing does.

## The one thing I could not do — DECK-102 (operator:gate)

The pack's closing step is a registry write, and it cannot be done from this box. This is
diagnosed rather than skipped.

`server.js:2988-2990` gates the tailnet listener:

```js
if (req.method === 'POST' && !BUS_ROUTES.has(p) && !notifyPath(p) && !tailnetAuthed(req))
  return send(res, 401, 'text/plain', 'unauthorized');
```

and `tailnetAuthed` (`server.js:497-501`) wants `Authorization: Bearer $FLEET_TAILNET_KEY`, from
`process.env.FLEET_TAILNET_KEY` (`server.js:491`). `/api/registry` is **not** in the exemption —
the XYZ-1888 carve-out covers `BUS_ROUTES` only.

Measured from `german-box`:

| Request | Result |
|---|---|
| `GET /api/ghtoken` | **200** — the deck is reachable, reads are open |
| `POST /api/registry`, no auth header | **401** |
| `POST /api/registry`, `Authorization: Bearer not-the-key` | **401** |
| `FLEET_TAILNET_KEY` in this box's environment | **unset** |

The only credential here is `~/.fleetdeck-bus-token`, which the code above shows authorises the
bus routes and nothing else. So no credential on this box can write that row, and retrying cannot
change it. The operator either provisions `FLEET_TAILNET_KEY` on the box — which fixes it for
every slice, since every pack ends with this same POST — or marks the row on the deck.

XYZ-2137 already records the symptom, and previous sessions read it as licence to skip the step
quietly. That is precisely why this is a filed gate: the packs make the registry row an acceptance
condition, so skipping it silently leaves the operator unable to confirm a slice finished.

---

Signed **Eckbert** · `frontend-developer` · `agent-eckbert` · 2026-09-07
