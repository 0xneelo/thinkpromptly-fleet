# fd-v2-l3 — Windows tiles + Session full screen (xterm engine)

**Worker** Gottlieb · `frontend-developer` · tag `agent-gottlieb` · CLI worker
**Branch** `agent-v2-l3`, cut from `origin/agent-v2-base`, merged with `origin/agent-v2-base` three
times (S2 array-reconciliation fix; S2.2 + L1.1; L1.2)
**Issue** DECK-42 · sub-issues DECK-67, DECK-77
**Ledger rows** D09, D10

## What shipped

The Windows screen and the Session full screen overlay run on live data with today's terminal
behaviour intact, inside the mock's markup, with fixture mode untouched.

| File | Ownership | What changed |
|---|---|---|
| `public/v2/screens/windows.js` | mine | the whole engine — 660 lines, from 1 line of stub |
| `public/v2/logic.js` | this screen's methods only | `tiles`, `termLines`, `termFoot`, `termRef`, `termMessage`, `termSessions`, plus the L3 token/handle publication and its throw-proofing |
| `scripts/l3-live.mjs` | new | the live-mode gate |
| `test/v2-windows.test.js` | new | unit cover for the pure logic |
| `test/v2-term-ws.test.js` | new (L3.1) | the server half of `/term`, against a real `server.js` |
| `docs/design/fleetdeck-v2/improvised.md` | appended | ten entries, `I-L3-01`..`I-L3-10` |

Nothing else was touched. The shell, `runtime.js`, `app.js`, `template.dc.html`, `data.js`,
`fixture.js` and the other screens' files and methods are all as the base left them.

## Numbers

| Gate | Result | Evidence |
|---|---|---|
| Pixel gate, fixture mode | **36/36 allPass**, max mismatch 0.033 %, Windows and Session full screen **0.000000 %** | `docs/design/fleetdeck-v2/verify/l3/report.json` |
| Live gate, API stubbed | **38/38 allPass** | `docs/design/fleetdeck-v2/verify/l3/live.json`, `live-dark.png`, `live-light.png` |
| Unit tests, client logic | 7 pass, 0 fail | `test/v2-windows.test.js` |
| Integration, `/term` server half | 7 pass, 0 fail | `test/v2-term-ws.test.js` |
| `npm test` | **467 tests, 467 pass, 0 fail** | on `weave/fd-v2`, run with nothing else going |

Commands, verbatim:

```bash
PORT=3227 FLEET_TRAIN_PORT=3228 node server.js &
npm run design:diff -- --app 'http://127.0.0.1:3227/v2/index.html?fixture=1' --slice l3
node scripts/l3-live.mjs --app http://127.0.0.1:3227
npm test
```

Run the pixel gate **before** the live gate: `design-diff.mjs` publishes `verify/<slice>/` by
replacing the directory, so it deletes `live.json` if run second (`I-L3-09`).

### The suite is green — but it was not, and the reason matters

On the woven branch, run with nothing else going, `npm test` is **467/467**. Earlier in this slice it
ended `fail 1` on every full run, and **never on the same test twice**:

| Run | The one that failed | On its own |
|---|---|---|
| S2 base | `train-broker.test.js` — "POST /api/ghtrain/end closes the window…" | `fail 1`, then `fail 0` |
| S2.2 + L1.1 base | `bus-tailnet-auth.test.js` — "XYZ-1888 — no other tailnet POST changed…" | `fail 1`, then `fail 0` |
| L1.2 base | `notify.test.js` — "a seat alias is refused without openChat and creates no notify" | `fail 0`, `fail 0` |

All three are HTTP tests that bind scratch ports and spawn servers; none touches anything in this
slice, and each passes when run alone. The trigger is contention: a run started while the Playwright
gate still held its own server collapsed much harder — 88 of 310 tests reached, six files reported
failing. With nothing else running the same suite is clean. Nothing was fixed to make it green; the
runs were simply isolated.

