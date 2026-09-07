# fd-v2-l2 — REPORT

| | |
|---|---|
| Worker | **Renate** · `frontend-developer` · tag `agent-renate` |
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Slice | L2 — app shell: sidebar · page header · right rail (ledger D03, D04, D05, + D06 with L1) |
| Branch | `agent-v2-l2` off `origin/agent-v2-base` — pushed |
| Linear | **DECK-56** (main) · DECK-57 … DECK-60 (sections) · DECK-81, DECK-82 (raised) |
| Date | 2026-09-07 |

## Result

| Gate | Result | Evidence |
|---|---|---|
| Pixel gate, fixture mode, 36 screens | **`allPass: true`**, max mismatch **0.032948 %** | `verify/l2/report.json` |
| Live-mode proof, API stubbed | **59/59**, `allPass: true`, **zero console errors** | `verify/l2/live.json`, `live-dark.png`, `live-light.png` |
| Unit tests (`test/v2-shell.test.js`) | **24 pass** | below |
| `npm test` | **465 pass / 0 fail** (woven tree) | below |
| Improvisation log | 15 entries, 7 screenshots | `improvised.md` §L2, `improvised/l2-*.png` |

The pixel maximum is the same number on the same screen (`registry` dark) that S1, S2 and my own
control run before writing any code all measured: `0.03294753086419753`. Fixture mode is untouched to
the digit.

## What shipped

| File | What it is |
|---|---|
| `public/v2/screens/shell.js` | the slice — 640 lines: fetch, adapt, `FD.setData`, the four hooks, the improvised layer |
| `public/v2/logic.js` | **four hunks**, all guarded: `groups`, `miniAccounts`, `boxRows`, the nav badge |
| `docs/design/fleetdeck-v2/verify/l2-live/live.mjs` + `stubs/` | the live proof and six hand-written API variants |
| `docs/design/fleetdeck-v2/verify/l2-live/shots.mjs` | the improvisation screenshots |
| `test/v2-shell.test.js` | 24 unit tests over the pure halves, the fixture-mode gate and the badge boot race |
| `docs/design/fleetdeck-v2/improvised.md` | 15 entries, I-L2-01 … I-L2-15 |

Commits: `4da1a09` (pack + seam) · `bef3c0a` (the slice) · `8afc195` (the oracle audit's three
rulings) · `ab8251b` (scroll churn) · the reviewer's findings, plus three base merges (S2.2, L1.1, L1.2).

## The shape of the slice, and why

**The mock's markup gives the shell three data slots and no handlers.** `A_groups`, `A_miniAccounts`
and `A_boxRows` are the only value-bound lists in the sidebar and rail; `Connect all`, `Refresh` and the
`Live API` pill carry a style and nothing else, and a session row's only `onClick` is `A_goWindows` —
the same function the nav's Windows button uses, with no row argument.

That splits the slice cleanly in two, and the split is the design:

- **Data goes through `FD.setData`** as `l2Groups`, `l2Accounts`, `l2Boxes`, `l2Badge` — four keys S2
  did not substitute, named per the design seat's broadcast point 4. Each of the four reads in
  `logic.js` keeps the mock's own seed literal as its default, so with no live data the fixture renders
  the same bytes. That is why the pixel gate is unchanged rather than merely close.
- **Everything else is applied after each render**, addressed by `data-dc-tpl` — the compiler's stable
  node ids, which are `data-*` hooks and not classes grafted onto mock markup. The hook is
  `AppLogic.prototype.componentDidMount/componentDidUpdate`, wrapped from `shell.js`; `logic.js` carries
  no shell plumbing.

**The oracle audit changed the second half.** The first working build appended a `⤢` to each row, a
toggle strip into the sidebar list, a `€` span into each account row and the empty state into the
Windows screen. The audit's binding ruling 1 forbids exactly that: foreign DOM inside a compiled node
is deleted whenever that parent's child list changes (F3), and stranded on the wrong row when a poll
reorders a positional `sc-for` (F1). Rewritten: one `#fd-l2-layer` on `document.body`, outside
`#dc-root`, holding **three** reused elements positioned over the nodes they belong to — one `⤢` that
follows the hovered row, one strip pinned to the foot of the sidebar list, one empty-state line. The
`€` needs no node at all now; it prefixes the value the rail already renders (`€71%`). Nothing per row
exists to go stale, and a row is resolved by its position among the rows rendered at that moment,
looked up in the same flat index the paint pass walks.

