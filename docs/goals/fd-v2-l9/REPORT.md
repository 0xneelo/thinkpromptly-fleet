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
| Live mode, API stubbed | `node docs/design/fleetdeck-v2/verify/l9/live.mjs` | **44/44 rows pass**, exit 0. `verify/l9/live.json`, `live-dark.png`, `live-light.png` |
| Unit | `node --test test/v2-machines.test.js` | **49 pass, 0 fail** |
| Suite | `npm test` | **278 pass, 1 fail** — the one failure is `test/v2-data.test.js`, inherited from the base and not caused by this branch. See below. |

### The one failing test is not this slice's

`npm test` is **not** fully green on `agent-v2-l9`, and it is not green on `origin/agent-v2-base`
either. `test/v2-data.test.js` fails to load at all:

```
ReferenceError: window is not defined
    at Object.<anonymous> (public/v2/fixture.js:4:1)
    at Object.<anonymous> (test/v2-data.test.js:17:14)
```

`public/v2/fixture.js:4` is `window.FD = window.FD || {};` — S2's generated file, from commit
`2bd76de`. Node has no `window`, so the file throws on `require`.

Proof it is inherited, not caused here: the test loads only `public/v2/data.js`, `router.js`,
`fixture.js` and `orgchart.js`, and `git diff origin/agent-v2-base --name-only` shows this branch
modifies **none** of them. It also reproduces standalone with no L9 file loaded. `fixture.js` is
generated by `tools/dc-compile.mjs` and the DESIGN-35 broadcast says not to edit it, so this slice
did not touch it. Filed as **DECK-80** for S2.2 with the UMD preamble the fix wants.

Everything else passes: 278 of 279, and `test/v2-machines.test.js` contributes 49 of them.

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
fixture-reported-literal, light-theme-renders, console-clean`.

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

**Adversarial audit:** not run. A `hard-crux` (Fable) post-audit is the protocol's default, and the
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

---

Signed **Eckbert** · `frontend-developer` · `agent-eckbert` · 2026-09-07
