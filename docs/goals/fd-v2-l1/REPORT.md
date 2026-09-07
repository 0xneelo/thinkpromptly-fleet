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
| `test/v2-data.test.js` | 65 tests |
| `server.js` | one ternary arm so a directory URL serves its `index.html` |
| `docs/design/fleetdeck-v2/improvised.md` | 12 entries (I-L1-01 … I-L1-12) |

Commits: `a918cc5` (server fix) · `ff76a68` (extractor + fixture) · `9e5c0d1` (data layer, router,
tests) · `55ec8b8` (report) · `b2f6f72` (`termLinesFor`) · `32cf21d` (reviewer findings).

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
| `npm test` | **294 pass, 0 fail** (229 before this slice, 65 new) |
| `test/v2-data.test.js` alone | 65 pass |
| `npm run v2:fixture` idempotent | yes — second run leaves the file byte-identical |
| `npm run v2:fixture -- --check` | exits 0; wired into `pretest`, so `npm test` fails on a stale fixture |
| Adapter shapes vs mock | all 9 match key list **and order**; asserted per adapter |
| Fixture mode | every seeded fetcher returns the mock array deep-equal and key-order-equal |
| `/v2/` resolves | 200 through a real `node server.js` on a scratch port, same body as `/v2/index.html` |
| Traversal guard | `/../server.js`, `/v2/../../server.js`, `/%2e%2e/`, `/v2/..%2f..%2f` all refused |
| Same-origin | asserted by a test — no absolute URL in `data.js` outside comments |
| Operator's live deck | never contacted; adapters run only against the captured fixtures |

## Acceptance (README §Acceptance)

- [x] `public/v2/data.js`, `router.js`, `fixture.js`, `orgchart.js` present; `npm test` green including `test/v2-data.test.js` — 294/294.
- [x] Fixture mode returns arrays deep-equal + key-order-equal to the mock's seed arrays; `npm run v2:fixture` idempotent. Read as the layer-1 projection — layers 2 and 3 are theme-dependent and non-serializable, so nothing on disk can equal them theme-independently (I-L1-01).
- [x] Every adapter output validated against the mock shapes — shape table above, one row per array.
- [x] `/v2/` resolves — 200 via `node server.js` on a scratch port; the change is quoted in commit `a918cc5`. The shell itself is S2's `public/v2/index.html`, so the test supplies a stand-in when that file is absent and uses the real one when present.
- [x] No fetch to any host but the page origin; no call to the operator's deck.
- [x] `reviewer` pass clean; branch pushed; `REPORT.md` signed; registry — see below.

### Reviewer findings, and what they changed

Two passes. The first cleared the fetchers, the router and the `server.js` hunk and found two holes in
the error contract (a response with no `.text`, and a 2xx that will not parse, both rejecting with a
bare `TypeError` / `SyntaxError` instead of `{status, body}`) — fixed before the first commit.

The second pass reviewed the adapters and tests and returned 12 findings. All were real; all are
fixed. The three that mattered:

1. **Fixture mode was not read-only.** Only the ten reading endpoints were intercepted, so `kill`,
   `deleteKey`, `registryDelete` and six other writes still reached the network under `?fixture=1`. A
   Kill clicked on a fixture page would have destroyed a real session. All nine writes are now inert
   in fixture mode, with a test for both halves of that.
2. **`toMachines` duplicated columns.** It mapped 1:1 over `clients[]`, so german-box — which reports
   every client twice, WSL and Windows — produced 8 single-section columns where the mock has 4
   columns of 2 sections. The Machines screen would have rendered doubled.
3. **The shape tests could not see either bug.** `assertShape` checked only `Array.isArray` on array
   fields, so a duplicated column, a dropped chip and a widened tuple all passed. It now walks one
   level into arrays and compares tuple lengths, and there are explicit tests for the german-box
   grouping, the chip pair and the bar tuple widths.

The rest: `accounts[].id` was the whole uuid rather than the mock's 8 hex; `plan` was the raw enum
`claude_max` rather than `Max 20×`; `banner` was the raw `state` rather than a sentence; bar tuples
were a fixed-width triple; `certs` was returned by reference; the visibility test could leak a fake
`document`; and the outbound-to-desktop thread path had no coverage. Every one is fixed and tested;
the label derivations are recorded as `improvised.md` I-L1-12.

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

---

# Addendum — L1.1: standing down from `public/v2/fixture.js`

| | |
|---|---|
| Worker | **Juergen** · `frontend-developer` |
| Date | 2026-09-07 |
| Trigger | DESIGN-35 follow-up: S2 landed at `origin/agent-v2-s2` `f370e4e` with its own generated `public/v2/fixture.js`; both slices had written that path, the merge conflicted, and the design seat resolved `origin/agent-v2-base` to S2's file. |