Ruling 2 is honoured on both sides of the seam: rows without a host or a name never reach `FD.setData`,
health and credits rows are type-checked, and each of the four `logic.js` reads takes `Array.isArray`
and guards every field access, so a malformed row cannot throw and blank all nine screens. Ruling 3 has
nothing to bite on — this slice binds no input.

## Behaviour checklist

Every item of `BEHAVIOUR.md`, in its order.

### §1 Sessions list

| Item | State | Note |
|---|---|---|
| `GET /api/sessions` → `d.sessions`, `norm()` defaults | **done** | `norm()` is `app.js:182` verbatim; unit-tested |
| only `s.live` rows listed | **done** | `A04`; dead rows excluded (`B02`) |
| `showHidden` `'1'`/`'0'`, hidden rows excluded when off | **done** | `B01`, `B09` |
| toggle text `show N hidden` / `hide hidden`, re-runs `loadSessions()` | **done** | verbatim; `B03`, `B04` |
| grouping, host divider in API order, list never re-sorted | **partial** | order and no-resort are exact; the mock groups **always**, where today a single host gets no divider (I-L2-12) |
| `.inactive` on a shown hidden row | **done** | rendered at `opacity .45`, as `style.css:141`; `B05` |
| row `title` = `"<name> [· <label>] · active <ago>"` | **done** | `A05`, `B07`; `ago` from `FD.data.ago` |
| amber dot on `kill-requested` | **done** | mock's `warn` token; `B06` |
| green dot when the tile is open | **done** | via guarded `FD.screens.windows.openKeys()`; `A11` |
| row contents: dot, name, ghost `⤢` | **done** | `⤢` improvised as one hover-following button (I-L2-04); `A07` |
| `⤢` → `openMax`, click propagation stopped | **done** | `A10` — `openMax` only, no `openTile` |
| row click → `openMax` while maximized, else `openTile` | **done** | `A08`, `A09` |
| error rows `"<host>: <message>"` | **done** | `C01` |
| `"no sessions"` when empty and no errors | **done** | `C03`; never both (`C02`) |
| `#refresh` → `loadSessions(); loadHealth(); loadAccounts();` | **done** | `A13` — those three, nothing else |
| no interval for the list | **done** | `A25` — 2.5 s idle, zero requests |

### §2 Health pills → right-rail "Boxes"

| Item | State | Note |
|---|---|---|
| `GET /api/health` → `data.hosts` or a bare array | **done** | both shapes handled |
| fetch failure → one red `health unreachable` | **done** | `D04` |
| `agentLocked` → amber + tip | **done** | `D01`–`D03`, tip verbatim |
| `kind==='linux'` → `reachable` / `unreachable` + tips | **done** | both tips verbatim |
| `holderOk===null \|\| wslAlive===null` → amber `unreachable` + tip | **done** | both null cases unit-tested |
| `holder OK` / `HOLDER DOWN` + `HOLDER_TIP` | **done** | tip verbatim |
| markup `div.pill > span.dot + text`, `title=tip` | **adapted** | the mock's box row splits the one pill string into name + status (I-L2-09); tips are `title` attributes |
| colours `#22c55e / #ef4444 / #f59e0b` | **adapted** | the mock's `good`/`warn`/`bad` oklch tokens — that substitution *is* ledger D06 |
| no polling; loaded at boot and on Refresh | **done** | `A25` |

### §3 Accounts mini → right-rail bars

