# fd-v2-l6 — Message bus threads + reply toast

**Worker:** Gerhild · `frontend-developer` · tag `agent-gerhild` · session `cli-worker`
**Branch:** `agent-v2-l6` off `origin/agent-v2-base` · **Linear:** DECK-49
**Ledger rows:** D13 (Message bus), D08 (Reply toast)
**Date:** 2026-09-07

---

## Result

| Gate | Required | Actual |
|---|---|---|
| Pixel gate, fixture mode | `verify/l6/report.json` allPass 36/36 | **36/36, allPass=true**, max 0.0329 % |
| Live mode, API stubbed | `verify/l6/live.json` all pass | **47/47, allPass=true**, 0 console errors |
| Unit tests | pure logic covered | **29/29** in `test/v2-bus.test.js` |
| Full suite | `npm test` green | **332/332, 0 fail** |
| Improvisations | logged + screenshots | **12 entries** I-L6-01..12, **6 screenshots** |
| Branch | pushed | `agent-v2-l6` pushed |

The pixel gate's 0.0329 % is on `registry dark` and is the same anti-aliasing noise S1 and S2
recorded on that screen; every other one of the 36 shots is 0.000000 %. **The Message bus shot
itself is 0.000000 % in both themes** — the screen this slice rewrote did not move a pixel in
fixture mode.

### Reproducing, in this order

```bash
# a static server rooted at public/
python3 -m http.server 4180 --bind 127.0.0.1 --directory public &

npm run design:diff -- --app "http://127.0.0.1:4180/v2/index.html?fixture=1" --slice l6
node docs/design/fleetdeck-v2/verify/l6-live/live.mjs      # writes verify/l6/live.json + PNGs
node docs/design/fleetdeck-v2/verify/l6-live/shots.mjs     # writes improvised/l6-*.png
npm test
```

**Order matters.** `design-diff.mjs` publishes a slice by renaming the whole `verify/<slice>/`
directory away and moving a staging directory in (`publish()`, line 244), so it destroys
anything else parked there. That is why the live harness lives in `verify/l6-live/` and writes
its output into `verify/l6/`, and why the pixel gate has to run first. (Learned the hard way:
the first copy of `live.mjs` was written into `verify/l6/` and the next gate run deleted it.)

---

## What was built

### `public/v2/screens/bus.js` — the live controller (the one file this slice owns)

Everything that talks to the network, stores anything, or runs on a timer. In fixture mode it
does **nothing at all**: `live` stays `false`, `FD.setData` is never called, no timer starts and
`/v2/data.js` is never even requested. That is asserted, not assumed — see the last unit test and
L6-43/44 in the live gate.

- **Threads.** `FD.data.toThreads(messages, now)` for the per-message shape; the rail is a union
  of the server's `targets[]`, every live fleet tmux session merged client-side the way
  `app.js:920-925` does today, every target and source the history mentions, and the adapter's
  own `busSessions`.
- **Unread** from `localStorage['fd-bus-seen']`, **pins** from `localStorage['fd-bus-pinned']` —
  both key names verbatim from `BEHAVIOUR.md` §7. Unread counts inbound rows whose `created_at`
  is newer than the stamp; the total goes to `FD.shell.setBadge` (guarded).
- **Send** is `POST /api/messages {source, target, text}` — exactly those three keys. A broadcast
  is N POSTs, one per selected target. **Retry** is `POST /api/messages/retry {id}`.
- **Poll**: one 15 s timer that fetches immediately while the bus screen is open and throttles to
  60 s on the app shell.
- **Reply toast** (D08): a new inbound row for a thread other than the open one raises
  `"<from> replied"` with a preview and **Open thread**, auto-dismissed at 7 s.
- **`FD.screens.bus.open(target)`** — the hook this slice provides.

### `public/v2/logic.js` — this screen's methods only

Every live branch is behind `busLive`, which is `null` in fixture mode. Seeds are read through
`FD.fixture` (`busGroups`, `busUnreadDefault`, `busActiveDefault`) with the mock's own literals as
the fallback, so with no live data the block evaluates to exactly what it did before.

Two lines outside the bus block: `componentDidMount` hands `AppLogic` to the bus screen and
`componentWillUnmount` releases it. Both guarded; `attach()` returns immediately in fixture mode.

