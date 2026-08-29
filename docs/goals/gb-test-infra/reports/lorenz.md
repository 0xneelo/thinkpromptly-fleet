# XYZ-1851 — GB test infra

**Lorenz · qa-expert** · branch `agent-lorenz` · base `ebce6e6` (rebased mid-lane onto Zita's
train-broker weave) · 2026-08-29

Two findings from XYZ-1851, both closed. A third flake surfaced while proving the second and
had to be closed too, or the 8/8 gate was unreachable; it is called out below rather than
folded in silently. `server.js` is untouched — Zita owns it — and `git diff` proves it.

## Finding 1 — the npm-install prerequisite now says so itself

`node_modules/` is gitignored and per-worktree, so a fresh clone or a fresh `git worktree` ran
`npm test` straight into `Cannot find module 'ws'` inside the first test file. A stack trace at
that point reads like a broken branch, which is the part that costs time.

- `scripts/check-deps.js` runs as `pretest` and resolves every runtime dependency against the
  repo root. Missing ones become one line that names them and says what to do, exit 1. No stack
  trace, no test file loaded. An unreadable `package.json` gets the same treatment.
- `README.md` gains a **Tests** section: install once per worktree, what the suite is, why the
  check exists, and that a run never touches the operator's deck.

Proved by moving `node_modules` aside:

```
> fleetdeck@1.0.0 pretest
> node scripts/check-deps.js

fleetdeck: dependencies are not installed in this worktree (missing @xterm/addon-fit,
@xterm/addon-web-links, @xterm/xterm, node-pty, ws) — run `npm install` here first, then
`npm test` again.
exit=1
```

## Finding 2 — the two flaky tests, deflaked at the fixture

Nothing either test asserts was changed, deleted or weakened. Both root causes were measured
before the fix, not guessed at.

### `test/seats-fencing.test.js` M14 — a fixture that corrupted its own state file

`health()` polls `qwinsta` and `wsl pgrep` in one `Promise.all`, so two `fake-ssh` processes did
a **non-atomic read-modify-write on one JSON state file**. One of them read a half-written
`ssh.json`, died on the parse, and the deck recorded that exactly as it records a real failure:
`holderOk: null`, `wslAlive: null`. M14 asserts `[true, true, false]`.

Measured by driving what M14 drives — one server on the fixture, `GET /api/health`, fresh state
file each time:

| tree | calls | M14 host assertion would fail |
| -- | -- | -- |
| before | 200 | **17 (8.5%)** — unloaded |
| after | 300 | 0 |
| after, under 96-way CPU load | 200 | 0 |

Fix, all in `test/fake-ssh.js`: an mkdir lock around every read-modify-write, every write landing
by `rename`, so a reader outside the lock — a test calling `i.ssh()` — never sees a partial file
either. The lock is reclaimable on the **holder's liveness**, never on its age: reclaiming a
holder merely slowed by load would put two writers in one critical section, which is the
corruption the lock exists to stop.

The lock lives at `<state>.fixture.lock`, not `<state>.lock`. `test/reaper.test.js` already
wraps every ssh call in a lock of its own at the latter path and spawns `fake-ssh` inside it; a
second lock on the same path made `fake-ssh` wait for a lock its own caller held, and hung the
whole file. That was caught by running the file, and is the reason the third commit exists.

### `test/kill-race.test.js` M5 — a deadline hidden in a unit conversion

tmux reports activity in whole seconds. The test wrote `Math.floor(Date.now() / 1000)` to mean
"active right now", and the deck compares `activity_seconds * 1000` against a 1000ms suspect
window. So **truncation alone spent a uniform 0–999ms of the budget** before the tick's own two
ssh round trips were charged to it. Observed margins from the fixture's own log, six runs:

```
tmux active 252ms ago      tmux active 310ms ago      tmux active 315ms ago
tmux active 531ms ago      tmux active 696ms ago      tmux active 929ms ago   <- 71ms of 1000 left
```

Over the cliff the session is reaped instead of flagged as a broken pinger — `got 'reaped',
expected 'suspect'`, at Kendra's reported rate of roughly one run in four.

Fix: a fixture value `activity: 'now'`, stamped when the sample is answered and rounded **up**, so
truncation costs nothing; and `FLEET_SUSPECT_WINDOW_S=3` for that one instance, so what remains
of the deadline is 3s of slack against a measured round trip of a few ms. The window is a config
knob the deck already reads. The claim under test — "tmux says this session was active inside the
suspect window, so it is a broken pinger, not a corpse" — is asserted exactly as before.

### The third flake — `test/kill-race.test.js`, both M4 in-flight-kill tests

