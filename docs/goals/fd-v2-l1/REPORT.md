# fd-v2-l1 — REPORT

| | |
|---|---|
| Worker | **Juergen** · `frontend-developer` · tag `agent-juergen` |
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Slice | L1 — data layer, fixture mode, v2 routing (ledger D06, D18–D20) |
| Branch | `agent-v2-l1` off `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` — pushed |
| Linear | **DECK-33** (main) · DECK-34 … DECK-38 (subtasks) |
| Date | 2026-09-07 |

## What shipped

| File | What it is |
|---|---|
| `public/v2/data.js` | 19 fetchers, 9 pure adapters, fixture mode, `poll()`, `theme()`, `ago()` |
| `public/v2/router.js` | `?view=land\|app\|deck` + `#screen` hashes; `route()` / `navigate()` / `onChange()` |
| `public/v2/fixture.js` | **generated** — the mock's seed arrays on `window.FD.fixture` |
| `public/v2/orgchart.js` | byte-identical copy of `public/orgchart.js` (asserted by a test) |
| `tools/extract-fixture.mjs` | the extractor; `npm run v2:fixture` / `v2:fixture -- --check` |
| `test/v2-data.test.js` | 56 tests |
| `server.js` | one ternary arm so a directory URL serves its `index.html` |
| `docs/design/fleetdeck-v2/improvised.md` | 11 entries (I-L1-01 … I-L1-11) |

Commits: `a918cc5` (server fix) · `ff76a68` (extractor + fixture) · `9e5c0d1` (data layer, router, tests).

## The design decision that shaped the slice

The mock's seed arrays are not data. They are local `const`s inside `AppLogic.renderVals()`
(`mock/Fleetdeck Final.dc.html` L1245–L2004) whose elements mix three layers: plain values,
theme-derived style objects (`dot(t.good)`, `chipTone('neutral')`, `bar(...)`), and closures added by
trailing `.map()` chains (`openTerm`, `toggle`, `copyConv`).

**L1 emits the data layer only** — the fields `diff.md` §"Binding map" names. Styles are rebuilt per
render from the theme token object `t`, so a row carrying baked styles renders wrong in the other
theme and cannot pass a pixel gate that runs both. Closures are the screen slices' job. The binding
map corroborates the line: for the org chart it lists the *arguments* of `orgCard()`, not its
returned keys. Full reasoning: `improvised.md` I-L1-01 and I-L1-02.

## Shape table

One row per mock seed array. **Target identifier** is the `FD.fixture.<name>` the ruling fixes, and
the name L2–L10 pass to `FD.setData(name, adapterOutput)`.

| Target identifier | Adapter | Source endpoint | Keys emitted (in order) | Types |
|---|---|---|---|---|
| `tiles` | `toTiles(sessions)` | `GET /api/sessions`, live rows | `name, box, foot1, foot2, lines` | str, str, null, null, [] |
| `groups` | `toGroups(sessions)` | `GET /api/sessions`, live rows, grouped by `host` | `box, n, items[{n}]` | str, num, arr |
| `regData` | `toRegistryRows(sessions)` | `GET /api/sessions`, all rows | `id, s, g, tk, st, active, msg, seen` (+`gone` when not live) | all str; `gone` bool |
| `orgScopeData` | `toOrg(sessions, seats).scope` | `GET /api/sessions` + `GET /api/seats` | `{machine:{host:[[name,role,path(,false)]]}, project:{group:[…]}}` | obj of arrays of tuples |
| — (`orgCard()` args) | `toOrg(...).cards` | same | `name, on, role, path, grp, epoch, lease, age, exp` | str, bool, str, str, str, num, str, str, str |
| — (`buildTree`) | `toOrg(...).roots` / `.unattached` | same | `FleetOrgChart.buildTree` output, unchanged | nodes |
| `busSessions` | `toThreads(messages).busSessions` | `GET /api/messages?limit=50` | `id, name, host, live` | str, str, str\|null, null |
| `busGroups` | `toThreads(...).busGroups` | — | `[]` — the API has no group concept | arr |
| `seedThreads` | `toThreads(...).threads` | `GET /api/messages?limit=50` | out: `k, dir, from, at, m, status, text` · out failed: `…, status, err, text` · in: `k, dir, from, at, m, text` · broadcast: `k, dir, from, at, m, per, text` | `m` num, `per` obj, rest str |
| `keyRows` | `toKeys(sshkeys, ghtrain).keyRows` | `GET /api/sshkeys` | `name, fp, comment` | str, str, str |
| `accounts` | `toAccounts(credits)` | `GET /api/credits` | `prov, name, email, id, plan, live, right, bars, trendPts, seen` (+`staleNote`, `banner`) | str×7, arr, arr\|null, str |
| `machines` | `toMachines(machines)` | `GET /api/machines` | `name, kind, sessions, cols[{client, sections[{env,name,email,chips,bars,note}]}]` | str, str, str, arr |
| `dsData` | `toDesktop(desktopSessions)` | `GET /api/desktop-sessions` | `name, email, acct, machine, rows[{title,path,branch,model,when,turns,created(,cli,sid,live)}]` | str×4, arr |
| `titles` | — static, no adapter | — | `{screen: [title, subtitle]}` | obj of tuples |
| `gbSessions` | — static, no adapter | — | `string[]` | arr |

