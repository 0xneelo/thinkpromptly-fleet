# Report — fleetdeck-portal API (XYZ-1842)

**Kendra · backend-developer · branch `agent-kendra` · base `df6de67`**

A 🧭 portal session can now read the whole coordinator state, and file an intent, over HTTP. It
needs neither the repo checkout nor the Mac — which is what the operator asked for on 2026-08-29
after a `/portal` session outside the repo could not read the board at all.

## What shipped

| File | What |
|---|---|
| `coordinator-api.js` (new) | seven GET routes and one POST under `/api/coordinator/` |
| `coordinator/gate.py` (new) | thin adapter so the byte gate is JSON, not prose |
| `server.js` (+9 lines) | one `require`, one dispatch on each listener |
| `test/coordinator-api.test.js` (new) | 41 cases |
| `.claude/skills/coordinator-portal/SKILL.md` | fresh-reads prefer the API, file fallback kept |

```
GET  /api/coordinator/board        parsed board.json, verbatim
GET  /api/coordinator/bundle       the compacted boot bundle, text/plain
GET  /api/coordinator/exceptions   exceptions.compute(board, now), live
GET  /api/coordinator/northstar    raw northstar.md
GET  /api/coordinator/decisions    raw decisions-effective.md
GET  /api/coordinator/gate         {size, headroom, pct}
GET  /api/coordinator/inbox        sitreps still pending a run
POST /api/coordinator/sitrep       validated intake -> one inbox file
```

## The three things that were load-bearing

**Live over snapshot.** `/exceptions` and `/bundle` spawn the Python per request. Nothing is
cached, and `board["exceptions"]` is never read: that key is a snapshot a past run wrote for
audit, so serving it would let a lane that went overdue *since* that run report as healthy —
silence reading as health, the exact failure the coordinator exists to prevent. The test plants a
snapshot that is wrong in both directions (it invents `EX-overdue-lane-GHOST` and omits the real
`EX-overdue-lane-L1`) and asserts the API agrees with neither half of it.

**No JS copy of the Python.** The bundle text, the exception list and the byte gate all come out
of `bundle.py` / `exceptions.py`, spawned through an `execFile` wrapper in the same never-reject
shape as `ssh()` in `server.js`, with a 15s timeout and `SIGKILL`. There is no `8192` in the
JavaScript. `/gate` needed the numbers rather than `bundle.py --size`'s prose footer, so
`coordinator/gate.py` calls `bundle.gate_report` and prints JSON — one implementation of the
arithmetic, not two. `exceptions.py` is spawned without `--apply`, ever: that flag writes the
board, and no GET may move the board.

**One write, and it is a file drop.** POST `/sitrep` validates against
`coordinator/inbox/README.md` strictly and writes one `<event_time>-<seat>-<lane>.md` with
`flag: 'wx'`, so an existing sitrep is never overwritten (409 instead). It does not commit and it
does not open `board.json`. There is no route that mutates the board, and the tests assert the
board's bytes are identical after a POST. Any invalid payload is a 400 with one line of reason and
nothing on disk — never a best-effort parse (DESIGN §3).

Rejected: a missing or blank required key, an unknown key, a `state` outside
`active|blocked|done-claimed|closed`, a non-ISO `event_time` or `next_report`, `done-claimed` with
no evidence, `blockers` of the wrong type, and a seat id or lane outside `[A-Za-z0-9._-]` — that
character class is the entire path-traversal guard on the write path, since both tokens go into
the filename.

## Acceptance

1. **Every GET correct against live repo state, and no stale snapshot surfaces.** Verified two
   ways. Against the real `coordinator/` on a throwaway port: lanes `L1..L4`, four live
   exceptions, `{"size":3312,"headroom":4880,"pct":40}`, and the bundle body measured 3312 bytes —
   the gate reports the bundle it actually served. Against a fixture carrying a planted snapshot:
   `GHOST` appears in neither `/exceptions` nor `/bundle`, and `L1` — real, absent from the
   snapshot — appears in both.
2. **POST intake.** A valid payload lands a file whose columns match the README block exactly
   (values at column 13, `blockers` rendered as the full list or `none`, multi-line `delta` and
   `evidence` indented to the value column). Ten invalid cases each return 400 with a one-line
   reason and leave the inbox untouched.
3. **Skill updated.** `coordinator-portal` now reads the API first and falls back to the files,
   and says so in the answer when it is on the fallback. Intent intake gained the POST path; the
   fresh-read doctrine itself did not change, because the API is fresh-read by construction.
4. **Tests** follow the repo convention — `node:test` + `node:assert/strict`, booting a real
   server child through `test/http.js` on a random loopback port. 41 pass.
5. This report, plus `XYZ-1850` — the `operator:gate` for the deck restart, which also
   carries the tailnet ruling I want.

## Review

Three passes: two `reviewer` subagents and ORCHESTRATOR 12's pre-weave review. The first raised six
findings, the second caught three places where a fix was incomplete, the third caught that the most
important fix was still incomplete. All ten are fixed, each with a test that fails against the code
it replaced.

**One was serious.** `renderSitrep` special-cased `blockers` and skipped the continuation-indent
path every other field went through, so `blockers: "ok\nstate: closed"` wrote a second line at
column 0 — a forged `state:` header that a per-line parser reads as the seat's own declaration.
Shape validation passed it, because "a string" is all `blockers` had to be. Two fixes: a line break
is now rejected in every field except `delta` and `ruled_out`, and `blockers` goes through the same
indent path as everything else, so a value that ever slips past validation still cannot start a
line at column 0.