| Item | State | Note |
|---|---|---|
| `GET /api/credits` → `d.rows` | **done** | |
| `pct` = max numeric `.pct`, codex vs others | **done** | `E01`; six unit cases incl. `seven_day_fable` exclusion |
| bar width `clamp(pct,0,100)%` | **done** | the mock's `barFill` already clamps at 0; `E04` |
| red > 90, amber ≥ 70, else green | **done** | `E02`, `E03`; the red tone is new to the rail (I-L2-10) |
| label `full.split(' ')[0] + (codex ? ' ·gpt' : '')` | **done** | `A16`, `E06` |
| `'—'` when pct is null | **done** | the mock prints `no data`; BEHAVIOUR wins (I-L2-10) |
| `€` flag when `credits.capped` | **partial** | it marks the value (`€71%`) rather than being its own span — the mock's row has three cells. **The `#f0836b` colour is lost** (I-L2-07); `E05` |
| tooltip: label/email, pct summary, credits used/limit, source | **done** | `A17`, `E07`, and `improvised/l2-account-tooltips.txt` |
| "detail" link → `/accounts.html` | **adapted** | the mock's rail header `⋯` opens the Accounts **screen** — the same destination, once L11 lands the cut-over |
| failure text `accounts unavailable` | **done** | `E08` |
| loaded at boot and on Refresh; no interval | **done** | `A01`, `A13`, `A25` |

### §4 Nav and `sync()`

| Item | State | Note |
|---|---|---|
| `fleetOpen`/`orgOpen`/`busOpen`, `windowsOpen` | **n.a.** | the three overlays became nav screens; `AppLogic.state.screen` is the one selector |
| `.sel` + `aria-selected` on the nav buttons | **done** | the mock's `navBtn(screen === …)` already does it, per render |
| `.open` per `tiles.has(key)` | **done** | expressed as the row dot tone (§1) |
| `#empty.hidden = tiles.size > 0` | **done** | shows when the tile grid is empty, counted off the DOM (I-L2-08) |
| **new** empty copy per the operator's ruling | **done** | verbatim, one sentence, no button; `C04` |
| `#empty-fleet` → `toggleFleet(true)` | **n.a.** | removed with the copy it belonged to |
| nav buttons → `toggleOrg/Fleet/Bus` + their loads | **done** | the mock switches screens; each screen's load is its own slice's |
| links to `/keys.html`, `/accounts.html`, `/machines.html`, `/sessions.html` | **n.a.** | they are nav items now; the real cut-over is L11 |
| `#drawer-close`, outside-click closes the drawer | **n.a.** | the mock has no drawer — the sidebar is permanent and collapsible (I-L2-15) |
| Escape closes fleet/org/bus | **n.a.** | nothing to close; `AppLogic` already binds Escape for the full screen, the terminal menu and the maximised bus |

### §5 Theme

| Item | State | Note |
|---|---|---|
| `?theme=` > localStorage > `prefers-color-scheme`, default dark | **done** | `FD.data.theme()` alone would default to dark with no key at all, so the OS branch is kept here |
| `fleetTheme` → `fd-landing-dark` migration | **done** | L1's `FD.data.theme()`; `F01` |
| `documentElement.dataset.theme` + `style.colorScheme` | **done** | `A22`, `A24` |
| toggle text `"☀ Light"` / `"☾ Dark"` | **n.a.** | the mock's control is an icon button with no label slot (I-L2-13) |
| `aria-pressed`, `title="Switch to <other> theme"` | **done** | verbatim; `A23`, `A24` |
| toggle flips, saves, re-syncs | **done** | the mock's own `toggleMode` writes the key; the attributes follow on the next render |

### §6 Keys, ids, timers

| Item | State | Note |
|---|---|---|
| localStorage `fleetTheme`, `showHidden` | **done** | `showHidden` verbatim; `fleetTheme` read once then migrated (D06) |
| the sixteen old DOM ids | **n.a.** | replaced by the mock's markup; every hook is a `data-dc-tpl` id or a `data-*` attribute |
| no timer for sessions / health / accounts | **done** | `A25` |
| `tickOrgTimes` 1 s, `loadOrg` 30 s | **n.a.** | org chart timers, L5's |

## Hooks

**Provided** (defined as no-ops in the first commit, `4da1a09`, before any of them was wired):

