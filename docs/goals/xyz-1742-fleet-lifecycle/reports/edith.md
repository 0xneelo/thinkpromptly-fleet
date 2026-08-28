# Lane 1 report — backend lease / reaper / fencing

**Worker:** Edith · backend-developer · german-box · branch `agent-edith`
**Issue:** XYZ-1820 (under XYZ-1742) · **Gate filed:** XYZ-1822
**Implements:** `docs/goals/xyz-1742-fleet-lifecycle/CONTRACT.md` (FROZEN) in `server.js` + `fleet.db` schema
**Acceptance:** operator decision M16 option (b) — the 15 named defects plus M1–M17 / S1–S7

**Status: acceptance green.** `npm test` — **71 tests, 71 pass, 0 fail**. Every M1–M17 clause with
a named test has that test; S1–S7 are implemented, none deferred. All 15 named defects are mapped
below. `npm start` boots clean on a fresh checkout and on a copy of a populated legacy `fleet.db`,
and the reaper has been driven end to end against a real tmux session on this box.

---

## 1. What shipped

`server.js` grew a lifecycle layer around the registry it already had. The registry semantics did
not change: a sighting still never touches the operator's classification, a row still outlives the
tmux session it describes, and both listeners still split the same way. What is new is that the
deck now *owns* the sessions it lists.

| Milestone | Clauses | What it is |
|---|---|---|
| A | M9, M10, S4 | additive migration behind a pre-migration backup; WAL + `synchronous=FULL` pinned and asserted at boot |
| B | M1, M2, S1, S7 | `POST /api/lease/claim`, `POST /api/heartbeat` — epochs, tombstones, both listeners |
| C | M13, M17, S3 | seats (loopback only), the `seat_epoch` fence on privileged writes, the tailnet bearer key |
| D | M3–M7, M14, M15, S5 | the reaper: CAS transitions, two-phase durable warn, second liveness sample, cascade guard, boot/clock grace, observability, retention |
| E | M11, M12, S6 | the parent edge, and the read contract Lane 3 renders from |
| F | M16 | this report, and the defect map below |

### The shape of a lifecycle

```
claim ──► active ──(expires_at < now)──► suspect ──(warn delivered)──► warned
             ▲                              │                            │
             └──────── heartbeat ───────────┘              (appeal window elapses)
                                                                         │
                                                                         ▼
                                            reaped ◄── CAS commits FIRST ─┘
                                               │
                                               ├─► tmux kill-session  (retried until it lands)
                                               └─► name.py close      (only after a confirmed kill)
```

Every arrow is one conditional UPDATE whose `WHERE` clause restates its own precondition. Nothing
reads a row, awaits, and then writes that row's `lease_state` on the strength of what it read.

---

## 2. Defect map — the 15 named defects

Rows 1–15 of the audit's coverage table. "Prevented by construction" means the mechanism cannot
occur in this design, not that it was patched; each such row still names the test that would fail
if the construction were undone.

