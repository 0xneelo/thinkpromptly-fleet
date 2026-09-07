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