| Hook | State |
|---|---|
| `FD.shell.setBadge(n)` | live — `l2Badge` overrides the bus count on the nav badge; `A20`, `A21` |
| `FD.shell.setLiveApi(text)` | live — the page-header pill, ruling O4; `null` restores `Live API`; `A18`, `A19` |
| `FD.shell.refresh()` | live — the three loads; `A13` |
| `FD.shell.selectSession(host, name)` | live — full screen switches, otherwise a tile |

`FD.shell.__pure` is also exported: the pure halves, for `test/v2-shell.test.js`. Nothing in the page
reads it.

**Used**, all guarded, all L3's:

| Hook | Behaviour when L3 is absent |
|---|---|
| `FD.screens.windows.openTile(host, name)` | the click is a no-op; the mock still switches to Windows |
| `FD.screens.windows.openMax(host, name)` | same |
| `FD.screens.windows.connectAll()` | the button is inert |
| `FD.screens.windows.openKeys()` *(not in the pack)* | every session dot is idle |
| `FD.screens.windows.isFullScreen()` *(not in the pack)* | falls back to the visibility of `[data-screen-label="Session full screen"]` |

**Two dependencies L3 should know about.** `openKeys()` and `isFullScreen()` are not in the pack's hook
list; I need them for BEHAVIOUR §1's green dot and for "switch while maximized", and neither can be
derived from the DOM reliably once tiles are real. `openKeys()` may return either `{host, name}` objects
or pre-joined keys. Both have a defined fallback, so L3 can ignore them and nothing breaks — the dot
stays idle and the row opens a tile.

## Verification

### Live-mode proof — `verify/l2-live/live.mjs`

Serves `public/` on loopback, routes `/api/*` to the captured fixtures in
`docs/design/fleetdeck-v2/fixtures/api/`, drives the page and writes `verify/l2/live.json`. Six
scenarios, 55 checks:

| Scenario | Stub | Checks |
|---|---|---|
| A · captured fixtures | `sessions/health/credits.json` as captured | 26 — grouping, counts, titles, dots, both click paths, `⤢`, Connect all, Refresh, the rail, both hooks, the theme, no polling, a clean console |
| B · hidden rows | `stubs/sessions-hidden.json` | 9 — exclusion, the two toggle texts, persistence, dimming, the amber dot, the label in the title |
| C · errors, empty, unkeyable | `stubs/sessions-errors.json`, `sessions-empty.json`, `sessions-unkeyable.json` | 5 |
| D · health branches | `stubs/health-branches.json`, plus a 500 | 4 — all five branches' texts, tones and tips in one payload |
| E · credits variants | `stubs/credits-variants.json`, plus a 500 | 8 — the pct rule, both thresholds, the em dash, `€`, the codex suffix, the tooltip |
| F · theme and fixture mode | legacy `fleetTheme`, `?theme=`, `?fixture=1` | 7 |

The captured `sessions.json` contains no hidden row, no `kill-requested` row and no error, and
`credits.json` no capped pool and no window past 90 %. Those five states are the hand-written stubs in
`verify/l2-live/stubs/`; each is small and quoted in the file.

**`F02` is the one that guards everybody else's work:** loaded with `?fixture=1` the slice issues zero
`/api/*` requests and does not even load `data.js`, and `F03` confirms the mock's own seed groups still
render.

### The live proof runs L2 alone

Once the weave landed, the page under test stopped being the shell and became the whole app: L3's
terminals cover the sidebar the moment a row is clicked, five more slices fetch their own endpoints,
and a failure here would have said nothing about L2. The harness therefore serves the other eight
`screens/*.js` files empty (`isolate`, on by default) and the L3 seam is a **spy** rather than a
stand-in — it records `openTile` / `openMax` / `connectAll` and hands them on, so the checks prove the
shell talks to the real hook when there is one. Cross-slice behaviour is the weave's to prove, and
`verify/l2/live.json` says what it can honestly say: L2 works.

### Order matters

`scripts/design-diff.mjs` **republishes `verify/<slice>/` wholesale** — it renames the directory away
and moves a staging directory into place. It ate the first copy of this harness. The harness and its
stubs therefore live in `verify/l2-live/` and only the results land in `verify/l2/`. **Run the pixel
gate first, then the live proof**, or `live.json` is deleted by the next gate run.

### `npm test` — 322 pass, 0 fail