### DESIGN-35 binding directives (2026-09-08)

1. **No foreign DOM inside a compiled node.** L6 mounts none. The one element it creates is a
   `<script>` appended to `document.head`, outside `#dc-root`.
2. **Validate before `FD.setData`; make the block throw-proof.** Both done: `validRows()` /
   `validMessage()` coerce or drop every incoming row before it reaches `FD.fixture` (I-L6-10),
   and `railGroups`, `thMsgs`, `thActions` and `toChips` each compute behind `busSafe()`, which
   returns the previous render's value if the computation throws.
3. **Bind raw input state.** The composer, the search box and the `from` chip bind the mock's own
   raw state and are unchanged. Nothing is set in `componentDidUpdate`. There is no `<select>` on
   this screen — the mock replaced it with the rail.

---

## Behaviour checklist — every item in `BEHAVIOUR.md`

`done` = ported and covered by a gate check. Live-gate ids are `L6-nn` in `verify/l6/live.json`.

### §1 Data

| Item | State | Evidence |
|---|---|---|
| `GET /api/messages?limit=50` | done | L6-01 asserts the exact URL and method |
| Response `{messages, targets}` | done | L6-03, L6-04 |
| `messages[]` shape, `created_at DESC` | done | unit: "a thread carries the adapter key set"; reversed per I-L6-04 |
| `targets[]`: desktop `current` first, then live desktop sessions, then local tmux | done | L6-04; ordering is the server's, passed through |
| Client merges `{type:'tmux',host,session}` for every live fleet session | done | L6-05; unit: "the rail unions declared targets, live tmux sessions and the history" |

### §2 Send

| Item | State | Evidence |
|---|---|---|
| Target required; option label `"Claude Desktop · <label\|\|'current chat'>"` / `"<host> · <session>"` | done, adapted | I-L6-02 — the rail splits name and host into two slots; L6-09, unit "a Claude Desktop row is labelled the way the old `<option>` was" |
| `#bus-source` defaults to `fleetdeck-ui`, editable | done | L6-10, L6-14 |
| `#bus-message`, "Send now" button | done, adapted | the mock's composer + `Send`/`Queue`; L6-11 |
| `POST /api/messages {source, target, text}` | done | L6-11 asserts the key set is exactly `source,target,text`; unit "deliver POSTs exactly…" |
| ok → clear the text | done | L6-12 |
| `"Delivering message…"` / `"Message delivered"` | done, adapted | I-L6-07 — the mock has no slot for them; they map onto the `queued`→`delivered` receipt. L6-13 |
| `"Delivery failed: <error\|\|'unknown error'>"` | **done, verbatim** | L6-16; units "an HTTP error body is read verbatim" and "a failure with no error field says unknown error" |
| always `loadBus()` afterwards | done | `deliver()` ends `.then(refresh)` |
| Server validation errors displayed verbatim (400/409/413) | done | L6-16, L6-19 |
| Duplicate client `id` idempotency | **n.a.** | today's UI never sends `id`; the body stays the three documented keys |
| `maxlength` 80 / 65536 | **partial** | the mock's composer and `from` chip carry no `maxlength`; the server still enforces `^[A-Za-z0-9._:@/-]{1,80}$` and 64 KiB and its rejection is shown verbatim. Adding the attribute would mean editing mock markup. |

### §3 Statuses and retry

| Item | State | Evidence |
|---|---|---|
| `queued → sending → delivered \| failed` | done | `sending` has no mock label and renders as `queued` (stLabel has no `sending` key) |
| Boot resets stale rows to failed | **n.a.** | server-side (`message-bus.js:54-74`); the client shows whatever status it is handed |
| Row: When · Source · Target · Status · Message · Retry | done, adapted | the mock's chat replaces the table; each message carries `at`, `from` and its own receipt |
| `error` as tooltip | done, adapted | shown inline in the receipt instead — see I-L6-07 |
| Retry only on `failed` | done | L6-17 |
| `POST /api/messages/retry {id}`; 404 / 409 | done | L6-18 asserts the body is exactly `{id}`; L6-19 the 409 text |
| `"Retrying message…"` / `"Message delivered"` / `"Retry failed: <error>"` | done, adapted + verbatim | I-L6-07; L6-19; unit "retry POSTs /api/messages/retry {id} and quotes the 409 verbatim" |
| `#bus-refresh` → `loadBus()` | done, adapted | the 15 s poll replaces the manual button; `FD.screens.bus.refresh()` is still exposed |
| **No poll** today | **deliberately changed** | D08 requires one. 15 s open / 60 s shell, per `BEHAVIOUR.md` §7 |