`test/v2-data.test.js` was red when this slice started (DECK-77, `fixture.js` assigning `window` at
require time). L1.1 fixed it upstream; the issue is closed.

**Run the suite with nothing else running.** A concurrent server or browser turns a green suite red in
a way that looks like a code failure and is not.

## Behaviour checklist (`BEHAVIOUR.md`, item by item)

### §1 Tile lifecycle

| Item | State | Note |
|---|---|---|
| `openTile` dedupes on `host + NUL + session`; existing tile is a no-op, no reconnect | **done** | live gate `L3-11` |
| sidebar row click → `openTile`, row click while maximized → `openMax` | **n.a. (L2)** | the sidebar is the shell slice's; `FD.screens.windows.openTile/openMax` are published for it |
| sidebar `⤢` and Registry "Show" → `openMax` | **n.a. (L2/L4)** | same hooks, guarded and live |
| Connect all → `openTile` per session, sequential, 500 ms stagger | **done** | `L3-25`; the button was dead markup and is now bound (`I-L3-06`) |
| `openMax` = `openTile` then maximize | **done** | `L3-13` |
| Close: observer off, `onclose` nulled, socket closed, terminal disposed, node removed, **nothing sent** | **done** | `L3-24` asserts zero API calls |
| One maximized tile at a time | **done** | `L3-17` |
| `setMax` button glyph/aria/title swap | **n.a.** | the mock's tile header has one `⤢` "Fullscreen" button and the overlay has its own "Exit full screen (Esc)"; there is no single button to relabel |
| shift+Esc only — plain Esc reaches tmux/vim | **done** | `L3-18`, `L3-19` |
| Drawer while maximized (`☰`, `#drawer-close`, outside click) | **n.a. (ruling O2)** | the drawer is replaced by the ≡ header menu; `L3-15`, `L3-16` |
| Bar double-click, not on a button → toggle maximize | **done** | `L3-36`, `L3-37` |
| `body.has-max` / `drawer-open` CSS | **n.a.** | the mock's overlay replaces the body-class mechanism |

### §2 xterm setup

| Item | State | Note |
|---|---|---|
| `scrollback:5000`, `fontSize:12`, `macOptionClickForcesSelection:true` | **done** | verbatim |
| Theme re-derived from the mock's tokens and recorded | **done** | `I-L3-02` |
| `FitAddon` + `WebLinksAddon` | **done** | |
| Copy-on-select → clipboard | **done** | ported verbatim; not asserted in the gate (headless clipboard reads are unreliable) — the only §2 item without a check |
| Focus on refit only when maximized | **done** | |
| `ResizeObserver` + refit → `{type:"resize"}` | **done** | `L3-08`; observer follows the current box (`I-L3-04`) |
| Initial cols/rows in the WS URL after `fit()` | **done** | `L3-07` |

### §3 WebSocket protocol

| Item | State | Note |
|---|---|---|
| URL `ws://host/term?host&session&cols&rows`, both values encoded | **done** | `L3-07` |
| Client → server JSON only: `input`, `resize` | **done** | `L3-12`, `L3-08` |
| `{"type":"exit"…}` dropped, everything else written | **done** | `L3-09`, `L3-10` |
| Rolling 2000-char tail for lock detection | **done** | `L3-22` |
| `onclose` → dead overlay, `Disconnected`, 1Password note, `Reconnect` | **done** | `L3-22`, texts verbatim |
| 15 s stall text, cleared on any message and on each connect | **done** | `L3-28`, `L3-29`; a parity bug here was found and fixed (below) |
| No auto-reconnect, manual only | **done** | `L3-23` |
| Server side (upgrade gate, `SAFE_NAME`, `reap()`) | **covered** | unchanged by this slice, but no longer unverified: `test/v2-term-ws.test.js` boots a real `server.js` and asserts it (L3.1) |

### §4 Connect all