| # | Defect | Verdict here | Evidence |
|---|---|---|---|
| 1 | Heartbeat POST ignores the agent's reported `status` | **prevented by construction** — the heartbeat body has no status field to mis-store, and `lease_state` is server-derived. Distress goes through registry `status`/`note`, which sightings already cannot overwrite (S7) | test `S7 — a heartbeat is liveness-only and cannot store a status`: a beat carrying `status:'error'` is accepted and the row's status stays `active` |
| 2 | Reaper marks offline without re-checking `last_seen` | **fixed** — three independent guards: the CAS re-states `expires_at < now` at write time, the second liveness sample re-reads tmux immediately pre-kill, and the cascade guard refuses the whole tick when the evidence is suspect | `M3 —` heartbeat/tick race, `M3 —` suspect CAS refuses an unexpired row, `M5 —` killed pinger + live tmux survives, `M6 —` partition reaps nothing, `M7 —` grace |
| 3 | Stale reaping silently config-disabled | **fixed** — `reaper_last_tick_at` and `reaper_ticks` in `/api/health`, and every transition logged with its epoch and reason | `M14 — a stopped reaper is visible within two ticks`, `M14 — every transition is logged with its epoch and a reason` |
| 4 | Only the *initial* claim is CAS-guarded | **fixed** — every transition is a CAS: claim, heartbeat, suspect, warn, reap, kill-confirm. None writes by primary key alone | `M1 —` epoch fencing, `M2 —` only the current epoch renews, `M3 —` both CAS tests, `M4 —` reaped-before-kill ordering |
| 5 | Any agent key can reset another agent's presence | **fixed** — a heartbeat renews only on the current epoch; the parent edge is written only at claim and validated; privileged writes carry a seat epoch; tailnet writes carry the shared bearer key | `M2 —` missing/stale/non-integer epoch renews nothing, `M12 —` registry POST carrying `parent_*` changes no edge, `M17 —` stale `seat_epoch` → 409, `S3 —` armed key rejects a write without it |
| 6 | Migration 035 drops `api_keys`, no rollback | **fixed** — additive ALTERs only, no DROP, no rebuild, and the db is copied before the one boot that migrates it | `M10 —` boot twice, old rows intact; `M10 —` backup is the pre-migration snapshot; `M10 —` an already-migrated db is not copied again |
| 7 | `synchronous=NORMAL` durability loss | **fixed** — both pragmas set, read back, and the process throws at boot if either differs | `M9 —` read-back rejects a handle left on `NORMAL`; `M9 —` boot refuses a db that cannot hold WAL |
| 8 | Event bus fire-and-forget, no replay | **fixed for the one message that precedes a kill** — `warned_at` is written only after delivery succeeds, so a warn lost to a restart or a failed ssh is re-sent, and the reap is gated on `warned_at` age | `M15 —` a restart re-warns an unwarned suspect before any reap |
| 9 | Workspace `admin` ⇒ host super-admin | **prevented by construction** — the listener split keeps `/api/kill`, the key routes and now the seat routes loopback-only; the tailnet listener mounts registry, leases and the token broker and nothing else | `M13 — a tailnet POST to /api/seats/claim gets 404`, `M11 — the fleet read stays off the tailnet` |
| 10 | Admin rotates or receives the global API key | **N/A, and kept N/A** — Lane 1 adds no key surface. The S3 bearer key is read from the environment; there is no rotation endpoint and no route that returns it | by inspection: `FLEET_TAILNET_KEY` is read once at boot and only ever compared |
| 11 | Cross-tenant identity tampering | **N/A** — single tenant. The session-level analogue is defect 5 | see row 5 |
| 12 | SSE stream leaks other workspaces' runs | **prevented by construction** — there is no SSE, and every fleet-wide read (`/api/sessions`, `/api/health`, `/api/seats`) is loopback-only | `M11 — the fleet read stays off the tailnet` |
| 13 | Webhook HMAC secrets plaintext at rest | **N/A** — webhooks are not in Lane 1 scope, and none were added | by inspection |
| 14 | Pipeline/notification races → duplicate work or delivery | **fixed** — a double warn cannot happen (`warned_at IS NULL` is in the CAS), a double reap cannot happen (`lease_state='suspect'` is in the CAS), a double kill cannot happen (one in-flight kill per row, plus `killed_at IS NULL`), and a Name is closed once, after a confirmed kill | `M4 —` failed kill retries without rewriting `reaped_at`, `M4 —` name-close log holds exactly one entry, `M3 —` CAS tests |
| 15 | Append-only logs never pruned | **fixed** — heartbeats update in place and no history row is ever written; reaped rows are deleted after the retention window | `S5 —` reaped rows pruned, nothing else touched; `S5 —` five beats leave one row |

Rows 16–35 of that table are the **unenumerated** counts. Per the operator's M16 option (b) they
are out of this lane's acceptance, and the research clone that produced them is gone
(`HANDOFF-XYZ-1742-orgchart.md` §6). They are not claimed as covered.

---

## 3. Amendment ledger — M1–M17

Every clause, what it cost, and the test named in the clause itself.