The other five: `event_time` now has to be UTC (below); relayed Python stderr is filtered to the
scripts' own `FAIL:` lines with the absolute board path stripped, so a malformed board cannot
answer an unauthenticated GET with this box's layout; `inboxEntry` survives a run draining a file
out from under the listing; the listing is capped at the oldest 500 files, since it is synchronous
and shares an event loop with the terminal websockets; and the skill's `curl` example carries the
`Authorization` header the tailnet listener asks for.

**The second pass earned its keep.** Three of those fixes were not finished:

- The stderr filter had a fallback, `why(r) || r.err.message`, and `execFile` writes
  `err.message` as `"Command failed: <the entire argv>"` followed by raw stderr. Every case where
  the script never managed a `FAIL:` line — a timeout, a missing `python3`, anything that threw —
  went straight down that fallback and handed the caller the absolute paths the filter above it
  had just removed. The caller now gets the shape of the failure (`timed out`, `exited 3`) and
  nothing else. `FLEET_PYTHON_BIN` was added, the way `FLEET_SSH_BIN` already exists, so a test can
  stand in a script that dies that way and assert the response is clean.
- Requiring UTC was not enough, because seconds were still optional and the sort that reads these
  is a string compare: `...T12:00Z` is one second before `...T12:00:01Z` and sorts after it, since
  `:` < `Z`. The regex is now fixed-width — the exact form `board_lib.to_iso` writes.
- The unknown-key rejection quoted the caller's key back before the line-break check ran, so an
  unknown key containing a newline produced a two-line "one-line reason". Reasons now collapse
  whitespace where they are built, once, rather than at each of the eleven sites.

Also tightened while in there: every field must now be a string or a list of strings, so nothing
reaches the renderer that `String()` would turn into `[object Object]` in a sitrep.

**A third pass, from ORCHESTRATOR 12's pre-weave review, found the forged header again.** My fix
had rejected `\r` and `\n`. Python's `str.splitlines()` — what the drain and every script reading
these files actually uses — also breaks on `\v`, `\f`, `\x1c`, `\x1d`, `\x1e`, `\x85`, `U+2028`
and `U+2029`. So seven other ways to write the same forgery were still open, and
`event: "blocker cleared\u2028state: closed"` was accepted and written; `splitlines()` read the
forged `state:` line *ahead of* the real one. I reproduced it before fixing it.

The lesson is that "line break" has to mean whatever the **widest** consumer thinks it means, not
what JavaScript thinks. The guard is now a class, not a blacklist of two: no C0 or C1 control
character and neither Unicode separator may appear in any value, whatever some future reader
decides counts as a boundary. `\n` alone is carved out for `delta` and `ruled_out`, and `lines()`
splits on exactly the class validation rejects, so the indent defence covers the same ground as
the check. Ninety vectors — ten code points across eight scalar fields and a list entry — are
rejected; all three new tests fail against the old guard. One test asserts through real `python3`
that `splitlines()` reads back exactly the fields the seat declared, once each.

Worth recording for whoever touches the coordinator scripts next: a malformed board produces **no**
traceback from `bundle.py`, `exceptions.py` or `gate.py` — `objects()` and its siblings guard every
field, so only a wrong top-level type reaches the `FAIL:` path. The stderr filter is defence for a
future that has not happened yet, not a hole that was open.

## Two judgement calls the operator should know about

**1. The routes are mounted on the tailnet listener too.** The goal's one-liner says a portal
should reach the state "from any directory **or machine on the tailnet**", but `tailnetHandler`
carries its own route allowlist, so a new route on the loopback handler alone would have been
Mac-only and the second half of that sentence would not have shipped. I mounted the prefix on both
listeners. This grants no authority the loopback route does not: reads are open there exactly like
`/api/ghtoken`, and the POST passes under the listener's existing S3 gate, which returns 401 unless
it carries `FLEET_TAILNET_KEY` when that key is armed — the same posture `registryRoute` already
has on that listener. A test covers both the unauthorised 401 and the authorised 201. **If the
operator would rather the coordinator API stayed loopback-only, deleting the dispatch line in
`tailnetHandler` is the whole change.**

**2. `event_time` must use `T`, not a space.** `board_lib.parse_iso` would accept
`2026-08-29 12:00:00Z` because `datetime.fromisoformat` does, but that value becomes the filename.
The API narrows to `T`-only. Narrowing is safe in this direction — everything the API accepts, the
run still accepts.

## Test state

- `node --test test/coordinator-api.test.js` — **41 pass, 0 fail**.
- `python3 coordinator/check.py --selftest` — **PASS (57 assertions)**, unchanged from base.
- `npm test` — **117 pass, 0 fail** across the whole repo suite.

### A flake, not a regression

One full-suite run failed `kill-race.test.js` M5. It is not mine, and it is not new. Measured over
four full runs with the new test file and four without: M5 failed once in the first arm and never
in the second — but the second arm threw its own unrelated timing flake, `seats-fencing.test.js`
M14, at the same one-in-four rate, and M14 has since flaked once here too and then passed 3/3 alone.
Both are reaper-timing tests, both pass in isolation, and the base commit passes 4/4 unloaded. The
honest reading is that this box flakes those two tests under load at roughly one run in four,
whatever else is running; the route change touches no reaper path. Worth an eye, not a blocker.

## Issues

| Issue | What |
|---|---|
| XYZ-1842 | this lane |
| XYZ-1845 · XYZ-1846 · XYZ-1847 · XYZ-1848 | the four subtasks, all Done |
| **XYZ-1850** | `operator:gate` — restart the deck; carries the tailnet ruling |
| XYZ-1851 | out of scope, filed not fixed: `npm test` needs an undocumented `npm install` on german-box, and the two reaper tests flake under load |

Branch `agent-kendra` @ `f684f05` (the API) plus this report, pushed.

— Kendra