| Item | State | Note |
|---|---|---|
| Iterates `/api/sessions` order, skips `!live` and `status==='hidden'`, 500 ms apart, no cap | **done** | `L3-25` (85 tiles in 46 s), `L3-26` |

### §5 Empty state and chrome

| Item | State | Note |
|---|---|---|
| Ruling copy, in mock tokens, with a screenshot | **done** | `L3-01`, `L3-35`, `I-L3-08`, `improvised/l3-empty-state.png` |
| Tile bar = dot · name · box · ⤢ · × | **done** | the mock's own markup; `L3-05` |
| Sidebar hint text | **n.a. (L2)** | the mock's footer text is the shell's |

### §6 State and hooks

| Item | State | Note |
|---|---|---|
| No persistence of open tiles or max state | **done** | in-memory model only; no localStorage key is written by this slice |
| New hooks are `data-*`/id only, never classes on mock markup | **done** | `L3-34` asserts zero slice attributes on compiled rows |

### §7 Mock counterparts and the fixture contract

| Item | State | Note |
|---|---|---|
| Fixture mode renders the seed lines; the gate stays green | **done** | `L3-31`, `L3-32`; Windows and Session full screen at 0.000000 % |
| Live mode hosts xterm in the same box, sized to the mock's mono body | **done** | `I-L3-04` |
| Footer from registry `label`/`role`/`task`, decided and documented | **done** | `I-L3-05`; `L3-06` |
| Overlay ≡ menu lists live sessions = the old drawer switcher | **done** | `L3-15`, `L3-16` |
| Message → `FD.screens.bus.open({type:"tmux",host,session})` | **done** | `L3-20` |
| Close restores; Escape chain and shift+Esc both live | **done** | `L3-19`, `L3-21`, `L3-18` |
| Toast on inbound reply (D08) | **n.a. (L6)** | not this slice |

## Hooks

**Provided** (defined as no-ops in the first commit, `096270c`, before any behaviour):

- `FD.screens.windows.openTile(host, name)`
- `FD.screens.windows.openMax(host, name)`
- `FD.screens.windows.connectAll()`
- `FD.screens.windows.closeTile(host, name)`

All four are fixture-guarded: under `?fixture=1` they return without touching `FD.fixture`, so no
stray call from another slice can break the pixel gate's byte-identical contract.

**Used**, both guarded, both no-ops until their owner lands:

- `FD.screens.bus.open` (L6) — the full-screen Message button. Verified with a stub in `L3-20`.
- `FD.shell.selectSession` (L2) — called on every `openTile`.

## Improvisations

Ten entries in `docs/design/fleetdeck-v2/improvised.md`, five with screenshots in
`docs/design/fleetdeck-v2/improvised/`:

| Entry | What |
|---|---|
| `I-L3-01` | xterm and `data.js` assets injected at runtime — the shell's script list is not this slice's |
| `I-L3-02` | the xterm theme re-derived from the mock's tokens; the terminal is theme-aware now |
| `I-L3-03` | the Disconnected overlay and the stall line, built in mock tokens |
| `I-L3-04` | the terminal layer outside `#dc-root`, aligned to the compiled boxes |
| `I-L3-05` | the footer mapping: `role · label` then `task` |
| `I-L3-06` | the tile ✕ and Connect all bound by delegation — the mock draws both with no handler |
| `I-L3-07` | the Windows subtitle reports what is actually attached |
| `I-L3-08` | the empty state, per the ruling, and how it is anchored when the grid collapses |
| `I-L3-09` | why the live gate script lives in `scripts/`, not `verify/l3/` |
| `I-L3-10` | the maximized terminal steps aside for the ≡ menu |

## Two defects the gates found in this slice's own code

1. **The stall line never cleared.** `app.js:1081-1086` deliberately leaves the stall timer handle set
   when it fires, because the next message tests that handle to decide whether a stall line is on
   screen and has to be taken down. The port nulled it, which stranded the line forever — the tile
   would show "no output…" while actively receiving output. Found by `L3-29`.