| # | Shipped | Test |
|---|---|---|
| **M1** lease-start endpoint | `POST /api/lease/claim`, one synchronous transaction, `epoch = COALESCE(epoch,0)+1`, clears every terminal marker | `M1 — a reaped (host,name) re-claims, and the old epoch is fenced out` · `M1 — every claim on the same session increments the epoch` |
| **M2** epoch mandatory once leased | missing / non-integer / stale epoch → `409 {current_epoch_hint:false}`, renews nothing; reaped → `410 {reason,reaped_at}` to every epoch | five `M2 —` tests |
| **M3** CAS on every transition, no awaits inside | claim, heartbeat, suspect, warn, reap and kill-confirm are each one conditional UPDATE that restates its own precondition | `M3 — a heartbeat racing a tick never leaves a row suspect with a future expiry` · `M3 — the suspect CAS refuses a row whose lease is not actually expired` · `M3 — the reap CAS refuses a suspect whose warn is younger than the appeal window` |
| **M4** fence first, kill second, name last | reap CAS commits before the ssh; kill failure leaves the row reaped and retries; one kill in flight per row; `name.py close` only after a confirmed kill, never for `mac` | `M4 — the reaped CAS commits before tmux kill-session` · `M4 — a failed kill leaves the row reaped and retries on the next tick` · `M4 — a Name is released only after the kill is confirmed` · `M4 — a mac row is never killed and never name-closed` · `M4 — a claim is refused while its predecessor's kill is still in flight` · `M4 — a kill whose row vanished mid-flight stamps nothing and raises an alert` |
| **M5** second liveness sample | `sampleSession()` re-reads that one session's tmux `session_activity` immediately before the reap decision, and the kill follows straight after the CAS | `M5 — a session with a killed pinger but an active tmux survives the sweep, flagged` · `M5 — stale tmux activity does not save a session` · `M5 — a session that reappears between the tick poll and the reap decision is not killed` · `M5 — a host that stops answering mid-tick defers the reap` |
| **M6** cascade guard | `> K` candidates, a whole host's sessions at once, or a failing ssh poll ⇒ no reaps that tick, one alert per trip | four `M6 —` tests |
| **M7** boot and clock-jump grace, monotonic ticks | grace armed at boot and re-armed by a wall/monotonic drift greater than one TTL; `process.hrtime.bigint()` is the tick clock | `M7 — a 2xTTL wall-clock jump reaps nothing for a full window` · `M7 — the boot grace blocks reaps for one full suspect window` |
| **M8** pinger proves its own session | **Lane 2's clause.** Lane 1's obligation was to freeze it in the contract, which `CONTRACT.md` §Pinger contract does. Nothing to build here; §7 below restates it for Konrad | n/a — Lane 2 |
| **M9** durability pragmas pinned and asserted | WAL + `synchronous=FULL` set, read back, boot throws on either | three `M9 —` tests, one of them against a handle deliberately left on `NORMAL` |
| **M10** additive migration with backup | twelve additive ALTERs, no DROP, no rebuild; the db is copied only on the boot that actually migrates it | four `M10 —` tests |
| **M11** read contract for Lane 3 | `/api/sessions` rows carry the lifecycle columns plus `tmux_live`; `live := tmux_live OR lease_state='active'`; `GET /api/seats`; all loopback-only | five `M11 —` tests |
| **M12** parent edge written only at claim, validated | `parent_host ∈ HOSTS() ∪ {mac}`, `SAFE_NAME`, no self-parent, both fields or neither; not in `REG_FIELDS` | three `M12 —` tests |
| **M13** seat renewal defined, seats loopback-only | renewed by the holder session's beat in the same transaction and only by a beat that was accepted; expired ⇒ suspect, never deleted; tailnet 404 | seven `M13 —` tests |
| **M14** reaper observability | `reaper_last_tick_at`, `reaper_ticks`, `reaper_tick_s`, `reaper_grace`, `alerts` in `/api/health`; every transition logged with epoch and reason | `M14 — a stopped reaper is visible within two ticks` · `M14 — every transition is logged with its epoch and a reason` · `M14 — /api/health carries the reaper's tick age` |
| **M15** durable two-phase warn | `warned_at` written only after delivery, so a lost warn is re-sent; reap gated on `warned_at` age; warn text is one quote-free token | three `M15 —` tests |
| **M16** make the acceptance list real | option (b), per the operator: the 15 named defects plus M1–M17 / S1–S7. Every item in §2 and in this table is individually checkable, and rows 16–35 are explicitly not claimed | this report |
| **M17** enumerate and fence the privileged write set | `/api/kill`, `/api/registry/delete`, `/api/registry` writes to `status`/`task`; browser Origin exempt; stale ⇒ 409 | six `M17 —` tests. **Scope reading under XYZ-1822 — see §5.1** |