`bars` sub-shape: `{label, pct, resets(, stale)}` — str, num\|null, str\|null, bool.
`machines` `chips` / `bars` stay positional tuples (`["claude_max","neutral"]`,
`["5 hour", null, true]`) because that is what the mock passes to `mSec()`.

## Note for Julius (S2) — substitution T3 is byte-safe for 9 of 13, not all 13

The ruling has S2 rewriting `logic.js` to `const X = FD.fixture.X`. That is a **byte-identical
substitution only where the mock's literal is pure data.** Checked literal by literal:

| Byte-safe — substitute directly (9) | Not byte-safe — the literal calls a theme helper (4) |
|---|---|
| `regData`, `busSessions`, `busGroups`, `seedThreads`, `orgScopeData`, `keyRows`, `dsData`, `titles`, `gbSessions` | `tiles` (`lines[].style.color = t.ink75`), `groups` (`dot(t.good)`), `accounts` (`bar()`, `chipTone()`, `spark()`), `machines` (`mSec()`) |

For those four, `FD.fixture.X` holds the **data** and `logic.js` must keep applying the helper. The
substitution becomes a one-line map rather than a bare assignment — e.g.

```js
const groups = FD.fixture.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, dotStyle: dot(t.good) })) }));
```

This is not a divergence from the ruling so much as the only form it can take: `dot(t.good)` is
recomputed from `t` on every render, and `t` differs between dark and light, so a frozen style in the
fixture would render wrong in one theme and fail the pixel gate. Same reason `accounts[].trendPts`
holds the raw history numbers and the template re-runs `spark()` on them. See `improvised.md`
I-L1-01/I-L1-02; happy to take the other shape if the design seat rules differently.

## Verification

| Check | Result |
|---|---|
| `npm test` | **285 pass, 0 fail** (229 before this slice, 56 new) |
| `test/v2-data.test.js` alone | 56 pass |
| `npm run v2:fixture` idempotent | yes — second run leaves the file byte-identical |
| `npm run v2:fixture -- --check` | exits 0; wired into `pretest`, so `npm test` fails on a stale fixture |
| Adapter shapes vs mock | all 9 match key list **and order**; asserted per adapter |
| Fixture mode | every seeded fetcher returns the mock array deep-equal and key-order-equal |
| `/v2/` resolves | 200 through a real `node server.js` on a scratch port, same body as `/v2/index.html` |
| Traversal guard | `/../server.js`, `/v2/../../server.js`, `/%2e%2e/`, `/v2/..%2f..%2f` all refused |
| Same-origin | asserted by a test — no absolute URL in `data.js` outside comments |
| Operator's live deck | never contacted; adapters run only against the captured fixtures |

## Acceptance (README §Acceptance)

- [x] `public/v2/data.js`, `router.js`, `fixture.js`, `orgchart.js` present; `npm test` green including `test/v2-data.test.js` — 285/285.
- [x] Fixture mode returns arrays deep-equal + key-order-equal to the mock's seed arrays; `npm run v2:fixture` idempotent. Read as the layer-1 projection — layers 2 and 3 are theme-dependent and non-serializable, so nothing on disk can equal them theme-independently (I-L1-01).
- [x] Every adapter output validated against the mock shapes — shape table above, one row per array.
- [x] `/v2/` resolves — 200 via `node server.js` on a scratch port; the change is quoted in commit `a918cc5`. The shell itself is S2's `public/v2/index.html`, so the test supplies a stand-in when that file is absent and uses the real one when present.
- [x] No fetch to any host but the page origin; no call to the operator's deck.
- [x] `reviewer` pass clean; branch pushed; `REPORT.md` signed; registry — see below.

## Deviations and open items, stated plainly

1. **Registry row not written.** `POST /api/registry` answers `unauthorized` from the box for both the
   opening and closing calls. This is the known box-side 401 covered by XYZ-2137, so per that
   precedent I did not file a gate. The registry has no `FD-v2-l1` row; the Linear issues are the
   record.
2. **Fable was unavailable.** The protocol's `hard-crux` pre-audit of the layer-boundary decision and
   the post-audit of the diff both hit `You've reached your Fable limit` (HTTP 429). I made the call
   myself on the evidence and wrote it up in full (`improvised.md` I-L1-01) so it can be overturned
   cheaply. **The design seat should treat I-L1-01 as unaudited.**
3. **O6 looks narrower than the ledger assumes.** `/api/credits` already returns `history[]` on 4 of 5
   captured rows. The planned `L8s` server rider may be unnecessary or much smaller (I-L1-11).
4. **`groups[]` key is `items`, not `sessions`** — the binding map says `sessions[]`, the mock says
   `items`. The mock wins; ledger correction for the design seat (I-L1-03).
5. **`trendPct` is not adapted** — it is derived from `trendPts`, and guessing the mock's formula would
   put a wrong number on screen. The template computes it (I-L1-11).
6. **`termLinesFor`** was added to the fixture after the first push, per the ruling.
7. One adapter build subagent stalled without producing output and was killed; I wrote the adapters
   directly. Every other step used subagents (three readers, two builders, two reviewers).

—
**Juergen** · frontend-developer