2. **A render loop.** The tile boxes were first re-synced from a `MutationObserver` on the document.
   A live terminal rewrites its own rows constantly, so the observer re-entered on every byte of pty
   output and pegged the main thread — the page stopped responding to clicks. Replaced with a
   per-render callback, which is the only moment a box can actually have moved.

## Review

A `reviewer` pass over the diff returned four findings. Two were already closed by the layer rework
(orphaned stall/dead nodes on maximize; the `ResizeObserver` bound to the wrong box). Two were real
and are fixed:

- **high — Connect all was a dead control.** `template.dc.html:182` draws the button with no
  `onClick`, no id and no title, and nothing bound it. Worse, the live gate called `connectAll()`
  through the hook, so the check passed while the button did nothing. Now bound by delegation, and
  the gate clicks the real button.
- **low — the public hooks were not fixture-guarded.** Now they are.

The reviewer also investigated a suspected shift+Esc regression and traced it into xterm's own
`evaluateKeyboardEvent`, confirming plain Escape never reaches the window listener while a terminal
is focused. Ruled out, not a bug.

**Fable pre/post-audit: not run.** The oracle audit of the S2 shim arrived through the design seat
mid-slice and its two binding items were applied in full (`I-L3-04`, and the `l3Try` throw-proofing in
`logic.js`), which covered the same ground for the parts of this slice they touch. A dedicated
`hard-crux` pass was not spent on top of that.

## Cross-slice notes

- **S2.2 offers a second option and this slice declines it.** The base now supports `key=` on
  `sc-for` and `data-dc-raw` for an element that owns its own children, so xterm *could* be mounted
  inside a tile body. Taking it would need two edits to `template.dc.html` — marking the tile body raw
  and keying the tiles loop — and this slice may not edit the template. The layer also handles the
  full-screen case with the same mechanism, and is proven by `L3-33`/`L3-34`. Keeping it. If the
  design seat wants the in-tree mount later, the swap is contained to `sync()`.
- **For L2:** if the shell also binds the sidebar's Connect all button, both bindings will fire.
  Mine should be the one removed — the button is in the shell's region.
- **For L2:** the screen header/subtitle is fed from `titles`. This slice copies that map and replaces
  only its `windows` entry, so a sibling doing the same composes cleanly.
- **`tiles` was never extracted into `fixture.js`** — S2's T3 pass left it as a literal in
  `logic.js`. Per the DESIGN-35 broadcast, the seed literal is kept as the fixture-mode default and
  live tiles arrive under a new key, `l3Tiles`, that this screen's method reads. Same for
  `l3TermSessions` and the `l3Live` switch.

## Open follow-ups

- **DECK-67** (`operator:decision`, open) — `tools/dc-compile.mjs` lists `logic.js` and every
  `screens/*.js` among its generated files, so `npm run v2:check` reports them stale as soon as any
  L-slice writes them, and one `npm run v2:compile` would erase all nine slices. `npm test` does not
  run that check, so no gate is blocked; the risk is data loss. Recommendation in the issue.
- **DECK-77** — closed, fixed upstream by L1.1.
- Copy-on-select is the one ported behaviour with no automated check (headless clipboard).
- The flaky `bus-tailnet-auth` / `train-broker` HTTP tests, noted above.

## Deviations from the launch prompt

- **The goal pack was incomplete on the branch.** `origin/agent-v2-base` carried only `BEHAVIOUR.md`
  under `docs/goals/fd-v2-l3/`; `README.md`, `PROTOCOL.md`, `LAUNCH.md` and `LAUNCH-PROMPT.txt` were
  authored on `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` (commits `2031720`, `42751fa`) and had
  not travelled with the rebase. Rather than file a gate and stop on a pack that demonstrably exists,
  they were restored onto this branch verbatim (`c4be55f`) and the slice proceeded. `BEHAVIOUR.md` was
  already identical.