---

## 4. SHOULD ledger — S1–S7

| # | Shipped | Evidence |
|---|---|---|
| **S1** heartbeat 200 returns `{expires_at, ttl_s, lease_state}` | yes; the pinger derives `ttl_s/3` and never hardcodes it | `S1 — the heartbeat 200 body carries the TTL a pinger derives its cadence from` · `S1 — a pinger follows a server-side TTL change instead of hardcoding one` |
| **S2** pin the numbers | TTL 90s, renew 30s, suspect/appeal 180s, tick 30s, K=3, retention 14d — all defaults, all overridable, all printed at boot | exercised by every test that overrides them; the boot line names all six |
| **S3** shared bearer key on tailnet writes | `FLEET_TAILNET_KEY` + `safeCompare`; loopback exempt; unset by default so today's workers keep working, and the state is printed at boot | `S3 — an armed tailnet key rejects a write without it` · `S3 — unset, the key gates nothing`. See §5.7 |
| **S4** INTEGER unix-ms everywhere, never compared to the legacy ISO strings | all eight new timestamp columns are INTEGER ms. The two families are never compared: every `<`/`<=`/`>=` on a timestamp in `server.js` names only a new column, and the legacy ISO columns are not compared anywhere at all | structural, and verifiable by grep; the M10 test asserts the columns exist and stay NULL on legacy rows |
| **S5** retention, no history rows | reaped rows pruned after 14 days — except a box row whose kill was never confirmed, which is kept as evidence (§5 and the review that prompted it); heartbeats update in place | `S5 — reaped rows are pruned after the retention window and nothing else is` · `S5 — a heartbeat updates in place and writes no history row` · `S5 — retention keeps a reaped row whose kill was never confirmed` |
| **S6** leaf subagents out of the v1 tree | **decided: out, and out by construction.** A row exists only if something claimed a lease for it or tmux listed it. A reader/hunter subagent has no tmux session and no pinger, so no route creates a row for one and Lane 3 has nothing to render. No code was needed | by construction — the two row-creating paths are `leaseClaim` and `seenStmt` |
| **S7** heartbeat is liveness-only by design | recorded in the contract and true in the code: the heartbeat body has no status field, and `lease_state` is server-derived | `S7 — a heartbeat is liveness-only and cannot store a status` |

---

## 5. Deviations, readings and integration notes

Everything below is either a documented reading of a thin spot in the frozen contract, or a note
another lane has to act on. Nothing here was improvised silently.

### 5.1 Operator gate — XYZ-1822 (M13 vs M17)

M17 fences `/api/registry` `status`/`task` writes from agent calls on a `seat_epoch`. M13 puts the
seat routes on the loopback listener only. Box workers write `status`/`task` over the tailnet and
send no `Origin`, so they are agent calls that can never obtain a `seat_epoch` — applying M17
literally to both listeners would return `409` to every worker's status write, forever, from the
moment the operator's desktop claims its first seat.

Shipped reading: **each listener carries one credential.** Loopback → the seat fence (M17), which
is where `/api/kill` and `/api/registry/delete` live anyway. Tailnet → the shared bearer key (S3).
The audit's own coverage table points at both M17 *and* S3 for defect 5, one per side. A ruling is
requested on XYZ-1822; reversing it is a two-line change here.

### 5.2 `GET /api/seats` withholds `epoch`

The contract says the route lists "seat rows". Returning the epoch would publish, on an
unauthenticated loopback route, the exact number `fenceCheck` trusts — so the "zombie orchestrator
on loopback" that M17 exists to stop could simply read it and replay it. Rows carry
`seat, owner_host, owner_name, expires_at, suspect_at, fenced`; a holder learns its epoch from its
own claim response. Covered by XYZ-1822. **Lane 3: say so if the tree needs the number.**