### §4 Delivery semantics

| Item | State | Evidence |
|---|---|---|
| Per-target FIFO, tmux/desktop transports | **n.a.** | entirely server-side |
| Receipts are `status` + `delivered_at` only; no ack on `/api/messages` | done | `acked` is unreachable in live mode — the mock's `acked` state only ever appears in fixture |

### §5 `setBusTarget(target)` → `FD.screens.bus.open(target)`

| Item | State | Evidence |
|---|---|---|
| Selects the thread immediately when it exists | done | L6-41; unit "open() selects a known thread…" |
| Otherwise selects it on the next load | done, adapted | I-L6-08 — a provisional row, kept across polls. L6-42; unit "…survives a poll" |
| Navigates to the bus screen | done | L6-41 (called from the Registry screen) |
| Called before the screen has mounted | done | unit "open() before attach is remembered, not dropped" |

### §6 Keys, ids, keyboard, server rules

| Item | State | Evidence |
|---|---|---|
| No bus localStorage today | **deliberately added** | `fd-bus-seen`, `fd-bus-pinned` — both required by `BEHAVIOUR.md` §7, names verbatim |
| Ids `#bus #bus-close #bus-form …` | **n.a.** | the mock's markup has none of them; hooks are `data-*`/id only and no markup was added |
| Escape closes the panel | done | the mock's chain (menu → terminal → bus max) is kept; L6-38 |
| Origin gate, `BUS_TOKEN`, body cap | **n.a.** | server-side |
| Errors `{ok:false,error}` displayed verbatim | done | L6-16, L6-19 |

### §7 Mock counterparts and improvisations

| Item | State | Evidence |
|---|---|---|
| Threads grouped by target; rail rows incl. targets with no messages | done | I-L6-01; L6-03, L6-04 |
| Preview = last text, timestamp = last `created_at`, Pinned/Recent split | done | screenshots; L6-27 |
| Unread via `fd-bus-seen`; badge → `FD.shell.setBadge(n)` | done | L6-24..26; 4 units |
| Pinned via `fd-bus-pinned`; pin action in the header | done | L6-27; units |
| Receipts from `status`/`delivered_at`/`error`; failed + Retry | done | L6-13, L6-16, L6-17 |
| Broadcast = N POSTs, correlated by text; per-recipient receipts | done | L6-34, L6-35 |
| Offline banner + `Queue` label (queue chosen, documented) | done | I-L6-12; L6-20..23 |
| Inbound poll 15 s open / 60 s shell | done | I-L6-06; L6-30 |
| Reply toast `"<from> replied"`, preview, Open thread, 7 s | done | L6-31, L6-32, L6-33 |
| Composer `⌘/Ctrl+Enter`; `from` chip = source | done | L6-15, L6-14 |
| Reader view, maximize, pin, show session, copy thread | done | L6-36..40 |
| Show session: tmux → `FD.screens.windows.openMax`, desktop → no-op | done | L6-36, L6-37; unit "setBadge and openMax are safe when L2 and L3 are not loaded yet" |
| Escape priority chain from the mock | done | L6-38 |