Green on the current base. Two things had to be established to say that honestly.

**DECK-81 is fixed by the base, not by me.** When I first ran the suite, `test/v2-data.test.js` threw
`ReferenceError: window is not defined` — the generated `fixture.js` carried a browser-only preamble and
L1's test `require`s it, so all 65 of L1's data-layer tests never ran. I proved it was inherited by
checking out `origin/agent-v2-base` into a scratch worktree with no L2 code in it and reproducing the
identical error, and filed **DECK-81**. L1.1 landed `public/v2/fixture-extract.js` and the file is now
requirable; `test/v2-data.test.js` runs 74 tests and passes.

**The reaper suites are flaky, and it is not this slice.** Intermediate runs showed 19, then 13, then 1
failure, always in `reaper.test.js` / `lease.test.js` / `seats-fencing.test.js` and never in a v2 file.
Same tree, same three files, back to back:

```
node --test test/reaper.test.js test/lease.test.js test/seats-fencing.test.js
  run 1 → tests 60, pass 46, fail 14
  run 2 → tests 60, pass 60, fail  0
```

They are wall-clock-sensitive suites that lose races under load — a clean checkout of the base shows the
same behaviour (9 failures in one `reaper.test.js` run, 2 in a full run). The v2 files are deterministic:
`v2-shell` 19/19 and `v2-data` 74/74 on every run. Reported so the next slice does not spend an hour on
it, and worth a Linear issue from whoever owns the reaper.

## Deviations and open items, stated plainly

1. **The reaper suites are flaky.** Not mine, not v2, but the next slice will trip over it: same tree,
   back to back, `reaper`+`lease`+`seats-fencing` scored 14 failures then 0. Worth an issue from whoever
   owns them.
2. **Registry row not written.** `POST /api/registry` answers `401 unauthorized` from the box, for the
   opening call. Known box-side 401 (XYZ-2137), the same one L1 hit; per that precedent no operator gate
   is filed. There is no `FD-v2-l2` row; DECK-56 is the record. Logged in `LINEAR-PENDING.md`.
3. **The four Linear labels the pack names do not exist** in this workspace — `agent:renate`,
   `project:remote-system`, `subproject:fleetdeck-v2`, `session:cli-worker` were each rejected by
   `addLabels` with "Could not find label". DECK-56 and its sub-issues carry none. Logged in
   `LINEAR-PENDING.md` for the operator to create them or drop the requirement.
4. **`data.js` is not in `index.html`** and the shell loads it itself (I-L2-01). The real fix is one
   `<script>` in the compiler's head list — S2's file. Every slice that wants the data layer needs this
   until then; the loader is parked on `FD.__dataLoading` so they can share one load.
5. **The page-header subtitles are mock copy** and the Windows one reads "4 tiles attached · german-box
   · holder OK" on live data. `README.md` §Scope 4 says to take title and subtitle from the `titles`
   map, so L2 does. Raised as **DECK-82** with three options and a recommendation.
6. **`npm run v2:check` is now stale by construction.** It regenerates `logic.js` from
   `template.dc.html` and compares; nine slices are each adding their own methods to `logic.js`, so the
   round-trip cannot hold past S2. It is not in `npm test`, and no gate of mine depends on it. Flagging
   it because the S2 report lists it as a green gate and it will not stay one.
7. **The `€` capped flag lost its colour** (I-L2-07). Small but real; recorded rather than glossed.
8. **Single-host fleets now get a group header** where today they get a bare list (I-L2-12). The mock's
   sidebar is built out of box groups; overruling this is a one-line change if the design seat prefers
   today's behaviour.
9. **The theme toggle's label is gone**, its title and `aria-pressed` are today's (I-L2-13).
10. **`AppLogic.prototype` is monkey-patched** for an after-render hook, from `shell.js`, wrapping
    rather than replacing. It composes if another slice does the same. The alternative was a line of
    shell plumbing in `logic.js` that nine slices would then conflict over. Stated so a reviewer can
    overrule it.

## L2.1 — after the weave

Three things, on `agent-v2-l2` merged with `origin/weave/fd-v2`.