## What changed

1. **Merged `origin/agent-v2-base`** into `agent-v2-l1`. Clean — the base had already resolved the
   conflict. `public/v2/fixture.js` is now S2's compiled file and this slice no longer writes it.
2. **`tools/extract-fixture.mjs` writes `public/v2/fixture-extract.js`**, holding only the seeds S2
   did not substitute.
3. **`npm run v2:fixture -- --check` is now a two-part gate**: the generated file must be current
   *and* every seed S2 owns must still extract to exactly what S2 shipped.
4. **`data.js` fixture mode reads `FD.fixture` first**, falling back to `FD.fixtureExtract`, and loads
   `fixture-extract.js` lazily — only on a page that asked for fixture mode.

## The seven seeds S2 owns are not the seven the brief listed

The brief named `regData, busSessions, seedThreads, orgScopeData, keyRows, accounts, machines`.
S2's shipped `public/v2/fixture.js` actually defines:

`regData` · `busSessions` · `seedThreads` · `orgScopeData` · `keyRows` · **`dsData`** · **`titles`**

Still seven, but `dsData` and `titles` are substituted and `accounts` and `machines` are not. I
followed the file rather than the list, and the split is derived at build time from S2's own keys
rather than hard-coded — so if S2 substitutes an eighth seed, this tool drops it from
`fixture-extract.js` and starts drift-checking it on the next run, with no edit here.

Resulting split, verified to have **zero overlap**:

| File | Owner | Seeds |
|---|---|---|
| `public/v2/fixture.js` | S2 (`tools/dc-compile.mjs`) | `regData, busSessions, seedThreads, orgScopeData, keyRows, dsData, titles` |
| `public/v2/fixture-extract.js` | L1 (`tools/extract-fixture.mjs`) | `tiles, groups, busGroups, accounts, machines, gbSessions, termLinesFor` |

## What "byte-for-byte" means across two generators

The two files are formatted differently on purpose: S2 preserves the mock's own literal style, this
extractor emits JSON. A literal byte comparison of source text would always fail. The check therefore
compares **values** — canonical JSON with key order preserved — which is what "identical seed" can
mean across two generators, and it is the property that actually matters: the app renders from S2's
copy while the tests assert against both, so the two must carry the same data.

Both generators independently produce the same seven seeds from the same mock. That agreement is now
enforced:

```
$ npm run v2:fixture -- --check
public/v2/fixture-extract.js is up to date; 7 S2-owned seeds match public/v2/fixture.js
```

and on drift it names the exact path and exits 1:

```
seed drift against public/v2/fixture.js (S2 owns these 7 keys):
  regData — [0].s: "LC-constantin-train-78" here vs "LC-TAMPERED" in S2
S2's fixture.js is the authority. Re-run S2's compiler or fix this extractor; do not edit either by hand.
```

Verified by tampering with a value in S2's file and confirming exit code 1, then restoring it. The
check runs on the plain path too, so `npm run v2:fixture` cannot write a file while drifted, and it is
wired into `pretest` — the merge had dropped that, so `npm test` can once again not pass against a
stale or drifted fixture.

## Lookup order in `data.js`

`fixtureFor(name)` reads `FD.fixture` first and `FD.fixtureExtract` only as a fallback, so S2 is
always the authority. Because the two files never define the same key, that order is a safety net
rather than a merge — and a test proves the precedence by shadowing one of S2's keys in
`FD.fixtureExtract` and asserting S2 still wins.

`loadFixtures()` is called by the fixture-mode fetchers before first use: a `require` under Node, and
in a browser it injects `/v2/fixture-extract.js` if the shell has not already included it. That means
**no edit to S2's `index.html` is required** — but if the design seat prefers an explicit tag, adding
`<script src="/v2/fixture-extract.js"></script>` next to `fixture.js` under fixture mode makes the
injection a no-op.

## Verification

| Check | Result |
|---|---|
| `npm test` (merged suite, S2's tests included) | **296 pass, 0 fail** |
| `test/v2-data.test.js` alone | 67 pass (2 new: the ownership split, and S2 precedence) |
| S2-owned seeds vs S2's file | 7/7 identical |
| Overlap between the two fixture files | none |
| `npm run v2:fixture` idempotent | yes |
| Drift detection | tampering with S2's file exits 1 and names the path |

## Still open, unchanged from L1

- The registry row was never written — `POST /api/registry` answers `unauthorized` from the box (XYZ-2137).
- `improvised.md` **I-L1-01** (the data-layer boundary) remains **unaudited**: Fable was rate-limited.

—
**Juergen** · frontend-developer