**Totals: 41 items — 31 done, 4 done-and-adapted with the reason recorded, 1 partial, 5 n.a.
(server-side or absent from the mock's markup), plus 2 deliberate changes the pack itself asks
for (the poll and the two localStorage keys).**

---

## Hooks

**Provided** — defined as a no-op in the first commit (`440fbaa`), wired in the second:

- `FD.screens.bus.open(target)` — `{type, host?, session}`, or a bare session id.

**Used** — every call site guarded, and proven to survive both absence and a throwing implementation
(unit: "setBadge and openMax are safe when L2 and L3 are not loaded yet"):

- `FD.shell.setBadge(n)` — **L2**. Called with the unread total after every poll and every
  `markSeen`. Absent today; the wrapper swallows it.
- `FD.screens.windows.openMax(host, session)` — **L3**. "Show session" on a tmux thread. Until L3
  lands the wrapper returns `false` and the caller falls back to the mock's own full-screen
  terminal, so the action works either way.

**Dependencies on other slices:** none blocking. L2 and L3 can land in any order.

---

## Deviations, and what the next slice should know

1. **`FD.data.toThreads` does not have the signature the pack promised.** `README.md` §Data
   identifiers says `toThreads(messages, targets, sessions)`; L1 shipped `toThreads(messages, now)`
   returning `{busSessions, busGroups, threads}`, and L1's own report does not flag the difference.
   Nothing is missing — L6 folds `targets[]` and `/api/sessions` in itself — but a slice reading
   the pack alone will write a call that silently ignores its 2nd and 3rd arguments.

2. **`public/v2/index.html` never loads `data.js`.** Nothing in the browser does. `bus.js` injects
   it, tagged `data-fd-dep="data"` so slices share one tag. **Filed as DECK-103**; when the shell
   owner adds the two script tags, delete I-L6-09 and the injection.

3. **A thread's identity is a bare session name** (L1's keying, I-L6-01). Two live sessions with
   the same name on different hosts would share a rail row. Not reachable with today's fleet
   naming; not fixable inside `screens/bus.js`.

4. **New `FD.fixture` keys this screen reads**, all with the mock's literal as the fallback so
   fixture mode is untouched: `busGroups`, `busUnreadDefault`, `busActiveDefault`. Per DESIGN-35
   item 4, they are set only via `FD.setData` and are noted here rather than added to `fixture.js`.

5. **`npm test` was red on base when this slice started** — S2's browser-only `fixture.js` against
   L1's Node `require`. Filed as DECK-70; **resolved** by the L1.1 base move (`fixture-extract.js`),
   and closed.

6. **`design-diff` destroys `verify/<slice>/`.** Worth putting in the pack for the remaining
   slices: keep hand-written verify scripts in a sibling directory.

---

## Commits

| Commit | What |
|---|---|
| `440fbaa` | hooks defined as no-ops, hooks used guarded, goal pack, registry note |
| `1c330de` | the live controller and the guarded bus methods in `logic.js` |
| `78bc2e0`, and later merges | `origin/agent-v2-base` moves (S2 shim fix, S2.2, L1.1, L1.2) |
| — | the live gate harness, the unit tests, the improvisation log, this report |

Pushed to `origin/agent-v2-l6` with a fresh train-broker token per push.

## Registry

`POST http://100.125.231.25:3131/api/registry` answers `unauthorized` / HTTP 401 from german-box —
the known box-side failure. Both rows are recorded in `REGISTRY-PENDING.md` in this directory;
DECK-49 carries the real state. Not a gate, and it did not block anything.

Linear itself was reachable throughout, so there is no `LINEAR-PENDING.md`: DECK-49 (this slice),
DECK-70 (base `npm test`, now Done) and DECK-103 (the unloaded `data.js`) were all filed live.

---

---

# L6.1 — the independent review's four findings (2026-09-07)

Merged `origin/weave/fd-v2` first (clean, no `logic.js` conflict). All four fixed; gates re-run.