### 5.3 Seat epochs are one counter across both seats

Per-seat counters would both start at 1, and the fence matches on the bare number — a stale
`coordinator` epoch would satisfy a fence earned by `orchestrator`. Seat claims now take
`MAX(epoch)+1` across the table. Still `epoch++` per claim, still fences the prior holder; a given
seat's own epoch may skip numbers. Covered by XYZ-1822.

### 5.4 Four schema columns beyond the contract's list

The contract's §Schema names eight columns. Four more are required by the audit clauses the
contract summarises, and the contract itself says the audit's full text governs where it is thin:

| Column | Required by |
|---|---|
| `reaped_at` | M2's `410 {reason, reaped_at}` body, and S5's retention cutoff |
| `reap_reason` | M2's `410 {reason, …}` body |
| `killed_at` | M4's "kill retried on the next tick", which needs to know a kill already landed |
| `pinger_dead` | M5's "set flag `pinger_dead`" |

All nullable, all additive, all through the same try/ALTER loop.

### 5.5 `/api/health` is now an object — Lane 3 must adapt one line

The contract says `/api/health` gains `reaper_last_tick_at`. A JSON array cannot carry a field, so
the response is now `{hosts: [...], reaper_last_tick_at, reaper_ticks, reaper_tick_s, reaper_grace,
fence_mode, ttl_s, alerts}`. The host entries under `hosts` are byte-for-byte what the route
returned before.

`public/app.js:52` does `hosts = await (await fetch('/api/health')).json()` and then iterates it —
that needs `.hosts`. `public/` belongs to Lane 3 and has not been touched from this lane.

### 5.6 The fence's `bootstrap` default

`FLEET_FENCE=bootstrap` (the default) leaves the seat fence open only while **no seat row has ever
existed**; the first claim arms it permanently. Without this, merging Lane 1 before Lane 2 teaches
anything to claim a seat would fence out every existing caller on the first boot.
`FLEET_FENCE=strict` arms it unconditionally.

### 5.7 The tailnet bearer key is off unless configured

S3's key is read from `FLEET_TAILNET_KEY`. Unset — the default — tailnet writes behave exactly as
they do today, because every box worker in the fleet, including the three lanes of this goal,
posts to `/api/registry` over tailscale with no credential. Boot logs `tailnet_key=armed|unset`
so the state is never a guess. Arming it is an ops step, not a code change.

### 5.8 New environment knobs

All default to today's behaviour when unset. `FLEET_TTL_S`, `FLEET_SUSPECT_WINDOW_S`,
`FLEET_REAPER_TICK_S`, `FLEET_CASCADE_K`, `FLEET_RETENTION_DAYS` are S2's numbers made
configurable. `FLEET_DB`, `FLEET_HOSTS_FILE`, `FLEET_TAILNET_BIND`, `FLEET_TAILNET_HOST`,
`FLEET_SSH_BIN`, `FLEET_NO_LISTEN`, `FLEET_NO_REAPER` exist so a throwaway instance can run beside
the operator's deck without sharing a port, a database, a fleet or an ssh path — which is how
every test in this lane runs. `FLEET_NAME_CLOSE_SCRIPT` points the reaper at `name.py`; unset, it
logs `name-skip` and releases nothing.

---

## 6. How this was tested

`npm test` → `node --test --test-concurrency=1 test/*.test.js`. 71 tests, no new dependency —
`node:test` and `node:assert/strict` only. Serial by choice: every test boots a real fleetdeck on
real ports, and parallel files collided.

**Nothing in the suite can reach the operator's deck.** Each test gets its own temp directory, its
own `fleet.db`, its own `hosts.json` and its own port pair, through the `FLEET_DB`,
`FLEET_HOSTS_FILE`, `PORT`, `FLEET_TAILNET_BIND` and `FLEET_TAILNET_HOST` knobs. The tailnet
listener binds `127.0.0.2` so the loopback/tailnet split is exercised for real rather than by
calling the handler directly.