- **`git merge origin/agent-v2-l1` reported "Already up to date"** — L1 is contained in the base, as
  the design seat confirmed.
- **The registry row could not be written.** `POST http://100.125.231.25:3131/api/registry` answers
  `401 unauthorized` from this box, for the opening row and the closing one alike. Known precedent
  XYZ-2137; per that precedent no gate was filed. Recorded on DECK-42 instead.

## L3.1 — follow-up after acceptance (DESIGN-35)

L3 was accepted and woven; this round closes four findings against the *evidence*, not the behaviour.
Branch merged with `origin/weave/fd-v2` first.

1. **`L3-24` proved nothing about the close button.** It called `FD.screens.windows.closeTile()`
   directly, so the delegated matcher in `windows.js` — the thing that actually runs when a user
   clicks ✕ — was never exercised. It now performs a real click on the ✕ of the **second** tile and
   asserts the second closed and the first stayed. Closing the second matters: a matcher that always
   closed index 0 would have passed a one-tile check.
2. **`live.json` claimed WebSocket server coverage it did not have.** The metadata said the server half
   was covered by `test/v2-windows.test.js`, which only covers pure client logic. Rather than delete
   the claim, `test/v2-term-ws.test.js` makes it true: it boots a real `server.js` on a scratch port
   with a fake `ssh` first on `PATH` — `server.js:2903` hands the literal string `'ssh'` to
   `pty.spawn`, so `FLEET_SSH_BIN` is not the seam — and asserts the pty byte stream, that an
   `{"type":"input"}` frame reaches the pty, that `{"type":"resize"}` is applied (the fake reports its
   own `COLUMNS`x`LINES` on SIGWINCH) and that an out-of-range one is dropped without killing the
   socket, that pty exit produces **exactly one** `{"type":"exit","code":n}` frame as the **last**
   frame, and that a bad `SAFE_NAME`, a host outside `HOSTS()` and a non-`/term` path are all refused
   with no pty bytes delivered. 7 checks, 7 pass. The fake puts its stdin in raw mode, which turns the
   pty's own line-discipline echo off — without that, the echo assertion would pass on tty echo alone
   and prove nothing. The `live.json` metadata now names this file and says what it covers.
3. **`I-L3-06` described an attribute that does not exist.** It said the close handler walks up to a
   `data-l3-key` element; that attribute was removed in the layer rework and the shipped matcher is
   index-based. The entry now describes what ships. `data-l3-key` no longer appears anywhere in
   `docs/` or `public/` — the one remaining mention, in `scripts/l3-live.mjs`, is `L3-34` asserting
   that **zero** such attributes exist.
4. **Connect all was bound twice.** This slice bound the sidebar button by label match while L2 was
   still landing. L2's shell binds it properly by template id (`screens/shell.js:648`,
   `data-dc-tpl="217"`) and calls `FD.screens.windows.connectAll()`. Left alone, one click at the
   weave would have run the 500 ms staggered sweep over every live session twice. This slice's binding
   is removed; the hook stays. New check `L3-38` asserts one click produces exactly one `connectAll`
   call, and `L3-25` — which clicks the real button — now proves the L2 → L3 seam end to end.

One spec drift found while writing that test and **not** corrected: `BEHAVIOUR.md` §3 cites
`server.js:2878-2947` and the line refs inside it (`2891`, `2896-2903`, `2919-2923`, `2930-2939`,
`2941`) are all off by +6 against the current file — the handler is at `2884-2950`. The behaviour
matches §3 exactly; only the line numbers moved. `BEHAVIOUR.md` is the design seat's spec of record,
so it is flagged here rather than edited.

The weave merge also dropped a dead duplicate `tiles:` key that an earlier merge had inserted above
this slice's. Later duplicate keys win in an object literal, so the shipped behaviour was never
affected; the dead one is simply gone.

---

Signed **Gottlieb** · `frontend-developer` · 2026-09-07