| Gate | Before L6.1 | After |
|---|---|---|
| Pixel, fixture mode | 36/36 allPass | **36/36 allPass**, max 0.0329 %, message-bus 0.000000 % both themes |
| Live, API stubbed | 47/47 | **50/50 allPass**, 0 console errors |
| `npm test` | 332/332 | **495/495, 0 fail** (the weave brought the other slices' suites) |

## 1 · HIGH — the reply toast never fired for the selected thread (`bus.js`)

`apply()` read `activeId()`, which is `host.state.busActive` — the *selected* thread, whether or
not the bus screen is on-screen. So `if (id === visible) continue` suppressed the toast for that
thread even after the user had navigated to Accounts: **the primary D08 case never fired.**

Fixed by adding `visibleThread()`, which returns the active thread **only while `busOpen()`**.
That is the mock's own rule — `arrive()` computes `viewing = screen is bus AND busActive is this
session` — so this restores parity rather than inventing one.

Proven both ways: with `visible = activeId()` restored, the new unit test fails; with the fix, it
passes. Live gate:

- **L6-48** select a thread, navigate to Accounts → the bus is off-screen, Accounts is showing
- **L6-49** an inbound row lands on that selected thread → the toast fires with the right `from` and preview
- **L6-50** click **Open thread** → back on the bus, that thread selected, the reply visible, toast gone

Units: "a reply on the selected thread still toasts once the user has left the bus screen",
"no toast for the selected thread while the bus screen is on-screen", "a reply on another thread
toasts whether or not the bus screen is showing".

## 2 · MEDIUM — `state.stOv` grew without bound (`bus.js`)

The prune compared `stOv`'s **client** keys (`x<ts>`, or `x<ts>:<target>` for a broadcast leg)
against **server** ids, so `serverKnows()` never matched and no override was ever dropped.

Now the id `POST /api/messages` returns is recorded by `noteServerId()` — on the optimistic entry
as `srvIds` (a list, because one optimistic message covers N broadcast POSTs) and in a module map.
The optimistic copy is confirmed by id first, falling back to source + text only while the POST is
still in flight; a confirmed send drops its `stOv` entry, its `errs` entry and its `sentIds` record
together. A key that genuinely *is* a server id — a retry — still matches the response directly.

A send the server never confirms keeps its override, because its `failed` receipt and **Retry**
button depend on it. Both directions are covered: "a confirmed send drops its status override
instead of leaking it" and "an unconfirmed send keeps its override and its receipt".

## 3 · LOW — `deliver()`'s unknown-target path skipped the refresh

It now calls `refresh()` like every other exit; a rail that has simply gone stale is what the next
poll fixes. Unit: "delivering to an unknown target still refreshes, in case the rail is stale" —
which also asserts it still posts nothing to a target it cannot name.

## 4 · LOW — `pinnedItems` / `recentItems` ran outside the throw guard

Both are now inside `busSafe()`, so a bad row reaching `isPinned`, `match` or `lastOf` falls back
to the previous render instead of taking every screen down with it.

## Two gate corrections the weave forced

Neither is a product change; both were the gate mis-reading a tree that now has L2 and L3 in it.

- **The hook recorders wrapped, not replaced.** `shell.js` and `windows.js` now provide
  `setBadge` and `openMax` for real and load after any init script, so the old spies were
  silently overwritten. The gate now wraps whatever is present after boot. `setBadge` calls
  through; `openMax` records only — what L6 owes is *"a tmux thread calls
  `openMax(host, session)` and does not fall back to the mock's terminal"*, and L6-36 asserts
  exactly that plus `Session full screen` staying hidden. Driving L3's real xterm overlay would
  make this gate fail on L3's regressions and leave every later check fighting to get back to the
  bus. Absence and a throwing implementation stay covered in `test/v2-bus.test.js`.
- **`/vendor/*` is served.** `server.js:2366-2371` maps the xterm bundle out of `node_modules`,
  not `public/`; the scratch server now answers the same four routes.

---

# L6.2 — every deep link into the bus was dead (2026-09-07)

Merged `origin/weave/fd-v2 @ 79cd53a` first — clean, no `logic.js` conflict.

| Gate | Result |
|---|---|
| Pixel, fixture mode | **36/36 allPass**, max 0.0329 %; message-bus and desktop-sessions 0.000000 % both themes |
| Live, API stubbed | **53/53 allPass**, 0 console errors |
| `npm test` | **560/560, 0 fail** |

## The defect, and why my first repro missed it

DESIGN-35 reported `FD.screens.bus.open()` returning `false` and doing nothing from Desktop
sessions → **Message session**. My first attempt to reproduce it **passed** — `open()` returned
`true` and the bus opened. That was a false negative in the reproduction, not a disagreement:

`AppLogic.componentDidMount` is what called `bus.attach(this)`, and the mock's `Component._mount`
runs a sub's `componentDidMount` the first time **that view** is shown. Reproducing by clicking
the App link mounts `AppLogic` long after `screens/bus.js` has loaded, so the attach lands. The
deployed deck lands straight in the app view (`?view=app` → `fdAsked('view')`, logic.js:1491), so
`AppLogic` mounts inside `app.js`'s `D.mount()` — **before any of the nine screen files exist**.
The guarded call `FD.screens.bus && FD.screens.bus.attach` simply found nothing, `host` stayed
`null` forever, and every deep link (Desktop **Message session**, Registry **Message**, Org **Send
a message**, Windows full-screen **Message**) was dead while threads still painted, because
`bus.live` comes up through the file's own `start2()`.

Reproduced deterministically once loaded the deployed way; the fix is verified against exactly
that entry point.

## The fix — it can no longer depend on load order

Three independent belts, any one of which is sufficient:

1. **`logic.js` — `_busAttach()`**, called from `componentDidMount` **and every
   `componentDidUpdate`**. Idempotent. This alone self-heals, because `bus.js`'s own boot calls
   `FD.setData`, which schedules the render whose `componentDidUpdate` performs the attach.
2. **`logic.js` publishes `FD.screens.busHost = this`.** `runtime.js` creates `FD.screens` before
   any logic runs, so the shell can leave itself there even when no screen file has loaded yet.
3. **`bus.js` attaches on load** if `FD.screens.busHost` is already there — the case where the app
   mounted first.

DESIGN-35 authorised a one-line `FD.host = logic` in `runtime.js` if the instance was not
otherwise reachable. **It was not needed and `runtime.js` is untouched**: belt 2 exposes the
`AppLogic` instance from within this slice's own methods, which is both narrower (the sub, not the
root) and avoids an edit to a file L6 does not own.

`pendingOpen` is kept and drained from `attach()` and `start2()`, so an `open()` that arrives
before the shell is honoured rather than dropped.

## `open()` now accepts every target the server accepts

`normalizeTarget()` handles the tmux `host`+`session` form, a claude-desktop session by name,
`current`, and the `id:<cliSessionId>` form `/api/desktop-sessions` returns as `messageTarget`
(resolved at delivery, server-side). A bare string is taken as a thread id, with `current` and
`id:` recognised as desktop.

**Contract change:** `open()` returns `false` **only for a malformed target**. A well-formed
target that has to wait for the host returns `true` — the deep link was accepted and will land.
The old test asserting `false` on a deferred open was updated to this contract.

## Two things the screenshot caught

- **The label.** `Claude Desktop · id:b5aafd43-265f-49e3-…` names nothing a human recognises. The
  bus now fetches `/api/desktop-sessions` once on first sight of an `id:` target and relabels to
  `Claude Desktop · 🎛 ORCHESTRATOR 28 = O45`, falling back to the raw id if the fetch fails. The
  **target is never rewritten** — the POST body carries the `id:` form verbatim. (I-L6-13)
- **The liveness.** The row read `OFFLINE` with a `Queue` button for a session the Desktop screen
  had just shown as live, because the server's `targets[]` lists desktop sessions by name and
  never carries the `id:` form. The same fetch now answers liveness for that one case.

## Coverage

Unit (`test/v2-bus.test.js`, 44 tests): the `id:<uuid>` messageTarget; the title resolving and its
raw-id fallback; every accepted target form; malformed targets rejected; `open()` before attach
honoured; attach idempotent across repeated and replaced hosts; a send carrying the `id:` target
verbatim; a live desktop `id:` thread not shown as offline.

Live gate: **L6-51** loads `?view=app` (the deployed entry, shell before screen files) and asserts
the *effect* — the bus actually shows the thread, since a queued open legitimately returns `true`
and a return-value check alone would not have caught this. **L6-52** clicks **Message session** on
a live Desktop row and asserts the bus opens on the `id:<uuid>` thread, labelled with the session
title, hash `#bus`. **L6-53** sends and asserts the POST body is the `messageTarget` verbatim.

Both belts were removed and the reproduction re-run to confirm L6-52 fails without the fix
(`bus visible: false`, empty hash) and passes with it (`#bus`).

## Note

`npm test` failed once on `test/v2-data.test.js` "a directory URL serves its index.html" with
`EADDRINUSE 127.0.0.1:33366` — a sibling session on the box, not this change: the same file passes
alone and the pristine `79cd53a` shows the same test green. The clean full run is 560/560.

DECK-103 is fixed on the weave — `index.html` now loads `data.js` and `router.js`. The injection
in `bus.js` (I-L6-09) is left in place as a dormant fallback; it is a no-op whenever `FD.data`
already exists.

**Signed: Gerhild** · frontend-developer · `agent-gerhild` · 2026-09-07