Found in loaded full-suite run 1 of the baseline sweep, not reported in XYZ-1851. `await
sleep(250)` had to land **inside** a 700ms kill window that only opens after an unbounded poll.
Under load the row was deleted before the reap CAS, so the CAS matched nothing, no alert was
raised, and the test read as a broken guard:

```
AssertionError: The input did not match /changed incarnation while its predecessor was being killed/
```

Fix: `until()` waits for the fixture to record the `kill-session` call — the evidence that the
window is open — bounded and with a message naming what it waited for. `killDelayMs` widened to
3000. Closing this was not optional: an 8/8 gate cannot be met while it stands.

Alongside it, `toReapEdge` and the other lifecycle waits now derive from the instance's own TTL
and suspect window instead of a hardcoded `1100`, so widening a window for one test does not
leave every sleep around it stale. Those waits are lower bounds — sleeping longer than asked only
makes the next step more certain — so load cannot break them.

## Acceptance

### 8 of 8 consecutive full-suite runs green under parallel load

Load profile: 96 CPU hogs plus 12 process-spawn loops on a 32-core box — a 3x oversubscription
held for the whole sweep, ending at a load average of 117. The same profile turned the tree red
**2 runs in 6** before the fix.

| | before (117 tests) | after (164 tests) |
| -- | -- | -- |
| run 1 | **red** — M4 row-vanished | 164/164, 173s |
| run 2 | **red** — M5 | 164/164, 167s |
| run 3 | green | 164/164, 169s |
| run 4 | green | 164/164, 168s |
| run 5 | green | 164/164, 171s |
| run 6 | green | 164/164, 168s |
| run 7 | — | 164/164, 170s |
| run 8 | — | 164/164, 172s |

Every run went through `npm test`, so the `pretest` check from finding 1 ran 8 times too.

### The tests still fail when the behaviour they guard is broken

One test-only revert, applied to a working copy of `server.js`, run, then reverted. `git diff`
on `server.js` is empty at every commit on this branch.

| break | test | result |
| -- | -- | -- |
| the reaper's pinger-dead branch disabled (`if (false && …)`), so a live tmux session is reaped anyway | kill-race M5 | **red** — `AssertionError: the fence never closed on a session that came back · actual 'reaped', expected 'suspect'` |
| `/api/health` reports `reaper_last_tick_at: msNow()` whatever the reaper is doing, so a stopped reaper reads healthy | seats-fencing M14 | **red** — `AssertionError: this instance runs with the reaper off · actual 1788022299652, expected null` |

Both fail on their own claim, not on a neighbouring assertion. Restored, both pass.

## What I did not touch

- **`server.js`** — Zita's, and out of scope. `git diff ebce6e6..HEAD -- server.js` is empty.
  The one temporary edit for the mutation proof above was reverted and verified before any
  commit.
- **Everything else outside `test/`, `README.md`, `package.json` and `scripts/`.**
- Three latent load-sensitivities I found and did **not** fix, because none has been observed
  failing: filed as **XYZ-1867** rather than folded into this lane.
  1. `test/reaper.test.js:458` — `sleep(1500)` is a deadline against a 3s boot grace, not a
     lower bound.
  2. `test/reaper.test.js`'s `wrapSrc` lock is now redundant, and its recovery force-removes the
     lock on age alone — the exact hazard the fixture's own recovery avoids.
  3. `test/http.js` picks its port band at random and never retries, so sibling worktrees can
     collide into an `EADDRINUSE` that reads as an unrelated test failing.

## Notes for the next seat

- `docs/goals/gb-test-infra/goal.md` was never woven. The issue body carried the full scope, as
  the launch prompt allowed for.
- Mid-lane rebase onto `ebce6e6` (Zita's train-broker weave) landed clean — no conflicts. Her
  `startBroker` fixture touches S3 in `seats-fencing`, not M14, so nothing here needed rework.
  The suite grew from 117 tests to 164 and every number below is against the new one.
- The fixture lock is the load-bearing piece of this change. If a future test file wants its own
  lock around `fake-ssh`, it must not use `<state>.fixture.lock`.

## Commits

| sha | what |
| -- | -- |
| `605a0bf` | finding 1 — `pretest` dependency check, README **Tests** section |
| `28c4827` | finding 2 — deflake M5, M14 and both M4 in-flight-kill tests at the fixture |
| `afffcef` | review follow-up — lock path, liveness-based reclaim, one stamp per answer |

Files: `README.md`, `package.json`, `scripts/check-deps.js` (new), `test/fake-ssh.js`,
`test/kill-race.test.js`. No assertion in any test was changed.

— Lorenz