**`setBadge(n)` dropped the count while the shell was still booting.** It returned early when
`!ready`, so a count L6 reports during its own synchronous mount — which races the shell's asynchronous
`data.js` load — was lost until L6 happened to call again, and on a quiet bus that could be never. It
now remembers the last count the way `setLiveApi` remembers its text, and applies it when `ready`
flips. Four unit tests cover it, including the case where nobody ever calls (no `l2Badge` key, so the
bus's own count still wins) and a nonsense argument (`0`, never the template's problem). **Mutation-
tested:** restoring the early return fails three of the four.

**The Windows empty state is now L3's.** L3 renders the same operator sentence from `windows.js`, keyed
to the tile model it owns rather than to a DOM count. Drawn from both files the user saw it twice, so
L2 yields. `EMPTY_COPY` stays in `shell.js` only so a unit test asserts the two files still quote the
operator word for word. Two further duplications between L2 and L3 — the "Connect all" binding and a
doubled `openTile` on a sidebar row click — are filed as **DECK-104** with evidence; both need an
ownership ruling rather than a unilateral fix.

**The screenshot count in this report was wrong** — seven PNGs, not six. `l2-right-rail-offline.png`
was captured but never cited; it now belongs to I-L2-09, which is where the two whole-list failure
states (`health unreachable`, `accounts unavailable`) are described.

## The reviewer pass, and what it changed

A Sonnet `reviewer` on the whole changeset returned six findings. Two were real behaviour bugs, one was
a real hole in my own tests, and three were smaller. All six are fixed.

1. **`?theme=` was persisted** (high). `applyTheme()` wrote the query answer into `fd-landing-dark`.
   Today's app holds it in a variable and only the toggle writes storage (`app.js:11-20` vs `60-63`), so
   one shared `?theme=light` link would have overwritten the user's saved theme for every later visit.
   The override is now handed to `AppLogic` once, on mount, as `state.dark` — which the mock's own
   `isDark()` reads before storage — and nothing is written. Three new live checks, `F05`–`F07`.
2. **"no sessions" counted the wrong rows** (medium). The fallback tested the raw session list while the
   sidebar renders the *validated* one, so a live row the API cannot key (no host, or no name) would
   leave the sidebar completely empty with no explanation. It now counts what could actually be
   rendered. New live check `C05` with its own stub.
3. **A vacuous test** (medium). `assert.ok(!shell.__pure.__loaded)` checked a property nothing ever
   sets — true no matter what fixture-mode detection did. Replaced with three real cases: both routes
   into fixture mode leave `FD.__dataLoading` untouched and append no script; a live boot **does** create
   it and appends exactly one `/v2/data.js`; and `?fixture=0` is a live boot. The negative case is the
   point — it proves the check is not simply always true.
4. **Painting raced the render** (low). `FD.setData` schedules its re-render on a microtask, so painting
   in the same tick read the previous render's DOM against the new data. The paint is now queued behind
   it, and still covers the case where the app view is not mounted and no `componentDidUpdate` arrives.
5. **`tokens()` re-runs `renderVals()`** (low). Accepted, and already reduced: it is cached per theme, so
   it runs on a theme change rather than on every paint. It is the only way to reach the mock's token
   table from outside the logic.
6. **The ⤢ could be stranded** (low). Hover was only cleared by moving onto another element, so leaving
   the window over a row left the button visible. `mouseleave` on the document and `blur` on the window
   now clear it.

**Both new checks were mutation-tested**, because this project's own standard is that a gate nobody has
seen fail is not evidence. Putting the `write()` back fails `F06` (`58/59`); restoring the raw-row count
fails `C05` with `foot=[]` — literally the empty, unexplained sidebar the finding described.

## Subagents

A Sonnet `reviewer` on the diff, findings above. The protocol's `hard-crux` audits were not run: this session's driver
is already at that tier for the decisions involved, and the design seat's own oracle audit of the shim
arrived mid-slice and was the binding review — I rewrote the improvised layer to satisfy its ruling 1
before pushing. Reads were done inline rather than delegated, because the slice turns on the exact
bytes of four compiled files and a summary of them would not have been usable.

—
**Renate** · frontend-developer