| File | Tests | What it drives |
|---|---|---|
| `test/schema.test.js` | 8 | boots `server.js` as a child process against a hand-built legacy db |
| `test/lease.test.js` | 15 | HTTP against a child process on its own ports |
| `test/seats-fencing.test.js` | 21 | same, plus the fake poller so `/api/sessions` has hosts to merge |
| `test/reaper.test.js` | 22 | in-process, driving `reaperTick()` by hand so a sweep is a step and not a race |
| `test/kill-race.test.js` | 5 | in-process, with a fake ssh that stalls mid-kill to open the race windows on purpose |

**The fake host poller** (`test/fake-ssh.js`) stands in for `ssh` through `FLEET_SSH_BIN`, with the
same argv shape, and answers from a JSON state file: which sessions each host has, how long since
tmux last saw each one, whether the host's poll fails, whether a kill fails softly or hard, how
long a kill stalls, and — for the sample-staleness test — after how many polls a session becomes
visible. It also **enforces the zero-quote rule on every command it ever sees** and exits 99 on a
quote character, so that rule is a property of the whole suite rather than one assertion. In
`local` mode it runs the command against this machine's real tmux and **refuses any target that is
not `EDITH-T-*`**, so no test can reach an `FD-*` or `LC-*` session.

**Mutation-tested.** The lease suite was checked by breaking the implementation on a scratch copy
13 different ways — fence removed, epoch not incremented, tombstone not cleared, reaped rows
renewable, parent validation off, hardcoded TTL, lease routes off the tailnet listener, and so on.
Each break was caught by the test that was supposed to catch it. One assertion was found dead in
the process (`assert.deepEqual` is loose and was silently passing) and the suite moved to
`node:assert/strict`.

**Driven against real tmux.** Beyond the fixture, the whole path was run once for real on this box:
a throwaway `EDITH-T-REAL` tmux session was claimed, allowed to expire, warned, reaped and killed
by the reaper through actual `tmux` commands — `lease_state` walking `active → suspect → reaped`,
`killed_at` set, `status` `killed`, and the session gone from `tmux ls`. The 28 live `FD-*`/`LC-*`
fleet sessions on the same tmux server were untouched.

**Acceptance item 4, checked as written.** `npm start` on a fresh checkout: boots, creates the db,
writes no backup. `npm start` on a copy of a populated legacy `fleet.db`: boots clean, writes
`fleet.db.bak-<date>`, and the legacy row comes back through `/api/sessions` with its `status`,
`note`, `group` and `task` intact and `lease_state: null` — an unleased row is never a reaper
candidate.

---

## 7. What Lane 2 and Lane 3 need from this

**Lane 2 (Konrad — the pinger).** `POST /api/lease/claim` returns `{epoch, expires_at, ttl_s}`.
Beat `POST /api/heartbeat {host, name, epoch}` every `ttl_s / 3` seconds, derived from the
response, never hardcoded — a server-side TTL change has to propagate (S1). `200` carries
`{expires_at, ttl_s, lease_state}`. `409` means the epoch is stale or missing: **do not re-claim
from the pinger** — surface it to the session (M8). `410` means the row is a tombstone: stop, write
the local note, and do not resurrect. A transient network error is not a `409` — keep beating.
Both routes are on the tailnet listener. If the operator arms `FLEET_TAILNET_KEY`, add
`authorization: Bearer <key>`.

**Lane 3 (Alfons — the org chart).** `GET /api/sessions` rows now carry `pid, parent_host,
parent_name, epoch, lease_state, expires_at, suspect_at, warned_at, reaped_at, pinger_dead,
tmux_live, live`. `live` is already the contract's definition (`tmux_live OR lease_state='active'`),
so a mac desktop row with a fresh lease renders live even though it is never in `tmux ls`.
`tmux_live` is kept alongside so the tree can tell a reaped-but-not-yet-killed box row (grey) from
a mac tombstone (🪦). One edge only: `(parent_host, parent_name)`, written at claim and validated.
`GET /api/seats` gives the two roots. `/api/health` changed shape — see §5.5.

---

*Signed: Edith · backend-developer · agent-edith*
